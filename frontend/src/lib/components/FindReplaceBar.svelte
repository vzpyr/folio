<script lang="ts">
  import type { Editor } from "@tiptap/core";
  import Icon from "./Icon.svelte";
  import { findReplaceKey, scrollToCurrentMatch } from "../editor/find-replace.ts";

  let {
    editor,
    seed,
  }: {
    editor: Editor | null;
    seed: { n: number } | null;
  } = $props();

  let open = $state(false);
  let term = $state("");
  let replaceTerm = $state("");
  let caseSensitive = $state(false);
  let showReplace = $state(false);
  let count = $state(0);
  let index = $state(-1);
  let composing = $state(false);
  let findInputEl: HTMLInputElement | undefined = $state();
  let replaceInputEl: HTMLInputElement | undefined = $state();
  let lastSeed = $state<{ n: number } | null>(null);

  function refresh() {
    const ed = editor;
    if (!ed) return;
    const st = findReplaceKey.getState(ed.state);
    count = st?.matches.length ?? 0;
    index = st?.current ?? -1;
    if (st && st.term !== term) term = st.term;
    if (st && st.caseSensitive !== caseSensitive) caseSensitive = st.caseSensitive;
  }

  function runSearch(t: string, cs: boolean) {
    const ed = editor;
    if (!ed) return;
    ed.commands.find(t, cs);
    refresh();
    scrollToCurrentMatch(ed);
  }

  function openBar(prefill: boolean) {
    const ed = editor;
    if (!ed) return;
    const wasOpen = open;
    open = true;
    if (!wasOpen && prefill && !ed.state.selection.empty) {
      const sel = ed.state.doc
        .textBetween(ed.state.selection.from, ed.state.selection.to, "\n", "\ufffc")
        .trim();
      if (sel && sel.length <= 200) term = sel;
    }
    runSearch(term, caseSensitive);
    queueMicrotask(() => {
      findInputEl?.focus();
      findInputEl?.select();
    });
  }

  function close() {
    if (!open) return;
    open = false;
    editor?.commands.clearSearch();
    editor?.commands.focus();
    refresh();
  }

  function next() {
    const ed = editor;
    if (!ed) return;
    ed.commands.findNext();
    refresh();
    scrollToCurrentMatch(ed);
  }

  function prev() {
    const ed = editor;
    if (!ed) return;
    ed.commands.findPrev();
    refresh();
    scrollToCurrentMatch(ed);
  }

  function toggleCase() {
    caseSensitive = !caseSensitive;
    runSearch(term, caseSensitive);
  }

  function toggleReplace() {
    showReplace = !showReplace;
    if (showReplace) {
      queueMicrotask(() => replaceInputEl?.focus());
    }
  }

  function replace() {
    const ed = editor;
    if (!ed) return;
    ed.commands.replace(replaceTerm);
    refresh();
    scrollToCurrentMatch(ed);
  }

  function replaceAll() {
    const ed = editor;
    if (!ed) return;
    ed.commands.replaceAll(replaceTerm);
    refresh();
    scrollToCurrentMatch(ed);
  }

  function onFindInput() {
    if (composing) return;
    const v = findInputEl?.value ?? "";
    term = v;
    runSearch(v, caseSensitive);
  }

  function onFindKey(e: KeyboardEvent) {
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();

    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) prev();
      else next();
    } else if (mod && k === "g") {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) prev();
      else next();
    } else if (mod && k === "f") {
      e.preventDefault();
      e.stopPropagation();
      (e.currentTarget as HTMLInputElement).select();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }

  function onReplaceKey(e: KeyboardEvent) {
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();

    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey || mod) replaceAll();
      else replace();
    } else if (mod && k === "g") {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) prev();
      else next();
    } else if (mod && k === "f") {
      e.preventDefault();
      e.stopPropagation();
      findInputEl?.focus();
      findInputEl?.select();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }

  $effect(() => {
    const s = seed;
    if (s && s !== lastSeed) {
      lastSeed = s;
      openBar(true);
    }
  });

  $effect(() => {
    const ed = editor;
    if (!ed) return;

    open = false;

    const refreshListener = () => refresh();
    ed.on("update", refreshListener);
    ed.on("selectionUpdate", refreshListener);

    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();

      if (mod && k === "f") {
        e.preventDefault();
        e.stopImmediatePropagation();
        openBar(true);
      } else if (mod && k === "g") {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (open) next();
        else openBar(false);
      } else if (e.key === "Escape" && open) {
        e.preventDefault();
        close();
      }
    };

    ed.view.dom.addEventListener("keydown", onKey, true);

    return () => {
      ed.off("update", refreshListener);
      ed.off("selectionUpdate", refreshListener);
      ed.view.dom.removeEventListener("keydown", onKey, true);
    };
  });

  $effect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();

      if (mod && k === "f") {
        e.preventDefault();
        e.stopPropagation();
        findInputEl?.focus();
        findInputEl?.select();
      } else if (mod && k === "g") {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) prev();
        else next();
      } else if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  });
</script>

