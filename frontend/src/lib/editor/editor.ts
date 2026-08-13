import { Editor, Node, InputRule, Extension } from "@tiptap/core";
import { findWrapping } from "@tiptap/pm/transform";
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
import Placeholder from "@tiptap/extension-placeholder";
import FloatingMenu from "@tiptap/extension-floating-menu";
import { Markdown } from "tiptap-markdown";
import type { MarkdownMarkSpec, MarkdownNodeSpec } from "tiptap-markdown";
import { TextSelection, Plugin, PluginKey } from "@tiptap/pm/state";
import { DOMParser } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { mount } from "svelte";
import { handlePaste, handleDrop, uploadFile } from "./attachments.ts";
import { FootnoteRef, FootnoteDef, jumpToFootnoteDef } from "./footnote.ts";
import { InlineMath, BlockMath } from "./math.ts";
import { SlashCommand } from "./slash.ts";
import FloatingBar from "../components/FloatingBar.svelte";
import { formatBytes } from "../util/format.ts";
import type { VaultStore, NoteIndex } from "../store/store.svelte.ts";

const HREF_RE = /^([a-z][a-z0-9+.-]*):/i;

export function isSafeHref(href: string): boolean {
  const m = HREF_RE.exec(href);
  if (!m) return true;

  const scheme = m[1].toLowerCase();

  return (
    scheme === "http" ||
    scheme === "https" ||
    scheme === "mailto" ||
    scheme === "blob"
  );
}

const TightBulletList = BulletList.extend({
  parseHTML() {
    return [{ tag: "ul", getAttrs: () => ({ tight: true }) }];
  },
});

const TightOrderedList = OrderedList.extend({
  parseHTML() {
    return [{ tag: "ol", getAttrs: () => ({ tight: true }) }];
  },
});

const TightTaskList = TaskList.extend({
  addInputRules() {
    return [taskListInputRule];
  },
  addAttributes() {
    return {
      tight: {
        default: false,
        renderHTML: () => false,
      },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'ul[data-type="taskList"]',
        getAttrs: () => ({ tight: true }),
        priority: 51,
      },
      {
        tag: "ul.contains-task-list",
        getAttrs: () => ({ tight: true }),
        priority: 51,
      },
    ];
  },
});

const MarkdownPaste = Extension.create({
  name: "markdownPaste",
  addProseMirrorPlugins() {
    const { editor } = this;

    return [
      new Plugin({
        key: new PluginKey("markdownPaste"),
        props: {
          handlePaste(view, event) {
            const input = view as EditorView & {
              input: { shiftKey: boolean };
            };

            if (input.input.shiftKey) return false;
            if (view.state.selection.$from.parent.type.spec.code) return false;

            let text = event.clipboardData?.getData("text/plain") ?? "";

            if (!text.trim()) {
              const htmlData =
                event.clipboardData?.getData("text/html") ?? "";

              if (htmlData.trim()) {
                text =
                  new globalThis.DOMParser().parseFromString(
                    htmlData,
                    "text/html",
                  ).body?.textContent ?? "";
              }
            }

            if (!text.trim()) return false;

            const storage = editor.storage as unknown as {
              markdown: {
                parser: {
                  parse(
                    text: string,
                    options?: { inline?: boolean },
                  ): string;
                };
              };
            };
            const html = storage.markdown.parser.parse(text, {
              inline: true,
            });
            const el = document.createElement("div");

            el.innerHTML = html;

            if (
              !el.querySelector(
                "a, strong, em, s, u, code, h1, h2, h3, h4, h5, h6, ul, ol, li, blockquote, pre, table, img",
              )
            ) {
              return false;
            }

            const slice = DOMParser.fromSchema(view.state.schema).parseSlice(
              el,
              { preserveWhitespace: true },
            );

            view.dispatch(
              view.state.tr
                .replaceSelection(slice)
                .scrollIntoView()
                .setMeta("paste", true)
                .setMeta("uiEvent", "paste"),
            );

            return true;
          },
        },
      }),
    ];
  },
});

const linkInputRule = new InputRule({
  find: /\[([^\]]+)\]\(([^)\s]+)\)$/,
  handler: ({ state, range, match }) => {
    const url = match[2].trim();

    if (!isSafeHref(url)) return null;

    const { tr } = state;
    const textEnd = range.from + 1 + match[1].length;

    tr.delete(textEnd, range.to);
    tr.delete(range.from, range.from + 1);
    tr.addMark(
      range.from,
      textEnd,
      state.schema.marks.link.create({ href: url }),
    );
  },
});

