import {
  isTauri,
  isDesktop,
  isIOS,
  tauriDialog,
  tauriFs,
  tauriPath,
} from "../util/tauri.ts";

export function downloadBlob(
  name: string,
  bytes: Uint8Array<ArrayBuffer>,
): void {
  const blob = new Blob([bytes], {
    type: name.endsWith(".zip") ? "application/zip" : "text/markdown",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function saveFile(
  name: string,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<"saved" | "canceled"> {
  if (isTauri() && !isDesktop()) return saveMobile(name, bytes);

  downloadBlob(name, bytes);

  return "saved";
}

async function saveMobile(
  name: string,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<"saved" | "canceled"> {
  const save = tauriDialog().save;
  if (!save) throw new Error("tauri dialog unavailable");

  const isZip = name.endsWith(".zip");
  const filters = [
    {
      name: isZip ? "zip archive" : "markdown",
      extensions: [isZip ? "zip" : "md"],
    },
  ];

  if (isIOS()) {
    const fs = tauriFs();
    const dir = await tauriPath().documentDir?.();
    if (!dir) throw new Error("tauri path unavailable");

    const tmp = `${dir.replace(/\/+$/, "")}/${name}`;

    await fs.writeFile(tmp, bytes);
    try {
      const picked = await save({ defaultPath: name, filters });

      return picked ? "saved" : "canceled";
    } finally {
      await fs.remove(tmp).catch(() => {});
    }
  }

  const uri = await save({ defaultPath: name, filters });
  if (!uri) return "canceled";

  await tauriFs().writeFile(uri, bytes);

  return "saved";
}
