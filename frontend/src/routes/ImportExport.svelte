<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { appState } from "../app.svelte.ts";
  import { buildExportZip, exportStamp } from "../lib/io/export.ts";
  import { saveFile } from "../lib/io/save.ts";
  import {
    parseImportSource,
    parseMarkdownFile,
    parseEnexFile,
    applyImport,
    detectImportFile,
  } from "../lib/io/import.ts";
  import type {
    ImportResult,
    ImportSource,
    ParsedImport,
  } from "../lib/io/import.ts";
  import Icon from "../lib/components/Icon.svelte";
  import { untrack } from "svelte";
  import { isTauri, invoke, tauriFs, tauriListen } from "../lib/util/tauri.ts";

  let props = $props<{
    onclose: () => void;
    initialTab?: "import" | "export";
  }>();

  let tab = $state<"import" | "export">(
    untrack(() => props.initialTab) ?? "import",
  );
  let items: { name: string; bytes: Uint8Array }[] = $state([]);
  let format = $state<ImportSource>("auto");
  let formatManual = $state(false);
  let busy = $state(false);
  let importing = $state(false);
  let result: ImportResult | null = $state(null);
  let error = $state("");
  let dragOver = $state(false);
  let exporting = $state(false);
  let exportDone = $state("");
  let noteCount = $derived(appState.index?.list.length ?? 0);
  let unlisteners: (() => void)[] = [];

  const SOURCES: ImportSource[] = [
    "auto",
    "markdown",
    "affine",
    "notion",
    "obsidian",
    "keep",
    "evernote",
  ];
  const FORMAT_HINTS: Record<ImportSource, string> = {
    auto: "auto-detect the source from the file",
    markdown: "generic markdown notes + assets",
    affine: "affine export · index.md + assets",
    notion: "notion export · pages, images & links · databases (csv) skipped",
    obsidian: "obsidian vault · notes, wiki-links & attachments · plugins & canvas skipped",
    keep: "google keep takeout · notes, lists, labels & images",
    evernote: "evernote export (.enex) · notes, tags, images & files",
  };

  function validName(name: string): boolean {
    const lower = name.toLowerCase();

    return (
      lower.endsWith(".md") ||
      lower.endsWith(".enex") ||
      lower.endsWith(".zip")
    );
  }

  function addBytes(name: string, bytes: Uint8Array): void {
    if (!validName(name)) {
      error = "please choose .zip, .md or .enex files";

      return;
    }

    error = "";
    items = [...items, { name, bytes }];

    if (!formatManual && /\.zip$/i.test(name)) {
      const detected = detectImportFile(bytes);
      if (detected !== "auto") format = detected;
    }
  }

  function addFiles(files: File[]): void {
    const pending = files.filter((f) => validName(f.name));
    if (pending.length === 0) {
      error = "please choose .zip, .md or .enex files";

      return;
    }

    error = "";
    void (async () => {
      for (const f of pending) {
        try {
          addBytes(f.name, new Uint8Array(await f.arrayBuffer()));
        } catch {
          error = "could not read file";
        }
      }
    })();
  }

  async function addPaths(paths: string[]): Promise<void> {
    if (paths.length === 0) return;

    try {
      await invoke("grant_import_scope", { paths });
    } catch {}

    const fs = tauriFs();
    error = "";

    for (const p of paths) {
      const name = p.split(/[\\/]/).pop() ?? p;

      try {
        addBytes(name, await fs.readFile(p));
      } catch {
        error = `could not read ${name}`;
      }
    }
  }

  function removeItem(i: number): void {
    items = items.filter((_, j) => j !== i);
  }

  async function doImport() {
    if (items.length === 0) {
      error = "choose files first";

      return;
    }

    const store = appState.store;
    const index = appState.index;
    if (!store || !index) return;

    busy = true;
    importing = true;
    error = "";
    result = null;

    try {
      const merged: ParsedImport = { notes: [], attachments: new Map() };

      for (const it of items) {
        const lower = it.name.toLowerCase();
        const parsed = lower.endsWith(".md")
          ? parseMarkdownFile(it.name, new TextDecoder().decode(it.bytes))
          : lower.endsWith(".enex")
            ? parseEnexFile(it.bytes)
            : parseImportSource(it.bytes, format);

        merged.notes.push(...parsed.notes);
        for (const [k, v] of parsed.attachments) {
          if (!merged.attachments.has(k)) merged.attachments.set(k, v);
        }
      }

      const res = await applyImport(store, index, merged);

      result = res;
      items = [];
      void appState.sync?.pushPending();
    } catch {
      error = "could not read file";
    } finally {
      busy = false;
      importing = false;
    }
  }

  onMount(() => {
    if (!isTauri()) return;

    void (async () => {
      try {
        unlisteners.push(
          await tauriListen<{ paths: string[] }>(
            "tauri://drag-drop",
            (payload) => {
              dragOver = false;
              if (payload?.paths?.length) void addPaths(payload.paths);
            },
          ),
        );
        unlisteners.push(
          await tauriListen("tauri://drag-enter", () => (dragOver = true)),
        );
        unlisteners.push(
          await tauriListen("tauri://drag-over", () => (dragOver = true)),
        );
        unlisteners.push(
          await tauriListen("tauri://drag-leave", () => (dragOver = false)),
        );
        unlisteners.push(
          await tauriListen(
            "tauri://drag-cancelled",
            () => (dragOver = false),
          ),
        );
      } catch {}
    })();
  });

  onDestroy(() => {
    for (const fn of unlisteners) fn();
    unlisteners = [];
  });

  async function doExport() {
    const store = appState.store;
    const index = appState.index;
    if (!store || !index) return;

    exporting = true;
    error = "";
    exportDone = "";

    try {
      const bytes = await buildExportZip(store);
      const outcome = await saveFile(
        `folio-export-${exportStamp()}.zip`,
        bytes,
      );
      if (outcome === "saved") exportDone = `exported ${noteCount} notes`;
    } catch {
      error = "could not build export zip";
    } finally {
      exporting = false;
    }
  }
