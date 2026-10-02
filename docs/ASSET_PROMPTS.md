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

## 3. 시작 화면 / 컷인 (선택)
- `Startscreen.png` 개선 시: **9:16, 하단 중앙 버튼 영역은 비워두기**(게임이 그 위에 "TAP TO START"를 그립니다). 우하단 15% 비우기.
- 궁극기 컷인(`skill1.jpg`, `skill2.jpg`)은 Phase 2에서 사용 예정이라 지금은 그대로 두셔도 됩니다.

---

## 4. 사운드 (선택 — Suno / Lyria 등)
현재 BGM 2곡을 쓰고 있습니다(일반 `under_heavy_fire`, 보스 `titan_at_the_gate`). 스테이지별로 늘리고 싶다면:
```
Seamlessly loopable 90-second chiptune-meets-synthwave shoot-em-up stage theme, 150 BPM, driving bassline, bright arpeggios, no vocals, no fade-out (loops cleanly), [MOOD per stage: hopeful sky / warm sunset / tense asteroid field / aggressive inferno / eerie cosmic].
```
효과음은 현재 코드 합성음으로 충분해서 우선순위 낮음. (필요하면 레이저/폭발/아이템 SFX 프롬프트도 따로 드릴게요.)

---

## 5. 전달 방법
1. 파일을 `assets-src/incoming/` 에 위 파일명으로 저장 (원본 PNG 그대로, 리사이즈·압축하지 마세요)
2. "에셋 넣었어"라고 알려 주시면 → 크로마키 제거 / WebP 변환 / 워터마크 정리 / 코드 연결 / 확인까지 제가 처리합니다.
