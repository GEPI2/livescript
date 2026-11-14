// 대본 보관함과 버전 기록에 쓰는 순수 계산. node lib.js 로 확인한다.

// ---- 어절 단위 비교 ----
// 공백은 앞 어절에 붙여서 센다. 반환 [{ t: '=' | '-' | '+', v: 글 }] (-: a에만 있음, +: b에만 있음)
// 앞뒤의 같은 부분을 먼저 떼고, 가운데만 LCS 표로 비교한다.
// ponytail: 가운데가 어절 3000개 × 3000개(30분 대본을 통째로 다시 쓴 정도)를 넘으면 줄 단위로 비교한다.
// 그래도 넘으면 통째로 지움/더함. 더 긴 대본이 흔해지면 Myers diff로 바꾼다.
const CELLS = 9e6;
const words = s => s.match(/^\s+|\S+\s*/g) || [];
const lines = s => s.match(/[^\n]*\n|[^\n]+/g) || [];

export function diff(a, b) {
  const A = words(a), B = words(b), out = [];
  const push = (t, v) => {
    if (!v) return;
    const l = out[out.length - 1];
    if (l?.t === t) l.v += v; else out.push({ t, v });
  };
  let p = 0, s = 0;
  while (p < A.length && p < B.length && A[p] === B[p]) p++;
  while (s < A.length - p && s < B.length - p && A[A.length - 1 - s] === B[B.length - 1 - s]) s++;
  push('=', A.slice(0, p).join(''));
  let x = A.slice(p, A.length - s), y = B.slice(p, B.length - s);
  if (x.length * y.length > CELLS) { x = lines(x.join('')); y = lines(y.join('')); }
  lcs(x, y, push);
  push('=', A.slice(A.length - s).join(''));
  return tidy(out);
}

// 바뀐 곳 사이에 낀 같은 말이 양쪽 바뀐 말보다 짧으면 바뀐 말에 합친다. 통째로 다시 쓴 글에서 '앱을 '처럼
// 흩어진 낱말 하나가 같은 말로 남아 읽기 어려워지는 것을 막는다(diff-match-patch의 semantic cleanup 기준).
function tidy(out) {
  const g = [];  // 같은 말 { e } 과 바뀐 말 { d: 지운 글, i: 더한 글 } 이 번갈아 온다
  for (const { t, v } of out) {
    if (t === '=') { g.push({ e: v }); continue; }
    if (!g.length || g[g.length - 1].e != null) g.push({ d: '', i: '' });
    g[g.length - 1][t === '-' ? 'd' : 'i'] += v;
  }
  const big = c => Math.max(c.d.length, c.i.length);
  for (let k = 1; k < g.length - 1; k++) {
    const [p, e, n] = [g[k - 1], g[k], g[k + 1]];
    // 같은 말이나 앞 변경 끝에 줄바꿈이 있으면 합치지 않는다 (두 문단의 바뀐 곳이 빈 줄째 하나로 보이지 않게)
    if (e.e != null && e.e.length <= big(p) && e.e.length <= big(n) && !/\n/.test(e.e + p.d.slice(-2) + p.i.slice(-2))) {
      p.d += e.e + n.d; p.i += e.e + n.i;
      g.splice(k, 2);
      k = Math.max(0, k - 2);  // 합친 덩어리 앞뒤를 다시 본다
    }
  }
  // 바뀐 말 양쪽이 같은 줄바꿈(문단 끝 빈 줄 등)으로 끝나면 그 공백은 같은 말로 돌린다.
  // 문단 끝 낱말만 바뀌어도 빈 줄째 지우고 새 문단을 더한 것처럼 보이지 않게. 띄어쓰기 한 칸은 지운 말과 더한 말 사이를 띄우도록 둔다.
  for (let k = 0; k < g.length; k++) {
    const c = g[k];
    if (c.e != null) continue;
    let n = 0;
    while (n < c.d.length && n < c.i.length && c.d[c.d.length - 1 - n] === c.i[c.i.length - 1 - n] && /\s/.test(c.i[c.i.length - 1 - n])) n++;
    const w = c.i.slice(c.i.length - n);
    if (!w.includes('\n')) continue;
    c.d = c.d.slice(0, -n); c.i = c.i.slice(0, -n);
    if (g[k + 1]?.e != null) g[k + 1].e = w + g[k + 1].e; else g.splice(k + 1, 0, { e: w });
  }
  return g.flatMap(c => c.e != null ? [{ t: '=', v: c.e }] : [c.d && { t: '-', v: c.d }, c.i && { t: '+', v: c.i }].filter(Boolean));
}

