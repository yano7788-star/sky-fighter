import { describe, expect, it } from 'vitest';
import { buildLevel, buildRescueLevel } from '../src/core/groundmap';
import { clearance } from '../tools/clear-check';

describe('지상전 맵 통행 검사 (반경 36 플레이어가 실제로 지나갈 수 있는 길)', () => {
  it('강하 맵: 모든 적·무기·문·출구에 닿을 수 있다', () => { expect(clearance(buildLevel(), 'assault').bad).toBe(0); });
  it('인질 구출 맵: 모든 적·무기·인질·문·헬기장에 닿을 수 있다', () => { expect(clearance(buildRescueLevel(), 'rescue').bad).toBe(0); });
});
