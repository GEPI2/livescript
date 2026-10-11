// 늦어지면 자동 줄이기. 발표 중에는 AI 없이 이 계산만 한다. node shrink.js 로 확인한다.
// '발표 준비'(claude.js cleanPrep)가 문단마다 정해 둔 중요도와 뺄 문장·남길 문장 번호로, 아직 읽지 않은 뒤쪽 문단의 문장을 숨긴다.
// 단계: 0 원문, 1 줄임(뺄 문장을 숨김), 2 요약(남길 문장만). 화면의 글자는 모두 발표자가 쓴 원문이다.
import { sentSpans, readScript, hashText, paras } from './lib.js?v=7';  // 뒤 셋은 아래 확인(예시 대본)에만 쓴다

export const MIN = 150, MAX = 600, PIECE = 300;  // 150자보다 짧은 문단은 다음과 묶고, 600자보다 길면 약 300자씩 나눈다
export const FREEZE = 300;  // 지금 위치에서 300자(약 1분) 안에 시작하는 단위는 바꾸지 않는다
export const MARGIN = 10;   // 목표보다 10초 일찍 끝나게 맞춘다 (문단마다 줄였다 돌아왔다 하지 않게)
export const LABEL = ['원문', '줄임', '요약'];

// 계산 단위. prep: 문단마다 { imp, keep, drop } (lib.js paras() 순서, 문장 번호 0부터), len: 소리 내어 읽는 글자 수(match.js norm 길이)
// 반환 [{ s: [{ a, b, p, n, top }], imp, max, len: [원문, 줄임, 요약] }]
//   s: 문장(원문 위치 a~b, 문단 번호 p, 글자 수 n, top: 이 문장이 보이는 가장 높은 단계. 뺄 문장 0, 남길 문장 2, 나머지 1)
//      중요도 1과 첫·마지막 문단은 줄임까지라서 그 문단의 나머지 문장도 2다. 상한은 문단마다 따로 둔다(짧아서 묶인 중요도 3 문단은 요약까지).
//   max: 이 단위에 쓸 수 있는 가장 높은 단계. 보이는 문장이 하나는 남아야 한다.
export function units(text, prep, len) {
  const ps = sentSpans(text), pieces = [];
  ps.forEach((spans, p) => {
    const it = prep[p], one = it?.imp === 1 || p === 0 || p === ps.length - 1;
    const s = spans.map(([a, b], k) => ({ a, b, p, n: len(text.slice(a, b)), top: !it ? 2 : it.drop.includes(k) ? 0 : it.keep.includes(k) || one ? 2 : 1 }));
    const tot = s.reduce((x, y) => x + y.n, 0), k = tot > MAX ? Math.round(tot / PIECE) : 1, imp = it?.imp ?? 2;
    let cur = [], acc = 0, c = 0;
    for (const x of s) {
      cur.push(x); acc += x.n;
      if (c < k - 1 && acc >= tot * (c + 1) / k) { pieces.push({ s: cur, imp }); cur = []; c++; }
    }
    if (cur.length) pieces.push({ s: cur, imp });
  });
  const size = u => u.s.reduce((x, y) => x + y.n, 0), U = [];
  for (const pc of pieces) {
    const l = U[U.length - 1];
    if (l && size(l) < MIN) { l.s.push(...pc.s); l.imp = Math.min(l.imp, pc.imp); }
    else U.push({ s: [...pc.s], imp: pc.imp });
  }
  if (U.length > 1 && size(U[U.length - 1]) < MIN) { const l = U.pop(), u = U[U.length - 1]; u.s.push(...l.s); u.imp = Math.min(u.imp, l.imp); }
  for (const u of U) {
    u.len = [0, 1, 2].map(L => u.s.reduce((x, y) => x + (y.top >= L ? y.n : 0), 0));
    u.max = [2, 1, 0].find(L => u.s.some(x => x.top >= L));
  }
  return U;
}

// 단위마다 보이는 대본에서 시작하는 위치(정규화 글자 수)
export function starts(U, lv) {
  let o = 0;
  return U.map((u, i) => { const s = o; o += u.len[lv[i]]; return s; });
}

// 지금 위치가 든 단위 번호. 단위 끝까지 읽었으면 다음 단위.
export function unitAt(U, lv, at) {
  const st = starts(U, lv);
  let i = 0;
  while (i + 1 < st.length && st[i + 1] <= at) i++;
  return i;
}

