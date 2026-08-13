export const KEYS = {
  serverUrl: "folio:serverUrl",
  token: "folio:token",
  theme: "folio:theme",
  vaultDir: "folio:vaultDir",
  uiFont: "folio:uiFont",
  editorFont: "folio:editorFont",
  aiBaseUrl: "folio:aiBaseUrl",
  aiToken: "folio:aiToken",
  aiModel: "folio:aiModel",
} as const;

export function loadSettings(): {
  serverUrl: string;
  token: string;
  theme: string;
  vaultDir: string;
  uiFont: string;
  editorFont: string;
  aiBaseUrl: string;
  aiToken: string;
  aiModel: string;
} {
  return {
    serverUrl: localStorage.getItem(KEYS.serverUrl) ?? "",
    token: localStorage.getItem(KEYS.token) ?? "",
    theme: localStorage.getItem(KEYS.theme) ?? "light",
    vaultDir: localStorage.getItem(KEYS.vaultDir) ?? "",
    uiFont: localStorage.getItem(KEYS.uiFont) ?? "system",
    editorFont: localStorage.getItem(KEYS.editorFont) ?? "system",
    aiBaseUrl: localStorage.getItem(KEYS.aiBaseUrl) ?? "",
    aiToken: localStorage.getItem(KEYS.aiToken) ?? "",
    aiModel: localStorage.getItem(KEYS.aiModel) ?? "",
  };
}

export function saveSettings(s: {
  serverUrl?: string;
  token?: string;
  theme?: string;
  vaultDir?: string;
  uiFont?: string;
  editorFont?: string;
  aiBaseUrl?: string;
  aiToken?: string;
  aiModel?: string;
}): void {
  if (s.serverUrl !== undefined)
    localStorage.setItem(KEYS.serverUrl, s.serverUrl);
  if (s.token !== undefined) localStorage.setItem(KEYS.token, s.token);
  if (s.theme !== undefined) localStorage.setItem(KEYS.theme, s.theme);
  if (s.vaultDir !== undefined) localStorage.setItem(KEYS.vaultDir, s.vaultDir);
  if (s.uiFont !== undefined) localStorage.setItem(KEYS.uiFont, s.uiFont);
  if (s.editorFont !== undefined)
    localStorage.setItem(KEYS.editorFont, s.editorFont);
  if (s.aiBaseUrl !== undefined)
    localStorage.setItem(KEYS.aiBaseUrl, s.aiBaseUrl);
  if (s.aiToken !== undefined) localStorage.setItem(KEYS.aiToken, s.aiToken);
  if (s.aiModel !== undefined) localStorage.setItem(KEYS.aiModel, s.aiModel);
}

const PASS_KEY = "folio:passphrase";

export function loadPassphrase(): string | null {
  return localStorage.getItem(PASS_KEY);
}

export function savePassphrase(passphrase: string): void {
  localStorage.setItem(PASS_KEY, passphrase);
}

export function clearPassphrase(): void {
  localStorage.removeItem(PASS_KEY);
}

export function clearAllSettings(): void {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith("folio:")) localStorage.removeItem(key);
  }
}

export function applyTheme(theme: string): void {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(KEYS.theme, theme);
}
