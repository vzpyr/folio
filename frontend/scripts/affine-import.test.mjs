import "./state-shim.mjs";
import { check, done } from "./harness.mjs";
import {
  parseImportSource,
  parseMarkdownFile,
  applyImport,
} from "../src/lib/io/import.ts";
import { zipBytes } from "../src/lib/io/zip.ts";

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
    return [...this.attachments.values()].map((a) => ({ id: a.id, ext: a.ext }));
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

const indexMd = `# Quarterly Goals

first draft for the quarter

planning documents and
roadmap drafts

* [ ] finalize budget
* [x] review timeline

![K3lX9fA7-5sTq2wE8rY4uI6oP0aZ9cV7bN3mQ1xD8fG5hJ2kL4=.png](assets/K3lX9fA7-5sTq2wE8rY4uI6oP0aZ9cV7bN3mQ1xD8fG5hJ2kL4=.png)

**important** and <u>underlined</u>

$$
E = mc^2
$$

8. alpha
9. beta

&#x20;   indented continuation line

see [budget.xlsx](assets/blob2.xlsx) and a[^1]b[^2]c[^3]

[^1]: {"type":"url","url":"https%3A%2F%2Fwww.example.com","favicon":"https%3A%2F%2Fwww.example.com%2Ffavicon.ico","title":"Example Domain","description":"An example domain"}
[^2]: {"type":"attachment","blobId":"blob1","fileName":"budget.pdf","fileType":"application/pdf"}
[^3]: {"type":"doc","docId":"deadbeef"}
`;

const zip = zipBytes({
  "index.md": enc.encode(indexMd),
  "assets/K3lX9fA7-5sTq2wE8rY4uI6oP0aZ9cV7bN3mQ1xD8fG5hJ2kL4=.png": PNG,
  "assets/blob1.pdf": enc.encode("pdf-bytes"),
  "assets/blob2.xlsx": enc.encode("xlsx-bytes"),
});

const parsed = parseImportSource(zip);
check("parses 1 affine note", parsed.notes.length === 1);
check("parses 3 attachments", parsed.attachments.size === 3);

const store = new FakeStore();
const result = await applyImport(store, new FakeIndex(), parsed);
check("imports 1 note", result.notes === 1);
check("imports 3 attachments", result.atts === 3);

const [note] = [...store.notes.values()];
const meta = note.meta;
const body = note.content;
const imageRef = body.match(/!\[\]\(assets\/([0-9a-f-]{8,36})\.png\)/);
const linkRef = body.match(/\[budget\.xlsx\]\(assets\/([0-9a-f-]{8,36})\.xlsx\)/);
const footRef = body.match(
  /\[budget\.pdf\]\(assets\/([0-9a-f-]{8,36})\.pdf "application\/pdf"\)/,
);

check("title from first h1 (not 'index')", meta.title === "Quarterly Goals");
check("h1 stays in body", body.includes("# Quarterly Goals"));
check(
  "base64-named image ref rewritten, alt dropped",
  !!imageRef && store.attachments.has(imageRef[1]),
);
check(
  "plain file link ref rewritten (older affine / obsidian / folio roundtrip)",
  !!linkRef && store.attachments.has(linkRef[1]),
);
check(
  "attachment citation footnote becomes file link",
  !!footRef && store.attachments.has(footRef[1]),
);
check(
  "url citation footnote becomes real link",
  body.includes('[Example Domain](https://www.example.com "An example domain")'),
);
check("url footnote ref + def removed", !body.includes("[^1]"));
check("attachment footnote ref + def removed", !body.includes("[^2]"));
check(
  "doc citation footnote left intact",
  body.includes("[^3]") && body.includes('{"type":"doc","docId":"deadbeef"}'),
);
check("&#x20; indentation normalized", !body.includes("&#x20;"));
check(
  "indented soft break line preserved with spaces",
  body.includes("    indented continuation line"),
);
check("task list markers preserved", body.includes("* [ ] finalize budget"));
check("checked task preserved", body.includes("* [x] review timeline"));
check("math preserved", body.includes("$$\nE = mc^2\n$$"));
check("underline html preserved", body.includes("<u>underlined</u>"));
check("ordered list start preserved", body.includes("8. alpha"));
check("no frontmatter id collision noise", note.meta.id !== undefined);

const single = parseMarkdownFile("quarterly.md", "# Quarterly Goals\n\ntext\n");
check("single md parses as one note", single.notes.length === 1);
check("single md gets folder ''", single.notes[0].folder === "");
const store2 = new FakeStore();
await applyImport(store2, new FakeIndex(), single);
const [n2] = [...store2.notes.values()];
check("single md derives title from h1", n2.meta.title === "Quarterly Goals");

const folioBody =
  "see [report.pdf](assets/cccccccc-cccc-4ccc-8ccc-cccccccccccc.pdf \"2048, application/pdf\")";
const folioZip = zipBytes({
  "index.md": enc.encode(folioBody),
  "assets/cccccccc-cccc-4ccc-8ccc-cccccccccccc.pdf": enc.encode("pdf"),
});
const store3 = new FakeStore();
await applyImport(store3, new FakeIndex(), parseImportSource(folioZip));
const [n3] = [...store3.notes.values()];
const fRef = n3.content.match(/assets\/([0-9a-f-]{8,36})\.pdf/);
check(
  "folio file chip ref re-pointed at imported attachment",
  !!fRef && store3.attachments.has(fRef[1]) && fRef[1] !== "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);

done("affine-import");