function lcs(x, y, push) {
  const n = x.length, m = y.length;
  if (n * m > CELLS) { push('-', x.join('')); push('+', y.join('')); return; }
  // 글자열 비교보다 빠르게 어절마다 번호를 붙인다. 뒤 공백은 빼고 센다('끝.'과 문단 끝의 '끝.\n\n'은 같은 어절).
  const id = new Map(), X = new Int32Array(n), Y = new Int32Array(m);
  const num = t => (t = t.trimEnd(), id.get(t) ?? (id.set(t, id.size), id.size - 1));
  x.forEach((t, i) => { X[i] = num(t); });
  y.forEach((t, j) => { Y[j] = num(t); });
  // L[i][j] = x[i..]와 y[j..]의 LCS 길이. min(n, m) <= 3000이라 Uint16으로 충분하다.
  const w = m + 1, L = new Uint16Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1, r = i * w, d = r + w; j >= 0; j--)
      L[r + j] = X[i] === Y[j] ? L[d + j + 1] + 1 : Math.max(L[d + j], L[r + j + 1]);
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (X[i] === Y[j]) {
      // 어절은 같고 뒤 공백만 다르면 공백만 바뀐 것으로 적는다
      const t = x[i] === y[j] ? x[i] : x[i].trimEnd();
      push('=', t); push('-', x[i].slice(t.length)); push('+', y[j].slice(t.length));
      i++; j++;
    }
    else if (L[(i + 1) * w + j] >= L[i * w + j + 1]) push('-', x[i++]);
    else push('+', y[j++]);
  }
  while (i < n) push('-', x[i++]);
  while (j < m) push('+', y[j++]);
}

// ---- 문단과 문장 ----
// 슬라이드 머리 줄: 줄 맨 앞의 '3슬라이드', '슬라이드 3', 'Slide 3', '# 제목'. 뒤에 글자가 바로 붙으면('3슬라이드에서는') 본문이다.
// 붙여넣은 대본에 이런 줄이 둘 이상이면 슬라이드마다 문단 하나로 묶는다(빈 줄마다 쪼개면 카드가 잘게 흩어진다).
// 3번 묶음: 번호 뒤 구분 기호(없을 수도 있다)
const HEAD = /^[^\S\n]*(?:#{1,6}[ \t]+(?=\S)|(\d{1,3})[ \t]*슬라이드(?![가-힣A-Za-z0-9])|(?:슬라이드|slide)[ \t]*(\d{1,3})(?![가-힣A-Za-z0-9]))([ \t]*[.,:)\-–—·~]*)[ \t]*/i;
// 줄 하나가 머리 줄이면 { no: 슬라이드 번호(없으면 0), title: 번호·기호·대괄호를 뺀 제목(없으면 '') }, 아니면 null
function headLine(line) {
  const m = HEAD.exec(line);
  if (!m) return null;
  let t = line.slice(m[0].length).trim();
  // 번호 뒤에 구분 기호(. : ) - ·) 없이 문장이 이어지면 본문이다: '3슬라이드 보시면 표가 있습니다.', '슬라이드 3, 4를 함께 보겠습니다.'
  if ((m[1] ?? m[2]) != null && !/[.:)\-–—·]/.test(m[3]) && !/^\[[^\]]*\]$/.test(t) && /[.!…。]["'”’)\]]*$/.test(t)) return null;  // 대괄호 제목('2슬라이드 [배경 등...]')은 머리 줄
  if (/^\[[^\]]*\]$/.test(t)) t = t.slice(1, -1).trim();
  if (/^[\d\s.,~\-–—]*$/.test(t)) t = '';  // '슬라이드 3-4', 'Slide 3.5'처럼 번호만 남으면 제목이 없는 것으로
  return { no: +(m[1] || m[2] || 0), title: t };
}
// 문단 첫 줄이 머리 줄이면 { no, title }, 아니면 null
export const slideHead = para => headLine(para.trimStart().split('\n', 1)[0]);
// 문단: 빈 줄로 나눈 덩어리. 빈 줄이 하나도 없는 대본이면 줄마다 한 문단. 슬라이드 머리 줄이 둘 이상이면 첫 머리 줄부터는 머리 줄마다 한 문단.
// 반환 [[시작, 끝], ...] (원문 위치, 앞뒤 공백 제외)
export function paraSpans(text) {
  const heads = [];
  for (let i = 0, e; i < text.length; i = e + 1) { e = text.indexOf('\n', i); if (e < 0) e = text.length; if (headLine(text.slice(i, e))) heads.push(i); }
  const body = heads.length >= 2 ? text.slice(0, heads[0]) : text;  // 첫 머리 줄 앞(인사말 등)은 예전 규칙대로
  const re = /\n\s*\n/.test(text) ? /\n\s*\n/g : /\n/g, out = [];  // 빈 줄이 있는 대본인지는 전체로 본다
  let s = 0, m;
  const add = e => {
    const p = text.slice(s, e), t = p.trim();
    if (t) { const a = s + p.search(/\S/); out.push([a, a + t.length]); }
  };
  while ((m = re.exec(body))) { add(m.index); s = m.index + m[0].length; }
  add(body.length);
  if (heads.length >= 2) heads.forEach((h, k) => { s = h; add(heads[k + 1] ?? text.length); });
  return out;
}

