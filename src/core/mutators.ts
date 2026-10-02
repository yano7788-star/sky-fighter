// 런 모디파이어(위험·보상): 출격 전에 무작위 3개 중 1개를 고른다. 더 어렵게 하는 대신 보상이 커진다. (순수 규칙)
import type { Rng } from './rng';

export type MutatorId = 'swift' | 'storm' | 'glass' | 'famine' | 'tough' | 'calm';

/** 모든 값은 배율(1 = 변화 없음) */
export interface MutatorEffects {
  enemySpeed: number;    // 일반 적 이동 속도
  bulletSpeed: number;   // 적 탄 속도
  bossShot: number;      // 보스 공격 주기 (작을수록 빠름)
  enemyHp: number;       // 일반 적 체력
  playerHp: number;      // 플레이어 최대 에너지
  dmg: number;           // 내 피해
  xp: number;            // 경험치
  drop: number;          // 아이템 드랍률
  spawn: number;         // 적 등장 간격 (클수록 적게 나옴)
  score: number;         // 처치 점수
  credit: number;        // 런 종료 크레딧
}
export const NEUTRAL: MutatorEffects = { enemySpeed: 1, bulletSpeed: 1, bossShot: 1, enemyHp: 1, playerHp: 1, dmg: 1, xp: 1, drop: 1, spawn: 1, score: 1, credit: 1 };

export interface MutatorDef {
  id: MutatorId; name: string; icon: string; color: string;
  risk: string;      // 불리한 점
  reward: string;    // 얻는 보상
  fx: Partial<MutatorEffects>;
}

export const MUTATORS: MutatorDef[] = [
  { id: 'swift',  name: '질주하는 적',   icon: '≫', color: '#38bdf8', risk: '적 이동 속도 +25%',            reward: '경험치 +25%, 점수·크레딧 +20%', fx: { enemySpeed: 1.25, xp: 1.25, score: 1.2, credit: 1.2 } },
  { id: 'storm',  name: '탄막 폭풍',     icon: '✺', color: '#f472b6', risk: '적 탄 +20% 빠름, 보스 공격 +15% 잦음', reward: '크레딧 +50%, 아이템 드랍 +30%', fx: { bulletSpeed: 1.2, bossShot: 0.85, credit: 1.5, drop: 1.3 } },
  { id: 'glass',  name: '유리 대포',     icon: '◇', color: '#fbbf24', risk: '최대 에너지 40% 감소',         reward: '내 피해 +50%, 점수 +30%', fx: { playerHp: 0.6, dmg: 1.5, score: 1.3 } },
  { id: 'famine', name: '보급 단절',     icon: '✖', color: '#f87171', risk: '아이템 드랍률 60% 감소',       reward: '경험치 +50%, 크레딧 +30%', fx: { drop: 0.4, xp: 1.5, credit: 1.3 } },
  { id: 'tough',  name: '강철 장갑',     icon: '⬣', color: '#a78bfa', risk: '일반 적 체력 +50%',            reward: '경험치 +40%, 점수 +30%', fx: { enemyHp: 1.5, xp: 1.4, score: 1.3 } },
  { id: 'calm',   name: '평온한 하늘',   icon: '☁', color: '#86efac', risk: '크레딧 30% 감소',              reward: '적이 적게(−20%) 약하게(−30% 체력) 나옴', fx: { spawn: 1.25, enemyHp: 0.7, credit: 0.7 } },
];

export const mutatorOf = (id: string | null | undefined): MutatorDef | null => MUTATORS.find(m => m.id === id) ?? null;
export const effectsOf = (id: string | null | undefined): MutatorEffects => ({ ...NEUTRAL, ...(mutatorOf(id)?.fx ?? {}) });

/** 출격 전에 제안할 모디파이어 n개 (중복 없음) */
export function offerMutators(rng: Rng, n = 3): MutatorId[] {
  const pool = MUTATORS.map(m => m.id);
  const out: MutatorId[] = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  return out;
}
