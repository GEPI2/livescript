// 연습 결과의 '대본과 실제로 한 말'(시안): 대본 한 구간과 그때 들은 말을 낱말 단위로 맞춰서 빼먹음·더함·바꿔 말함을 가른다.
// 바꿔 말한 것이 연습마다 되풀이되면 '대본을 이렇게 바꿀까요?' 제안이 된다. 순수 계산이라 node에서도 돈다. node compare.js 로 확인한다.

// 비교용 낱말: 문장부호와 대소문자를 뺀다 (qa.js norm과 같다)
const key = w => w.normalize('NFC').toLowerCase().replace(/[^0-9a-z가-힣]/g, '');
const words = t => t.normalize('NFC').split(/\s+/).filter(w => key(w));
const trimP = w => w.replace(/^[^0-9A-Za-z가-힣]+|[^0-9A-Za-z가-힣]+$/g, '');

export const MAX_RUN = 4;  // 바꿔 말함으로 묶는 한쪽 낱말 수(이보다 길면 빼먹음과 더함으로 따로 본다)

// 낱말 최장 공통 부분열로 맞춘다. 반환 [{ t: '=' | '-' | '+' | '~', s: 대본 글, w: 들은 글 }]
//   '=' 같음, '-' 빼먹음(대본에만), '+' 더함(들은 말에만), '~' 바꿔 말함(대본 s → 들은 w)
export function align(script, spoken) {
  const a = words(script), b = words(spoken), ka = a.map(key), kb = b.map(key), n = a.length, m = b.length;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = ka[i] === kb[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const raw = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && ka[i] === kb[j]) { raw.push({ t: '=', s: a[i], w: b[j] }); i++; j++; }
    else if (j >= m || (i < n && L[i + 1][j] >= L[i][j + 1])) raw.push({ t: '-', s: a[i++] });
    else raw.push({ t: '+', w: b[j++] });
  }
  // 이어진 '-'와 '+' 덩어리를 짝지어 바꿔 말함으로
  const out = [];
  for (let k = 0; k < raw.length;) {
    if (raw[k].t === '=') { out.push(raw[k++]); continue; }
    const from = [], to = [];
    while (k < raw.length && raw[k].t !== '=') { (raw[k].t === '-' ? from : to).push(raw[k]); k++; }
    if (from.length && to.length && from.length <= MAX_RUN && to.length <= MAX_RUN) out.push({ t: '~', s: from.map(x => x.s).join(' '), w: to.map(x => x.w).join(' ') });
    else {  // 이어진 낱말은 한 곳으로 센다
      if (from.length) out.push({ t: '-', s: from.map(x => x.s).join(' ') });
      if (to.length) out.push({ t: '+', w: to.map(x => x.w).join(' ') });
    }
  }
  return out;
}
export const diffCount = ops => ops.filter(o => o.t !== '=').length;

// 한 번의 연습에서 바꿔 말한 것: { '대본 글→들은 글': { from, to, n } }. 글자만 앞뒤 부호를 떼어 모은다.
export function swaps(ops) {
  const out = {};
  for (const o of ops) {
    if (o.t !== '~') continue;
    const from = trimP(o.s), to = trimP(o.w), k = key(from) + '→' + key(to);
    if (!key(from) || !key(to)) continue;
    (out[k] ||= { from, to, n: 0 }).n++;
  }
  return out;
}

// 제안: runs = 연습마다 swaps() 결과(오래된 것부터). 가장 최근 연습에 있고, 그 연습까지 이어서 2회 이상 나왔거나 한 연습에서 3번 이상 나온 것.
// ignore: 그대로 두기로 한 키. 반환 [{ k, from, to, runs: 이어서 나온 연습 수, n: 가장 최근 연습에서의 횟수 }]
export function suggest(runs, ignore = []) {
  const last = runs.at(-1) ?? {}, out = [];
  for (const [k, v] of Object.entries(last)) {
    if (ignore.includes(k)) continue;
    let r = 0;
    for (let i = runs.length - 1; i >= 0 && runs[i][k]; i--) r++;
    if (r >= 2 || v.n >= 3) out.push({ k, from: v.from, to: v.to, runs: r, n: v.n });
  }
  return out.sort((x, y) => y.runs - x.runs || y.n - x.n).slice(0, 3);
}

