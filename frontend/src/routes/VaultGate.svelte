<script lang="ts">
  import { onMount } from "svelte";
  import { deriveKeys } from "../lib/util/crypto.ts";
  import type { VaultStore } from "../lib/store/store.svelte.ts";
  import { BrowserStore, NoteIndex } from "../lib/store/store.svelte.ts";
  import { NativeStore, VaultMismatchError } from "../lib/store/store-native.ts";
  import { connectSync } from "../lib/connect-sync.ts";
  import type { Keys } from "../lib/util/crypto.ts";
  import { appState, navigate } from "../app.svelte.ts";
  import {
    loadSettings,
    saveSettings,
    loadPassphrase,
    savePassphrase,
    clearPassphrase,
    loadSecrets,
    applyTheme,
  } from "../lib/util/settings.ts";
  import { isDesktop, invoke, tauriFs } from "../lib/util/tauri.ts";
  import { hydrateAiConfig } from "../lib/ai/state.svelte.ts";
  import { folderRegistry } from "../lib/store/folders.ts";
  import {
    inspectVaultFolder,
    type VaultFolderStats,
  } from "../lib/store/vault-folder.ts";
  import ConfirmFolderModal from "../lib/components/ConfirmFolderModal.svelte";

  const settings = loadSettings();

  let passphrase = $state("");
  let rememberPassphrase = $state(true);
  let error = $state("");
  let loading = $state(false);
  let theme = $state(settings.theme || "light");
  let mismatch = $state(false);
  let confirmReset = $state(false);
  let folderWarn = $state<{ dir: string; stats: VaultFolderStats } | null>(
    null,
  );
  let vaultDir = $state(settings.vaultDir || "");
  let autoUnlocking = $state(true);

  function errorText(e: unknown, fallback: string): string {
    const msg =
      e instanceof Error
        ? e.message
        : typeof e === "string"
          ? e
          : e &&
              typeof e === "object" &&
              "message" in e &&
              typeof (e as { message: unknown }).message === "string"
            ? (e as { message: string }).message
            : fallback;

    return (msg || fallback).toLowerCase().trim();
  }

  $effect(() => {
    applyTheme(theme);
  });

  function toggleTheme() {
    theme = theme === "light" ? "dark" : "light";
    applyTheme(theme);
  }

  async function pickFolder() {
    error = "";

    try {
      const dir = await invoke("pick_vault_folder");
      if (typeof dir !== "string" || !dir) return;

      vaultDir = dir;
      saveSettings({ vaultDir: dir });
      await invoke("grant_vault_scope", { dir });
    } catch {
      error = "could not open folder picker";
    }
  }

  async function unlock() {
    if (!passphrase.trim() || (isDesktop() && !vaultDir)) {
      error = "passphrase required";
      if (isDesktop() && !vaultDir)
        error = "choose a vault folder and enter a passphrase";

      return;
    }

    if (isDesktop()) {
      const fs = tauriFs();
      const sep = vaultDir.endsWith("/") || vaultDir.endsWith("\\") ? "" : "/";
      const alreadyAdopted = await fs
        .exists(`${vaultDir}${sep}.folio/state.json`)
        .catch(() => false);

      if (!alreadyAdopted) {
        try {
          const stats = await inspectVaultFolder(fs, vaultDir);

          if (stats.files > 0 || stats.dirs > 0) {
            folderWarn = { dir: vaultDir, stats };

            return;
          }
        } catch {}
      }
    }

    await doUnlock();
  }

  async function doUnlock() {
    loading = true;
    error = "";
    mismatch = false;
    confirmReset = false;

    try {
      const keys = await deriveKeys(passphrase.trim());
      let store: VaultStore;

      if (isDesktop()) {
        store = new NativeStore(keys.vaultId, vaultDir, tauriFs());
      } else {
        store = new BrowserStore(keys.vaultId);
      }

      await store.init();
      await finishUnlock(store, keys);
    } catch (e: unknown) {
      if (e instanceof VaultMismatchError) {
        mismatch = true;

        return;
      }

      console.error("[folio] unlock failed:", e);
      error = errorText(e, "unlock failed");
    } finally {
      loading = false;
    }
  }

  async function finishUnlock(store: VaultStore, keys: Keys): Promise<void> {
    if (rememberPassphrase) {
      await savePassphrase(passphrase.trim());
    } else {
      await clearPassphrase();
    }

    await hydrateAiConfig();

    const index = new NoteIndex();
    await index.rebuild(store);
    await folderRegistry.load(store);
    appState.keys = keys;
    appState.store = store;
    appState.index = index;
    appState.vaultUnlocked = true;
    appState.sync = null;
    appState.syncStatus = "synced";
    appState.lastSync = null;
    appState.lastError = null;
    navigate("");
    window.FolioSplash?.ready?.();
    void wireSync(store, index, keys);
  }

  async function resetFolder() {
    if (!isDesktop() || !vaultDir) return;

    if (!confirmReset) {
      confirmReset = true;

      return;
    }

    loading = true;
    error = "";

    try {
      const keys = await deriveKeys(passphrase.trim());
      const store = new NativeStore(keys.vaultId, vaultDir, tauriFs());
      await store.resetLocal();
      await finishUnlock(store, keys);
    } catch (e: unknown) {
      console.error("[folio] folder reset failed:", e);
      error = errorText(e, "reset failed");
      mismatch = true;
    } finally {
      loading = false;
    }
  }

  async function wireSync(
    store: VaultStore,
    index: NoteIndex,
    keys: Keys,
  ): Promise<void> {
    if (!appState.vaultUnlocked) return;

    const cfg = loadSettings();
    const { token } = await loadSecrets();
    const res = await connectSync(cfg.serverUrl, token, keys, store, index);

    if (res.sync) {
      appState.sync = res.sync;
      appState.syncStatus = res.sync.status;
      await res.sync.pushPending();
      await res.sync.pull();
    } else if (res.status === "offline") {
      appState.sync = null;
      appState.syncStatus = "offline";
      appState.lastError = res.message ?? null;
    } else if (res.status === "error") {
      appState.sync = null;
      appState.syncStatus = "error";
      appState.lastError = res.message ?? null;
    }
  }

  onMount(async () => {
    if (isDesktop() && vaultDir) {
      void invoke("grant_vault_scope", { dir: vaultDir }).catch(() => {});
    }

    const saved = await loadPassphrase();
    if (saved) passphrase = saved;

    if (saved && (!isDesktop() || vaultDir)) {
      try {
        await unlock();
      } catch {
        autoUnlocking = false;
        window.FolioSplash?.ready?.();
      } finally {
        if (!appState.vaultUnlocked) {
          autoUnlocking = false;
          window.FolioSplash?.ready?.();
        }
      }
    } else {
      autoUnlocking = false;
      window.FolioSplash?.ready?.();
    }
  });
