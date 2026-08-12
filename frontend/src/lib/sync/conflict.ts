import type { Keys, Envelope, Opened } from "../util/crypto.ts";
import { sealEnvelope, openEnvelope, opaqueId } from "../util/crypto.ts";
import {
  parseFrontmatter,
  writeFrontmatter,
  extractTitle,
} from "../editor/markdown.ts";
import { conflictTitle } from "../util/format.ts";
import { FOLDER_REGISTRY_ID, parseRegistryContent } from "../store/folders.ts";
import type { VaultStore, NoteMeta, NoteIndex } from "../store/store.svelte.ts";
import type { ApiClient } from "./transport.ts";
import type { Ledger } from "./ledger.ts";
import { SETTLE_MS } from "./types.ts";
import { addNotice } from "./notices.svelte.ts";

export interface SyncContext {
  keys: Keys;
  store: VaultStore;
  index: NoteIndex;
  api: ApiClient;
  ledger: Ledger;
}

export async function forkConflict(
  ctx: SyncContext,
  meta: NoteMeta,
  content: string,
): Promise<string> {
  const { store } = ctx;
  const newId = crypto.randomUUID();
  const newTitle = conflictTitle(meta.title);
  const { meta: fm, body } = parseFrontmatter(content);
  const now = Date.now();
  const newContent = writeFrontmatter(
    {
      id: newId,
      title: newTitle,
      created: fm.created ?? now,
      updated: now,
      tags: fm.tags ?? [],
      pinned: false,
      folder: fm.folder ?? "",
    },
    body,
  );
  const newMeta: NoteMeta = {
    id: newId,
    title: newTitle,
    folder: meta.folder,
    tags: [...meta.tags],
    pinned: false,
    created: fm.created ?? now,
    updated: now - SETTLE_MS - 1000,
    rev: -1,
    conflict: true,
    dirty: true,
  };

  await store.writeNote(newId, newMeta, newContent);

  addNotice(
    "conflict",
    `your edit of “${meta.title}” was kept as “${newTitle}”`,
    "another device saved a newer version of this note first — your version was preserved, nothing was lost.",
  );

  return newId;
}

export async function resolveNoteConflict(
  ctx: SyncContext,
  opaque: string,
  id: string,
  meta: NoteMeta,
  content: string,
): Promise<void> {
  const { store, api, keys, ledger } = ctx;
  const env = await api.fetchItem(opaque);

  if (!env || env.rev === undefined) return;

  let winner: Opened;
  try {
    winner = await openEnvelope(keys, opaque, env);
  } catch {
    return;
  }

  const remote = new TextDecoder().decode(winner.payload);
  const cur = (await store.listNotes()).find((n) => n.id === id);
  const modifiedSince =
    !!cur && cur.dirty === true && (cur.updated ?? 0) > (meta.updated ?? 0);

  if (winner.deleted) {
    await forkConflict(ctx, meta, content);

    if (!modifiedSince) {
      await store.deleteNote(id);
      ledger.delete(id);
      ledger.setTomb(id, env.rev ?? 0);
    }

    return;
  }

  const { body: remoteBody } = parseFrontmatter(remote);
  const { body: localBody } = parseFrontmatter(content);

  if (remoteBody === localBody) {
    meta.rev = env.rev;
    meta.dirty = false;
    ledger.set(id, env.rev);
    await store.writeNote(id, meta, remote);

    return;
  }

  await forkConflict(ctx, meta, content);

  if (!modifiedSince) {
    await applyWinner(ctx, id, env, winner, remote, cur?.trashed ?? false);
    ledger.set(id, env.rev);
  }
}

async function applyWinner(
  ctx: SyncContext,
  id: string,
  env: Envelope,
  winner: Opened,
  remote: string,
  trashed: boolean,
): Promise<void> {
  const { store } = ctx;
  const { meta: fm } = parseFrontmatter(remote);
  const now = Date.now();
  const title = fm.title ?? extractTitle(remote, id);
  const winnerMeta: NoteMeta = {
    id,
    title,
    folder: fm.folder ?? "",
    tags: fm.tags ?? [],
    pinned: fm.pinned ?? false,
    created: fm.created ?? winner.updated ?? now,
    updated: fm.updated ?? winner.updated ?? now,
    rev: env.rev ?? 0,
    conflict: false,
    dirty: false,
    trashed,
  };

  await store.writeNote(id, winnerMeta, remote);
}

export async function resolveRegistryConflict(
  ctx: SyncContext,
  opaque: string,
  meta: NoteMeta,
  content: string,
): Promise<void> {
  const { store, api, keys, ledger } = ctx;
  const env = await api.fetchItem(opaque);

  if (!env || env.rev === undefined) return;

  const opened = await openEnvelope(keys, opaque, env);
  const remote = new TextDecoder().decode(opened.payload);
  const merged = [
    ...new Set([
      ...parseRegistryContent(remote),
      ...parseRegistryContent(content),
    ]),
  ].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  const { meta: fm } = parseFrontmatter(content);
  const now = Date.now();
  const newContent = writeFrontmatter(
    {
      id: FOLDER_REGISTRY_ID,
      title: fm.title ?? meta.title,
      created: fm.created ?? now,
      updated: now,
      tags: [],
      pinned: false,
      folder: "",
    },
    JSON.stringify({ folders: merged }),
  );
  const sealed = await sealEnvelope(
    keys,
    FOLDER_REGISTRY_ID,
    "note",
    now,
    false,
    new TextEncoder().encode(newContent),
  );
  const put = await api.putItem(opaque, env.rev, sealed.nonce, sealed.blob);

  if (put.ok) {
    meta.rev = put.rev;
    meta.dirty = false;
    ledger.set(FOLDER_REGISTRY_ID, put.rev);
    await store.writeNote(FOLDER_REGISTRY_ID, meta, newContent);
  }
}

export async function indexOpaque(
  ctx: SyncContext,
  ids: string[],
  att: boolean,
  out: Map<string, { id: string; att: boolean }>,
): Promise<void> {
  for (const id of ids) {
    const opaque = await opaqueId(ctx.keys, id);
    out.set(opaque, { id, att });
  }
}
