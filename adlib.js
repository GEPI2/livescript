// 애드리브 모으기. 발표자가 대본을 따라 읽다가 대본에 없는 말을 이어 가면 그 말을 따로 모은다. node adlib.js 로 확인한다.
// app.js가 인식 결과를 넣고(heard, end), 커서가 움직일 때마다 모으던 구간을 닫거나 나눌 자리를 적고 새로 연다(voice, anchor, close 다음에 open).
// 구간은 '대본이 마지막으로 맞은 뒤 들은 말'이다. 그래서 '대본 밖' 표시(3초)가 뜨기 전 첫마디도 들어간다.
import { sentSpans } from './lib.js?v=9';

export const MIN = 10;  // ponytail: 정규화 10음절(약 2초)보다 짧으면 버린다. 군말이나 대본을 맞추다 남은 조각이 대부분이다. 실제 기록으로 다시 맞춘다.
export const MAX = 50, RAW = 2000;  // 발표 하나에 최근 50개, 하나에 2000자까지 저장한다
export const CTX = 400;  // 앞뒤 문장은 400자까지 둔다. 잘린 앞 문장은 insertAfter가 앞부분으로 찾는다.

// 군말: 홀로 쓴 어, 음, 그, 저, 저기, 이제, 뭐 (어어, 음음처럼 늘인 것과 뒤 쉼표·마침표 포함). 원문(raw)은 따로 둔다.
const FILLER = /^(어+|음+|으음|그|저|저기|이제|뭐)[,.…~!?]*$/;
export const clean = t => String(t).split(/\s+/).filter(w => w && !FILLER.test(w)).join(' ');

// t에서 p와 두 글자가 겹치는 글자 수 (바꿔 읽은 말은 대본과 낱말이 겹친다)
function shared(t, p) {
  const B = new Set();
  for (let i = 1; i < p.length; i++) B.add(p.slice(i - 1, i + 1));
  let n = 0;
  for (let i = 0; i < t.length; i++) n += B.has(t.slice(i - 1, i + 1)) || B.has(t.slice(i, i + 2));
  return n;
}

// s 끝에서 정규화 n음절 앞의 어절 경계 (n은 이동 하나에 100음절 안쪽이라 끝 400자만 본다). 어절 가운데에 걸리면 out일 때 그 어절 앞, 아니면 뒤.
export function back(s, n, len, out = true) {
  const o = Math.max(0, s.length - 400);
  let b = s.length, got = 0;
  for (const m of [...s.slice(o).matchAll(/\S+\s*/g)].reverse()) {
    if (got >= n || ((got += len(m[0])) > n && !out)) break;
    b = o + m.index;
  }
  return b;
}
// s의 a에서 정규화 n음절 뒤의 어절 경계. 어절 가운데에 걸리면 그 어절 앞.
function fwd(s, a, n, len) {
  for (const m of s.slice(a).matchAll(/\s*\S+/g)) {
    if ((n -= len(m[0])) < 0) break;
    a += m[0].length;
  }
  return a;
}

// 대본 a와 들은 말 b(음절 배열)를 앞에서부터 맞춰 [b에서 쓴 음절 수, a에서 쓴 음절 수]. 같으면 +1, 다르거나 빠지면 -2로 세어
// 점수가 가장 높은 데서 끊는다. 대본이 끝나고 애드리브로 들어가면 점수가 떨어지고, -2라서 애드리브를 건너 먼 대본까지 잇지 않는다.
function align(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => -2 * j), best = 0, out = [0, 0];
  for (let i = 1; i <= a.length; i++) {
    const row = [-2 * i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.max(prev[j - 1] + (a[i - 1] === b[j - 1] ? 1 : -2), prev[j] - 2, row[j - 1] - 2);
      if (row[j] > best) { best = row[j]; out = [j, i]; }
    }
    prev = row;
  }
  return out;
}

// 중간 결과가 확정되며 글자 수가 조금 바뀌면(띄어쓰기, 쉼표) 위치가 어절 가운데로 갈 수 있다. 가까운 어절 경계로 옮긴다.
// 같은 거리면 구간을 넓히는 쪽(시작 early는 앞, 끝은 뒤)
function snap(s, i, early) {
  if (i <= 0 || i >= s.length || !/\S/.test(s[i - 1]) || !/\S/.test(s[i])) return i;
  let l = i, r = i;
  while (l > 0 && /\S/.test(s[l - 1])) l--;
  while (r < s.length && /\S/.test(s[r])) r++;
  return i - l < r - i || (i - l === r - i && early) ? l : r;
}

