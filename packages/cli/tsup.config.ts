import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { passportsign: 'src/index.ts' },
  format: ['cjs'],
  outDir: 'dist',
  target: 'node22',
  platform: 'node',
  clean: true,
  shims: false,
  splitting: false,
  treeshake: true,
  sourcemap: false,
  bundle: true,
  // Bundle the things that need our patches / share workspace state:
  noExternal: ['@zkpassport/sdk', '@passportsign/core', '@truestamp/canonify'],
  // Everything else stays as a regular runtime dep (npm install resolves them):
  external: [
    'commander',
    'ora',
    'qrcode-terminal',
    '@aztec/bb.js',
  ],
  banner: { js: '#!/usr/bin/env node' },
});
