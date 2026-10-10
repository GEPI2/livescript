// 대본과 들은 말을 비교해서 지금 읽는 위치를 찾는다.
// 한국어 음성 인식은 띄어쓰기가 대본과 자주 달라서, 공백·문장부호를 빼고 음절 단위로 비교한다.

const BACK = 60, AHEAD = 150, TAIL = 12;

// ---- 표기 맞추기: 대본과 들은 말에 같은 규칙을 쓴다 ----
const DIG = '영일이삼사오육칠팔구';
const ABC = '에이 비 씨 디 이 에프 지 에이치 아이 제이 케이 엘 엠 엔 오 피 큐 알 에스 티 유 브이 더블유 엑스 와이 제트'.split(' ');

// 숫자를 한자어로 읽는다. 2026 -> 이천이십육, 10000 -> 만. 0으로 시작하는 번호는 한 자리씩(010 -> 공일공).
function readNum(d) {
  if (d === '0') return '영';
  if (d[0] === '0' || d.length > 16) return [...d].map(c => c === '0' ? '공' : DIG[c]).join('');
  let out = '';
  for (let g = Math.ceil(d.length / 4) - 1; g >= 0; g--) {  // 네 자리씩: 조, 억, 만, 일
    const part = d.slice(Math.max(0, d.length - g * 4 - 4), d.length - g * 4);
    let s = '';
    [...part].forEach((c, k) => {
      const p = part.length - 1 - k;
      if (c !== '0') s += (c === '1' && p ? '' : DIG[c]) + ['', '십', '백', '천'][p];
    });
    if (s) out += (s === '일' && g === 1 ? '' : s) + ['', '만', '억', '조'][g];
  }
  return out;
}

// 정규화된 문자열 s와, 각 글자가 원문 몇 번째 글자에서 왔는지 at(숫자처럼 하나가 여러 음절로 늘면 같은 값이 반복),
// 어절 끝 1~2음절 표시 end(조사·어미라서 건너뛰어도 덜 센다).
// 맥이나 일부 PDF에서 복사한 한글은 자모가 분리된 NFD라서 NFC로 합친 뒤 비교한다.
function normMap(text) {
  text = text.normalize('NFC');
  let s = '', w = 0, m;
  const at = [], end = [];
  const endWord = () => {
    if (s.length - w >= 2) end[s.length - 1] = true;
    if (s.length - w >= 4) end[s.length - 2] = true;
    w = s.length;
  };
  // 2026.10.11 같은 점 찍은 날짜·번호, 숫자(1,000 같은 쉼표와 소수점 포함), 영문, %, 한글, 공백
  const re = /\d+(?:\.\d+){2,}|(\d{1,3}(?:,\d{3})+(?!\d)|\d+)(?:\.(\d+))?|[A-Za-z]+|%|[가-힣]|\s+/g;
  while ((m = re.exec(text))) {
    const x = m[0];
    if (/^\s/.test(x)) { endWord(); continue; }
    const out = m[1] ? readNum(m[1].replace(/,/g, '')) + (m[2] ? '점' + [...m[2]].map(c => DIG[c]).join('') : '')
      : /^\d/.test(x) ? x.split('.').map(d => readNum(d.replace(/^0+(?=\d)/, ''))).join('')  // 점 찍은 날짜는 마디마다 앞의 0을 빼고 읽는다: 2026.03.05 -> 이천이십육삼오
      : x === '%' ? '퍼센트'
      : /^[A-Z]{1,5}$/.test(x) ? [...x].map(c => ABC[c.charCodeAt(0) - 65]).join('')  // 대문자 약어: AI -> 에이아이
      : x.toLowerCase();
    for (const c of out) { s += c; at.push(m.index); }
  }
  endWord();
  return { s, at, end };
}

function norm(s) { return normMap(s).s; }

// ---- 위치 찾기 ----
// 비용은 0.1 단위 정수로 센다(소수 비교 오차를 피하려고). 기본 비용 1 = 10.
const SKIP = 5;       // 대본 음절을 안 읽고 넘어갔다
const SKIP_END = 3;   // 어절 끝 1~2음절(조사·어미)을 안 읽었다
const NEAR = 3;       // 인식기가 자주 바꿔 적는 짝
const LAST_MISS = 15; // 들은 말 마지막 3음절이 전혀 다르다. 애드리브가 시작될 때 앞질러 가지 않게 한다.

// 을/를, 은/는, 이/가, 와/과(대본의 어절 끝에서만), ㅐ/ㅔ(초성·종성이 같고 중성만 다를 때)
// 자모 하나만 달라도 할인하는 일반 규칙은 넣지 않는다. 다/가/나처럼 자모 하나 차이인 음절이 많아서 애드리브에 끌려간다.
const PAIRS = ['을를', '은는', '이가', '와과'];
function near(a, b, wordEnd) {
  if (wordEnd && (PAIRS.includes(a + b) || PAIRS.includes(b + a))) return true;
  const x = a.charCodeAt(0) - 0xAC00, y = b.charCodeAt(0) - 0xAC00;
  return x >= 0 && y >= 0 && x < 11172 && y < 11172 && Math.abs(x - y) === 4 * 28 && Math.floor(Math.min(x, y) / 28) % 21 === 1;
}

