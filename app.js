// 말랑 화면. match.js(전역 norm, normMap, anchors, follow, MARK)를 먼저 불러온다.
import { cleanPack, prepare, rank, confidence, scriptHits, packHash, toB64, fromB64, loadModel, modelCached, embed, embedAll, REV, DIM, norm as plain } from './qa.js?v=14';
import { keyStore, keyOk, qaPrompt, generatePack, parsePack, callClaude, scriptPrompt, editPrompt, prepPrompt, parsePrep, PREP_SCHEMA, suggestAlts, adlibPrompt, parseAdlib, summarizeAdlib, coachPrompt, parseCoach, coachRun } from './claude.js?v=14';
import { diff, paras, paraRange, paraSpans, sentSpans, around, addVersion, hashText, cleanScript, readScript } from './lib.js?v=14';
import { slidesFrom, outlineLines, topicOf } from './slides.js?v=14';
import { align, swaps, suggest, applyReplace, packSays, readSays, addSays, compareRun, hardWords, wordKey } from './compare.js?v=14';
import { units, shrunk, plan, remap, unitAt, strikes, modeLevels, LABEL } from './shrink.js?v=14';
import { loadJev, closeJev, jevCached, rerank, SIZE as JEV_SIZE, TIMEOUT as JEV_TIMEOUT } from './jev.js?v=14';
import { collector, readSegs, summary, insertAfter, head, addText, MAX as AD_MAX, CTX } from './adlib.js?v=14';
import { modeOf, micIdle, mixKind, secMap, sentAt, newHear, hearStep, hearReset, readHear, newAcc, tickAcc, packAcc, readAcc, ringPush, speechRate,
  newPace, paceHold, paceStep, mRow, newCue, cueStep, readSignal, frames, deviceKind, browserKey, audioDefault, newWatch, watchdog, blockOf, audioNote, W_WIN,
  buildRun, readRuns, upsertRun, saveRuns, runLabel, sumLines, statCards, secRows, tips, toneLines, NAME } from './check.js?v=14';

const $ = id => document.getElementById(id);
history.scrollRestoration = 'manual';  // 새로고침하면 브라우저가 옛 스크롤 자리로 되돌리지 않고 render()가 지금 줄을 1/3에 둔다
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
// ls.lib 내용을 목록으로 다듬는다. 읽을 때와 다른 탭이 목록을 바꿨을 때 같이 쓴다
const cleanList = l => (Array.isArray(l?.list) ? l.list : []).filter(e => typeof e?.id === 'string' && /^\w+$/.test(e.id))
  .map(e => ({ id: e.id, name: typeof e.name === 'string' && e.name.trim() ? e.name.slice(0, 40) : '대본', src: typeof e.src === 'string' ? e.src : '' }));
