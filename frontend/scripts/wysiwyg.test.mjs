import { JSDOM } from "jsdom";
import "./register-svelte.mjs";
import { check, done } from "./harness.mjs";

const dom = new JSDOM("<!DOCTYPE html><body></body>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.MutationObserver = dom.window.MutationObserver;
globalThis.DOMParser = dom.window.DOMParser;
globalThis.Node = dom.window.Node;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.HTMLMediaElement = dom.window.HTMLMediaElement;
globalThis.Element = dom.window.Element;
globalThis.Text = dom.window.Text;
globalThis.Comment = dom.window.Comment;
globalThis.DocumentFragment = dom.window.DocumentFragment;
globalThis.Range = dom.window.Range;
globalThis.DOMRect = dom.window.DOMRect;
globalThis.getSelection = dom.window.getSelection.bind(dom.window);
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(
  dom.window,
);

const { createEditor, setBody, getMarkdown } =
  await import("../src/lib/editor/editor.ts");
const { TextSelection } = await import("prosemirror-state");
const { parseFrontmatter, writeFrontmatter, extractTitle, cleanDerivedTitle } =
  await import("../src/lib/editor/markdown.ts");

const norm = (s) => s.replace(/\s+$/, "");

function build(body) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const ed = createEditor(el, {
    body: "",
    store: {},
    index: {},
    onToast: () => {},
  });
  setBody(ed, body);
  return ed;
}
function roundtrip(md) {
  const ed = build(md);
  const out = getMarkdown(ed);
  ed.destroy();
  return out;
}
function pasteInto(ed, text, html) {
  const fake = {
    getData: (t) =>
      t === "text/plain" ? text : t === "text/html" ? (html ?? "") : "",
    files: { length: 0 },
  };
  const ev = new dom.window.Event("paste", {
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(ev, "clipboardData", { value: fake });
  ed.view.dom.dispatchEvent(ev);
}

const cases = [
  ["headings (blank lines)", "# one\n## two\n### three", "collapse"],
  ["emphasis", "**bold** *italic* ~~strike~~ `code`"],
  ["underline <u>", "hello <u>world</u>"],
  ["link", "a [link](https://example.com) b"],
  ["wiki [[target]]", "see [[Target]]"],
  ["wiki [[target|alias]]", "see [[Target|alias]]"],
  ["task list", "- [ ] todo\n- [x] done"],
  ["bullet + ordered", "- one\n- two\n\n1. first\n2. second"],
  ["blockquote", "> quote\n\n> more"],
  ["code block with lang", "```js\nconst x = 1;\n```"],
  ["code block plaintext", "```plaintext\nx = 1\n```"],
  ["callout", "> [!note] 💡\n> hello"],
  ["callout warning", "> [!warning] ⚠️\n> be careful"],
  ["gfm table", "| a | b |\n| --- | --- |\n| 1 | 2 |"],
  [
    "footnote",
    "text[^1] and more[^2]\n\n[^1]: first note\n\n[^2]: second **bold** note",
  ],
  ["footnote ref inside code stays literal", "literal `[^3]` stays"],
  ["image ref", "![alt](assets/abc-123.png)"],
  ["image with title (caption)", '![alt](assets/abc-123.png "caption text")'],
  [
    "image with width (inline html)",
    '<img src="assets/abc-123.png" width="400" alt="alt">',
  ],
  [
    "file chip with meta",
    '[report.pdf](assets/abc-123.pdf "2048, application/pdf")',
  ],
  ["file chip without meta", "see [notes.txt](assets/abc-456.txt)"],
  ["horizontal rule", "---"],
  [
    "mixed doc",
    "# title\n\nsome **bold** and *italic* with a [link](https://x.io)\n\n- [ ] task\n- item\n\n| h |\n| --- |\n| v |\n\nsee [[Other|other note]] and <u>underlined</u>",
    "collapse",
  ],
  ["inline math", "a $x^2 + y^2$ b"],
  ["block math", "$$\nE = mc^2\n$$"],
  ["block math multiline content", "$$\n\\int_0^1 x dx\n$$"],
  ["math with escaped dollar", "a $x\\$y$ b"],
  ["math next to wiki link", "see [[Target]] and $x$"],
  ["math inside code stays literal", "`$x$` stays code"],
  ["math inside fence stays literal", "```\n$x$\n```"],
  ["currency amount stays text", "cost is $5 and $10"],
];
for (const [name, md, mode] of cases) {
  const out = roundtrip(md);
  const eq =
    mode === "collapse" ? (s) => norm(s).replace(/\n{2,}/g, "\n") : norm;
  check(`roundtrip: ${name}`, eq(out) === eq(md), JSON.stringify(out));
}

{
  const ed = build("");
  setBody(ed, "a $x$ b");
  const kinds = ed.state.doc.toJSON().content[0].content.map((c) => c.type);
  const latex = ed.state.doc.toJSON().content[0].content[1].attrs.latex;
  ed.destroy();
  check(
    "inline math parses into a node",
    kinds.join(",") === "text,inlineMath,text" && latex === "x",
    JSON.stringify({ kinds, latex }),
  );
}

{
  const ed = build("");
  setBody(ed, "$$\nE = mc^2\n$$");
  const kinds = ed.state.doc.toJSON().content.map((n) => n.type);
  const latex = ed.state.doc.toJSON().content[0].attrs.latex;
  ed.destroy();
  check(
    "block math parses into a node",
    kinds[0] === "blockMath" && latex === "E = mc^2",
    JSON.stringify({ kinds, latex }),
  );
}

{
  const ed = build("");
  const { view } = ed;
  const tr = view.state.tr;
  tr.insertText("$x^2$", 1);
  tr.setMeta("applyInputRules", { from: 1, text: "$x^2$" });
  view.dispatch(tr);
  await new Promise((r) => setTimeout(r, 20));
  const kinds = ed.state.doc.toJSON().content[0].content.map((c) => c.type);
  const out = getMarkdown(ed);
  ed.destroy();
  check(
    "typing '$x^2$' converts to inline math",
    kinds.join(",") === "inlineMath" && out === "$x^2$",
    JSON.stringify({ kinds, out }),
  );
}

{
  const ed = build("");
  const { view } = ed;
  const tr = view.state.tr;
  tr.insertText("$$", 1);
  tr.setMeta("applyInputRules", { from: 1, text: "$$" });
  view.dispatch(tr);
  await new Promise((r) => setTimeout(r, 20));
  const kinds = ed.state.doc.toJSON().content.map((n) => n.type);
  const out = getMarkdown(ed);
  ed.destroy();
  check(
    "typing '$$' at line start converts to block math",
    kinds[0] === "blockMath" && out === "$$\n$$",
    JSON.stringify({ kinds, out }),
  );
}

{
  const ed = build("");
  setBody(ed, "$$\nx\n$$");
  const out = getMarkdown(ed);
  ed.destroy();
  check(
    "single-line block math canonicalizes to multiline",
    norm(out) === "$$\nx\n$$",
    JSON.stringify(out),
  );
}

{
  const ed = build("");
  setBody(ed, "$ x $ and $x $ and $x$5 and $5.99");
  const out = getMarkdown(ed);
  ed.destroy();
  check(
    "space and digit rules keep invalid math as text",
    norm(out) === "$ x $ and $x $ and $x$5 and $5.99",
    JSON.stringify(out),
  );
}

{
  const ed = build("");
  setBody(ed, "text[^1]\n\n[^1]: the note");
  const json = ed.state.doc.toJSON();
  const inlineKinds = json.content.flatMap((n) =>
    n.content ? n.content.map((c) => c.type) : [],
  );
  const blockKinds = json.content.map((n) => n.type);
  ed.destroy();
  check(
    "footnote parses into ref + def nodes",
    inlineKinds.includes("footnoteRef") && blockKinds.includes("footnoteDef"),
    JSON.stringify({ inlineKinds, blockKinds }),
  );
}

{
  const ed = build("");
  ed.commands.insertContent("see [[x]]");
  const out = getMarkdown(ed);
  ed.destroy();
  check(
    "typed [[x]] stays literal",
    norm(out) === "see [[x]]",
    JSON.stringify(out),
  );
}

{
  const ed = build("");
  const { view } = ed;
  const tr = view.state.tr;
  tr.insertText("- [ ] ", 1);
  tr.setMeta("applyInputRules", { from: 1, text: "- [ ] " });
  view.dispatch(tr);
  await new Promise((r) => setTimeout(r, 20));
  const types = ed.state.doc.toJSON().content.map((n) => n.type);
  const checked = ed.state.doc.toJSON().content[0].content[0].attrs.checked;
  const out = getMarkdown(ed);
  ed.destroy();
  check(
    "typing '- [ ] ' creates a task list",
    types.includes("taskList") && checked === false && out === "- [ ] ",
    JSON.stringify({ types, checked, out }),
  );
}

{
  const ed = build("");
  const { view } = ed;
  const tr = view.state.tr;
  tr.insertText("- [x] ", 1);
  tr.setMeta("applyInputRules", { from: 1, text: "- [x] " });
  view.dispatch(tr);
  await new Promise((r) => setTimeout(r, 20));
  const checked = ed.state.doc.toJSON().content[0].content[0].attrs.checked;
  const out = getMarkdown(ed);
  ed.destroy();
  check(
    "typing '- [x] ' creates a checked task",
    checked === true && out === "- [x] ",
    JSON.stringify({ checked, out }),
  );
}

{
  const ed = build("");
  ed.chain().focus().insertFootnote().run();
  const out = getMarkdown(ed);
  ed.destroy();
  check(
    "insert footnote writes ref + def",
    out.includes("[^1]") && out.includes("[^1]: "),
    JSON.stringify(out),
  );
}

{
  const ed = build("");
  ed.chain().focus().toggleBold().insertContent("b").run();
  check(
    "toolbar bold",
    getMarkdown(ed).includes("**b**"),
    JSON.stringify(getMarkdown(ed)),
  );
  ed.destroy();
  const ed2 = build("");
  ed2.chain().focus().toggleUnderline().insertContent("u").run();
  check(
    "toolbar underline",
    getMarkdown(ed2).includes("<u>u</u>"),
    JSON.stringify(getMarkdown(ed2)),
  );
  ed2.destroy();
  const ed3 = build("");
  ed3.chain().focus().toggleTaskList().insertContent("t").run();
  check(
    "toolbar task list",
    getMarkdown(ed3).includes("- [ ] t"),
    JSON.stringify(getMarkdown(ed3)),
  );
  ed3.destroy();
  const ed4 = build("");
  ed4.chain().focus().insertTable({ rows: 2, cols: 2 }).run();
  check(
    "toolbar table",
    getMarkdown(ed4).includes("|  |  |"),
    JSON.stringify(getMarkdown(ed4)),
  );
  ed4.destroy();
  const ed5 = build("");
  ed5
    .chain()
    .focus()
    .insertContent({
      type: "fileChip",
      attrs: {
        name: "a.pdf",
        ref: "assets/x.pdf",
        size: 1048576,
        mime: "application/pdf",
      },
    })
    .run();
  const md5 = getMarkdown(ed5);
  check(
    "file chip serializes as link+title",
    md5.includes('[a.pdf](assets/x.pdf "1048576, application/pdf")'),
    JSON.stringify(md5),
  );
  ed5.destroy();
  {
    const edA = build("");
    edA
      .chain()
      .focus()
      .insertContent({
        type: "fileChip",
        attrs: {
          name: "a.py",
          ref: "assets/x.py",
          size: 9523,
          mime: "text/x-python",
        },
      })
      .run();
    const html = edA.getHTML();
    edA.destroy();
    const edB = build(`<p>${html}</p>`);
    const out = getMarkdown(edB);
    check(
      "chip clipboard round-trips to link+title",
      norm(out).trim() === '[a.py](assets/x.py "9523, text/x-python")',
      JSON.stringify(out) + " from " + html,
    );
    edB.destroy();
  }
  {
    const ed = build(
      '<p><a href="https://example.com">https://example.com</a></p>',
    );
    const slice = ed.state.doc.slice(1, ed.state.doc.content.size - 1);
    const copied = ed.storage.markdown.serializer.serialize(slice.content);
    ed.destroy();
    check(
      "plain link copy has no angle brackets",
      norm(copied).trim() === "https://example.com",
      JSON.stringify(copied),
    );
  }
  const ed6 = build("");
  ed6
    .chain()
    .focus()
    .insertContent({
      type: "image",
      attrs: { src: "assets/x.png", alt: "a", ref: "assets/x.png", width: 300 },
    })
    .run();
  const md6 = getMarkdown(ed6);
  check(
    "image width serializes as <img width>",
    md6.includes('<img src="assets/x.png" width="300" alt="a">'),
    JSON.stringify(md6),
  );
  ed6.destroy();
}

{
  const fm = {
    id: "x",
    title: "T",
    created: 1,
    updated: 2,
    tags: ["a"],
    pinned: true,
    folder: "f",
  };
  const content = writeFrontmatter(fm, "# body");
  const parsed = parseFrontmatter(content);
  const ok =
    parsed.meta.title === "T" &&
    parsed.meta.pinned === true &&
    parsed.meta.tags !== undefined &&
    parsed.meta.tags[0] === "a" &&
    parsed.meta.folder === "f" &&
    parsed.meta.created === 1 &&
    parsed.body === "# body";
  check(
    "frontmatter round-trips",
    ok,
    content + " → " + JSON.stringify(parsed.meta),
  );
}

{
  const ed = build("");
  const { view } = ed;
  const tr = view.state.tr;
  tr.insertText("/", 1);
  view.dispatch(tr);
  await new Promise((r) => setTimeout(r, 20));
  const host = ed.view.dom.parentElement;
  const menu = host?.querySelector(".slash-menu");
  const items = menu?.querySelectorAll(".slash-item") ?? [];
  check(
    "'/' opens the slash menu with all blocks",
    !!menu && items.length === 14,
    String(items.length),
  );

  const tr2 = view.state.tr.insertText("quo", view.state.selection.from);
  view.dispatch(tr2);
  await new Promise((r) => setTimeout(r, 20));
  const filtered = host?.querySelectorAll(".slash-item") ?? [];
  check(
    "slash menu filters by query",
    filtered.length === 1 && (filtered[0]?.textContent ?? "").includes("Quote"),
    String(filtered.length),
  );

  view.dom.dispatchEvent(
    new dom.window.KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }),
  );
  await new Promise((r) => setTimeout(r, 20));
  check(
    "escape closes the menu and keeps the slash text",
    getMarkdown(ed) === "/quo",
    getMarkdown(ed),
  );
  ed.destroy();
}