// 연습 때 막힌 낱말(시안의 점선 밑줄 '활용하고 — 연습 때 두 번 막혔어요'): runsOps = 연습마다 align() 결과를 이은 목록(오래된 것부터).
// 낱말 하나를 다른 말로 바꿔 말한 곳('~')을 연습마다 한 번씩 세고, minRuns번 넘는 연습에서 그랬으면 막힌 낱말이다. 바꿔 말한 말이 추천이 된다.
// 반환 [{ k, w, runs, alts }] (runs 많은 순). 빼먹은 낱말은 문장째 건너뛴 것이 많아서 세지 않는다.
export function hardWords(runsOps, minRuns = 2) {
  const m = new Map();
  runsOps.forEach(ops => {
    const seen = new Set();
    for (const o of ops) {
      if (o.t !== '~' || o.s.includes(' ')) continue;
      const w = trimP(o.s), k = key(w), to = trimP(o.w);
      if (k.length < 2 || !key(to)) continue;
      const e = m.get(k) ?? { k, w, runs: 0, alts: new Map() };
      if (!seen.has(k)) { e.runs++; seen.add(k); }
      e.alts.set(to, (e.alts.get(to) ?? 0) + 1);
      m.set(k, e);
    }
  });
  return [...m.values()].filter(e => e.runs >= minRuns).map(e => ({ k: e.k, w: e.w, runs: e.runs, alts: [...e.alts].sort((a, b) => b[1] - a[1]).map(x => x[0]).slice(0, 3) })).sort((a, b) => b.runs - a.runs);
}
export const wordKey = key;

// 대본의 from을 to로 모두 바꾼다. [새 글, 바꾼 수]. from이 낱말 가운데에 든 경우(앞뒤가 한글·숫자)는 건드리지 않는다.
export function applyReplace(text, from, to) {
  const esc = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), re = new RegExp(`(?<![0-9A-Za-z가-힣])${esc}`, 'g');
  let n = 0;
  return [text.replace(re, () => (n++, to)), n];
}

// ---- 저장 ----
// 대본마다 sk('says')에 연습 기록(t0)별로 [{ s: 그 구간의 보인 대본, x: 그때 들은 말 }]을 둔다. 대본을 나중에 고쳐도 비교할 수 있게 대본 글도 같이 둔다.
export const SAY_MAX = 12000;  // 한 번의 연습에 대본 글과 들은 말을 합쳐 이 글자까지 (구간마다 똑같이 나눈다)
export const SAYS = 5;         // 연습 기록 수와 같다(check.js RUNS)
// 구간마다 [대본, 들은 말]. 둘 다 앞에서부터 같은 길이로 잘라 같은 자리를 비교한다.
export function packSays(secs) {
  const per = Math.max(200, Math.floor(SAY_MAX / Math.max(1, secs.length) / 2));
  return secs.map(([s, x]) => ({ s: String(s).slice(0, per), x: String(x).slice(0, per) }));
}
export function readSays(json) {
  let v;
  try { v = JSON.parse(json); } catch { return []; }
  return (Array.isArray(v) ? v : []).filter(r => Number.isFinite(r?.t0) && Array.isArray(r.secs)).map(r => ({ t0: r.t0, secs: r.secs.slice(0, 300).map(x => ({ s: typeof x?.s === 'string' ? x.s : '', x: typeof x?.x === 'string' ? x.x : '' })) }));
}
// 목록에 이 연습을 더하고(같은 t0면 바꿔 쓴다) 기록에 남은 연습(keep: t0 목록)만 둔다
export const addSays = (list, entry, keep) => [...list.filter(r => r.t0 !== entry.t0), entry].filter(r => keep.includes(r.t0)).slice(-SAYS);
// 연습 한 번의 구간별 비교: [{ ops, n }] (n: 다르게 말한 곳 수)
export const compareRun = r => r.secs.map(x => { const ops = x.x.trim() ? align(x.s, x.x) : []; return { ops, n: diffCount(ops) }; });

