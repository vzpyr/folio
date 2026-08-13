import { Node, mergeAttributes } from "@tiptap/core";
import type { NodeViewRendererProps } from "@tiptap/core";
import type { MarkdownNodeSpec } from "tiptap-markdown";
import type MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token";
import type StateBlock from "markdown-it/lib/rules_block/state_block";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Fragment, Slice } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import type { ViewMutationRecord } from "@tiptap/pm/view";

export interface CalloutKind {
  kind: string;
  icon: string;
  label: string;
}

export const CALLOUT_KINDS: CalloutKind[] = [
  { kind: "note", icon: "💡", label: "note" },
  { kind: "info", icon: "ℹ️", label: "info" },
  { kind: "tip", icon: "🔥", label: "tip" },
  { kind: "warning", icon: "⚠️", label: "warning" },
  { kind: "danger", icon: "🛑", label: "danger" },
  { kind: "question", icon: "❓", label: "question" },
];

const DEFAULT_KIND = "note";
const DEFAULT_ICON = "💡";

const kindEntry = (kind: string): CalloutKind =>
  CALLOUT_KINDS.find((k) => k.kind === kind) ?? CALLOUT_KINDS[0];

const iconFor = (kind: string, icon: string | null | undefined): string =>
  icon?.trim() || kindEntry(kind).icon;

const escHtml = (s: string): string =>
  s.replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
  );

const MARKER_RE = /^>\s*\[!([a-zA-Z0-9_-]+)\]\s*(.*)$/;
const EMOJI_RE = /^\p{Extended_Pictographic}$/u;

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    insertCallout: {
      insertCallout: (attrs?: { kind?: string; icon?: string }) => ReturnType;
    };
  }
}

function calloutRule(
  state: StateBlock,
  startLine: number,
  endLine: number,
  silent: boolean,
): boolean {
  const start = state.bMarks[startLine] + state.tShift[startLine];
  const max = state.eMarks[startLine];
  const first = state.src.slice(start, max);
  const m = MARKER_RE.exec(first);
  if (!m) return false;
  if (silent) return true;

  const icon = m[2].trim();
  const body: string[] = [];
  let nextLine = startLine + 1;

  while (nextLine < endLine) {
    const ls = state.bMarks[nextLine] + state.tShift[nextLine];
    const le = state.eMarks[nextLine];
    if (le <= ls || state.src.charCodeAt(ls) !== 0x3e) break;
    body.push(state.src.slice(ls + 1, le).replace(/^[ \t]?/, ""));
    nextLine += 1;
  }

  const token = state.push("callout", "div", 0);
  token.block = true;
  token.meta = {
    kind: m[1],
    icon: EMOJI_RE.test(icon) ? icon : "",
    content: body.join("\n"),
  };
  state.line = nextLine;

  return true;
}

function calloutParseSetup(md: MarkdownIt): void {
  const anyMd = md as unknown as { __folioCallout?: boolean };
  if (anyMd.__folioCallout) return;
  anyMd.__folioCallout = true;

  md.block.ruler.before("blockquote", "callout", calloutRule);

  md.renderer.rules.callout = (tokens: Token[], idx: number) => {
    const meta = tokens[idx].meta as {
      kind: string;
      icon: string;
      content: string;
    };
    const kind = escHtml(meta.kind);
    const icon = escHtml(meta.icon || iconFor(meta.kind, ""));
    const inner = md.render(meta.content ?? "");
    const body = inner.trim() ? inner : "<p></p>";

    return `<div data-type="callout" data-kind="${kind}" data-icon="${icon}">${body}</div>`;
  };
}

