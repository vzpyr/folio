import "./state-shim.mjs";
import { check, done } from "./harness.mjs";
import {
  parseFrontmatter,
  writeFrontmatter,
} from "../src/lib/editor/markdown.ts";
import {
  FOLDER_REGISTRY_ID,
  FolderRegistry,
  setNoteFolder,
  deleteFolder,
  pruneEmptyFolder,
  parseRegistryContent,
} from "../src/lib/store/folders.ts";

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
}

class FakeIndex {
  constructor(store) {
    this.map = new Map();
    for (const n of store.notes.values()) this.map.set(n.meta.id, n.meta);
  }
  getById(id) {
    return this.map.get(id) ?? null;
  }
  upsert(meta) {
    this.map.set(meta.id, meta);
  }
  get notes() {
    return [...this.map.values()];
  }
  get list() {
    return this.notes.filter((n) => !n.trashed);
  }
  get all() {
    return this.notes;
  }
}

const store = new FakeStore();
const index = new FakeIndex(store);
const reg = new FolderRegistry();

await reg.load(store);
check("empty vault → no folders", reg.names.length === 0);
check("ensure creates", (await reg.ensure(store, "work")) === "created");
check(
  "ensure dedupes case-insensitively",
  (await reg.ensure(store, "Work")) === "exists",
);
check(
  "registry has one name",
  reg.names.length === 1 && reg.names[0] === "work",
);
check("find is case-insensitive", reg.find("WORK") === "work");
check("registry note written to store", store.notes.has(FOLDER_REGISTRY_ID));

const raw = store.notes.get(FOLDER_REGISTRY_ID).content;
const names = parseRegistryContent(raw);
check("registry note round-trips", names.length === 1 && names[0] === "work");
check(
  "registry meta flagged dirty for sync",
  store.notes.get(FOLDER_REGISTRY_ID).meta.dirty === true,
);
check(
  "registry rev starts at -1 (new note → base_rev 0)",
  store.notes.get(FOLDER_REGISTRY_ID).meta.rev === -1,
);

const a = crypto.randomUUID();
const b = crypto.randomUUID();
store.writeNote(
  a,
  {
    id: a,
    title: "note a",
    folder: "",
    tags: [],
    pinned: false,
    created: 1,
    updated: 1,
    rev: 1,
    conflict: false,
    dirty: false,
  },
  writeFrontmatter(
    {
      id: a,
      title: "note a",
      created: 1,
      updated: 1,
      tags: [],
      pinned: false,
      folder: "",
    },
    "body a",
  ),
);
store.writeNote(
  b,
  {
    id: b,
    title: "note b",
    folder: "",
    tags: [],
    pinned: false,
    created: 1,
    updated: 1,
    rev: 1,
    conflict: false,
    dirty: false,
  },
  writeFrontmatter(
    {
      id: b,
      title: "note b",
      created: 1,
      updated: 1,
      tags: [],
      pinned: false,
      folder: "",
    },
    "body b",
  ),
);
index.upsert(store.notes.get(a).meta);
index.upsert(store.notes.get(b).meta);

await setNoteFolder(store, index, a, "work", reg);
let fmA = parseFrontmatter(store.notes.get(a).content);
check(
  "bind → folder in frontmatter",
  fmA.meta.folder === "work",
  JSON.stringify(fmA.meta),
);
check(
  "bind marks note dirty (sync will push)",
  store.notes.get(a).meta.dirty === true,
);
check("bind updates index", index.getById(a).folder === "work");

await setNoteFolder(store, index, b, "recipes", reg);
check("bind creates new folder", reg.find("recipes") === "recipes");

const before = store.notes.get(b).meta.updated;
await setNoteFolder(store, index, b, "Recipes", reg);
check("same folder → no rewrite", store.notes.get(b).meta.updated === before);

const folderOf = (id) =>
  parseFrontmatter(store.notes.get(id).content).meta.folder ?? "";

await setNoteFolder(store, index, b, "", reg);
check("unbind → folder empty", folderOf(b) === "");
check(
  "last note leaves → folder pruned from registry",
  reg.find("recipes") === null,
);

await setNoteFolder(store, index, b, "recipes", reg);
check("re-bind recreates folder", reg.find("recipes") === "recipes");

const e = crypto.randomUUID();
const f = crypto.randomUUID();
store.writeNote(
  e,
  {
    id: e,
    title: "note e",
    folder: "",
    tags: [],
    pinned: false,
    created: 1,
    updated: 1,
    rev: 1,
    conflict: false,
    dirty: false,
  },
  writeFrontmatter(
    {
      id: e,
      title: "note e",
      created: 1,
      updated: 1,
      tags: [],
      pinned: false,
      folder: "",
    },
    "body e",
  ),
);
store.writeNote(
  f,
  {
    id: f,
    title: "note f",
    folder: "",
    tags: [],
    pinned: false,
    created: 1,
    updated: 1,
    rev: 1,
    conflict: false,
    dirty: false,
  },
  writeFrontmatter(
    {
      id: f,
      title: "note f",
      created: 1,
      updated: 1,
      tags: [],
      pinned: false,
      folder: "",
    },
    "body f",
  ),
);
index.upsert(store.notes.get(e).meta);
index.upsert(store.notes.get(f).meta);
await setNoteFolder(store, index, e, "team", reg);
await setNoteFolder(store, index, f, "team", reg);
await setNoteFolder(store, index, e, "work", reg);
check("folder survives while a note remains", reg.find("team") === "team");
check("note e bound to new folder", folderOf(e) === "work");
await setNoteFolder(store, index, f, "", reg);
check("folder pruned when last note leaves", reg.find("team") === null);