// 최근 들은 TAIL 음절이 현재 위치 주변 어디서 끝나는지 가중치를 준 편집 거리로 찾는다.
// end: 대본의 normMap(...).end (없으면 어절 끝 할인 없이 비교)
// 반환: { pos: 그 지점까지 읽은 정규화 글자 수, dist } 또는 못 찾으면 null
// ponytail: 글자 비교라서 대본을 풀어 말하면 못 잡는다. 기록을 보고 필요하면 문장 키워드로 확장.
function locate(script, heard, cur, end = []) {
  const p = heard.slice(-TAIL), m = p.length;
  if (m < 5) return null;
  const from = Math.max(0, cur - BACK), t = script.slice(from, cur + AHEAD), n = t.length;
  let prev = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    const row = [i * 10], a = p[i - 1], last = i > m - 3;  // 마지막 3음절에는 할인이 없다
    for (let j = 1; j <= n; j++) {
      const b = t[j - 1], e = end[from + j - 1];
      const sub = a === b ? 0 : near(a, b, e) ? (last ? 10 : NEAR) : last ? LAST_MISS : 10;
      row[j] = Math.min(
        prev[j - 1] + sub,
        prev[j] + 10,                                // 대본에 없는 말을 했다
        row[j - 1] + (last ? 10 : e ? SKIP_END : SKIP));  // 대본을 건너뛰었다
    }
    prev = row;
  }
  // 비용이 같으면 현재 위치에 가까운 쪽 (대본에 같은 말이 여러 번 나올 때 엉뚱한 데로 안 튀게)
  let best = 1;
  for (let j = 2; j <= n; j++)
    if (prev[j] < prev[best] || (prev[j] === prev[best] && Math.abs(from + j - cur) < Math.abs(from + best - cur))) best = j;
  return prev[best] <= m * 3 ? { pos: from + best, dist: prev[best] / 10 } : null;  // 들은 음절당 0.3까지
}

// ---- 문장 키워드: 문장을 많이 바꿔 말해서 글자 비교가 실패할 때 쓴다 ----
// 어절에서 조사·서술격 어미를 떼고, 대본에서 두 문장 이하에만 나오는 낱말을 그 문장의 키워드로 둔다.
// 겹친 조사(에는, 으로는)는 왼쪽부터 맞는 것이 이겨서 통째로 떨어진다
const JOSA = /(입니다|이에요|예요|이라는|이라고|라는|라고|인데요|으로써|으로서|으로는|에게는|까지는|에서도|에서는|에게서|으로|에서|에게|한테|까지|부터|처럼|보다|이랑|하고|에는|에도|에만|로는|은|는|이|가|을|를|에|의|도|만|와|과|로|랑)$/;
// 조사가 떨어지지 않았는데 이렇게 끝나면 동사·형용사·부사로 보고 뺀다
const PRED = /(다|요|죠|까|면|서|고|게|지|며|해|려|니|히|던|어|아|여|운|적인|느라|는데|지만|도록|한|할|된|될)$/;
// 조사를 뗐는데 남은 말이 이렇게 끝나면 용언이다 (있었다는, 사용하는, 진행되는)
const PRED2 = /(다|하|되|해|었|았|였|겠)$/;
// 흔한 낱말(세 음절 이상은 흔해도 쓴다)과, 끝 글자로 못 거르는 관형사·관형형·명사형(그런, 지난, 놓친, 주기)
// ponytail: 관형형은 시험 대본에서 새어 나온 것만 적었다. 기록에서 더 나오면 여기에 더한다.
const COMMON = new Set(('지금 조금 어디 저희 우리 오늘 이번 다음 정말 아주 매우 너무 가장 아직 자주 물론 미리 직접 항상 잠깐 그대 이것 그것 여기 거기 먼저 이제 처음 사실 실제 부분 경우 때문 정도 이상 동안 시간 문제 생각 말씀 질문 사람 하나 모두 계속 다시 그냥 진짜 혹시 결국 바로 함께 발표 화면 ' +
  '그런 이런 저런 어떤 모든 다른 여러 만든 지난 놓친 놓치 놓칠 멈춘 맞출 주기 따라가 물어볼').split(' '));
const A_RECENT = 20, A_AHEAD = 60, A_SENTS = 2;  // 최근 20음절 안에서, 60글자와 다음 두 문장까지만
// 글자 비교로 따라가다가 처음 키워드로 옮길 때는 14글자까지만. 애드리브에서 뒷문장 낱말 두 개를 말하면 한 문장씩 끌려갔다.
// 어림 상태에서 지난번 키워드 문장에 이어지는 문장이 맞을 때만 끝까지 간다(anchorHit의 next).
const A_FIRST = 14;

// s: 정규화한 대본, words: 대본 어절 [{ n0, n1, s, t }] (정규화 위치, 문장 번호, 원문)
// variants: { 키워드: [다른 말, ...] }. '발표 준비'에서 AI가 만든 다른 말(휴대폰 → 핸드폰)을 같은 키워드로 더한다.
// 반환 { st: 문장마다 정규화 시작 위치, list: [{ k: 찾을 말, id: 키워드, sent, end: 그 어절이 끝나는 위치 }] }
// ponytail: 형태소 분석 없이 끝 글자로 조사와 용언을 가른다. 조사 없이 쓴 '아이디어', '결과'(→결) 같은 명사는 놓치고,
// COMMON에 없는 관형형은 키워드로 남는다. 기록에서 문제가 되면 작은 용언·명사 목록을 더한다.
function anchors(s, words, variants = {}) {
  const st = [], per = [];
  for (const w of words) {
    st[w.s] ??= w.n0;
    const nw = s.slice(w.n0, w.n1), k = nw.replace(JOSA, '');
    if (k.length < 2 || (k === nw ? PRED : PRED2).test(k) || COMMON.has(k)) continue;
    // 숫자에서 나온 두 음절(2주 → 이주, 4회 → 사회)은 '학생들이 주로'처럼 어절 경계를 넘어 맞아서 뺀다
    if (k.length < 3 && /\d/.test(w.t)) continue;
    (per[w.s] ??= []).push({ k, end: w.n1, sent: w.s });
  }
  const sent = st.map((x, i) => s.slice(x, st[i + 1] ?? s.length));
  const vs = new Map(Object.entries(variants).map(([k, v]) => [norm(k), v.map(norm).filter(x => x.length >= 2)]));
  const list = [];
  for (const ks of per) {
    const keep = (ks || []).filter(a => sent.filter(t => t.includes(a.k)).length <= 2);
    for (const a of keep) {
      // 한 낱말이 다른 키워드를 품으면 같은 키워드로 센다 (에이아 ⊂ 에이아이를 두 개로 세지 않게)
      a.id = keep.reduce((m, b) => a.k.includes(b.k) && b.k.length < m.length ? b.k : m, a.k);
      list.push(a);
      for (const v of vs.get(a.k) || []) list.push({ ...a, k: v });
    }
  }
  return { st, list };
}

