import { parseFrontmatter, writeFrontmatter } from "../editor/markdown.ts";
import type { VaultStore, NoteMeta, NoteIndex } from "./store.svelte.ts";
import { bumpFolders } from "../util/signals.svelte.ts";

export const FOLDER_REGISTRY_ID = "00000000-0000-4000-8000-000000000000";

export function isFolderRegistryId(id: string): boolean {
  return id === FOLDER_REGISTRY_ID;
}

export function parseRegistryContent(content: string): string[] {
  try {
    const { body } = parseFrontmatter(content);
    const data = JSON.parse(body.trim() || "{}") as { folders?: unknown };

    if (!Array.isArray(data.folders)) return [];

    const names: string[] = [];
    const seen = new Set<string>();

    for (const f of data.folders) {
      if (typeof f !== "string") continue;

      const n = f.trim();
      if (!n || n.length > 100) continue;

      const key = n.toLowerCase();
      if (seen.has(key)) continue;

      seen.add(key);
      names.push(n);
    }

    return names.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  } catch {
    return [];
  }
}

const byName = (a: string, b: string) =>
  a.toLowerCase().localeCompare(b.toLowerCase());

export class FolderRegistry {
  names: string[] = [];
  private loaded = false;

  get ready(): boolean {
    return this.loaded;
  }

  find(name: string): string | null {
    const lower = name.toLowerCase();

    return this.names.find((n) => n.toLowerCase() === lower) ?? null;
  }

  async load(store: VaultStore): Promise<void> {
    const content = await store.readNote(FOLDER_REGISTRY_ID);

    this.names = content ? parseRegistryContent(content) : [];
    this.loaded = true;
  }

  private async readMeta(store: VaultStore): Promise<NoteMeta | null> {
    const list = await store.listNotes();

    return list.find((n) => n.id === FOLDER_REGISTRY_ID) ?? null;
  }

  private async persist(store: VaultStore, names: string[]): Promise<void> {
    const prev = await this.readMeta(store);
    const now = Date.now();
    const meta: NoteMeta = {
      id: FOLDER_REGISTRY_ID,
      title: "folio folders",
      folder: "",
      tags: [],
      pinned: false,
      created: prev?.created ?? now,
      updated: now,
      rev: prev?.rev ?? -1,
      conflict: false,
      dirty: true,
    };
    const content = writeFrontmatter(
      {
        id: meta.id,
        title: meta.title,
        created: meta.created,
        updated: meta.updated,
        tags: [],
        pinned: false,
        folder: "",
      },
      JSON.stringify({ folders: names }),
    );

    await store.writeNote(FOLDER_REGISTRY_ID, meta, content);
    this.names = names;
  }

  async ensure(
    store: VaultStore,
    rawName: string,
  ): Promise<"created" | "exists"> {
    const name = rawName.trim();
    if (!name || name.length > 100) return "exists";
    if (this.find(name)) return "exists";

    const names = [...this.names, name].sort(byName);
    await this.persist(store, names);
    bumpFolders();

    return "created";
  }

  async remove(store: VaultStore, name: string): Promise<void> {
    const existing = this.find(name);
    if (!existing) return;

    await this.persist(
      store,
      this.names.filter((n) => n !== existing),
    );
    bumpFolders();
  }
}

export const folderRegistry = new FolderRegistry();

export async function setNoteFolder(
  store: VaultStore,
  index: NoteIndex,
  noteId: string,
  folderRaw: string,
  registry: FolderRegistry = folderRegistry,
): Promise<void> {
  const folder = folderRaw.trim();
  const meta = index.getById(noteId);
  if (!meta) return;

  const oldFolder = meta.folder;
  let target = folder;

  if (folder) {
    const existing = registry.find(folder);
    if (existing) target = existing;
    else await registry.ensure(store, folder);
  }

  if (meta.folder === target) return;

  const leaving = oldFolder && oldFolder !== target;
  const content = await store.readNote(noteId);
  if (!content) return;

  const { meta: fm, body } = parseFrontmatter(content);
  const now = Date.now();
  const newMeta: NoteMeta = {
    ...meta,
    folder: target,
    updated: now,
    dirty: true,
  };
  const newContent = writeFrontmatter(
    {
      id: meta.id,
      title: meta.title,
      created: fm.created ?? meta.created,
      updated: now,
      tags: meta.tags,
      pinned: meta.pinned,
      folder: target,
    },
    body,
  );

  await store.writeNote(noteId, newMeta, newContent);
  await index.upsert(newMeta, newContent);

  if (leaving) {
    await pruneEmptyFolder(store, index, oldFolder, registry);
  }
}

export async function pruneEmptyFolder(
  store: VaultStore,
  index: NoteIndex,
  folder: string,
  registry: FolderRegistry = folderRegistry,
): Promise<void> {
  if (!folder) return;

  const remaining = index.list.filter((n) => n.folder === folder);
  if (remaining.length > 0) return;

  for (const t of index.all.filter((n) => n.trashed && n.folder === folder)) {
    await setNoteFolder(store, index, t.id, "", registry);
  }

  await registry.remove(store, folder);
}

export async function deleteFolder(
  store: VaultStore,
  index: NoteIndex,
  name: string,
  registry: FolderRegistry = folderRegistry,
): Promise<void> {
  const existing = registry.find(name);
  if (!existing) return;

  await registry.remove(store, existing);

  const bound = index.all.filter((n) => n.folder === existing);
  for (const meta of bound) {
    await setNoteFolder(store, index, meta.id, "", registry);
  }
}