const taskListInputRule = new InputRule({
  find: /^\s*([-+*])\s\[([ xX])\]\s$/,
  handler: ({ state, range, match }) => {
    const checked = match[2].toLowerCase() === "x";
    const tr = state.tr.delete(range.from, range.to);
    const $start = tr.doc.resolve(range.from);
    const blockRange = $start.blockRange();
    const wrapping =
      blockRange && findWrapping(blockRange, state.schema.nodes.taskList);
    if (!wrapping) return null;

    tr.wrap(blockRange, wrapping);

    let itemPos: number | null = null;
    tr.doc.nodesBetween(range.from, tr.doc.content.size, (node, pos) => {
      if (itemPos === null && node.type.name === "taskItem") {
        itemPos = pos;

        return false;
      }

      return true;
    });
    if (itemPos !== null) tr.setNodeMarkup(itemPos, undefined, { checked });
  },
});

const UnderlineMark = Underline.extend({
  addStorage() {
    return {
      markdown: {
        serialize: {
          open: () => "<u>",
          close: () => "</u>",
        },
      } satisfies MarkdownMarkSpec,
    };
  },
});

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
        renderHTML: (attrs) =>
          attrs.width ? { width: String(attrs.width) } : {},
      },
      title: {
        default: null,
        parseHTML: (el) => el.getAttribute("title") || null,
        renderHTML: (attrs) => (attrs.title ? { title: attrs.title } : {}),
      },
    };
  },
  addStorage() {
    return {
      markdown: {
        serialize(
          state: { write(s: string): void; esc(s: string): string },
          node: {
            attrs: {
              alt?: string;
              ref?: string | null;
              src?: string;
              width?: number | null;
              title?: string | null;
            };
          },
        ) {
          const src = node.attrs.ref || node.attrs.src || "";
          const alt = (node.attrs.alt || "").replace(/"/g, "&quot;");
          const title = node.attrs.title
            ? ` title="${String(node.attrs.title).replace(/"/g, "&quot;")}"`
            : "";
          const titleMd = node.attrs.title
            ? ` "${String(node.attrs.title).replace(/"/g, "&quot;")}"`
            : "";

          if (node.attrs.width) {
            state.write(
              `<img src="${src}" width="${node.attrs.width}" alt="${alt}"${title}>`,
            );

            return;
          }

          state.write(
            `![${state.esc(alt)}](${src.replace(/[()]/g, "\\$&")}${titleMd})`,
          );
        },
      } satisfies MarkdownNodeSpec,
    };
  },
});

const FileChip = Node.create({
  name: "fileChip",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return {
      name: { default: "file" },
      ref: { default: null },
      size: { default: null },
      mime: { default: null },
    };
  },

  parseHTML() {
    return [
      {
        tag: "span.file-chip",
        priority: 100,
        getAttrs: (el) => {
          const s = el as HTMLElement;

          return {
            ref: s.getAttribute("data-ref") || null,
            name: s.getAttribute("data-name") || "file",
            size: s.getAttribute("data-size")
              ? Number(s.getAttribute("data-size")) || null
              : null,
            mime: s.getAttribute("data-mime") || null,
          };
        },
      },
      {
        tag: 'a[href^="assets/"]',
        priority: 100,
        getAttrs: (el) => {
          const a = el as HTMLAnchorElement;
          const title = a.getAttribute("title") || "";
          const [sizeStr, mime] = title.split(",").map((s) => s.trim());
          const size =
            sizeStr && /^\d+$/.test(sizeStr) ? Number(sizeStr) : null;

          return {
            ref: a.getAttribute("href") || null,
            name: a.textContent || "file",
            size,
            mime: mime || null,
          };
        },
      },
    ];
  },

  renderHTML({ node }) {
    const { name, ref, size, mime } = node.attrs;
    const meta: string[] = [];

    if (size != null) meta.push(formatBytes(size));
    if (mime) meta.push(mime);

    return [
      "span",
      {
        class: "file-chip",
        "data-ref": ref || "",
        "data-name": name || "file",
        "data-size": size ?? "",
        "data-mime": mime || "",
      },
      ["span", { class: "file-chip-name" }, name || "file"],
      ...(meta.length
        ? [["span", { class: "file-chip-meta" }, `(${meta.join(", ")})`]]
        : []),
    ];
  },

  addStorage() {
    return {
      markdown: {
        serialize(
          state: { write(s: string): void },
          node: {
            attrs: {
              name?: string | null;
              ref?: string | null;
              size?: number | null;
              mime?: string | null;
            };
          },
        ) {
          const ref = (node.attrs.ref || "").replace(/[()]/g, "\\$&");
          const name = (node.attrs.name || "file").replace(/[[\]()]/g, "\\$&");
          const meta = [node.attrs.size, node.attrs.mime]
            .filter((v) => v != null && v !== "")
            .join(", ");

          state.write(`[${name}](${ref}${meta ? ` \"${meta}\"` : ""})`);
        },
      } satisfies MarkdownNodeSpec,
    };
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    insertWikiLink: {
      insertWikiLink: (target: string, alias?: string) => ReturnType;
    };
  }
}

const WikiLink = Node.create({
  name: "wikiLink",
  group: "inline",
  inline: true,
  content: "text*",

  addAttributes() {
    return {
      target: { default: null },
      alias: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: "a.wiki-link" }];
  },

  renderHTML({ node }) {
    const target = node.attrs.target ?? "";

    return [
      "a",
      {
        class: "wiki-link",
        href: `#/note/${encodeURIComponent(target)}`,
        "data-wiki": target,
      },
      0,
    ];
  },

  addCommands() {
    return {
      insertWikiLink:
        (target: string, alias?: string) =>
        ({
          tr,
          state,
          dispatch,
        }: {
          tr: Transaction;
          state: EditorState;
          dispatch?: (tr: Transaction) => void;
        }) => {
          const { from, to } = state.selection;
          const text = alias || target;
          const node = state.schema.nodes.wikiLink.create(
            { target, alias: alias || null },
            state.schema.text(text),
          );

          if (dispatch) {
            tr.replaceWith(from, to, node);
            tr.setSelection(
              TextSelection.near(tr.doc.resolve(from + text.length)),
            );
            dispatch(tr);
          }

          return true;
        },
    };
  },

  addStorage() {
    return {
      markdown: {
        serialize(
          state: { write(s: string): void },
          node: {
            textContent: string;
            attrs: { target?: string | null; alias?: string | null };
          },
        ) {
          const text = node.textContent;
          const { target, alias } = node.attrs;

          if (alias) state.write(`[[${target ?? ""}|${text}]]`);
          else state.write(`[[${text}]]`);
        },
      } satisfies MarkdownNodeSpec,
    };
  },
});

