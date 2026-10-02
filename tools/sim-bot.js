// 헤드리스 시뮬레이션 하네스 — 브라우저 javascript_tool(또는 DevTools 콘솔)에서 붙여넣어 실행.
// rAF를 가로채 루프를 동기적으로 돌리므로, 화면이 숨겨져 있어도 수 분치 플레이를 즉시 시뮬레이션할 수 있다.
// 실행 후에는 페이지를 새로고침할 것 (rAF를 덮어썼기 때문).
// 사용법: SIM = { maxSeconds: 480, startTier: 1 } 로 파라미터를 바꾼 뒤 아래 전체를 실행하면 결과 객체를 반환한다.
(() => {
  const P = Object.assign({ maxSeconds: 480, startTier: 1, bombPanic: 0.1 }, window.SIM || {});
  window.requestAnimationFrame = () => 1;
  restartGame();
  if (P.startTier > 1) { bossTier = P.startTier; bgTier = P.startTier; nextBossScore = score + 1; }
  const log = []; let f = 0, last = '';
  const MAXF = 60 * P.maxSeconds;
  function bot() {
    let tx = boss ? boss.x : (enemies[0] ? enemies[0].x : canvas.width / 2);
    let near = null, nd = 1e9;
    for (const b of enemyBullets) if (b.y < player.y - 10) { const d = Math.hypot(b.x - player.x, b.y - player.y); if (d < nd) { nd = d; near = b; } }
    if (near && nd < 110) tx = player.x + (near.x < player.x ? 60 : -60);
    player.targetX = Math.max(40, Math.min(canvas.width - 40, tx));
    player.targetY = canvas.height - 120; isFiring = true;
    if (nd < 60 && bombs > 0 && Math.random() < P.bombPanic) fireBomb();
  }
  while (f < MAXF && gameState === 'PLAYING') {
    bot(); loop(); f++;
    if (stagePhase !== last) { log.push(`${f}f(${(f / 60) | 0}s) ${stagePhase} stage${bossTier} score${score} hp${Math.round(player.energy)} lives${lives}`); last = stagePhase; }
  }
  return { seconds: +(f / 60).toFixed(1), state: gameState, stage: bossTier, score, log };
})();
