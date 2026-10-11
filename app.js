// 라이브스크립트 화면. match.js(전역 norm, normMap, anchors, follow, MARK)를 먼저 불러온다.
import { cleanPack, prepare, rank, confidence, packHash, toB64, fromB64, loadModel, modelCached, embed, embedAll, REV, DIM, norm as plain } from './qa.js?v=6';
import { keyStore, keyOk, qaPrompt, generatePack, parsePack, callClaude, scriptPrompt, editPrompt, prepPrompt, parsePrep, PREP_SCHEMA, suggestAlts, adlibPrompt, parseAdlib, summarizeAdlib } from './claude.js?v=6';
import { diff, paras, paraRange, around, addVersion, hashText, cleanScript, readScript } from './lib.js?v=6';
import { units, shrunk, plan, remap, unitAt, strikes, LABEL } from './shrink.js?v=6';
import { loadJev, closeJev, jevCached, rerank, SIZE as JEV_SIZE, TIMEOUT as JEV_TIMEOUT } from './jev.js?v=6';
import { collector, readSegs, summary, insertAfter, head, addText, MAX as AD_MAX, CTX } from './adlib.js?v=6';

const $ = id => document.getElementById(id);
// 배포 직후 옛 index.html과 섞여 아래에서 멈춰도, 빈 편집창에 친 글이 저장된 대본을 덮어쓰지 않게 다 불러올 때까지 잠근다 (맨 아래에서 푼다)
$('text').readOnly = true;
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
// 저장 공간(약 5MB)이 가득 차면 다시 계산할 수 있는 질문 벡터를 비우고 한 번 더 해 본다
const save = (k, v) => store.set(k, v) || (store.del('ls.vec'), store.set(k, v));
const FULL = '이 기기의 저장 공간이 가득 차서 저장하지 못했어요. 쓰지 않는 대본을 지우고, 그동안 지금 대본은 다른 곳에 복사해 두세요.';

// ---- 대본 보관함 ----
// ls.lib = { cur: 지금 대본 id, list: [{ id, name, src: 마지막으로 대본을 바꾼 방법 }] }
// 대본마다 따로 두는 값(대본, 위치, 목표, 발표 시간, 발표 정보, 버전, 발표 준비)은 sk(이름)에 둔다.
// 첫 대본('a')은 예전 키(ls.script, ls.cur, ls.target, ls.talk, ls.qaInfo)를 그대로 써서 옮길 것이 없고, 이전 판 앱으로 열어도 그 대본이 보인다.
let lib = { cur: 'a', list: [{ id: 'a', name: '대본 1', src: '' }] };
try {
  const l = JSON.parse(store.get('ls.lib'));
  const list = (Array.isArray(l?.list) ? l.list : []).filter(e => typeof e?.id === 'string' && /^\w+$/.test(e.id))
    .map(e => ({ id: e.id, name: typeof e.name === 'string' && e.name.trim() ? e.name.slice(0, 40) : '대본', src: typeof e.src === 'string' ? e.src : '' }));
  if (list.length) lib = { cur: list.some(e => e.id === l.cur) ? l.cur : list[0].id, list };
} catch {}
const sk = (k, id = lib.cur) => id === 'a' ? 'ls.' + k : `ls.${k}.${id}`;
const entry = () => lib.list.find(e => e.id === lib.cur);
const saveLib = () => save('ls.lib', JSON.stringify(lib)) || tell(FULL);

let S = { s: '' }, A = null, words = [], sents = [], cur = 0, pending = null;
let approx = null;  // 문장 키워드로 옮겨서 위치가 어림값이면 그 키워드 문장 번호. 글자 비교가 다시 맞으면 null.

