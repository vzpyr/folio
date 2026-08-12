<script lang="ts">
  import { TextSelection } from "prosemirror-state";
  import type { Editor } from "@tiptap/core";

  let {
    editor,
    titles,
    seed,
    onPick,
  }: {
    editor: Editor | null;
    titles: string[];
    seed: { q: string; n: number } | null;
    onPick: (target: string) => void;
  } = $props();

  let open = $state(false);
  let query = $state("");
  let selected = $state(0);
  let inlineActive = $state(false);
  let inlineStart = $state(0);
  let anchor = $state<{ top: number; left: number } | null>(null);
  let inputEl: HTMLInputElement | undefined = $state();
  let triggerEl: HTMLButtonElement | undefined = $state();
  let lastSeed = $state<{ q: string; n: number } | null>(null);

  let filtered = $derived(
    titles
      .filter((t) => t.toLowerCase().includes(query.toLowerCase()))
      .slice(0, 20),
  );

  function close() {
    inlineActive = false;
    open = false;
    query = "";
    selected = 0;
  }

  function position(pos: number) {
    const v = editor?.view;
    if (!v) return;

    const c = v.coordsAtPos(pos);
    if (!c || (c.top === 0 && c.left === 0)) return;

    anchor = {
      top: Math.min(c.bottom + 6, window.innerHeight - 300),
      left: Math.min(c.left, window.innerWidth - 260),
    };
  }

  function completeInline(target: string) {
    const ed = editor;
    if (!ed) return;

    const { state } = ed;
    const start = Math.max(0, inlineStart - 2);
    const end = state.selection.from;
    const node = state.schema.nodes.wikiLink.create(
      { target, alias: null },
      state.schema.text(target),
    );
    const tr = state.tr.delete(start, end).insert(start, node);

    tr.setSelection(TextSelection.near(tr.doc.resolve(start + node.nodeSize)));
    ed.view.dispatch(tr);
  }

  function pick(target: string) {
    if (inlineActive) completeInline(target);
    else onPick(target);
    close();
  }

  function toggle() {
    query = "";
    selected = 0;
    inlineActive = false;

    if (triggerEl) {
      const r = triggerEl.getBoundingClientRect();
      anchor = {
        top: r.bottom + 4,
        left: Math.min(r.left, window.innerWidth - 260),
      };
    }

    open = !open;
    if (open) queueMicrotask(() => inputEl?.focus());
  }

  function onUpdate() {
    const ed = editor;
    if (!ed) return;

    const st = ed.state;
    const from = st.selection.from;

    if (inlineActive) {
      if (from < inlineStart) {
        close();
        return;
      }

      const q = st.doc.textBetween(inlineStart, from, "\n", "\ufffc");
      if (/\s/.test(q)) {
        close();
        return;
      }

      query = q;
      selected = 0;
      position(from);
    } else {
      const before = st.doc.textBetween(
        Math.max(0, from - 2),
        from,
        "\n",
        "\ufffc",
      );

      if (before === "[[") {
        inlineStart = from;
        inlineActive = true;
        query = "";
        selected = 0;
        open = true;
        position(from);
      }
    }
  }

  function onKey(e: KeyboardEvent) {
    if (!inlineActive) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopImmediatePropagation();
      selected = filtered.length ? (selected + 1) % filtered.length : 0;
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopImmediatePropagation();
      selected = filtered.length
        ? (selected - 1 + filtered.length) % filtered.length
        : 0;
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (filtered.length) pick(filtered[selected]);
      else close();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopImmediatePropagation();
      close();
    }
  }

  function onPickerKey(e: KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      selected = Math.min(selected + 1, filtered.length - 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      selected = Math.max(selected - 1, 0);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered.length) pick(filtered[selected]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  }

  $effect(() => {
    if (seed && seed !== lastSeed) {
      lastSeed = seed;
      open = true;
      query = seed.q;
      inlineActive = false;
      selected = 0;
      queueMicrotask(() => inputEl?.focus());
    }
  });

  $effect(() => {
    const ed = editor;
    if (!ed) return;

    ed.on("update", onUpdate);
    ed.view.dom.addEventListener("keydown", onKey, true);

    return () => {
      ed.off("update", onUpdate);
      ed.view.dom.removeEventListener("keydown", onKey, true);
    };
  });
</script>

<button title="link to note" bind:this={triggerEl} onclick={toggle}>[[</button>

{#if open}
  <div
    class="wiki-picker"
    style="top: {anchor?.top ?? 88}px; left: {anchor?.left ?? 16}px;"
  >
    <input
      bind:this={inputEl}
      bind:value={query}
      placeholder="link to note…"
      readonly={inlineActive}
      onkeydown={onPickerKey}
      oninput={() => (selected = 0)}
    />
    <div class="wiki-list">
      {#each filtered as t, i (t)}
        <button
          class="wiki-item"
          class:selected={i === selected}
          onmousemove={() => (selected = i)}
          onclick={() => pick(t)}>{t}</button
        >
      {/each}
      {#if filtered.length === 0}
        <span class="wiki-none">no matches</span>
      {/if}
    </div>
  </div>
{/if}

<style>
  .wiki-picker {
    position: fixed;
    z-index: 40;
    width: var(--panel-w);
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    padding: var(--pad-xs);
  }

  .wiki-picker input {
    width: 100%;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg);
    color: var(--fg);
    padding: var(--pad-sm);
    font-size: var(--fs-sm);
  }

  .wiki-picker input:focus {
    outline: var(--focus-ring);
    outline-offset: -1px;
  }

  .wiki-list {
    max-height: 220px;
    overflow-y: auto;
    margin-top: var(--s1);
  }

  .wiki-item {
    display: block;
    width: 100%;
    text-align: left;
    font-size: var(--fs-sm);
    color: var(--fg-2);
    padding: var(--pad-sm);
    border-radius: var(--r-sm);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .wiki-item:hover {
    background: var(--bg-3);
    color: var(--fg);
  }

  .wiki-item.selected {
    background: var(--bg-3);
    color: var(--fg);
  }

  .wiki-none {
    font-size: var(--fs-xs);
    color: var(--fg-3);
    padding: var(--pad-sm);
  }
</style>