function calloutView({ node, editor, getPos }: NodeViewRendererProps) {
  const wrapper = document.createElement("div");
  wrapper.className = `callout callout-${node.attrs.kind || DEFAULT_KIND}`;

  const iconEl = document.createElement("span");
  iconEl.className = "callout-icon";
  iconEl.contentEditable = "false";
  iconEl.textContent = iconFor(node.attrs.kind, node.attrs.icon);

  const body = document.createElement("div");
  body.className = "callout-body";

  const menu = document.createElement("div");
  menu.className = "callout-menu";
  menu.style.display = "none";
  menu.contentEditable = "false";

  for (const entry of CALLOUT_KINDS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "callout-opt";
    btn.innerHTML = `<span class="callout-opt-icon">${entry.icon}</span><span class="callout-opt-label">${entry.label}</span>`;
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", () => {
      const pos = getPos();
      if (pos == null || pos < 0) return;
      editor.view.dispatch(
        editor.state.tr.setNodeMarkup(pos, undefined, {
          kind: entry.kind,
          icon: entry.icon,
        }),
      );
      hide();
      editor.commands.focus();
    });
    menu.appendChild(btn);
  }

  wrapper.append(iconEl, body, menu);

  const onDocDown = (e: PointerEvent) => {
    const t = e.target as globalThis.Node | null;
    if (t && !menu.contains(t) && !iconEl.contains(t)) hide();
  };

  function hide(): void {
    menu.style.display = "none";
    document.removeEventListener("pointerdown", onDocDown, true);
  }

  function toggle(): void {
    if (menu.style.display === "none") {
      menu.style.display = "flex";
      document.addEventListener("pointerdown", onDocDown, true);
    } else {
      hide();
    }
  }

  iconEl.addEventListener("mousedown", (e) => {
    if (!editor.isEditable) return;
    e.preventDefault();
    e.stopPropagation();
    toggle();
  });

  return {
    dom: wrapper,
    contentDOM: body,
    update(updated: PMNode) {
      if (updated.type !== node.type) return false;
      if (updated.attrs.kind !== node.attrs.kind) {
        wrapper.className = `callout callout-${updated.attrs.kind || DEFAULT_KIND}`;
      }
      if (
        updated.attrs.kind !== node.attrs.kind ||
        updated.attrs.icon !== node.attrs.icon
      ) {
        iconEl.textContent = iconFor(updated.attrs.kind, updated.attrs.icon);
      }
      node = updated;

      return true;
    },
    ignoreMutation(mutation: ViewMutationRecord) {
      return !body.contains(mutation.target);
    },
    destroy() {
      document.removeEventListener("pointerdown", onDocDown, true);
    },
  };
}

export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      kind: {
        default: DEFAULT_KIND,
        parseHTML: (el) =>
          (el as HTMLElement).getAttribute("data-kind") || DEFAULT_KIND,
        renderHTML: (attrs) => ({ "data-kind": attrs.kind || DEFAULT_KIND }),
      },
      icon: {
        default: DEFAULT_ICON,
        parseHTML: (el) => {
          const element = el as HTMLElement;

          return iconFor(
            element.getAttribute("data-kind") || DEFAULT_KIND,
            element.getAttribute("data-icon"),
          );
        },
        renderHTML: (attrs) => ({
          "data-icon": iconFor(attrs.kind, attrs.icon),
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "callout",
        class: `callout callout-${node.attrs.kind || DEFAULT_KIND}`,
      }),
      0,
    ];
  },

  addCommands() {
    return {
      insertCallout:
        (attrs) =>
        ({ tr, state, dispatch }) => {
          const type = state.schema.nodes.callout;
          if (!type) return false;

          const kind = attrs?.kind || DEFAULT_KIND;
          const node = type.create(
            { kind, icon: iconFor(kind, attrs?.icon) },
            state.schema.nodes.paragraph.create(),
          );
          const { from, to } = state.selection;
          let target = { from, to };

          if (from === to) {
            const $pos = state.doc.resolve(from);

            if ($pos.parent.type.name === "paragraph") {
              const parent = $pos.parent;
              const isEmpty =
                parent.childCount === 0 && parent.textContent === "";

              if (isEmpty) {
                const $start = state.doc.resolve($pos.start());

                target = { from: $start.before(), to: $start.after() };
              }
            }
          }

          if (dispatch) {
            tr.replace(
              target.from,
              target.to,
              new Slice(Fragment.from(node), 0, 0),
            );
            tr.setSelection(
              TextSelection.near(tr.doc.resolve(target.from + 1)),
            );
            dispatch(tr);
          }

          return true;
        },
    };
  },

  addNodeView() {
    return calloutView;
  },

  addStorage() {
    return {
      markdown: {
        serialize(state, node: PMNode) {
          const kind = node.attrs.kind || DEFAULT_KIND;
          const icon = iconFor(kind, node.attrs.icon);

          state.write(`> [!${kind}] ${icon}\n`);
          state.wrapBlock("> ", null, node, () => state.renderContent(node));
        },
        parse: { setup: calloutParseSetup },
      } satisfies MarkdownNodeSpec,
    };
  },
});
