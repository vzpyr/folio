<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { appState, navigate } from "../app.svelte.ts";
  import {
    loadSettings,
    saveSettings,
    loadSecrets,
    saveSecrets,
    applyTheme,
    clearPassphrase,
    clearAllSettings,
  } from "../lib/util/settings.ts";
  import { isDesktop, invoke, tauriFs } from "../lib/util/tauri.ts";
  import { NativeStore } from "../lib/store/store-native.ts";
  import {
    inspectVaultFolder,
    type VaultFolderStats,
  } from "../lib/store/vault-folder.ts";
  import { connectSync } from "../lib/connect-sync.ts";
  import { formatRelative } from "../lib/util/format.ts";
  import {
    applyFonts,
    loadFontCatalog,
    unloadFontCatalog,
    FONTS,
  } from "../lib/util/fonts.ts";
  import ImportExport from "./ImportExport.svelte";
  import ConfirmFolderModal from "../lib/components/ConfirmFolderModal.svelte";
  import FontPicker from "../lib/components/FontPicker.svelte";
  import { tauriHttpFetch } from "../lib/util/tauri.ts";
  import { aiConfig, updateAiConfig } from "../lib/ai/state.svelte.ts";

  const settings = loadSettings();

  let theme = $state(settings.theme || "light");
  let uiFont = $state(settings.uiFont);
  let editorFont = $state(settings.editorFont);
  let confirmSignOut = $state(false);
  let confirmClear = $state(false);
  let vaultId = $derived(appState.keys?.vaultId ?? "");
  let manageDataOpen = $state(false);
  let vaultDir = $state(
    appState.store instanceof NativeStore ? appState.store.vaultDir : "",
  );
  let folderError = $state("");
  let pendingFolder = $state<{ dir: string; stats: VaultFolderStats } | null>(
    null,
  );
  let syncUrl = $state(settings.serverUrl || "");
  let syncToken = $state("");
  let syncConnecting = $state(false);
  let syncError = $state("");
  let syncConnected = $derived(!!appState.sync);
  let syncStatus = $derived(appState.syncStatus);
  let lastSync = $derived(appState.lastSync);
  let lastError = $derived(appState.lastError);
  let syncConfigured = $state(false);
  let aiModels = $state<string[]>([]);
  let aiLoadingModels = $state(false);
  let aiError = $state("");

  async function loadAiModels() {
    if (!aiConfig.baseUrl.trim()) {
      aiError = "base url required";

      return;
    }

    aiLoadingModels = true;
    aiError = "";

    try {
      const base = aiConfig.baseUrl.trim().replace(/\/+$/, "");
      const headers: Record<string, string> = {};
      if (aiConfig.token.trim()) headers.Authorization = `Bearer ${aiConfig.token.trim()}`;

      const res = await tauriHttpFetch(`${base}/models`, { headers });
      if (!res.ok) throw new Error(`${res.status}`);

      const data = (await res.json()) as { data?: { id: string }[] };
      aiModels = [...new Set((data.data ?? []).map((m) => m.id))].sort();

      if (aiModels.length === 0) aiError = "no models returned";
    } catch (e: unknown) {
      aiError = e instanceof Error ? e.message : "could not load models";
    } finally {
      aiLoadingModels = false;
    }
  }

  $effect(() => {
    applyTheme(theme);
    applyFonts(uiFont, editorFont);
  });

  onMount(async () => {
    loadFontCatalog();
    const sec = await loadSecrets();
    syncToken = sec.token;
    syncConfigured = !!settings.serverUrl && !!sec.token;
  });
  onDestroy(unloadFontCatalog);

  function toggleTheme() {
    theme = theme === "light" ? "dark" : "light";
    applyTheme(theme);
  }

  async function changeFolder() {
    const st = appState.store;
    if (!(st instanceof NativeStore)) return;

    folderError = "";

    try {
      const dir = await invoke("pick_vault_folder");
      if (typeof dir !== "string" || !dir) return;

      await invoke("grant_vault_scope", { dir });

      const stats = await inspectVaultFolder(tauriFs(), dir);

      if (stats.files > 0 || stats.dirs > 0) {
        pendingFolder = { dir, stats };

        return;
      }

      await relink(dir);
    } catch (e: unknown) {
      folderError =
        e instanceof Error
          ? e.message.toLowerCase()
          : "could not change folder";
    }
  }

  async function relink(dir: string) {
    const st = appState.store;
    if (!(st instanceof NativeStore)) return;

    folderError = "";

    try {
      await st.setVaultDir(dir);
      await st.rescan();
      if (appState.index) await appState.index.rebuild(st);
      saveSettings({ vaultDir: dir });
      vaultDir = st.vaultDir;

      if (appState.sync) {
        await appState.sync.pushPending();
        await appState.sync.pull();
      }
    } catch (e: unknown) {
      folderError =
        e instanceof Error
          ? e.message.toLowerCase()
          : "could not change folder";
    }
  }

  async function connectSyncNow() {
    if (
      !syncUrl.trim() ||
      !syncToken.trim() ||
      !appState.store ||
      !appState.index ||
      !appState.keys
    ) {
      syncError = "server url and token required";

      return;
    }

    syncConnecting = true;
    syncError = "";

    try {
      await appState.sync?.destroy();
      appState.sync = null;

      const res = await connectSync(
        syncUrl,
        syncToken,
        appState.keys,
        appState.store,
        appState.index,
      );

      if (res.sync) {
        appState.sync = res.sync;
        appState.syncStatus = res.sync.status;
        saveSettings({ serverUrl: syncUrl.trim() });
        await saveSecrets({ token: syncToken.trim() });
        syncConfigured = true;
        await res.sync.pushPending();
        await res.sync.pull();
      } else if (res.status === "offline") {
        saveSettings({ serverUrl: syncUrl.trim() });
        await saveSecrets({ token: syncToken.trim() });
        syncConfigured = true;
        appState.sync = null;
        appState.syncStatus = "offline";
        appState.lastError = res.message ?? null;
        syncError = res.message ?? "could not reach server";
      } else {
        syncError = res.message ?? "could not connect";
      }
    } catch (e: unknown) {
      syncError = e instanceof Error ? e.message : "could not connect";
    } finally {
      syncConnecting = false;
    }
  }

  async function disconnectSync() {
    await appState.sync?.destroy();
    appState.sync = null;
    appState.syncStatus = "synced";
    appState.lastSync = null;
    appState.lastError = null;
    saveSettings({ serverUrl: "" });
    await saveSecrets({ token: "" });

    syncUrl = "";
    syncToken = "";
    syncConfigured = false;
  }

  async function signOut() {
    if (!confirmSignOut) {
      confirmSignOut = true;

      return;
    }

    await appState.sync?.destroy();
    await clearPassphrase();
    appState.vaultUnlocked = false;
    appState.store = null;
    appState.index = null;
    appState.sync = null;
    appState.keys = null;
    appState.syncStatus = "synced";
    appState.lastSync = null;
    appState.lastError = null;
    navigate("");
  }

  async function clearData() {
    if (!confirmClear) {
      confirmClear = true;

      return;
    }

    await appState.sync?.destroy();
    if (appState.store) await appState.store.clearAll();
    await clearAllSettings();
    appState.vaultUnlocked = false;
    appState.store = null;
    appState.index = null;
    appState.sync = null;
    appState.keys = null;
    appState.syncStatus = "synced";
    appState.lastSync = null;
    appState.lastError = null;
    navigate("");
  }
