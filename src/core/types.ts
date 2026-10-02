export type GameState = 'PLAYING' | 'GAMEOVER' | 'GAMECLEAR';
export type StagePhase = 'FIGHT' | 'WARNING' | 'BOSS' | 'BOSS_DYING' | 'CLEAR' | 'INTRO';
/** P 파워업 · M 유도미사일 · E 에너지 · B 폭탄 · G 자석 · L 목숨 · C 동료(고양이) · D 동료(강아지) */
export type ItemType = 'P' | 'M' | 'E' | 'B' | 'G' | 'L' | 'C' | 'D';
export type SkillKey = 'cat' | 'dog' | 'ult';
export type EnemyType = 'scout' | 'zigzag' | 'kamikaze' | 'sniper';
export type Rank = 'S' | 'A' | 'B' | 'C';

export interface PlayerState {
  x: number; y: number;
  targetX: number; targetY: number;
  radius: number;
  energy: number; maxEnergy: number;
  invincible: number;
  shield: number;   // 방벽 남은 프레임 (0이면 없음) — 다음 피격 1회를 막아 줌 (자동 방벽 카드)
  aegisTimer: number; // 자동 방벽 재생성까지 남은 프레임
  magnet: number;   // 자석 남은 프레임
}
export interface Bullet { x: number; y: number; vx: number; vy: number; dmg: number; pierce: number; homing?: boolean; hits?: object[]; }
export interface Missile { x: number; y: number; vx: number; vy: number; speed: number; dmg: number; }
export interface Gem { x: number; y: number; v: number; }
export interface Companion { ready: boolean; active: boolean; timer: number; used: boolean; pity: number; }
export type UltPhase = 'IDLE' | 'CUTIN' | 'FALL' | 'IMPACT';
export interface EnemyBullet { x: number; y: number; vx: number; vy: number; color: string; r: number; grazed?: boolean; }
export interface Enemy {
  type: EnemyType;
  x: number; y: number;
  hp: number; maxHp: number;
  speed: number;
  baseX: number;        // 지그재그 기준 x
  age: number;          // 생성 후 경과 프레임
  fireCd: number;       // 사격 쿨다운(저격형/지그재그)
  hold: number;         // 저격형이 제자리에서 버틴 프레임
  flash?: number;       // 피격 직후 하얗게 번쩍이는 남은 프레임 (연출용)
  lastHit?: 'bullet' | 'missile' | 'other';   // 마지막으로 맞은 무기 (처치 연출 분기)
}
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

export interface MidBoss {
  tier: number;
  x: number; y: number; targetY: number;
  width: number; height: number;
  vx: number;
  hp: number; maxHp: number;
  shootCd: number;
  /** MOVE: 좌우 이동 + 부채꼴 사격 / CHARGE: 정지·레이저 예고선 / FIRE: 레이저 발사 */
  state: 'MOVE' | 'CHARGE' | 'FIRE';
  stateTimer: number;
  laserX: number;
  dying: boolean; deathTimer: number;
}

export interface BossConfig {
  name: string; hp: number; color: string; subColor: string; w: number; h: number; shotCd: number;
}
export interface MidBossConfig { hp: number; w: number; h: number; fanCount: number; fanSpeed: number; color: string; }

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
  | { t: 'graze'; x: number; y: number }
  | { t: 'combo'; combo: number; mult: number }
  | { t: 'bomb'; x: number; y: number }
  | { t: 'missileHit'; x: number; y: number; kill: boolean }
  | { t: 'kill'; x: number; y: number; pts: number; missile: boolean }
  | { t: 'levelup'; level: number }
  | { t: 'skill'; key: SkillKey }
  | { t: 'ult'; phase: UltPhase }
  | { t: 'heal'; x: number; y: number }
  | { t: 'gem'; x: number; y: number }
  | { t: 'gameover' }
  | { t: 'gameclear' };

/** 한 틱에 시뮬레이션에 전달되는 입력 (포인터/키보드/패드를 씬이 합쳐서 만든다) */
export interface SimInput {
  targetX: number; targetY: number;   // 플레이어가 향할 목표 좌표 (논리 좌표)
  fire: boolean;
  bomb: boolean;                      // 이번 틱에 폭탄 버튼을 눌렀는가 (에지)
  skill?: SkillKey | null;            // 이번 틱에 누른 스킬 버튼 (고양이/강아지/필살기)
}
