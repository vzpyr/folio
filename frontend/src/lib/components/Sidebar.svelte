<script lang="ts">
  import { appState, navigate, toggleSettings } from "../../app.svelte.ts";
  import { setTrashed } from "../store/store.svelte.ts";
  import { folderRegistry, setNoteFolder } from "../store/folders.ts";
  import { folderSignal } from "../util/signals.svelte.ts";
  import { createNote, promptAddFolder, promptDeleteFolder } from "../actions.ts";
  import Icon from "./Icon.svelte";
  import SyncStatus from "./SyncStatus.svelte";

  let index = $derived(appState.index);
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

  async function refreshFolders() {
    const st = appState.store;
    if (!st) return;

    await folderRegistry.load(st);
    folderNames = [...folderRegistry.names];
  }

  async function dropOnAll(e: DragEvent) {
    e.preventDefault();

    const st = appState.store;
    const idx = appState.index;
    const noteId = e.dataTransfer?.getData("text/folio-note");
    if (!st || !idx || !noteId) return;

    await setTrashed(st, idx, noteId, false);
    await setNoteFolder(st, idx, noteId, "");
    if (appState.sync) void appState.sync.sync();
  }

  async function dropOnFolder(e: DragEvent, name: string) {
    e.preventDefault();

    const st = appState.store;
    const idx = appState.index;
    const noteId = e.dataTransfer?.getData("text/folio-note");
    if (!st || !idx || !noteId) return;

    await setNoteFolder(st, idx, noteId, name);
    if (appState.sync) void appState.sync.sync();
  }

  async function dropOnTrash(e: DragEvent) {
    e.preventDefault();

    const st = appState.store;
    const idx = appState.index;
    const noteId = e.dataTransfer?.getData("text/folio-note");
    if (!st || !idx || !noteId) return;

    await setTrashed(st, idx, noteId, true);
    if (appState.sync) void appState.sync.sync();
  }

  $effect(() => {
    appState.lastSync;
    folderSignal();
    void refreshFolders();
  });
</script>

<aside class="sidebar">
  <div class="bar-header">
    <h1 class="bar-title">folio</h1>
    <button class="btn-new" onclick={() => createNote()} title="new note"
      ><Icon name="plus" size={18} /></button
    >
  </div>

  <div class="sidebar-section">
    <h3>sync</h3>
    <SyncStatus variant="row" />
  </div>

  <div class="sidebar-section">
    <div class="section-head">
      <h3>folders</h3>
      <button class="btn-add-folder" onclick={promptAddFolder} title="new folder"
        ><Icon name="plus" size={14} /></button
      >
    </div>
    <button
      class="filter-item"
      class:active={appState.filterFolder === null && !appState.filterTrash}
      ondragover={(e) => e.preventDefault()}
      ondrop={dropOnAll}
      onclick={() => {
        appState.filterFolder = null;
        appState.filterTrash = false;
        navigate("");
      }}
    >
      all notes
    </button>
    <button
      class="filter-item filter-trash"
      class:active={appState.filterTrash}
      ondragover={(e) => e.preventDefault()}
      ondrop={dropOnTrash}
      onclick={() => {
        appState.filterTrash = true;
        appState.filterFolder = null;
        navigate("");
      }}
    >
      trash {#if index?.trashCount}<span class="count">{index.trashCount}</span
        >{/if}
    </button>
    {#each allFolders as name (name)}
      <div
        role="button"
        tabindex="0"
        onkeydown={(e) => {
          if (e.key === "Enter") {
            appState.filterFolder = name;
            appState.filterTrash = false;
          }
        }}
        class="folder-row"
        class:active={appState.filterFolder === name}
        ondragover={(e) => e.preventDefault()}
        ondrop={(e) => dropOnFolder(e, name)}
        onclick={() => {
          appState.filterFolder = name;
          appState.filterTrash = false;
          navigate("");
        }}
      >
        <button
          class="folder-x"
          title="delete folder"
          onclick={(e) => {
            e.stopPropagation();
            void promptDeleteFolder(name);
          }}><Icon name="x" size={12} /></button
        >
        <span class="folder-name">{name}</span>
        <span class="count">{countFor(name)}</span>
      </div>
    {/each}
    {#if allFolders.length === 0}
      <span class="folder-none">no folders</span>
    {/if}
  </div>

  <div class="sidebar-footer">
    <button class="btn-settings" onclick={toggleSettings}>settings</button>
  </div>
</aside>

<style>
  .sidebar {
    width: var(--sidebar-w);
    min-width: var(--sidebar-w);
    height: 100%;
    overflow-y: auto;
    background: var(--bg-2);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
  }

  .btn-new {
    width: var(--icon-btn);
    height: var(--icon-btn);
    border-radius: var(--r-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--fs-xl);
    color: var(--fg-2);
    border: 1px solid var(--border);
  }

  .btn-new:hover {
    background: var(--bg-3);
  }

  .sidebar-section {
    padding: var(--pad-panel);
    border-bottom: 1px solid var(--border);
  }

  .sidebar-section h3 {
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--fg-3);
    text-transform: lowercase;
    margin-bottom: var(--gap);
  }

  .filter-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: var(--pad-sm);
    font-size: var(--fs-sm);
    color: var(--fg-2);
    border-radius: var(--r-sm);
    text-align: left;
  }

  .filter-item:hover {
    background: var(--bg-3);
  }

  .filter-item.active {
    background: var(--bg);
    color: var(--fg);
    font-weight: 500;
  }

  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--gap);
  }

  .btn-add-folder {
    width: var(--icon-btn-xs);
    height: var(--icon-btn-xs);
    border-radius: var(--r-sm);
    color: var(--fg-3);
    font-size: var(--fs-sm);
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .btn-add-folder:hover {
    background: var(--bg-3);
    color: var(--fg);
  }

  .folder-row {
    display: flex;
    align-items: center;
    gap: var(--s1);
    width: 100%;
    padding: var(--pad-sm);
    font-size: var(--fs-sm);
    color: var(--fg-2);
    border-radius: var(--r-sm);
    text-align: left;
    cursor: default;
  }

  .folder-row:hover {
    background: var(--bg-3);
  }

  .folder-row.active {
    background: var(--bg);
    color: var(--fg);
    font-weight: 500;
  }

  .folder-x {
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

  .folder-x:hover {
    background: var(--bg);
    color: var(--fg);
  }

  .folder-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .folder-none {
    display: block;
    font-size: var(--fs-xs);
    color: var(--fg-3);
    padding: var(--pad-sm);
  }

  .count {
    font-size: var(--fs-xs);
    color: var(--fg-3);
  }

  .sidebar-footer {
    margin-top: auto;
    padding: var(--pad-panel);
    border-top: 1px solid var(--border);
  }

  .btn-settings {
    font-size: var(--fs-sm);
    color: var(--fg-3);
    width: 100%;
    padding: var(--pad-sm);
    border-radius: var(--r-sm);
    border: 1px solid var(--border);
    text-align: center;
  }

  .btn-settings:hover {
    background: var(--bg-3);
  }
</style>
