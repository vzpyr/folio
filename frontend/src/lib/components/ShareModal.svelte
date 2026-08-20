<script lang="ts">
  import { onMount } from "svelte";
  import { appState } from "../../app.svelte.ts";
  import Icon from "./Icon.svelte";
  import { parseFrontmatter, extractTitle } from "../editor/markdown.ts";
  import { loadSettings, loadSecrets } from "../util/settings.ts";
  import {
    generateRandomKey,
    generateRandomPassword,
    encryptShare,
    toBase64,
    fromBase64,
    base64url,
  } from "../share/crypto.ts";
  import {
    createRemoteShare,
    getRemoteShareByNote,
    deleteRemoteShare,
  } from "../share/api.ts";
  import type { ShareAttachment, SharePayload, ShareMeta } from "../share/types.ts";

  const {
    noteId,
    onclose,
  }: {
    noteId: string;
    onclose: () => void;
  } = $props();

  let serverUrl = $state("");
  let token = $state("");
  let loading = $state(true);
  let creating = $state(false);
  let revoking = $state(false);
  let error = $state("");
  let copyNotice = $state("");

  let existingShare = $state<ShareMeta | null>(null);

  let usePassword = $state(false);
  let password = $state("");
  let expiryMs = $state<number | null>(7 * 24 * 60 * 60 * 1000);
  let maxViews = $state<number | null>(null);

  let createdLink = $state("");
  let savedPassword = $state("");

  onMount(() => {
    void init();
  });

  async function init() {
    loading = true;
    error = "";

    const settings = loadSettings();
    const secrets = await loadSecrets();

    serverUrl = settings.serverUrl.trim();
    token = secrets.token.trim();

    if (!serverUrl && typeof window !== "undefined" && window.location.origin.startsWith("http")) {
      serverUrl = window.location.origin;
    }

    if (serverUrl && token) {
      try {
        existingShare = await getRemoteShareByNote(serverUrl, token, noteId);
      } catch {
        existingShare = null;
      }
    }

    loading = false;
  }

  function generatePass() {
    password = generateRandomPassword(12);
  }

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      copyNotice = `${label} copied`;
      setTimeout(() => (copyNotice = ""), 2000);
    } catch {
      copyNotice = "copy failed";
      setTimeout(() => (copyNotice = ""), 2000);
    }
  }

  async function createShareLink() {
    const st = appState.store;
    if (!st || !serverUrl || !token) return;

    creating = true;
    error = "";

    try {
      const rawContent = await st.readNote(noteId);
      if (!rawContent) throw new Error("note not found");

      const { meta: fm, body } = parseFrontmatter(rawContent);
      const title = fm.title ?? extractTitle(rawContent, noteId);
      const tags = fm.tags ?? [];

      const attList = await st.listAttachments();
      const referencedAttachments: ShareAttachment[] = [];

      const refRegex = /assets\/([0-9a-f-]+)\.(\w+)/g;
      let match: RegExpExecArray | null;
      const foundIds = new Set<string>();

      while ((match = refRegex.exec(body)) !== null) {
        foundIds.add(match[1]);
      }

      for (const attId of foundIds) {
        const attInfo = attList.find((a) => a.id === attId);
        if (!attInfo) continue;
        const bytes = await st.readAttachment(attId);
        if (!bytes) continue;

        referencedAttachments.push({
          id: `assets/${attId}.${attInfo.ext}`,
          name: `${attId}.${attInfo.ext}`,
          mime: null,
          data: toBase64(bytes),
        });
      }

      const payload: SharePayload = {
        version: 1,
        title,
        body,
        tags,
        created: fm.created ?? Date.now(),
        updated: fm.updated ?? Date.now(),
        attachments: referencedAttachments,
      };

      const shareKey = generateRandomKey();
      const encResult = await encryptShare(
        payload,
        shareKey,
        usePassword && password.trim() ? password.trim() : undefined,
      );

      const shareId = crypto.randomUUID();
      const now = Date.now();
      const expiresAt = expiryMs ? now + expiryMs : null;

      await createRemoteShare(serverUrl, token, {
        id: shareId,
        note_id: noteId,
        nonce: encResult.nonce,
        blob: encResult.blob,
        has_password: encResult.has_password,
        salt: encResult.salt,
        wrapped_key: encResult.wrapped_key,
        verifier: encResult.verifier,
        expires_at: expiresAt,
        max_views: maxViews,
      });

      const keyPart = encResult.has_password
        ? `salt=${base64url(fromBase64(encResult.salt!))}`
        : `k=${base64url(shareKey)}`;

      const origin = serverUrl.replace(/\/+$/, "");
      createdLink = `${origin}/#/share/${shareId}#${keyPart}`;
      savedPassword = usePassword ? password.trim() : "";
      existingShare = {
        id: shareId,
        note_id: noteId,
        has_password: encResult.has_password,
        salt: encResult.salt,
        wrapped_key: encResult.wrapped_key,
        verifier: encResult.verifier,
        expires_at: expiresAt,
        max_views: maxViews,
        view_count: 0,
        created_at: now,
      };
    } catch (e) {
      error = e instanceof Error ? e.message : "failed to create share";
    } finally {
      creating = false;
    }
  }

  async function revokeShare() {
    if (!existingShare || !serverUrl || !token) return;

    revoking = true;
    error = "";

    try {
      await deleteRemoteShare(serverUrl, token, existingShare.id);
      existingShare = null;
      createdLink = "";
      savedPassword = "";
    } catch (e) {
      error = e instanceof Error ? e.message : "failed to revoke share";
    } finally {
      revoking = false;
    }
  }

  function formatExpiry(timestamp?: number | null): string {
    if (!timestamp) return "never";
    const diff = timestamp - Date.now();
    if (diff <= 0) return "expired";
    const hours = Math.round(diff / (1000 * 60 * 60));
    if (hours < 24) return `in ${hours} hour${hours === 1 ? "" : "s"}`;
    const days = Math.round(hours / 24);
    return `in ${days} day${days === 1 ? "" : "s"}`;
  }
