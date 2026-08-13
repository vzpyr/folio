import type { NodeViewRendererProps } from "@tiptap/core";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import type { CodeBlockLowlightOptions } from "@tiptap/extension-code-block-lowlight";
import { createLowlight, common } from "lowlight";
import xml from "highlight.js/lib/languages/xml";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { ViewMutationRecord } from "@tiptap/pm/view";

export const lowlight = createLowlight(common);

lowlight.register({ html: xml });

const PINNED_LANGUAGES: { value: string; label: string }[] = [
  { value: "", label: "auto" },
  { value: "plaintext", label: "plain text" },
];

const LANGUAGE_ENTRIES: { value: string; label: string }[] = [
  { value: "html", label: "html" },
  { value: "xml", label: "xml" },
  { value: "css", label: "css" },
  { value: "scss", label: "scss" },
  { value: "less", label: "less" },
  { value: "javascript", label: "javascript" },
  { value: "typescript", label: "typescript" },
  { value: "json", label: "json" },
  { value: "yaml", label: "yaml" },
  { value: "markdown", label: "markdown" },
  { value: "bash", label: "bash" },
  { value: "shell", label: "shell" },
  { value: "python", label: "python" },
  { value: "python-repl", label: "python repl" },
  { value: "ruby", label: "ruby" },
  { value: "php", label: "php" },
  { value: "php-template", label: "php template" },
  { value: "java", label: "java" },
  { value: "kotlin", label: "kotlin" },
  { value: "c", label: "c" },
  { value: "cpp", label: "c++" },
  { value: "csharp", label: "c#" },
  { value: "objectivec", label: "objective-c" },
  { value: "go", label: "go" },
  { value: "rust", label: "rust" },
  { value: "swift", label: "swift" },
  { value: "sql", label: "sql" },
  { value: "r", label: "r" },
  { value: "graphql", label: "graphql" },
  { value: "ini", label: "ini" },
  { value: "makefile", label: "makefile" },
  { value: "lua", label: "lua" },
  { value: "perl", label: "perl" },
  { value: "arduino", label: "arduino" },
  { value: "wasm", label: "wasm" },
  { value: "vbnet", label: "vb.net" },
  { value: "diff", label: "diff" },
];

LANGUAGE_ENTRIES.sort((a, b) => a.label.localeCompare(b.label));

export const CODE_LANGUAGES = [...PINNED_LANGUAGES, ...LANGUAGE_ENTRIES];

function codeBlockView({ node, editor, getPos }: NodeViewRendererProps) {
  const container = document.createElement("div");
  container.className = "code-block";

  const head = document.createElement("div");
  head.className = "code-block-head";
  head.contentEditable = "false";

  const select = document.createElement("select");
  select.className = "code-block-lang";
  select.title = "language";

  const registered = new Set(lowlight.listLanguages());

  const addOption = (value: string, label: string) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  };

  for (const lang of CODE_LANGUAGES) {
    if (lang.value === "" || registered.has(lang.value)) {
      addOption(lang.value, lang.label);
    }
  }

  const current = node.attrs.language || "";
  if (current && !select.querySelector(`option[value="${current}"]`)) {
    addOption(current, current);
  }
  select.value = current;

  const pre = document.createElement("pre");
  pre.className = "code-block-pre";
  const code = document.createElement("code");
  pre.appendChild(code);
  head.appendChild(select);
  container.append(head, pre);

  select.addEventListener("mousedown", (e) => e.stopPropagation());
  select.addEventListener("change", () => {
    if (!editor.isEditable) return;
    const pos = getPos();
    if (pos == null || pos < 0) return;

    const language = select.value === "" ? null : select.value;
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        language,
      }),
    );
    editor.commands.focus();
  });

  return {
    dom: container,
    contentDOM: code,
    update(updated: PMNode) {
      if (updated.type !== node.type) return false;
      node = updated;

      const lang = node.attrs.language || "";
      if (select.value !== lang) select.value = lang;

      return true;
    },
    ignoreMutation(mutation: ViewMutationRecord) {
      return !code.contains(mutation.target);
    },
  };
}

export const FolioCodeBlock = CodeBlockLowlight.extend({
  addOptions() {
    return {
      ...this.parent?.(),
      lowlight,
    } as CodeBlockLowlightOptions;
  },
  addNodeView() {
    return codeBlockView;
  },
});
