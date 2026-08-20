<script lang="ts">
  import { chatState, closeChat, clearChat } from "../ai/state.svelte.ts";
  import { sendMessage, stopGeneration } from "../ai/chat.ts";
  import Icon from "./Icon.svelte";

  let input = $state("");
  let inputEl = $state<HTMLTextAreaElement | null>(null);
  let scrollEl = $state<HTMLDivElement | null>(null);

  $effect(() => {
    if (!chatState.open) return;

    requestAnimationFrame(() => inputEl?.focus());
  });

  $effect(() => {
    const el = scrollEl;
    if (!el) return;

    for (const m of chatState.messages) {
      void m.content;
    }

    el.scrollTop = el.scrollHeight;
  });

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      if (chatState.busy) stopGeneration();

      return;
    }

    if (e.key === "Enter" && !e.shiftKey && !chatState.busy) {
      e.preventDefault();
      send();
    }
  }

  function send() {
    if (chatState.busy) {
      stopGeneration();

      return;
    }

    const text = input;
    if (!text.trim()) return;

    input = "";
    void sendMessage(text);
  }

  function close() {
    closeChat();
    stopGeneration();
  }
</script>

{#if chatState.open}
  <div class="overlay" role="dialog" aria-modal="true" aria-label="ask your notes">
    <div class="modal">
      <div class="header">
        <span class="title">ask your notes</span>
        <button class="btn-close" onclick={close} title="close"
          ><Icon name="x" size={16} /></button
        >
      </div>
      <div class="chat" bind:this={scrollEl}>
        {#if chatState.messages.length === 0}
          <div class="empty">ask anything about your notes…</div>
        {:else}
          {#each chatState.messages as m (m.id)}
            {#if m.role === "user"}
              <div class="msg user">
                <div class="msg-label">you</div>
                <div class="msg-content">{m.content}</div>
              </div>
            {:else if m.role === "assistant"}
              {#if m.content || !m.toolCalls?.length}
                <div class="msg assistant">
                  <div class="msg-label">assistant</div>
                  <div class="msg-content">{m.content || "…"}</div>
                </div>
              {/if}
            {:else if m.role === "tool" || m.role === "system"}
              <div class="msg tool">
                <div class="msg-label">{m.name ?? m.role}</div>
                <div class="msg-content">{m.detail ?? m.content}</div>
              </div>
            {:else}
              <div class="msg error">{m.content}</div>
            {/if}
          {/each}
        {/if}
      </div>
      <div class="composer">
        <textarea
          class="input"
          bind:this={inputEl}
          bind:value={input}
          placeholder="ask about your notes…"
          onkeydown={onKeydown}
        ></textarea>
        <div class="actions">
          <button
            class="btn-clear"
            onclick={() => {
              stopGeneration();
              clearChat();
            }}
            title="clear chat"
          >
            <Icon name="broom" size={16} />
          </button>
          <button
            class="btn-send"
            onclick={send}
            title={chatState.busy ? "stop" : "send"}
            disabled={!chatState.busy && !input.trim()}
          >
            {#if chatState.busy}
              <Icon name="square" size={16} />
            {:else}
              <Icon name="send" size={16} />
            {/if}
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

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
    width: min(var(--maxw-chat), calc(100vw - var(--s4) * 2));
    height: min(70vh, calc(100vh - var(--s4) * 2));
    display: flex;
    flex-direction: column;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
    box-shadow: 0 16px 48px rgb(0 0 0 / 0.24);
    padding: var(--pad-lg);
    gap: var(--gap-lg);
    animation: modalContentEnter 0.22s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
  }

  .title {
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

  .chat {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--bg-2);
    padding: var(--pad-sm);
  }

  .empty {
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--fg-3);
    font-size: var(--fs-base);
    text-transform: lowercase;
  }

  .msg {
    padding: var(--pad-md);
  }

  .msg + .msg {
    border-top: 1px solid var(--border);
  }

  .msg-label {
    font-size: var(--fs-xs);
    color: var(--fg-3);
    margin-bottom: var(--s1);
    text-transform: lowercase;
  }

  .msg-content {
    font-size: var(--fs-base);
    color: var(--fg);
    white-space: pre-wrap;
    overflow-wrap: break-word;
    line-height: 1.45;
  }

  .msg.tool .msg-content {
    font-size: var(--fs-sm);
    color: var(--fg-3);
  }

  .msg.error {
    font-size: var(--fs-sm);
    color: var(--fg-2);
  }

  .composer {
    display: flex;
    align-items: flex-end;
    gap: var(--gap);
    flex-shrink: 0;
  }

  .actions {
    display: flex;
    flex-direction: column;
    gap: var(--gap);
    flex-shrink: 0;
  }

  .btn-clear {
    width: var(--ctl-h);
    height: var(--ctl-h);
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--bg-2);
    color: var(--fg-3);
  }

  .btn-clear:hover {
    border-color: var(--border-strong);
    color: var(--fg);
  }

  .input {
    flex: 1;
    height: calc(var(--ctl-h) * 2 + var(--gap));
    resize: none;
    padding: var(--pad-sm) var(--ctl-px);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--bg-2);
    color: var(--fg);
    font-size: var(--fs-base);
    font-family: var(--font);
    line-height: 1.45;
  }

  .input:focus {
    outline: var(--focus-ring);
    outline-offset: -1px;
    border-color: var(--border-strong);
  }

  .btn-send {
    width: var(--ctl-h);
    height: var(--ctl-h);
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--bg-2);
    color: var(--fg-2);
  }

  .btn-send:hover {
    border-color: var(--border-strong);
    color: var(--fg);
  }

  .btn-send:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
