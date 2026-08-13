<script lang="ts">
  import type { Editor } from "@tiptap/core";
  import {
    fmtState,
    toggleBold,
    toggleItalic,
    toggleUnderline,
    toggleStrike,
    toggleCode,
    setLinkHref,
  } from "../editor/toolbar.ts";
  import Icon from "./Icon.svelte";

  let { editor }: { editor: Editor } = $props();

  let fmt = $state(fmtState(editor));
  let linkMode = $state(false);
  let linkHref = $state("");

  const refresh = () => {
    if (editor.isDestroyed) return;
    fmt = fmtState(editor);
  };

  $effect(() => {
    editor.on("selectionUpdate", refresh);
    editor.on("update", refresh);

    return () => {
      editor.off("selectionUpdate", refresh);
      editor.off("update", refresh);
    };
  });

  function openLink() {
    linkHref = (editor.getAttributes("link").href as string) ?? "";
    linkMode = true;
  }

  function applyLink() {
    setLinkHref(editor, linkHref);
    linkMode = false;
  }
</script>

{#if linkMode}
  <div class="link-popover">
    <input
      class="link-input"
      bind:value={linkHref}
      placeholder="url"
      autofocus
      onblur={() => {
        linkMode = false;
      }}
      onkeydown={(e) => {
        if (e.key === "Enter") applyLink();
        if (e.key === "Escape") linkMode = false;
      }}
      onmousedown={(e) => e.stopPropagation()}
    />
    <button
      type="button"
      class="link-apply"
      onmousedown={(e) => e.preventDefault()}
      onclick={applyLink}
    >
      apply
    </button>
  </div>
{:else}
  <div class="float-bar">
    <button
      type="button"
      class:active={fmt.bold}
      title="bold"
      onclick={() => toggleBold(editor)}
    >
      <Icon name="bold" size={14} />
    </button>
    <button
      type="button"
      class:active={fmt.italic}
      title="italic"
      onclick={() => toggleItalic(editor)}
    >
      <Icon name="italic" size={14} />
    </button>
    <button
      type="button"
      class:active={fmt.underline}
      title="underline"
      onclick={() => toggleUnderline(editor)}
    >
      <Icon name="underline" size={14} />
    </button>
    <button
      type="button"
      class:active={fmt.strike}
      title="strikethrough"
      onclick={() => toggleStrike(editor)}
    >
      <Icon name="strikethrough" size={14} />
    </button>
    <button
      type="button"
      class:active={fmt.code}
      title="inline code"
      onclick={() => toggleCode(editor)}
    >
      <Icon name="code" size={14} />
    </button>
    <button
      type="button"
      class:active={fmt.link}
      title="link"
      onclick={openLink}
    >
      <Icon name="link-2" size={14} />
    </button>
  </div>
{/if}
