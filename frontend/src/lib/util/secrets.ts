import { isTauri, invoke } from "./tauri.ts";

export async function getSecret(key: string): Promise<string | null> {
  if (isTauri()) {
    try {
      const v = (await invoke("secret_get", { key })) as string | null;
      if (v) return v;
    } catch {}
  }

  return localStorage.getItem(key);
}

export async function setSecret(key: string, value: string): Promise<void> {
  if (isTauri()) {
    try {
      await invoke("secret_set", { key, value });
      return;
    } catch {}
  }

  localStorage.setItem(key, value);
}

export async function deleteSecret(key: string): Promise<void> {
  if (isTauri()) {
    try {
      await invoke("secret_delete", { key });
    } catch {}
  }

  localStorage.removeItem(key);
}
