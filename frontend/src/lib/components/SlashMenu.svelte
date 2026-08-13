<script lang="ts">
  import type { Writable } from "svelte/store";
  import Icon from "./Icon.svelte";
  import type { SlashItem, SlashState } from "../editor/slash.ts";

  let { menu }: { menu: Writable<SlashState> } = $props();

  let listEl: HTMLDivElement | undefined = $state();

  $effect(() => {
    const selected = $menu.selected;
    const list = listEl;
    const el = list?.querySelector(".slash-item.selected");
    if (!list || !el) return;

    const listRect = list.getBoundingClientRect();
    const itemRect = el.getBoundingClientRect();

    if (itemRect.top < listRect.top) {
      list.scrollTop -= listRect.top - itemRect.top;
    } else if (itemRect.bottom > listRect.bottom) {
      list.scrollTop += itemRect.bottom - listRect.bottom;
    }
  });
</script>

<div class="slash-list" role="listbox" bind:this={listEl}>
  {#if $menu.items.length === 0}
    <div class="slash-none">no matches</div>
  {:else}
    {#each $menu.items as item, i}
      <button
        type="button"
        role="option"
        class="slash-item"
        class:selected={i === $menu.selected}
        onmouseenter={() => menu.update((s) => ({ ...s, selected: i }))}
        onmousedown={(e) => e.preventDefault()}
        onclick={() => $menu.onPick(item)}
      >
        <Icon name={item.icon} size={14} />
        <span class="slash-title">{item.title}</span>
        <span class="slash-hint">{item.hint}</span>
      </button>
    {/each}
  {/if}
</div>
