// 애드리브 모으기. 발표자가 대본을 따라 읽다가 대본에 없는 말을 이어 가면 그 말을 따로 모은다. node adlib.js 로 확인한다.
// app.js가 인식 결과를 넣고(heard, end), 커서가 움직일 때마다 모으던 구간을 닫고 새로 연다(voice 또는 close, 그다음 open).
// 구간은 '대본이 마지막으로 맞은 뒤 들은 말'이다. 그래서 '대본 밖' 표시(3초)가 뜨기 전 첫마디도 들어간다.
import { sentSpans } from './lib.js?v=5';

export const MIN = 10;  // ponytail: 정규화 10음절(약 2초)보다 짧으면 버린다. 군말이나 대본을 맞추다 남은 조각이 대부분이다. 실제 기록으로 다시 맞춘다.
export const MAX = 50, RAW = 2000;  // 발표 하나에 최근 50개, 하나에 2000자까지 저장한다
export const CTX = 400;  // 앞뒤 문장은 400자까지 둔다. 잘린 앞 문장은 insertAfter가 앞부분으로 찾는다.

// 군말: 홀로 쓴 어, 음, 그, 저, 저기, 이제, 뭐 (어어, 음음처럼 늘인 것과 뒤 쉼표·마침표 포함). 원문(raw)은 따로 둔다.
const FILLER = /^(어+|음+|으음|그|저|저기|이제|뭐)[,.…~!?]*$/;
export const clean = t => String(t).split(/\s+/).filter(w => w && !FILLER.test(w)).join(' ');

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
export function collector(onSeg, norm, clock = Date.now) {
  let old = '', now = '', fin = 0, open = null, closing = [];
  const tape = () => old + now, pos = () => old.length + now.length, len = t => norm(t).length;
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
    open(info, lead = 0) { const a = back(tape(), lead, len); open = { info, a, at: a < pos() ? clock() : 0 }; },
    // 닫는다. trim: 끝에서 뺄 음절 수(키워드로 맞은 대본), null: 이번 세션이 끝날 때의 끝에서(정지)
    close: trim => close(trim),
    // 목소리로 대본이 맞아 닫는다. p: 커서가 방금 지나온 대본(정규화), far: 확인을 거쳐 먼 곳으로 옮겼음(p는 새 위치 앞 60글자 안).
    // 모은 말(g)을 p와 끝에서부터 맞춰 애드리브 뒤에 다시 읽은 대본을 빼고, 앞에서부터 맞춰 커서가 늦게 따라와 애드리브 전에 읽은
    // 대본(한 결과에 대본 끝과 애드리브 첫마디가 같이 온 경우)을 뺀다. 가까운 이동이면 둘 다 맞지 않은 가운데 대본은 바꿔 읽은 것으로 보고
    // 그만큼 끝에서 더 뺀다(커서가 간 만큼 말했다). 끝과 앞이 어절 가운데에 걸리면 그 어절은 애드리브에 둔다
    // (어미만 우연히 같을 때: 애드리브 '…나아집니다'와 대본 '…배진혁입니다').
    // 반환 lead: 끝에서 대본 뒤에 이미 들어온 다음 애드리브의 음절 수(locate는 3음절까지 붙어도 맞춘다). open(info, lead)에 넘긴다.
    voice(p, far) {
      const s = tape(), g = norm(s.slice(open ? open.a : Math.max(0, s.length - 400)));
      const lead = [0, 1, 2, 3].find(k => g[g.length - 1 - k] === p.at(-1)) ?? 0;
      if (!open) return lead;
      let [m, i] = align([...p].reverse(), [...g.slice(Math.max(0, g.length - lead - p.length - 10), g.length - lead)].reverse());
      const m2 = Math.max(0, len(s.slice(back(s, lead + m, len, false))) - lead);  // 어절 가운데면 그 어절은 애드리브 쪽
      i = Math.max(0, i - (m - m2)); m = m2;
      const [h, k] = align([...p.slice(0, p.length - i)], [...g.slice(0, g.length - lead - m)]);
      close(lead + m + (far ? 0 : Math.min(p.length - i - k, g.length - lead - m - h)), fwd(s, open.a, h, len), false);
      return lead;
    },
    // 새 발표: 모으던 것과 확정을 기다리던 것을 버린다
    reset() { open = null; closing = []; },
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
  const V = (steps, name) => {
    const g3 = [], C3 = collector(g => g3.push(g), norm);
    let lead = 0;
    C3.open(info(0));
    for (const [h, p, far] of steps) { C3.heard(R([h])); if (p) C3.open(info(1), lead = C3.voice(norm(p), far)); }
    C3.close(null); C3.end();
    return [g3.map(g => g.text), lead];
  };
  const S0 = '안녕하세요 오늘 발표를 맡은 배진혁입니다.';
  // 대본 끝과 애드리브 첫마디가 한 결과로: locate는 '혹시'를 붙인 채 문장 끝으로 옮긴다. '혹시'는 다음 애드리브에 넣는다.
  assert.deepEqual(V([[S0 + ' 혹시', S0], [S0 + ' 혹시 뒤에 계신 분들 소리 잘 들리시나요 저희 팀은 지난 3개월', '저희 팀은 지난 3개월']]),
    [['혹시 뒤에 계신 분들 소리 잘 들리시나요'], 0], '첫마디를 잃지 않는다');
  assert.equal(V([[S0 + ' 혹시', S0]])[1], 2, 'lead');
  // 커서가 늦게 따라옴: 대본 끝(맡은 배진혁입니다)이 애드리브와 한 결과로 와서 커서가 '발표를'에 남았다. 앞의 대본도 빼고,
  // 애드리브 끝 '나아집니다'와 대본 '배진혁입니다'의 '니다'가 우연히 같아도 끝 어절을 잃지 않는다.
  assert.deepEqual(V([['안녕하세요 오늘 발표를', '안녕하세요 오늘 발표를'],
    [S0 + ' 시끄러운 곳에서는 마이크를 가까이 대면 조금 나아집니다 저희 팀은 지난 3개월', '맡은 배진혁입니다 저희 팀은 지난 3개월']])[0],
  ['시끄러운 곳에서는 마이크를 가까이 대면 조금 나아집니다'], '늦게 따라온 커서');
  // 바꿔 읽기: 끝만 같고 가운데는 다르게 말했으면 커서가 간 만큼 말한 것으로 보고 뺀다(애드리브가 아니다)
  assert.deepEqual(V([['대학생들한테 설문해 봤더니 반 넘는 사람이 발표하다 대본 놓쳐 봤다고 답했습니다', '대학생 200명에게 설문을 해 보니 절반 이상이 발표 중에 대본을 놓친 경험이 있다고 답했습니다']])[0],
    [], '바꿔 읽은 대본');
  // 다시 읽기(먼 위치, 뒤로): 애드리브 뒤에 앞 문장을 다시 읽었다. 다시 읽은 만큼만 빼고 애드리브 끝은 남긴다.
  assert.deepEqual(V([[S0, S0], [S0 + ' 사실 이 기능은 팀원이 낸 아이디어인데요 오늘 발표를 맡은 배진혁입니다', S0, true]])[0],
    ['사실 이 기능은 팀원이 낸 아이디어인데요'], '다시 읽기');

  // 7. 확정되며 앞 글자가 바뀌어도 시작은 어절 경계 (쉼표가 붙어 한 글자 밀림, 띄어쓰기가 빠져 한 글자 당겨짐)
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
