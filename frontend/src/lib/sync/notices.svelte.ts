import type { SyncNotice, SyncNoticeKind } from "./types.ts";

const MAX_NOTICES = 6;
const AUTO_DISMISS_MS = 15000;

export const syncNotices = $state<SyncNotice[]>([]);

export function addNotice(
  kind: SyncNoticeKind,
  text: string,
  detail?: string,
): void {
  const notice: SyncNotice = {
    id: crypto.randomUUID(),
    kind,
    text,
    detail,
    at: Date.now(),
  };

  syncNotices.push(notice);

  if (syncNotices.length > MAX_NOTICES)
    syncNotices.splice(0, syncNotices.length - MAX_NOTICES);

  setTimeout(() => dismissNotice(notice.id), AUTO_DISMISS_MS);
}

export function dismissNotice(id: string): void {
  const i = syncNotices.findIndex((n) => n.id === id);
  if (i !== -1) syncNotices.splice(i, 1);
}

export function clearNotices(): void {
  syncNotices.splice(0, syncNotices.length);
}
