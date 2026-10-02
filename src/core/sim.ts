import { FIRST_BOSS_SCORE, H, MAX_TIER, NEXT_BOSS_SCORE_STEP, PHASE_FRAMES, PLAYER, W } from './config';
import {
  BOSS_CONFIGS, COMBO_WINDOW, DROP_BASE, DROP_EXTRA, ENEMY_DEFS, ENEMY_WEIGHTS, GRAZE_MARGIN, GRAZE_SCORE, MID_BOSS_LEAD_SCORE,
  MID_CONFIGS, comboMultiplier, fireBossPattern, rankFor,
} from './data';
import { createRng, type Rng } from './rng';
import type {
  Boss, Bullet, Enemy, EnemyBullet, EnemyType, GameState, Item, ItemType, MidBoss, Missile, PlayerState, Rank, SimEvent, SimInput,
  StagePhase,
} from './types';

const SHIELD_FRAMES = 900;
const MAGNET_FRAMES = 600;
const MAGNET_RANGE = 150;
const MAX_LIVES = 4;

/**
 * 게임 규칙 시뮬레이션 (Phaser/DOM 무관한 순수 TS).
 * - 고정 60Hz 틱: step(input) 한 번 = 1/60초
 * - 렌더링·사운드·연출은 drainEvents()로 받은 이벤트를 보고 바깥(씬)에서 처리한다
 * - 시드 고정 난수 → 같은 입력이면 같은 결과 (밸런스 측정·테스트 재현용)
 */
export class Sim {
  rng: Rng;
  state: GameState = 'PLAYING';
  frame = 0;
  score = 0;
  lives: number = PLAYER.startLives;
  bombs: number = PLAYER.startBombs;
  weaponLevel = 1;
  hasHomingMissile = false;
  missileTimer = 0;

  combo = 0;
  comboTimer = 0;
  grazeCount = 0;
  stageHits = 0;                 // 이번 스테이지에서 피격당한 횟수 (랭크 계산용)
  stageRank: Rank | null = null;

  bossTier = 1;
  boss: Boss | null = null;
  midBoss: MidBoss | null = null;
  midDone = false;               // 이번 스테이지의 중간보스를 이미 등장시켰는가
  nextBossScore = FIRST_BOSS_SCORE;
  stagePhase: StagePhase = 'FIGHT';
  phaseTimer = 0;
  clearBonus = 0;

  player: PlayerState;
  bullets: Bullet[] = [];
  missiles: Missile[] = [];
  enemyBullets: EnemyBullet[] = [];
  enemies: Enemy[] = [];
  items: Item[] = [];
  events: SimEvent[] = [];

  private fireCd = 0;
  private missileCd = 0;
  private lastBombFrame = 0;

  constructor(seed = 1) {
    this.rng = createRng(seed);
    this.player = this.newPlayer();
  }

  get multiplier(): number { return comboMultiplier(this.combo); }

  private newPlayer(): PlayerState {
    return {
      x: W / 2, y: PLAYER.spawnY, targetX: W / 2, targetY: PLAYER.spawnY,
      radius: PLAYER.radius, energy: PLAYER.maxEnergy, maxEnergy: PLAYER.maxEnergy, invincible: 0, shield: 0, magnet: 0,
    };
  }

  /** 시작 스테이지를 건너뛰어 특정 스테이지부터 테스트할 때 사용 */
  startAtTier(tier: number): void {
    this.bossTier = tier;
    this.nextBossScore = this.score + 1;
    this.midDone = true;
  }

  drainEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  private emit(e: SimEvent): void { this.events.push(e); }
  private boom(x: number, y: number, color: string, count: number): void { this.emit({ t: 'explosion', x, y, color, count }); }

