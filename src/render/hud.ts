import Phaser from 'phaser';
import { H, PHASE_FRAMES, W } from '../core/config';
import { BOSS_CONFIGS } from '../core/data';
import { mutatorOf } from '../core/mutators';
import type { Sim } from '../core/sim';
import { contentCenter, R } from './textures';

export const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
export const textStyle = (size: number, color: string, bold = true): Phaser.Types.GameObjects.Text.TextStyle => ({
  fontFamily: FONT, fontSize: `${size}px`, fontStyle: bold ? 'bold' : 'normal', color, resolution: R,
});

// UI 버튼 판정 영역 (논리 좌표)
export const UI = {
  sound: { x: W - 45, y: 30, hit: 30 },
  pause: { x: W - 95, y: 30, hit: 24 },
  bomb:  { x: W - 55, y: H - 65, hit: 45 },
  ult:   { x: 44, y: H - 52, hit: 32 },     // 필살기 (게이지 링)
  cat:   { x: 104, y: H - 50, hit: 28 },    // 동료: 고양이(흡혈)
  dog:   { x: 154, y: H - 50, hit: 28 },    // 동료: 강아지(방어막)
};
export const inZone = (z: { x: number; y: number; hit: number }, x: number, y: number) => Math.hypot(x - z.x, y - z.y) < z.hit;
/** 동료 버튼은 보유/사용 중일 때만 존재한다 (없을 땐 이동·발사 입력을 막지 않는다) */
export const companionZoneActive = (sim: Sim, key: 'cat' | 'dog') => sim.comp[key].ready || sim.comp[key].active;
export const isUiZone = (x: number, y: number, sim?: Sim) =>
  inZone(UI.sound, x, y) || inZone(UI.pause, x, y) || inZone(UI.bomb, x, y) || inZone(UI.ult, x, y) ||
  (inZone(UI.cat, x, y) && (!sim || companionZoneActive(sim, 'cat'))) || (inZone(UI.dog, x, y) && (!sim || companionZoneActive(sim, 'dog')));

const bannerAlpha = (t: number, total: number, fadeIn = 18, fadeOut = 24) => Math.max(0, Math.min(1, t / fadeIn, (total - t) / fadeOut));

/** 미션 클리어 화면의 버튼 판정 영역 (무한 모드 계속 / 타이틀로) */
export const RESULT_BTN = { cont: { x: W / 2, y: H / 2 + 172, w: 300, h: 46 }, title: { x: W / 2, y: H / 2 + 228, w: 300, h: 40 } };
/** 일시정지 메뉴 버튼: 계속하기 / 메인 화면으로(두 번 눌러 확인) */
export const PAUSE_BTN = { resume: { x: W / 2, y: H / 2 - 56, w: 250, h: 42 }, quit: { x: W / 2, y: H / 2 - 4, w: 250, h: 42 } };
export const inRect = (z: { x: number; y: number; w: number; h: number }, x: number, y: number) => Math.abs(x - z.x) < z.w / 2 && Math.abs(y - z.y) < z.h / 2;

export interface ResultInfo { newAch?: string[]; dailyBest?: number; kind: 'GAMEOVER' | 'GAMECLEAR'; score: number; stage: number; level: number; credits: number; best: { score: number; stage: number }; newRecord: boolean; }

/** 게임 화면 HUD: 에너지 바·점수·폭탄·보스 바·배너·일시정지/결과 오버레이 */
export class Hud {
  daily = false;   // 일일 도전 중이면 모디파이어 배지 앞에 표시
  private displayEnergy = 100;
  private displayHp = 0;
  private hitFlash = 0;
  private whiteFlash = 0;

