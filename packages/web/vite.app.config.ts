// Builds the browser app (the /bind page) into dist-app/, which the
// Worker serves as static assets. Separate file from any vitest
// config so test discovery is unaffected.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: resolve(here, 'app'),
  build: {
    outDir: resolve(here, 'dist-app'),
    emptyOutDir: true,
    // Keep every generated file under /bind/* — on the custom domain
    // only /bind*, /badge/*, /verify/* route to the Worker, and the
    // default /assets/* would collide with GitHub Pages' own assets.
    assetsDir: 'bind/assets',
    rollupOptions: {
      input: {
        bind: resolve(here, 'app/bind/index.html'),
      },
    },
  },
});
