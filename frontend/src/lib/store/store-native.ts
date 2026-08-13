import type { VaultStore, NoteMeta } from "./store.svelte.ts";
import { parseFrontmatter, writeFrontmatter } from "./store.svelte.ts";
import type { NativeFs } from "../util/tauri.ts";
import { sanitizeFileName, sanitizeFolderPath } from "../io/export.ts";
import { isConflictTitle } from "../util/format.ts";

export class VaultMismatchError extends Error {
  constructor() {
    super("vault folder belongs to a different vault");
    this.name = "VaultMismatchError";
  }
}

interface NativeState {
  vaultId: string;
  serverUrl?: string;
  token?: string;
  revs: Record<string, number>;
  tomb: Record<string, number>;
  dirty: Record<string, boolean>;
  paths: Record<string, string>;
  atts: Record<string, string>;
  mtimes: Record<string, number>;
}

function freshState(vaultId: string): NativeState {
  return {
    vaultId,
    revs: {},
    tomb: {},
    dirty: {},
    paths: {},
    atts: {},
    mtimes: {},
  };
}

function dirname(rel: string): string {
  const i = rel.lastIndexOf("/");

  return i < 0 ? "" : rel.slice(0, i);
}

function basename(rel: string): string {
  const i = rel.lastIndexOf("/");

  return i < 0 ? rel : rel.slice(i + 1);
}

function normalizeDir(d: string): string {
  return d.replace(/[\\/]+$/, "").replace(/\\/g, "/");
}

export class NativeStore implements VaultStore {
  readonly vaultId: string;
  vaultDir: string;
  private fs: NativeFs;
  private state: NativeState = freshState("");
  private idToPath = new Map<string, string>();
  private metas = new Map<string, NoteMeta>();
  private attExt = new Map<string, string>();

  constructor(vaultId: string, vaultDir: string, fs: NativeFs) {
    this.vaultId = vaultId;
    this.vaultDir = normalizeDir(vaultDir);
    this.fs = fs;
  }

  private abs(rel: string): string {
    return this.vaultDir + (rel ? `/${rel}` : "");
  }

  private async mkdirAll(rel: string): Promise<void> {
    if (!rel) return;

    try {
      await this.fs.mkdir(this.abs(rel), { recursive: true });
    } catch {}
  }

  private async exists(rel: string): Promise<boolean> {
    try {
      return await this.fs.exists(this.abs(rel));
    } catch {
      return false;
    }
  }

  private async writeFile(
    rel: string,
    data: string | Uint8Array<ArrayBuffer>,
  ): Promise<void> {
    await this.mkdirAll(dirname(rel));

    if (typeof data === "string") {
      await this.fs.writeTextFile(this.abs(rel), data);
    } else {
      await this.fs.writeFile(this.abs(rel), data);
    }
  }

  async init(): Promise<void> {
    await this.loadState();
    await this.saveState();
    await this.rescan();
  }

  async setVaultDir(dir: string): Promise<void> {
    this.vaultDir = normalizeDir(dir);
    this.idToPath.clear();
    this.metas.clear();
    this.attExt.clear();
    await this.loadState();
    await this.saveState();
    await this.rescan();
  }

  async resetLocal(): Promise<void> {
    const p = this.abs(".folio");

    try {
      await this.fs.remove(p, { recursive: true });
    } catch {}

    this.idToPath.clear();
    this.metas.clear();
    this.attExt.clear();
    this.state = freshState(this.vaultId);
    await this.saveState();
    await this.rescan();
  }

  async setConnection(serverUrl: string, token: string): Promise<void> {
    this.state.serverUrl = serverUrl;
    this.state.token = token;
    await this.saveState();
  }

  private async loadState(): Promise<void> {
    const p = this.abs(".folio/state.json");
    let raw: string | null = null;

    try {
      if (await this.fs.exists(p)) raw = await this.fs.readTextFile(p);
    } catch {
      raw = null;
    }

    if (raw === null) {
      this.state = freshState(this.vaultId);

      return;
    }

    let parsed: Partial<NativeState>;
    try {
      parsed = JSON.parse(raw) as Partial<NativeState>;
    } catch {
      try {
        await this.fs.rename(p, `${p}.bak`);
      } catch {}

      this.state = freshState(this.vaultId);

      return;
    }

    if (parsed.vaultId && parsed.vaultId !== this.vaultId) {
      throw new VaultMismatchError();
    }

    this.state = {
      vaultId: this.vaultId,
      serverUrl:
        typeof parsed.serverUrl === "string" ? parsed.serverUrl : undefined,
      token: typeof parsed.token === "string" ? parsed.token : undefined,
      revs: parsed.revs ?? {},
      tomb: parsed.tomb ?? {},
      dirty: parsed.dirty ?? {},
      paths: parsed.paths ?? {},
      atts: parsed.atts ?? {},
      mtimes: parsed.mtimes ?? {},
    };
  }