{
  const ed = build("");
  const { view } = ed;
  const tr = view.state.tr;
  tr.insertText("/", 1);
  view.dispatch(tr);
  await new Promise((r) => setTimeout(r, 20));
  view.dom.dispatchEvent(
    new dom.window.KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    }),
  );
  await new Promise((r) => setTimeout(r, 20));
  const types = ed.state.doc.toJSON().content.map((n) => n.type);
  const out = getMarkdown(ed);
  ed.destroy();
  check(
    "enter inserts the first slash item (heading 1)",
    types[0] === "heading" && types[1] === "paragraph" && norm(out) === "#",
    JSON.stringify({ types, out }),
  );
}

{
  const ed = build("");
  const { view } = ed;
  const tr = view.state.tr;
  tr.insertText("/ta", 1);
  view.dispatch(tr);
  await new Promise((r) => setTimeout(r, 20));
  view.dom.dispatchEvent(
    new dom.window.KeyboardEvent("keydown", {
      key: "ArrowDown",
      bubbles: true,
      cancelable: true,
    }),
  );
  view.dom.dispatchEvent(
    new dom.window.KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    }),
  );
  await new Promise((r) => setTimeout(r, 20));
  const types = ed.state.doc.toJSON().content.map((n) => n.type);
  const out = getMarkdown(ed);
  ed.destroy();
  check(
    "'/ta' + arrow moves selection and enters table (2x3)",
    types[0] === "table" &&
      norm(out) === "|  |  |\n| --- | --- |\n|  |  |\n|  |  |",
    JSON.stringify({ types, out }),
  );
}

