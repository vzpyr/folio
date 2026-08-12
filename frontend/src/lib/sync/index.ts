export { SyncEngine } from "./engine.ts";
export type { EngineHooks } from "./engine.ts";
export type {
  SyncStatus,
  SyncNotice,
  SyncNoticeKind,
  ManifestItem,
} from "./types.ts";
export { syncNotices, addNotice, dismissNotice } from "./notices.svelte.ts";
export type { VaultStore, NoteIndex, NoteMeta } from "../store/store.svelte.ts";