// 단계 lv로 보일 대본을 만든다. 숨긴 문장은 글에서 뺀다. 문장 사이, 문단 사이 공백은 원문 그대로.
// 반환 { text, cut: [{ a, b, lv }] } cut: 줄인 단위가 보이는 대본에서 차지하는 자리(표시용, 앞에서부터)
export function shrunk(text, U, lv) {
  const all = U.flatMap((u, i) => u.s.map(s => ({ ...s, i })));
  if (!all.length) return { text, cut: [] };
  const paraGap = [];  // 문단 끝 문장 뒤 공백
  all.forEach((s, k) => { paraGap[s.p] = text.slice(s.b, all[k + 1]?.a ?? s.b); });
  let out = text.slice(0, all[0].a), prev = -1;
  const cut = [];
  all.forEach((s, k) => {
    if (s.top < lv[s.i]) return;
    if (prev >= 0) out += all[prev].p === s.p ? text.slice(all[prev].b, all[prev + 1].a) : paraGap[all[prev].p];
    if (lv[s.i] && cut[cut.length - 1]?.i !== s.i) cut.push({ i: s.i, a: out.length, lv: lv[s.i] });
    out += text.slice(s.a, s.b);
    if (lv[s.i]) cut[cut.length - 1].b = out.length;
    prev = k;
  });
  out += text.slice(all[all.length - 1].b);
  return { text: out, cut: cut.map(({ a, b, lv }) => ({ a, b, lv })) };
}

// 미리 줄이기 창의 보기: 원문을 [{ t: '=' | '-', v }]로 나눈다. 숨길 문장만 '-'(lib.js diff와 같은 모양).
// 글자 비교(diff)로 그리면 숨긴 문장 사이에 남는 문장까지 지웠다 다시 쓴 것처럼 보여서 단계에서 바로 만든다.
export function strikes(text, U, lv) {
  const out = [];
  let o = 0;
  U.forEach((u, i) => u.s.forEach(s => {
    if (s.top >= lv[i]) return;
    out.push({ t: '=', v: text.slice(o, s.a) }, { t: '-', v: text.slice(s.a, s.b) });
    o = s.b;
  }));
  out.push({ t: '=', v: text.slice(o) });
  return out.filter(x => x.v);
}

// 단계를 바꿀 때 지금 위치를 새 대본으로 옮긴다: 같은 문장의 같은 자리. 그 문장이 숨으면 다음 보이는 문장 처음.
export function remap(U, from, to, at) {
  const all = U.flatMap((u, i) => u.s.map(s => ({ n: s.n, top: s.top, i })));
  let o = 0, k = 0;
  for (; k < all.length; k++) {
    if (all[k].top < from[all[k].i]) continue;
    if (at < o + all[k].n) break;
    o += all[k].n;
  }
  const off = at - o;
  o = 0;
  for (let j = 0; j < all.length; j++) {
    if (all[j].top < to[all[j].i]) continue;
    if (j === k) return o + Math.min(off, all[j].n);
    if (j > k) return o;
    o += all[j].n;
  }
  return o;
}

// 목표 시간에 맞게 단계를 고른다. 발표 중에는 지금 단위가 바뀔 때만 부른다.
// at: 지금 위치(보이는 대본의 정규화 글자 수), sec: 지난 초, r: 초당 글자, goal: 목표 초, freeze: 지금 위치에서 이만큼 안에 시작하는 단위는 그대로
// 지난 단위와 고정한 단위는 지금 단계를 두고, 나머지는 원문에서 다시 고른다(앞서가게 되면 원문으로 돌아온다).
// 덜 중요한 쪽부터 줄인다(중요도 3의 줄임 → 3의 요약과 2의 줄임 → 2의 요약과 1의 줄임). 같으면 뒤 단위부터.
// 반환 { lv, over: 다 줄여도 넘는 초 }
export function plan(U, lv, at, sec, r, goal, freeze = FREEZE) {
  const st = starts(U, lv), free = st.map(s => s >= at + freeze);
  const out = lv.map((l, i) => free[i] ? 0 : l);
  const total = U.reduce((x, u, i) => x + u.len[out[i]], 0);
  let need = sec + (total - at) / r - goal + MARGIN;
  const moves = [];
  U.forEach((u, i) => {
    if (free[i]) for (let L = 1; L <= u.max; L++) if (u.len[L] < u.len[L - 1]) moves.push({ i, L, rank: L + 3 - u.imp });
  });
  moves.sort((a, b) => a.rank - b.rank || b.i - a.i);
  for (const m of moves) {
    if (need <= 0) break;
    if (out[m.i] >= m.L) continue;
    need -= (U[m.i].len[out[m.i]] - U[m.i].len[m.L]) / r;
    out[m.i] = m.L;
  }
  return { lv: out, over: Math.max(0, Math.round(need - MARGIN)) };
}