  private async saveState(): Promise<void> {
    await this.mkdirAll(".folio");
    await this.fs.writeTextFile(
      this.abs(".folio/state.json"),
      JSON.stringify(this.state, null, 2),
    );
  }

  async rescan(): Promise<void> {
    const files: string[] = [];

    await this.walk("", files);

    const metas = new Map<string, NoteMeta>();
    const idToPath = new Map<string, string>();

    for (const rel of files) {
      if (!/\.md$/i.test(rel)) continue;

      await this.scanNote(rel, metas, idToPath);
    }

    this.metas = metas;
    this.idToPath = idToPath;
    await this.scanAtts();
    await this.saveState();
  }

  private async walk(dirRel: string, out: string[]): Promise<void> {
    let entries: { name: string; isDir: boolean }[] = [];

    try {
      const read = await this.fs.readDir(this.abs(dirRel));
      entries = read.map((e) => ({ name: e.name, isDir: e.isDir }));
    } catch {
      return;
    }

    for (const e of entries) {
      if (e.name === ".folio" || e.name === "assets") continue;

      const rel = dirRel ? `${dirRel}/${e.name}` : e.name;

      if (e.isDir) {
        await this.walk(rel, out);
      } else {
        out.push(rel);
      }
    }
  }

  private async scanNote(
    rel: string,
    metas: Map<string, NoteMeta>,
    idToPath: Map<string, string>,
  ): Promise<void> {
    const absPath = this.abs(rel);
    let content: string;

    try {
      content = await this.fs.readTextFile(absPath);
    } catch {
      return;
    }

    const { meta: fm, body } = parseFrontmatter(content);
    const relFolder = dirname(rel);
    const stem = basename(rel).replace(/\.md$/i, "");
    const mtime =
      (await this.fs.stat(absPath).catch(() => null))?.mtimeMs ?? Date.now();
    let id: string;
    let title: string;
    let dirty = false;

    if (fm.id) {
      id = fm.id;
      title = fm.title?.trim() || sanitizeFileName(stem || "untitled");

      if (fm.folder && fm.folder !== relFolder) {
        const fixed = writeFrontmatter(
          {
            id,
            title,
            created: fm.created ?? mtime,
            updated: fm.updated ?? mtime,
            tags: fm.tags ?? [],
            pinned: fm.pinned ?? false,
            folder: relFolder,
            trashed: fm.trashed ?? false,
          },
          body,
        );

        await this.fs.writeTextFile(absPath, fixed).catch(() => {});
        dirty = true;
      }
    } else {
      id = crypto.randomUUID();
      title = sanitizeFileName(stem || "untitled");
      const added = writeFrontmatter(
        {
          id,
          title,
          created: mtime,
          updated: mtime,
          tags: [],
          pinned: false,
          folder: relFolder,
        },
        content,
      );

      await this.fs.writeTextFile(absPath, added).catch(() => {});
      dirty = true;
    }

    if (fm.id && !dirty) {
      const lastMtime = this.state.mtimes[id];

      if (lastMtime && mtime > lastMtime + 500) {
        dirty = true;
      }
    }

    const meta: NoteMeta = {
      id,
      title,
      folder: relFolder,
      tags: fm.tags ?? [],
      pinned: fm.pinned ?? false,
      created: fm.created ?? mtime,
      updated: fm.updated ?? mtime,
      rev: this.state.revs[id] ?? -1,
      conflict: isConflictTitle(title),
      trashed: fm.trashed ?? false,
      dirty: this.state.dirty[id] ?? dirty,
    };

    this.state.paths[id] = rel;
    this.state.mtimes[id] = mtime;
    if (dirty) this.state.dirty[id] = true;
    metas.set(id, meta);
    idToPath.set(id, rel);
  }

  private async scanAtts(): Promise<void> {
    const attExt = new Map<string, string>();
    let entries: { name: string; isDir: boolean }[] = [];

    try {
      const read = await this.fs.readDir(this.abs("assets"));
      entries = read.map((e) => ({ name: e.name, isDir: e.isDir }));
    } catch {}

    for (const e of entries) {
      if (e.isDir) continue;

      const m = /^([0-9a-f-]{8,36})\.(\w+)$/.exec(e.name);
      if (m) attExt.set(m[1], m[2]);
    }

    this.attExt = attExt;
    this.state.atts = Object.fromEntries(attExt);
  }

  async listNotes(): Promise<NoteMeta[]> {
    return [...this.metas.values()];
  }

  async readNote(id: string): Promise<string | null> {
    const rel = this.idToPath.get(id) ?? this.state.paths[id];
    if (!rel) return null;

    try {
      return await this.fs.readTextFile(this.abs(rel));
    } catch {
      return null;
    }
  }

