import { store } from './storage';

export type SfxName = 'laser' | 'missile' | 'boom' | 'enrage' | 'item' | 'heal';
export type BgmName = 'normal' | 'boss';

const BASE = import.meta.env.BASE_URL;
const BGM_TRACKS: Record<BgmName, { src: string; vol: number; loopEnd: number }> = {
  normal: { src: `${BASE}assets/audio/under_heavy_fire.mp3`, vol: 0.25, loopEnd: 175.3 },   // loopEnd: 끝부분 무음 구간 건너뛰기
  boss:   { src: `${BASE}assets/audio/titan_at_the_gate.mp3`, vol: 0.28, loopEnd: 0 },
};

/**
 * 오디오 전체를 Phaser와 독립적으로 관리한다.
 *  - 효과음: WebAudio 합성음 (파일 없음)
 *  - BGM: HTMLAudio 스트리밍 mp3 (디코딩 메모리를 쓰지 않아 모바일에 유리), 일반/보스 크로스페이드
 */
class AudioSystem {
  muted: boolean = !!store.get('muted', false);
  private ctx: AudioContext | null = null;
  private els: Partial<Record<BgmName, HTMLAudioElement & { failed?: boolean }>> = {};
  private unlocked = false;
  private lastPlayed: Partial<Record<SfxName, number>> = {};
  private suspended = false;

  /** 반드시 사용자 제스처(터치/클릭/키 입력) 안에서 호출 — 자동재생 제한 해제 */
  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx && this.ctx.state === 'suspended' && !this.suspended) void this.ctx.resume();
    if (!this.unlocked) {
      this.unlocked = true;
      const n = this.get('normal'); this.play(n);
    }
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    store.set('muted', this.muted);
    return this.muted;
  }

  // ---------------------------------------------------------------- 효과음
  sfx(name: SfxName): void {
    const ctx = this.ctx;
    if (!ctx || this.muted || this.suspended || ctx.state !== 'running') return;
    const now = performance.now();
    if (now - (this.lastPlayed[name] ?? 0) < 35) return;    // 같은 소리 폭주 방지
    this.lastPlayed[name] = now;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    const f = osc.frequency, g = gain.gain;
    const exp = (to: number, dur: number) => f.exponentialRampToValueAtTime(to, t + dur);
    switch (name) {
      case 'laser':   osc.type = 'square';   f.setValueAtTime(820, t); exp(200, 0.07);  g.setValueAtTime(0.08, t); g.exponentialRampToValueAtTime(0.01, t + 0.07); osc.start(t); osc.stop(t + 0.07); break;
      case 'missile': osc.type = 'sawtooth'; f.setValueAtTime(280, t); exp(600, 0.1);   g.setValueAtTime(0.1, t);  g.exponentialRampToValueAtTime(0.01, t + 0.1);  osc.start(t); osc.stop(t + 0.1);  break;
      case 'boom':    osc.type = 'sawtooth'; f.setValueAtTime(140, t); exp(30, 0.4);    g.setValueAtTime(0.4, t);  g.exponentialRampToValueAtTime(0.01, t + 0.4);  osc.start(t); osc.stop(t + 0.4);  break;
      case 'enrage':  osc.type = 'sawtooth'; f.setValueAtTime(180, t); f.linearRampToValueAtTime(540, t + 0.35); g.setValueAtTime(0.35, t); g.exponentialRampToValueAtTime(0.01, t + 0.4); osc.start(t); osc.stop(t + 0.4); break;
      case 'item':    osc.type = 'sine';     f.setValueAtTime(440, t); exp(1100, 0.16); g.setValueAtTime(0.18, t); g.exponentialRampToValueAtTime(0.01, t + 0.16); osc.start(t); osc.stop(t + 0.16); break;
      case 'heal':    osc.type = 'sine';     f.setValueAtTime(300, t); exp(800, 0.25);  g.setValueAtTime(0.2, t);  g.exponentialRampToValueAtTime(0.01, t + 0.25); osc.start(t); osc.stop(t + 0.25); break;
    }
  }

  // ---------------------------------------------------------------- BGM
  private get(name: BgmName): HTMLAudioElement & { failed?: boolean } {
    let el = this.els[name];
    if (!el) {
      el = new Audio(BGM_TRACKS[name].src) as HTMLAudioElement & { failed?: boolean };
      el.loop = true; el.volume = 0; el.preload = 'auto';
      el.addEventListener('error', () => { el!.failed = true; });
      this.els[name] = el;
    }
    return el;
  }
  private play(el: HTMLAudioElement): void {
    const p = el.play();
    if (p && p.catch) p.catch(() => { /* 자동재생 차단 — 다음 사용자 입력에서 다시 시도 */ });
  }

  /** 매 틱(60Hz) 호출: want 트랙으로 크로스페이드, null이면 페이드아웃 */
  updateMusic(want: BgmName | null): void {
    if (!this.unlocked || this.suspended) return;
    if (want === 'boss' && this.els.boss?.failed) want = 'normal';
    for (const name of Object.keys(BGM_TRACKS) as BgmName[]) {
      const cfg = BGM_TRACKS[name];
      if (name === want && !this.els[name]) this.get(name);
      const el = this.els[name];
      if (!el || el.failed) continue;
      const target = name === want && !this.muted ? cfg.vol : 0;
      const dv = target - el.volume;
      el.volume = Math.max(0, Math.min(1, el.volume + dv * 0.06 + Math.sign(dv) * 0.002));
      if (target > 0 && el.paused) this.play(el);
      if (target === 0 && el.volume < 0.01 && !el.paused) el.pause();
      if (cfg.loopEnd && el.currentTime > cfg.loopEnd) el.currentTime = 0;
    }
  }

  rewind(): void { for (const el of Object.values(this.els)) { try { el.currentTime = 0; } catch { /* 메타데이터 로딩 전 */ } } }

  /** 일시정지: 모든 소리를 멈춘다 */
  suspend(): void {
    this.suspended = true;
    for (const el of Object.values(this.els)) el.pause();
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }
  resume(): void {
    this.suspended = false;
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }
}

export const audio = new AudioSystem();
