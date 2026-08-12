import type { VaultStore, NoteIndex } from "../store/store.svelte.ts";
import type { Keys } from "../util/crypto.ts";
import type { SyncStatus } from "./types.ts";
import {
  SETTLE_MS,
  SSE_DEBOUNCE_MS,
  POLL_MS,
  isNetworkError,
} from "./types.ts";
import { ApiClient, Backoff } from "./transport.ts";
import { Ledger } from "./ledger.ts";
import { push, tombstoneNote } from "./push.ts";
import { pull } from "./pull.ts";
import type { SyncContext } from "./conflict.ts";

export interface EngineHooks {
  onState(
    status: SyncStatus,
    lastSync: number | null,
    lastError: string | null,
  ): void;
  onPendingEdits(count: number): void;
}

export class SyncEngine {
  readonly store: VaultStore;
  readonly index: NoteIndex;
  readonly keys: Keys;
  readonly ledger = new Ledger();
  private readonly api: ApiClient;
  private readonly hooks: EngineHooks;
  onBeforeCycle?: () => Promise<void> | void;
  status: SyncStatus = "synced";
  private lastSync: number | null = null;
  private lastError: string | null = null;
  private running = false;
  private chain: Promise<unknown> = Promise.resolve();
  private sseAbort: AbortController | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private followUpTimer: ReturnType<typeof setTimeout> | null = null;
  private nudgeTimer: ReturnType<typeof setTimeout> | null = null;
  private backoff = new Backoff();
  private visibilityHandler: () => void = () => {};

  constructor(
    url: string,
    token: string,
    keys: Keys,
    store: VaultStore,
    index: NoteIndex,
    hooks: EngineHooks,
  ) {
    this.keys = keys;
    this.store = store;
    this.index = index;
    this.hooks = hooks;
    this.api = new ApiClient(url, token, keys.vaultId);
  }

  get isRunning(): boolean {
    return this.running;
  }

  async init(): Promise<void> {
    this.ledger.load(
      await this.store.getServerRevs(),
      await this.store.getServerTombRevs(),
    );
  }

  start(): void {
    if (this.running) return;

    this.running = true;
    void this.sseLoop();
    this.startPoll();

    if (typeof document !== "undefined") {
      this.visibilityHandler = () => {
        if (document.visibilityState === "visible") {
          void this.sync();
          if (!this.sseAbort) void this.sseLoop();
        } else {
          this.stopSse();
        }
      };
      document.addEventListener("visibilitychange", this.visibilityHandler);
    }
  }

  nudge(): void {
    void this.refreshPendingEdits();

    if (this.nudgeTimer) clearTimeout(this.nudgeTimer);

    this.nudgeTimer = setTimeout(() => {
      this.nudgeTimer = null;
      void this.sync();
    }, SSE_DEBOUNCE_MS);
  }

  sync(): Promise<void> {
    return this.runExclusive(async () => {
      await this.onBeforeCycle?.();
      await this.pushCycle();
      await this.pullCycle();
    });
  }

  pushPending(): Promise<void> {
    return this.runExclusive(async () => {
      await this.onBeforeCycle?.();
      await this.pushCycle();
    });
  }

  pull(): Promise<void> {
    return this.runExclusive(async () => {
      await this.onBeforeCycle?.();
      await this.pullCycle();
    });
  }

  async pushDelete(id: string): Promise<void> {
    return this.runExclusive(async () => {
      await this.onBeforeCycle?.();

      try {
        await tombstoneNote(this.ctx(), id);
        await this.ledger.save(this.store);
        await this.index.rebuild(this.store);
      } catch (e: unknown) {
        if (isNetworkError(e)) {
          this.setStatus("offline");
          this.scheduleReconnect();

          return;
        }

        throw e;
      }

      await this.refreshPendingEdits();
    });
  }

  async destroy(): Promise<void> {
    this.running = false;
    this.stopSse();
    this.stopPoll();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.followUpTimer) {
      clearTimeout(this.followUpTimer);
      this.followUpTimer = null;
    }