</script>

{#if !autoUnlocking}
  <div class="gate">
    <div class="gate-card">
      <h1>folio</h1>
      <p class="subtitle">local-first encrypted notes</p>
      {#if isDesktop()}
        <div class="folder-box">
          <label>
            <span>vault folder</span>
            <input type="button" hidden />
            {#if vaultDir}
              <span class="vault-dir">{vaultDir}</span>
            {:else}
              <span class="folder-hint"
                >notes live as plain markdown files in a folder you choose.</span
              >
            {/if}
          </label>
          <button
            class="btn-change-folder"
            onclick={pickFolder}
            disabled={loading}
          >
            {loading
              ? "picking…"
              : vaultDir
                ? "change folder"
                : "choose folder"}
          </button>
        </div>
      {/if}
      <label>
        <span>passphrase</span>
        <input
          type="password"
          bind:value={passphrase}
          placeholder="encryption passphrase"
          onkeydown={(e) => {
            if (e.key === "Enter") unlock();
          }}
        />
      </label>
      <label class="checkbox-row">
        <input type="checkbox" bind:checked={rememberPassphrase} />
        <span>remember passphrase</span>
      </label>
      {#if mismatch}
        <div class="error">
          <p>
            this folder belongs to a different vault (different passphrase).
          </p>
          <p class="reset-note">
            resetting clears the folder's folio state and adopts its files as a
            new vault — your note files are kept.
          </p>
        </div>
      {:else if error}
        <p class="error">{error}</p>
      {/if}
      {#if mismatch}
        <button class="btn-unlock" onclick={resetFolder} disabled={loading}>
          {confirmReset ? "confirm reset" : "reset folder & unlock"}
        </button>
      {:else}
        <button class="btn-unlock" onclick={unlock} disabled={loading}>
          {loading ? "unlocking…" : "unlock"}
        </button>
      {/if}
      <button class="btn-theme" onclick={toggleTheme} title="toggle theme">
        {theme === "light" ? "dark mode" : "light mode"}
      </button>
    </div>
  </div>
{/if}

{#if folderWarn}
  <ConfirmFolderModal
    folder={folderWarn.dir}
    stats={folderWarn.stats}
    oncontinue={() => {
      const w = folderWarn;
      folderWarn = null;
      if (w) void doUnlock();
    }}
    oncancel={() => (folderWarn = null)}
  />
{/if}

<style>
  .gate {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    background: var(--bg);
  }

  .gate-card {
    width: 100%;
    max-width: var(--maxw-narrow);
    padding: var(--pad-xl);
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
    background: var(--bg);
    box-shadow: 0 16px 48px rgb(0 0 0 / 0.12);
  }

  h1 {
    font-size: var(--fs-3xl);
    font-weight: 600;
    margin-bottom: var(--s1);
    text-transform: lowercase;
  }

  .subtitle {
    color: var(--fg-2);
    font-size: var(--fs-sm);
    margin-bottom: var(--s5);
    text-transform: lowercase;
  }

  .folder-hint {
    color: var(--fg-3);
    font-size: var(--fs-sm);
    margin-bottom: var(--s4);
    text-transform: lowercase;
  }

  .vault-dir {
    display: block;
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    color: var(--fg-2);
    word-break: break-all;
    text-transform: none;
  }

  .folder-box {
    margin-bottom: var(--gap);
  }

  .btn-change-folder {
    font-size: var(--fs-xs);
    color: var(--fg-3);
    padding: var(--pad-sm);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    margin-bottom: var(--gap-lg);
  }

  .btn-change-folder:disabled {
    opacity: 0.5;
  }

  .btn-change-folder:hover {
    color: var(--fg-2);
  }

  .reset-note {
    font-size: var(--fs-xs);
    color: var(--fg-3);
    margin-top: var(--s2);
    text-transform: lowercase;
  }

  label {
    display: block;
    margin-bottom: var(--gap-lg);
  }

  label > span {
    display: block;
    font-size: var(--fs-sm);
    color: var(--fg-2);
    margin-bottom: var(--s1);
    text-transform: lowercase;
  }

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

  input[type="password"]:focus {
    outline: var(--focus-ring);
    outline-offset: -1px;
  }

  .checkbox-row {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: var(--gap);
    margin-bottom: var(--s4);
  }

  .checkbox-row span {
    font-size: var(--fs-sm);
    color: var(--fg-2);
    text-transform: lowercase;
  }

  .error {
    color: var(--fg);
    font-size: var(--fs-sm);
    margin-bottom: var(--gap-lg);
    padding: var(--pad-md);
    background: var(--bg-3);
    border-radius: var(--r-sm);
    border: 1px solid var(--border);
    text-transform: lowercase;
  }

  .btn-unlock {
    width: 100%;
    height: var(--ctl-h);
    padding: 0 var(--s4);
    background: var(--fg);
    color: var(--bg);
    border-radius: var(--r-sm);
    font-weight: 500;
    margin-bottom: var(--gap-lg);
  }

  .btn-unlock:disabled {
    opacity: 0.5;
  }

  .btn-theme {
    font-size: var(--fs-sm);
    color: var(--fg-3);
    width: 100%;
    height: var(--ctl-h);
    padding: 0 var(--s4);
    border-radius: var(--r-sm);
  }

  .btn-theme:hover {
    color: var(--fg-2);
  }
</style>
