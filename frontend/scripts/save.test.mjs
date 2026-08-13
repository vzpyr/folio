import "./register-svelte.mjs";

const { JSDOM } = await import("jsdom");

const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Blob = dom.window.Blob;
globalThis.URL = {
  createObjectURL: () => "blob:mock",
  revokeObjectURL: () => {},
};

const { check, done } = await import("./harness.mjs");
const { saveFile } = await import("../src/lib/io/save.ts");

const bytes = new TextEncoder().encode("hello");

function setTauri(api, nav) {
  Object.defineProperty(globalThis, "navigator", {
    value: nav,
    configurable: true,
  });
  window.__TAURI__ = api;
}

function spy(fn) {
  const calls = [];
  const wrapped = (...args) => {
    calls.push(args);

    return fn ? fn(...args) : undefined;
  };
  wrapped.calls = calls;

  return wrapped;
}

function fullFs(overrides = {}) {
  const base = {
    readTextFile: spy(),
    writeTextFile: spy(),
    readFile: spy(),
    writeFile: spy(),
    mkdir: spy(),
    remove: spy(),
    rename: spy(),
    readDir: spy(),
    stat: spy(),
    exists: spy(),
  };

  return { ...base, ...overrides };
}

delete window.__TAURI__;
Object.defineProperty(globalThis, "navigator", {
  value: { platform: "Linux x86_64", userAgent: "jsdom", maxTouchPoints: 0 },
  configurable: true,
});
let clicked = false;
const origClick = dom.window.HTMLAnchorElement.prototype.click;
dom.window.HTMLAnchorElement.prototype.click = function () {
  clicked = true;
  origClick.call(this);
};
const out = await saveFile("beta.md", bytes);
dom.window.HTMLAnchorElement.prototype.click = origClick;
check("web export downloads via anchor", out === "saved" && clicked);
delete window.__TAURI__;

const write = spy();
const save = spy(async () => "content://documents/save/1");
setTauri(
  { dialog: { save }, fs: fullFs({ writeFile: write }) },
  {
    platform: "Linux x86_64",
    userAgent: "Mozilla/5.0 (Linux; Android 14)",
    maxTouchPoints: 0,
  },
);
const android = await saveFile("beta.md", bytes);
check("android save returns saved", android === "saved");
check(
  "android writes bytes to returned content uri",
  write.calls.length === 1 &&
    write.calls[0][0] === "content://documents/save/1" &&
    write.calls[0][1].length === bytes.length,
);

const write2 = spy();
setTauri(
  { dialog: { save: async () => null }, fs: fullFs({ writeFile: write2 }) },
  { platform: "Linux x86_64", userAgent: "Android", maxTouchPoints: 0 },
);
const canceled = await saveFile("beta.md", bytes);
check(
  "android cancel returns canceled without write",
  canceled === "canceled" && write2.calls.length === 0,
);

const write3 = spy();
const remove3 = spy();
const calls = [];
setTauri(
  {
    dialog: {
      save: () => {
        calls.push("save");

        return Promise.resolve("file://dest/beta.md");
      },
    },
    fs: fullFs({
      writeFile: async (...a) => {
        calls.push("write:" + a[0]);
        write3(...a);
      },
      remove: async (...a) => {
        calls.push("remove:" + a[0]);
        remove3(...a);
      },
    }),
    path: {
      documentDir: async () =>
        "/var/mobile/Containers/Data/Application/UUID/Documents",
    },
  },
  { platform: "iPhone", userAgent: "jsdom", maxTouchPoints: 0 },
);
const ios = await saveFile("beta.md", bytes);
check("ios save returns saved", ios === "saved");
check(
  "ios writes temp file in documents then saves then removes",
  calls[0] ===
    "write:/var/mobile/Containers/Data/Application/UUID/Documents/beta.md" &&
    calls[1] === "save" &&
    calls[2] ===
      "remove:/var/mobile/Containers/Data/Application/UUID/Documents/beta.md",
);

const write4 = spy();
const remove4 = spy();
setTauri(
  {
    dialog: { save: async () => null },
    fs: fullFs({
      writeFile: write4,
      remove: async (...a) => {
        remove4(...a);
      },
    }),
    path: { documentDir: async () => "/tmp/docs" },
  },
  { platform: "iPhone", userAgent: "jsdom", maxTouchPoints: 0 },
);
const iosCancel = await saveFile("beta.md", bytes);
check(
  "ios cancel returns canceled and cleans up temp",
  iosCancel === "canceled" && remove4.calls.length === 1,
);

done("save");
