<script lang="ts">
  import { onMount } from "svelte";
  import { appState } from "./app.svelte.ts";
  import { isTauri } from "./lib/util/tauri.ts";
  import { NativeStore } from "./lib/store/store-native.ts";
  import { syncNotices, dismissNotice } from "./lib/sync";
  import { mobile } from "./lib/util/mobile.svelte.ts";
  import Sidebar from "./lib/components/Sidebar.svelte";
  import Icon from "./lib/components/Icon.svelte";
  import MobileChrome from "./lib/components/MobileChrome.svelte";
  import MobileTabBar from "./lib/components/MobileTabBar.svelte";
  import Dialog from "./lib/components/Dialog.svelte";
  import AiChat from "./lib/components/AiChat.svelte";
  import VaultGate from "./routes/VaultGate.svelte";
  import List from "./routes/List.svelte";
  import Note from "./routes/Note.svelte";
  import Settings from "./routes/Settings.svelte";

  let route = $derived(appState.route);
  let unlocked = $derived(appState.vaultUnlocked);
  let isMobile = $derived(mobile());
  let noteId = $derived.by(() => {
    if (route.startsWith("note/")) return decodeURIComponent(route.slice(5));

    return null;
  });

  onMount(() => {
    const onFocus = () => {
      const st = appState.store;

      if (!isTauri() || !st || !appState.index || !appState.sync) return;
      if (!(st instanceof NativeStore)) return;

      void (async () => {
        await st.rescan();
        await appState.index!.rebuild(st);
        void appState.sync!.sync();
      })();
    };

    window.addEventListener("focus", onFocus);

    return () => window.removeEventListener("focus", onFocus);
  });

  onMount(() => {
    const drop = () => window.FolioSplash?.ready?.();
    requestAnimationFrame(() => requestAnimationFrame(drop));
  });
</script>

{#if !unlocked}
  <VaultGate />
{:else}
  {#snippet mainContent()}
    {#if noteId}
      {#key noteId}
        <Note id={noteId} />
      {/key}
    {:else if route === "settings"}
      <Settings />
    {:else}
      <List />
    {/if}
  {/snippet}

  {#if isMobile}
    <div class="app-layout app-layout-mobile">
      {#if !noteId}
        <MobileChrome />
      {/if}
      <main class="app-main">
        {@render mainContent()}
      </main>
      {#if !noteId}
        <MobileTabBar />
      {/if}
    </div>
  {:else}
    <div class="app-layout">
      <Sidebar />
      <main class="app-main">
        {@render mainContent()}
      </main>
    </div>
  {/if}
{/if}

{#if syncNotices.length > 0}
  <div class="sync-notices" role="status" aria-live="polite">
    {#each syncNotices as n (n.id)}
      <div class="sync-notice {n.kind}">
        <div class="sync-notice-body">
          <div class="sync-notice-text">{n.text}</div>
          {#if n.detail}<div class="sync-notice-detail">{n.detail}</div>{/if}
        </div>
        <button
          class="sync-notice-dismiss"
          onclick={() => dismissNotice(n.id)}
          aria-label="dismiss"><Icon name="x" size={14} /></button
        >
      </div>
    {/each}
  </div>
{/if}

<Dialog />

<AiChat />

<style>
  .app-layout {
    display: flex;
    height: 100%;
    background: var(--bg);
  }

  .app-layout-mobile {
    flex-direction: column;
  }

  .app-main {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .sync-notices {
    position: fixed;
    top: calc(env(safe-area-inset-top) + var(--s4));
    right: var(--s4);
    z-index: 100;
    display: flex;
    flex-direction: column;
    gap: var(--gap);
    max-width: var(--maxw-narrow);
  }

  .sync-notice {
    display: flex;
    align-items: flex-start;
    gap: var(--gap);
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-left: 3px solid var(--g3);
    border-radius: var(--r-md);
    padding: var(--pad-md);
    box-shadow: 0 4px 16px rgb(0 0 0 / 0.15);
  }

  .sync-notice.conflict {
    border-left-color: var(--g7);
  }

  .sync-notice.error {
    border-left-color: var(--g7);
  }

  .sync-notice-body {
    flex: 1;
    min-width: 0;
  }

  .sync-notice-text {
    font-size: var(--fs-sm);
    color: var(--fg);
  }

  .sync-notice-detail {
    font-size: var(--fs-xs);
    color: var(--fg-3);
  }

  .sync-notice-dismiss {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: var(--fs-lg);
    line-height: 1;
    color: var(--fg-3);
    padding: 0 var(--s1);
    border-radius: var(--r-sm);
  }

  .sync-notice-dismiss:hover {
    color: var(--fg);
    background: var(--bg-3);
  }
</style>
