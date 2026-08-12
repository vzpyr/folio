import { SyncEngine, type EngineHooks } from "./sync/engine.ts";
import type { SyncStatus } from "./sync/types.ts";
import type { VaultStore, NoteIndex } from "./store/store.svelte.ts";
import type { Keys } from "./util/crypto.ts";
import { NativeStore } from "./store/store-native.ts";
import { appState } from "../app.svelte.ts";

export type { SyncStatus };

export interface ConnectResult {
  sync: SyncEngine | null;
  status: SyncStatus;
  message?: string;
}

function appHooks(): EngineHooks {
  return {
    onState(status, lastSync, lastError) {
      appState.syncStatus = status;
      appState.lastSync = lastSync;
      appState.lastError = lastError;
    },
    onPendingEdits(count) {
      appState.pendingEdits = count;
    },
  };
}

export async function connectSync(
  serverUrl: string,
  token: string,
  keys: Keys,
  store: VaultStore,
  index: NoteIndex,
): Promise<ConnectResult> {
  const url = serverUrl.trim().replace(/\/+$/, "");
  const tok = token.trim();

  if (!url || !tok) {
    return { sync: null, status: "synced" };
  }

  let res: Response;
  try {
    res = await fetch(`${url}/api/vaults/${keys.vaultId}/manifest`, {
      headers: { Authorization: `Bearer ${tok}` },
    });
  } catch {
    return {
      sync: null,
      status: "offline",
      message: "could not reach server — sync will retry",
    };
  }

  if (!res.ok) {
    return {
      sync: null,
      status: "error",
      message: "server rejected the token — check url and token",
    };
  }

  const sync = new SyncEngine(url, tok, keys, store, index, appHooks());
  await sync.init();

  if (store instanceof NativeStore) {
    await store.setConnection(url, tok);
    sync.onBeforeCycle = () => store.rescan();
  }

  sync.start();

  return { sync, status: "synced" };
}
