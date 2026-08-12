import { zipSync, unzipSync } from "fflate";

export function zipBytes(
  files: Record<string, Uint8Array>,
): Uint8Array<ArrayBuffer> {
  return zipSync(files);
}

export function unzip(bytes: Uint8Array): Record<string, Uint8Array> {
  return unzipSync(bytes);
}
