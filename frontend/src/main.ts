import "katex/dist/katex.min.css";
import "./app.css";
import { mount } from "svelte";
import App from "./App.svelte";
import { initRouter } from "./app.svelte.ts";
import { loadSettings } from "./lib/util/settings.ts";
import { applyFonts } from "./lib/util/fonts.ts";

initRouter();

if (typeof navigator !== "undefined" && navigator.storage?.persist) {
  navigator.storage.persist().catch(() => {});
}

const settings = loadSettings();
applyFonts(settings.uiFont, settings.editorFont);

const app = mount(App, { target: document.getElementById("app")! });

export default app;