  private g: Phaser.GameObjects.Graphics;       // 에너지/보스 바
  private t: Record<string, Phaser.GameObjects.Text> = {};
  private bombImg: Phaser.GameObjects.Image;
  private bombCenter: { x: number; y: number };
  private hitRect: Phaser.GameObjects.Rectangle;
  private whiteRect: Phaser.GameObjects.Rectangle;
  private warnRect: Phaser.GameObjects.Rectangle;
  private pauseGroup: Phaser.GameObjects.GameObject[] = [];
  private pauseQuit!: Phaser.GameObjects.Text;
  private resultGroup: Phaser.GameObjects.GameObject[] = [];
  private resultTexts: Record<string, Phaser.GameObjects.Text> = {};
  private resultG!: Phaser.GameObjects.Graphics;
  private buildText!: Phaser.GameObjects.Text;
  private btn: { ult: Phaser.GameObjects.Image; cat: Phaser.GameObjects.Image; dog: Phaser.GameObjects.Image } | null = null;

  constructor(private scene: Phaser.Scene, ui: Phaser.GameObjects.Container) {
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => { ui.add(o); return o; };
    const text = (key: string, x: number, y: number, size: number, color: string, ox = 0, oy = 0, bold = true) => {
      this.t[key] = add(scene.add.text(x, y, '', textStyle(size, color, bold)).setOrigin(ox, oy));
      return this.t[key];
    };

    this.g = add(scene.add.graphics());
    this.bombCenter = contentCenter(scene, 'bomb');
    this.bombImg = add(scene.add.image(UI.bomb.x, UI.bomb.y, 'bomb').setDisplaySize(70, 70));
    text('bombCount', 0, 0, 22, '#ffffff', 0.5, 0.5).setShadow(0, 0, '#000', 4, true, true);

    text('eng', 23, 66, 11, '#94a3b8', 0.5, 1);
    text('engPct', 23, 78, 12, '#f8fafc', 0.5, 1);
    text('score', 50, 34, 16, '#f8fafc', 0, 1);
    text('best', 50, 49, 11, '#64748b', 0, 1);
    text('stage', W / 2, 34, 18, '#38bdf8', 0.5, 1);
    text('missile', 50, 66, 12, '#ec4899', 0, 1);
    text('combo', 50, 84, 13, '#facc15', 0, 1).setShadow(0, 0, '#000', 4, true, true);
    text('level', W / 2, 50, 12, '#7dd3fc', 0.5, 1);
    text('mut', W / 2, 63, 10.5, '#fbbf24', 0.5, 1);
    this.btn = {
      ult: add(scene.add.image(UI.ult.x, UI.ult.y, 'skill_palm').setDisplaySize(30, 36)),
      cat: add(scene.add.image(UI.cat.x, UI.cat.y, 'ally_cat').setDisplaySize(30, 28)),
      dog: add(scene.add.image(UI.dog.x, UI.dog.y, 'ally_dog').setDisplaySize(30, 28)),
    };
    text('ultLabel', UI.ult.x, UI.ult.y + 36, 9, '#fde68a', 0.5, 0.5);
    text('catLabel', UI.cat.x, UI.cat.y + 32, 9, '#fb7185', 0.5, 0.5);
    text('dogLabel', UI.dog.x, UI.dog.y + 32, 9, '#fb923c', 0.5, 0.5);
    text('mute', W - 25, 36, 18, '#38bdf8', 1, 1, false);
    text('lives', W - 20, 65, 18, '#f43f5e', 1, 1, false);
    text('bossName', 0, 0, 11, '#ffffff', 0.5, 1);
    text('phase2', W / 2, H * 0.38, 20, '#ef4444', 0.5, 0.5).setShadow(0, 0, '#000', 6, true, true);

    // 일시정지 버튼 아이콘
    const pb = scene.add.graphics();
    pb.lineStyle(1.5, 0x94a3b8, 0.7); pb.strokeCircle(UI.pause.x, UI.pause.y, 15);
    pb.fillStyle(0xcbd5e1, 1); pb.fillRect(UI.pause.x - 5, 23, 3.5, 14); pb.fillRect(UI.pause.x + 1.5, 23, 3.5, 14);
    add(pb);

    // 배너 (WARNING / CLEAR / INTRO)
    this.warnRect = add(scene.add.rectangle(0, 0, W, H, 0xef4444, 0).setOrigin(0, 0));
    const shadow = (tx: Phaser.GameObjects.Text) => tx.setShadow(0, 0, '#000', 10, true, true);
    shadow(text('bannerMain', W / 2, H * 0.36, 30, '#fff', 0.5, 0.5));
    shadow(text('bannerSub', W / 2, H * 0.36 + 34, 16, '#fff', 0.5, 0.5));

    // 플래시
    this.hitRect = add(scene.add.rectangle(0, 0, W, H, 0xef4444, 0).setOrigin(0, 0));
    this.whiteRect = add(scene.add.rectangle(0, 0, W, H, 0xffffff, 0).setOrigin(0, 0));

    this.buildPause(add);
    this.buildResult(add);
  }