{#if open && editor}
  <div class="find-bar" role="dialog" aria-label="find in note">
    <div class="find-row">
      <input
        bind:this={findInputEl}
        bind:value={term}
        class="find-input"
        placeholder="find"
        spellcheck="false"
        autocomplete="off"
        autocorrect="off"
        autocapitalize="off"
        enterkeyhint="search"
        oninput={onFindInput}
        onkeydown={onFindKey}
        oncompositionstart={() => (composing = true)}
        oncompositionend={() => {
          composing = false;
          onFindInput();
        }}
      />
      <span class="find-count">{count === 0 ? "0/0" : `${index + 1}/${count}`}</span>
      <button
        type="button"
        class="find-btn"
        title="previous match (shift+enter)"
        aria-label="previous match"
        onmousedown={(e) => e.preventDefault()}
        onclick={prev}
      >
        <span class="find-up"><Icon name="chevron-down" size={14} /></span>
      </button>
      <button
        type="button"
        class="find-btn"
        title="next match (enter)"
        aria-label="next match"
        onmousedown={(e) => e.preventDefault()}
        onclick={next}
      >
        <Icon name="chevron-down" size={14} />
      </button>
      <button
        type="button"
        class="find-case"
        class:active={caseSensitive}
        title="match case"
        aria-label="match case"
        aria-pressed={caseSensitive}
        onmousedown={(e) => e.preventDefault()}
        onclick={toggleCase}
      >
        Aa
      </button>
      <button
        type="button"
        class="find-btn"
        class:active={showReplace}
        title="replace"
        aria-label="toggle replace"
        aria-expanded={showReplace}
        onmousedown={(e) => e.preventDefault()}
        onclick={toggleReplace}
      >
        <span class="find-caret" class:open={showReplace}>
          <Icon name="chevron-down" size={14} />
        </span>
      </button>
      <button
        type="button"
        class="find-btn"
        title="close (esc)"
        aria-label="close find"
        onclick={close}
      >
        <Icon name="x" size={14} />
      </button>
    </div>
    {#if showReplace}
      <div class="replace-row">
        <input
          bind:this={replaceInputEl}
          bind:value={replaceTerm}
          class="replace-input"
          placeholder="replace"
          spellcheck="false"
          autocomplete="off"
          autocorrect="off"
          autocapitalize="off"
          enterkeyhint="done"
          onkeydown={onReplaceKey}
        />
        <button
          type="button"
          class="find-action"
          title="replace (enter)"
          onmousedown={(e) => e.preventDefault()}
          onclick={replace}
        >
          replace
        </button>
        <button
          type="button"
          class="find-action"
          title="replace all (shift+enter)"
          onmousedown={(e) => e.preventDefault()}
          onclick={replaceAll}
        >
          all
        </button>
      </div>
    {/if}
  </div>
{/if}

<style>
  .find-bar {
    position: absolute;
    top: var(--s2);
    right: var(--s2);
    z-index: 40;
    width: min(380px, calc(100% - var(--s4)));
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    box-shadow: 0 6px 24px rgb(0 0 0 / 0.18);
    padding: var(--pad-xs);
    transform-origin: top right;
    animation: findBarEnter 0.18s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }

  .find-row,
  .replace-row {
    display: flex;
    align-items: center;
    gap: var(--s1);
  }

  .replace-row {
    margin-top: var(--s1);
    border-top: 1px solid var(--border);
    padding-top: var(--s1);
    animation: replaceRowEnter 0.16s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }

  .find-input,
  .replace-input {
    flex: 1;
    min-width: 0;
    height: var(--ctl-h);
    padding: 0 var(--ctl-px);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg);
    color: var(--fg);
    font-size: var(--fs-sm);
  }

  .find-input:focus,
  .replace-input:focus {
    outline: var(--focus-ring);
    outline-offset: -1px;
  }

  .find-count {
    flex-shrink: 0;
    min-width: 34px;
    text-align: center;
    font-size: var(--fs-xs);
    color: var(--fg-3);
  }

  .find-btn {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: var(--icon-btn-xs);
    height: var(--icon-btn-xs);
    border-radius: var(--r-sm);
    color: var(--fg-2);
    transition: background 0.12s ease, color 0.12s ease;
  }

  .find-btn:hover,
  .find-btn.active {
    background: var(--bg-3);
    color: var(--fg);
  }

  .find-case {
    flex-shrink: 0;
    min-width: var(--icon-btn-xs);
    height: var(--icon-btn-xs);
    padding: 0 var(--s1);
    border-radius: var(--r-sm);
    font-size: var(--fs-sm);
    color: var(--fg-2);
    text-transform: none;
    transition: background 0.12s ease, color 0.12s ease;
  }

  .find-case:hover,
  .find-case.active {
    background: var(--bg-3);
    color: var(--fg);
  }

  .find-action {
    flex-shrink: 0;
    min-height: var(--ctl-h);
    padding: 0 var(--s2);
    border-radius: var(--r-sm);
    font-size: var(--fs-sm);
    color: var(--fg-2);
    transition: background 0.12s ease, color 0.12s ease;
  }

  .find-action:hover {
    background: var(--bg-3);
    color: var(--fg);
  }

  .find-up,
  .find-caret {
    display: flex;
  }

  .find-up {
    transform: rotate(180deg);
  }

  .find-caret {
    transition: transform 0.15s ease;
  }

  .find-caret.open {
    transform: rotate(180deg);
  }

  @keyframes findBarEnter {
    from {
      opacity: 0;
      transform: translateY(-8px) scale(0.98);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  @keyframes findBarEnterMobile {
    from {
      opacity: 0;
      transform: translateY(-100%);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @keyframes replaceRowEnter {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @media (max-width: 800px) {
    .find-bar {
      top: 0;
      left: 0;
      right: 0;
      width: auto;
      max-width: none;
      border-radius: 0;
      border-left: none;
      border-right: none;
      border-top: none;
      transform-origin: top;
      animation: findBarEnterMobile 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }
  }
</style>