// 최근 들은 말에 같은 문장의 서로 다른 키워드가 2개 이상 있으면 { pos: 그 문장에서 가장 뒤 키워드의 어절 끝, sent, next }. 없으면 null
// 앞으로만 가고, 지금 위치(어림 상태는 아래)에서 60글자와 다음 두 문장을 넘지 않는다. 여러 문장이 맞으면 가까운 문장.
// s(정규화한 대본)를 주면 방금 읽은 대본(커서 앞 20글자)에 있는 키워드는 안 센다. 이웃 문장에 같은 낱말이 있으면
// 그대로 읽고 난 뒤 아무 말에나 다음 문장으로 넘어가기 때문이다.
// approx: 어림 상태면 지난번 키워드 문장. 그 문장이나 그 뒤 키워드가 있는 첫 문장이 맞으면 이어 읽는 중이다(next).
// 이때는 세 음절 이상 키워드 하나로도 되고, 거리와 문장 수를 그 문장 시작에서 잰다(커서는 14글자만 갔어도 말은 거기까지 왔다).
function anchorHit(A, h, cur, s = '', approx = null) {
  const recent = h.slice(-A_RECENT), back = s.slice(Math.max(0, cur - A_RECENT), cur), by = [];
  const base = approx === null ? cur : Math.max(cur, A.st[approx]);
  let c = 0;
  while (c + 1 < A.st.length && A.st[c + 1] <= base) c++;
  for (const a of A.list) {
    if (a.end <= cur || a.end > base + A_AHEAD || a.sent > c + A_SENTS || !recent.includes(a.k) || back.includes(a.k)) continue;
    const g = by[a.sent] ??= new Map();
    g.set(a.id, Math.max(g.get(a.id) || 0, a.end));
  }
  const next = i => approx !== null && i >= approx && !A.list.some(x => x.sent > approx && x.sent < i);
  // 두 음절 하나는 '개인정보'의 '정보'처럼 다른 말 속에서도 맞아서 둘 이상이어야 한다
  const sent = by.findIndex((g, i) => g?.size >= 2 || (g && next(i) && [...g.keys()].some(k => k.length >= 3)));
  return sent < 0 ? null : { pos: Math.max(...by[sent].values()), sent, next: next(sent) };
}

// 들은 말 h로 커서를 어디로 옮길지 정한다. app.js onHeard와 아래 시뮬레이션이 같이 쓴다.
// A: anchors() 결과(없으면 글자 비교만), pending: 확인을 기다리는 먼 위치,
// approx: 어림 상태면 지난번 키워드 이동의 문장 번호(글자가 아직 안 맞음), 아니면 null
// 반환 { how, pos, pending, sent }  how: 'voice' 글자 비교로 맞음, 'wait' 맞았지만 확인 대기, 'anchor' 키워드로 어림(sent: 맞은 문장), '' 못 찾음
function follow(S, A, h, cur, pending, approx = null) {
  const r = locate(S.s, h, cur, S.end);
  if (!r) {
    // 키워드는 글자 비교가 실패했을 때만 쓰고, 확인 대기 중인 먼 위치를 확인해 주지 않는다
    const a = A && anchorHit(A, h, cur, S.s, approx);
    if (!a) return { how: '', pos: cur, pending };
    // 끝까지 옮기는 건 이어 읽는 중(next)일 때만. 처음이거나 키워드 문장을 건너뛰면 14글자까지(애드리브가 이어지면 끌려갔다).
    return { how: 'anchor', pos: a.next ? a.pos : Math.min(a.pos, cur + A_FIRST), pending: null, sent: a.sent };
  }
  const d = r.pos - cur;
  // 뒤로 가거나 멀리 뛰는 건, 이어서 한 말도 그 위치에서 앞으로 맞아야 반영
  if (d >= -2 && d <= 30) return { how: 'voice', pos: Math.max(cur, r.pos), pending: null };
  if (pending !== null && r.pos > pending && r.pos - pending <= 20) return { how: 'voice', pos: r.pos, pending: null };
  return { how: 'wait', pos: cur, pending: r.pos };
}

// 어절 하나씩 들려주며 follow()로 커서를 옮긴다. 줄마다 인식 세션 하나(app.js의 heard, cut과 같은 방식).
// 반환: 어절마다 커서 위치와 그때 how
function play(S, A, lines, cur, heard = '') {
  let pending = null, approx = null;
  const out = [];
  for (const line of lines) {
    const ws = line.split(' ');
    let cut = 0, sn = '';
    for (let w = 1; w <= ws.length; w++) {
      sn = norm(ws.slice(0, w).join(' '));
      const f = follow(S, A, heard + sn.slice(cut), cur, pending, approx);
      pending = f.pending;
      if (f.how === 'anchor') { heard = ''; cut = sn.length; approx = f.sent; }
      if (f.how === 'voice') approx = null;
      cur = f.pos;
      out.push({ cur, how: f.how });
    }
    heard = (heard + sn.slice(cut)).slice(-60);
  }
  return out;
}

