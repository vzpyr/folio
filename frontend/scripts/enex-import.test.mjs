import "./state-shim.mjs";
import { check, done } from "./harness.mjs";
import { parseEnexFile, md5Hex } from "../src/lib/io/enex.ts";
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
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0x03,
]);
const pdfBytes = enc.encode("%PDF-1.4 fake");
const b64 = (bytes) => Buffer.from(bytes).toString("base64");

check(
  "md5 known vector",
  md5Hex(enc.encode("abc")) === "900150983cd24fb0d6963f7d28e17f72",
);

const pngHash = md5Hex(PNG);
const pdfHash = md5Hex(pdfBytes);

const enex = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE en-export SYSTEM "http://xml.evernote.com/pub/evernote-export.dtd">
<en-export export-date="20240101T000000Z" application="Evernote" version="10.0">
<note>
<title>Meeting &amp; Budget</title>
<created>20230115T093000Z</created>
<updated>20230115T100000Z</updated>
<tag>work</tag>
<tag>project alpha</tag>
<content><![CDATA[<!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd">
<en-note><div>Discuss <b>budget</b> for Q3.</div><div><br/></div><ul><li><div>alpha</div></li><li><div>beta</div></li></ul></en-note>]]></content>
</note>
<note>
<title>Whiteboard</title>
<created>20230201T120000Z</created>
<updated>20230201T120000Z</updated>
<content><![CDATA[<en-note><div>Sketch:</div><div><en-media type="image/png" hash="${pngHash}"/></div></en-note>]]></content>
<resource>
<data encoding="base64">${b64(PNG)}</data>
<mime>image/png</mime>
<width>4</width><height>4</height>
<resource-attributes><file-name>sketch.png</file-name></resource-attributes>
</resource>
</note>
<note>
<title>Spec</title>
<created>20230202T090000Z</created>
<updated>20230202T090000Z</updated>
<content><![CDATA[<en-note><div>See <en-media type="application/pdf" hash="${pdfHash}"/> for details.</div></en-note>]]></content>
<resource>
<data encoding="base64">${b64(pdfBytes)}</data>
<mime>application/pdf</mime>
<resource-attributes><file-name>spec.pdf</file-name></resource-attributes>
</resource>
</note>
<note>
<title>Tasks</title>
<content><![CDATA[<en-note><div><en-todo/>Buy milk</div><div><en-todo checked="true"/>Call mom</div></en-note>]]></content>
</note>
<note>
<title>Code</title>
<content><![CDATA[<en-note><div>Example:</div><pre><![CDATA[const x = 1;]]></pre></en-note>]]></content>
</note>
<note>
<title>Table</title>
<content><![CDATA[<en-note><table><tr><td>A</td><td>B</td></tr><tr><td>1</td><td>2</td></tr></table></en-note>]]></content>
</note>
<note>
<title>Hidden</title>
<note-attributes><active>false</active></note-attributes>
<content><![CDATA[<en-note><div>x</div></en-note>]]></content>
</note>
</en-export>`;

const parsed = parseEnexFile(enc.encode(enex));
check("enex parses 6 notes (inactive skipped)", parsed.notes.length === 6);
check("enex parses 2 resources", parsed.attachments.size === 2);

const zip = zipBytes({ "Notebook.enex": enc.encode(enex) });
check("detect evernote zip", detectImportSource(unzip(zip)) === "evernote");
const parsedZip = parseImportSource(zip);
check("zip with enex parses", parsedZip.notes.length === 6);

const store = new FakeStore();
const result = await applyImport(store, new FakeIndex(), parsed);
check("imports 6 enex notes", result.notes === 6);
check("imports 2 enex attachments", result.atts === 2);

const byTitle = new Map(
  [...store.notes.values()].map((n) => [n.meta.title, n]),
);
check("hidden note skipped", !byTitle.has("Hidden"));

const meeting = byTitle.get("Meeting & Budget");
check("title entities decoded", !!meeting);
check("tags preserved", meeting?.meta.tags.join(",") === "work,project alpha");
check(
  "created parsed",
  meeting?.meta.created === Date.parse("2023-01-15T09:30:00Z"),
);
check("bold converted", meeting?.content.includes("**budget**"));
check(
  "list items converted",
  meeting?.content.includes("- alpha") && meeting?.content.includes("- beta"),
);

const whiteboard = byTitle.get("Whiteboard")?.content ?? "";
const imgRef = whiteboard.match(
  /!\[[^\]]*\]\(assets\/([0-9a-f-]{8,36})\.png\)/,
);
check(
  "image embedded and re-pointed",
  !!imgRef &&
    store.attachments.has(imgRef[1]) &&
    store.attachments.get(imgRef[1])?.bytes.length === PNG.length,
);

const spec = byTitle.get("Spec")?.content ?? "";
const pdfRef = spec.match(/\[spec\.pdf\]\(assets\/([0-9a-f-]{8,36})\.pdf\)/);
check("pdf attachment linked", !!pdfRef && store.attachments.has(pdfRef[1]));

const tasks = byTitle.get("Tasks")?.content ?? "";
check("unchecked todo", tasks.includes("- [ ] Buy milk"));
check("checked todo", tasks.includes("- [x] Call mom"));

const code = byTitle.get("Code")?.content ?? "";
check(
  "code block preserved",
  code.includes("```") && code.includes("const x = 1;"),
);

const table = byTitle.get("Table")?.content ?? "";
check(
  "table converted",
  table.includes("| A | B |") &&
    table.includes("| --- | --- |") &&
    table.includes("| 1 | 2 |"),
);

done("enex-import");
