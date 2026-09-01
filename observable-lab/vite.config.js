import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Learning lab — one component, no routing. Vite just serves it.
export default defineConfig({
  plugins: [react()],
  server: { port: 5180 },
});
