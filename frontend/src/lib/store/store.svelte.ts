import {
  parseFrontmatter,
  writeFrontmatter,
  extractTitle,
  extractWikiLinks,
} from "../editor/markdown.ts";
import { isFolderRegistryId } from "./folders.ts";
import { SearchIndex, type SearchHit } from "./search.ts";

export interface NoteMeta {
  id: string;
  title: string;
  folder: string;
  tags: string[];
  pinned: boolean;
  created: number;
  updated: number;
  rev: number;
  conflict: boolean;
  dirty?: boolean;
  trashed?: boolean;
  preview?: string;
}

export interface Attachment {
  id: string;
  ext: string;
  bytes: Uint8Array;
}

export interface VaultStore {
  init(): Promise<void>;
  listNotes(): Promise<NoteMeta[]>;
  readNote(id: string): Promise<string | null>;
  writeNote(id: string, meta: NoteMeta, md: string): Promise<void>;
  deleteNote(id: string): Promise<void>;
  listAttachments(): Promise<{ id: string; ext: string }[]>;
  readAttachment(id: string): Promise<Uint8Array<ArrayBuffer> | null>;
  writeAttachment(
    id: string,
    ext: string,
    bytes: Uint8Array<ArrayBuffer>,
  ): Promise<void>;
  deleteAttachment(id: string): Promise<void>;
  setServerRevs(
    revs: Map<string, number>,
    tombRevs?: Map<string, number>,
  ): Promise<void>;
  getServerRevs(): Promise<Map<string, number>>;
  getServerTombRevs(): Promise<Map<string, number>>;
  clearAll(): Promise<void>;
}

const DB_NAME = "folio";
const DB_VERSION = 1;

