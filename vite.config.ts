import { defineConfig } from 'vite';

// base './' : GitHub Pages 하위 경로(/sky-fighter/)에서도, 로컬에서도 같은 빌드가 동작한다
export default defineConfig({
  base: './',
  // 정적 에셋 캐시 무효화용 빌드 식별자 (GitHub Pages/브라우저 캐시 때문에 새 이미지가 안 보이는 문제 방지)
  define: { __BUILD__: JSON.stringify(Date.now().toString(36)) },
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
