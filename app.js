// 라이브스크립트 화면. match.js(전역 norm, normMap, locate)를 먼저 불러온다.
import { cleanPack, prepare, rank, packHash, toB64, fromB64, loadModel, modelCached, embed, embedAll, REV, DIM } from './qa.js';
import { keyStore, keyOk, qaPrompt, generatePack, parsePack } from './claude.js';

const $ = id => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

let S = { s: '' }, words = [], sents = [], cur = 0, pending = null;

// 대본을 문장 > 어절 span으로 만든다. 어절마다 정규화 기준 시작/끝(n0, n1)을 기록.
function build(text) {
  text = text.normalize('NFC');
  S = normMap(text);
  const toNorm = [];
  for (let i = 0, k = 0; i <= text.length; i++) { toNorm[i] = k; if (S.at[k] === i) k++; }

  const root = $('prompt');
  root.textContent = '';
  words = []; sents = [];
  let sEl = null, newSent = true, last = 0, m;
  const re = /\S+/g;
  while ((m = re.exec(text))) {
    const gap = text.slice(last, m.index);
    if (gap.includes('\n')) newSent = true;
    if (newSent) {
      root.append(gap);
      sEl = document.createElement('span');
      sEl.className = 's';
      root.append(sEl);
      sents.push({ el: sEl, first: words.length });
      newSent = false;
    } else sEl.append(gap);
    const w = document.createElement('span');
    w.textContent = m[0];
    w.dataset.i = words.length;
    sEl.append(w);
    words.push({ el: w, s: sents.length - 1, n0: toNorm[m.index], n1: toNorm[m.index + m[0].length] });
    if (/[.?!…。]["'”’)\]]*$/.test(m[0])) newSent = true;
    last = re.lastIndex;
  }
  root.append(text.slice(last));
  cur = Math.min(+store.get('ls.cur') || 0, S.s.length);
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
  sents.forEach((x, i) => x.el.classList.toggle('cur', i === s));
  store.set('ls.cur', cur);

  // 지금 줄을 화면 위에서 1/3 지점에 둔다
  const el = words[c]?.el;
  if (el) {
    const d = el.getBoundingClientRect().top - innerHeight / 3;
    if (Math.abs(d) > el.offsetHeight * 0.6) scrollBy({ top: d, behavior: 'smooth' });
  }
}

function setCur(n) { cur = Math.max(0, Math.min(n, S.s.length)); render(); }

// 손으로 옮기면 들은 말을 비워서 예전 말에 다시 끌려가지 않게 한다
function jump(n) { heard = ''; cut = sessionNorm.length; pending = null; lastMatch = Date.now(); setCur(n); }

function sentStart(i) { return words[sents[i].first].n0; }
function prev() {
  if (!words.length) return;
  const s = words[Math.min(curWord(), words.length - 1)].s;
  jump(cur > sentStart(s) ? sentStart(s) : sentStart(Math.max(0, s - 1)));
}
function next() {
  const c = curWord();
  if (c < words.length && words[c].s + 1 < sents.length) jump(sentStart(words[c].s + 1));
}

// ---- 음성 인식 ----
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const NO_SR = '이 브라우저는 음성 인식이 안 돼요. Chrome이나 Safari를 쓰세요. 손으로 넘기기는 됩니다.';
let rec, listening = false, errored = false, lock = null;
let heard = '', sessionNorm = '', cut = 0, t0 = 0, lastHeard = 0, lastMatch = 0;
let resFinal = 0;  // 이번 인식 세션에서 확정된 결과 수 (질문 구간 시작점)

function onHeard(h) {
  const r = locate(S.s, h, cur);
  if (!r) return;
  lastMatch = Date.now();
  const d = r.pos - cur;
  // 뒤로 가거나 멀리 뛰는 건, 이어서 한 말도 그 위치에서 앞으로 맞아야 반영
  if (d < -2 || d > 60) {
    if (pending !== null && r.pos > pending && r.pos - pending <= 20) { pending = null; setCur(r.pos); }
    else if (pending === null || r.pos !== pending) pending = r.pos;
    return;
  }
  pending = null;
  if (d > 0) setCur(r.pos);
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
    resFinal = e.results.length;
    if (qSeg && qSeg.from > e.results.length) qSeg.from = 0;  // 결과 목록이 새로 시작됐으면 처음부터
    for (let i = 0; i < e.results.length; i++) {
      t += e.results[i][0].transcript;
      if (qSeg && i >= qSeg.from) q += e.results[i][0].transcript;
      if (!e.results[i].isFinal && resFinal > i) resFinal = i;
    }
    sessionNorm = norm(t);
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
    if (listening) setTimeout(() => { try { rec.start(); } catch {} }, errored ? 1000 : 0);
    errored = false;
  };
  rec.onerror = e => {
    if (e.error === 'no-speech' || e.error === 'aborted') return;
    errored = true;
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { stop(); say('마이크 권한을 허용해 주세요'); }
    else say(e.error === 'network' ? '인터넷 연결을 확인해 주세요' : '음성 인식 오류: ' + e.error);
  };
}

async function keepAwake() {
  try { lock = await navigator.wakeLock?.request('screen'); } catch {}
}

function start() {
  if (!rec) initRec();
  listening = true;
  if (!t0 || cur === 0) t0 = Date.now();
  lastMatch = Date.now();
  try { rec.start(); } catch {}
  keepAwake();
  $('mic').classList.add('on');
  $('mic').textContent = '■ 정지';
}

function stop() {
  listening = false;
  rec?.stop();
  lock?.release().catch(() => {});
  lock = null;
  $('mic').classList.remove('on');
  $('mic').textContent = busy ? '준비 중' : '● 시작';
}

document.addEventListener('visibilitychange', () => {
  if (listening && document.visibilityState === 'visible') keepAwake();
});

// ---- 화면 ----
function setMode(editing) {
  if (editing && qaMode) setQa(false);
  document.body.classList.toggle('editing', editing);
  $('mode').textContent = editing ? '발표' : '편집';
  if (editing) { stop(); scrollTo(0, 0); }
  else { build($('text').value); render(); prepareTalk(); }
}

function fontSize(delta) {
  const fs = Math.max(16, Math.min(64, (+store.get('ls.fs') || 28) + delta));
  store.set('ls.fs', fs);
  document.documentElement.style.setProperty('--fs', fs + 'px');
  if (delta && !qaMode) render();
}

setInterval(() => {
  if (document.body.classList.contains('editing')) { $('status').textContent = ''; return; }
  const sec = t0 ? Math.floor((Date.now() - t0) / 1000) : 0;
  const pct = S.s.length ? Math.round(cur / S.s.length * 100) : 0;
  const off = !qaMode && listening && lastHeard - lastMatch > 3000;
  // 휴대폰에서는 상태줄이 좁아 뒤쪽이 잘리므로 경고를 앞에 둔다
  $('status').innerHTML = (off ? '<span id="off">대본 밖</span> · ' : '') + `${pct}% · ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  $('qaBtn').classList.toggle('hot', !qaMode && pct >= 95);
}, 500);

$('text').oninput = () => { store.set('ls.script', $('text').value); store.set('ls.cur', 0); };
$('mode').onclick = () => setMode(!document.body.classList.contains('editing'));
$('mic').onclick = () => listening ? stop() : start();
$('prev').onclick = prev;
$('next').onclick = next;
$('smaller').onclick = () => fontSize(-2);
$('bigger').onclick = () => fontSize(2);
$('prompt').onclick = e => { const i = e.target.dataset.i; if (i != null) jump(words[i].n0); };
// 버튼에 포커스가 남으면 스페이스가 버튼을 한 번 더 누르게 되므로 바로 뗀다
addEventListener('click', e => e.target.closest('button')?.blur());
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
const AUTO_T1 = Infinity;  // 이 점수 이상이면 카드를 바로 연다. 실제 질문으로 평가해 정하기 전까지 끈다.

function setPack(p) { pack = p; qsents = p ? prepare(p) : []; V = null; vecKey = ''; }
try { setPack(cleanPack(JSON.parse(store.get('ls.pack')))); } catch { setPack(null); }

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
addEventListener('pagehide', () => { if (modelJob) store.del('ls.embLoading'); });

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
  })().finally(() => { vecJob = null; showModel(); });
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
  $('getModel').textContent = stuck ? '다시 시도' : '모델 받기 (약 163MB, 와이파이 권장)';
  $('qaState').textContent = !pack ? "준비된 질문이 없어요. 편집 화면의 'Q&A 준비'에서 만들어 주세요."
    : modelState === 'loading' || vecJob ? '판정 모델 준비 중… 그동안은 간단 비교로 동작 중'
    : ready && V ? `질문 ${pack.questions.length}개 · e5 판정` : `질문 ${pack.questions.length}개 · 간단 비교로 동작 중`;
  $('qaRetry').hidden = !stuck;
  $('ask').disabled = busy || !pack;
}

// 프렙 창의 '모델 받기'와 질의응답 화면의 '다시 시도'
async function getModel(report) {
  await loadJudge(p => p.status === 'progress_total' && report('모델 받는 중' + pctText(p)));
  if (pipe && pack) await vectors((i, n) => report(`질문 준비 중 ${i}/${n}`));
  report('');
}
$('getModel').onclick = () => getModel(t => t && ($('modelMsg').textContent = t));
$('qaRetry').onclick = async () => {
  setBusy(true);
  try { await getModel(t => $('qaState').textContent = t); } finally { setBusy(false); showModel(); }
};

// ---- 질의응답 화면 ----
let qaMode = false, qSeg = null;  // qSeg: '질문'을 누른 뒤 모으는 중인 말 { from, done, cur }
let asked = '';  // 마지막으로 판정한 질문. 전체 목록에서 고른 카드에도 보여 준다.

function setQa(on) {
  qaMode = on; qSeg = null;
  document.body.classList.toggle('qa', on);
  $('qaBtn').textContent = on ? '대본' : 'Q&A';
  askBtn();
  if (on) { scrollTo(0, 0); showModel(); renderAll(); }
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
    asked = '';
    $('card').hidden = true; $('chips').textContent = ''; $('qaTime').textContent = '';
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

// 두 번째 탭이나 입력칸 Enter: e5 + 음절 비교로 판정
async function judge(text) {
  if (!pack) return;
  const t = performance.now();
  asked = text;
  let qv = null;
  try { if (pipe && V) qv = await embed(pipe, [text]); } catch (e) { modelBroke(e); }
  const top = rank(pack, qsents, text, qv, V).slice(0, 3);
  chips(top, text, true);
  $('qaTime').textContent = `판정 ${Math.round(performance.now() - t)}ms · ${qv ? 'e5 + 음절 비교' : '간단 비교'}`;
  $('live').textContent = '';
  if (top[0]?.score >= AUTO_T1) openCard(top[0].q, top, text);
}

function chip(label, fn, cls = '') {
  const b = document.createElement('button');
  b.className = 'chip ' + cls;
  b.textContent = label;
  b.onclick = fn;
  return b;
}

function chips(top, text, final) {
  const box = $('chips');
  box.textContent = '';
  for (const r of top) box.append(chip(r.q.q, () => openCard(r.q, top, text)));
  if (final) box.append(chip('해당 없음', () => { box.textContent = ''; $('all').open = true; $('all').scrollIntoView(); }, 'none'));
}

// 카드는 다음 '질문'을 누를 때까지 저절로 바뀌지 않는다
function openCard(q, top = [], text = '') {
  qSeg = null; askBtn();
  $('chips').textContent = ''; $('live').textContent = '';
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
  const more = $('cardMore');
  more.textContent = '';
  for (const r of top) if (r.q !== q) more.append(chip(r.q.q, () => openCard(r.q, top, text)));
  $('card').hidden = false;
}

// 마지막 수단: 검색칸이 달린 전체 질문 목록
function renderAll() {
  const f = norm($('allQ').value), box = $('allList');
  box.textContent = '';
  for (const q of pack?.questions || [])
    if (!f || norm([q.q, ...q.alts].join(' ')).includes(f))
      box.append(chip(q.q, () => { $('all').open = false; openCard(q, [], asked); }));
}
$('allQ').oninput = renderAll;

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

function info() {
  return {
    topic: $('topic').value.trim(),
    audience: $('audience').value.trim(),
    n: Math.max(1, Math.min(40, Math.round(+$('count').value) || 20)),
    script: $('text').value.normalize('NFC').trim(),
  };
}
try {
  const i = JSON.parse(store.get('ls.qaInfo')) || {};
  $('topic').value = i.topic || ''; $('audience').value = i.audience || ''; $('count').value = i.n || 20;
} catch {}
for (const id of ['topic', 'audience', 'count'])
  $(id).onchange = () => { const { topic, audience, n } = info(); store.set('ls.qaInfo', JSON.stringify({ topic, audience, n })); };

function field(tag, label, value, set) {
  const l = document.createElement('label');
  const el = document.createElement(tag);
  l.className = 'small';
  l.append(label, el);
  el.value = value;
  if (tag === 'textarea') el.rows = Math.min(8, Math.max(2, value.split('\n').length));
  el.oninput = () => set(el.value);
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
    cb.onchange = () => { it.check = cb.checked; d.classList.toggle('check', cb.checked); };
    chk.append(cb, ' 직접 확인');
    const del = chip('삭제', () => { draft.splice(i, 1); renderDraft(); });
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
}

function showKey() {
  const k = keyStore.get();
  $('gen').hidden = !k;
  $('keyHint').hidden = !!k;
  $('keyState').textContent = !k ? '저장된 키가 없어요.' : keyStore.remembered() ? '이 기기에 저장된 키가 있어요.' : '이 탭에만 저장된 키가 있어요.';
}

$('prepBtn').onclick = () => {
  if (!draft.length && pack) draft = copyQs(pack.questions);
  renderDraft(); showKey(); showModel();
  $('prep').showModal();
};
$('closePrep').onclick = () => $('prep').close();

$('gen').onclick = async () => {
  if (genCtl) return genCtl.abort();
  const inf = info();
  if (!inf.script) return prepMsg('먼저 대본을 붙여넣으세요.');
  genCtl = new AbortController();
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
  }
};

$('copyPrompt').onclick = async () => {
  const inf = info();
  if (!inf.script) return prepMsg('먼저 대본을 붙여넣으세요.');
  const out = $('promptOut');
  out.value = qaPrompt(inf).text;
  out.hidden = false;
  try {
    await navigator.clipboard.writeText(out.value);
    prepMsg("프롬프트를 복사했어요. claude.ai 같은 챗봇에 붙여넣고, 받은 JSON을 '결과 붙여넣기'에 넣으세요.");
  } catch {
    out.select();
    prepMsg('자동 복사가 안 돼요. 위 칸의 글을 직접 복사하세요.');
  }
};
$('pasteBtn').onclick = () => { $('pasteBox').hidden = false; $('pasteIn').focus(); };
$('pasteApply').onclick = () => {
  try {
    setDraft(parsePack($('pasteIn').value), '붙여넣은');
    $('pasteIn').value = '';
    $('pasteBox').hidden = true;
  } catch (e) { prepMsg('적용하지 못했어요. ' + e.message); }
};

$('addQ').onclick = () => {
  draft.push({ id: '', q: '', alts: [], answer: [], source: '', check: false });
  renderDraft();
  $('qList').lastElementChild.querySelector('input').focus();
};

$('savePack').onclick = async () => {
  const items = draft.filter(it => it.q.trim());
  if (!items.length) {
    store.del('ls.pack'); store.del('ls.vec');
    setPack(null); draft = []; renderDraft(); showModel();
    return prepMsg('질문을 모두 지웠어요.');
  }
  let p;
  try { p = cleanPack({ questions: items }); } catch (e) { return prepMsg(e.message); }
  const s = JSON.stringify(p);
  const saved = store.set('ls.pack', s) || (store.del('ls.vec'), store.set('ls.pack', s));  // 가득 찼으면 벡터를 비우고 한 번 더
  setPack(p);
  draft = copyQs(p.questions);
  renderDraft();
  const done = saved ? `저장했어요. 질문 ${p.questions.length}개`
    : `이 기기에 저장하지 못했어요. 지금 화면에서만 쓸 수 있으니 내보내기로 파일에 저장해 두세요. 질문 ${p.questions.length}개`;
  prepMsg(done);
  // 모델이 이 기기에 있으면 지금 벡터를 계산해 둔다 (휴대폰에서 15~30초)
  if (pipe || (modelState === 'off' && await modelCached())) {
    await loadJudge(() => {});
    await vectors((i, n) => prepMsg(`${done}. 판정 준비 중 ${i}/${n}`));
    if (pack === p) prepMsg(V ? `${done}. 판정 준비도 끝났어요.` : done);  // 그사이 다시 저장했으면 그쪽이 알린다
  }
  showModel();
};

$('exportPack').onclick = () => {
  let p;
  try { p = cleanPack({ questions: draft }); } catch (e) { return prepMsg('내보낼 질문이 없어요.'); }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' }));
  a.download = 'qa-pack.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
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
const openKey = () => { $('keyIn').value = ''; $('keyRemember').checked = keyStore.remembered(); showKey(); $('keyDlg').showModal(); };
$('keyBtn').onclick = openKey;
$('keyBtn2').onclick = openKey;
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

if (!SR) { $('mic').disabled = true; say(NO_SR); }
fontSize(0);
$('text').value = store.get('ls.script') || '';
showKey();
setMode(!$('text').value.trim());
