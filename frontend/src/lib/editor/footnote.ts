import { Node } from "@tiptap/core";
import type { MarkdownNodeSpec } from "tiptap-markdown";
import { TextSelection } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/core";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    insertFootnote: {
      insertFootnote: () => ReturnType;
    };
  }
}

const REF_RE = /^\[\^([^\s\]]+)\]/;
const DEF_RE = /^\[\^([^\s\]]+)\]:[ \t]?(.*)$/;

function footnoteRefRule(state: any, silent: boolean): boolean {
  const start = state.pos;
  if (state.src.charCodeAt(start) !== 0x5b) return false;

  const match = REF_RE.exec(state.src.slice(start));
  if (!match) return false;
  if (silent) return true;

  const token = state.push("footnote_ref", "", 0);
  token.meta = { label: match[1] };
  state.pos = start + match[0].length;

  return true;
}

function footnoteDefRule(
  state: any,
  startLine: number,
  endLine: number,
  silent: boolean,
): boolean {
  const start = state.bMarks[startLine] + state.tShift[startLine];
  const max = state.eMarks[startLine];
  const match = DEF_RE.exec(state.src.slice(start, max));
  if (!match) return false;
  if (silent) return true;

  const lines = [match[2]];
  let nextLine = startLine + 1;

  while (nextLine < endLine) {
    if (state.tShift[nextLine] < 4 && !state.isEmpty(nextLine)) break;
    lines.push(
      state.src.slice(
        state.bMarks[nextLine] + state.tShift[nextLine],
        state.eMarks[nextLine],
      ),
    );
    nextLine++;
  }

  const token = state.push("footnote_def", "", 0);
  token.meta = { label: match[1], content: lines.join("\n") };
  state.line = nextLine;

  return true;
}

export function footnotePlugin(md: any): void {
  if (md.__folioFootnote) return;
  md.__folioFootnote = true;

  md.inline.ruler.after("escape", "footnote_ref", footnoteRefRule);
  md.block.ruler.before("reference", "footnote_def", footnoteDefRule);

  md.renderer.rules.footnote_ref = (tokens: any[], idx: number) => {
    const label = md.utils.escapeHtml(tokens[idx].meta.label);

    return (
      `<sup class="footnote-ref" data-label="${label}">` +
      `<a href="#fn-${label}">[${label}]</a></sup>`
    );
  };

  md.renderer.rules.footnote_def = (tokens: any[], idx: number) => {
    const label = md.utils.escapeHtml(tokens[idx].meta.label);
    const html = md.renderInline(tokens[idx].meta.content);

    return (
      `<div class="footnote-def" data-label="${label}" id="fn-${label}">` +
      `${html}</div>`
    );
  };
}

export const FootnoteRef = Node.create({
  name: "footnoteRef",
  group: "inline",
  inline: true,
  atom: true,

  addAttributes() {
    return {
      label: { default: "" },
    };
  },

  parseHTML() {
    return [
      {
        tag: "sup.footnote-ref",
        getAttrs: (el) => {
          const label =
            el.getAttribute("data-label") ||
            (el.textContent || "").replace(/[[\]]/g, "").trim();

          return label ? { label } : false;
        },
      },
    ];
  },

  renderHTML({ node }) {
    return [
      "sup",
      { class: "footnote-ref", "data-label": node.attrs.label },
      `[${node.attrs.label}]`,
    ];
  },

  addCommands() {
    return {
      insertFootnote:
        () =>
        ({ state, tr, dispatch }): boolean => {
          const refType = state.schema.nodes.footnoteRef;
          const defType = state.schema.nodes.footnoteDef;
          if (!refType || !defType) return false;

          const label = nextFootnoteLabel(state.doc);
          const { from, to, empty } = state.selection;
          const selectedText = empty
            ? ""
            : state.doc.textBetween(from, to, "\n");

          let next = tr;
          if (!empty) next = next.delete(from, to);

          next = next.insert(
            next.mapping.map(from),
            refType.create({ label }),
          );

          const defNode = defType.create(
            { label },
            selectedText ? state.schema.text(selectedText) : undefined,
          );
          const defAt = next.doc.content.size;
          next = next.insert(defAt, defNode);
          next = next.setSelection(
            TextSelection.near(next.doc.resolve(defAt + 1)),
          );

          if (dispatch) dispatch(next);

          return true;
        },
    };
  },

  addStorage() {
    return {
      markdown: {
        serialize(
          state: { write(s: string): void },
          node: { attrs: { label?: string } },
        ) {
          state.write(`[^${node.attrs.label}]`);
        },
        parse: {
          setup(md: unknown) {
            footnotePlugin(md);
          },
        },
      } satisfies MarkdownNodeSpec,
    };
  },
});

export const FootnoteDef = Node.create({
  name: "footnoteDef",
  group: "block",
  content: "inline*",
  defining: true,

  addAttributes() {
    return {
      label: { default: "" },
    };
  },

  parseHTML() {
    return [
      {
        tag: "div.footnote-def",
        getAttrs: (el) => {
          const label = el.getAttribute("data-label") || "";

          return label ? { label } : false;
        },
      },
    ];
  },

  renderHTML({ node }) {
    return ["div", { class: "footnote-def", "data-label": node.attrs.label }, 0];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: { attrs: { label?: string } }) {
          state.write(`[^${node.attrs.label}]: `);
          state.renderInline(node);
          state.closeBlock(node);
        },
      } satisfies MarkdownNodeSpec,
    };
  },
});

function nextFootnoteLabel(doc: {
  descendants(fn: (n: any, pos: number) => boolean | void): void;
}): string {
  let max = 0;

  doc.descendants((node) => {
    if (node.type.name === "footnoteDef" && /^\d+$/.test(node.attrs.label)) {
      max = Math.max(max, parseInt(node.attrs.label, 10));
    }
  });

  return String(max + 1);
}

export function jumpToFootnoteDef(editor: Editor, label: string): void {
  const { state, view } = editor;
  let found = -1;

  state.doc.descendants((node, pos) => {
    if (
      found === -1 &&
      node.type.name === "footnoteDef" &&
      node.attrs.label === label
    ) {
      found = pos;

      return false;
    }

    return true;
  });

  if (found === -1) return;

  const dom = view.domAtPos(found + 1).node as HTMLElement | null;
  const defEl = dom?.closest(".footnote-def") as HTMLElement | null;

  if (defEl) {
    defEl.scrollIntoView?.({ behavior: "smooth", block: "center" });
    defEl.classList.add("footnote-def-flash");
    setTimeout(() => defEl.classList.remove("footnote-def-flash"), 1600);
  }
}
