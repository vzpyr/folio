import { appState } from "../../app.svelte.ts";
import { parseFrontmatter } from "../editor/markdown.ts";
import { tauriHttpFetch } from "../util/tauri.ts";
import { aiConfig, chatState, uid, type ChatMessage } from "./state.svelte.ts";

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

interface WireMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
  tool_call_id?: string;
  name?: string;
}

interface SseChunk {
  error?: { message?: string };
  choices?: {
    delta?: {
      content?: string | null;
      tool_calls?: {
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }[];
    };
  }[];
}

const TOOLS = [
  {
    type: "function",
    function: {
      name: "search_notes",
      description:
        "Full-text search over the user's notes (titles and bodies). Returns ranked matches with title, folder and a matching excerpt. Use this before read_note.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: 'search keywords, e.g. "docker deployment"',
          },
          limit: {
            type: "number",
            description: "max results, default 6",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_note",
      description:
        "Read the full markdown content of a note. The id comes from search_notes results.",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "note id",
          },
        },
        required: ["id"],
      },
    },
  },
] as const;

const SYSTEM_PROMPT = [
  "You are a friendly and helpful note-taking assistant, built into folio (lowercase), a notes app.",
  "- Use search_notes to find relevant notes and read_note to read the most relevant ones before answering questions about the user's notes.",
  "- If a search returns nothing useful, say so instead of guessing.",
  "- Answer in plain text, in the user's language.",
  "- Provide direct, concise answers without unnecessary preambles.",
].join("\n");

function systemPrompt(): string {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

  return `${SYSTEM_PROMPT}\nThe current time/date is ${stamp}.`;
}

let controller: AbortController | null = null;

export function stopGeneration(): void {
  controller?.abort();
}

export async function sendMessage(text: string): Promise<void> {
  const content = text.trim();
  if (!content || chatState.busy) return;

  const msgs = chatState.messages;
  msgs.push({ id: uid(), role: "user", content });
  chatState.busy = true;

  let draftId = uid();
  msgs.push({ id: draftId, role: "assistant", content: "" });
  const wire = buildWire(draftId);
  controller = new AbortController();

  try {
    for (;;) {
      const turn = await streamTurn(wire, controller.signal, (full) => {
        const m = msgs.find((x) => x.id === draftId);
        if (m) m.content = full;
      });

      if (turn.aborted) {
        cleanupDraft(msgs, draftId);
        break;
      }

      const draft = msgs.find((x) => x.id === draftId);
      if (!draft) break;
      draft.toolCalls = turn.toolCalls;
      if (turn.content) draft.content = turn.content;
      wire.push(toWire(draft)!);

      if (turn.toolCalls.length === 0) break;

      for (const call of turn.toolCalls) {
        const out = await runTool(call);
        msgs.push({
          id: uid(),
          role: "tool",
          content: out.result,
          detail: out.detail,
          toolCallId: call.id,
          name: call.name,
        });
        wire.push({
          role: "tool",
          content: out.result,
          tool_call_id: call.id,
          name: call.name,
        });
      }

      if (controller.signal.aborted) break;

      draftId = uid();
      msgs.push({ id: draftId, role: "assistant", content: "" });
    }
  } catch (e) {
    if (chatState.messages === msgs) {
      chatState.messages = msgs.filter((x) => x.id !== draftId);
      chatState.messages.push({
        id: uid(),
        role: "error",
        content: e instanceof Error ? e.message : "request failed",
      });
    }
  } finally {
    chatState.busy = false;
    controller = null;
  }
}

function buildWire(draftId: string): WireMessage[] {
  const out: WireMessage[] = [{ role: "system", content: systemPrompt() }];

  for (const m of chatState.messages) {
    if (m.id === draftId || m.role === "error") continue;

    const w = toWire(m);
    if (w) out.push(w);
  }

  return out;
}

function toWire(m: ChatMessage): WireMessage | null {
  switch (m.role) {
    case "user":
      return { role: "user", content: m.content };
    case "assistant":
      return {
        role: "assistant",
        content: m.toolCalls?.length ? m.content || null : m.content,
        tool_calls: m.toolCalls?.length
          ? m.toolCalls.map((c) => ({
              id: c.id,
              type: "function",
              function: { name: c.name, arguments: c.arguments },
            }))
          : undefined,
      };
    case "tool":
      return {
        role: "tool",
        content: m.content,
        tool_call_id: m.toolCallId,
        name: m.name,
      };
    case "system":
      return { role: "system", content: m.content };
    case "error":
      return null;
  }
}

function cleanupDraft(msgs: ChatMessage[], draftId: string): void {
  const m = msgs.find((x) => x.id === draftId);
  if (!m) return;

  if (!m.content && !m.toolCalls?.length) {
    if (chatState.messages === msgs) {
      chatState.messages = msgs.filter((x) => x.id !== draftId);
    }
  } else {
    m.toolCalls = [];
  }
}

