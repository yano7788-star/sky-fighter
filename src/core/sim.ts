import { FUSION_IDS, type RunStats } from './achievements';
import { CARDS, hasFusion, type FusionId, newBuild, offerCards, statsOf, xpNeeded, type Build, type BuildStats, type CardId } from './build';
import { H, MAX_TIER, PHASE_FRAMES, PLAYER, W, loopOf, tierIdx } from './config';
import {
  BOMB, BOSS_CONFIGS, ULT_KIND, COMBO_WINDOW, COMPANION_FRAMES, DROP_BASE, DROP_EXTRA, ENEMY_DEFS, ENEMY_WEIGHTS, GRAZE_MARGIN, GRAZE_SCORE,
  FIGHT_FRAMES, HAZARD, HAZARDS, ON_SCREEN_Y, enemyHpScale, LIFESTEAL_CAP, LIFESTEAL_RATE, MID_BOSS_AT, MID_CONFIGS, SPAWN_INTERVAL, MOB_HIT_VALUE, SHIELD_R, ULT, comboMultiplier, companionDropChance,
  fireBossPattern, rankFor, BOSS_SP, BOSS_SPECIALS,
} from './data';
import { NO_META, pilotOf, type MetaParams } from './meta';
import { createRng, type Rng } from './rng';
import type {
  Boss, Bullet, Companion, Enemy, EnemyBullet, EnemyType, GameState, Gem, Hazard, Item, ItemType, MidBoss, Missile, PlayerState, Rank,
  SimEvent, SimInput, SkillKey, StagePhase, UltKind, UltPhase,
} from './types';

const MAGNET_FRAMES = 600;
const MAGNET_RANGE = 150;
const GEM_RANGE = 90;
const MAX_LIVES = 4;
const MISSILE_CD = [0, 40, 30, 24, 18];

const newCompanion = (): Companion => ({ ready: false, active: false, timer: 0, used: false, pity: 0 });

/**
 * 게임 규칙 시뮬레이션 (Phaser/DOM 무관한 순수 TS).
 * - 고정 60Hz 틱: step(input) 한 번 = 1/60초
 * - 렌더링·사운드·연출은 drainEvents()로 받은 이벤트를 보고 바깥(씬)에서 처리한다
 * - 시드 고정 난수 → 같은 입력이면 같은 결과 (밸런스 측정·테스트 재현용)
 */
export class Sim {
  rng: Rng;
  meta: MetaParams;
  state: GameState = 'PLAYING';
  frame = 0;
  score = 0;
  lives: number = PLAYER.startLives;
  bombs: number = PLAYER.startBombs;
  weaponLevel = 1;                // P 아이템으로 오르는 기본 대포 레벨 (1~5)
  hasHomingMissile = false;       // M 아이템: 일정 시간 유도 미사일
  missileTimer = 0;

  // 성장(빌드)
  build: Build = newBuild();
  stats: BuildStats;
  level = 1;
  xp = 0;
  pending: CardId[] | null = null;   // 레벨업 카드 선택 대기 (null이 아니면 시뮬레이션이 멈춘다)
  gems: Gem[] = [];
  private vacuum = 0;

  // 동료 / 궁극기
  comp: { cat: Companion; dog: Companion } = { cat: newCompanion(), dog: newCompanion() };
  ult: { gauge: number; phase: UltPhase; t: number; kind: UltKind } = { gauge: 0, phase: 'IDLE', t: 0, kind: 'palm' };

  // 폭탄 폭발장 / 레이저 상태 (렌더링이 읽는다)
  bombT = 0; bombX = 0; bombY = 0;
  laser = { on: false, x: 0, w: 0, offs: [0] as number[] };   // offs: 빔 가로 위치 오프셋(프리즘 융합 시 3줄기)

  combo = 0;
  comboTimer = 0;
  grazeCount = 0;
  stageHits = 0;                 // 이번 스테이지에서 피격당한 횟수 (랭크 계산용)
  stageRank: Rank | null = null;

  bossTier = 1;
  endless = false;               // 무한 모드: 5스테이지 클리어 후 계속 도전 (루프마다 난이도 상승)
  boss: Boss | null = null;
  midBoss: MidBoss | null = null;
  midDone = false;               // 이번 스테이지의 중간보스를 이미 등장시켰는가
  stageFrames = 0;               // 이번 스테이지의 전투(FIGHT) 경과 프레임 — 보스 등장 시점을 결정
  stagePhase: StagePhase = 'FIGHT';
  phaseTimer = 0;
  clearBonus = 0;

  player: PlayerState;
  bullets: Bullet[] = [];
  missiles: Missile[] = [];
  enemyBullets: EnemyBullet[] = [];
  enemies: Enemy[] = [];
  items: Item[] = [];
  hazards: Hazard[] = [];
  run = { kills: 0, maxCombo: 0, hits: 0, bombs: 0, ults: 0 };   // 업적용 한 판 통계
  windDir = 0; windWarn = 0; windT = 0;     // 바람: 예고(windWarn) 후 windT 동안 windDir 방향으로 분다
  private hazCd: Record<string, number> = {};
  events: SimEvent[] = [];

  private fireCd = 0;
  private missileCd = 0;
  private droneCd = 0;
  private droneMissileCd = 0;
  private lastBombFrame = 0;

  constructor(seed = 1, meta: MetaParams = NO_META) {
    this.rng = createRng(seed);
    this.meta = meta;
    this.stats = statsOf(this.build, meta);
    this.player = this.newPlayer();
    this.player.maxEnergy = Math.round((this.player.maxEnergy + meta.energyBonus) * meta.mut.playerHp); this.player.energy = this.player.maxEnergy;
    this.bombs += meta.startBombs;
    this.ult.gauge = meta.ultStart;
    this.ult.kind = pilotOf(meta.pilot).ult;
  }

  get multiplier(): number { return comboMultiplier(this.combo); }
  get maxBombs(): number { return PLAYER.maxBombs + this.stats.bombCapBonus + this.meta.startBombs; }
  /** 동생의 궁극기(시간 정지) 진행 중: 적·적 탄·보스는 움직이지 않는다 (피격은 계속 받음) */
  get timeStopped(): boolean { return this.ult.phase === 'ACTIVE' && this.ult.kind === 'timestop'; }
  get ultReady(): boolean { return this.ult.gauge >= 100 && this.ult.phase === 'IDLE'; }
  get xpNext(): number { return xpNeeded(this.level); }
  /** 표 조회용 스테이지(1~5): 무한 모드에서 6스테이지는 1번 구성으로 돌아간다 */
  get stageTier(): number { return tierIdx(this.bossTier); }
  get loopCount(): number { return loopOf(this.bossTier); }
  /** 적 탄 속도 배율: 루프가 돌수록 빨라진다 */
  get enemyBulletSpeed(): number { return Math.min(1.45, 1 + 0.06 * this.loopCount) * this.meta.mut.bulletSpeed; }

  private newPlayer(): PlayerState {
    return {
      x: W / 2, y: PLAYER.spawnY, targetX: W / 2, targetY: PLAYER.spawnY,
      radius: PLAYER.radius, energy: PLAYER.maxEnergy, maxEnergy: PLAYER.maxEnergy, invincible: 0, shield: 0, aegisTimer: 0, magnet: 0,
    };
  }

  /** 시작 스테이지를 건너뛰어 특정 스테이지부터 테스트할 때 사용 */
  startAtTier(tier: number): void {
    this.bossTier = tier;
    this.stageFrames = FIGHT_FRAMES[tier];
    this.midDone = true;
  }

  drainEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  private emit(e: SimEvent): void { this.events.push(e); }
  private boom(x: number, y: number, color: string, count: number): void { this.emit({ t: 'explosion', x, y, color, count }); }

  /** 드론 위치 (렌더링·사격 공용) */
  dronePositions(): { x: number; y: number }[] {
    const n = this.stats.drones, p = this.player, out: { x: number; y: number }[] = [];
    for (let i = 0; i < n; i++) {
      const a = this.frame * 0.05 + (i * Math.PI * 2) / n;
      out.push({ x: p.x + Math.cos(a) * 52, y: p.y + Math.sin(a) * 30 });
    }
    return out;
  }