</script>

<main class="settings-content">
  <h1>settings</h1>

  <section>
    <h2>appearance</h2>
    <div class="setting-row">
      <span class="setting-label">theme</span>
      <button class="btn-toggle" onclick={toggleTheme}>
        {theme === "light" ? "switch to dark" : "switch to light"}
      </button>
    </div>
    <div class="setting-row">
      <span class="setting-label">ui font</span>
      <FontPicker value={uiFont} fonts={FONTS} label="ui font" onchange={(v) => (uiFont = v)} />
    </div>
    <div class="setting-row">
      <span class="setting-label">editor font</span>
      <FontPicker
        value={editorFont}
        fonts={FONTS}
        label="editor font"
        onchange={(v) => (editorFont = v)}
      />
    </div>
    <p class="signout-note">provided by bunny fonts</p>
  </section>

  <section>
    <h2>sync</h2>
    <p class="signout-note">
      optional — link a self-hosted server to sync across devices. without it,
      folio is fully local on this device.
    </p>
    {#if syncConnected || syncStatus === "offline" || syncConfigured}
      {#if !syncConnected}
        <div class="setting-row">
          <span class="setting-label">server</span><span
            class="setting-value mono vault-path">{syncUrl || "—"}</span
          >
        </div>
      {/if}
      <button
        class="btn-toggle"
        onclick={disconnectSync}
        disabled={syncConnecting}
      >
        disconnect sync
      </button>
    {:else}
      <label class="sync-field">
        <span>server url</span>
        <input
          type="text"
          bind:value={syncUrl}
          placeholder="https://notes.example.com"
        />
      </label>
      <label class="sync-field">
        <span>token</span>
        <input
          type="password"
          bind:value={syncToken}
          placeholder="server bearer token"
        />
      </label>
      {#if syncError}<p class="error-note">{syncError}</p>{/if}
      <button
        class="btn-save"
        onclick={connectSyncNow}
        disabled={syncConnecting}
      >
        {syncConnecting ? "connecting…" : "connect"}
      </button>
    {/if}
  </section>

  <section>
    <h2>ai</h2>
    <p class="signout-note">
      optional — connect an openai-compatible chat api (openai, openrouter,
      groq, ollama, …). credentials stay on this device and are never synced.
    </p>
    <label class="sync-field">
      <span>base url</span>
      <input
        type="text"
        value={aiConfig.baseUrl}
        placeholder="https://api.openai.com/v1"
        oninput={(e) => updateAiConfig({ baseUrl: e.currentTarget.value })}
      />
    </label>
    <label class="sync-field">
      <span>api key (optional)</span>
      <input
        type="password"
        value={aiConfig.token}
        placeholder="sk-…"
        oninput={(e) => updateAiConfig({ token: e.currentTarget.value })}
      />
    </label>
    <label class="sync-field">
      <span>model</span>
      <input
        type="text"
        value={aiConfig.model}
        placeholder="gpt-4o-mini"
        oninput={(e) => updateAiConfig({ model: e.currentTarget.value })}
      />
    </label>
    <button
      class="btn-save"
      onclick={loadAiModels}
      disabled={aiLoadingModels}
    >
      {aiLoadingModels ? "loading…" : "load models"}
    </button>
    {#if aiModels.length > 0}
      <div class="ai-models">
        {#each aiModels as m (m)}
          <button
            class="ai-model"
            class:active={m === aiConfig.model}
            onclick={() => updateAiConfig({ model: m })}
          >
            {m}
          </button>
        {/each}
      </div>
    {/if}
    {#if aiError}<p class="error-note">{aiError}</p>{/if}
  </section>

  <section>
    <h2>data</h2>
    <div class="setting-row">
      <span class="setting-label">vault id</span>
      <span class="setting-value mono">{vaultId.slice(0, 12)}…</span>
    </div>
    {#if isDesktop()}
      <div class="setting-row">
        <span class="setting-label">folder</span>
        <span class="setting-value mono vault-path">{vaultDir || "—"}</span>
      </div>
      <p class="signout-note">
        notes are plain .md files here; external edits are picked up on focus or
        sync.
      </p>
      <button class="btn-save" onclick={changeFolder}>change folder</button>
      {#if folderError}
        <p class="error-note">{folderError}</p>
      {/if}
    {/if}
    <div class="row-actions">
      <button class="btn-toggle" onclick={() => (manageDataOpen = true)}>
        manage data
      </button>
      <button class="btn-signout" onclick={signOut}>
        {confirmSignOut ? "confirm sign out" : "sign out"}
      </button>
      <button class="btn-signout" onclick={clearData}>
        {confirmClear ? "confirm clear" : "clear local data"}
      </button>
    </div>
    {#if confirmSignOut}
      <p class="signout-note">
        locks the vault and clears the remembered passphrase — notes, token and
        server url stay
      </p>
    {/if}
    {#if confirmClear}
      <p class="signout-note">
        deletes ALL notes and attachments and clears everything: passphrase,
        token, server url, theme, vault folder. irreversible.
      </p>
    {/if}
  </section>
</main>

{#if manageDataOpen}
  <ImportExport initialTab="import" onclose={() => (manageDataOpen = false)} />
{/if}

{#if pendingFolder}
  <ConfirmFolderModal
    folder={pendingFolder.dir}
    stats={pendingFolder.stats}
    oncontinue={() => {
      const p = pendingFolder;
      pendingFolder = null;
      if (p) void relink(p.dir);
    }}
    oncancel={() => (pendingFolder = null)}
  />
{/if}

<style>
  .settings-content {
    flex: 1;
    height: 100%;
    overflow-y: auto;
    padding: var(--pad-page);
    max-width: var(--maxw-page);
    margin: 0 auto;
  }

  h1 {
    font-size: var(--fs-2xl);
    font-weight: 600;
    text-transform: lowercase;
    margin-bottom: var(--s5);
  }

  h2 {
    font-size: var(--fs-base);
    font-weight: 600;
    text-transform: lowercase;
    color: var(--fg-2);
    margin-bottom: var(--gap-lg);
    padding-bottom: var(--s2);
    border-bottom: 1px solid var(--border);
  }

  section {
    margin-bottom: var(--s6);
  }

  .setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--pad-sm);
    font-size: var(--fs-sm);
  }

  .setting-label {
    color: var(--fg-3);
    text-transform: lowercase;
    font-size: var(--fs-sm);
    display: block;
    margin-bottom: var(--s1);
  }

  .setting-value {
    color: var(--fg-2);
  }

  .mono {
    font-family: var(--font-mono);
    font-size: var(--fs-sm);
  }

  .vault-path {
    word-break: break-all;
    text-align: right;
    text-transform: none;
  }

  .error-note {
    font-size: var(--fs-xs);
    color: var(--fg-3);
    margin-top: var(--s2);
    text-transform: lowercase;
  }

  input[type="text"],
  input[type="password"] {
    width: 100%;
    height: var(--ctl-h);
    padding: 0 var(--ctl-px);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-2);
    color: var(--fg);
    font-size: var(--fs-base);
  }

  input:focus {
    outline: var(--focus-ring);
    outline-offset: -1px;
  }

  .btn-toggle,
  .btn-save,
  .btn-signout {
    height: var(--ctl-h);
    padding: 0 var(--ctl-px);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    font-size: var(--fs-sm);
    color: var(--fg-2);
  }

  .row-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gap);
    margin-top: var(--s2);
  }

  .btn-toggle:hover,
  .btn-save:hover,
  .btn-signout:hover {
    background: var(--bg-3);
    color: var(--fg);
    border-color: var(--border-strong);
  }

  .btn-save {
    margin-top: var(--s3);
  }

  .signout-note {
    font-size: var(--fs-xs);
    color: var(--fg-3);
    margin-top: var(--s2);
    text-transform: lowercase;
  }

  .sync-field {
    display: block;
    margin-bottom: var(--gap-lg);
  }

  .sync-field span {
    display: block;
    font-size: var(--fs-sm);
    color: var(--fg-2);
    margin-bottom: var(--s1);
    text-transform: lowercase;
  }

  .sync-pill {
    font-size: var(--fs-xs);
    padding: var(--pad-xs);
    border-radius: var(--r-full);
    border: 1px solid var(--border);
    text-transform: lowercase;
    color: var(--fg-2);
  }

  .sync-pill.synced {
    border-color: var(--g5);
    color: var(--g5);
  }

  .sync-pill.offline {
    border-color: var(--g3);
    color: var(--g3);
  }

  .sync-pill.error {
    border-color: var(--border-strong);
    color: var(--fg);
  }

  .ai-models {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s1);
    margin-top: var(--s3);
  }

  .ai-model {
    padding: var(--pad-xs) var(--pad-sm);
    font-size: var(--fs-xs);
    color: var(--fg-3);
    background: var(--bg-3);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
  }

  .ai-model:hover {
    color: var(--fg);
    border-color: var(--border-strong);
  }

  .ai-model.active {
    color: var(--fg);
    border-color: var(--fg-3);
  }
</style>
