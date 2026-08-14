import { openEnvelope, opaqueId } from "../util/crypto.ts";
import type { Opened } from "../util/crypto.ts";
import { parseFrontmatter, extractTitle } from "../editor/markdown.ts";
import { isConflictTitle } from "../util/format.ts";
import type { NoteMeta } from "../store/store.svelte.ts";
import type { SyncContext } from "./conflict.ts";
import { indexOpaque } from "./conflict.ts";
import { attKey } from "./types.ts";
import { addNotice } from "./notices.svelte.ts";

export async function pull(ctx: SyncContext): Promise<void> {
  const { store, ledger, api, keys, index } = ctx;
  const manifest = await api.fetchManifest();
  const localNotes = await store.listNotes();
  const localAtts = await store.listAttachments();
  const opaqueToKey = new Map<string, string>();
  const opaqueToReal = new Map<string, { id: string; att: boolean }>();

  for (const key of ledger.allKeys()) {
    const real = key.startsWith("att:") ? key.slice(4) : key;
    const opaque = await opaqueId(keys, real);

    opaqueToKey.set(opaque, key);
  }

  await indexOpaque(
    ctx,
    localNotes.map((n) => n.id),
    false,
    opaqueToReal,
  );
  await indexOpaque(
    ctx,
    localAtts.map((a) => a.id),
    true,
    opaqueToReal,
  );

  for (const [opaque, entry] of opaqueToReal) {
    if (!opaqueToKey.has(opaque))
      opaqueToKey.set(opaque, entry.att ? attKey(entry.id) : entry.id);
  }

  const want = new Map<string, number>();

  for (const item of manifest) {
    const key = opaqueToKey.get(item.id);
    const localRev = key !== undefined ? ledger.knownRev(key) : 0;

    if (item.rev > localRev) want.set(item.id, item.rev);
  }

  if (want.size === 0) return;

  const envs = await api.fetchItems([...want.keys()]);
  const changes: {
    opaque: string;
    rev: number;
    opened: Opened;
  }[] = [];

  for (const [opaque, rev] of want) {
    const env = envs.get(opaque);

    if (!env || env.rev !== rev) continue;

    try {
      const opened = await openEnvelope(keys, opaque, env);
      changes.push({ opaque, rev, opened });
    } catch {}
  }

  if (changes.length === 0) return;

  for (const c of changes) {
    const { opened } = c;

    if (!opened.deleted) continue;

    const key = opaqueToKey.get(c.opaque);

    if (opened.kind === "attachment") {
      const id = opened.id;

      if (key && ledger.has(key)) {
        await store.deleteAttachment(id);
        ledger.delete(key);
        ledger.setTomb(attKey(id), c.rev);
      } else {
        ledger.setTomb(attKey(id), c.rev);
      }
    } else {
      const freshLocal = (await store.listNotes()).find(
        (n) => n.id === opened.id,
      );
      if (freshLocal?.dirty) continue;

      if (key && ledger.has(key)) {
        await store.deleteNote(opened.id);
        ledger.delete(key);
        ledger.setTomb(opened.id, c.rev);
      } else {
        ledger.setTomb(opened.id, c.rev);
      }
    }
  }

  const attExt = new Map<string, string>();
  for (const a of localAtts) attExt.set(a.id, a.ext);

  for (const c of changes) {
    const { opened } = c;

    if (opened.kind !== "note" || opened.deleted) continue;

    const md = new TextDecoder().decode(opened.payload);
    const { meta: fm } = parseFrontmatter(md);
    const now = Date.now();
    const localMeta = (await store.listNotes()).find(
      (n) => n.id === opened.id,
    );

    if (localMeta?.dirty) continue;

    const title = fm.title ?? extractTitle(md, opened.id);
    const meta: NoteMeta = {
      id: opened.id,
      title,
      folder: fm.folder ?? "",
      tags: fm.tags ?? [],
      pinned: fm.pinned ?? false,
      created: fm.created ?? opened.updated ?? now,
      updated: fm.updated ?? opened.updated ?? now,
      rev: c.rev,
      conflict: isConflictTitle(title),
      dirty: false,
      trashed: fm.trashed ?? localMeta?.trashed ?? false,
    };

    await store.writeNote(opened.id, meta, md);
    ledger.set(opened.id, c.rev);

    if (isConflictTitle(title) && !localMeta) {
      addNotice(
        "conflict",
        `received “${title}”`,
        "a conflict copy from another device arrived — it preserves an edit that lost a race here.",
      );
    }

    for (const m of md.matchAll(/assets\/([0-9a-f-]+)\.([a-z0-9]+)/gi)) {
      attExt.set(m[1], m[2]);
    }
  }

  const incomingAtts = changes.filter(
    (c) => c.opened.kind === "attachment" && !c.opened.deleted,
  );

  if (incomingAtts.some((c) => !attExt.has(c.opened.id))) {
    for (const n of localNotes) {
      if (incomingAtts.every((c) => attExt.has(c.opened.id))) break;

      const content = await store.readNote(n.id);
      if (!content) continue;

      for (const m of content.matchAll(/assets\/([0-9a-f-]+)\.([a-z0-9]+)/gi)) {
        if (!attExt.has(m[1])) attExt.set(m[1], m[2]);
      }
    }
  }

  for (const c of incomingAtts) {
    const ext = attExt.get(c.opened.id);
    if (!ext) continue;

    await store.writeAttachment(c.opened.id, ext, c.opened.payload);
    ledger.set(attKey(c.opened.id), c.rev);
  }

  await ledger.save(store);
  await index.rebuild(store);
}
