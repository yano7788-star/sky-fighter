import Phaser from 'phaser';
import { H, W } from '../core/config';
import { CARDS, lv, type Build, type CardId } from '../core/build';
import { FONT, textStyle } from './hud';
import { R } from './textures';

const CARD_W = 134, CARD_H = 214, GAP = 10;
const TOP = H * 0.22;

const hex = (c: string) => Phaser.Display.Color.HexStringToColor(c).color;

/** 레벨업 카드 선택 오버레이 (3장). 탭/클릭, 숫자키 1~3, 게임패드 좌우+A로 선택 */
export class LevelUpOverlay {
  private root: Phaser.GameObjects.Container;
  private g: Phaser.GameObjects.Graphics;
  private title: Phaser.GameObjects.Text;
  private hint: Phaser.GameObjects.Text;
  private buildTxt: Phaser.GameObjects.Text;
  private cardTexts: { icon: Phaser.GameObjects.Text; name: Phaser.GameObjects.Text; lvl: Phaser.GameObjects.Text; desc: Phaser.GameObjects.Text; tag: Phaser.GameObjects.Text }[] = [];
  private cards: CardId[] = [];
  private selected = 1;
  visible = false;

  constructor(scene: Phaser.Scene, ui: Phaser.GameObjects.Container) {
    this.root = scene.add.container(0, 0).setVisible(false);
    ui.add(this.root);
    const dim = scene.add.rectangle(0, 0, W, H, 0x03050a, 0.82).setOrigin(0, 0);
    this.g = scene.add.graphics();
    this.title = scene.add.text(W / 2, TOP - 54, 'LEVEL UP!', textStyle(32, '#fde047')).setOrigin(0.5).setShadow(0, 0, '#f59e0b', 14, true, true);
    this.hint = scene.add.text(W / 2, TOP - 22, '강화할 카드를 선택하세요', textStyle(13, '#94a3b8', false)).setOrigin(0.5);
    this.buildTxt = scene.add.text(W / 2, TOP + CARD_H + 30, '', { ...textStyle(12, '#94a3b8', false), align: 'center', wordWrap: { width: W - 50 }, lineSpacing: 6 }).setOrigin(0.5, 0);
    this.root.add([dim, this.g, this.title, this.hint, this.buildTxt]);
    for (let i = 0; i < 3; i++) {
      const x = this.cardX(i) + CARD_W / 2;
      const t = {
        icon: scene.add.text(x, TOP + 36, '', { fontFamily: FONT, fontSize: '40px', fontStyle: 'bold', color: '#fff', resolution: R }).setOrigin(0.5),
        name: scene.add.text(x, TOP + 82, '', textStyle(15, '#f8fafc')).setOrigin(0.5),
        lvl: scene.add.text(x, TOP + 104, '', textStyle(11, '#94a3b8', false)).setOrigin(0.5),
        desc: scene.add.text(x, TOP + 124, '', { ...textStyle(11.5, '#cbd5e1', false), align: 'center', wordWrap: { width: CARD_W - 18 }, lineSpacing: 3 }).setOrigin(0.5, 0),
        tag: scene.add.text(x, TOP + CARD_H - 16, '', textStyle(11, '#fde047')).setOrigin(0.5),
      };
      this.cardTexts.push(t); this.root.add([t.icon, t.name, t.lvl, t.desc, t.tag]);
    }
  }

  private cardX(i: number): number { return (W - (CARD_W * 3 + GAP * 2)) / 2 + i * (CARD_W + GAP); }

  show(cards: CardId[], build: Build): void {
    const relic = CARDS[cards[0]]?.kind === 'relic';
    this.title.setText(relic ? 'RELIC GET!' : 'LEVEL UP!').setColor(relic ? '#f0abfc' : '#fde047');
    this.hint.setText(relic ? '보스 격파 보상: 유물을 하나 고르세요 (이번 런 내내 적용)' : '강화할 카드를 선택하세요');
    this.cards = cards; this.visible = true; this.selected = Math.min(1, cards.length - 1);
    this.root.setVisible(true);
    cards.forEach((id, i) => {
      const c = CARDS[id], cur = lv(build, id), t = this.cardTexts[i];
      const fusion = c.kind === 'fusion' || c.kind === 'relic';
      t.icon.setText(c.icon).setColor(c.color).setVisible(true);
      t.name.setText(c.name).setVisible(true);
      t.lvl.setText(c.kind === 'relic' ? '유물' : fusion ? '진화' : cur === 0 ? 'NEW' : `Lv ${cur} → ${cur + 1}`).setColor(cur === 0 || fusion ? '#fde047' : '#94a3b8').setVisible(true);
      t.desc.setText(c.desc(cur + 1)).setVisible(true);
      t.tag.setText(c.kind === 'relic' ? '★ RELIC ★' : fusion ? '★ FUSION ★' : c.kind === 'module' ? '무기 모듈' : '패시브').setColor(fusion ? '#fde047' : '#64748b').setVisible(true);
    });
    for (let i = cards.length; i < 3; i++) Object.values(this.cardTexts[i]).forEach(o => o.setVisible(false));
    const owned = (Object.keys(CARDS) as CardId[]).filter(id => lv(build, id) > 0).map(id => `${CARDS[id].name} ${CARDS[id].kind === 'fusion' || CARDS[id].kind === 'relic' ? '★' : `Lv${lv(build, id)}`}`);
    this.buildTxt.setText(owned.length ? `내 빌드: ${owned.join('  ·  ')}` : '');
  }

  hide(): void { this.visible = false; this.root.setVisible(false); }

  /** 좌표 아래의 카드 번호 (없으면 -1) */
  hit(x: number, y: number): number {
    if (!this.visible) return -1;   // 오버레이가 보이기 전(히트스톱 중)의 보이지 않는 탭 방지
    for (let i = 0; i < this.cards.length; i++) {
      const cx = this.cardX(i);
      if (x >= cx && x <= cx + CARD_W && y >= TOP && y <= TOP + CARD_H) return i;
    }
    return -1;
  }
  count(): number { return this.cards.length; }
  getSelected(): number { return this.selected; }
  moveSelection(d: number): void { this.selected = (this.selected + d + this.cards.length) % this.cards.length; }
  select(i: number): void { if (i >= 0 && i < this.cards.length) this.selected = i; }

  /** 매 프레임: 카드 패널 그리기 (선택 하이라이트·융합 카드 펄스) */
  update(time: number): void {
    if (!this.visible) return;
    const g = this.g; g.clear();
    this.cards.forEach((id, i) => {
      const c = CARDS[id], x = this.cardX(i), fusion = c.kind === 'fusion' || c.kind === 'relic', sel = i === this.selected;
      const col = hex(c.color), pulse = 0.5 + Math.sin(time * 0.008) * 0.5;
      g.fillStyle(0x0b1220, 0.96); g.fillRoundedRect(x, TOP, CARD_W, CARD_H, 12);
      g.fillStyle(col, 0.12); g.fillRoundedRect(x, TOP, CARD_W, 70, { tl: 12, tr: 12, bl: 0, br: 0 });
      g.lineStyle(sel ? 3.5 : 2, fusion ? 0xfde047 : col, fusion ? 0.6 + pulse * 0.4 : sel ? 1 : 0.6);
      g.strokeRoundedRect(x, TOP, CARD_W, CARD_H, 12);
      if (sel) { g.lineStyle(1.5, 0xffffff, 0.25 + pulse * 0.25); g.strokeRoundedRect(x - 4, TOP - 4, CARD_W + 8, CARD_H + 8, 15); }
    });
  }
}