  // ---------------------------------------------------------------------
  // 레벨업 / 카드
  // ---------------------------------------------------------------------
  private addXp(v: number): void {
    this.xp += v * this.stats.xpMult;
    this.checkLevelUp();
  }
  private checkLevelUp(): void {
    if (this.pending) return;
    const need = xpNeeded(this.level);
    if (this.xp >= need) {
      this.xp -= need; this.level++;
      const offer = offerCards(this.build, this.rng);
      if (offer.length === 0) {   // 모든 카드를 최대로 키운 경우: 정지시키지 않고 보상으로 대체
        this.score += 500; this.player.energy = Math.min(this.player.maxEnergy, this.player.energy + 25);
        this.emit({ t: 'heal', x: this.player.x, y: this.player.y });
        this.checkLevelUp();
        return;
      }
      this.pending = offer;
      this.emit({ t: 'levelup', level: this.level });
    }
  }
  /** 레벨업 카드 선택 (씬이 호출) */
  chooseCard(index: number): void {
    if (!this.pending) return;
    const id = this.pending[index];
    if (!id) return;
    this.build.levels[id] = (this.build.levels[id] ?? 0) + 1;
    this.stats = statsOf(this.build, this.meta);
    const p = this.player;
    if (id === 'vitality') { p.maxEnergy += 25; p.energy = Math.min(p.maxEnergy, p.energy + 25); this.emit({ t: 'heal', x: p.x, y: p.y }); }
    if (id === 'bombcap') this.bombs = Math.min(this.maxBombs, this.bombs + 1);
    if (id === 'aegis') p.aegisTimer = Math.min(p.aegisTimer || Infinity, this.stats.aegisSeconds * 60);
    this.emit({ t: 'ring', x: p.x, y: p.y, color: CARDS[id].color, max: 90 });
    this.emit({ t: 'sfx', name: 'item' });
    this.pending = null;
    this.checkLevelUp();   // 경험치가 남아 연속 레벨업이면 바로 다음 카드
  }

  // ---------------------------------------------------------------------
  // 한 틱 진행
  // ---------------------------------------------------------------------
  step(inp: SimInput): void {
    if (this.state !== 'PLAYING') return;
    if (this.pending) return;                                   // 카드 선택 중에는 정지
    if (this.ult.phase === 'CUTIN' || this.ult.phase === 'FALL') { this.stepUltCinematic(); return; }

    this.frame++;
    const p = this.player;
    p.targetX = inp.targetX; p.targetY = inp.targetY;
    const ultPhase0 = this.ult.phase, bombs0 = this.bombs;
    if (inp.skill) this.activateSkill(inp.skill);
    if (inp.bomb) this.fireBomb();
    if (ultPhase0 === 'IDLE' && this.ult.phase !== 'IDLE') this.run.ults++;
    if (this.bombs < bombs0) this.run.bombs++;
    if (p.invincible > 0) p.invincible--;
    if (p.magnet > 0) p.magnet--;
    this.updateAegis();
    this.updateCompanions();
    if (this.ult.phase === 'IMPACT' && ++this.ult.t >= ULT.frames.IMPACT) { this.ult.phase = 'IDLE'; this.ult.t = 0; }
    if (this.ult.phase === 'ACTIVE') this.runUltActive();
    if (!this.timeStopped && this.comboTimer > 0 && --this.comboTimer === 0 && this.combo > 0) { this.combo = 0; this.emit({ t: 'combo', combo: 0, mult: 1 }); }

    // 플레이어 이동
    p.x += (p.targetX - p.x) * 0.25; p.y += (p.targetY - p.y) * 0.25;
    p.x = Math.max(PLAYER.minX, Math.min(PLAYER.maxX, p.x));
    p.y = Math.max(PLAYER.minY, Math.min(PLAYER.maxY, p.y));

    this.updateHazards();
    this.updateWeapons(inp.fire);
    this.updateBullets();
    this.updateMissiles();
    this.updateBombField();
    if (!this.timeStopped || this.stagePhase === 'BOSS_DYING' || this.stagePhase === 'CLEAR') this.updateStagePhase();   // 시간 정지 중에도 보스 폭발·클리어 연출은 계속 진행
    if (this.boss) this.updateBoss();
    if (this.midBoss) this.updateMidBoss();
    this.updateEnemyBullets();
    this.updateEnemies();
    this.updateItems();
    this.updateGems();
    this.checkLevelUp();
  }

  private updateAegis(): void {
    const p = this.player, sec = this.stats.aegisSeconds;
    if (sec <= 0 || p.shield > 0) return;
    if (p.aegisTimer <= 0) p.aegisTimer = sec * 60;
    if (--p.aegisTimer <= 0) { p.shield = 1; p.aegisTimer = sec * 60; this.emit({ t: 'ring', x: p.x, y: p.y, color: '#22d3ee', max: 60 }); }
  }

  private updateCompanions(): void {
    for (const c of [this.comp.cat, this.comp.dog]) if (c.active && --c.timer <= 0) { c.active = false; c.timer = 0; }
  }

  // ---------------------------------------------------------------------
  // 스킬 버튼: 동료 / 궁극기
  // ---------------------------------------------------------------------
  private canUseSkill(): boolean {
    return this.state === 'PLAYING' && this.stagePhase !== 'BOSS_DYING' && this.stagePhase !== 'CLEAR';
  }
  activateSkill(key: SkillKey): void {
    if (!this.canUseSkill()) return;
    const p = this.player;
    if (key === 'cat' || key === 'dog') {
      const c = this.comp[key];
      if (!c.ready || c.active || c.used) return;
      c.ready = false; c.active = true; c.used = true; c.timer = COMPANION_FRAMES;
      this.emit({ t: 'skill', key }); this.emit({ t: 'sfx', name: 'item' });
      this.boom(p.x, p.y, key === 'cat' ? '#fb7185' : '#fb923c', 14);
    } else if (key === 'ult') {
      if (!this.ultReady) return;
      this.ult.gauge = 0; this.ult.phase = 'CUTIN'; this.ult.t = 0;
      this.emit({ t: 'skill', key: 'ult' }); this.emit({ t: 'ult', phase: 'CUTIN' });
    }
  }

  private stepUltCinematic(): void {
    const u = this.ult;
    u.t++;
    if (u.phase === 'CUTIN' && u.t >= ULT_KIND[u.kind].cutin) {
      if (u.kind === 'palm') { u.phase = 'FALL'; u.t = 0; this.emit({ t: 'ult', phase: 'FALL' }); }
      else { u.phase = 'ACTIVE'; u.t = 0; this.startUltActive(); this.emit({ t: 'ult', phase: 'ACTIVE' }); }
    } else if (u.phase === 'FALL' && u.t >= ULT.frames.FALL) {
      u.phase = 'IMPACT'; u.t = 0;
      this.applyUltDamage();
      this.emit({ t: 'ult', phase: 'IMPACT' });
    }
  }

  /** 언니(미사일 포격)/동생(시간 정지) 궁극기가 컷인 직후 시작될 때 */
  private startUltActive(): void {
    const p = this.player, u = this.ult;
    this.vacuum = Math.max(this.vacuum, 60);
    if (u.kind === 'barrage') {
      this.enemyBullets.length = 0;
      p.invincible = Math.max(p.invincible, ULT_KIND.barrage.invincible);
      this.emit({ t: 'shake', v: 14 }); this.emit({ t: 'flash', kind: 'bomb', v: 0.6 }); this.emit({ t: 'vibrate', pattern: [90, 40, 140] });
    } else if (u.kind === 'timestop') {
      p.invincible = Math.max(p.invincible, ULT_KIND.timestop.active);
      for (let i = this.enemyBullets.length - 1; i >= 0; i--) if (Math.hypot(this.enemyBullets[i].x - p.x, this.enemyBullets[i].y - p.y) < 90) this.enemyBullets.splice(i, 1);   // 정지된 탄에 끼지 않도록 주변 탄 제거
      this.emit({ t: 'shake', v: 6 }); this.emit({ t: 'flash', kind: 'respawn', v: 0.5 });
    }
  }

  /** ACTIVE 단계 매 틱: 미사일 포격은 화면 위에서 미사일을 쏟아붓는다. 끝나면 IDLE */
  private runUltActive(): void {
    const u = this.ult, k = ULT_KIND[u.kind];
    if (u.kind === 'palm') return;
    u.t++;
    if (u.kind === 'barrage' && u.t % ULT_KIND.barrage.interval === 0 && this.missiles.length < 140) {
      for (let i = 0; i < 2; i++) {
        const x = 20 + this.rng() * (W - 40);
        this.missiles.push({ x, y: -12, vx: (this.rng() - 0.5) * 2, vy: 8, speed: 9, dmg: ULT_KIND.barrage.dmg * this.stats.dmgMult });
      }
      if (u.t % 9 === 0) this.emit({ t: 'sfx', name: 'missile' });
    }
    if ('active' in k && u.t >= k.active) { u.phase = 'IDLE'; u.t = 0; this.emit({ t: 'ult', phase: 'IDLE' }); }
  }

  /** 손바닥이 닿는 순간: 모든 적 총알 제거 + 화면의 적/중간보스 최대 체력의 50%, 보스 30% */
  private applyUltDamage(): void {
    const p = this.player;
    this.enemyBullets.length = 0;
    for (const e of this.enemies) if (e.y >= 0) e.hp -= Math.max(1, Math.ceil(ULT.enemyPct * e.maxHp));
    if (this.midBoss && !this.midBoss.dying) {
      this.midBoss.hp -= Math.ceil(ULT.enemyPct * this.midBoss.maxHp);
      this.midBoss.state = 'MOVE'; this.midBoss.stateTimer = 0;   // 레이저 중단
    }
    if (this.boss && !this.boss.dying) this.boss.hp -= Math.ceil(ULT.bossPct * this.boss.maxHp);
    p.invincible = Math.max(p.invincible, ULT.frames.IMPACT);
    this.vacuum = 90;
    this.emit({ t: 'shake', v: 24 }); this.emit({ t: 'flash', kind: 'bomb', v: 1 }); this.emit({ t: 'vibrate', pattern: [120, 60, 200] });
  }