await setNoteFolder(store, index, b, "recipes", reg);

await deleteFolder(store, index, "recipes", reg);
check("delete removes registry name", reg.find("recipes") === null);
check("delete unbinds notes → all notes", folderOf(b) === "");
check("delete keeps the note", store.notes.has(b));
check(
  "work folder untouched",
  reg.find("work") === "work" &&
    store.notes.get(a).content.includes("folder: work"),
);

const c = crypto.randomUUID();
const d = crypto.randomUUID();
store.writeNote(
  c,
  {
    id: c,
    title: "note c",
    folder: "",
    tags: [],
    pinned: false,
    created: 1,
    updated: 1,
    rev: 1,
    conflict: false,
    dirty: false,
  },
  writeFrontmatter(
    {
      id: c,
      title: "note c",
      created: 1,
      updated: 1,
      tags: [],
      pinned: false,
      folder: "",
    },
    "body c",
  ),
);
store.writeNote(
  d,
  {
    id: d,
    title: "note d",
    folder: "",
    tags: [],
    pinned: false,
    created: 1,
    updated: 1,
    rev: 1,
    conflict: false,
    dirty: false,
  },
  writeFrontmatter(
    {
      id: d,
      title: "note d",
      created: 1,
      updated: 1,
      tags: [],
      pinned: false,
      folder: "",
    },
    "body d",
  ),
);
index.upsert(store.notes.get(c).meta);
index.upsert(store.notes.get(d).meta);
await setNoteFolder(store, index, c, "stuff", reg);
await setNoteFolder(store, index, d, "stuff", reg);
const metaC = index.getById(c);
const trashedC = { ...metaC, trashed: true, dirty: true };
await store.writeNote(c, trashedC, store.notes.get(c).content);
index.upsert(trashedC);
check(
  "trashed note hidden from list",
  index.list.find((n) => n.id === c) === undefined,
);
check(
  "trashed note still visible in all",
  index.all.find((n) => n.id === c) !== undefined,
);
await deleteFolder(store, index, "stuff", reg);
check("delete folder unbinds trashed note", folderOf(c) === "");
check("delete folder unbinds visible note", folderOf(d) === "");
check("stuff gone from registry", reg.find("stuff") === null);

const g = crypto.randomUUID();
const h = crypto.randomUUID();
store.writeNote(
  g,
  {
    id: g,
    title: "note g",
    folder: "",
    tags: [],
    pinned: false,
    created: 1,
    updated: 1,
    rev: 1,
    conflict: false,
    dirty: false,
  },
  writeFrontmatter(
    {
      id: g,
      title: "note g",
      created: 1,
      updated: 1,
      tags: [],
      pinned: false,
      folder: "",
    },
    "body g",
  ),
);
store.writeNote(
  h,
  {
    id: h,
    title: "note h",
    folder: "",
    tags: [],
    pinned: false,
    created: 1,
    updated: 1,
    rev: 1,
    conflict: false,
    dirty: false,
  },
  writeFrontmatter(
    {
      id: h,
      title: "note h",
      created: 1,
      updated: 1,
      tags: [],
      pinned: false,
      folder: "",
    },
    "body h",
  ),
);
index.upsert(store.notes.get(g).meta);
index.upsert(store.notes.get(h).meta);
await setNoteFolder(store, index, g, "temp", reg);
await setNoteFolder(store, index, h, "temp", reg);
const trashedG = { ...index.getById(g), trashed: true, dirty: true };
await store.writeNote(g, trashedG, store.notes.get(g).content);
index.upsert(trashedG);
check(
  "trashed note hidden from list",
  index.list.find((n) => n.id === g) === undefined,
);
await setNoteFolder(store, index, h, "", reg);
check("prune removes folder", reg.find("temp") === null);
check("prune unbinds trashed straggler", folderOf(g) === "");

const i = crypto.randomUUID();
store.writeNote(
  i,
  {
    id: i,
    title: "note i",
    folder: "",
    tags: [],
    pinned: false,
    created: 1,
    updated: 1,
    rev: 1,
    conflict: false,
    dirty: false,
  },
  writeFrontmatter(
    {
      id: i,
      title: "note i",
      created: 1,
      updated: 1,
      tags: [],
      pinned: false,
      folder: "",
    },
    "body i",
  ),
);
index.upsert(store.notes.get(i).meta);
await setNoteFolder(store, index, i, "gone", reg);
const trashedI = { ...index.getById(i), trashed: true, dirty: true };
await store.writeNote(i, trashedI, store.notes.get(i).content);
index.upsert(trashedI);
check("folder exists while trashed note bound", reg.find("gone") === "gone");
store.notes.delete(i);
index.map.delete(i);
await pruneEmptyFolder(store, index, "gone", reg);
check("permanent delete prunes empty folder", reg.find("gone") === null);

store.writeNote(
  FOLDER_REGISTRY_ID,
  {
    id: FOLDER_REGISTRY_ID,
    title: "folio folders",
    folder: "",
    tags: [],
    pinned: false,
    created: 1,
    updated: 1,
    rev: 1,
    conflict: false,
    dirty: false,
  },
  "---\nid: x\ntitle: folio folders\n---\n\nnot json at all",
);
const reg2 = new FolderRegistry();
await reg2.load(store);
check("corrupt registry → empty, no crash", reg2.names.length === 0);

done("folders");
