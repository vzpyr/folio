<script lang="ts">
  import Icon from "./Icon.svelte";

  let {
    folder,
    stats,
    oncontinue,
    oncancel,
  }: {
    folder: string;
    stats: { files: number; dirs: number; mds: number; adoptable: number };
    oncontinue: () => void;
    oncancel: () => void;
  } = $props();

  let filesTxt = $derived(`${stats.files} file${stats.files === 1 ? "" : "s"}`);
  let dirsTxt = $derived(
    stats.dirs > 0
      ? ` and ${stats.dirs} folder${stats.dirs === 1 ? "" : "s"}`
      : ""
  );
  let mdsTxt = $derived(`${stats.mds} markdown`);
</script>

<div class="overlay" role="presentation" onclick={oncancel}>
  <div
    class="modal"
    role="alertdialog"
    tabindex="-1"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => e.key === "Escape" && oncancel()}
  >
    <div class="modal-header">
      <span class="modal-title">folder isn't empty</span>
      <button class="btn-close" onclick={oncancel} title="close"
        ><Icon name="x" size={16} /></button
      >
    </div>
    <p class="folder-path">{folder}</p>
    <p class="warn">
      this folder contains {filesTxt}{dirsTxt} — {mdsTxt}.
      {#if stats.mds > 0}
        folio will adopt the markdown files as notes
        {stats.adoptable > 0
          ? ` and write its header into ${stats.adoptable} of them`
          : ""}.
      {/if}
      a hidden <span class="mono">.folio</span> folder will be created here.
    </p>
    <p class="warn-strong">
      only continue if this is the folder you want as your vault.
    </p>
    <div class="modal-actions">
      <button class="btn-cancel" onclick={oncancel}>cancel</button>
      <button class="btn-continue" onclick={oncontinue}>continue</button>
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgb(0 0 0 / 0.45);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
    animation: modalBackdropEnter 0.18s ease-out forwards;
  }

  .modal {
    width: 90%;
    max-width: var(--maxw-modal);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
    padding: var(--pad-lg);
    box-shadow: 0 16px 48px rgb(0 0 0 / 0.24);
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

  .folder-path {
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    color: var(--fg-2);
    word-break: break-all;
    text-transform: none;
    margin-bottom: var(--gap-lg);
    padding: var(--pad-md);
    background: var(--bg-3);
    border-radius: var(--r-sm);
    border: 1px solid var(--border);
  }

  .warn {
    font-size: var(--fs-sm);
    color: var(--fg-2);
    margin-bottom: var(--gap);
    line-height: 1.45;
    text-transform: lowercase;
  }

  .warn-strong {
    font-size: var(--fs-sm);
    color: var(--fg);
    font-weight: 500;
    margin-bottom: var(--s4);
    line-height: 1.45;
    text-transform: lowercase;
  }

  .mono {
    font-family: var(--font-mono);
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--gap);
  }

  .btn-cancel {
    height: var(--ctl-h);
    padding: 0 var(--ctl-px);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    font-size: var(--fs-sm);
    color: var(--fg-3);
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .btn-cancel:hover {
    color: var(--fg);
    border-color: var(--border-strong);
    background: var(--bg-3);
  }

  .btn-continue {
    height: var(--ctl-h);
    padding: 0 var(--ctl-px);
    background: var(--fg);
    color: var(--bg);
    border-radius: var(--r-sm);
    font-size: var(--fs-sm);
    font-weight: 500;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
</style>
