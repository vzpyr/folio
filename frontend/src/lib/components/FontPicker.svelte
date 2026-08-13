<script lang="ts">
  import Icon from "./Icon.svelte";
  import { clickOutside } from "../util/dom.ts";
  import type { FontDef } from "../util/fonts.ts";

  let {
    value,
    fonts,
    label,
    onchange,
  }: {
    value: string;
    fonts: FontDef[];
    label: string;
    onchange: (v: string) => void;
  } = $props();

  let open = $state(false);

  const selected = $derived(fonts.find((f) => f.id === value) ?? fonts[0]);

  function pick(id: string) {
    onchange(id);
    open = false;
  }

  function toggle() {
    open = !open;
  }
</script>

<div class="combo-wrap" use:clickOutside={() => (open = false)}>
  <button
    type="button"
    class="combo"
    class:open
    onclick={toggle}
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-label={label}
    title={label}
  >
    <span class="combo-label" style="font-family: {selected.family}"
      >{selected.label}</span
    >
    <Icon name="chevron-down" size={10} class="combo-caret" />
  </button>

  {#if open}
    <div
      class="dd font-dd"
      role="listbox"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
    >
      {#each fonts as f (f.id)}
        <button
          type="button"
          class="dd-item"
          class:active={f.id === selected.id}
          onclick={() => pick(f.id)}
        >
          <span class="dd-check">
            {#if f.id === selected.id}
              <Icon name="check" size={12} />
            {/if}
          </span>
          <span class="dd-label" style="font-family: {f.family}"
            >{f.label}</span
          >
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .font-dd {
    left: auto;
    right: 0;
  }
</style>
