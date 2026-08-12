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

export async function buildExportZip(
  store: VaultStore,
  vaultId = "",
): Promise<Uint8Array<ArrayBuffer>> {
  const notes = await store.listNotes();
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
  const missing = new Set<string>();
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

      if (!ext || bytes === null) {
        missing.add(aid);
        continue;
      }

      written.add(aid);
      files[`assets/${aid}.${ext}`] = bytes;
    }
  }

  files["README.txt"] = enc.encode(
    buildReadme(new Date(), vaultId, sorted.length, written.size, [...missing]),
  );

  return zipBytes(files);
}

function buildReadme(
  date: Date,
  vaultId: string,
  noteCount: number,
  attachmentCount: number,
  missing: string[],
): string {
  const lines = [
    "folio export",
    `exported: ${date.toISOString().slice(0, 10)}`,
    `vault: ${vaultId ? vaultId.slice(0, 12) : "—"}`,
    `notes: ${noteCount}`,
    `attachments: ${attachmentCount}`,
    "",
    "files are plain markdown with yaml frontmatter and can be re-imported with folio (import → zip).",
  ];

  if (missing.length) {
    lines.push(
      "",
      `missing attachments (not in this vault): ${missing.join(", ")}`,
    );
  }

  return lines.join("\n") + "\n";
}
