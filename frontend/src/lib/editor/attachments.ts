import type { Editor } from "@tiptap/core";
import type { VaultStore } from "../store/store.svelte.ts";

const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/markdown": "md",
  "application/json": "json",
  "text/csv": "csv",
  "text/html": "html",
  "application/zip": "zip",
  "application/gzip": "gz",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "pptx",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "video/mp4": "mp4",
  "video/webm": "webm",
};

export function extFromMime(mime: string): string | null {
  return MIME_EXT[mime] ?? null;
}

function extFromName(name: string): string | null {
  const m = /\.([a-z0-9]{1,8})$/i.exec(name);

  return m ? m[1].toLowerCase() : null;
}

export async function uploadFile(
  file: File,
  editor: Editor,
  store: VaultStore,
  onToast: (msg: string) => void,
): Promise<void> {
  const ext = extFromMime(file.type) ?? extFromName(file.name);

  if (!ext) {
    onToast("unsupported file type");
    return;
  }

  const id = crypto.randomUUID();
  const bytes = new Uint8Array(await file.arrayBuffer());

  await store.writeAttachment(id, ext, bytes);

  const ref = `assets/${id}.${ext}`;
  const url = URL.createObjectURL(new Blob([bytes]));

  if (file.type.startsWith("image/")) {
    const alt =
      (file.name.replace(/\.[^.]+$/, "") || "image")
        .replace(/[[\]()]/g, "")
        .trim() || "image";

    editor
      .chain()
      .focus()
      .insertContent({ type: "image", attrs: { src: url, alt, ref } })
      .run();
  } else {
    editor
      .chain()
      .focus()
      .insertContent({
        type: "fileChip",
        attrs: {
          name: file.name || "file",
          ref,
          size: file.size || null,
          mime: file.type || null,
        },
      })
      .run();
  }
}

export function handlePaste(
  e: ClipboardEvent,
  editor: Editor,
  store: VaultStore,
  onToast: (msg: string) => void,
): boolean {
  const items = e.clipboardData?.items;
  if (!items) return false;

  for (const item of items) {
    if (item.kind !== "file") continue;

    const file = item.getAsFile();
    if (!file) continue;

    e.preventDefault();
    void uploadFile(file, editor, store, onToast);

    return true;
  }

  return false;
}

export function handleDrop(
  e: DragEvent,
  editor: Editor,
  store: VaultStore,
  onToast: (msg: string) => void,
): boolean {
  const files = e.dataTransfer?.files;
  if (!files || files.length === 0) return false;

  e.preventDefault();

  const at = editor.view.posAtCoords({ left: e.clientX, top: e.clientY });
  if (at) editor.chain().setTextSelection(at.pos).run();

  void uploadFile(files[0], editor, store, onToast);

  return true;
}