// 문단마다 문장 [시작, 끝] (원문 위치, 앞뒤 공백 제외). 문장은 app.js build()와 같은 규칙으로 나눈다:
// 어절 끝의 . ? ! … 。(뒤 따옴표·괄호 포함) 또는 줄바꿈. '발표 준비'의 문장 번호(문단 안에서 0부터)가 이 나눔을 따른다.
export function sentSpans(text) {
  return paraSpans(text).map(([a, b]) => {
    const p = text.slice(a, b), re = /[^\n]*?[.?!…。]["'”’)\]]*(?=\s|$)|[^\n]+/g, out = [];
    let m;
    while ((m = re.exec(p))) {
      const t = m[0].trim();
      if (t) { const s = a + m.index + m[0].search(/\S/); out.push([s, s + t.length]); }
    }
    return out;
  });
}
export function paras(text) {
  text = text.normalize('NFC');
  return sentSpans(text).map(p => p.map(([a, b]) => text.slice(a, b)));
}

// 선택한 [a, b)에 걸친 문단 전체의 [시작, 끝]. 문단에 안 걸치면(공백만 골랐으면) null
export function paraRange(text, a, b) {
  const ps = paraSpans(text).filter(([s, e]) => e > a && s < b);
  return ps.length ? [ps[0][0], ps[ps.length - 1][1]] : null;
}

// 고른 말이 들어 있는 문장 (앞뒤 최대 200자). '다른 말'에 문맥으로 보낸다.
export function around(text, a, b) {
  const s = text.slice(0, a).search(/[^.?!…。\n]*$/), e = text.slice(b).search(/[.?!…。\n]|$/);
  return text.slice(Math.max(s, a - 200), b + Math.min(e + 1, 200)).trim();
}

// ---- 버전 ----
export const MAX_VERS = 30;
// 새 버전을 맨 앞에 넣는다. 빈 대본이거나 바로 앞 버전과 같으면 null
export function addVersion(vs, v, max = MAX_VERS) {
  if (!v.text.trim() || vs[0]?.text === v.text) return null;
  return [v, ...vs].slice(0, max);
}

// 대본 해시. '발표 준비' 결과가 어느 대본으로 만든 것인지 적어 둔다.
export function hashText(t) {
  t = t.normalize('NFC').trim();
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16);
}

// 챗봇이 대본 앞뒤에 붙이는 말: 첫 줄 '여기 대본입니다:'와 따로 떨어진 끝 문단 '대본을 더 줄이고 싶으시면 말씀해 주세요.'
// 대본에 나올 만한 말('안녕하세요. ... 수정안입니다:', '다음은 설치 스크립트입니다:', '수정이 필요하시면 말씀해 주세요.', '도움이 되길 바랍니다.')은 남도록 좁게 잡는다.
const DID = '(요청하신|말씀하신|고친|수정한|다듬은|새로 쓴|작성한|줄인|늘린)';
// 첫 줄: 앞에 '네,', '물론이죠!'만 올 수 있고 그 밖의 문장이 있으면 대본이다. 스크립트·초안·수정안은 '고친 초안', '발표 스크립트'처럼 바로 앞에서 AI 결과임을 밝힐 때만.
const PRE_IT = new RegExp(`^((여기|다음은|아래는|${DID})\\s.{0,30})?(대본|원고|${DID}\\s(스크립트|초안|수정본|수정안)|발표\\s?용?\\s?(스크립트|초안))(입니다|이에요|예요)\\s*[:：]$`);
const PRE = s => {
  s = s.replace(/^(네|넵|예|물론이죠|물론입니다|좋아요|좋습니다|알겠습니다)[,.!~]*\s+/, '');
  return !/[.!?]/.test(s) && (PRE_IT.test(s) || /^(대본|원고)[을를] .{0,20}(썼|작성했|고쳤|다듬었|수정했|줄였|늘렸)(습니다|어요)\s*[:：]$/.test(s));
};
// 끝 문단: 문장마다 끝인사(BYE)이고, 적어도 한 문장은 대본·말투를 가리키거나 '더 줄이고'처럼 고쳐 쓰기를 권해야(BOT) 뺀다.
// '도움이 되길 바랍니다.'나 '좌석을 바꾸고 싶으시면 말씀해 주세요.'만 있으면 대본의 끝말일 수 있어 남긴다.
const BYE = s => /^(이 (대본이|원고가) )?도움이 (되길|되기를|되었으면|됐으면) (바랍니다|좋겠습니다|합니다)[.!]?$/.test(s) ||
  /필요하시면|원하시면|있으시면|싶으시면/.test(s) && /말씀|알려|요청/.test(s) && /대본|스크립트|원고|수정|조정|다듬|고치|고쳐|바꾸|바꿔|줄이|늘리|분량|길이|말투|톤/.test(s);
const BOT = s => /대본|원고|말투/.test(s) || /^(좀 |조금 )?(더 |짧게 |길게 )+(줄이|늘리|다듬|고치|고쳐|바꾸|바꿔|수정)/.test(s);

