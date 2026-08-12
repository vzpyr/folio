<script lang="ts">
  import { appState, navigate } from "../../app.svelte.ts";
  import SyncStatus from "./SyncStatus.svelte";
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
</style>
