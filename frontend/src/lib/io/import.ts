import type { VaultStore, NoteIndex, NoteMeta } from "../store/store.svelte.ts";
import { parseFrontmatter, writeFrontmatter } from "../editor/markdown.ts";
import { sanitizeFileName, sanitizeFolderPath } from "./export.ts";
import { unzip } from "./zip.ts";
import { isFolderRegistryId } from "../store/folders.ts";
import { parseEnexEntries } from "./enex.ts";

export { parseEnexFile } from "./enex.ts";

export interface RawNote {
  path: string;
  folder: string;
  content: string;
}

export interface ParsedImport {
  notes: RawNote[];
  attachments: Map<string, Uint8Array<ArrayBuffer>>;
  source?: ImportSource;
}

export type ImportSource =
  "auto" | "markdown" | "affine" | "notion" | "obsidian" | "keep" | "evernote";

export interface ImportResult {
  notes: number;
  atts: number;
  skipped: number;
  collisions: string[];
}

function isSkippedPath(rel: string): boolean {
  if (rel === "" || rel.endsWith("/") || rel.startsWith("__MACOSX/"))
    return true;

  return rel.split("/").some((seg) => seg.startsWith("."));
}

function attachmentDir(path: string): { key: string } | null {
  const m = /(?:^|\/)(assets|attachments?)\/(.+)$/i.exec(path);
  if (!m) return null;

  return { key: m[2].replace(/^\.\//, "") };
}

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  if (i <= 0 || i === name.length - 1) return "bin";

  const ext = name
    .slice(i + 1)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

  return ext || "bin";
}

function normalizeRef(ref: string): string {
  const r = ref.trim().replace(/^\.\//, "").replace(/^\/+/, "");

  return attachmentDir(r)?.key ?? r;
}

function transformOutsideFences(
  body: string,
  fn: (line: string) => string,
): string {
  const lines = body.split("\n");
  let inFence = false;
  const out: string[] = [];

  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    out.push(inFence ? line : fn(line));
  }

  return out.join("\n");
}

function normalizeAffineEscapes(body: string): string {
  return transformOutsideFences(body, (line) =>
    line.startsWith("&#x20;") ? line.replace(/&#x20;/g, " ") : line,
  );
}

function normalizeContent(text: string): string {
  return normalizeAffineEscapes(text.replace(/\r\n/g, "\n"));
}

export function parseMarkdownFile(name: string, text: string): ParsedImport {
  const rel = name.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
  const path = /\.md$/i.test(rel) ? rel : `${rel}.md`;

  return {
    notes: [{ path, folder: folderFor(path), content: normalizeContent(text) }],
    attachments: new Map(),
  };
}

export function detectImportSource(
  entries: Record<string, Uint8Array>,
): ImportSource {
  const names = Object.keys(entries);
  const has = (re: RegExp) => names.some((n) => re.test(n));

  if (has(/\.enex$/i)) return "evernote";
  if (has(/(?:^|\/)Keep\/[^/]+\.json$/i)) return "keep";
  if (has(/(?:^|\/)\.obsidian(?:\/|$)/)) return "obsidian";
  if (has(/ [0-9a-f]{8,32}\.md$/i)) return "notion";
  if (has(/(?:^|\/)index\.md$/) && has(/(?:^|\/)assets\//)) return "affine";

  return "markdown";
}

export function detectImportFile(bytes: Uint8Array): ImportSource {
  return detectImportSource(unzip(bytes));
}

export function parseImportSource(
  bytes: Uint8Array,
  source: ImportSource = "auto",
): ParsedImport {
  const entries = unzip(bytes);
  const resolved = source === "auto" ? detectImportSource(entries) : source;

  if (resolved === "keep") return parseKeepImport(entries);
  if (resolved === "evernote") return parseEnexEntries(entries);

  return parseMarkdownZip(entries, resolved);
}

function parseMarkdownZip(
  entries: Record<string, Uint8Array>,
  source: ImportSource,
): ParsedImport {
  const notes: RawNote[] = [];
  const attachments = new Map<string, Uint8Array<ArrayBuffer>>();
  const dec = new TextDecoder();

  for (const [rawPath, data] of Object.entries(entries)) {
    const rel = rawPath
      .replace(/\\/g, "/")
      .replace(/^\.\//, "")
      .replace(/^\/+/, "");

    if (isSkippedPath(rel)) continue;

    if (/\.md$/i.test(rel)) {
      if (source === "notion" && /^index\.md$/i.test(rel)) continue;

      notes.push({
        path: source === "notion" ? notionCleanPath(rel) : rel,
        folder: source === "notion" ? notionFolderFor(rel) : folderFor(rel),
        content:
          source === "notion"
            ? rewriteNotionLinks(normalizeContent(dec.decode(data)))
            : normalizeContent(dec.decode(data)),
      });
    } else if (
      source === "obsidian" ||
      source === "notion" ||
      attachmentDir(rel)
    ) {
      if (source === "notion" && /\.(?:csv|html?)$/i.test(rel)) continue;

      attachments.set(rel, Uint8Array.from(data));
    }
  }

  return { notes, attachments, source };
}

function stripNotionUuid(name: string): string {
  return name.replace(/\s+[0-9a-f]{8,32}$/i, "");
}

function notionCleanPath(rel: string): string {
  return rel
    .split("/")
    .map((seg) => {
      const isMd = /\.md$/i.test(seg);
      const base = seg.replace(/\.md$/i, "");
      if (!isMd && /^[0-9a-f]{8,32}$/i.test(base)) return "";

      const cleaned = stripNotionUuid(base);

      return isMd ? `${cleaned}.md` : cleaned;
    })
    .filter(Boolean)
    .join("/");
}

function notionFolderFor(rel: string): string {
  const parts = notionCleanPath(rel).split("/");
  parts.pop();

  return sanitizeFolderPath(parts.join("/"));
}

function rewriteNotionLinks(body: string): string {
  return body.replace(
    /(!?)\[([^\]]+)\]\(([^)\s]+\.md)(?:\s+["'][^"']*["'])?\)/gi,
    (_m, bang: string, text: string, href: string) => {
      if (bang) return _m;

      let target = href;
      try {
        target = decodeURIComponent(href);
      } catch {
        return _m;
      }
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(target)) return _m;

      const base = target.split("/").pop() ?? "";
      const title = stripNotionUuid(base.replace(/\.md$/i, "")).trim();
      if (!title) return _m;

      return title === text ? `[[${title}]]` : `[[${title}|${text}]]`;
    },
  );
}

interface KeepListContent {
  text?: string;
  isChecked?: boolean;
}

interface KeepAttachment {
  name?: string;
  mimetype?: string;
}

interface KeepNote {
  title?: string;
  textContent?: string;
  listContent?: KeepListContent[];
  labels?: { name?: string }[];
  isPinned?: boolean;
  isArchived?: boolean;
  isTrashed?: boolean;
  createdTimestampUsec?: number;
  userEditedTimestampUsec?: number;
  attachments?: KeepAttachment[];
}

const KEEP_JSON_RE = /(?:^|\/)Keep\/[^/]+\.json$/i;

function parseKeepImport(entries: Record<string, Uint8Array>): ParsedImport {
  const dec = new TextDecoder();
  const paths = Object.keys(entries);

  const jsonPaths = paths.filter((p) => KEEP_JSON_RE.test(p));
  const keepFiles =
    jsonPaths.length > 0
      ? jsonPaths
      : paths.filter((p) => /^[^/]+\.json$/i.test(p) && !isSkippedPath(p));

  const filesByBase = new Map<string, { bytes: Uint8Array }>();
  for (const p of paths) {
    if (isSkippedPath(p)) continue;
    if (/\.(?:json|html)$/i.test(p)) continue;

    const base = p.split("/").pop() ?? "";
    if (base && !filesByBase.has(base))
      filesByBase.set(base, { bytes: entries[p] });
  }

  const notes: RawNote[] = [];
  const attachments = new Map<string, Uint8Array<ArrayBuffer>>();

  for (const p of keepFiles) {
    let note: KeepNote;
    try {
      note = JSON.parse(dec.decode(entries[p])) as KeepNote;
    } catch {
      continue;
    }
    if (note.isTrashed) continue;

    const text = note.textContent ?? "";
    const title =
      (note.title ?? "").trim() || text.split("\n")[0].trim() || "untitled";
    let body = text;
    if (title && body.startsWith(title)) {
      body = body.slice(title.length).replace(/^\n+/, "");
    }

    const items = (note.listContent ?? [])
      .filter((i) => typeof i.text === "string")
      .map((i) => `- [${i.isChecked ? "x" : " "}] ${i.text}`)
      .join("\n");
    if (items) body = body ? `${body}\n\n${items}` : items;

    const refs: string[] = [];
    for (const att of note.attachments ?? []) {
      const name = (att.name ?? "").split("/").pop() ?? "";
      if (!name || !filesByBase.has(name)) continue;

      const target = `assets/${name}`;
      if (!attachments.has(target)) {
        attachments.set(target, Uint8Array.from(filesByBase.get(name)!.bytes));
      }
      refs.push(`![${name}](assets/${name})`);
    }
    if (refs.length)
      body = body ? `${body}\n\n${refs.join("\n\n")}` : refs.join("\n\n");

    const labels = (note.labels ?? [])
      .map((l) => l.name)
      .filter((n): n is string => !!n);
    const lines = ["---"];
    lines.push(`title: ${title.replace(/\n/g, " ")}`);
    if (note.createdTimestampUsec) {
      lines.push(
        `created: ${new Date(note.createdTimestampUsec / 1000).toISOString()}`,
      );
    }
    if (note.userEditedTimestampUsec) {
      lines.push(
        `updated: ${new Date(note.userEditedTimestampUsec / 1000).toISOString()}`,
      );
    }
    if (labels.length) lines.push(`tags: [${labels.join(", ")}]`);
    if (note.isPinned) lines.push("pinned: true");
    lines.push("---", "", body);

    notes.push({
      path: `${sanitizeFileName(title)}.md`,
      folder: "",
      content: lines.join("\n"),
    });
  }

  return { notes, attachments, source: "keep" };
}

function folderFor(rel: string): string {
  let parts = rel.split("/");

  if (parts.length > 1 && /export/i.test(parts[0])) parts = parts.slice(1);

  parts.pop();

  return sanitizeFolderPath(parts.join("/"));
}

function titleFromPath(path: string): string {
  const base = path.split("/").pop() ?? "";

  return sanitizeFileName(base.replace(/\.md$/i, "") || "untitled");
}

function headingTitle(body: string): string {
  const h = body.match(/^#\s+(.+)$/m);

  return h ? h[1].trim() : "";
}

const EMBED_RE = /!\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g;
const IMG_REF_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;
const LINK_REF_RE = /\[([^\]]+)\]\(([^)]+)\)/g;

function splitRef(refWithTitle: string): { ref: string; title: string | null } {
  const m = /^(.+?)(?:\s+"([^"]*)")?$/.exec(refWithTitle);

  return {
    ref: (m?.[1] ?? refWithTitle).trim(),
    title: m?.[2] ?? null,
  };
}

