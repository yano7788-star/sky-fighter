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
