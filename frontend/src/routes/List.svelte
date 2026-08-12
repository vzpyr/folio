<script lang="ts">
  import { appState, navigate } from "../app.svelte.ts";
  import { formatRelative } from "../lib/util/format.ts";
  import { parseFrontmatter, writeFrontmatter } from "../lib/editor/markdown.ts";
  import type { NoteMeta } from "../lib/store/store.svelte.ts";
  import { setTrashed } from "../lib/store/store.svelte.ts";
  import { pruneEmptyFolder } from "../lib/store/folders.ts";
  import { mobile } from "../lib/util/mobile.svelte.ts";
  import FolderCombo from "../lib/components/FolderCombo.svelte";
  import SortCombo, { type SortBy } from "../lib/components/SortCombo.svelte";
  import Icon from "../lib/components/Icon.svelte";

  let index = $derived(appState.index);
  let filterFolder = $derived(appState.filterFolder);
  let filterTrash = $derived(appState.filterTrash);
  let isMobile = $derived(mobile());
  let sortBy = $state<SortBy>("updated");
  let search = $derived(appState.searchQuery);
  let unassignedOnly = $derived(appState.unassignedOnly);
  let openMenu = $state<string | null>(null);
  let notes = $derived.by(() => {
    if (!index) return [];

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

    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((n) => n.title.toLowerCase().includes(q));
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

    return [...pinned, ...rest];
  });

  function openNote(id: string) {
    if (openMenu) {
      openMenu = null;

      return;
    }

    navigate(`note/${id}`);
  }

  async function togglePin(e: Event, id: string) {
    e.stopPropagation();

    const st = appState.store;
    const idx = index;
    if (!st || !idx) return;

    const cur = idx.getById(id);
    const content = await st.readNote(id);
    if (!cur || !content) return;

    const { meta: fm, body } = parseFrontmatter(content);
    const now = Date.now();
    const meta: NoteMeta = {
      ...cur,
      pinned: !cur.pinned,
      updated: now,
      dirty: true,
    };
    const newContent = writeFrontmatter(
      {
        id: cur.id,
        title: cur.title,
        created: fm.created ?? cur.created,
        updated: now,
        tags: cur.tags,
        pinned: meta.pinned,
        folder: cur.folder,
      },
      body,
    );

    await st.writeNote(id, meta, newContent);
    await idx.upsert(meta, newContent);
    void appState.sync?.sync();
  }

  async function trashNote(e: Event, id: string) {
    e.stopPropagation();
    openMenu = null;

    const st = appState.store;
    const idx = index;
    if (!st || !idx) return;

    await setTrashed(st, idx, id, true);
    void appState.sync?.sync();
  }

  async function restoreNote(e: Event, id: string) {
    e.stopPropagation();
    openMenu = null;

    const st = appState.store;
    const idx = index;
    if (!st || !idx) return;

    await setTrashed(st, idx, id, false);
    void appState.sync?.sync();
  }

  async function deleteNote(e: Event, id: string) {
    e.stopPropagation();
    openMenu = null;

    const st = appState.store;
    const idx = index;
    if (!st || !idx) return;

    if (!window.confirm("permanently delete this note?")) return;

    const folder = idx.getById(id)?.folder ?? "";
    await st.deleteNote(id);
    await idx.remove(id);
    await pruneEmptyFolder(st, idx, folder);
    void appState.sync?.pushDelete(id);
  }

  async function deleteAllTrash() {
    const st = appState.store;
    const idx = index;
    if (!st || !idx || !filterTrash) return;

    const list = [...idx.trashList];
    if (list.length === 0) return;

    if (
      !window.confirm(
        `permanently delete ${list.length} trashed ${list.length === 1 ? "note" : "notes"}?`,
      )
    )
      return;

    for (const n of list) {
      const folder = n.folder;
      await st.deleteNote(n.id);
      await idx.remove(n.id);
      await pruneEmptyFolder(st, idx, folder);
      void appState.sync?.pushDelete(n.id);
    }
  }

  function toggleMenu(e: Event, id: string) {
    e.stopPropagation();
    openMenu = openMenu === id ? null : id;
  }
</script>

<svelte:document onclick={() => (openMenu = null)} />

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
          <select class="sort-select" bind:value={sortBy} title="sort">
            <option value="updated">updated</option>
            <option value="created">created</option>
            <option value="title">title</option>
          </select>
          <Icon name="chevron-down" size={10} class="sort-caret" />
        </span>
      </div>
    {/if}
  </div>

  {#if notes.length === 0}
    <div class="empty">
      <p>
        {filterTrash
          ? "trash is empty"
          : unassignedOnly
            ? "no unassigned notes"
            : "no notes yet"}
      </p>
    </div>
  {:else}
    <div class="list-items">
      {#each notes as note (note.id)}
        <div
          class="note-row"
          class:pinned={note.pinned}
          role="button"
          tabindex="0"
          draggable="true"
          ondragstart={(e) => {
            e.dataTransfer?.setData("text/folio-note", note.id);
            if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
          }}
          onclick={() => openNote(note.id)}
          onkeydown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              openNote(note.id);
            }
          }}
        >
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
                        class="menu-item menu-danger"
                        onclick={(e) => deleteNote(e, note.id)}>delete</button
                      >
                    {:else}
                      <button
                        class="menu-item menu-danger"
                        onclick={(e) => trashNote(e, note.id)}>trash</button
                      >
                    {/if}
                  </div>
                {/if}
              </span>
            </span>
          </div>
          {#if note.preview}
            <div class="note-preview">{note.preview}</div>
          {/if}
        </div>
      {/each}
    </div>
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

  .note-row {
    display: block;
    width: 100%;
    text-align: left;
    padding: var(--pad-row);
    border-radius: var(--r-md);
    margin-bottom: var(--s1);
    border: 1px solid transparent;
  }

  .note-row:hover {
    background: var(--bg-2);
  }

  .note-row.pinned {
    background: var(--bg-2);
    border-color: var(--border);
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

  .note-star {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--fg-3);
    padding: var(--pad-xs);
    border-radius: var(--r-sm);
    cursor: pointer;
  }

  .note-star:hover {
    color: var(--g4);
  }

  .note-star.starred {
    color: var(--g4);
  }

  .note-menu-wrap {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--fg-3);
    padding: var(--pad-xs);
    border-radius: var(--r-sm);
    cursor: pointer;
  }

  .note-menu-wrap:hover {
    color: var(--fg);
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
  }

  .menu-item {
    display: block;
    width: 100%;
    text-align: left;
    padding: var(--pad-sm);
    font-size: var(--fs-sm);
    color: var(--fg-2);
    border-radius: 0;
  }

  .menu-item:hover {
    background: var(--bg-3);
    color: var(--fg);
  }

  .menu-danger:hover {
    color: var(--g7);
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
  }

  .btn-delete-all:hover {
    color: var(--g7);
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

  @media (max-width: 800px) {
    .note-created {
      display: none;
    }

    .note-folder {
      display: none;
    }
  }
</style>
