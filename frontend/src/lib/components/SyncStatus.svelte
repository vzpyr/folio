<script lang="ts">
  import { appState } from "../../app.svelte.ts";
  import { formatRelative } from "../util/format.ts";
  import { clickOutside } from "../util/dom.ts";
  import type { IconName } from "../util/icons.ts";
  import Icon from "./Icon.svelte";

  let { variant = "button" }: { variant?: "button" | "row" } = $props();

  let sync = $derived(appState.sync);
  let syncStatus = $derived(appState.syncStatus);
  let pendingEdits = $derived(appState.pendingEdits);
  let lastError = $derived(appState.lastError);
  let lastSync = $derived(appState.lastSync);
  let isConfigured = $derived(
    !!sync || syncStatus === "offline" || syncStatus === "error",
  );
  let syncing = $derived(
    !!sync && (syncStatus === "syncing" || pendingEdits > 0),
  );
  let synced = $derived(
    !!sync && syncStatus === "synced" && pendingEdits === 0,
  );
  let offline = $derived(
    syncStatus === "offline" ||
      syncStatus === "error" ||
      (isConfigured && !syncing && !synced),
  );
  let kind = $derived(
    !isConfigured
      ? "local"
      : syncing
        ? "syncing"
        : synced
          ? "synced"
          : "offline",
  );
  let iconName: IconName = $derived(
    syncing
      ? "rotate-cw"
      : synced
        ? "check"
        : offline
          ? "cloud-alert"
          : "cloud-off",
  );
  let label = $derived(
    !isConfigured
      ? "local only"
      : syncing
        ? pendingEdits > 0
          ? "saving…"
          : "syncing…"
        : synced
          ? "synced"
          : "sync offline",
  );
  let detail = $derived(
    lastError
      ? lastError
      : synced && lastSync
        ? `last synced ${formatRelative(lastSync)}`
        : kind === "local"
          ? "no server linked — notes are stored only on this device."
          : kind === "offline" && lastSync
            ? `last synced ${formatRelative(lastSync)}`
            : "",
  );
  let open = $state(false);

  async function manualSync() {
    if (appState.sync) await appState.sync.sync();
    open = false;
  }
</script>

<div
  class="sync-status {kind}"
  class:row={variant === "row"}
  use:clickOutside={() => (open = false)}
>
  {#if variant === "row"}
    <button
      type="button"
      class="sync-row"
      onclick={() => (open = !open)}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label="sync status"
    >
      <Icon name={iconName} size={16} class={syncing ? "spin" : ""} />
      <span class="row-label">{label}</span>
      {#if synced && lastSync}
        <span class="row-time">{formatRelative(lastSync)}</span>
      {/if}
    </button>
  {:else}
    <button
      type="button"
      class="sync-btn"
      onclick={() => (open = !open)}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label="sync"
      title={detail || label}
    >
      <Icon name={iconName} size={20} class={syncing ? "spin" : ""} />
    </button>
  {/if}

  {#if open}
    <div
      class="dd sync-dd"
      role="dialog"
      aria-label="sync status"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
    >
      <div class="sync-pop-head">
        <Icon name={iconName} size={14} class={syncing ? "spin" : ""} />
        <span class="sync-pop-title">{label}</span>
      </div>
      {#if detail}
        <p class="sync-pop-detail">{detail}</p>
      {/if}
      <button
        type="button"
        class="sync-pop-now"
        onclick={manualSync}
        disabled={syncing}
      >
        {syncing ? "syncing…" : "sync now"}
      </button>
    </div>
  {/if}
</div>

<style>
  .sync-status {
    position: relative;
    display: inline-flex;
    flex-shrink: 0;
    min-width: 0;
  }

  .sync-status.row {
    display: flex;
    width: 100%;
  }

  .sync-btn {
    width: var(--ctl-h);
    height: var(--ctl-h);
    min-height: var(--ctl-h);
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--bg);
    color: var(--fg-2);
  }

  .sync-btn:hover {
    border-color: var(--border-strong);
    color: var(--fg);
  }

  .sync-row {
    display: flex;
    align-items: center;
    gap: var(--gap);
    width: 100%;
    text-align: left;
    padding: var(--pad-sm);
    border-radius: var(--r-sm);
    color: var(--fg-2);
  }

  .sync-row:hover {
    background: var(--bg-3);
  }

  .row-label {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row-time {
    flex-shrink: 0;
    font-size: var(--fs-xs);
    color: var(--fg-3);
  }

  .sync-status.synced .sync-btn {
    color: var(--fg-2);
  }

  .sync-status.syncing .sync-btn {
    color: var(--fg-2);
  }

  .sync-status.offline .sync-btn {
    color: var(--fg-2);
    border-color: var(--border-strong);
  }

  .sync-status.local .sync-btn {
    color: var(--fg-2);
  }

  .sync-status.synced .sync-pop-head {
    color: var(--fg);
  }

  .sync-status.syncing .sync-pop-head {
    color: var(--fg-2);
  }

  .sync-status.offline .sync-pop-head {
    color: var(--fg);
  }

  .sync-status.local .sync-pop-head {
    color: var(--fg-3);
  }

  .sync-dd {
    left: auto;
    right: 0;
    width: var(--panel-w);
  }

  .sync-status.row .sync-dd {
    left: 0;
    right: auto;
    min-width: 0;
    width: 100%;
    max-width: 100%;
  }

  .sync-pop-head {
    display: flex;
    align-items: center;
    gap: var(--gap);
    padding: var(--pad-sm);
    min-height: var(--ctl-h);
    border-radius: var(--r-sm);
    color: var(--fg-2);
  }

  .sync-pop-title {
    flex: 1;
    min-width: 0;
    font-size: var(--fs-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sync-pop-detail {
    margin: 0;
    padding: var(--pad-xs) var(--pad-sm) var(--pad-sm);
    font-size: var(--fs-sm);
    color: var(--fg-3);
    white-space: normal;
    overflow-wrap: break-word;
  }

  .sync-pop-now {
    width: 100%;
    height: var(--ctl-h);
    display: flex;
    align-items: center;
    justify-content: center;
    margin-top: var(--pad-xs);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    color: var(--fg-2);
    font-size: var(--fs-sm);
  }

  .sync-pop-now:hover {
    background: var(--bg-3);
    border-color: var(--border-strong);
    color: var(--fg);
  }

  .sync-pop-now:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
