import { readFile } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";
import { compile } from "svelte/compiler";

const SVELTE_CLIENT = pathToFileURL(
  resolvePath(process.cwd(), "node_modules/svelte/src/index-client.js"),
).href;

export async function resolve(specifier, context, next) {
  if (specifier === "svelte") {
    return { url: SVELTE_CLIENT, shortCircuit: true };
  }

  return next(specifier, context);
}

export async function load(url, context, next) {
  if (!url.endsWith(".svelte")) return next(url, context);

  const source = await readFile(new URL(url), "utf8");
  const { js } = compile(source, { generate: "client", filename: url });

  return { format: "module", source: js.code, shortCircuit: true };
}