{
  const ed = build("");
  const { view } = ed;
  const tr = view.state.tr;
  tr.insertText("/ta", 1);
  view.dispatch(tr);
  await new Promise((r) => setTimeout(r, 20));
  view.dom.dispatchEvent(
    new dom.window.KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    }),
  );
  await new Promise((r) => setTimeout(r, 20));
  const types = ed.state.doc.toJSON().content.map((n) => n.type);
  const out = getMarkdown(ed);
  ed.destroy();
  check(
    "'/ta' + enter inserts a task list",
    types[0] === "taskList" && norm(out) === "- [ ]",
    JSON.stringify({ types, out }),
  );
}

{
  const ed = build("");
  const { view } = ed;
  const tr = view.state.tr;
  tr.insertText("/ca", 1);
  view.dispatch(tr);
  await new Promise((r) => setTimeout(r, 20));
  view.dom.dispatchEvent(
    new dom.window.KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    }),
  );
  await new Promise((r) => setTimeout(r, 20));
  const types = ed.state.doc.toJSON().content.map((n) => n.type);
  const out = getMarkdown(ed);
  ed.destroy();
  check(
    "'/ca' + enter inserts a callout",
    types.join(",") === "callout,paragraph" && norm(out) === "> [!note] 💡\n>",
    JSON.stringify({ types, out }),
  );
}

