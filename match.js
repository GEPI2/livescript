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

  // 대본을 읽다가 같은 주제의 애드리브로 넘어갈 때 커서가 끌려가는 비율 (25문장 x 애드리브 20개 = 480가지)
  // 1단계 match.js로 같은 시뮬레이션을 돌리면 46/480이었다.
  const t0 = Date.now(), r = adlibRate();
  console.log(`애드리브 중 커서 이동 ${r.moved}/${r.n} (${(r.moved / r.n * 100).toFixed(1)}%, 1단계 46/480 = 9.6%), 최대 ${r.max}글자, ${Date.now() - t0}ms`);
  assert.ok(r.moved / r.n <= 46 / 480 + 0.02, '1단계보다 2%p 넘게 늘지 않기');
  assert.ok(r.max < 15, '애드리브에 끌려가도 한 문장 넘게 뛰지 않기');

  console.log('match.js ok');

  // 대본의 각 문장 끝에서 애드리브를 어절 하나씩 들려주며, app.js onHeard와 같은 규칙으로 커서가 움직이는지 센다
  function adlibRate() {
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
    const S = normMap(SCRIPT.join('\n'));
    const ends = [];
    let o = 0, moved = 0, n = 0, max = 0;
    for (const t of SCRIPT) ends.push(o += norm(t).length);
    for (let k = 0; k < SCRIPT.length - 1; k++) for (const off of OFF) {
      let cur = ends[k], pending = null, start = cur;
      const words = off.split(' '), before = S.s.slice(Math.max(0, cur - 60), cur);
      for (let w = 1; w <= words.length; w++) {
        const r = locate(S.s, (before + norm(words.slice(0, w).join(' '))).slice(-60), cur, S.end);
        if (!r) continue;
        const d = r.pos - cur;
        if (d < -2 || d > 30) {
          if (pending !== null && r.pos > pending && r.pos - pending <= 20) { pending = null; cur = r.pos; }
          else if (pending === null || r.pos !== pending) pending = r.pos;
          continue;
        }
        pending = null;
        if (d > 0) cur = r.pos;
      }
      n++;
      if (cur !== start) moved++;
      max = Math.max(max, Math.abs(cur - start));
    }
    return { moved, n, max };
  }
}
