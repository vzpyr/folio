import type { Envelope } from "../util/crypto.ts";

export type SyncStatus = "synced" | "syncing" | "offline" | "error";

export interface ManifestItem {
  id: string;
  rev: number;
}

export interface Change {
  opaque: string;
  rev: number;
  env: Envelope;
}

export type SyncNoticeKind = "conflict" | "info" | "error";

export interface SyncNotice {
  id: string;
  kind: SyncNoticeKind;
  text: string;
  detail?: string;
  at: number;
}

export function attKey(id: string): string {
  return "att:" + id;
}

export function isAttKey(key: string): boolean {
  return key.startsWith("att:");
}

export const SETTLE_MS = 1200;
export const SSE_DEBOUNCE_MS = 500;
export const POLL_MS = 30000;
export const MAX_RECONNECT_BACKOFF_MS = 30000;

export function isNetworkError(e: unknown): boolean {
  return e instanceof TypeError && /fetch/i.test(e.message);
}
