/**
 * 지상전 모바일 조작 모드 (순수 로직, 테스트 대상)
 *  - 정밀(precise): 이동 스틱 + 조준 스틱 (조준 방향 = 스틱 방향, 살짝만 밀어도 발사).
 *  - 간편(simple): 이동 스틱 + 사격 버튼(조준 없음). 몸 방향은 이동 방향을 따라가고, 사격 버튼을 누르는 동안은 방향이 잠겨
 *    이동하면서도 같은 방향으로 쏜다(뒷걸음질·옆걸음 사격). 스틱을 아주 살짝만 기울이면(제자리 회전 구역) 이동 없이 방향만 바뀐다.
 */
export type ControlMode = 'simple' | 'precise';
export const TURN_ZONE = { min: 0.12, move: 0.38 };

export interface SimpleState { facing: number; lock: number | null }
export const newSimpleState = (facing = -Math.PI / 2): SimpleState => ({ facing, lock: null });

export interface ControlOut { mx: number; my: number; aim: number; fire: boolean }

/** stick: 이동 스틱 값(-1..1), fire: 사격 버튼을 누르고 있는가. st 는 호출 사이에 유지한다 */
export function simpleControl(st: SimpleState, sx: number, sy: number, fire: boolean): ControlOut {
  const m = Math.hypot(sx, sy), dir = Math.atan2(sy, sx);
  if (!fire) st.lock = null;
  else if (st.lock === null) st.lock = st.facing;   // 누른 순간의 방향으로 잠근다
  let mx = 0, my = 0;
  if (m >= TURN_ZONE.move) {   // 이동: 잠겨 있지 않으면 몸이 이동 방향을 본다
    mx = sx / Math.max(1, m); my = sy / Math.max(1, m);
    if (st.lock === null) st.facing = dir;
  } else if (m >= TURN_ZONE.min) {   // 제자리 회전: 이동 없이 방향만 (사격 중이면 잠금 방향도 따라 돈다)
    st.facing = dir; if (st.lock !== null) st.lock = dir;
  }
  return { mx, my, aim: st.lock ?? st.facing, fire };
}

/** 정밀 모드: 조준 스틱 → 방향(0.2 이상) / 발사(0.3 이상). 조준 스틱을 놓으면 null */
export function preciseAim(ax: number, ay: number): { aim: number; fire: boolean } | null {
  const m = Math.hypot(ax, ay);
  if (m < 0.2) return null;
  return { aim: Math.atan2(ay, ax), fire: m >= 0.3 };
}