  // ---------------------------------------------------------------------
  // 무기: 기본 대포 + 모듈(산탄/관통/유도/드론/레이저) + 융합
  // ---------------------------------------------------------------------
  private mkBullet(x: number, y: number, vx: number, vy: number, dmg: number, pierce: number, homing = false): Bullet {
    return { x, y, vx, vy, dmg, pierce, homing };
  }

  private updateWeapons(wantFire: boolean): void {
    const p = this.player, st = this.stats;
    if (this.fireCd > 0) this.fireCd--;
    if (this.missileCd > 0) this.missileCd--;
    if (this.droneCd > 0) this.droneCd--;
    if (this.droneMissileCd > 0) this.droneMissileCd--;

    const od = st.overdrive && this.combo >= 5;   // 오버클럭 융합: 콤보 중에는 더 빠르고 강하게
    const baseDmg = st.dmgMult * (1 + 0.15 * st.pierce) * (this.timeStopped ? ULT_KIND.timestop.boost : 1) * (od ? 1.2 : 1);
    const pierceN = st.pierce + (st.railgun ? 2 : 0);

    if (wantFire && this.fireCd <= 0) {
      this.fireCd = Math.max(3, Math.round(8 / (st.rateMult * (od ? 1.35 : 1))));
      this.emit({ t: 'muzzle' }); this.emit({ t: 'sfx', name: 'laser' });
      const b = (dx: number, dy: number, vx: number) => this.bullets.push(this.mkBullet(p.x + dx, p.y + dy, vx, -13, baseDmg, pierceN));
      switch (this.weaponLevel) {
        case 1: b(-18, -25, 0); b(18, -25, 0); break;
        case 2: b(-22, -20, -1); b(0, -36, 0); b(22, -20, 1); break;
        case 3: b(-26, -18, -2.5); b(-12, -30, 0); b(12, -30, 0); b(26, -18, 2.5); break;
        case 4: b(-30, -16, -3); b(-15, -28, -1); b(0, -36, 0); b(15, -28, 1); b(30, -16, 3); break;
        default: b(-32, -14, -3.4); b(-19, -26, -1.5); b(-6, -34, 0); b(6, -34, 0); b(19, -26, 1.5); b(32, -14, 3.4); break;
      }
      // 산탄 모듈: 옆으로 퍼지는 보조탄
      const sdmg = (st.swarm ? 0.84 : 0.6) * st.dmgMult;
      for (let k = 1; k <= st.spread; k++) {
        const vx = 2.4 * k;
        this.bullets.push(this.mkBullet(p.x - 14, p.y - 20, -vx, -12.4, sdmg, st.pierce > 0 ? 1 : 0, st.swarm));
        this.bullets.push(this.mkBullet(p.x + 14, p.y - 20, vx, -12.4, sdmg, st.pierce > 0 ? 1 : 0, st.swarm));
      }
    }

    // 유도 미사일: 모듈(상시) 또는 M 아이템(일정 시간, 최대 단계 주기)
    if (this.hasHomingMissile) { this.missileTimer--; if (this.missileTimer <= 0) this.hasHomingMissile = false; }
    const homingLv = Math.max(st.homing, this.hasHomingMissile ? 4 : 0);
    if (homingLv > 0 && wantFire && this.missileCd <= 0) {
      this.missileCd = MISSILE_CD[homingLv];
      this.emit({ t: 'sfx', name: 'missile' });
      this.missiles.push({ x: p.x - 26, y: p.y, vx: -3, vy: -5, speed: 7.5, dmg: 2.2 * st.dmgMult });
      this.missiles.push({ x: p.x + 26, y: p.y, vx: 3, vy: -5, speed: 7.5, dmg: 2.2 * st.dmgMult });
    }

    // 드론: 기체 주위를 돌며 함께 사격 (헌터 융합: 유도 미사일도 발사)
    if (st.drones > 0 && wantFire) {
      const ds = this.dronePositions();
      if (this.droneCd <= 0) {
        this.droneCd = 18;
        for (const d of ds) this.bullets.push(this.mkBullet(d.x, d.y - 8, 0, -12, 0.6 * st.dmgMult, 0));
      }
      if (st.hunter && this.droneMissileCd <= 0) {
        this.droneMissileCd = 70;
        const d = ds[Math.floor(this.rng() * ds.length)];
        this.missiles.push({ x: d.x, y: d.y, vx: d.x < p.x ? -2 : 2, vy: -5, speed: 7.5, dmg: 1.8 * st.dmgMult });
      }
    }

    // 레이저: 사격 중 전방 관통 빔 (5프레임마다 피해)
    this.laser.on = false;
    if (st.laser > 0 && wantFire) {
      const offs = st.prism ? [-38, 0, 38] : [0];
      const w = (10 + 3 * st.laser) * (st.railgun ? 2.2 : 1) * (st.prism ? 0.8 : 1);
      this.laser.on = true; this.laser.x = p.x; this.laser.w = w; this.laser.offs = offs;
      if (this.frame % 5 === 0) for (const o of offs) this.laserTick(w, (0.7 + 0.35 * st.laser) * st.dmgMult * (st.railgun ? 2 : 1) * (od ? 1.2 : 1), o);
    }
  }

  private laserTick(w: number, dmg: number, off = 0): void {
    const p = this.player, lx = p.x + off;
    for (const e of this.enemies) {
      if (e.y < p.y && e.y >= ON_SCREEN_Y && Math.abs(e.x - lx) < w / 2 + ENEMY_DEFS[e.type].hitR * 0.6) this.damageEnemy(e, dmg);
    }
    const b = this.boss;
    if (b && !b.dying && b.y > 20 && b.y < p.y && Math.abs(b.x - lx) < w / 2 + b.width / 2) { this.damageBoss(dmg); this.emit({ t: 'hitspark', x: lx, y: b.y + b.height / 2 }); }
    const m = this.midBoss;
    if (m && !m.dying && m.y > 20 && m.y < p.y && Math.abs(m.x - lx) < w / 2 + m.width / 2) { this.damageMid(dmg); this.emit({ t: 'hitspark', x: lx, y: m.y + m.height / 2 }); }
  }

  // ---- 피해 처리 공통 (흡혈 포함) ----
  private lifesteal(dmg: number): void {
    if (!this.comp.cat.active) return;
    const p = this.player, cap = p.maxEnergy * LIFESTEAL_CAP;
    if (p.energy >= cap) return;
    p.energy = Math.min(cap, p.energy + dmg * LIFESTEAL_RATE);
  }
  private damageEnemy(e: Enemy, dmg: number): void { e.hp -= dmg; this.lifesteal(dmg); }
  private damageBoss(dmg: number): void { const b = this.boss!; if ((b.stun ?? 0) > 0) dmg *= BOSS_SP.stunDmg; b.hp -= dmg; this.lifesteal(dmg); }
  private damageMid(dmg: number): void { this.midBoss!.hp -= dmg; this.lifesteal(dmg); }

  private steer(b: Bullet, turnMax: number): void {
    const sp = Math.hypot(b.vx, b.vy) || 13, cur = Math.atan2(b.vy, b.vx);
    let target: { x: number; y: number } | null = null, best = Infinity;
    const diff = (tg: { x: number; y: number }) => {
      let d = Math.atan2(tg.y - b.y, tg.x - b.x) - cur;
      while (d < -Math.PI) d += Math.PI * 2;
      while (d > Math.PI) d -= Math.PI * 2;
      return d;
    };
    const consider = (tg: { x: number; y: number }) => {
      const d = Math.hypot(tg.x - b.x, tg.y - b.y);
      if (d < best && Math.abs(diff(tg)) < 1.4) { best = d; target = tg; }
    };
    for (const e of this.enemies) if (e.hp > 0 && e.y >= ON_SCREEN_Y) consider(e);
    if (this.boss && !this.boss.dying) consider(this.boss);
    if (this.midBoss && !this.midBoss.dying) consider(this.midBoss);
    if (!target) return;
    const turn = Math.max(-turnMax, Math.min(turnMax, diff(target)));
    b.vx = Math.cos(cur + turn) * sp; b.vy = Math.sin(cur + turn) * sp;
  }