// 대본을 문장 > 어절 span으로 만든다. 어절마다 정규화 기준 시작/끝(n0, n1)을 기록.
// cuts: 자동 줄이기로 문장을 숨긴 단위의 자리 [{ a, b, lv }] (shrink.js shrunk). 그 문장들은 div.cut 안에 넣는다.
function build(text, cuts = []) {
  text = text.normalize('NFC');
  S = normMap(text);
  const toNorm = [];
  // 숫자처럼 한 글자가 여러 음절로 늘면 at에 같은 값이 반복된다
  for (let i = 0, k = 0; i <= text.length; i++) { while (k < S.at.length && S.at[k] < i) k++; toNorm[i] = k; }

  const root = $('prompt');
  root.textContent = '';
  words = []; sents = [];
  let sEl = null, newSent = true, last = 0, m, host = root, ci = 0;
  const re = /\S+/g;
  while ((m = re.exec(text))) {
    let gap = text.slice(last, m.index);
    if (gap.includes('\n')) newSent = true;
    if (newSent) {
      // 줄인 단위는 문장 경계에서 시작하고 끝난다. 블록이 줄을 바꾸므로 블록 뒤 첫 줄바꿈은 뺀다(빈 줄 수를 원문과 같게).
      if (host !== root && m.index >= cuts[ci].b) { host = root; ci++; gap = gap.replace('\n', ''); }
      if (host === root && cuts[ci] && m.index >= cuts[ci].a) {
        root.append(gap); gap = '';
        host = document.createElement('div');
        host.className = 'cut';
        host.dataset.l = LABEL[cuts[ci].lv];
        root.append(host);
      }
      host.append(gap);
      sEl = document.createElement('span');
      sEl.className = 's';
      host.append(sEl);
      sents.push({ el: sEl, first: words.length });
      newSent = false;
    } else sEl.append(gap);
    const w = document.createElement('span');
    w.textContent = m[0];
    w.dataset.i = words.length;
    sEl.append(w);
    words.push({ el: w, t: m[0], s: sents.length - 1, n0: toNorm[m.index], n1: toNorm[m.index + m[0].length] });
    if (/[.?!…。]["'”’)\]]*$/.test(m[0])) newSent = true;
    last = re.lastIndex;
  }
  root.append(text.slice(last));
  // '발표 준비'에서 만든 키워드의 다른 말도 키워드로 쓴다. 키워드 이름으로 찾으므로 대본이 조금 바뀌어도 그대로 쓴다.
  A = anchors(S.s, words, loadPrep()?.kw);
  approx = null;
  cur = Math.min(+store.get(sk('cur')) || 0, S.s.length);
}

function curWord() {
  const c = words.findIndex(w => w.n1 > cur);
  return c < 0 ? words.length : c;
}

// 읽은 어절은 흐리게, 지금 어절은 밑줄, 지금 문장은 배경
function render() {
  const c = curWord(), s = words[c]?.s;
  words.forEach((w, i) => {
    const k = i < c ? 'r' : i === c ? 'c' : '';
    if (w.el.className !== k) w.el.className = k;
  });
  sents.forEach((x, i) => {
    x.el.classList.toggle('cur', i === s);
    x.el.classList.toggle('approx', approx !== null && i === s);
  });
  store.set(sk('cur'), cur);

  // 지금 줄을 화면 위에서 1/3 지점에 둔다 (대본 끝이면 마지막 어절)
  const el = words[Math.min(c, words.length - 1)]?.el;
  if (el) {
    const d = el.getBoundingClientRect().top - innerHeight / 3;
    if (Math.abs(d) > el.offsetHeight * 0.6) scrollBy({ top: d, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
}

// by: 누가 옮겼나('voice', 'anchor', 'tap', 'prev', 'next'). 있으면 기록에 남긴다.
function setCur(n, by) {
  n = Math.max(0, Math.min(n, S.s.length));
  if (by) begin();  // 질의응답 화면에서 켠 마이크로 손으로만 넘겨도 발표 시간을 잰다
  if (by) note({ from: cur, to: n, by });
  cur = n;
  render();
}

// 손으로 옮기면 들은 말을 비워서 예전 말에 다시 끌려가지 않게 한다
// lastMove: 손으로 옮긴 직후 3초는 대본 밖으로 보지 않는다. 말 속도(onSec)는 목소리가 맞은 때(lastMatch)로만 잰다.
// 손으로 옮겨도 모으던 애드리브를 닫고 지금 자리부터 다시 모은다 (마지막으로 대본이 맞은 뒤 들은 말은 모두 애드리브로 본다)
function jump(n, by) { heard = ''; cut = sessionNorm.length; pending = null; said = 0; lastMove = Date.now(); approx = null; setCur(n, by); tape.close(0); adNew(); }

function sentStart(i) { return words[sents[i].first].n0; }
function prev() {
  if (!words.length) return;
  const s = words[Math.min(curWord(), words.length - 1)].s;
  jump(cur > sentStart(s) ? sentStart(s) : sentStart(Math.max(0, s - 1)), 'prev');
}
function next() {
  const c = curWord();
  if (c < words.length && words[c].s + 1 < sents.length) jump(sentStart(words[c].s + 1), 'next');
}

// ---- 음성 인식 ----
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const NO_SR = '이 브라우저는 음성 인식이 안 돼요. Chrome이나 Safari를 쓰세요. 손으로 넘기기는 됩니다.';
let rec, listening = false, errored = false, lock = null;
let heard = '', sessionNorm = '', cut = 0, lastHeard = 0, lastMatch = 0, lastAnchor = 0, lastResume = 0, lastMove = 0;  // lastResume: 1.5초 넘게 쉰 뒤 첫 결과, lastMove: 손으로 옮기거나 시작한 때
let resFinal = 0;  // 이번 인식 세션에서 확정된 결과 수 (질문 구간 시작점)
const APPROX_MS = 10000;  // ponytail: 문장 하나를 바꿔 말하는 데 걸리는 시간으로 잡은 값. 기록의 anchor 간격으로 다시 맞춘다.
let said = 0;  // 마지막으로 커서를 옮긴 뒤 새로 들은 글자 수 (말 속도용)

// 어디로 옮길지는 match.js follow()가 정한다 (node match.js 시뮬레이션과 같은 규칙)
function onHeard(h) {
  // 키워드로 옮긴 지 오래면 이어 읽는 중으로 보지 않는다 (애드리브 뒤 키워드 하나에 끌려가지 않게). 점선 표시는 그대로.
  const f = follow(S, A, h, cur, pending, Date.now() - lastAnchor < APPROX_MS ? approx : null);
  pending = f.pending;
  if (f.how) begin();
  if (f.how === 'anchor') {
    // 키워드로 옮긴 곳은 어림 위치다. jump()처럼 들은 말을 비운다. 글자가 맞은 것은 아니므로
    // lastMatch는 그대로 두고, 말 속도에도 넣지 않는다(그동안 말한 시간도 lastMatch가 그대로라 빠진다).
    // 애드리브는 여기서 닫지 않고 나눌 자리만 적어 둔다(adlib.js anchor). 애드리브에 다음 문장 키워드가 섞여도 커서가 옮겨 가기 때문이다.
    // ponytail: 나눈다면 키워드를 찾는 최근 20음절(match.js A_RECENT) 안에서 커서가 간 만큼을 바꿔 읽은 대본으로 보고 뺀다
    tape.anchor(Math.min(said, 20, Math.max(0, f.pos - cur)), cur, f.pos);
    heard = ''; cut = sessionNorm.length; said = 0; approx = f.sent; lastAnchor = Date.now();
    setCur(f.pos, 'anchor');
    return adNew();
  }
  if (!f.how) return;
  lastMatch = Date.now();
  if (f.how === 'wait') return;
  const was = approx !== null;
  approx = null;  // 글자 비교가 다시 맞았다
  if (f.pos !== cur) voiceMove(f.pos);
  else if (was) render();
}

// 말 속도에는 목소리로 앞으로 간 글자만 센다. 건너뛴 대본은 말하지 않았으므로 새로 들은 만큼까지만.
// 애드리브는 커서가 지나온 대본과 맞춰 경계를 잡는다(adlib.js voice).
function voiceMove(n) {
  const lead = tape.voice(S.s, cur, n);
  if (n > cur) matched += Math.min(n - cur, said);
  said = 0;
  setCur(n, 'voice');
  adNew(lead);
}

function say(t) {
  $('heard').textContent = t;
  if (qaMode && t) $('live').textContent = t;  // 질의응답 화면에는 아래 줄이 없으므로
}

function initRec() {
  rec = new SR();
  rec.lang = 'ko-KR';
  rec.continuous = true;
  rec.interimResults = true;
  rec.onresult = e => {
    let t = '', q = '';
    // 세션 안에서 결과 목록이 새로 시작됐으면 세션이 끝난 것처럼 이어 붙인다 (onend와 같게).
    // 확정 전 결과는 합쳐져 목록이 줄기도 하므로, 지난번 확정 결과 수(resFinal)보다 짧아졌을 때만 새 목록으로 본다.
    if (e.results.length < resFinal) {
      heard = (heard + sessionNorm.slice(cut)).slice(-60);
      sessionNorm = ''; cut = 0;
      if (qSeg) { qSeg.done += qSeg.cur + ' '; qSeg.cur = ''; qSeg.from = 0; }
      tape.end();
    }
    resFinal = e.results.length;
    for (let i = e.resultIndex ?? 0; i < e.results.length; i++)  // 바뀐 결과만 (i: 이번 인식 세션 안 번호)
      note({ i, final: e.results[i].isFinal, text: e.results[i][0].transcript, ...(qaMode && { qa: true }) });
    for (let i = 0; i < e.results.length; i++) {
      t += e.results[i][0].transcript;
      if (qSeg && i >= qSeg.from) q += e.results[i][0].transcript;
      if (!e.results[i].isFinal && resFinal > i) resFinal = i;
    }
    tape.heard(Array.from(e.results, r => ({ t: r[0].transcript, final: r.isFinal })));  // 질의응답 중에도 넣어야 위치가 맞는다
    const n0 = sessionNorm.length;
    sessionNorm = norm(t);
    said += Math.max(0, sessionNorm.length - n0);
    if (Date.now() - lastHeard > 1500) lastResume = Date.now();
    lastHeard = Date.now();
    // 질의응답 중에는 대본 추적을 멈춘다 (질문과 답의 낱말에 커서가 끌려가지 않게)
    if (qaMode) { onQuestion(q); return; }
    say(t.slice(-40));
    onHeard(heard + sessionNorm.slice(cut));
  };
  // 크롬은 연속 인식을 혼자 끝내기도 해서, 듣는 중이면 다시 시작한다
  rec.onend = () => {
    heard = (heard + sessionNorm.slice(cut)).slice(-60);
    sessionNorm = ''; cut = 0; resFinal = 0;
    if (qSeg) { qSeg.done += qSeg.cur + ' '; qSeg.cur = ''; qSeg.from = 0; }
    tape.end();  // 정지했으면 여기서 마지막 애드리브가 정해진다
    // 기다리는 사이 '정지'를 눌렀으면 다시 켜지 않는다
    if (listening) setTimeout(() => { if (listening) try { rec.start(); } catch {} }, errored ? 1000 : 0);
    errored = false;
  };
  rec.onerror = e => {
    if (e.error === 'no-speech' || e.error === 'aborted') return;
    errored = true;
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { stop(); say('마이크 권한을 허용해 주세요'); }
    else say(e.error === 'network' ? '인터넷 연결을 확인해 주세요' : '음성 인식 오류: ' + e.error);
  };
}

// 받는 사이 '정지'를 눌렀으면 바로 놓는다
async function keepAwake() {
  try { const l = await navigator.wakeLock?.request('screen'); if (listening) lock = l; else l?.release().catch(() => {}); } catch {}
}

function start() {
  // 대본 끝에서 다시 누르면 처음부터 할지 묻는다 (질의응답 화면의 '질문'은 묻지 않는다)
  if (!qaMode && end && S.s.length && cur >= S.s.length && confirm('대본 끝이에요. 처음부터 다시 할까요?')) jump(0, 'tap');
  if (!rec) initRec();
  listening = true;
  // 질의응답 화면에서 켠 마이크로는 발표 시간을 재지 않는다. 대본을 처음 따라갈 때 잰다(begin).
  if (!t0 || cur === 0) { resetTalk(qaMode ? 0 : Date.now()); baseLevels(); }
  // 30분 넘게 쉬었다가 이어 하면 쉰 시간은 경과 시간에서 뺀다. 끝난 발표면 멈춘 시간(end)도 같이 옮겨서 발표 시간이 그대로 남게.
  else if (Date.now() - seen > 30 * 6e4) { const g = Date.now() - seen; t0 += g; if (end) end += g; }
  // 기록의 위치는 보이는 대본 기준이라 시작할 때마다 단계를 남긴다 (새로고침 뒤 이어 할 때도 기록만으로 위치를 읽을 수 있게)
  if (shr.on && U) note({ shrink: shr.lv, why: 'start', at: cur });
  lastMove = Date.now();
  adNew();
  try { rec.start(); } catch {}
  keepAwake();
  $('mic').classList.add('on');
  $('mic').textContent = '■ 정지';
}

// 질의응답 화면에서 마이크를 켜 아직 발표 시간을 재지 않았으면(start()가 미뤄 둠) 대본을 처음 따라간 지금부터 잰다
function begin() {
  if (t0 || !listening || qaMode) return;
  t0 = Date.now(); onSec = 0;
  clearAds();  // 새 발표
  for (const e of log) e.t -= t0;  // 그 전 기록의 t는 시각 그대로다(note). 발표 시작 기준으로 바꾸면 음수가 된다.
  saveTalk(); keepLog();
  if (shr.on && U) note({ shrink: shr.lv, why: 'start', at: cur });
}

function stop() {
  listening = false;
  tape.close(null);  // 정지 직전까지 한 말 (확정 결과는 정지 뒤에 온다)
  rec?.stop();
  lock?.release().catch(() => {});
  lock = null;
  $('mic').classList.remove('on');
  $('mic').textContent = busy ? '준비 중' : '● 시작';
}

document.addEventListener('visibilitychange', () => {
  if (listening && document.visibilityState === 'visible') keepAwake();
  if (document.hidden) keepLog();
});

// ---- 화면 ----
function setMode(editing) {
  if (editing && qaMode) setQa(false);
  document.body.classList.toggle('editing', editing);
  $('mode').textContent = editing ? '발표' : '편집';
  if (editing) { stop(); scrollTo(0, 0); updEst(); }
  else {
    shrinkUnits(); baseLevels();
    if (!snapshot('발표 시작')) tell(FULL);
    else if (shr.on && target && !U) tell(NEED_PREP);  // 발표 준비 뒤에 대본을 고쳤으면 줄이지 못한다
    show(); render(); prepareTalk(); askShrink();
  }
}

function fontSize(delta) {
  const fs = Math.max(16, Math.min(64, (+store.get('ls.fs') || 28) + delta));
  store.set('ls.fs', fs);
  document.documentElement.style.setProperty('--fs', fs + 'px');
  if (delta && !qaMode) render();
}

// ---- 시간과 말 속도 ----
// 발표 시작 시각, 대본 위에서 말한 시간(초), 목소리로 따라간 글자 수. 대본마다 저장해서 새로고침해도 이어서 잰다(loadScript).
// end: 발표가 끝난 때(대본 끝에 닿았거나 질의응답에 들어간 때). 그 뒤로는 경과 시간을 멈춘다.
//   질의응답에서 대본으로 돌아오거나 끝에서 되돌아가 이어 읽으면 아직 발표 중이므로 푼다(멈춘 동안도 경과 시간에 든다).
let t0 = 0, onSec = 0, matched = 0, seen = 0, target = 0, end = 0;  // target: 목표 시간(분), 0이면 끔
const R0 = 5;  // 처음 기본 말 속도(초당 정규화 글자). 한국어 낭독은 쉼을 포함해 초당 4.8~5.1음절
let r0 = R0;  // 이번 발표의 처음 말 속도: 발표를 시작할 때 잰 속도 rate() (편집창 예상과 같은 값에서 출발)
const saveTalk = () => {
  store.set(sk('talk'), JSON.stringify({ t0, onSec, matched, seen: seen = Date.now(), end, r0 }));  // seen: 마지막으로 들은 때
  // 말 속도는 사람마다 다르므로 대본과 따로 마지막으로 잰 값을 둔다 (편집 화면의 예상 시간, AI 대본 길이)
  // ponytail: 1분 넘게 말한 마지막 발표 하나로 잰다. 리허설 여러 번을 합치려면 시간 가중 평균으로.
  if (onSec >= 60) store.set('ls.rate', JSON.stringify({ s: onSec, m: matched }));
};
// 초당 정규화 글자. 잰 값이 적을 때는 기본값 쪽으로 당긴다(상태줄 예상 종료와 같은 계산).
function rate() {
  let s = 0, m = 0;
  try { const r = JSON.parse(store.get('ls.rate')); s = +r.s || 0; m = +r.m || 0; } catch {}
  return (m + R0 * 30) / (s + 30);
}
const spoken = t => norm(t).length;  // 소리 내어 읽는 글자 수 ([확인 필요] 표시와 문장부호는 빠진다)
// 새 발표: 지난 발표에서 들은 말도 비운다
// 애드리브 목록은 실제로 시작할 때(t) 비운다. 대본을 고쳐서 부르면(0) 그대로 둔다(편집 화면에서 '대본에 넣기'를 이어서 하게).
function resetTalk(t) { t0 = t; onSec = 0; matched = 0; end = 0; r0 = rate(); log = []; heard = ''; cut = sessionNorm.length; pending = null; said = 0; saveTalk(); keepLog(); tape.reset(); if (t) clearAds(); }
const mmss = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

setInterval(() => {
  if (listening) {
    // 손으로 넘긴 글자, 애드리브, 질의응답 시간은 말 속도에서 뺀다
    if (!qaMode && Date.now() - lastMatch < 3000) onSec += 0.5;
    const done = qaMode || (S.s.length && cur >= S.s.length);
    if (t0 && !end && done) end = Date.now();
    else if (end && !done) end = 0;
    saveTalk();
  }
  if (document.body.classList.contains('editing')) { $('status').textContent = ''; return; }
  // 시작 전 대본 처음에 있으면 지난 발표의 시간을 보이지 않는다 (start()가 새로 잰다)
  // 끝났으면 끝난 때에서, 듣지 않는 동안은 마지막으로 들은 때에서 멈춘다
  const now = end || (listening ? Date.now() : seen || Date.now());
  const sec = t0 && (listening || cur) ? Math.max(0, Math.floor((now - t0) / 1000)) : 0;
  const pct = S.s.length ? Math.round(cur / S.s.length * 100) : 0;
  // 키워드로 막 따라갔거나 손으로 옮긴 때도 대본 밖이 아니다 (lastMatch는 말 속도용이라 이 둘에는 안 바꾼다)
  // 쉬었다가 다시 말하기 시작했으면 그때부터 잰다 (첫마디가 대본과 달라도 바로 대본 밖이 아니게)
  const off = !qaMode && listening && lastHeard - Math.max(lastMatch, lastAnchor, lastResume, lastMove) > 3000;
  // 대본 밖이거나 질의응답 중에는 다시 계산하지 않는다. render() 안에서 하지 않는 것은 다시 그리다가 또 그리지 않게.
  if (listening && !off && !qaMode && t0 && target && shr.on && U) autoShrink(sec);
  // 휴대폰에서는 상태줄이 좁아 뒤쪽이 잘리므로 중요한 것을 앞에 둔다: 대본 밖, 목표 대비, 경과, 진행률
  const items = off ? ['<span id="off">대본&nbsp;밖</span>'] : [];
  if (target) {
    // 예상 종료 = 경과 시간 + 남은 글자 / 말 속도. 처음 30초 동안은 기본 속도 쪽으로 당긴다.
    // 시작 전에는 지난 발표 값이 아니라 편집창 예상과 같은 속도(rate())로 본다 (start()가 r0 = rate()로 새로 잰다).
    const k = listening || cur ? (onSec + 30) / (matched + r0 * 30) : 1 / rate();
    const d = Math.round(sec + (S.s.length - cur) * k - target * 60);
    // 항목 안은 &nbsp;로 묶어서 두 줄로 접혀도 낱말과 시간이 떨어지지 않게 한다 (넣는 값은 mmss 숫자뿐)
    items.push(d > 0 ? `<b id="late">초과&nbsp;${mmss(d)}</b>` : `<b>여유&nbsp;${mmss(-d)}</b>`);
  }
  items.push(mmss(sec), pct + '%');
  $('status').innerHTML = items.join(' <span class="dot">·</span> ');
  $('qaBtn').classList.toggle('hot', !qaMode && pct >= 95);
}, 500);

// 편집 화면 아래와 AI 도구의 목표 시간은 같은 값이다
function setTarget(v) {
  target = Math.max(0, +v) || 0;
  target ? store.set(sk('target'), target) : store.del(sk('target'));
  for (const id of ['target', 'gMin']) if (document.activeElement !== $(id)) $(id).value = target || '';
  updEst();
}
$('target').oninput = () => setTarget($('target').value);
$('gMin').oninput = () => setTarget($('gMin').value);

// 편집창 아래 '예상 7:40 / 목표 8:00'. 30분 대본이면 정규화에 휴대폰에서 수 ms가 걸려서 타자를 멈출 때 센다.
function updEst() {
  clearTimeout(updEst.h);
  updEst.h = setTimeout(() => {
    const s = Math.round(spoken($('text').value) / rate()), e = $('est'), w = document.createElement('span');
    const over = target ? s - Math.round(target * 60) : 0;
    e.textContent = `예상 ${mmss(s)}` + (over > 0 ? ` (+${mmss(over)})` : '');  // 넘친 시간은 휴대폰에서도 보이게 .wide 밖에
    e.classList.toggle('over', over > 0);
    w.className = 'wide';
    if (target) { w.textContent = ` / 목표 ${mmss(Math.round(target * 60))}`; e.append(w); }
  }, 150);
  $('shrinkBox').hidden = !target;
}

// ---- 늦어지면 자동 줄이기 (shrink.js) ----
// sk('shrink') = { on, h: 대본 해시, pt: 발표 준비를 한 때, lv: 단위마다 단계(0 원문, 1 줄임, 2 요약), asked: 미리 줄인 대본을 물어본 대본,
//   pre: 미리 줄인 대본으로 연습하기로 했으면 그 단계(처음부터 발표할 때마다 이 단계로 시작) }
// 단계는 대본과 '발표 준비' 결과가 그대로일 때만 쓴다. 저장해 두어서 새로고침해도 같은 글이 보인다.
const SHR0 = { on: false, h: '', pt: 0, lv: [], asked: '', pre: null };
const NEED_PREP = "자동 줄이기는 지금 대본으로 한 '발표 준비' 결과가 있어야 해요. 대본을 고쳤다면 AI 도구의 '발표 준비'를 다시 해 주세요.";
let shr = { ...SHR0 }, U = null, uAt = -1;  // U: 줄이기 단위(지금 대본으로 한 발표 준비가 없으면 null), uAt: 마지막으로 계산한 때의 단위
function loadShrink() {
  try {
    const v = JSON.parse(store.get(sk('shrink')));
    const lvs = a => a.map(x => [1, 2].includes(x) ? x : 0);
    shr = { on: v.on === true, h: String(v.h || ''), pt: +v.pt || 0, lv: Array.isArray(v.lv) ? lvs(v.lv) : [], asked: String(v.asked || ''), pre: Array.isArray(v.pre) ? lvs(v.pre) : null };
  } catch { shr = { ...SHR0 }; }
  U = null;
  $('shrinkOn').checked = shr.on;
}
const saveShrink = () => store.set(sk('shrink'), JSON.stringify(shr));
function shrinkUnits() {
  const text = $('text').value, h = hashText(text), p = loadPrep();
  U = prepFits(p, text) ? units(text, p.paras, spoken) : null;  // 단계(shr.h)는 해시로 보아서, 글이 바뀌면 원문부터 다시
  if (U && (shr.h !== h || shr.pt !== p.t || shr.lv.length !== U.length)) {
    if (shr.h === h && shr.lv.some(Boolean)) store.set(sk('cur'), 0);  // 같은 대본으로 발표 준비를 다시 했으면 옛 단계로 잰 위치는 맞지 않는다
    Object.assign(shr, { h, pt: p.t, lv: U.map(() => 0), pre: null });
    saveShrink();
  }
}

// 발표 화면에 들어갈 때와 처음부터 시작할 때. 목표가 없으면 원문으로, 처음부터면 지난 발표에서 줄인 단계를 버리고
// 미리 줄인 대본을 골랐으면 그 단계로 돌아간다. 편집 화면에서는 위치가 메모리에 없을 수 있어서 저장된 위치를 쓴다.
function baseLevels() {
  if (!shr.on || !U) return;
  cur = +store.get(sk('cur')) || 0;
  const L0 = U.map(() => 0), lv = !target ? L0 : cur ? shr.lv : shr.pre?.length === U.length ? shr.pre : L0;
  if (lv.some((l, i) => l !== shr.lv[i])) setLevels(lv, 'reset');
}

// 발표 화면의 대본. 자동 줄이기가 켜져 있으면 숨긴 문장을 뺀 글이다.
function show() {
  const text = $('text').value, d = shr.on && U ? shrunk(text, U, shr.lv) : { text, cut: [] };
  build(d.text, d.cut);
  uAt = U ? unitAt(U, shr.lv, cur) : -1;
}

// 지금 단위가 바뀔 때만 다시 계산한다. 말 속도는 상태줄의 예상 종료와 같은 값(목소리로 따라간 글자 ÷ 대본 위에서 말한 시간).
function autoShrink(sec) {
  const u = unitAt(U, shr.lv, cur);
  if (u === uAt) return;
  uAt = u;
  const p = plan(U, shr.lv, cur, sec, (matched + r0 * 30) / (onSec + 30), target * 60);
  if (p.lv.some((l, i) => l !== shr.lv[i])) setLevels(p.lv, 'plan', p.over);
}

// 단계를 바꾸고 대본을 다시 그린다. 지금 위치는 같은 문장의 같은 자리로 옮긴다.
// 발표 중에는 지금 위치에서 300자 뒤부터만 바뀌므로 위치, 들은 말, 어림 상태가 그대로 맞다. 확인을 기다리던 먼 위치만 버린다.
function setLevels(lv, why, over = 0) {
  const c = remap(U, shr.lv, lv, cur), moved = c !== cur, a = moved ? null : approx;
  note({ shrink: lv, why, over, at: cur });
  shr.lv = lv;
  saveShrink();
  pending = null;
  if (moved) { heard = ''; cut = sessionNorm.length; said = 0; }
  store.set(sk('cur'), c);
  cur = c;
  if (document.body.classList.contains('editing')) return;
  show();  // build()가 어림 상태를 지운다
  approx = a;
  render();
}

$('shrinkOn').onchange = () => {
  shrinkUnits();
  if (!$('shrinkOn').checked && U && shr.lv.some(Boolean)) setLevels(U.map(() => 0), 'off');
  shr.on = $('shrinkOn').checked;
  shr.asked = ''; shr.pre = null;
  saveShrink();
  if (shr.on && !U) tell(NEED_PREP);
};

// 처음부터 발표할 때 원문이 목표보다 길면 미리 줄인 대본으로 연습할지 묻는다 (대본과 준비 결과마다 한 번).
// 편집 화면의 예상 시간과 같은 말 속도를 쓰고, 300자 고정 없이 처음부터 줄인다.
let pre = null;
function askShrink() {
  if (!shr.on || !U || !target || cur || shr.lv.some(Boolean) || shr.asked === shr.h + ':' + shr.pt) return;
  const r = rate(), goal = target * 60, L0 = U.map(() => 0);
  const est = lv => Math.round(U.reduce((x, u, i) => x + u.len[lv[i]], 0) / r), s0 = est(L0);
  if (s0 <= goal) return;
  const p = plan(U, L0, 0, 0, r, goal, 0);
  if (!p.lv.some(Boolean)) return;
  pre = p.lv;
  $('shrinkMsg').textContent = `지금 대본은 예상 ${mmss(s0)}, 목표 ${mmss(Math.round(goal))}보다 ${mmss(Math.round(s0 - goal))} 길어요. 줄인 대본의 예상 시간: ${mmss(est(pre))}.` +
    (p.over ? ` 다 줄여도 ${mmss(p.over)} 넘어요.` : '');
  showDiff($('shrinkDiff'), '', '', strikes($('text').value, U, pre));
  $('shrinkDlg').showModal();
}
const shrinkAsked = () => { shr.asked = shr.h + ':' + shr.pt; saveShrink(); $('shrinkDlg').close(); };
$('shrinkYes').onclick = () => { shr.pre = pre; shrinkAsked(); setLevels(pre, 'pre'); };
$('shrinkNo').onclick = shrinkAsked;

// ---- 기록 내려받기 ----
// 인식 결과 원문, 목소리로 옮긴 위치, 손으로 고친 위치. 나중에 매처를 고칠 때 쓴다(10분당 손 보정 횟수 등).
// 기록 파일에 적는 앱 버전. 매처나 기록 형식을 바꾸면 올린다. (4: [확인 필요] 표시를 비교에서 뺌, 발표 준비의 다른 말을 키워드로
// 5: 자동 줄이기 { shrink: 단계, why, over, at }와 prep, 질의응답 판정 { qa: 'judge', j, q, ms, top, jev, low, auto }과 고른 칩 { qa: 'pick', j, id, how, rank }
// 6: 발표 전에 질의응답 화면에서 켠 마이크의 기록도 남긴다. 그 기록의 t는 음수다
// 7: 애드리브 구간 adlib (adlib.js readSegs 모양))
const VERSION = 7;
const LOG_MAX = 20000;
let log = [], logId = '';  // logId: 지금 log가 속한 대본 (loadScript가 정한다)
function note(x) {
  // 발표를 시작하기 전 일은 남기지 않는다. 다만 질의응답 화면에서 켠 마이크부터는 마이크를 꺼도 남긴다
  // (t0가 0이라 t는 시각 그대로다. 발표를 시작하면 begin()이, 기록을 받으면 logJson이 바꾼다)
  if (!t0 && !listening && !log.length) return;
  log.push({ t: Date.now() - t0, ...x });
  if (log.length > LOG_MAX) log.shift();
  keepLog.h ||= setTimeout(keepLog, 3000);  // 탭이 죽어도 잃는 기록이 3초 안쪽이게
}

function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const logJson = text => {
  const b = t0 || log[0]?.t || 0;  // 질의응답만 하고 발표는 시작하지 않았으면 첫 기록을 시작으로 본다
  return JSON.stringify({
    app: 'livescript', version: VERSION, userAgent: navigator.userAgent,
    start: b ? new Date(b).toISOString() : null, target, onSec, matched, cur,
    script: text, normLength: norm(text).length, events: t0 ? log : log.map(e => ({ ...e, t: e.t - b })),
    prep: shr.on && prepFits(loadPrep(), text) ? loadPrep().paras : null,  // 자동 줄이기 단계(shrink)로 보이는 대본을 다시 만들 때
    adlib: ads,
  });
};
// 리허설 뒤 오타부터 고쳐도 기록을 받을 수 있게, 대본을 고쳐 새 발표가 되기 직전의 기록(고치기 전 대본과 함께)을 둔다
let lastLog = null;
$('saveLog').onclick = () => {
  const stamp = new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 16).replace(/\D/g, '');
  download(`livescript-log-${stamp}.json`, log.length || !lastLog ? logJson($('text').value) : lastLog);
};
// 새로고침이나 대본을 바꿨다 돌아와도 기록을 잇도록 이 탭에 대본마다 남긴다: 기록이 늘면 3초 안에, 숨거나 떠날 때, 대본을 바꾸기 전, 새 발표를 시작할 때.
// 기록이 비었으면 남은 것도 지워서 새 발표에 옛 기록이 되살아나지 않게.
function keepLog() {
  clearTimeout(keepLog.h); keepLog.h = 0;
  if (logId) try { log.length ? sessionStorage.setItem('ls.log.' + logId, JSON.stringify({ t0, log })) : sessionStorage.removeItem('ls.log.' + logId); } catch {}
}

// ---- 애드리브: 대본에 없는 말을 따로 모은다 (adlib.js) ----
// ads: 마지막 발표의 애드리브. 대본마다 sk('adlib')에 두어 새로고침 뒤와 발표가 끝난 뒤에도 본다. 새 발표를 시작하면 비운다.
// adRes: 보여 준 '대본에 넣기' 비교 { id, full, shown }, adJob: 프롬프트를 복사한 때의 애드리브 목록 (붙여넣은 답을 그 애드리브에 맞춘다)
let ads = [], adRes = null, adCtl = null, adJob = null;
const tape = collector(addAd, norm);
const editing = () => document.body.classList.contains('editing');
const adMsg = t => { $('adMsg').textContent = t; };

// 지금 자리: 앞 문장(읽던 문장, 아무것도 안 읽었으면 -1), 그 자리 바로 앞 말, 앞뒤 문장 (보이는 대본 기준, 앞뒤 문장은 CTX자까지)
// 앞 문장 번호 s는 원문 기준이다(자동 줄이기로 숨긴 문장을 센다). '대본에 넣기'가 원문에서 같은 문장이 여러 번 나올 때 가린다.
function adInfo() {
  const k = words.findLastIndex(w => w.n0 < cur), s = k < 0 ? -1 : words[k].s;
  const sent = i => words.filter(w => w.s === i).map(w => w.t).join(' ').slice(0, CTX);
  const shown = shr.on && U ? U.flatMap((u, i) => u.s.map(x => x.top >= shr.lv[i])) : null;  // 원문 문장마다 보이는지
  let c = -1;
  return { cur, s: shown && s >= 0 ? shown.findIndex(v => v && ++c === s) : s,
    snip: words.slice(Math.max(0, k - 2), k + 1).map(w => w.t).join(' ').slice(-24), prev: s < 0 ? '' : sent(s), next: sent(s + 1) };
}
// 듣는 중이고, 질의응답이 아니고, 대본 끝이 아닐 때만 모은다. lead: 끝에서 이미 들어온 애드리브 음절 수
function adNew(lead) { if (listening && !qaMode && cur < S.s.length) tape.open(adInfo(), lead); }
function addAd(g) {
  if (!t0) return;
  ads.push({ id: (ads.at(-1)?.id || 0) + 1, t: Math.max(0, g.at - t0), e: Math.max(0, g.end - t0), ...g.info, raw: g.raw, text: g.text });
  if (ads.length > AD_MAX) ads.shift();
  saveAds(); renderAds();
}
// ponytail: 저장 공간이 가득 차면 애드리브는 이 화면에만 남는다 (발표 중에 알림을 띄우지 않는다)
const saveAds = () => ads.length ? store.set(sk('adlib'), JSON.stringify(ads)) : store.del(sk('adlib'));
// 하던 AI 정리는 멈춘다. 번호(id)는 새 발표에서 1부터 다시 쓰이므로 결과는 번호가 아니라 애드리브 자체에 맞춘다(adSet).
function clearAds() { adCtl?.abort(); ads = []; adRes = null; saveAds(); renderAds(); }

function adCard(g, full) {
  const d = document.createElement('div');
  const el = (tag, text, cls = '', to = d) => { const e = document.createElement(tag); e.textContent = text; e.className = cls; to.append(e); return e; };
  d.className = 'ad';
  el('p', head(g), 'small');
  el('p', g.text);
  if (g.ai) {
    if (g.ai.title) el('p', g.ai.title, 't');
    if (g.ai.points.length) { const ul = el('ul', ''); for (const p of g.ai.points) el('li', p, '', ul); }
    el('p', g.ai.worth ? '대본에 넣을 만해요' + (g.ai.add.length ? ': ' + g.ai.add.join(' ') : '') : '대본에 넣지 않아도 돼요', g.ai.worth ? 'small ok' : 'small');
  }
  // 대본에 넣기는 편집 화면에서만 (발표 중에 대본을 바꾸면 위치를 처음부터 다시 잡는다)
  if (!full || !editing()) return d;
  const done = $('text').value.includes(addText(g).replace(/[.?!…。]+$/, ''));  // 넣은 글이 지금 대본에 있다 (버전으로 되돌리면 다시 없다)
  if (done) el('p', '대본에 들어 있어요. 되돌리려면 ⋯ 메뉴의 버전 보기에서 고르세요.', 'small');
  if (adRes?.id !== g.id) { el('button', done ? '한 번 더 넣기' : '대본에 넣기').onclick = () => adInsert(g); return d; }
  const cap = el('p', '지금 대본과 비교: ', 'small');
  el('ins', '더할 말', '', cap);
  showDiff(el('div', '', 'diff'), adRes.shown, adRes.full);  // '적용'과 '취소'는 창 아래 줄에
  return d;
}

// 최근 것이 위 (새로 생겨도 내리지 않고 보이게). 복사 글만 오래된 것부터.
function renderAds() {
  const n = ads.length, list = [...ads].reverse();
  $('adBtn').textContent = `애드리브 ${n}`;
  $('adBtn').hidden = !n;
  $('adSideN').textContent = n ? `애드리브 ${n}개` : '애드리브';
  $('adSideEmpty').hidden = !!n;
  $('adSideList').replaceChildren(...list.map(g => adCard(g, false)));
  $('adHead').textContent = !n ? '아직 모은 애드리브가 없어요. 발표 중에 대본에 없는 말을 이어서 하면 여기에 모여요.'
    : `발표에서 대본에 없던 말 ${n}개를 모았어요.` + (editing() ? " '대본에 넣기'를 누르면 바뀌는 곳을 보여 주고, '적용'을 눌러야 대본이 바뀝니다."
      : " '대본에 넣기'는 편집 화면의 ⋯ 메뉴 '애드리브 정리'에서 할 수 있어요.");
  $('adAi').disabled = !n && !adCtl;
  $('adPrompt').disabled = $('adCopy').disabled = $('adSideCopy').disabled = !n;
  $('adList').replaceChildren(...list.map(g => adCard(g, true)));
  $('adApply').hidden = $('adCancel').hidden = !adRes;
}

function openAd() {
  adRes = null; adMsg('');
  $('adOut').hidden = $('adPasteBox').hidden = true;
  showKey(); renderAds();
  $('adDlg').showModal();
}
$('adBtn').onclick = openAd;
$('adSideMore').onclick = openAd;
$('mAdlib').onclick = openAd;
$('adClose').onclick = () => $('adDlg').close();
$('adApply').onclick = () => adApply();
$('adCancel').onclick = () => { adRes = null; adMsg(''); renderAds(); };

async function adCopy() {
  if (!ads.length) return;
  const t = summary(ads);
  try { await navigator.clipboard.writeText(t); tell(`애드리브 ${ads.length}개를 복사했어요.`); }
  catch {
    if (!$('adDlg').open) openAd();
    const o = $('adOut');
    o.value = t; o.hidden = false; o.select();
    adMsg('자동 복사가 안 돼요. 아래 칸의 글을 직접 복사하세요.');
  }
}
$('adCopy').onclick = adCopy;
$('adSideCopy').onclick = adCopy;

// AI 정리: 애드리브와 앞뒤 문장만 보낸다(claude.js adlibPrompt). 키가 없으면 프롬프트 복사 → 결과 붙여넣기.
// segs: 보낸 애드리브(그 순서가 res 순서). 그사이 새 발표가 되었거나 다른 대본으로 갔으면 ads에 없다. 반환: 적용했나
function adSet(segs, res) {
  if (!segs.some(g => ads.includes(g))) { adMsg("그사이 새 발표가 시작됐거나 대본이 바뀌었어요. '프롬프트 복사'부터 다시 해 주세요."); return false; }
  segs.forEach((g, i) => { if (res[i] && ads.includes(g)) g.ai = res[i]; });
  saveAds(); renderAds();
  const w = res.filter(x => x?.worth).length, miss = res.filter(x => !x).length;
  adMsg(`정리했어요. 대본에 넣을 만한 애드리브 ${w}개` + (miss ? `, 정리하지 못한 것 ${miss}개` : '') + (w && !editing() ? ". '대본에 넣기'는 편집 화면에서 할 수 있어요." : '.'));
  return true;
}
$('adAi').onclick = async () => {
  if (adCtl) return adCtl.abort();
  const segs = [...ads];
  if (!segs.length) return;
  adCtl = new AbortController();
  $('adAi').textContent = '멈추기';
  adMsg('AI에 보내는 중…');
  try {
    adSet(segs, await summarizeAdlib(segs, {
      key: keyStore.get(), signal: adCtl.signal,
      onProgress: x => adMsg(x.chars ? `AI가 쓰는 중… ${x.chars}자` : 'AI가 생각하는 중…'),
    }));
  } catch (e) {
    adMsg(e.name === 'AbortError' ? '멈췄어요.' : e.message);
  } finally {
    adCtl = null;
    $('adAi').textContent = 'AI 정리';
    renderAds();
  }
};
$('adPrompt').onclick = () => {
  if (!ads.length) return;
  adJob = [...ads];
  copyPrompt($('adOut'), adlibPrompt(ads).text, adMsg, 'JSON');
  $('adPasteBox').hidden = false;
};
$('adPaste').onclick = () => { $('adPasteBox').hidden = false; $('adPasteIn').focus(); };
$('adPasteApply').onclick = () => {
  const t = $('adPasteIn').value, segs = adJob || ads;  // 이 화면에서 프롬프트를 복사하지 않았으면(새로고침 뒤) 지금 목록
  if (!t.trim()) return adMsg('챗봇이 돌려준 답을 붙여넣어 주세요.');
  try {
    if (!adSet(segs, parseAdlib(t, segs.length))) return;
    $('adPasteIn').value = '';
    $('adPasteBox').hidden = $('adOut').hidden = true;
  } catch (e) { adMsg('적용하지 못했어요. ' + e.message); }
};

// 대본에 넣기: 애드리브가 나온 문장 바로 뒤에 AI가 쓴 문장(없으면 들은 말)을 넣는다. AI 결과처럼 비교를 보여 주고, 적용하기 전에 버전을 남긴다.
function adInsert(g) {
  const now = $('text').value, full = insertAfter(now, g.prev, addText(g), g.s);
  if (full == null) return adMsg('대본에서 이 애드리브의 앞 문장을 찾지 못했어요. 그사이 대본을 고쳤다면 직접 넣어 주세요.');
  adRes = { id: g.id, full, shown: now };
  adMsg("바뀌는 곳을 확인하고 '적용'을 누르세요.");
  renderAds();
  $('adList').querySelector('.diff')?.scrollIntoView({ block: 'nearest' });
  $('adApply').focus();
}
function adApply() {
  const r = adRes;
  adRes = null;
  if (!r) return;
  if ($('text').value !== r.shown) { renderAds(); return adMsg("그사이 대본이 바뀌었어요. '대본에 넣기'를 다시 눌러 주세요."); }
  if (!snapshot('애드리브 넣기 전')) { renderAds(); return adMsg(NOKEEP); }
  const kept = keptIn();
  setText(r.full, '애드리브');  // 대본이 바뀌었으므로 발표 준비와 질문 팩은 다른 수정처럼 '다시 준비' 안내를 받는다
  renderAds();
  adMsg('대본에 넣었어요.' + (kept && ` 넣기 전 대본은 ${kept}에 있어요.`));
  $('adTitle').focus();
}

// 대본이 바뀌면 처음부터 다시 읽는다. src: 바꾼 방법(버전 목록에 보인다)
function textChanged(src) {
  // 저장소에는 아직 고치기 전 대본이 있다. 다른 대본에 갔다 오거나 새로고침해도 받을 수 있게 이 탭에도 둔다.
  if (log.length) { lastLog = logJson(store.get(sk('script')) || ''); try { sessionStorage.setItem('ls.last.' + logId, lastLog); } catch {} }
  const t = $('text').value;
  if (!save(sk('script'), t)) {
    // 가득 차면 이 대본의 오래된 버전부터 지운다 (지금 쓰는 대본이 옛 버전보다 중요하다)
    const vs = vers();
    let gone = 0, ok = false;
    while (!ok && vs.length) { vs.pop(); gone++; vs.length ? store.set(sk('vers'), JSON.stringify(vs)) : store.del(sk('vers')); ok = store.set(sk('script'), t); }
    tell(ok ? `저장 공간이 모자라 이 대본의 오래된 버전 ${gone}개를 지웠어요.` : FULL);
  }
  store.set(sk('cur'), 0); resetTalk(0);
  setSrc(src);
  updEst();
}
function setText(t, src) { $('text').value = t.normalize('NFC'); textChanged(src); undo = null; updAlt(); }
// 맥이나 PDF에서 복사한 한글은 자모가 풀린 꼴(NFD)이다. 편집창 글을 NFC로 맞춰 두어야 고른 위치, 버전 비교, AI 결과가 같은 글자를 센다.
function nfc() {
  const ta = $('text'), v = ta.value, n = v.normalize('NFC');
  if (n === v) return;
  const at = i => v.slice(0, i).normalize('NFC').length, a = at(ta.selectionStart), b = at(ta.selectionEnd);
  ta.value = n; ta.setSelectionRange(a, b);
}
$('text').oninput = e => { if (!e.isComposing) nfc(); textChanged('직접 고침'); undo = null; updAlt(); };
const marks = () => ($('text').value.match(MARK) || []).length;
$('mode').onclick = () => {
  const editing = document.body.classList.contains('editing'), n = editing ? marks() : 0;
  if (editing && !$('text').value.trim()) return tell("먼저 대본을 붙여넣거나 ⋯ 메뉴의 '예시 대본 열기'를 누르세요.");
  if (n && !confirm(`대본에 [확인 필요]가 ${n}곳 남아 있어요. 사실을 확인하지 않은 채 발표 화면으로 갈까요?\n(읽지 않아도 따라가기에는 문제없어요)`)) return;
  setMode(!editing);
};
$('mic').onclick = () => listening ? stop() : start();
$('prev').onclick = prev;
$('next').onclick = next;
$('smaller').onclick = () => fontSize(-2);
$('bigger').onclick = () => fontSize(2);
$('prompt').onclick = e => { const i = e.target.dataset.i; if (i != null) jump(words[i].n0, 'tap'); };
// 버튼에 포커스가 남으면 스페이스가 버튼을 한 번 더 누르게 되므로 바로 뗀다.
// 마우스·터치로 누른 때만 포커스를 뗀다(키보드로 누르면 detail이 0)
addEventListener('click', e => e.detail && e.target.closest('button')?.blur());
addEventListener('keydown', e => {
  if (document.body.classList.contains('editing') || qaMode || e.target.closest?.('input, textarea, dialog')) return;
  if (e.key === 'ArrowRight' || e.key === 'PageDown') next();
  else if (e.key === 'ArrowLeft' || e.key === 'PageUp') prev();
  else if (e.key === ' ' && SR && !busy) listening ? stop() : start();
  else return;
  e.preventDefault();
});

// ---- 질의응답: 판정 준비 ----
// 팩 = { version, questions: [{ id, q, alts, answer, source, check }] }
let pack = null, qsents = [], V = null, vecKey = '', pipe = null, busy = false;
let modelState = store.get('ls.embLoading') ? 'crashed' : 'off';  // off | loading | ready | failed | crashed
let modelErr = '', modelJob = null, vecJob = null;
// 이 기기 설정: 답 카드 자동 열기(기본 꺼짐, 기준값은 qa.js confidence), JEV 모드(실험, 기본 꺼짐, WebGPU가 있는 기기에만 보임)
let autoCard = store.get('ls.autoCard') === '1', jevOn = store.get('ls.jev') === '1';
let jev = null, jevJob = null, jevState = store.get('ls.jevLoading') ? 'crashed' : 'off';  // off | loading | ready | failed | nogpu | crashed
const HAS_GPU = !!navigator.gpu;

function setPack(p) { pack = p; qsents = p ? prepare(p) : []; V = null; vecKey = ''; }

// 모델을 불러오다 탭이 강제 종료되면 표시가 남는다. 다음에는 이 기기에서 자동으로 불러오지 않는다.
function loadJudge(onProgress) {
  modelJob ??= (async () => {
    modelState = 'loading'; showModel();
    store.set('ls.embLoading', '1');
    try {
      const p = await loadModel(onProgress);
      await embed(p, ['준비']);  // 첫 판정이 늦지 않게 한 번 돌려 둔다
      pipe = p; modelState = 'ready';
      navigator.storage?.persist?.().catch(() => {});
    } catch (e) {
      modelBroke(e);
    } finally {
      store.del('ls.embLoading');
      modelJob = null;
      showModel();
    }
  })();
  return modelJob;
}
// 새로고침이나 페이지 이동은 강제 종료가 아니다. 탭이 죽을 때는 pagehide가 오지 않으므로 그때는 표시가 남는다.
addEventListener('pagehide', () => { if (modelJob) store.del('ls.embLoading'); if (jevJob) store.del('ls.jevLoading'); keepLog(); });

// JEV 모델(Kev-0.6B, 워커에서 돈다). e5처럼 불러오다 탭이 죽으면 표시가 남아 다음에는 자동으로 불러오지 않는다.
// 실패하면 e5만으로 판정한다. WebGPU가 없거나 f16 셰이더가 안 되면 jev.js가 받기 전에 멈춘다.
function loadJudgeJev(onProgress) {
  jevJob ??= (async () => {
    jevState = 'loading'; showJev(); showModel();
    store.set('ls.jevLoading', '1');
    try { jev = await loadJev(onProgress); jevState = 'ready'; }
    catch (e) {
      if (e.message !== 'off') console.warn('JEV 오류', e);  // off: 불러오는 중에 JEV 모드를 껐다
      jev = null; jevState = e.message === 'off' ? 'off' : e.message === 'nogpu' ? 'nogpu' : 'failed';
    }
    finally { store.del('ls.jevLoading'); jevJob = null; showJev(); showModel(); }
  })();
  return jevJob;
}
// 받아 둔 모델이 있을 때만 불러온다 (340MB를 저절로 받지 않는다)
const jevNow = () => jevOn && HAS_GPU && jevState === 'off' && jevCached().then(c => c && loadJudgeJev(() => {}));

function showJev() {
  $('jevBox').hidden = !HAS_GPU;
  $('jevOn').checked = jevOn;
  $('jevMsg').textContent = !jevOn ? `JEV 모델(${JEV_SIZE})은 처음 한 번만 받습니다. WebGPU가 되는 기기(PC Chrome 등)에서만 쓰고, 실패하면 e5로 판정합니다.` +
    (matchMedia('(pointer: coarse)').matches ? ' 휴대폰에서는 데이터가 많이 들어 권하지 않아요.' : '') : {
    off: `모델이 없으면 e5로만 판정합니다. 와이파이에서 한 번 받아 두면 이 기기에서 계속 씁니다.`,
    loading: 'JEV 모델을 불러오는 중…',
    ready: 'JEV 준비됨 (Kev-0.6B, 이 기기의 WebGPU로 계산)',
    failed: 'JEV를 쓸 수 없어요. e5로 판정합니다.',
    nogpu: '이 기기의 WebGPU로는 JEV를 쓸 수 없어요(f16 셰이더가 필요해요). e5로 판정합니다.',
    crashed: '지난번에 JEV 모델을 불러오다 멈췄어요. 이 기기에서는 자동으로 불러오지 않아요.',
  }[jevState];
  $('getJev').hidden = !jevOn || jevState === 'ready' || jevState === 'nogpu';
  $('getJev').disabled = jevState === 'loading';
  $('getJev').textContent = jevState === 'failed' || jevState === 'crashed' ? 'JEV 다시 시도' : `JEV 모델 받기 (${JEV_SIZE}, 와이파이 권장)`;
}
$('getJev').onclick = () => loadJudgeJev(p => p.status === 'progress_total' && ($('jevMsg').textContent = 'JEV 모델 받는 중' + pctText(p)));
$('jevOn').onchange = () => {
  jevOn = $('jevOn').checked;
  jevOn ? store.set('ls.jev', '1') : store.del('ls.jev');
  // GPU 메모리를 비우고, 받는 중이면 받기를 멈춘다. 다시 켜면 받아 둔 파일로 불러온다.
  if (!jevOn && (jevState === 'ready' || jevState === 'loading')) { closeJev(); jev = null; jevState = 'off'; }
  showJev(); showModel();
  jevNow();
};
$('autoCard').checked = autoCard;
$('autoCard').onchange = () => { autoCard = $('autoCard').checked; autoCard ? store.set('ls.autoCard', '1') : store.del('ls.autoCard'); };

// 불러오기나 계산이 실패하면 음절 비교로 돌아간다. 실행이 한 번 실패하면 transformers의 실행 순서가 막혀
// 이후 계산도 모두 실패하므로(새로고침해야 풀림) 모델을 더 쓰지 않는다.
function modelBroke(e) {
  console.warn('판정 모델 오류', e);
  pipe = null; modelState = 'failed';
  modelErr = e instanceof TypeError ? '인터넷 연결을 확인하고 다시 시도해 주세요.' : '페이지를 새로고침한 뒤 다시 시도해 주세요.';
  showModel();
}

// 팩 벡터: 해시와 모델 버전이 같으면 저장해 둔 것을 쓰고, 다르면 다시 계산한다
function vectors(onProgress) {
  if (!pipe || !pack) return Promise.resolve();
  const p = pack, texts = qsents.map(s => s.text), hash = packHash(p);
  if (vecKey === hash + ':' + REV) return Promise.resolve();
  if (vecJob) return vecJob.then(() => vectors(onProgress));  // 하던 계산이 끝난 뒤 지금 팩으로 다시 확인
  vecJob = (async () => {
    let v = null;
    try {
      const saved = JSON.parse(store.get('ls.vec'));
      if (saved.hash === hash && saved.rev === REV) v = fromB64(saved.b64);
    } catch {}
    if (v?.length !== texts.length * DIM) {
      try { v = await embedAll(pipe, texts, onProgress); } catch (e) { return modelBroke(e); }
      store.set('ls.vec', JSON.stringify({ hash, rev: REV, b64: toB64(v) }));
    }
    if (pack === p) { V = v; vecKey = hash + ':' + REV; }  // 계산하는 동안 팩이 바뀌었으면 버린다
  })().finally(() => {
    vecJob = null; showModel();
    if (pipe && pack && pack !== p) vectors();  // 그사이 바뀐 팩은 prepareTalk가 busy라 건너뛰었을 수 있다 (V 없이 '준비 중'에 머물지 않게)
  });
  return vecJob;
}

function setBusy(b) {
  busy = b;
  $('mic').disabled = b || !SR;
  if (!listening) $('mic').textContent = b ? '준비 중' : '● 시작';
  $('ask').disabled = b || !pack;
}

const pctText = p => p.status === 'progress_total' ? ` ${Math.round(p.progress)}% (${Math.round(p.loaded / 1e6)}/${Math.round(p.total / 1e6)}MB)` : '';

// 발표 모드에 들어갈 때: 팩이 있고 모델이 이 기기에 있으면, 마이크를 켜기 전에 불러온다
async function prepareTalk() {
  showModel();
  if (!pack || busy || (!pipe && (modelState === 'crashed' || modelState === 'failed'))) return;
  setBusy(true);  // 캐시를 확인하는 동안에도 마이크를 막는다
  try {
    if (pipe || modelState === 'loading' || await modelCached()) {
      const job = loadJudge(p => p.status === 'progress_total' && say('판정 모델 불러오는 중' + pctText(p)))
        .then(() => vectors((i, n) => say(`질문 준비 중 ${i}/${n}`)));
      job.then(() => pipe && jevNow(), () => {});  // JEV는 e5 후보를 다시 고르므로 e5 다음에. 워커에서 불러오므로 마이크를 막지 않는다.
      // 모델 불러오기가 10초를 넘으면(네트워크가 느리거나 멈춤) 마이크를 막지 않는다. 불러오기는 뒤에서 계속된다.
      const slow = new Promise(r => setTimeout(r, 10000)).then(() => modelState === 'loading' ? null : job);
      await Promise.race([job, slow]);
    }
  } catch (e) { console.warn(e); }
  finally { setBusy(false); say(SR ? '' : NO_SR); }
}

function showModel() {
  const ready = modelState === 'ready', stuck = modelState === 'crashed' || modelState === 'failed';
  $('modelMsg').textContent = {
    off: '모델이 없으면 음절 비교만으로 고릅니다. 와이파이에서 한 번 받아 두면 이 기기에서 계속 씁니다.',
    loading: '판정 모델을 불러오는 중…',
    ready: '판정 모델 준비됨 (multilingual-e5-small, 이 기기 안에서 계산)',
    failed: '판정 모델을 쓸 수 없어요. 음절 비교로 동작합니다. ' + modelErr,
    crashed: '지난번에 모델을 불러오다 멈췄어요. 이 기기에서는 자동으로 불러오지 않아요.',
  }[modelState];
  $('getModel').hidden = ready;
  $('getModel').disabled = modelState === 'loading';
  $('getModel').textContent = stuck ? '다시 시도' : '모델 받기 (약 135MB, 와이파이 권장)';
  const j = !jevOn || !HAS_GPU ? '' : jev ? ' + JEV' : { loading: ' · JEV 준비 중', off: ' · JEV 모델 없음' }[jevState] || ' · JEV 없이';
  $('qaState').textContent = !pack ? "준비된 질문이 없어요. 편집 화면의 AI나 ⋯ 메뉴에서 'Q&A 준비'를 열어 만들어 주세요."
    // 모델이 준비된 뒤 질문 벡터를 계산하기 전(V 없음)도 준비 중이다. 벡터 계산이 실패하면 modelBroke가 ready를 푼다.
    : modelState === 'loading' || vecJob || (ready && !V) ? '판정 모델 준비 중… 그동안은 글자 비교로 고릅니다'
    : ready ? `질문 ${pack.questions.length}개 · AI 판정(e5, 기기 안)${j}` : `질문 ${pack.questions.length}개 · AI 모델 없이 글자 비교로 고르는 중`;
  $('qaRetry').hidden = !pack || ready || modelState === 'loading';
  $('qaRetry').textContent = stuck ? '다시 시도' : '판정 모델 받기 (약 135MB, 와이파이 권장)';
  $('ask').disabled = busy || !pack;
}

// 프렙 창의 '모델 받기'와 질의응답 화면의 '판정 모델 받기'('다시 시도')
async function getModel(report) {
  await loadJudge(p => p.status === 'progress_total' && report('모델 받는 중' + pctText(p)));
  if (pipe && pack) await vectors((i, n) => report(`질문 준비 중 ${i}/${n}`));
  report('');
}
$('getModel').onclick = () => getModel(t => t && ($('modelMsg').textContent = t));
// 받는 동안에도 마이크와 '질문'은 쓴다(그동안은 글자 비교). 받는 동안 버튼이 숨어서 두 번 눌리지 않는다.
$('qaRetry').onclick = () => getModel(t => t && ($('qaState').textContent = t)).finally(showModel);

// ---- 질의응답 화면 ----
let qaMode = false, qSeg = null;  // qSeg: '질문'을 누른 뒤 모으는 중인 말 { from, done, cur }
let asked = '';  // 마지막으로 판정한 질문. 전체 목록에서 고른 카드에도 보여 준다.
let judgeN = 0;  // 판정 번호. 기록에서 판정(qa: 'judge')과 고른 칩(qa: 'pick')을 잇고, 새 질문을 시작하면 늘려서 늦게 끝난 판정을 버린다.

function setQa(on) {
  if (on) tape.close(0);  // 질의응답에서 하는 말은 애드리브가 아니다
  qaMode = on; qSeg = null;
  document.body.classList.toggle('qa', on);
  $('qaBtn').textContent = on ? '대본' : 'Q&A';
  askBtn();
  if (on) {
    scrollTo(0, 0); showModel(); renderAll();
    if ($('card').hidden) $('live').textContent = pack ? "'질문'을 누르고 청중 질문을 따라 말한 뒤 한 번 더 누르세요. 채팅 질문은 아래 칸에 붙여넣으세요." : '';
  }
  else jump(cur);  // 질의응답 중에 들은 말에 커서가 끌려가지 않게
}
$('qaBtn').onclick = () => setQa(!qaMode);

function askBtn() {
  $('ask').textContent = qSeg ? '● 듣는 중 · 다시 누르면 고르기' : '질문';
  $('ask').classList.toggle('on', !!qSeg);
}

function ask() {
  if (!qSeg) {
    qSeg = { from: listening ? resFinal : 0, done: '', cur: '' };
    asked = ''; judgeN++;
    $('card').hidden = true; $('chips').textContent = ''; $('qaTime').textContent = ''; $('qaLow').hidden = true;
    $('live').textContent = SR ? '질문을 따라 말한 뒤 한 번 더 누르세요.' : NO_SR;
    if (!listening && SR) start();
  } else {
    const text = (qSeg.done + qSeg.cur).replace(/\s+/g, ' ').trim();
    qSeg = null;
    if (text) judge(text);
    else $('live').textContent = '질문을 듣지 못했어요. 다시 눌러 주세요.';
  }
  askBtn();
}
$('ask').onclick = ask;

// 말하는 동안: 음절 비교로 후보를 계속 바꿔 보여 준다
function onQuestion(q) {
  if (!qSeg || !pack) return;
  qSeg.cur = q;
  const text = (qSeg.done + q).replace(/\s+/g, ' ').trim();
  $('live').textContent = text.slice(-80);
  if (text) chips(rank(pack, qsents, text).slice(0, 3), text, false);
}

// 두 번째 탭이나 입력칸 Enter: e5 + 음절 비교로 판정. JEV 모드면 Kev가 e5 후보 5개와 '해당 없음' 가운데 다시 고른다.
// 자동 열기를 켰으면 e5 1등이 확실할 때(JEV가 있으면 JEV도 같은 1등일 때)만 카드를 바로 연다. 판정마다 기록에 남긴다.
async function judge(text) {
  if (!pack) return;
  const n = ++judgeN, t = performance.now();
  asked = text;
  let qv = null;
  try { if (pipe && V) qv = await embed(pipe, [text]); } catch (e) { modelBroke(e); }
  if (n !== judgeN) return;
  const all = rank(pack, qsents, text, qv, V), ms = Math.round(performance.now() - t);
  let top = all.slice(0, 3), jv = null, jmsg = '';
  if (qv && jev && jevOn) {
    const t1 = performance.now(), five = all.slice(0, 5);
    try {
      const late = new Promise((_, no) => setTimeout(() => no(new Error('timeout')), JEV_TIMEOUT));
      // 질문은 끝 300자까지만 (붙여넣은 긴 채팅 글로 입력이 수천 토큰이 되지 않게)
      jv = { ...rerank(five, await Promise.race([jev(text.slice(-300), five.map(r => r.q.q)), late])), ms: Math.round(performance.now() - t1) };
      top = jv.chips;
    } catch (e) {
      // 늦은 것도 오류처럼 닫는다. 워커는 한 번에 하나씩 처리하므로 멈춘 판정 뒤의 판정도 모두 늦어진다. 'JEV 다시 시도'로 다시 연다.
      const slow = e.message === 'timeout';
      if (!slow) console.warn('JEV 오류', e);
      closeJev(); jev = null; jevState = 'failed'; showJev(); showModel();
      jmsg = slow ? ' · JEV가 늦어 e5로' : ' · JEV 오류로 e5로';
    }
    if (n !== judgeN) return;
  }
  const c = qv ? confidence(all) : null;
  const auto = autoCard && c?.sure && !jv?.noneFirst && (!jv || jv.top[0].q === all[0].q);
  const r3 = x => Math.round(x * 1000) / 1000;
  note({
    qa: 'judge', j: n, q: text, ms, how: qv ? 'e5' : 'simple', low: !!c?.low, auto: auto ? all[0].q.id : null,
    top: all.slice(0, 3).map(r => ({ id: r.q.id, s: r3(r.score), e: qv ? r3(r.e) : null, b: r3(r.b) })),
    ...(jv && { jev: { ms: jv.ms, none: r3(jv.none), top: jv.top.slice(0, 3).map(r => ({ id: r.q.id, p: r3(r.p) })) } }),
    ...(jmsg && { jevFail: jmsg }),
  });
  chips(top, text, true, jv?.noneFirst, !!qv);
  $('qaLow').hidden = !c?.low;
  $('qaTime').textContent = `판정 ${ms}ms · ${qv ? 'e5 + 음절 비교' : '간단 비교'}` + (jv ? ` · JEV ${jv.ms}ms` : '') + jmsg;
  $('live').textContent = '';
  if (auto) openCard(all[0].q, top, text, 'auto', 0);
}

function chip(label, fn, cls = '') {
  const b = document.createElement('button');
  b.className = 'chip ' + cls;
  b.textContent = label;
  b.onclick = fn;
  return b;
}

// noneFirst: JEV가 '해당 없음'을 높은 확률로 골랐으면 맨 앞에. sim: e5 판정이면 칩마다 유사도를 보인다
function chips(top, text, final, noneFirst = false, sim = false) {
  const box = $('chips');
  box.textContent = '';
  // 말하는 동안 바뀌는 후보는 읽어 주지 않는다 (화면 읽기 소리가 질문 인식에 섞이지 않게). 판정이 끝나면 읽어 준다.
  $('qaRes').setAttribute('aria-busy', !final);
  const none = final && chip('해당 없음', () => {
    note({ qa: 'pick', j: judgeN, id: null, how: 'none' });
    box.textContent = ''; $('qaLow').hidden = true; $('all').open = true; $('all').scrollIntoView();
  }, 'none');
  if (none && noneFirst) box.append(none);
  top.forEach((r, i) => {
    const b = chip(r.q.q, () => openCard(r.q, top, text, final ? 'chip' : 'live', i));
    if (sim && typeof r.e === 'number') { const s = document.createElement('small'); s.textContent = ' · 유사도 ' + r.e.toFixed(2); b.append(s); }
    box.append(b);
  });
  if (none && !noneFirst) box.append(none);
}

// 카드는 다음 '질문'을 누를 때까지 저절로 바뀌지 않는다
// how: 어떻게 열었나('chip', 'live' 말하는 중의 칩, 'more' 카드 아래 칩, 'list' 전체 목록, 'auto' 자동). rank: 후보 중 몇째(0부터)
function openCard(q, top = [], text = '', how = '', rank = -1) {
  if (how) note({ qa: 'pick', j: judgeN, id: q.id, how, rank });
  qSeg = null; askBtn();
  $('chips').textContent = ''; $('live').textContent = ''; $('qaLow').hidden = true;
  $('cardHeard').textContent = text ? '인식한 질문: ' + text : '';
  $('cardQ').textContent = q.q;
  $('cardCheck').hidden = !q.check;
  const ul = $('cardA');
  ul.textContent = '';
  for (const a of q.answer.length ? q.answer : ['준비된 답이 없어요.']) {
    const li = document.createElement('li');
    li.textContent = a;
    ul.append(li);
  }
  $('cardSrc').textContent = q.source ? '근거: ' + q.source : '';
  $('cardSrc').hidden = !q.source;
  const more = $('cardMore');
  more.textContent = '';
  if (top.some(r => r.q !== q)) {  // 다른 후보가 답의 일부로 보이지 않게 이름표를 단다
    const p = document.createElement('p');
    p.className = 'small';
    p.textContent = '혹시 이 질문인가요?';
    more.append(p);
  }
  top.forEach((r, i) => r.q !== q && more.append(chip(r.q.q, () => openCard(r.q, top, text, 'more', i))));
  $('card').hidden = false;
}

// 마지막 수단: 검색칸이 달린 전체 질문 목록
// 검색은 친 글자 그대로 비교한다. match.js의 norm은 AI를 에이아이로 바꿔서 'ai'나 '20'으로 못 찾는다.
function renderAll() {
  const f = plain($('allQ').value), box = $('allList');
  box.textContent = '';
  for (const q of pack?.questions || [])
    if (!f || plain([q.q, ...q.alts].join(' ')).includes(f))
      box.append(chip(q.q, () => { $('all').open = false; openCard(q, [], asked, 'list'); }));
}
$('allQ').oninput = renderAll;
// 브라우저 기본 지우기(×)는 너무 작아서 칸을 텍스트로 두고, 누르면 전체를 골라 붙여넣기가 바로 바꾸게 한다
for (const id of ['qaText', 'allQ']) $(id).onfocus = e => setTimeout(() => e.target.select());

$('qaText').onkeydown = e => {
  const v = e.target.value.trim();
  if (e.key !== 'Enter' || e.isComposing || !v) return;
  qSeg = null; askBtn();
  $('card').hidden = true;
  judge(v);
};

// ---- Q&A 준비 창 (편집 화면) ----
let draft = [], genCtl = null;
const copyQs = qs => qs.map(q => ({ ...q, alts: [...q.alts], answer: [...q.answer] }));
const prepMsg = t => { $('prepMsg').textContent = t; };
// 저장하지 않은 질문 수정. 이 탭(sessionStorage)에 대본마다 두어서 창을 닫거나 새로고침해도 다시 열면 보인다.
let dirty = false;
const draftKey = () => 'ls.draft.' + lib.cur;
function touched() { dirty = true; try { sessionStorage.setItem(draftKey(), JSON.stringify(draft)); } catch {} }
function clean() { dirty = false; try { sessionStorage.removeItem(draftKey()); } catch {} }

function info() {
  return {
    topic: $('topic').value.trim(),
    audience: $('audience').value.trim(),
    n: Math.max(1, Math.min(40, Math.round(+$('count').value) || 20)),
    script: $('text').value.normalize('NFC').trim(),
  };
}

// 발표 정보 (대본마다). 'Q&A 준비'와 'AI 도구'의 같은 data-info 칸이 같은 값을 쓴다. 창을 열 때 채운다.
let pinfo = {};
function fillInfo() {
  for (const el of document.querySelectorAll('[data-info]'))
    el.value = pinfo[el.dataset.info] ?? (el.tagName === 'SELECT' ? el.options[0].value : el.defaultValue);
  $('gMin').value = target || '';
}
for (const el of document.querySelectorAll('[data-info]'))
  el.onchange = () => { pinfo[el.dataset.info] = el.value; store.set(sk('qaInfo'), JSON.stringify(pinfo)) || tell(FULL); };

function field(tag, label, value, set) {
  const l = document.createElement('label');
  const el = document.createElement(tag);
  l.className = 'small';
  l.append(label, el);
  el.value = value;
  if (tag === 'textarea') el.rows = Math.min(8, Math.max(2, value.split('\n').length));
  el.oninput = () => { set(el.value); touched(); };
  return l;
}

function renderDraft() {
  const box = $('qList');
  box.textContent = '';
  $('qCount').textContent = draft.length;
  draft.forEach((it, i) => {
    const d = document.createElement('div');
    d.className = 'qitem' + (it.check ? ' check' : '');
    const chk = document.createElement('label'), cb = document.createElement('input');
    chk.className = 'chk';
    cb.type = 'checkbox'; cb.checked = it.check;
    cb.onchange = () => { it.check = cb.checked; d.classList.toggle('check', cb.checked); touched(); };
    chk.append(cb, ' 직접 확인');
    const del = chip('삭제', () => { draft.splice(i, 1); renderDraft(); touched(); });
    del.className = '';
    const row = document.createElement('div'), gap = document.createElement('span');
    row.className = 'row';
    gap.className = 'grow';
    row.append(chk, gap, del);
    const src = document.createElement('p');
    src.className = 'small';
    src.textContent = '근거: ' + it.source;
    src.hidden = !it.source;
    d.append(
      field('input', `질문 ${i + 1}`, it.q, v => { it.q = v; }),
      field('textarea', '바꿔 묻는 말 (한 줄에 하나)', it.alts.join('\n'), v => { it.alts = v.split('\n'); }),
      field('textarea', '답 (한 줄에 하나)', it.answer.join('\n'), v => { it.answer = v.split('\n'); }),
      src, row,
    );
    box.append(d);
  });
}

function setDraft(p, how) {
  draft = copyQs(p.questions);
  renderDraft();
  const n = p.questions.filter(q => q.check).length;
  prepMsg(`${how} 질문 ${p.questions.length}개를 불러왔어요.` + (n ? ` 노란색 ${n}개는 자료에 근거가 없으니 직접 확인하세요.` : '') + " 읽어 보고 고친 뒤 '저장'을 누르세요.");
  touched();
}

function showKey() {
  const k = keyStore.get();
  $('gen').hidden = !k;
  $('keyHint').hidden = !!k;
  $('aiGo').hidden = !k;
  $('aiKeyHint').hidden = !!k;
  $('adAi').hidden = !k;
  $('adKeyHint').hidden = !!k;
  $('keyState').textContent = !k ? '저장된 키가 없어요.' : keyStore.remembered() ? '이 기기에 저장된 키가 있어요.' : '이 탭에만 저장된 키가 있어요.';
  updAlt();
}

function openQa() {
  if (!draft.length) try { draft = copyQs(JSON.parse(sessionStorage.getItem(draftKey())) || []); if (draft.length) dirty = true; } catch { draft = []; }
  if (!draft.length && pack) draft = copyQs(pack.questions);
  fillInfo(); renderDraft(); showKey(); showModel(); showJev();
  $('prep').showModal();
}
$('prepBtn').onclick = openQa;
// 질의응답에는 저장한 질문만 쓰이므로 닫기 전에 묻는다. 닫으면 고친 내용을 버리고 저장한 질문으로 돌아간다(새로고침은 이 탭에 남은 초안으로 잇는다).
const okClose = () => !dirty || (confirm('저장하지 않은 질문 수정이 있어요. 닫으면 고친 내용은 버리고 저장한 질문으로 돌아가요. 닫을까요?') && (draft = [], clean(), true));
$('closePrep').onclick = () => { if (okClose()) $('prep').close(); };
$('prep').addEventListener('cancel', e => { if (!okClose()) e.preventDefault(); });

$('gen').onclick = async () => {
  if (genCtl) return genCtl.abort();
  const inf = info();
  if (!inf.script) return prepMsg('먼저 대본을 붙여넣으세요.');
  genCtl = new AbortController();
  $('savePack').disabled = true;  // 만드는 동안 저장하면 옛 초안이 저장된다
  $('gen').textContent = '멈추기';
  prepMsg('AI에 보내는 중…');
  try {
    const p = await generatePack(inf, {
      key: keyStore.get(), signal: genCtl.signal,
      onProgress: x => prepMsg(x.chars ? `AI가 쓰는 중… 질문 ${x.questions}개` : 'AI가 생각하는 중…'),
    });
    setDraft(p, 'AI가 만든');
  } catch (e) {
    prepMsg(e.name === 'AbortError' ? '멈췄어요.' : e.message);
  } finally {
    genCtl = null;
    $('gen').textContent = 'AI로 만들기';
    $('savePack').disabled = false;
  }
};

// 프롬프트를 보여 주고 클립보드에 복사한다 (Q&A 준비와 AI 도구가 같이 쓴다)
async function copyPrompt(out, text, msg, what) {
  out.value = text;
  out.hidden = false;
  try {
    await navigator.clipboard.writeText(text);
    msg(`프롬프트를 복사했어요. claude.ai 같은 챗봇에 붙여넣고, 받은 ${what}을 '결과 붙여넣기'에 넣으세요.`);
  } catch {
    out.select();
    msg('자동 복사가 안 돼요. 아래 칸의 글을 직접 복사하세요.');
  }
}
$('copyPrompt').onclick = () => {
  const inf = info();
  if (!inf.script) return prepMsg('먼저 대본을 붙여넣으세요.');
  copyPrompt($('promptOut'), qaPrompt(inf).text, prepMsg, 'JSON');
  $('pasteBox').hidden = false;
};
$('pasteBtn').onclick = () => { $('pasteBox').hidden = false; $('pasteIn').focus(); };
$('pasteApply').onclick = () => {
  try {
    setDraft(parsePack($('pasteIn').value), '붙여넣은');
    $('pasteIn').value = '';
    $('pasteBox').hidden = $('promptOut').hidden = true;
  } catch (e) { prepMsg('적용하지 못했어요. ' + e.message); }
};

$('addQ').onclick = () => {
  draft.push({ id: '', q: '', alts: [], answer: [], source: '', check: false });
  renderDraft();
  touched();
  $('qList').lastElementChild.querySelector('input').focus();
};

$('savePack').onclick = async () => {
  const items = draft.filter(it => it.q.trim());
  if (!items.length) {
    store.del(sk('pack')); store.del('ls.vec');
    setPack(null); draft = []; renderDraft(); showModel();
    clean();
    return prepMsg('질문을 모두 지웠어요.');
  }
  let p;
  try { p = cleanPack({ questions: items }); } catch (e) { return prepMsg(e.message); }
  const s = JSON.stringify(p);
  const saved = save(sk('pack'), s);  // 가득 찼으면 벡터를 비우고 한 번 더
  setPack(p);
  draft = copyQs(p.questions);
  renderDraft();
  const done = saved ? `저장했어요. 질문 ${p.questions.length}개`
    : `이 기기에 저장하지 못했어요. 지금 화면에서만 쓸 수 있으니 내보내기로 파일에 저장해 두세요. 질문 ${p.questions.length}개`;
  prepMsg(done);
  $('prepMsg').scrollIntoView({ block: 'nearest' });  // 맨 아래 '저장'을 눌러도 결과가 보이게
  if (saved) clean();
  // 모델이 이 기기에 있으면 지금 벡터를 계산해 둔다 (휴대폰에서 15~30초)
  if (pipe || (modelState === 'off' && await modelCached())) {
    await loadJudge(() => {});
    await vectors((i, n) => prepMsg(`${done}. 판정 준비 중 ${i}/${n}`));
    if (pack === p) prepMsg(V ? `${done}. 판정 준비도 끝났어요.` : done);  // 그사이 다시 저장했으면 그쪽이 알린다
  } else if (modelState !== 'loading') prepMsg(`${done}. 기기 안 AI 판정을 쓰려면 아래 '모델 받기'를 누르세요.`);
  showModel();
};

$('exportPack').onclick = () => {
  let p;
  try { p = cleanPack({ questions: draft }); } catch (e) { return prepMsg('내보낼 질문이 없어요.'); }
  download('qa-pack.json', JSON.stringify(p, null, 2));
};
$('importBtn').onclick = () => $('importFile').click();
$('importFile').onchange = async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  if (f.size > 2e6) return prepMsg('파일이 너무 커요. 질문 팩 JSON 파일인지 확인해 주세요.');
  try { setDraft(parsePack(await f.text()), '파일에서 가져온'); } catch (err) { prepMsg('가져오지 못했어요. ' + err.message); }
};

// ---- AI 키 창 ----
$('keyShared').hidden = !location.hostname.endsWith('.github.io');  // 계정의 Pages 사이트가 모두 한 출처(<계정>.github.io)를 쓴다
const openKey = () => { $('keyIn').value = ''; $('keyRemember').checked = keyStore.remembered(); showKey(); $('keyDlg').showModal(); };
$('keyBtn').onclick = openKey;
$('keyBtn2').onclick = openKey;
$('keyBtn3').onclick = openKey;
$('keyBtn4').onclick = openKey;
$('keySave').onclick = () => {
  const k = $('keyIn').value.replace(/[\s\u200b-\u200d\u2060]/g, '') || keyStore.get();  // 복사할 때 붙은 공백, 보이지 않는 글자 제거
  if (k && !keyOk(k)) { $('keyState').textContent = '키에 쓸 수 없는 글자가 있어요. 키를 다시 복사해 넣어 주세요.'; return; }
  if (k) keyStore.set(k, $('keyRemember').checked);
  $('keyIn').value = '';
  showKey();
  $('keyDlg').close();
};
$('keyClear').onclick = () => { keyStore.clear(); showKey(); };
$('keyClose').onclick = () => $('keyDlg').close();

// ---- 알림: 열린 창이 있으면 그 창의 상태 줄에, 없으면 화면 아래에 ----
function tell(t) {
  const box = document.querySelector('dialog[open] [role=status]') || $('toast');
  box.textContent = t;
  if (box !== $('toast')) return;
  box.hidden = !t;
  clearTimeout(tell.h);
  tell.h = setTimeout(() => { box.hidden = true; }, 6000);
}

// ---- 대본 고르기, 새로 만들기, 이름 바꾸기, 지우기 (편집 화면에서만) ----
function loadScript() {
  keepLog();  // 앞 대본의 기록을 남긴다 (돌아오면 아래에서 잇는다)
  genCtl?.abort(); aiCtl?.abort(); altCtl?.abort(); adCtl?.abort();  // 하던 AI 일은 앞 대본의 것이므로 멈춘다 (결과가 다른 대본에 들어가지 않게)
  $('text').value = (store.get(sk('script')) || '').normalize('NFC');
  target = +store.get(sk('target')) || 0;
  $('target').value = target || '';
  t0 = onSec = matched = seen = end = 0; r0 = rate(); log = []; heard = ''; cut = sessionNorm.length; pending = null; said = 0;
  try { const v = JSON.parse(store.get(sk('talk'))); t0 = +v.t0 || 0; onSec = +v.onSec || 0; matched = +v.matched || 0; seen = +v.seen || t0; end = +v.end || 0; r0 = +v.r0 || rate(); } catch {}
  // 새로고침했거나 다른 대본에 갔다 왔으면 이 탭에 남겨 둔 기록을 잇는다 (새 발표면 t0가 달라 되살리지 않는다)
  logId = lib.cur;
  try { const s = JSON.parse(sessionStorage.getItem('ls.log.' + logId)); if (s?.t0 === t0 && Array.isArray(s.log)) log = s.log; } catch {}
  try { pinfo = JSON.parse(store.get(sk('qaInfo'))) || {}; } catch { pinfo = {}; }
  try { setPack(cleanPack(JSON.parse(store.get(sk('pack'))))); } catch { setPack(null); }  // 질문 팩도 대본마다 (첫 대본은 예전 ls.pack)
  loadShrink();
  draft = []; dirty = false;
  try { lastLog = sessionStorage.getItem('ls.last.' + logId); } catch { lastLog = null; }
  aiRes = null; aiJob = null; undo = null; sel = null;
  ads = readSegs(store.get(sk('adlib'))); adRes = null; tape.reset();  // adJob은 둔다: 앞 대본의 애드리브라 adSet이 맞추지 않는다
  renderLib(); updEst(); updAlt(); renderAds();
}

function renderLib() {
  const s = $('lib');
  s.textContent = '';
  for (const e of lib.list) s.append(new Option(e.name, e.id));
  s.append(new Option('＋ 새 대본', '+'));
  s.value = lib.cur;
}

const cleanName = s => String(s || '').normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, 40);
$('lib').onchange = () => {
  let id = $('lib').value;
  if (id === '+') {
    const name = prompt('새 대본 이름', `대본 ${lib.list.length + 1}`);
    if (name === null) return renderLib();
    id = Date.now().toString(36);
    lib.list.push({ id, name: cleanName(name) || `대본 ${lib.list.length + 1}`, src: '' });
  }
  lib.cur = id;
  saveLib(); loadScript();
};

// 메뉴 창: 버튼을 누르면 메뉴를 먼저 닫는다 (다른 창이 그 위에 열리도록)
$('menuBtn').onclick = () => { $('menuTitle').textContent = entry().name; $('menu').showModal(); };
$('menu').addEventListener('click', e => { if (e.target.closest('button')) $('menu').close(); }, true);
$('mRename').onclick = () => {
  const e = entry(), name = cleanName(prompt('대본 이름', e.name));
  if (!name) return;
  e.name = name;
  saveLib(); renderLib();
};
$('mDel').onclick = () => {
  const e = entry();
  if (!confirm(`'${e.name}' 대본과 그 버전 기록을 지울까요? 되돌릴 수 없어요.`)) return;
  for (const k of ['script', 'cur', 'target', 'talk', 'qaInfo', 'pack', 'vers', 'prep', 'shrink', 'adlib']) store.del(sk(k));
  lib.list = lib.list.filter(x => x !== e);
  log = [];  // 지운 대본의 기록은 남기지 않는다 (loadScript의 keepLog가 이 탭의 것도 지운다)
  try { sessionStorage.removeItem('ls.last.' + e.id); } catch {}
  if (!lib.list.length) lib.list.push({ id: Date.now().toString(36), name: '대본 1', src: '' });
  lib.cur = lib.list[0].id;
  saveLib(); loadScript();
  tell(`'${e.name}'을(를) 지웠어요.`);
};

// 대본 파일: PC에서 쓴 대본을 발표용 휴대폰으로 옮긴다. 목표 시간, 발표 정보, 질문 팩, 발표 준비도 같이 (휴대폰에서 AI를 다시 부르지 않게).
// 가져오면 새 대본으로 더한다. 글 파일(.txt)도 받는다.
$('mExport').onclick = () => download(`${entry().name}.livescript.json`, JSON.stringify({
  app: 'livescript', kind: 'script', name: entry().name, text: $('text').value, target, info: pinfo, pack, prep: loadPrep(),
}));
$('mImport').onclick = () => $('scriptFile').click();
$('scriptFile').onchange = async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  if (f.size > 2e6) return tell('가져오지 못했어요. 파일이 너무 커요.');
  importScript(await f.text(), f.name);
};
// 예시 대본: 같은 출처의 파일을 가져오기와 같은 길로 연다. 키 없이도 자동 줄이기, 따라가기, 질문 판정을 바로 볼 수 있게 자동 줄이기를 켜 둔다.
$('mSample').onclick = () => fetch('sample.livescript.json?v=6').then(r => { if (!r.ok) throw new Error(); return r.text(); })
  .then(t => importScript(t, 'sample.livescript.json', true)).catch(() => tell('예시 대본을 불러오지 못했어요. 인터넷 연결을 확인해 주세요.'));

async function importScript(raw, fname, demo = false) {
  let r;
  try { r = readScript(raw, fname); } catch (err) { return tell('가져오지 못했어요. ' + (err instanceof SyntaxError ? '파일 내용이 깨졌어요.' : err.message)); }
  const id = Date.now().toString(36), k = n => sk(n, id);
  if (!save(k('script'), r.text)) return tell(FULL);
  if (r.target) store.set(k('target'), r.target);
  store.set(k('qaInfo'), JSON.stringify(r.info));
  try { store.set(k('pack'), JSON.stringify(cleanPack(r.pack))); } catch {}  // 질문 팩이 없거나 깨졌으면 질문 없이
  if (r.prep) store.set(k('prep'), JSON.stringify(r.prep));
  if (demo) store.set(k('shrink'), JSON.stringify({ on: true }));
  // 같은 기기에서 내보냈다 가져오면 이름이 겹치므로 ' (2)'처럼 번호를 붙인다 (이름은 40자까지)
  let name = cleanName(r.name) || `대본 ${lib.list.length + 1}`;
  for (let i = 2, b = name.slice(0, 35); lib.list.some(x => x.name === name); i++) name = `${b} (${i})`;
  lib.list.push({ id, name, src: '파일에서 가져옴' });
  lib.cur = id;
  saveLib(); loadScript();
  tell(`'${entry().name}'을(를) 새 대본으로 가져왔어요.` + (pack ? ` 질문 ${pack.questions.length}개도 같이 왔어요.` : '') +
    // 모델이 이 기기에 있으면 발표 화면에 들어갈 때 알아서 불러오고 '판정 모델 받기'도 보이지 않는다
    (demo && modelState === 'off' && !await modelCached() ? " 질의응답 AI 판정을 보려면 발표 화면의 'Q&A'에서 '판정 모델 받기'를 누르세요." : ''));
}

// ---- 버전 ----
// sk('vers') = [{ t, label: 만든 때, src: 대본을 바꾼 방법, text }] 최신이 앞
// ponytail: 버전마다 대본 전체를 저장한다(30분 대본 30개면 약 40만 자). 공간이 모자라면 오래된 것부터 지운다.
// 긴 대본을 여러 개 두는 일이 흔해지면 바로 뒤 버전과의 차이(lib.js diff)만 저장한다.
function vers() {
  try { const v = JSON.parse(store.get(sk('vers'))); return Array.isArray(v) ? v.filter(x => typeof x?.text === 'string') : []; } catch { return []; }
}
// 저장 공간이 모자라면 오래된 버전부터 지우며 다시 해 본다. 지운 알림은 부른 쪽의 알림('적용했어요' 등) 뒤에 보이게 미룬다.
function saveVers(vs) {
  let gone = 0;
  while (!save(sk('vers'), JSON.stringify(vs))) {
    if (vs.length <= 1) return false;
    vs.pop(); gone++;
  }
  if (gone) setTimeout(() => tell(`저장 공간이 모자라 오래된 버전 ${gone}개를 지웠어요.`));
  return true;
}
// 지금 대본을 버전으로 남긴다. 지금 대본이 버전에 있으면 true(새로 남겼거나, 바로 앞 버전과 같거나, 빈 대본), 저장 공간이 모자라 못 남기면 false.
// 대본을 바꾸는 쪽은 false이면 바꾸지 않는다(NOKEEP). once: 바로 앞 버전이 같은 이유로 만든 것이면 또 만들지 않는다('다른 말'처럼 잇달아 쓰는 것)
const NOKEEP = '저장 공간이 가득 차서 지금 대본을 버전에 남기지 못해 바꾸지 않았어요. 쓰지 않는 대본을 지우거나, 지금 대본을 다른 곳에 복사해 둔 뒤 다시 해 주세요.';
function snapshot(label, once = false) {
  const vs = vers();
  if (once && vs[0]?.label === label) return true;
  const nv = addVersion(vs, { t: Date.now(), label, src: entry().src || '직접 고침', text: $('text').value });
  return !nv || saveVers(nv);
}
// 지금 대본이 들어 있는 버전 이름 (snapshot 바로 뒤, 대본을 바꾸기 전에 부른다). 없으면 ''(빈 대본).
// 바로 앞 버전과 같으면 새로 남기지 않으므로 그 버전이다(발표 직후면 '발표 시작').
const keptIn = () => { const v = vers()[0]; return v?.text === $('text').value ? `'${v.label}' 버전(${when(v.t)})` : ''; };

const when = t => { const d = new Date(t), p = n => String(n).padStart(2, '0'); return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`; };
const est = t => mmss(Math.round(spoken(t) / rate()));
const histMsg = t => { $('histMsg').textContent = t; };
let picked = null;  // 버전 창에서 고른 버전

function openHist() { picked = null; histMsg(''); renderVers(); $('hist').showModal(); }
$('mHist').onclick = openHist;
$('histClose').onclick = () => $('hist').close();
function saveVersion() {
  const t = $('text').value;
  if (!t.trim()) return '빈 대본은 저장하지 않아요.';
  if (vers()[0]?.text === t) return '바로 앞 버전과 같아서 따로 저장하지 않았어요.';
  return snapshot('직접 저장') ? '버전을 저장했어요.' : FULL;
}
$('verSave').onclick = () => { histMsg(saveVersion()); renderVers(); };
$('mVerSave').onclick = () => tell(saveVersion());

function renderVers() {
  const box = $('verList'), vs = vers();
  box.textContent = '';
  if (!vs.length) box.textContent = '아직 저장된 버전이 없어요.';
  for (const v of vs) {
    const b = document.createElement('button'), s = document.createElement('small');
    const on = picked?.t === v.t && picked.text === v.text;
    b.className = 'ver' + (on ? ' on' : '');
    b.setAttribute('aria-pressed', on);
    b.append(`${when(v.t)} · ${v.label}`);
    s.textContent = `${v.src || '직접 고침'} · 예상 ${est(v.text)}`;
    b.append(s);
    b.onclick = () => { picked = v; renderVers(); };
    box.append(b);
  }
  $('verView').hidden = $('verRestore').hidden = !picked;
  if (!picked) return;
  const now = $('text').value, d = Math.round(spoken(now) / rate()) - Math.round(spoken(picked.text) / rate());
  $('verHead').textContent = `${when(picked.t)} 버전 → 지금 대본: 예상 ${est(picked.text)} → ${est(now)} (${d < 0 ? '-' : '+'}${mmss(Math.abs(d))})`;
  showDiff($('verDiff'), picked.text, now);
  $('verDiff').scrollIntoView({ block: 'nearest' });
}

// 되돌리기: 지금 대본을 버전으로 남긴 뒤 바꾼다
$('verRestore').onclick = () => {
  if (!picked) return;
  if (picked.text === $('text').value) return histMsg('지금 대본과 같아요.');
  if (!snapshot('되돌리기 전')) return histMsg(NOKEEP);
  const kept = keptIn();
  setText(picked.text, `되돌림(${when(picked.t)})`);
  picked = null;
  renderVers();
  histMsg('되돌렸어요.' + (kept && ` 되돌리기 전 대본은 ${kept}에 있어요.`));
};

// 어절 단위 비교를 그린다. 길게 같은 부분은 앞뒤만 보이고 눌러야 펼친다(30분 대본도 휴대폰에서 읽을 수 있게).
// d: 이미 나눈 결과가 있으면 그것을 그린다(미리 줄이기 창)
function showDiff(box, a, b, d = diff(a, b)) {
  box.textContent = '';
  d.forEach(({ t, v }, i) => {
    if (t === '=' && v.length > 240) {
      const head = i ? v.slice(0, 80) : '', tail = i < d.length - 1 ? v.slice(-80) : '';
      const more = document.createElement('button');
      more.textContent = `… 같은 내용 ${v.length - head.length - tail.length}자 …`;
      more.onclick = () => more.replaceWith(v.slice(head.length, v.length - tail.length));
      return box.append(head, more, tail);
    }
    const el = document.createElement(t === '+' ? 'ins' : t === '-' ? 'del' : 'span');
    el.textContent = v;
    box.append(el);
  });
  if (!d.some(x => x.t !== '=')) box.prepend('(바뀐 곳 없음)\n');
}

// ---- AI 도구: 새로 쓰기, 지시로 고치기, 발표 준비 ----
// job = { tab, prompt: { system, user, text }, schema?, done(받은 글) }. 키가 있으면 API로, 없으면 프롬프트 복사 → 결과 붙여넣기.
let aiTab = 'gen', aiJob = null, aiCtl = null, aiRes = null, aiSel = null;
const aiMsg = t => { $('aiMsg').textContent = t; };
const GO = { gen: 'AI로 쓰기', edit: 'AI로 고치기', prep: '발표 준비 하기' };

function openAi(tab = aiTab) {
  // 편집창에서 고른 글이 있으면 그 문단만 고칠 수 있다
  const ta = $('text');
  aiSel = ta.selectionEnd > ta.selectionStart ? paraRange(ta.value, ta.selectionStart, ta.selectionEnd) : null;
  fillInfo(); showKey(); setTab(tab); aiMsg('');
  $('ai').showModal();
}
$('aiBtn').onclick = () => openAi();
$('aiClose').onclick = () => $('ai').close();  // 쓰던 중이면 뒤에서 계속 받는다 (다시 열면 결과가 있다)
$('aiQa').onclick = () => { $('ai').close(); openQa(); };
for (const b of document.querySelectorAll('#aiTabs [data-tab]')) b.onclick = () => setTab(b.dataset.tab);

function setTab(t) {
  aiTab = t;  // aiJob(복사한 프롬프트)은 두어서 창을 닫았다 열어도 붙여넣은 답이 그 프롬프트의 대본·문단에 맞는다
  for (const b of document.querySelectorAll('#aiTabs [data-tab]')) { b.classList.toggle('on', b.dataset.tab === t); b.setAttribute('aria-pressed', b.dataset.tab === t); }
  for (const p of document.querySelectorAll('#ai [data-pane]')) p.hidden = p.dataset.pane !== t;
  $('aiGo').textContent = aiCtl ? '멈추기' : GO[t];
  $('aiPrompt').hidden = $('aiPasteBox').hidden = true;
  $('aiResBox').hidden = $('aiApply').hidden = aiRes?.tab !== t;  // 결과는 만든 탭에서만 (새로 쓴 초안을 '고치기'에서 적용하지 않게)
  $('aiOut').hidden = true;
  if (t === 'prep') updPrepState();
  if (t === 'edit') {
    $('onlySelBox').hidden = !aiSel;
    if (aiSel) $('selInfo').textContent = `고른 문단만 고치기 (${spoken($('text').value.slice(...aiSel))}자)`;
  }
}

$('instrChips').onclick = e => {
  const b = e.target.closest('button');
  if (b) { $('instr').value = b.textContent; $('instr').focus(); }
};

// 지금 탭의 할 일. 프롬프트에 넣을 입력이 모자라면 Error (paste: 붙여넣은 결과만 받을 때는 프롬프트 입력을 묻지 않는다)
function jobFor(tab, paste = false) {
  const text = $('text').value.normalize('NFC'), r = rate();
  const need = (ok, msg) => { if (!ok && !paste) throw new Error(msg); };
  if (tab === 'gen') {
    const g = k => $('ai').querySelector(`[data-info="${k}"]`).value.trim();
    const i = { topic: g('topic'), audience: g('audience'), goal: g('goal'), tone: g('tone'), outline: g('outline'), refs: g('refs'), minutes: target };
    need(i.topic || i.outline, '주제나 슬라이드 개요를 적어 주세요.');
    i.chars = target ? Math.round(target * 60 * r) : 0;
    return { tab, prompt: scriptPrompt(i), done: t => showRes({ tab, text: cleanScript(t), base: text, range: null, src: 'AI 초안', check: true }) };
  }
  need(text.trim(), '먼저 대본을 쓰거나 붙여넣으세요.');
  if (tab === 'edit') {
    const instr = $('instr').value.trim(), range = $('onlySel').checked && !$('onlySelBox').hidden ? aiSel : null;
    need(instr, '어떻게 고칠지 적어 주세요.');
    const part = range ? text.slice(...range) : '';
    // '30초 줄이기'처럼 줄일 양을 말했는데 고칠 글이 그만큼 길지 않으면 보내지 않는다 (거의 다 지운 답이나 빈 답이 온다).
    // '5분으로 줄여'처럼 목표 길이를 말한 지시는 막지 않는다.
    const chars = spoken(part || text), m = instr.match(/(\d+(?:\.\d+)?)\s*(초|분)\s*(?:정도|만큼|쯤)?\s*줄/);
    if (m) need(m[1] * (m[2] === '분' ? 60 : 1) * r < chars * 0.8, `고칠 글이 예상 ${mmss(Math.round(chars / r))}밖에 안 돼서 ${m[1]}${m[2]} 줄이기는 어려워요. 문단을 더 고르거나 지시를 바꿔 주세요.`);
    return { tab, prompt: editPrompt({ script: text, part, instr, rate: r, chars }), done: t => showRes({ tab, text: cleanScript(t), base: text, range, src: 'AI 고침' }) };
  }
  // 발표 준비: 문단·문장은 lib.js paras(), 키워드는 match.js anchors()로 뽑아 보낸다
  const ps = paras(text), flat = ps.flat(), words = [];
  let s = '';
  flat.forEach((t, si) => t.replace(MARK, ' ').split(/\s+/).filter(Boolean).forEach(x => { const n0 = s.length; s += norm(x); words.push({ s: si, t: x, n0, n1: s.length }); }));
  const kw = flat.map(() => new Set());
  for (const a of anchors(s, words).list) kw[a.sent].add(a.k);
  let k = 0;
  const input = ps.map(p => p.map(t => ({ t, kw: [...kw[k++]] })));
  return {
    tab, schema: PREP_SCHEMA, prompt: prepPrompt(input),
    done: t => {
      const p = parsePrep(t, ps);
      if (!save(sk('prep'), JSON.stringify({ h: hashText(text), t: Date.now(), ...p, n: ps.map(x => x.length) }))) throw new Error(FULL);
      updPrepState();
      aiMsg(`발표 준비를 저장했어요. 문단 ${p.paras.length}개, 다른 말이 있는 키워드 ${Object.keys(p.kw).length}개`);
    },
  };
}

// 저장된 발표 준비 결과 { h: 만든 대본의 해시, t, paras: [{ imp, keep, drop }] (문장 번호 0부터, lib.js paras() 기준), kw, n: 문단마다 문장 수 }
// paras는 늦어지면 줄이기(shrink.js)가 쓴다. 문장 번호만 쓰므로 대본이 같거나(h) 문단과 문장 수가 같을 때(n)만 쓴다.
function loadPrep() {
  try {
    const p = JSON.parse(store.get(sk('prep')));
    if (!p || !Array.isArray(p.paras)) return null;
    // anchors()가 받는 모양만 남긴다 (저장된 값이 깨져도 발표 화면이 멈추지 않게)
    p.kw = Object.fromEntries(Object.entries(p.kw && typeof p.kw === 'object' ? p.kw : {}).filter(([, v]) => Array.isArray(v) && v.every(x => typeof x === 'string')));
    const ints = v => Array.isArray(v) ? v.filter(Number.isInteger) : [];  // shrink.js units()가 받는 모양
    p.paras = p.paras.map(x => ({ imp: [1, 2, 3].includes(x?.imp) ? x.imp : 2, keep: ints(x?.keep), drop: ints(x?.drop) }));
    p.n = Array.isArray(p.n) && p.n.every(Number.isInteger) ? p.n : null;
    return p;
  } catch { return null; }
}
// 오타 하나를 고쳐도 문단과 문장 수가 같으면 문장 번호가 그대로 맞으므로 계속 쓴다
const prepFits = (p, text) => !!p && (p.h === hashText(text) || (!!p.n && p.n.join() === paras(text).map(x => x.length).join()));
function updPrepState() {
  const p = loadPrep(), text = $('text').value, fits = prepFits(p, text);
  $('prepState').textContent = !p ? '아직 하지 않았어요.'
    : p.h === hashText(text) ? `${when(p.t)}에 지금 대본으로 했어요.`
    : fits ? `${when(p.t)}에 했고, 그 뒤 고친 곳이 있지만 문단과 문장 수가 같아서 그대로 써요.`
    : `${when(p.t)}에 했는데 그 뒤로 대본이 바뀌었어요. 줄이기 정보를 쓰려면 다시 해 주세요. (키워드의 다른 말은 그대로 씁니다)`;
  // 늦어지면 뺄 수 있는 문장을 모두 그어 보인다 (단위마다 가장 높은 단계)
  $('prepCap').hidden = $('prepDiff').hidden = !fits;
  if (!fits) return;
  const u = units(text, p.paras, spoken);
  showDiff($('prepDiff'), '', '', strikes(text, u, u.map(x => x.max)));
}

$('aiGo').onclick = async () => {
  if (aiCtl) return aiCtl.abort();
  try { await run(jobFor(aiTab)); } catch (e) { aiMsg(e.message); }
};
$('aiCopy').onclick = () => {
  try { aiJob = jobFor(aiTab); } catch (e) { return aiMsg(e.message); }
  copyPrompt($('aiPrompt'), aiJob.prompt.text, aiMsg, aiTab === 'prep' ? 'JSON' : '대본');
  $('aiPasteBox').hidden = false;
};
$('aiPaste').onclick = () => { $('aiPasteBox').hidden = false; $('aiPasteIn').focus(); };
$('aiPasteApply').onclick = () => {
  const t = $('aiPasteIn').value;
  if (!t.trim()) return aiMsg('챗봇이 돌려준 답을 붙여넣어 주세요.');
  try {
    (aiJob?.tab === aiTab ? aiJob : jobFor(aiTab, true)).done(t);
    $('aiPasteIn').value = '';
    $('aiPasteBox').hidden = $('aiPrompt').hidden = true;
  } catch (e) { aiMsg('적용하지 못했어요. ' + e.message); }
};

// API로 부른다. 대본은 받는 대로 읽기 전용 미리보기에 보여 준다.
async function run(job) {
  aiCtl = new AbortController();
  $('aiGo').textContent = '멈추기';
  $('aiShorter').disabled = $('aiLonger').disabled = $('aiApply').disabled = true;
  const out = $('aiOut'), live = job.tab !== 'prep';
  let frame = 0, last = '';
  out.value = ''; out.hidden = !live;
  $('aiMsg').scrollIntoView({ block: 'nearest' });  // 휴대폰에서는 입력칸 아래라 안 보인다
  aiMsg('AI에 보내는 중…');
  try {
    const t = await callClaude({
      key: keyStore.get(), ...job.prompt, schema: job.schema, signal: aiCtl.signal,
      onProgress: x => {
        if (!x.chars) return aiMsg('AI가 생각하는 중…');
        aiMsg(`AI가 쓰는 중… ${x.chars}자`);
        last = x.text;
        if (live && !frame) frame = requestAnimationFrame(() => { frame = 0; out.value = last; out.scrollTop = out.scrollHeight; });
      },
    });
    cancelAnimationFrame(frame);
    out.hidden = true;
    job.done(t);
  } catch (e) {
    aiMsg(e.name === 'AbortError' ? '멈췄어요.' : e.message);
  } finally {
    aiCtl = null;
    $('aiGo').textContent = GO[aiTab];
    $('aiShorter').disabled = $('aiLonger').disabled = $('aiApply').disabled = false;
  }
}

// 결과: r = { tab: 만든 탭, text: 받은 글, base: 보낼 때 대본, range: 고친 문단 [시작, 끝] 또는 null, src, check: 길이 확인 }
function showRes(r) {
  if (!r.text) throw new Error('받은 대본이 비어 있어요.');
  const now = $('text').value;
  if (r.range && now !== r.base) throw new Error('그사이 대본이 바뀌었어요. 다시 고쳐 주세요.');
  r.full = r.range ? r.base.slice(0, r.range[0]) + r.text + r.base.slice(r.range[1]) : r.text;
  r.shown = now;
  aiRes = r;
  if (aiTab !== r.tab) setTab(r.tab);  // 받는 사이 탭을 바꿨으면 결과를 만든 탭으로
  // 앱이 다시 센다. 목표와 10% 넘게 다르면 줄이기/늘리기
  const s = Math.round(spoken(r.full) / rate()), off = target ? s / (target * 60) - 1 : 0;
  $('aiLen').textContent = `예상 ${mmss(s)}` + (target ? ` / 목표 ${mmss(Math.round(target * 60))} (${off < 0 ? '' : '+'}${Math.round(off * 100)}%)` : '');
  $('aiShorter').hidden = !(r.check && off > 0.1);
  $('aiLonger').hidden = !(r.check && off < -0.1);
  showDiff($('aiDiff'), now, r.full);
  $('aiResBox').hidden = $('aiApply').hidden = false;
  $('aiMsg').scrollIntoView({ block: 'start' });
  const marks = (r.full.match(MARK) || []).length;
  aiMsg("바뀌는 곳을 확인하고 '적용'을 누르세요." + (marks ? ` [확인 필요] ${marks}곳은 발표 전에 직접 확인해 고쳐 주세요.` : ''));
}

// 길이 맞추기: 받은 대본을 다시 고쳐 받는다 (편집창 대본은 그대로)
function fixJob(longer) {
  const r = aiRes, T = Math.round(target * 60 * rate()), len = spoken(r.full);
  const instr = `전체 길이를 약 ${T}자로 ${longer ? '늘려' : '줄여'} 주세요. 지금은 약 ${len}자입니다. 문단 수와 순서는 그대로 두세요.` +
    (longer ? ' 늘릴 때는 설명이나 예시를 더하고, 자료에 없는 사실은 [확인 필요]로 표시하세요.' : ' 줄일 때는 덜 중요한 설명과 예시부터 뺍니다.');
  return { tab: aiTab, prompt: editPrompt({ script: r.full, instr, rate: rate(), chars: len }), done: t => showRes({ ...r, text: cleanScript(t), range: null }) };
}
for (const [id, longer] of [['aiShorter', false], ['aiLonger', true]])
  $(id).onclick = () => {
    if (!aiRes || aiCtl) return;
    const j = fixJob(longer);
    if (keyStore.get()) return run(j);
    aiJob = j;
    copyPrompt($('aiPrompt'), j.prompt.text, aiMsg, '대본');
    $('aiPasteBox').hidden = false;
  };

// 적용: 지금 대본을 버전으로 남긴 뒤 바꾼다
$('aiApply').onclick = () => {
  const r = aiRes;
  if (!r) return;
  if ($('text').value !== r.shown) {
    try { showRes(r); } catch (e) { return aiMsg(e.message); }
    return aiMsg("대본이 바뀌어서 비교를 다시 했어요. 확인하고 다시 '적용'을 누르세요.");
  }
  if (!snapshot('AI 적용 전')) return aiMsg(NOKEEP);
  const kept = keptIn();  // 빈 대본에 적용했으면 ''
  setText(r.full, r.src);
  aiRes = null;
  $('aiResBox').hidden = $('aiApply').hidden = true;
  aiMsg('적용했어요.' + (kept && ` 적용 전 대본은 ${kept}에 있어요.`));
};

// ---- 다른 말: 편집창에서 고른 말을 Claude Haiku가 바꿔 준다 (키가 있을 때만) ----
let sel = null, undo = null, altCtl = null;  // sel: 고른 말 { a, b, t }, undo: 마지막으로 바꾼 것 { a, alt, orig }
function updAlt() {
  const ta = $('text');
  // 버튼을 누르느라 편집창 밖으로 나가도 고른 말을 기억한다
  if (document.activeElement === ta) {
    let a = ta.selectionStart, b = ta.selectionEnd;
    const raw = ta.value.slice(a, b);
    a += raw.length - raw.trimStart().length; b -= raw.length - raw.trimEnd().length;  // 앞뒤 공백은 빼고 바꾼다
    const t = ta.value.slice(a, b);
    sel = t && t.length <= 40 && !t.includes('\n') ? { a, b, t } : null;
    if (undo && sel && (sel.a !== undo.a || sel.t !== undo.alt)) undo = null;  // 다른 말을 새로 고르면 되돌리기 대신 다른 말
  }
  $('altBtn').hidden = !(undo || (sel && keyStore.get()));
  $('altBtn').textContent = undo ? '되돌리기' : '다른 말';
}
document.addEventListener('selectionchange', updAlt);
$('text').addEventListener('select', updAlt);  // Firefox는 편집창 안 선택에 selectionchange가 오지 않는다

$('altBtn').onclick = async () => {
  const ta = $('text');
  if (undo) {
    const u = undo, e = u.a + u.alt.length;
    if (ta.value.slice(u.a, e) === u.alt) { ta.setRangeText(u.orig, u.a, e, 'select'); ta.dispatchEvent(new Event('input')); setSrc('다른 말'); }
    undo = null;
    return updAlt();
  }
  if (!sel || ta.value.slice(sel.a, sel.b) !== sel.t) { sel = null; return updAlt(); }
  const { a, b, t } = sel;
  $('altFrom').textContent = `'${t}' 대신 쓸 말`;
  $('altList').textContent = '';
  $('altMsg').textContent = 'AI에 묻는 중…';
  $('altDlg').showModal();
  altCtl?.abort();
  const ctl = altCtl = new AbortController();
  try {
    const alts = await suggestAlts({ phrase: t, sentence: around(ta.value, a, b) }, { key: keyStore.get(), signal: ctl.signal });
    $('altMsg').textContent = '누르면 그 자리만 바뀝니다.';
    for (const x of alts) $('altList').append(chip(x, () => replaceAlt(a, b, t, x)));
  } catch (e) {
    if (e.name !== 'AbortError') $('altMsg').textContent = e.message;
  }
};
$('altClose').onclick = () => { altCtl?.abort(); $('altDlg').close(); };

function setSrc(src) { const e = entry(); if (e.src !== src) { e.src = src; saveLib(); } }
function replaceAlt(a, b, orig, alt) {
  const ta = $('text');
  if (ta.value.slice(a, b) !== orig) return ($('altMsg').textContent = '그사이 대본이 바뀌어서 바꾸지 못했어요. 다시 골라 주세요.');
  if (!snapshot('다른 말 전', true)) return ($('altMsg').textContent = NOKEEP);
  ta.setRangeText(alt, a, b, 'select');
  ta.dispatchEvent(new Event('input'));  // 저장, 예상 시간 (oninput이 undo를 지우므로 그 뒤에 둔다)
  setSrc('다른 말');
  undo = { a, alt, orig };
  sel = null;
  $('altDlg').close();
  updAlt();
}

if (!SR) { $('mic').disabled = true; say(NO_SR); }
fontSize(0);
loadScript();
$('text').readOnly = false; $('toast').hidden = true;  // 여기까지 오면 앱이 다 불러와졌다 (index.html은 읽기 전용과 안내로 시작)
showKey();
setMode(!$('text').value.trim());
// 대본이 있으면 바로 발표 화면으로 열리므로 [확인 필요]는 여기서 알린다
if (marks() && !document.body.classList.contains('editing')) tell(`대본에 [확인 필요]가 ${marks()}곳 남아 있어요. 발표 전에 편집에서 확인해 주세요.`);
