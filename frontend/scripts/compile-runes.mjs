import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readFileSync, writeFileSync, rmSync } from "fs";
import { compileModule } from "svelte/compiler";
import { stripTypeScriptTypes } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "src");

export async function compileRunes(relPath) {
  const srcPath = join(ROOT, relPath);
  const src = readFileSync(srcPath, "utf8");
  const js = stripTypeScriptTypes(src, { mode: "strip" });
  const out = compileModule(js, { filename: relPath, generate: "client" }).js
    .code;
  const mjsPath = join(ROOT, relPath.replace(/\.ts$/, ".mjs"));
  writeFileSync(mjsPath, out);
  const version = String(Date.now());
  process.on("exit", () => {
    try {
      rmSync(mjsPath, { force: true });
    } catch {}
  });
  return { path: mjsPath, version };
}
