import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: { '@cm/shared': path.resolve(__dirname, '../shared/src/index.ts') },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 30_000,
    env: { NODE_ENV: 'test' },
    setupFiles: ['tests/setup.ts'],
  },
});
