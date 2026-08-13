import "./state-shim.mjs";
import { check, done } from "./harness.mjs";
import {
  detectImportSource,
  parseImportSource,
  applyImport,
} from "../src/lib/io/import.ts";
import { zipBytes, unzip } from "../src/lib/io/zip.ts";

class FakeStore {
  notes = new Map();
  attachments = new Map();
  async listNotes() {
    return [...this.notes.values()].map((n) => n.meta);
  }
  async readNote(id) {
    return this.notes.get(id)?.content ?? null;
  }
  async writeNote(id, meta, content) {
    this.notes.set(id, { meta, content });
  }
  async listAttachments() {
    return [...this.attachments.values()].map((a) => ({
      id: a.id,
      ext: a.ext,
    }));
  }
  async readAttachment(id) {
    return this.attachments.get(id)?.bytes ?? null;
  }
  async writeAttachment(id, ext, bytes) {
    this.attachments.set(id, { id, ext, bytes });
  }
}
class FakeIndex {
  map = new Map();
  async upsert(meta) {
    this.map.set(meta.id, meta);
  }
}

const enc = new TextEncoder();
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function keepZip(notes, files = {}) {
  const entries = {};
  for (const [name, note] of Object.entries(notes)) {
    entries[`Takeout/Keep/${name}.json`] = enc.encode(
      JSON.stringify(note, null, 2),
    );
  }
  for (const [name, bytes] of Object.entries(files)) {
    entries[`Takeout/Keep/${name}`] = bytes;
  }
  return zipBytes(entries);
}

const textNote = {
  title: "Groceries",
  textContent: "Groceries\n\nmilk and eggs",
  labels: [{ name: "errands" }, { name: "home" }],
  isPinned: true,
  createdTimestampUsec: 1600000000000000,
  userEditedTimestampUsec: 1600000000123456,
  attachments: [],
};
const listNote = {
  textContent: "",
  listContent: [
    { text: "buy milk", isChecked: true },
    { text: "call mom", isChecked: false },
  ],
  labels: [],
};
const imgNote = {
  title: "Whiteboard",
  textContent: "Whiteboard\n\nsketch of the plan",
  labels: [],
  attachments: [{ name: "whiteboard.png", mimetype: "image/png" }],
};
const trashNote = {
  title: "Junk",
  textContent: "Junk\n\nshould not appear",
  labels: [],
  isTrashed: true,
};

const keepZipBytes = keepZip(
  { textNote, listNote, imgNote, trashNote },
  {
    "whiteboard.png": PNG,
  },
);
check(
  "detect google keep zip",
  detectImportSource(unzip(keepZipBytes)) === "keep",
);
const keepParsed = parseImportSource(keepZipBytes);
check("keep parses 3 notes (trash skipped)", keepParsed.notes.length === 3);
check("keep parses 1 attachment", keepParsed.attachments.size === 1);
check(
  "keep notes land in root folder",
  keepParsed.notes.every((n) => n.folder === ""),
);

const mdZip = zipBytes({
  "Note A.md": enc.encode("# Note A\n\ntext"),
  "assets/pic.png": PNG,
});
check(
  "detect generic markdown zip",
  detectImportSource(unzip(mdZip)) === "markdown",
);

const obsidianZip = zipBytes({
  ".obsidian/app.json": enc.encode("{}"),
  "Home.md": enc.encode("[[Other]]"),
  "images/photo.png": PNG,
});
const obsidianDetected = detectImportSource(unzip(obsidianZip));
check("detect obsidian vault", obsidianDetected === "obsidian");
const obsidianParsed = parseImportSource(obsidianZip);
check(
  ".obsidian config skipped, attachments anywhere imported",
  obsidianParsed.notes.length === 1 &&
    obsidianParsed.attachments.has("images/photo.png"),
);

const notionZip = zipBytes({
  "index.html": enc.encode("<html></html>"),
  "Section/My Page 8f2a1b3c4d5e6f7a.md": enc.encode("# My Page\n\ntext"),
});
check(
  "detect notion export by uuid filenames",
  detectImportSource(unzip(notionZip)) === "notion",
);

const affineZip = zipBytes({
  "index.md": enc.encode("# Index"),
  "assets/a.png": PNG,
});
check(
  "detect affine export",
  detectImportSource(unzip(affineZip)) === "affine",
);

const store = new FakeStore();
const result = await applyImport(store, new FakeIndex(), keepParsed);
check("imports 3 keep notes", result.notes === 3);
check("imports 1 keep attachment", result.atts === 1);

const notes = [...store.notes.values()];
const byTitle = new Map(notes.map((n) => [n.meta.title, n]));
check("has groceries note", byTitle.has("Groceries"));
check(
  "keep title from json, not duplicated in body",
  byTitle.get("Groceries")?.content.includes("milk and eggs"),
);
check(
  "keep labels become tags",
  byTitle.get("Groceries")?.meta.tags.join(",") === "errands,home",
);
check("keep pinned preserved", byTitle.get("Groceries")?.meta.pinned === true);
check(
  "keep created parsed",
  byTitle.get("Groceries")?.meta.created === 1600000000000,
);
check(
  "keep updated parsed",
  byTitle.get("Groceries")?.meta.updated === 1600000000123,
);

const listContent = byTitle.get("Groceries")?.content;
check("trash note not imported", !byTitle.has("Junk"));

const listNoteStore = notes.find((n) => n.meta.title !== "Groceries");
const listBody = listNoteStore?.content ?? "";
check(
  "checklist items become checkboxes",
  listBody.includes("- [x] buy milk") && listBody.includes("- [ ] call mom"),
);

const imgNoteStore = notes.find((n) => n.meta.title === "Whiteboard");
const imgBody = imgNoteStore?.content ?? "";
const imgRef = imgBody.match(/!\[[^\]]*\]\(assets\/([0-9a-f-]{8,36})\.png\)/);
check(
  "keep attachment embedded and re-pointed at imported asset",
  !!imgRef && store.attachments.has(imgRef[1]),
);

const obsidianStore = new FakeStore();
await applyImport(obsidianStore, new FakeIndex(), obsidianParsed);
const [obsNote] = [...obsidianStore.notes.values()];
check(
  "obsidian transclusion becomes wiki-link",
  obsNote.content.includes("[[Other]]"),
);

done("keep-import");