// node compare.js 로 확인
if (typeof process === 'object' && process.argv[1]?.endsWith('compare.js')) {
  const assert = (await import('node:assert')).default;
  const s = '발표자는 슬라이드를 넘기고, 시간을 보고, 대본을 찾는 일을 동시에 합니다. 그래서 활용하고 있는 프롬프터도 손으로 스크롤해야 하죠.';
  const sp = '발표자는 슬라이드를 넘기고 시간을 보고 대본을 찾는 일을 합니다 사실 저도 그랬는데요 그래서 쓰고 있는 프롬프터도 손으로 스크롤해야 하죠';
  const ops = align(s, sp);
  const kinds = ops.filter(o => o.t !== '=');
  assert.deepEqual(kinds.map(o => [o.t, o.s ?? '', o.w ?? '']), [['-', '동시에', ''], ['+', '', '사실 저도 그랬는데요'], ['~', '활용하고', '쓰고']], '빼먹음, 더함(이어진 낱말은 한 곳), 바꿔 말함');
  assert.equal(diffCount(ops), 3);
  assert.deepEqual(align('안녕하세요. 반갑습니다!', '안녕하세요 반갑습니다').map(o => o.t), ['=', '='], '문장부호와 대소문자는 무시');
  assert.deepEqual(align('', '').length, 0);
  assert.deepEqual(align('가 나', '').map(o => [o.t, o.s]), [['-', '가 나']], '말이 없으면 대본 전체가 빼먹음 한 곳');
  assert.deepEqual(align('가 나 다 라 마 바', '사 아 자 차 카 타').map(o => o.t), ['-', '+'], '너무 길게 다르면 바꿔 말함이 아니다');
  const sw = swaps(ops);
  assert.deepEqual(Object.values(sw), [{ from: '활용하고', to: '쓰고', n: 1 }]);
  // 제안: 이어서 2회 이상
  const R = (...pairs) => Object.fromEntries(pairs.map(([f, t, n = 1]) => [key(f) + '→' + key(t), { from: f, to: t, n }]));
  assert.deepEqual(suggest([R(['활용하고', '쓰고']), R(['활용하고', '쓰고'])]).map(x => [x.from, x.to, x.runs]), [['활용하고', '쓰고', 2]]);
  assert.deepEqual(suggest([R(['활용하고', '쓰고']), R(['다른', '말']), R(['활용하고', '쓰고'])]), [], '이어서 나오지 않으면 제안하지 않는다');
  assert.equal(suggest([R(['활용하고', '쓰고', 3])]).length, 1, '한 번의 연습에서 3번도 제안');
  assert.deepEqual(suggest([R(['활용하고', '쓰고']), R(['활용하고', '쓰고'])], [key('활용하고') + '→' + key('쓰고')]), [], '그대로 두기로 한 것은 빼고');
  const hw = hardWords([align('그래서 활용하고 있는 도구', '그래서 쓰고 있는 도구'), align('활용하고 합니다', '사용하고 합니다'), align('활용하고', '활용하고')]);
  assert.deepEqual(hw, [{ k: '활용하고', w: '활용하고', runs: 2, alts: ['쓰고', '사용하고'] }], '두 번 넘게 바꿔 말한 낱말만, 같게 말한 연습은 세지 않는다');
  assert.deepEqual(hardWords([align('가나 다라', '가나 마바')]), [], '한 번만으로는 아니다');
  assert.equal(wordKey('활용하고,'), '활용하고');
  // 바꾸기
  assert.deepEqual(applyReplace('활용하고 있는 도구를 활용하고, 재활용하고', '활용하고', '쓰고'), ['쓰고 있는 도구를 쓰고, 재활용하고', 2], '낱말 가운데는 건드리지 않는다');
  assert.deepEqual(applyReplace('없는 말', '활용', '쓰기'), ['없는 말', 0]);
  assert.deepEqual(applyReplace('a.b (c)', 'a.b', 'x'), ['x (c)', 1], '정규식 글자는 그대로 찾는다');
  // 저장
  const pk = packSays([['가'.repeat(5000), '나'.repeat(5000)], ['다', '라']]);
  assert.equal(pk[0].s.length, 3000); assert.equal(pk[1].x, '라');
  assert.equal(packSays(Array(100).fill(['가'.repeat(900), '나'])).every(x => x.s.length === 200), true, '구간이 많아도 200자는 둔다');
  assert.deepEqual(readSays('깨진 글'), []); assert.deepEqual(readSays(JSON.stringify([{ t0: 1, secs: [{ s: '가', x: 5 }] }, { t0: 'x' }])), [{ t0: 1, secs: [{ s: '가', x: '' }] }]);
  let L = [];
  for (const t0 of [1, 2, 3, 4, 5, 6]) L = addSays(L, { t0, secs: [] }, [2, 3, 4, 5, 6]);
  assert.deepEqual(L.map(r => r.t0), [2, 3, 4, 5, 6], '기록에 남은 연습만, 최근 5개');
  assert.deepEqual(addSays([{ t0: 2, secs: [{ s: 'a', x: 'a' }] }], { t0: 2, secs: [] }, [2]).map(r => r.secs.length), [0], '같은 연습은 바꿔 쓴다');
  const cr = compareRun({ secs: [{ s, x: sp }, { s: '가 나', x: '' }] });
  assert.deepEqual(cr.map(c => c.n), [3, 0], '말이 없는 구간은 비교하지 않는다');
  console.log('compare.js ok');
}
