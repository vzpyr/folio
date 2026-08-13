import { appState } from "../app.svelte.ts";
import { confirmDialog } from "./dialogs.svelte.ts";
import { parseFrontmatter, writeFrontmatter } from "./editor/markdown.ts";
import {
  folderRegistry,
  pruneEmptyFolder,
  setNoteFolder,
} from "./store/folders.ts";
import { setTrashed, type NoteMeta } from "./store/store.svelte.ts";

const DND_MIME = "text/folio-note";

export function dragPayload(ev: DragEvent, ids: string[]): void {
  const dt = ev.dataTransfer;
  if (!dt || ids.length === 0) return;

  dt.setData(DND_MIME, JSON.stringify(ids));
  dt.effectAllowed = "move";
}

export function droppedIds(ev: DragEvent): string[] {
  const raw = ev.dataTransfer?.getData(DND_MIME);
  if (!raw) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed))
      return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    return [raw];
  }

  return [raw];
}

export function flushSync(): void {
  void appState.sync?.sync();
}

export async function bulkTrash(ids: string[]): Promise<void> {
  const st = appState.store;
  const idx = appState.index;
  if (!st || !idx || ids.length === 0) return;

  for (const id of ids) await setTrashed(st, idx, id, true);
}

export async function bulkRestore(ids: string[]): Promise<void> {
  const st = appState.store;
  const idx = appState.index;
  if (!st || !idx || ids.length === 0) return;

  for (const id of ids) await setTrashed(st, idx, id, false);
}

export async function bulkSetFolder(
  ids: string[],
  folder: string,
): Promise<void> {
  const st = appState.store;
  const idx = appState.index;
  if (!st || !idx || ids.length === 0) return;

  if (folder.trim()) await folderRegistry.load(st);

  for (const id of ids)
    await setNoteFolder(st, idx, id, folder, folderRegistry);
}

export async function bulkTogglePin(ids: string[]): Promise<void> {
  const st = appState.store;
  const idx = appState.index;
  if (!st || !idx || ids.length === 0) return;

  const allPinned = ids.every((id) => idx.getById(id)?.pinned);

  for (const id of ids) {
    const cur = idx.getById(id);
    const content = await st.readNote(id);
    if (!cur || !content) continue;

    const { meta: fm, body } = parseFrontmatter(content);
    const now = Date.now();
    const meta: NoteMeta = {
      ...cur,
      pinned: !allPinned,
      updated: now,
      dirty: true,
    };
    const newContent = writeFrontmatter(
      {
        id: cur.id,
        title: cur.title,
        created: fm.created ?? cur.created,
        updated: now,
        tags: cur.tags,
        pinned: meta.pinned,
        folder: cur.folder,
        trashed: cur.trashed ?? false,
      },
      body,
    );

    await st.writeNote(id, meta, newContent);
    await idx.upsert(meta, newContent);
  }
}

export async function bulkDelete(ids: string[]): Promise<boolean> {
  const st = appState.store;
  const idx = appState.index;
  if (!st || !idx || ids.length === 0) return false;

  const ok = await confirmDialog({
    title: ids.length === 1 ? "delete note" : "delete notes",
    message: `permanently delete ${ids.length} ${ids.length === 1 ? "note" : "notes"}?`,
    confirmLabel: "delete",
  });
  if (!ok) return false;

  for (const id of ids) {
    const folder = idx.getById(id)?.folder ?? "";
    await st.deleteNote(id);
    await idx.remove(id);
    await pruneEmptyFolder(st, idx, folder);
    if (appState.sync) void appState.sync.pushDelete(id);
  }

  return true;
}
