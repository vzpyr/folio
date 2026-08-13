<script lang="ts">
  import { getDialog, cancelDialog, submitDialog } from "../dialogs.svelte.ts";
  import Icon from "./Icon.svelte";

  let dialog = $derived(getDialog());

  let input = $state("");
  let inputEl = $state<HTMLInputElement | null>(null);
  let primaryEl = $state<HTMLButtonElement | null>(null);
  let modalEl = $state<HTMLElement | null>(null);

  let isPrompt = $derived(dialog?.kind === "prompt");

  $effect(() => {
    const d = dialog;
    if (!d) return;

    if (d.kind === "prompt") input = d.options.initial ?? "";

    const previous = document.activeElement;
    requestAnimationFrame(() => {
      if (d.kind === "prompt") inputEl?.focus();
      else primaryEl?.focus();
    });

    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  });

  function onKeydown(e: KeyboardEvent) {
    if (!dialog) return;

    if (e.key === "Escape") {
      e.preventDefault();
      cancelDialog();
      return;
    }

    if (e.key === "Tab" && modalEl) {
      const items = modalEl.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if dialog}
  {#key dialog.id}
    <div class="overlay" role="presentation" onclick={cancelDialog}>
      <div
        class="modal"
        role={isPrompt ? "dialog" : "alertdialog"}
        aria-modal="true"
        aria-labelledby="dialog-title"
        tabindex="-1"
        bind:this={modalEl}
        onclick={(e) => e.stopPropagation()}
      >
        <div class="modal-header">
          <span class="modal-title" id="dialog-title">{dialog.options.title}</span>
          <button class="btn-close" onclick={cancelDialog} title="close"
            ><Icon name="x" size={16} /></button
          >
        </div>
        {#if dialog.options.message}
          <p class="modal-message">{dialog.options.message}</p>
        {/if}
        {#if isPrompt}
          <input
            class="modal-input"
            type="text"
            placeholder={dialog.options.placeholder ?? ""}
            bind:this={inputEl}
            bind:value={input}
            onkeydown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitDialog(input);
              }
            }}
          />
        {/if}
        <div class="modal-actions">
          <button class="btn-cancel" onclick={cancelDialog}>cancel</button>
          <button class="btn-confirm" bind:this={primaryEl} onclick={() => submitDialog(input)}>
            {dialog.options.confirmLabel ?? (isPrompt ? "ok" : "confirm")}
          </button>
        </div>
      </div>
    </div>
  {/key}
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgb(0 0 0 / 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }

  .modal {
    width: 90%;
    max-width: var(--maxw-modal);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
    padding: var(--pad-lg);
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

  .modal-message {
    font-size: var(--fs-sm);
    color: var(--fg-2);
    line-height: 1.45;
    margin-bottom: var(--gap-lg);
  }

  .modal-input {
    width: 100%;
    height: var(--ctl-h);
    padding: 0 var(--ctl-px);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--bg-2);
    color: var(--fg);
    font-size: var(--fs-base);
    margin-bottom: var(--gap-lg);
  }

  .modal-input:focus {
    outline: var(--focus-ring);
    outline-offset: -1px;
    border-color: var(--border-strong);
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--gap);
  }

  .btn-cancel {
    padding: var(--pad-md);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    font-size: var(--fs-sm);
    color: var(--fg-3);
  }

  .btn-cancel:hover {
    color: var(--fg);
    border-color: var(--border-strong);
  }

  .btn-confirm {
    padding: var(--pad-md);
    background: var(--fg);
    color: var(--bg);
    border-radius: var(--r-sm);
    font-size: var(--fs-sm);
    font-weight: 500;
  }
</style>
