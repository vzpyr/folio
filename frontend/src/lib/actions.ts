import { writeFrontmatter } from "./editor/markdown.ts";
import { folderRegistry, deleteFolder } from "./store/folders.ts";
import { appState, navigate } from "../app.svelte.ts";
import type { NoteMeta } from "./store/store.svelte.ts";

export async function createNote(): Promise<string | null> {
  const st = appState.store;
  const idx = appState.index;

  if (!st || !idx) return null;

  const nid = crypto.randomUUID();
  const now = Date.now();
  const folder = appState.filterFolder ?? "";
  const meta: NoteMeta = {
    id: nid,
    title: "untitled",
    folder,
    tags: [],
    pinned: false,
    created: now,
    updated: now,
    rev: -1,
    conflict: false,
    dirty: true,
  };
  const content = writeFrontmatter(
    {
      id: nid,
      title: "untitled",
      created: now,
      updated: now,
      tags: [],
      pinned: false,
      folder,
    },
    "",
  );

  await st.writeNote(nid, meta, content);
  await idx.upsert(meta, content);
  navigate(`note/${nid}`);
  void appState.sync?.nudge();

  return nid;
}

export async function promptAddFolder(): Promise<void> {
  const st = appState.store;
  if (!st) return;

  const name = window.prompt("folder name")?.trim();
  if (!name) return;

  await folderRegistry.ensure(st, name);
  appState.filterFolder = name;
  void appState.sync?.sync();
}

export async function promptDeleteFolder(name: string): Promise<void> {
  const st = appState.store;
  const idx = appState.index;
  if (!st || !idx) return;

  if (!window.confirm(`delete folder "${name}"? notes move to all notes`))
    return;

  await deleteFolder(st, idx, name);
  if (appState.filterFolder === name) appState.filterFolder = null;
  void appState.sync?.sync();
}
