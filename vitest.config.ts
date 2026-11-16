import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@lcw/schemas': path.resolve(__dirname, 'packages/schemas/src/index.ts'),
      '@lcw/content': path.resolve(__dirname, 'packages/content/src/index.ts'),
      '@lcw/destruction': path.resolve(__dirname, 'packages/destruction/src/index.ts'),
      '@lcw/sim-core': path.resolve(__dirname, 'packages/sim-core/src/index.ts'),
      '@lcw/quota': path.resolve(__dirname, 'packages/quota/src/index.ts'),
      '@lcw/converse': path.resolve(__dirname, 'packages/converse/src/index.ts'),
      '@lcw/guard': path.resolve(__dirname, 'packages/guard/src/index.ts'),
      '@lcw/metrics': path.resolve(__dirname, 'packages/metrics/src/index.ts'),
      '@lcw/audio': path.resolve(__dirname, 'packages/audio/src/index.ts'),
      '@lcw/ui': path.resolve(__dirname, 'packages/ui/src/index.ts'),
      '@lcw/bots': path.resolve(__dirname, 'packages/bots/src/index.ts'),
      '@lcw/edge': path.resolve(__dirname, 'apps/edge/src/index.ts')
    }
  },
  test: {
    include: [
      'packages/*/src/**/*.test.ts',
      'packages/*/src/**/*.test.tsx',
      'apps/*/src/**/*.test.ts',
      'apps/*/src/**/*.test.tsx',
      'tools/__tests__/*.test.ts'
    ],
    environment: 'node'
  }
});
