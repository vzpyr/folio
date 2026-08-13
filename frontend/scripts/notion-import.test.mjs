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

const U1 = "8f2a1b3c4d5e6f7a8b9c0d1e2f3a4b5c";
const U2 = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
const U3 = "deadbeefdeadbeefdeadbeefdeadbeef";
const U4 = "0123456789abcdef0123456789abcdef";

const myPage = `# My Page

Intro with [sub page link](Sub%20Page%20${U2}.md) and [alias](Sub%20Page%20${U2}.md).

![shot](My%20Page%20${U1}/shot.png)

[external](https://example.com/docs/page.md) stays a url
`;

const subPage = `# Sub Page

back to [My Page](My%20Page%20${U1}.md)
`;

const hashKid = `# Hash Kid

child of a hash-named folder
`;

const zip = zipBytes({
  "index.html": enc.encode("<html><body>sitemap</body></html>"),
  "index.md": enc.encode(`# Sitemap\n\n[My Page](My%20Page%20${U1}.md)`),
  [`Section A/My Page ${U1}.md`]: enc.encode(myPage),
  [`Section A/My Page ${U1}/shot.png`]: PNG,
  [`Section A/My Page ${U1}/Sub Page ${U2}.md`]: enc.encode(subPage),
  [`Section A/${U3}/Hash Kid ${U4}.md`]: enc.encode(hashKid),
  "Section A/Database xyz789.csv": enc.encode("a,b\n1,2"),
});

check("detect notion export", detectImportSource(unzip(zip)) === "notion");

const parsed = parseImportSource(zip);
check("notion parses 3 notes", parsed.notes.length === 3);
check("notion parses 1 attachment", parsed.attachments.size === 1);
check(
  "csv skipped",
  [...parsed.attachments.keys()].every((k) => !k.endsWith(".csv")),
);

const byPath = new Map(parsed.notes.map((n) => [n.path, n]));
check("uuid stripped from page filename", byPath.has("Section A/My Page.md"));
check(
  "uuid stripped from subpage filename",
  byPath.has("Section A/My Page/Sub Page.md"),
);
check("hash folder dropped", byPath.has("Section A/Hash Kid.md"));
check("index.md sitemap skipped", !byPath.has("index.md"));
check(
  "page folder preserved",
  byPath.get("Section A/My Page.md")?.folder === "Section A",
);
check(
  "subpage folder preserved",
  byPath.get("Section A/My Page/Sub Page.md")?.folder === "Section A/My Page",
);
check(
  "hash kid lands in parent folder",
  byPath.get("Section A/Hash Kid.md")?.folder === "Section A",
);

const store = new FakeStore();
const result = await applyImport(store, new FakeIndex(), parsed);
check("imports 3 notion notes", result.notes === 3);
check("imports notion attachment", result.atts === 1);

const byTitle = new Map(
  [...store.notes.values()].map((n) => [n.meta.title, n]),
);
check("my page title clean", byTitle.has("My Page"));
check("sub page title clean", byTitle.has("Sub Page"));
check("hash kid title clean", byTitle.has("Hash Kid"));

const myBody = byTitle.get("My Page")?.content ?? "";
check(
  "page link becomes wiki-link",
  myBody.includes("[[Sub Page|sub page link]]"),
);
check("page link alias preserved", myBody.includes("[[Sub Page|alias]]"));
check(
  "external .md url untouched",
  myBody.includes("[external](https://example.com/docs/page.md) stays a url"),
);
const imgRef = myBody.match(/!\[[^\]]*\]\(assets\/([0-9a-f-]{8,36})\.png\)/);
check(
  "folder-relative image re-pointed",
  !!imgRef && store.attachments.has(imgRef[1]),
);

const subBody = byTitle.get("Sub Page")?.content ?? "";
check("reverse link becomes wiki-link", subBody.includes("[[My Page]]"));

done("notion-import");
