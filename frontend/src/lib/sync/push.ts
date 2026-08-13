import { sealEnvelope, opaqueId, openEnvelope } from "../util/crypto.ts";
import { FOLDER_REGISTRY_ID } from "../store/folders.ts";
import type { NoteMeta } from "../store/store.svelte.ts";
import type { SyncContext } from "./conflict.ts";
import { resolveNoteConflict, resolveRegistryConflict } from "./conflict.ts";
import { attKey, isAttKey, SETTLE_MS, isNetworkError } from "./types.ts";
import { addNotice } from "./notices.svelte.ts";

export async function push(
  ctx: SyncContext,
): Promise<{ unsettled: { id: string; updated: number }[] }> {
  const { store, ledger, index } = ctx;
  const attempted = new Set<string>();

  for (;;) {
    const notes = await store.listNotes();
    const now = Date.now();
    const ready = notes.filter(
      (n) =>
        n.dirty === true &&
        now - (n.updated ?? 0) > SETTLE_MS &&
        !attempted.has(n.id),
    );

    if (ready.length === 0) break;

    for (const meta of ready) {
      attempted.add(meta.id);

      const content = await store.readNote(meta.id);
      if (!content) continue;

      try {
        await pushOneNote(ctx, meta, content);
      } catch (e: unknown) {
        if (isNetworkError(e)) throw e;
        console.error(`[folio] push ${meta.id} threw`, e);
      }
    }
  }

  const refs = await getAttachmentRefs(ctx);
  await gcLocalAttachments(ctx, refs);
  await pushAttachments(ctx, refs);

  const localIds = new Set((await store.listNotes()).map((n) => n.id));
  for (const key of ledger.noteKeys()) {
    if (key === FOLDER_REGISTRY_ID) continue;
    if (!localIds.has(key)) await tombstoneNote(ctx, key);
  }

  await ledger.save(store);
  await index.rebuild(store);

  const now = Date.now();
  const unsettled = (await store.listNotes())
    .filter((n) => n.dirty === true && now - (n.updated ?? 0) <= SETTLE_MS)
    .map((n) => ({ id: n.id, updated: n.updated ?? 0 }));

  return { unsettled };
}

async function pushOneNote(
  ctx: SyncContext,
  meta: NoteMeta,
  content: string,
): Promise<void> {
  const { store, ledger, api, keys } = ctx;
  const opaque = await opaqueId(keys, meta.id);
  const { nonce, blob } = await sealEnvelope(
    keys,
    meta.id,
    "note",
    meta.updated,
    false,
    new TextEncoder().encode(content),
  );
  const baseRev = ledger.baseRevFor(meta.id, meta.rev);
  const res = await api.putItem(opaque, baseRev, nonce, blob);

  if (res.ok) {
    meta.rev = res.rev;
    meta.dirty = false;
    ledger.set(meta.id, res.rev);
    await store.writeNote(meta.id, meta, content);

    return;
  }

  if (res.status === 409) {
    if (meta.id === FOLDER_REGISTRY_ID) {
      await resolveRegistryConflict(ctx, opaque, meta, content);
    } else {
      await resolveNoteConflict(ctx, opaque, meta.id, meta, content);
    }

    return;
  }

  if (res.status === 401 || res.status === 400) {
    addNotice(
      "error",
      "push rejected — check server url and token",
      res.body || undefined,
    );

    return;
  }

  console.error(
    `[folio] push ${meta.id} failed status=${res.status} body=${JSON.stringify(res.body)}`,
  );
}

async function getAttachmentRefs(ctx: SyncContext): Promise<Set<string>> {
  const refs = new Set<string>();

  for (const n of await ctx.store.listNotes()) {
    const content = await ctx.store.readNote(n.id);
    if (!content) continue;

    for (const m of content.matchAll(/assets\/([0-9a-f-]+)\./g)) refs.add(m[1]);
  }

  return refs;
}

async function gcLocalAttachments(
  ctx: SyncContext,
  refs: Set<string>,
): Promise<void> {
  for (const a of await ctx.store.listAttachments()) {
    if (!refs.has(a.id) && ctx.ledger.has(attKey(a.id))) {
      await ctx.store.deleteAttachment(a.id);
    }
  }
}

