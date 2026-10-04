# SKY BREAKER: NEON STRIKE (repo: sky-fighter)

> 게임 이름은 `src/branding.ts` 한 곳에서 관리. 바꿀 때는 그 파일 + `index.html` <title> + `public/manifest.webmanifest` 3곳.

세로형 슈팅 게임. **Phaser 3.90.0 + TypeScript + Vite**. GitHub Pages로 배포 (repo: yano7788-star/sky-fighter).
이전 단일 HTML 버전은 git 태그 `vanilla-v1` 과 `legacy/` 에 보관.

## 명령
- `npm run dev` — 개발 서버 (http://localhost:5180, `.claude/launch.json` 의 `sky-fighter`)
- `npm test` — Vitest (코어 규칙 단위 테스트)
- `npm run sim -- --seeds 200 --skill 0.7 --tier 1` — 브라우저 없이 봇 시뮬레이션으로 난이도 측정 (사람 실력의 하한선)
- `npm run build` — 타입체크 + 프로덕션 빌드(`dist/`), `npm run preview` 로 확인
- 에셋 변환: `SHARP_DIR=<sharp가 설치된 폴더> node tools/optimize-assets.cjs` (구 원본 `assets-src/originals/`) + `node tools/process-incoming.cjs [bosses|player|pilots|enemies|midbosses|icons|logo|explosion|backgrounds]` (새 생성 이미지 `assets-src/incoming/` → 크로마키·워터마크 제거 → `public/assets/img/`). incoming 원본은 용량이 커서 git에서 제외(.gitignore).

## 구조
```
src/core/     게임 규칙 (순수 TS, Phaser/DOM 무관) — 테스트·시뮬레이션 대상
  sim.ts        Sim 클래스: step(input) 1회 = 1/60초. 이벤트(SimEvent)를 내보내고 연출은 모름
  build.ts      레벨업 카드(모듈/패시브/융합), 경험치 곡선, BuildStats
  meta.ts       격납고(영구 성장) 업그레이드·크레딧
  data.ts       보스/적/중간보스 설정, 탄막 패턴 테이블, 폭탄·궁극기·동료·진행 시간 상수
  config.ts     상수 (논리 해상도 450x800, 타이밍, 플레이어)
  mutators.ts   런 모디파이어·일일 도전 시드 / achievements.ts 업적 16종·RunStats / missions.ts 일일 미션 / routes.ts 스테이지 사이 항로 선택
src/render/   Phaser 렌더링: background(거울 타일 스크롤), fx(파티클/링), hud(스킬 버튼·XP바 포함), levelup(카드 오버레이), ultfx(궁극기 연출), textures(생성 텍스처)
src/scenes/   (+ MutatorScene·MissionScene·AchievementScene·PilotScene·HangarScene) BootScene(로딩) → TitleScene ↔ HangarScene, TitleScene → GameScene (입력·고정 틱 루프·결과 오버레이)
src/systems/  audio(합성 SFX + mp3 BGM 크로스페이드), storage(localStorage)
tests/        Vitest      tools/  sim-run.ts, optimize-assets.js
public/       정적 파일: assets/img(WebP), assets/audio(mp3), assets/icons, manifest, sw.js
assets-src/   원본 이미지(originals), 새로 받은 이미지(incoming)
legacy/       예전 HTML 버전들 (배포 안 됨, 참고/포팅용)
docs/         DESIGN.md(게임 디자인·아이디어), ROADMAP.md(점검+로드맵), CHANGELOG.md(개발 로그), GROUND_MODE.md(지상전 기획), ASSET_PROMPTS.md(Gemini 생성 요청서)
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
- **모델 배정(토큰 절약)**: `asset-optimizer`=haiku(기계적 변환·용량 작업), `game-qa`/`game-balance`=sonnet(코드 리뷰·수치 판단). 큰 추론이 필요 없는 작업(파일 추출·검색·반복 실행)은 haiku, 일반 코드 리뷰는 sonnet, 설계·어려운 디버깅만 메인 모델(또는 opus)에서 직접 처리한다. 서브에이전트를 임의로 띄울 때도 `model` 파라미터를 같은 기준으로 지정한다.

## 시스템 메모
- 레벨업/궁극기 연출 중에는 `Sim.step`이 즉시 return (정지). `sim.pending`이 null이 아니면 씬이 카드 오버레이를 띄우고 `chooseCard(i)`로 해제.
- 보스 등장은 `FIGHT_FRAMES`(전투 시간) 기준, 점수 아님. 보스 HP/스폰 간격/XP 곡선은 `npm run sim`으로 맞춘다 (약한 봇 기준 클리어율 약 17%, 한 판 4~5분이 현재 기준선 — 사람 플레이 피드백으로 계속 조정).
- 레거시 스프라이트(고양이/강아지/워쉽/중간보스/손바닥/컷인)는 `assets-src/legacy/` → `tools/optimize-assets.cjs`가 `public/assets/img/`로 변환.
- BGM: 일반 전투 1~3스테이지 `under_heavy_fire`, 4~5스테이지 `target_solar_core`, 보스전 `titan_at_the_gate` (GameScene.wantedBgm에서 매핑, 한 곳만 고치면 됨).
- 패럴랙스 오버레이(`overlay_clouds`)는 스테이지별로 색조가 바뀌며 `ParallaxOverlay`가 그린다. 이미지는 흰색+알파로 복원한 것(`tools/process-incoming.cjs overlay`).
- 키: 이동 방향키/WASD, 발사 Space, 폭탄 B/X/Shift, 필살기 R, 고양이 Q, 강아지 E, 카드 1·2·3, 일시정지 P/ESC, 음소거 M.
- 적은 화면 안(y>=ON_SCREEN_Y)에 들어온 뒤에만 피격된다(화면 밖에서 죽던 문제). 중간보스 레이저는 보스 코에서 곧게 발사되며, CHARGE 동안 보스가 조준 위치(lockX)로 미끄러져 간다.
- 스테이지 장애물(`HAZARDS`/`HAZARD` in data.ts, `Sim.updateHazards`): 2 바람(플레이어·적 탄을 밀음), 3 운석(예고 후 낙하), 4 용암 기둥(예고 후 분출), 5 전부. 일반 전투 구간에서만 나오고 중간보스·보스·시간 정지 중에는 멈추거나 사라진다. 렌더는 `GameScene.renderHazards`. 약한 봇 클리어율 약 12%.
- 보스 특수 공격(`BOSS_SPECIALS`/`BOSS_SP`, `Sim.updateBossSpecial`): 2 레이저, 3 돌진(바닥 충격파 탄 고리), 4·5 번갈아. 2페이즈부터 레이저 3줄기(틈으로 피함). 진행 중엔 보스 이동·탄막 정지. 일반 탄막 직전에는 수축 링 예고. 렌더 `GameScene.renderBossSpecial`.
- 게임 중 일시정지 메뉴: 계속하기 / 메인 화면으로(두 번 눌러 확인, 키 Q·T, 패드 B). 나갈 때 점수·크레딧·업적은 정산 저장.
- 유물(렐릭, build.ts `RELIC_DEFS`/`offerRelics`): 보스 격파(최종 보스 제외, 무한 모드는 포함) 때 3택1. 레벨업과 같은 `pending` 카드 오버레이를 쓰고 `CARDS`의 kind='relic'(Build.levels에 1로 저장). 스탯형은 `statsOf`, 효과형은 sim 훅(그레이즈 폭탄/연쇄 폭발/불사조 등). 보스 약점 노출(`Boss.stun`)은 특수 공격 직후 80f, 피해 ×1.6. 보스 체력은 `BOSS_HP_MULT`(1.5)로 보정(유물 도입 후 봇 클리어율 ~18%).
- 하이퍼 모드(`HYPER`, `Sim.activateHyper`): 그레이즈 +4씩 충전, 100이면 자동 발동(탄 소거→점수, 6초간 점수 ×2·연사 +20%). HUD는 바닥 중앙 막대.
- 일일 미션(`core/missions.ts`, `MissionScene`): 날짜 시드로 3개 선택, 여러 판 누적(sum)/한 판 최고(max), 완료 시 크레딧 1회 + 전체 완료 보너스. `finishRun`에서 `applyRun(prev)`로 반영(무한 모드 이어하기 중복 방지). 업적과 같은 결과 화면 줄에 표시. 신규 적 이미지는 `tools/process-incoming.cjs newenemies`.
- 지상전(MVP 이식 v2.4: 타일 64·도트 4px, 규칙·수치 근거는 `assets-src/mvp/HANDOFF.md`, 스프라이트는 `tools/gen-ground-sprites.cjs` 가 `gs_*.png` 생성)(`core/ground.ts` `GroundSim`, `scenes/GroundScene.ts`): 3스테이지 보스 직후 `Sim.groundRequest` → GameScene이 pause 하고 GroundScene을 launch → 끝나면 `sim.finishGround/groundFail` 후 resume. `sim.groundEnabled`는 GameScene만 켠다(헤드리스 sim/테스트는 건너뜀). 픽셀 아트는 `tools/process-ground.cjs`(PNG 팔레트, NEAREST), 봇 `core/groundbot.ts` + `npm run ground`. `?ground`(본편에서 곧장 강하; v2.5: 3스테이지 보스 자폭→EJECT 버튼(`Sim.eject`, `stagePhase='EJECT'`)→강하, 터치 조작 2종 simple/precise는 `core/groundinput.ts`·`sf-ground-ctl`, 지상전만 가로 800×450 가변 레이아웃 `GroundScene.applyLayout`) / **`?groundtest`(지상전 테스트 페이지: 구역·무기·파일럿·무적·인트로 생략 선택, `src/groundtest.ts`)**. **인질 구출 임무(v2.7)**: 4스테이지 클리어 직후 `Sim.rescueRequest` → GameScene 이 `GroundScene`(mission='rescue')을 launch, `GroundSim` opts.mission='rescue' 가 `buildRescueLevel()`(수용소 맵)·인질(`hostage`)·경보/증원·`updateRescue` 를 쓴다. 끝나면 `sim.finishRescue`(성공 시 자매 해금은 씬이 저장). 실패해도 게임오버 아님. 맵 검사 `npx tsx tools/map-check.ts`. 맵은 `core/groundmap.ts`(타일 18×132: 옥상→1·2층→격납고, 스폰/엄폐물/무기 배치), 적·무기 수치는 `ground.ts` 상단 표(ENEMY_DEF/WEAPONS/DROPS). 적 AI는 시야각+소음+거리장 추격.
