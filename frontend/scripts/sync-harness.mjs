import { spawn, execSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import net from "node:net";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

import "./state-shim.mjs";
import { IDBFactory } from "fake-indexeddb";
import { deriveKeys } from "../src/lib/util/crypto.ts";
import { BrowserStore, NoteIndex } from "../src/lib/store/store.svelte.ts";
import { SyncEngine } from "../src/lib/sync/engine.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, "..", "..");

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

function randomToken() {
  return randomBytes(32).toString("base64");
}

function binaryExists(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function newestServerSource() {
  const dirs = [join(ROOT, "server", "src"), join(ROOT, "server")];
  let newest = 0;
  for (const d of dirs) {
    for (const f of ["Cargo.toml", "Cargo.lock"]) {
      try {
        newest = Math.max(newest, statSync(join(d, f)).mtimeMs);
      } catch {}
    }
  }
  for (const f of [
    "api.rs",
    "db.rs",
    "embed.rs",
    "files.rs",
    "main.rs",
    "sse.rs",
  ]) {
    try {
      newest = Math.max(
        newest,
        statSync(join(ROOT, "server", "src", f)).mtimeMs,
      );
    } catch {}
  }
  return newest;
}

function serverBinary() {
  if (process.env.FOLIO_SERVER_BIN) return process.env.FOLIO_SERVER_BIN;
  const debug = join(ROOT, "server", "target", "debug", "folio-server");
  const release = join(ROOT, "server", "target", "release", "folio-server");
  const newestSrc = newestServerSource();

  for (const bin of [debug, release]) {
    if (binaryExists(bin) && statSync(bin).mtimeMs >= newestSrc) return bin;
  }
  console.log("building folio server (cargo build)...");
  execSync(
    "cargo build --manifest-path " + join(ROOT, "server", "Cargo.toml"),
    {
      stdio: "inherit",
    },
  );
  return debug;
}

export async function startServer(opts = {}) {
  const bin = serverBinary();
  const dataDir =
    opts.dataDir ?? mkdtempSync(join(tmpdir(), "folio-sync-test-"));
  const token = opts.token ?? randomToken();
  const port = opts.port ?? (await freePort());
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(bin, [], {
    env: {
      ...process.env,
      FOLIO_TOKEN: token,
      FOLIO_DATA_DIR: dataDir,
      FOLIO_HOST: "127.0.0.1",
      FOLIO_PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout.on("data", (d) => (logs += d));
  child.stderr.on("data", (d) => (logs += d));
  const deadline = Date.now() + 20000;
  for (;;) {
    if (child.exitCode !== null) {
      throw new Error(`server exited early (${child.exitCode}):\n${logs}`);
    }
    try {
      const res = await fetch(`${url}/api/health`, {
        signal: AbortSignal.timeout(500),
      });
      if (res.ok) break;
    } catch {}
    if (Date.now() > deadline)
      throw new Error(`server did not become healthy:\n${logs}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  return { url, token, port, dataDir, child, logs: () => logs };
}

export function killServer(server) {
  if (server.child.exitCode === null) server.child.kill("SIGKILL");
}

export function stopServer(server) {
  killServer(server);
  rmSync(server.dataDir, { recursive: true, force: true });
}

let deviceSeq = 0;

export async function makeDevice(passphrase, server) {
  deviceSeq += 1;
  const keys = await deriveKeys(passphrase);
  const store = new BrowserStore(keys.vaultId, new IDBFactory());
  await store.init();
  const index = new NoteIndex();
  await index.rebuild(store);
  const state = {
    status: "synced",
    lastSync: null,
    lastError: null,
    pendingEdits: 0,
  };
  const engine = new SyncEngine(server.url, server.token, keys, store, index, {
    onState(status, lastSync, lastError) {
      state.status = status;
      state.lastSync = lastSync;
      state.lastError = lastError;
    },
    onPendingEdits(n) {
      state.pendingEdits = n;
    },
  });
  await engine.init();
  engine.start();
  return { name: `device-${deviceSeq}`, keys, store, index, engine, state };
}

export function destroyDevice(device) {
  device.engine.destroy();
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function until(fn, ms = 5000, step = 100) {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) return v;
    await sleep(step);
  }
}
