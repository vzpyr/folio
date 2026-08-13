import "./state-shim.mjs";
import "fake-indexeddb/auto";
import { check, done } from "./harness.mjs";
import { compileRunes } from "./compile-runes.mjs";

const mjs = await compileRunes("lib/store/store.svelte.ts");
const { BrowserStore, NoteIndex, setTrashed } = await import(
  mjs.path + "?t=" + mjs.version
);

const store = new BrowserStore("taglistvault");
await store.init();
const index = new NoteIndex();
await index.rebuild(store);

const mk = (n, title, tags) => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  title,
  folder: "",
  tags,
  pinned: false,
  created: 1,
  updated: 2,
  rev: -1,
  conflict: false,
  dirty: true,
});

await store.writeNote(mk(1, "one", ["work", "home"]).id, mk(1, "one", ["work", "home"]), "---\nid: a\n---\n\nbody one");
await store.writeNote(mk(2, "two", ["work"]).id, mk(2, "two", ["work"]), "---\nid: b\n---\n\nbody two");
await index.rebuild(store);

const initial = index.tagList.map((t) => `${t.tag}:${t.count}`).sort().join(",");
check("taglist rebuild counts", initial === "home:1,work:2", initial);

await setTrashed(store, index, mk(1, "one", []).id, true);
const afterTrash = index.tagList.map((t) => `${t.tag}:${t.count}`).sort().join(",");
check("taglist drops counts on trash", afterTrash === "work:1", afterTrash);
check(
  "list excludes trashed note",
  !index.list.some((n) => n.id === mk(1, "one", []).id) &&
    index.trashList.some((n) => n.id === mk(1, "one", []).id),
  JSON.stringify({
    list: index.list.map((n) => n.title),
    trash: index.trashList.map((n) => n.title),
  }),
);

await store.deleteNote(mk(2, "two", []).id);
await index.remove(mk(2, "two", []).id);
const afterDelete = index.tagList.map((t) => t.tag).join(",");
check("taglist empty after delete", afterDelete === "", afterDelete);

await setTrashed(store, index, mk(1, "one", []).id, false);
const afterRestore = index.tagList.map((t) => `${t.tag}:${t.count}`).sort().join(",");
check("taglist restores counts on restore", afterRestore === "home:1,work:1", afterRestore);
check(
  "restore re-adds note to list",
  index.list.some((n) => n.id === mk(1, "one", []).id) &&
    !index.trashList.some((n) => n.id === mk(1, "one", []).id),
  JSON.stringify({
    list: index.list.map((n) => n.title),
    trash: index.trashList.map((n) => n.title),
  }),
);

done("taglist");
