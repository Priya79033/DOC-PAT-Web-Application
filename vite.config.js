import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  root: '.',
  server: { proxy: { '/api': 'http://localhost:5000' } },
  build: { outDir: 'dist', emptyOutDir: true },
});