  private buildPause(add: <T extends Phaser.GameObjects.GameObject>(o: T) => T): void {
    const s = this.scene;
    this.pauseGroup = [
      add(s.add.rectangle(0, 0, W, H, 0x03050a, 0.72).setOrigin(0, 0)),
      add(s.add.text(W / 2, H / 2 - 120, 'PAUSED', textStyle(34, '#38bdf8')).setOrigin(0.5)),
      add(s.add.text(W / 2, H / 2 - 84, '버튼 밖을 탭하거나 P / ESC 로 계속', textStyle(13, '#94a3b8', false)).setOrigin(0.5)),
      add(s.add.text(W / 2, H / 2 + 44, '이동 방향키·WASD / 발사 Space / 폭탄 B · 필살기 R · 동료 Q/E · 음소거 M', textStyle(11, '#64748b', false)).setOrigin(0.5)),
    ];
    const g = add(s.add.graphics()), r = PAUSE_BTN.resume, q = PAUSE_BTN.quit;
    g.fillStyle(0x0c4a6e, 0.8); g.fillRoundedRect(r.x - r.w / 2, r.y - r.h / 2, r.w, r.h, 12); g.lineStyle(2, 0x38bdf8, 1); g.strokeRoundedRect(r.x - r.w / 2, r.y - r.h / 2, r.w, r.h, 12);
    g.fillStyle(0x1e293b, 0.9); g.fillRoundedRect(q.x - q.w / 2, q.y - q.h / 2, q.w, q.h, 12); g.lineStyle(2, 0x64748b, 1); g.strokeRoundedRect(q.x - q.w / 2, q.y - q.h / 2, q.w, q.h, 12);
    this.pauseGroup.push(g, add(s.add.text(r.x, r.y, '▶ 계속하기', textStyle(18, '#f8fafc')).setOrigin(0.5)));
    this.pauseQuit = add(s.add.text(q.x, q.y, '', textStyle(16, '#cbd5e1')).setOrigin(0.5)); this.pauseGroup.push(this.pauseQuit);
    this.setPauseConfirm(false);
    this.buildText = add(s.add.text(W / 2, H / 2 + 80, '', { ...textStyle(13, '#94a3b8', false), align: 'center', wordWrap: { width: W - 60 }, lineSpacing: 6 }).setOrigin(0.5, 0));
    this.pauseGroup.push(this.buildText);
    this.pauseGroup.forEach(o => (o as unknown as Phaser.GameObjects.Components.Visible).setVisible(false));
  }

