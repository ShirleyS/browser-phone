import { defineConfig } from '@lovable.dev/vite-tanstack-config';
export default defineConfig({
  nitro: { preset: 'node-server', output: { dir: '.output', publicDir: '.output/public', serverDir: '.output/server' } },
  tanstackStart: { server: { entry: 'server' } },
});