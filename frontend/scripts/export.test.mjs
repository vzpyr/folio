import "./state-shim.mjs";
import { check, done } from "./harness.mjs";
import {
  buildExportZip,
  sanitizeFileName,
  extractAttachmentRefs,
} from "../src/lib/io/export.ts";
import { parseImportSource, applyImport } from "../src/lib/io/import.ts";
import { unzip } from "../src/lib/io/zip.ts";

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

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3,
]);
const A_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ATT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function note(id, title, folder, body) {
  return {
    meta: {
      id,
      title,
      folder,
      tags: [],
      pinned: false,
      created: 1,
      updated: 1,
      rev: 1,
      conflict: false,
      dirty: false,
    },
    content: `---\nid: ${id}\ntitle: ${title}\n---\n\n${body}`,
  };
}

const store = new FakeStore();
store.notes.set(
  A_ID,
  note(A_ID, "alpha", "work", `hello ![img](assets/${ATT}.png)\n`),
);
store.notes.set(B_ID, note(B_ID, "beta", "", "root note\n"));
store.attachments.set(ATT, { id: ATT, ext: "png", bytes: PNG });

const zip = await buildExportZip(store, "testvaultid");
const entries = unzip(zip);

check(
  "export has folder note at work/alpha.md",
  entries["work/alpha.md"] !== undefined,
);
check("export has root note at beta.md", entries["beta.md"] !== undefined);
check(
  "export has attachment at assets/" + ATT + ".png",
  entries[`assets/${ATT}.png`] !== undefined,
);
check("export has readme.txt", entries["README.txt"] !== undefined);

const parsed = parseImportSource(zip);
check("import parses 2 notes", parsed.notes.length === 2);
check(
  "import derives folder from path",
  parsed.notes.find((n) => n.path === "work/alpha.md")?.folder === "work",
);
check("import parses 1 attachment", parsed.attachments.size === 1);

const target = new FakeStore();
const result = await applyImport(target, new FakeIndex(), parsed);
check("import writes 2 notes", result.notes === 2);
const attWritten = [...target.attachments.values()];
check(
  "import writes 1 attachment",
  result.atts === 1 && attWritten.length === 1,
);
const alpha = target.notes.get(A_ID);
check("import preserves original id (no collision)", alpha !== undefined);
const refMatch = alpha?.content.match(/assets\/([0-9a-f-]{8,36})\.png/);
check(
  "import rewrites asset ref to fresh attachment id",
  !!refMatch && target.attachments.has(refMatch[1]),
);
check(
  "attachment bytes preserved",
  attWritten.length === 1 && attWritten[0].bytes.length === PNG.length,
);

const again = new FakeStore();
again.notes.set(A_ID, note(A_ID, "alpha", "work", "existing\n"));
const collision = await applyImport(
  again,
  new FakeIndex(),
  parseImportSource(zip),
);
check(
  "id collision → fresh id, never overwrite",
  collision.skipped === 1 && again.notes.has(A_ID) && again.notes.size === 3,
);
check(
  "collision note titled with (imported ...)",
  [...again.notes.values()].some((n) => n.meta.title.includes("(imported ")),
);

check(
  "sanitizefilename strips illegal chars",
  sanitizeFileName("a/b:c*d?e") === "a-b-c-d-e",
);
check(
  "sanitizefilename trims trailing dots/spaces",
  sanitizeFileName("name. ") === "name",
);
check(
  "sanitizefilename falls back to untitled",
  sanitizeFileName("") === "untitled",
);

const refs = extractAttachmentRefs(
  `![x](assets/${ATT}.png) and [f](assets/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.bin)`,
);
check("extractattachmentrefs finds refs", refs.size === 2 && refs.has(ATT));

done("export");