// 인식 결과를 이어 붙인 글(테이프)에서 구간을 잡는다. 위치는 테이프 처음부터 센 글자 수다.
// 지난 인식 세션의 글은 굳혀 두고(old), 이번 세션은 결과 목록을 그대로 이어 붙인다(now, 그중 확정된 앞부분 길이 fin).
// 닫은 구간은 끝까지 확정 결과가 온 뒤에 글을 정한다. 세션이 확정 없이 끝나면 마지막 중간 결과를 쓴다.
// norm: 정규화(app.js는 match.js norm), onSeg({ info, at, end, raw, text }): MIN을 넘은 구간 (at, end는 clock 시각)
// ponytail: 테이프는 페이지를 새로 열 때까지 자란다(말 1시간에 약 5만 자).
// 키워드 이동(anchor)은 혼자서 구간을 닫지 않는다. 애드리브에 다음 문장의 키워드 두 개가 섞여도 커서가 옮겨 가기 때문이다.
// 나눌 자리만 적어 두고(tent) 다음 일로 정한다. 키워드 뒤에 대본 밖 말이 MIN 넘게 이어졌으면 없던 일로 하고(앞 구간이 처음 시작, 시각, 자리 그대로 이어진다)
// 아니면 나눈다. 키워드로 또 옮기면 두 키워드 사이의 말에서 커서가 간 만큼은 바꿔 읽은 대본으로 본다.
// 목소리가 맞으면 키워드 뒤 구간에서 대본을 빼고 남는 말로 잰다. 정지·손으로 옮김·질의응답이면 키워드 뒤에 한 말 전부로 잰다.
export function collector(onSeg, norm, clock = Date.now) {
  let old = '', now = '', fin = 0, open = null, closing = [], tent = null;
  const tape = () => old + now, pos = () => old.length + now.length, len = t => norm(t).length;
  const size = (a, b) => len(clean(tape().slice(a, b)));  // 군말을 뺀 음절 수
  function emit(c) {
    const s = tape(), b = snap(s, Math.min(c.b ?? s.length, s.length), false);
    const a = snap(s, c.a, true);
    const raw = s.slice(a, b).replace(/\s+/g, ' ').replace(/^[\s,.?!…]+/, '').trim().slice(0, RAW), text = clean(raw);
    if (len(text) >= MIN) onSeg({ info: c.info, at: c.at, end: c.end, raw, text });
  }
  // all: 세션이 끝났으면 모두. 아니면 끝까지 확정된 구간만 (끝이 null이면 세션이 끝날 때까지 기다린다)
  const flush = all => { closing = closing.filter(c => (!all && (c.b ?? Infinity) > old.length + fin) || (emit(c), false)); };
  // a: 구간 시작, out: 끝이 어절 가운데에 걸리면 그 어절도 뺀다
  function close(trim, a = open?.a, out = true) {
    if (!open) return;
    const b = trim == null ? null : back(tape(), trim, len, out);
    if (open.at && (b == null || b > a)) closing.push({ info: open.info, a, b, at: open.at, end: clock() });
    open = null;
    flush(false);
  }
  // 키워드로 나눈 것을 정한다. keep: 나눈다(앞 구간은 나눌 자리에서 닫는다), 아니면 없던 일(키워드 뒤에 연 구간을 버리고 앞 구간을 잇는다)
  function settle(keep) {
    const t = tent;
    tent = null;
    if (!t) return;
    if (!keep) open = t.o;
    else if (t.o.at && t.b > t.o.a) closing.push({ info: t.o.info, a: t.o.a, b: t.b, at: t.o.at, end: t.end });
  }
  // 목소리로 맞았을 때 구간 o에서 뺄 것: { a: 새 시작(앞에 대본이 끼었으면 그 뒤), trim: 끝에서 뺄 음절 수 }. voice의 설명 참고
  function cut(o, p, far, lead) {
    const s = tape(), g = norm(s.slice(o.a));
    let [m, i] = align([...p].reverse(), [...g.slice(Math.max(0, g.length - lead - p.length - 10), g.length - lead)].reverse());
    const m2 = Math.max(0, len(s.slice(back(s, lead + m, len, false))) - lead);  // 어절 가운데면 그 어절은 애드리브 쪽
    i = Math.max(0, i - (m - m2)); m = m2;
    const [h, k] = align([...p.slice(0, p.length - i)], [...g.slice(0, g.length - lead - m)]);
    return { a: fwd(s, o.a, h, len), trim: lead + m + (far ? 0 : Math.min(p.length - i - k, g.length - lead - m - h)) };
  }
  return {
    // rs: 이번 세션의 결과 목록 [{ t: 글, final }] (크롬처럼 확정된 결과가 앞에 온다)
    heard(rs) {
      now = rs.map(r => r.t).join(' ');
      const k = rs.findIndex(r => !r.final);
      fin = k < 0 ? now.length : rs.slice(0, k).map(r => r.t).join(' ').length;
      if (open && !open.at && pos() > open.a) open.at = clock();  // 연 뒤 처음 들은 때 (말을 시작한 때)
      flush(false);
    },
    // 세션이 끝남 (onend, 또는 세션 안에서 결과 목록이 새로 시작됨)
    end() { old += now + ' '; now = ''; fin = 0; flush(true); },
    // 대본이 맞은 자리부터 모은다. info: 그 자리 { cur, s, snip, prev, next }, lead: 끝에서 이미 들어온 애드리브 음절 수(voice의 반환값)
    // tent가 있으면 키워드로 옮긴 직후다(anch). 그 자리는 어림이라 대본을 어디서부터 다시 읽었는지 모른다.
    open(info, lead = 0) { const a = back(tape(), lead, len); open = { info, a, at: a < pos() ? clock() : 0, anch: !!tent }; },
    // 닫는다(손으로 옮김, 질의응답, 정지). trim: 끝에서 뺄 음절 수, null: 이번 세션이 끝날 때의 끝에서(정지)
    close(trim) {
      if (tent) settle(size(tent.p, trim == null ? undefined : back(tape(), trim, len)) < MIN);
      close(trim);
    },
    // 키워드로 옮겼다: 끝에서 trim음절(바꿔 읽은 대본으로 본 것) 앞을 나눌 자리로 적어 둔다. 커서가 from에서 to로 간다. 그다음 open()으로 새 구간을 연다.
    // tent.from: 없던 일이 되면 커서가 있던 자리. 앞 구간도 키워드로 연 것이면 모른다(-1e9, voice에서 먼 이동으로 본다).
    anchor(trim, from, to) {
      if (tent) {  // 키워드로 잇달아 옮겼다
        const more = size(tent.p) - (to - from) >= MIN;  // 첫 키워드 뒤에 커서가 간 것보다 MIN 넘게 더 말했다: 애드리브가 이어졌다
        if (more) from = tent.from;
        settle(!more);
      }
      if (open) tent = { o: open, b: back(tape(), trim, len), p: pos(), end: clock(), from: open.anch ? -1e9 : from };
      open = null;
      flush(false);
    },
    // 목소리로 대본이 맞아 닫는다. sc: 정규화한 대본, 커서가 from에서 to로 간다. 커서가 지나온 대본(p)은 from~to이고,
    // 뒤로 가거나 확인을 거쳐 먼 위치(follow의 30글자 밖)로 옮겼으면(far) 어디서부터 다시 읽었는지 모르므로 새 위치 앞 60글자(follow가 뒤로 찾는 범위)다.
    // 모은 말(g)을 p와 끝에서부터 맞춰 애드리브 뒤에 다시 읽은 대본을 빼고, 앞에서부터 맞춰 커서가 늦게 따라와 애드리브 전에 읽은
    // 대본(한 결과에 대본 끝과 애드리브 첫마디가 같이 온 경우)을 뺀다. 가까운 이동이면 둘 다 맞지 않은 가운데 대본은 바꿔 읽은 것으로 보고
    // 그만큼 끝에서 더 뺀다(커서가 간 만큼 말했다). 끝과 앞이 어절 가운데에 걸리면 그 어절은 애드리브에 둔다
    // (어미만 우연히 같을 때: 애드리브 '…나아집니다'와 대본 '…배진혁입니다').
    // 반환 lead: 끝에서 대본 뒤에 이미 들어온 다음 애드리브의 음절 수(locate는 3음절까지 붙어도 맞춘다). open(info, lead)에 넘긴다.
    // 키워드로 나눈 뒤 처음 맞은 목소리면 나눌지 정한다(위 collector 설명). 키워드 뒤 구간에서 대본을 빼고 남는 말(left)로 잰다.
    // 키워드 자리에서 30글자 넘게 앞으로 갔으면 그사이 말은 건너뛴 대본을 바꿔 읽은 것일 수 있어 나눈다. 다만 키워드로 옮기기 전 자리(tent.from)에서도
    // 30글자 넘게 갔는데(키워드 문장을 건너뛰고 다음 문장을 읽음, skip) 거기서 먼 이동으로 재어 남는 말 중 건너뛴 대본과 겹치지 않는 것이 MIN 넘으면 없던 일이다.
    // 바꿔 읽은 말은 대본과 낱말이 겹친다. 키워드로 잇달아 옮겼으면(tent.from이 -1e9) 바꿔 읽는 중이므로 보지 않는다.
    // 없던 일이면 커서는 tent.from에서 온 것으로 보고 p를 다시 잡는다(키워드가 앞지른 만큼 다시 읽은 대본도 뺀다).
    voice(sc, from, to) {
      const s = tape(), far = f => to < f || to - f > 30, pass = f => sc.slice(far(f) ? Math.max(to > f ? f : 0, to - 60, 0) : f, to);
      const g = norm(s.slice(open ? open.a : Math.max(0, s.length - 400))), lead = [0, 1, 2, 3].find(k => g[g.length - 1 - k] === sc[to - 1]) ?? 0;
      if (tent) {
        const left = f => { const c = cut(open, pass(f), far(f), lead); return norm(clean(s.slice(c.a, back(s, c.trim, len, false)))); };
        const skip = !!open && tent.from >= 0 && to - tent.from > 30 && (t => t.length - shared(t, sc.slice(from, to)))(left(tent.from)) >= MIN;
        const keep = !!open && (to - from > 30 || left(from).length < MIN) && !skip;
        if (!keep) from = tent.from;
        settle(keep);
      }
      if (!open) return lead;
      const c = cut(open, pass(from), far(from), lead);
      close(c.trim, c.a, false);
      return lead;
    },
    // 새 발표: 모으던 것과 확정을 기다리던 것을 버린다
    reset() { open = null; closing = []; tent = null; },
  };
}

