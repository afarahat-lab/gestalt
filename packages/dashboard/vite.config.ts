import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // The SPA is mounted at /app/* on the server (the API owns the root and
  // bare paths like /intents). `base` rewrites every absolute asset
  // reference in the built `index.html` to `/app/assets/...` so the
  // bundle works once it lands at that URL.
  base: '/app/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/auth': 'http://localhost:3000',
      '/intents': 'http://localhost:3000',
      '/events': 'http://localhost:3000',
      '/status': 'http://localhost:3000',
      '/alerts': 'http://localhost:3000',
    },
  },
});
