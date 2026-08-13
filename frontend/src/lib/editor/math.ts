import { Node, InputRule, mergeAttributes } from "@tiptap/core";
import type { Editor, NodeViewRendererProps } from "@tiptap/core";
import katex from "katex";
import type { MarkdownNodeSpec } from "tiptap-markdown";
import type MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token";
import type StateInline from "markdown-it/lib/rules_inline/state_inline";
import type StateBlock from "markdown-it/lib/rules_block/state_block";
import type { Node as ProseMirrorNode, ResolvedPos } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";

const KATEX_OPTIONS = { throwOnError: false, strict: false };

const focusNear = (editor: Editor, $pos: ResolvedPos): void => {
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near($pos)));
  editor.commands.focus();
};

function escLatex(latex: string): string {
  return latex.replace(/(^|[^\\])\$/g, "$1\\$");
}

const mathMd = new WeakSet<object>();

const escAttr = (s: string): string =>
  s.replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
  );

const mathInlineHtml = (tokens: Token[], idx: number): string => {
  const token = tokens[idx];

  return `<span data-type="inline-math" data-latex="${escAttr(token.attrGet("data-latex") ?? "")}"></span>`;
};

const mathBlockHtml = (tokens: Token[], idx: number): string => {
  const token = tokens[idx];

  return `<div data-type="block-math" data-latex="${escAttr(token.attrGet("data-latex") ?? "")}"></div>`;
};

const mathParseSetup = (md: MarkdownIt): void => {
  if (mathMd.has(md)) return;

  mathMd.add(md);
  md.inline.ruler.before("escape", "math_inline", mathInlineRule);
  md.block.ruler.before("paragraph", "math_block", mathBlockRule);
  md.renderer.rules.math_inline = mathInlineHtml;
  md.renderer.rules.math_block = mathBlockHtml;
};

function mathInlineRule(state: StateInline, silent: boolean): boolean {
  const src = state.src;
  const pos = state.pos;

  if (src.charCodeAt(pos) !== 0x24) return false;
  if (src.charCodeAt(pos + 1) === 0x24) return false;

  const next = src.charCodeAt(pos + 1);
  if (next === 0x20 || next === 0x09 || next === 0x0a || next === 0)
    return false;

  let content = "";
  let i = pos + 1;

  while (i < src.length) {
    const c = src.charCodeAt(i);

    if (c === 0x5c && src.charCodeAt(i + 1) === 0x24) {
      content += "\\$";
      i += 2;
      continue;
    }

    if (c === 0x24) {
      const prev = src.charCodeAt(i - 1);
      const after = src.charCodeAt(i + 1);

      if (prev === 0x20 || prev === 0x09 || (after >= 0x30 && after <= 0x39)) {
        content += "$";
        i += 1;
        continue;
      }

      if (content.length === 0) {
        i += 1;
        continue;
      }

      if (silent) return true;

      const token = state.push("math_inline", "span", 0);
      token.attrSet("data-type", "inline-math");
      token.attrSet("data-latex", content);
      state.pos = i + 1;

      return true;
    }

    if (c === 0x0a) return false;

    content += src[i];
    i += 1;
  }

  return false;
}

function mathBlockRule(
  state: StateBlock,
  startLine: number,
  endLine: number,
  silent: boolean,
): boolean {
  const start = state.bMarks[startLine] + state.tShift[startLine];
  const max = state.eMarks[startLine];
  const src = state.src;

  if (src.charCodeAt(start) !== 0x24 || src.charCodeAt(start + 1) !== 0x24)
    return false;

  const rest = src.slice(start + 2, max);
  const single = /^([\s\S]*?)\$\$\s*$/.exec(rest);

  if (single) {
    const content = single[1].trim();
    if (silent) return true;

    const token = state.push("math_block", "div", 0);
    token.block = true;
    token.attrSet("data-type", "block-math");
    token.attrSet("data-latex", content);
    state.line = startLine + 1;

    return true;
  }

  if (rest.trim() !== "") return false;
  if (silent) return true;

  for (let line = startLine + 1; line < endLine; line += 1) {
    const lineStart = state.bMarks[line] + state.tShift[line];
    const lineEnd = state.eMarks[line];

    if (
      src.slice(lineStart, lineStart + 2) === "$$" &&
      src.slice(lineStart + 2, lineEnd).trim() === ""
    ) {
      const content = src.slice(max + 1, lineStart).trim();
      if (silent) return true;

      const token = state.push("math_block", "div", 0);
      token.block = true;
      token.attrSet("data-type", "block-math");
      token.attrSet("data-latex", content);
      state.line = line + 1;

      return true;
    }
  }

  return false;
}

