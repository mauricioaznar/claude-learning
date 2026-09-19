import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// The client is a separate Vite app that builds INTO the server's public/ dir,
// so Nest serves the compiled SPA in production. In dev, `npm run dev` starts
// Vite (with HMR) and proxies the API calls to the Nest backend on :3002.
//
// Note: the direct-to-storage upload is NOT proxied — the browser POSTs to the
// absolute MinIO URL the backend returns, so it bypasses Vite entirely.
export default defineConfig({
  plugins: [svelte()],
  build: {
    outDir: "../public",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/uploads": "http://localhost:3002",
      "/health": "http://localhost:3002",
    },
  },
});
