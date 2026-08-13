const APP = new URL("../src/app.svelte.mjs", import.meta.url).href;
const STORE = new URL("../src/lib/store/store.svelte.mjs", import.meta.url)
  .href;

export async function resolve(specifier, context, next) {
  let path;
  try {
    path = new URL(specifier, context.parentURL).pathname;
  } catch {
    return next(specifier, context);
  }

  if (path.endsWith("/src/app.svelte.ts")) {
    return { url: APP, shortCircuit: true };
  }

  if (path.endsWith("/src/lib/store/store.svelte.ts")) {
    return { url: STORE, shortCircuit: true };
  }

  return next(specifier, context);
}
