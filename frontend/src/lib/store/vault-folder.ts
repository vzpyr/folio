import type { NativeFs } from "../util/tauri.ts";

export interface VaultFolderStats {
  files: number;
  dirs: number;
  mds: number;
  adoptable: number;
}

const FM_BLOCK = /^---\n([\s\S]*?)\n---/;
const ID_LINE = /(?:^|\n)\s*id:\s*[0-9a-fA-F-]{36}\s*(?:\n|$)/;

async function hasFolioId(fs: NativeFs, path: string): Promise<boolean> {
  try {
    const text = await fs.readTextFile(path);
    const block = text.match(FM_BLOCK);

    if (!block) return false;

    return ID_LINE.test(block[1]);
  } catch {
    return false;
  }
}

export async function inspectVaultFolder(
  fs: NativeFs,
  dir: string,
): Promise<VaultFolderStats> {
  const stats: VaultFolderStats = { files: 0, dirs: 0, mds: 0, adoptable: 0 };
  const stack = [dir.replace(/[\\/]+$/, "")];

  while (stack.length) {
    const d = stack.pop()!;
    let entries;

    try {
      entries = await fs.readDir(d);
    } catch {
      continue;
    }

    for (const e of entries) {
      if (e.name === ".folio" || e.name === "assets") continue;

      const p = e.path || `${d}/${e.name}`;

      if (e.isDir) {
        stats.dirs += 1;
        stack.push(p);
        continue;
      }

      stats.files += 1;

      if (!/\.md$/i.test(e.name)) continue;

      stats.mds += 1;
      if (!(await hasFolioId(fs, p))) stats.adoptable += 1;
    }
  }

  return stats;
}
