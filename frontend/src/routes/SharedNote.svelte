<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { Editor } from "@tiptap/core";
  import StarterKit from "@tiptap/starter-kit";
  import BulletList from "@tiptap/extension-bullet-list";
  import OrderedList from "@tiptap/extension-ordered-list";
  import Underline from "@tiptap/extension-underline";
  import TaskList from "@tiptap/extension-task-list";
  import TaskItem from "@tiptap/extension-task-item";
  import { Table } from "@tiptap/extension-table";
  import { TableRow } from "@tiptap/extension-table-row";
  import { TableCell } from "@tiptap/extension-table-cell";
  import { TableHeader } from "@tiptap/extension-table-header";
  import Image from "@tiptap/extension-image";
  import Link from "@tiptap/extension-link";
  import { Markdown } from "tiptap-markdown";
  import Icon from "../lib/components/Icon.svelte";
  import { FootnoteRef, FootnoteDef, jumpToFootnoteDef } from "../lib/editor/footnote.ts";
  import { InlineMath, BlockMath } from "../lib/editor/math.ts";
  import { Callout } from "../lib/editor/callout.ts";
  import { FolioCodeBlock } from "../lib/editor/code-block.ts";
  import { formatTimestamp, formatBytes } from "../lib/util/format.ts";
  import { loadSettings } from "../lib/util/settings.ts";
  import {
    fromBase64,
    fromBase64url,
    toBase64,
    decryptShare,
    deriveVerifierOnly,
    unwrapShareKey,
  } from "../lib/share/crypto.ts";
  import { getRemoteShare, unlockRemoteShare } from "../lib/share/api.ts";
  import type { SharePayload } from "../lib/share/types.ts";

  const { shareId }: { shareId: string } = $props();

  let loading = $state(true);
  let unlocking = $state(false);
  let error = $state<string | null>(null);
  let needsPassword = $state(false);
  let passwordInput = $state("");
  let salt = $state<string | null>(null);
  let keyFromUrl = $state<Uint8Array | null>(null);

  let payload = $state<SharePayload | null>(null);
  let editorEl: HTMLDivElement | undefined = $state();
  let view: Editor | null = $state(null);
  let toast = $state("");
  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  const objectUrls = new Map<string, string>();

  function showToast(msg: string) {
    toast = msg;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = ""), 2500);
  }

  function getEffectiveServerUrl(): string {
    const s = loadSettings();
    if (s.serverUrl && s.serverUrl.trim()) return s.serverUrl.trim();
    if (typeof window !== "undefined" && window.location.origin.startsWith("http")) {
      return window.location.origin;
    }
    return "";
  }

  function parseHashParams(): { k?: string; salt?: string } {
    const raw = location.hash;
    const idx = raw.indexOf("#", 1);
    const frag = idx !== -1 ? raw.slice(idx + 1) : raw.includes("?") ? raw.split("?")[1] : "";
    const params = new URLSearchParams(frag);
    return {
      k: params.get("k") || undefined,
      salt: params.get("salt") || undefined,
    };
  }

  onMount(() => {
    void loadShare();
  });

  onDestroy(() => {
    view?.destroy();
    view = null;
    for (const u of objectUrls.values()) URL.revokeObjectURL(u);
    objectUrls.clear();
  });

  async function loadShare() {
    loading = true;
    error = null;

    const serverUrl = getEffectiveServerUrl();
    if (!serverUrl) {
      error = "no_server";
      loading = false;
      return;
    }

    const { k, salt: urlSalt } = parseHashParams();

    if (k) {
      try {
        keyFromUrl = fromBase64url(k);
      } catch {
        keyFromUrl = null;
      }
    }

    if (urlSalt) {
      try {
        salt = toBase64(fromBase64url(urlSalt));
      } catch {
        salt = null;
      }
    }

    try {
      const res = await getRemoteShare(serverUrl, shareId);

      if (res.has_password) {
        needsPassword = true;
        salt = res.salt || salt;
        loading = false;
        return;
      }

      if (!keyFromUrl) {
        error = "missing_key";
        loading = false;
        return;
      }

      if (!res.blob || !res.nonce) {
        error = "invalid_payload";
        loading = false;
        return;
      }

      const p = await decryptShare(res.blob, res.nonce, keyFromUrl);
      displayPayload(p);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "not_found") error = "not_found";
      else if (msg === "expired") error = "expired";
      else error = "error_loading";
    } finally {
      loading = false;
    }
  }

  async function submitPassword() {
    if (!passwordInput.trim() || !salt) return;

    unlocking = true;
    error = null;

    const serverUrl = getEffectiveServerUrl();

    try {
      const verifier = await deriveVerifierOnly(passwordInput.trim(), salt);
      const res = await unlockRemoteShare(serverUrl, shareId, verifier);

      if (!res.wrapped_key || !res.blob || !res.nonce) {
        throw new Error("invalid_payload");
      }

      const shareKey = await unwrapShareKey(res.wrapped_key, passwordInput.trim(), res.salt || salt);
      const p = await decryptShare(res.blob, res.nonce, shareKey);
      needsPassword = false;
      displayPayload(p);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "invalid_password") error = "invalid_password";
      else if (msg === "expired") error = "expired";
      else if (msg === "not_found") error = "not_found";
      else error = "decrypt_failed";
    } finally {
      unlocking = false;
    }
  }

  function displayPayload(p: SharePayload) {
    payload = p;

    for (const att of p.attachments) {
      try {
        const bytes = fromBase64(att.data);
        const blob = new Blob([bytes], { type: att.mime || "" });
        const url = URL.createObjectURL(blob);
        objectUrls.set(att.id, url);
      } catch {
      }
    }

    requestAnimationFrame(() => {
      if (editorEl) initEditor(p.body);
    });
  }

  function initEditor(body: string) {
    view?.destroy();

    const FolioImage = Image.extend({
      addAttributes() {
        return {
          ...this.parent?.(),
          ref: {
            default: null,
            parseHTML: (el) => {
              const src = el.getAttribute("src") ?? "";
              return src.startsWith("assets/") ? src : null;
            },
            renderHTML: (attrs) => (attrs.ref ? { "data-ref": attrs.ref } : {}),
          },
          width: {
            default: null,
            parseHTML: (el) => {
              const w = el.getAttribute("width");
              if (!w) return null;
              const n = parseInt(w, 10);
              return Number.isFinite(n) && n > 0 ? n : null;
            },
            renderHTML: (attrs) => (attrs.width ? { width: String(attrs.width) } : {}),
          },
        };
      },
    });

    view = new Editor({
      element: editorEl,
      editable: false,
      extensions: [
        StarterKit.configure({
          link: false,
          underline: false,
          bulletList: false,
          orderedList: false,
          codeBlock: false,
        }),
        FolioCodeBlock,
        Underline,
        BulletList,
        OrderedList,
        TaskList,
        TaskItem.configure({ nested: true }),
        Table.configure({ resizable: false }),
        TableRow,
        TableCell,
        TableHeader,
        FolioImage,
        Link.configure({
          openOnClick: true,
          autolink: true,
        }),
        FootnoteRef,
        FootnoteDef,
        InlineMath,
        BlockMath,
        Callout,
        Markdown.configure({
          html: true,
          breaks: false,
        }),
      ],
      editorProps: {
        attributes: { class: "folio-editor shared-editor" },
        handleClick(_view, _pos, event) {
          const target = event.target as HTMLElement | null;

          if (target?.closest?.("sup.footnote-ref")) {
            const sup = target.closest("sup.footnote-ref");
            const label = sup?.getAttribute("data-label");
            if (label && view) jumpToFootnoteDef(view, label);
            return true;
          }

          if (target?.closest?.(".file-chip") || target?.closest?.('a[href^="assets/"]')) {
            const el = (target.closest(".file-chip") || target.closest('a[href^="assets/"]')) as HTMLElement;
            const ref = el.getAttribute("data-ref") || el.getAttribute("href") || "";
            const name = el.getAttribute("data-name") || el.textContent || "file";
            downloadAttachment(ref, name);
            return true;
          }

          return false;
        },
      },
    });

    view.commands.setContent(body);

    view.state.doc.descendants((node, pos) => {
      if (node.type.name === "image" && node.attrs.ref) {
        const resolved = objectUrls.get(node.attrs.ref);
        if (resolved && view) {
          view.view.dispatch(
            view.state.tr.setNodeMarkup(pos, undefined, {
              ...node.attrs,
              src: resolved,
            }),
          );
        }
      }
    });
  }

  function downloadAttachment(ref: string, name: string) {
    const url = objectUrls.get(ref);
    if (!url) {
      showToast("file not found");
      return;
    }

    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function copyMarkdown() {
    if (!payload) return;
    try {
      await navigator.clipboard.writeText(payload.body);
      showToast("markdown copied");
    } catch {
      showToast("copy failed");
    }
  }

  function downloadNote() {
    if (!payload) return;
    const blob = new Blob([payload.body], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${payload.title || "note"}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
</script>

<div class="shared-layout">
  <header class="shared-header">
    <div class="header-left">
      <span class="brand">folio</span>
      <span class="brand-badge">shared note</span>
    </div>
    {#if payload}
      <div class="header-right">
        <button class="btn-action" onclick={copyMarkdown} title="copy markdown">
          <Icon name="copy" size={14} />
          <span>copy</span>
        </button>
        <button class="btn-action" onclick={downloadNote} title="download markdown">
          <Icon name="download" size={14} />
          <span>download</span>
        </button>
      </div>
    {/if}
  </header>

  <main class="shared-content">
    {#if loading}
      <div class="center-state">
        <p class="state-msg">loading note…</p>
      </div>
    {:else if needsPassword}
      <div class="password-box">
        <h2 class="pw-title">protected note</h2>
        <p class="pw-desc">this note is encrypted with a password. enter the password to view its contents.</p>

        <form
          class="pw-form"
          onsubmit={(e) => {
            e.preventDefault();
            void submitPassword();
          }}
        >
          <input
            type="password"
            class="pw-input"
            placeholder="password"
            bind:value={passwordInput}
            autofocus
          />
          {#if error === "invalid_password"}
            <p class="error-msg">incorrect password</p>
          {:else if error}
            <p class="error-msg">{error}</p>
          {/if}
          <button type="submit" class="btn-unlock" disabled={unlocking || !passwordInput.trim()}>
            {unlocking ? "unlocking…" : "unlock note"}
          </button>
        </form>
      </div>
    {:else if error}
      <div class="center-state">
        {#if error === "not_found"}
          <h2 class="state-head">note not found</h2>
          <p class="state-sub">this link may be invalid or the author removed the share.</p>
        {:else if error === "expired"}
          <h2 class="state-head">link expired</h2>
          <p class="state-sub">this share link has expired or reached its maximum view limit.</p>
        {:else if error === "missing_key"}
          <h2 class="state-head">decryption key missing</h2>
          <p class="state-sub">the link is missing the decryption key. ensure you copied the complete url.</p>
        {:else}
          <h2 class="state-head">unable to load note</h2>
          <p class="state-sub">could not load or decrypt the note.</p>
        {/if}
      </div>
    {:else if payload}
      <div class="doc-container">
        <h1 class="doc-title">{payload.title}</h1>

        {#if payload.tags && payload.tags.length > 0}
          <div class="tags-list">
            {#each payload.tags as t}
              <span class="tag-chip">#{t}</span>
            {/each}
          </div>
        {/if}

        <div class="doc-meta">
          <span>updated {formatTimestamp(payload.updated)}</span>
        </div>

        <div class="editor-wrap" bind:this={editorEl}></div>
      </div>
    {/if}
  </main>

  {#if toast}
    <div class="toast">{toast}</div>
  {/if}
</div>

<style>
  .shared-layout {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    color: var(--fg);
  }

  .shared-header {
    height: var(--bar-h);
    padding: 0 var(--pad-page);
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: var(--bg);
    flex-shrink: 0;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: var(--s2);
  }

  .brand {
    font-weight: 700;
    font-size: var(--fs-md);
    letter-spacing: -0.02em;
  }

  .brand-badge {
    font-size: var(--fs-xs);
    color: var(--fg-3);
    padding: var(--pad-xs) var(--pad-sm);
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    text-transform: lowercase;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: var(--s2);
  }

  .btn-action {
    display: inline-flex;
    align-items: center;
    gap: var(--s1);
    height: var(--ctl-h);
    padding: 0 var(--ctl-px);
    font-size: var(--fs-xs);
    color: var(--fg-2);
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
  }

  .btn-action:hover {
    background: var(--bg-3);
    color: var(--fg);
  }

  .shared-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: var(--pad-page);
    overflow-y: auto;
  }

  .center-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: var(--pad-lg);
  }

  .state-head {
    font-size: var(--fs-xl);
    font-weight: 600;
    margin-bottom: var(--s2);
  }

  .state-sub,
  .state-msg {
    font-size: var(--fs-sm);
    color: var(--fg-3);
  }

  .password-box {
    width: 100%;
    max-width: var(--maxw-modal);
    margin-top: var(--s5);
    padding: var(--pad-lg);
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
  }

  .pw-title {
    font-size: var(--fs-lg);
    font-weight: 600;
    margin-bottom: var(--s1);
    text-transform: lowercase;
  }

  .pw-desc {
    font-size: var(--fs-sm);
    color: var(--fg-3);
    margin-bottom: var(--gap-lg);
    line-height: 1.45;
  }

  .pw-form {
    display: flex;
    flex-direction: column;
    gap: var(--gap);
  }

  .pw-input {
    height: var(--ctl-h);
    padding: 0 var(--ctl-px);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg);
    color: var(--fg);
    font-size: var(--fs-sm);
  }

  .pw-input:focus {
    outline: var(--focus-ring);
    outline-offset: -1px;
  }

  .btn-unlock {
    height: var(--ctl-h);
    padding: 0 var(--ctl-px);
    background: var(--fg);
    color: var(--bg);
    border-radius: var(--r-sm);
    font-size: var(--fs-sm);
    font-weight: 500;
  }

  .btn-unlock:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .error-msg {
    font-size: var(--fs-xs);
    color: var(--g4);
  }

  .doc-container {
    width: 100%;
    max-width: var(--maxw-editor);
    padding-bottom: var(--s5);
  }

  .doc-title {
    font-size: var(--fs-2xl);
    font-weight: 700;
    line-height: 1.2;
    margin-bottom: var(--s2);
  }

  .tags-list {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s1);
    margin-bottom: var(--s2);
  }

  .tag-chip {
    font-size: var(--fs-xs);
    color: var(--fg-3);
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    padding: var(--pad-xs);
  }

  .doc-meta {
    font-size: var(--fs-xs);
    color: var(--fg-3);
    margin-bottom: var(--gap-lg);
    padding-bottom: var(--gap);
    border-bottom: 1px solid var(--border);
  }

  .editor-wrap :global(.folio-editor) {
    outline: none;
  }

  .toast {
    position: fixed;
    bottom: var(--s5);
    left: 50%;
    transform: translateX(-50%);
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    padding: var(--pad-md);
    font-size: var(--fs-sm);
    color: var(--fg);
    z-index: 60;
    text-transform: lowercase;
  }
</style>
