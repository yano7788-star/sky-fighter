export type GameState = 'PLAYING' | 'GAMEOVER' | 'GAMECLEAR';
export type StagePhase = 'FIGHT' | 'WARNING' | 'BOSS' | 'BOSS_DYING' | 'CLEAR' | 'INTRO';
export type ItemType = 'P' | 'M' | 'E' | 'B';

export interface PlayerState {
  x: number; y: number;
  targetX: number; targetY: number;
  radius: number;
  energy: number; maxEnergy: number;
  invincible: number;
}
export interface Bullet { x: number; y: number; vx: number; vy: number; }
export interface Missile { x: number; y: number; vx: number; vy: number; speed: number; }
export interface EnemyBullet { x: number; y: number; vx: number; vy: number; color: string; r: number; }
export interface Enemy { x: number; y: number; hp: number; speed: number; }
export interface Item { x: number; y: number; type: ItemType; }

export interface Boss {
  tier: number; name: string;
  x: number; y: number; targetY: number;
  width: number; height: number;
  vx: number;
  hp: number; maxHp: number;
  shootCooldown: number; attackMode: 1 | 2;
  color: string; subColor: string;
  shotCdMax: number;
  phase2: boolean; phase2Alert: number;
  dying: boolean; deathTimer: number;
}

export interface BossConfig {
  name: string; hp: number; color: string; subColor: string; w: number; h: number; shotCd: number;
}

/** 시뮬레이션이 내보내는 이벤트 — 렌더링/사운드/연출은 이걸 보고 반응한다 (코어는 연출을 모른다) */
export type SimEvent =
  | { t: 'sfx'; name: 'laser' | 'missile' | 'boom' | 'enrage' | 'item' | 'heal' }
  | { t: 'explosion'; x: number; y: number; color: string; count: number }
  | { t: 'ring'; x: number; y: number; color: string; max: number }
  | { t: 'shake'; v: number }
  | { t: 'hitstop'; frames: number }
  | { t: 'flash'; kind: 'hit' | 'bomb' | 'respawn' | 'bossDeath' | 'enrage'; v: number }
  | { t: 'vibrate'; pattern: number | number[] }
  | { t: 'muzzle' }
  | { t: 'hitspark'; x: number; y: number }
  | { t: 'gameover' }
  | { t: 'gameclear' };

/** 한 틱에 시뮬레이션에 전달되는 입력 (포인터/키보드/패드를 씬이 합쳐서 만든다) */
export interface SimInput {
  targetX: number; targetY: number;   // 플레이어가 향할 목표 좌표 (논리 좌표)
  fire: boolean;
  bomb: boolean;                      // 이번 틱에 폭탄 버튼을 눌렀는가 (에지)
}
