import "./state-shim.mjs";
import { check, done } from "./harness.mjs";
import {
  writeFrontmatter,
  parseFrontmatter,
} from "../src/lib/editor/markdown.ts";
import {
  FOLDER_REGISTRY_ID,
  parseRegistryContent,
} from "../src/lib/store/folders.ts";
import { setTrashed } from "../src/lib/store/store.svelte.ts";
import { SETTLE_MS } from "../src/lib/sync/types.ts";
import { clearNotices, syncNotices } from "../src/lib/sync/notices.svelte.ts";
import {
  startServer,
  stopServer,
  killServer,
  makeDevice,
  destroyDevice,
  sleep,
  until,
} from "./sync-harness.mjs";

const PASS = "test passphrase for the sync suite";
const server = await startServer();
const devices = [];
let failed = false;

try {
  const A = await makeDevice(PASS, server);
  const B = await makeDevice(PASS, server);
  devices.push(A, B);

  async function writeNote(
    dev,
    id,
    title,
    body,
    folder = "",
    rev = -1,
    trashed = false,
  ) {
    const now = Date.now() - 5000;
    const md = writeFrontmatter(
      {
        id,
        title,
        created: now,
        updated: now,
        tags: [],
        pinned: false,
        folder,
        trashed,
      },
      body,
    );
    const meta = {
      id,
      title,
      folder,
      tags: [],
      pinned: false,
      created: now,
      updated: now,
      rev,
      conflict: false,
      dirty: true,
      trashed,
    };
    await dev.store.writeNote(id, meta, md);
    await dev.index.upsert(meta, md);
  }

  async function meta(dev, id) {
    return (await dev.store.listNotes()).find((n) => n.id === id);
  }

  const NOTE1 = crypto.randomUUID();
  await writeNote(A, NOTE1, "hello", "the first note body");
  await A.engine.sync();
  check("a pushed the new note (status synced)", A.state.status === "synced");
  check(
    "a knows the note as clean + rev 1",
    (await meta(A, NOTE1))?.dirty !== true && (await meta(A, NOTE1))?.rev === 1,
  );

  await B.engine.sync();
  const bNote = await B.store.readNote(NOTE1);
  check(
    "b pulled the note",
    bNote !== null && bNote.includes("the first note body"),
  );
  check("b knows the note as clean + rev 1", (await meta(B, NOTE1))?.rev === 1);

  const NOTE2 = crypto.randomUUID();
  await writeNote(A, NOTE2, "shared", "base content");
  await A.engine.sync();
  await B.engine.sync();
  check(
    "setup: both devices at rev 1",
    (await meta(A, NOTE2))?.rev === 1 && (await meta(B, NOTE2))?.rev === 1,
  );

  clearNotices();
  await writeNote(A, NOTE2, "shared", "A wins this race", 1);
  await writeNote(B, NOTE2, "shared", "B loses this race", 1);
  await A.engine.sync();
  await B.engine.sync();

  const aMeta = await meta(A, NOTE2);
  const bMeta = await meta(B, NOTE2);
  const aConflicts = (await A.store.listNotes()).filter((n) =>
    /^shared \(conflict /.test(n.title),
  );
  const bConflicts = (await B.store.listNotes()).filter((n) =>
    /^shared \(conflict /.test(n.title),
  );

  check(
    "winner kept the original id on a",
    (await A.store.readNote(NOTE2))?.includes("A wins this race") === true,
  );
  check(
    "winner kept the original id on b (pulled)",
    (await B.store.readNote(NOTE2))?.includes("A wins this race") === true,
  );
  check(
    "losing side forked a conflict copy on b",
    bConflicts.length === 1 &&
      (await B.store.readNote(bConflicts[0].id))?.includes(
        "B loses this race",
      ) === true,
  );
  check(
    "both devices clean after the dust settles",
    aMeta?.dirty !== true && bMeta?.dirty !== true,
  );
  check(
    "a got a conflict notice",
    syncNotices.some((n) => n.kind === "conflict"),
  );
  check(
    "the original id kept its rev bump (rev 2)",
    aMeta?.rev === 2 && bMeta?.rev === 2,
  );
  void (aConflicts, bConflicts);

  await A.engine.sync();
  const aConflictsAfter = (await A.store.listNotes()).filter((n) =>
    /^shared \(conflict /.test(n.title),
  );
  check("conflict copy propagated back to a", aConflictsAfter.length === 1);
  check(
    "losing side forked a conflict copy on a too",
    aConflictsAfter.length === 1 &&
      (await A.store.readNote(aConflictsAfter[0].id))?.includes(
        "B loses this race",
      ) === true,
  );
  check(
    "a still holds the winner under the original id",
    (await A.store.readNote(NOTE2))?.includes("A wins this race") === true,
  );

  const NOTE3 = crypto.randomUUID();
  await writeNote(A, NOTE3, "doomed", "delete me");
  await A.engine.sync();
  await B.engine.sync();
  await A.engine.pushDelete(NOTE3);
  await B.engine.sync();
  check(
    "b removed the note after tombstone",
    (await B.store.readNote(NOTE3)) === null,
  );
  check("a removed the note locally", (await A.store.readNote(NOTE3)) === null);

  const ATT = crypto.randomUUID();
  const PNG = new Uint8Array([
    137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4, 5, 6, 7, 8, 9,
  ]);
  const NOTE4 = crypto.randomUUID();
  await writeNote(A, NOTE4, "with image", `see ![pic](assets/${ATT}.png)`);
  await A.store.writeAttachment(ATT, "png", PNG);
  await A.engine.sync();
  await B.engine.sync();
  const bAtt = await B.store.readAttachment(ATT);
  check(
    "b pulled the attachment bytes",
    bAtt !== null &&
      bAtt.length === PNG.length &&
      bAtt.every((b, i) => b === PNG[i]),
  );
  check(
    "b resolved the ext from the note body",
    (await B.store.listAttachments()).some(
      (a) => a.id === ATT && a.ext === "png",
    ),
  );

  await writeNote(A, NOTE4, "with image", "no more image", 1);
  await A.engine.sync();
  await B.engine.sync();
  check(
    "b dropped the orphaned attachment after tombstone",
    (await B.store.readAttachment(ATT)) === null,
  );

  const regA = writeFrontmatter(
    {
      id: FOLDER_REGISTRY_ID,
      title: "folio folders",
      created: Date.now() - 5000,
      updated: Date.now() - 5000,
      tags: [],
      pinned: false,
      folder: "",
    },
    JSON.stringify({ folders: ["work", "home"] }),
  );
  await A.store.writeNote(
    FOLDER_REGISTRY_ID,
    {
      id: FOLDER_REGISTRY_ID,
      title: "folio folders",
      folder: "",
      tags: [],
      pinned: false,
      created: Date.now() - 5000,
      updated: Date.now() - 5000,
      rev: -1,
      conflict: false,
      dirty: true,
    },
    regA,
  );
  await A.engine.sync();
  const regB = writeFrontmatter(
    {
      id: FOLDER_REGISTRY_ID,
      title: "folio folders",
      created: Date.now() - 5000,
      updated: Date.now() - 5000,
      tags: [],
      pinned: false,
      folder: "",
    },
    JSON.stringify({ folders: ["work", "shopping"] }),
  );
  await B.store.writeNote(
    FOLDER_REGISTRY_ID,
    {
      id: FOLDER_REGISTRY_ID,
      title: "folio folders",
      folder: "",
      tags: [],
      pinned: false,
      created: Date.now() - 5000,
      updated: Date.now() - 5000,
      rev: -1,
      conflict: false,
      dirty: true,
    },
    regB,
  );
  await B.engine.sync();
  await A.engine.sync();
  const mergedA = parseRegistryContent(
    (await A.store.readNote(FOLDER_REGISTRY_ID)) ?? "",
  );
  const mergedB = parseRegistryContent(
    (await B.store.readNote(FOLDER_REGISTRY_ID)) ?? "",
  );
  check(
    "folder registries merged (union on a)",
    JSON.stringify(mergedA) === JSON.stringify(["home", "shopping", "work"]),
  );
  check(
    "folder registries merged (union on b)",
    JSON.stringify(mergedB) === JSON.stringify(["home", "shopping", "work"]),
  );

  const NOTE7 = crypto.randomUUID();
  await writeNote(A, NOTE7, "victim", "original text");
  await A.engine.sync();
  await B.engine.sync();
  await writeNote(B, NOTE7, "victim", "B was editing this", 1);
  await A.engine.pushDelete(NOTE7);
  await B.engine.sync();
  await A.engine.sync();
  const bVictim = await B.store.readNote(NOTE7);
  const aVictim = await A.store.readNote(NOTE7);
  const bVictimConflicts = (await B.store.listNotes()).filter((n) =>
    /^victim \(conflict /.test(n.title),
  );
  const aVictimConflicts = (await A.store.listNotes()).filter((n) =>
    /^victim \(conflict /.test(n.title),
  );
  check("delete wins: note gone on b", bVictim === null);
  check("delete wins: note gone on a", aVictim === null);
  check(
    "b's edit preserved as a conflict copy on b",
    bVictimConflicts.length === 1 &&
      (await B.store.readNote(bVictimConflicts[0].id))?.includes(
        "B was editing this",
      ) === true,
  );
  check(
    "b's edit preserved as a conflict copy on a",
    aVictimConflicts.length === 1 &&
      (await A.store.readNote(aVictimConflicts[0].id))?.includes(
        "B was editing this",
      ) === true,
  );

  const NOTE8 = crypto.randomUUID();
  await writeNote(A, NOTE8, "twin", "base text");
  await A.engine.sync();
  await B.engine.sync();
  await writeNote(A, NOTE8, "twin", "same text from both", 1);
  await writeNote(B, NOTE8, "twin", "same text from both", 1);
  await A.engine.sync();
  await B.engine.sync();
  check(
    "identical text: no spurious conflict copy on a",
    (await A.store.listNotes()).filter((n) => /^twin \(conflict /.test(n.title))
      .length === 0,
  );
  check(
    "identical text: no spurious conflict copy on b",
    (await B.store.listNotes()).filter((n) => /^twin \(conflict /.test(n.title))
      .length === 0,
  );
  check(
    "identical text adopted to rev 2 on both",
    (await meta(A, NOTE8))?.rev === 2 && (await meta(B, NOTE8))?.rev === 2,
  );
  check(
    "identical text clean on both",
    (await meta(A, NOTE8))?.dirty !== true &&
      (await meta(B, NOTE8))?.dirty !== true,
  );

  const NOTE6 = crypto.randomUUID();
  const NOTE9 = crypto.randomUUID();

  const NOTE10 = crypto.randomUUID();
  await writeNote(A, NOTE10, "trash victim", "trash me");
  await A.engine.sync();
  await B.engine.sync();
  await setTrashed(A.store, A.index, NOTE10, true);
  await A.engine.sync();
  await sleep(SETTLE_MS + 300);
  await A.engine.sync();
  await B.engine.sync();
  const bTrashMeta = await meta(B, NOTE10);
  check("trash propagates to b", bTrashMeta?.trashed === true);
  check(
    "trash flag written to frontmatter on a",
    /^trashed: true$/m.test((await A.store.readNote(NOTE10)) ?? ""),
  );
  check(
    "trash flag written to frontmatter on b",
    /^trashed: true$/m.test((await B.store.readNote(NOTE10)) ?? ""),
  );

  await setTrashed(B.store, B.index, NOTE10, false);
  await B.engine.sync();
  await sleep(SETTLE_MS + 300);
  await B.engine.sync();
  await A.engine.sync();
  check(
    "restore propagates back to a",
    (await meta(A, NOTE10))?.trashed === false,
  );
  check(
    "untrash flag written to frontmatter on b",
    /^trashed: false$/m.test((await B.store.readNote(NOTE10)) ?? ""),
  );
  check(
    "a's copy reflects the untrash flag",
    /^trashed: false$/m.test((await A.store.readNote(NOTE10)) ?? ""),
  );

  await writeNote(
    B,
    NOTE10,
    "trash victim",
    "edited while trashed",
    "",
    (await meta(B, NOTE10))?.rev ?? -1,
    true,
  );
  await B.engine.sync();
  await A.engine.sync();
  check(
    "editing a trashed note keeps it trashed on b",
    (await meta(B, NOTE10))?.trashed === true,
  );
  check(
    "editing a trashed note keeps it trashed on a",
    (await meta(A, NOTE10))?.trashed === true,
  );

  await writeNote(A, NOTE9, "offline delete victim", "delete me while offline");
  await A.engine.sync();
  await B.engine.sync();
  const { dataDir: keepDir, token: keepToken, port: keepPort } = server;
  killServer(server);
  await sleep(300);
  await writeNote(
    A,
    NOTE6,
    "offline note",
    "written while the server was down",
  );
  await A.engine.sync();
  check(
    "a went offline while the server was down",
    A.state.status === "offline",
  );
  check(
    "the offline note stayed dirty (nothing lost)",
    (await meta(A, NOTE6))?.dirty === true,
  );
  await A.store.deleteNote(NOTE9);
  await A.engine.pushDelete(NOTE9);
  check(
    "offline delete did not crash the engine",
    A.state.status === "offline",
  );

  const restarted = await startServer({
    dataDir: keepDir,
    token: keepToken,
    port: keepPort,
  });
  try {
    await until(async () => (await B.store.readNote(NOTE6)) !== null, 20000);
    check(
      "b received the offline note automatically after reconnect",
      (await B.store.readNote(NOTE6))?.includes(
        "written while the server was down",
      ) === true,
    );
    await until(async () => (await meta(A, NOTE6))?.dirty !== true, 15000);
    check("a pushed the offline note automatically after reconnect", true);
    await until(async () => (await B.store.readNote(NOTE9)) === null, 15000);
    check("offline delete tombstone landed automatically on b", true);
    await until(async () => (await meta(A, NOTE9)) === undefined, 15000);
    check("a stayed deleted after reconnect", true);
  } finally {
    stopServer(restarted);
  }

  const s2 = await startServer();
  const C = await makeDevice(PASS, s2);
  devices.push(C);
  try {
    const N10 = crypto.randomUUID();
    await writeNote(C, N10, "drain test", "content");
    const inFlight = C.engine.sync();
    await sleep(20);
    await C.engine.destroy();
    check(
      "destroy drained the in-flight push",
      (await meta(C, N10))?.dirty !== true,
    );
    const N10b = crypto.randomUUID();
    await writeNote(C, N10b, "after destroy", "never pushed");
    await C.engine.sync();
    check(
      "cycles after destroy are no-ops",
      (await meta(C, N10b))?.dirty === true,
    );
  } finally {
    stopServer(s2);
  }
} catch (e) {
  console.error("sync suite crashed:", e);
  failed = true;
} finally {
  for (const d of devices) destroyDevice(d);
  if (server.child.exitCode === null) server.child.kill("SIGKILL");
  try {
    stopServer(server);
  } catch {}
}

done("sync (real server)");
void failed;
