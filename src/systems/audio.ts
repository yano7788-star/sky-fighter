import { store } from './storage';

export type SfxName = 'laser' | 'missile' | 'boom' | 'enrage' | 'item' | 'heal' | 'missileHit' | 'laserCharge' | 'laserBeam' | 'bossHit' | 'bossHeavy' | 'laserHit' | 'bossBreak' | 'gPistol' | 'gSilenced' | 'gSiren' | 'gShotgun' | 'gSmg' | 'gRail' | 'gRoll' | 'gHurt' | 'gEnemyShot' | 'gHit' | 'gKill' | 'gStyle' | 'gThrow' | 'gRifle' | 'gSwing' | 'gMelee' | 'gDoor' | 'gDoorKick' | 'gDoorBreak' | 'gGlass' | 'gCrate' | 'gCasing' | 'gPump' | 'gBeep' | 'gDodge' | 'gBombLand';
export type BgmName = 'normal' | 'solar' | 'boss';

const BASE = import.meta.env.BASE_URL;
const THROTTLE_MS: Partial<Record<SfxName, number>> = { bossHit: 60, laserHit: 90, bossHeavy: 80, bossBreak: 200, gSmg: 28, gEnemyShot: 70, gHit: 30, gKill: 60, gCasing: 45, gGlass: 60, gDoor: 120, gCrate: 50, gSwing: 90 };   // 연사 무기의 피격음은 간격을 둬서 뭉개지지 않게
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
  private musicMul = 1;      // 은신 중에는 음악을 거의 끈다 (부드럽게 오르내림)
  private stealth: number | null = null;   // 은신 긴장도 0~1 (null = 은신 아님)
  private hbMs = 0; private drone: { g: GainNode } | null = null;
  private duckUntil = 0;     // BGM 덕킹: 이 시각까지 음악 볼륨을 낮춘다
  private duckAmt = 1;

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
    if (now - (this.lastPlayed[name] ?? 0) < (THROTTLE_MS[name] ?? 35)) return;    // 같은 소리 폭주 방지 (연사 무기는 간격을 더 넓게)
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
      case 'laserCharge': {   // 충전음: 낮은 톱니파가 1.15초 동안 높게 차오르며 떨림이 빨라진다
        osc.type = 'sawtooth'; f.setValueAtTime(110, t); exp(920, 1.15);
        g.setValueAtTime(0.02, t); g.linearRampToValueAtTime(0.17, t + 1.05); g.linearRampToValueAtTime(0.0001, t + 1.2);
        osc.start(t); osc.stop(t + 1.2);
        const o2 = ctx.createOscillator(), g2 = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain();
        o2.type = 'square'; o2.frequency.setValueAtTime(55, t); o2.frequency.exponentialRampToValueAtTime(460, t + 1.15);
        lfo.frequency.setValueAtTime(6, t); lfo.frequency.linearRampToValueAtTime(34, t + 1.15); lg.gain.value = 0.05;
        lfo.connect(lg); lg.connect(g2.gain); g2.gain.setValueAtTime(0.06, t); g2.gain.linearRampToValueAtTime(0.1, t + 1.1); g2.gain.linearRampToValueAtTime(0.0001, t + 1.2);
        o2.connect(g2); g2.connect(ctx.destination); o2.start(t); lfo.start(t); o2.stop(t + 1.2); lfo.stop(t + 1.2);
        break;
      }
      case 'laserBeam': {   // 발사음: 날카로운 '쩡' + 0.75초 동안 이어지는 굵은 저음 + 쉬익 하는 노이즈
        osc.type = 'sawtooth'; f.setValueAtTime(95, t); f.exponentialRampToValueAtTime(58, t + 0.8);
        g.setValueAtTime(0.0001, t); g.linearRampToValueAtTime(0.4, t + 0.04); g.setValueAtTime(0.34, t + 0.55); g.exponentialRampToValueAtTime(0.01, t + 0.8);
        osc.start(t); osc.stop(t + 0.8);
        const z = ctx.createOscillator(), zg = ctx.createGain();
        z.type = 'square'; z.frequency.setValueAtTime(1500, t); z.frequency.exponentialRampToValueAtTime(260, t + 0.22);
        zg.gain.setValueAtTime(0.16, t); zg.gain.exponentialRampToValueAtTime(0.005, t + 0.24); z.connect(zg); zg.connect(ctx.destination); z.start(t); z.stop(t + 0.25);
        const len = Math.floor(ctx.sampleRate * 0.8), buf = ctx.createBuffer(1, len, ctx.sampleRate), ch = buf.getChannelData(0);
        for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1);
        const ns = ctx.createBufferSource(), ng = ctx.createGain(), bp = ctx.createBiquadFilter();
        bp.type = 'bandpass'; bp.Q.value = 0.8; bp.frequency.setValueAtTime(2400, t); bp.frequency.exponentialRampToValueAtTime(500, t + 0.8);
        ns.buffer = buf; ns.connect(bp); bp.connect(ng); ng.connect(ctx.destination);
        ng.gain.setValueAtTime(0.0001, t); ng.gain.linearRampToValueAtTime(0.2, t + 0.05); ng.gain.exponentialRampToValueAtTime(0.01, t + 0.8); ns.start(t);
        break;
      }
      case 'missileHit': {   // 묵직한 둔탁음 + 노이즈 버스트 (미사일 착탄)
        osc.type = 'sine'; f.setValueAtTime(170, t); exp(42, 0.2); g.setValueAtTime(0.55, t); g.exponentialRampToValueAtTime(0.01, t + 0.2); osc.start(t); osc.stop(t + 0.2);
        const len = Math.floor(ctx.sampleRate * 0.14), buf = ctx.createBuffer(1, len, ctx.sampleRate), ch = buf.getChannelData(0);
        for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / len);
        const ns = ctx.createBufferSource(), ng = ctx.createGain(), bp = ctx.createBiquadFilter();
        bp.type = 'lowpass'; bp.frequency.value = 1800; ns.buffer = buf; ns.connect(bp); bp.connect(ng); ng.connect(ctx.destination);
        ng.gain.setValueAtTime(0.32, t); ng.gain.exponentialRampToValueAtTime(0.01, t + 0.14); ns.start(t);
        break;
      }
      case 'bossHit': {   // 보스 피격(연사탄): 3겹(찰진 금속 + 몸통 + 서브 베이스), 매번 피치를 살짝 비튼다
        const pr = 0.95 + Math.random() * 0.1;
        osc.type = 'square'; f.setValueAtTime(1700 * pr, t); exp(820 * pr, 0.035); g.setValueAtTime(0.07, t); g.exponentialRampToValueAtTime(0.005, t + 0.04); osc.start(t); osc.stop(t + 0.04);
        this.layer(ctx, 'triangle', 320 * pr, 150 * pr, 0.07, 0.16, t); this.layer(ctx, 'sine', 95 * pr, 52, 0.1, 0.3, t);
        break;
      }
      case 'bossHeavy': {   // 보스 강타(폭탄·궁극기 등): 둔중한 쿵 + 노이즈
        const pr = 0.95 + Math.random() * 0.1;
        this.layer(ctx, 'sine', 110 * pr, 36, 0.28, 0.6, t); this.layer(ctx, 'sawtooth', 420 * pr, 90, 0.16, 0.22, t); this.noise(ctx, 0.16, 0.3, 2200, t);
        break;
      }
      case 'laserHit': {   // 레이저가 닿는 지글거림
        const pr = 0.95 + Math.random() * 0.1;
        osc.type = 'sawtooth'; f.setValueAtTime(1100 * pr, t); exp(520 * pr, 0.07); g.setValueAtTime(0.07, t); g.exponentialRampToValueAtTime(0.004, t + 0.08); osc.start(t); osc.stop(t + 0.08);
        this.layer(ctx, 'sine', 140 * pr, 70, 0.08, 0.2, t); this.noise(ctx, 0.05, 0.1, 3500, t);
        break;
      }
      case 'bossBreak': {   // 외피 파손: 금속 찢어지는 소리 + 깊은 울림
        this.layer(ctx, 'sine', 90, 30, 0.55, 0.7, t); this.layer(ctx, 'sawtooth', 700, 120, 0.3, 0.25, t); this.noise(ctx, 0.35, 0.4, 1500, t);
        this.duck(260, 0.45);
        break;
      }
      // ---- 지상전 효과음 (합성): 총마다 소리 성격을 달리하고 피치를 살짝 비튼다
      case 'gPistol': { const pr = 0.95 + Math.random() * 0.1; this.layer(ctx, 'square', 900 * pr, 240, 0.06, 0.09, t); this.noise(ctx, 0.05, 0.16, 4200, t); break; }
      case 'gSilenced': { const pr = 0.95 + Math.random() * 0.1; this.layer(ctx, 'triangle', 360 * pr, 130, 0.05, 0.05, t); this.noise(ctx, 0.035, 0.05, 1600, t); this.layer(ctx, 'square', 2300, 1500, 0.012, 0.022, t + 0.012); break; }   // 소음기: 낮고 작은 "퓻" + 슬라이드 철컥
      case 'gSiren': { this.layer(ctx, 'sawtooth', 620, 900, 0.34, 0.035, t); this.layer(ctx, 'sawtooth', 900, 620, 0.34, 0.035, t + 0.36); break; }   // 경보 사이렌
      case 'gShotgun': { this.noise(ctx, 0.16, 0.42, 3200, t); this.layer(ctx, 'sine', 150, 46, 0.22, 0.4, t); this.layer(ctx, 'sawtooth', 520, 120, 0.1, 0.12, t); break; }
      case 'gSmg': { const pr = 0.92 + Math.random() * 0.16; this.layer(ctx, 'square', 760 * pr, 280, 0.04, 0.06, t); this.noise(ctx, 0.03, 0.1, 5000, t); break; }
      case 'gRail': { this.layer(ctx, 'sawtooth', 2000, 220, 0.3, 0.18, t); this.layer(ctx, 'sine', 100, 38, 0.35, 0.45, t); this.noise(ctx, 0.2, 0.2, 6000, t); this.duck(200, 0.5); break; }
      case 'gRoll': { this.noise(ctx, 0.14, 0.16, 1400, t); this.layer(ctx, 'sine', 260, 120, 0.12, 0.06, t); break; }
      case 'gHurt': { this.layer(ctx, 'sawtooth', 240, 70, 0.28, 0.3, t); this.noise(ctx, 0.18, 0.3, 1800, t); this.duck(260, 0.5); break; }
      case 'gEnemyShot': { const pr = 0.95 + Math.random() * 0.1; this.layer(ctx, 'square', 420 * pr, 190, 0.05, 0.04, t); break; }
      case 'gHit': { const pr = 0.9 + Math.random() * 0.2; this.layer(ctx, 'triangle', 520 * pr, 190, 0.06, 0.1, t); this.noise(ctx, 0.04, 0.08, 3000, t); break; }
      case 'gKill': { const pr = 0.95 + Math.random() * 0.1; this.layer(ctx, 'sine', 160 * pr, 55, 0.14, 0.3, t); this.layer(ctx, 'square', 1000 * pr, 400, 0.05, 0.05, t); break; }
      case 'gStyle': { this.layer(ctx, 'sine', 600, 1500, 0.18, 0.16, t); this.layer(ctx, 'triangle', 900, 2000, 0.22, 0.1, t + 0.04); break; }
      case 'gThrow': { this.layer(ctx, 'triangle', 300, 600, 0.12, 0.1, t); this.noise(ctx, 0.1, 0.1, 2400, t); break; }
      case 'gRifle': { const pr = 0.95 + Math.random() * 0.1; this.layer(ctx, 'sawtooth', 1100 * pr, 180, 0.06, 0.1, t); this.noise(ctx, 0.06, 0.22, 5200, t); this.layer(ctx, 'sine', 120, 55, 0.12, 0.22, t); break; }
      case 'gSwing': { this.noise(ctx, 0.1, 0.14, 2200, t); this.layer(ctx, 'triangle', 520, 190, 0.09, 0.05, t); break; }
      case 'gMelee': { this.layer(ctx, 'sine', 150, 48, 0.16, 0.42, t); this.noise(ctx, 0.09, 0.28, 2600, t); this.layer(ctx, 'square', 380, 120, 0.05, 0.08, t); this.duck(160, 0.6); break; }
      case 'gDoor': { this.layer(ctx, 'triangle', 170, 105, 0.24, 0.05, t); this.noise(ctx, 0.2, 0.06, 600, t); break; }
      case 'gDoorKick': { this.layer(ctx, 'sine', 105, 38, 0.22, 0.5, t); this.noise(ctx, 0.12, 0.32, 1800, t); this.layer(ctx, 'square', 230, 90, 0.08, 0.1, t); this.duck(160, 0.6); break; }
      case 'gDoorBreak': { this.noise(ctx, 0.32, 0.46, 3500, t); this.layer(ctx, 'sine', 85, 30, 0.38, 0.55, t); this.layer(ctx, 'sawtooth', 320, 90, 0.16, 0.16, t); this.duck(260, 0.5); break; }
      case 'gGlass': { this.noise(ctx, 0.28, 0.3, 9000, t); this.layer(ctx, 'triangle', 3300, 1200, 0.1, 0.1, t); this.layer(ctx, 'square', 2500, 900, 0.08, 0.05, t + 0.02); break; }
      case 'gCrate': { this.noise(ctx, 0.12, 0.3, 1500, t); this.layer(ctx, 'sine', 125, 68, 0.13, 0.32, t); break; }
      case 'gCasing': { const pr = 0.9 + Math.random() * 0.25; this.layer(ctx, 'triangle', 3300 * pr, 2400 * pr, 0.05, 0.05, t); break; }
      case 'gPump': { this.layer(ctx, 'square', 260, 170, 0.06, 0.09, t); this.noise(ctx, 0.05, 0.12, 3000, t); this.layer(ctx, 'square', 200, 130, 0.06, 0.08, t + 0.07); break; }
      case 'gBeep': { this.layer(ctx, 'sine', 1900, 1850, 0.05, 0.08, t); break; }
      case 'gDodge': { this.layer(ctx, 'sine', 700, 1500, 0.16, 0.12, t); this.noise(ctx, 0.1, 0.08, 5000, t); break; }
      case 'gBombLand': { this.layer(ctx, 'triangle', 320, 160, 0.08, 0.1, t); this.noise(ctx, 0.06, 0.1, 2400, t); break; }
      case 'heal':    osc.type = 'sine';     f.setValueAtTime(300, t); exp(800, 0.25);  g.setValueAtTime(0.2, t);  g.exponentialRampToValueAtTime(0.01, t + 0.25); osc.start(t); osc.stop(t + 0.25); break;
    }
  }

  /** 효과음 한 겹(오실레이터) */
  private layer(ctx: AudioContext, type: OscillatorType, f0: number, f1: number, dur: number, vol: number, t: number): void {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.004, t + dur);
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + dur + 0.01);
  }
  private noise(ctx: AudioContext, dur: number, vol: number, cutoff: number, t: number): void {
    const len = Math.floor(ctx.sampleRate * dur), buf = ctx.createBuffer(1, len, ctx.sampleRate), ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const ns = ctx.createBufferSource(), ng = ctx.createGain(), lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = cutoff; ns.buffer = buf; ns.connect(lp); lp.connect(ng); ng.connect(ctx.destination);
    ng.gain.setValueAtTime(vol, t); ng.gain.exponentialRampToValueAtTime(0.004, t + dur); ns.start(t);
  }
  /** BGM 덕킹: 강한 타격 순간 음악을 잠깐 낮춰 효과음을 부각 */
  duck(ms: number, amt = 0.5): void {   // 겹치면 더 길고 더 깊은 쪽을 따른다
    const now = performance.now(), active = now < this.duckUntil;
    this.duckAmt = active ? Math.min(this.duckAmt, amt) : amt;
    this.duckUntil = Math.max(this.duckUntil, now + ms);
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

  /** 은신 긴장도: 소음기 은신 중이면 0~1(가까운 적일수록 큼), 아니면 null. 음악을 10%로 낮추고 저음 드론 + 심장 박동을 깐다 */
  setStealth(level: number | null): void { this.stealth = level; }
  /** 매 프레임(dt ms) 호출: 드론 볼륨과 심장 박동 */
  tickStealth(dtMs: number): void {
    const ctx = this.ctx, on = this.stealth !== null && !this.muted && !this.suspended && !!ctx && ctx.state === 'running';
    if (!ctx || (!on && !this.drone)) return;
    if (!this.drone && on) {   // 낮은 두 음(52·78Hz)이 천천히 맥놀이치는 드론
      const g = ctx.createGain(); g.gain.value = 0; g.connect(ctx.destination);
      for (const [fr, vol] of [[52, 1], [55.5, 0.8], [78, 0.35]] as const) { const o = ctx.createOscillator(), og = ctx.createGain(); o.type = 'sine'; o.frequency.value = fr; og.gain.value = vol; o.connect(og); og.connect(g); o.start(); }
      this.drone = { g };
    }
    if (this.drone && ctx) this.drone.g.gain.setTargetAtTime(on ? 0.05 : 0, ctx.currentTime, 0.6);
    if (!on || !ctx) { this.hbMs = 0; return; }
    const k = this.stealth ?? 0;
    this.hbMs += dtMs;
    if (this.hbMs >= 1150 - 620 * k) {   // 적이 가까울수록 심장이 빨라진다
      this.hbMs = 0; const t = ctx.currentTime, v = 0.16 + 0.14 * k;
      this.layer(ctx, 'sine', 72, 40, 0.14, v, t); this.layer(ctx, 'sine', 64, 36, 0.12, v * 0.65, t + 0.17);
    }
  }

  /** 매 틱(60Hz) 호출: want 트랙으로 크로스페이드, null이면 페이드아웃 */
  updateMusic(want: BgmName | null): void {
    if (!this.unlocked || this.suspended) return;
    this.musicMul += ((this.stealth !== null ? 0.1 : 1) - this.musicMul) * (this.stealth !== null ? 0.03 : 0.05);
    if (want === 'boss' && this.tracks.boss?.failed) want = 'normal';
    for (const name of Object.keys(BGM_TRACKS) as BgmName[]) {
      const cfg = BGM_TRACKS[name];
      const t = name === want ? this.get(name) : this.tracks[name];
      if (!t || t.failed) continue;
      const target = name === want && !this.muted ? cfg.vol * this.musicMul * (performance.now() < this.duckUntil ? this.duckAmt : 1) : 0;
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
