<script lang="ts">
  import { appState, navigate, toggleSettings } from "../../app.svelte.ts";
  import { folderRegistry } from "../store/folders.ts";
  import {
    bulkRestore,
    bulkSetFolder,
    bulkTrash,
    droppedIds,
    flushSync,
  } from "../bulk.ts";
  import { folderSignal } from "../util/signals.svelte.ts";
  import { createNote, promptAddFolder, promptDeleteFolder } from "../actions.ts";
  import Icon from "./Icon.svelte";
  import SyncStatus from "./SyncStatus.svelte";
  import { aiConfigured, openChat } from "../ai/state.svelte.ts";

  let aiOn = $derived(aiConfigured());

  let index = $derived(appState.index);
  let folderNames = $state<string[]>([]);
  let dragOver = $state<string | null>(null);
  let allFolders = $derived(
    [...folderNames].sort((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase()),
    ),
  );

  function dragEnter(key: string) {
    dragOver = key;
  }

  function dragLeave(e: DragEvent, key: string) {
    if (dragOver !== key) return;

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;

    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      dragOver = null;
    }
  }

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
    dragOver = null;

    const ids = droppedIds(e);
    if (ids.length === 0) return;

    await bulkRestore(ids);
    await bulkSetFolder(ids, "");
    flushSync();
  }

  async function dropOnFolder(e: DragEvent, name: string) {
    e.preventDefault();
    dragOver = null;

    const ids = droppedIds(e);
    if (ids.length === 0) return;

    await bulkSetFolder(ids, name);
    flushSync();
  }

  async function dropOnTrash(e: DragEvent) {
    e.preventDefault();
    dragOver = null;

    const ids = droppedIds(e);
    if (ids.length === 0) return;

    await bulkTrash(ids);
    flushSync();
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
    <div class="bar-actions">
      {#if aiOn}
        <button class="btn-new" onclick={openChat} title="ask your notes"
          ><Icon name="sparkles" size={18} /></button
        >
      {/if}
      <button class="btn-new" onclick={() => createNote()} title="new note"
        ><Icon name="plus" size={18} /></button
      >
    </div>
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
      class:drag-over={dragOver === "all"}
      ondragenter={() => dragEnter("all")}
      ondragleave={(e) => dragLeave(e, "all")}
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
      class:drag-over={dragOver === "trash"}
      ondragenter={() => dragEnter("trash")}
      ondragleave={(e) => dragLeave(e, "trash")}
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
        class:drag-over={dragOver === `folder:${name}`}
        ondragenter={() => dragEnter(`folder:${name}`)}
        ondragleave={(e) => dragLeave(e, `folder:${name}`)}
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
    <button class="btn-settings" onclick={toggleSettings}>
      <Icon name="settings" size={16} />
      <span>settings</span>
    </button>
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
    color: var(--fg-2);
    border: none;
    background: transparent;
    cursor: pointer;
    transition: background 0.1s ease, color 0.1s ease;
  }

  .bar-actions {
    display: flex;
    align-items: center;
    gap: var(--s1);
  }

  .btn-new:hover {
    background: var(--bg-3);
    color: var(--fg);
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
    transition: background 0.1s ease, color 0.1s ease;
  }

  .filter-item:hover {
    background: var(--bg-3);
  }

  .filter-item.active {
    background: var(--bg);
    color: var(--fg);
    font-weight: 500;
  }

  .filter-item.drag-over {
    background: var(--bg-3);
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
    transition: background 0.1s ease, color 0.1s ease;
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
    transition: background 0.1s ease, color 0.1s ease;
  }

  .folder-row:hover {
    background: var(--bg-3);
  }

  .folder-row.active {
    background: var(--bg);
    color: var(--fg);
    font-weight: 500;
  }

  .folder-row.drag-over {
    background: var(--bg-3);
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
    height: var(--ctl-h);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--s2);
    padding: 0 var(--ctl-px);
    border-radius: var(--r-sm);
    border: 1px solid var(--border);
    text-align: center;
    cursor: pointer;
    transition: background 0.1s ease, color 0.1s ease, border-color 0.1s ease;
  }

  .btn-settings:hover {
    background: var(--bg-3);
    color: var(--fg);
    border-color: var(--border-strong);
  }
</style>
