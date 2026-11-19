import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // Served by the edge Worker under /adventure/ (tools/build-site.mjs copies dist there; docs/22).
  base: '/adventure/',
  plugins: [react()],
  resolve: {
    alias: {
      '@lcw/schemas': path.resolve(__dirname, '../../packages/schemas/src/index.ts'),
      '@lcw/content': path.resolve(__dirname, '../../packages/content/src/index.ts'),
      '@lcw/converse': path.resolve(__dirname, '../../packages/converse/src/index.ts'),
      '@lcw/audio': path.resolve(__dirname, '../../packages/audio/src/index.ts'),
      '@lcw/ui': path.resolve(__dirname, '../../packages/ui/src/index.ts')
    }
  }
});
