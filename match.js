// 대본과 들은 말을 비교해서 지금 읽는 위치를 찾는다.
// 한국어 음성 인식은 띄어쓰기가 대본과 자주 달라서, 공백·문장부호를 빼고 음절 단위로 비교한다.

const BACK = 60, AHEAD = 150, TAIL = 12;

// 맥이나 일부 PDF에서 복사한 한글은 자모가 분리된 NFD라서 NFC로 합친 뒤 비교한다
function norm(s) {
  return s.normalize('NFC').toLowerCase().replace(/[^0-9a-z가-힣]/g, '');
}

// 정규화된 문자열과, 각 글자가 원문 몇 번째 글자였는지
function normMap(text) {
  let s = '';
  const at = [];
  for (let i = 0; i < text.length; i++) {
    if (/[0-9a-z가-힣]/i.test(text[i])) { s += text[i].toLowerCase(); at.push(i); }
  }
  return { s, at };
}

// 최근 들은 TAIL 음절이 현재 위치 주변 어디서 끝나는지 편집 거리로 찾는다.
// 반환: { pos: 그 지점까지 읽은 정규화 글자 수, dist } 또는 못 찾으면 null
// ponytail: 글자 비교라서 대본을 풀어 말하면 못 잡는다. 2단계에서 문장 단위 키워드/의미 매칭으로 확장.
function locate(script, heard, cur) {
  const p = heard.slice(-TAIL), m = p.length;
  if (m < 5) return null;
  const from = Math.max(0, cur - BACK), t = script.slice(from, cur + AHEAD), n = t.length;
  let prev = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    const row = [i];
    for (let j = 1; j <= n; j++)
      row[j] = Math.min(prev[j - 1] + (p[i - 1] !== t[j - 1]), prev[j] + 1, row[j - 1] + 1);
    prev = row;
  }
  // 거리가 같으면 현재 위치에 가까운 쪽 (대본에 같은 말이 여러 번 나올 때 엉뚱한 데로 안 튀게)
  let best = 1;
  for (let j = 2; j <= n; j++)
    if (prev[j] < prev[best] || (prev[j] === prev[best] && Math.abs(from + j - cur) < Math.abs(from + best - cur))) best = j;
  return prev[best] <= Math.floor(m * 0.3) ? { pos: from + best, dist: prev[best] } : null;
}

// node match.js 로 실행하면 확인
if (typeof module === 'object') {
  const assert = require('assert');
  const S = normMap('안녕하세요, 여러분. 오늘은 라이브스크립트를 소개하겠습니다.\n발표할 때 대본을 놓치지 않게 도와주는 서비스입니다.');
  const end = w => S.s.indexOf(norm(w)) + norm(w).length;

  assert.equal(locate(S.s, norm('오늘은라이브 스크립트를'), 0).pos, end('라이브스크립트를'), '띄어쓰기가 달라도 찾기');
  // 마지막 음절을 잘못 들으면 한 글자 덜 간다. 앞질러 가는 것보다 낫다.
  assert.equal(locate(S.s, norm('오늘은 라이브스크립트을'), 0).pos, end('라이브스크립트를') - 1, '마지막 음절 오인식');
  assert.equal(locate(S.s, norm('오늘은 라이브스크립트를 점심'), 0).pos, end('라이브스크립트를'), '애드리브가 시작돼도 앞질러 가지 않기');
  assert.equal(locate(S.s, norm('발표할 때 대분을 놓치지'), 20).pos, end('놓치지'), '중간 음절 오인식');
  assert.equal(locate(S.s, norm('점심 메뉴는 김치찌개로 하죠'), 0), null, '대본과 상관없는 말');
  assert.equal(locate(S.s, norm('여러분'), 0), null, '너무 짧으면 판단 안 함');
  assert.equal(norm('대본을 읽다'.normalize('NFD')), '대본을읽다', 'NFD 한글');

  const R = norm('감사합니다. 오늘 발표를 시작하겠습니다. 감사합니다.');
  const cur = R.indexOf('시작하겠습니다') + 7;
  assert.equal(locate(R, norm('감사합니다'), cur).pos, R.length, '같은 말이 두 번이면 가까운 쪽');

  console.log('match.js ok');
}