try {
  const l = JSON.parse(store.get('ls.lib'));
  const list = cleanList(l);
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
        // 시안: 위에 '핵심만으로 줄였어요' 알약과 '원래 대본 보기' 단추. 단어가 아니라서 위치 계산에는 끼지 않는다
        const hd = document.createElement('div'), pill = document.createElement('span'), ob = document.createElement('button');
        hd.className = 'cuthd'; pill.textContent = ['', '조금 줄였어요', '핵심만으로 줄였어요'][cuts[ci].lv];
        ob.type = 'button'; ob.className = 'orig'; ob.textContent = '원래 대본 보기'; ob.dataset.u = cuts[ci].i;
        hd.append(pill, ob); host.append(hd);
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

// 읽은 어절은 흐리게, 지금 어절은 굵게+밑줄, 지금 문장(.cur)에는 색이 없고 읽는 줄 막대가 줄을 알린다. instant: 새로고침·회전·화면 전환 뒤에는 미끄러지지 않고 바로 옮긴다
function render(instant = false) {
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
  const el = words[Math.min(c, words.length - 1)]?.el, rl = $('readline');
  rl.hidden = !el;
  if (el) {
    const top = el.getBoundingClientRect().top, d = top - innerHeight / 3, go = Math.abs(d) > el.offsetHeight * 0.6;
    // 절대 위치로 보낸다: 미끄러지는 중에 또 옮겨도 목표가 겹쳐 더해지지 않아 지금 줄이 읽는 줄 표시에 맞는다
    if (go) scrollTo({ top: scrollY + d, behavior: instant || matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    // 읽는 줄 표시: 스크롤이 끝난 뒤 지금 어절이 있을 줄의 왼쪽
    rl.style.top = (go ? innerHeight / 3 : top) + 'px';
    rl.style.height = el.offsetHeight + 'px';
    rl.style.left = $('prompt').getBoundingClientRect().left + 4 + 'px';
  }
}

// by: 누가 옮겼나('voice', 'anchor', 'tap', 'prev', 'next'). 있으면 기록에 남긴다.
function setCur(n, by) {
  n = Math.max(0, Math.min(n, S.s.length));
  if (by) begin();  // 질의응답 화면에서 켠 마이크로 손으로만 넘겨도 발표 시간을 잰다
  if (by) note({ from: cur, to: n, by });
  cur = n; lastBy = by;  // 발표 점검 구간(secNow)이 누가 옮겼는지 본다
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
const NO_SR = '이 브라우저는 음성 인식이 안 돼요. Chrome이나 Safari를 쓰세요. 손으로 넘기기는 돼요.';
let rec, listening = false, errored = false, lock = null, locking = false;
let recOn = false, recOff = 0;  // 인식기가 켜져 있나, 마지막으로 꺼진 때 (크롬이 끝냈다 다시 켜는 틈을 마이크 버튼에 보인다)
let heard = '', sessionNorm = '', cut = 0, lastHeard = 0, lastMatch = 0, lastAnchor = 0, lastResume = 0, lastMove = 0;  // lastResume: 1.5초 넘게 쉰 뒤 첫 결과, lastMove: 손으로 옮기거나 시작한 때
let resFinal = 0;  // 이번 인식 세션에서 확정된 결과 수 (질문 구간 시작점)
let finalSeen = 0, TX_MAX = 3000;  // 이번 세션에서 구간에 모아 둔 확정 결과 수, 구간마다 모아 둘 글자 수
const APPROX_MS = 10000;  // ponytail: 문장 하나를 바꿔 말하는 데 걸리는 시간으로 잡은 값. 기록의 anchor 간격으로 다시 맞춘다.
let said = 0;  // 마지막으로 커서를 옮긴 뒤 새로 들은 글자 수 (말 속도용)

// 어디로 옮길지는 match.js follow()가 정한다 (node match.js 시뮬레이션과 같은 규칙)
function onHeard(h) {
  // 키워드로 옮긴 지 오래면 이어 읽는 중으로 보지 않는다 (애드리브 뒤 키워드 하나에 끌려가지 않게). 점선 표시는 그대로.
  const f = follow(S, A, h, cur, pending, Date.now() - lastAnchor < APPROX_MS ? approx : null);
  pending = f.pending;
  if (f.how) begin();
  if (f.how === 'anchor') {
    const a = accAt();
    if (a) a.anch++;  // 발표 점검: 옮기기 전 구간
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
  const lead = tape.voice(S.s, cur, n), d = n > cur ? Math.min(n - cur, said) : 0;
  matched += d;
  said = 0;
  setCur(n, 'voice');
  const a = accAt();
  if (a) a.chars += d;  // 발표 점검: 옮긴 뒤 구간 (구간 첫 어절을 읽은 것이 앞 구간에 들지 않게)
  adNew(lead);
}

// tail: 들은 말이면 끝이 보이게 앞을 자른다 (안내 글은 앞부터 보인다)
function say(t, tail = false) {
  const n = tail ? Math.max(8, Math.floor($('heard').clientWidth / 13)) : 0;  // 폭은 앞을 자를 때만 잰다 (화면을 바꿀 때 쓸모없는 강제 레이아웃을 피한다)
  $('heardT').textContent = tail && t.length > n ? '…' + t.slice(1 - n) : t;
  if (qaMode && t) liveMsg(t);  // 질의응답 화면에는 아래 줄이 없으므로
}
// iPhone·iPad의 다른 브라우저(Safari 엔진을 빌려 씀)와 홈 화면 웹앱은 인식 객체가 있어도 동작하지 않는다는 보고가 있다
const NOT_SAFARI = /CriOS|FxiOS|EdgiOS/.test(navigator.userAgent) || navigator.standalone ? 'iPhone·iPad에서는 Safari에서 열어 주세요. 다른 브라우저와 홈 화면 앱에서는 음성 인식이 안 될 수 있어요.' : '';
const sayNone = () => say(SR ? NOT_SAFARI : NO_SR);
// 한 줄 칩은 좁은 화면에서 잘리므로 오류는 토스트로도 올린다. userAgentData는 Chrome·Edge에만 있다(iPadOS Safari는 UA가 Mac이라 글로는 못 가린다)
const CHROMIUM = !!navigator.userAgentData;
const sayErr = t => { say(t); tell(t); };

function initRec() {
  rec = new SR();
  rec.lang = 'ko-KR';
  rec.continuous = true;
  rec.interimResults = true;
  rec.onstart = () => { recOn = true; finalSeen = 0; };
  rec.onresult = e => {
    let t = '', q = '';
    resN++;
    // 인식기 굶음으로 목소리 분석을 끈 뒤 5초 안에 결과가 오면 분석이 원인이었다고 보고 이 브라우저를 막힘으로 적는다
    if (recProbe) { if (blockOf('rec?', recProbe, Date.now()) === 'rec') setBlock('rec'); recProbe = 0; }
    // 세션 안에서 결과 목록이 새로 시작됐으면 세션이 끝난 것처럼 이어 붙인다 (onend와 같게).
    // 확정 전 결과는 합쳐져 목록이 줄기도 하므로, 지난번 확정 결과 수(resFinal)보다 짧아졌을 때만 새 목록으로 본다.
    if (e.results.length < resFinal) {
      heard = (heard + sessionNorm.slice(cut)).slice(-60);
      hearReset(hs, sessionNorm.length);
      sessionNorm = ''; cut = 0;
      if (qSeg) { qSeg.done += qSeg.cur + ' '; qSeg.cur = ''; qSeg.from = 0; }
      tape.end();
    }
    resFinal = e.results.length;
    for (let i = e.resultIndex ?? 0; i < e.results.length; i++) {  // 바뀐 결과만 (i: 이번 인식 세션 안 번호)
      note({ i, final: e.results[i].isFinal, text: e.results[i][0].transcript, ...(qaMode && { qa: true }) });
      // 확정된 말은 그때의 구간에 모아 둔다. 같은 확정 결과가 다시 오면(i가 앞서지 않으면) 세지 않는다
      if (e.results[i].isFinal && i >= finalSeen) {
        finalSeen = i + 1;
        const a = accAt() ? secNow() : -1;
        if (tx[a] != null) tx[a] = (tx[a] + ' ' + e.results[i][0].transcript).trim().slice(0, TX_MAX);
      }
    }
    for (let i = 0; i < e.results.length; i++) {
      t += e.results[i][0].transcript;
      if (qSeg && i >= qSeg.from) q += e.results[i][0].transcript;
      if (!e.results[i].isFinal && resFinal > i) resFinal = i;
    }
    tape.heard(Array.from(e.results, r => ({ t: r[0].transcript, final: r.isFinal })));  // 질의응답 중에도 넣어야 위치가 맞는다
    const n0 = sessionNorm.length;
    sessionNorm = norm(t);
    said += Math.max(0, sessionNorm.length - n0);
    // 발표 점검: 들은 음절(중간 결과가 줄었다 늘어도 두 번 세지 않음)과 1.5초 넘는 멈춤(그 틈에 인식기가 다시 켜졌으면 세지 않음, 멈추기 전 구간)
    const d = hearStep(hs, sessionNorm.length), a = accAt();
    if (Date.now() - lastHeard > 1500) { lastResume = Date.now(); if (a && recOff <= lastHeard) a.gaps++; }
    lastHeard = Date.now();
    // 질의응답 중에는 대본 추적을 멈춘다 (질문과 답의 낱말에 커서가 끌려가지 않게)
    if (qaMode) { onQuestion(q); return; }
    say(t, true);
    onHeard(heard + sessionNorm.slice(cut));
    const b = accAt();
    if (b) b.heard += d;  // 들은 음절은 따라간 글자와 같이 옮긴 뒤 구간에
  };
  // 크롬은 연속 인식을 혼자 끝내기도 해서, 듣는 중이면 다시 시작한다
  rec.onend = () => {
    recOn = false; recOff = Date.now();
    heard = (heard + sessionNorm.slice(cut)).slice(-60);
    hearReset(hs, sessionNorm.length);
    sessionNorm = ''; cut = 0; resFinal = 0; finalSeen = 0;
    if (qSeg) { qSeg.done += qSeg.cur + ' '; qSeg.cur = ''; qSeg.from = 0; }
    tape.end();  // 정지했으면 여기서 마지막 애드리브가 정해진다
    // 기다리는 사이 '정지'를 눌렀으면 다시 켜지 않는다
    if (listening) setTimeout(() => { if (listening) try { rec.start(); } catch {} }, errored ? 1000 : 0);
    errored = false;
  };
  rec.onerror = e => {
    if (e.error === 'no-speech' || e.error === 'aborted') return;
    errored = true;
    if (e.error === 'audio-capture' && listening) stopAudio('rec?');  // 분석용 마이크와 부딪쳤을 수 있다. 분석만 끈다
    if (e.error === 'not-allowed') { stop(); sayErr('마이크 권한을 허용해 주세요. ' + (CHROMIUM ? '주소창 왼쪽 아이콘에서 마이크를 허용하고 새로고침해 주세요' : 'iPhone·iPad는 설정 > 앱 > Safari > 마이크')); }
    // iPhone·iPad Safari는 받아쓰기가 꺼져 있으면 이 오류를 낸다
    else if (e.error === 'service-not-allowed') { stop(); sayErr(CHROMIUM ? '음성 인식이 꺼져 있어요. 브라우저의 음성 인식 설정을 확인해 주세요' : '음성 인식이 꺼져 있어요. iPhone·iPad는 설정 > 일반 > 키보드 > 받아쓰기를 켜 주세요'); }
    else if (e.error === 'network') sayErr('인터넷 연결을 확인해 주세요');
    // audio-capture는 분석용 마이크와 부딪친 일시 오류일 수 있어(위에서 분석을 끄면 1초 뒤 혼자 다시 켜진다) 토스트 없이 칩에만 중립 문구로 둔다
    else { console.warn('음성 인식 오류', e.error); say(e.error === 'audio-capture' ? '마이크를 쓸 수 없어요. 연결과 다른 앱이 쓰는지 확인해 주세요' : '음성 인식이 잠깐 끊겼어요'); }
  };
}

// 발표 화면에 있는 동안 화면이 꺼지지 않게 한다 (정지하고 차례를 기다릴 때, 질의응답 중에도). 받는 사이 편집 화면으로 갔으면 바로 놓는다.
// 탭이 숨으면 브라우저가 놓으므로(released) 다시 보일 때 다시 요청한다.
async function keepAwake() {
  if (editing() || locking || (lock && !lock.released)) return;
  locking = true;
  try { const l = await navigator.wakeLock?.request('screen'); if (editing()) l?.release().catch(() => {}); else lock = l || null; } catch {}
  locking = false;
}
function letSleep() { lock?.release().catch(() => {}); lock = null; }

function start() {
  // 대본 끝에서 다시 누르면 처음부터 할지 묻는다 (질의응답 화면의 '질문'은 묻지 않는다)
  if (!qaMode && end && S.s.length && cur >= S.s.length && confirm('대본 끝이에요. 처음부터 다시 할까요?')) jump(0, 'tap');
  if (!rec) initRec();
  listening = true;
  // 질의응답 화면에서 켠 마이크로는 발표 시간을 재지 않는다. 대본을 처음 따라갈 때 잰다(begin).
  if (!t0 || cur === 0) { resetTalk(qaMode ? 0 : Date.now()); baseLevels(); }
  // 30분 넘게 쉬었다가 이어 하면 쉰 시간은 경과 시간에서 뺀다. 끝난 발표면 멈춘 시간(end)도 같이 옮겨서 발표 시간이 그대로 남게.
  else if (Date.now() - seen > 30 * 6e4) { const g = Date.now() - seen; t0 += g; if (end) end += g; }
  runKind = mixKind(runKind, coach);  // 발표 점검: 같은 발표를 다른 모드로 이어 하면 'mixed'
  if (t0) note({ run: coach });
  // 기록의 위치는 보이는 대본 기준이라 시작할 때마다 단계를 남긴다 (새로고침 뒤 이어 할 때도 기록만으로 위치를 읽을 수 있게)
  if (shr.on && U) note({ shrink: shr.lv, why: 'start', at: cur });
  lastMove = Date.now(); recOff = Date.now(); lastTick = Date.now();
  unstay(); adNew();
  try { rec.start(); } catch {}
  keepAwake();
  $('mic').classList.add('on');
  $('mic').textContent = '정지';
  $('mic').setAttribute('aria-label', '듣는 중, 누르면 정지');
  showCoach();
}

// 질의응답 화면에서 마이크를 켜 아직 발표 시간을 재지 않았으면(start()가 미뤄 둠) 대본을 처음 따라간 지금부터 잰다
function begin() {
  if (t0 || !listening || qaMode) return;
  t0 = runT = Date.now(); onSec = 0;
  clearAds();  // 새 발표
  for (const e of log) e.t -= t0;  // 그 전 기록의 t는 시각 그대로다(note). 발표 시작 기준으로 바꾸면 음수가 된다.
  saveTalk(); keepLog();
  note({ run: coach });
  if (shr.on && U) note({ shrink: shr.lv, why: 'start', at: cur });
}

// 반환: 듣고 있었으면 저장한 발표 점검 기록(말한 시간 20초 미만이면 null)
function stop() {
  const was = listening;
  // 발표 점검: 마지막 말(이나 손으로 옮김) 뒤 3초 넘게 말없이 기다리다 정지했으면 그 시간은 지금 구간의 걸린 시간에서 뺀다.
  // 말한 시간도 그때 멈췄다. 그동안 대본 밖이었으면(마지막 결과가 대본과 달랐으면) 대본 밖 시간에서도 뺀다
  const a = accAt(), idle = (Date.now() - Math.max(lastHeard, lastMove)) / 1000 - 3;
  if (a && idle > 0) {
    if (lastHeard - Math.max(lastMatch, lastAnchor, lastResume, lastMove) > 3000) a.off = Math.max(0, a.off - idle);
    a.wall = Math.max(a.talk, a.wall - idle);  // 마지막 타이머 뒤 시간까지 빼므로 말한 시간 아래로는 내리지 않는다
  }
  listening = false;
  tape.close(null);  // 정지 직전까지 한 말 (확정 결과는 정지 뒤에 온다)
  rec?.stop();
  stopAudio('stop');
  $('mic').classList.remove('on', 'hear', 'gap');
  showCue(null); showCoach();
  return was ? saveRun() : null;
}
// 듣지 않을 때 마이크 버튼: 모드 글자('● 연습')와 화면 읽기용 이름('연습으로 시작'). 준비 중이면 그 글자 그대로
function micRest() {
  const m = $('mic');
  m.textContent = busy ? '준비 중' : micIdle(coach);
  if (busy) m.removeAttribute('aria-label');
  else m.setAttribute('aria-label', coach === 'live' ? '시작' : NAME[coach] + '으로 시작');
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') keepAwake();
  if (document.hidden) { keepLog(); if (listening) saveRun(); }  // 탭을 닫거나 기기가 잠겨도 발표 점검 기록이 남게
});

// ---- 화면 ----
function setMode(editing) {
  stopHear();
  if (editing && qaMode) setQa(false);
  document.body.classList.toggle('editing', editing);
  document.querySelector('meta[name=theme-color]').content = editing ? '#FFFFFF' : '#0F1115';  // 주소창·제목줄 색을 화면(밝은 편집, 어두운 발표)에 맞춘다
  $('mode').textContent = editing ? '발표' : '편집';
  $('mode').classList.toggle('cta', editing);
  closeUndo(); sayNone();
  // iPad는 전체 화면에서 글자 입력을 막으므로 편집 화면에서는 끈다
  if (editing) {
    stop(); letSleep(); scrollTo(0, 0); updEst(); cardAt = -1; cardNew = false; renderCards();  // 연습에서 막힌 낱말과 줄이기 단계가 바뀌었을 수 있다
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    // 실전은 결과 창을 저절로 열지 않으므로 편집 화면으로 돌아오면 한 번 알린다 (저장하지 못했으면 그 안내를)
    if (runFull) { runFull = false; tell(FULL); }
    else if (liveNote) tell("방금 발표의 점검 결과는 ⋯ > '발표 점검'에서 볼 수 있어요." + (audioNote(liveNote) && ' ' + audioNote(liveNote)), { stay: true });
    liveNote = null;
  }
  else {
    keepAwake();
    shrinkUnits(); baseLevels();
    if (!snapshot('발표 시작')) tell(FULL);
    else if (shr.auto && target && !U) tell(NEED_PREP);  // 발표 준비 뒤에 대본을 고쳤으면 줄이지 못한다
    show(); render(true); prepareTalk(); askShrink();
  }
}

// 회전하거나 창 크기를 바꾸면 지금 줄을 다시 1/3에 둔다. 주소창이 숨거나 나오는 정도(높이만 120px 이하)는 손으로 내린 자리를 그대로 둔다.
let vw = innerWidth, vh = innerHeight, resized = 0;
addEventListener('resize', () => {
  clearTimeout(resized);
  resized = setTimeout(() => {
    if (innerWidth === vw && Math.abs(innerHeight - vh) <= 120) return;
    vw = innerWidth; vh = innerHeight;  // 편집·질의응답 화면에서 돌려도 새 크기를 적어 둔다 (돌아올 때 render가 맞춘다)
    if (!editing() && !qaMode) render(true);
  }, 150);
});

// 태블릿은 거치대에 세워 두고 멀리서 읽으므로 기본 글자를 키운다. iPad Safari는 Mac처럼 자신을 알려서 화면 크기와 터치로 가린다.
const TABLET = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) >= 600;
function fontSize(delta) {
  const fs = Math.max(16, Math.min(64, (+store.get('ls.fs') || (TABLET || innerWidth >= 900 ? 34 : 28)) + delta));
  store.set('ls.fs', fs);
  document.documentElement.style.setProperty('--fs', fs + 'px');
  $('fsNow').textContent = fs;
  if (delta && !qaMode && !editing()) render();  // 편집 화면에서는 숨은 대본을 다시 그리지 않는다(읽던 위치를 저장하고 스크롤하므로)
}

// 글 폭: 좁게 18em, 보통 24em, 넓게 960px(기본, 시안의 prompter-max). 좁게·보통은 글자 크기에 맞춰 한 줄 글자 수가 같게 em으로 둔다.
const WIDTHS = ['18em', '24em', '960px'];
function textWidth(w) {
  if (!WIDTHS.includes(w)) w = '960px';
  document.documentElement.style.setProperty('--w', w);
  for (const b of document.querySelectorAll('[data-w]')) b.setAttribute('aria-pressed', b.dataset.w === w);
}

// ---- 시간과 말 속도 ----
// 발표 시작 시각, 대본 위에서 말한 시간(초), 목소리로 따라간 글자 수. 대본마다 저장해서 새로고침해도 이어서 잰다(loadScript).
// end: 발표가 끝난 때(대본 끝에 닿았거나 질의응답에 들어간 때). 그 뒤로는 경과 시간을 멈춘다.
//   질의응답에서 대본으로 돌아오거나 끝에서 되돌아가 이어 읽으면 아직 발표 중이므로 푼다.
//   질의응답 시간은 경과에서 빼고(endQa), 대본 끝에서 멈춘 동안은 경과에 든다.
let t0 = 0, onSec = 0, matched = 0, seen = 0, target = 0, end = 0;  // target: 목표 시간(분), 0이면 끔
// endQa: end를 질의응답 때문에 정했나(돌아오면 그동안을 경과에서 뺀다), qaAt: 질의응답 화면에 들어온 때, offT: 마지막으로 대본 밖이던 때(돌아오면 자동 줄이기를 다시 계산)
let endQa = false, qaAt = 0, offT = 0;
const R0 = 5;  // 처음 기본 말 속도(초당 정규화 글자). 한국어 낭독은 쉼을 포함해 초당 4.8~5.1음절
let r0 = R0;  // 이번 발표의 처음 말 속도: 발표를 시작할 때 잰 속도 rate() (편집창 예상과 같은 값에서 출발)
const saveTalk = () => {
  store.set(sk('talk'), JSON.stringify({ t0, onSec, matched, seen: seen = Date.now(), end, endQa, r0,  // seen: 마지막으로 들은 때
    acc: acc && packAcc(acc), hs, rt: runT, kind: runKind, rd, tx, cues, aud: runAud, re }));  // 발표 점검 (아래 '발표 점검' 참고)
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
function resetTalk(t) { t0 = t; onSec = 0; matched = 0; end = 0; endQa = false; r0 = rate(); log = []; heard = ''; cut = sessionNorm.length; pending = null; said = 0; newRun(); saveTalk(); keepLog(); tape.reset(); if (t) { clearAds(); coachCtl?.abort(); } }
const mmss = s => { s = Math.max(0, Math.round(s) || 0); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };  // 초는 반올림해 정수로(연습 기록의 걸린 시간은 소수다)

setInterval(() => {
  const tNow = Date.now(), dt = (tNow - lastTick) / 1000;  // 발표 점검은 0.5초가 아니라 실제 시각 차이로 더한다 (창이 가려지면 타이머가 늦어진다)
  lastTick = tNow;
  if (listening) {
    // 손으로 넘긴 글자, 애드리브, 질의응답 시간은 말 속도에서 뺀다
    if (!qaMode && Date.now() - lastMatch < 3000) onSec += 0.5;
    const atEnd = S.s.length && cur >= S.s.length, done = qaMode || atEnd;
    if (t0 && !end && done) { end = Date.now(); endQa = !atEnd; }
    // 질의응답 때문에 멈췄으면 그동안의 시간은 발표 경과에서 뺀다 (대본 끝에서 갔다 왔으면 멈춘 값 그대로)
    else if (end && !done) { if (endQa) t0 += Date.now() - end; end = 0; endQa = false; }
    saveTalk();
    // 마이크 버튼: 들리면 채운 원, 조용하면 빈 원, 크롬이 인식을 끝내고 다시 켜는 틈이 길면 '연결 중'.
    // 4초가 넘으면 혼자 다시 켜지 못한 것으로 보고 '다시 듣기' (iOS Safari는 누르는 동작 없이 다시 켜기가 실패하기도 한다)
    const m = $('mic'), gap = !recOn && Date.now() - recOff > 700, label = !gap ? '정지' : stuck() ? '다시 듣기' : '연결 중';
    m.classList.toggle('hear', Date.now() - lastHeard < 1500);
    m.classList.toggle('gap', gap);
    if (m.textContent !== label) m.textContent = label;
    $('listen').lastChild.textContent = !gap ? '듣는 중' : stuck() ? '다시 듣기 필요' : '연결 중';
    m.setAttribute('aria-label', !gap ? '듣는 중, 누르면 정지' : stuck() ? '음성 인식이 멈췄어요. 누르면 다시 들어요' : '음성 인식 다시 연결 중');
  }
  if (editing()) return;
  // 시작 전 대본 처음에 있으면 지난 발표의 시간을 보이지 않는다 (start()가 새로 잰다)
  // 끝났으면 끝난 때에서, 듣지 않는 동안은 마지막으로 들은 때에서 멈춘다
  const now = end || (listening ? Date.now() : seen || Date.now());
  const sec = t0 && (listening || cur) ? Math.max(0, Math.floor((now - t0) / 1000)) : 0;
  const pct = S.s.length ? Math.round(cur / S.s.length * 100) : 0;
  // 키워드로 막 따라갔거나 손으로 옮긴 때도 대본 밖이 아니다 (lastMatch는 말 속도용이라 이 둘에는 안 바꾼다)
  // 쉬었다가 다시 말하기 시작했으면 그때부터 잰다 (첫마디가 대본과 달라도 바로 대본 밖이 아니게)
  const off = !qaMode && listening && lastHeard - Math.max(lastMatch, lastAnchor, lastResume, lastMove) > 3000;
  // 대본 밖(기다리는 중)은 읽는 자리와 아래 줄에서 보인다 (index.html body.off)
  document.body.classList.toggle('off', off);
  // 대본 밖이거나 질의응답 중에는 다시 계산하지 않는다. render() 안에서 하지 않는 것은 다시 그리다가 또 그리지 않게.
  // 대본 밖 말을 하다 대본으로 돌아오면(다시 맞으면) 같은 문단이어도 그만큼 늦어졌으므로 한 번 다시 계산한다.
  if (off) offT = Date.now();
  // 먼 위치 확인을 기다리는 중이면(pending) 확인된 뒤에 한다. 다시 계산하면 setLevels가 기다리던 위치를 버린다.
  else if (offT && !pending && Math.max(lastMatch, lastAnchor) > offT) { offT = 0; uAt = -1; }
  if (listening && !off && !qaMode && t0 && target && shr.auto && U && coach !== 'read') autoShrink(sec);  // 리딩은 재기만 한다
  // 상태줄 큰 칸: 목표 대비 하나(목표가 없으면 경과). 시작 전에는 편집창과 같은 '예상'이고 아직 늦은 것이 아니라 주황을 쓰지 않는다.
  // 작은 칸: 경과. 진행률은 위 막대에 있고 넓은 화면에서만 글자로도 보인다.
  // 아직 시작하지 않았으면(t0 없음) 손으로 옮겨도 '예상'이다
  const started = !!(t0 && (listening || cur)), pre = !listening && !started;
  const goal = coach === 'read' ? 0 : target;  // 리딩은 목표가 없는 것처럼: 경과만, 주황 '초과'와 눈금 없음
  let cls = '', late = false, d = 0;
  if (target) {
    // 예상 종료 = 경과 시간 + 남은 글자 / 말 속도. 처음 30초 동안은 기본 속도 쪽으로 당긴다.
    // 시작 전에는 지난 발표 값이 아니라 편집창 예상과 같은 속도(rate())로 본다 (start()가 r0 = rate()로 새로 잰다).
    const k = listening || cur ? (onSec + 30) / (matched + r0 * 30) : 1 / rate();
    d = Math.round(sec + (S.s.length - cur) * k - target * 60);
  }
  const wide = document.createElement('span');  // 좁은 화면에서는 '예상'을 뺀다
  wide.className = 'wide'; wide.textContent = '예상 ';
  let badge = [];
  if (goal) {
    late = !pre && d > 0;
    badge = pre ? [`예상 ${d > 0 ? '+' : '-'}${mmss(Math.abs(d))}`] : d > 0 ? ['초과 ', wide, mmss(d)] : ['여유 ' + mmss(-d)];
    cls = pre ? 'pre' : late ? 'late' : '';
  }
  // 상태줄: 지난 시간을 크게, 목표가 있으면 '/ 목표'와 목표 대비 배지. 질의응답에서는 '질문 답변'과 멈춘 발표 경과.
  $('stSec').textContent = qaMode ? `발표 ${mmss(sec)} 경과` : mmss(sec);
  $('stOf').textContent = goal && !qaMode ? ' / ' + mmss(Math.round(target * 60)) : '';
  $('stMain').replaceChildren(...(qaMode ? ['질문 답변'] : badge));
  $('stMain').className = 'main ' + (qaMode ? '' : cls);
  // 진행 막대: 채운 폭은 진행률, 흰 눈금은 목표에 맞추려면 지금 있어야 할 곳(목표가 있고 발표를 시작했을 때만)
  const bar = $('bar'), tick = goal && started;
  bar.style.setProperty('--p', pct + '%');
  bar.style.setProperty('--t', tick ? Math.min(100, sec / (target * 60) * 100) + '%' : '0%');
  bar.lastChild.hidden = !tick;
  bar.classList.toggle('late', late);
  // 시안: 남은 시간 1분 전부터 아래에 알림 칩. 처음 나올 때 한 번 진동(되는 기기만). 목표가 지났거나 리딩·질의응답·멈춘 때는 없다
  const remain = goal && started && listening && !qaMode && !end ? goal * 60 - sec : 0;
  const alertOn = remain > 0 && remain <= 60;
  if (alertOn) { $('timeAlert').textContent = `남은 시간 ${mmss(Math.ceil(remain))}`; if ($('timeAlert').hidden) navigator.vibrate?.(200); }
  $('timeAlert').hidden = !alertOn;
  $('qaBtn').classList.toggle('hot', !qaMode && pct >= 95);
  coachTick(tNow, dt, sec, off, late, d);
}, 500);

// 편집 화면 아래와 AI 도구의 목표 시간은 같은 값이다
function setTarget(v) {
  target = Math.max(0, +v) || 0;
  target ? store.set(sk('target'), target) : store.del(sk('target'));
  for (const id of ['target', 'gMin', 'cTarget']) if (document.activeElement !== $(id)) $(id).value = target || '';
  updEst(); syncChips();
}
$('target').oninput = () => setTarget($('target').value);
$('gMin').oninput = () => setTarget($('gMin').value);
$('cTarget').oninput = () => { setTarget($('cTarget').value); renderCheck(); };  // 발표 점검 결과 창: 기대 시간을 새 목표로 다시 그린다

// 편집창 아래 '예상 7:40 / 목표 8:00'. 30분 대본이면 정규화에 휴대폰에서 수 ms가 걸려서 타자를 멈출 때 센다.
function updEst() {
  clearTimeout(updEst.h);
  updEst.h = setTimeout(() => {
    renderVerSide();  // 버전 카드는 타자를 멈춘 뒤에 다시 그린다 (글자마다 그리면 긴 대본에서 무겁다)
    const s = Math.round(spoken($('text').value) / rate()), e = $('est'), w = document.createElement('span');
    const over = target ? s - Math.round(target * 60) : 0;
    e.textContent = `예상 ${mmss(s)}` + (over > 0 ? ` (+${mmss(over)})` : '');  // 넘친 시간은 휴대폰에서도 보이게 .wide 밖에
    e.classList.toggle('over', over > 0);
    w.className = 'wide';
    if (target) { w.textContent = ` / 목표 ${mmss(Math.round(target * 60))}`; e.append(w); }
  }, 150);
  $('shrinkBox').hidden = !target;
  updShrinkUi();
}

// ---- 늦어지면 자동 줄이기 (shrink.js) ----
// sk('shrink') = { on: 줄인 단계를 쓴다(auto나 mode), auto: 발표 중 자동 줄이기(스위치), mode: 미리 줄이기 단계(0 원본, 1 조금 짧게, 2 핵심만; 시안의 세그먼트), h: 대본 해시, pt: 발표 준비를 한 때, lv: 단위마다 단계(0 원문, 1 줄임, 2 요약), asked: 미리 줄인 대본을 물어본 대본,
//   pre: 미리 줄인 대본으로 연습하기로 했으면 그 단계(처음부터 발표할 때마다 이 단계로 시작) }
// 단계는 대본과 '발표 준비' 결과가 그대로일 때만 쓴다. 저장해 두어서 새로고침해도 같은 글이 보인다.
const SHR0 = { on: false, auto: false, mode: 0, h: '', pt: 0, lv: [], asked: '', pre: null };
const NEED_PREP = "자동 줄이기는 지금 대본으로 한 '발표 준비' 결과가 있어야 해요. 대본을 고쳤다면 AI 도구의 '발표 준비'를 다시 해 주세요.";
let shr = { ...SHR0 }, U = null, uAt = -1;  // U: 줄이기 단위(지금 대본으로 한 발표 준비가 없으면 null), uAt: 마지막으로 계산한 때의 단위
function loadShrink() {
  try {
    const v = JSON.parse(store.get(sk('shrink')));
    const lvs = a => a.map(x => [1, 2].includes(x) ? x : 0);
    const auto = (v.auto ?? v.on) === true, mode = [1, 2].includes(v.mode) ? v.mode : 0;  // 옛 저장값은 on이 곧 자동
    shr = { on: auto || mode > 0, auto, mode, h: String(v.h || ''), pt: +v.pt || 0, lv: Array.isArray(v.lv) ? lvs(v.lv) : [], asked: String(v.asked || ''), pre: Array.isArray(v.pre) ? lvs(v.pre) : null };
  } catch { shr = { ...SHR0 }; }
  U = null;
  $('shrinkOn').checked = shr.auto;
  updShrinkUi();
}
const saveShrink = () => store.set(sk('shrink'), JSON.stringify(shr));
function shrinkUnits() {
  const text = $('text').value, h = hashText(text), p = loadPrep();
  U = prepFits(p, text) ? units(text, p.paras, spoken, must()) : null;  // 단계(shr.h)는 해시로 보아서, 글이 바뀌면 원문부터 다시. 꼭 말할 문장은 늘 남는다
  if (U && (shr.h !== h || shr.pt !== p.t || shr.lv.length !== U.length)) {
    if (shr.h === h && shr.lv.some(Boolean)) store.set(sk('cur'), 0);  // 같은 대본으로 발표 준비를 다시 했으면 옛 단계로 잰 위치는 맞지 않는다
    Object.assign(shr, { h, pt: p.t, lv: U.map(() => 0), pre: shr.mode ? modeLevels(U, shr.mode) : null });
    saveShrink();
  } else if (U && U.some((u, i) => shr.lv[i] > u.max || (shr.pre && shr.pre[i] > u.max))) {  // 꼭 말할 문장을 풀어서 단위의 최대 단계가 내려갔다
    shr.lv = shr.lv.map((l, i) => Math.min(l, U[i].max)); if (shr.pre) shr.pre = shr.pre.map((l, i) => Math.min(l, U[i].max));
    saveShrink();
  }
}

// 발표 화면에 들어갈 때와 처음부터 시작할 때. 목표가 없으면 원문으로, 처음부터면 지난 발표에서 줄인 단계를 버리고
// 미리 줄인 대본을 골랐으면 그 단계로 돌아간다. 편집 화면에서는 위치가 메모리에 없을 수 있어서 저장된 위치를 쓴다.
function baseLevels() {
  if (!shr.on || !U) return;
  cur = +store.get(sk('cur')) || 0;
  const L0 = U.map(() => 0), pre = shr.pre?.length === U.length ? shr.pre : L0;
  const lv = shr.mode && !cur ? pre : !target ? L0 : cur ? shr.lv : pre;  // 미리 줄이기 단계를 골랐으면 목표가 없어도 처음부터 그 단계
  if (lv.some((l, i) => l !== shr.lv[i])) setLevels(lv, 'reset');
}

// 발표 화면의 대본. 자동 줄이기가 켜져 있으면 숨긴 문장을 뺀 글이다.
function show() {
  const text = $('text').value, d = shr.on && U ? shrunk(text, U, shr.lv) : { text, cut: [] };
  build(d.text, d.cut);
  uAt = U ? unitAt(U, shr.lv, cur) : -1;
  // 발표 점검 구간은 자동 줄이기 단위와 같다(발표 준비가 없으면 준비 없이 나눈 단위, 경계는 같다). 보이는 문장 → 구간
  SU = U ?? units(text, [], spoken);
  secOf = secMap(SU, shr.on && U ? shr.lv : null);
  if (acc?.length !== SU.length) newRun(true);
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
  if (document.body.classList.contains('editing')) cur = +store.get(sk('cur')) || 0;  // 편집 화면에서는 메모리의 옛 읽던 위치가 아니라 이 대본의 저장값으로 잰다
  const c = remap(U, shr.lv, lv, cur), moved = c !== cur, a = moved ? null : approx;
  if (undoAt !== null) undoAt = remap(U, shr.lv, lv, undoAt);  // 되돌릴 위치도 새 대본 기준으로
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
  shr.auto = $('shrinkOn').checked;
  shr.on = shr.auto || shr.mode > 0;
  // 끄면 미리 줄이기 단계(없으면 원문)로 돌아간다
  if (!shr.auto && U && shr.lv.some(Boolean)) setLevels(shr.mode ? modeLevels(U, shr.mode) : U.map(() => 0), 'off');
  shr.asked = ''; shr.pre = shr.mode && U ? modeLevels(U, shr.mode) : null;
  saveShrink(); updShrinkUi();
  if (shr.auto && !U) tell(NEED_PREP);
};

// 넓은 화면에서는 '자동 줄이기' 스위치를 '시간이 모자랄 때' 카드에 둔다(시안). 좁으면 아래 줄에 둔다.
const wideEd = matchMedia('(min-width: 1100px)');
function placeSw() { wideEd.matches ? $('shrinkCard').append($('shrinkBox')) : $('shrinkBox').parentElement.id === 'shrinkCard' && document.querySelector('footer.e-only').insertBefore($('shrinkBox'), $('altBtn')); }
wideEd.addEventListener('change', placeSw); placeSw();
// 시안의 '시간이 모자랄 때' 카드: 원본 / 조금 짧게 / 핵심만. 발표 준비(AI)가 있어야 쓰고, 없으면 안내만 보인다.
function setShrinkMode(m) {
  shrinkUnits();
  if (!U) return updShrinkUi();
  shr.mode = m; shr.on = shr.auto || m > 0;
  shr.pre = m ? modeLevels(U, m) : null;
  shr.asked = shr.h + ':' + shr.pt;  // 단계를 골랐으니 '줄인 대본으로 연습할까요?'를 다시 묻지 않는다
  if (!shr.lv.every((l, i) => l === (shr.pre?.[i] ?? 0))) setLevels(shr.pre || U.map(() => 0), 'mode');
  saveShrink(); updShrinkUi();
}
$('modeSeg').onclick = e => { const b = e.target.closest('[data-m]'); if (b && !b.disabled) setShrinkMode(+b.dataset.m); };
$('modePrep').onclick = () => openAi('prep');
function updShrinkUi() {
  const text = $('text').value, p = loadPrep(), fit = prepFits(p, text), u = fit ? units(text, p.paras, spoken, must()) : null, r = rate();
  for (const b of $('modeSeg').children) { b.disabled = !u; b.setAttribute('aria-pressed', u ? +b.dataset.m === shr.mode : false); }
  $('modePrep').hidden = !!u;
  if (!u) { $('modeInfo').textContent = text.trim() ? '발표 준비를 하면 문단마다 짧은 버전을 만들어 두고 고를 수 있어요.' : ''; return; }
  const est = lv => mmss(Math.round(u.reduce((x, y, i) => x + y.len[lv[i]], 0) / r)), L = modeLevels(u, shr.mode);
  $('modeInfo').textContent = shr.mode ? `${['', '조금 짧게', '핵심만'][shr.mode]}: 예상 ${est(L)} (원본 ${est(u.map(() => 0))})` : `원본: 예상 ${est(u.map(() => 0))}`;
}

// 처음부터 발표할 때 원문이 목표보다 길면 미리 줄인 대본으로 연습할지 묻는다 (대본과 준비 결과마다 한 번).
// 편집 화면의 예상 시간과 같은 말 속도를 쓰고, 300자 고정 없이 처음부터 줄인다. 리딩은 지금 대본을 재기만 하므로 묻지 않는다(연습에서 묻는다).
let pre = null;
function askShrink() {
  if (coach === 'read' || !shr.auto || !U || !target || cur || shr.lv.some(Boolean) || shr.asked === shr.h + ':' + shr.pt) return;
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

// 들어보기(시안): 편집 화면에서 지금 대본을 문장마다 소리 내어 읽어 준다(브라우저 음성 합성). 다시 누르거나 화면을 옮기면 멈춘다.
const TTS = 'speechSynthesis' in window ? speechSynthesis : null;
let hearing = 0;  // 읽는 중이면 읽기 번호(멈추면 0)
function stopHear() {
  if (!hearing) return;
  hearing = 0; TTS.cancel();
  $('listenBtn').setAttribute('aria-pressed', false); $('listenBtn').setAttribute('aria-label', '대본 들어보기'); $('listenBtn').lastChild.textContent = '들어보기';
}
$('listenBtn').hidden = !TTS;
$('listenBtn').setAttribute('aria-label', '대본 들어보기');
$('listenBtn').onclick = () => {
  if (hearing) return stopHear();
  const ss = paras($('text').value).flat().map(t => t.replace(MARK, ' ').trim()).filter(Boolean);
  if (!ss.length) return tell('먼저 대본을 쓰거나 붙여넣으세요.');
  const id = hearing = Date.now();
  $('listenBtn').setAttribute('aria-pressed', true); $('listenBtn').setAttribute('aria-label', '대본 들어보기 멈추기'); $('listenBtn').lastChild.textContent = '멈추기';
  TTS.cancel();
  ss.forEach((t, k) => {
    const u = new SpeechSynthesisUtterance(t);
    u.lang = 'ko-KR';
    if (k === ss.length - 1) u.onend = u.onerror = () => { if (hearing === id) stopHear(); };
    TTS.speak(u);
  });
};
addEventListener('pagehide', stopHear);

// 원래 대본 보기(시안): 줄인 단위의 원문. 숨긴 문장은 흐리게 취소선을 긋는다. 편집 화면의 대본은 그대로다.
function showOrig(i) {
  const u = U?.[i];
  if (!u) return;
  const text = $('text').value, box = $('origText');
  box.replaceChildren();
  let o = u.s[0].a;
  for (const s of u.s) {
    box.append(text.slice(o, s.a));
    const x = document.createElement(s.top < shr.lv[i] ? 'del' : 'span');
    x.textContent = text.slice(s.a, s.b);
    box.append(x);
    o = s.b;
  }
  $('origDlg').showModal();
}
$('prompt').addEventListener('click', e => { const b = e.target.closest('button.orig'); if (b) showOrig(+b.dataset.u); });
$('origClose').onclick = () => $('origDlg').close();

// ---- 발표 점검: 모드, 구간 시간, 말 빠르기, 실시간 힌트, 목소리 분석, 기록 (계산은 check.js) ----
// 모드는 탭마다 sessionStorage ls.coach에 둔다. 새 탭은 늘 실전이라 전날 연습 모드가 교실 발표에 남지 않는다.
let coach = 'live';
try { coach = modeOf(sessionStorage.getItem('ls.coach')); } catch {}
let cueOn = store.get('ls.cue') !== '0';  // 실시간 힌트 보기 (기기마다, 끄면 '0')
// 이번 발표(t0)의 값. ls.talk에 같이 둔다(saveTalk). SU: 구간(자동 줄이기 단위), secOf: 보이는 문장 → 구간,
// acc: 구간마다 걸린·말한·대본 밖 시간과 글자 수(check.js newAcc), hs: 들은 음절, runKind: 모드(이어 하다 바꾸면 'mixed'),
// rd: 구간마다 말투 신호 수, cues: [[힌트, 경과 초]], runAud: 목소리 분석(null이면 안 함, { off: 꺼진 이유, at }), re: 발표 중 새로고침했나
// runT: 기록 번호(처음 시작한 때). t0는 질의응답 시간이나 긴 쉼만큼 뒤로 밀리므로 따로 둔다
let tx = [];  // 구간마다 그때 들은 확정 말(연습 결과의 '대본과 실제로 한 말'). acc와 같은 때 새로 시작한다
let SU = [], secOf = [], acc = null, hs = newHear(), runKind = null, rd = [], cues = [], runAud = null, re = false, runT = 0;
// 메모리만: 말 빠르기 창(5초마다 한 줄), 판정 상태, 보이는 힌트, 높낮이·쉼 프레임(F), 켜진 분석(au)
let ring = [], ringT = 0, rdT = 0, pst = newPace(), pace = null, readNow = false, flatW = null, cst = newCue(), cueK = null, F = null, au = null;
let lastTick = Date.now(), resN = 0, recProbe = 0;  // resN: 받은 인식 결과 수(감시용), recProbe: 인식기 굶음으로 분석을 끈 때
let runs = [], runFull = false, liveNote = null;  // runs: 이 대본의 최근 5회 기록, runFull: 저장 공간이 모자라 저장하지 못함(정지 뒤 알림), liveNote: 편집 화면에서 알릴 실전 기록
// keep: 구간 수만 바뀌었으면(show) 발표 정보는 두고 구간 값만 새로
function newRun(keep = false) {
  acc = newAcc(SU.length); rd = SU.map(() => 0); tx = SU.map(() => ''); F = au && frames(SU.length);  // 분석 중이면 새 구간 수로 이어 잰다
  if (keep) return;
  hs = newHear(); hs.base = -sessionNorm.length;  // 이번 인식 세션에서 이미 들은 말은 세지 않는다
  runT = t0; runKind = null; cues = []; runAud = null; re = false; ring = []; ringT = 0; rdT = 0; pst = newPace(); pace = null; readNow = false; cst = newCue();
}
// 지금 구간: 목소리로 왔으면 마지막으로 읽기 시작한 어절의 문장(문단 끝까지 읽고 하는 대본 밖 말은 그 구간), 손이나 키워드로 옮겼으면
// 옮겨 간 어절의 문장(구간 첫 어절로 옮기고 읽기 전까지가 건너뛴 앞 구간에 들지 않게). 40ms마다 부르므로 위치와 대본이 그대로면 다시 찾지 않는다.
let secMemo = null, lastBy = null;  // lastBy: 마지막으로 커서를 옮긴 것 (setCur)
function secNow() {
  if (secMemo?.cur !== cur || secMemo.words !== words || secMemo.by !== lastBy)
    secMemo = { cur, words, by: lastBy, s: Math.max(0, Math.min(secOf[sentAt(words, cur + (lastBy === 'voice' ? 0 : 1))] ?? 0, SU.length - 1)) };
  return secMemo.s;
}
const wallSum = () => acc ? acc.reduce((x, a) => x + a.wall, 0) : elapsed();  // 결과 창 총 시간과 같은 기준(구간 걸린 시간 합)
// 발표 중 지금 구간의 누적. 시작 전, 질의응답 중, 대본 끝에 닿은 뒤(맺음말, 정지 뒤에 오는 확정 결과)면 없음 (걸린 시간을 더하는 coachTick과 같은 조건)
const accAt = () => listening && t0 && !qaMode && !end && acc?.[secNow()];
const elapsed = () => t0 ? Math.max(0, Math.floor(((end || Date.now()) - t0) / 1000)) : 0;  // 상태줄 경과(질의응답 시간 뺌)

// 500ms 타이머에서. 걸린 시간·말한 시간·대본 밖 시간을 지금 구간에 더하고, 5초마다 빠르기와 말투를 판정하고, 힌트를 정한다.
function coachTick(now, dt, sec, off, late, d) {
  const talking = listening && !qaMode && t0 && !end && acc;
  if (talking) tickAcc(acc, secNow(), dt, { talk: now - lastHeard < 3000, off });
  const rest = S.s.length - cur, hold = paceHold({ sec, off, qa: qaMode, now, lastMove, rest, r0, recOn, recOff });
  if (talking && now - ringT >= 5000) {
    ringT = now;
    const sum = k => acc.reduce((x, a) => x + a[k], 0);
    ringPush(ring, [sum('talk'), sum('heard'), sum('chars'), sum('anch'), ads.at(-1)?.id ?? 0]);  // 애드리브는 번호로 센다(목록은 50개에서 멈춤)
    const r = speechRate(ring), lv = au && F ? F.live(performance.now()) : null;
    flatW = lv?.flat ?? null;
    pace = paceStep(pst, r, now, { hold, goal: target * 60, sec, rest, d });
    readNow = coach !== 'read' && readSignal(ring, flatW, !!au);  // 리딩은 읽는 것이 목적이라 말투 신호를 세지 않는다
    if (readNow && now - rdT >= 60000) { rdT = now; rd[secNow()]++; }  // 결과 창에는 60초에 많아야 한 번 센다
    note({ m: mRow(r, flatW, lv?.run ?? null) });
  }
  // 인식기가 다시 켜지는 짧은 틈('연결 중')에는 두고(판정은 paceHold가 멈춤), '다시 듣기'(4초)나 대본 끝이면 지운다
  const hide = off || qaMode || !listening || stuck() || !!end;
  showCue(cueStep(cst, { mode: coach, on: cueOn, pace, read: readNow, late, shrinkOn: shr.auto && !!U, hold, hide }, now), sec);
}
// 상태줄 작은 칸의 힌트. 바뀔 때만 고치고, 켜고 끌 때 기록에 남긴다.
function showCue(c, sec = 0) {
  const k = c?.k ?? null, el = $('cue'), w = c?.word ?? '';
  if (k !== cueK) {
    if (cueK) note({ cue: cueK, on: false });
    if (k) { note({ cue: k, on: true }); cues.push([k, sec]); }
    cueK = k;
  }
  if (el.textContent !== w) el.textContent = w;
  el.classList.toggle('dim', !!c?.dim);
}

// '가' 시트의 발표 점검 묶음
function setCoach(m) {
  coach = modeOf(m);
  try { sessionStorage.setItem('ls.coach', coach); } catch {}
  showCoach();
}
function showCoach() {
  const desk = devKind() === 'desktop', key = browserKey(navigator), blk = desk && key && getJ('ls.audioBlock')?.[key];
  $('coachNoSr').hidden = !!SR;
  $('coachSet').hidden = !SR;
  for (const b of document.querySelectorAll('[data-coach]')) { b.setAttribute('aria-pressed', b.dataset.coach === coach); b.disabled = listening; }
  $('audioOn').disabled = $('checkOpen').disabled = listening;
  // '말하듯이'는 목소리 분석이 있어야 나오므로 분석이 꺼져 있으면(휴대폰, Safari, 끔) 말하지 않는다
  $('modeHelp').textContent = listening ? '정지한 뒤 바꿀 수 있어요.' : {
    read: '힌트 없이 재기만 해요. 끝나면 결과를 보여 줘요.',
    practice: (audioWant() ? '빠르기와 말투' : '빠르기') + ' 힌트를 위에 하나씩 보여 줘요. 끝나면 결과를 보여 줘요.',
    live: "'천천히'만 흐리게 보여 줘요. 결과는 정지한 뒤 아래 '점검 결과'에서 봐요." + (desk ? " 목소리 분석을 켜면 '말하듯이'도 보여 줘요. 연습에서 먼저 써 보세요." : ''),
  }[coach] + (blk ? ` 지난번에 ${blk === 'rec' ? '음성 인식이 멈춰서' : '분석기에 소리가 안 들어와서'} 목소리 분석을 꺼 뒀어요. 켜면 다시 시험해요.` : '');
  $('audioRow').hidden = !desk;
  $('audioOn').checked = audioWant();
  $('cueOn').checked = cueOn;
  if (!listening) micRest();
}
for (const b of document.querySelectorAll('[data-coach]')) b.onclick = () => { if (!listening) setCoach(b.dataset.coach); };
$('cueOn').onchange = () => { cueOn = $('cueOn').checked; cueOn ? store.del('ls.cue') : store.set('ls.cue', '0'); };
// 목소리 분석 값은 리딩·연습(r)과 실전(l)을 따로 기억한다. 다시 켜면 이 브라우저의 막힘 기록을 지운다(다시 시험).
$('audioOn').onchange = () => {
  const on = $('audioOn').checked, key = browserKey(navigator);
  store.set('ls.audio', JSON.stringify({ ...getJ('ls.audio'), [coach === 'live' ? 'l' : 'r']: on }));
  if (on && key) { const b = getJ('ls.audioBlock') || {}; delete b[key]; store.set('ls.audioBlock', JSON.stringify(b)); }
  showCoach();
};
$('checkOpen').onclick = () => { $('viewDlg').close(); openCheck(); };
$('mCheck').onclick = () => openCheck();

// ---- 목소리 분석: PC Chrome에서 인식기와 따로 마이크를 하나 더 열어 높낮이와 쉼을 잰다 (소리는 저장하지 않는다) ----
// 인식기는 건드리지 않는다. 부딪치면 분석만 끄고, 멈춘 인식기는 기존 '다시 듣기'가 맡는다.
const devKind = () => deviceKind(navigator, matchMedia('(pointer: coarse)').matches, !!window.AudioContext);
const getJ = k => { try { const v = JSON.parse(store.get(k)); return v && typeof v === 'object' ? v : null; } catch { return null; } };
function audioWant() {
  const key = browserKey(navigator);
  return audioDefault(devKind(), coach, getJ('ls.audio'), !!(key && getJ('ls.audioBlock')?.[key]));
}
// 이 브라우저(brand + 주버전)에서 분석이 막힌다고 적는다. 업데이트하면 키가 달라 다시 시험한다.
function setBlock(v) {
  const key = browserKey(navigator);
  if (key) store.set('ls.audioBlock', JSON.stringify({ ...getJ('ls.audioBlock'), [key]: v }));
}
function startAudio() {
  if (au || qaMode || !listening || !SU.length || devKind() !== 'desktop' || !audioWant()) return;
  let me;
  try {
    me = au = { ctx: new AudioContext(), b: [], c: null, w: newWatch() };  // b: 감시용 1초 칸(최근 8개), c: 채우는 칸
    me.ctx.resume().catch(() => {});
  } catch { au = null; return; }
  F ??= frames(SU.length);
  runAud ??= { off: null, at: null };
  navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } }).then(stream => {
    me.stream = stream;
    if (au !== me) return stream.getTracks().forEach(t => t.stop());  // 기다리는 사이 정지했다
    if (runAud?.off) runAud = { off: null, at: null };  // 이어 한 발표에서 다시 켜졌다. 꺼져 있던 사이 구간은 높낮이 없이 보인다
    const ctx = me.ctx, an = ctx.createAnalyser(), tr = me.tr = stream.getAudioTracks()[0], set = tr?.getSettings?.() || {};
    an.fftSize = ctx.sampleRate > 48000 ? 4096 : 2048;  // 48kHz 넘게 받으면 창을 늘려야 낮은 목소리를 잡는다
    ctx.createMediaStreamSource(stream).connect(an);
    const buf = new Float32Array(an.fftSize);
    me.iv = setInterval(() => { an.getFloatTimeDomainData(buf); audioFrame(me, buf); }, 40);
    note({ audio: 'on', set: { echoCancellation: set.echoCancellation, noiseSuppression: set.noiseSuppression, autoGainControl: set.autoGainControl, sampleRate: set.sampleRate } });
  }, () => { if (au === me) stopAudio('denied'); });
}
// 40ms마다 프레임 하나. 1초마다 감시: 분석기 말소리, 인식 결과 수, 들은 음절, 최대 dB, 바닥, 모두 0
function audioFrame(me, buf) {
  const t = performance.now(), r = F.push(buf, me.ctx.sampleRate, t, secNow());
  // 탭이 숨으면 Chrome이 40ms 타이머를 1초 넘게 늦춰 1초 칸에 프레임이 한두 개뿐이다. 그런 칸으로는 충돌을 판정하지 않는다
  if (document.hidden) { me.b = []; me.c = null; return; }
  const c = me.c ??= { t, sp: 0, mx: -Infinity, fl: 0, res: resN, hn: hs.n };
  if (r.on) c.sp += 0.04;
  c.mx = Math.max(c.mx, r.db); c.fl = r.floor;
  if (t - c.t < 1000) return;
  me.b.push({ sp: c.sp, res: resN - c.res, hn: hs.n - c.hn, mx: c.mx, fl: c.fl, z: c.mx < -150 });  // 샘플이 모두 0이면 -180dB
  if (me.b.length > W_WIN) me.b.shift();
  me.c = null;
  const why = watchdog(me.w, me.b, { recOn, muted: !!me.tr?.muted, ended: me.tr?.readyState === 'ended' });
  if (why) stopAudio(why);
}
// why: 'stop' | 'qa' | 'edit' | 'load' | 'hide'(끝냄) 또는 'rec?' | 'audio' | 'lost' | 'denied'(문제로 꺼짐, 결과 창에 적는다)
// 막힘으로 적는 것은 'audio'(바로)와 'rec?'(끄자 5초 안에 인식이 풀리면)뿐이다. 'lost'(마이크를 뽑거나 장치에서 끔)는 인식기와 부딪친 것이 아니다
function stopAudio(why) {
  const me = au;
  if (!me) return;
  au = null; flatW = null;
  clearInterval(me.iv);
  me.stream?.getTracks().forEach(t => t.stop());
  me.ctx.close().catch(() => {});
  note({ audio: 'off', why });
  if (!['rec?', 'audio', 'lost', 'denied'].includes(why)) return;
  // 대본 끝까지 간 뒤면 빠진 값이 없다. 때는 결과 창의 총 시간과 같은 기준(구간 걸린 시간 합, 멈춘 시간 뺌)
  if (!end) runAud = { off: why, at: wallSum() };
  if (why === 'audio') setBlock('audio');
  if (why === 'rec?') recProbe = Date.now();
}

// ---- 발표 점검 기록 (대본마다 sk('runs')에 최근 5회) ----
// 정지, 질의응답, 탭 숨김에서 저장한다(같은 발표면 바꿔 씀). 말한 시간 20초 미만이면 저장하지 않는다(check.js buildRun).
// 저장 공간이 모자라면 듣는 중에는 알리지 않고 runFull로 두었다가 정지 뒤 알린다.
// 구간 i의 보이는 대본(자동 줄이기로 숨긴 문장은 뺀다)
function secScript(i) {
  const text = $('text').value, lv = shr.on && U ? shr.lv[i] : 0;
  return SU[i].s.filter(x => x.top >= lv).map(x => text.slice(x.a, x.b)).join(' ');
}
function saveRun() {
  if (!t0 || !acc || acc.length !== SU.length) return null;
  const text = $('text').value, lv = shr.on && U ? shr.lv : null, ad = SU.map(() => 0), origSec = SU.flatMap((u, i) => u.s.map(() => i));
  for (const g of ads) ad[origSec[Math.max(0, g.s ?? 0)] ?? 0]++;  // 애드리브의 앞 문장(원문 번호)이 든 구간
  const r = buildRun({
    t0: runT || t0, kind: runKind || coach, h: hashText(text), target: Math.round(target * 60), r0, el: elapsed(), pct: S.s.length ? Math.round(cur / S.s.length * 100) : 0,
    lv, re, audio: runAud, acc, aud: F?.secs() ?? null, rd, ad, cues, ai: null,
    info: SU.map((u, i) => ({ w: text.slice(u.s[0].a, u.s[0].a + 40).replace(/\s+/g, ' ').slice(0, 20), n: u.len[lv?.[i] ?? 0], lv: lv?.[i] ?? 0 })),
  });
  if (!r) return null;
  runs = upsertRun(runs, r);
  runFull = !save(sk('runs'), saveRuns(runs));
  // 구간마다 보인 대본과 들은 말도 같이 둔다(대본을 나중에 고쳐도 비교할 수 있게). 못 저장해도 연습 기록은 남는다
  store.set(sk('says'), JSON.stringify(addSays(readSays(store.get(sk('says'))), { t0: r.t0, secs: packSays(SU.map((_, i) => [secScript(i), tx[i] || ''])) }, runs.map(x => x.t0))));
  liveNote = coach === 'live' ? r : null;  // 실전 뒤 연습을 하면 옛 실전 기록을 알리지 않는다
  return r;
}

// ---- 발표 점검 결과 창 ----
// runSel: 고른 기록(t0), coachJob: 프롬프트를 복사한 기록(t0). 붙여넣은 답은 그 기록에 넣는다.
let runSel = 0, coachCtl = null, coachJob = 0;
const coachMsg = t => { $('coachMsg').textContent = t; };
const mk = (tag, text = '', cls = '') => { const e = document.createElement(tag); e.textContent = text; if (cls) e.className = cls; return e; };
// 고른 기록과 바로 앞 기록 (없으면 가장 최근 것)
function runPair() {
  const i = runs.findIndex(r => r.t0 === runSel), k = i < 0 ? runs.length - 1 : i;
  return [runs[k] ?? null, runs[k - 1] ?? null];
}
const ruleTips = (run, goal) => tips(run, goal).map(x => x.text);

function openCheck(t) {
  runSel = t || 0;  // 없으면 가장 최근 기록
  coachMsg('');
  $('coachOut').hidden = $('coachPasteBox').hidden = true;
  $('checkMsg').textContent = runFull ? FULL : '';
  runFull = false;
  $('cTarget').value = target || '';
  showKey(); renderCheck();
  if (!$('checkDlg').open) $('checkDlg').showModal();
}
// ---- 연습 결과: 대본과 실제로 한 말, 대본 수정 제안, 회차별 시간, 구간부터 연습 (계산은 compare.js) ----
let diffSec = -1;  // 결과 창에서 보고 있는 구간(-1이면 다르게 말한 곳이 가장 많은 구간)
// 연습마다 저장한 대본·들은 말을 비교한다. 이 연습(run)까지의 { says: 이 연습, cmp: 구간별 비교, per: 연습마다 바꿔 말한 것 }. 들은 말이 없으면 null
function compareOf(run) {
  const all = readSays(store.get(sk('says'))), mine = all.find(x => x.t0 === run.t0);
  if (!mine) return null;
  const upto = runs.filter(r => r.t0 <= run.t0).flatMap(r => all.filter(x => x.t0 === r.t0));
  const cmps = upto.map(compareRun);
  return { says: mine, cmp: compareRun(mine), per: cmps.map(c => swaps(c.flatMap(x => x.ops))) };
}
const ignored = () => { try { const v = JSON.parse(store.get(sk('sugIgnore'))); return Array.isArray(v) ? v : []; } catch { return []; } };
function renderCompare(run) {
  const c = compareOf(run), box = $('cDiffBox');
  $('cSug').replaceChildren(); box.hidden = !c;
  const sec = secRows(run, null, Math.round(target * 60));
  // 가장 많이 넘은 구간부터 연습(시안의 '2번 문단만 반복 연습')
  const worst = sec.map((r, i) => [r.bar.wall - r.bar.hi, i]).sort((a, b) => b[0] - a[0])[0];
  $('cRepeat').hidden = !(worst && worst[0] > 0 && run.secs.length > 1);
  if (!$('cRepeat').hidden) { $('cRepeat').textContent = `${worst[1] + 1}번 구간부터 연습`; $('cRepeat').onclick = () => startFromSection(worst[1]); }
  // 회차별 시간: 남은 연습 기록(최대 5회). 지금 보는 연습만 진한 보라
  const mx = Math.max(...runs.map(r => r.wall), 1);
  $('cHistBox').hidden = runs.length < 2;
  $('cHist').replaceChildren(...runs.map((r, i) => {
    const d = mk('div', '', r === run ? 'now' : ''), bar = mk('i');
    bar.style.height = Math.max(6, Math.round(r.wall / mx * 80)) + 'px';
    d.append(mk('span', mmss(r.wall)), bar, mk('span', `${i + 1}회`));
    return d;
  }));
  if (!c) return;
  // 4번째 숫자 카드와 제안
  const sg = suggest(c.per, ignored()), n = c.cmp.reduce((x, y) => x + y.n, 0);
  const card = mk('div', '', 'stat');
  card.append(mk('div', '대본과 다르게 말한 곳', 'k'), mk('div', String(n), 'v'), mk('div', sg.length ? `대본 수정 제안 ${sg.length}개` : '대본 수정 제안 없음', 'note'));
  $('cStats').append(card);
  $('cSug').replaceChildren(...sg.map(g => {
    const d = mk('div', '', 'sug'), row = mk('div', '', 'row'), go = mk('button', '바꾸기', 'go'), no = mk('button', '그대로 두기');
    go.onclick = () => applySuggest(g, run);
    no.onclick = () => { store.set(sk('sugIgnore'), JSON.stringify([...ignored(), g.k])); renderCheck(); };
    row.append(go, no);
    d.append(mk('h3', '대본을 이렇게 바꿀까요?'), mk('p', g.runs >= 2 ? `연습 ${g.runs}번 연속 '${g.from}' 대신 '${g.to}'라고 말했어요.` : `이번 연습에서 '${g.from}' 대신 '${g.to}'라고 ${g.n}번 말했어요.`), row, mk('p', '바꾸면 새 버전으로 저장돼요', 'small'));
    return d;
  }));
  // 비교할 구간: 다르게 말한 곳이 있는 구간. 고르지 않았으면 가장 많은 구간
  const has = c.cmp.map((x, i) => [x.n, i]).filter(x => x[0] > 0);
  if (!has.length) { $('cDiffSec').replaceChildren(); $('cDiffTxt').textContent = '대본과 다르게 말한 곳이 없어요.'; return; }
  const pick = has.some(x => x[1] === diffSec) ? diffSec : has.sort((a, b) => b[0] - a[0])[0][1];
  $('cDiffH').textContent = `${pick + 1} · ${run.secs[pick]?.w || '구간'} — 대본과 실제로 한 말`;
  $('cDiffSec').replaceChildren(...c.cmp.flatMap((x, i) => x.n ? [(() => {
    const b = mk('button', `${i + 1}번 구간 (${x.n})`);
    b.setAttribute('aria-pressed', i === pick);
    b.onclick = () => { diffSec = i; renderCompare(run); };
    return b;
  })()] : []));
  const out = [];
  for (const o of c.cmp[pick].ops) {
    if (o.t === '=') out.push(o.s, ' ');
    else if (o.t === '-') out.push(mk('del', o.s), ' ');
    else if (o.t === '+') out.push(mk('ins', o.w), ' ');
    else { const u = mk('u', o.s, 'chg'); u.title = `들은 말: ${o.w}`; out.push(u, ' '); }
  }
  $('cDiffTxt').replaceChildren(...out);
}
// 제안 반영: 지금 대본에서 모두 바꾸고 새 버전으로 남긴다. 대본에서 못 찾으면(그사이 고쳤으면) 알린다
function applySuggest(g, run) {
  const [t, n] = applyReplace($('text').value, g.from, g.to);
  if (!n) { $('checkMsg').textContent = `'${g.from}' 말을 대본에서 찾지 못했어요. 대본이 바뀐 것 같으면 직접 고쳐 주세요.`; return; }
  if (!snapshot('연습 제안 반영 전')) { $('checkMsg').textContent = NOKEEP; return; }
  setText(t, '연습 제안');
  snapshot('연습 제안 반영');
  store.set(sk('sugIgnore'), JSON.stringify([...ignored(), g.k]));  // 바꿨으니 같은 제안은 다시 하지 않는다
  renderCheck();
  $('checkMsg').textContent = `${n}곳을 바꿨어요: '${g.from}' → '${g.to}'. 새 버전으로 저장했어요.`;
}
// 구간 i부터 연습: 연습 모드로 발표 화면에 가서 그 구간의 첫 글자에 선다
function startFromSection(i) {
  setCoach('practice');
  $('checkDlg').close();
  if (qaMode) setQa(false);
  if (editing() && !toTalk()) return;
  jump(SU.slice(0, i).reduce((x, u, j) => x + u.len[shr.on && U ? shr.lv[j] ?? 0 : 0], 0));
}

function renderCheck() {
  $('checkNoSr').hidden = !!SR;
  $('checkBody').hidden = $('cDel').hidden = !SR;
  const [run, prev] = runPair(), goal = Math.round(target * 60);
  $('cEmpty').hidden = !!run;
  $('cRunBox').hidden = $('cRunRow').hidden = !run;
  $('cDel').disabled = !runs.length;
  if (!SR || !run) return;
  runSel = run.t0;
  $('cRun').replaceChildren(...[...runs].reverse().map(r => new Option(runLabel(r), r.t0, false, r === run)));
  const sum = sumLines(run, prev, goal);
  if (!run.audio) sum.push(devKind() === 'desktop' ? "목소리 분석 없이 쟀어요. 발표 화면 '가'에서 '목소리 분석(높낮이·쉼)'을 켜면 높낮이와 쉼도 봐요."
    : '이 브라우저에서는 높낮이와 쉼을 재지 않아요. PC Chrome에서 연습하면 볼 수 있어요.');
  $('cStats').replaceChildren(...statCards(run, prev, goal).map(c => {
    const box = mk('div', '', 'stat'), n = mk('div', c.note, c.over ? 'note over' : 'note');
    const v = mk('div', c.value, 'v');
    if (c.unit) v.append(mk('small', c.unit));
    box.append(mk('div', c.label, 'k'), v, n);
    return box;
  }));
  renderCompare(run);
  // 걸린 시간·평균 빠르기·대본 밖은 위 숫자 카드에 있으므로 글에서는 뺀다
  $('cSum').replaceChildren(...sum.slice(1).filter(t => !/^(평균 빠르기|대본 밖) /.test(t)).map(t => mk('p', t)));
  const tone = toneLines(run);
  $('cTone').replaceChildren(...(tone.length ? [mk('h3', '읽는 말투'), ...tone.map((t, i) => mk('p', t, i ? 'small' : ''))] : []));
  // 다음에 해 볼 것. AI 결과가 있으면 그 자리를 AI 팁으로 바꾸고 규칙으로 찾은 것은 접어 둔다.
  const rule = tips(run, goal).map(x => {
    const li = mk('li', x.text);
    if (x.k === 'over' && !shr.auto && prepFits(loadPrep(), $('text').value)) { const b = mk('button', '자동 줄이기 켜기'); b.onclick = shrinkFromCheck; li.append(' ', b); }
    return li;
  });
  const ai = run.ai;
  $('cTipsH').textContent = ai ? 'AI 코칭' : '다음에 해 볼 것';
  $('cAiSum').textContent = ai ? ai.summary : rule.length ? '' : '규칙으로 찾은 고칠 점이 없어요.';  // 번호 없는 한 줄
  $('cAiSum').hidden = !$('cAiSum').textContent;
  $('cTips').replaceChildren(...(ai ? ai.tips.map(x => mk('li', (x.sec && !x.what.includes(`${x.sec}번`) ? `${x.sec}번 구간: ` : '') + `${x.what} ${x.how}`)) : rule));
  $('cRule').hidden = !ai || !rule.length;
  $('cRuleList').replaceChildren(...(ai ? rule : []));
  // 구간: 첫 줄(번호·첫 글, 걸린 시간·판정), 막대(연보라 띠 기대 시간, 진한 보라 걸린 시간), 정도 낱말, 숫자 보기
  $('cNoGoal').hidden = !!goal;
  $('cSemi').hidden = !run.secs.some(s => s.st);  // 범례의 '반음은 피아노 건반 한 칸'은 높낮이를 잰 기록에만
  const pc = x => `${Math.max(0, Math.min(100, x * 100))}%`;
  $('cSecs').replaceChildren(...secRows(run, prev, goal).map((r, i) => {
    const box = mk('div', '', 'sec'), h = mk('p', '', 'sh'), bar = mk('div', '', 'cbar'), band = mk('i'), w = mk('b'), m = r.bar.max || 1;
    h.append(mk('span', r.head), mk('b', r.time));
    band.style.left = pc(r.bar.lo / m); band.style.width = pc((r.bar.hi - r.bar.lo) / m);
    w.style.width = pc(r.bar.wall / m);
    w.classList.toggle('over', r.bar.over);  // 시안: 기대 띠를 넘으면 주황
    bar.setAttribute('aria-hidden', 'true');
    bar.append(band, w);
    if (r.bar.b != null) { const g = mk('u'); g.style.left = pc(r.bar.b / m); bar.append(g); }  // 목표 눈금(시안의 검은 세로선)
    box.append(h, bar);
    if (r.words) box.append(mk('p', r.words, 'small'));
    if (r.nums.length) {
      const dt = mk('details'), ul = mk('ul'), sm = mk('summary', '숫자 보기');
      sm.setAttribute('aria-label', `${i + 1}번 구간 숫자 보기`);  // 화면 읽기의 컨트롤 목록에서 구간을 가린다
      dt.append(sm, ul);
      for (const n of r.nums) ul.append(mk('li', n));
      box.append(dt);
    }
    return box;
  }));
}
$('cRun').onchange = () => { runSel = +$('cRun').value; coachMsg(''); renderCheck(); };
$('checkClose').onclick = () => $('checkDlg').close();
$('cDel').onclick = () => {
  if (!runs.length || !confirm('이 대본의 연습 기록을 모두 지울까요? 되돌릴 수 없어요.')) return;
  coachCtl?.abort();
  runs = []; store.del(sk('runs')); store.del(sk('says'));
  resetTalk(0);  // 이어 하던 발표의 잰 값(ls.talk)도 버린다. 남기면 다음 정지에 지운 기록이 다시 저장된다. 다음 시작이 새 발표다
  renderCheck();
  $('checkMsg').textContent = '기록을 지웠어요.';
  $('checkTitle').focus();  // 누른 단추가 꺼져 포커스가 창 밖으로 나가지 않게
};
// 리딩·연습으로 시작: 모드를 바꾸고 대본 처음에 둔다. 마이크는 사용자가 누른다.
function checkStart(m) {
  setCoach(m);
  $('checkDlg').close();
  if (qaMode) setQa(false);
  if (editing() && !toTalk()) return;
  jump(0);
}
$('cRead').onclick = () => checkStart('read');
$('cPractice').onclick = () => checkStart('practice');
function shrinkFromCheck() {
  $('shrinkOn').checked = true;
  $('shrinkOn').onchange();
  renderCheck();
  if (shr.auto && U) $('checkMsg').textContent = '자동 줄이기를 켰어요. 다음 발표부터 목표보다 늦어지면 뒤 문단을 줄여요.';
  $('checkTitle').focus();  // 누른 단추는 다시 그려져 없어졌다
}

// AI 코칭: 구간 번호와 잰 숫자만 보낸다(claude.js coachPrompt). 키가 없으면 프롬프트 복사 → 결과 붙여넣기. 결과는 그 기록의 ai에 둔다.
function setCoachAi(t, ai) {
  const r = runs.find(x => x.t0 === t);
  if (!r) { coachMsg('그사이 기록이 지워졌어요.'); return false; }
  r.ai = ai;
  if (!save(sk('runs'), saveRuns(runs))) $('checkMsg').textContent = FULL;
  runSel = t;
  renderCheck();
  coachMsg("AI 코칭을 받았어요. 위 'AI 코칭'에서 볼 수 있어요.");
  return true;
}
$('coachAi').onclick = async () => {
  if (coachCtl) return coachCtl.abort();
  const [run, prev] = runPair();
  if (!run) return;
  const goal = Math.round(target * 60), ctl = coachCtl = new AbortController();
  $('coachAi').textContent = '멈추기';
  coachMsg('AI에 보내는 중…');
  $('coachMsg').setAttribute('aria-busy', 'true');  // 받는 동안 바뀌는 글자 수를 화면 읽기가 하나하나 읽지 않게
  try {
    const ai = await coachRun(run, prev, ruleTips(run, goal), {
      key: keyStore.get(), signal: ctl.signal, goal,
      onProgress: x => coachMsg(x.chars ? `AI가 쓰는 중… ${x.chars}자` : 'AI가 생각하는 중…'),
    });
    setCoachAi(run.t0, ai);
  } catch (e) {
    coachMsg(e.name === 'AbortError' ? '멈췄어요.' : e.message);
  } finally {
    $('coachMsg').removeAttribute('aria-busy');
    if (coachCtl === ctl) coachCtl = null;
    $('coachAi').textContent = 'AI 코칭';
  }
};
$('coachPrompt').onclick = () => {
  const [run, prev] = runPair();
  if (!run) return;
  const goal = Math.round(target * 60);
  coachJob = run.t0;
  copyPrompt($('coachOut'), coachPrompt(run, prev, ruleTips(run, goal), goal).text, coachMsg, '답');
  $('coachPasteBox').hidden = false;
};
$('coachPaste').onclick = () => { $('coachPasteBox').hidden = false; $('coachPasteIn').focus(); };
$('coachPasteApply').onclick = () => {
  const t = $('coachPasteIn').value, run = runs.find(r => r.t0 === (coachJob || runSel));  // 이 화면에서 프롬프트를 복사하지 않았으면 고른 기록
  if (!t.trim()) return coachMsg('챗봇이 돌려준 답을 붙여넣어 주세요.');
  if (!run) return coachMsg('그사이 기록이 지워졌어요.');
  try {
    if (!setCoachAi(run.t0, parseCoach(t, run.secs.length))) return;
    $('coachPasteIn').value = '';
    $('coachPasteBox').hidden = $('coachOut').hidden = true;
    $('cTipsH').focus();  // 붙여넣기 칸이 숨었다. 새 'AI 코칭' 목록으로
  } catch (e) { coachMsg('적용하지 못했어요. ' + e.message); }
};

// ---- 기록 내려받기 ----
// 인식 결과 원문, 목소리로 옮긴 위치, 손으로 고친 위치. 나중에 매처를 고칠 때 쓴다(10분당 손 보정 횟수 등).
// 기록 파일에 적는 앱 버전. 매처나 기록 형식을 바꾸면 올린다. (4: [확인 필요] 표시를 비교에서 뺌, 발표 준비의 다른 말을 키워드로
// 5: 자동 줄이기 { shrink: 단계, why, over, at }와 prep, 질의응답 판정 { qa: 'judge', j, q, ms, top, jev, low, auto }과 고른 칩 { qa: 'pick', j, id, how, rank }
// 6: 발표 전에 질의응답 화면에서 켠 마이크의 기록도 남긴다. 그 기록의 t는 음수다
// 7: 애드리브 구간 adlib (adlib.js readSegs 모양)
// 8: 탭으로 옮긴 것을 되돌리기 { by: 'undo' }
// 9: 발표 점검. 마이크로 발표를 시작하거나 이어 할 때 { run: 모드 }, 5초마다 { m: [말 빠르기 × 10, 높낮이 창 폭 × 10, 최근 연속 발화 최장 초] },
//    힌트 { cue: 'fast' | 'slow' | 'read', on }, 목소리 분석 { audio: 'on', set: getSettings() } / { audio: 'off', why }. 파일에 mode(지금 점검 모드))
const VERSION = 9;
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
    start: b ? new Date(b).toISOString() : null, target, onSec, matched, cur, mode: coach,
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
    : `발표에서 대본에 없던 말 ${n}개를 모았어요.` + (editing() ? " '대본에 넣기'를 누르면 바뀌는 곳을 보여 주고, '적용'을 눌러야 대본이 바뀌어요."
      : " '대본에 넣기'는 편집 화면의 ⋯ 메뉴 › '더 보기' › '애드리브 정리'에서 할 수 있어요.");
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
  copyPrompt($('adOut'), adlibPrompt(ads).text, adMsg, '답');
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
  stopHear();
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
  store.set(sk('cur'), 0); cur = 0; resetTalk(0);
  const long = t.length > 100000;
  if (long && !textChanged.long) tell('대본이 10만 자를 넘으면 따라가기 준비가 느려져서 발표 화면이 늦게 열릴 수 있어요.');
  textChanged.long = long;
  setSrc(src);
  updEst(); showEmpty();
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
// 편집 화면 → 발표 화면. 빈 대본이면 알리고, [확인 필요]가 남았으면 묻는다. 갔으면 true
function toTalk() {
  const n = marks();
  if (!$('text').value.trim()) { tell("먼저 대본을 붙여넣거나 '예시로 둘러보기'를 누르세요."); return false; }
  if (n && !confirm(`대본에 [확인 필요]가 ${n}곳 남아 있어요. 사실을 확인하지 않은 채 발표 화면으로 갈까요?\n(읽지 않아도 따라가기에는 문제없어요)`)) return false;
  setMode(false);
  return true;
}
$('mode').onclick = () => {
  if (editing()) return toTalk();
  // 듣는 중에 잘못 누르면 음성 인식이 꺼지므로 묻는다 (대본을 고치지 않으면 위치는 그대로 남는다)
  if (listening && !confirm('발표를 멈추고 편집 화면으로 갈까요? 대본을 고치지 않으면 지금 위치에서 이어 할 수 있어요.')) return;
  setMode(true);
};
const stuck = () => listening && !recOn && Date.now() - recOff > 4000;
$('mic').onclick = () => {
  if (!stuck()) {
    // 목소리 분석은 마이크 버튼과 스페이스로 시작할 때만 켠다 (AudioContext는 누른 동작 안에서 만들어야 소리가 난다)
    if (!listening) { start(); return startAudio(); }
    // 리딩·연습은 정지하면 결과 창을 연다(기록이 저장됐고 다른 창이 없을 때, 끝까지 가지 않아도). 실전은 열지 않는다.
    const r = stop();
    if (r && coach !== 'live' && !document.querySelector('dialog[open]')) openCheck(r.t0);
    else if (runFull) { runFull = false; tell(FULL); }
    return;
  }
  recOff = Date.now();  // 다시 4초를 기다린다
  try { rec.start(); } catch {}
};
$('prev').onclick = prev;
$('next').onclick = next;
$('smaller').onclick = () => fontSize(-2);
$('bigger').onclick = () => fontSize(2);
// 보기 시트: 글자 크기와 글 폭. 뒤를 가리지 않아서 바꾸는 대로 대본에서 보인다. 시트 밖을 누르면 닫는다.
$('view').onclick = () => { showCoach(); $('viewDlg').showModal(); };
$('viewClose').onclick = () => $('viewDlg').close();
$('viewDlg').addEventListener('click', e => {
  const r = $('viewDlg').getBoundingClientRect();
  if (e.target === $('viewDlg') && (e.clientY < r.top || e.clientX < r.left || e.clientX > r.right)) $('viewDlg').close();
});
for (const b of document.querySelectorAll('[data-w]')) b.onclick = () => { store.set('ls.w', b.dataset.w); textWidth(b.dataset.w); if (!qaMode) render(); };
// 전체 화면: 주소 막대만큼 대본이 더 보인다. iPhone은 지원하지 않아서 단추를 숨긴다.
$('fullRow').hidden = !document.fullscreenEnabled;
$('full').onclick = () => document.fullscreenElement ? document.exitFullscreen().catch(() => {})
  : document.documentElement.requestFullscreen().catch(() => tell('전체 화면으로 바꾸지 못했어요.'));
document.addEventListener('fullscreenchange', () => $('full').setAttribute('aria-pressed', !!document.fullscreenElement));

// 대본을 눌러 옮기면 5초 동안 되돌릴 수 있다 (손바닥이 스쳐도 위치를 잃지 않게). 잇달아 눌러도 되돌릴 곳은 처음 누르기 전 위치.
let undoAt = null, undoT = 0;
function closeUndo() { clearTimeout(undoT); undoAt = null; $('undoBar').hidden = true; }
$('prompt').onclick = e => {
  const i = e.target.dataset.i;
  if (i == null) return;
  undoAt ??= cur;
  jump(words[i].n0, 'tap');
  unstay();  // 되돌리기 막대와 같은 자리
  $('undoBar').hidden = false;
  clearTimeout(undoT);
  undoT = setTimeout(closeUndo, 5000);
};
$('undoBtn').onclick = () => { const n = undoAt; closeUndo(); if (n !== null) jump(n, 'undo'); };
// 버튼에 포커스가 남으면 스페이스가 버튼을 한 번 더 누르게 되므로 바로 뗀다.
// 마우스·터치로 누른 때만 포커스를 뗀다(키보드로 누르면 detail이 0)
addEventListener('click', e => e.detail && e.target.closest('button')?.blur());
// 키보드(Tab)로 포커스가 온 단추는 스페이스로 그 단추를 누른다. 마우스로 열고 닫은 창이 포커스를 되돌려 준 단추는 그렇게 보지 않는다(그때 스페이스는 계속 마이크)
let tabbed = false;
addEventListener('pointerdown', () => { tabbed = false; }, true);
addEventListener('keydown', e => { if (e.key === 'Tab') tabbed = true; }, true);
addEventListener('keydown', e => {
  if (document.body.classList.contains('editing') || qaMode || e.target.closest?.('input, textarea, dialog')) return;
  if (e.key === 'ArrowRight' || e.key === 'PageDown') next();
  else if (e.key === 'ArrowLeft' || e.key === 'PageUp') prev();
  else if (e.key === ' ' && SR && !busy && !(tabbed && e.target.closest?.('button, summary, a, select'))) $('mic').onclick();  // 인식이 멈췄으면 정지 대신 다시 듣기
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
addEventListener('pagehide', () => { if (modelJob) store.del('ls.embLoading'); if (jevJob) store.del('ls.jevLoading'); stopAudio('hide'); keepLog(); });  // 분석 끔 기록까지 남긴다

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
  $('jevMsg').textContent = !jevOn ? `큰 모델(${JEV_SIZE})은 처음 한 번만 받아요. 그래픽 가속이 되는 기기(컴퓨터 Chrome 등)에서만 쓰고, 안 되면 기본 방식으로 골라요.` +
    (matchMedia('(pointer: coarse)').matches ? ' 휴대폰·태블릿에서는 데이터와 메모리가 많이 들어 권하지 않아요.' : '') : {
    off: `모델이 없으면 기본 방식으로만 골라요. 와이파이에서 한 번 받아 두면 이 기기에서 계속 써요.`,
    loading: '큰 모델을 불러오는 중…',
    ready: '큰 모델 준비됐어요. 이 기기 안에서 계산해요.',
    failed: '큰 모델을 쓸 수 없어요. 기본 방식으로 골라요.',
    nogpu: '이 기기에서는 큰 모델을 쓸 수 없어요. 기본 방식으로 골라요.',
    crashed: '지난번에 큰 모델을 불러오다 멈췄어요. 이 기기에서는 자동으로 불러오지 않아요.',
  }[jevState];
  $('getJev').hidden = !jevOn || jevState === 'ready' || jevState === 'nogpu';
  $('getJev').disabled = jevState === 'loading';
  $('getJev').textContent = jevState === 'failed' || jevState === 'crashed' ? '큰 모델 다시 받기' : `큰 모델 받기 (${JEV_SIZE}, 와이파이 권장)`;
}
$('getJev').onclick = () => loadJudgeJev(p => p.status === 'progress_total' && ($('jevMsg').textContent = '큰 모델 받는 중' + pctText(p)));
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
  if (!listening) micRest();
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
      const job = loadJudge(p => p.status === 'progress_total' && say('질문 찾기 모델 불러오는 중' + pctText(p)))
        .then(() => vectors((i, n) => say(`질문 준비 중 ${i}/${n}`)));
      job.then(() => pipe && jevNow(), () => {});  // JEV는 e5 후보를 다시 고르므로 e5 다음에. 워커에서 불러오므로 마이크를 막지 않는다.
      // 모델 불러오기가 10초를 넘으면(네트워크가 느리거나 멈춤) 마이크를 막지 않는다. 불러오기는 뒤에서 계속된다.
      const slow = new Promise(r => setTimeout(r, 10000)).then(() => modelState === 'loading' ? null : job);
      await Promise.race([job, slow]);
    }
  } catch (e) { console.warn(e); }
  finally { setBusy(false); sayNone(); }
}

