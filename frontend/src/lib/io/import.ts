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
        content: dec.decode(data).replace(/\r\n/g, "\n"),
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

const EMBED_RE = /!\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g;
const IMG_REF_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;

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

  out = out.replace(IMG_REF_RE, (all, alt: string, ref: string) => {
    const rec = byRef.get(normalizeRef(ref));

    return rec ? `![${alt}](assets/${rec.id}.${rec.ext})` : all;
  });

  return out;
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

  for (const path of parsed.attachments.keys()) {
    const dir = attachmentDir(path);
    if (!dir) continue;

    const name = dir.key.split("/").pop() ?? "";
    if (!name) continue;

    const rec = { id: crypto.randomUUID(), ext: extOf(name) };
    byRef.set(dir.key, rec);
    if (!byName.has(name)) byName.set(name, rec);
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
    let title = titleFromFm || titleFromPath(raw.path);
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

    const body = rewriteRefs(rawBody, byRef, byName);
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