// node shrink.js 로 실행하면 확인
if (import.meta.main ?? (typeof process === 'object' && process.argv[1]?.endsWith('shrink.js'))) {
  const assert = (await import('node:assert')).default;
  // 실제 정규화(match.js norm)로 센다. match.js는 브라우저에서 전역 함수로 쓰는 스크립트라서 그대로 불러온다.
  const { readFileSync } = await import('node:fs');
  (await import('node:vm')).runInThisContext(readFileSync(new URL('./match.js', import.meta.url), 'utf8'));
  const len = t => norm(t).length;

  // 문장 하나가 48자. 문단 0(4문장), 1(4), 2(2, 짧음), 3(2, 짧음), 4(14, 길어서 나눔), 5(4)
  const id = n => String.fromCharCode(0xAC00 + n * 28);  // 문장마다 다른 한 음절 (길이를 같게)
  const S = n => `이 문장은 ${id(n)}번 문장이고 시간이 모자라면 숨길 수도 있는 평범한 설명을 꽤 길게 담고 있으니 처음부터 끝까지 읽습니다.`;
  let n = 0;
  const P = c => Array.from({ length: c }, () => S(n++)).join(' ');
  const text = [P(4), P(4), P(2), P(2), P(14), P(4)].join('\n\n') + '\n';
  const has = (t, k) => t.includes(` ${id(k)}번 `);
  const prep = [
    { imp: 2, keep: [0], drop: [2] },
    { imp: 3, keep: [1], drop: [2, 3] },
    { imp: 2, keep: [0], drop: [1] },
    { imp: 3, keep: [0], drop: [1] },
    { imp: 2, keep: [0], drop: [3, 4, 9, 13] },
    { imp: 1, keep: [2], drop: [0] },
  ];
  const sn = len(S(0));
  assert.equal(sn, 48);
  const U = units(text, prep, len);
  assert.deepEqual(U.map(u => [...new Set(u.s.map(s => s.p))]), [[0], [1], [2, 3], [4], [4], [5]], '짧은 문단 2, 3은 묶고 긴 문단 4(672자)는 두 조각');
  assert.deepEqual(U.map(u => u.s.length), [4, 4, 4, 7, 7, 4]);
  assert.deepEqual(U.map(u => u.imp), [2, 3, 2, 2, 2, 1], '묶으면 더 중요한 쪽');
  assert.deepEqual(U.map(u => u.len[2] === u.len[1]), [true, false, true, false, false, true], '첫 문단, 마지막 문단, 중요도 1은 요약해도 줄임과 같다 (2+3은 남길·뺄 문장뿐이라 같음)');
  assert.equal(U[4].max, 1, '남길 문장이 없는 조각(4의 뒤)은 줄임까지 (다 숨지 않게)');
  assert.deepEqual(U[3].len, [7 * sn, 5 * sn, sn]);
  assert.ok(units('가.\n\n나.', [], len).every(u => u.len[u.max] === u.len[0]), '발표 준비가 없는 문단은 줄이지 않는다');

  // 보일 대본: 원문 그대로면 같은 글
  const L0 = U.map(() => 0);
  assert.equal(shrunk(text, U, L0).text, text);
  assert.deepEqual(shrunk(text, U, L0).cut, []);
  const lv = [1, 2, 1, 0, 1, 1];
  const d = shrunk(text, U, lv);
  assert.ok(!has(d.text, 2) && has(d.text, 3), '줄임: 뺄 문장만 숨김');
  assert.ok([4, 6, 7].every(k => !has(d.text, k)) && has(d.text, 5), '요약: 남길 문장만');
  assert.ok(!has(d.text, 9) && !has(d.text, 11) && has(d.text, 8) && has(d.text, 10), '묶은 단위는 두 문단 모두 줄임');
  assert.ok(!has(d.text, 21) && !has(d.text, 25) && has(d.text, 15) && has(d.text, 20), '나눈 문단은 조각마다 (앞 조각은 원문, 뒤 조각은 줄임)');
  assert.ok(!has(d.text, 26) && has(d.text, 27), '마지막 문단 줄임');
  assert.equal(d.text.split('\n\n').length, 6, '문단 사이 빈 줄은 그대로');
  assert.equal(len(d.text), U.reduce((x, u, i) => x + u.len[lv[i]], 0), '정규화 글자 수가 단위 길이의 합과 같다');
  assert.deepEqual(d.cut.map(c => c.lv), [1, 2, 1, 1, 1]);
  for (const c of d.cut) assert.ok(d.text.slice(c.a).startsWith('이 문장은') && d.text.slice(c.a, c.b).endsWith('읽습니다.'), '줄인 단위 자리는 문장 처음부터 끝까지');
  assert.equal(d.text.slice(d.cut[1].a, d.cut[1].b), S(5), '요약한 문단 1은 남길 문장 하나');

  // 미리 보기: 숨길 문장만 지운 글로, 나머지는 원문 그대로
  const mk = strikes(text, U, lv);
  assert.equal(mk.map(x => x.v).join(''), text);
  assert.deepEqual(mk.filter(x => x.t === '-').map(x => x.v), [2, 4, 6, 7, 9, 11, 21, 25, 26].map(S));

  // 짧아서 묶인 문단도 상한은 문단마다: 중요도 1 문단(1)은 줄임까지, 같이 묶인 중요도 3 문단(2)은 요약까지
  const n4 = n, T4 = [P(4), P(3), P(3), P(4)].join('\n\n');
  const U4 = units(T4, [{ imp: 2, keep: [0], drop: [2] }, { imp: 1, keep: [0], drop: [2] }, { imp: 3, keep: [0], drop: [2] }, { imp: 2, keep: [0], drop: [1] }], len);
  assert.deepEqual(U4.map(u => [...new Set(u.s.map(s => s.p))]), [[0], [1, 2], [3]]);
  const p4 = plan(U4, [0, 0, 0], 0, 0, 5, 1, 0).lv;
  assert.deepEqual(p4, [1, 2, 1]);
  const d4 = shrunk(T4, U4, p4).text;
  assert.ok(has(d4, n4 + 4) && has(d4, n4 + 5) && !has(d4, n4 + 6), '중요도 1 문단은 뺄 문장만 숨김');
  assert.ok(has(d4, n4 + 7) && !has(d4, n4 + 8) && !has(d4, n4 + 9), '묶인 중요도 3 문단은 남길 문장만');

  // 줄 단위 문단(빈 줄 없음)과 문단 안 줄바꿈
  const T2 = '첫 줄입니다.\n둘째 줄은 빼도 됩니다.\n셋째 줄입니다.';
  const U2 = units(T2, [{ imp: 2, keep: [0], drop: [] }, { imp: 3, keep: [0], drop: [0] }, { imp: 2, keep: [0], drop: [] }], len);
  assert.equal(U2.length, 1, '짧은 문단은 묶인다');
  assert.equal(shrunk(T2, U2, [1]).text, '첫 줄입니다.\n셋째 줄입니다.');
  const T3 = '가 문장입니다. 나 문장입니다.\n다 문장입니다.\n\n라 문장입니다.';
  const U3 = units(T3, [{ imp: 3, keep: [0], drop: [1, 2] }, { imp: 2, keep: [0], drop: [] }], len);
  assert.equal(shrunk(T3, U3, [1]).text, '가 문장입니다.\n\n라 문장입니다.', '문단 끝 문장이 숨어도 문단 사이는 빈 줄');
  assert.equal(len('2026.10.11. 오늘'), len('2026.10.11.') + len('오늘'), '공백에서 나누면 정규화 길이를 더할 수 있다');

  // 위치 옮기기
  const st0 = starts(U, L0), stL = starts(U, lv);
  assert.equal(remap(U, L0, lv, 37), 37, '앞 문장이 남으면 같은 자리');
  assert.equal(remap(U, L0, lv, st0[1] + sn + 5), stL[1] + 5, '남는 문장 안의 자리는 같은 문장 같은 자리');
  assert.equal(remap(U, L0, lv, st0[1] + 3), stL[1], '숨는 문장 안이면 다음 보이는 문장 처음');
  assert.equal(remap(U, lv, L0, stL[1] + 5), st0[1] + sn + 5, '되돌려도 같은 문장');
  const end0 = st0[5] + U[5].len[0];
  assert.equal(remap(U, L0, lv, end0), stL[5] + U[5].len[1], '끝이면 끝');
  assert.equal(unitAt(U, L0, 0), 0); assert.equal(unitAt(U, L0, st0[2] - 1), 1); assert.equal(unitAt(U, L0, st0[2]), 2, '단위 끝까지 읽으면 다음 단위');

  // plan: 말 속도 5자/초. 원문 1440자 = 288초. 문단 1을 시작할 때(192자) 300자 안(문단 2까지)은 고정
  const r = 5, goal = 288, at = st0[1], onTime = at / r;
  assert.deepEqual(plan(U, L0, 0, 0, r, goal + 30).lv, L0, '여유 있으면 그대로');
  const p5 = plan(U, L0, at, onTime + 5, r, goal);
  assert.deepEqual(p5.lv, [0, 0, 0, 0, 1, 0], '5초 늦으면(여유 10초까지 15초) 덜 중요한 뒤 단위 하나만 줄임');
  const p60 = plan(U, L0, at, onTime + 60, r, goal);
  assert.deepEqual(p60.lv, [0, 0, 0, 2, 1, 1], '60초 늦으면: 중요도 2의 줄임(뒤부터) → 중요도 1의 줄임과 2의 요약(뒤부터)');
  assert.equal(p60.over, 0);
  const p200 = plan(U, L0, at, onTime + 200, r, goal);
  assert.deepEqual(p200.lv, [0, 0, 0, 2, 1, 1], '고정된 문단 2는 아무리 늦어도 그대로');
  assert.equal(p200.over, Math.round(200 + 10 - (96 + 96 + 192 + 48) / r - 10), '다 줄여도 넘는 시간');
  // 앞서가면 원문으로 돌아온다. 이미 300자 안에 들어온 단위(3, 4)는 그대로
  const back = plan(U, p60.lv, starts(U, p60.lv)[2], st0[2] / r - 20, r, goal);
  assert.deepEqual(back.lv, [0, 0, 0, 2, 1, 0]);
  // 발표 전에 미리 줄이기: 고정 없이 처음부터. 중요도 3의 줄임 → 2의 줄임(뒤부터)
  assert.deepEqual(plan(U, L0, 0, 0, r, goal - 40, 0).lv, [0, 1, 0, 1, 1, 0]);
  // 같은 상황이면 같은 결과 (문단마다 다시 계산해도 흔들리지 않는다)
  assert.deepEqual(plan(U, p5.lv, at, onTime + 5, r, goal).lv, p5.lv);

  // 예시 대본(⋯ 메뉴 '예시 대본 열기'): 가져오기가 되고, 발표 준비가 이 대본에 맞고, 목표 3분까지 줄일 수 있다
  const ex = readScript(readFileSync(new URL('./sample.livescript.json', import.meta.url), 'utf8'), 'sample.livescript.json');
  const eps = paras(ex.text);
  assert.equal(ex.prep.h, hashText(ex.text), '발표 준비 해시가 대본과 같다');
  assert.equal(ex.prep.paras.length, eps.length);
  assert.deepEqual(ex.prep.n, eps.map(p => p.length), '문단마다 문장 수');
  ex.prep.paras.forEach((x, i) => assert.ok([...x.keep, ...x.drop].every(k => Number.isInteger(k) && k >= 0 && k < eps[i].length), `문단 ${i + 1}의 문장 번호`));
  assert.equal(ex.target, 3);
  const eU = units(ex.text, ex.prep.paras, len), eL = len(ex.text), e0 = eU.map(() => 0);
  assert.ok(eL >= 1100 && eL <= 1300, `예시 대본 ${eL}자 (초당 5자로 약 3분 40초~4분 20초)`);
  assert.equal(plan(eU, e0, 0, 0, 5, 180, 0).over, 0, '다 줄이면 목표 3분 안');
  // 시연: 첫 문단을 읽고(약 32초) 대본 밖 말을 60초 한 뒤 둘째 문단에 들어서면, 지금 위치에서 300자보다 뒤 문단이 줄어든다
  assert.equal(eU[0].s.at(-1).p, 0, '첫 문단은 혼자 한 단위 (둘째 문단에서 다시 계산한다)');
  assert.ok(eU.every(u => u.s.every(x => x.p === u.s[0].p)), '문단마다 한 단위 (150자보다 짧으면 묶여서 여담 문단이 마지막 문단의 중요도 1을 따른다)');
  const eAt = starts(eU, e0)[1], eLv = plan(eU, e0, eAt, eAt / 5 + 60, 5, 180).lv;
  assert.ok(eLv.some((l, i) => l && starts(eU, e0)[i] >= eAt + FREEZE), `60초 늦으면 뒤 문단을 줄인다: ${eLv}`);
  console.log('shrink.js ok');
}