    if (this.nudgeTimer) {
      clearTimeout(this.nudgeTimer);
      this.nudgeTimer = null;
    }

    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.visibilityHandler);
    }

    await this.chain.catch(() => undefined);
  }

  private ctx(): SyncContext {
    return {
      keys: this.keys,
      store: this.store,
      index: this.index,
      api: this.api,
      ledger: this.ledger,
    };
  }

  private runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.chain.then(() => {
      if (!this.running) return undefined as unknown as T;

      return fn();
    });

    this.chain = p.then(
      () => undefined,
      () => undefined,
    );

    return p;
  }

  private setStatus(s: SyncStatus, err?: string | null): void {
    this.status = s;
    this.lastError = err ?? null;
    this.hooks.onState(s, this.lastSync, this.lastError);
  }

  private async pushCycle(): Promise<void> {
    this.setStatus("syncing");

    try {
      const result = await push(this.ctx());

      if (result.unsettled.length > 0)
        this.scheduleSettleFollowUp(result.unsettled);

      this.finishCycle();
    } catch (e: unknown) {
      this.handleCycleError(e);
    }
  }

  private async pullCycle(): Promise<void> {
    this.setStatus("syncing");

    try {
      await pull(this.ctx());
      this.finishCycle();
    } catch (e: unknown) {
      this.handleCycleError(e);
    }
  }

  private finishCycle(): void {
    this.backoff.reset();
    this.lastSync = Date.now();
    if (this.status !== "error") this.setStatus("synced");
    void this.refreshPendingEdits();
  }

  private handleCycleError(e: unknown): void {
    if (isNetworkError(e)) {
      this.setStatus("offline");
      this.scheduleReconnect();
    } else {
      const msg = e instanceof Error ? e.message : "sync error";
      this.setStatus("error", msg);
    }
  }

  private async refreshPendingEdits(): Promise<void> {
    try {
      const notes = await this.store.listNotes();
      this.hooks.onPendingEdits(notes.filter((n) => n.dirty).length);
    } catch {
      this.hooks.onPendingEdits(0);
    }
  }

  private async sseLoop(): Promise<void> {
    this.stopSse();
    if (!this.running) return;

    const ac = new AbortController();
    this.sseAbort = ac;
    let result: "ended" | "failed" = "ended";

    try {
      await this.api.streamEvents(() => this.nudge(), ac.signal);
    } catch {
      result = "failed";
      if (ac.signal.aborted) return;
    }

    if (!this.running || this.sseAbort !== ac) return;

    this.sseAbort = null;
    this.setStatus(
      "offline",
      result === "failed" ? "connection to server lost" : null,
    );
    this.scheduleReconnect();
  }

  private stopSse(): void {
    if (this.sseAbort) {
      this.sseAbort.abort();
      this.sseAbort = null;
    }
  }

  private scheduleReconnect(): void {
    if (!this.running || this.reconnectTimer) return;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.sync().then(() => {
        if (this.running) void this.sseLoop();
      });
    }, this.backoff.next());
  }

  private startPoll(): void {
    this.stopPoll();

    this.pollTimer = setInterval(() => {
      if (
        typeof document === "undefined" ||
        document.visibilityState === "visible"
      ) {
        void this.sync();
      }
    }, POLL_MS);
  }

  private stopPoll(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  scheduleSettleFollowUp(notes: { id: string; updated: number }[]): void {
    if (!this.running || this.followUpTimer) return;

    const now = Date.now();
    let minAge = Infinity;
    for (const n of notes) minAge = Math.min(minAge, now - (n.updated ?? 0));

    if (!Number.isFinite(minAge)) return;

    const wait = Math.max(0, SETTLE_MS - minAge);

    this.followUpTimer = setTimeout(() => {
      this.followUpTimer = null;
      void this.sync();
    }, wait);
  }
}
