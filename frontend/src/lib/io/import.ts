import type { VaultStore, NoteIndex, NoteMeta } from "../store/store.svelte.ts";
import { parseFrontmatter, writeFrontmatter } from "../editor/markdown.ts";
import { sanitizeFileName, sanitizeFolderPath } from "./export.ts";
import { unzip } from "./zip.ts";
import { isFolderRegistryId } from "../store/folders.ts";

export interface RawNote {
  path: string;
  folder: string;
  content: string;
}

export interface ParsedImport {
  notes: RawNote[];
  attachments: Map<string, Uint8Array<ArrayBuffer>>;
}

export interface ImportResult {
  notes: number;
  atts: number;
  skipped: number;
  collisions: string[];
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

export function parseImportSource(bytes: Uint8Array): ParsedImport {
  const entries = unzip(bytes);
  const notes: RawNote[] = [];
  const attachments = new Map<string, Uint8Array<ArrayBuffer>>();
  const dec = new TextDecoder();

  for (const [rawPath, data] of Object.entries(entries)) {
    const rel = rawPath
      .replace(/\\/g, "/")
      .replace(/^\.\//, "")
      .replace(/^\/+/, "");

    if (rel === "" || rel.endsWith("/") || rel.startsWith("__MACOSX/"))
      continue;

    if (/\.md$/i.test(rel)) {
      notes.push({
        path: rel,
        folder: folderFor(rel),
        content: normalizeContent(dec.decode(data)),
      });
    } else if (attachmentDir(rel)) {
      attachments.set(rel, Uint8Array.from(data));
    }
  }

  return { notes, attachments };
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

function rewriteRefs(
  body: string,
  byRef: Map<string, { id: string; ext: string }>,
  byName: Map<string, { id: string; ext: string }>,
): string {
  let out = body.replace(
    EMBED_RE,
    (_all, namePart: string, altPart?: string) => {
      const name = (namePart.trim().split("/").pop() ?? "").trim();
      const alt = (altPart ?? "").trim() || name;
      const rec = byName.get(name);

      return rec ? `![${alt}](assets/${rec.id}.${rec.ext})` : name;
    },
  );

  out = out.replace(IMG_REF_RE, (all, alt: string, refWithTitle: string) => {
    const { ref, title } = splitRef(refWithTitle);
    const rec = byRef.get(normalizeRef(ref));
    if (!rec) return all;

    const name = ref.split("/").pop() ?? "";
    const altOut = alt && alt !== name ? alt : "";
    const titleOut = title ? ` "${title}"` : "";

    return `![${altOut}](assets/${rec.id}.${rec.ext}${titleOut})`;
  });

  out = out.replace(LINK_REF_RE, (all, text: string, refWithTitle: string) => {
    const { ref, title } = splitRef(refWithTitle);
    const rec = byRef.get(normalizeRef(ref));
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
  const existing = new Set((await store.listNotes()).map((n) => n.id));
  const usedNow = new Set<string>();
  const byRef = new Map<string, { id: string; ext: string }>();
  const byName = new Map<string, { id: string; ext: string }>();
  const byBaseId = new Map<string, { id: string; ext: string }>();

  for (const path of parsed.attachments.keys()) {
    const dir = attachmentDir(path);
    if (!dir) continue;

    const name = dir.key.split("/").pop() ?? "";
    if (!name) continue;

    const rec = { id: crypto.randomUUID(), ext: extOf(name) };
    byRef.set(dir.key, rec);
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
      rewriteRefs(rawBody, byRef, byName),
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
    const dir = attachmentDir(path);
    if (!dir) continue;

    const rec = byRef.get(dir.key);
    if (!rec) continue;

    await store.writeAttachment(rec.id, rec.ext, bytes);
    attCount += 1;
  }

  return { notes: noteCount, atts: attCount, skipped: skipCount, collisions };
}