  // ---------------------------------------------------------------------
  // 한 틱 진행
  // ---------------------------------------------------------------------
  step(inp: SimInput): void {
    if (this.state !== 'PLAYING') return;
    this.frame++;
    const p = this.player;
    p.targetX = inp.targetX; p.targetY = inp.targetY;
    if (inp.bomb) this.fireBomb();
    if (p.invincible > 0) p.invincible--;
    if (p.shield > 0) p.shield--;
    if (p.magnet > 0) p.magnet--;
    if (this.comboTimer > 0 && --this.comboTimer === 0 && this.combo > 0) { this.combo = 0; this.emit({ t: 'combo', combo: 0, mult: 1 }); }

    // 플레이어 이동
    p.x += (p.targetX - p.x) * 0.25; p.y += (p.targetY - p.y) * 0.25;
    p.x = Math.max(PLAYER.minX, Math.min(PLAYER.maxX, p.x));
    p.y = Math.max(PLAYER.minY, Math.min(PLAYER.maxY, p.y));

    this.updateWeapons(inp.fire);
    this.updateBullets();
    this.updateMissiles();
    this.updateStagePhase();
    if (this.boss) this.updateBoss();
    if (this.midBoss) this.updateMidBoss();
    this.updateEnemyBullets();
    this.updateEnemies();
    this.updateItems();
  }

  // ---------------------------------------------------------------------
  private updateWeapons(wantFire: boolean): void {
    const p = this.player;
    if (this.fireCd > 0) this.fireCd--;
    if (this.missileCd > 0) this.missileCd--;

    if (wantFire && this.fireCd <= 0) {
      this.fireCd = 8;
      this.emit({ t: 'muzzle' }); this.emit({ t: 'sfx', name: 'laser' });
      const b = (dx: number, dy: number, vx: number) => this.bullets.push({ x: p.x + dx, y: p.y + dy, vx, vy: -13 });
      if (this.weaponLevel === 1) { b(-18, -25, 0); b(18, -25, 0); }
      else if (this.weaponLevel === 2) { b(-22, -20, -1); b(0, -36, 0); b(22, -20, 1); }
      else { b(-26, -18, -2.5); b(-12, -30, 0); b(12, -30, 0); b(26, -18, 2.5); }
    }

    if (this.hasHomingMissile) {
      this.missileTimer--;
      if (this.missileTimer <= 0) this.hasHomingMissile = false;
      if (wantFire && this.missileCd <= 0) {
        this.missileCd = 18;
        this.emit({ t: 'sfx', name: 'missile' });
        this.missiles.push({ x: p.x - 26, y: p.y, vx: -3, vy: -5, speed: 7.5 });
        this.missiles.push({ x: p.x + 26, y: p.y, vx: 3, vy: -5, speed: 7.5 });
      }
    }
  }