function showModel() {
  const ready = modelState === 'ready', stuck = modelState === 'crashed' || modelState === 'failed';
  $('modelMsg').textContent = {
    off: '질문 찾기 모델이 없으면 글자 비교만으로 골라요. 와이파이에서 한 번 받아 두면 이 기기에서 계속 써요.',
    loading: '질문 찾기 모델을 불러오는 중…',
    ready: '질문 찾기 모델 준비됨 (이 기기 안에서 계산해요)',
    failed: '질문 찾기 모델을 쓸 수 없어요. 글자 비교만 써요. ' + modelErr,
    crashed: '지난번에 모델을 불러오다 멈췄어요. 이 기기에서는 자동으로 불러오지 않아요.',
  }[modelState];
  $('getModel').hidden = ready;
  $('getModel').disabled = modelState === 'loading';
  $('getModel').textContent = stuck ? '다시 시도' : '질문 찾기 모델 받기 (약 135MB, 와이파이 권장)';
  const j = !jevOn || !HAS_GPU ? '' : jev ? ' + 큰 모델' : { loading: ' · 큰 모델 준비 중', off: ' · 큰 모델 없음' }[jevState] || ' · 큰 모델 없이';
  $('qaState').textContent = !pack ? "준비된 질문이 없어요. 편집 화면의 'AI 도구'나 ⋯ 메뉴에서 'Q&A 준비'를 열어 만들어 주세요."
    // 모델이 준비된 뒤 질문 벡터를 계산하기 전(V 없음)도 준비 중이다. 벡터 계산이 실패하면 modelBroke가 ready를 푼다.
    : modelState === 'loading' || vecJob || (ready && !V) ? '질문 찾기 모델 준비 중… 그동안은 글자 비교로 골라요'
    : ready ? `질문 ${pack.questions.length}개 · 질문 찾기 모델(이 기기 안)${j}` : `질문 ${pack.questions.length}개 · 글자 비교로 고르는 중`;
  // 모델 받기는 질의응답 화면 맨 아래에 둔다 ('질문'이 위에 오게). 받는 동안에는 버튼을 감추고 진행을 그 자리에 보인다.
  $('qaGet').hidden = !pack || ready;
  $('qaRetry').hidden = modelState === 'loading';  // 발표 화면에 들어갈 때 저절로 불러오는 중이어도 감춘다
  $('qaRetry').textContent = stuck ? '다시 시도' : '질문 찾기 모델 받기 (약 135MB, 와이파이 권장)';
  const none = '질문 찾기 모델이 없으면 글자만 비교해서 골라요.';
  if (modelState !== 'loading') $('qaGetMsg').textContent = none;
  else if ($('qaGetMsg').textContent === none) $('qaGetMsg').textContent = '질문 찾기 모델을 불러오는 중…';  // 받기 버튼으로 받으면 진행이 이 글을 덮는다
  $('ask').disabled = busy || !pack;
}

