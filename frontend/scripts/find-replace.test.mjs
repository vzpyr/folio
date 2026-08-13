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
globalThis.requestIdleCallback = (fn) => setTimeout(fn, 0);

const { createEditor, getMarkdown } =
  await import("../src/lib/editor/editor.ts");
const { findReplaceKey } = await import("../src/lib/editor/find-replace.ts");

const st = (ed) => findReplaceKey.getState(ed.state);

const el = document.createElement("div");
document.body.appendChild(el);

const editor = createEditor(el, { body: "", store: null, index: null });
editor.commands.setContent(
  "<p>the quick brown fox jumps over the lazy dog. the fox is quick.</p>",
);

check(
  "initial state empty",
  st(editor).matches.length === 0 && st(editor).current === -1,
);

editor.commands.find("fox");
check("find fox -> 2 matches", st(editor).matches.length === 2);
check("current = 0", st(editor).current === 0);
check(
  "selection at first match",
  editor.state.selection.from === st(editor).matches[0].from,
);

editor.commands.findNext();
check("next -> current 1", st(editor).current === 1);
editor.commands.findNext();
check("next wraps -> current 0", st(editor).current === 0);
editor.commands.findPrev();
check("prev wraps -> current 1", st(editor).current === 1);

editor.commands.find("THE", true);
check("case sensitive THE -> 0", st(editor).matches.length === 0);
editor.commands.find("the", true);
check("case sensitive the -> 3", st(editor).matches.length === 3);
editor.commands.find("The", false);
check("case insensitive The -> 3", st(editor).matches.length === 3);

editor.commands.find("fox");
check("find fox again -> 2", st(editor).matches.length === 2);

editor.commands.find("quick");
editor.commands.replace("slow");
const md1 = getMarkdown(editor);
check(
  "replace 1st quick",
  md1.includes("slow brown fox") && md1.includes("fox is quick."),
);
check("after replace count 1", st(editor).matches.length === 1);
check("after replace current 0", st(editor).current === 0);

editor.commands.find("the");
editor.commands.replace("them");
check(
  "replace keeps matches when term in replacement",
  st(editor).matches.length === 3 && st(editor).current === 0,
);
check("replaceAll the->them empty?", getMarkdown(editor).includes("them"));

editor.commands.find("o");
editor.commands.replaceAll("0");
const md2 = getMarkdown(editor);
check("replaceAll o->0", md2.includes("br0wn") && md2.includes("d0g"));
check("replaceAll emptied matches", st(editor).matches.length === 0);

editor.commands.find("\\");
check("regex chars escaped", st(editor).matches.length === 0);

editor.commands.find("quick");
check("clear then empty", st(editor).matches.length === 1);
editor.commands.clearSearch();
check("cleared", st(editor).matches.length === 0 && st(editor).term === "");

editor.commands.setContent("<p>one two</p><p>three four</p>");
editor.commands.find("two");
check("match within block", st(editor).matches.length === 1);
editor.commands.find("two three", true);
check("matches never span blocks", st(editor).matches.length === 0);
editor.commands.find("three");
check("match in second block", st(editor).matches.length === 1);

editor.commands.setContent("<p>a <strong>bold fox</strong> here</p>");
editor.commands.find("bold fox");
check("match across mark boundary", st(editor).matches.length === 1);
editor.commands.replace("plain");
check("replace across mark", getMarkdown(editor).includes("plain"));

editor.commands.setContent("<pre><code>const fox = 1;</code></pre>");
editor.commands.find("fox");
check("search inside code block", st(editor).matches.length === 1);

editor.destroy();
done();