  private updateBullets(): void {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.x += b.vx; b.y += b.vy;
      if (b.y < -15 || b.x < 0 || b.x > W) this.bullets.splice(i, 1);
    }
  }

  private updateMissiles(): void {
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      let target: { x: number; y: number } | null = this.boss && !this.boss.dying ? this.boss : null;
      if (!target && this.midBoss && !this.midBoss.dying) target = this.midBoss;
      if (!target && this.enemies.length > 0) {
        let minDist = Infinity;
        for (const e of this.enemies) { const d = Math.hypot(e.x - m.x, e.y - m.y); if (d < minDist) { minDist = d; target = e; } }
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
        const mc = MID_CONFIGS[this.bossTier];
        if (mc && !this.midDone && !this.midBoss && !this.boss && this.score >= this.nextBossScore - MID_BOSS_LEAD_SCORE) {
          this.spawnMidBoss(this.bossTier);
        } else if (!this.boss && !this.midBoss && this.score >= this.nextBossScore) {
          this.stagePhase = 'WARNING'; this.phaseTimer = PHASE_FRAMES.WARNING;
        }
        break;
      }
      case 'WARNING':
        if (--this.phaseTimer <= 0) { this.spawnBoss(this.bossTier); this.stagePhase = 'BOSS'; }
        break;
      case 'BOSS_DYING':
        if (--this.phaseTimer <= 0) {
          if (this.boss) {
            this.boom(this.boss.x, this.boss.y, '#ffffff', 40);
            this.boom(this.boss.x, this.boss.y, this.boss.subColor, 50);
          }
          this.emit({ t: 'sfx', name: 'boom' }); this.emit({ t: 'flash', kind: 'bossDeath', v: 0.9 });
          this.boss = null; this.stagePhase = 'CLEAR'; this.phaseTimer = PHASE_FRAMES.CLEAR;
        }
        break;
      case 'CLEAR':
        if (--this.phaseTimer <= 0) {
          if (this.bossTier >= MAX_TIER) { this.state = 'GAMECLEAR'; this.emit({ t: 'gameclear' }); }
          else this.beginNextStage();
        }
        break;
      case 'INTRO':
        if (--this.phaseTimer <= 0) this.stagePhase = 'FIGHT';
        break;
      default: break;
    }
  }

  private beginNextStage(): void {
    this.bossTier++;
    this.nextBossScore = this.score + NEXT_BOSS_SCORE_STEP;
    this.stagePhase = 'INTRO'; this.phaseTimer = PHASE_FRAMES.INTRO;
    this.midDone = false; this.stageHits = 0; this.stageRank = null;
  }

  private spawnBoss(tier: number): void {
    const c = BOSS_CONFIGS[tier];
    this.boss = {
      tier, name: c.name, x: W / 2, y: -120, targetY: 135, width: c.w, height: c.h,
      vx: 2.3 + tier * 0.25, hp: c.hp, maxHp: c.hp, shootCooldown: 0, attackMode: 1,
      color: c.color, subColor: c.subColor, shotCdMax: c.shotCd,
      phase2: false, phase2Alert: 0, dying: false, deathTimer: 0,
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
    if (b.phase2Alert > 0) b.phase2Alert--;

    if (b.dying) {
      // 폭발 중: 이동·공격 정지, 기체 위에서 연쇄 폭발
      b.deathTimer++;
      if (b.deathTimer % 5 === 0) {
        this.boom(b.x + (this.rng() - 0.5) * b.width * 0.9, b.y + (this.rng() - 0.5) * b.height * 0.9,
          this.rng() < 0.5 ? b.subColor : '#f59e0b', 10);
      }
      if (b.deathTimer % 16 === 1) this.emit({ t: 'sfx', name: 'boom' });
    } else if (b.y < b.targetY) {
      b.y += 1.5;
    } else {
      b.x += b.vx;
      if (b.x < b.width / 2 + 10 || b.x > W - b.width / 2 - 10) b.vx *= -1;
      b.shootCooldown++;
      if (b.shootCooldown > b.shotCdMax) {
        b.shootCooldown = 0;
        b.attackMode = b.attackMode === 1 ? 2 : 1;
        fireBossPattern(b, { player: p, frame: this.frame, emit: eb => this.enemyBullets.push(eb) });
      }
    }

    if (!b.dying) {
      for (let j = this.bullets.length - 1; j >= 0; j--) {
        const bl = this.bullets[j];
        if (Math.hypot(bl.x - b.x, bl.y - b.y) < b.width / 2) {
          this.bullets.splice(j, 1); b.hp--;
          this.boom(bl.x, bl.y, '#f59e0b', 3);
          this.emit({ t: 'hitspark', x: bl.x, y: bl.y });
        }
      }
      for (let m = this.missiles.length - 1; m >= 0; m--) {
        const ms = this.missiles[m];
        if (Math.hypot(ms.x - b.x, ms.y - b.y) < b.width / 2) {
          this.missiles.splice(m, 1); b.hp -= 3;
          this.emit({ t: 'sfx', name: 'boom' }); this.boom(ms.x, ms.y, '#ec4899', 10);
        }
      }
      if (Math.hypot(p.x - b.x, p.y - b.y) < b.width / 2 + 10) this.applyDamage(50);
    }

    // 체력이 0이 되어도 바로 사라지지 않고 '폭발 연출 → 클리어 → 다음 스테이지' 순서로 이어짐
    if (!b.dying && b.hp <= 0) {
      b.dying = true; b.deathTimer = 0; b.hp = 0; b.phase2Alert = 0;
      this.stagePhase = 'BOSS_DYING'; this.phaseTimer = PHASE_FRAMES.BOSS_DYING;
      const { rank, bonus } = rankFor(this.stageHits);
      this.stageRank = rank;
      this.clearBonus = 200 * b.tier + bonus; this.score += this.clearBonus;
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

  // ---------------------------------------------------------------------
  // 중간보스: 좌우 이동 + 부채꼴 사격, 주기적으로 레이저(예고선 → 발사)
  // ---------------------------------------------------------------------
  private spawnMidBoss(tier: number): void {
    const c = MID_CONFIGS[tier];
    this.midDone = true;
    this.midBoss = {
      tier, x: W / 2, y: -80, targetY: 120, width: c.w, height: c.h, vx: 1.8 + tier * 0.2,
      hp: c.hp, maxHp: c.hp, shootCd: 0, state: 'MOVE', stateTimer: 0, laserX: W / 2, dying: false, deathTimer: 0,
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
        this.midBoss = null;
      }
      return;
    }

    if (m.y < m.targetY) {
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
      if (++m.stateTimer > 300) { m.state = 'CHARGE'; m.stateTimer = 0; m.laserX = p.x; }   // 예고선은 이 시점의 플레이어 위치에 고정
    } else if (m.state === 'CHARGE') {
      // 예고선은 고정(1.2초) — 보고 피할 수 있어야 공정하다
      if (++m.stateTimer >= 70) { m.state = 'FIRE'; m.stateTimer = 0; this.emit({ t: 'sfx', name: 'enrage' }); this.emit({ t: 'shake', v: 8 }); }
    } else {
      m.stateTimer++;
      if (Math.abs(p.x - m.laserX) < 34 + p.radius * 0.5 && p.y > m.y) this.applyDamage(40);
      if (m.stateTimer >= 45) { m.state = 'MOVE'; m.stateTimer = 0; m.shootCd = 0; }
    }

    // 피격
    for (let j = this.bullets.length - 1; j >= 0; j--) {
      const bl = this.bullets[j];
      if (Math.hypot(bl.x - m.x, bl.y - m.y) < m.width / 2) { this.bullets.splice(j, 1); m.hp--; this.boom(bl.x, bl.y, '#f59e0b', 2); this.emit({ t: 'hitspark', x: bl.x, y: bl.y }); }
    }
    for (let k = this.missiles.length - 1; k >= 0; k--) {
      const ms = this.missiles[k];
      if (Math.hypot(ms.x - m.x, ms.y - m.y) < m.width / 2) { this.missiles.splice(k, 1); m.hp -= 3; this.emit({ t: 'sfx', name: 'boom' }); this.boom(ms.x, ms.y, '#ec4899', 8); }
    }
    if (Math.hypot(p.x - m.x, p.y - m.y) < m.width / 2 + 10) this.applyDamage(40);

    if (m.hp <= 0) {
      m.dying = true; m.deathTimer = 0; m.hp = 0;
      this.score += 150;
      this.enemyBullets.length = 0;
      this.emit({ t: 'shake', v: 10 }); this.emit({ t: 'hitstop', frames: 5 }); this.emit({ t: 'vibrate', pattern: [60, 40, 120] });
    }
  }

  // ---------------------------------------------------------------------
  private updateEnemyBullets(): void {
    const p = this.player;
    for (let i = this.enemyBullets.length - 1; i >= 0; i--) {
      if (i >= this.enemyBullets.length) continue;   // applyDamage(리스폰)가 탄을 전부 지운 경우
      const eb = this.enemyBullets[i];
      eb.x += eb.vx; eb.y += eb.vy;
      const d = Math.hypot(p.x - eb.x, p.y - eb.y);
      if (d < p.radius + eb.r) {
        this.enemyBullets.splice(i, 1);
        this.applyDamage(20);
        continue;
      }
      // 그레이즈: 판정 바로 바깥을 스치면 보너스 (피격 직후 무적 중에는 제외)
      if (!eb.grazed && p.invincible === 0 && d < p.radius + eb.r + GRAZE_MARGIN) {
        eb.grazed = true; this.grazeCount++; this.score += GRAZE_SCORE;
        this.emit({ t: 'graze', x: eb.x, y: eb.y });
      }
      if (eb.y > H + 20 || eb.x < -20 || eb.x > W + 20 || eb.y < -20) this.enemyBullets.splice(i, 1);
    }
  }

  private pickEnemyType(): EnemyType {
    const w = ENEMY_WEIGHTS[Math.min(MAX_TIER, this.bossTier)];
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
    this.enemies.push({ type, x, y: -30, hp: def.hp, maxHp: def.hp, speed, baseX: x, age: 0, fireCd: 50 + this.rng() * 60, hold: 0 });
  }

  private aimedShot(e: Enemy, spd: number, color: string, r: number, spread = 0): void {
    const p = this.player;
    const ang = Math.atan2(p.x - e.x, p.y - e.y) + spread;
    this.enemyBullets.push({ x: e.x, y: e.y + 12, vx: Math.sin(ang) * spd, vy: Math.cos(ang) * spd, color, r });
  }

  private moveEnemy(e: Enemy): void {
    const p = this.player;
    e.age++;
    switch (e.type) {
      case 'scout':
        e.y += e.speed;
        if (this.rng() < 0.008) this.enemyBullets.push({ x: e.x, y: e.y + 10, vx: 0, vy: 2.2, color: '#f43f5e', r: 4 });
        break;
      case 'zigzag':
        e.y += e.speed;
        e.x = Math.max(30, Math.min(W - 30, e.baseX + Math.sin(e.age * 0.06) * 80));
        if (--e.fireCd <= 0 && e.y > 40 && e.y < H * 0.55) { this.aimedShot(e, 2.6, '#fb923c', 4); e.fireCd = 110 + this.rng() * 40; }
        break;
      case 'kamikaze':
        e.y += e.speed;
        if (e.y < p.y - 40) e.x += Math.max(-3.2, Math.min(3.2, (p.x - e.x) * 0.035));
        break;
      case 'sniper':
        if (e.y < 150 && e.hold === 0) e.y += e.speed;
        else if (e.hold < 170) {
          e.hold++;
          if (--e.fireCd <= 0) { this.aimedShot(e, 3.0, '#38bdf8', 4.5, -0.12); this.aimedShot(e, 3.0, '#38bdf8', 4.5, 0.12); e.fireCd = 60; }
        } else e.y += e.speed * 1.5;
        if (e.hold === 0 && e.y >= 150) e.hold = 1;
        break;
    }
  }

  private updateEnemies(): void {
    const p = this.player;
    const spawnOk = this.stagePhase === 'FIGHT' || this.stagePhase === 'BOSS' ||
      (this.stagePhase === 'INTRO' && this.phaseTimer < PHASE_FRAMES.INTRO - 50);
    if (spawnOk && this.frame % (this.boss || this.midBoss ? 70 : 32) === 0) this.spawnEnemy();

    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      const def = ENEMY_DEFS[e.type];
      this.moveEnemy(e);

      for (let j = this.bullets.length - 1; j >= 0; j--) {
        const b = this.bullets[j];
        if (Math.hypot(b.x - e.x, b.y - e.y) < def.hitR) { this.bullets.splice(j, 1); e.hp -= 1; this.emit({ t: 'hitspark', x: b.x, y: b.y }); break; }
      }
      for (let m = this.missiles.length - 1; m >= 0; m--) {
        const ms = this.missiles[m];
        if (Math.hypot(ms.x - e.x, ms.y - e.y) < def.hitR + 2) { this.missiles.splice(m, 1); e.hp -= 3; break; }
      }
      if (e.hp <= 0) {
        this.emit({ t: 'sfx', name: 'boom' }); this.boom(e.x, e.y, '#ef4444', 12);
        this.killScore(def.score);
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
  private killScore(base: number): void {
    this.combo++; this.comboTimer = COMBO_WINDOW;
    this.score += Math.round(base * comboMultiplier(this.combo));
    this.emit({ t: 'combo', combo: this.combo, mult: comboMultiplier(this.combo) });
  }

  private dropItem(x: number, y: number): void {
    const r = this.rng();
    let type: ItemType | null = null;
    for (const [cum, t] of DROP_BASE) if (r < cum) { type = t; break; }
    if (!type) { const r2 = this.rng(); for (const [cum, t] of DROP_EXTRA) if (r2 < cum) { type = t; break; } }
    if (type) this.items.push({ x, y, type });
  }

  private updateItems(): void {
    const p = this.player;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      const dx = p.x - it.x, dy = p.y - it.y, dist = Math.hypot(dx, dy);
      if (p.magnet > 0 && dist < MAGNET_RANGE && dist > 1) { it.x += (dx / dist) * 7; it.y += (dy / dist) * 7; }
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
      case 'P': this.weaponLevel = Math.min(3, this.weaponLevel + 1); this.emit({ t: 'sfx', name: 'item' }); break;
      case 'M': this.hasHomingMissile = true; this.missileTimer = 500; this.emit({ t: 'sfx', name: 'item' }); break;
      case 'E':
        this.emit({ t: 'sfx', name: 'heal' });
        p.energy = Math.min(p.maxEnergy, p.energy + 30);
        this.boom(p.x, p.y, '#06b6d4', 10);
        break;
      case 'B':
        this.emit({ t: 'sfx', name: 'item' });
        this.bombs = Math.min(PLAYER.maxBombs, this.bombs + 1);
        this.boom(p.x, p.y, '#ef4444', 10);
        break;
      case 'S': p.shield = SHIELD_FRAMES; this.emit({ t: 'sfx', name: 'item' }); this.emit({ t: 'ring', x: p.x, y: p.y, color: '#60a5fa', max: 60 }); break;
      case 'G': p.magnet = MAGNET_FRAMES; this.emit({ t: 'sfx', name: 'item' }); this.emit({ t: 'ring', x: p.x, y: p.y, color: '#c084fc', max: MAGNET_RANGE }); break;
      case 'L':
        this.lives = Math.min(MAX_LIVES, this.lives + 1);
        this.emit({ t: 'sfx', name: 'heal' }); this.emit({ t: 'ring', x: p.x, y: p.y, color: '#f43f5e', max: 70 });
        break;
    }
  }

  // ---------------------------------------------------------------------
  fireBomb(): void {
    if (this.bombs <= 0 || this.state !== 'PLAYING') return;
    if (this.stagePhase === 'BOSS_DYING' || this.stagePhase === 'CLEAR') return;   // 연출 중 폭탄 낭비 방지
    if (this.frame - this.lastBombFrame < 20) return;
    this.lastBombFrame = this.frame;
    this.bombs--;
    this.emit({ t: 'sfx', name: 'boom' }); this.emit({ t: 'flash', kind: 'bomb', v: 1 });
    this.emit({ t: 'shake', v: 16 }); this.emit({ t: 'hitstop', frames: 5 }); this.emit({ t: 'vibrate', pattern: 90 });

    this.enemyBullets.length = 0;
    for (const e of this.enemies) if (e.y > -10) e.hp = 0;   // 화면 안의 적만 제거
    if (this.boss && !this.boss.dying) {
      this.boss.hp -= 40;
      this.boom(this.boss.x, this.boss.y, '#ef4444', 30);
    }
    if (this.midBoss && !this.midBoss.dying) {
      this.midBoss.hp -= 40;
      this.boom(this.midBoss.x, this.midBoss.y, '#ef4444', 24);
    }
  }

  applyDamage(dmg: number): void {
    const p = this.player;
    if (p.invincible > 0 || this.state !== 'PLAYING') return;
    if (this.stagePhase === 'BOSS_DYING' || this.stagePhase === 'CLEAR') return;   // 전환 연출 중에는 피해 없음

    if (p.shield > 0) {   // 실드가 피격 1회를 흡수
      p.shield = 0; p.invincible = 30;
      this.emit({ t: 'sfx', name: 'item' }); this.emit({ t: 'ring', x: p.x, y: p.y, color: '#60a5fa', max: 70 });
      this.emit({ t: 'shake', v: 4 });
      return;
    }

    p.energy = Math.max(0, p.energy - dmg);
    p.invincible = 40;
    this.stageHits++;
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
}