</script>

<div class="overlay" role="presentation" onclick={props.onclose}>
  <div class="modal" role="presentation" onclick={(e) => e.stopPropagation()}>
    <div class="modal-header">
      <span class="modal-title">import / export</span>
      <button class="btn-close" onclick={props.onclose} title="close"
        ><Icon name="x" size={16} /></button
      >
    </div>

    <div class="tabs">
      <button
        class="tab"
        class:active={tab === "import"}
        onclick={() => (tab = "import")}>import</button
      >
      <button
        class="tab"
        class:active={tab === "export"}
        onclick={() => (tab = "export")}>export</button
      >
    </div>

    {#if tab === "import"}
      <div class="tab-body">
        <div
          role="presentation"
          class="dropzone"
          class:dragover={dragOver}
          ondragover={(e) => {
            if (isTauri()) return;
            e.preventDefault();
            dragOver = true;
          }}
          ondragleave={() => {
            if (!isTauri()) dragOver = false;
          }}
          ondrop={(e) => {
            if (isTauri()) return;
            e.preventDefault();
            dragOver = false;
            addFiles([...(e.dataTransfer?.files ?? [])]);
          }}
        >
          <p>drop .zip, .md or .enex files here</p>
          <p class="hint">or</p>
          <label class="file-btn">
            choose files
            <input
              type="file"
              accept=".zip,.md,.enex"
              multiple
              hidden
              onchange={(e) => {
                const files = e.currentTarget.files
                  ? [...e.currentTarget.files]
                  : [];
                e.currentTarget.value = "";
                addFiles(files);
              }}
            />
          </label>
        </div>
        <p class="hint">
          affine, notion, obsidian, google keep, evernote & generic markdown —
          the source is auto-detected from the file
        </p>
        <div class="format-row">
          {#each SOURCES as s (s)}
            <button
              class="format-pill"
              class:active={format === s}
              onclick={() => {
                format = s;
                formatManual = true;
              }}>{s}</button
            >
          {/each}
        </div>
        <p class="hint">{FORMAT_HINTS[format]}</p>
        {#if items.length > 0}
          <ul class="file-list">
            {#each items as it, i (it.name + i)}
              <li class="file-item">
                <span class="file-name">{it.name}</span>
                <button
                  class="file-remove"
                  onclick={() => removeItem(i)}
                  title="remove"
                  ><Icon name="x" size={12} /></button
                >
              </li>
            {/each}
          </ul>
        {/if}
        <button
          class="btn-primary"
          disabled={items.length === 0 || busy}
          onclick={doImport}
        >
          {importing
            ? "importing…"
            : items.length
              ? `import ${items.length} file${items.length > 1 ? "s" : ""}`
              : "import"}
        </button>
        {#if error}
          <p class="error">{error}</p>
        {/if}
        {#if result}
          <p class="result">
            imported {result.notes} notes · {result.atts} attachments
            {#if result.skipped}· {result.skipped} conflicts skipped{/if}
          </p>
          {#if result.collisions.length}
            <details class="collisions">
              <summary
                >{result.collisions.length} collision{result.collisions.length >
                1
                  ? "s"
                  : ""}</summary
              >
              <ul>
                {#each result.collisions as c (c)}
                  <li>{c}</li>
                {/each}
              </ul>
            </details>
          {/if}
        {/if}
      </div>
    {:else}
      <div class="tab-body">
        <p class="preview-line">
          {noteCount} notes in this vault · the whole vault is exported as plain markdown
          + attachments
        </p>
        <button
          class="btn-primary"
          disabled={exporting || noteCount === 0}
          onclick={doExport}
        >
          {exporting ? "exporting…" : "export zip"}
        </button>
        {#if exportDone}
          <p class="result">{exportDone}</p>
        {/if}
        {#if error}
          <p class="error">{error}</p>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgb(0 0 0 / 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
    animation: modalBackdropEnter 0.18s ease-out forwards;
  }

  .modal {
    width: 90%;
    max-width: var(--maxw-modal);
    max-height: 85vh;
    overflow-y: auto;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
    padding: var(--pad-lg);
    animation: modalContentEnter 0.22s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--gap-lg);
  }

  .modal-title {
    font-size: var(--fs-lg);
    font-weight: 600;
    text-transform: lowercase;
  }

  .btn-close {
    width: var(--icon-btn);
    height: var(--icon-btn);
    border-radius: var(--r-sm);
    color: var(--fg-3);
    font-size: var(--fs-xl);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .btn-close:hover {
    background: var(--bg-3);
    color: var(--fg);
  }

  .tabs {
    display: flex;
    gap: var(--gap);
    border-bottom: 1px solid var(--border);
    margin-bottom: var(--s4);
  }

  .tab {
    padding: var(--pad-md);
    font-size: var(--fs-sm);
    color: var(--fg-3);
    text-transform: lowercase;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
  }

  .tab:hover {
    color: var(--fg);
  }

  .tab.active {
    color: var(--fg);
    border-bottom-color: var(--fg-3);
  }

  .tab-body {
    display: flex;
    flex-direction: column;
    gap: var(--gap-lg);
  }

  .dropzone {
    border: 1px dashed var(--border-strong);
    border-radius: var(--r-md);
    padding: var(--pad-lg);
    text-align: center;
    font-size: var(--fs-base);
    color: var(--fg-2);
    text-transform: lowercase;
  }

  .dropzone.dragover {
    background: var(--bg-3);
    border-color: var(--fg-3);
  }

  .hint {
    font-size: var(--fs-xs);
    color: var(--fg-3);
    margin: var(--s2) 0;
  }

  .format-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s2);
  }

  .format-pill {
    padding: var(--s1) var(--s3);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    font-size: var(--fs-xs);
    color: var(--fg-3);
    text-transform: lowercase;
  }

  .format-pill:hover {
    background: var(--bg-3);
    color: var(--fg);
  }

  .format-pill.active {
    color: var(--fg);
    border-color: var(--fg-3);
    background: var(--bg-3);
  }

  .file-btn {
    display: inline-block;
    padding: var(--pad-md);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    font-size: var(--fs-sm);
    color: var(--fg-2);
    cursor: pointer;
  }

  .file-btn:hover {
    background: var(--bg-3);
    color: var(--fg);
  }

  .file-name {
    font-size: var(--fs-sm);
    color: var(--fg-2);
    word-break: break-all;
  }

  .file-list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: var(--s1);
  }

  .file-item {
    display: flex;
    align-items: center;
    gap: var(--gap);
  }

  .file-item .file-name {
    flex: 1;
    min-width: 0;
  }

  .file-remove {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--icon-btn-xs);
    height: var(--icon-btn-xs);
    border-radius: var(--r-sm);
    color: var(--fg-3);
  }

  .file-remove:hover {
    color: var(--fg);
    background: var(--bg-3);
  }

  .btn-primary {
    align-self: flex-start;
    padding: var(--pad-md);
    border: 1px solid var(--border-strong);
    border-radius: var(--r-sm);
    font-size: var(--fs-sm);
    color: var(--fg);
    text-transform: lowercase;
  }

  .btn-primary:hover {
    background: var(--bg-3);
  }

  .btn-primary:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .error {
    font-size: var(--fs-sm);
    color: var(--fg-2);
    text-transform: lowercase;
  }

  .result {
    font-size: var(--fs-base);
    color: var(--fg);
    text-transform: lowercase;
  }

  .preview-line {
    font-size: var(--fs-sm);
    color: var(--fg-3);
    text-transform: lowercase;
  }

  .collisions {
    font-size: var(--fs-xs);
    color: var(--fg-3);
  }

  .collisions summary {
    cursor: pointer;
    text-transform: lowercase;
  }

  .collisions ul {
    margin: var(--s2) 0 0 var(--s4);
    list-style: disc;
  }
</style>