</script>

<div class="overlay" role="presentation" onclick={onclose}>
  <div
    class="modal"
    role="dialog"
    tabindex="-1"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => e.key === "Escape" && onclose()}
  >
    <div class="modal-header">
      <span class="modal-title">share note</span>
      <button class="btn-close" onclick={onclose} title="close">
        <Icon name="x" size={16} />
      </button>
    </div>

    {#if loading}
      <p class="desc">checking share status…</p>
    {:else if !serverUrl || !token}
      <div class="warn-box">
        <p class="warn">a connected folio sync server is required to share notes.</p>
        <p class="warn-sub">configure your server url and sync token in settings first.</p>
      </div>
      <div class="modal-actions">
        <button class="btn-cancel" onclick={onclose}>close</button>
      </div>
    {:else if createdLink}
      <div class="result-box">
        <p class="result-title">note share link created</p>
        <div class="copy-row">
          <input class="link-input" readonly value={createdLink} />
          <button class="btn-copy" onclick={() => copyText(createdLink, "link")}>
            copy link
          </button>
        </div>

        {#if savedPassword}
          <div class="pass-row">
            <span class="pass-label">password:</span>
            <input class="pass-input" readonly value={savedPassword} />
            <button class="btn-copy" onclick={() => copyText(savedPassword, "password")}>
              copy password
            </button>
          </div>
        {/if}

        {#if copyNotice}
          <p class="notice">{copyNotice}</p>
        {/if}
      </div>

      <div class="modal-actions">
        <button class="btn-continue" onclick={onclose}>done</button>
      </div>
    {:else if existingShare}
      <div class="existing-box">
        <p class="existing-title">active share link</p>
        <p class="existing-meta">
          expires: {formatExpiry(existingShare.expires_at)}
          {#if existingShare.max_views}
            • views: {existingShare.view_count} / {existingShare.max_views}
          {:else}
            • views: {existingShare.view_count}
          {/if}
          {#if existingShare.has_password}
            • password protected
          {/if}
        </p>

        {#if error}
          <p class="error-msg">{error}</p>
        {/if}

        <div class="existing-actions">
          <button class="btn-danger" disabled={revoking} onclick={revokeShare}>
            {revoking ? "revoking…" : "revoke share link"}
          </button>
        </div>
      </div>

      <div class="modal-actions">
        <button class="btn-cancel" onclick={onclose}>close</button>
      </div>
    {:else}
      <div class="form-group">
        <label class="check-label">
          <input type="checkbox" bind:checked={usePassword} onchange={() => usePassword && !password && generatePass()} />
          require password
        </label>
        {#if usePassword}
          <div class="pass-field-row">
            <input
              type="text"
              class="text-input"
              placeholder="enter or generate password"
              bind:value={password}
            />
            <button type="button" class="btn-gen" onclick={generatePass} title="generate random password">
              generate
            </button>
          </div>
        {/if}
      </div>

      <div class="form-row">
        <div class="form-col">
          <label class="field-label" for="share-expiry">expires after</label>
          <select
            id="share-expiry"
            class="select-input"
            bind:value={expiryMs}
          >
            <option value={1 * 60 * 60 * 1000}>1 hour</option>
            <option value={24 * 60 * 60 * 1000}>1 day</option>
            <option value={7 * 24 * 60 * 60 * 1000}>7 days</option>
            <option value={14 * 24 * 60 * 60 * 1000}>14 days</option>
            <option value={30 * 24 * 60 * 60 * 1000}>30 days</option>
            <option value={null}>never</option>
          </select>
        </div>

        <div class="form-col">
          <label class="field-label" for="share-views">max views</label>
          <select
            id="share-views"
            class="select-input"
            bind:value={maxViews}
          >
            <option value={null}>unlimited</option>
            <option value={1}>1 view (burn after reading)</option>
            <option value={5}>5 views</option>
            <option value={10}>10 views</option>
            <option value={50}>50 views</option>
            <option value={100}>100 views</option>
          </select>
        </div>
      </div>

      {#if error}
        <p class="error-msg">{error}</p>
      {/if}

      <div class="modal-actions">
        <button class="btn-cancel" onclick={onclose}>cancel</button>
        <button
          class="btn-continue"
          disabled={creating || (usePassword && !password.trim())}
          onclick={createShareLink}
        >
          {creating ? "creating…" : "create share link"}
        </button>
      </div>
    {/if}
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
    animation: modalBackdropEnter 0.15s ease-out forwards;
  }

  .modal {
    width: 90%;
    max-width: var(--maxw-modal);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
    padding: var(--pad-lg);
    box-shadow: 0 16px 48px rgb(0 0 0 / 0.24);
    animation: modalContentEnter 0.16s cubic-bezier(0.16, 1, 0.3, 1) forwards;
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

  .desc {
    font-size: var(--fs-sm);
    color: var(--fg-3);
    margin-bottom: var(--gap-lg);
  }

  .warn-box {
    padding: var(--pad-md);
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    margin-bottom: var(--gap-lg);
  }

  .warn {
    font-size: var(--fs-sm);
    color: var(--fg);
    margin-bottom: var(--s1);
  }

  .warn-sub {
    font-size: var(--fs-xs);
    color: var(--fg-3);
  }

  .form-group {
    margin-bottom: var(--gap-lg);
  }

  .check-label {
    display: flex;
    align-items: center;
    gap: var(--s2);
    font-size: var(--fs-sm);
    color: var(--fg);
    cursor: pointer;
    user-select: none;
  }

  .pass-field-row {
    display: flex;
    gap: var(--s2);
    margin-top: var(--s2);
  }

  .text-input,
  .select-input,
  .link-input,
  .pass-input {
    height: var(--ctl-h);
    padding: 0 var(--ctl-px);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-2);
    color: var(--fg);
    font-size: var(--fs-sm);
  }

  .text-input {
    flex: 1;
    min-width: 0;
  }

  .text-input:focus,
  .select-input:focus {
    outline: var(--focus-ring);
    outline-offset: -1px;
  }

  .btn-gen,
  .btn-copy {
    height: var(--ctl-h);
    padding: 0 var(--ctl-px);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-2);
    color: var(--fg-2);
    font-size: var(--fs-sm);
    flex-shrink: 0;
  }

  .btn-gen:hover,
  .btn-copy:hover {
    background: var(--bg-3);
    color: var(--fg);
  }

  .form-row {
    display: flex;
    gap: var(--gap-lg);
    margin-bottom: var(--gap-lg);
  }

  .form-col {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--s1);
  }

  .field-label {
    font-size: var(--fs-xs);
    color: var(--fg-3);
    text-transform: lowercase;
  }

  .select-input {
    width: 100%;
  }

  .result-box,
  .existing-box {
    padding: var(--pad-md);
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    margin-bottom: var(--gap-lg);
  }

  .result-title,
  .existing-title {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--fg);
    margin-bottom: var(--gap);
    text-transform: lowercase;
  }

  .existing-meta {
    font-size: var(--fs-xs);
    color: var(--fg-3);
    margin-bottom: var(--gap);
  }

  .copy-row {
    display: flex;
    gap: var(--s2);
    margin-bottom: var(--gap);
  }

  .link-input {
    flex: 1;
    min-width: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
  }

  .pass-row {
    display: flex;
    align-items: center;
    gap: var(--s2);
  }

  .pass-label {
    font-size: var(--fs-xs);
    color: var(--fg-3);
  }

  .pass-input {
    flex: 1;
    min-width: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
  }

  .notice {
    font-size: var(--fs-xs);
    color: var(--fg-2);
    margin-top: var(--s2);
  }

  .error-msg {
    font-size: var(--fs-xs);
    color: var(--g4);
    margin-bottom: var(--gap);
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
  }

  .btn-cancel:hover {
    color: var(--fg);
    border-color: var(--border-strong);
  }

  .btn-continue {
    height: var(--ctl-h);
    padding: 0 var(--ctl-px);
    background: var(--fg);
    color: var(--bg);
    border-radius: var(--r-sm);
    font-size: var(--fs-sm);
    font-weight: 500;
  }

  .btn-continue:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .btn-danger {
    height: var(--ctl-h);
    padding: 0 var(--ctl-px);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    color: var(--g4);
    font-size: var(--fs-sm);
  }

  .btn-danger:hover {
    background: var(--bg-3);
  }
</style>
