import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./" so the build works at tylko17.github.io/<repo>/ with no config.
// Routing is hash-based for the same reason: Pages has no SPA fallback.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: { target: "es2022", chunkSizeWarningLimit: 900 },
});
