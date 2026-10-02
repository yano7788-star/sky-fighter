import { FIRST_BOSS_SCORE, H, MAX_TIER, NEXT_BOSS_SCORE_STEP, PHASE_FRAMES, PLAYER, W } from './config';
import { BOSS_CONFIGS, fireBossPattern } from './data';
import { createRng, type Rng } from './rng';
import type {
  Boss, Bullet, Enemy, EnemyBullet, GameState, Item, ItemType, Missile, PlayerState, SimEvent, SimInput, StagePhase,
} from './types';

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

  bossTier = 1;
  boss: Boss | null = null;
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

  private newPlayer(): PlayerState {
    return {
      x: W / 2, y: PLAYER.spawnY, targetX: W / 2, targetY: PLAYER.spawnY,
      radius: PLAYER.radius, energy: PLAYER.maxEnergy, maxEnergy: PLAYER.maxEnergy, invincible: 0,
    };
  }

  /** 시작 스테이지를 건너뛰어 특정 스테이지부터 테스트할 때 사용 */
  startAtTier(tier: number): void {
    this.bossTier = tier;
    this.nextBossScore = this.score + 1;
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

    // 플레이어 이동
    p.x += (p.targetX - p.x) * 0.25; p.y += (p.targetY - p.y) * 0.25;
    p.x = Math.max(PLAYER.minX, Math.min(PLAYER.maxX, p.x));
    p.y = Math.max(PLAYER.minY, Math.min(PLAYER.maxY, p.y));

    this.updateWeapons(inp.fire);
    this.updateBullets();
    this.updateMissiles();
    this.updateStagePhase();
    if (this.boss) this.updateBoss();
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
  // 스테이지 진행: 전투 → 경고 → 보스 → 폭발 → 클리어 → 다음 스테이지 도입
  // ---------------------------------------------------------------------
  private updateStagePhase(): void {
    switch (this.stagePhase) {
      case 'FIGHT':
        if (!this.boss && this.score >= this.nextBossScore) { this.stagePhase = 'WARNING'; this.phaseTimer = PHASE_FRAMES.WARNING; }
        break;
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
      this.clearBonus = 200 * b.tier; this.score += this.clearBonus;
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
  private updateEnemyBullets(): void {
    const p = this.player;
    for (let i = this.enemyBullets.length - 1; i >= 0; i--) {
      if (i >= this.enemyBullets.length) continue;   // applyDamage(리스폰)가 탄을 전부 지운 경우
      const eb = this.enemyBullets[i];
      eb.x += eb.vx; eb.y += eb.vy;
      if (Math.hypot(p.x - eb.x, p.y - eb.y) < p.radius + eb.r) {
        this.enemyBullets.splice(i, 1);
        this.applyDamage(20);
        continue;
      }
      if (eb.y > H + 20 || eb.x < -20 || eb.x > W + 20 || eb.y < -20) this.enemyBullets.splice(i, 1);
    }
  }

  private updateEnemies(): void {
    const p = this.player;
    const spawnOk = this.stagePhase === 'FIGHT' || this.stagePhase === 'BOSS' ||
      (this.stagePhase === 'INTRO' && this.phaseTimer < PHASE_FRAMES.INTRO - 50);
    if (spawnOk && this.frame % (this.boss ? 70 : 32) === 0) {
      this.enemies.push({ x: this.rng() * (W - 70) + 45, y: -30, hp: 1, speed: 3.2 + this.rng() * 1.5 });
    }
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      e.y += e.speed;
      if (this.rng() < 0.008) this.enemyBullets.push({ x: e.x, y: e.y + 10, vx: 0, vy: 2.2, color: '#f43f5e', r: 4 });

      for (let j = this.bullets.length - 1; j >= 0; j--) {
        const b = this.bullets[j];
        if (Math.hypot(b.x - e.x, b.y - e.y) < 20) { this.bullets.splice(j, 1); e.hp = 0; break; }
      }
      for (let m = this.missiles.length - 1; m >= 0; m--) {
        const ms = this.missiles[m];
        if (Math.hypot(ms.x - e.x, ms.y - e.y) < 22) { this.missiles.splice(m, 1); e.hp = 0; break; }
      }
      if (e.hp <= 0) {
        this.emit({ t: 'sfx', name: 'boom' }); this.boom(e.x, e.y, '#ef4444', 12); this.score += 10;
        const r = this.rng();
        let drop: ItemType | null = null;
        if (r < 0.05) drop = 'P'; else if (r < 0.09) drop = 'M'; else if (r < 0.13) drop = 'E'; else if (r < 0.15) drop = 'B';
        if (drop) this.items.push({ x: e.x, y: e.y, type: drop });
        this.enemies.splice(i, 1);
        continue;
      }
      if (Math.hypot(p.x - e.x, p.y - e.y) < p.radius + 14) {
        this.enemies.splice(i, 1);
        this.applyDamage(35);
        continue;
      }
      if (e.y > H + 30) this.enemies.splice(i, 1);
    }
  }

  private updateItems(): void {
    const p = this.player;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.y += 2.2;
      if (Math.hypot(p.x - it.x, p.y - it.y) < p.radius + 12) {
        if (it.type === 'P') this.weaponLevel = Math.min(3, this.weaponLevel + 1);
        else if (it.type === 'M') { this.hasHomingMissile = true; this.missileTimer = 500; }
        else if (it.type === 'E') {
          this.emit({ t: 'sfx', name: 'heal' });
          p.energy = Math.min(p.maxEnergy, p.energy + 30);
          this.boom(p.x, p.y, '#06b6d4', 10);
        } else {
          this.emit({ t: 'sfx', name: 'item' });
          this.bombs = Math.min(PLAYER.maxBombs, this.bombs + 1);
          this.boom(p.x, p.y, '#ef4444', 10);
        }
        this.items.splice(i, 1);
      } else if (it.y > H + 20) this.items.splice(i, 1);
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
  }

  applyDamage(dmg: number): void {
    const p = this.player;
    if (p.invincible > 0 || this.state !== 'PLAYING') return;
    if (this.stagePhase === 'BOSS_DYING' || this.stagePhase === 'CLEAR') return;   // 전환 연출 중에는 피해 없음
    p.energy = Math.max(0, p.energy - dmg);
    p.invincible = 40;
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
