import { store } from './storage';

export type SfxName = 'laser' | 'missile' | 'boom' | 'enrage' | 'item' | 'heal' | 'missileHit';
export type BgmName = 'normal' | 'solar' | 'boss';

const BASE = import.meta.env.BASE_URL;
const BGM_TRACKS: Record<BgmName, { src: string; vol: number; loopEnd: number }> = {
  normal: { src: `${BASE}assets/audio/under_heavy_fire.mp3`, vol: 0.25, loopEnd: 175.3 },   // loopEnd: 끝부분 무음 구간 건너뛰기
  solar:  { src: `${BASE}assets/audio/target_solar_core.mp3`, vol: 0.26, loopEnd: 0 },    // 후반(4·5스테이지) 일반 전투곡
  boss:   { src: `${BASE}assets/audio/titan_at_the_gate.mp3`, vol: 0.28, loopEnd: 0 },
};

/**
 * 오디오 전체를 Phaser와 독립적으로 관리한다.
 *  - 효과음: WebAudio 합성음 (파일 없음)
 *  - BGM: HTMLAudio 스트리밍 mp3 (디코딩 메모리를 쓰지 않아 모바일에 유리), 일반/보스 크로스페이드
 */
interface Track { el: HTMLAudioElement; gain: GainNode | null; vol: number; failed: boolean; retryAt: number; }

class AudioSystem {
  muted: boolean = !!store.get('muted', false);
  private ctx: AudioContext | null = null;
  private tracks: Partial<Record<BgmName, Track>> = {};
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
      // 두 트랙 모두 이 사용자 제스처 안에서 한 번 재생→정지해 모바일(iOS) 자동재생 제한을 풀어 둔다
      this.primeTrack(this.get('normal'), false);
      this.primeTrack(this.get('boss'), true);
      this.primeTrack(this.get('solar'), true);
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
      case 'missileHit': {   // 묵직한 둔탁음 + 노이즈 버스트 (미사일 착탄)
        osc.type = 'sine'; f.setValueAtTime(170, t); exp(42, 0.2); g.setValueAtTime(0.55, t); g.exponentialRampToValueAtTime(0.01, t + 0.2); osc.start(t); osc.stop(t + 0.2);
        const len = Math.floor(ctx.sampleRate * 0.14), buf = ctx.createBuffer(1, len, ctx.sampleRate), ch = buf.getChannelData(0);
        for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / len);
        const ns = ctx.createBufferSource(), ng = ctx.createGain(), bp = ctx.createBiquadFilter();
        bp.type = 'lowpass'; bp.frequency.value = 1800; ns.buffer = buf; ns.connect(bp); bp.connect(ng); ng.connect(ctx.destination);
        ng.gain.setValueAtTime(0.32, t); ng.gain.exponentialRampToValueAtTime(0.01, t + 0.14); ns.start(t);
        break;
      }
      case 'heal':    osc.type = 'sine';     f.setValueAtTime(300, t); exp(800, 0.25);  g.setValueAtTime(0.2, t);  g.exponentialRampToValueAtTime(0.01, t + 0.25); osc.start(t); osc.stop(t + 0.25); break;
    }
  }

  // ---------------------------------------------------------------- BGM
  private get(name: BgmName): Track {
    let t = this.tracks[name];
    if (!t) {
      const el = new Audio(BGM_TRACKS[name].src);
      el.loop = true; el.preload = 'auto';
      const track: Track = { el, gain: null, vol: 0, failed: false, retryAt: 0 };
      // 볼륨은 WebAudio 게인으로 제어 (iOS Safari는 HTMLMediaElement.volume을 무시하기 때문)
      if (this.ctx) {
        try {
          const src = this.ctx.createMediaElementSource(el);
          track.gain = this.ctx.createGain(); track.gain.gain.value = 0;
          src.connect(track.gain); track.gain.connect(this.ctx.destination);
        } catch { track.gain = null; }
      }
      if (!track.gain) el.volume = 0;
      el.addEventListener('error', () => { track.failed = true; });
      this.tracks[name] = track; t = track;
    }
    return t;
  }
  private setVol(t: Track, v: number): void {
    t.vol = v;
    if (t.gain) t.gain.gain.value = v; else t.el.volume = Math.max(0, Math.min(1, v));
  }
  private play(t: Track): void {
    const now = performance.now();
    if (now < t.retryAt) return;
    const p = t.el.play();
    if (p && p.catch) p.catch(() => { t.retryAt = now + 1000; });   // 자동재생 차단 — 1초 뒤 재시도
  }
  private primeTrack(t: Track, pauseAfter: boolean): void {
    const p = t.el.play();
    if (pauseAfter) { if (p && p.then) p.then(() => { t.el.pause(); t.el.currentTime = 0; }).catch(() => { /* 무시 */ }); }
    else if (p && p.catch) p.catch(() => { /* 무시 */ });
  }

  /** 매 틱(60Hz) 호출: want 트랙으로 크로스페이드, null이면 페이드아웃 */
  updateMusic(want: BgmName | null): void {
    if (!this.unlocked || this.suspended) return;
    if (want === 'boss' && this.tracks.boss?.failed) want = 'normal';
    for (const name of Object.keys(BGM_TRACKS) as BgmName[]) {
      const cfg = BGM_TRACKS[name];
      const t = name === want ? this.get(name) : this.tracks[name];
      if (!t || t.failed) continue;
      const target = name === want && !this.muted ? cfg.vol : 0;
      const dv = target - t.vol;
      this.setVol(t, Math.max(0, Math.min(1, t.vol + dv * 0.06 + Math.sign(dv) * 0.002)));
      if (target > 0 && t.el.paused) this.play(t);
      if (target === 0 && t.vol < 0.01 && !t.el.paused) t.el.pause();
      if (cfg.loopEnd && t.el.currentTime > cfg.loopEnd) t.el.currentTime = 0;
    }
  }

  rewind(): void { for (const t of Object.values(this.tracks)) { try { t.el.currentTime = 0; } catch { /* 메타데이터 로딩 전 */ } } }

  /** 일시정지: 모든 소리를 멈춘다 */
  suspend(): void {
    this.suspended = true;
    for (const t of Object.values(this.tracks)) t.el.pause();
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }
  resume(): void {
    this.suspended = false;
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }
}

export const audio = new AudioSystem();