function refLookup(
  ref: string,
  byRef: Map<string, { id: string; ext: string }>,
  byName: Map<string, { id: string; ext: string }>,
): { id: string; ext: string } | null {
  const direct = byRef.get(normalizeRef(ref));
  if (direct) return direct;

  const base = ref.split("/").pop() ?? "";
  const byBase = byName.get(base);
  if (byBase) return byBase;

  const decoded = tryDecodeUri(ref);
  if (decoded !== ref) {
    const dec = byRef.get(normalizeRef(decoded));
    if (dec) return dec;

    const decBase = decoded.split("/").pop() ?? "";
    return byName.get(decBase) ?? null;
  }

  return null;
}

function tryDecodeUri(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function rewriteRefs(
  body: string,
  byRef: Map<string, { id: string; ext: string }>,
  byName: Map<string, { id: string; ext: string }>,
  source?: ImportSource,
): string {
  let out = body.replace(
    EMBED_RE,
    (_all, namePart: string, altPart?: string) => {
      const name = (namePart.trim().split("/").pop() ?? "").trim();
      const alt = (altPart ?? "").trim() || name;
      const rec = byName.get(name);

      if (rec) return `![${alt}](assets/${rec.id}.${rec.ext})`;
      if (source === "obsidian") return `[[${name}]]`;
      return name;
    },
  );

  out = out.replace(IMG_REF_RE, (all, alt: string, refWithTitle: string) => {
    const { ref, title } = splitRef(refWithTitle);
    const rec = refLookup(ref, byRef, byName);
    if (!rec) return all;

    const name = ref.split("/").pop() ?? "";
    const altOut = alt && alt !== name ? alt : "";
    const titleOut = title ? ` "${title}"` : "";

    return `![${altOut}](assets/${rec.id}.${rec.ext}${titleOut})`;
  });

  out = out.replace(LINK_REF_RE, (all, text: string, refWithTitle: string) => {
    const { ref, title } = splitRef(refWithTitle);
    const rec = refLookup(ref, byRef, byName);
    if (!rec) return all;

    return `[${text}](assets/${rec.id}.${rec.ext}${title ? ` "${title}"` : ""})`;
  });

  return out;
}

interface AffineFootnoteDef {
  type?: string;
  url?: string;
  title?: string;
  description?: string;
  fileName?: string;
  fileType?: string;
  blobId?: string;
}

const FOOTNOTE_DEF_RE = /^\[\^([\w-]+)\]:\s*(\{.*\})\s*$/;
const FOOTNOTE_REF_RE = /\[\^([\w-]+)\]/g;

function convertAffineFootnotes(
  body: string,
  byBaseId: Map<string, { id: string; ext: string }>,
): string {
  const defs = new Map<string, AffineFootnoteDef>();

  const stripped = transformOutsideFences(body, (line) => {
    const m = FOOTNOTE_DEF_RE.exec(line);
    if (!m) return line;

    let data: AffineFootnoteDef;
    try {
      data = JSON.parse(m[2]) as AffineFootnoteDef;
    } catch {
      return line;
    }

    if (data.type !== "url" && data.type !== "attachment") return line;
    defs.set(m[1], data);

    return "";
  });

  if (defs.size === 0) return body;

  return transformOutsideFences(stripped, (line) =>
    line.replace(FOOTNOTE_REF_RE, (all, label: string) => {
      const data = defs.get(label);
      if (!data) return all;

      if (data.type === "url") {
        let url = data.url ?? "";
        try {
          url = decodeURIComponent(url);
        } catch {
          url = data.url ?? "";
        }
        if (!url) return all;

        const title = (data.title || url).replace(/[[\]]/g, "");
        const desc = data.description
          ? ` "${data.description.replace(/"/g, "&quot;")}"`
          : "";

        return `[${title}](${url.replace(/[()]/g, "\\$&")}${desc})`;
      }

      if (data.type === "attachment") {
        const rec = data.blobId ? byBaseId.get(data.blobId) : undefined;
        if (!rec) return all;

        const name = (data.fileName || "file").replace(/[[\]]/g, "");
        const mime = data.fileType ? ` "${data.fileType}"` : "";

        return `[${name}](assets/${rec.id}.${rec.ext}${mime})`;
      }

      return all;
    }),
  );
}

export async function applyImport(
  store: VaultStore,
  index: NoteIndex,
  parsed: ParsedImport,
): Promise<ImportResult> {
  const attKey = (path: string): string | null => {
    const dir = attachmentDir(path);
    if (dir) return dir.key;
    return parsed.source === "obsidian" || parsed.source === "notion"
      ? path
      : null;
  };
  const existing = new Set((await store.listNotes()).map((n) => n.id));
  const usedNow = new Set<string>();
  const byRef = new Map<string, { id: string; ext: string }>();
  const byName = new Map<string, { id: string; ext: string }>();
  const byBaseId = new Map<string, { id: string; ext: string }>();

  for (const path of parsed.attachments.keys()) {
    const key = attKey(path);
    if (!key) continue;

    const name = key.split("/").pop() ?? "";
    if (!name) continue;

    const rec = { id: crypto.randomUUID(), ext: extOf(name) };
    byRef.set(key, rec);
    if (!byName.has(name)) byName.set(name, rec);

    const base = name.replace(/\.[^.]+$/, "");
    if (base && base !== name && !byBaseId.has(base)) byBaseId.set(base, rec);
  }

  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  let noteCount = 0;
  let attCount = 0;
  let skipCount = 0;
  const collisions: string[] = [];

  for (const raw of parsed.notes) {
    const { meta: fm, body: rawBody } = parseFrontmatter(raw.content);
    const titleFromFm = fm.title?.trim() || "";
    let title = titleFromFm || headingTitle(rawBody) || titleFromPath(raw.path);
    let folder = fm.folder || raw.folder;
    const hasId = !!fm.id;

    if (hasId && isFolderRegistryId(fm.id!)) continue;

    let id: string;
    if (hasId && !existing.has(fm.id!) && !usedNow.has(fm.id!)) {
      id = fm.id!;
    } else {
      id = crypto.randomUUID();
      if (hasId) {
        skipCount += 1;
        collisions.push(title);
        title = `${title} (imported ${day})`;
      }
    }

    const body = convertAffineFootnotes(
      rewriteRefs(rawBody, byRef, byName, parsed.source),
      byBaseId,
    );
    const meta: NoteMeta = {
      id,
      title,
      folder: sanitizeFolderPath(folder),
      tags: fm.tags ?? [],
      pinned: fm.pinned ?? false,
      created: fm.created || now,
      updated: fm.updated || now,
      rev: -1,
      conflict: false,
      dirty: true,
    };
    const content = writeFrontmatter(
      {
        id,
        title,
        created: meta.created,
        updated: meta.updated,
        tags: meta.tags,
        pinned: meta.pinned,
        folder: meta.folder,
      },
      body,
    );

    await store.writeNote(id, meta, content);
    await index.upsert(meta, content);
    usedNow.add(id);
    noteCount += 1;
  }

  for (const [path, bytes] of parsed.attachments) {
    const key = attKey(path);
    if (!key) continue;

    const rec = byRef.get(key);
    if (!rec) continue;

    await store.writeAttachment(rec.id, rec.ext, bytes);
    attCount += 1;
  }

  return { notes: noteCount, atts: attCount, skipped: skipCount, collisions };
}