function mathNodeView(displayMode: boolean) {
  return ({ node, editor, getPos }: NodeViewRendererProps) => {
    const wrapper = document.createElement(displayMode ? "div" : "span");
    wrapper.className = displayMode ? "math math-block" : "math math-inline";
    wrapper.contentEditable = "false";

    const display = document.createElement("span");
    display.className = "math-display";

    const input = document.createElement("textarea");
    input.className = "math-input";
    input.spellcheck = false;
    input.rows = displayMode ? 3 : 1;

    wrapper.append(display, input);

    let alive = true;

    const render = () => {
      try {
        katex.render(node.attrs.latex, display, {
          ...KATEX_OPTIONS,
          displayMode,
        });
        display.classList.remove("math-error");
      } catch {
        display.textContent = node.attrs.latex;
        display.classList.add("math-error");
      }
    };

    const stop = () => {
      wrapper.classList.remove("math-editing");
      render();
    };

    const start = () => {
      if (!alive || !editor.isEditable) return;

      wrapper.classList.add("math-editing");
      input.value = node.attrs.latex;
      input.focus();
      input.select();
    };

    const commit = () => {
      if (!alive) return;

      const latex = input.value.trim();
      const pos = getPos();
      if (pos == null) return;

      if (latex === "") {
        const { doc } = editor.state;
        editor.view.dispatch(editor.state.tr.delete(pos, pos + node.nodeSize));
        focusNear(editor, doc.resolve(Math.min(pos, doc.content.size)));

        return;
      }

      if (latex !== node.attrs.latex) {
        editor.view.dispatch(
          editor.state.tr.setNodeMarkup(pos, undefined, { latex }),
        );
      }

      stop();
      focusNear(editor, editor.state.doc.resolve(pos));
    };

    const cancel = () => {
      if (!alive) return;

      stop();
      const pos = getPos();
      if (pos == null) return;

      focusNear(editor, editor.state.doc.resolve(pos));
    };

    wrapper.addEventListener("mousedown", (e) => {
      if (!editor.isEditable) return;

      e.preventDefault();
      e.stopPropagation();
      start();
    });

    input.addEventListener("mousedown", (e) => e.stopPropagation());
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();

      if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      } else if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        commit();
      }
    });
    input.addEventListener("blur", commit);

    if (node.attrs.latex === "" && editor.isEditable) setTimeout(start, 0);

    render();

    return {
      dom: wrapper,
      update(next: ProseMirrorNode) {
        if (next.attrs.latex !== node.attrs.latex) {
          node = next;
          render();
        }

        return true;
      },
      ignoreMutation: () => true,
      destroy() {
        alive = false;
        input.removeEventListener("blur", commit);
      },
    };
  };
}

const InlineMath = Node.create({
  name: "inlineMath",
  group: "inline",
  inline: true,
  atom: true,

  addAttributes() {
    return {
      latex: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-latex"),
        renderHTML: (attrs) => ({ "data-latex": attrs.latex }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="inline-math"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, { "data-type": "inline-math" }),
    ];
  },

  addInputRules() {
    return [
      new InputRule({
        find: /(?<!\$)(?<!\\)\$([^$\n]+)\$$/,
        handler: ({ state, range, match }) => {
          const latex = (match[1] ?? "").trim();
          if (!latex) return null;

          const node = state.schema.nodes.inlineMath.create({ latex });
          state.tr.replaceWith(range.from, range.to, node);
        },
      }),
    ];
  },

  addNodeView() {
    return mathNodeView(false);
  },

  addStorage() {
    return {
      markdown: {
        serialize(state, node) {
          state.write(`$${escLatex(node.attrs.latex)}$`);
        },
        parse: { setup: mathParseSetup },
      } satisfies MarkdownNodeSpec,
    };
  },
});

const BlockMath = Node.create({
  name: "blockMath",
  group: "block",
  atom: true,

  addAttributes() {
    return {
      latex: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-latex"),
        renderHTML: (attrs) => ({ "data-latex": attrs.latex }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="block-math"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "block-math" }),
    ];
  },

  addInputRules() {
    return [
      new InputRule({
        find: /^\$\$(?!\$)/,
        handler: ({ state, range }) => {
          const { tr } = state;
          const $cur = state.doc.resolve(range.to);
          const whole =
            $cur.parent.textBetween(0, $cur.parentOffset) === "$$" &&
            $cur.parentOffset === $cur.parent.content.size;
          const node = state.schema.nodes.blockMath.create({ latex: "" });

          if (whole && $cur.parent.type.name === "paragraph") {
            const $start = state.doc.resolve($cur.start());

            if (
              $start
                .node(-1)
                .canReplaceWith(
                  $start.index(-1),
                  $start.indexAfter(-1),
                  state.schema.nodes.blockMath,
                )
            ) {
              tr.replaceWith($start.before(), $start.after(), node);

              return;
            }
          }

          tr.replaceWith(range.from, range.to, node);
        },
      }),
    ];
  },

  addNodeView() {
    return mathNodeView(true);
  },

  addStorage() {
    return {
      markdown: {
        serialize(state, node) {
          const latex = escLatex(node.attrs.latex);

          state.write("$$\n");
          state.text(latex, false);
          state.ensureNewLine();
          state.write("$$");
          state.closeBlock(node);
        },
        parse: { setup: mathParseSetup },
      } satisfies MarkdownNodeSpec,
    };
  },
});

export { InlineMath, BlockMath };
