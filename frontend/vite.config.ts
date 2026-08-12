import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [svelte()],
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes("node_modules/@tiptap") ||
            id.includes("node_modules/tiptap-markdown")
          ) {
            return "tiptap";
          }
        },
      },
    },
  },
});