// 프렙 창의 '모델 받기'와 질의응답 화면의 '판정 모델 받기'('다시 시도')
async function getModel(report) {
  await loadJudge(p => p.status === 'progress_total' && report('모델 받는 중' + pctText(p)));
  if (pipe && pack) await vectors((i, n) => report(`질문 준비 중 ${i}/${n}`));
  report('');
}
$('getModel').onclick = () => getModel(t => t && ($('modelMsg').textContent = t));
// 받는 동안에도 마이크와 '질문'은 쓴다(그동안은 글자 비교). 받는 동안 버튼을 감춰서 두 번 눌리지 않고, 진행은 버튼 자리 위 글에 보인다.
$('qaRetry').onclick = () => getModel(t => t && ($('qaGetMsg').textContent = t)).finally(showModel);

// ---- 질의응답 화면 ----
let qaMode = false, qSeg = null;  // qSeg: '질문'을 누른 뒤 모으는 중인 말 { from, done, cur }
let asked = '', askedBy = 'voice';  // 마지막으로 판정한 질문과 받은 길('voice', 'chat'). 전체 목록에서 고른 카드에도 보여 준다.
// 왼쪽 '들은 질문' 칸: 안내 글은 작게, 들은 질문은 크게
function liveMsg(t) { const l = $('live'); l.textContent = t; l.className = ''; delete l.dataset.src; }
function liveQ(t, by) { if (!t) return liveMsg(''); const l = $('live'); l.textContent = '“' + t + '”'; l.className = 'q'; l.dataset.src = by === 'chat' ? '채팅으로 받음' : '음성으로 받음'; }
let judgeN = 0;  // 판정 번호. 기록에서 판정(qa: 'judge')과 고른 칩(qa: 'pick')을 잇고, 새 질문을 시작하면 늘려서 늦게 끝난 판정을 버린다.

