export type GameState = 'PLAYING' | 'GAMEOVER' | 'GAMECLEAR';
export type StagePhase = 'FIGHT' | 'WARNING' | 'BOSS' | 'BOSS_DYING' | 'EJECT' | 'CLEAR' | 'INTRO';
/** P 파워업 · M 유도미사일 · E 에너지 · B 폭탄 · G 자석 · L 목숨 · C 동료(고양이) · D 동료(강아지) */
export type ItemType = 'P' | 'M' | 'E' | 'B' | 'G' | 'L' | 'C' | 'D';
export type SkillKey = 'cat' | 'dog' | 'ult';
export type EnemyType = 'scout' | 'zigzag' | 'kamikaze' | 'sniper' | 'drone' | 'mine' | 'turret' | 'rock';   // drone=벌떼 드론, mine=부유 기뢰(폭발 시 탄 고리), turret=지상 포대, rock=운석 괴수(처치 시 쪼개짐)
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
export type UltPhase = 'IDLE' | 'CUTIN' | 'FALL' | 'IMPACT' | 'ACTIVE';
/** 궁극기 종류: 에이스=자매의 손바닥, 언니=미사일 포격, 동생=시간 정지 */
export type UltKind = 'palm' | 'barrage' | 'timestop';
/** 스테이지 장애물: 운석(예고 후 낙하) / 용암 기둥(예고 후 분출) */
export interface Hazard { kind: 'meteor' | 'lava'; x: number; y: number; t: number; warn: number; dur: number; hit?: boolean; }
export interface EnemyBullet { x: number; y: number; vx: number; vy: number; color: string; r: number; grazed?: boolean; }
export interface Enemy {
  type: EnemyType;
  x: number; y: number;
  hp: number; maxHp: number;
  speed: number;
  baseX: number;        // 지그재그 기준 x
  vx?: number;          // 가로 이동 속도(벌떼 협공 등)
  side?: boolean;       // 옆에서 날아 들어오는 적 (화면 가장자리에서 등장해 반대편으로 지나간다)
  age: number;          // 생성 후 경과 프레임
  fireCd: number;       // 사격 쿨다운(저격형/지그재그)
  hold: number;         // 저격형이 제자리에서 버틴 프레임
  form?: number;        // 편대 번호 (같은 편대를 전멸시키면 보너스)
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
  /** 보스 특수 공격: 레이저(예고선 → 발사) / 돌진(예고 레인 → 돌진 → 복귀). 진행 중에는 일반 탄막과 이동을 멈춘다 */
  sp?: { kind: 'laser' | 'charge' | 'swarm'; state: 'WARN' | 'ACT' | 'RET'; t: number; lockX: number; beams: number[] };
  spCd?: number; spIdx?: number;
  brk?: number;    // 파손 단계(0~3): 체력 70/40/10% 아래로 내려갈 때마다 올라간다 (연출용)
  stun?: number;   // 특수 공격 직후 약점 노출(그로기): 남은 프레임. 이동·사격 정지, 받는 피해 증가
  phase3?: boolean; phase3Alert?: number;   // 최종 보스(5스테이지) 전용 3페이즈: 체력 20% 이하
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
  lockX: number;     // CHARGE 동안 보스가 미끄러져 가는 목표 x (플레이어의 x를 조준)
  laserX: number;    // 레이저/예고선의 x — 항상 보스 자신의 x (보스 코에서 곧게 내려온다)
  dying: boolean; deathTimer: number;
  brk?: number;    // 파손 단계(연출용)
}

export interface BossConfig {
  name: string; hp: number; color: string; subColor: string; w: number; h: number; shotCd: number;
}
export interface MidBossConfig { hp: number; w: number; h: number; fanCount: number; fanSpeed: number; color: string; }

/** 시뮬레이션이 내보내는 이벤트 — 렌더링/사운드/연출은 이걸 보고 반응한다 (코어는 연출을 모른다) */
export type SimEvent =
  | { t: 'sfx'; name: 'laser' | 'missile' | 'boom' | 'enrage' | 'item' | 'heal' | 'laserCharge' | 'laserBeam' }
  | { t: 'explosion'; x: number; y: number; color: string; count: number }
  | { t: 'ring'; x: number; y: number; color: string; max: number }
  | { t: 'shake'; v: number }
  | { t: 'hitstop'; frames: number }
  | { t: 'flash'; kind: 'hit' | 'bomb' | 'respawn' | 'bossDeath' | 'enrage'; v: number }
  | { t: 'vibrate'; pattern: number | number[] }
  | { t: 'muzzle' }
  | { t: 'hitspark'; x: number; y: number }
  /** 보스/중간보스 피격: 무기별(src) 연출을 위해 매 피해마다 나온다 */
  | { t: 'bossHit'; target: 'boss' | 'mid'; src: 'bullet' | 'missile' | 'laser' | 'other'; x: number; y: number; dmg: number }
  | { t: 'bossBreak'; target: 'boss' | 'mid'; stage: number; x: number; y: number }   // 외피 파손(70/40/10%)
  | { t: 'slowmo'; ms: number; scale: number }                                          // 페이즈 전환·격추 순간의 슬로 모션
  | { t: 'laserHit'; x: number; y: number }                                             // 레이저 빔이 닿은 지점
  | { t: 'graze'; x: number; y: number }
  | { t: 'combo'; combo: number; mult: number }
  | { t: 'formclear'; x: number; y: number; pts: number }
  | { t: 'bomb'; x: number; y: number }
  | { t: 'missileHit'; x: number; y: number; kill: boolean }
  | { t: 'kill'; x: number; y: number; pts: number; missile: boolean }
  | { t: 'levelup'; level: number }
  | { t: 'skill'; key: SkillKey }
  | { t: 'ult'; phase: UltPhase }
  | { t: 'heal'; x: number; y: number }
  | { t: 'gem'; x: number; y: number }
  | { t: 'gameover' }
  | { t: 'overload' }        // 3스테이지 보스 코어 과부하(자폭 카운트다운 시작)
  | { t: 'selfdestruct'; x: number; y: number }   // 자폭 폭발이 아군 기체를 덮침
  | { t: 'eject' }           // 비상 탈출
  | { t: 'gameclear' };

/** 한 틱에 시뮬레이션에 전달되는 입력 (포인터/키보드/패드를 씬이 합쳐서 만든다) */
export interface SimInput {
  targetX: number; targetY: number;   // 플레이어가 향할 목표 좌표 (논리 좌표)
  fire: boolean;
  bomb: boolean;                      // 이번 틱에 폭탄 버튼을 눌렀는가 (에지)
  skill?: SkillKey | null;            // 이번 틱에 누른 스킬 버튼 (고양이/강아지/필살기)
}
