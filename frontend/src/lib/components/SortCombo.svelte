<script lang="ts">
  import Icon from "./Icon.svelte";
  import { clickOutside } from "../util/dom.ts";

  export type SortBy = "updated" | "created" | "title";

  let {
    value,
    onchange,
  }: {
    value: SortBy;
    onchange: (v: SortBy) => void;
  } = $props();

  let open = $state(false);

  const options: { value: SortBy; label: string }[] = [
    { value: "updated", label: "updated" },
    { value: "created", label: "created" },
    { value: "title", label: "title" },
  ];

  function pick(v: SortBy) {
    onchange(v);
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
    aria-label="sort notes"
    title="sort notes"
  >
    <span class="combo-label">{value}</span>
    <Icon name="chevron-down" size={10} class="combo-caret" />
  </button>

  {#if open}
    <div
      class="dd sort-dd"
      role="listbox"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
    >
      {#each options as opt (opt.value)}
        <button
          type="button"
          class="dd-item"
          class:active={value === opt.value}
          onclick={() => pick(opt.value)}
        >
          <span class="dd-check">
            {#if value === opt.value}
              <Icon name="check" size={12} />
            {/if}
          </span>
          <span class="dd-label">{opt.label}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .sort-dd {
    left: auto;
    right: 0;
  }
</style>
