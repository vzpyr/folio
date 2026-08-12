<script lang="ts">
  import { appState, navigate } from "../../app.svelte.ts";
  import { promptAddFolder, promptDeleteFolder } from "../actions.ts";
  import { folderRegistry } from "../store/folders.ts";
  import { folderSignal } from "../util/signals.svelte.ts";
  import { clickOutside } from "../util/dom.ts";
  import Icon from "./Icon.svelte";

  let index = $derived(appState.index);
  let filterFolder = $derived(appState.filterFolder);
  let filterTrash = $derived(appState.filterTrash);
  let lastSync = $derived(appState.lastSync);
  let open = $state(false);
  let folderNames = $state<string[]>([]);
  let allFolders = $derived(
    [...folderNames].sort((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase()),
    ),
  );

  function countFor(name: string): number {
    return (
      appState.index?.folderList.find((f) => f.folder === name)?.count ?? 0
    );
  }

  let chipLabel = $derived(
    filterTrash ? "trash" : (filterFolder ?? "all notes"),
  );

  function selectAll() {
    appState.filterFolder = null;
    appState.filterTrash = false;
    navigate("");
    open = false;
  }

  function selectTrash() {
    appState.filterTrash = true;
    appState.filterFolder = null;
    navigate("");
    open = false;
  }

  function selectFolder(name: string) {
    appState.filterFolder = name;
    appState.filterTrash = false;
    navigate("");
    open = false;
  }

  function toggleUnassigned() {
    if (appState.filterFolder || appState.filterTrash) {
      appState.unassignedOnly = true;
      appState.filterFolder = null;
      appState.filterTrash = false;
      navigate("");
    } else {
      appState.unassignedOnly = !appState.unassignedOnly;
    }
  }

  async function refreshFolders() {
    const st = appState.store;
    if (!st) return;

    await folderRegistry.load(st);
    folderNames = [...folderRegistry.names];
  }

  async function addFolder() {
    open = false;
    await promptAddFolder();
  }

  async function removeFolder(name: string, ev: Event) {
    ev.stopPropagation();
    await promptDeleteFolder(name);
  }

  function toggle() {
    open = !open;
  }

  $effect(() => {
    lastSync;
    folderSignal();
    void refreshFolders();
  });
</script>

<div class="combo-wrap" use:clickOutside={() => (open = false)}>
  <button
    type="button"
    class="combo"
    class:open
    onclick={toggle}
    aria-haspopup="listbox"
    aria-expanded={open}
    title="folders"
  >
    <span class="combo-label">{chipLabel}</span>
    <Icon name="chevron-down" size={10} class="combo-caret" />
  </button>

  {#if open}
    <div
      class="dd"
      role="listbox"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        class="dd-item"
        class:active={!filterFolder && !filterTrash}
        onclick={selectAll}
      >
        <span class="dd-check" aria-hidden="true"></span>
        <span class="dd-label">all notes</span>
      </button>
      <button
        type="button"
        class="dd-item dd-sub"
        class:active={appState.unassignedOnly && !filterFolder && !filterTrash}
        onclick={toggleUnassigned}
      >
        <span class="dd-check"
          >{#if appState.unassignedOnly && !filterFolder && !filterTrash}<Icon
              name="check"
              size={12}
            />{/if}</span
        >
        <span class="dd-label">unassigned only</span>
      </button>
      <button
        type="button"
        class="dd-item"
        class:active={filterTrash}
        onclick={selectTrash}
      >
        <span class="dd-check" aria-hidden="true"></span>
        <span class="dd-label">trash</span>
        {#if index?.trashCount}<span class="dd-count">{index.trashCount}</span
          >{/if}
      </button>

      {#if allFolders.length}
        <div class="dd-sep" aria-hidden="true"></div>
        {#each allFolders as name (name)}
          <div
            class="dd-item dd-folder"
            class:active={filterFolder === name}
            role="option"
            aria-selected={filterFolder === name}
            tabindex="0"
            onclick={() => selectFolder(name)}
            onkeydown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                selectFolder(name);
              }
            }}
          >
            <button
              type="button"
              class="dd-x"
              title="delete folder"
              aria-label="delete folder {name}"
              onclick={(e) => removeFolder(name, e)}
              ><Icon name="x" size={12} /></button
            >
            <span class="dd-label">{name}</span>
            <span class="dd-count">{countFor(name)}</span>
          </div>
        {/each}
      {/if}

      <div class="dd-sep" aria-hidden="true"></div>
      <button type="button" class="dd-item dd-add" onclick={addFolder}>
        <span class="dd-check" aria-hidden="true"></span>
        <span class="dd-label">+ new folder</span>
      </button>
    </div>
  {/if}
</div>

<style>
  .dd-sub {
    padding-left: var(--s4);
    font-size: var(--fs-sm);
  }

  .dd-folder {
    padding-left: var(--s1);
  }

  .dd-x {
    width: var(--icon-btn-xs);
    height: var(--icon-btn-xs);
    flex-shrink: 0;
    border-radius: var(--r-sm);
    color: var(--fg-3);
    font-size: var(--fs-sm);
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .dd-x:hover {
    background: var(--bg);
    color: var(--fg);
  }

  .dd-add {
    color: var(--fg-3);
  }

  .dd-add:hover {
    color: var(--fg);
  }
</style>