  private updateBullets(): void {
    const catOn = this.comp.cat.active;
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      if (catOn || b.homing) this.steer(b, catOn ? 0.22 : 0.12);
      b.x += b.vx; b.y += b.vy;
      if (b.y < -15 || b.x < -10 || b.x > W + 10) this.bullets.splice(i, 1);
    }
  }

  private updateMissiles(): void {
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      let target: { x: number; y: number } | null = this.boss && !this.boss.dying ? this.boss : null;
      if (!target && this.midBoss && !this.midBoss.dying) target = this.midBoss;
      if (!target && this.enemies.length > 0) {
        let minDist = Infinity;
        for (const e of this.enemies) { if (e.y < ON_SCREEN_Y) continue; const d = Math.hypot(e.x - m.x, e.y - m.y); if (d < minDist) { minDist = d; target = e; } }
      }
      if (target) {
        const desired = Math.atan2(target.y - m.y, target.x - m.x), current = Math.atan2(m.vy, m.vx);
        let diff = desired - current;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        const na = current + diff * 0.14;
        m.vx = Math.cos(na) * m.speed; m.vy = Math.sin(na) * m.speed;
      }
      m.x += m.vx; m.y += m.vy;
      if (m.y < -30 || m.y > H + 30 || m.x < -30 || m.x > W + 30) this.missiles.splice(i, 1);
    }
  }

  // ---------------------------------------------------------------------
  // 스테이지 진행: 전투(+중간보스) → 경고 → 보스 → 폭발 → 클리어 → 다음 스테이지 도입
  // ---------------------------------------------------------------------
  private updateStagePhase(): void {
    switch (this.stagePhase) {
      case 'FIGHT': {
        this.stageFrames++;
        const mc = MID_CONFIGS[this.stageTier], dur = FIGHT_FRAMES[this.stageTier];
        if (mc && !this.midDone && !this.midBoss && !this.boss && this.stageFrames >= dur * MID_BOSS_AT) {
          this.spawnMidBoss(this.stageTier);
        } else if (!this.boss && !this.midBoss && this.stageFrames >= dur) {
          this.stagePhase = 'WARNING'; this.phaseTimer = PHASE_FRAMES.WARNING;
        }
        break;
      }
      case 'WARNING':
        if (--this.phaseTimer <= 0) { this.spawnBoss(this.stageTier); this.stagePhase = 'BOSS'; }
        break;
      case 'BOSS_DYING':
        if (--this.phaseTimer <= 0) {
          if (this.boss) {
            this.boom(this.boss.x, this.boss.y, '#ffffff', 40);
            this.boom(this.boss.x, this.boss.y, this.boss.subColor, 50);
            this.spawnGems(this.boss.x, this.boss.y, 120, 14);
          }
          this.vacuum = 150;
          this.emit({ t: 'sfx', name: 'boom' }); this.emit({ t: 'flash', kind: 'bossDeath', v: 0.9 });
          this.boss = null; this.stagePhase = 'CLEAR'; this.phaseTimer = PHASE_FRAMES.CLEAR;
        }
        break;
      case 'CLEAR':
        if (--this.phaseTimer <= 0) {
          if (this.bossTier >= MAX_TIER && !this.endless) { this.state = 'GAMECLEAR'; this.emit({ t: 'gameclear' }); }
          else this.beginNextStage();
        }
        break;
      case 'INTRO':
        if (--this.phaseTimer <= 0) this.stagePhase = 'FIGHT';
        break;
      default: break;
    }
  }

  /** GAMECLEAR 이후 '무한 모드 계속'을 고른 경우: 다음 스테이지(6~)로 이어서 진행 */
  startEndless(): void {
    if (this.state !== 'GAMECLEAR') return;
    this.state = 'PLAYING'; this.endless = true;
    this.enemyBullets.length = 0;
    this.player.invincible = Math.max(this.player.invincible, 150);
    this.beginNextStage();
  }

  private beginNextStage(): void {
    this.bossTier++;
    this.stageFrames = 0;
    this.stagePhase = 'INTRO'; this.phaseTimer = PHASE_FRAMES.INTRO;
    this.midDone = false; this.stageHits = 0; this.stageRank = null;
    for (const c of [this.comp.cat, this.comp.dog]) { c.used = false; c.pity = 0; }   // 동료는 스테이지마다 다시 사용 가능
  }

  private spawnBoss(tier: number): void {
    const c = BOSS_CONFIGS[tier], loop = this.loopCount;
    const hp = Math.round(c.hp * (1 + 0.5 * loop));   // 무한 모드 루프마다 +50%
    this.boss = {
      tier, name: c.name.replace(/STAGE \d+/, 'STAGE ' + this.bossTier), x: W / 2, y: -120, targetY: 135, width: c.w, height: c.h,
      vx: 2.3 + tier * 0.25, hp, maxHp: hp, shootCooldown: 0, attackMode: 1,
      color: c.color, subColor: c.subColor, shotCdMax: Math.max(12, Math.round(c.shotCd * (1 - 0.04 * loop) * this.meta.mut.bossShot)),
      phase2: false, phase2Alert: 0, dying: false, deathTimer: 0,
      spCd: Math.round(BOSS_SP.cd[0] * 0.6), spIdx: 0,
    };
  }

  // ---------------------------------------------------------------------
  private updateBoss(): void {
    const b = this.boss!;
    const p = this.player;

    if (!b.dying && !b.phase2 && b.hp <= b.maxHp * 0.5) {
      b.phase2 = true; b.phase2Alert = 80;
      b.shotCdMax = Math.max(16, Math.round(b.shotCdMax * 0.74));   // 공격 주기 26% 가속
      b.vx = (b.vx > 0 ? 1 : -1) * Math.abs(b.vx) * 1.3;            // 이동 속도 30% 증속
      this.emit({ t: 'sfx', name: 'enrage' });
      this.boom(b.x, b.y, '#ef4444', 35);
      this.emit({ t: 'flash', kind: 'enrage', v: 0.5 });
      this.emit({ t: 'shake', v: 10 }); this.emit({ t: 'vibrate', pattern: 150 });
      this.emit({ t: 'ring', x: b.x, y: b.y, color: '#ef4444', max: 120 });
    }
    if (!b.dying && b.tier === 5 && b.phase2 && !b.phase3 && b.hp <= b.maxHp * 0.2) {   // 최종 보스 3페이즈
      b.phase3 = true; b.phase3Alert = 100;
      b.shotCdMax = Math.max(14, Math.round(b.shotCdMax * 0.8));
      b.vx = (b.vx > 0 ? 1 : -1) * Math.abs(b.vx) * 1.2;
      this.enemyBullets.length = 0;                                  // 페이즈 전환 순간에는 탄을 지워 준다
      this.emit({ t: 'sfx', name: 'enrage' }); this.emit({ t: 'flash', kind: 'enrage', v: 0.8 });
      this.emit({ t: 'shake', v: 16 }); this.emit({ t: 'vibrate', pattern: [120, 60, 200] });
      this.boom(b.x, b.y, '#e879f9', 40); this.emit({ t: 'ring', x: b.x, y: b.y, color: '#e879f9', max: 200 });
    }
    if (b.phase2Alert > 0) b.phase2Alert--;
    if (b.phase3Alert && b.phase3Alert > 0) b.phase3Alert--;

    if (b.dying) {
      // 폭발 중: 이동·공격 정지, 기체 위에서 연쇄 폭발
      b.deathTimer++;
      if (b.deathTimer % 5 === 0) {
        this.boom(b.x + (this.rng() - 0.5) * b.width * 0.9, b.y + (this.rng() - 0.5) * b.height * 0.9,
          this.rng() < 0.5 ? b.subColor : '#f59e0b', 10);
      }
      if (b.deathTimer % 16 === 1) this.emit({ t: 'sfx', name: 'boom' });
    } else if (this.timeStopped) {
      // 시간 정지 중: 이동·공격 정지
    } else if (b.sp) {
      this.updateBossSpecial(b);
    } else if ((b.stun ?? 0) > 0) {
      b.stun!--;                                   // 그로기: 제자리에서 멈춘다
    } else if (b.y < b.targetY) {
      b.y += 1.5;
    } else {
      if (this.startBossSpecialIfReady(b)) { /* 이번 틱은 특수 공격 시작 */ } else {
      b.x += b.vx;
      if (b.x < b.width / 2 + 10 || b.x > W - b.width / 2 - 10) b.vx *= -1;
      b.shootCooldown++;
      if (b.shootCooldown > b.shotCdMax) {
        b.shootCooldown = 0;
        b.attackMode = b.attackMode === 1 ? 2 : 1;
        fireBossPattern(b, { player: p, frame: this.frame, emit: eb => this.enemyBullets.push(eb) });
      }
      }
    }

    if (!b.dying) {
      for (let j = this.bullets.length - 1; j >= 0 && b.y > 20; j--) {   // 화면 밖에서 진입 중인 보스는 피격되지 않음
        const bl = this.bullets[j];
        if (bl.hits?.includes(b)) continue;
        if (Math.hypot(bl.x - b.x, bl.y - b.y) < b.width / 2) {
          this.damageBoss(bl.dmg);
          this.boom(bl.x, bl.y, '#f59e0b', 3);
          this.emit({ t: 'hitspark', x: bl.x, y: bl.y });
          if (bl.pierce > 0) { (bl.hits ??= []).push(b); bl.pierce--; } else this.bullets.splice(j, 1);
        }
      }
      for (let m = this.missiles.length - 1; m >= 0; m--) {
        const ms = this.missiles[m];
        if (Math.hypot(ms.x - b.x, ms.y - b.y) < b.width / 2) {
          this.missiles.splice(m, 1); this.damageBoss(ms.dmg);
          this.emit({ t: 'sfx', name: 'boom' }); this.boom(ms.x, ms.y, '#ec4899', 10); this.emit({ t: 'missileHit', x: ms.x, y: ms.y, kill: false });
        }
      }
      if (Math.hypot(p.x - b.x, p.y - b.y) < b.width / 2 + 10) this.applyDamage(50);
    }

    // 체력이 0이 되어도 바로 사라지지 않고 '폭발 연출 → 클리어 → 다음 스테이지' 순서로 이어짐
    if (!b.dying && b.hp <= 0) {
      b.dying = true; b.deathTimer = 0; b.hp = 0; b.phase2Alert = 0; b.phase3Alert = 0; b.sp = undefined; b.stun = 0;
      this.stagePhase = 'BOSS_DYING'; this.phaseTimer = PHASE_FRAMES.BOSS_DYING;
      const { rank, bonus } = rankFor(this.stageHits);
      this.stageRank = rank;
      this.clearBonus = 200 * this.bossTier + bonus; this.score += this.clearBonus;   // 무한 모드에서는 루프가 돌수록 보너스도 커진다
      this.ult.gauge = Math.min(100, this.ult.gauge + ULT.gaugeBoss);
      // 「자매의 손바닥」: 3번째 보스를 목숨 2개 이상 유지한 채 처치하면 게이지가 가득 찬다
      if (b.tier === 3 && this.loopCount === 0 && this.lives >= 2 && this.ult.gauge < 100) { this.ult.gauge = 100; this.emit({ t: 'sfx', name: 'heal' }); }
      this.emit({ t: 'sfx', name: 'boom' }); this.boom(b.x, b.y, b.subColor, 30);
      this.emit({ t: 'shake', v: 14 }); this.emit({ t: 'hitstop', frames: 8 }); this.emit({ t: 'vibrate', pattern: [100, 50, 220] });
      this.emit({ t: 'ring', x: b.x, y: b.y, color: '#ffffff', max: 160 });
      this.emit({ t: 'ring', x: b.x, y: b.y, color: b.subColor, max: 110 });
      this.enemyBullets.length = 0;                                   // 남은 탄막 제거
      for (const e of this.enemies) e.hp = 0;                         // 잔여 적기 정리
      for (const ms of this.missiles) this.boom(ms.x, ms.y, '#ec4899', 6);
      this.missiles.length = 0;
    }
  }

  /** 특수 공격 간격이 끝나면 시작한다 (레이저는 플레이어 x로 미끄러지며 예고, 돌진은 그 x의 레인을 예고) */
  private startBossSpecialIfReady(b: Boss): boolean {
    const list = BOSS_SPECIALS[b.tier];
    if (!list) return false;
    if ((b.spCd = (b.spCd ?? 0) - 1) > 0) return false;
    const idx = b.spIdx ?? 0; b.spIdx = idx + 1;
    const kind = list[idx % list.length];
    const half = b.width / 2 + 10;
    b.sp = { kind, state: 'WARN', t: 0, lockX: Math.max(half, Math.min(W - half, this.player.x)), beams: b.phase2 || b.phase3 ? [-BOSS_SP.tripleOff, 0, BOSS_SP.tripleOff] : [0] };
    b.shootCooldown = 0;
    this.emit({ t: 'sfx', name: 'laserCharge' });
    return true;
  }

  private updateBossSpecial(b: Boss): void {
    const sp = b.sp!, p = this.player;
    const cdIdx = b.phase3 ? 2 : b.phase2 ? 1 : 0;
    const finish = () => {
      b.sp = undefined; b.spCd = Math.round(BOSS_SP.cd[cdIdx] * (1 - 0.05 * this.loopCount)); b.shootCooldown = 0;
      b.stun = Math.round(BOSS_SP.stun * (b.phase3 ? 0.8 : 1));   // 약점 노출
      this.enemyBullets.length = 0;
      this.emit({ t: 'ring', x: b.x, y: b.y, color: '#fde047', max: 130 }); this.emit({ t: 'sfx', name: 'item' });
    };
    sp.t++;
    if (sp.kind === 'laser') {
      if (sp.state === 'WARN') {
        b.x += Math.max(-6, Math.min(6, (sp.lockX - b.x) * 0.07));   // 조준 위치로 미끄러지며 예고선이 보스 앞에서 곧게 내려온다
        if (sp.t >= BOSS_SP.laserWarn) { sp.state = 'ACT'; sp.t = 0; this.emit({ t: 'sfx', name: 'laserBeam' }); this.emit({ t: 'shake', v: 9 }); }
      } else {
        if (sp.beams.some(o => Math.abs(p.x - (b.x + o)) < BOSS_SP.laserHalf + p.radius * 0.5) && p.y > b.y) this.applyDamage(BOSS_SP.laserDmg);
        if (sp.t >= BOSS_SP.laserAct) finish();
      }
      return;
    }
    // 돌진
    if (sp.state === 'WARN') {
      b.x += Math.max(-7, Math.min(7, (sp.lockX - b.x) * 0.09));
      if (sp.t >= BOSS_SP.chargeWarn) { sp.state = 'ACT'; sp.t = 0; this.emit({ t: 'sfx', name: 'laserBeam' }); }
    } else if (sp.state === 'ACT') {
      b.y += Math.min(BOSS_SP.dashMax, 4 + sp.t * 0.9);
      if (b.y >= H - b.height * 0.35) {   // 바닥 충돌: 충격파 + 탄 고리
        b.y = H - b.height * 0.35; sp.state = 'RET'; sp.t = 0;
        this.emit({ t: 'shake', v: 16 }); this.emit({ t: 'hitstop', frames: 4 }); this.emit({ t: 'sfx', name: 'boom' });
        this.emit({ t: 'ring', x: b.x, y: b.y, color: b.subColor, max: 160 }); this.boom(b.x, b.y + b.height * 0.3, '#f59e0b', 22);
        const n = 14;
        for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; this.enemyBullets.push({ x: b.x, y: b.y, vx: Math.sin(a) * 3.2, vy: Math.cos(a) * 3.2, color: b.subColor, r: 5 }); }
      }
    } else {
      b.y -= BOSS_SP.retSpeed;
      if (b.y <= b.targetY) { b.y = b.targetY; finish(); }
    }
  }

  // ---------------------------------------------------------------------
  // 중간보스: 좌우 이동 + 부채꼴 사격, 주기적으로 레이저(예고선 → 발사)
  // ---------------------------------------------------------------------
  private spawnMidBoss(tier: number): void {
    const c = MID_CONFIGS[tier];
    const hp = Math.round(c.hp * (1 + 0.5 * this.loopCount));
    this.midDone = true;
    this.midBoss = {
      tier, x: W / 2, y: -80, targetY: 120, width: c.w, height: c.h, vx: 1.8 + tier * 0.2,
      hp, maxHp: hp, shootCd: 0, state: 'MOVE', stateTimer: 0, lockX: W / 2, laserX: W / 2, dying: false, deathTimer: 0,
    };
    this.emit({ t: 'sfx', name: 'enrage' }); this.emit({ t: 'shake', v: 6 });
  }

  private updateMidBoss(): void {
    const m = this.midBoss!, p = this.player, c = MID_CONFIGS[m.tier];

    if (m.dying) {
      m.deathTimer++;
      if (m.deathTimer % 6 === 0) this.boom(m.x + (this.rng() - 0.5) * m.width, m.y + (this.rng() - 0.5) * m.height, this.rng() < 0.5 ? c.color : '#f59e0b', 8);
      if (m.deathTimer === 1) this.emit({ t: 'sfx', name: 'boom' });
      if (m.deathTimer >= 60) {
        this.boom(m.x, m.y, '#ffffff', 30); this.boom(m.x, m.y, c.color, 30);
        this.emit({ t: 'sfx', name: 'boom' }); this.emit({ t: 'ring', x: m.x, y: m.y, color: c.color, max: 100 });
        this.items.push({ x: m.x, y: m.y, type: 'L' });    // 중간보스 처치 보상: 목숨
        this.spawnGems(m.x, m.y, 60, 8);
        this.midBoss = null;
      }
      return;
    }

    if (this.timeStopped) {
      // 시간 정지 중: 이동·공격 정지
    } else if (m.y < m.targetY) {
      m.y += 2;
    } else if (m.state === 'MOVE') {
      m.x += m.vx;
      if (m.x < m.width / 2 + 10 || m.x > W - m.width / 2 - 10) m.vx *= -1;
      if (++m.shootCd > 75) {
        m.shootCd = 0;
        const offs = c.fanCount === 3 ? [-0.3, 0, 0.3] : [-0.5, -0.25, 0, 0.25, 0.5];
        const base = Math.atan2(p.x - m.x, p.y - m.y) * 0.5;   // 플레이어 쪽으로 살짝 치우친 부채꼴
        for (const o of offs) {
          this.enemyBullets.push({ x: m.x, y: m.y + 36, vx: Math.sin(base + o) * c.fanSpeed, vy: Math.cos(base + o) * c.fanSpeed, color: c.color, r: 5 });
        }
      }
      if (++m.stateTimer > 300) { m.state = 'CHARGE'; m.stateTimer = 0; this.emit({ t: 'sfx', name: 'laserCharge' }); m.lockX = Math.max(m.width / 2 + 10, Math.min(W - m.width / 2 - 10, p.x)); m.laserX = m.x; }   // 조준 위치는 이 시점의 플레이어 x로 고정
    } else if (m.state === 'CHARGE') {
      // 보스가 조준 위치로 미끄러져 가고, 예고선은 보스 코에서 곧게 내려온다 (1.2초 — 보고 피할 수 있어야 공정)
      m.x += Math.max(-6, Math.min(6, (m.lockX - m.x) * 0.07)); m.laserX = m.x;
      if (++m.stateTimer >= 70) { m.state = 'FIRE'; m.stateTimer = 0; m.laserX = m.x; this.emit({ t: 'sfx', name: 'laserBeam' }); this.emit({ t: 'shake', v: 8 }); }
    } else {
      m.stateTimer++; m.laserX = m.x;
      if (Math.abs(p.x - m.laserX) < 34 + p.radius * 0.5 && p.y > m.y) this.applyDamage(40);
      if (m.stateTimer >= 45) { m.state = 'MOVE'; m.stateTimer = 0; m.shootCd = 0; }
    }

    // 피격
    for (let j = this.bullets.length - 1; j >= 0; j--) {
      const bl = this.bullets[j];
      if (bl.hits?.includes(m)) continue;
      if (Math.hypot(bl.x - m.x, bl.y - m.y) < m.width / 2) {
        this.damageMid(bl.dmg); this.boom(bl.x, bl.y, '#f59e0b', 2); this.emit({ t: 'hitspark', x: bl.x, y: bl.y });
        if (bl.pierce > 0) { (bl.hits ??= []).push(m); bl.pierce--; } else this.bullets.splice(j, 1);
      }
    }
    for (let k = this.missiles.length - 1; k >= 0; k--) {
      const ms = this.missiles[k];
      if (Math.hypot(ms.x - m.x, ms.y - m.y) < m.width / 2) { this.missiles.splice(k, 1); this.damageMid(ms.dmg); this.emit({ t: 'sfx', name: 'boom' }); this.boom(ms.x, ms.y, '#ec4899', 8); this.emit({ t: 'missileHit', x: ms.x, y: ms.y, kill: false }); }
    }
    if (Math.hypot(p.x - m.x, p.y - m.y) < m.width / 2 + 10) this.applyDamage(40);

    if (m.hp <= 0) {
      m.dying = true; m.deathTimer = 0; m.hp = 0;
      this.score += 150;
      this.ult.gauge = Math.min(100, this.ult.gauge + ULT.gaugeMidBoss);
      this.enemyBullets.length = 0;
      this.emit({ t: 'shake', v: 10 }); this.emit({ t: 'hitstop', frames: 5 }); this.emit({ t: 'vibrate', pattern: [60, 40, 120] });
    }
  }

  // ---------------------------------------------------------------------
  get windForce(): number { return this.windT > 0 ? this.windDir * HAZARD.windBullet : 0; }

  /** 스테이지 장애물: 일반 전투 구간에서만 나온다 (중간보스·보스·시간 정지 중에는 멈추거나 사라진다) */
  private updateHazards(): void {
    const def = HAZARDS[this.stageTier];
    if (!def || this.stagePhase !== 'FIGHT' || this.midBoss) {
      this.hazards.length = 0; this.windT = 0; this.windWarn = 0; this.hazCd = {};
      return;
    }
    if (this.timeStopped) return;
    const p = this.player, loop = 12 * this.loopCount;
    for (const kind of ['meteor', 'lava', 'wind'] as const) {
      const base = def[kind];
      if (!base) continue;
      const interval = Math.max(80, base - loop);
      const cd = this.hazCd[kind] ?? (HAZARD.grace + interval);
      if (this.stageFrames < 1) { this.hazCd[kind] = cd; continue; }
      if (cd > 0) { this.hazCd[kind] = cd - 1; continue; }
      this.hazCd[kind] = interval * (0.8 + this.rng() * 0.4);
      if (kind === 'wind') {
        if (this.windT <= 0 && this.windWarn <= 0) { this.windDir = this.rng() < 0.5 ? -1 : 1; this.windWarn = HAZARD.windWarn; }
      } else {
        const x = Math.max(30, Math.min(W - 30, p.x + (this.rng() - 0.5) * 170));
        this.hazards.push(kind === 'meteor'
          ? { kind, x, y: -24, t: 0, warn: HAZARD.meteorWarn, dur: 0 }
          : { kind, x, y: 0, t: 0, warn: HAZARD.lavaWarn, dur: HAZARD.lavaDur });
      }
    }
    if (this.windWarn > 0 && --this.windWarn === 0) this.windT = HAZARD.windDur;
    if (this.windT > 0) {
      this.windT--;
      p.x = Math.max(PLAYER.minX, Math.min(PLAYER.maxX, p.x + this.windDir * HAZARD.windPush));
    }
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      h.t++;
      if (h.kind === 'meteor') {
        if (h.t > h.warn) {
          h.y += HAZARD.meteorSpeed;
          if (!h.hit && Math.hypot(p.x - h.x, p.y - h.y) < p.radius + HAZARD.meteorR) {
            h.hit = true; this.applyDamage(HAZARD.damage);
            this.emit({ t: 'explosion', x: h.x, y: h.y, color: '#fb923c', count: 14 });
          }
          if (h.hit || h.y > H + 30) {
            if (!h.hit) this.emit({ t: 'explosion', x: h.x, y: H - 6, color: '#fb923c', count: 8 });
            this.hazards.splice(i, 1);
          }
        }
      } else {
        if (h.t === h.warn) { this.emit({ t: 'shake', v: 5 }); this.emit({ t: 'sfx', name: 'boom' }); }
        if (h.t > h.warn && !h.hit && Math.abs(p.x - h.x) < HAZARD.lavaHalfW + p.radius * 0.5) { h.hit = true; this.applyDamage(HAZARD.damage); }
        if (h.t >= h.warn + h.dur) this.hazards.splice(i, 1);
      }
    }
  }

  private updateEnemyBullets(): void {
    if (this.timeStopped) return;   // 시간 정지: 적 탄은 허공에 멈춰 있다
    const p = this.player, dogOn = this.comp.dog.active;
    const orbit = this.stats.aegisorbit && this.stats.drones > 0 ? this.dronePositions() : null;   // 아이기스 오빗 융합: 드론이 탄을 막는다
    for (let i = this.enemyBullets.length - 1; i >= 0; i--) {
      if (i >= this.enemyBullets.length) continue;   // applyDamage(리스폰)가 탄을 전부 지운 경우
      const eb = this.enemyBullets[i];
      const sp = this.enemyBulletSpeed;
      eb.x += eb.vx * sp + this.windForce; eb.y += eb.vy * sp;
      const d = Math.hypot(p.x - eb.x, p.y - eb.y);
      if (orbit && orbit.some(d => Math.hypot(d.x - eb.x, d.y - eb.y) < 17 + eb.r)) {
        this.enemyBullets.splice(i, 1);
        if (this.frame % 2 === 0) this.emit({ t: 'explosion', x: eb.x, y: eb.y, color: '#67e8f9', count: 2 });
        continue;
      }
      // 강아지 방어막: 반경 안으로 들어온 탄은 사라진다
      if (dogOn && d < SHIELD_R + eb.r) {
        this.enemyBullets.splice(i, 1);
        if (this.frame % 2 === 0) this.emit({ t: 'explosion', x: eb.x, y: eb.y, color: '#a5f3fc', count: 2 });
        continue;
      }
      if (d < p.radius + eb.r) {
        this.enemyBullets.splice(i, 1);
        this.applyDamage(22);
        continue;
      }
      // 그레이즈: 판정 바로 바깥을 스치면 보너스 (피격 직후 무적 중에는 제외)
      if (!eb.grazed && p.invincible === 0 && d < p.radius + eb.r + GRAZE_MARGIN) {
        eb.grazed = true; this.grazeCount++; this.score += GRAZE_SCORE;
        this.ult.gauge = Math.min(100, this.ult.gauge + ULT.gaugePerGraze);
        this.emit({ t: 'graze', x: eb.x, y: eb.y });
      }
      if (eb.y > H + 20 || eb.x < -20 || eb.x > W + 20 || eb.y < -20) this.enemyBullets.splice(i, 1);
    }
  }

  private pickEnemyType(): EnemyType {
    const w = ENEMY_WEIGHTS[this.stageTier];
    let total = 0;
    for (const k of Object.keys(w) as EnemyType[]) total += w[k] ?? 0;
    let r = this.rng() * total;
    for (const k of Object.keys(w) as EnemyType[]) { r -= w[k] ?? 0; if (r < 0) return k; }
    return 'scout';
  }

  private spawnEnemy(): void {
    const type = this.pickEnemyType();
    const def = ENEMY_DEFS[type];
    const x = this.rng() * (W - 70) + 45;
    const speed = type === 'scout' ? 3.2 + this.rng() * 1.5
      : type === 'zigzag' ? 2.4 + this.rng() * 0.6
      : type === 'kamikaze' ? 4.2 + this.rng() * 1.0 : 2.6;
    const hp = Math.max(1, Math.round(def.hp * enemyHpScale(this.bossTier) * this.meta.mut.enemyHp));
    this.enemies.push({ type, x, y: -30, hp, maxHp: hp, speed: speed * this.meta.mut.enemySpeed, baseX: x, age: 0, fireCd: 50 + this.rng() * 60, hold: 0 });
  }

  private aimedShot(e: Enemy, spd: number, color: string, r: number, spread = 0): void {
    const p = this.player;
    const ang = Math.atan2(p.x - e.x, p.y - e.y) + spread;
    this.enemyBullets.push({ x: e.x, y: e.y + 12, vx: Math.sin(ang) * spd, vy: Math.cos(ang) * spd, color, r });
  }

  private moveEnemy(e: Enemy): void {
    const p = this.player;
    e.age++;
    if (e.flash && e.flash > 0) e.flash--;
    switch (e.type) {
      case 'scout':
        e.y += e.speed;
        if (this.rng() < 0.008) this.enemyBullets.push({ x: e.x, y: e.y + 10, vx: 0, vy: 2.2, color: '#f43f5e', r: 4 });
        break;
      case 'zigzag':
        e.y += e.speed;
        e.x = Math.max(30, Math.min(W - 30, e.baseX + Math.sin(e.age * 0.06) * 80));
        if (--e.fireCd <= 0 && e.y > 40 && e.y < H * 0.55) { this.aimedShot(e, 2.6, '#fb923c', 4); e.fireCd = 95 + this.rng() * 40; }
        break;
      case 'kamikaze':
        e.y += e.speed;
        if (e.y < p.y - 40) e.x += Math.max(-3.2, Math.min(3.2, (p.x - e.x) * 0.035));
        break;
      case 'sniper':
        if (e.y < 150 && e.hold === 0) e.y += e.speed;
        else if (e.hold < 170) {
          e.hold++;
          if (--e.fireCd <= 0) { this.aimedShot(e, 3.0, '#38bdf8', 4.5, -0.12); this.aimedShot(e, 3.0, '#38bdf8', 4.5, 0.12); e.fireCd = 50; }
        } else e.y += e.speed * 1.5;
        if (e.hold === 0 && e.y >= 150) e.hold = 1;
        break;
    }
  }

  private updateEnemies(): void {
    const p = this.player, dogOn = this.comp.dog.active;
    const spawnOk = this.stagePhase === 'FIGHT' || this.stagePhase === 'BOSS' ||
      (this.stagePhase === 'INTRO' && this.phaseTimer < PHASE_FRAMES.INTRO - 50);
    const interval = Math.max(10, Math.round((SPAWN_INTERVAL[this.stageTier] - 2 * this.loopCount) * this.meta.mut.spawn));
    if (spawnOk && !this.timeStopped && this.frame % (this.boss || this.midBoss ? interval * 2 : interval) === 0) this.spawnEnemy();

    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      const def = ENEMY_DEFS[e.type];
      if (!this.timeStopped) this.moveEnemy(e);
      const vulnerable = e.y >= ON_SCREEN_Y;   // 화면에 들어오기 전에는 무적

      for (let j = this.bullets.length - 1; vulnerable && j >= 0; j--) {
        const b = this.bullets[j];
        if (b.hits?.includes(e)) continue;
        if (Math.hypot(b.x - e.x, b.y - e.y) < def.hitR) {
          this.damageEnemy(e, b.dmg); e.flash = 3; e.lastHit = 'bullet'; this.emit({ t: 'hitspark', x: b.x, y: b.y });
          if (b.pierce > 0) { (b.hits ??= []).push(e); b.pierce--; } else { this.bullets.splice(j, 1); break; }
        }
      }
      for (let m = this.missiles.length - 1; vulnerable && m >= 0; m--) {
        const ms = this.missiles[m];
        if (Math.hypot(ms.x - e.x, ms.y - e.y) < def.hitR + 2) {
          this.missiles.splice(m, 1); this.damageEnemy(e, ms.dmg);
          e.flash = 8; e.lastHit = 'missile';
          const dead = e.hp <= 0;
          if (!dead) e.y -= 8;                                   // 미사일에 맞으면 뒤로 밀려난다 (묵직한 타격감)
          this.emit({ t: 'missileHit', x: ms.x, y: ms.y, kill: dead });
          this.missileSplash(ms.x, ms.y, e, ms.dmg * 0.5);       // 폭발 범위 피해: 뭉친 적을 한꺼번에 쓸어버림
          break;
        }
      }
      // 강아지 방어막에 닿은 적은 부서진다
      if (dogOn && e.hp > 0 && Math.hypot(p.x - e.x, p.y - e.y) < SHIELD_R + def.bodyR) e.hp = 0;

      if (e.hp <= 0) {
        this.emit({ t: 'sfx', name: 'boom' }); this.boom(e.x, e.y, '#ef4444', 12);
        const pts = this.killScore(def.score);
        this.emit({ t: 'kill', x: e.x, y: e.y, pts, missile: e.lastHit === 'missile' });
        this.lifesteal(MOB_HIT_VALUE);
        this.ult.gauge = Math.min(100, this.ult.gauge + def.xp * ULT.gaugePerXp);
        this.spawnGems(e.x, e.y, def.xp, Math.max(1, Math.round(def.xp / 4)));
        this.dropItem(e.x, e.y);
        this.enemies.splice(i, 1);
        continue;
      }
      if (Math.hypot(p.x - e.x, p.y - e.y) < p.radius + def.bodyR) {
        this.enemies.splice(i, 1);
        this.applyDamage(e.type === 'kamikaze' ? 45 : 35);
        continue;
      }
      if (e.y > H + 30) this.enemies.splice(i, 1);
    }
  }

  /** 처치 점수: 연속 처치(콤보)에 따라 배율 적용 */
  private killScore(base: number): number {
    this.combo++; this.comboTimer = COMBO_WINDOW;
    this.run.kills++; this.run.maxCombo = Math.max(this.run.maxCombo, this.combo);
    const pts = Math.round(base * comboMultiplier(this.combo) * this.meta.mut.score);
    this.score += pts;
    this.emit({ t: 'combo', combo: this.combo, mult: comboMultiplier(this.combo) });
    return pts;
  }

  /** 미사일 착탄 지점 주변(반경 52)의 다른 적에게 절반 피해 */
  private missileSplash(x: number, y: number, except: Enemy, dmg: number): void {
    for (const o of this.enemies) {
      if (o === except || o.y < ON_SCREEN_Y) continue;
      if (Math.hypot(o.x - x, o.y - y) < 52) { this.damageEnemy(o, dmg); o.flash = 6; o.lastHit = 'missile'; }
    }
  }

  // ---------------------------------------------------------------------
  // 경험치 젬
  // ---------------------------------------------------------------------
  private spawnGems(x: number, y: number, totalXp: number, n: number): void {
    const v = totalXp / n;
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n + this.rng(), r = n > 1 ? 10 + this.rng() * 26 : 0;
      this.gems.push({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, v });
    }
  }

  private updateGems(): void {
    const p = this.player, range = GEM_RANGE * this.stats.magnetMult;
    if (this.vacuum > 0) this.vacuum--;
    for (let i = this.gems.length - 1; i >= 0; i--) {
      const g = this.gems[i];
      const dx = p.x - g.x, dy = p.y - g.y, d = Math.hypot(dx, dy) || 1;
      if (this.vacuum > 0 || d < range) { const sp = this.vacuum > 0 ? 13 : 8 + (range - d) * 0.05; g.x += (dx / d) * sp; g.y += (dy / d) * sp; }
      else g.y += 1.4;
      if (d < p.radius + 10) { this.gems.splice(i, 1); this.addXp(g.v); this.emit({ t: 'gem', x: g.x, y: g.y }); continue; }
      if (g.y > H + 20) this.gems.splice(i, 1);
    }
  }

  // ---------------------------------------------------------------------
  // 아이템
  // ---------------------------------------------------------------------
  private dropItem(x: number, y: number): void {
    if (this.maybeDropCompanion(x, y)) return;
    const luck = this.stats.luckMult * this.meta.luckMult;
    const r = this.rng() / luck;
    let type: ItemType | null = null;
    for (const [cum, t] of DROP_BASE) if (r < cum) { type = t; break; }
    if (!type) { const r2 = this.rng() / luck; for (const [cum, t] of DROP_EXTRA) if (r2 < cum) { type = t; break; } }
    if (type) this.items.push({ x, y, type });
  }

  /** 처치 수가 쌓일수록 동료 아이템 확률이 오른다. 이미 보유/사용 중이거나 화면에 같은 아이템이 있으면 드랍하지 않음 */
  private maybeDropCompanion(x: number, y: number): boolean {
    const defs: [keyof Sim['comp'], ItemType][] = [['cat', 'C'], ['dog', 'D']];
    for (const [key, type] of defs) {
      const c = this.comp[key];
      if (c.ready || c.active || c.used || this.items.some(it => it.type === type)) continue;
      c.pity++;
      if (this.rng() < companionDropChance(c.pity)) { this.items.push({ x, y, type }); return true; }
    }
    return false;
  }

  private updateItems(): void {
    const p = this.player, range = MAGNET_RANGE * this.stats.magnetMult;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      const dx = p.x - it.x, dy = p.y - it.y, dist = Math.hypot(dx, dy);
      if (p.magnet > 0 && dist < range && dist > 1) { it.x += (dx / dist) * 7; it.y += (dy / dist) * 7; }
      else it.y += 2.2;
      if (Math.hypot(p.x - it.x, p.y - it.y) < p.radius + 12) {
        this.collect(it.type);
        this.items.splice(i, 1);
      } else if (it.y > H + 20) this.items.splice(i, 1);
    }
  }

  private collect(type: ItemType): void {
    const p = this.player;
    switch (type) {
      case 'P':
        this.weaponLevel = Math.min(5, this.weaponLevel + 1); this.emit({ t: 'sfx', name: 'item' });
        if (this.weaponLevel >= 5) this.score += 0;
        break;
      case 'M': this.hasHomingMissile = true; this.missileTimer = 500; this.emit({ t: 'sfx', name: 'item' }); break;
      case 'E':
        this.emit({ t: 'sfx', name: 'heal' });
        p.energy = Math.min(p.maxEnergy, p.energy + 30);
        this.boom(p.x, p.y, '#06b6d4', 10);
        break;
      case 'B':
        this.emit({ t: 'sfx', name: 'item' });
        this.bombs = Math.min(this.maxBombs, this.bombs + 1);
        this.boom(p.x, p.y, '#ef4444', 10);
        break;
      case 'G': p.magnet = MAGNET_FRAMES; this.emit({ t: 'sfx', name: 'item' }); this.emit({ t: 'ring', x: p.x, y: p.y, color: '#c084fc', max: MAGNET_RANGE }); break;
      case 'L':
        this.lives = Math.min(MAX_LIVES, this.lives + 1);
        this.emit({ t: 'sfx', name: 'heal' }); this.emit({ t: 'ring', x: p.x, y: p.y, color: '#f43f5e', max: 70 });
        break;
      case 'C': case 'D': {
        const c = this.comp[type === 'C' ? 'cat' : 'dog'];
        this.emit({ t: 'sfx', name: 'item' });
        if (c.ready || c.active || c.used) { this.score += 100; break; }
        c.ready = true; c.pity = 0;
        this.boom(p.x, p.y, type === 'C' ? '#fb7185' : '#fb923c', 12);
        break;
      }
    }
  }

  // ---------------------------------------------------------------------
  // 폭탄 (강화판): 즉시 전체 정리 + 보스 큰 피해 + 퍼져 나가는 폭발장 + 무적
  // ---------------------------------------------------------------------
  fireBomb(): void {
    if (this.bombs <= 0 || this.state !== 'PLAYING') return;
    if (this.pending || this.ult.phase === 'CUTIN' || this.ult.phase === 'FALL') return;   // 카드 선택·궁극기 연출 중 낭비 방지
    if (this.stagePhase === 'BOSS_DYING' || this.stagePhase === 'CLEAR') return;   // 연출 중 폭탄 낭비 방지
    if (this.frame - this.lastBombFrame < 20) return;
    this.lastBombFrame = this.frame;
    this.bombs--;
    const p = this.player;
    p.invincible = Math.max(p.invincible, BOMB.invincibleFrames);
    this.bombT = BOMB.fieldFrames; this.bombX = p.x; this.bombY = p.y;
    this.emit({ t: 'sfx', name: 'boom' }); this.emit({ t: 'flash', kind: 'bomb', v: 1 }); this.emit({ t: 'bomb', x: p.x, y: p.y });
    this.emit({ t: 'shake', v: 22 }); this.emit({ t: 'hitstop', frames: 6 }); this.emit({ t: 'vibrate', pattern: [80, 40, 120] });

    // 화면의 모든 탄은 점수로 변환
    const n = this.enemyBullets.length;
    this.score += n;
    for (let i = 0; i < n; i += 3) this.boom(this.enemyBullets[i].x, this.enemyBullets[i].y, '#fde68a', 1);
    this.enemyBullets.length = 0;
    for (const e of this.enemies) if (e.y >= 0) e.hp = 0;   // 화면 안의 적은 전부 파괴 (처치 점수/드랍/경험치 정상 처리)
    if (this.boss && !this.boss.dying) {
      this.boss.hp -= Math.max(BOMB.minBurst, Math.ceil(this.boss.maxHp * BOMB.bossBurstPct));
      this.boom(this.boss.x, this.boss.y, '#ef4444', 30);
    }
    if (this.midBoss && !this.midBoss.dying) {
      this.midBoss.hp -= Math.max(BOMB.minBurst, Math.ceil(this.midBoss.maxHp * BOMB.bossBurstPct));
      this.boom(this.midBoss.x, this.midBoss.y, '#ef4444', 24);
    }
    this.vacuum = Math.max(this.vacuum, 30);
  }

  /** 폭발장: 퍼져 나가는 동안 탄을 계속 지우고, 범위 안의 적/보스에게 지속 피해 */
  private updateBombField(): void {
    if (this.bombT <= 0) return;
    this.bombT--;
    const k = 1 - this.bombT / BOMB.fieldFrames;
    const radius = BOMB.fieldRadiusMax * Math.sqrt(k);
    for (let i = this.enemyBullets.length - 1; i >= 0; i--) {
      const b = this.enemyBullets[i];
      if (Math.hypot(b.x - this.bombX, b.y - this.bombY) < radius) { this.enemyBullets.splice(i, 1); this.score += 1; }
    }
    for (const e of this.enemies) if (e.y >= 0 && Math.hypot(e.x - this.bombX, e.y - this.bombY) < radius) e.hp -= 1;
    const tick = BOMB.fieldPctTotal / BOMB.fieldFrames;
    if (this.boss && !this.boss.dying && Math.hypot(this.boss.x - this.bombX, this.boss.y - this.bombY) < radius + this.boss.width / 2) this.boss.hp -= this.boss.maxHp * tick;
    if (this.midBoss && !this.midBoss.dying && Math.hypot(this.midBoss.x - this.bombX, this.midBoss.y - this.bombY) < radius + this.midBoss.width / 2) this.midBoss.hp -= this.midBoss.maxHp * tick;
  }

  applyDamage(dmg: number): void {
    const p = this.player;
    if (p.invincible > 0 || this.state !== 'PLAYING') return;
    if (this.stagePhase === 'BOSS_DYING' || this.stagePhase === 'CLEAR') return;   // 전환 연출 중에는 피해 없음

    if (p.shield > 0) {   // 방벽이 피격 1회를 흡수
      p.shield = 0; p.invincible = 30;
      this.emit({ t: 'sfx', name: 'item' }); this.emit({ t: 'ring', x: p.x, y: p.y, color: '#60a5fa', max: 70 });
      this.emit({ t: 'shake', v: 4 });
      return;
    }

    p.energy = Math.max(0, p.energy - dmg);
    p.invincible = 40;
    this.stageHits++; this.run.hits++;
    if (this.combo > 0) { this.combo = 0; this.comboTimer = 0; this.emit({ t: 'combo', combo: 0, mult: 1 }); }
    this.emit({ t: 'sfx', name: 'boom' }); this.boom(p.x, p.y, '#ef4444', 16);
    this.emit({ t: 'shake', v: 10 }); this.emit({ t: 'flash', kind: 'hit', v: 0.45 });
    this.emit({ t: 'hitstop', frames: 4 }); this.emit({ t: 'vibrate', pattern: 60 });

    if (p.energy <= 0) {
      if (this.lives > 0) {
        this.lives--;
        p.energy = p.maxEnergy; p.invincible = 150;
        this.enemyBullets.length = 0;
        this.emit({ t: 'flash', kind: 'respawn', v: 0.6 });
        this.emit({ t: 'sfx', name: 'heal' });
      } else {
        this.state = 'GAMEOVER';
        this.emit({ t: 'gameover' }); this.emit({ t: 'vibrate', pattern: [120, 60, 220] });
      }
    }
  }

  /** 업적 판정용 한 판 기록 */
  runStats(daily = false): RunStats {
    const fusions = FUSION_IDS.filter(id => hasFusion(this.build, id)).length;
    return { score: this.score, bossTier: this.bossTier, cleared: this.state === 'GAMECLEAR' || this.endless, endless: this.endless,
      kills: this.run.kills, maxCombo: this.run.maxCombo, graze: this.grazeCount, hits: this.run.hits, bombs: this.run.bombs, ults: this.run.ults,
      fusions, mutator: this.meta.mutator ?? null, daily };
  }

  /** 현재 빌드에서 융합 카드 보유 여부 (렌더링/HUD용) */
  hasFusion(id: FusionId): boolean { return hasFusion(this.build, id); }
}
