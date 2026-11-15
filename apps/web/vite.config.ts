import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@lcw/schemas': path.resolve(__dirname, '../../packages/schemas/src/index.ts'),
      '@lcw/content': path.resolve(__dirname, '../../packages/content/src/index.ts'),
      '@lcw/destruction': path.resolve(__dirname, '../../packages/destruction/src/index.ts'),
      '@lcw/sim-core': path.resolve(__dirname, '../../packages/sim-core/src/index.ts'),
      '@lcw/metrics': path.resolve(__dirname, '../../packages/metrics/src/index.ts'),
      '@lcw/audio': path.resolve(__dirname, '../../packages/audio/src/index.ts'),
      '@lcw/ui': path.resolve(__dirname, '../../packages/ui/src/index.ts')
    }
  }
});