{
  const ed = build("");
  setBody(ed, "> [!tip]\n> heat\n\n> more");
  const node = ed.state.doc.toJSON().content[0];
  const inner = node.content.map((n) => n.type);
  const out = getMarkdown(ed);
  ed.destroy();
  check(
    "callout defaults icon and keeps block quote after",
    node.type === "callout" &&
      node.attrs.kind === "tip" &&
      node.attrs.icon === "🔥" &&
      inner.join(",") === "paragraph" &&
      norm(out) === "> [!tip] 🔥\n> heat\n\n> more",
    JSON.stringify({ node, inner, out }),
  );
}

{
  const ed = build("");
  const { view } = ed;
  await new Promise((r) => setTimeout(r, 20));
  const p = view.dom.querySelector("p.is-empty");
  check(
    "empty line shows the slash hint",
    !!p && p.getAttribute("data-placeholder") === "type / for commands",
    p?.outerHTML ?? "no placeholder",
  );
  const tr = view.state.tr;
  tr.insertText("hello", 1);
  view.dispatch(tr);
  await new Promise((r) => setTimeout(r, 20));
  check(
    "hint disappears once you type",
    !view.dom.querySelector("p.is-empty"),
    view.dom.innerHTML,
  );
  view.dom.dispatchEvent(
    new dom.window.KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    }),
  );
  await new Promise((r) => setTimeout(r, 20));
  const empties = [...view.dom.querySelectorAll("p.is-empty")];
  check(
    "enter on a typed line creates a fresh empty line with the hint",
    empties.length === 1 &&
      empties[0].getAttribute("data-placeholder") === "type / for commands",
    view.dom.innerHTML,
  );
  ed.destroy();
}

