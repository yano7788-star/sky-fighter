# SKY BREAKER: NEON STRIKE (repo: sky-fighter)

> 게임 이름은 `src/branding.ts` 한 곳에서 관리. 바꿀 때는 그 파일 + `index.html` <title> + `public/manifest.webmanifest` 3곳.

세로형 슈팅 게임. **Phaser 3.90.0 + TypeScript + Vite**. GitHub Pages로 배포 (repo: yano7788-star/sky-fighter).
이전 단일 HTML 버전은 git 태그 `vanilla-v1` 과 `legacy/` 에 보관.

## 명령
- `npm run dev` — 개발 서버 (http://localhost:5180, `.claude/launch.json` 의 `sky-fighter`)
- `npm test` — Vitest (코어 규칙 단위 테스트)
- `npm run sim -- --seeds 200 --skill 0.7 --tier 1` — 브라우저 없이 봇 시뮬레이션으로 난이도 측정 (사람 실력의 하한선)
- `npm run build` — 타입체크 + 프로덕션 빌드(`dist/`), `npm run preview` 로 확인
- 에셋 변환: `SHARP_DIR=<sharp가 설치된 폴더> node tools/optimize-assets.cjs` (원본 `assets-src/originals/` → `public/assets/img/`)

## 구조
```
src/core/     게임 규칙 (순수 TS, Phaser/DOM 무관) — 테스트·시뮬레이션 대상
  sim.ts        Sim 클래스: step(input) 1회 = 1/60초. 이벤트(SimEvent)를 내보내고 연출은 모름
  build.ts      레벨업 카드(모듈/패시브/융합), 경험치 곡선, BuildStats
  meta.ts       격납고(영구 성장) 업그레이드·크레딧
  data.ts       보스/적/중간보스 설정, 탄막 패턴 테이블, 폭탄·궁극기·동료·진행 시간 상수
  config.ts     상수 (논리 해상도 450x800, 타이밍, 플레이어)
src/render/   Phaser 렌더링: background(거울 타일 스크롤), fx(파티클/링), hud(스킬 버튼·XP바 포함), levelup(카드 오버레이), ultfx(궁극기 연출), textures(생성 텍스처)
src/scenes/   BootScene(로딩) → TitleScene ↔ HangarScene, TitleScene → GameScene (입력·고정 틱 루프·결과 오버레이)
src/systems/  audio(합성 SFX + mp3 BGM 크로스페이드), storage(localStorage)
tests/        Vitest      tools/  sim-run.ts, optimize-assets.js
public/       정적 파일: assets/img(WebP), assets/audio(mp3), assets/icons, manifest, sw.js
assets-src/   원본 이미지(originals), 새로 받은 이미지(incoming)
legacy/       예전 HTML 버전들 (배포 안 됨, 참고/포팅용)
docs/         DESIGN.md(게임 디자인·아이디어), ROADMAP.md(점검+로드맵), ASSET_PROMPTS.md(Gemini 생성 요청서)
```

## 규칙·주의
- **`main`은 GitHub Pages 배포 브랜치.** 직접 커밋 금지, `develop`에서 작업하고 요청 시에만 머지.
- 게임 규칙은 `src/core/`에만 둔다. Phaser import 금지(테스트·시뮬레이션이 Node에서 돌아야 함). 연출·사운드는 `SimEvent`를 받아 씬에서 처리.
- 고정 60Hz 틱: `GameScene.update`가 시간을 누적해 `tick()`을 호출. 주사율(60/120/144Hz)과 무관하게 속도 동일.
- 렌더 배율 `R=2`: 논리 좌표(450x800)를 2배 해상도로 그림. 모든 월드/UI는 `scale(R)` 컨테이너 안에 있고, 생성 텍스처는 `makeTexture`(R배)로 만들며 이미지에 `setScale(S)`를 준다. 포인터 좌표는 `/ R`.
- 보스 탄막은 데이터: `BOSS_PATTERNS[tier][phase][mode]` (fan/ring/line 헬퍼). 조준탄은 `aimAng` (vx=sin, vy=cos 규약).
- 난수는 `Sim.rng`(시드 고정)만 사용 → 같은 시드·입력이면 결과 동일.
- UI 문구·주석은 한국어. 모든 원본 이미지 우하단에 AI 워터마크가 있어 변환 스크립트가 제거함.
- `mp3`는 HTMLAudio 스트리밍(디코딩 메모리 절약). SFX는 WebAudio 합성(파일 없음).

## 에이전트 (.claude/agents/, 세션 시작 시 로드됨)
- `game-qa` 버그 사냥(수정 없이 보고), `game-balance` 시뮬레이션 기반 수치 조정, `asset-optimizer` 에셋 용량/전처리
- 개발 서버가 떠 있어야 하는 검증은 `window.__game` (dev 전용)으로 씬 상태 접근: `__game.scene.getScene('GameScene').sim`

## 시스템 메모
- 레벨업/궁극기 연출 중에는 `Sim.step`이 즉시 return (정지). `sim.pending`이 null이 아니면 씬이 카드 오버레이를 띄우고 `chooseCard(i)`로 해제.
- 보스 등장은 `FIGHT_FRAMES`(전투 시간) 기준, 점수 아님. 보스 HP/스폰 간격/XP 곡선은 `npm run sim`으로 맞춘다 (약한 봇 기준 클리어율 30~45%, 한 판 5~6분이 현재 기준선).
- 레거시 스프라이트(고양이/강아지/워쉽/중간보스/손바닥/컷인)는 `assets-src/legacy/` → `tools/optimize-assets.cjs`가 `public/assets/img/`로 변환.
- 키: 이동 방향키/WASD, 발사 Space, 폭탄 B/X/Shift, 필살기 R, 고양이 Q, 강아지 E, 카드 1·2·3, 일시정지 P/ESC, 음소거 M.
