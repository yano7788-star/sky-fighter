/// <reference types="vite/client" />
// vite.config.ts 의 define 으로 주입되는 빌드 식별자
declare const __BUILD__: string;
declare const __APP_VERSION__: string;   // 배포 버전 표시 (vite.config.ts)
