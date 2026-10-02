# 이미지·사운드 생성 요청서 (Gemini 등)

직접 생성해서 `assets-src/incoming/` 폴더에 넣어 주시면 제가 최적화(WebP 변환, 투명 처리, 워터마크 제거)해서 게임에 연결합니다.
프롬프트는 영어로 써 두었습니다(결과 품질이 안정적). 필요하면 그대로 복사해서 쓰세요.

---

## 0. 먼저 알아둘 점 (현재 에셋 점검 결과)

| 문제 | 영향 | 이번 요청에서의 해결 |
|---|---|---|
| **모든 이미지 우하단에 AI 반짝이(✦) 워터마크** | 배경 3~5, 시작 화면, 보스·플레이어 스프라이트에 남아 있었음 | 파이프라인에서 크롭/패치/제거 처리함(적용 완료). 새 이미지는 **우하단 15% 영역에 중요한 요소를 넣지 마세요.** |
| **Stage 1 배경: 위(진한 파랑) ↔ 아래(흰 구름) 완전히 달라서** 이어 붙이면 이음새가 칼같이 보임 | 스크롤할 때 끊김 | 코드를 **거울 타일링**(상하 반전 반복)으로 바꿔 우선 해결함. 아래 §1처럼 진짜 이음새 없는 배경을 만들면 더 좋아짐 |
| **Stage 2 배경: 단색 주황 그라데이션** | 스크롤해도 움직임이 거의 안 느껴짐 | §1-2처럼 **움직임 단서(구름 결, 먼지, 빛줄기)**가 있는 배경 필요 |
| 보스 스프라이트의 **검정 배경 제거가 불완전** (기체 안쪽 어두운 패널선이 구멍처럼 파임) | 보스 내부에 분홍 실선이 보일 수 있음 | §2 **초록 크로마키 배경**으로 다시 뽑으면 완벽히 해결 |

---

## 1. 스테이지 배경 (필수: Stage 1, 2 / 선택: 3~5)

### 공통 사양
- 세로 **9:16** (권장 1080×1920, 최소 768×1376), PNG
- **위·아래 가장자리가 이어지도록(vertical seamless tile)**: 맨 위 줄과 맨 아래 줄이 같은 색/같은 모양이어야 함
- 화면 정중앙에 눈에 띄는 큰 오브젝트 금지(반복되면 티가 남). 작은 구름/먼지/별 같은 **분산된 디테일** 위주
- **명도 대비는 낮게**: 위에서 전투기·탄환이 선명하게 보여야 하므로 극단적으로 밝은 점/강한 대비 금지
- 우하단 15%에 중요한 요소 넣지 않기

> 팁: Gemini가 "완벽한 이음새"를 한 번에 못 만들 때가 많습니다. 이음새가 살짝 어긋나도 괜찮아요.
> 제가 코드/스크립트로 가장자리를 크로스페이드해서 보정할 수 있습니다. 그래도 위 조건(위아래 색 톤 동일)은 최대한 지켜 주세요.

### 1-1. Stage 1 — 맑은 하늘, 구름 위 (파일명 `bg1.png`)
```
A vertical 9:16 game background, top-down aerial view looking down at a bright daytime sky with soft layered cartoon-realistic clouds, scrolling shooter style. Uniform medium-blue sky color across the whole image (no dark top and no white bottom), clouds scattered evenly with similar density from top to bottom, gentle soft shading, no sun disc, no large focal object, low contrast so small bright bullets remain readable on top. IMPORTANT: this image must tile seamlessly vertically — the top edge and the bottom edge must be identical in color and cloud arrangement. Keep the bottom-right corner empty (plain sky). No text, no logo, no watermark, no UI.
```