  async writeNote(id: string, meta: NoteMeta, md: string): Promise<void> {
    const folder = sanitizeFolderPath(meta.folder ?? "");
    const title = sanitizeFileName(meta.title || "untitled");
    const target = folder ? `${folder}/${title}.md` : `${title}.md`;
    const cur = this.idToPath.get(id) ?? this.state.paths[id];
    let finalRel = target;

    if (cur && cur !== target) {
      const ownerId = await this.noteIdAt(target);

      if (ownerId === id) {
        finalRel = target;
      } else {
        finalRel = await this.dedupePath(target);

        if (finalRel !== cur && (await this.exists(cur))) {
          await this.mkdirAll(dirname(finalRel));
          await this.fs.rename(this.abs(cur), this.abs(finalRel));
        }
      }
    } else if (!cur) {
      finalRel = await this.dedupePath(target);
    }

    await this.writeFile(finalRel, md);

    const mtime =
      (await this.fs.stat(this.abs(finalRel)).catch(() => null))?.mtimeMs ??
      Date.now();

    this.idToPath.set(id, finalRel);
    this.state.paths[id] = finalRel;
    this.state.mtimes[id] = mtime;
    if (meta.rev >= 0) this.state.revs[id] = meta.rev;
    if (meta.dirty === true) this.state.dirty[id] = true;
    else delete this.state.dirty[id];
    this.metas.set(id, {
      ...meta,
      folder,
      rev: meta.rev >= 0 ? meta.rev : (this.state.revs[id] ?? meta.rev),
      conflict: isConflictTitle(meta.title),
    });
    await this.saveState();
  }

  async deleteNote(id: string): Promise<void> {
    const rel = this.idToPath.get(id) ?? this.state.paths[id];

    if (rel) {
      try {
        await this.fs.remove(this.abs(rel));
      } catch {}
    }

    this.idToPath.delete(id);
    this.metas.delete(id);
    delete this.state.paths[id];
    delete this.state.dirty[id];
    delete this.state.mtimes[id];
    await this.saveState();
  }

  private async noteIdAt(rel: string): Promise<string | null> {
    try {
      const content = await this.fs.readTextFile(this.abs(rel));

      return parseFrontmatter(content).meta.id ?? null;
    } catch {
      return null;
    }
  }

  private async dedupePath(target: string): Promise<string> {
    if (!(await this.exists(target))) return target;

    const dir = dirname(target);
    const stem = basename(target).replace(/\.md$/i, "");
    const prefix = dir ? `${dir}/` : "";
    let n = 2;
    let cand = `${prefix}${stem} ${n}.md`;

    while (await this.exists(cand)) {
      n += 1;
      cand = `${prefix}${stem} ${n}.md`;
    }

    return cand;
  }

  async listAttachments(): Promise<{ id: string; ext: string }[]> {
    return [...this.attExt.entries()].map(([id, ext]) => ({ id, ext }));
  }

  async readAttachment(id: string): Promise<Uint8Array<ArrayBuffer> | null> {
    const ext = this.attExt.get(id) ?? this.state.atts[id];
    if (!ext) return null;

    try {
      return await this.fs.readFile(this.abs(`assets/${id}.${ext}`));
    } catch {
      return null;
    }
  }

  async writeAttachment(
    id: string,
    ext: string,
    bytes: Uint8Array<ArrayBuffer>,
  ): Promise<void> {
    await this.writeFile(`assets/${id}.${ext}`, bytes);
    this.attExt.set(id, ext);
    this.state.atts[id] = ext;
    await this.saveState();
  }

  async deleteAttachment(id: string): Promise<void> {
    const ext = this.attExt.get(id) ?? this.state.atts[id];

    if (ext) {
      try {
        await this.fs.remove(this.abs(`assets/${id}.${ext}`));
      } catch {}
    }

    this.attExt.delete(id);
    delete this.state.atts[id];
    await this.saveState();
  }

  async setServerRevs(
    map: Map<string, number>,
    tombMap?: Map<string, number>,
  ): Promise<void> {
    this.state.revs = {};
    for (const [k, v] of map) this.state.revs[k] = v;

    this.state.tomb = {};
    if (tombMap) for (const [k, v] of tombMap) this.state.tomb[k] = v;

    for (const [id, meta] of this.metas) {
      if (this.state.revs[id] !== undefined) meta.rev = this.state.revs[id];
    }

    await this.saveState();
  }

  async getServerRevs(): Promise<Map<string, number>> {
    return new Map(Object.entries(this.state.revs));
  }

  async getServerTombRevs(): Promise<Map<string, number>> {
    return new Map(Object.entries(this.state.tomb));
  }

  async clearAll(): Promise<void> {
    const entries = await this.fs.readDir(this.vaultDir).catch(() => []);

    for (const e of entries) {
      const p = `${this.vaultDir}/${e.name}`;
      await this.fs.remove(p, { recursive: true }).catch(() => {});
    }

    this.idToPath.clear();
    this.metas.clear();
    this.attExt.clear();
    this.state = freshState(this.vaultId);
  }
}