  private buildResult(add: <T extends Phaser.GameObjects.GameObject>(o: T) => T): void {
    const s = this.scene;
    const mk = (key: string, y: number, size: number) => {
      const tx = add(s.add.text(W / 2, y, '', textStyle(size, '#fff')).setOrigin(0.5));
      this.resultTexts[key] = tx; this.resultGroup.push(tx);
    };
    this.resultGroup.push(add(s.add.rectangle(0, 0, W, H, 0x03050a, 0.9).setOrigin(0, 0)));
    this.resultTexts.dim = this.resultGroup[0] as Phaser.GameObjects.Text;
    mk('ach', H / 2 - 84, 14); mk('title', H / 2 - 40, 34); mk('l1', H / 2 + 8, 20); mk('l2', H / 2 + 42, 22); mk('l3', H / 2 + 76, 22);
    mk('record', H / 2 + 110, 16); mk('credits', H / 2 + 138, 15); mk('prompt', H / 2 + 176, 16);
    this.resultG = add(s.add.graphics()); this.resultGroup.push(this.resultG);
    mk('btnC', RESULT_BTN.cont.y, 19); mk('btnT', RESULT_BTN.title.y, 15);
    this.resultGroup.forEach(o => (o as unknown as Phaser.GameObjects.Components.Visible).setVisible(false));
  }

  flash(kind: 'hit' | 'bomb' | 'respawn' | 'bossDeath' | 'enrage', v: number): void {
    if (kind === 'hit') this.hitFlash = Math.max(this.hitFlash, v);
    else this.whiteFlash = Math.max(this.whiteFlash, v);
  }

  resetState(sim: Sim): void {
    this.displayEnergy = sim.player.energy; this.displayHp = 0; this.hitFlash = 0; this.whiteFlash = 0;
  }

  /** 60Hz 틱: 표시 값 보간 + 플래시 감쇠 */
  tick(sim: Sim): void {
    this.displayEnergy += (sim.player.energy - this.displayEnergy) * 0.15;
    if (sim.boss) {
      if (this.displayHp === 0 && sim.boss.hp === sim.boss.maxHp) this.displayHp = sim.boss.maxHp;
      this.displayHp += (sim.boss.hp - this.displayHp) * 0.15;
    } else this.displayHp = 0;
    this.hitFlash = Math.max(0, this.hitFlash - 0.05);
    this.whiteFlash = Math.max(0, this.whiteFlash - 0.04);
  }

  setBuildText(t: string): void { this.buildText.setText(t); }

  /** 메인 화면으로 버튼: 한 번 누르면 확인 문구, 두 번째에 실행 */
  setPauseConfirm(on: boolean): void { this.pauseQuit.setText(on ? '정말 나갈까요? 한 번 더 누르세요' : '⌂ 메인 화면으로').setColor(on ? '#fca5a5' : '#cbd5e1'); }

  setPaused(v: boolean): void { this.pauseGroup.forEach(o => (o as unknown as Phaser.GameObjects.Components.Visible).setVisible(v)); }

  showResult(r: ResultInfo | null, canTap = false): void {
    const show = !!r;
    this.resultGroup.forEach(o => (o as unknown as Phaser.GameObjects.Components.Visible).setVisible(show));
    if (!r) return;
    const t = this.resultTexts;
    const over = r.kind === 'GAMEOVER';
    t.title.setText(over ? 'MISSION OVER' : 'MISSION CLEAR!').setColor(over ? '#f87171' : '#10b981');
    t.ach.setText(r.newAch && r.newAch.length ? '🏆 ' + r.newAch.join(' · ') : '').setColor('#fbbf24');
    t.l1.setText(over ? '' : '지구의 평화를 지켰습니다.').setColor('#facc15');
    t.l2.setText(`최종 점수: ${r.score}`).setColor('#fff');
    t.l3.setText(over ? `최종 도달: STAGE ${r.stage}  ·  LV ${r.level}` : `LV ${r.level}`).setColor('#fff');
    t.credits.setText(`+${r.credits} CREDITS  (격납고에서 강화)`).setColor('#7dd3fc');
    t.record.setText(r.dailyBest !== undefined ? `📅 오늘의 최고 ${r.dailyBest}${r.newRecord ? '  ★ NEW RECORD!' : ''}` : r.newRecord ? '★ NEW RECORD! ★' : `BEST ${r.best.score} (STAGE ${r.best.stage})`).setColor(r.newRecord ? '#facc15' : '#94a3b8');
    t.prompt.setText('화면을 탭하여 다시 출격').setColor(canTap ? '#38bdf8' : '#94a3b8').setVisible(over);
    // 미션 클리어: [무한 모드 계속] [타이틀로] 두 버튼
    const g = this.resultG; g.clear(); g.setVisible(!over);
    t.btnC.setVisible(!over).setText('∞ 무한 모드 계속').setColor(canTap ? '#0b1220' : '#475569');
    t.btnT.setVisible(!over).setText('타이틀로').setColor(canTap ? '#cbd5e1' : '#64748b');
    if (!over) {
      const c = RESULT_BTN.cont, tt = RESULT_BTN.title;
      g.fillStyle(canTap ? 0xfde047 : 0x334155, 1); g.fillRoundedRect(c.x - c.w / 2, c.y - c.h / 2, c.w, c.h, 12);
      g.lineStyle(2, canTap ? 0x64748b : 0x334155, 1); g.strokeRoundedRect(tt.x - tt.w / 2, tt.y - tt.h / 2, tt.w, tt.h, 10);
    }
  }