// AI가 쓴 대본이나 챗봇에서 붙여넣은 대본을 다듬는다: 코드 블록 표시, 마크다운 제목 줄, 굵게 표시, 빈 줄 여러 개, 앞뒤 인사말
// keepHead: '# 제목' 줄을 지우지 않는다(원래 대본이 '# ' 줄을 슬라이드 머리 줄로 쓰고 있을 때. 지우면 그 카드가 앞 슬라이드에 합쳐진다)
export function cleanScript(t, keepHead = false) {
  t = String(t).normalize('NFC').replace(/\r\n?/g, '\n');
  const f = t.match(/```[^\n]*\n([\s\S]*?)```/);
  if (f) t = f[1];
  // 구분선(---, ***, ___)만 있는 줄은 소리 내어 읽지 않으므로 지운다
  t = t.replace(/^[ \t]*([-*_])([ \t]*\1){2,}[ \t]*$/gm, '').replace(keepHead ? /(?!)/ : /^#{1,6}\s.*$/gm, '').replace(/\*\*|__/g, '').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
  const first = t.split('\n', 1)[0];
  if (first.length <= 60 && first.length < t.length && PRE(first)) t = t.slice(first.length).trim();
  const ps = t.split('\n\n'), last = ps.at(-1), ss = (last.match(/[^.!?\n]+[.!?]*/g) || []).map(x => x.trim());  // '...'만 있는 문단은 문장이 없다
  if (ps.length > 1 && last.length <= 120 && ss.every(BYE) && ss.some(BOT)) t = ps.slice(0, -1).join('\n\n');
  return t;
}

// ---- 문단에 띄울 슬라이드 ----
// 직접 고른 쪽은 문단 머리글(공백을 접은 앞 20자)로 묶는다. 앞에 문단을 넣거나 빼도 그 문단을 따라간다
export const headOf = t => t.replace(/\s+/g, ' ').trim().slice(0, 20);
// { 머리글: 쪽 번호(1부터) } 모양만 남긴다 (저장값·가져온 파일은 믿지 않는다)
export const cleanParaSlide = v => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.entries(v).filter(([k, n]) => k && k.length <= 20 && Number.isInteger(n) && n > 0).slice(0, 300)) : {};

