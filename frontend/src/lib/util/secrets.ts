import { isTauri, invoke } from "./tauri.ts";

const webMemory = new Map<string, string>();

export async function getSecret(key: string): Promise<string | null> {
  if (isTauri()) {
    try {
      const v = (await invoke("secret_get", { key })) as string | null;
      if (v) return v;
    } catch {}
  }

  return sessionStorage.getItem(key) ?? webMemory.get(key) ?? null;
}

export async function setSecret(key: string, value: string): Promise<void> {
  if (isTauri()) {
    try {
      await invoke("secret_set", { key, value });
      return;
    } catch {}
  }

  sessionStorage.setItem(key, value);
  webMemory.set(key, value);
}

export async function deleteSecret(key: string): Promise<void> {
  if (isTauri()) {
    try {
      await invoke("secret_delete", { key });
    } catch {}
  }

  sessionStorage.removeItem(key);
  webMemory.delete(key);
}
