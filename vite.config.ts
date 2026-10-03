import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// 타이틀에 표시할 배포 버전: package.json 버전 + 커밋 해시 + 빌드 날짜 (예: v2.1.0 · b035ca3 · 10.03)
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
const sha = (() => { try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; } })();
const d = new Date();
const appVersion = `v${pkg.version}${sha ? ' · ' + sha : ''} · ${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;

// base './' : GitHub Pages 하위 경로(/sky-fighter/)에서도, 로컬에서도 같은 빌드가 동작한다
export default defineConfig({
  base: './',
  // 정적 에셋 캐시 무효화용 빌드 식별자 (GitHub Pages/브라우저 캐시 때문에 새 이미지가 안 보이는 문제 방지)
  define: { __BUILD__: JSON.stringify(Date.now().toString(36)), __APP_VERSION__: JSON.stringify(appVersion) },
  server: { host: true, watch: { ignored: ['**/assets-src/**', '**/legacy/**', '**/docs/**'] } },   // 큰 원본 이미지를 감시하다 EBUSY 로 죽는 문제 방지
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: { manualChunks: { phaser: ['phaser'] } }
    }
  },
  test: { include: ['tests/**/*.test.ts'] }
});