// ---- 대본 파일 (발표용 휴대폰으로 옮기기) ----
// 앱이 내보낸 파일 { app: 'livescript', kind: 'script', name, text, target, info, pack, prep }이나 글 파일(.txt)을 읽는다. 파일은 믿지 않는다.
// 반환 { name, text, target, info, pack, prep }. pack은 앱이 qa.js cleanPack으로 검사하고, prep은 모양만 맞춘다(앱 loadPrep이 읽을 때마다 검사).
// prep.n(문단마다 문장 수)은 정수 배열일 때만 넘긴다.
const INFO = ['topic', 'audience', 'goal', 'tone', 'outline', 'refs', 'n', 'rubric'];  // rubric: 발표 준비의 평가 기준 글칸
export function readScript(raw, fname = '') {
  raw = String(raw).replace(/^\uFEFF/, '');
  const json = /\.json$/i.test(fname) || /^\s*\{/.test(raw);
  const d = json ? JSON.parse(raw) : { name: fname.replace(/\.[^.]*$/, ''), text: raw };
  if (json && (d?.app !== 'livescript' || d.kind !== 'script')) throw new Error('말랑에서 내보낸 대본 파일이 아니에요.');
  const text = typeof d.text === 'string' ? d.text.normalize('NFC').replace(/\r\n?/g, '\n') : '';
  if (!text.trim()) throw new Error('대본이 비어 있어요.');
  if (text.length > 100000) throw new Error('대본이 너무 길어요. 10만 자까지 가져올 수 있어요.');  // 따라가기 준비가 글 길이의 제곱으로 느려져서 한도를 둔다
  const p = d.prep;
  return {
    name: typeof d.name === 'string' ? d.name : '', text,
    target: Math.min(600, Math.max(0, +d.target || 0)),
    info: Object.fromEntries(INFO.filter(k => typeof d.info?.[k] === 'string').map(k => [k, d.info[k].slice(0, 2000)])),
    pack: d.pack ?? null,
    // 흐름·핵심 문장·평가 기준(keys, crit, rub)은 모양만 보고 넘긴다. 앱의 loadPrep가 한 번 더 검사한다
    prep: p && typeof p === 'object' && Array.isArray(p.paras) ? { h: String(p.h ?? ''), t: +p.t || 0, paras: p.paras, kw: p.kw && typeof p.kw === 'object' ? p.kw : {},
      n: Array.isArray(p.n) && p.n.every(Number.isInteger) ? p.n : null,
      ...Object.fromEntries(['keys', 'crit', 'rub'].filter(k => Array.isArray(p[k])).map(k => [k, p[k]])) } : null,
    must: Array.isArray(d.must) ? d.must.filter(x => typeof x === 'string').slice(0, 200) : [],  // 꼭 말할 문장(대본 글 그대로)
    paraSlide: cleanParaSlide(d.paraSlide),
  };
}

// node lib.js 로 실행하면 확인
if (import.meta.main ?? (typeof process === 'object' && process.argv[1]?.endsWith('lib.js'))) {
  const assert = (await import('node:assert')).default;
  const side = (d, t) => d.filter(x => x.t !== t).map(x => x.v).join('');
  const check = (a, b) => { const d = diff(a, b); assert.equal(side(d, '+'), a, '옛 글 복원'); assert.equal(side(d, '-'), b, '새 글 복원'); return d; };

  const d = check('오늘은 라이브스크립트를 소개하겠습니다.', '오늘은 새 라이브스크립트를 소개합니다.');
  assert.deepEqual(d.filter(x => x.t !== '=').map(x => x.t + x.v), ['+새 ', '-소개하겠습니다.', '+소개합니다.']);
  assert.deepEqual(diff('', '새 대본'), [{ t: '+', v: '새 대본' }]);
  assert.deepEqual(diff('같은 글', '같은 글'), [{ t: '=', v: '같은 글' }]);
  check('  앞 공백\n\n둘째 문단입니다. 끝', '앞 공백\n둘째 문단이에요. 끝\n');
  check('가 나 다 라 마', '마 라 다 나 가');
  const re2 = check('예전 대본은 발표 앱을 소개하는 글이었습니다. 끝까지 읽어 주세요.', '새 대본은 출석 앱을 설명합니다. 그리고 질문을 받습니다.');
  assert.deepEqual(re2.map(x => x.t + x.v.slice(0, 3)), ['-예전 ', '+새 ', '=대본은', '-발표 ', '+출석 '], '다시 쓴 글에서 바뀐 말 사이에 흩어진 같은 낱말(앱을)은 바뀐 말에 합친다');
  const kept = check('음성 인식은 브라우저에 들어 있는 기능을 씁니다. 크롬과 사파리에서 동작합니다.', '음성 인식은 브라우저 기능을 씁니다. 크롬과 사파리에서 동작합니다.');
  assert.deepEqual(kept.filter(x => x.t !== '=').map(x => x.t + x.v), ['-브라우저에 들어 있는 ', '+브라우저 '], '조금 고친 곳은 그대로 보인다');

  const ch = d => d.filter(x => x.t !== '=').map(x => x.t + x.v);
  assert.deepEqual(ch(check('첫 문단.\n\n둘째 문단을 표시합니다.\n\n셋째 문단.', '첫 문단.\n\n둘째 문단을 보여 줍니다.\n\n셋째 문단.')),
    ['-표시합니다.', '+보여 줍니다.'], '문단 끝 낱말만 바뀌면 빈 줄은 같은 말로 남는다');
  assert.deepEqual(ch(check('앞은 이었습니다. 끝.', '앞은 이었습니다. 끝.\n\n새 문단.')), ['+\n\n새 문단.'], '끝에 문단을 더해도 마지막 어절은 같은 말');
  check('가 나\n\n다', '가 나 다\n');
  assert.deepEqual(ch(check('첫 문단은 여기서 끝.\n\n그 시작 부분입니다.', '첫 문단은 여기서 마침.\n\n그 출발 부분입니다.')),
    ['-끝.', '+마침.', '-시작 ', '+출발 '], '두 문단의 바뀐 곳을 빈 줄째 합치지 않는다');

  // 30분 대본(약 9000음절, 어절 약 2700개). 휴대폰은 PC보다 3~5배 느리다고 본다.
  const W = ['발표를', '시작하겠습니다.', '오늘은', '음성', '인식으로', '대본을', '따라가는', '앱을', '소개합니다.', '휴대폰', '브라우저만', '있으면', '됩니다.'];
  const big = Array.from({ length: 2700 }, (_, i) => W[(i * 7 + (i >> 4)) % W.length] + (i % 40 === 39 ? '\n\n' : ' ')).join('');
  let t = performance.now();
  const small = check(big, big.replace('음성', '목소리').replace(/됩니다\.(?![\s\S]*됩니다\.)/, '돼요.'));
  const tEdit = performance.now() - t;
  assert.ok(small.length <= 7, '앞뒤를 떼면 바뀐 곳만 남는다');
  const re = big.split(' ').map((w, i) => i % 3 ? w : '새말' + i).join(' ');
  t = performance.now();
  check(big, re);
  const tAll = performance.now() - t;
  const huge = big.repeat(3);
  t = performance.now();
  const hd = check(huge, huge.split('\n\n').map((p, i) => i % 2 ? p : p.replace(/ /g, '  ')).join('\n\n'));
  const tHuge = performance.now() - t;
  assert.ok(hd.length > 2, '아주 길면 줄 단위로 비교');
  console.log(`비교: 30분 대본 조금 고침 ${tEdit.toFixed(1)}ms, 3분의 1을 바꿈 ${tAll.toFixed(0)}ms, 90분 대본 ${tHuge.toFixed(0)}ms`);
  assert.ok(tAll < 400, '30분 대본 전체 비교가 PC에서 0.4초 안');

  // 문단과 문장
  const S = '안녕하세요. 오늘은 3.14를 봅니다!\n둘째 줄 "그렇죠?" 네\n\n  둘째 문단…  끝(정말.)\n\n\n셋째';
  assert.deepEqual(paras(S), [['안녕하세요.', '오늘은 3.14를 봅니다!', '둘째 줄 "그렇죠?"', '네'], ['둘째 문단…', '끝(정말.)'], ['셋째']]);
  assert.deepEqual(paras('첫 줄\n둘째 줄. 셋째'), [['첫 줄'], ['둘째 줄.', '셋째']], '빈 줄이 없으면 줄마다 문단');
  assert.deepEqual(paras('가'.normalize('NFD') + '나.'), [['가나.']], 'NFD');
  assert.deepEqual(paras('  \n\n '), []);
  // 슬라이드 머리 줄이 둘 이상이면 슬라이드마다 문단 하나(안의 빈 줄은 그대로), 첫 머리 줄 앞은 예전 규칙
  const SL = '인사말입니다.\n\n1슬라이드. 표지\n안녕하세요.\n\n2슬라이드 [2. Tier 1 → 2 → 3 적용 분석]\n\n[TIER 1 : 구조적 압력]\n먼저 압력입니다.\n\n둘째 문단.\n\nSlide 3: 마무리\n감사합니다.';
  assert.deepEqual(paraSpans(SL).map(([a, b]) => SL.slice(a, b).split('\n')[0]), ['인사말입니다.', '1슬라이드. 표지', '2슬라이드 [2. Tier 1 → 2 → 3 적용 분석]', 'Slide 3: 마무리']);
  assert.equal(paras(SL)[2].length, 5, '둘째 슬라이드: 머리 줄, [TIER 1…], 먼저…, 둘째 문단.');
  assert.deepEqual(paraSpans(SL).map(([a, b]) => slideHead(SL.slice(a, b))), [null, { no: 1, title: '표지' }, { no: 2, title: '2. Tier 1 → 2 → 3 적용 분석' }, { no: 3, title: '마무리' }]);
  assert.deepEqual(slideHead('# 도입\n글'), { no: 0, title: '도입' });
  assert.deepEqual([slideHead('4슬라이드'), slideHead('3슬라이드에서는 표를 봅니다.'), slideHead('[확인 필요] 숫자'), slideHead('슬라이드를 넘기겠습니다.')], [{ no: 4, title: '' }, null, null, null]);
  assert.equal(paraSpans('1슬라이드. 하나뿐\n\n본문 하나.\n\n본문 둘.').length, 3, '머리 줄이 하나뿐이면 예전처럼 빈 줄마다');
  assert.equal(paraSpans('3슬라이드에서는 표를 봅니다.\n\n4슬라이드에서는 그림을 봅니다.\n\n끝.').length, 3, '본문 문장은 머리 줄이 아니다');
  assert.equal(paraSpans('# 하나\n가.\n나.\n# 둘\n다.').length, 2, '빈 줄이 없어도 머리 줄마다');
  // 본문 문장은 머리 줄이 아니다(번호 뒤에 구분 기호 없이 문장으로 끝남). 구분 기호가 있으면 문장으로 끝나도 머리 줄
  assert.deepEqual(['3슬라이드 보시면 표가 있습니다.', '슬라이드 3, 4를 함께 보겠습니다.', 'Slide 3 shows the result.', '1 슬라이드 분량입니다. 짧아요.'].map(slideHead), [null, null, null, null]);
  assert.deepEqual(['1슬라이드. 표지입니다.', 'Slide 3: 마무리입니다.', '2슬라이드 무엇이 문제인가?', '# 제목입니다.'].map(x => slideHead(x)?.title), ['표지입니다.', '마무리입니다.', '무엇이 문제인가?', '제목입니다.']);
  assert.deepEqual(['1슬라이드, 표지', '슬라이드 3-4', 'Slide 3.5', '3슬라이드 -- 제목', '1슬라이드 - 3가지 이유', '슬라이드 3: 4차 산업혁명'].map(x => slideHead(x).title), ['표지', '', '', '제목', '3가지 이유', '4차 산업혁명']);
  assert.equal(paraSpans('안녕하세요.\n\n3슬라이드 보시면 표가 있습니다.\n\n표 설명.\n\n7슬라이드 보시면 그림이 있습니다.\n\n끝.').length, 5, '말로 읽는 문장 둘로는 묶지 않는다');
  assert.equal(paraSpans('1슬라이드\n가.\n\n　2슬라이드\n나.\n\n3슬라이드\n다.').length, 3, '줄 앞 전각 공백');
  assert.equal(paraSpans('# 가\n글.\n\n' + ' '.repeat(35) + '3슬라이드에서는 표를 봅니다.\n\n다음.').length, 3, '깊게 들여 쓴 본문');
  assert.equal(paraSpans('안녕하세요. 발표자입니다.\n오늘 주제는 말랑입니다.\n1슬라이드\n내용.\n\n더.\n2슬라이드\n끝.').length, 3, '빈 줄이 있는 대본이면 머리 줄 앞 인사말은 줄마다 나누지 않는다');
  assert.equal(cleanScript('# 소개\n첫째.\n\n둘째.', true), '# 소개\n첫째.\n\n둘째.', '머리 줄을 남기라고 하면 # 줄을 지우지 않는다');
  assert.equal(cleanScript('# 소개\n첫째.'), '첫째.');
  assert.equal(slideHead('2슬라이드 [배경 등...]').title, '배경 등...', '대괄호 제목은 마침표로 끝나도 머리 줄');
  const T = '첫 문단.\n\n둘째 문단 가운데.\n\n셋째 문단.';
  const at = w => T.indexOf(w);
  assert.deepEqual(paraRange(T, at('가운데'), at('가운데') + 3), [at('둘째'), at('셋째') - 2], '한 문단');
  assert.equal(T.slice(...paraRange(T, at('문단.'), at('셋째') + 1)), T, '여러 문단에 걸치면 모두');
  assert.equal(paraRange(T, at('\n\n'), at('\n\n') + 2), null, '빈 줄만 고르면 없음');
  const A = '앞 문장입니다. 이 레버리지를 쓰면 좋습니다. 뒤 문장.';
  assert.equal(around(A, A.indexOf('레버리지를'), A.indexOf('레버리지를') + 5), '이 레버리지를 쓰면 좋습니다.');

  // 버전
  const v1 = { t: 1, text: '가' };
  assert.equal(addVersion([v1], { t: 2, text: '가' }), null, '같으면 안 만듦');
  assert.equal(addVersion([], { t: 2, text: ' \n' }), null, '빈 대본은 안 만듦');
  const many = Array.from({ length: 30 }, (_, i) => ({ t: i, text: 'v' + i }));
  const nv = addVersion(many, { t: 99, text: '새' });
  assert.equal(nv.length, 30); assert.equal(nv[0].text, '새'); assert.equal(nv[29].text, 'v28', '가장 오래된 것부터 지움');
  assert.equal(hashText(' 대본\n'), hashText('대본'.normalize('NFD')));
  assert.notEqual(hashText('대본'), hashText('대본.'));

  assert.equal(cleanScript('네, 대본입니다.\n```\n## 도입\n**안녕하세요.**\r\n\n\n\n반갑습니다.  \n```\n'), '안녕하세요.\n\n반갑습니다.');
  assert.equal(cleanScript('그대로 둡니다.\n\n[확인 필요] 숫자'), '그대로 둡니다.\n\n[확인 필요] 숫자');
  // 챗봇 인사말은 빼고, 대본에 나올 만한 말은 남긴다
  const body = '안녕하세요.\n\n오늘 발표를 시작하겠습니다.';
  for (const pre of ['여기 대본입니다:', '다음은 요청하신 5분 발표 대본입니다:', '물론이죠! 고친 대본이에요：', '대본을 다음과 같이 수정했습니다:'])
    assert.equal(cleanScript(pre + '\n\n' + body), body, pre);
  assert.equal(cleanScript('여기 대본입니다:\n## 도입\n' + body), body, '제목 줄을 지운 뒤 첫 줄');
  for (const pre of ['여기 수정한 발표 스크립트입니다:', '네, 고친 초안입니다:', '다음은 요청하신 5분 발표 스크립트예요:'])
    assert.equal(cleanScript(pre + '\n' + body), body, pre);
  for (const bye of ['이 대본이 도움이 되길 바랍니다.', '대본 수정이 필요하시면 말씀해 주세요.', '도움이 되었으면 좋겠습니다! 더 줄이고 싶으시면 알려 주세요.', '이 대본이 도움이 되길 바랍니다.\n말투를 바꾸고 싶으시면 요청해 주세요.'])
    assert.equal(cleanScript(body + '\n\n' + bye), body, bye);
  assert.equal(cleanScript('여기 대본입니다:\n' + body + '\n\n대본을 더 다듬고 싶으시면 말씀해 주세요.'), body, '앞뒤 함께');
  assert.equal(cleanScript(body + '\n\n---\n\n이 대본이 도움이 되길 바랍니다.'), body, '구분선 뒤 끝인사');
  assert.equal(cleanScript('안녕하세요.\n\n***\n\n반갑습니다.\n___'), '안녕하세요.\n\n반갑습니다.', '구분선 줄');
  assert.equal(cleanScript('1부\n\n-- 2부 --\n\n영하 -3도'), '1부\n\n-- 2부 --\n\n영하 -3도', '글이 있는 줄은 둔다');
  for (const keep of [
    '오늘 말씀드릴 세 가지는 다음과 같습니다:\n첫째, 속도입니다.',
    '이 앱의 대본 기능은 다음과 같습니다:\n\n따라가기입니다.',
    '여기 대본입니다:',  // 뒤에 아무것도 없으면 그대로
    body + '\n\n오늘 발표가 여러분께 도움이 되길 바랍니다.',
    body + '\n\n궁금한 점이 있으시면 언제든 말씀해 주세요.',
    body + '\n수정이 필요하시면 말씀해 주세요.',  // 빈 줄로 떨어지지 않은 끝 줄은 대본으로 본다
    '도움이 되길 바랍니다.',  // 문단이 하나뿐이면 대본이다
    body + '\n\n감사합니다. 도움이 되길 바랍니다.',
    // 대본의 첫 줄이나 끝말일 수 있는 것
    '안녕하세요. 오늘 보고드릴 내용은 2025년 예산 수정안입니다:\n첫째, 인건비를 줄입니다.',
    '이번 개편의 최종 초안입니다:\n메뉴를 세 개로 줄였습니다.',
    '다음은 설치 스크립트입니다:\n한 줄씩 보겠습니다.',
    '다음은 저희 팀이 작성한 예산 초안입니다:\n세 부분으로 나눴습니다.',
    ...['도움이 되길 바랍니다.', '도움이 되었으면 좋겠습니다.', '수정이 필요하시면 말씀해 주세요.', '일정 조정이 필요하시면 사무국에 알려 주세요.',
      '보고드린 안에 수정이 필요한 부분이 있으시면 말씀해 주세요.', '좌석을 바꾸고 싶으시면 진행 요원에게 말씀해 주세요.',
      '비용을 줄이고 싶으시면 저희에게 알려 주세요.', '비용을 더 줄이고 싶으시면 저희에게 알려 주세요.',
      '요금제를 바꾸고 싶으시면 언제든 고객센터에 말씀해 주세요.', '...', '?', '!!!'].map(x => body + '\n\n' + x),
  ]) assert.equal(cleanScript(keep), keep, keep);

  // 대본 파일
  const file = { app: 'livescript', kind: 'script', name: '발표', text: '가'.normalize('NFD') + '나.', target: '7', info: { topic: '주제', bad: '1', n: 5 }, pack: { questions: [] }, prep: { h: 1, paras: [{ imp: 1 }], kw: 3 } };
  assert.deepEqual(readScript(JSON.stringify(file), 'x.json'), { name: '발표', text: '가나.', target: 7, info: { topic: '주제' }, pack: { questions: [] }, prep: { h: '1', t: 0, paras: [{ imp: 1 }], kw: {}, n: null }, must: [], paraSlide: {} });
  assert.deepEqual(readScript('\uFEFF첫 줄\r\n둘째 줄', '내 대본.txt'), { name: '내 대본', text: '첫 줄\n둘째 줄', target: 0, info: {}, pack: null, prep: null, must: [], paraSlide: {} }, '글 파일');
  assert.deepEqual(readScript(JSON.stringify({ ...file, paraSlide: { 가나: 2, 다라: 0, 마: 'x', 바: 1.5, ['가'.repeat(21)]: 1 } })).paraSlide, { 가나: 2 }, '고른 슬라이드는 20자 머리글과 1 이상 정수만');
  assert.deepEqual([readScript(JSON.stringify({ ...file, paraSlide: '가' })).paraSlide, cleanParaSlide([3]), cleanParaSlide(null)], [{}, {}, {}], '객체가 아니면 비운다');
  assert.equal(headOf('  안녕하세요.\n 오늘은   발표 대본을 따라가는 말랑을 소개합니다.'), '안녕하세요. 오늘은 발표 대본을 따라', '공백을 접은 앞 20자');
  assert.throws(() => readScript('{"version":1,"questions":[]}', 'qa-pack.json'), /대본 파일이 아니/, '질문 팩 파일');
  assert.throws(() => readScript('{"app":"livescript"', 'a.json'), SyntaxError);
  assert.throws(() => readScript(' \n', 'a.txt'), /비어/);
  assert.throws(() => readScript('가'.repeat(100001), 'a.txt'), /너무 길어요/, '10만 자 넘는 대본');
  assert.equal(readScript('가'.repeat(100000), 'a.txt').text.length, 100000, '10만 자까지는 가져온다');
  assert.equal(readScript(JSON.stringify({ ...file, target: 1e9, prep: { paras: 1 } })).target, 600);
  assert.equal(readScript(JSON.stringify({ ...file, prep: { paras: 1 } })).prep, null);
  assert.deepEqual(readScript(JSON.stringify({ ...file, must: ['가.', 3, '나.'] })).must, ['가.', '나.'], '꼭 말할 문장은 글만');
  assert.deepEqual(readScript(JSON.stringify({ ...file, prep: { paras: [], n: [3, 2] } })).prep.n, [3, 2], '문단마다 문장 수');
  assert.equal(readScript(JSON.stringify({ ...file, prep: { paras: [], n: [3, '2'] } })).prep.n, null, '깨진 문장 수는 버린다');
  const fx = readScript(JSON.stringify({ ...file, info: { rubric: '근거\n전달' }, prep: { paras: [], keys: [{ p: 1 }], crit: [], rub: ['근거'], extra: 1 } }));
  assert.deepEqual([fx.info.rubric, fx.prep.keys, fx.prep.crit, fx.prep.rub, fx.prep.extra], ['근거\n전달', [{ p: 1 }], [], ['근거'], undefined], '평가 기준과 흐름도 함께 온다');

  // 모든 ?v= 파일이 sw.js의 미리 받기 목록에 같은 버전으로 있어야 오프라인에서 열린다
  const fs = await import('node:fs'), dir = new URL('.', import.meta.url), src = f => fs.readFileSync(new URL(f, dir), 'utf8');
  const sw = src('sw.js'), Q = sw.match(/const Q = '(\?v=\d+)'/)[1];
  for (const f of fs.readdirSync(dir).filter(f => /\.js$|^index\.html$/.test(f)))
    for (const [, n, q] of src(f).matchAll(/([\w.-]+\.(?:js|json))(\?v=\d+)/g)) { assert.equal(q, Q, `${f}: ${n}${q}`); assert.ok(sw.includes(`'${n}'`), `sw.js SHELL에 없어요: ${n}`); }
  console.log('lib.js ok');
}
