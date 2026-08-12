import "./state-shim.mjs";
import "fake-indexeddb/auto";
import { check, done } from "./harness.mjs";
import { compileRunes } from "./compile-runes.mjs";
import { writeFrontmatter } from "../src/lib/editor/markdown.ts";

const mjs = await compileRunes("lib/store/store.svelte.ts");
const { BrowserStore, NoteIndex } = await import(
  mjs.path + "?t=" + mjs.version
);

const store = new BrowserStore("backlinkvault");
await store.init();

const now = Date.now();
const aId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const bId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

async function put(id, title, body) {
  const meta = {
    id,
    title,
    folder: "",
    tags: [],
    pinned: false,
    created: now,
    updated: now,
    rev: -1,
    conflict: false,
    dirty: false,
  };
  const md = writeFrontmatter(
    {
      id,
      title,
      created: now,
      updated: now,
      tags: [],
      pinned: false,
      folder: "",
    },
    body,
  );
  await store.writeNote(id, meta, md);
}

await put(aId, "untitled1", "hello [[untitled2]]");
await put(bId, "untitled2", "world");

const index = new NoteIndex();
await index.rebuild(store);
const links = index.backlinks(bId);
check(
  "[[untitled2]] in untitled1 appears as backlink",
  links.some((n) => n.id === aId),
  JSON.stringify(links.map((n) => n.id)),
);

const contentA = await store.readNote(aId);
await index.upsert(
  {
    ...(await store.listNotes()).find((n) => n.id === aId),
    updated: now + 1,
    dirty: true,
  },
  contentA,
);
const links2 = index.backlinks(bId);
check(
  "upsert preserves backlinks",
  links2.some((n) => n.id === aId),
  JSON.stringify(links2.map((n) => n.id)),
);

done("backlinks");
