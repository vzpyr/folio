<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { appState, navigate } from "../app.svelte.ts";
  import {
    createEditor,
    setBody,
    getMarkdown,
  } from "../lib/editor/editor.ts";
  import { insertWikiLink, undo, redo } from "../lib/editor/toolbar.ts";
  import {
    parseFrontmatter,
    writeFrontmatter,
    extractTitle,
    cleanDerivedTitle,
  } from "../lib/editor/markdown.ts";
  import { formatTimestamp } from "../lib/util/format.ts";
  import Icon from "../lib/components/Icon.svelte";
  import { folderRegistry, setNoteFolder } from "../lib/store/folders.ts";
  import { mobile } from "../lib/util/mobile.svelte.ts";
  import { clickOutside, autofocus } from "../lib/util/dom.ts";
  import { buildNoteExport } from "../lib/io/export.ts";
  import { saveFile } from "../lib/io/save.ts";
  import { addNotice } from "../lib/sync/notices.svelte.ts";
  import { flushSync } from "../lib/bulk.ts";
  import { setTrashed, type NoteMeta } from "../lib/store/store.svelte.ts";
  import { folderSignal } from "../lib/util/signals.svelte.ts";
  import WikiPicker from "../lib/components/WikiPicker.svelte";
  import FindReplaceBar from "../lib/components/FindReplaceBar.svelte";
  import type { Editor } from "@tiptap/core";
  import type { Frontmatter } from "../lib/editor/markdown.ts";

  const { id }: { id: string } = $props();

  let store = $derived(appState.store);
  let isMobile = $derived(mobile());
  let index = $derived(appState.index);
  let sync = $derived(appState.sync);

  let editorEl: HTMLDivElement | undefined = $state();
  let view: Editor | null = $state(null);
  let notFound = $state(false);
  let loading = $state(true);
  let unsaved = $state(false);
  let meta = $state<NoteMeta | null>(null);
  let backlinks = $derived(index?.backlinks(id) ?? []);
  let backlinksOpen = $state(false);
  let openMenu = $state(false);
  let menuMove = $state(false);
  let folderInput = $state("");
  let folderNames = $state<string[]>([]);
  let tagInput = $state("");
  let tagSuggestions = $derived(
    (index?.tagList ?? []).filter((t) => !(meta?.tags ?? []).includes(t.tag)),
  );
  let toast = $state("");
  let wikiSeed = $state<{ q: string; n: number } | null>(null);
  let findSeed = $state<{ n: number } | null>(null);
  let tableEl = $state<HTMLElement | null>(null);
  let tablePos = $state<{
    top: number;
    bottom: number;
    left: number;
    right: number;
  } | null>(null);
  let tableMenu = $state<{ x: number; y: number } | null>(null);
  let contentScrollEl: HTMLDivElement | undefined = $state();
  let inTableSel = $state(false);
  let hoverActive = $state(false);
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  let suppressSave = false;
  let pendingImageResolves = 0;
  let savedSnapshot = {
    body: "",
    title: "",
    folder: "",
    pinned: false,
    tags: [] as string[],
  };
  let lastWrittenUpdated = 0;

  const attUrls = new Map<string, string>();

  function resolveImageRef(ref: string): Promise<string | null> {
    const cached = attUrls.get(ref);
    if (cached) return Promise.resolve(cached);

    const m = ref.match(/^assets\/([0-9a-f-]+)\.(\w+)$/);
    if (!m) return Promise.resolve(null);

    const st = store;
    if (!st) return Promise.resolve(null);

    pendingImageResolves++;

    return st
      .readAttachment(m[1])
      .then((bytes) => {
        if (!bytes) return null;

        const url = URL.createObjectURL(new Blob([bytes]));
        attUrls.set(ref, url);

        return url;
      })
      .finally(() => {
        pendingImageResolves--;
        if (pendingImageResolves === 0) setTimeout(releaseSaveSuppress, 0);
      });
  }

  function releaseSaveSuppress() {
    suppressSave = false;
  }

  function extractRefs(doc: string): Set<string> {
    const refs = new Set<string>();
    const re = /assets\/([0-9a-f-]+)\./g;
    let m: RegExpExecArray | null;

    while ((m = re.exec(doc)) !== null) refs.add(m[1]);

    return refs;
  }

  function downloadFile(ref: string, name: string, mime?: string | null) {
    const m = ref.match(/^assets\/([0-9a-f-]+)\.(\w+)$/);
    const st = store;
    if (!m || !st) return;

    void st.readAttachment(m[1]).then((bytes) => {
      if (!bytes) {
        toastMsg("file not found");

        return;
      }

      const url = URL.createObjectURL(new Blob([bytes], { type: mime || "" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    });
  }

  function toastMsg(msg: string) {
    toast = msg;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = ""), 2600);
  }

  let dirtyFlushed = false;

  function scheduleSave() {
    unsaved = true;

    if (!dirtyFlushed) {
      dirtyFlushed = true;
      void doSave(true);
    }

    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void doSave(), 800);
  }

  function fmToMeta(
    fm: Partial<Frontmatter>,
    content: string,
    base?: NoteMeta | null,
  ): NoteMeta {
    const now = Date.now();

    return {
      id: fm.id ?? id,
      title: fm.title ?? extractTitle(content, id),
      folder: fm.folder ?? "",
      tags: fm.tags ?? [],
      pinned: fm.pinned ?? false,
      created: fm.created ?? base?.created ?? now,
      updated: now,
      rev: base?.rev ?? -1,
      conflict: base?.conflict ?? false,
      trashed: fm.trashed ?? base?.trashed ?? false,
      dirty: true,
    };
  }

  async function doSave(writeOnly = false) {
    const ed = view;
    const st = store;
    const idx = index;
    if (!ed || !st || !idx) return;
    if (notFound) return;

    try {
      const body = getMarkdown(ed);
      const noteId = meta?.id ?? id;
      const cur = (await st.listNotes()).find((n) => n.id === noteId);
      const stale = !!cur && cur.updated !== lastWrittenUpdated;
      const m: NoteMeta = {
        id: noteId,
        title: meta?.title ?? extractTitle(body, id),
        folder: meta?.folder ?? "",
        tags: [...(meta?.tags ?? [])],
        pinned: meta?.pinned ?? false,
        created: meta?.created ?? Date.now(),
        updated: Date.now(),
        rev: cur?.rev ?? meta?.rev ?? -1,
        conflict: meta?.conflict ?? false,
        trashed: meta?.trashed ?? cur?.trashed ?? false,
        dirty: true,
      };
      const tagsSame =
        m.tags.length === savedSnapshot.tags.length &&
        m.tags.every((t, i) => t === savedSnapshot.tags[i]);

      if (
        body === savedSnapshot.body &&
        m.title === savedSnapshot.title &&
        m.folder === savedSnapshot.folder &&
        m.pinned === savedSnapshot.pinned &&
        tagsSame
      ) {
        if (!writeOnly) unsaved = false;

        return;
      }

      if (writeOnly && stale) {
        const recContent = await st.readNote(noteId);

        if (recContent !== null && recContent !== undefined && cur) {
          const marked: NoteMeta = { ...cur, dirty: true };
          await st.writeNote(noteId, marked, recContent);
          await idx.upsert(marked, recContent);
        }

        return;
      }

      const content = writeFrontmatter(
        {
          id: m.id,
          title: m.title,
          created: m.created,
          updated: m.updated,
          tags: m.tags,
          pinned: m.pinned,
          folder: m.folder,
          trashed: m.trashed ?? false,
        },
        body,
      );

      await st.writeNote(m.id, m, content);
      await idx.upsert(m, content);
      meta = m;
      lastWrittenUpdated = m.updated;
      savedSnapshot = {
        body,
        title: m.title,
        folder: m.folder,
        pinned: m.pinned,
        tags: [...m.tags],
      };

      if (writeOnly) {
        return;
      }

      unsaved = false;
      dirtyFlushed = false;
      await cleanupOrphanedAttachments(body, m.id);
      sync?.nudge();
    } catch (e) {
      console.error("[folio] doSave failed:", e);
    }
  }

  async function cleanupOrphanedAttachments(doc: string, noteId: string) {
    const st = store;
    if (!st) return;

    const refs = extractRefs(doc);
    const atts = await st.listAttachments();
    const candidates = atts.filter((a) => !refs.has(a.id));
    if (candidates.length === 0) return;

    const others = (await st.listNotes())
      .map((n) => n.id)
      .filter((nid) => nid !== noteId);

    for (const a of candidates) {
      let used = false;

      for (const nid of others) {
        const c = await st.readNote(nid);
        if (c && extractRefs(c).has(a.id)) {
          used = true;
          break;
        }
      }

      if (!used) await st.deleteAttachment(a.id);
    }
  }

  function updateFrontmatter(patch: Partial<Frontmatter>) {
    if (!meta) return;

    const merged: Frontmatter = {
      id: meta.id,
      title: meta.title,
      created: meta.created,
      updated: Date.now(),
      tags: meta.tags,
      pinned: meta.pinned,
      folder: meta.folder,
      ...patch,
    };
    const tagsSame =
      meta! && merged.tags.length === meta!.tags.length &&
      merged.tags.every((t, i) => t === meta!.tags![i]);

    if (
      merged.title === meta!.title &&
      merged.folder === meta!.folder &&
      merged.pinned === meta!.pinned &&
      tagsSame
    ) {
      return;
    }

    meta = { ...meta!, ...merged, updated: merged.updated, dirty: true };
    void doSave();
  }

  $effect(() => {
    appState.lastSync;
    folderSignal();
    void refreshFolders();
  });

  async function refreshFolders() {
    const st = store;
    if (!st) return;

    await folderRegistry.load(st);
    folderNames = [...folderRegistry.names];
  }

  let allFolders = $derived(
    [...folderNames].sort((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase()),
    ),
  );

  async function moveToFolder(folder: string) {
    const st = store;
    const idx = index;
    if (!st || !idx || !meta) return;

    openMenu = false;
    menuMove = false;
    folderInput = folder;
    await setNoteFolder(st, idx, meta.id, folder, folderRegistry);

    const fresh = idx.getById(meta.id);
    if (fresh) meta = fresh;

    lastWrittenUpdated = meta.updated;
    savedSnapshot = { ...savedSnapshot, folder: meta.folder };
    flushSync();
  }

  async function saveFolder() {
    const st = store;
    const idx = index;
    if (!st || !idx || !meta) return;

    openMenu = false;
    menuMove = false;
    await setNoteFolder(st, idx, meta.id, folderInput.trim(), folderRegistry);

    const fresh = idx.getById(meta.id);
    if (fresh) meta = fresh;

    lastWrittenUpdated = meta.updated;
    savedSnapshot = { ...savedSnapshot, folder: meta.folder };
    flushSync();
  }

  async function exportCurrentNote() {
    const st = store;
    if (!st || !meta) return;

    openMenu = false;
    menuMove = false;
    try {
      const res = await buildNoteExport(st, [meta.id]);
      if (!res) return;

      const outcome = await saveFile(res.name, res.bytes);
      if (outcome === "saved") addNotice("info", `exported ${res.name}`);
    } catch {
      addNotice("error", "export failed");
    }
  }

  async function trashCurrentNote() {
    const st = store;
    const idx = index;
    if (!st || !idx || !meta) return;

    openMenu = false;
    menuMove = false;
    if (saveTimer) clearTimeout(saveTimer);
    suppressSave = true;
    meta = { ...meta, trashed: true, dirty: true };
    await setTrashed(st, idx, meta.id, true);
    flushSync();
    navigate("");
  }

  function togglePin() {
    updateFrontmatter({ pinned: !meta?.pinned });
  }

  function addTag() {
    if (!meta) return;

    const parts = tagInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (!parts.length) return;

    const tags = [...meta.tags];
    for (const p of parts) {
      if (!tags.includes(p)) tags.push(p);
    }
    tagInput = "";
    updateFrontmatter({ tags });
  }

  function removeTag(i: number) {
    if (!meta) return;
    updateFrontmatter({ tags: meta.tags.filter((_, j) => j !== i) });
  }

  function findTableEl(): HTMLElement | null {
    const v = view;
    if (!v) return null;

    const sel = v.state.selection.$from;

    for (let d = sel.depth; d > 0; d--) {
      if (sel.node(d).type.name === "table") {
        const dom = v.view.nodeDOM(sel.before(d));

        return dom instanceof HTMLElement && dom.tagName === "TABLE"
          ? dom
          : null;
      }
    }

    return null;
  }

  function recomputeTablePos() {
    const el = tableEl;
    const c = contentScrollEl;

    if (!el || !c) {
      tablePos = null;

      return;
    }

    const t = el.getBoundingClientRect();
    const r = c.getBoundingClientRect();

    tablePos = {
      top: t.top - r.top,
      bottom: t.bottom - r.top,
      left: t.left - r.left,
      right: t.right - r.left,
    };
  }

  function updateTable() {
    const el = findTableEl();
    inTableSel = !!el;

    if (el) {
      tableEl = el;
      recomputeTablePos();
    } else if (!hoverActive) {
      tableEl = null;
      tablePos = null;
    }
  }

  function onTableContext(e: MouseEvent) {
    if (!view) return;

    const t = (e.target as HTMLElement).closest("table");
    if (!t) return;

    e.preventDefault();

    const hit = view.view.posAtCoords({ left: e.clientX, top: e.clientY });
    if (hit?.pos !== undefined) view.commands.setTextSelection(hit.pos);
    tableMenu = { x: e.clientX, y: e.clientY };
  }

  function tblRun(
    action:
      | "rowAbove"
      | "rowBelow"
      | "colLeft"
      | "colRight"
      | "deleteRow"
      | "deleteCol"
      | "deleteTable",
  ) {
    if (!view) return;

    const chain = view.chain().focus();

    if (action === "rowAbove") chain.addRowBefore();
    else if (action === "rowBelow") chain.addRowAfter();
    else if (action === "colLeft") chain.addColumnBefore();
    else if (action === "colRight") chain.addColumnAfter();
    else if (action === "deleteRow") chain.deleteRow();
    else if (action === "deleteCol") chain.deleteColumn();
    else chain.deleteTable();

    chain.run();
    tableMenu = null;
    updateTable();
  }

  let lastRemoteCheck = "";
  let reloadGen = 0;

  $effect(() => {
    const idx = index;
    const st = store;
    if (!idx || !st || !meta || loading) return;

    const cur = idx.all.find((n) => n.id === meta!.id);
    if (!cur) {
      if (!notFound && !unsaved) notFound = true;

      return;
    }

    if (notFound) notFound = false;

    const key = `${cur.updated}:${cur.rev}:${cur.title}:${cur.folder}:${cur.trashed ?? false}:${cur.pinned}:${(cur.tags ?? []).join(",")}`;
    if (key === lastRemoteCheck) return;

    lastRemoteCheck = key;

    if (unsaved || suppressSave) return;

    const mid = meta.id;
    const gen = ++reloadGen;

    void (async () => {
      if (gen !== reloadGen) return;

      const ed = view;
      if (!ed) return;

      const stored = await st.readNote(mid);
      if (!stored) return;

      if (unsaved || suppressSave) return;

      const { meta: fm, body } = parseFrontmatter(stored);
      const fresh: NoteMeta = { ...fmToMeta(fm, stored, cur), dirty: false };
      const bodyChanged = body !== getMarkdown(ed);

      meta = fresh;
      lastWrittenUpdated = fresh.updated;
      savedSnapshot = {
        body,
        title: fresh.title,
        folder: fresh.folder,
        pinned: fresh.pinned,
        tags: [...fresh.tags],
      };
      unsaved = false;

      if (!bodyChanged) return;

      suppressSave = true;
      for (const url of attUrls.values()) URL.revokeObjectURL(url);
      attUrls.clear();
      setBody(ed, body, resolveImageRef);

      if (pendingImageResolves === 0) {
        releaseSaveSuppress();
      }
    })();
  });

  async function loadNote() {
    const st = store;
    const idx = index;
    if (!st || !idx) return;

    loading = true;
    suppressSave = true;
    notFound = false;
    view?.destroy();
    view = null;
    attUrls.clear();

    let realId = id;
    let content = await st.readNote(id);

    if (content === null) {
      const resolved = idx.resolveLink(id);

      if (resolved && resolved !== id) {
        realId = resolved;
        content = await st.readNote(resolved);
      }
    }

    if (content === null) {
      notFound = true;
      loading = false;
      suppressSave = false;

      return;
    }

    const { meta: fm } = parseFrontmatter(content);
    const stored = (await st.listNotes()).find((n) => n.id === realId) ?? null;
    meta = fmToMeta(fm, content, stored);
    lastWrittenUpdated = stored?.updated ?? 0;
    unsaved = false;

    const { body } = parseFrontmatter(content);
    savedSnapshot = {
      body,
      title: meta.title,
      folder: meta.folder,
      pinned: meta.pinned,
      tags: [...meta.tags],
    };

    if (editorEl) {
      view = createEditor(editorEl, {
        body,
        store: st,
        index: idx,
        resolveAttachment: resolveImageRef,
        onFileChipClick: downloadFile,
        onDocChange: () => {
          if (suppressSave) return;
          unsaved = true;
          scheduleSave();
        },
        onToast: toastMsg,
        onWikiClick: (target) => {
          const resolved = idx.resolveLink(target);

          if (resolved) {
            navigate(`note/${resolved}`);
          } else if (
            idx.titleList.some((t) => t.toLowerCase() === target.toLowerCase())
          ) {
            wikiSeed = { q: target, n: (wikiSeed?.n ?? 0) + 1 };
          } else {
            navigate(`note/${target}`);
          }
        },
      });
      setBody(view, body, resolveImageRef);
      savedSnapshot.body = getMarkdown(view);
      view.on("selectionUpdate", updateTable);
      view.on("update", updateTable);
      view.view.dom.addEventListener("contextmenu", onTableContext);
      view.view.dom.addEventListener("blur", () => {
        if (saveTimer) clearTimeout(saveTimer);
        void doSave();
      });
    }

    if (pendingImageResolves === 0) {
      releaseSaveSuppress();
    }

    loading = false;
  }

  let titleDraft = $state("");
  let titleEditing = $state(false);

  function derivedTitle(body: string): string {
    const heading = body.match(/^#\s+(.+)$/m);
    if (heading) {
      const cleaned = cleanDerivedTitle(heading[1]);
      if (cleaned) return cleaned;
    }

    return "untitled";
  }

  let titlePlaceholder = $derived.by(() => {
    const ed = view;
    if (!meta || !ed) return "untitled";

    return derivedTitle(getMarkdown(ed));
  });

  function commitTitle(raw: string) {
    const t = raw.trim();

    if (t && meta && t !== meta.title) {
      meta.title = t;
      updateFrontmatter({ title: t });
    }

    titleEditing = false;
    titleDraft = "";
  }

  function onDocDown(e: MouseEvent) {
    if (!tableMenu) return;
    if (!(e.target as HTMLElement).closest(".tbl-menu")) tableMenu = null;
  }

  function onEditorScroll() {
    recomputeTablePos();
  }

  onMount(() => {
    void loadNote();
    editorEl?.addEventListener("scroll", onEditorScroll);
    window.addEventListener("resize", onEditorScroll);
    document.addEventListener("mousedown", onDocDown);

    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (saveTimer) clearTimeout(saveTimer);
        void doSave();
      }

      if (e.key === "Escape") {
        tableMenu = null;
        if (menuMove) {
          menuMove = false;
        } else {
          openMenu = false;
        }
      }
    }

    window.addEventListener("keydown", onKey);

    return () => {
      window.removeEventListener("keydown", onKey);
      editorEl?.removeEventListener("scroll", onEditorScroll);
      window.removeEventListener("resize", onEditorScroll);
      document.removeEventListener("mousedown", onDocDown);
    };
  });

  onDestroy(() => {
    if (saveTimer) clearTimeout(saveTimer);
    if (titleEditing) commitTitle(titleDraft);
    void doSave();
    view?.destroy();
    view = null;
    for (const url of attUrls.values()) URL.revokeObjectURL(url);
    attUrls.clear();
  });
