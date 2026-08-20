<script lang="ts">
  import { appState, navigate } from "../app.svelte.ts";
  import { formatRelative } from "../lib/util/format.ts";
  import type { NoteMeta } from "../lib/store/store.svelte.ts";
  import { mobile } from "../lib/util/mobile.svelte.ts";
  import { folderRegistry } from "../lib/store/folders.ts";
  import { folderSignal } from "../lib/util/signals.svelte.ts";
  import { clickOutside, checkedAttr } from "../lib/util/dom.ts";
  import { buildNoteExport } from "../lib/io/export.ts";
  import { saveFile } from "../lib/io/save.ts";
  import { addNotice } from "../lib/sync/notices.svelte.ts";
  import FolderCombo from "../lib/components/FolderCombo.svelte";
  import SortCombo, { type SortBy } from "../lib/components/SortCombo.svelte";
  import Icon from "../lib/components/Icon.svelte";
  import ShareModal from "../lib/components/ShareModal.svelte";
  import type { SearchHit, Snippet } from "../lib/store/search.ts";
  import {
    bulkTrash,
    bulkRestore,
    bulkDelete,
    bulkSetFolder,
    bulkTogglePin,
    dragPayload,
    flushSync,
  } from "../lib/bulk.ts";

  let index = $derived(appState.index);
  let filterFolder = $derived(appState.filterFolder);
  let filterTrash = $derived(appState.filterTrash);
  let isMobile = $derived(mobile());
  let sortBy = $state<SortBy>("updated");
  let search = $derived(appState.searchQuery);
  let tagList = $derived(index?.tagList ?? []);
  let unassignedOnly = $derived(appState.unassignedOnly);
  let openMenu = $state<string | null>(null);
  let menuMoveId = $state<string | null>(null);
  let shareModalNoteId = $state<string | null>(null);
  let moveOpen = $state(false);
  let folderNames = $state<string[]>([]);
  let selected = $state(new Set<string>());
  let anchor = $state<string | null>(null);
  let notes = $derived.by(() => {
    if (!index) return [];

    const _reactive = [index.list, index.trashList];
    const q = search.trim();

    if (q) {
      const hits = index
        .search(q)
        .map((hit) => ({ meta: index.getById(hit.id), hit }))
        .filter(
          (r): r is { meta: NoteMeta; hit: SearchHit } =>
            !!r.meta &&
            (filterTrash ? !!r.meta.trashed : !r.meta.trashed) &&
            (!filterFolder || r.meta.folder === filterFolder) &&
            (!appState.unassignedOnly || !r.meta.folder) &&
            (!appState.filterTag || r.meta.tags.includes(appState.filterTag)),
        )
        .sort((a, b) => b.hit.score - a.hit.score);

      const pinned = hits.filter((r) => r.meta.pinned);
      const rest = hits.filter((r) => !r.meta.pinned);

      return [...pinned, ...rest].map((r) => ({
        ...r.meta,
        snippet: r.hit.snippet ? snippetHtml(r.hit.snippet) : null,
      }));
    }

    let list: NoteMeta[];

    if (filterTrash) {
      list = [...index.trashList];
    } else {
      list = [...index.list];
      if (filterFolder) {
        list = list.filter((n) => n.folder === filterFolder);
      } else if (appState.unassignedOnly) {
        list = list.filter((n) => !n.folder);
      }
    }

    const tag = appState.filterTag;
    if (tag) {
      list = list.filter((n) => n.tags.includes(tag));
    }

    const pinned = list.filter((n) => n.pinned);
    const rest = list.filter((n) => !n.pinned);
    const cmp = (a: NoteMeta, b: NoteMeta) => {
      if (sortBy === "title") return a.title.localeCompare(b.title);

      const key = sortBy;

      return (b[key] ?? 0) - (a[key] ?? 0);
    };

    pinned.sort(cmp);
    rest.sort(cmp);

    return [...pinned, ...rest].map((n) => ({ ...n, snippet: null }));
  });

  let allFolders = $derived(
    [...folderNames].sort((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase()),
    ),
  );
  let allSelected = $derived(
    notes.length > 0 && notes.every((n) => selected.has(n.id)),
  );
  let someSelected = $derived(selected.size > 0 && !allSelected);
  let selectedIds = $derived([...selected]);
  let allPinned = $derived(
    selectedIds.length > 0 &&
      selectedIds.every((id) => index?.getById(id)?.pinned),
  );

  $effect(() => {
    const visible = new Set(notes.map((n) => n.id));
    const next = new Set([...selected].filter((id) => visible.has(id)));
    if (next.size !== selected.size) selected = next;
  });

  $effect(() => {
    appState.lastSync;
    folderSignal();
    void refreshFolders();
  });

  async function refreshFolders() {
    const st = appState.store;
    if (!st) return;

    await folderRegistry.load(st);
    folderNames = [...folderRegistry.names];
  }

  function esc(s: string): string {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function snippetHtml(s: Snippet): string {
    return `${esc(s.before)}<mark>${esc(s.match)}</mark>${esc(s.after)}`;
  }

  function openNote(id: string) {
    if (openMenu) {
      openMenu = null;

      return;
    }

    navigate(`note/${id}`);
  }

  function toggleSelect(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selected = next;
  }

  function selectRange(from: string, to: string) {
    const ids = notes.map((n) => n.id);
    const a = ids.indexOf(from);
    const b = ids.indexOf(to);
    if (a === -1 || b === -1) return;

    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    selected = new Set(ids.slice(lo, hi + 1));
  }

  function selectClick(e: MouseEvent, id: string) {
    if (e.shiftKey) {
      const from = anchor ?? (selected.size > 0 ? [...selected][0] : id);
      selectRange(from, id);

      return;
    }

    toggleSelect(id);
    anchor = id;
  }

  function rowClick(e: MouseEvent, id: string) {
    if (e.shiftKey || e.ctrlKey || e.metaKey || selected.size > 0) {
      selectClick(e, id);

      return;
    }

    openNote(id);
  }

  function selectAllVisible() {
    selected = allSelected ? new Set() : new Set(notes.map((n) => n.id));
  }

  function clearSelection() {
    moveOpen = false;
    anchor = null;
    selected = new Set();
  }

  function dragStart(e: DragEvent, id: string) {
    dragPayload(e, selected.has(id) ? [...selected] : [id]);
  }

  async function trashSelected() {
    await bulkTrash(selectedIds);
    clearSelection();
    flushSync();
  }

  async function restoreSelected() {
    await bulkRestore(selectedIds);
    clearSelection();
    flushSync();
  }

  async function deleteSelected() {
    if (await bulkDelete(selectedIds)) clearSelection();
  }

  async function moveSelected(folder: string) {
    await bulkSetFolder(selectedIds, folder);
    clearSelection();
    flushSync();
  }

  async function togglePinSelected() {
    await bulkTogglePin(selectedIds);
    clearSelection();
    flushSync();
  }

  async function exportIds(ids: string[]) {
    const store = appState.store;
    if (!store) return;

    try {
      const res = await buildNoteExport(store, ids);
      if (!res) return;

      const outcome = await saveFile(res.name, res.bytes);
      if (outcome === "saved") addNotice("info", `exported ${res.name}`);
    } catch {
      addNotice("error", "export failed");
    }
  }

  async function exportNote(e: Event, id: string) {
    e.stopPropagation();
    openMenu = null;
    await exportIds([id]);
  }

  function exportSelected() {
    void exportIds(selectedIds);
  }

  async function deleteAllTrash() {
    if (!index || !filterTrash) return;

    const ids = index.trashList.map((n) => n.id);
    if (ids.length === 0) return;

    if (await bulkDelete(ids)) clearSelection();
  }

  async function moveNote(e: Event, id: string, folder: string) {
    e.stopPropagation();
    openMenu = null;
    menuMoveId = null;
    await bulkSetFolder([id], folder);
    flushSync();
  }

  async function trashNote(e: Event, id: string) {
    e.stopPropagation();
    openMenu = null;
    menuMoveId = null;
    await bulkTrash([id]);
    flushSync();
  }

  async function restoreNote(e: Event, id: string) {
    e.stopPropagation();
    openMenu = null;
    menuMoveId = null;
    await bulkRestore([id]);
    flushSync();
  }

  async function deleteNote(e: Event, id: string) {
    e.stopPropagation();
    openMenu = null;
    menuMoveId = null;
    await bulkDelete([id]);
  }

  async function togglePin(e: Event, id: string) {
    e.stopPropagation();
    menuMoveId = null;
    await bulkTogglePin([id]);
    flushSync();
  }

  function toggleMenu(e: Event, id: string) {
    e.stopPropagation();
    menuMoveId = null;
    openMenu = openMenu === id ? null : id;
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key !== "Escape") return;

    if (selected.size > 0) {
      e.preventDefault();
      clearSelection();
    } else if (moveOpen) {
      moveOpen = false;
    } else if (menuMoveId) {
      menuMoveId = null;
    } else {
      openMenu = null;
    }
  }