### 1-2. Stage 2 — 노을 하늘 (파일명 `bg2.png`)
```
A vertical 9:16 game background for a scrolling shooter, sunset sky seen from high altitude: warm orange to coral gradient with many thin horizontal streaked clouds in layers (cirrus bands), floating tiny golden dust particles and faint light rays, clearly visible cloud streaks so vertical scrolling motion is easy to perceive. Overall color roughly constant from top to bottom (no strong light-to-dark vertical gradient), low contrast, no sun disc, no big focal object. IMPORTANT: it must tile seamlessly vertically — top edge and bottom edge identical in color and cloud streak arrangement. Keep the bottom-right corner empty. No text, no logo, no watermark.
```

### 1-3. (선택) Stage 3~5 업그레이드 — 스크롤감 개선용
- **Stage 3 (AEGIS FLAGSHIP / 금빛):** `...asteroid belt in deep space with golden ion clouds, rocks of varied sizes scattered evenly, dark background, low contrast...` (+ 위 공통 이음새 문구)
- **Stage 4 (HEAVY DESTROYER / 붉은):** `...scorched battlefield seen from above, red-black smoke, glowing lava cracks and drifting embers scattered evenly...`
- **Stage 5 (VOID ARCHANGEL / 보라):** `...void space with violet nebula wisps, faint concentric energy rings, tiny stars...`

### 1-4. (선택) 패럴랙스 오버레이 — 깊이감 업그레이드
배경 위에 더 빠르게 흐르는 반투명 얇은 층을 겹치면 입체감이 확 살아납니다. **초록 크로마키**로 뽑아 주세요.
```
Wispy semi-transparent cloud streaks (and a few tiny cloud puffs) arranged sparsely, on a perfectly flat solid pure green (#00FF00) background, vertical 9:16, no shadows on the background, soft edges, white-ish color, large empty areas between the wisps, no text, no watermark.
```
(Stage별로 색만 바꿔 요청: 노을=주황 빛 먼지, 우주=작은 파편, 용암=연기 등)

---

## 2. 기체/오브젝트 스프라이트 — **초록 크로마키로 뽑기**

