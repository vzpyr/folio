import "./app.css";
import { mount } from "svelte";
import App from "./App.svelte";
import { initRouter } from "./app.svelte.ts";

initRouter();

if (typeof navigator !== "undefined" && navigator.storage?.persist) {
  navigator.storage.persist().catch(() => {});
}

const app = mount(App, { target: document.getElementById("app")! });

export default app;