const WIKI_RE = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g;

export function applyWikiLinks(editor: Editor): void {
  const { state, view } = editor;
  const jobs: {
    from: number;
    to: number;
    target: string;
    alias: string | null;
  }[] = [];

  state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;

    const parent = state.doc.resolve(pos).parent;
    if (parent.type.name === "codeBlock") return;
    if (node.marks.some((m) => m.type.name === "code")) return;

    let m: RegExpExecArray | null;

    while ((m = WIKI_RE.exec(node.text)) !== null) {
      const from = pos + m.index;
      const to = from + m[0].length;

      jobs.push({ from, to, target: m[1].trim(), alias: m[2]?.trim() ?? null });
    }
  });

  if (jobs.length === 0) return;

  const tr = state.tr;

  for (const job of jobs.sort((a, b) => b.from - a.from)) {
    const text = job.alias ?? job.target;
    const node = state.schema.nodes.wikiLink.create(
      { target: job.target, alias: job.alias },
      state.schema.text(text),
    );

    tr.replaceWith(job.from, job.to, node);
  }

  view.dispatch(tr);
}

async function resolveImages(
  editor: Editor,
  resolveAttachment?: (ref: string) => Promise<string | null>,
): Promise<void> {
  if (!resolveAttachment) return;

  const { state } = editor;
  const jobs: { pos: number; ref: string }[] = [];

  state.doc.descendants((node, pos) => {
    if (node.type.name === "image" && node.attrs.ref)
      jobs.push({ pos, ref: node.attrs.ref });
  });

  for (const job of jobs) {
    const url = await resolveAttachment(job.ref);

    if (!url || editor.isDestroyed) continue;

    const node = editor.state.doc.nodeAt(job.pos);
    if (!node || node.type.name !== "image") continue;

    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(job.pos, undefined, {
        ...node.attrs,
        src: url,
      }),
    );
  }
}

function toggleTaskAt(view: EditorView, pos: number): void {
  const $pos = view.state.doc.resolve(pos);
  let depth = $pos.depth;

  while (depth > 0) {
    const node = $pos.node(depth);

    if (node.type.name === "taskItem") {
      const nodePos = $pos.before(depth);

      view.dispatch(
        view.state.tr.setNodeMarkup(nodePos, undefined, {
          ...node.attrs,
          checked: !node.attrs.checked,
        }),
      );

      return;
    }

    depth--;
  }
}

export interface EditorOptions {
  body: string;
  store: VaultStore;
  index: NoteIndex;
  resolveAttachment?: (ref: string) => Promise<string | null>;
  onDocChange?: () => void;
  onToast?: (msg: string) => void;
  onWikiClick?: (target: string) => void;
  onFileChipClick?: (ref: string, name: string, mime?: string | null) => void;
}