{
  const ed = build("```\n\n```");
  const { view } = ed;
  let cpos = 0;
  ed.state.doc.descendants((n, p) => {
    if (n.type.name === "codeBlock" && cpos === 0) cpos = p + 1;
  });
  const tr = view.state.tr;
  tr.setSelection(TextSelection.create(tr.doc, cpos));
  view.dispatch(tr);
  await new Promise((r) => setTimeout(r, 20));
  check(
    "no slash hint inside an empty code block",
    ![...view.dom.querySelectorAll("[data-placeholder]")].some(
      (el) => el.getAttribute("data-placeholder") === "type / for commands",
    ),
    view.dom.innerHTML,
  );
  ed.destroy();
}

{
  const ed = build("");
  const { view } = ed;
  const text = "[example](https://example.com/)";
  const tr = view.state.tr;
  tr.insertText(text, 1);
  tr.setMeta("applyInputRules", { from: 1, text });
  view.dispatch(tr);
  await new Promise((r) => setTimeout(r, 20));
  const marks = ed.state.doc
    .toJSON()
    .content[0].content.map((c) => c.marks?.[0]?.type);
  const out = getMarkdown(ed);
  ed.destroy();
  check(
    "typed [text](url) becomes a link",
    marks[0] === "link" && norm(out) === text,
    JSON.stringify({ marks, out }),
  );
}

{
  const ed = build("");
  const { view } = ed;
  const text = "[x](javascript:alert(1))";
  const tr = view.state.tr;
  tr.insertText(text, 1);
  tr.setMeta("applyInputRules", { from: 1, text });
  view.dispatch(tr);
  await new Promise((r) => setTimeout(r, 20));
  const out = getMarkdown(ed);
  ed.destroy();
  check(
    "unsafe typed link stays literal (escaped)",
    norm(out) === "\\[x\\](javascript:alert(1))",
    out,
  );
}

{
  const ed = build("```\n```");
  const { view } = ed;
  let cpos = 0;
  ed.state.doc.descendants((n, p) => {
    if (n.type.name === "codeBlock" && cpos === 0) cpos = p + 1;
  });
  const text = "[example](https://example.com/)";
  const tr = view.state.tr;
  tr.insertText(text, cpos);
  tr.setMeta("applyInputRules", { from: cpos, text });
  view.dispatch(tr);
  await new Promise((r) => setTimeout(r, 20));
  const links = ed.state.doc
    .toJSON()
    .content[0].content.filter((c) => c.marks?.[0]?.type === "link");
  ed.destroy();
  check(
    "no link conversion inside a code block",
    links.length === 0,
    JSON.stringify(links),
  );
}

