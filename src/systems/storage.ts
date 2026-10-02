// localStorage는 사생활 보호 모드 등에서 막힐 수 있으므로 항상 try/catch로 감싼다
const PREFIX = 'skyfighter.';

export const store = {
  get<T>(key: string, fallback: T): T {
    try {
      const v = localStorage.getItem(PREFIX + key);
      return v === null ? fallback : (JSON.parse(v) as T);
    } catch { return fallback; }
  },
  set(key: string, value: unknown): void {
    try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* 저장 불가 환경 */ }
  },
};

export interface BestRecord { score: number; stage: number; }
export const loadBest = (): BestRecord => store.get<BestRecord>('best', { score: 0, stage: 0 });
export const saveBest = (b: BestRecord): void => store.set('best', b);

// 격납고(영구 성장): 크레딧과 강화 레벨
import type { MetaLevels } from '../core/meta';
export interface MetaSave { credits: number; levels: MetaLevels; pilots: { owned: string[]; selected: string }; }
export const loadMeta = (): MetaSave => {
  const m = store.get<Partial<MetaSave>>('meta', {});
  const owned = Array.from(new Set(['ace', ...(m.pilots?.owned ?? [])]));
  const selected = owned.includes(m.pilots?.selected ?? '') ? (m.pilots!.selected as string) : 'ace';
  return { credits: Math.max(0, Number(m.credits) || 0), levels: m.levels ?? {}, pilots: { owned, selected } };
};
export const saveMeta = (m: MetaSave): void => store.set('meta', m);

// 일일 도전 기록 (날짜가 바뀌면 초기화)
export interface DailySave { date: string; best: number; runs: number; }
export const loadDaily = (key: string): DailySave => {
  const d = store.get<Partial<DailySave>>('daily', {});
  return d.date === key ? { date: key, best: Number(d.best) || 0, runs: Number(d.runs) || 0 } : { date: key, best: 0, runs: 0 };
};
export const saveDaily = (d: DailySave): void => store.set('daily', d);
