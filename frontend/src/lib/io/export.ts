import type { VaultStore } from "../store/store.svelte.ts";
import { zipBytes } from "./zip.ts";
import { isFolderRegistryId } from "../store/folders.ts";

export function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(/[\/\\:*?"<>|\x00-\x1f]/g, "-")
    .replace(/[ \t.]+$/g, "")
    .slice(0, 200);

  return cleaned === "" ? "untitled" : cleaned;
}

export function sanitizeFolderPath(folder: string): string {
  return folder
    .split("/")
    .map((seg) =>
      seg.replace(/[\/\\:*?"<>|\x00-\x1f]/g, "-").replace(/[ \t.]+$/g, ""),
    )
    .filter((seg) => seg !== "" && seg !== "." && seg !== "..")
    .join("/");
}

const ATT_REF_RE = /assets\/([0-9a-f-]{8,36})\.(\w+)/g;

export function extractAttachmentRefs(doc: string): Set<string> {
  const ids = new Set<string>();
  let m: RegExpExecArray | null;

  while ((m = ATT_REF_RE.exec(doc)) !== null) ids.add(m[1]);

  return ids;
}

export interface NoteExport {
  name: string;
  bytes: Uint8Array<ArrayBuffer>;
}

export function exportStamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");

  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export async function buildExportZip(
  store: VaultStore,
  ids?: Set<string>,
): Promise<Uint8Array<ArrayBuffer>> {
  const all = await store.listNotes();
  const notes = ids ? all.filter((n) => ids.has(n.id)) : all;
  const attachments = await store.listAttachments();
  const extById = new Map(attachments.map((a) => [a.id, a.ext]));
  const sorted = [...notes].sort((a, b) => {
    const fa = a.folder || "~";
    const fb = b.folder || "~";

    return fa.localeCompare(fb) || a.title.localeCompare(b.title);
  });
  const files: Record<string, Uint8Array> = {};
  const usedNames = new Set<string>();
  const written = new Set<string>();
  const enc = new TextEncoder();

  for (const note of sorted) {
    if (isFolderRegistryId(note.id)) continue;

    const content = await store.readNote(note.id);
    if (content === null) continue;

    const folder = sanitizeFolderPath(note.folder);
    const title = sanitizeFileName(note.title || "untitled");
    let rel = folder ? `${folder}/${title}.md` : `${title}.md`;
    let n = 1;

    while (usedNames.has(rel)) {
      n += 1;
      rel = folder ? `${folder}/${title} ${n}.md` : `${title} ${n}.md`;
    }

    usedNames.add(rel);
    files[rel] = enc.encode(content);

    for (const aid of extractAttachmentRefs(content)) {
      if (written.has(aid)) continue;

      const ext = extById.get(aid);
      const bytes = ext ? await store.readAttachment(aid) : null;
      if (!ext || bytes === null) continue;

      written.add(aid);
      files[`assets/${aid}.${ext}`] = bytes;
    }
  }

  return zipBytes(files);
}

export async function buildNoteExport(
  store: VaultStore,
  ids: string[],
): Promise<NoteExport | null> {
  if (ids.length === 0) return null;

  const metas = await store.listNotes();
  const byId = new Map(metas.map((m) => [m.id, m]));

  if (ids.length > 1) {
    return {
      name: `folio-export-${exportStamp()}.zip`,
      bytes: await buildExportZip(store, new Set(ids)),
    };
  }

  const meta = byId.get(ids[0]);
  const content = meta ? await store.readNote(meta.id) : null;
  if (!meta || content === null) return null;

  const title = sanitizeFileName(meta.title || "untitled");

  if (extractAttachmentRefs(content).size === 0) {
    return { name: `${title}.md`, bytes: new TextEncoder().encode(content) };
  }

  return {
    name: `${title}.zip`,
    bytes: await buildExportZip(store, new Set([meta.id])),
  };
}
