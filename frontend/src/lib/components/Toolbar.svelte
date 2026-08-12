<script lang="ts">
  import type { Snippet } from "svelte";
  import type { Editor } from "@tiptap/core";
  import {
    toggleBold,
    toggleItalic,
    toggleUnderline,
    toggleStrike,
    toggleCode,
    toggleBulletList,
    toggleOrderedList,
    toggleTaskList,
    toggleBlockquote,
    toggleCodeBlock,
    setHeading,
    undo,
    redo,
    insertHr,
  } from "../editor/toolbar.ts";
  import { insertTable } from "../editor/editor.ts";
  import type { FmtState } from "../editor/toolbar.ts";
  import Icon from "./Icon.svelte";

  let {
    fmt,
    editor,
    refresh,
    onLinkPrompt,
    onPickAttachment,
    children,
  }: {
    fmt: FmtState;
    editor: Editor | null;
    refresh: () => void;
    onLinkPrompt: () => void;
    onPickAttachment: () => void;
    children?: Snippet;
  } = $props();

  function run(fn: (e: Editor) => void) {
    if (!editor) return;
    fn(editor);
    refresh();
  }
</script>

<div class="toolbar">
  <button
    title="bold"
    class:active={fmt.bold}
    onclick={() => run(toggleBold)}
    ><Icon name="bold" size={16} /></button
  >
  <button
    title="italic"
    class:active={fmt.italic}
    onclick={() => run(toggleItalic)}
    ><Icon name="italic" size={16} /></button
  >
  <button
    title="underline"
    class:active={fmt.underline}
    onclick={() => run(toggleUnderline)}
    ><Icon name="underline" size={16} /></button
  >
  <button
    title="strikethrough"
    class:active={fmt.strike}
    onclick={() => run(toggleStrike)}
    ><Icon name="strikethrough" size={16} /></button
  >
  <button
    title="inline code"
    class:active={fmt.code}
    onclick={() => run(toggleCode)}
    ><Icon name="code" size={16} /></button
  >
  <span class="toolbar-sep"></span>
  <button
    title="heading 1"
    class:active={fmt.heading1}
    onclick={() => run(setHeading(1))}
    ><Icon name="heading-1" size={16} /></button
  >
  <button
    title="heading 2"
    class:active={fmt.heading2}
    onclick={() => run(setHeading(2))}
    ><Icon name="heading-2" size={16} /></button
  >
  <button
    title="heading 3"
    class:active={fmt.heading3}
    onclick={() => run(setHeading(3))}
    ><Icon name="heading-3" size={16} /></button
  >
  <span class="toolbar-sep"></span>
  <button
    title="bullet list"
    class:active={fmt.bulletList}
    onclick={() => run(toggleBulletList)}
    ><Icon name="list" size={16} /></button
  >
  <button
    title="ordered list"
    class:active={fmt.orderedList}
    onclick={() => run(toggleOrderedList)}
    ><Icon name="list-ordered" size={16} /></button
  >
  <button
    title="task list"
    class:active={fmt.taskList}
    onclick={() => run(toggleTaskList)}
    ><Icon name="list-todo" size={16} /></button
  >
  <button
    title="quote"
    class:active={fmt.blockquote}
    onclick={() => run(toggleBlockquote)}
    ><Icon name="quote" size={16} /></button
  >
  <span class="toolbar-sep"></span>
  <button title="link" onclick={onLinkPrompt}
    ><Icon name="link-2" size={16} /></button
  >
  {@render children?.()}
  <button title="insert image or file" onclick={onPickAttachment}
    ><Icon name="paperclip" size={16} /></button
  >
  <button
    title="code block"
    class:active={fmt.codeBlock}
    onclick={() => run(toggleCodeBlock)}
    ><Icon name="braces" size={16} /></button
  >
  <button title="table" onclick={() => run(insertTable)}
    ><Icon name="table" size={16} /></button
  >
  <button title="horizontal rule" onclick={() => run(insertHr)}
    ><Icon name="minus" size={16} /></button
  >
  <span class="toolbar-sep"></span>
  <button title="undo" onclick={() => run(undo)}
    ><Icon name="undo" size={16} /></button
  >
  <button title="redo" onclick={() => run(redo)}
    ><Icon name="redo" size={16} /></button
  >
</div>

<style>
  .toolbar {
    display: flex;
    align-items: center;
    gap: var(--s1);
    padding: var(--pad-xs);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    overflow-x: auto;
  }

  .toolbar :global(button) {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: var(--icon-btn);
    height: var(--icon-btn);
    padding: 0 var(--s2);
    border-radius: var(--r-sm);
    color: var(--fg-2);
    font-size: var(--fs-sm);
    flex-shrink: 0;
  }

  .toolbar :global(button:hover) {
    background: var(--bg-3);
    color: var(--fg);
  }

  .toolbar :global(button:active) {
    background: var(--bg-2);
  }

  .toolbar :global(button.active) {
    color: var(--fg);
    background: var(--bg-3);
  }

  .toolbar-sep {
    width: 1px;
    height: var(--s4);
    background: var(--border);
    margin: 0 var(--s1);
    flex-shrink: 0;
  }
</style>