interface TurnResult {
  content: string;
  toolCalls: ToolCall[];
  aborted: boolean;
}

async function streamTurn(
  wire: WireMessage[],
  signal: AbortSignal,
  onContent: (full: string) => void,
): Promise<TurnResult> {
  const base = aiConfig.baseUrl.replace(/\/+$/, "");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (aiConfig.token) headers.Authorization = `Bearer ${aiConfig.token}`;

  let res: Response;
  try {
    res = await tauriHttpFetch(`${base}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: aiConfig.model,
        messages: wire,
        tools: TOOLS,
        stream: true,
      }),
      signal,
    });
  } catch (e) {
    if (signal.aborted) return { content: "", toolCalls: [], aborted: true };

    throw e;
  }

  if (!res.ok) throw new Error(await errorText(res));
  if (!res.body) throw new Error("no response body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const frags = new Map<number, { id: string; name: string; args: string }>();
  let content = "";
  let buf = "";

  const handle = (block: string): void => {
    for (const line of block.split("\n")) {
      if (!line.startsWith("data:")) continue;

      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") return;

      let json: SseChunk;
      try {
        json = JSON.parse(data) as SseChunk;
      } catch {
        return;
      }

      if (json.error) throw new Error(json.error.message ?? "provider error");

      const delta = json.choices?.[0]?.delta;
      if (!delta) return;

      if (typeof delta.content === "string" && delta.content) {
        content += delta.content;
        onContent(content);
      }

      if (delta.tool_calls) {
        for (const c of delta.tool_calls) {
          const i = c.index ?? 0;
          const f = frags.get(i) ?? { id: "", name: "", args: "" };

          if (c.id) f.id += c.id;
          if (c.function?.name) f.name += c.function.name;
          if (c.function?.arguments) f.args += c.function.arguments;

          frags.set(i, f);
        }
      }
    }
  };

  for (;;) {
    let value: Uint8Array | undefined;
    let done: boolean;

    try {
      ({ value, done } = await reader.read());
    } catch (e) {
      if (signal.aborted) break;

      throw e;
    }

    if (done) break;
    buf += decoder.decode(value, { stream: true });

    let idx: number;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      handle(buf.slice(0, idx));
      buf = buf.slice(idx + 2);
    }
  }
  if (buf.trim()) handle(buf.trim());

  const toolCalls: ToolCall[] = [...frags.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, f]) => ({ id: f.id, name: f.name, arguments: f.args }));

  return { content, toolCalls, aborted: signal.aborted };
}

interface ToolOutcome {
  result: string;
  detail: string;
}

async function runTool(call: ToolCall): Promise<ToolOutcome> {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(call.arguments) as Record<string, unknown>;
  } catch {}

  switch (call.name) {
    case "search_notes": {
      const index = appState.index;
      if (!index)
        return {
          result: "notes unavailable",
          detail: "search_notes: unavailable",
        };

      const query = String(args.query ?? "").trim();
      if (!query)
        return { result: "empty query", detail: "search_notes: empty query" };

      const limit = Math.min(Math.max(1, Number(args.limit) || 6), 10);
      const rows = index
        .search(query)
        .slice(0, limit)
        .map((h) => {
          const meta = index.getById(h.id);

          return {
            id: h.id,
            title: meta?.title ?? "",
            folder: meta?.folder ?? "",
            excerpt: h.snippet
              ? h.snippet.before + h.snippet.match + h.snippet.after
              : "",
          };
        });

      return {
        result: rows.length ? JSON.stringify(rows) : "no notes matched",
        detail: `"${query}" → ${rows.length ? `${rows.length} match${rows.length === 1 ? "" : "es"}` : "no matches"}`,
      };
    }
    case "read_note": {
      const id = String(args.id ?? "").trim();
      const index = appState.index;
      const store = appState.store;
      const meta = index?.getById(id);
      const raw = store ? await store.readNote(id) : null;

      if (!raw)
        return { result: "note not found", detail: "read_note: not found" };

      const { meta: fm, body } = parseFrontmatter(raw);
      const title = meta?.title ?? fm.title ?? id;

      return {
        result: `# ${title}\n\n${body.slice(0, 8000)}`,
        detail: title,
      };
    }
    default:
      return { result: "unknown tool", detail: `unknown tool: ${call.name}` };
  }
}

async function errorText(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  let detail = text.slice(0, 300);

  try {
    const j = JSON.parse(text) as {
      error?: { message?: string };
      message?: string;
    };
    detail = j.error?.message ?? j.message ?? detail;
  } catch {}

  return `${res.status}: ${detail}`;
}