// node match.js 로 실행하면 확인
if (typeof module === 'object') {
  const assert = require('assert');
  const S = normMap('안녕하세요, 여러분. 오늘은 라이브스크립트를 소개하겠습니다.\n발표할 때 대본을 놓치지 않게 도와주는 서비스입니다.');
  const end = w => S.s.indexOf(norm(w)) + norm(w).length;
  const L = (h, cur) => locate(S.s, norm(h), cur, S.end);

  assert.equal(L('오늘은라이브 스크립트를', 0).pos, end('라이브스크립트를'), '띄어쓰기가 달라도 찾기');
  // 마지막 음절을 잘못 들으면 한 글자 덜 간다. 앞질러 가는 것보다 낫다. (마지막 3음절에는 을/를 할인도 없다)
  assert.equal(L('오늘은 라이브스크립트을', 0).pos, end('라이브스크립트를') - 1, '마지막 음절 오인식');
  assert.equal(L('오늘은 라이브스크립트를 점심', 0).pos, end('라이브스크립트를'), '애드리브가 시작돼도 앞질러 가지 않기');
  assert.equal(L('발표할 때 대분을 놓치지', 20).pos, end('놓치지'), '중간 음절 오인식');
  assert.equal(L('점심 메뉴는 김치찌개로 하죠', 0), null, '대본과 상관없는 말');
  assert.equal(L('여러분', 0), null, '너무 짧으면 판단 안 함');
  assert.equal(norm('대본을 읽다'.normalize('NFD')), '대본을읽다', 'NFD 한글');
  assert.equal(L('발표할 때 대본을 놓치지'.normalize('NFD'), 20).pos, end('놓치지'), 'NFD로 들어와도 찾기');

  const R = norm('감사합니다. 오늘 발표를 시작하겠습니다. 감사합니다.');
  const cur = R.indexOf('시작하겠습니다') + 7;
  assert.equal(locate(R, norm('감사합니다'), cur).pos, R.length, '같은 말이 두 번이면 가까운 쪽');

  // 조금 다르게 읽어도 따라가기 (괄호 안은 1단계 결과)
  assert.equal(L('대본을 놓치지 않게 서비스입니다', 30).pos, S.s.length, '낱말 건너뛰기 (null)');
  assert.equal(L('소개해요 발표할 때 대본을', 10).pos, end('대본을'), '어미 바꿈 뒤 이어 읽기 (null)');
  assert.equal(L('발표 때 대본 놓치지 않게', 25).dist, 0.6, '조사·어미 건너뛰기는 0.3씩 (2)');
  assert.equal(L('발표할 때 대본를 놓치지 않게', 25).dist, 0.3, '조사 짝 을/를 (1)');
  assert.equal(L('발표할 때 데본을 놓치지', 20).dist, 0.3, 'ㅐ/ㅔ (1)');
  assert.equal(L('발표할 때 대본을 놓치지 앉게', 20).dist, 1.5, '마지막 3음절은 할인 없음, 전혀 다르면 1.5 (1)');
  for (const junk of ['질문 있으신 분 손 들어 주세요', '화면이 잘 보이시나요 뒤에도', '제가 어제 회사에서 들은 얘기인데요'])
    assert.equal(L(junk, 0), null, '상관없는 말: ' + junk);

  // 표기 맞추기
  assert.equal(norm('2026년'), '이천이십육년');
  assert.equal(norm('1000 10000 100000000 1234567 105 11'), '천만일억백이십삼만사천오백육십칠백오십일');
  assert.equal(norm('1,000명 3.14 0.5초 0'), '천명삼점일사영점오초영', '쉼표, 소수점');
  assert.equal(norm('010-1234-5678'), '공일공천이백삼십사오천육백칠십팔', '0으로 시작하면 한 자리씩');
  assert.equal(norm('15% AI가 PDF를 HTML5 iPhone OpenAI ai'), '십오퍼센트에이아이가피디에프를에이치티엠엘오iphoneopenaiai', '약어, %');
  assert.equal(norm('2026.'), '이천이십육', '문장 끝 마침표는 소수점이 아니다');
  assert.equal(norm('2026.10.11. 2026.03.05 3.5.'), '이천이십육십십일이천이십육삼오삼점오', '점 찍은 날짜는 소수가 아니다');
  const D = normMap('발표일은 2026.10.11. 토요일');
  assert.equal(locate(D.s, norm('발표일은 2026년 10월 11일'), 0, D.end)?.pos, D.s.indexOf('토요일'), '날짜를 년·월·일로 들어도');

  // 원문 위치: 한 글자가 여러 음절로 늘면 같은 위치가 반복된다
  const T = '올해 2026년 AI 시장은 15% 성장';
  const N = normMap(T);
  assert.equal(N.s.length, N.at.length);
  assert.deepEqual(N.at.slice(2, 8), [3, 3, 3, 3, 3, 7], '이천이십육 -> 2026의 시작 위치');
  assert.equal(T[N.at[N.s.indexOf('퍼센트')]], '%');
  const toNorm = [];  // app.js build()와 같은 계산
  for (let i = 0, k = 0; i <= T.length; i++) { while (k < N.at.length && N.at[k] < i) k++; toNorm[i] = k; }
  assert.equal(toNorm[T.indexOf('2026')], 2);
  assert.equal(toNorm[T.indexOf(' AI')], N.s.indexOf('에이아이'), '어절 끝 = 다음 어절 시작');
  assert.equal(toNorm[T.indexOf('AI') + 2], N.s.indexOf('시장'));
  assert.equal(toNorm[T.length], N.s.length);

  const P = (h, cur = 0) => locate(N.s, norm(h), cur, N.end)?.pos;
  assert.equal(P('올해 이천이십육 년 에이아이 시장은'), N.s.indexOf('시장은') + 3, '숫자·약어를 소리로 읽어도');
  assert.equal(P('올해 2026년 AI 시장은'), N.s.indexOf('시장은') + 3, '인식기가 숫자로 줘도');
  assert.equal(P('시장은 십오 퍼센트 성장'), N.s.length, '퍼센트');

  // 문장 키워드 (app.js build()처럼 어절마다 정규화 위치와 문장 번호를 만든다. 여기서는 한 줄이 한 문장)
  const toWords = lines => {
    const w = [];
    let o = 0;
    lines.forEach((t, s) => t.split(/\s+/).filter(Boolean).forEach(x => w.push({ s, t: x, n0: o, n1: o += norm(x).length })));
    return w;
  };
  const KS = ['오늘은 휴대폰 마이크로 들은 말을 글자로 바꿉니다.', '그 글자를 대본과 비교해서 위치를 찾습니다.',
    '시끄러운 강의실에서는 음성 인식이 자주 틀립니다.', '음성 인식이 틀리면 손으로 고칩니다.', '음성 인식 결과는 기록에 남깁니다.',
    '마지막으로 발표 시간을 알려 줍니다.', 'AI 모델과 AI가 쓴 요약을 비교한 표입니다.'];
  const KN = normMap(KS.join('\n')), KW = toWords(KS), KA = anchors(KN.s, KW);
  const keys = i => [...new Set(KA.list.filter(a => a.sent === i).map(a => a.k))].join(' ');
  assert.equal(keys(0), '휴대폰 마이크 글자', '조사 떼기, 흔한 말(오늘)과 용언(바꿉니다) 빼기');
  assert.equal(keys(1), '글자 대본 위치', '두 문장에 나오는 글자는 키워드');
  assert.equal(keys(2), '강의실', '세 문장에 나오는 음성·인식, 용언(시끄러운), 흔한 말(자주)은 빼기');
  assert.equal(keys(5), '마지막', '흔한 두 음절(발표, 시간)과 알려는 빼기');
  const wEnd = w => KN.s.indexOf(norm(w)) + norm(w).length;  // 그 어절이 대본에서 끝나는 위치 (처음 나오는 것)
  const hit = (h, cur = 0, B = KA) => anchorHit(B, norm(h), cur)?.pos ?? null;
  assert.equal(hit('그 휴대폰 있잖아요'), null, '키워드 하나로는 안 옮김');
  assert.equal(hit('휴대폰 휴대폰'), null, '같은 키워드 두 번도 하나');
  assert.equal(hit('제 휴대폰에 있는 마이크'), wEnd('마이크로'), '서로 다른 키워드 두 개면 마지막 키워드 어절 끝');
  assert.equal(hit('마이크 휴대폰'), wEnd('마이크로'), '순서가 바뀌어도 대본에서 뒤쪽 키워드');
  assert.equal(hit('마이크 휴대폰', wEnd('마이크로')), null, '앞으로만');
  assert.equal(hit('휴대폰 마이크 이런 얘기 저런 얘기를 한참 하다가 이제 끝'), null, '최근 20음절 안에서만');
  assert.equal(hit('결과는 기록에', wEnd('시끄러운')), wEnd('기록에'), '지금 문장에서 두 문장 뒤까지');
  assert.equal(hit('휴대폰 글자 대본'), wEnd('글자로'), '두 문장이 맞으면 가까운 문장');
  assert.equal(hit('강의실 마지막', 0), null, '다른 문장 키워드끼리는 안 셈');
  const LS = ['시작합니다.', '이 문장은 일부러 길게 써서 키워드가 맨 끝에 오도록 만들었고 그 사이에는 별 뜻 없는 말이 아주 오래 계속 이어지다가 마지막에 오렌지와 바나나를 먹었습니다.'];
  const LN = normMap(LS.join(' ')), LA = anchors(LN.s, toWords(LS)), ban = LN.s.indexOf('바나나를') + 4;
  assert.ok(ban > 60 && anchorHit(LA, norm('오렌지 바나나'), 0) === null, '60글자보다 멀면 안 옮김');
  assert.equal(anchorHit(LA, norm('오렌지 바나나'), ban - 60).pos, ban);
  const SS = ['네.', '좋아요.', '그렇죠.', '오렌지를 바나나와 먹어요.'];
  const SN = normMap(SS.join(' ')), SA = anchors(SN.s, toWords(SS)), sb = SN.s.indexOf('바나나와') + 4;
  assert.equal(anchorHit(SA, norm('오렌지 바나나'), 0), null, '가까워도 다음 두 문장보다 뒤는 안 봄');
  assert.equal(anchorHit(SA, norm('오렌지 바나나'), 1).pos, sb);
  const ai = KN.s.indexOf(norm('마지막으로'));
  assert.ok(hit('에이아이 모델', ai) > ai && hit('에이아이', ai) === null, '에이아(AI)와 에이아이(AI가)는 한 키워드');
  const KV = anchors(KN.s, KW, { 휴대폰: ['핸드폰', '폰'] });
  assert.equal(hit('핸드폰 마이크', 0, KV), wEnd('마이크로'), 'AI가 만든 다른 말도 키워드');
  assert.equal(hit('핸드폰 휴대폰', 0, KV), null, '다른 말은 원래 키워드와 같은 하나');
  assert.ok(!KV.list.some(a => a.k === '폰'), '한 음절 다른 말은 버림');
  // 어림 상태(지난번 키워드 문장 0)에서 이어지는 문장은 세 음절 이상 키워드 하나로도. 두 음절 하나는 안 됨.
  assert.equal(anchorHit(KA, norm('휴대폰'), 0, '', 0)?.pos, wEnd('휴대폰'), '이어 읽을 때는 세 음절 키워드 하나로');
  assert.equal(anchorHit(KA, norm('글자'), 0, '', 0), null, '두 음절 키워드 하나로는 안 됨');
  assert.equal(anchorHit(KA, norm('휴대폰'), 0), null, '어림 상태가 아니면 하나로는 안 됨');
  // 시험 대본에서 새어 나온 키워드: 겹친 조사(경우에는), 관형사(그런, 다른), 숫자에서 나온 두 음절(2주 -> 이주)
  const QS = ['오늘은 저희가 만든 출석 확인 앱을 소개하겠습니다.', '교수님이 이름을 부르는 데만 수업마다 오 분이 걸립니다.',
    '그런 경우에는 다른 방식이 필요하다고 생각했습니다.', '학생 30명이 2주 동안 써 보았습니다.'];
  const QN = normMap(QS.join('\n')), QA = anchors(QN.s, toWords(QS)), q1 = norm(QS[0]).length;
  const qkeys = i => [...new Set(QA.list.filter(a => a.sent === i).map(a => a.k))].join(' ');
  assert.equal(qkeys(2), '방식', '겹친 조사, 관형사 빼기');
  assert.equal(qkeys(3), '학생 삼십명', '숫자에서 나온 두 음절(이주) 빼기');
  assert.equal(play(QN, QA, ['어 그런데 다른 질문 있으신 분 계신가요'], q1, QN.s.slice(0, q1)).pop().cur, q1, '그런데 다른 질문: 안 움직임');
  // 이웃 문장에 같은 낱말이 있으면, 그대로 읽은 뒤 아무 말에나 다음 문장으로 넘어가지 않기
  const RS = ['오늘은 회의록 요약 기능을 소개하겠습니다.', '회의록 요약 기능은 녹음 파일을 올리면 바로 동작합니다.', '그다음 화면에서 결과를 확인합니다.'];
  const RN = normMap(RS.join('\n')), RA = anchors(RN.s, toWords(RS)), r1 = norm(RS[0]).length;
  assert.deepEqual(play(RN, RA, [RS[0], '자 그러면'], 0).slice(-2).map(x => x.cur), [r1, r1], '방금 읽은 키워드는 안 셈');

  // follow(): 글자 비교가 먼저, 키워드는 실패했을 때만. 처음 키워드 이동은 14글자까지, 어림 상태에서는 끝까지.
  const KF = { s: KN.s, end: KN.end }, gj = wEnd('글자로');
  assert.ok(gj > 14 && hit('제 휴대폰에 있는 글자') === gj);
  assert.deepEqual(follow(KF, KA, norm('제 휴대폰에 있는 글자'), 0, null), { how: 'anchor', pos: 14, pending: null, sent: 0 }, '처음엔 14글자까지');
  assert.equal(follow(KF, KA, norm('제 휴대폰에 있는 글자'), 0, null, 0).pos, gj, '어림 상태이고 같은 문장이면 키워드 위치까지');
  const sk = wEnd('시끄러운');
  assert.equal(follow(KF, KA, norm('기록 결과'), sk, null, 3).pos, wEnd('기록에'), '어림 상태에서 다음 문장이면 끝까지');
  assert.equal(follow(KF, KA, norm('기록 결과'), sk, null, 2).pos, wEnd('기록에'), '키워드 없는 문장(3)은 건너뛰어도 이어 읽기');
  assert.equal(follow(KF, KA, norm('기록 결과'), sk, null, 1).pos, sk + 14, '키워드 문장(2)을 건너뛰면 다시 14글자까지');
  assert.equal(follow(KF, null, norm('제 휴대폰에 있는 글자'), 0, null).how, '', '키워드가 없으면 그대로');
  assert.equal(follow(KF, KA, norm('휴대폰 마이크로 들은 말을'), 0, null).how, 'voice', '글자가 맞으면 키워드를 안 씀');
  const pend = KN.s.indexOf(norm('결과는'));  // 확인을 기다리는 먼 위치
  const fp = follow(KF, KA, norm('대본 그리고 위치'), KN.s.indexOf(norm('그 글자를')), pend, 0);
  assert.ok(fp.how === 'anchor' && fp.pos === wEnd('위치를') && fp.pending === null, '키워드는 먼 위치를 확인해 주지 않고 대기도 지움');

  // 대본을 읽다가 같은 주제의 애드리브로 넘어갈 때 커서가 끌려가는 비율 (25문장 x 애드리브 20개 = 480가지)
  // 1단계 match.js로 같은 시뮬레이션을 돌리면 46/480이었다. 2차 1단계(글자 비교만)는 49/480, 최대 11글자.
  const t0 = Date.now(), r = adlibRate(1), r3 = adlibRate(3);
  console.log(`애드리브 중 커서 이동 ${r.moved}/${r.n} (${(r.moved / r.n * 100).toFixed(1)}%, 1단계 46/480 = 9.6%), 최대 ${r.max}글자, 키워드로 옮김 ${r.anchor}번` +
    ` / 세 줄 연달아 ${r3.moved}/${r3.n}, 최대 ${r3.max}글자, ${Date.now() - t0}ms`);
  assert.ok(r.moved / r.n <= 46 / 480 + 0.02, '1단계보다 2%p 넘게 늘지 않기');
  assert.ok(r.max < 15, '애드리브에 끌려가도 한 문장 넘게 뛰지 않기');
  assert.ok(r.anchor <= 5, '애드리브에 키워드가 맞는 경우는 드물게');
  // 애드리브 세 줄이 이어져도(질의응답 버튼 없이 질문에 답할 때) 한 번 키워드로 옮긴 뒤 끝까지 끌려가지 않기. 키워드 없이 최대 11글자.
  assert.ok(r3.max <= 30, '애드리브 세 줄: 한 문장 남짓까지만');
  assert.ok(r.at(4, '제가 대신 넘겨 주기도 했는데요 속도가 안 맞더라고요') === 0 && r.at(13, '긴장해서 말이 멈춘 적 평균 몇 번 있으세요') === 0,
    '명사형·관형형(주기, 멈춘) 키워드에 안 끌려감');
  assert.equal(r.at(12, '학생들이 주로 많이 물어보는 건데요'), 0, '숫자 두 음절(이주)이 어절 경계를 넘어 맞지 않기');

  // 같은 대본을 그대로, 조금 바꿔, 많이 바꿔 읽기 (중간에 대본 밖 말 두 줄). 어절마다 커서가 그 문장 안에 있는 비율
  // 키워드 없이(2차 1단계) 7문장 대본 100%, 84%, 12% / 12문장 대본 100%, 87%, 11%
  const DT = demoTakes();
  for (const [name, T] of Object.entries(DT)) {
    console.log(`읽기 시험(${name}) ` + Object.entries(T).map(([k, v]) => `${k} ${v.in}%`).join(', '));
    assert.equal(T['그대로'].in, 100);
    assert.ok(T['조금 바꿔'].in >= 84, '조금 바꿔 읽기는 그대로');
    for (const k in T) assert.ok(T[k].ahead === 0 && T[k].off === 0, k + ': 앞질러 가거나 대본 밖 말에 움직이지 않기');
  }
  assert.ok(DT['7문장']['많이 바꿔'].in >= 20 && DT['12문장']['많이 바꿔'].in >= 35, '많이 바꿔 읽기 12%, 11% -> 20%, 35% 이상');

  console.log('match.js ok');

  // 대본의 각 문장 끝에서 애드리브 nl줄(20개 중 7개씩 건너 고름)을 어절 하나씩 들려주며, app.js onHeard와 같은 규칙으로 커서가 움직이는지 센다
  // at(k, 줄): 문장 k 끝에서 그 줄을 말한 뒤 커서가 움직인 거리
  function adlibRate(nl) {
    const SCRIPT = `안녕하세요, 오늘 발표를 맡은 배진혁입니다.
저희 팀은 지난 3개월 동안 발표 보조 서비스를 만들었습니다.
먼저 저희가 이 문제에 관심을 가지게 된 계기부터 말씀드리겠습니다.
대학생 200명에게 설문을 해 보니 절반 이상이 발표 중에 대본을 놓친 경험이 있다고 답했습니다.
특히 긴장하면 어디까지 읽었는지 찾느라 말이 끊기는 경우가 많았습니다.
기존 프롬프터 앱은 일정한 속도로 화면을 올려 주기 때문에 발표자의 속도와 맞지 않습니다.
그래서 저희는 발표자의 목소리를 듣고 대본 위치를 따라가는 방식을 택했습니다.
원리는 간단합니다.
휴대폰 마이크로 들은 말을 글자로 바꾸고, 그 글자를 대본과 비교해서 지금 읽는 곳을 찾습니다.
찾은 위치는 화면에서 밑줄과 배경색으로 표시됩니다.
발표자가 잠깐 대본 밖의 이야기를 해도 위치는 그대로 유지됩니다.
다시 대본으로 돌아오면 자연스럽게 이어서 따라갑니다.
다음으로 실제 사용 결과를 보여 드리겠습니다.
교내 발표 수업에서 학생 30명이 2주 동안 이 앱을 써 보았습니다.
대본을 놓쳐서 말이 멈춘 횟수가 평균 4회에서 1회로 줄었습니다.
발표 시간도 목표 시간에 더 가깝게 맞출 수 있었다는 의견이 많았습니다.
물론 아직 부족한 점도 있습니다.
대본과 많이 다르게 말하면 위치를 놓치는 문제가 남아 있습니다.
또 시끄러운 강의실에서는 음성 인식이 자주 틀립니다.
이 부분은 다음 버전에서 AI 모델을 활용해 개선할 계획입니다.
앞으로는 예상 질문을 미리 만들어 주는 기능도 추가하려고 합니다.
발표 정보를 넣으면 청중이 물어볼 만한 질문과 답변을 정리해 줍니다.
저희의 목표는 누구나 긴장하지 않고 발표할 수 있게 돕는 것입니다.
지금까지 들어 주셔서 감사합니다.
질문 있으시면 편하게 해 주세요.`.split('\n');
    const OFF = `아 잠시만요 화면이 좀 안 넘어가네요
혹시 뒤에 계신 분들 소리 잘 들리시나요
이건 제가 직접 겪은 일인데요 작년에 발표하다가 완전히 머리가 하얘졌어요
질문 감사합니다 음성 인식은 지금 구글 서버를 쓰고 있습니다
대본을 미리 외우면 되지 않냐고 하실 수도 있는데요 그게 쉽지 않습니다
설문은 저희 학교 학생들을 대상으로 했고요 온라인으로 받았습니다
네 프롬프터 앱이랑 가장 큰 차이는 속도를 사람이 정하지 않는다는 점입니다
배터리는 한 시간 정도 쓰면 이십 퍼센트 정도 닳았어요
시끄러운 곳에서는 마이크를 가까이 대면 조금 나아집니다
영어 발표도 되냐는 질문이 많았는데 아직은 한국어만 됩니다
아이폰에서도 사파리로 들어가시면 똑같이 쓰실 수 있어요
발표 수업 교수님께서도 꽤 좋아하셨습니다
그 부분은 다음 슬라이드에서 자세히 말씀드릴게요
개인정보는 따로 저장하지 않고 대본도 휴대폰에만 남습니다
가격은 아직 정하지 않았고 당분간 무료로 운영할 예정입니다
다른 질문 있으신가요 네 뒤에 계신 분
대본 위치를 놓치면 손으로 눌러서 옮길 수도 있습니다
예상 질문 기능은 지금 개발 중이라 시연은 어렵습니다
이 숫자는 저희가 직접 세어 본 거라 조금 오차가 있을 수 있어요
마이크 권한을 허용하지 않으면 손으로만 넘길 수 있습니다`.split('\n');
    const S = normMap(SCRIPT.join('\n')), A = anchors(S.s, toWords(SCRIPT));
    const ends = [];
    let o = 0, moved = 0, n = 0, max = 0, anchor = 0;
    for (const t of SCRIPT) ends.push(o += norm(t).length);
    const run = (k, lines) => play(S, A, lines, ends[k], S.s.slice(Math.max(0, ends[k] - 60), ends[k]));
    for (let k = 0; k < SCRIPT.length - 1; k++) for (let i = 0; i < OFF.length; i++) {
      const start = ends[k], out = run(k, Array.from({ length: nl }, (_, j) => OFF[(i + j * 7) % OFF.length]));
      n++;
      if (out[out.length - 1].cur !== start) moved++;
      if (out.some(x => x.how === 'anchor')) anchor++;
      for (const x of out) max = Math.max(max, Math.abs(x.cur - start));
    }
    return { moved, n, max, anchor, at: (k, line) => run(k, [line]).pop().cur - ends[k] };
  }

  // 손으로 만든 예시 두 벌(12문장은 따로 쓴 것). 실제 평가는 기록 내려받기로 모은 인식 결과로 같은 계산을 한다.
  function demoTakes() {
    const SCRIPT = ['안녕하세요, 저는 라이브스크립트 팀의 배진혁입니다.', '발표를 하다 보면 대본을 어디까지 읽었는지 놓칠 때가 많습니다.',
      '저희는 이 문제를 음성 인식으로 풀어 보려고 합니다.', '발표자가 말하면 화면의 대본에서 지금 읽는 곳이 자동으로 표시됩니다.',
      '2026년 기준으로 휴대폰 브라우저만 있으면 따로 설치할 것이 없습니다.', '대본과 조금 다르게 말해도 위치를 놓치지 않는 것이 이번 목표입니다.',
      '마지막으로 리허설 기록을 분석해서 말하는 속도도 알려 드립니다.'];
    const TAKES = {
      '그대로': SCRIPT,
      '조금 바꿔': ['안녕하세요 라이브스크립트 팀 배진혁입니다', '발표하다 보면 대본 어디까지 읽었는지 자주 놓치잖아요',
        '그래서 저희는 이걸 음성 인식으로 풀어 보려고 해요', '말을 하면 화면 대본에서 지금 읽는 곳이 자동으로 표시가 돼요',
        '이천이십육 년 기준으로 휴대폰 브라우저만 있으면 설치할 게 없어요', '대본이랑 조금 다르게 말해도 위치를 안 놓치는 게 목표입니다',
        '마지막으로 리허설 기록을 분석해서 말 속도도 알려 드려요'],
      '많이 바꿔': ['네 반갑습니다 라이브스크립트 만들고 있는 배진혁이라고 합니다', '발표할 때 내가 대본 어디 읽고 있었지 하고 헤맨 적 있으시죠',
        '이걸 음성 인식 기술로 해결해 보자는 게 저희 아이디어입니다', '제가 말하는 대로 화면에 지금 위치가 따라오는 거죠',
        '설치 같은 건 필요 없고 휴대폰 브라우저면 충분합니다', '대본 그대로 안 읽어도 따라오게 만드는 게 이번 목표고요',
        '끝으로 리허설 기록으로 말 빠르기까지 알려 드립니다'],
    };
    const SCRIPT2 = ['안녕하세요, 오늘은 도서관 좌석 예약 앱을 소개하겠습니다.', '시험 기간이 되면 열람실 자리를 맡으려고 아침부터 줄을 서는 학생이 많습니다.',
      '저희는 이 불편을 줄이려고 모바일 예약 시스템을 만들었습니다.', '학생증 번호로 로그인하면 남은 좌석이 지도 위에 색깔로 표시됩니다.',
      '원하는 좌석을 누르면 두 시간 동안 예약이 유지됩니다.', '자리를 비우고 30분이 지나면 예약은 자동으로 취소됩니다.',
      '그래서 가방만 두고 오래 자리를 비우는 문제가 줄어듭니다.', '지난 학기에 중앙도서관에서 한 달 동안 시범 운영을 했습니다.',
      '하루 평균 이용자는 800명 정도였고 만족도는 높았습니다.', '다만 와이파이가 약한 지하 열람실에서는 접속이 느렸습니다.',
      '다음 학기에는 출입 게이트와 연동해서 입실 확인을 자동으로 하려고 합니다.', '끝까지 들어 주셔서 감사합니다.'];
    const TAKES2 = {
      '그대로': SCRIPT2,
      '조금 바꿔': ['안녕하세요 오늘 도서관 좌석 예약 앱 소개해 드릴게요', '시험 기간 되면 열람실 자리 맡으려고 아침부터 줄 서는 학생들 많잖아요',
        '그래서 저희가 이 불편 줄이려고 모바일 예약 시스템을 만들었어요', '학생증 번호로 로그인하시면 남은 좌석이 지도에 색깔로 표시돼요',
        '원하는 좌석 누르시면 두 시간 동안 예약이 유지됩니다', '자리 비우고 삼십 분 지나면 예약이 자동으로 취소돼요',
        '그러니까 가방만 두고 자리 오래 비우는 문제가 줄어들죠', '지난 학기에 중앙도서관에서 한 달간 시범 운영을 해 봤습니다',
        '하루 평균 이용자가 팔백 명 정도였고 만족도도 높았어요', '다만 와이파이 약한 지하 열람실에서는 접속이 좀 느렸습니다',
        '다음 학기엔 출입 게이트랑 연동해서 입실 확인도 자동으로 하려고요', '끝까지 들어 주셔서 감사합니다'],
      '많이 바꿔': ['네 반갑습니다 오늘 제가 보여 드릴 건 도서관 자리 잡는 앱이에요', '시험 때마다 열람실 자리 때문에 새벽같이 줄 서 보신 분 계시죠',
        '그 고생을 없애 보려고 휴대폰으로 예약하는 시스템을 짰습니다', '학생증으로 들어가면 빈 좌석이 지도에 색으로 딱 보여요',
        '마음에 드는 좌석을 고르면 두 시간은 내 자리가 됩니다', '삼십 분 넘게 안 돌아오면 예약이 알아서 풀려요',
        '가방만 놓고 사라지는 사람들 이제 못 버티는 거죠', '중앙도서관에서 지난 학기 한 달간 시범으로 돌려 봤어요',
        '하루에 팔백 명쯤 썼고 반응도 좋았습니다', '근데 지하 열람실은 와이파이가 약해서 좀 버벅였어요',
        '다음엔 출입 게이트랑 묶어서 입실 체크까지 자동으로 해 보려고요', '들어 주셔서 고맙습니다'],
    };
    return { '7문장': score(SCRIPT, TAKES, [3, 6]), '12문장': score(SCRIPT2, TAKES2, [4, 8]) };
  }

  // offAt: 대본 밖 말 두 줄을 끼워 넣는 위치
  function score(SCRIPT, TAKES, offAt) {
    const S = normMap(SCRIPT.join(' ')), A = anchors(S.s, toWords(SCRIPT)), st = [];
    let o = 0;
    for (const t of SCRIPT) { st.push(o); o += norm(t).length; }
    const res = {};
    for (const [name, take] of Object.entries(TAKES)) {
      const lines = take.map((t, i) => [t, i]);
      lines.splice(offAt[0], 0, ['혹시 뒤에 소리 잘 들리시나요', -1]);
      lines.splice(offAt[1], 0, ['잠깐 물 좀 마시겠습니다', -1]);
      const out = play(S, A, lines.map(x => x[0]), 0);
      let i = 0, inS = 0, tot = 0, ahead = 0, off = 0, prev = 0;
      for (const [t, s] of lines) for (const _ of t.split(' ')) {
        const cur = out[i++].cur, e = st[s + 1] ?? S.s.length;
        if (s < 0) off += cur !== prev;
        else { tot++; inS += st[s] <= cur && cur <= e; ahead += cur > e; }
        prev = cur;
      }
      res[name] = { in: Math.round(inS / tot * 100), ahead, off };
    }
    return res;
  }
}
