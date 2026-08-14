import { getSecret, setSecret, deleteSecret } from "./secrets.ts";

export const KEYS = {
  serverUrl: "folio:serverUrl",
  theme: "folio:theme",
  vaultDir: "folio:vaultDir",
  uiFont: "folio:uiFont",
  editorFont: "folio:editorFont",
  aiBaseUrl: "folio:aiBaseUrl",
  aiModel: "folio:aiModel",
} as const;

export const SECRET_KEYS = {
  token: "folio:token",
  aiToken: "folio:aiToken",
  passphrase: "folio:passphrase",
} as const;

export function loadSettings(): {
  serverUrl: string;
  theme: string;
  vaultDir: string;
  uiFont: string;
  editorFont: string;
  aiBaseUrl: string;
  aiModel: string;
} {
  return {
    serverUrl: localStorage.getItem(KEYS.serverUrl) ?? "",
    theme: localStorage.getItem(KEYS.theme) ?? "light",
    vaultDir: localStorage.getItem(KEYS.vaultDir) ?? "",
    uiFont: localStorage.getItem(KEYS.uiFont) ?? "system",
    editorFont: localStorage.getItem(KEYS.editorFont) ?? "system",
    aiBaseUrl: localStorage.getItem(KEYS.aiBaseUrl) ?? "",
    aiModel: localStorage.getItem(KEYS.aiModel) ?? "",
  };
}

export function saveSettings(s: {
  serverUrl?: string;
  theme?: string;
  vaultDir?: string;
  uiFont?: string;
  editorFont?: string;
  aiBaseUrl?: string;
  aiModel?: string;
}): void {
  if (s.serverUrl !== undefined)
    localStorage.setItem(KEYS.serverUrl, s.serverUrl);
  if (s.theme !== undefined) localStorage.setItem(KEYS.theme, s.theme);
  if (s.vaultDir !== undefined) localStorage.setItem(KEYS.vaultDir, s.vaultDir);
  if (s.uiFont !== undefined) localStorage.setItem(KEYS.uiFont, s.uiFont);
  if (s.editorFont !== undefined)
    localStorage.setItem(KEYS.editorFont, s.editorFont);
  if (s.aiBaseUrl !== undefined)
    localStorage.setItem(KEYS.aiBaseUrl, s.aiBaseUrl);
  if (s.aiModel !== undefined) localStorage.setItem(KEYS.aiModel, s.aiModel);
}

export async function loadSecrets(): Promise<{
  token: string;
  aiToken: string;
}> {
  const token = (await getSecret(SECRET_KEYS.token)) ?? "";
  const aiToken = (await getSecret(SECRET_KEYS.aiToken)) ?? "";

  return { token, aiToken };
}

export async function saveSecrets(s: {
  token?: string;
  aiToken?: string;
}): Promise<void> {
  if (s.token !== undefined) {
    if (s.token) await setSecret(SECRET_KEYS.token, s.token);
    else await deleteSecret(SECRET_KEYS.token);
  }
  if (s.aiToken !== undefined) {
    if (s.aiToken) await setSecret(SECRET_KEYS.aiToken, s.aiToken);
    else await deleteSecret(SECRET_KEYS.aiToken);
  }
}

export async function loadPassphrase(): Promise<string | null> {
  return getSecret(SECRET_KEYS.passphrase);
}

export async function savePassphrase(passphrase: string): Promise<void> {
  await setSecret(SECRET_KEYS.passphrase, passphrase);
}

export async function clearPassphrase(): Promise<void> {
  await deleteSecret(SECRET_KEYS.passphrase);
}

export async function clearAllSettings(): Promise<void> {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith("folio:")) localStorage.removeItem(key);
  }
  await deleteSecret(SECRET_KEYS.token);
  await deleteSecret(SECRET_KEYS.aiToken);
  await deleteSecret(SECRET_KEYS.passphrase);
}

export function applyTheme(theme: string): void {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(KEYS.theme, theme);
}