function setQa(on) {
  if (on) { tape.close(0); qaAt = Date.now(); closeUndo(); stopAudio('qa'); if (listening) saveRun(); }  // 질의응답에서 하는 말은 애드리브가 아니다. 목소리 분석은 다음 시작 때 다시 켠다
  qaMode = on; qSeg = null;
  sayNone();  // 돌아왔을 때 예전 말이 남지 않게
  document.body.classList.toggle('qa', on);
  $('qaBtn').textContent = on ? '대본으로' : 'Q&A';
  askBtn();
  if (on) {
    scrollTo(0, 0); showModel(); renderAll();
    if ($('card').hidden) liveMsg(pack ? "'질문 듣기'를 누르고 청중 질문을 따라 말한 뒤 한 번 더 누르세요. 채팅 질문은 아래 칸에 붙여넣으세요." : '');
  }
  else jump(cur);  // 질의응답 중에 들은 말에 커서가 끌려가지 않게
}
// 발표 중 질의응답에 다녀와 대본을 이어 읽으면 목소리 분석은 다음 마이크 시작까지 꺼져 있다. 결과 창에 그 때를 적는다
$('qaBtn').onclick = () => {
  setQa(!qaMode);
  if (!qaMode && listening && runAud && !runAud.off && !au && cur < S.s.length) runAud = { off: 'qa', at: wallSum() };
};