  private setText(key: string, v: string): Phaser.GameObjects.Text {
    const tx = this.t[key];
    if (tx.text !== v) tx.setText(v);
    return tx;
  }

  /** 렌더 프레임마다 호출 */
  render(sim: Sim, bestScore: number, muted: boolean): void {
    const p = sim.player, g = this.g;
    g.clear();

    // 1. 에너지 바
    const barX = 16, barY = 80, barW = 14, barH = 150;
    const ratio = Math.max(0, Math.min(1, this.displayEnergy / p.maxEnergy)), fillH = barH * ratio;
    const eColor = p.energy <= 25 ? (sim.frame % 8 < 4 ? 0xef4444 : 0xfee2e2) : p.energy <= 55 ? 0xf59e0b : 0x10b981;
    g.fillStyle(0x0f172a, 0.75); g.fillRoundedRect(barX, barY, barW, barH, 7);
    if (fillH > 4) { g.fillStyle(eColor, 1); g.fillRoundedRect(barX + 2, barY + (barH - fillH) + 2, barW - 4, fillH - 4, 5); }
    g.lineStyle(1.5, eColor, 1); g.strokeRoundedRect(barX, barY, barW, barH, 7);
    this.setText('eng', 'ENG'); this.setText('engPct', `${Math.round(p.energy)}%`);

    // 2. 폭탄 버튼
    this.bombImg.setAlpha(sim.bombs > 0 ? 1 : 0.4);
    const bc = this.bombCenter;
    this.t.bombCount.setPosition(UI.bomb.x + (bc.x - 0.5) * 70, UI.bomb.y + (bc.y - 0.5) * 70).setAlpha(sim.bombs > 0 ? 1 : 0.4);
    this.setText('bombCount', `x${sim.bombs}`);

    // 3. 상단 UI
    this.setText('score', `SCORE ${sim.score}`);
    this.setText('best', `BEST ${Math.max(bestScore, sim.score)}`);
    this.setText('stage', `STAGE ${sim.bossTier}`);
    const buffs: string[] = [];
    if (sim.hasHomingMissile) buffs.push(`MISSILE ${Math.ceil(sim.missileTimer / 60)}s`);
    if (p.shield > 0) buffs.push('SHIELD');
    if (p.magnet > 0) buffs.push(`MAGNET ${Math.ceil(p.magnet / 60)}s`);
    this.setText('missile', buffs.join('  ·  '));
    this.setText('combo', sim.combo >= 2 ? `COMBO ${sim.combo}  ×${sim.multiplier.toFixed(2).replace(/.?0+$/, '')}` : '');
    this.setText('mute', muted ? '🔇' : '🔊').setColor(muted ? '#64748b' : '#38bdf8');
    this.setText('lives', '♥ '.repeat(sim.lives));

    // 4. 보스 체력 바
    const b = sim.boss;
    if (b) {
      const bx = 70, bw = W - 96, by = 96;
      g.fillStyle(0x0f172a, 0.8); g.fillRect(bx, by, bw, 12);
      const col = b.phase2 ? (sim.frame % 6 < 3 ? 0xef4444 : 0xf59e0b) : Phaser.Display.Color.HexStringToColor(b.color).color;
      g.fillStyle(col, 1); g.fillRect(bx, by, bw * Math.max(0, this.displayHp / b.maxHp), 12);
      g.lineStyle(1.5, Phaser.Display.Color.HexStringToColor(b.phase2 ? '#f87171' : b.subColor).color, 1); g.strokeRect(bx, by, bw, 12);
      this.t.bossName.setPosition(bx + bw / 2, by - 3);
      this.setText('bossName', `${b.name}${b.phase3 ? ' [FINAL PHASE]' : b.phase2 ? ' [PHASE 2]' : ''} (${Math.max(0, b.hp)} / ${b.maxHp})`);
      const a3 = (b.phase3Alert ?? 0) > 0, alert = b.phase2Alert > 0 || a3;
      this.t.phase2.setVisible(alert);
      if (alert) { this.setText('phase2', a3 ? '☠ FINAL PHASE ☠' : '⚡ PHASE 2: OVERDRIVE ⚡').setColor(sim.frame % 8 < 4 ? (a3 ? '#e879f9' : '#ef4444') : '#facc15'); }
    } else { this.setText('bossName', ''); this.t.phase2.setVisible(false); }

    // 4-2. 경험치 바(상단 가로줄) + 레벨
    const xr = Math.max(0, Math.min(1, sim.xp / sim.xpNext));
    g.fillStyle(0x0f172a, 0.7); g.fillRect(0, 0, W, 5);
    g.fillStyle(0x22d3ee, 1); g.fillRect(0, 0, W * xr, 5);
    this.setText('level', `LV ${sim.level}`);
    const md = mutatorOf(sim.meta.mutator);
    this.setText('mut', (this.daily ? '📅 ' : '') + (md ? `${md.icon} ${md.name}` : '')).setColor(md?.color ?? '#fbbf24');

    // 4-3. 스킬 버튼 (필살기 게이지 링 / 동료)
    this.renderSkillButtons(sim);

    // 5. 스테이지 배너
    this.renderBanner(sim);

    this.hitRect.setAlpha(this.hitFlash * 0.5);
    this.whiteRect.setAlpha(Math.min(1, this.whiteFlash));
  }

