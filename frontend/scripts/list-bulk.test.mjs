import "./register-svelte.mjs";
import { register } from "node:module";

const { JSDOM } = await import("jsdom");
await import("./state-shim.mjs");
const { check, done } = await import("./harness.mjs");
const { compileRunes } = await import("./compile-runes.mjs");
const { mount } = await import("svelte");

await compileRunes("app.svelte.ts");
await compileRunes("lib/store/store.svelte.ts");
register("./list-bulk-loader.mjs", import.meta.url);

const dom = new JSDOM(
  "<!DOCTYPE html><html><head></head><body></body></html>",
  {
    url: "http://localhost/",
    pretendToBeVisual: true,
  },
);
globalThis.window = dom.window;
globalThis.location = dom.window.location;
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
globalThis.MouseEvent = dom.window.MouseEvent;
globalThis.KeyboardEvent = dom.window.KeyboardEvent;
globalThis.getSelection = dom.window.getSelection.bind(dom.window);
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(
  dom.window,
);
globalThis.requestIdleCallback = (fn) => setTimeout(fn, 0);

const { NoteIndex, writeFrontmatter } =
  await import("../src/lib/store/store.svelte.ts");
const { appState } = await import("../src/app.svelte.ts");
const List = (await import("../src/routes/List.svelte")).default;

const sleep = () => new Promise((r) => setTimeout(r, 10));

class FakeStore {
  notes = new Map();
  async listNotes() {
    return [...this.notes.values()].map((n) => n.meta);
  }
  async readNote(id) {
    return this.notes.get(id)?.content ?? null;
  }
  async writeNote(id, meta, content) {
    this.notes.set(id, { meta, content });
  }
  async deleteNote(id) {
    this.notes.delete(id);
  }
}

const store = new FakeStore();
const now = Date.now();
for (let i = 1; i <= 3; i++) {
  const id = `note-${i}`;
  const meta = {
    id,
    title: `note ${i}`,
    folder: i === 1 ? "work" : "",
    tags: [],
    pinned: false,
    created: now,
    updated: now - i * 1000,
    rev: -1,
    conflict: false,
  };
  store.notes.set(id, {
    meta,
    content: writeFrontmatter(
      {
        id,
        title: meta.title,
        created: meta.created,
        updated: meta.updated,
        tags: [],
        pinned: false,
        folder: meta.folder,
      },
      `body of note ${i}`,
    ),
  });
}

const FOLDER_REGISTRY_ID = "00000000-0000-4000-8000-000000000000";
store.notes.set(FOLDER_REGISTRY_ID, {
  meta: {
    id: FOLDER_REGISTRY_ID,
    title: "folio folders",
    folder: "",
    tags: [],
    pinned: false,
    created: now,
    updated: now,
    rev: -1,
    conflict: false,
  },
  content: writeFrontmatter(
    {
      id: FOLDER_REGISTRY_ID,
      title: "folio folders",
      created: now,
      updated: now,
      tags: [],
      pinned: false,
      folder: "",
    },
    JSON.stringify({ folders: ["work"] }),
  ),
});

const idx = new NoteIndex();
await idx.rebuild(store);
appState.index = idx;
appState.store = store;
appState.vaultUnlocked = true;

const el = document.createElement("div");
document.body.appendChild(el);
mount(List, { target: el });
await sleep();

const rows = () => el.querySelectorAll(".note-row");
const checkboxes = () => el.querySelectorAll(".note-row input[type=checkbox]");
const bulkBar = () => el.querySelector(".bulk-bar");
const bulkCount = () => el.querySelector(".bulk-count")?.textContent ?? "";
const selectAll = () => el.querySelector(".select-all input[type=checkbox]");
const click = (node) =>
  node.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true }),
  );
const modClick = (node, mods = {}) =>
  node.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true, ...mods }),
  );
class MockDataTransfer {
  data = new Map();
  effectAllowed = "none";
  setData(type, value) {
    this.data.set(type, value);
  }
  getData(type) {
    return this.data.get(type) ?? "";
  }
}
const dragStart = (node) => {
  const dt = new MockDataTransfer();
  const ev = new MouseEvent("dragstart", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "dataTransfer", { value: dt });
  node.dispatchEvent(ev);
  return dt;
};

check("renders 3 rows", rows().length === 3);
check("each row has a checkbox", checkboxes().length === 3);
check("select-all checkbox present", !!selectAll());
check("no bulk bar initially", !bulkBar());
check("folder chip on work note", rows()[0].textContent.includes("work"));

click(checkboxes()[0]);
await sleep();
check("bulk bar after one selection", !!bulkBar());
check("count shows 1 note", bulkCount().includes("1 selected"));
check("first row marked selected", rows()[0].classList.contains("selected"));

click(checkboxes()[1]);
await sleep();
check("count shows 2 notes", bulkCount().includes("2 selected"));

click(selectAll());
await sleep();
check("select all -> 3 selected", bulkCount().includes("3 selected"));
check(
  "all checkboxes checked",
  [...checkboxes()].every((c) => c.checked),
);

check(
  "drag payload carries all 3 selected ids",
  JSON.parse(dragStart(rows()[0]).getData("text/folio-note")).length === 3,
);

window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
await sleep();
check("escape clears selection", !bulkBar());
check(
  "no row selected after escape",
  ![...rows()].some((r) => r.classList.contains("selected")),
);

