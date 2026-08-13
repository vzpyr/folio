import type { VaultStore, NoteIndex } from "./lib/store/store.svelte.ts";
import type { SyncEngine } from "./lib/sync";
import type { SyncStatus } from "./lib/sync";
import type { Keys } from "./lib/util/crypto.ts";

interface AppState {
  route: string;
  vaultUnlocked: boolean;
  unlocking: boolean;
  store: VaultStore | null;
  index: NoteIndex | null;
  sync: SyncEngine | null;
  keys: Keys | null;
  syncStatus: SyncStatus;
  lastSync: number | null;
  lastError: string | null;
  pendingEdits: number;
  filterFolder: string | null;
  filterTrash: boolean;
  searchQuery: string;
  unassignedOnly: boolean;
  filterTag: string | null;
  prevRoute: string;
}

export const appState: AppState = $state({
  route: "",
  vaultUnlocked: false,
  unlocking: false,
  store: null,
  index: null,
  sync: null,
  keys: null,
  syncStatus: "synced",
  lastSync: null,
  lastError: null,
  pendingEdits: 0,
  filterFolder: null,
  filterTrash: false,
  searchQuery: "",
  unassignedOnly: false,
  filterTag: null,
  prevRoute: "",
});

function parseHash(): string {
  const h = location.hash.replace(/^#\/?/, "");
  return h === "" ? "" : h;
}

export function initRouter(): void {
  appState.route = parseHash();

  const update = () => {
    appState.route = parseHash();
  };

  window.addEventListener("hashchange", update);
  window.addEventListener("popstate", update);
}

export function navigate(path: string): void {
  location.hash = path === "" ? "/" : `/${path}`;
}

export function toggleSettings(): void {
  if (appState.route === "settings") {
    navigate(appState.prevRoute || "");
  } else {
    appState.prevRoute = appState.route;
    navigate("settings");
  }
}