  private renderSkillButtons(sim: Sim): void {
    const g = this.g, f = sim.frame, b = this.btn!;
    const canAct = sim.stagePhase !== 'BOSS_DYING' && sim.stagePhase !== 'CLEAR';
    const pulse = 0.5 + 0.5 * Math.sin(f * 0.14);

    // 필살기: 항상 표시. 게이지가 차오르고, 가득 차면 빛난다
    const u = UI.ult, ur = 25, frac = Math.min(1, sim.ult.gauge / 100), ready = sim.ultReady;
    g.fillStyle(0x0f172a, 0.78); g.fillCircle(u.x, u.y, ur);
    g.lineStyle(3, 0x334155, 0.9); g.strokeCircle(u.x, u.y, ur - 2);
    if (frac > 0) { g.lineStyle(3.5, ready ? 0x67e8f9 : 0x22d3ee, ready ? 0.7 + pulse * 0.3 : 0.95); g.beginPath(); g.arc(u.x, u.y, ur - 2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac); g.strokePath(); }
    if (ready) { g.lineStyle(2, 0xa5f3fc, 0.3 + pulse * 0.4); g.strokeCircle(u.x, u.y, ur + 3 + pulse * 3); }
    b.ult.setAlpha(ready ? (canAct ? 1 : 0.45) : 0.35);
    this.setText('ultLabel', ready ? '필살기!' : `${Math.floor(sim.ult.gauge)}%`).setColor(ready ? '#fde68a' : '#64748b');

    // 동료: 보유(펄스 링) → 사용 중(남은 시간 링) → 사용 후 숨김
    const comp: ['cat' | 'dog', typeof UI.cat, number, string][] = [['cat', UI.cat, 0xfb7185, '흡혈'], ['dog', UI.dog, 0xfb923c, '방어막']];
    for (const [key, z, color, label] of comp) {
      const c = sim.comp[key], show = c.ready || c.active;
      b[key].setVisible(show); this.t[key + 'Label'].setVisible(show);
      if (!show) continue;
      const r = 21;
      g.fillStyle(0x0f172a, 0.78); g.fillCircle(z.x, z.y, r);
      if (c.active) {
        g.lineStyle(3, 0x334155, 0.6); g.strokeCircle(z.x, z.y, r - 2);
        g.lineStyle(3.5, color, 1); g.beginPath(); g.arc(z.x, z.y, r - 2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (c.timer / 480)); g.strokePath();
        this.setText(key + 'Label', `${Math.ceil(c.timer / 60)}s`).setColor('#ffffff');
      } else {
        g.lineStyle(2.5, color, 0.6 + pulse * 0.4); g.strokeCircle(z.x, z.y, r - 2 + pulse * 1.5);
        this.setText(key + 'Label', label).setColor('#' + color.toString(16).padStart(6, '0'));
      }
      b[key].setAlpha(c.active || canAct ? 1 : 0.4);
    }
  }