function openDb(idb: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = idb.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;

      if (!db.objectStoreNames.contains("entries")) {
        db.createObjectStore("entries", { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txGet<T>(
  db: IDBDatabase,
  store: string,
  key: string,
): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const s = tx.objectStore(store);
    const req = s.get(key);

    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

function txGetAll<T>(db: IDBDatabase, store: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const s = tx.objectStore(store);
    const req = s.getAll();

    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

function txPut(db: IDBDatabase, store: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    const s = tx.objectStore(store);
    const req = s.put(value);

    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function txDelete(db: IDBDatabase, store: string, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    const s = tx.objectStore(store);
    const req = s.delete(key);

    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function txClear(db: IDBDatabase, store: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    const s = tx.objectStore(store);
    const req = s.clear();

    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

interface NoteRecord {
  key: string;
  id: string;
  meta: NoteMeta;
  content: string;
}

interface AttRecord {
  key: string;
  id: string;
  ext: string;
  blob: Blob;
}

interface StateRecord {
  key: string;
  revs: Record<string, number>;
  tomb: Record<string, number>;
}

export class BrowserStore implements VaultStore {
  private db!: IDBDatabase;
  private vaultId: string;
  private idb: IDBFactory;

  constructor(vaultId: string, idb: IDBFactory = indexedDB) {
    this.vaultId = vaultId;
    this.idb = idb;
  }

  async init(): Promise<void> {
    this.db = await openDb(this.idb);
  }

  private noteKey(id: string): string {
    return `note:${this.vaultId}:${id}`;
  }

  private attKey(id: string): string {
    return `att:${this.vaultId}:${id}`;
  }

  private stateKey(): string {
    return `state:${this.vaultId}`;
  }

  async listNotes(): Promise<NoteMeta[]> {
    const all = await txGetAll<NoteRecord>(this.db, "entries");

    return all
      .filter((r) => r.key.startsWith(`note:${this.vaultId}:`))
      .map((r) => r.meta);
  }

  async readNote(id: string): Promise<string | null> {
    const rec = await txGet<NoteRecord>(this.db, "entries", this.noteKey(id));

    return rec?.content ?? null;
  }

  async writeNote(id: string, meta: NoteMeta, md: string): Promise<void> {
    await txPut(this.db, "entries", {
      key: this.noteKey(id),
      id,
      meta: { ...meta, preview: undefined, tags: [...(meta.tags ?? [])] },
      content: md,
    } satisfies NoteRecord);
  }

  async deleteNote(id: string): Promise<void> {
    await txDelete(this.db, "entries", this.noteKey(id));
  }

  async listAttachments(): Promise<{ id: string; ext: string }[]> {
    const all = await txGetAll<AttRecord>(this.db, "entries");

    return all
      .filter((r) => r.key.startsWith(`att:${this.vaultId}:`))
      .map((r) => ({ id: r.id, ext: r.ext }));
  }

  async readAttachment(id: string): Promise<Uint8Array<ArrayBuffer> | null> {
    const rec = await txGet<AttRecord>(this.db, "entries", this.attKey(id));
    if (!rec) return null;

    return new Uint8Array(await rec.blob.arrayBuffer());
  }

  async writeAttachment(
    id: string,
    ext: string,
    bytes: Uint8Array<ArrayBuffer>,
  ): Promise<void> {
    await txPut(this.db, "entries", {
      key: this.attKey(id),
      id,
      ext,
      blob: new Blob([bytes]),
    } satisfies AttRecord);
  }

  async deleteAttachment(id: string): Promise<void> {
    await txDelete(this.db, "entries", this.attKey(id));
  }

  async setServerRevs(
    map: Map<string, number>,
    tombMap?: Map<string, number>,
  ): Promise<void> {
    const key = this.stateKey();
    const revs: Record<string, number> = {};
    for (const [k, v] of map) revs[k] = v;

    const tomb: Record<string, number> = {};
    if (tombMap) for (const [k, v] of tombMap) tomb[k] = v;

    await txPut(this.db, "entries", { key, revs, tomb } satisfies StateRecord);
  }

  async getServerRevs(): Promise<Map<string, number>> {
    const existing = await txGet<StateRecord>(
      this.db,
      "entries",
      this.stateKey(),
    );
    const map = new Map<string, number>();

    if (existing?.revs) {
      for (const [k, v] of Object.entries(existing.revs)) map.set(k, v);
    }

    return map;
  }

  async getServerTombRevs(): Promise<Map<string, number>> {
    const existing = await txGet<StateRecord>(
      this.db,
      "entries",
      this.stateKey(),
    );
    const map = new Map<string, number>();

    if (existing?.tomb) {
      for (const [k, v] of Object.entries(existing.tomb)) map.set(k, v);
    }

    return map;
  }

  async clearAll(): Promise<void> {
    await txClear(this.db, "entries");
  }
}

export async function setTrashed(
  store: VaultStore,
  index: NoteIndex,
  id: string,
  trashed: boolean,
): Promise<void> {
  const cur = index.getById(id);
  const content = await store.readNote(id);

  if (!cur || !content) return;

  const { meta: fm, body } = parseFrontmatter(content);
  const now = Date.now();
  const meta: NoteMeta = {
    ...cur,
    trashed,
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
      pinned: cur.pinned,
      folder: cur.folder,
      trashed,
    },
    body,
  );

  await store.writeNote(id, meta, newContent);
  await index.upsert(meta, newContent);
}

function extractPreview(body: string): string {
  const lines = body.split("\n");

  for (const line of lines) {
    const t = line.trim();

    if (!t) continue;
    if (t === "---") continue;
    if (/^#{1,6}\s/.test(t)) continue;
    if (/^-{3,}$|^\*{3,}$|^_{3,}$/.test(t)) continue;

    const stripped = t
      .replace(/^[-*+]\s+/, "")
      .replace(/^>\s*/, "")
      .replace(/[*_`~]/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/\[\[([^\]]+)\]\]/g, "$1")
      .trim();

    if (!stripped) continue;

    return stripped.length > 120 ? stripped.slice(0, 120) + "…" : stripped;
  }

  return "";
}

let _notes = $state<NoteMeta[]>([]);
let _trash = $state<NoteMeta[]>([]);
let _folders = $state<Map<string, number>>(new Map());
let _tagCounts = $state<Map<string, number>>(new Map());

export class NoteIndex {
  private byId = new Map<string, NoteMeta>();
  private titleToId = new Map<string, string[]>();
  private backlinkMap = new Map<string, Set<string>>();
  private referrerMap = new Map<string, Set<string>>();
  private searchIndex = new SearchIndex();

  async rebuild(store: VaultStore): Promise<void> {
    const list = await store.listNotes();
    const all = list.filter((n) => !isFolderRegistryId(n.id));
    const visible = all.filter((n) => !n.trashed);
    const trashedList = all.filter((n) => !!n.trashed);

    this.byId.clear();
    this.titleToId.clear();
    this.backlinkMap.clear();
    this.referrerMap.clear();
    this.searchIndex = new SearchIndex();

    const newFolders = new Map<string, number>();
    const newTags = new Map<string, number>();

    for (const n of visible) {
      this.byId.set(n.id, n);

      if (n.title) {
        const key = n.title.toLowerCase();
        const arr = this.titleToId.get(key) ?? [];
        arr.push(n.id);
        this.titleToId.set(key, arr);
      }

      for (const t of n.tags) {
        newTags.set(t, (newTags.get(t) ?? 0) + 1);
      }

      if (n.folder) {
        newFolders.set(n.folder, (newFolders.get(n.folder) ?? 0) + 1);
      }
    }

    for (const n of trashedList) {
      this.byId.set(n.id, n);
    }

    for (const n of visible) {
      const content = await store.readNote(n.id);

      if (content) {
        this.scanBacklinks(n.id, content);

        const { body } = parseFrontmatter(content);
        n.preview = extractPreview(body);
        this.searchIndex.add(n.id, n.title, body);
      }
    }

    for (const n of trashedList) {
      const content = await store.readNote(n.id);

      if (content) {
        const { body } = parseFrontmatter(content);
        n.preview = extractPreview(body);
        this.searchIndex.add(n.id, n.title, body);
      }
    }

    _notes = visible;
    _trash = trashedList;
    _folders = newFolders;
    _tagCounts = newTags;
  }

  private scanBacklinks(id: string, content: string): void {
    const { body } = parseFrontmatter(content);
    const targets = new Set<string>();

    for (const t of extractWikiLinks(body)) {
      const ids = this.titleToId.get(t.toLowerCase()) ?? [];

      for (const targetId of ids) {
        if (targetId !== id) targets.add(targetId);
      }
    }

    for (const targetId of targets) {
      if (!this.backlinkMap.has(targetId))
        this.backlinkMap.set(targetId, new Set());

      this.backlinkMap.get(targetId)!.add(id);
    }

    this.referrerMap.set(id, targets);
    this.backlinkMap = new Map(this.backlinkMap);
    this.referrerMap = new Map(this.referrerMap);
  }

  async upsert(meta: NoteMeta, content: string): Promise<void> {
    if (isFolderRegistryId(meta.id)) return;

    const old = this.byId.get(meta.id);

    if (old) {
      if (old.title) {
        const key = old.title.toLowerCase();
        const arr = this.titleToId.get(key);

        if (arr) {
          const i = arr.indexOf(meta.id);
          if (i !== -1) arr.splice(i, 1);
          if (arr.length === 0) this.titleToId.delete(key);
        }
      }

      for (const t of old.tags) {
        const c = (_tagCounts.get(t) ?? 1) - 1;
        if (c <= 0) _tagCounts.delete(t);
        else _tagCounts.set(t, c);
      }

      if (old.folder && !old.trashed) {
        const c = (_folders.get(old.folder) ?? 1) - 1;

        if (c <= 0) {
          const next = new Map(_folders);
          next.delete(old.folder);
          _folders = next;
        } else {
          _folders = new Map(_folders).set(old.folder, c);
        }
      }

      const oldTargets = this.referrerMap.get(meta.id) ?? new Set();
      for (const t of oldTargets) this.backlinkMap.get(t)?.delete(meta.id);
      this.referrerMap.delete(meta.id);
    }

    const isTrashed = !!meta.trashed;
    const { body } = parseFrontmatter(content);
    meta.preview = extractPreview(body);
    this.searchIndex.add(meta.id, meta.title, body);

    if (isTrashed) {
      _notes = _notes.filter((n) => n.id !== meta.id);
      _trash = [..._trash.filter((n) => n.id !== meta.id), meta];
    } else {
      _trash = _trash.filter((n) => n.id !== meta.id);
      _notes = [..._notes.filter((n) => n.id !== meta.id), meta];
    }

    this.byId.set(meta.id, meta);

    if (meta.title) {
      const key = meta.title.toLowerCase();
      const arr = this.titleToId.get(key) ?? [];

      if (!arr.includes(meta.id)) arr.push(meta.id);

      this.titleToId.set(key, arr);
    }

    if (!isTrashed) {
      for (const t of meta.tags)
        _tagCounts.set(t, (_tagCounts.get(t) ?? 0) + 1);
    }

    if (meta.folder && !isTrashed) {
      const cur = _folders.get(meta.folder) ?? 0;
      _folders = new Map(_folders).set(meta.folder, cur + 1);
    }

    this.scanBacklinks(meta.id, content);
    _tagCounts = new Map(_tagCounts);
  }

  async remove(id: string): Promise<void> {
    if (isFolderRegistryId(id)) return;

    const old = this.byId.get(id);
    if (!old) return;

    if (old.title) {
      const key = old.title.toLowerCase();
      const arr = this.titleToId.get(key);

      if (arr) {
        const i = arr.indexOf(id);
        if (i !== -1) arr.splice(i, 1);
        if (arr.length === 0) this.titleToId.delete(key);
      }
    }

    for (const t of old.tags) {
      const c = (_tagCounts.get(t) ?? 1) - 1;
      if (c <= 0) _tagCounts.delete(t);
      else _tagCounts.set(t, c);
    }

    if (old.folder && !old.trashed) {
      const c = (_folders.get(old.folder) ?? 1) - 1;

      if (c <= 0) {
        const next = new Map(_folders);
        next.delete(old.folder);
        _folders = next;
      } else {
        _folders = new Map(_folders).set(old.folder, c);
      }
    }

    _tagCounts = new Map(_tagCounts);

    const targets = this.referrerMap.get(id) ?? new Set();
    for (const t of targets) this.backlinkMap.get(t)?.delete(id);

    this.referrerMap.delete(id);
    this.backlinkMap.delete(id);
    for (const referrers of this.referrerMap.values()) referrers.delete(id);

    this.byId.delete(id);
    this.searchIndex.remove(id);
    _notes = _notes.filter((n) => n.id !== id);
    _trash = _trash.filter((n) => n.id !== id);
  }

  get list(): NoteMeta[] {
    return _notes;
  }

  get all(): NoteMeta[] {
    return [..._notes, ..._trash];
  }

  get titleList(): string[] {
    return [...new Set(_notes.map((n) => n.title).filter(Boolean))];
  }

  getById(id: string): NoteMeta | undefined {
    return this.byId.get(id);
  }

  search(query: string): SearchHit[] {
    return this.searchIndex.search(query);
  }

  resolveLink(target: string): string | undefined {
    if (this.byId.has(target)) return target;

    const ids = this.titleToId.get(target.toLowerCase());
    if (ids && ids.length === 1) return ids[0];

    return undefined;
  }

  backlinks(id: string): NoteMeta[] {
    const referrers = this.backlinkMap.get(id);
    if (!referrers) return [];

    return [...referrers].map((rId) => this.byId.get(rId)!).filter(Boolean);
  }

  get tagList(): { tag: string; count: number }[] {
    return [..._tagCounts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => a.tag.localeCompare(b.tag));
  }

  get folderList(): { folder: string; count: number }[] {
    return [..._folders.entries()]
      .map(([folder, count]) => ({ folder, count }))
      .sort((a, b) => a.folder.localeCompare(b.folder));
  }

  get trashList(): NoteMeta[] {
    return _trash;
  }

  get trashCount(): number {
    return _trash.length;
  }

  extractTitleFor(id: string, content: string): string {
    return extractTitle(content, id);
  }
}

export { parseFrontmatter, writeFrontmatter, extractTitle };