</script>

<div class="layout">
  <div class="note-pane">
    <div class="topbar">
      {#if isMobile}
        <button
          class="btn-back"
          onclick={() => navigate("")}
          title="back"
          aria-label="back to notes"
        >
          <Icon name="chevron-left" size={22} />
        </button>
      {/if}
      <input
        class="note-title-input"
        value={titleEditing
          ? titleDraft
          : meta?.title === titlePlaceholder
            ? ""
            : (meta?.title ?? "")}
        placeholder={titlePlaceholder}
        oninput={(e) => {
          titleEditing = true;
          titleDraft = e.currentTarget.value;
        }}
        onblur={(e) => commitTitle(e.currentTarget.value)}
        onkeydown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
      <span class="spacer"></span>
      {#if !isMobile}
        <button
          class="btn-pin"
          class:active={meta?.pinned}
          onclick={togglePin}
          title="pin note"
        >
          {meta?.pinned ? "pinned" : "pin"}
        </button>
      {/if}
      <div
        class="backlinks-wrap"
        use:clickOutside={() => (backlinksOpen = false)}
      >
        <button
          class="btn-backlinks"
          class:active={backlinksOpen}
          onclick={() => (backlinksOpen = !backlinksOpen)}
        >
          backlinks {backlinks.length ? `(${backlinks.length})` : ""}
        </button>
        {#if isMobile && backlinksOpen}
          <div
            class="dd backlinks-dd"
            role="dialog"
            aria-label="backlinks"
            tabindex="-1"
            onclick={(e) => e.stopPropagation()}
            onkeydown={(e) => e.stopPropagation()}
          >
            <div class="backlinks-dd-head">backlinks</div>
            {#if backlinks.length === 0}
              <p class="no-backlinks backlinks-none">none</p>
            {:else}
              {#each backlinks as bl (bl.id)}
                <button
                  type="button"
                  class="dd-item"
                  onclick={() => {
                    backlinksOpen = false;
                    navigate(`note/${bl.id}`);
                  }}
                >
                  <span class="dd-label">{bl.title}</span>
                </button>
              {/each}
            {/if}
          </div>
        {/if}
      </div>
      {#if !isMobile && meta?.folder}
        <button
          class="btn-folder"
          title="folder"
          onclick={() => {
            folderInput = meta?.folder ?? "";
            menuMove = true;
            openMenu = true;
          }}
        >
          {meta.folder}
        </button>
      {/if}
      <div
        class="note-menu-wrap"
        use:clickOutside={() => {
          openMenu = false;
          menuMove = false;
        }}
      >
        <button
          class="btn-menu"
          class:active={openMenu}
          title="more"
          onclick={() => {
            menuMove = false;
            openMenu = !openMenu;
          }}
        >
          <Icon name="ellipsis-vertical" size={16} />
        </button>
        {#if openMenu}
          <div
            class="note-menu"
            role="presentation"
            onclick={(e) => e.stopPropagation()}
          >
            {#if menuMove}
              <button
                class="menu-item"
                onclick={(e) => {
                  e.stopPropagation();
                  menuMove = false;
                }}>← back</button
              >
              <div class="menu-sep"></div>
              <button
                class="menu-item"
                onclick={() => void moveToFolder("")}
                >all notes</button
              >
              {#each allFolders as name (name)}
                <button
                  class="menu-item"
                  onclick={() => void moveToFolder(name)}
                  >{name}</button
                >
              {/each}
              <div class="menu-sep"></div>
              <div class="folder-row">
                <input
                  class="folder-input"
                  bind:value={folderInput}
                  placeholder="new folder"
                  list="folder-options"
                  use:autofocus
                  onkeydown={(e) => {
                    if (e.key === "Enter") void saveFolder();
                    if (e.key === "Escape") {
                      openMenu = false;
                      menuMove = false;
                    }
                  }}
                />
                <button
                  class="btn-folder-save"
                  onmousedown={(e) => e.preventDefault()}
                  onclick={() => void saveFolder()}
                >save</button>
              </div>
            {:else}
              <button
                class="menu-item"
                onclick={(e) => {
                  e.stopPropagation();
                  folderInput = meta?.folder ?? "";
                  menuMove = true;
                }}>move to</button
              >
              <button
                class="menu-item"
                onclick={() => void trashCurrentNote()}
                >trash</button
              >
              <button
                class="menu-item"
                onclick={togglePin}
                >{meta?.pinned ? "unpin" : "pin"}</button
              >
              <button
                class="menu-item"
                onclick={() => void exportCurrentNote()}
                >export</button
              >
            {/if}
          </div>
        {/if}
        <datalist id="folder-options">
          {#each index?.folderList ?? [] as f}
            <option value={f.folder}></option>
          {/each}
        </datalist>
      </div>
    </div>

    <div class="tags-row">
      {#each meta?.tags ?? [] as tag, i}
        <span class="tag-chip">
          #{tag}
          <span
            class="tag-remove"
            role="button"
            tabindex="0"
            title="remove tag"
            onkeydown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                removeTag(i);
              }
            }}
            onclick={() => removeTag(i)}
          >
            <Icon name="x" size={10} />
          </span>
        </span>
      {/each}
      <input
        class="tag-input"
        type="text"
        bind:value={tagInput}
        placeholder="+ tag"
        list="tag-options"
        onkeydown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            addTag();
          }
          if (e.key === "Backspace" && !tagInput && meta?.tags.length) {
            removeTag(meta.tags.length - 1);
          }
          if (e.key === "Escape") e.currentTarget.blur();
        }}
        onblur={() => {
          if (tagInput.trim()) addTag();
        }}
      />
      <datalist id="tag-options">
        {#each tagSuggestions as t}
          <option value={t.tag}></option>
        {/each}
      </datalist>
    </div>

    <WikiPicker
      editor={view}
      titles={index?.titleList ?? []}
      seed={wikiSeed}
      onPick={(target) => {
        if (view) insertWikiLink(target)(view);
      }}
    />

    <div class="metabar">
      {#if isMobile}
        <button type="button" title="undo" onclick={() => view && undo(view)}>
          <Icon name="undo" size={16} />
        </button>
        <button type="button" title="redo" onclick={() => view && redo(view)}>
          <Icon name="redo" size={16} />
        </button>
        <button
          type="button"
          title="find"
          aria-label="find in note"
          onclick={() => (findSeed = { n: (findSeed?.n ?? 0) + 1 })}
        >
          <Icon name="search" size={16} />
        </button>
      {/if}
      <span class="meta-times">
        {#if meta}
          <span>created {formatTimestamp(meta.created)}</span>
          <span>updated {formatTimestamp(meta.updated)}</span>
        {/if}
      </span>
    </div>

    <div
      role="presentation"
      class="content-scroll"
      bind:this={contentScrollEl}
      onfocus={() => {}}
      onmouseover={(e) => {
        const t = e.target as HTMLElement;
        const tbl = t.closest("table") as HTMLElement | null;

        if (tbl) {
          tableEl = tbl;
          hoverActive = true;
          recomputeTablePos();
        } else if (!t.closest(".tbl-add")) {
          if (!inTableSel) {
            tableEl = null;
            tablePos = null;
          }
        }
      }}
      onmouseleave={() => {
        hoverActive = false;

        if (!inTableSel) {
          tableEl = null;
          tablePos = null;
        }
      }}
    >
      <div class="editor-wrap" bind:this={editorEl}></div>
      <FindReplaceBar editor={view} seed={findSeed} />
      {#if loading}
        <div class="status-overlay">loading…</div>
      {:else if notFound}
        <div class="status-overlay">note not found</div>
      {/if}
      {#if tableEl && tablePos}
        <button
          class="tbl-add"
          title="add row"
          style="top: {tablePos.bottom + 2}px; left: {tablePos.left}px;"
          onclick={() => tblRun("rowBelow")}
          ><Icon name="plus" size={12} /></button
        >
        <button
          class="tbl-add"
          title="add column"
          style="top: {tablePos.top}px; left: {tablePos.right + 2}px;"
          onclick={() => tblRun("colRight")}
          ><Icon name="plus" size={12} /></button
        >
      {/if}
      {#if tableMenu}
        <div
          class="tbl-menu"
          style="top: {tableMenu.y}px; left: {tableMenu.x}px;"
        >
          <button onclick={() => tblRun("rowAbove")}>insert row above</button>
          <button onclick={() => tblRun("rowBelow")}>insert row below</button>
          <button onclick={() => tblRun("colLeft")}>insert column left</button>
          <button onclick={() => tblRun("colRight")}>insert column right</button
          >
          <span class="tbl-menu-sep"></span>
          <button onclick={() => tblRun("deleteRow")}>delete row</button>
          <button onclick={() => tblRun("deleteCol")}>delete column</button>
          <button onclick={() => tblRun("deleteTable")}>delete table</button>
        </div>
      {/if}
    </div>
  </div>

  {#if !isMobile && backlinksOpen}
    <aside class="backlinks-panel">
      <h3>backlinks</h3>
      {#if backlinks.length === 0}
        <p class="no-backlinks">none</p>
      {:else}
        {#each backlinks as bl (bl.id)}
          <button
            class="backlink-item"
            onclick={() => navigate(`note/${bl.id}`)}>{bl.title}</button
          >
        {/each}
      {/if}
    </aside>
  {/if}

  {#if toast}
    <div class="toast">{toast}</div>
  {/if}
</div>

<style>
  .layout {
    display: flex;
    height: 100%;
    background: var(--bg);
  }

  .note-pane {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .topbar {
    display: flex;
    align-items: center;
    gap: var(--gap);
    padding: var(--pad-bar);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .note-title-input {
    font-weight: 600;
    font-size: var(--fs-lg);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--r-sm);
    color: var(--fg);
    padding: 0 var(--ctl-px);
    height: var(--ctl-h);
    min-width: 60px;
    flex: 1;
    max-width: var(--maxw-editor);
  }

  .note-title-input:hover {
    border-color: var(--border);
  }

  .note-title-input:focus {
    border-color: var(--border-strong);
    outline: none;
  }

  .spacer {
    flex: 1;
  }

  .btn-pin,
  .btn-backlinks,
  .btn-folder,
  .btn-menu {
    height: var(--ctl-h);
    padding: 0 var(--ctl-px);
    font-size: var(--fs-sm);
    color: var(--fg-3);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .btn-menu {
    width: var(--ctl-h);
    padding: 0;
  }

  .btn-pin:hover,
  .btn-backlinks:hover,
  .btn-folder:hover,
  .btn-menu:hover {
    background: var(--bg-3);
    color: var(--fg);
  }

  .btn-pin.active,
  .btn-backlinks.active,
  .btn-folder.active,
  .btn-menu.active {
    color: var(--fg);
    border-color: var(--border-strong);
  }

  .note-menu-wrap {
    position: relative;
    display: inline-flex;
    flex-shrink: 0;
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
    z-index: 50;
    box-shadow: 0 4px 12px rgb(0 0 0 / 0.15);
  }

  .menu-item {
    display: block;
    width: 100%;
    text-align: left;
    padding: var(--pad-sm);
    font-size: var(--fs-sm);
    color: var(--fg-2);
    border-radius: var(--r-sm);
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

  .metabar {
    display: flex;
    align-items: center;
    gap: var(--gap);
    padding: var(--pad-xs);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    flex-wrap: wrap;
    font-size: var(--fs-sm);
  }

  .folder-input {
    height: var(--ctl-h);
    padding: 0 var(--ctl-px);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-2);
    color: var(--fg);
    font-size: var(--fs-sm);
    min-width: 0;
  }

  .folder-input:focus {
    outline: var(--focus-ring);
    outline-offset: -1px;
  }

  .folder-row {
    display: flex;
    align-items: center;
    gap: var(--s1);
    padding: 0 var(--pad-sm) var(--pad-sm);
  }

  .folder-row .folder-input {
    flex: 1;
    min-width: 0;
  }

  .btn-folder-save {
    height: var(--ctl-h);
    padding: 0 var(--ctl-px);
    font-size: var(--fs-sm);
    color: var(--fg-2);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    flex-shrink: 0;
  }

  .btn-folder-save:hover {
    background: var(--bg-3);
    color: var(--fg);
  }

  .metabar button {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: var(--icon-btn);
    height: var(--icon-btn);
    padding: 0 var(--s2);
    border-radius: var(--r-sm);
    color: var(--fg-2);
    flex-shrink: 0;
  }

  .metabar button:active {
    background: var(--bg-3);
    color: var(--fg);
  }

  .tags-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s1);
    padding: var(--pad-xs);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .tags-row .tag-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--s1);
    font-size: var(--fs-xs);
    color: var(--fg-3);
    background: var(--bg-3);
    border-radius: var(--r-sm);
    padding: var(--pad-xs);
    white-space: nowrap;
  }

  .tag-remove {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--fg-3);
    padding: var(--pad-xs);
    border-radius: var(--r-sm);
    cursor: pointer;
  }

  .tag-remove:hover {
    color: var(--g4);
  }

  .tag-input {
    flex: 1;
    min-width: 80px;
    font-size: var(--fs-sm);
    color: var(--fg);
    background: transparent;
    -webkit-appearance: none;
    -moz-appearance: none;
    appearance: none;
    border: none;
    border-radius: 0;
    outline: none;
    padding: var(--pad-xs);
  }

  .tag-input::placeholder {
    color: var(--fg-3);
  }

  .meta-times {
    display: flex;
    gap: var(--gap-lg);
    margin-left: auto;
    color: var(--fg-3);
    font-size: var(--fs-xs);
  }

  .content-scroll {
    flex: 1;
    min-height: 0;
    position: relative;
    display: flex;
    flex-direction: column;
  }

  .editor-wrap {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: var(--pad-page);
  }

  .status-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--fg-3);
    font-size: var(--fs-base);
    text-transform: lowercase;
    background: var(--bg);
    z-index: 2;
  }

  .backlinks-panel {
    width: var(--panel-w);
    min-width: var(--panel-w);
    border-left: 1px solid var(--border);
    background: var(--bg-2);
    overflow-y: auto;
    padding: var(--pad-panel);
  }

  .backlinks-panel h3 {
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--fg-3);
    text-transform: lowercase;
    margin-bottom: var(--gap);
  }

  .no-backlinks {
    font-size: var(--fs-xs);
    color: var(--fg-3);
    text-transform: lowercase;
  }

  .backlink-item {
    display: block;
    width: 100%;
    text-align: left;
    font-size: var(--fs-sm);
    color: var(--fg-2);
    padding: var(--pad-sm);
    border-radius: var(--r-sm);
  }

  .backlink-item:hover {
    background: var(--bg-3);
  }

  .toast {
    position: fixed;
    bottom: var(--s5);
    left: 50%;
    transform: translateX(-50%);
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    padding: var(--pad-md);
    font-size: var(--fs-sm);
    color: var(--fg);
    z-index: 60;
    text-transform: lowercase;
  }

  .tbl-add {
    position: absolute;
    z-index: 30;
    width: var(--icon-btn-xs);
    height: var(--icon-btn-xs);
    border-radius: var(--r-full);
    border: 1px solid var(--border);
    background: var(--bg-2);
    color: var(--fg-2);
    font-size: var(--fs-sm);
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    padding: 0;
  }

  .tbl-add:hover {
    background: var(--bg-3);
    color: var(--fg);
    border-color: var(--border-strong);
  }

  .tbl-menu {
    position: fixed;
    z-index: 60;
    min-width: var(--menu-w);
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    padding: var(--pad-xs);
    display: flex;
    flex-direction: column;
    box-shadow: 0 4px 16px rgb(0 0 0 / 0.15);
  }

  .tbl-menu button {
    text-align: left;
    font-size: var(--fs-xs);
    color: var(--fg-2);
    padding: var(--pad-sm);
    border-radius: var(--r-sm);
  }

  .tbl-menu button:hover {
    background: var(--bg-3);
    color: var(--fg);
  }

  .tbl-menu-sep {
    height: 1px;
    background: var(--border);
    margin: var(--pad-xs);
  }

  .btn-back {
    width: var(--ctl-h);
    height: var(--ctl-h);
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--fg-2);
    border-radius: var(--r-sm);
    margin-left: calc(-1 * var(--s1));
  }

  .btn-back:hover {
    background: var(--bg-3);
    color: var(--fg);
  }

  .backlinks-wrap {
    position: relative;
    display: inline-flex;
    flex-shrink: 0;
  }

  .backlinks-dd {
    left: auto;
    right: 0;
    width: var(--panel-w);
  }

  .backlinks-dd-head {
    padding: var(--pad-sm);
    font-size: var(--fs-sm);
    color: var(--fg-3);
    text-transform: lowercase;
  }

  .backlinks-none {
    padding: var(--pad-xs) var(--pad-sm) var(--pad-sm);
  }

  @media (max-width: 800px) {
    .note-title-input {
      max-width: none;
    }

    .spacer {
      display: none;
    }
  }
</style>
