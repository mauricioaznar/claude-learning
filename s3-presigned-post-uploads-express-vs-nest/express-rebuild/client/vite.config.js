import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The client is a separate Vite app that builds INTO the server's public/ dir,
// so Express serves the compiled SPA in production. In dev, `npm run dev` starts
// Vite (with HMR) and proxies the API calls to the Express backend on :3004.
//
// Note: the direct-to-storage upload is NOT proxied — the browser POSTs to the
// absolute MinIO URL the backend returns, so it bypasses Vite entirely.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../public",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/uploads": "http://localhost:3004",
      "/health": "http://localhost:3004",
    },
  },
});
