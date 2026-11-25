import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, normalizePath } from 'vite';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.join(projectRoot, 'src', 'client');
const mainEntry = normalizePath(path.join(clientRoot, 'main.tsx'));

const pagesBootstrap = {
  name: 'io-pages-test-bootstrap',
  enforce: 'pre' as const,
  transform(code: string, id: string) {
    const cleanId = normalizePath(id.split('?')[0] ?? id);
    if (cleanId !== mainEntry) return null;

    // Load the browser-side API adapter before the original game client starts.
    return {
      code: "import '../pages/api.js';\n" + code,
      map: null,
    };
  },
};

export default defineConfig({
  root: clientRoot,
  base: '/infinity-orbs-v2/',
  plugins: [pagesBootstrap, react(), tailwindcss()],
  resolve: {
    alias: [
      {
        find: '@devvit/web/client',
        replacement: path.join(projectRoot, 'src', 'pages', 'devvit-client.ts'),
      },
      {
        find: '@devvit/analytics/client/reddit',
        replacement: path.join(projectRoot, 'src', 'pages', 'telemetry.ts'),
      },
      {
        find: '@devvit/notifications',
        replacement: path.join(projectRoot, 'src', 'pages', 'notifications.ts'),
      },
    ],
  },
  build: {
    outDir: path.join(projectRoot, 'dist-pages'),
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      input: {
        index: path.join(clientRoot, 'index.html'),
        frenzy: path.join(clientRoot, 'frenzy.html'),
      },
    },
  },
});
