import { resolve } from 'node:path';

import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    emptyOutDir: false,
    outDir: '.vite/build',
    rollupOptions: {
      external: ['electron'],
      output: {
        entryFileNames: 'main.js',
        format: 'cjs',
      },
    },
    ssr: resolve(import.meta.dirname, 'src/main.ts'),
    target: 'node24',
  },
});
