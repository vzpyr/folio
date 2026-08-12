import type { VaultStore } from "../store/store.svelte.ts";
import { isAttKey } from "./types.ts";

export class Ledger {
  private revs = new Map<string, number>();
  private tomb = new Map<string, number>();
  private dirty = new Set<string>();
  private tombDirty = new Set<string>();

  load(revs: Map<string, number>, tombRevs?: Map<string, number>): void {
    this.revs = new Map(revs);
    this.tomb = new Map(tombRevs ?? []);
    this.dirty.clear();
    this.tombDirty.clear();
  }

  get(key: string): number {
    return this.revs.get(key) ?? 0;
  }

  knownRev(key: string): number {
    return Math.max(this.revs.get(key) ?? 0, this.tomb.get(key) ?? 0);
  }

  has(key: string): boolean {
    return this.revs.has(key);
  }

  set(key: string, rev: number): void {
    this.revs.set(key, rev);

    if (this.tomb.delete(key)) this.tombDirty.add(key);

    this.dirty.add(key);
  }

  setTomb(key: string, rev: number): void {
    this.tomb.set(key, rev);
    this.tombDirty.add(key);
  }

  delete(key: string): void {
    this.revs.delete(key);
    this.dirty.add(key);
  }

  keys(): IterableIterator<string> {
    return this.revs.keys();
  }

  noteKeys(): string[] {
    return [...this.revs.keys()].filter((k) => !isAttKey(k));
  }

  allKeys(): string[] {
    const out = new Set<string>(this.revs.keys());
    for (const k of this.tomb.keys()) out.add(k);

    return [...out];
  }

  snapshot(): Map<string, number> {
    return new Map(this.revs);
  }

  tombSnapshot(): Map<string, number> {
    return new Map(this.tomb);
  }

  async save(store: VaultStore): Promise<void> {
    if (this.dirty.size === 0 && this.tombDirty.size === 0) return;

    await store.setServerRevs(this.snapshot(), this.tombSnapshot());
    this.dirty.clear();
    this.tombDirty.clear();
  }

  baseRevFor(noteKey: string, metaRev: number): number {
    const latest = this.revs.get(noteKey);

    if (latest !== undefined) {
      return metaRev > 0 ? Math.min(metaRev, latest) : latest;
    }

    return metaRev > 0 ? metaRev : 0;
  }
}