현재 스프라이트는 "가짜 체크무늬/검정/흰 배경"이라 제가 알고리즘으로 지워야 했고, 어두운 디테일이 같이 지워지는 문제가 있었습니다.
**배경을 완전히 단색 초록(#00FF00)으로** 뽑아 주시면 크로마키로 깔끔하게 분리됩니다(제가 `tools/` 에 키 스크립트를 추가합니다).

### 공통 규칙
- 1:1 정사각, **1024×1024 이상** PNG
- 배경은 **균일한 순수 초록 #00FF00** 한 가지 색(그라데이션·그림자·바닥면·반사 금지)
- 기체에 **초록색 계열을 쓰지 말 것** (Stage 1 보스처럼 올리브/초록 기체는 **#FF00FF 마젠타 배경**으로 요청)
- 기체는 **정면에서 본 탑다운**, 중앙 배치, 사방 10% 여백, **우하단 15% 비우기**
- **방향: 기체의 앞(코)이 항상 위쪽**. (게임에서 적/보스는 180° 돌려서 아래를 보게 씁니다)
- 기존 보스 1~5와 **같은 화풍**: semi-realistic sci-fi, 세밀한 패널 디테일, 림 라이트(rim light), 네온 발광 포인트

### 공통 프롬프트 템플릿
```
Top-down view game sprite of [SUBJECT DESCRIPTION], nose pointing up, perfectly symmetrical, centered with 10% margin on all sides, semi-realistic sci-fi concept art with detailed panel lines, metallic materials, glowing neon accents and rim lighting. The background must be a perfectly flat solid pure green (#00FF00) with no gradient, no shadow, no floor, no reflections. The subject itself contains no green. Keep the bottom-right corner empty. No text, no logo, no watermark.
```
(`[SUBJECT]`를 아래 목록에서 교체. 초록색 기체는 `pure green (#00FF00)` → `pure magenta (#FF00FF)` 로 바꾸기)

### 2-1. 기존 에셋 재생성(품질 개선) — 우선순위 높음
| 파일명 | SUBJECT |
|---|---|
| `player.png` | sleek blue-and-white single-seat fighter jet with twin orange afterburners (현재 `player.png` 느낌 유지) |
| `boss1.png` | olive-green armored twin-rotor gunship "Tank Buster", heavy side cannons — **마젠타 배경** |
| `boss2.png` | dark stealth delta-wing aircraft with cyan glowing lines "Cyber Stealth" |
| `boss3.png` | golden-brown ornate flagship with two large glowing energy orbs "Aegis Flagship" |
| `boss4.png` | crimson heavy destroyer with massive hull armor and rows of cannons |
| `boss5.png` | violet-black winged "Void Archangel" warship with glowing purple core |
| `bomb.png` | round glowing cyan bomb button icon (원형 아이콘, 투명 배경이 필요하면 초록 크로마키) |

> 기존 이미지를 레퍼런스로 첨부하고 "same design, redraw on flat green background"라고 요청하면 가장 안전합니다.

### 2-2. 신규 에셋 (로드맵 Phase 2용)
**일반 적 기체 4종** (각 1024×1024, 작게 쓰이므로 실루엣이 단순하고 선명해야 함. 코가 위):
1. `enemy_scout.png` — small fast red-and-black scout fighter, swept wings
2. `enemy_zigzag.png` — compact orange hover drone with twin side thrusters (지그재그 비행형)
3. `enemy_kamikaze.png` — pointed dark-purple missile-like suicide craft with glowing red nose (돌진형)
4. `enemy_sniper.png` — slender gray-blue long-range turret ship with a single large cannon (저격형)

**중간보스 2종** (Stage 2, 3용):
- `midboss_2.png` — mid-size cyan-blue armored gunship with a front laser emitter
- `midboss_3.png` — mid-size gold-bronze carrier with twin cannon pods

**아이템 아이콘 6종** (각 256×256로 충분, 마젠타/초록 크로마키): 파워업(P), 유도 미사일(M), 에너지(E), 폭탄(B), 실드, 자석 — `glossy round neon icon badge with [symbol]`

---

## 3. 타이틀 화면 아트 (새로 제작 필요 — 기존 `Startscreen.png`는 폐기)

기존 시작 화면 이미지에는 **"CONTINUE CAMPAIGN / MULTIPLAYER / WELCOME BACK, PILOT"** 같은 UI와 옛 제목("Cyber Strike: Neon Warfare / Mobile Shooter")이 그림에 박혀 있었는데, 실제 게임에는 스토리 모드도 멀티플레이도 없어서 **폐기**했습니다.
지금 타이틀은 **코드로 그린 임시 화면**(스테이지 배경 순환 + 전투기 + 로고 텍스트 + 버튼)이고, 아래 두 장이 오면 교체합니다. **글자·버튼·UI는 절대 그림에 넣지 말아 주세요**(제목·버튼은 게임이 직접 그립니다).

### 3-1. 타이틀 배경 — `title_bg.png` (9:16, 1080×1920)
```
A vertical 9:16 key-art background for a mobile vertical-scrolling shooter game title screen, NO text, NO logo, NO UI, NO buttons. A dramatic sky-to-space scene seen from high altitude: golden-orange sunset clouds in the lower half transitioning upward into deep blue and violet sky with stars and a faint nebula at the top, distant glowing neon-edged warships silhouetted far away, soft volumetric light rays. The upper third (where the game logo will go) and the lower third (where buttons will go) should be relatively calm and darker with low detail; the middle third is open and empty (a fighter jet will be placed there). Cinematic, semi-realistic sci-fi concept art matching a detailed spaceship game, rich colors, no characters, no airplanes in the center. Keep the bottom-right corner empty. No watermark.
```

### 3-2. 로고 — `logo.png` (초록 크로마키, 가로 16:9 이상)
게임 이름이 확정되면 만들어 주세요(현재 임시 이름: **SKY BREAKER / NEON STRIKE**).
```
A bold game logo that reads exactly "[GAME TITLE]" with a smaller line "[SUBTITLE]" beneath it, metallic chrome letters with cyan neon glow edges and subtle lightning/wing motifs, sci-fi arcade shooter style, centered, on a perfectly flat solid pure green (#00FF00) background with no shadow or gradient. The letters contain no green. Keep the bottom-right corner empty. No watermark.
```

### 3-3. (선택) 스테이지 브리핑용 일러스트 — `brief_1~5.png`
각 보스 등장 전에 짧은 대사/설정을 보여주는 **스토리 컷**을 넣고 싶다면(스토리 모드 대신 "연출" 수준) 보스별 반신 일러스트 5장. 우선순위 낮음.

---

## 4. 사운드 (선택 — Suno / Lyria 등)
현재 BGM 2곡을 쓰고 있습니다(일반 `under_heavy_fire`, 보스 `titan_at_the_gate`). 스테이지별로 늘리고 싶다면:
```
Seamlessly loopable 90-second chiptune-meets-synthwave shoot-em-up stage theme, 150 BPM, driving bassline, bright arpeggios, no vocals, no fade-out (loops cleanly), [MOOD per stage: hopeful sky / warm sunset / tense asteroid field / aggressive inferno / eerie cosmic].
```
효과음은 현재 코드 합성음으로 충분해서 우선순위 낮음. (필요하면 레이저/폭발/아이템 SFX 프롬프트도 따로 드릴게요.)

---

## 5-0. 현재 에셋 상태
> 2026-10-02 갱신: 보스·플레이어·스킨·파일럿·적 3종·중간보스 2종·아이템·젬·드론·로고·타이틀·배경 1~2·폭발 시트·패럴랙스 오버레이 모두 **적용 완료**. 남은 것: 배경 3~5, 파일럿 전용 궁극기 컷인(§ DESIGN 7번 결정 후), 타이틀 외 추가 연출.

| 용도 | 상태 |
|---|---|
| 동료 고양이/강아지, 저격형 적(워쉽), 중간보스(비명 얼굴), 궁극기 컷인 카드·손바닥 | ✅ 레거시 `Cyber_Strike.html`에서 추출해 사용 중 (`assets-src/legacy/`) — **새로 만들 필요 없음**(원하면 같은 화풍으로 교체 가능) |
| 일반 적 3종(정찰기·지그재그 드론·돌진형) | ⚠️ 코드로 그린 **임시 도형** → 전용 스프라이트 필요 (`enemy_scout/zigzag/kamikaze.png`) |
| 경험치 젬, 드론, 아이템 아이콘(P/M/E/B/G/L) | ⚠️ 코드로 그린 임시 아이콘 → 있으면 좋음 |
| 보스 5종, 플레이어 | ✅ 사용 중이나 **초록 크로마키로 재생성하면** 내부 구멍(분홍선) 문제 해결 (§2) |
| 타이틀 배경·로고, 스테이지 배경 이음새 | ⚠️ §1, §3 |
| 파일럿 2명(자매) 초상화 + 기체 스킨 2종 | 🆕 파일럿 선택 기능을 만들 때 필요 (아직 미구현, `docs/DESIGN.md` 5번) |

## 5. 추가로 있으면 좋은 이미지 (Phase 2 콘텐츠용, 우선순위순)

| 우선 | 파일명 | 용도 | 비고 |
|---|---|---|---|
| ★★★ | `enemy_scout/zigzag/kamikaze/sniper.png` | 적 4종 (§2-2) | 지금은 빨간 삼각형 하나뿐이라 가장 체감이 큼 |
| ★★★ | `bg1~5.png` 이음새 없는 버전 | 스테이지 배경 (§1) | 현재는 코드로 거울 타일링해서 임시 해결 |
| ★★☆ | `midboss_2.png`, `midboss_3.png` | 중간보스 2종 | 스테이지 2·3 보스 전에 등장 예정 |
| ★★☆ | `ally_cat.png`, `ally_dog.png` | 동료(흡혈/보호막) | 예전 Cyber_Strike.html에 base64로 들어 있던 걸 제가 추출해서 쓸 수도 있으니, 새로 만들 거면 같은 화풍으로 |
| ★★☆ | `item_shield/magnet/life.png` | 신규 아이템 3종 | 256×256, 둥근 네온 뱃지 |
| ★☆☆ | `ult_cutin.png` (+ `skill1/2.jpg` 기존) | 궁극기 컷인 | 기존 이미지 재사용 가능 |
| ★☆☆ | `player_skin_2/3.png` | 해금용 기체 스킨 2종 | player.png와 같은 구도·크기 |
| ★☆☆ | `boss_final_phase3.png` | 5스테이지 3페이즈 폭주 형태 | boss5 변형 |
| ★☆☆ | `explosion_sheet.png` | 폭발 스프라이트 시트 (8~12프레임, 가로 배열) | 지금은 코드 파티클 — 시트가 있으면 더 화려해짐 |
| ★☆☆ | `logo.png` | 타이틀 로고 (초록 크로마키) | 시작 화면 상단에 얹을 용도 |
| ☆ | `bgm_stage2~5.mp3`, `bgm_title.mp3` | 스테이지별 BGM (§4) | 선택 |

### 추가 프롬프트
**동료 (고양이)** — `ally_cat.png`
```
Top-down view game sprite of a small cute cyber-cat drone companion with neon-blue glowing eyes and tiny jet thrusters, chibi proportions, nose pointing up, centered with 10% margin, semi-realistic sci-fi style matching a detailed spaceship game, on a perfectly flat solid pure green (#00FF00) background with no gradient or shadow. Subject contains no green. Keep the bottom-right corner empty. No text, no watermark.
```
(`ally_dog.png`: `...armored robot-dog companion with a small energy shield emitter on its back...`)

**신규 아이템 뱃지** — 256×256, 마젠타(#FF00FF) 배경
```
A glossy round neon icon badge with a thick metallic rim and a bold simple glyph in the center: [SHIELD: a bubble shield / MAGNET: a horseshoe magnet with blue sparks / LIFE: a glowing red heart], sci-fi game pickup style, on a perfectly flat solid pure magenta (#FF00FF) background, no shadow on the background, centered with 10% margin. Keep the bottom-right corner empty. No text, no watermark.
```

**폭발 스프라이트 시트** — `explosion_sheet.png`
```
A horizontal sprite sheet of a stylized sci-fi explosion animation in exactly 10 frames laid out in a single row, each frame a perfect square of equal size, the explosion growing from a small bright flash to a large fireball then fading into smoke and sparks, orange-yellow-white core with dark smoke edges, on a perfectly flat solid pure green (#00FF00) background, no shadow. No text, no watermark.
```

---

## 6. 전달 방법
1. 파일을 `assets-src/incoming/` 에 위 파일명으로 저장 (원본 PNG 그대로, 리사이즈·압축하지 마세요)
2. "에셋 넣었어"라고 알려 주시면 → 크로마키 제거 / WebP 변환 / 워터마크 정리 / 코드 연결 / 확인까지 제가 처리합니다.

---

## 7. 신규 적(비행기가 아닌 적) 이미지 — 지금은 코드로 그린 임시 텍스처 (있으면 교체)
공통: 위에서 내려다본 시점, 중앙 배치 + 10% 여백, **순수 초록(#00FF00) 단색 배경**, 그림자·그라데이션 없음, 피사체에 초록색 쓰지 않기, 우하단 모서리 비우기, 글자·워터마크 없음. 스타일은 기존 `enemy_*`와 같은 "디테일한 SF 세미리얼". 파일은 `assets-src/incoming/` 에 아래 이름으로.

| 파일 | 적 | 프롬프트 핵심 |
|---|---|---|
| `enemy_drone.png` | 벌떼 드론(인해전술 잡병, 매우 작게 보임) | `A tiny hostile swarm drone: a glowing red single-eye sphere body with two short swept wings, menacing but simple so it reads clearly when 30 appear at once` |
| `enemy_mine.png` | 부유 기뢰(터지면 탄 고리) | `A spiked floating naval-style space mine: dark metal sphere with 8 radial spikes, a pulsing red core light and yellow warning stripes, hazard look` |
| `enemy_turret.png` | 지상 포대(배경과 함께 스크롤) | `Top-down view of a ground anti-air turret emplacement: octagonal steel base bolted to the ground, a triple-barrel cannon on a round rotating hub with yellow warning lights, military sci-fi` |
| `enemy_rock.png` | 운석 괴수(처치하면 쪼개짐) | `A living meteor creature: a jagged cracked asteroid body with glowing molten-orange fissures and two small glowing eyes in the cracks, heavy and rocky` |

**추가 후보(다음 업데이트용, 아직 코드 없음)** — 필요하면 이 순서로: ① `enemy_jelly.png` 공중 해파리형 생명체(전기 촉수) ② `enemy_crab.png` 지상 게형 메카(측면 이동) ③ `enemy_gunship_side.png` 측면 진입용 대형 헬기형 ④ `enemy_swarm_bug.png` 곤충형 벌떼(드론 대체 스킨).

`enemy_drone/mine/turret/rock`을 받으면: "에셋 넣었어"라고 알려 주세요 → 크로마키 제거·WebP 변환·로딩 연결(`BootScene`)·크기 조정(`GameScene.ENEMY_W`)까지 처리합니다.

### 7-1. 신규 적 4종을 한 장으로 (이 프롬프트 하나면 됩니다) — 파일명 `enemies_new_sheet.png`
```
A single image containing a 2x2 grid of four distinct top-down view sci-fi shooter game enemy sprites, each centered inside its own equal square cell with generous margin, cells clearly separated, semi-realistic detailed sci-fi style matching a vertical-scrolling spaceship shooter. All four on one perfectly flat solid pure green (#00FF00) background with no gradient, no shadow and no cell borders. None of the subjects contains any green.
Top-left: a tiny hostile swarm drone — a glowing red single-eye spherical body with two short swept wings, simple and readable even when thirty appear at once.
Top-right: a spiked floating space mine — dark metal sphere with eight radial spikes, a pulsing red core light and yellow hazard stripes.
Bottom-left: a ground anti-air turret emplacement seen from above — octagonal steel base, round rotating hub with a triple-barrel cannon pointing downward, yellow warning lights.
Bottom-right: a living meteor creature — a jagged cracked asteroid body with glowing molten-orange fissures and two small glowing eyes in the cracks.
Keep the bottom-right corner of the whole image empty. No text, no labels, no watermark.
```
받으면 `assets-src/incoming/enemies_new_sheet.png` 로 넣고 "에셋 넣었어"라고 알려 주세요 → 2×2로 자르고 크로마키 제거 후 `enemy_drone/mine/turret/rock`으로 연결합니다.

---

## 8. 지상전 모드 에셋 (기획: `docs/GROUND_MODE.md`)
공통 규칙(매우 중요 — 이전 시트에서 배경이 섞였던 문제 방지): **"exactly N sprites, nothing else"**, **배경은 순수 초록(#00FF00) 단색**, 풍경·하늘·배경 오브젝트·중복 스프라이트 금지, 각 스프라이트는 자기 칸 안에 완전히 들어갈 것, 칸 구분선·글자·워터마크 없음, 피사체에 초록색 쓰지 않기, 전체 이미지 우하단 모서리 비우기. **위에서 내려다본(top-down, 약 80~90도) 시점**, 스타일은 기존 게임과 동일한 "디테일한 SF 세미리얼".

### 8-1. 파일럿 3명 (탑다운 캐릭터) — `ground_pilots_sheet.png`
참고용으로 기존 파일럿 이미지(`pilot_sister1/2`, 에이스 기체 조종사)를 첨부해서 같은 인물임을 유지하세요.
```
IMPORTANT: output exactly three character sprites and nothing else, arranged in a single row of 3 equal square cells. The entire image background must be one perfectly flat solid pure green (#00FF00) — no scenery, no extra objects, no duplicates, no cell borders. Each sprite is fully inside its own cell and does not overlap anything.
Top-down view (camera looking almost straight down) of a stylized sci-fi pilot character in a flight suit holding a compact rifle, facing downward toward the bottom of the image, shown from above as a game character sprite, semi-realistic detailed sci-fi style, matching the attached reference portraits. Left: the main pilot (neutral build, helmet under the arm). Middle: the older sister (athletic, short hair, baseball cap, aggressive stance, carrying a shotgun). Right: the younger sister (long hair tied back, slender, carrying a long-barrel precision rifle). Keep the bottom-right corner empty. No text, no watermark.
```

### 8-2. 지상 적 6종 — `ground_enemies_sheet.png` (3열×2행)
```
IMPORTANT: output exactly six enemy sprites and nothing else, arranged in a 3 columns x 2 rows grid of equal square cells. The entire image background must be one perfectly flat solid pure green (#00FF00) — no scenery, no extra objects, no duplicates, no cell borders. Each sprite fully inside its own cell.
Top-down view (camera looking almost straight down), sci-fi shooter enemies facing downward, semi-realistic detailed style:
Row 1: (1) rifleman soldier in gray-red armor with a rifle; (2) assault trooper in heavy plated armor with a glowing red melee blade, in a charging pose; (3) sniper soldier in a dark hood lying prone with a very long rifle and a small red laser sight.
Row 2: (4) a ground turret with a rotating round hub and four short barrels on an octagonal steel base; (5) a small hovering combat drone with a red eye (same design family as a swarm drone); (6) a medium armored vehicle seen from above with a rotating cannon turret and a mortar tube, tracks on both sides.
Keep the bottom-right corner empty. No text, no watermark.
```

### 8-3. 지상 타일/소품 — 이미지 3장 (각각 따로)
```
(a) `tile_floor.png` — A seamless tileable top-down texture of a sci-fi military base floor: dark steel plates with rivets, faint scratches, a few yellow hazard stripe segments. Perfectly seamless on all four edges, flat even lighting, 1024x1024, no objects, no perspective.
(b) `tile_wall.png` — A seamless tileable top-down texture of a thick sci-fi concrete-and-steel wall top surface, darker than the floor with subtle panel lines, seamless on all edges, 1024x1024.
(c) `props_sheet.png` — exactly eight props in a 4x2 grid on a perfectly flat solid pure green (#00FF00) background (no scenery, no duplicates): top-down view of a low cover barrier, a metal crate, a stack of two crates, an explosive red barrel with a hazard symbol, a closed hangar door section, an open hangar door section, a weapon crate with a glowing lid, a ground light fixture. Keep the bottom-right corner empty. No text.
```

### 8-4. 지상 보스 "격납고 수문장" — `ground_boss.png`
```
Top-down view of a huge sci-fi hangar guardian walker mech, facing downward, with two shoulder cannons, a central glowing red core, heavy armor plates and a rotating gatling arm, semi-realistic detailed style, centered with 10% margin, on a perfectly flat solid pure green (#00FF00) background with no scenery and no duplicates. The subject contains no green. Keep the bottom-right corner empty. No text, no watermark.
```

### 8-5. 전환 컷 3장 (각각 따로, 16:9 또는 9:16 세로) — 배경 있음(크로마키 아님)
1. `cut_shotdown.png`: 불꽃에 휩싸인 전투기에서 조종사가 탈출하는 순간, 구름 위 하늘, 역동적인 시네마틱.
2. `cut_landing.png`: 구름을 뚫고 지상 군사 기지에 착지하는 조종사의 뒷모습, 아래로 내려다보는 시점.
3. `cut_takeoff.png`: 격납고에서 새 기체에 올라타 시동을 거는 조종사, 시네마틱.
(공통 문구: `cinematic sci-fi game cutscene illustration, semi-realistic, dramatic lighting, vertical 9:16, no text, no watermark`)

**우선순위**: 8-1 → 8-2 → 8-3 → 8-4 → 8-5. 8-1~8-3까지 있으면 지상전 코어(M3)를 바로 붙일 수 있습니다. 받으면 `assets-src/incoming/` 에 넣고 "에셋 넣었어"라고 알려 주세요(자르기·크로마키·연결은 제가 처리).