// 답 카드를 연 동안(body.carded)은 '질문' 버튼을 작게 줄이고 카드를 화면 위로 올린다
function askBtn() {
  $('ask').textContent = qSeg ? '듣는 중 · 다시 누르면 고르기' : $('card').hidden ? '질문 듣기' : '다음 질문 듣기';
  $('ask').classList.toggle('on', !!qSeg);
  document.body.classList.toggle('carded', !$('card').hidden);
}

function ask() {
  if (!qSeg) {
    qSeg = { from: listening ? resFinal : 0, done: '', cur: '' };
    asked = ''; judgeN++;
    $('card').hidden = true; $('hits').hidden = true; $('chips').textContent = ''; $('chips').classList.remove('final'); $('qaTime').textContent = ''; $('qaLow').hidden = true;
    liveMsg(SR ? '질문을 따라 말한 뒤 한 번 더 누르세요.' : NO_SR);
    if (!listening && SR) start();
  } else {
    const text = (qSeg.done + qSeg.cur).replace(/\s+/g, ' ').trim();
    qSeg = null;
    if (text) judge(text);
    else liveMsg('질문을 듣지 못했어요. 다시 눌러 주세요.');
  }
  askBtn();
}
$('ask').onclick = ask;

// 말하는 동안: 음절 비교로 후보를 계속 바꿔 보여 준다
function onQuestion(q) {
  if (!qSeg || !pack) return;
  qSeg.cur = q;
  const text = (qSeg.done + q).replace(/\s+/g, ' ').trim();
  liveQ(text.slice(-80), 'voice');
  if (text) chips(rank(pack, qsents, text).slice(0, 3), text, false);
}

// 두 번째 탭이나 입력칸 Enter: e5 + 음절 비교로 판정. JEV 모드면 Kev가 e5 후보 5개와 '해당 없음' 가운데 다시 고른다.
// 자동 열기를 켰으면 e5 1등이 확실할 때(JEV가 있으면 JEV도 같은 1등일 때)만 카드를 바로 연다. 판정마다 기록에 남긴다.
async function judge(text, by = 'voice') {
  if (!pack) return;
  const n = ++judgeN, t = performance.now();
  asked = text; askedBy = by;
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
      jmsg = ' · 큰 모델이 안 돼서 기본 방식으로 골랐어요';
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
  $('qaTime').textContent = (qv ? '이 기기 안에서 골랐어요' : '글자 비교로 골랐어요') + jmsg;
  liveQ(text, by);  // 들은 질문은 카드를 열어도 왼쪽에 남는다
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
  box.classList.toggle('final', final);  // 판정이 끝난 후보는 번호를 달고 1순위에 테두리
  // 말하는 동안 바뀌는 후보는 읽어 주지 않는다 (화면 읽기 소리가 질문 인식에 섞이지 않게). 판정이 끝나면 읽어 준다.
  $('qaRes').setAttribute('aria-busy', !final);
  const none = final && chip('해당 없음 · 관련 대본 구간 보기', () => {
    note({ qa: 'pick', j: judgeN, id: null, how: 'none' });
    box.textContent = ''; $('qaLow').hidden = true; showHits(asked);
  }, 'none');
  if (none && noneFirst) box.append(none);
  top.forEach((r, i) => {
    const b = chip(r.q.q, () => openCard(r.q, top, text, final ? 'chip' : 'live', i), i ? '' : 'top');
    if (final) { const n = document.createElement('span'); n.className = 'n'; n.textContent = i + 1; b.prepend(n); }
    box.append(b);
  });
  if (none && !noneFirst) box.append(none);
}

// 카드는 다음 '질문'을 누를 때까지 저절로 바뀌지 않는다
// how: 어떻게 열었나('chip', 'live' 말하는 중의 칩, 'more' 카드 아래 칩, 'list' 전체 목록, 'auto' 자동). rank: 후보 중 몇째(0부터)
function openCard(q, top = [], text = '', how = '', rank = -1) {
  if (how) note({ qa: 'pick', j: judgeN, id: q.id, how, rank });
  qSeg = null;
  $('chips').textContent = ''; $('hits').hidden = true; liveQ(text, askedBy); $('qaLow').hidden = true;
  $('cardHeard').textContent = rank < 0 ? '고른 질문' : rank ? '비슷한 질문' : '가장 비슷한 질문';
  $('cardRank').hidden = rank < 0;
  $('cardRank').textContent = (rank + 1) + '순위';
  $('cardQ').textContent = q.q;
  $('cardKeys').replaceChildren(...(q.keys || []).map(k => mk('span', k)));
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
  // 카드 아래: 다른 후보(번호는 순위)와 '해당 없음'. 답의 일부로 보이지 않게 이름표를 단다
  const more = $('cardMore');
  more.textContent = '';
  if (top.length) {
    if (top.some(r => r.q !== q)) {
      const p = document.createElement('p');
      p.className = 'small';
      p.textContent = '다른 후보';
      more.append(p);
    }
    top.forEach((r, i) => {
      if (r.q === q) return;
      const b = chip(r.q.q, () => openCard(r.q, top, text, 'more', i));
      const n = document.createElement('span'); n.className = 'n'; n.textContent = i + 1; b.prepend(n);
      more.append(b);
    });
    more.append(chip('해당 없음 · 관련 대본 구간 보기', () => {
      note({ qa: 'pick', j: judgeN, id: null, how: 'none' });
      showHits(asked);
    }, 'none'));
  }
  $('card').hidden = false;
  askBtn();
  $('card').scrollIntoView({ block: 'start' });
  if (how !== 'auto') $('cardQ').focus({ preventScroll: true });  // 누른 칩은 사라지므로 포커스를 답 카드 제목으로 (화면 읽기도 답이 열린 것을 안다). 자동으로 열릴 때는 포커스를 뺏지 않는다
}

// '해당 없음'(시안): 들은 질문과 가까운 대본 문장을 보여 주고, 누르면 질의응답에서 나가 그 문장으로 간다. 없으면 전체 질문 목록을 연다.
function showHits(text) {
  const ss = sents.map((_, i) => words.filter(w => w.s === i).map(w => w.t).join(' ')), hs = text ? scriptHits(ss, text) : [];
  $('card').hidden = true; askBtn();
  $('hits').hidden = false;
  $('hitList').replaceChildren(...(hs.length ? hs.map(h => {
    const b = chip(h.t.length > 90 ? h.t.slice(0, 89) + '…' : h.t, () => { $('hits').hidden = true; setQa(false); jump(sentStart(h.i), 'tap'); });
    const n = document.createElement('small'); n.textContent = `대본 ${h.i + 1}번째 문장`; b.append(n);
    return b;
  }) : [mk('p', '비슷한 대본 문장을 찾지 못했어요. 아래 전체 질문 목록에서 골라 보세요.', 'small')]));
  if (!hs.length) { $('all').open = true; $('all').scrollIntoView(); }
  $('hitsH').focus({ preventScroll: true });  // 누른 칩이 사라지므로 포커스를 이 제목으로 (Tab으로 첫 대본 칩에 닿는다)
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
  qSeg = null;
  $('card').hidden = true;
  askBtn();
  judge(v, 'chat');
};

// ---- Q&A 준비 창 (편집 화면) ----
let draft = [], genCtl = null;
const copyQs = qs => qs.map(q => ({ ...q, alts: [...q.alts], answer: [...q.answer], keys: [...(q.keys || [])] }));
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
  syncChips();
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
    d.setAttribute('role', 'group'); d.setAttribute('aria-label', `질문 ${i + 1}`);  // 같은 이름의 칸이 여덟 번 읽히지 않게 번호를 붙인다
    const chk = document.createElement('label'), cb = document.createElement('input');
    chk.className = 'chk';
    cb.type = 'checkbox'; cb.checked = it.check; cb.setAttribute('aria-label', `질문 ${i + 1} 직접 확인`);
    cb.onchange = () => { it.check = cb.checked; d.classList.toggle('check', cb.checked); touched(); };
    chk.append(cb, ' 직접 확인');
    const del = chip('삭제', () => { draft.splice(i, 1); renderDraft(); touched(); (box.children[Math.min(i, draft.length - 1)]?.querySelector('input') ?? $('addQ')).focus(); });  // 지운 단추는 사라지므로 포커스를 이웃 질문으로
    del.className = ''; del.setAttribute('aria-label', `질문 ${i + 1} 삭제`);
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
      field('input', '핵심 키워드 (쉼표로 나눠 2~3개, 답 카드 맨 위에 보여요)', (it.keys || []).join(', '), v => { it.keys = v.split(/[,，]/); }),
      src, row,
    );
    box.append(d);
  });
}

function setDraft(p, how) {
  draft = copyQs(p.questions);
  renderDraft();
  const n = p.questions.filter(q => q.check).length;
  prepMsg(`${how} 질문 ${p.questions.length}개를 불러왔어요.` + (n ? ` '직접 확인'이 켜진 ${n}개는 자료에 근거가 없으니 확인해 주세요.` : '') + " 읽어 보고 고친 뒤 '저장'을 누르세요.");
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
  $('coachAi').hidden = !k;
  $('coachKeyHint').hidden = !!k;
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
  copyPrompt($('promptOut'), qaPrompt(inf).text, prepMsg, '답');
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
    await vectors((i, n) => prepMsg(`${done}. 질문 찾기 준비 중 ${i}/${n}`));
    if (pack === p) prepMsg(V ? `${done}. 질문 찾기 준비도 끝났어요.` : done);  // 그사이 다시 저장했으면 그쪽이 알린다
  } else if (modelState !== 'loading') prepMsg(`${done}. 질문 찾기 모델을 쓰려면 아래 '질문 찾기 모델 받기'를 누르세요.`);
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
$('keyBtn5').onclick = openKey;
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
// stay: 6초 뒤 사라지지 않고 [닫기]를 누르거나 다른 알림이 올 때까지 남는다
function tell(t, { stay = false } = {}) {
  const box = document.querySelector('dialog[open] [role=status]');
  if (box) { box.textContent = t; return; }
  $('toastT').textContent = t;
  $('toastX').hidden = !stay;
  $('toast').hidden = !t;
  clearTimeout(tell.h);
  if (!stay) tell.h = setTimeout(() => { $('toast').hidden = true; }, 6000);
}
$('toastX').onclick = () => { $('toast').hidden = true; };
const unstay = () => { if (!$('toastX').hidden) $('toast').hidden = true; };  // 남겨 둔 안내는 시작하거나 대본을 바꾸면 닫는다

// ---- 대본 고르기, 새로 만들기, 이름 바꾸기, 지우기 (편집 화면에서만) ----
function loadScript() {
  keepLog();  // 앞 대본의 기록을 남긴다 (돌아오면 아래에서 잇는다)
  stopAudio('load');
  stopHear(); cardAt = -1; cardNew = false; diffSec = -1; upSlides = null; showUp(); $('promptOut').hidden = $('pasteBox').hidden = true;  // 앞 대본의 화면 값(열린 카드, 읽어 주던 소리, 올린 자료 칩, 복사한 프롬프트)은 비운다
  genCtl?.abort(); aiCtl?.abort(); altCtl?.abort(); adCtl?.abort(); coachCtl?.abort();  // 하던 AI 일은 앞 대본의 것이므로 멈춘다 (결과가 다른 대본에 들어가지 않게)
  $('text').value = (store.get(sk('script')) || '').normalize('NFC');
  target = +store.get(sk('target')) || 0;
  cur = +store.get(sk('cur')) || 0;  // 메모리의 읽던 위치도 이 대본 것으로 (편집 화면에서 render()·setLevels가 옛 값을 저장하지 않게)
  $('target').value = target || '';
  t0 = onSec = matched = seen = end = 0; endQa = false; r0 = rate(); log = []; heard = ''; cut = sessionNorm.length; pending = null; said = 0;
  // 발표 점검: 구간 수가 같을 때만 구간 누적을 되살린다. 높낮이·쉼(F)은 메모리에만 있어서 새로고침 전 것은 빠진다(re).
  SU = units($('text').value, [], spoken); secOf = []; newRun();
  runs = readRuns(store.get(sk('runs'))); runSel = 0; coachJob = 0;
  try {
    const v = JSON.parse(store.get(sk('talk'))); t0 = +v.t0 || 0; onSec = +v.onSec || 0; matched = +v.matched || 0; seen = +v.seen || t0; end = +v.end || 0; endQa = v.endQa === true; r0 = +v.r0 || rate();
    acc = readAcc(v.acc, SU.length) || acc;
    hs = readHear(v.hs); hs.base = hs.n;  // 새로고침 뒤 인식은 새 세션부터
    runT = +v.rt || t0;
    runKind = ['read', 'practice', 'live', 'mixed'].includes(v.kind) ? v.kind : null;
    if (Array.isArray(v.rd) && v.rd.length === SU.length) rd = v.rd.map(x => +x || 0);
    if (Array.isArray(v.tx) && v.tx.length === SU.length) tx = v.tx.map(x => String(x).slice(0, TX_MAX));
    if (Array.isArray(v.cues)) cues = v.cues;
    runAud = v.aud && typeof v.aud === 'object' ? v.aud : null;
    re = v.re === true || !!runAud;
  } catch {}
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
  renderLib(); updEst(); updAlt(); renderAds(); showEmpty(); unstay(); renderVerSide();
}

function renderLib() {
  const s = $('lib');
  s.textContent = '';
  for (const e of lib.list) s.append(new Option(e.name, e.id));
  s.append(new Option('＋ 새 대본', '+'));
  s.value = lib.cur;
}

const cleanName = s => String(s || '').normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, 40);
// 같은 이름이 둘 생기면 ' (2)'처럼 번호를 붙인다 (이름은 40자까지). self: 이름을 바꾸는 대본 자신은 빼고 본다
// 기본 이름은 안 쓰인 가장 작은 '대본 N'
const nextName = () => { let n = 1; while (lib.list.some(x => x.name === `대본 ${n}`)) n++; return `대본 ${n}`; };
const uniqueName = (name, self = null) => { for (let i = 2, b = name.slice(0, 35); lib.list.some(x => x !== self && x.name === name); i++) name = `${b} (${i})`; return name; };
$('lib').onchange = () => {
  let id = $('lib').value;
  if (id === '+') {
    const name = prompt('새 대본 이름', nextName());
    if (name === null) return renderLib();
    id = Date.now().toString(36);
    lib.list.push({ id, name: uniqueName(cleanName(name) || nextName()), src: '' });
  }
  lib.cur = id;
  saveLib(); loadScript();
};