</script>

<svelte:document
  onclick={() => {
    openMenu = null;
    menuMoveId = null;
  }}
/>
<svelte:window onkeydown={onKeydown} />

<main class="note-list">
  <div class="bar-header">
    {#if isMobile}
      <div class="mobile-controls">
        <FolderCombo />
        <SortCombo value={sortBy} onchange={(v) => (sortBy = v)} />
        {#if filterTrash}
          <button class="btn-delete-all" onclick={deleteAllTrash}
            >delete all</button
          >
        {/if}
      </div>
    {:else}
      <h1 class="bar-title">{filterTrash ? "trash" : "notes"}</h1>
      <div class="header-controls">
        {#if filterTrash}
          <button class="btn-delete-all" onclick={deleteAllTrash}
            >delete all</button
          >
        {/if}
        {#if !filterTrash && !filterFolder}
          <label class="unassigned-filter" title="only notes without a folder">
            <input type="checkbox" bind:checked={appState.unassignedOnly} />
            unassigned only
          </label>
        {/if}
        <input
          class="search-input"
          type="text"
          placeholder="search…"
          bind:value={appState.searchQuery}
        />
        <span class="sort-wrap">
          <select
            class="sort-select"
            bind:value={sortBy}
            title="sort"
            disabled={!!search.trim()}
          >
            <option value="updated">updated</option>
            <option value="created">created</option>
            <option value="title">title</option>
          </select>
          <Icon name="chevron-down" size={10} class="sort-caret" />
        </span>
      </div>
    {/if}
  </div>

  {#if tagList.length > 0}
    <div class="tag-bar">
      {#each tagList as t (t.tag)}
        <span
          class="tag-chip"
          class:active={appState.filterTag === t.tag}
          role="button"
          tabindex="0"
          onkeydown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              appState.filterTag = appState.filterTag === t.tag ? null : t.tag;
            }
          }}
          onclick={() => {
            appState.filterTag = appState.filterTag === t.tag ? null : t.tag;
          }}
        >
          {t.tag}<span class="tag-count">{t.count}</span>
        </span>
      {/each}
    </div>
  {/if}

  {#if notes.length > 0}
    <div class="select-row">
      <label class="select-all">
        <input
          type="checkbox"
          use:checkedAttr={allSelected}
          indeterminate={someSelected}
          onclick={() => selectAllVisible()}
        />
        <span>{allSelected ? "deselect all" : "select all"}</span>
      </label>
    </div>
  {/if}

  {#if notes.length === 0}
    <div class="empty">
      <p>
        {search.trim()
          ? `no matches for "${search.trim()}"`
          : filterTrash
            ? "trash is empty"
            : unassignedOnly
              ? "no unassigned notes"
              : appState.filterTag
                ? `no notes with #${appState.filterTag}`
                : "no notes yet"}
      </p>
    </div>
  {:else}
    <div class="list-items">
      {#each notes as note (note.id)}
        <div
          class="note-row"
          class:pinned={note.pinned}
          class:selected={selected.has(note.id)}
          role="button"
          tabindex="0"
          draggable="true"
          ondragstart={(e) => dragStart(e, note.id)}
          onclick={(e) => rowClick(e, note.id)}
          onkeydown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              if (selected.size > 0) toggleSelect(note.id);
              else openNote(note.id);
            }
          }}
        >
          <span class="note-check">
            <input
              type="checkbox"
              use:checkedAttr={selected.has(note.id)}
              aria-label={`select ${note.title}`}
              onclick={(e) => {
                e.stopPropagation();
                selectClick(e, note.id);
              }}
            />
          </span>
          <div class="note-body">
            <div class="note-top">
              <span class="note-title">
                {note.title}
              </span>
              <span class="note-actions">
                <span class="note-time">{formatRelative(note.updated)}</span>
                <span class="note-time note-created"
                  >{formatRelative(note.created)}</span
                >
                {#if note.folder}
                  <span class="note-folder">{note.folder}</span>
                {/if}
                <span
                  class="note-star"
                  class:starred={note.pinned}
                  role="button"
                  tabindex="0"
                  onkeydown={(e) => e.key === "Enter" && togglePin(e, note.id)}
                  title={note.pinned ? "unpin" : "pin"}
                  onclick={(e) => togglePin(e, note.id)}
                >
                  {#if note.pinned}
                    <Icon name="star-check" size={14} />
                  {:else}
                    <Icon name="star" size={14} />
                  {/if}
                </span>
                <span
                  class="note-menu-wrap"
                  role="button"
                  tabindex="0"
                  onkeydown={(e) => e.key === "Enter" && toggleMenu(e, note.id)}
                  title="more"
                  onclick={(e) => toggleMenu(e, note.id)}
                >
                  <Icon name="ellipsis-vertical" size={14} />
                  {#if openMenu === note.id}
                    <div
                      class="note-menu"
                      role="presentation"
                      onclick={(e) => e.stopPropagation()}
                    >
                      {#if filterTrash}
                        <button
                          class="menu-item"
                          onclick={(e) => restoreNote(e, note.id)}>restore</button
                        >
                        <button
                          class="menu-item"
                          onclick={(e) => deleteNote(e, note.id)}>delete</button
                        >
                      {:else if menuMoveId === note.id}
                        <button
                          class="menu-item"
                          onclick={(e) => {
                            e.stopPropagation();
                            menuMoveId = null;
                          }}>← back</button
                        >
                        <div class="menu-sep"></div>
                        <button
                          class="menu-item"
                          onclick={(e) => moveNote(e, note.id, "")}
                          >all notes</button
                        >
                        {#each allFolders as name (name)}
                          <button
                            class="menu-item"
                            onclick={(e) => moveNote(e, note.id, name)}
                            >{name}</button
                          >
                        {/each}
                      {:else}
                        <button
                          class="menu-item"
                          onclick={(e) => togglePin(e, note.id)}
                          >{note.pinned ? "unpin" : "pin"}</button
                        >
                        <button
                          class="menu-item"
                          onclick={(e) => {
                            e.stopPropagation();
                            menuMoveId = note.id;
                          }}>move to</button
                        >
                        <button
                          class="menu-item"
                          onclick={(e) => {
                            e.stopPropagation();
                            openMenu = null;
                            shareModalNoteId = note.id;
                          }}>share</button
                        >
                        <button
                          class="menu-item"
                          onclick={(e) => exportNote(e, note.id)}>export</button
                        >
                        <button
                          class="menu-item"
                          onclick={(e) => trashNote(e, note.id)}>trash</button
                        >
                      {/if}
                    </div>
                  {/if}
                </span>
              </span>
            </div>
            {#if note.snippet}
              <div class="note-preview">{@html note.snippet}</div>
            {:else if note.preview}
              <div class="note-preview">{note.preview}</div>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}

  {#if selected.size > 0}
    <div class="bulk-bar">
      <span class="bulk-count">{selected.size} selected</span>
      <div class="bulk-actions">
        {#if filterTrash}
          <button class="bulk-btn" onclick={restoreSelected}>restore</button>
          <button class="bulk-btn" onclick={deleteSelected}>delete</button>
          <button class="bulk-btn" onclick={exportSelected}>export</button>
          <button class="bulk-btn" onclick={clearSelection}>clear</button>
        {:else}
          <button class="bulk-btn" onclick={togglePinSelected}
            >{allPinned ? "unpin" : "pin"}</button
          >
          <div class="bulk-move" use:clickOutside={() => (moveOpen = false)}>
            <button class="bulk-btn" onclick={() => (moveOpen = !moveOpen)}
              >move to</button
            >
            {#if moveOpen}
              <div
                class="dd bulk-dd"
                role="listbox"
                tabindex="-1"
                onclick={(e) => e.stopPropagation()}
                onkeydown={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  class="dd-item"
                  onclick={() => {
                    moveOpen = false;
                    void moveSelected("");
                  }}
                >
                  <span class="dd-check" aria-hidden="true"></span>
                  <span class="dd-label">all notes</span>
                </button>
                {#if allFolders.length}
                  <div class="dd-sep" aria-hidden="true"></div>
                  {#each allFolders as name (name)}
                    <button
                      type="button"
                      class="dd-item"
                      onclick={() => {
                        moveOpen = false;
                        void moveSelected(name);
                      }}
                    >
                      <span class="dd-check" aria-hidden="true"></span>
                      <span class="dd-label">{name}</span>
                    </button>
                  {/each}
                {/if}
              </div>
            {/if}
          </div>
          <button class="bulk-btn" onclick={exportSelected}>export</button>
          <button class="bulk-btn" onclick={trashSelected}>trash</button>
          <button class="bulk-btn" onclick={clearSelection}>clear</button>
        {/if}
      </div>
    </div>
  {/if}

  {#if shareModalNoteId}
    <ShareModal noteId={shareModalNoteId} onclose={() => (shareModalNoteId = null)} />
  {/if}
</main>

<style>
  .note-list {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .mobile-controls {
    display: flex;
    align-items: center;
    gap: var(--gap);
    flex: 1;
    min-width: 0;
  }

  .mobile-controls :global(.combo-wrap) {
    flex: 1 1 0;
    min-width: 0;
  }

  .header-controls {
    display: flex;
    align-items: center;
    gap: var(--gap);
  }

  .search-input {
    width: var(--search-w);
    height: var(--ctl-h);
    padding: 0 var(--ctl-px);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--bg-2);
    color: var(--fg);
    font-size: var(--fs-base);
  }

  .search-input:focus {
    outline: var(--focus-ring);
    outline-offset: -1px;
    border-color: var(--border-strong);
  }

  .sort-wrap {
    position: relative;
    display: inline-flex;
    align-items: center;
  }

  .sort-select {
    -webkit-appearance: none;
    -moz-appearance: none;
    appearance: none;
    height: var(--ctl-h);
    padding: 0 calc(var(--ctl-px) + var(--s1) + 10px) 0 var(--ctl-px);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--bg-2);
    color: var(--fg-2);
    font-size: var(--fs-sm);
    cursor: pointer;
  }
  .sort-select:hover {
    border-color: var(--border-strong);
  }

  .sort-select:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .sort-select:focus {
    outline: var(--focus-ring);
    outline-offset: -1px;
  }

  :global(.sort-caret) {
    position: absolute;
    top: 50%;
    right: var(--ctl-px);
    transform: translateY(-50%);
    color: var(--fg-3);
    pointer-events: none;
  }

  .empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--fg-3);
    font-size: var(--fs-base);
    text-transform: lowercase;
  }

  .list-items {
    flex: 1;
    overflow-y: auto;
    padding: var(--pad-row);
  }

  .tag-bar {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s1);
    padding: var(--pad-xs);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .tag-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--s1);
    font-size: var(--fs-xs);
    color: var(--fg-3);
    background: var(--bg-3);
    border-radius: var(--r-sm);
    padding: var(--pad-xs);
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.1s ease, color 0.1s ease;
  }

  .tag-chip:hover {
    color: var(--fg);
  }

  .tag-chip.active {
    color: var(--fg);
    background: var(--bg-2);
  }

  .tag-count {
    opacity: 0.7;
  }

  .select-row {
    display: flex;
    align-items: center;
    padding: var(--pad-xs) var(--pad-row);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .select-all {
    display: inline-flex;
    align-items: center;
    gap: var(--gap);
    font-size: var(--fs-xs);
    color: var(--fg-3);
    cursor: pointer;
    user-select: none;
  }

  .note-row {
    display: flex;
    align-items: flex-start;
    gap: var(--gap);
    width: 100%;
    text-align: left;
    padding: var(--pad-row);
    border-radius: var(--r-md);
    margin-bottom: var(--s1);
    border: 1px solid transparent;
    transition: background 0.1s ease, border-color 0.1s ease;
  }

  .note-row:hover {
    background: var(--bg-2);
  }

  .note-row.pinned {
    background: var(--bg-2);
    border-color: var(--border);
  }

  .note-row.selected {
    background: var(--bg-3);
  }

  .note-check {
    flex-shrink: 0;
  }

  .note-body {
    flex: 1;
    min-width: 0;
  }

  .note-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap-lg);
    min-height: var(--icon-btn-xs);
  }

  .note-title {
    font-size: var(--fs-base);
    font-weight: 500;
    color: var(--fg);
    display: flex;
    align-items: center;
    gap: var(--gap);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }

  .note-actions {
    display: flex;
    align-items: center;
    gap: var(--gap);
    flex-shrink: 0;
  }

  .note-time {
    font-size: var(--fs-xs);
    color: var(--fg-3);
    white-space: nowrap;
  }

  .note-created {
    color: var(--fg-3);
    opacity: 0.7;
  }

  .note-folder {
    font-size: var(--fs-xs);
    color: var(--fg-3);
    background: var(--bg-3);
    padding: var(--pad-xs);
    border-radius: var(--r-sm);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .note-star,
  .note-menu-wrap {
    width: var(--icon-btn-xs);
    height: var(--icon-btn-xs);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--fg-3);
    border-radius: var(--r-sm);
    cursor: pointer;
    transition: background 0.1s ease, color 0.1s ease;
  }

  .note-star:hover,
  .note-menu-wrap:hover {
    background: var(--bg-3);
    color: var(--fg);
  }

  .note-star.starred {
    color: var(--fg);
  }

  .note-menu-wrap {
    position: relative;
  }

  .note-menu {
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: var(--s1);
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    padding: var(--pad-xs);
    min-width: var(--menu-w);
    z-index: 20;
    box-shadow: 0 4px 12px rgb(0 0 0 / 0.1);
    transform-origin: top right;
    animation: dropdownEnter 0.18s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }

  .menu-item {
    display: block;
    width: 100%;
    text-align: left;
    padding: var(--pad-sm);
    font-size: var(--fs-sm);
    color: var(--fg-2);
    border-radius: 0;
    transition: background 0.1s ease, color 0.1s ease;
  }

  .menu-item:hover {
    background: var(--bg-3);
    color: var(--fg);
  }

  .menu-sep {
    height: 1px;
    background: var(--border);
    margin: var(--pad-xs) 0;
  }

  .unassigned-filter {
    display: inline-flex;
    align-items: center;
    gap: var(--s1);
    font-size: var(--fs-xs);
    color: var(--fg-3);
    cursor: pointer;
    white-space: nowrap;
    user-select: none;
  }

  .btn-delete-all {
    height: var(--ctl-h);
    padding: 0 var(--ctl-px);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: var(--fs-xs);
    color: var(--fg-3);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    white-space: nowrap;
    transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
  }

  .btn-delete-all:hover {
    color: var(--fg);
    border-color: var(--border-strong);
    background: var(--bg-3);
  }

  .note-preview {
    font-size: var(--fs-sm);
    color: var(--fg-3);
    margin-top: var(--s1);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .note-preview :global(mark) {
    background: var(--bg-3);
    color: var(--fg);
    border-radius: var(--r-sm);
    padding: 0 var(--pad-xs);
  }

  .bulk-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap);
    padding: var(--pad-bar);
    border-top: 1px solid var(--border);
    background: var(--bg-2);
    flex-shrink: 0;
    animation: slideUp 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }

  .bulk-count {
    font-size: var(--fs-sm);
    color: var(--fg-3);
    white-space: nowrap;
  }

  .bulk-actions {
    display: flex;
    align-items: center;
    gap: var(--gap);
  }

  .bulk-btn {
    padding: var(--pad-sm);
    font-size: var(--fs-sm);
    color: var(--fg-2);
    border-radius: var(--r-sm);
    white-space: nowrap;
    transition: background 0.12s ease, color 0.12s ease;
  }

  .bulk-btn:hover {
    background: var(--bg-3);
    color: var(--fg);
  }

  .bulk-move {
    position: relative;
    display: inline-flex;
  }

  .bulk-dd {
    left: auto;
    right: 0;
    top: auto;
    bottom: calc(100% + var(--s1));
  }

  @media (max-width: 800px) {
    .note-created {
      display: none;
    }

    .note-folder {
      display: none;
    }
  }
</style>