  private renderBanner(sim: Sim): void {
    const main = this.t.bannerMain, sub = this.t.bannerSub;
    const ph = sim.stagePhase;
    this.warnRect.setFillStyle(0xef4444, 0);
    if (ph !== 'WARNING' && ph !== 'CLEAR' && ph !== 'INTRO') { main.setVisible(false); sub.setVisible(false); return; }
    main.setVisible(true); sub.setVisible(true);
    if (ph === 'WARNING') {
      const total = PHASE_FRAMES.WARNING, t = total - sim.phaseTimer, a = bannerAlpha(t, total, 12, 20);
      this.warnRect.setFillStyle(0xef4444, (0.06 + 0.05 * Math.sin(sim.frame * 0.25)) * a);
      main.setAlpha(a).setFontSize(30).setColor('#ef4444').setText('⚠ WARNING ⚠').setVisible(Math.floor(sim.frame / 10) % 2 === 0);
      sub.setAlpha(a).setColor('#fca5a5').setText(BOSS_CONFIGS[sim.stageTier].name.replace(/STAGE \d+/, 'STAGE ' + sim.bossTier));
    } else if (ph === 'CLEAR') {
      const total = PHASE_FRAMES.CLEAR, a = bannerAlpha(total - sim.phaseTimer, total, 15, 25);
      main.setAlpha(a).setFontSize(34).setColor('#10b981').setText(`STAGE ${sim.bossTier} CLEAR!`);
      sub.setAlpha(a).setColor('#facc15').setText(`BOSS BONUS +${sim.clearBonus}${sim.stageRank ? `  ·  RANK ${sim.stageRank}` : ''}`).setPosition(W / 2, H * 0.36 + 36);
    } else {
      const total = PHASE_FRAMES.INTRO - 15, t = PHASE_FRAMES.INTRO - sim.phaseTimer - 15;   // 배경이 바뀌기 시작한 뒤에 등장
      const cfg = BOSS_CONFIGS[sim.stageTier], a = bannerAlpha(t, total, 20, 30);
      main.setAlpha(a).setFontSize(40).setColor(cfg.subColor).setText(`STAGE ${sim.bossTier}`);
      sub.setAlpha(a).setColor('#e2e8f0').setText(cfg.name.replace(/^STAGE \d+:\s*/, '')).setPosition(W / 2, H * 0.36 + 34);
    }
  }
}

