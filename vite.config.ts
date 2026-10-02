import { defineConfig } from 'vite';

// base './' : GitHub Pages 하위 경로(/sky-fighter/)에서도, 로컬에서도 같은 빌드가 동작한다
export default defineConfig({
  base: './',
  server: { host: true },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: { manualChunks: { phaser: ['phaser'] } }
    }
  },
  test: { include: ['tests/**/*.test.ts'] }
});
