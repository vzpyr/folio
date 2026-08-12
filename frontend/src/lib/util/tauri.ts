export interface NativeFsEntry {
  name: string;
  path: string;
  isDir: boolean;
}

export interface NativeFs {
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, data: string): Promise<void>;
  readFile(path: string): Promise<Uint8Array<ArrayBuffer>>;
  writeFile(path: string, data: Uint8Array<ArrayBuffer>): Promise<void>;
  mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>;
  remove(path: string, opts?: { recursive?: boolean }): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  readDir(
    path: string,
    opts?: { recursive?: boolean },
  ): Promise<NativeFsEntry[]>;
  stat(path: string): Promise<{ isDir: boolean; mtimeMs: number } | null>;
  exists(path: string): Promise<boolean>;
}

interface TauriFsApi {
  readTextFile?: (path: string) => Promise<string>;
  writeTextFile?: (path: string, data: string, opts?: unknown) => Promise<void>;
  readFile?: (path: string) => Promise<Uint8Array<ArrayBuffer>>;
  writeFile?: (
    path: string,
    data: Uint8Array<ArrayBuffer>,
    opts?: unknown,
  ) => Promise<void>;
  mkdir?: (path: string, opts?: { recursive?: boolean }) => Promise<void>;
  remove?: (path: string, opts?: { recursive?: boolean }) => Promise<void>;
  rename?: (oldPath: string, newPath: string) => Promise<void>;
  readDir?: (
    path: string,
    opts?: { recursive?: boolean },
  ) => Promise<
    { name: string; path: string; isDir?: boolean; isDirectory?: boolean }[]
  >;
  stat?: (path: string) => Promise<{
    isDirectory?: boolean;
    isDir?: boolean;
    mtime?: number | Date;
    mtimeMs?: number;
  } | null>;
  exists?: (path: string) => Promise<boolean>;
}

interface TauriGlobal {
  core?: {
    invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
  };
  fs?: TauriFsApi;
}

function getGlobal(): TauriGlobal {
  if (typeof window === "undefined" || !("__TAURI__" in window)) {
    throw new Error("tauri runtime unavailable");
  }

  return (window as unknown as { __TAURI__: TauriGlobal }).__TAURI__;
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI__" in window;
}

export function isAndroid(): boolean {
  return (
    isTauri() &&
    typeof navigator !== "undefined" &&
    /Android/i.test(navigator.userAgent)
  );
}

export function isDesktop(): boolean {
  return isTauri() && !isAndroid();
}

export async function invoke(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<unknown> {
  const g = getGlobal();
  const fn = g.core?.invoke;
  if (!fn) throw new Error("tauri core unavailable");

  return fn(cmd, args);
}

export function tauriFs(): NativeFs {
  const fs = getGlobal().fs;
  if (!fs) throw new Error("tauri fs plugin unavailable");

  const need = <T>(name: keyof TauriFsApi, fn: T): T => {
    if (!fn) throw new Error(`tauri fs: ${name} unavailable`);

    return fn;
  };

  return {
    readTextFile: need("readTextFile", fs.readTextFile!),
    writeTextFile: need("writeTextFile", fs.writeTextFile!),
    readFile: need("readFile", fs.readFile!),
    writeFile: need("writeFile", fs.writeFile!),
    mkdir: need("mkdir", fs.mkdir!),
    remove: need("remove", fs.remove!),
    rename: need("rename", fs.rename!),
    readDir: async (path, opts) =>
      (await need("readDir", fs.readDir!)(path, opts ?? {})).map((e) => ({
        name: e.name,
        path: e.path,
        isDir: e.isDirectory ?? e.isDir ?? false,
      })),
    stat: async (path) => {
      const s = await need("stat", fs.stat!)(path);
      if (!s) return null;

      const m = s.mtimeMs ?? s.mtime;
      const mtimeMs =
        typeof m === "number" ? m : m instanceof Date ? m.getTime() : 0;

      return {
        isDir: s.isDir ?? s.isDirectory ?? false,
        mtimeMs,
      };
    },
    exists: need("exists", fs.exists!),
  };
}