{
  const ed = build("");
  pasteInto(
    ed,
    "[example](https://example.com/)",
    "<p>[example](https://example.com/)</p>",
  );
  await new Promise((r) => setTimeout(r, 20));
  const marks = ed.state.doc
    .toJSON()
    .content[0].content.map((c) => c.marks?.[0]?.type);
  const out = getMarkdown(ed);
  ed.destroy();
  check(
    "paste with html on the clipboard still converts markdown links",
    marks[0] === "link" && norm(out) === "[example](https://example.com/)",
    JSON.stringify({ marks, out }),
  );
}

{
  const ed = build("");
  pasteInto(
    ed,
    "",
    '<meta charset="utf-8"><p>[example](https://example.com/)</p>',
  );
  await new Promise((r) => setTimeout(r, 20));
  const marks = ed.state.doc
    .toJSON()
    .content[0].content.map((c) => c.marks?.[0]?.type);
  const out = getMarkdown(ed);
  ed.destroy();
  check(
    "html-only clipboard still converts markdown links",
    marks[0] === "link" && norm(out) === "[example](https://example.com/)",
    JSON.stringify({ marks, out }),
  );
}

{
  const ed = build("");
  pasteInto(ed, "**bold**");
  await new Promise((r) => setTimeout(r, 20));
  const marks = ed.state.doc
    .toJSON()
    .content[0].content.map((c) => c.marks?.[0]?.type);
  const out = getMarkdown(ed);
  ed.destroy();
  check(
    "plain-text paste of markdown still converts",
    marks[0] === "bold" && norm(out) === "**bold**",
    JSON.stringify({ marks, out }),
  );
}

{
  const ed = build("");
  pasteInto(
    ed,
    "see example",
    '<p>see <a href="https://example.com/">example</a></p>',
  );
  await new Promise((r) => setTimeout(r, 20));
  const marks = ed.state.doc
    .toJSON()
    .content[0].content.map((c) => c.marks?.[0]?.type);
  const out = getMarkdown(ed);
  ed.destroy();
  check(
    "rich html paste with a real link is not rewritten",
    marks[1] === "link" && norm(out) === "see [example](https://example.com/)",
    JSON.stringify({ marks, out }),
  );
}

{
  const ed = build("```\n```");
  const { view } = ed;
  let cpos = 0;
  ed.state.doc.descendants((n, p) => {
    if (n.type.name === "codeBlock" && cpos === 0) cpos = p + 1;
  });
  const tr = view.state.tr;
  tr.setSelection(TextSelection.create(tr.doc, cpos));
  view.dispatch(tr);
  pasteInto(
    ed,
    "[example](https://example.com/)",
    "<p>[example](https://example.com/)</p>",
  );
  await new Promise((r) => setTimeout(r, 20));
  const codeText = ed.state.doc.content.firstChild?.textContent ?? "";
  const links = ed.state.doc
    .toJSON()
    .content[0].content.filter((c) => c.marks?.[0]?.type === "link");
  ed.destroy();
  check(
    "paste into a code block stays literal",
    codeText === "[example](https://example.com/)" && links.length === 0,
    JSON.stringify({ codeText, links }),
  );
}

{
  check(
    "cleanDerivedTitle unescapes asterisk",
    cleanDerivedTitle("\\* my header") === "* my header",
  );
  check(
    "cleanDerivedTitle unescapes multiple asterisks",
    cleanDerivedTitle("\\*\\*stars\\*\\*") === "**stars**",
  );
  check(
    "cleanDerivedTitle strips bold formatting",
    cleanDerivedTitle("**bold title**") === "bold title",
  );
  check(
    "cleanDerivedTitle strips italic formatting",
    cleanDerivedTitle("*italic title*") === "italic title",
  );
  check(
    "cleanDerivedTitle strips inline code",
    cleanDerivedTitle("`code title`") === "code title",
  );
  check(
    "cleanDerivedTitle strips html tags",
    cleanDerivedTitle("<u>underlined title</u>") === "underlined title",
  );
  check(
    "cleanDerivedTitle unescapes other markdown escapes",
    cleanDerivedTitle("\\# \\_underline\\_ and \\[brackets\\]") ===
      "# _underline_ and [brackets]",
  );
  check(
    "extractTitle handles escaped asterisk heading",
    extractTitle("# \\* asterisk title", "id-12345678") === "* asterisk title",
  );
  check(
    "extractTitle handles formatted heading",
    extractTitle("# **bold heading**", "id-12345678") === "bold heading",
  );
}

done("wysiwyg");
