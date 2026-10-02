import type { RunStats } from './achievements';
import { createRng } from './rng';
import { dailySeed } from './mutators';

/** 일일 미션: 날짜마다 3개가 정해지고(모두 같은 조건), 여러 판에 걸쳐 누적된다. 완료 시 크레딧 지급 */
export interface MissionDef {
  id: string; desc: string; goal: number; reward: number;
  kind: 'sum' | 'max';              // sum=여러 판 누적 / max=한 판 최고치
  value: (r: RunStats) => number;   // 한 판 기록에서 읽는 값
}

export const MISSIONS: MissionDef[] = [
  { id: 'graze', desc: '탄을 아슬아슬하게 60번 스치기', goal: 60, reward: 70, kind: 'sum', value: r => r.graze },
  { id: 'kills', desc: '적 150기 처치', goal: 150, reward: 70, kind: 'sum', value: r => r.kills },
  { id: 'combo', desc: '한 판에 25콤보 달성', goal: 25, reward: 80, kind: 'max', value: r => r.maxCombo },
  { id: 'hyper', desc: '하이퍼 모드 1번 발동', goal: 1, reward: 80, kind: 'sum', value: r => r.hypers },
  { id: 'fusion', desc: '융합 카드 획득', goal: 1, reward: 70, kind: 'max', value: r => r.fusions },
  { id: 'stage3', desc: '3스테이지에 도달', goal: 3, reward: 70, kind: 'max', value: r => r.bossTier },
  { id: 'bosses', desc: '보스 2기 격파', goal: 2, reward: 90, kind: 'sum', value: r => Math.max(0, r.bossTier - (r.cleared ? 0 : 1)) },
  { id: 'ults', desc: '궁극기 2번 사용', goal: 2, reward: 60, kind: 'sum', value: r => r.ults },
  { id: 'score', desc: '한 판에 점수 8,000 달성', goal: 8000, reward: 80, kind: 'max', value: r => r.score },
  { id: 'nohit', desc: '피격 없이 2스테이지에 도달', goal: 1, reward: 90, kind: 'max', value: r => (r.hits === 0 && r.bossTier >= 2 ? 1 : 0) },
];
export const MISSION_ALL_BONUS = 100;   // 3개 모두 완료 보너스

/** 그날의 미션 3개 (날짜 시드 → 모두 동일) */
export function dailyMissions(dayKeyStr: string): MissionDef[] {
  const rng = createRng(dailySeed(dayKeyStr) + 101), pool = [...MISSIONS], out: MissionDef[] = [];
  while (out.length < 3 && pool.length) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  return out;
}

export interface MissionSave { date: string; progress: Record<string, number>; done: string[]; bonus: boolean; }
export const newMissionSave = (date: string): MissionSave => ({ date, progress: {}, done: [], bonus: false });

/**
 * 한 판(또는 무한 모드로 이어진 구간)의 기록을 반영한다. prev는 같은 런에서 이미 반영한 기록(누적 값 중복 방지).
 * 반환: 새 저장 상태 + 이번에 새로 완료한 미션 + 지급할 크레딧
 */
export function applyRun(save: MissionSave, key: string, r: RunStats, prev: RunStats | null): { save: MissionSave; completed: MissionDef[]; credits: number } {
  const s: MissionSave = save.date === key ? { ...save, progress: { ...save.progress }, done: [...save.done] } : newMissionSave(key);
  const completed: MissionDef[] = [];
  const list = dailyMissions(key);
  for (const m of list) {
    const cur = s.progress[m.id] ?? 0;
    s.progress[m.id] = m.kind === 'sum' ? cur + Math.max(0, m.value(r) - (prev ? m.value(prev) : 0)) : Math.max(cur, m.value(r));
    if (!s.done.includes(m.id) && s.progress[m.id] >= m.goal) { s.done.push(m.id); completed.push(m); }
  }
  let credits = completed.reduce((n, m) => n + m.reward, 0);
  if (!s.bonus && list.every(m => s.done.includes(m.id))) { s.bonus = true; credits += MISSION_ALL_BONUS; }
  return { save: s, completed, credits };
}