export function createEditor(parent: HTMLElement, opts: EditorOptions): Editor {
  const noop = () => {};
  const floatEl = document.createElement("div");
  const editor: Editor = new Editor({
    element: parent,
    extensions: [
      StarterKit.configure({
        link: false,
        underline: false,
        bulletList: false,
        orderedList: false,
      }),
      UnderlineMark,
      TightBulletList,
      TightOrderedList,
      TightTaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
      FolioImage.configure({
        allowBase64: false,
        resize: {
          enabled: true,
          directions: ["top-right", "bottom-right"],
          minWidth: 40,
          minHeight: 40,
          alwaysPreserveAspectRatio: true,
        },
      }),
      FileChip,
      MarkdownPaste,
      Link.extend({
        addInputRules() {
          return [linkInputRule];
        },
      }).configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        validate: isSafeHref,
      }),
      FootnoteRef,
      FootnoteDef,
      InlineMath,
      BlockMath,
      Placeholder.configure({
        placeholder: ({ node }) =>
          node.type.name === "codeBlock" ? "" : "type / for commands",
      }),
      WikiLink,
      Markdown.configure({
        html: true,
        tightLists: true,
        breaks: false,
        transformPastedText: true,
        transformCopiedText: true,
      }),
      FloatingMenu.configure({
        element: floatEl,
        shouldShow: ({ state }) => {
          const { selection, doc } = state;

          return (
            !selection.empty &&
            doc
              .textBetween(selection.from, selection.to, "\n", "\ufffc")
              .trim() !== ""
          );
        },
        options: { placement: "top", offset: 8 },
      }),
      SlashCommand.configure({
        onAttachment: () =>
          pickAttachment(editor, opts.store, opts.onToast ?? noop),
      }),
    ],
    editorProps: {
      attributes: { class: "folio-editor" },
      handlePaste(view, event) {
        return handlePaste(event, editor, opts.store, opts.onToast ?? noop);
      },
      handleDrop(view, event) {
        return handleDrop(event, editor, opts.store, opts.onToast ?? noop);
      },
      handleClick(view, pos, event) {
        const target = event.target as HTMLElement | null;

        if (target?.closest?.("a.wiki-link")) {
          const href = target.closest("a.wiki-link")?.getAttribute("data-wiki");
          if (href) opts.onWikiClick?.(href);

          return true;
        }

        if (target?.closest?.("sup.footnote-ref")) {
          const sup = target.closest("sup.footnote-ref");
          const label = sup?.getAttribute("data-label");
          if (label) jumpToFootnoteDef(editor, label);

          return true;
        }

        if (target?.closest?.(".file-chip")) {
          const chip = target.closest(".file-chip");
          const ref = chip?.getAttribute("data-ref");
          const name = chip?.getAttribute("data-name");
          const mime = chip?.getAttribute("data-mime");

          if (ref) opts.onFileChipClick?.(ref, name || "file", mime || null);

          return true;
        }

        if (
          target?.tagName === "INPUT" &&
          target.closest('[data-type="taskItem"]')
        ) {
          toggleTaskAt(view, pos);

          return true;
        }

        return false;
      },
    },
  });

  mount(FloatingBar, { target: floatEl, props: { editor } });

  editor.on("update", () => opts.onDocChange?.());

  return editor;
}

export function setBody(
  editor: Editor,
  body: string,
  resolveAttachment?: (ref: string) => Promise<string | null>,
): void {
  editor.commands.setContent(body);
  applyWikiLinks(editor);
  void resolveImages(editor, resolveAttachment);
}

export function getMarkdown(editor: Editor): string {
  const storage = editor.storage as unknown as {
    markdown: { getMarkdown(): string };
  };
  let md = storage.markdown.getMarkdown();

  md = md.replace(
    /\\\[\\\[([^\]\\|]+)(?:\|([^\]\\]+))?\\\]\\\]/g,
    (_m, t: string, a?: string) => {
      return `[[${t}${a !== undefined ? `|${a}` : ""}]]`;
    },
  );

  return md;
}

export function pickAttachment(
  editor: Editor,
  store: VaultStore | null,
  onToast: (msg: string) => void,
): void {
  if (!store) return;

  const input = document.createElement("input");
  input.type = "file";
  input.style.display = "none";
  document.body.appendChild(input);
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file) void uploadFile(file, editor, store, onToast);
    input.remove();
  });
  input.click();
}

export const editorExtensions = {
  FolioImage,
  FileChip,
  WikiLink,
  UnderlineMark,
  FootnoteRef,
  FootnoteDef,
  InlineMath,
  BlockMath,
};

export type { Editor as TiptapEditor } from "@tiptap/core";
