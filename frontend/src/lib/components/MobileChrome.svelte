<script lang="ts">
  import { appState, navigate } from "../../app.svelte.ts";
  import SyncStatus from "./SyncStatus.svelte";
  import Icon from "./Icon.svelte";
  import { aiConfigured, openChat } from "../ai/state.svelte.ts";

  let aiOn = $derived(aiConfigured());
</script>

<header class="chrome">
  <input
    class="search"
    type="text"
    placeholder="search notes…"
    bind:value={appState.searchQuery}
    onfocus={() => {
      if (appState.route === "settings") navigate("");
    }}
    aria-label="search notes"
  />
  {#if aiOn}
    <button class="btn-ai" onclick={openChat} aria-label="ask your notes"
      ><Icon name="sparkles" size={18} /></button
    >
  {/if}
  <SyncStatus variant="button" />
</header>

<style>
  .chrome {
    display: flex;
    align-items: center;
    gap: var(--gap);
    padding: var(--pad-bar);
    background: var(--bg-2);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .search {
    flex: 1;
    min-width: 0;
    height: var(--ctl-h);
    min-height: var(--ctl-h);
    padding: 0 var(--ctl-px);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--bg);
    color: var(--fg);
    font-size: var(--fs-lg);
  }

  .search:focus {
    outline: var(--focus-ring);
    outline-offset: -1px;
    border-color: var(--border-strong);
  }

  .btn-ai {
    width: var(--ctl-h);
    height: var(--ctl-h);
    min-height: var(--ctl-h);
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--bg);
    color: var(--fg-2);
    transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
  }

  .btn-ai:hover {
    border-color: var(--border-strong);
    color: var(--fg);
  }
</style>
