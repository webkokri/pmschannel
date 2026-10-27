import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/worker/index.ts'],
  format: ['cjs'],
  target: 'node20',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // `@cm/shared` is a workspace package resolved via a `src/index.ts` exports
  // condition meant for tsx/Vite's live-TS resolution in dev. Plain `node dist/index.js`
  // in production can't `require()` that raw .ts file, so bundle it in here instead of
  // leaving it external (the default for anything listed in package.json dependencies).
  noExternal: ['@cm/shared'],
});
