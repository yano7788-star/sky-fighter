import type { FusionId } from './build';

/** 한 판이 끝났을 때의 기록 (순수 데이터: 테스트·시뮬레이션에서도 만든다) */
export interface RunStats {
  score: number; bossTier: number; cleared: boolean; endless: boolean;
  hypers: number; kills: number; maxCombo: number; graze: number; hits: number; bombs: number; ults: number;
  fusions: number; mutator: string | null; daily: boolean;
}

export interface Achievement { id: string; icon: string; name: string; desc: string; reward: number; test: (r: RunStats) => boolean; }

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'stage2', icon: '🛩', name: '이륙', desc: '2스테이지에 도달', reward: 30, test: r => r.bossTier >= 2 },
  { id: 'stage3', icon: '☁', name: '구름 위로', desc: '3스테이지에 도달', reward: 60, test: r => r.bossTier >= 3 },
  { id: 'stage5', icon: '🌋', name: '최후의 전장', desc: '5스테이지에 도달', reward: 120, test: r => r.bossTier >= 5 },
  { id: 'clear', icon: '🏁', name: '미션 클리어', desc: '5스테이지 보스를 격파', reward: 300, test: r => r.cleared },
  { id: 'endless', icon: '∞', name: '끝나지 않는 하늘', desc: '무한 모드 6스테이지에 도달', reward: 400, test: r => r.endless && r.bossTier >= 6 },
  { id: 'combo30', icon: '🔥', name: '연쇄 폭발', desc: '30콤보 달성', reward: 80, test: r => r.maxCombo >= 30 },
  { id: 'graze100', icon: '✨', name: '아슬아슬', desc: '한 판에 탄 100번 스치기', reward: 100, test: r => r.graze >= 100 },
  { id: 'untouched', icon: '🛡', name: '무결점 비행', desc: '피격 없이 3스테이지에 도달', reward: 200, test: r => r.hits === 0 && r.bossTier >= 3 },
  { id: 'nobomb', icon: '💣', name: '폭탄은 사치', desc: '폭탄 없이 4스테이지에 도달', reward: 200, test: r => r.bombs === 0 && r.bossTier >= 4 },
  { id: 'fusion', icon: '⚗', name: '첫 융합', desc: '융합 카드를 획득', reward: 80, test: r => r.fusions >= 1 },
  { id: 'fusion2', icon: '⚛', name: '이중 융합', desc: '한 판에 융합 2종 보유', reward: 150, test: r => r.fusions >= 2 },
  { id: 'hyper3', icon: '🌈', name: '하이퍼 러너', desc: '한 판에 하이퍼 모드 3번 발동', reward: 90, test: r => r.hypers >= 3 },
  { id: 'ult3', icon: '🌟', name: '필살기 연발', desc: '한 판에 궁극기 3번 사용', reward: 60, test: r => r.ults >= 3 },
  { id: 'score20k', icon: '💯', name: '2만 점', desc: '점수 20,000 달성', reward: 100, test: r => r.score >= 20000 },
  { id: 'score50k', icon: '👑', name: '5만 점', desc: '점수 50,000 달성', reward: 250, test: r => r.score >= 50000 },
  { id: 'mutclear', icon: '⚠', name: '위험을 안고', desc: '모디파이어를 쓰고 클리어', reward: 250, test: r => r.cleared && !!r.mutator },
  { id: 'daily', icon: '📅', name: '오늘의 도전자', desc: '일일 도전에서 2스테이지에 도달', reward: 60, test: r => r.daily && r.bossTier >= 2 },
];

export const FUSION_IDS: FusionId[] = ['swarm', 'railgun', 'hunter', 'aegisorbit', 'prism', 'overdrive'];

/** 새로 달성한 업적 (이미 달성한 것은 제외) */
export function newlyUnlocked(r: RunStats, have: readonly string[]): Achievement[] {
  return ACHIEVEMENTS.filter(a => !have.includes(a.id) && a.test(r));
}