// ---- 내 발표 (시안의 홈): 대본마다 카드 하나, 아래에 최근 연습. 머리줄의 '말랑'을 누르면 열린다 ----
const homeOpen = () => !$('home').hidden;
function closeHome() { $('home').hidden = true; document.body.classList.remove('home'); $('homeBtn').setAttribute('aria-expanded', 'false'); }
function renderHome() {
  const grid = $('hGrid'), all = [];
  grid.replaceChildren(...lib.list.map(e => {
    const text = (store.get(sk('script', e.id)) || '').trim(), g = Math.round((+store.get(sk('target', e.id)) || 0) * 60);
    const rs = readRuns(store.get(sk('runs', e.id))), last = rs.at(-1);
    for (const r of rs) all.push({ e, r });
    const b = mk('button', '', e.id === lib.cur ? 'pcard on' : 'pcard');
    const th = mk('div', text ? text.slice(0, 60) + (text.length > 60 ? '…' : '') : '아직 비어 있어요', text ? 'th' : 'th none');
    th.setAttribute('aria-hidden', 'true');  // 카드 이름은 발표 이름부터 읽히게 (미리보기는 눈으로만)
    if (e.id === lib.cur) b.setAttribute('aria-current', 'true');
    const badge = !text ? mk('span', '대본 쓰는 중', 'badge')
      : !last ? mk('span', '아직 연습 전', 'badge')
      : !g ? mk('span', `최근 ${mmss(last.wall)}`, 'badge')
      : last.wall > g + 15 ? mk('span', `최근 ${mmss(last.wall)} · ${mmss(last.wall - g)} 초과`, 'badge over')
      : mk('span', `최근 ${mmss(last.wall)} · 시간 안`, 'badge ok');
    const info = mk('div'), ft = mk('div', '', 'ft');
    info.append(mk('div', e.name, 'nm'), mk('div', `${g ? '목표 ' + mmss(g) : '목표 없음'}${rs.length ? ` · 연습 ${rs.length}회` : ''}`, 'mt'));
    ft.append(badge, mk('span', !text ? '대본 쓰기' : last ? '이어서 연습' : '연습하러 가기', 'go'));
    b.append(th, info, ft);
    b.onclick = () => { closeHome(); if (e.id !== lib.cur) { lib.cur = e.id; saveLib(); loadScript(); } };
    return b;
  }));
  const add = mk('button', '＋ 새 발표 만들기', 'pcard new');
  add.onclick = () => { closeHome(); $('lib').value = '+'; $('lib').onchange(); };
  grid.append(add);
  const top = all.sort((x, y) => y.r.t0 - x.r.t0).slice(0, 3);
  $('hRunsH').hidden = !top.length;
  $('hRuns').replaceChildren(...top.map(({ e, r }) => {
    const b = mk('button');
    b.append(mk('span', e.name), mk('span', runLabel(r)));
    b.onclick = () => { closeHome(); if (e.id !== lib.cur) { lib.cur = e.id; saveLib(); loadScript(); } openCheck(r.t0); };
    return b;
  }));
}
// 홈 탭: 내 발표 / 연습 기록 / 설정
function setHomeTab(t) {
  for (const b of document.querySelectorAll('.htabs [data-t]')) b.setAttribute('aria-selected', b.dataset.t === t);
  for (const d of document.querySelectorAll('#home [data-tp]')) d.hidden = d.dataset.tp !== t;
  if (t === 'runs') {
    const all = lib.list.flatMap(e => readRuns(store.get(sk('runs', e.id))).map(r => ({ e, r }))).sort((x, y) => y.r.t0 - x.r.t0);
    $('hRunsAll').replaceChildren(...all.map(({ e, r }) => {
      const b = mk('button');
      b.append(mk('span', e.name), mk('span', runLabel(r)));
      b.onclick = () => { closeHome(); if (e.id !== lib.cur) { lib.cur = e.id; saveLib(); loadScript(); } openCheck(r.t0); };
      return b;
    }));
  }
  if (t === 'set') {
    $('hsKeyV').textContent = keyStore.get() ? '넣어 둠' : '없음';
    $('hsFs').textContent = $('fsNow').textContent;
    $('hsInstall').hidden = !installEv;
  }
}
for (const b of document.querySelectorAll('.htabs [data-t]')) b.onclick = () => setHomeTab(b.dataset.t);
$('hsKey').onclick = () => { closeHome(); openKey(); };
$('hsSm').onclick = () => { fontSize(-2); $('hsFs').textContent = $('fsNow').textContent; };
$('hsBg').onclick = () => { fontSize(2); $('hsFs').textContent = $('fsNow').textContent; };
$('hsInstall').onclick = () => $('mInstall').onclick();
$('homeBtn').onclick = () => { if (homeOpen()) return closeHome(); renderHome(); setHomeTab('main'); $('home').hidden = false; document.body.classList.add('home'); $('homeBtn').setAttribute('aria-expanded', 'true'); $('homeH').focus(); };
// 같은 브라우저의 다른 탭(설치한 앱 창 포함)이 대본 목록을 바꾸면 따라간다. 안 그러면 이 탭의 옛 목록이 저장될 때 다른 탭에서 만든 대본이 목록에서 사라진다.
addEventListener('storage', e => {
  if (e.key !== 'ls.lib' || !e.newValue) return;
  try {
    const list = cleanList(JSON.parse(e.newValue)), me = entry();
    if (!list.some(x => x.id === me.id)) list.push(me);  // 지금 열어 둔 대본은 다른 탭이 지워도 목록에 둔다
    lib.list = list; renderLib(); if (homeOpen()) renderHome();
  } catch {}
});
$('mHome').onclick = () => homeOpen() || $('homeBtn').click();  // 폰 폭에서는 머리줄에 말랑 단추가 없어서 ⋯ 메뉴로 간다 (메뉴는 단추를 누르면 저절로 닫힌다)
$('hNew').onclick = () => { closeHome(); $('lib').value = '+'; $('lib').onchange(); };
$('hPaste').onclick = () => { closeHome(); $('text').focus(); };
$('mode').addEventListener('click', closeHome, true);
addEventListener('keydown', e => { if (e.key === 'Escape' && homeOpen() && !document.querySelector('dialog[open]')) { closeHome(); $('homeBtn').focus(); } });  // 포커스가 사라지면 Tab이 엉뚱한 곳에서 시작한다

// 메뉴 창: 버튼을 누르면 메뉴를 먼저 닫는다 (다른 창이 그 위에 열리도록)
$('menuBtn').onclick = () => { $('menuTitle').textContent = entry().name; $('menu').showModal(); };
$('menu').addEventListener('click', e => { if (e.target.closest('button')) $('menu').close(); }, true);
// 앱으로 설치: Chrome이 설치할 수 있다고 알려 줄 때만 메뉴에 버튼을 보인다 (배너나 재촉은 없다). 설치한 앱 창에서는 숨긴다.
let installEv = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEv = e; $('mInstall').hidden = matchMedia('(display-mode: standalone)').matches; });
addEventListener('appinstalled', () => { installEv = null; $('mInstall').hidden = true; });
$('mInstall').onclick = () => { installEv?.prompt().catch(() => {}); installEv = null; $('mInstall').hidden = true; };  // prompt()는 한 번만 된다. 닫으면 Chrome이 다음에 다시 알려 준다.
$('mRename').onclick = () => {
  const e = entry(), name = cleanName(prompt('대본 이름', e.name));
  if (!name) return;
  e.name = uniqueName(name, e);
  saveLib(); renderLib();
};
$('mDel').onclick = () => {
  const e = entry();
  if (!confirm(`'${e.name}' 대본과 버전, 질문, 연습 기록을 모두 지울까요? 되돌릴 수 없어요.`)) return;
  for (const k of ['script', 'cur', 'target', 'talk', 'qaInfo', 'pack', 'vers', 'prep', 'shrink', 'adlib', 'runs', 'says', 'sugIgnore', 'must', 'hardIgnore']) store.del(sk(k));
  try { sessionStorage.removeItem('ls.draft.' + e.id); } catch {}  // 저장하지 않은 질문 수정도 같이 지운다
  lib.list = lib.list.filter(x => x !== e);
  log = [];  // 지운 대본의 기록은 남기지 않는다 (loadScript의 keepLog가 이 탭의 것도 지운다)
  try { sessionStorage.removeItem('ls.last.' + e.id); } catch {}
  if (!lib.list.length) lib.list.push({ id: Date.now().toString(36), name: '대본 1', src: '' });
  lib.cur = lib.list[0].id;
  saveLib(); loadScript();
  tell(`대본을 지웠어요: '${e.name}'`);
};

// 대본 파일: PC에서 쓴 대본을 발표용 휴대폰으로 옮긴다. 목표 시간, 발표 정보, 질문 팩, 발표 준비도 같이 (휴대폰에서 AI를 다시 부르지 않게).
// 가져오면 새 대본으로 더한다. 글 파일(.txt)도 받는다.
$('mExport').onclick = () => download(`${entry().name}.livescript.json`, JSON.stringify({
  app: 'livescript', kind: 'script', name: entry().name, text: $('text').value, target, info: pinfo, pack, prep: loadPrep(), must: must(),
}));
$('mImport').onclick = () => $('scriptFile').click();
$('scriptFile').onchange = async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  if (f.size > 3e5) return tell('가져오지 못했어요. 파일이 너무 커요. 대본은 10만 자(약 300KB)까지 가져올 수 있어요.');  // 글이 길수록 따라가기 준비가 제곱으로 느려진다(2MB는 열 때마다 45초)
  importScript(await f.text(), f.name);
};
// 예시 대본: 같은 출처의 파일을 가져오기와 같은 길로 연다. 키 없이도 자동 줄이기, 따라가기, 질문 판정을 바로 볼 수 있게 자동 줄이기를 켜 둔다.
$('mSample').onclick = $('eSample').onclick = () => fetch('sample.livescript.json?v=14').then(r => { if (!r.ok) throw new Error(); return r.text(); })
  .then(t => importScript(t, 'sample.livescript.json', true)).catch(() => tell('예시 대본을 불러오지 못했어요. 인터넷 연결을 확인해 주세요.'));
$('ePaste').onclick = () => $('text').focus();
// 빈 편집 화면의 첫 안내 카드는 대본에 글이 생기면 숨긴다
const showEmpty = () => { $('empty').hidden = !!$('text').value.trim(); if (!cardEditing) renderCards(); };

// ---- 문단 카드 (시안의 대본 편집) ----
// 대본이 있으면 편집 화면은 문단마다 카드 하나(번호·첫 글·예상 시간)다. 카드를 누르면 그 문단만 글칸이 되고 아래에 '꼭 말할 문장'과 '더 짧게·더 쉽게'가 나온다.
// 글은 그대로 숨은 #text에 있어서(저장, 버전, AI가 모두 이 칸을 읽는다) 카드에서 고치면 그 문단 자리만 #text에 반영한다.
let cardAt = -1, cardEditing = false, cardNew = false;  // 글칸이 된 카드 번호(-1 없음), 글 치는 중(다시 그리지 않는다), 끝에 더한 빈 카드가 열려 있나
let cardSpan = null;                                       // 글칸이 된 문단의 지금 자리 { a, b }(#text 안 위치)
const must = () => { try { const v = JSON.parse(store.get(sk('must'))); return Array.isArray(v) ? v.filter(x => typeof x === 'string') : []; } catch { return []; } };
const saveMust = a => a.length ? store.set(sk('must'), JSON.stringify(a.slice(0, 200))) : store.del(sk('must'));  // 꼭 말할 문장(글 그대로). shrink.js units()가 늘 남긴다
const hardIgnore = () => { try { const v = JSON.parse(store.get(sk('hardIgnore'))); return Array.isArray(v) ? v : []; } catch { return []; } };
const titleOf = t => { const w = t.replace(/\s+/g, ' ').trim(); return w.length > 14 ? w.slice(0, 13) + '…' : w; };
// 연습 때 막힌 낱말(compare.js hardWords): 저장된 연습의 대본·들은 말을 다시 맞춘다. 연습 기록이 그대로면 다시 계산하지 않는다
let hardMemo = { raw: null, list: [] };
function hardList() {
  const raw = store.get(sk('says')) || '';
  if (hardMemo.raw !== raw) hardMemo = { raw, list: hardWords(readSays(raw).map(r => r.secs.flatMap(x => x.x.trim() ? align(x.s, x.x) : []))) };
  const ig = hardIgnore();
  return hardMemo.list.filter(h => !ig.includes(h.k));
}
const autosize = ta => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };

function renderCards() {
  const text = $('text').value, on = !!text.trim();
  document.body.classList.toggle('cards', on);
  $('cards').hidden = !on;
  if (!on) { cardAt = -1; cardNew = false; return; }
  const ps = paraSpans(text), ss = sentSpans(text), ms = new Set(must()), hard = new Map(hardList().map(h => [h.k, h]));
  if (cardAt >= ps.length) cardAt = cardNew ? ps.length : -1;
  $('cNav').replaceChildren();
  $('cList').replaceChildren(...[...ps.map(([a, b], i) => ({ a, b, i })), ...(cardNew ? [{ a: text.trimEnd().length + 2, b: text.trimEnd().length + 2, i: ps.length }] : [])].map(({ a, b, i }) => {
    const t = text.slice(a, b), on = i === cardAt, card = mk('article', '', on ? 'pc on' : 'pc');
    card.id = 'p' + (i + 1); card.dataset.i = i;
    card.setAttribute('aria-label', `${i + 1}번 문단`);
    const ph = mk('div', '', 'ph');
    ph.append(mk('span', `${i + 1} · ${titleOf(t) || '새 문단'}`, 'pn'), mk('span', `예상 ${est(t)}`, 'pe'));
    card.append(ph);
    if (on) {
      const ta = mk('textarea', '', 'pta');
      ta.value = t; ta.dataset.a = a; ta.setAttribute('aria-label', `${i + 1}번 문단 고치기`); ta.placeholder = '여기에 문단을 쓰세요';
      cardSpan = { a, b };
      ta.addEventListener('input', e => { if (!e.isComposing) cardInput(ta); });
      ta.addEventListener('compositionend', () => cardInput(ta));
      for (const ev of ['select', 'keyup', 'mouseup', 'focus']) ta.addEventListener(ev, () => cardSel(ta));
      ta.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); const k = cardAt; cardAt = -1; cardNew = false; renderCards(); $('p' + (k + 1))?.focus(); } });
      card.append(ta, cardTool(ta));
    } else {
      const p = mk('p', '', 'pt');
      p.replaceChildren(...paraNodes(text, a, b, ss[i] || [], ms, hard));  // 꼭 말할 문장은 표시, 막힌 낱말은 점선 밑줄
      card.append(p);
      card.tabIndex = 0;
      card.addEventListener('click', e => { if (!e.target.closest('.hard, .hardpop')) cardOpen(i, e); });
      card.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === card) { e.preventDefault(); cardOpen(i); } });
    }
    const n = mk('a'), th = mk('i', t.slice(0, 40));
    th.setAttribute('aria-hidden', 'true');  // 작은 미리보기는 아래 '번호 제목'과 같은 글이라 읽어 주지 않는다
    n.href = '#p' + (i + 1); n.append(th, mk('span', `${i + 1} ${titleOf(t)}`));
    if (on) n.setAttribute('aria-current', 'true');
    n.onclick = e => { e.preventDefault(); card.scrollIntoView({ behavior: 'smooth', block: 'center' }); cardOpen(i); };
    $('cNav').append(n);
    return card;
  }));
  $('cAdd').hidden = cardNew;
  const ta = $('cList').querySelector('.pta');
  if (ta) { autosize(ta); if (renderCards.focus) { ta.focus(); ta.setSelectionRange(...renderCards.focus); } }
  renderCards.focus = null;
}
// 문단 글을 노드로: 문장 사이 글은 그대로, 꼭 말할 문장은 <mark>, 막힌 낱말은 점선 밑줄 단추
function paraNodes(text, a, b, sents, ms, hard) {
  const out = [];
  let o = a;
  const words = (from, to, host) => {
    for (const m of text.slice(from, to).matchAll(/\S+|\s+/g)) {
      const t = m[0], k = wordKey(t), h = k && hard.get(k);
      if (!h) { host.push(t); continue; }
      const w = mk('span', t.replace(/[^0-9A-Za-z가-힣]+$/, ''), 'hard'), end = from + m.index + w.textContent.length;
      w.tabIndex = 0; w.setAttribute('role', 'button'); w.dataset.a = from + m.index; w.dataset.b = end; w.dataset.k = k;
      w.onclick = e => { e.stopPropagation(); hardPop(w, h); };
      w.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); hardPop(w, h); } };
      host.push(w, t.slice(w.textContent.length));
    }
  };
  for (const [sa, sb] of sents) {
    words(o, sa, out);
    if (ms.has(text.slice(sa, sb))) { const mk2 = mk('mark', '', 'must'), inner = []; words(sa, sb, inner); mk2.append(...inner); out.push(mk2); }
    else words(sa, sb, out);
    o = sb;
  }
  words(o, b, out);
  return out;
}
// 카드를 글칸으로. e가 있으면 누른 자리에 커서를 둔다
function cardOpen(i, e) {
  if (cardAt === i) return;
  cardAt = i; cardNew = false;
  let at = null;
  const card = e?.currentTarget;
  if (e && card && document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(e.clientX, e.clientY), pt = card.querySelector('.pt');
    if (r && pt?.contains(r.startContainer)) {
      const w = document.createTreeWalker(pt, NodeFilter.SHOW_TEXT);
      let n = 0, x;
      while ((x = w.nextNode())) { if (x === r.startContainer) { n += r.startOffset; break; } n += x.length; }
      at = [n, n];
    }
  }
  renderCards.focus = at || [1e9, 1e9];
  renderCards();
}
// 카드에서 글을 치면 그 문단 자리만 #text에 넣는다
function cardInput(ta) {
  const text = $('text').value, nf = ta.value.normalize('NFC');
  if (nf !== ta.value) { const a = ta.selectionStart, b = ta.selectionEnd; ta.value = nf; ta.setSelectionRange(a, b); }
  let { a, b } = cardSpan;
  if (cardNew) {  // 끝에 더한 빈 카드: 처음 글자를 칠 때 문단 구분(빈 줄)과 함께 붙인다
    const base = text.trimEnd();
    a = b = base.length + (base ? 2 : 0);
    if (!ta.value.trim()) return;
    $('text').value = base + (base ? '\n\n' : '') + ta.value;
    cardNew = false; cardSpan = { a, b: a + ta.value.length };
  } else {
    $('text').value = text.slice(0, a) + ta.value + text.slice(b);
    cardSpan = { a, b: a + ta.value.length };
  }
  cardEditing = true;
  textChanged('직접 고침'); undo = null; updAlt();
  cardEditing = false;
  autosize(ta);
  ta.dataset.a = cardSpan.a;
  const card = ta.closest('.pc');
  card.querySelector('.pe').textContent = `예상 ${est(ta.value)}`;
  card.querySelector('.pn').textContent = `${+card.dataset.i + 1} · ${titleOf(ta.value) || '새 문단'}`;
  updMust(ta);
}
// 카드 글칸의 선택을 숨은 #text에 옮겨서 '다른 말'과 AI 문단 고치기가 그대로 읽는다
function cardSel(ta) {
  if (!cardSpan) return;
  $('text').setSelectionRange(cardSpan.a + ta.selectionStart, cardSpan.a + ta.selectionEnd);
  updAlt(); updMust(ta);
}
const cardPos = ta => cardSpan.a + ta.selectionStart;
// 커서가 든 문장(#text 위치) [시작, 끝]
function sentAtCaret(ta) {
  const text = $('text').value, i = paraSpans(text).findIndex(([a]) => a === cardSpan.a), ss = sentSpans(text)[i] || [], c = cardPos(ta);
  return ss.find(([a, b]) => c >= a && c <= b + 1) ?? ss.findLast(([a]) => a <= c) ?? null;
}
function updMust(ta) {
  const card = ta.closest('.pc'), btn = card?.querySelector('.mustb');
  if (!btn) return;
  const text = $('text').value, s = sentAtCaret(ta), ms = must(), i = paraSpans(text).findIndex(([a]) => a === cardSpan.a);
  const n = (sentSpans(text)[i] || []).filter(([a, b]) => ms.includes(text.slice(a, b))).length;
  btn.setAttribute('aria-pressed', !!s && ms.includes(text.slice(...s)));
  btn.lastChild.textContent = n ? ` ${n}개` : '';
}
function cardTool(ta) {
  const d = mk('div', '', 'ptool'), m = mk('button', '', 'mustb'), sp = mk('span', '', 'grow'), lb = mk('span', '이 문단 다시 만들기', 'small');
  m.type = 'button'; m.setAttribute('aria-pressed', 'false');
  m.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path fill="currentColor" d="M5 1h4l-.5 4L11 7.5H7.6L7 13l-.6-5.5H3L5.5 5z"/></svg>꼭 말할 문장<span></span>';  // 마지막 span은 개수 자리
  m.onclick = () => {
    const s = sentAtCaret(ta);
    if (!s) return tell('표시할 문장에 커서를 두세요.');
    const t = $('text').value.slice(...s), ms = must();
    saveMust(ms.includes(t) ? ms.filter(x => x !== t) : [...ms, t]);
    updMust(ta);
    if (document.body.classList.contains('editing')) shrinkUnits();  // 늘 남기는 문장이 바뀌었다
  };
  const mkBtn = (label, ins) => { const b = mk('button', label); b.type = 'button'; b.onclick = () => remake(ta, ins); return b; };
  d.append(m, sp, lb, mkBtn('더 짧게', '이 문단을 같은 뜻으로 더 짧게 줄여 줘'), mkBtn('더 쉽게', '이 문단을 더 쉬운 말로 바꿔 줘'));
  queueMicrotask(() => updMust(ta));
  return d;
}
// 이 문단 다시 만들기: AI 도구의 '지시로 고치기'를 이 문단만으로 열고, 키가 있으면 바로 시작한다
function remake(ta, instr) {
  $('text').setSelectionRange(cardSpan.a, cardSpan.a + ta.value.length);
  openAi('edit');
  $('instr').value = instr;
  $('onlySel').checked = true;
  if (keyStore.get()) $('aiGo').click();
}
// 막힌 낱말을 누르면 연습 때 바꿔 말한 말이 추천으로 나온다. 누르면 그 자리만 바뀐다
function hardPop(w, h) {
  $('cList').querySelectorAll('.hardpop').forEach(x => x.remove());
  const pop = mk('div', '', 'hardpop'), row = mk('div', '', 'row'), cardId = w.closest('.pc').id;
  pop.setAttribute('role', 'group'); pop.setAttribute('aria-label', '대체 단어 추천');
  pop.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); pop.remove(); w.focus(); } });  // 키보드로 닫는 길
  pop.append(mk('div', `'${h.w}' — 연습 때 ${h.runs}번 막혔어요`, 'small'));
  const a = +w.dataset.a, b = +w.dataset.b, orig = w.textContent;
  for (const alt of h.alts) {
    const x = mk('button', alt);
    x.onclick = () => {
      const ta = $('text');
      if (ta.value.slice(a, b) !== orig) return tell('그사이 대본이 바뀌어서 바꾸지 못했어요.');
      if (!snapshot('막힌 낱말 바꾸기 전', true)) return tell(NOKEEP);
      ta.setRangeText(alt, a, b, 'preserve');
      ta.dispatchEvent(new Event('input'));
      setSrc('막힌 낱말 바꿈');
      tell(`바꿨어요: '${orig}' → '${alt}'`);
      document.getElementById(cardId)?.focus();  // 다시 그려진 카드로 포커스 (고른 단추는 사라졌다)
    };
    row.append(x);
  }
  const no = mk('button', '추천 안 함', 'no');
  no.onclick = () => { store.set(sk('hardIgnore'), JSON.stringify([...hardIgnore(), h.k])); renderCards(); document.getElementById(cardId)?.focus(); };
  row.append(no);
  pop.append(row);
  const card = w.closest('.pc'), cr = card.getBoundingClientRect(), wr = w.getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(wr.left - cr.left, cr.width - 348)) + 'px';
  pop.style.top = wr.bottom - cr.top + 6 + 'px';
  card.append(pop);
  row.firstChild.focus();
}
document.addEventListener('click', e => { if (!e.target.closest('.hardpop, .hard')) document.querySelectorAll('.hardpop').forEach(x => x.remove()); });
// 글칸 밖을 누르면 글칸을 닫고 카드로 되돌린다(고친 글은 이미 반영됐다)
document.addEventListener('pointerdown', e => {
  if (cardAt < 0 || !editing() || e.target.closest('.pc.on, dialog, #cNav, header, footer, aside')) return;
  cardAt = -1; cardNew = false; renderCards();
});
$('cAdd').onclick = () => { cardNew = true; cardAt = paraSpans($('text').value).length; renderCards.focus = [0, 0]; renderCards(); };

async function importScript(raw, fname, demo = false) {
  let r;
  try { r = readScript(raw, fname); } catch (err) { return tell('가져오지 못했어요. ' + (err instanceof SyntaxError ? '파일 내용이 깨졌어요.' : err.message)); }
  const id = Date.now().toString(36), k = n => sk(n, id);
  if (!save(k('script'), r.text)) return tell(FULL);
  if (r.target) store.set(k('target'), r.target);
  store.set(k('qaInfo'), JSON.stringify(r.info));
  try { store.set(k('pack'), JSON.stringify(cleanPack(r.pack))); } catch {}  // 질문 팩이 없거나 깨졌으면 질문 없이
  if (r.prep) store.set(k('prep'), JSON.stringify(r.prep));
  if (r.must.length) store.set(k('must'), JSON.stringify(r.must));  // 꼭 말할 문장도 같이 와야 다른 기기에서 자동 줄이기가 그 문장을 남긴다
  if (demo) store.set(k('shrink'), JSON.stringify({ on: true }));
  // 같은 기기에서 내보냈다 가져오면 이름이 겹치므로 ' (2)'처럼 번호를 붙인다 (이름은 40자까지)
  const name = uniqueName(cleanName(r.name) || nextName());
  const was = lib.cur;
  lib.list.push({ id, name, src: '파일에서 가져옴' });
  lib.cur = id;
  // 목록을 저장하지 못하면(저장 공간 부족) 방금 넣은 것을 되돌리고 성공이라고 알리지 않는다 (saveLib가 이미 알렸다)
  if (!saveLib()) { lib.list.pop(); lib.cur = was; for (const n of ['script', 'target', 'qaInfo', 'pack', 'prep', 'shrink', 'must']) store.del(k(n)); return; }
  loadScript();
  // 모델이 이 기기에 있으면 발표 화면에 들어갈 때 알아서 불러오고 '질문 찾기 모델 받기'도 보이지 않는다
  const get = demo && modelState === 'off' && !await modelCached() ? " 질문 찾기 모델을 쓰려면 'Q&A' 화면 맨 아래의 '질문 찾기 모델 받기'를 누르세요." : '';
  // 예시는 처음 쓰는 사람이 따라 할 안내라 닫을 때까지 남긴다
  if (demo) tell("예시 대본을 열었어요. 위 '발표'를 누르고 '● 시작'을 누른 뒤 소리 내어 읽어 보세요. 질문 답하기는 발표 화면의 'Q&A'에서 볼 수 있어요." + get + " 연습하며 재 보려면 ⋯ > '발표 점검'을 누르세요.", { stay: true });
  else tell(`새 대본으로 가져왔어요: '${entry().name}'.` + (pack ? ` 질문 ${pack.questions.length}개도 같이 왔어요.` : ''));
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
  renderVerSide();
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

// 되돌리기: 지금 대본을 버전으로 남긴 뒤 바꾼다. 안내할 글을 돌려준다.
function restoreVer(v) {
  if (v.text === $('text').value) return '지금 대본과 같아요.';
  if (!snapshot('되돌리기 전')) return NOKEEP;
  const kept = keptIn();
  setText(v.text, `되돌림(${when(v.t)})`);
  return '되돌렸어요.' + (kept && ` 되돌리기 전 대본은 ${kept}에 있어요.`);
}
$('verRestore').onclick = () => {
  if (!picked) return;
  histMsg(restoreVer(picked));
  picked = null;
  renderVers();
};

// 편집 화면 오른쪽 '버전 기록'(시안): 최근 3개. 지금 대본과 같은 버전은 '지금', 나머지는 되돌리기
function renderVerSide() {
  const vs = vers().slice(0, 3), now = $('text').value;
  $('verSide').replaceChildren(...(vs.length ? vs.map(v => {
    const li = mk('li'), d = mk('div'), sub = mk('small', `${when(v.t)} · 예상 ${est(v.text)}`);
    d.append(mk('b', v.label), sub);
    if (v.text === now) li.append(d, mk('span', '지금', 'now'));
    else { const b = mk('button', '되돌리기'); b.onclick = () => { tell(restoreVer(v)); renderVerSide(); }; li.append(d, b); }
    return li;
  }) : [mk('li', '아직 저장된 버전이 없어요.', 'now')]));
}
$('verSideSave').onclick = () => { tell(saveVersion()); renderVerSide(); };
$('verSideAll').onclick = openHist;

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

// ---- 'AI 도구 › 새로 쓰기' 보조 (시안의 대본 만들기): 발표자료 올리기, 듣는 사람·발표 시간 칩, 말투 세그먼트 ----
const gInfo = k => $('ai').querySelector(`[data-info="${k}"]`);
const setInfo = (k, v) => { const el = gInfo(k); el.value = v; el.dispatchEvent(new Event('change')); };  // 저장은 change에서
function syncChips() {
  const aud = $('aud').value.trim(), min = $('gMin').value.trim(), tone = $('toneSel').value;
  for (const b of $('audChips').children) b.setAttribute('aria-pressed', b.textContent === aud);
  for (const b of $('minChips').querySelectorAll('[data-m]')) b.setAttribute('aria-pressed', +b.dataset.m === +min && min !== '');
  for (const b of $('toneSeg').children) b.setAttribute('aria-pressed', b.dataset.t === tone);
}
$('audChips').onclick = e => { const b = e.target.closest('button'); if (b) { setInfo('audience', b.textContent); syncChips(); } };
$('minChips').onclick = e => { const b = e.target.closest('[data-m]'); if (b) { setTarget(b.dataset.m); syncChips(); } };
$('toneSeg').onclick = e => { const b = e.target.closest('button'); if (b) { setInfo('tone', b.dataset.t); syncChips(); } };
$('aud').addEventListener('input', syncChips); $('gMin').addEventListener('input', syncChips);

// 올린 자료의 슬라이드. 파일 줄과 슬라이드 조각(처음 셋과 '+N장')을 그리고, 개요 칸에 슬라이드마다 한 줄을 넣는다.
let upSlides = null;
function showUp() {
  $('upRow').hidden = $('upThumbs').hidden = !upSlides;
  if (!upSlides) return;
  const sl = upSlides.slides;
  $('upExt').textContent = upSlides.kind === 'pdf' ? 'PDF' : 'PPT';
  $('upName').textContent = upSlides.name;
  $('upInfo').textContent = `슬라이드 ${sl.length}장 · 내용 읽기 완료`;
  $('upThumbs').replaceChildren(...sl.slice(0, 3).map(s => mk('div', `${s.n} ${s.title}`)), ...(sl.length > 3 ? [mk('div', `+${sl.length - 3}장`, 'more')] : []));
}
let upSeq = 0;  // 늦게 끝난 앞 파일이 방금 고른 파일을 덮지 않게 마지막으로 고른 것만 반영한다
async function takeSlides(file) {
  if (!file) return;
  const my = ++upSeq;
  aiMsg('자료를 읽는 중이에요…');
  try {
    const { kind, slides } = await slidesFrom(file);
    if (my !== upSeq) return;
    if (!slides.some(s => s.body || !/^슬라이드 \d+$/.test(s.title))) throw new Error('읽을 수 있는 글이 없어요. 그림만 있는 자료는 개요를 직접 적어 주세요.');
    upSlides = { name: file.name, kind, slides };
    setInfo('outline', outlineLines(slides));
    if (!gInfo('topic').value.trim()) setInfo('topic', topicOf(slides, file.name));
    showUp();
    aiMsg(`슬라이드 ${slides.length}장을 읽어 개요 칸에 넣었어요. 고칠 곳이 있으면 고쳐 주세요.`);
  } catch (e) { if (my === upSeq) aiMsg('자료를 읽지 못했어요. ' + e.message); }
}
$('slideFile').onchange = e => { const f = e.target.files[0]; e.target.value = ''; takeSlides(f); };
$('upClear').onclick = () => {
  upSeq++;  // 읽는 중에 빼면 늦은 결과가 되살아나지 않게
  if (upSlides && gInfo('outline').value === outlineLines(upSlides.slides)) setInfo('outline', '');  // 직접 고친 개요는 남긴다
  upSlides = null; showUp(); aiMsg('');
};
for (const ev of ['dragenter', 'dragover']) $('upDrop').addEventListener(ev, e => { e.preventDefault(); $('upDrop').classList.add('over'); });
// 자료 올리기 칸 밖에 파일을 놓아도 브라우저가 그 파일로 이동해 앱을 벗어나지 않게 한다 (글을 끌어다 놓는 것은 'Files'가 아니라 그대로)
for (const ev of ['dragover', 'drop']) addEventListener(ev, e => { if (e.dataTransfer?.types?.includes('Files') && !e.target.closest?.('#upDrop')) e.preventDefault(); });
for (const ev of ['dragleave', 'drop']) $('upDrop').addEventListener(ev, e => { e.preventDefault(); $('upDrop').classList.remove('over'); if (ev === 'drop') takeSlides(e.dataTransfer.files[0]); });

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
    : `${when(p.t)}에 했는데 그 뒤로 대본이 바뀌었어요. 줄이기 정보를 쓰려면 다시 해 주세요. (키워드의 다른 말은 그대로 써요)`;
  // 늦어지면 뺄 수 있는 문장을 모두 그어 보인다 (단위마다 가장 높은 단계)
  $('prepCap').hidden = $('prepDiff').hidden = !fits;
  if (!fits) return;
  const u = units(text, p.paras, spoken, must());
  showDiff($('prepDiff'), '', '', strikes(text, u, u.map(x => x.max)));
}

$('aiGo').onclick = async () => {
  if (aiCtl) return aiCtl.abort();
  try { await run(jobFor(aiTab)); } catch (e) { aiMsg(e.message); }
};
$('aiCopy').onclick = () => {
  try { aiJob = jobFor(aiTab); } catch (e) { return aiMsg(e.message); }
  copyPrompt($('aiPrompt'), aiJob.prompt.text, aiMsg, aiTab === 'prep' ? '답' : '대본');
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
  const ta = $('text'), card = document.activeElement?.classList.contains('pta') ? document.activeElement : null;
  // 버튼을 누르느라 편집창 밖으로 나가도 고른 말을 기억한다. 카드 글칸의 선택은 문단 시작 자리를 더해 #text 위치로 본다
  if (document.activeElement === ta || (card && cardSpan)) {
    let a = card ? cardSpan.a + card.selectionStart : ta.selectionStart, b = card ? cardSpan.a + card.selectionEnd : ta.selectionEnd;
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
    $('altMsg').textContent = '누르면 그 자리만 바뀌어요.';
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

if (!SR) $('mic').disabled = true;
sayNone();
fontSize(0); textWidth(store.get('ls.w'));
loadScript();
showCoach();
$('text').readOnly = false; $('toast').hidden = true;  // 여기까지 오면 앱이 다 불러와졌다 (index.html은 읽기 전용과 안내로 시작)
showKey();
setMode(!$('text').value.trim());
document.body.classList.add('ready');  // 첫 화면은 모드가 정해질 때까지 가려 둔다(밝은 편집 화면이 어두운 발표 화면 앞에 번쩍이지 않게)
// 오프라인에서도 열리게 (sw.js). https와 *.localhost에서만 된다. 개발 주소(localhost, 127.0.0.1)는 고친 모듈이 캐시에 가리지 않게 뺀다.
if ('serviceWorker' in navigator && isSecureContext && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {});
// 대본이 있으면 바로 발표 화면으로 열리므로 [확인 필요]는 여기서 알린다
if (marks() && !document.body.classList.contains('editing')) tell(`대본에 [확인 필요]가 ${marks()}곳 남아 있어요. 발표 전에 편집에서 확인해 주세요.`);
