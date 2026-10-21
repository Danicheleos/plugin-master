/// <reference types='vitest' />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiTarget = `http://127.0.0.1:${process.env['PM_PORT'] ?? 4317}`;
const webPort = Number(process.env['PM_WEB_PORT'] ?? 5100);

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/web',
  server: {
    port: webPort,
    // LAN mode (PM_LAN=1) is opt-in; the API server itself stays on loopback
    host: process.env['PM_LAN'] === '1' ? '0.0.0.0' : 'localhost',
    // no changeOrigin: the server's Host guard checks the browser's Host (localhost, or a LAN IP in LAN mode)
    proxy: {
      '/api': apiTarget,
      '/ws': { target: apiTarget, ws: true },
    },
  },
  preview: {
    port: 4300,
    host: 'localhost',
  },
  plugins: [react()],
  // Uncomment this if you are using workers.
  // worker: {
  //  plugins: [],
  // },
  build: {
    outDir: './dist',
    emptyOutDir: true,
    reportCompressedSize: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
  test: {
    name: 'web',
    watch: false,
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    environment: 'jsdom',
    // Mantine + jsdom widget tests take ~1 s alone but up to ~8 s when `pnpm check` runs all projects in parallel
    testTimeout: 15000,
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8' as const,
    },
  },
}));