async function pushAttachments(
  ctx: SyncContext,
  refs: Set<string>,
): Promise<void> {
  const { store, ledger } = ctx;
  const local = await store.listAttachments();
  const localIds = new Set(local.map((a) => a.id));

  for (const a of local) {
    if (ledger.has(attKey(a.id))) continue;
    if (!refs.has(a.id)) continue;

    const bytes = await store.readAttachment(a.id);
    if (!bytes) continue;

    await pushOneAttachment(ctx, a.id, a.ext, bytes);
  }

  for (const key of ledger.keys()) {
    if (!isAttKey(key)) continue;

    const id = key.slice(4);
    if (!localIds.has(id)) await tombstoneAttachment(ctx, id);
  }
}

async function pushOneAttachment(
  ctx: SyncContext,
  id: string,
  ext: string,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<void> {
  const { store, ledger, api, keys } = ctx;
  const opaque = await opaqueId(keys, id);
  const { nonce, blob } = await sealEnvelope(
    keys,
    id,
    "attachment",
    Date.now(),
    false,
    bytes,
  );
  const baseRev = ledger.get(attKey(id));
  const res = await api.putItem(opaque, baseRev, nonce, blob);

  if (res.ok) {
    ledger.set(attKey(id), res.rev);

    return;
  }

  if (res.status === 409) {
    const env = await api.fetchItem(opaque);

    if (!env || env.rev === undefined) return;

    try {
      const opened = await openEnvelope(keys, opaque, env);

      if (!opened.deleted) {
        await store.writeAttachment(id, ext, opened.payload);
        ledger.set(attKey(id), env.rev);
      } else {
        ledger.set(attKey(id), env.rev);
      }
    } catch {}

    return;
  }

  if (res.status === 401 || res.status === 400) {
    addNotice(
      "error",
      "push rejected — check server url and token",
      res.body || undefined,
    );
  }
}

async function tombstoneAttachment(
  ctx: SyncContext,
  id: string,
): Promise<void> {
  const { ledger, api, keys } = ctx;
  const opaque = await opaqueId(keys, id);
  const serverRev = ledger.get(attKey(id));
  const { nonce, blob } = await sealEnvelope(
    keys,
    id,
    "attachment",
    Date.now(),
    true,
    new Uint8Array(0),
  );
  let res = await api.putItem(opaque, serverRev, nonce, blob);

  if (res.ok || res.status === 404) {
    ledger.delete(attKey(id));
    if (res.ok) ledger.setTomb(attKey(id), res.rev);

    return;
  }

  if (res.status !== 409) return;

  const env = await api.fetchItem(opaque);
  if (!env || env.rev === undefined) return;

  if (env.rev === 0) {
    ledger.delete(attKey(id));

    return;
  }

  res = await api.putItem(opaque, env.rev, nonce, blob);

  if (res.ok || res.status === 404) {
    ledger.delete(attKey(id));
    if (res.ok) ledger.setTomb(attKey(id), res.rev);
  }
}

export async function tombstoneNote(
  ctx: SyncContext,
  id: string,
): Promise<void> {
  const { store, ledger, api, keys } = ctx;
  const opaque = await opaqueId(keys, id);
  const serverRev = ledger.get(id);
  const { nonce, blob } = await sealEnvelope(
    keys,
    id,
    "note",
    Date.now(),
    true,
    new Uint8Array(0),
  );
  let res = await api.putItem(opaque, serverRev, nonce, blob);

  if (res.ok || res.status === 404) {
    ledger.delete(id);
    if (res.ok) ledger.setTomb(id, res.rev);
    await store.deleteNote(id);

    return;
  }

  if (res.status !== 409) return;

  const env = await api.fetchItem(opaque);
  if (!env || env.rev === undefined) return;

  if (env.rev === 0) {
    ledger.delete(id);
    await store.deleteNote(id);

    return;
  }

  res = await api.putItem(opaque, env.rev, nonce, blob);

  if (res.ok || res.status === 404) {
    ledger.delete(id);
    if (res.ok) ledger.setTomb(id, res.rev);
    await store.deleteNote(id);
  }
}