// AI 정리 한 개 { title, points: 1~3줄, worth: 대본에 넣을 만함, add: 넣을 문장 0~2개 }. AI 답과 저장된 값을 모두 이걸로 거른다.
export function cleanAi(x) {
  if (!x || typeof x !== 'object') return null;
  const line = (s, n) => typeof s === 'string' ? s.normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, n) : '';
  const list = (v, k, n) => [...new Set((Array.isArray(v) ? v : []).map(s => line(s, n)).filter(Boolean))].slice(0, k);
  const title = line(x.title, 40), points = list(x.points, 3, 200), worth = x.worth === true, add = worth ? list(x.add, 2, 300) : [];
  return title || points.length ? { title, points, worth, add } : null;
}

// 저장해 둔 애드리브 (localStorage 값은 믿지 않는다: 모양을 맞추고 길이를 자른다)
// [{ id, t, e: 시작·끝(발표 시작부터 ms), cur, s: 앞 문장 번호(원문 기준, -1이면 발표 처음), snip: 그 자리 앞 말, prev, next: 앞뒤 문장(CTX자까지), raw, text, ai }]
export function readSegs(json) {
  let v;
  try { v = JSON.parse(json); } catch { return []; }
  const str = (x, n) => typeof x === 'string' ? x.slice(0, n) : '';
  const num = x => Number.isFinite(x) && x >= 0 ? x : 0;
  return (Array.isArray(v) ? v : []).filter(g => typeof g?.text === 'string' && g.text.trim()).slice(-MAX).map(g => ({
    id: Number.isInteger(g.id) ? g.id : 0, t: num(g.t), e: num(g.e), cur: num(g.cur), s: Number.isInteger(g.s) ? g.s : -1,
    snip: str(g.snip, 60), prev: str(g.prev, CTX), next: str(g.next, CTX), raw: str(g.raw, RAW), text: str(g.text, RAW),
    ai: cleanAi(g.ai),
  }));
}

const mmss = ms => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
export const where = g => g.s < 0 ? '발표 처음' : `'…${g.snip}' 다음`;
export const head = g => `#${g.id} · ${mmss(g.t)} · ${where(g)}`;
export const addText = g => g.ai?.add.length ? g.ai.add.join(' ') : g.text;  // 대본에 넣을 글: AI가 쓴 문장, 없으면 들은 말

