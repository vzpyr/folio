const KEYS = {
  serverUrl: "folio:serverUrl",
  token: "folio:token",
  theme: "folio:theme",
  vaultDir: "folio:vaultDir",
} as const;

export function loadSettings(): {
  serverUrl: string;
  token: string;
  theme: string;
  vaultDir: string;
} {
  return {
    serverUrl: localStorage.getItem(KEYS.serverUrl) ?? "",
    token: localStorage.getItem(KEYS.token) ?? "",
    theme: localStorage.getItem(KEYS.theme) ?? "light",
    vaultDir: localStorage.getItem(KEYS.vaultDir) ?? "",
  };
}

export function saveSettings(s: {
  serverUrl?: string;
  token?: string;
  theme?: string;
  vaultDir?: string;
}): void {
  if (s.serverUrl !== undefined)
    localStorage.setItem(KEYS.serverUrl, s.serverUrl);
  if (s.token !== undefined) localStorage.setItem(KEYS.token, s.token);
  if (s.theme !== undefined) localStorage.setItem(KEYS.theme, s.theme);
  if (s.vaultDir !== undefined) localStorage.setItem(KEYS.vaultDir, s.vaultDir);
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
