import Phaser from 'phaser';
import { metaParams } from './core/meta';
import { Sim } from './core/sim';
import type { WeaponId } from './core/ground';
import { loadMeta } from './systems/storage';

/** 지상전 테스트 페이지(?groundtest): 본편을 거치지 않고 지상전만 바로 시작한다. 구역·무기·파일럿·무적·인트로 생략을 DOM 패널에서 고른다. */
export interface GroundTest { section: number; weapon: WeaponId; pilot: 0 | 1 | 2; god: boolean; skipIntro: boolean; boss?: number; ctl?: 'simple' | 'precise'; layout?: 'auto' | 'portrait' | 'landscape' }
const KEY = 'sf-groundtest';
const DEFAULTS: GroundTest = { section: 0, weapon: 'pistol', pilot: 0, god: false, skipIntro: true };

export const isGroundTest = (): boolean => /[?&]groundtest(=|&|$)/.test(location.search);
const load = (): GroundTest => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return { ...DEFAULTS }; } };
const save = (t: GroundTest) => { try { localStorage.setItem(KEY, JSON.stringify(t)); } catch { /* 무시 */ } };

/** BootScene 끝에서 호출: 지상전 씬을 시작하고 패널을 붙인다 */
export function startGroundTest(scene: Phaser.Scene): void {
  const m = loadMeta();
  const sim = new Sim(7, metaParams(m.levels, m.pilots.selected, null));
  sim.lives = 99;
  const game = scene.game;
  const run = (t: GroundTest) => { save(t); try { if (t.layout === 'landscape') localStorage.setItem('sf-ground-lay', 'land'); else if (t.layout === 'portrait') localStorage.setItem('sf-ground-lay', 'port'); else localStorage.removeItem('sf-ground-lay'); } catch { /* 무시 */ } game.scene.stop('GroundScene'); game.scene.start('GroundScene', { sim, test: t }); };
  const t0 = load(); try { if (t0.layout === 'landscape') localStorage.setItem('sf-ground-lay', 'land'); else if (t0.layout === 'portrait') localStorage.setItem('sf-ground-lay', 'port'); else localStorage.removeItem('sf-ground-lay'); } catch { /* 무시 */ }   // 테스트 페이지는 저장된 방향 선택을 그대로 따른다(자동이면 기기 방향)
  scene.scene.start('GroundScene', { sim, test: t0 });
  mountPanel(load(), run);
}

function mountPanel(init: GroundTest, run: (t: GroundTest) => void): void {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;left:8px;top:8px;z-index:10;font:12px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:#e2e8f0;background:rgba(2,6,14,.82);border:1px solid #334155;border-radius:8px;padding:8px 10px;max-width:210px';
  const sel = (id: string, opts: [string, string][], v: string) => `<select id="${id}" style="width:100%;margin:2px 0 6px;background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:4px;padding:3px">${opts.map(([k, l]) => `<option value="${k}"${k === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
  el.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center"><b>지상전 테스트</b><button id="gt-fold" style="background:none;border:0;color:#94a3b8;cursor:pointer">–</button></div><div id="gt-body">
    시작 구역${sel('gt-sec', [['0', '옥상'], ['1', '건물 1층'], ['2', '건물 2층'], ['3', '격납고(보스)']], String(init.section))}
    무기${sel('gt-w', [['pistol', '권총'], ['silenced', '소음기 권총'], ['rifle', '소총'], ['smg', 'SMG'], ['shotgun', '샷건'], ['rail', '레일 라이플']], init.weapon)}
    파일럿${sel('gt-p', [['0', '에이스'], ['1', '언니(화력 ×1.2)'], ['2', '동생(관통+탄속)']], String(init.pilot))}
    화면${sel('gt-lay', [['auto', '자동(기기 방향)'], ['portrait', '세로'], ['landscape', '가로']], init.layout ?? 'auto')}
    <label style="display:block;margin:2px 0"><input id="gt-god" type="checkbox"${init.god ? ' checked' : ''}> 무적</label>
    <label style="display:block;margin:2px 0 8px"><input id="gt-skip" type="checkbox"${init.skipIntro ? ' checked' : ''}> 인트로 컷 건너뛰기</label>
    <button id="gt-go" style="width:100%;padding:6px;background:#0ea5e9;color:#02060e;border:0;border-radius:6px;font-weight:700;cursor:pointer">적용하고 다시 시작</button>
    <div style="margin-top:6px;color:#94a3b8">WASD 이동 · 마우스 조준/클릭 · Shift 구르기(무적) · F/우클릭 근접 · G 폭탄 · E 줍기 · R 재시작(사망 시) · P 일시정지</div></div>`;
  document.body.appendChild(el);
  const q = <T extends HTMLElement>(id: string) => el.querySelector('#' + id) as T;
  q('gt-fold').onclick = () => { const b = q<HTMLDivElement>('gt-body'); b.style.display = b.style.display === 'none' ? '' : 'none'; };
  q('gt-go').onclick = () => {
    run({ section: +q<HTMLSelectElement>('gt-sec').value, weapon: q<HTMLSelectElement>('gt-w').value as WeaponId, pilot: +q<HTMLSelectElement>('gt-p').value as 0 | 1 | 2, layout: q<HTMLSelectElement>('gt-lay').value as 'auto' | 'portrait' | 'landscape', god: q<HTMLInputElement>('gt-god').checked, skipIntro: q<HTMLInputElement>('gt-skip').checked });
    (document.activeElement as HTMLElement | null)?.blur();
  };
}
