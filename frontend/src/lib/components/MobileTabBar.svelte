<script lang="ts">
  import { appState, navigate, toggleSettings } from "../../app.svelte.ts";
  import { createNote } from "../actions.ts";
  import Icon from "./Icon.svelte";

  let route = $derived(appState.route);
  let notesActive = $derived(route !== "settings" && !route.startsWith("note/"));
  let settingsActive = $derived(route === "settings");
</script>

<nav class="tabbar" aria-label="primary">
  <button
    class="tab"
    class:active={notesActive}
    onclick={() => navigate("")}
    aria-label="notes"
    aria-current={notesActive ? "page" : undefined}
  >
    <Icon name="notebook" size={22} />
    <span class="label">notes</span>
  </button>
  <button
    class="tab tab-new"
    onclick={() => createNote()}
    aria-label="new note"
  >
    <Icon name="plus" size={24} />
  </button>
  <button
    class="tab"
    class:active={settingsActive}
    onclick={toggleSettings}
    aria-label="settings"
    aria-current={settingsActive ? "page" : undefined}
  >
    <Icon name="settings" size={22} />
    <span class="label">settings</span>
  </button>
</nav>

<style>
  .tabbar {
    display: flex;
    align-items: stretch;
    justify-content: space-around;
    flex-shrink: 0;
    height: calc(var(--tabbar-h) + env(safe-area-inset-bottom));
    padding-bottom: env(safe-area-inset-bottom);
    background: var(--bg-2);
    border-top: 1px solid var(--border);
  }

  .tab {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--s1);
    padding: var(--pad-xs);
    color: var(--fg-3);
    border-radius: 0;
    transition: color 0.15s ease, opacity 0.12s ease;
  }

  .tab:active {
    opacity: 0.7;
  }

  .tab .label {
    font-size: var(--fs-xs);
    text-transform: lowercase;
    letter-spacing: 0.01em;
  }

  .tab.active {
    color: var(--fg);
  }

  .tab.active .label {
    font-weight: 600;
  }

  .tab-new {
    position: relative;
    color: var(--fg);
  }

  .tab-new::before {
    content: "";
    position: absolute;
    top: 0;
    left: 50%;
    transform: translate(-50%, calc(-1 * var(--fab-overhang)));
    width: var(--fab);
    height: var(--fab);
    border-radius: var(--r-full);
    background: var(--fg);
    color: var(--bg);
    box-shadow: 0 2px 8px rgb(0 0 0 / 0.18);
    z-index: 0;
  }

  .tab-new :global(svg) {
    position: absolute;
    top: calc(
      -1 * var(--fab-overhang) + (var(--fab) - var(--fab-icon)) / 2
    );
    left: 50%;
    transform: translateX(-50%);
    z-index: 1;
    color: var(--bg);
  }

  .tab-new:focus-visible {
    outline: none;
  }

  .tab-new:focus-visible::before {
    outline: var(--focus-ring);
    outline-offset: 1px;
  }
</style>
