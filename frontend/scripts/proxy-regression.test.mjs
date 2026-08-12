import "./state-shim.mjs";
import "fake-indexeddb/auto";
import { check, done } from "./harness.mjs";
import { compileRunes } from "./compile-runes.mjs";

const mjs = await compileRunes("lib/store/store.svelte.ts");
const { BrowserStore } = await import(mjs.path + "?t=" + mjs.version);

const store = new BrowserStore("proxytestvault");
await store.init();

const tagsProxy = new Proxy(["a", "b"], {
  get(t, k) {
    return Reflect.get(t, k);
  },
  set(t, k, v) {
    return Reflect.set(t, k, v);
  },
});
const meta = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "proxy note",
  folder: "work",
  tags: tagsProxy,
  pinned: false,
  created: 1,
  updated: 2,
  rev: -1,
  conflict: false,
  dirty: true,
};

let threw = null;
try {
  await store.writeNote(meta.id, meta, "---\nid: x\n---\n\nbody");
} catch (e) {
  threw = e;
}
check(
  "proxy meta does not throw on writenote",
  threw === null,
  threw?.message ?? "",
);

const list = await store.listNotes();
const readBack = await store.readNote(meta.id);
const ok =
  list.length === 1 &&
  list[0].title === "proxy note" &&
  JSON.stringify(list[0].tags) === '["a","b"]' &&
  readBack.includes("body");
check("proxy meta survives writenote + readback", ok);

done("proxy-regression");