// '복사'로 내보내는 글 (오래된 것부터)
export function summary(segs) {
  const out = [`애드리브 ${segs.length}개`];
  for (const g of segs) {
    out.push('', head(g), g.text);
    if (!g.ai) continue;
    if (g.ai.title) out.push('정리: ' + g.ai.title);
    out.push(...g.ai.points.map(p => '- ' + p));
    out.push(g.ai.worth ? '대본에 넣을 만함' + (g.ai.add.length ? ': ' + g.ai.add.join(' ') : '') : '대본에 넣지 않아도 됨');
  }
  return out.join('\n');
}

// 대본에 넣는다: 문장 prev 바로 뒤, 같은 문단 안에. prev가 ''이면(발표 처음) 맨 앞에.
// 같은 문장이 여러 번 나오면 원문 문장 번호 hint에 가까운 것. 못 찾으면(그사이 대본을 고쳤으면) null.
// prev가 CTX자로 잘렸으면 그 글로 시작하는 문장을 찾는다.
export function insertAfter(text, prev, add, hint = 0) {
  add = add.replace(/\s+/g, ' ').trim();
  if (!add) return null;
  if (!/[.?!…。]["'”’)\]]*$/.test(add)) add += '.';  // 들은 말에는 마침표가 없다. 없으면 다음 문장과 한 문장으로 붙는다.
  if (!prev.trim()) return add + ' ' + text;
  const key = x => x.replace(/\s+/g, ' ').trim(), k = key(prev), sp = sentSpans(text).flat();
  const same = t => prev.length >= CTX ? t.startsWith(k) : t === k;
  let best = -1;
  sp.forEach(([a, b], i) => { if (same(key(text.slice(a, b))) && (best < 0 || Math.abs(i - hint) < Math.abs(best - hint))) best = i; });
  if (best < 0) return null;
  const b = sp[best][1];
  return text.slice(0, b) + ' ' + add + text.slice(b);
}

// node adlib.js 로 실행하면 확인
if (import.meta.main ?? (typeof process === 'object' && process.argv[1]?.endsWith('adlib.js'))) {
  const assert = (await import('node:assert')).default;
  // 실제 정규화(match.js norm)로 센다 (shrink.js 확인과 같은 방법)
  const { readFileSync } = await import('node:fs');
  (await import('node:vm')).runInThisContext(readFileSync(new URL('./match.js', import.meta.url), 'utf8'));
  const len = t => norm(t).length;

  assert.equal(clean('음 그러니까 어 제가 작년에 저기 발표를 하다가, 뭐 대본을 음... 놓쳤어요 어어'), '그러니까 제가 작년에 발표를 하다가, 대본을 놓쳤어요');
  assert.equal(clean('음, 어 그 저 저기 이제 뭐'), '', '군말만');
  assert.equal(clean('이제부터 그것이 저의 음악'), '이제부터 그것이 저의 음악', '군말로 시작하는 낱말은 둔다');

  // 흉내 낸 인식: app.js처럼 결과마다 heard, 커서가 움직이면 close(뺄 음절) 후 open
  let t = 0;
  const got = [], C = collector(g => got.push(g), norm, () => ++t);
  const info = n => ({ cur: n, s: n, snip: '', prev: '', next: '' });
  const R = (...xs) => xs.map(x => typeof x === 'string' ? { t: x, final: true } : { t: x[0], final: false });  // ['글']은 중간 결과

  // 1. 그대로 읽기: 맞을 때마다 들은 만큼 빼면 남는 것이 없다
  C.open(info(0));
  C.heard(R(['오늘은 라이브']));
  C.close(len('오늘은 라이브')); C.open(info(5));
  C.heard(R(['오늘은 라이브스크립트를 소개하겠습니다']));
  C.close(len('스크립트를 소개하겠습니다')); C.open(info(17));
  C.heard(R('오늘은 라이브스크립트를 소개하겠습니다'));
  assert.equal(got.length, 0, '대본만 읽으면 애드리브가 없다');

  // 2. 문장 가운데 애드리브: 중간 결과로 닫고, 확정 결과가 온 뒤 확정 글로 정한다. 다시 읽기 시작한 대본(발표할 때 대본을)은 뺀다.
  C.heard(R('오늘은 라이브스크립트를 소개하겠습니다', ['음 제가 작년에 발표하다가 대본을 노쳐서']));
  C.heard(R('오늘은 라이브스크립트를 소개하겠습니다', ['음 제가 작년에 발표하다가 대본을 놓쳐서 정말 당황 했거든요 그래서 발표할 때 대본을']));
  C.close(len('발표할 때 대본을')); C.open(info(25));
  assert.equal(got.length, 0, '확정 결과를 기다린다');
  C.heard(R('오늘은 라이브스크립트를 소개하겠습니다', '음 제가 작년에 발표하다가 대본을 놓쳐서 정말 당황했거든요 그래서 발표할 때 대본을', ['놓치지']));
  assert.equal(got.length, 1);
  assert.equal(got[0].raw, '음 제가 작년에 발표하다가 대본을 놓쳐서 정말 당황했거든요 그래서', '확정 글. 띄어쓰기가 줄어 끝이 어절 가운데로 가면 가까운 경계');
  assert.equal(got[0].text, '제가 작년에 발표하다가 대본을 놓쳐서 정말 당황했거든요 그래서');
  assert.deepEqual(got[0].info, info(17));
  assert.ok(got[0].at < got[0].end);

  // 3. 군말만 하다가 다시 읽으면 버린다
  C.heard(R('오늘은 라이브스크립트를 소개하겠습니다', '음 제가 작년에 발표하다가 대본을 놓쳐서 정말 당황했거든요 그래서 발표할 때 대본을', '놓치지 음 어 그 저기 이제 뭐 음 어 그 저기 이제 뭐 않게'));
  C.close(len('않게')); C.open(info(30));
  assert.equal(got.length, 1, '군말만 남으면 버린다');

  // 4. 세션이 바뀌어도 이어 모으고, 정지하면 세션 끝의 글까지 (확정 없이 끝나면 마지막 중간 결과)
  C.end();
  C.heard(R(['여기서 잠깐 질문을 하나 드리면']));
  C.end();
  C.heard(R('여러분은 발표하다가', ['대본을 놓친 적 있으신가요']));
  C.close(null);
  assert.equal(got.length, 1, '정지하면 세션이 끝날 때까지 기다린다');
  C.end();
  assert.equal(got[1].text, '여기서 잠깐 질문을 하나 드리면 여러분은 발표하다가 대본을 놓친 적 있으신가요', '두 세션에 걸친 말, 마지막 중간 결과까지');

  // 5. 아무 말도 없이 닫거나, 새 발표가 되면 버린다
  C.open(info(40));
  C.close(0); C.open(info(41));
  C.heard(R('지금부터 하는 말은 새 발표에서 버려지는 말입니다'));
  C.close(null); C.reset(); C.end();
  assert.equal(got.length, 2, 'reset 뒤에는 나오지 않는다');

  // 6. 목소리로 맞아 닫기(voice): 커서가 지나온 대본 p와 맞춰 앞뒤의 대본을 뺀다. 한 결과에 여러 어절씩 온다.
  // 단계마다 [들은 말, 커서 from, to, 키워드 이동이면 trim]. from, to는 대본 sc의 앞부분(글)이나 위치. 반환 [구간 글, lead, 구간 자리]
  const V = (sc, steps) => {
    const g3 = [], C3 = collector(g => g3.push(g), norm), at = t => typeof t === 'number' ? t : len(t);
    let lead = 0;
    C3.open(info(0));
    for (const [h, a, b, trim] of steps) {
      C3.heard(R([h]));
      if (trim != null) { C3.anchor(trim, at(a), at(b)); C3.open(info(at(b))); }
      else if (b != null) C3.open(info(at(b)), lead = C3.voice(norm(sc), at(a), at(b)));
    }
    C3.close(null); C3.end();
    return [g3.map(g => g.text), lead, g3.map(g => g.info.cur)];
  };
  const S0 = '안녕하세요 오늘 발표를 맡은 배진혁입니다.', S1 = S0 + ' 저희 팀은 지난 3개월';
  // 대본 끝과 애드리브 첫마디가 한 결과로: locate는 '혹시'를 붙인 채 문장 끝으로 옮긴다. '혹시'는 다음 애드리브에 넣는다.
  assert.deepEqual(V(S1, [[S0 + ' 혹시', '', S0], [S0 + ' 혹시 뒤에 계신 분들 소리 잘 들리시나요 저희 팀은 지난 3개월', S0, S1]]).slice(0, 2),
    [['혹시 뒤에 계신 분들 소리 잘 들리시나요'], 0], '첫마디를 잃지 않는다');
  assert.equal(V(S1, [[S0 + ' 혹시', '', S0]])[1], 2, 'lead');
  // 커서가 늦게 따라옴: 대본 끝(맡은 배진혁입니다)이 애드리브와 한 결과로 와서 커서가 '발표를'에 남았다. 앞의 대본도 빼고,
  // 애드리브 끝 '나아집니다'와 대본 '배진혁입니다'의 '니다'가 우연히 같아도 끝 어절을 잃지 않는다.
  assert.deepEqual(V(S1, [['안녕하세요 오늘 발표를', '', '안녕하세요 오늘 발표를'],
    [S0 + ' 시끄러운 곳에서는 마이크를 가까이 대면 조금 나아집니다 저희 팀은 지난 3개월', '안녕하세요 오늘 발표를', S1]])[0],
  ['시끄러운 곳에서는 마이크를 가까이 대면 조금 나아집니다'], '늦게 따라온 커서');
  // 바꿔 읽기: 끝만 같고 가운데는 다르게 말했으면 커서가 간 만큼 말한 것으로 보고 뺀다(애드리브가 아니다)
  const SV = '대학생 200명에게 설문을 해 보니 절반 이상이 발표 중에 대본을 놓친 경험이 있다고 답했습니다';
  assert.deepEqual(V(SV, [['반 넘는 사람이 발표하다 대본 놓쳐 봤다고 답했습니다', '대학생 200명에게 설문을 해 보니', SV]])[0], [], '바꿔 읽은 대본');
  // 다시 읽기(뒤로 먼 위치): 애드리브 뒤에 앞 문장을 다시 읽었다. 다시 읽은 만큼만 빼고 애드리브 끝은 남긴다.
  assert.deepEqual(V(S1, [[S0, '', S0], [S0 + ' 사실 이 기능은 팀원이 낸 아이디어인데요 오늘 발표를 맡은 배진혁입니다', S1, S0]])[0],
    ['사실 이 기능은 팀원이 낸 아이디어인데요'], '다시 읽기');

  // 7. 키워드 이동은 나눌 자리만 적어 둔다. 키워드 뒤 '이 앱은 대본 따라가요'(9음절)를 바꿔 읽은 대본으로 보고 나눌지는 다음 일로 정한다.
  const SK = '라이브스크립트는 발표 대본을 따라갑니다. 음성 인식으로 지금 읽는 곳을 찾습니다. 화면도 알아서 내려 줍니다.', SK2 = SK.slice(0, SK.lastIndexOf(' 화면'));
  const H1 = '제가 작년에 발표하다가 대본을 놓쳤어요 이 앱은 대본 따라가요', K1 = [H1, 0, 14, 9], MORE = ' 그래서 이런 걸 만들게 됐습니다';
  assert.deepEqual(V(SK, [K1, [H1 + ' 목소리를 글자로 바꿔서 위치를', 14, '라이브스크립트는 발표 대본을 따라갑니다. 음성 인식으로 지금', 9],
    [H1 + ' 목소리를 글자로 바꿔서 위치를 읽는 곳을 찾습니다', '라이브스크립트는 발표 대본을 따라갑니다. 음성 인식으로 지금', SK2]]),
  [['제가 작년에 발표하다가 대본을 놓쳤어요'], 0, [0]], '키워드로 잇달아 옮기면(바꿔 읽기) 나눈다');
  assert.deepEqual(V(SK, [K1, [H1 + ' 그렇죠']])[0], ['제가 작년에 발표하다가 대본을 놓쳤어요'], '정지: 뒤에 한 말이 짧으면 나눈다');
  assert.deepEqual(V(SK, [K1, [H1 + MORE]]), [[H1 + MORE], 0, [0]], '정지: 대본 밖 말이 이어지면 없던 일, 처음 자리 그대로');
  assert.deepEqual(V(SK, [K1, [H1 + MORE + ' 라이브스크립트는 발표', 14, '라이브스크립트는 발표']]), [[H1 + MORE], 0, [0]], '대본 밖 말이 이어지다 뒤로 맞으면 없던 일');
  assert.deepEqual(V(SK, [K1, [H1 + MORE + ' 화면도 알아서 내려 줍니다', 14, SK]]), [[H1 + MORE], 0, [0]], '키워드 문장을 건너뛰고 다음 문장을 읽어도 대본 밖 말이 이어졌으면 없던 일');
  assert.deepEqual(V(SK, [K1, [H1 + ' 그렇죠 화면도 알아서 내려 줍니다', 14, SK]])[0], ['제가 작년에 발표하다가 대본을 놓쳤어요'], '30글자 넘게 앞으로 맞고 키워드 뒤 말이 짧으면 나눈다');
  assert.deepEqual(V(SK, [K1, [H1 + MORE + ' 목소리를 글자로 바꿔서 위치를', 14, '라이브스크립트는 발표 대본을 따라갑니다. 음성 인식으로 지금', 9],
    [H1 + MORE + ' 목소리를 글자로 바꿔서 위치를 읽는 곳을 찾습니다', '라이브스크립트는 발표 대본을 따라갑니다. 음성 인식으로 지금', SK2]]),
  [[H1 + MORE + ' 목소리를'], 0, [0]], '키워드로 잇달아 옮겨도 그사이 커서가 간 것보다 MIN 넘게 더 말했으면 앞 구간을 잇는다');
  assert.deepEqual(V(SK, [K1, [H1 + ' 음성 인식으로 지금 어디 읽는지 찾아 주고요 화면도 알아서 내려 줍니다', 14, SK]])[0],
    ['제가 작년에 발표하다가 대본을 놓쳤어요', '음성 인식으로 지금 어디 읽는지 찾아 주고요'], '건너뛴 대본을 바꿔 읽은 말(글자가 겹친다)이면 나눈다');

  // 8. app.js와 같은 흐름(match.js follow, 크롬처럼 어절이 w개씩 늘어나는 중간 결과, 330ms 간격)으로 예시 대본을 읽는다. 반환 [[앞 문장 번호, 글]]
  // 실제 주소에서 본 경우를 그대로 시험하려고 그때의 예시 대본(477자)을 여기에 둔다. 지금 sample.livescript.json은 시연용으로 더 길다.
  const sample = { text: "안녕하세요. 오늘은 발표 대본을 따라가는 웹 서비스, 라이브스크립트를 소개하겠습니다. 발표하다 보면 대본에서 읽던 곳을 놓치기 쉽습니다. 대본을 소리 내어 읽으면 지금 읽는 곳을 표시하고 화면을 알아서 내려 줍니다.\n\n말소리는 브라우저의 음성 인식이 글자로 바꾸는데, 크롬은 구글 서버로, 사파리는 애플 서버로 보냅니다. 대본을 그대로 읽지 않아도 괜찮습니다. 어미를 바꾸거나 낱말을 건너뛰어도 하이라이트가 따라갑니다. 문장을 많이 바꿔 말하면 문장마다 뽑아 둔 키워드로 위치를 어림합니다.\n\n발표가 늦어지면 아직 읽지 않은 뒷부분을 줄여 줍니다. 발표 전에 AI가 문단마다 빼도 되는 문장을 골라 두면, 발표 중에는 덜 중요한 문장부터 숨깁니다. 새로 쓴 문장은 없어서 화면의 글은 모두 발표자가 쓴 원문입니다.\n\n질의응답도 돕습니다. 발표 전에 AI가 예상 질문과 답을 만들어 두고, 질문을 따라 말하면 그중 무엇인지 골라 답 카드를 띄웁니다. 질문 판정은 서버가 아니라 기기 안에서 도는 작은 AI 모델이 합니다.\n\n따로 설치할 앱 없이 휴대폰이나 PC 브라우저에서 주소만 열면 됩니다. 판정 모델은 무료 오픈소스이고, 처음 한 번 와이파이에서 받아 두면 됩니다.\n\nAI는 발표 전에는 준비를 돕고, 발표 중에는 기기 안에서 질문을 알아듣습니다. 들어 주셔서 감사합니다.",
    prep: { kw: {"하이라이트": ["강조 표시"], "피씨": ["컴퓨터", "노트북"], "와이파이": ["무선 인터넷"]} } };
  function talk(text, lines, w, kw = {}) {
    const S = normMap(text), words = [], segs = [], T = collector(g => segs.push(g), norm, () => t);
    let t = 0, cur = 0, pending = null, approx = null, heard = '', said = 0, lastAnchor = -1e9, k = 0, anchored = 0;
    for (const m of text.matchAll(/\S+/g)) {  // app.js build()처럼 . ? ! 뒤나 줄바꿈에서 새 문장
      words.push({ t: m[0], s: k, n0: len(text.slice(0, m.index)), n1: len(text.slice(0, m.index + m[0].length)) });
      if (/[.?!]$/.test(m[0]) || /^\s*\n/.test(text.slice(m.index + m[0].length))) k++;
    }
    const A = anchors(S.s, words, kw), info = () => ({ cur, s: words.findLast(x => x.n0 < cur)?.s ?? -1 });
    T.open(info());
    for (const line of lines) {
      const ws = line.split(' ');
      let cut = 0, sn = '';
      for (let i = Math.min(w, ws.length); ; i = Math.min(i + w, ws.length)) {
        t += 330;
        T.heard([{ t: ws.slice(0, i).join(' '), final: i === ws.length }]);
        const n0 = sn.length;
        sn = norm(ws.slice(0, i).join(' ')); said += Math.max(0, sn.length - n0);
        const f = follow(S, A, heard + sn.slice(cut), cur, pending, t - lastAnchor < 10000 ? approx : null);
        pending = f.pending;
        if (f.how === 'anchor') {
          T.anchor(Math.min(said, 20, Math.max(0, f.pos - cur)), cur, f.pos);
          heard = ''; cut = sn.length; said = 0; approx = f.sent; lastAnchor = t; cur = f.pos; anchored++;
          T.open(info());
        } else if (f.how === 'voice') {
          approx = null;
          if (f.pos !== cur) { const lead = T.voice(S.s, cur, f.pos); said = 0; cur = f.pos; T.open(info(), lead); }
        }
        if (i === ws.length) break;
      }
      heard = (heard + sn.slice(cut)).slice(-60);
      T.end();  // 줄마다 인식 세션 하나
    }
    T.close(null); T.end();
    return [segs.map(g => [g.info.s, g.text]), anchored];
  }
  const sents = sample.text.match(/[^.?!]+[.?!]/g).map(x => x.trim());
  // 실제 주소에서 본 경우: 13문장을 읽고, 다음 문장 키워드 두 개(판정, 모델)가 섞인 애드리브, 다음 문장. 키워드로 옮겨도 한 구간이고 13번째 문장 뒤
  const AD = '이 부분이 제일 중요한데요 판정 모델은 인터넷이 끊겨도 한 번 받아 두면 계속 쓸 수 있습니다';
  for (const w of [1, 2, 3]) {
    const [got, n] = talk(sample.text, [...sents.slice(0, 13), AD, sents[13]], w, sample.prep.kw);
    assert.ok(n > 0, '키워드로 옮기는 경우를 시험한다');
    assert.deepEqual(got, [[12, AD]], `키워드가 섞인 애드리브 w=${w}`);
  }
  // 애드리브 뒤에 다음 문장들을 바꿔 읽어 키워드로 또 옮겨도, 그사이 대본 밖 말이 길면 13번째 문장 뒤에서 애드리브 처음부터 (바꿔 읽은 말이 붙는 것은 어쩔 수 없다)
  const P13 = '어떤 질문인지 판정하는 건 서버 말고 기기 안의 작은 모델이 해요', P14 = '앱 설치 없이 휴대폰이나 피씨 브라우저로 주소만 열면 끝이에요';
  for (const w of [1, 2, 3]) {
    const [got] = talk(sample.text, [...sents.slice(0, 13), AD, P13, P14, sents[15]], w, sample.prep.kw);
    assert.ok(got.length === 1 && got[0][0] === 12 && got[0][1].startsWith(AD), `애드리브 뒤 바꿔 읽기 w=${w}: ${JSON.stringify(got)}`);
  }
  // 키워드 문장을 건너뛰고 그다음 문장을 읽어도 한 구간
  for (const w of [1, 2, 3]) assert.deepEqual(talk(sample.text, [...sents.slice(0, 13), AD, sents[14]], w, sample.prep.kw)[0], [[12, AD]], `건너뛰기 w=${w}`);
  // 키워드로 잇달아 옮긴 뒤 앞 문장으로 돌아와 읽어도 다시 읽은 대본은 애드리브에 넣지 않는다
  const AD2 = '이건 예상 질문 카드 기능인데요 판정 모델이 핵심이라 뒤에서 자세히 말씀드릴게요';
  for (const w of [1, 2, 3]) {
    const [got] = talk(sample.text, [...sents.slice(0, 12), AD2, ...sents.slice(12, 14)], w, sample.prep.kw);
    assert.ok(got.length === 1 && got[0][1].endsWith('말씀드릴게요'), `키워드 두 번 뒤 다시 읽기 w=${w}: ${JSON.stringify(got)}`);
  }
  // 많이 바꿔 읽기(키워드로만 옮겨 감)는 애드리브가 아니다
  const PARA = ['서버 말고 기기에서 판정해요', '설치 없이 휴대폰 브라우저로 열어요', '모델은 무료 오픈소스고 와이파이에서 받아요'];
  const PARA2 = [P14, '판정 모델은 공짜 오픈소스고 와이파이 될 때 한 번만 받아 두시면 돼요', '정리하면 에이아이는 발표 전엔 준비를 돕고 발표 중엔 기기에서 질문을 알아들어요'];
  for (const w of [1, 2, 3]) {
    const [got, n] = talk(sample.text, [...sents.slice(0, 13), ...PARA, ...sents.slice(16)], w, sample.prep.kw);
    assert.ok(n >= 2, '키워드로 잇달아 옮긴다');
    assert.deepEqual(got, [], `바꿔 읽기 w=${w}`);
    // ponytail: w=1이면 '공짜 오픈소스고 …'가 구간으로 남는다(이번 변경 전부터). 키워드 두 번 뒤의 목소리로 건너뛰기를 보지 않는 것은 w=2, 3이 확인한다.
    if (w > 1) assert.deepEqual(talk(sample.text, [...sents.slice(0, 14), ...PARA2, ...sents.slice(17)], w, sample.prep.kw)[0], [], `바꿔 읽기 2 w=${w}`);
  }

  // 9. 확정되며 앞 글자가 바뀌어도 시작은 어절 경계 (쉼표가 붙어 한 글자 밀림, 띄어쓰기가 빠져 한 글자 당겨짐)
  for (const [fin, want] of [['안녕하세요, 오늘은', '제가'], ['안녕하세요오늘은', '제가'], ['안녕 하세요 오늘 은', '은 제가']]) {
    const g2 = [], C2 = collector(g => g2.push(g), norm);
    C2.heard(R(['안녕하세요 오늘은']));
    C2.open(info(0));
    C2.heard(R(fin + ' 제가 준비한 이야기를 잠깐 먼저 하겠습니다'));
    C2.close(0); C2.end();
    assert.equal(g2[0].text, want + ' 준비한 이야기를 잠깐 먼저 하겠습니다', fin);
  }

  assert.equal(back('가나 다라마 바', 3, len), 3, '3음절 앞 어절 경계');
  assert.equal(back('가나 다라마 바', 0, len), 8);
  assert.equal(back('가나 다라마 바', 3, len, false), 7, '어절 가운데면 그 어절 뒤');

  // 대본에 넣기
  const T = '첫 문단입니다. 대본을 놓치지 않게 도와줍니다.\n\n둘째 문단입니다. 대본을 놓치지 않게 도와줍니다. 끝.';
  assert.equal(insertAfter(T, '첫 문단입니다.', '제가 작년에 놓쳤어요', 0), '첫 문단입니다. 제가 작년에 놓쳤어요. 대본을 놓치지 않게 도와줍니다.\n\n둘째 문단입니다. 대본을 놓치지 않게 도와줍니다. 끝.', '마침표를 붙여 문장 뒤에');
  assert.equal(insertAfter(T, '대본을  놓치지 않게\n도와줍니다.', '예를 들면 이렇습니다.', 3), '첫 문단입니다. 대본을 놓치지 않게 도와줍니다.\n\n둘째 문단입니다. 대본을 놓치지 않게 도와줍니다. 예를 들면 이렇습니다. 끝.', '같은 문장이 두 번이면 가까운 쪽, 공백은 무시');
  assert.equal(insertAfter(T, '대본을 놓치지 않게 도와줍니다.', '가.', 0).indexOf(' 가.'), T.indexOf('\n\n'), '문단 끝 문장 뒤는 같은 문단 안');
  assert.equal(insertAfter(T, '', '안녕하세요 반갑습니다', -1), '안녕하세요 반갑습니다. ' + T, '발표 처음');
  assert.equal(insertAfter(T, '없는 문장.', '가'), null);
  const L = '가'.repeat(CTX + 50) + '.';
  assert.equal(insertAfter(L + ' 끝.', L.slice(0, CTX), '넣은 말'), L + ' 넣은 말. 끝.', 'CTX자로 잘린 앞 문장은 앞부분으로 찾는다');
  assert.equal(insertAfter('첫 문단입니다 여기까지.', '첫 문단입니다', '가'), null, '잘리지 않은 앞 문장은 통째로 같아야');
  assert.equal(insertAfter(T, '첫 문단입니다.', '  '), null);

  // 저장값 검사와 복사 글
  const ai = cleanAi({ title: ' 작년 경험 ', points: ['대본을 놓친 적이 있다', '대본을 놓친 적이 있다', 3, '', 'b', 'c', 'd'], worth: true, add: ['저도 작년에 대본을 놓친 적이 있습니다.', 'x', 'y'] });
  assert.deepEqual(ai, { title: '작년 경험', points: ['대본을 놓친 적이 있다', 'b', 'c'], worth: true, add: ['저도 작년에 대본을 놓친 적이 있습니다.', 'x'] });
  assert.deepEqual(cleanAi({ title: '군말', points: [], worth: 'yes', add: ['넣지 마'] }), { title: '군말', points: [], worth: false, add: [] }, 'worth는 true일 때만');
  assert.equal(cleanAi({ title: 3, points: 'x' }), null);
  const segs = readSegs(JSON.stringify([{ id: 1, t: 42000, s: 0, snip: '첫 문단입니다.', prev: '첫 문단입니다.', raw: '음 제가', text: '제가 작년에', ai: { ...ai, extra: '<b>' } },
    { id: 2, t: -5, s: 'x', text: '  ' }, null, { id: 3.5, t: 61000, s: -1, text: '안녕하세요 반갑습니다', ins: 'yes', ai: { title: '' } }, { text: 'a'.repeat(3000) }]));
  assert.equal(segs.length, 3, '빈 글과 깨진 항목은 버린다');
  assert.deepEqual(segs[0].ai, ai, '모르는 칸은 버린다');
  assert.deepEqual([segs[1].id, segs[1].s, segs[1].ins, segs[1].ai, segs[2].text.length], [0, -1, undefined, null, RAW], '모르는 칸(ins)은 버린다');
  assert.deepEqual(readSegs('{깨짐'), []);
  assert.equal(readSegs(JSON.stringify(Array.from({ length: 60 }, (_, i) => ({ id: i, text: '말' })))).length, MAX);
  assert.equal(summary(segs.slice(0, 2)), [
    '애드리브 2개', '', "#1 · 0:42 · '…첫 문단입니다.' 다음", '제가 작년에', '정리: 작년 경험', '- 대본을 놓친 적이 있다', '- b', '- c',
    '대본에 넣을 만함: 저도 작년에 대본을 놓친 적이 있습니다. x', '', '#0 · 1:01 · 발표 처음', '안녕하세요 반갑습니다'].join('\n'));
  assert.equal(addText(segs[0]), '저도 작년에 대본을 놓친 적이 있습니다. x');
  assert.equal(addText(segs[1]), '안녕하세요 반갑습니다', 'AI 문장이 없으면 들은 말');
  console.log('adlib.js ok');
}