click(checkboxes()[2]);
await sleep();
check(
  "unselected row drags only itself",
  (() => {
    const ids = JSON.parse(dragStart(rows()[2]).getData("text/folio-note"));
    return ids.length === 1 && ids[0] === "note-3";
  })(),
);

const trashedId = "note-1";
appState.filterTrash = false;
appState.filterFolder = null;
await store.writeNote(
  trashedId,
  { ...store.notes.get(trashedId).meta, trashed: true },
  store.notes.get(trashedId).content,
);
await idx.upsert(
  { ...store.notes.get(trashedId).meta, trashed: true },
  store.notes.get(trashedId).content,
);
appState.filterTrash = true;
await sleep();
check("trash view shows 1 row", rows().length === 1);
const trashCheckbox = checkboxes()[0];
click(trashCheckbox);
await sleep();
check(
  "trash view bulk actions",
  (() => {
    const bar = bulkBar();
    const txt = bar?.textContent ?? "";
    return (
      bar &&
      txt.includes("restore") &&
      txt.includes("delete") &&
      !txt.includes("move to")
    );
  })(),
);
check("move-to menu hidden in trash view", !el.querySelector(".bulk-move"));

appState.filterTrash = false;
await idx.upsert(
  { ...store.notes.get(trashedId).meta, trashed: false },
  store.notes.get(trashedId).content,
);
appState.filterFolder = "work";
await sleep();
check("folder filter shows 1 row", rows().length === 1);

appState.filterFolder = null;
await sleep();
click(checkboxes()[0]);
click(checkboxes()[1]);
await sleep();
click(el.querySelector(".bulk-move .bulk-btn"));
await sleep();
const ddItems = [...el.querySelectorAll(".bulk-dd .dd-item")];
check(
  "move menu lists all notes + folders",
  (() => {
    const labels = ddItems.map((d) => d.textContent.trim());
    return labels.includes("all notes") && labels.includes("work");
  })(),
);

window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
await sleep();

window.location.hash = "";
click(rows()[0]);
await sleep();
check(
  "plain click with no selection opens note",
  window.location.hash === "#/note/note-1",
);

window.location.hash = "";
modClick(rows()[0], { ctrlKey: true });
await sleep();
check(
  "ctrl+click selects without opening",
  (() => {
    return (
      rows()[0].classList.contains("selected") && window.location.hash === ""
    );
  })(),
);

modClick(rows()[2], { ctrlKey: true });
await sleep();
check("ctrl+click adds second note", bulkCount().includes("2 selected"));

modClick(rows()[0], { shiftKey: true });
await sleep();
check(
  "shift+click selects range from anchor",
  (() => {
    return (
      bulkCount().includes("3 selected") &&
      rows()[0].classList.contains("selected")
    );
  })(),
);

window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
await sleep();
modClick(rows()[2], { shiftKey: true });
await sleep();
check(
  "shift+click without anchor selects single note",
  (() => {
    const sel = [...el.querySelectorAll(".note-row.selected")].length;
    return sel === 1 && rows()[2].classList.contains("selected");
  })(),
);

click(rows()[0]);
await sleep();
check(
  "plain click with selection toggles instead of opening",
  (() => {
    return (
      rows()[0].classList.contains("selected") && window.location.hash === ""
    );
  })(),
);

click(rows()[0]);
await sleep();
check(
  "plain click on selected row unselects",
  (() => {
    return (
      !rows()[0].classList.contains("selected") && window.location.hash === ""
    );
  })(),
);

const menuWrap = rows()[0].querySelector(".note-menu-wrap");
click(menuWrap);
await sleep();
const noteMenu = el.querySelector(".note-menu");
check("three dot menu opens", !!noteMenu);
check(
  "three dot menu has standardized actions",
  noteMenu?.textContent?.includes("move to") &&
    noteMenu?.textContent?.includes("trash") &&
    noteMenu?.textContent?.includes("pin") &&
    noteMenu?.textContent?.includes("export"),
);

const moveBtn = [...noteMenu.querySelectorAll(".menu-item")].find((b) =>
  b.textContent.includes("move to"),
);
click(moveBtn);
await sleep();
check(
  "three dot menu shows folders after move to click",
  noteMenu.textContent.includes("work"),
);

const workFolderBtn = [...noteMenu.querySelectorAll(".menu-item")].find(
  (b) => b.textContent.trim() === "work",
);
click(workFolderBtn);
await sleep();
check("note moved to work folder", idx.getById("note-1")?.folder === "work");

appState.searchQuery = "body";
await sleep();
check("search matches notes", rows().length > 0);
const initialSearchCount = rows().length;
await store.writeNote(
  "note-1",
  { ...store.notes.get("note-1").meta, trashed: true },
  store.notes.get("note-1").content,
);
await idx.upsert(
  { ...store.notes.get("note-1").meta, trashed: true },
  store.notes.get("note-1").content,
);
await sleep();
check(
  "search reactively updates when note trashed",
  rows().length === initialSearchCount - 1,
);

appState.filterTrash = true;
await sleep();
check("search in trash shows trashed note", rows().length === 1);

appState.searchQuery = "";
appState.filterTrash = false;
await store.writeNote(
  "note-1",
  { ...store.notes.get("note-1").meta, trashed: false },
  store.notes.get("note-1").content,
);
await idx.upsert(
  { ...store.notes.get("note-1").meta, trashed: false },
  store.notes.get("note-1").content,
);
await sleep();

done("list-bulk");
