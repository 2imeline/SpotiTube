import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: {
    target: 'es2022',
    minify: true,
    cssMinify: true,
    sourcemap: false,
    chunkSizeWarningLimit: 800,
  },
  worker: { format: 'es' },
});
