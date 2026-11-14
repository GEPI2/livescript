// 화면 시험 도구. 앱 서버(python3 -m http.server 8765)와 playwright-core가 있어야 한다.
// 실행: node e2e/run.mjs   (playwright-core 위치는 PW_CORE, 브라우저는 CHROME에 적는다. 없으면 이 컴퓨터의 기본 위치를 찾는다)
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = os.homedir();
const guess = [process.env.PW_CORE, ...fs.readdirSync(path.join(home, '.npm/_npx'), { withFileTypes: true }).map(d => path.join(home, '.npm/_npx', d.name, 'node_modules'))].filter(Boolean);
const dir = guess.find(d => fs.existsSync(path.join(d, 'playwright-core')));
if (!dir) throw new Error('playwright-core를 찾지 못했어요. PW_CORE에 node_modules 경로를 적어 주세요.');
const { chromium } = createRequire(dir + '/')('playwright-core');
export const BASE = process.env.BASE || 'http://localhost:8765/';
// AI 중계(claude.js API). 호스트는 배포한 Worker마다 달라서 경로로 잡는다
export const AI = '**/v1/messages';
const cache = path.join(home, 'Library/Caches/ms-playwright');
const chromeGuess = () => {
  if (process.env.CHROME) return process.env.CHROME;
  const d = fs.readdirSync(cache).filter(x => x.startsWith('chromium-')).sort().pop();
  return path.join(cache, d, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
};
export const launch = () => chromium.launch({ executablePath: chromeGuess(), args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });

// 흉내 낸 음성 인식: window.__say(text, final)
export const MOCK = `
window.__finals = [];
window.SpeechRecognition = window.webkitSpeechRecognition = class {
  constructor() { window.__rec = this; }
  start() { window.__rec = this; window.__finals = []; setTimeout(() => this.onstart && this.onstart(), 0); }  // 인식기가 여럿이면(읽기 시험) 마지막으로 켠 것이 듣는다
  stop() { setTimeout(() => this.onend && this.onend(), 0); }
  abort() { this.stop(); }
};
const item = (t, f) => { const i = [{ transcript: t }]; i.isFinal = f; return i; };
// 중간 결과(말하는 중): 확정된 결과 뒤에 붙는다
window.__say = (t, final = false) => {
  const r = window.__rec; if (!r || !r.onresult) return;
  if (final) return window.__fin(t);
  r.onresult({ resultIndex: window.__finals.length, results: [...window.__finals, item(t, false)] });
};
// 확정 결과 하나를 더한다
window.__fin = t => {
  const r = window.__rec; if (!r || !r.onresult) return;
  window.__finals.push(item(t, true));
  r.onresult({ resultIndex: window.__finals.length - 1, results: [...window.__finals] });
};
window.__spoken = [];
window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
window.__speakOk = true;
const synth = { speak(u) { window.__spoken.push(u.text); window.__utt = u; }, cancel() { window.__spoken.length = 0; window.__canceled = (window.__canceled || 0) + 1; } };
try { Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true }); } catch {}
try { localStorage.getItem('ls.audio') || localStorage.setItem('ls.audio', JSON.stringify({ l: false, r: false })); } catch {}
`;
export async function page(browser, o = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, locale: 'ko-KR', permissions: ['microphone'], ...o });
  await ctx.addInitScript(MOCK);
  await ctx.route(AI, r => r.abort());  // 시험이 진짜 중계(서비스가 돈을 낸다)를 부르지 않게. 답이 필요한 시험은 p.route로 덮는다
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', e => p.errors.push(e.message));
  p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|favicon/.test(m.text())) p.errors.push(m.text()); });
  return p;
}
// 첫 화면은 홈이다. home: false(기본)면 Esc로 홈을 닫고 편집 화면에서 시작한다(로고는 늘 홈을 연다)
export const open = async (p, q = '', { home = false } = {}) => { await p.goto(BASE + q); await p.waitForFunction(() => document.body.classList.contains('ready') || !document.getElementById('text').readOnly); await p.waitForTimeout(300); if (!home) await p.evaluate(() => document.getElementById('home').hidden || dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))); };
export const sample = async p => { await p.click('#eSample'); await p.waitForTimeout(600); await p.locator('#toastX').click().catch(() => {}); };
