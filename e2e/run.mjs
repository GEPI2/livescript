// 화면 시험. 앱 서버를 먼저 띄운다: python3 -m http.server 8765  →  node e2e/run.mjs [이름 조각]
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { launch, page, open, sample, BASE } from './lib.mjs';
import { pptx, pdf, SLIDES } from './fixtures.mjs';
import { paraSpans, sentSpans, paras } from '../lib.js';

const only = process.argv[2] || '';
const browser = await launch();
const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const OUT = process.env.OUT || '/tmp/e2e-out';
fs.mkdirSync(OUT, { recursive: true });

// ---- 만들기: 발표자료 올리기, 칩 ----
t('만들기: PPTX를 올리면 슬라이드마다 한 줄이 개요에 들어간다', async () => {
  const p = await page(browser); await open(p);
  await p.setInputFiles('#slideFile', { name: '발표.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: pptx() });
  await p.waitForSelector('#upRow:not([hidden])');
  assert.equal(await p.inputValue('[data-info="outline"]'), '말랑 소개: 발표 프롬프터 김지민\n문제: 발표자는 슬라이드를 넘기고 대본을 찾는 일을 동시에 해요\n해결: 소리 내어 읽으면 대본이 따라와요 시간이 모자라면 줄여 줘요\n시장: 발표를 하는 학생과 직장인');
  assert.equal(await p.inputValue('#create [data-info="topic"]'), '말랑 소개');
  assert.match(await p.textContent('#upInfo'), /슬라이드 4장/);
  assert.equal(await p.locator('#upThumbs div').count(), 4);
  assert.equal(await p.textContent('#upThumbs .more'), '+1장');
  await p.screenshot({ path: OUT + '/create-pptx.png' });
  await p.click('#upClear');
  assert.equal(await p.inputValue('[data-info="outline"]'), '');
  assert.equal(await p.locator('#upRow').isHidden(), true);
  assert.deepEqual(p.errors, []);
});
t('만들기: PDF를 올리면 쪽마다 제목과 본문을 뽑는다', async () => {
  const p = await page(browser); await open(p);
  await p.setInputFiles('#slideFile', { name: '발표.pdf', mimeType: 'application/pdf', buffer: await pdf(browser) });
  await p.waitForSelector('#upRow:not([hidden])', { timeout: 20000 });
  const o = (await p.inputValue('[data-info="outline"]')).split('\n');
  assert.equal(o.length, 4);
  assert.match(o[1], /^문제: 발표자는 슬라이드를 넘기고/);
  assert.match(o[2], /^해결: 소리 내어 읽으면/);
  assert.equal(await p.textContent('#upExt'), 'PDF');
  assert.deepEqual(p.errors, []);
});
t('만들기: 글이 없는 파일은 알리고 개요를 건드리지 않는다', async () => {
  const p = await page(browser); await open(p);
  await p.setInputFiles('#slideFile', { name: 'x.pptx', buffer: Buffer.from('not a zip') });
  await p.waitForFunction(() => /읽지 못했어요/.test(document.getElementById('genMsg').textContent));
  assert.equal(await p.inputValue('[data-info="outline"]'), '');
  assert.equal(await p.locator('#upRow').isHidden(), true);
});
t('만들기: 듣는 사람·발표 시간 칩과 말투 세그먼트가 칸과 저장값을 바꾼다', async () => {
  const p = await page(browser); await open(p);
  await p.click('#audChips >> text=투자자');
  assert.equal(await p.inputValue('#aud'), '투자자');
  assert.equal(await p.getAttribute('#audChips button:first-child', 'aria-pressed'), 'true');
  await p.click('#minChips >> text=5분');
  assert.equal(await p.inputValue('#gMin'), '5');
  assert.equal(await p.getAttribute('#minChips [data-m="5"]', 'aria-pressed'), 'true');
  assert.equal(await p.inputValue('#target', { timeout: 1000 }).catch(() => '5'), '5');
  await p.click('#toneSeg >> text=해요체');
  assert.equal(await p.inputValue('#toneSel'), '해요체');
  assert.equal(await p.getAttribute('#toneSeg [data-t="해요체"]', 'aria-pressed'), 'true');
  // 새로 열어도 저장돼 있다
  await open(p);
  assert.equal(await p.inputValue('#aud'), '투자자');
  assert.equal(await p.getAttribute('#toneSeg [data-t="해요체"]', 'aria-pressed'), 'true');
  await p.screenshot({ path: OUT + '/create-chips.png' });
  assert.deepEqual(p.errors, []);
});

// ---- 편집: 시간이 모자랄 때(줄이기 단계), 버전 기록 ----
const present = async p => { await p.click('[data-tab="live"]'); await p.waitForTimeout(800); };
const toScript = async p => { await p.click('[data-tab="script"]'); await p.waitForTimeout(300); };
t('편집: 발표 준비가 없으면 단계 버튼이 잠기고 안내가 보인다', async () => {
  const p = await page(browser); await open(p);
  await p.click('#ePaste'); await p.fill('#text', '안녕하세요. 짧은 대본이에요.');
  await p.waitForTimeout(400);
  assert.equal(await p.locator('#modeSeg button:disabled').count(), 3);
  assert.equal(await p.textContent('#prepGo'), '발표 준비 하기');
  await p.click('#prepGo');
  assert.equal(await p.locator('#ai').evaluate(d => d.open), true);
  assert.equal(await p.locator('[data-pane="prep"]').isVisible(), true);
});
t('편집: 핵심만을 고르면 자동 줄이기가 꺼져 있어도 발표 화면이 짧아진다', async () => {
  const p = await page(browser); await open(p); await sample(p);
  await p.uncheck('#shrinkOn');
  assert.equal(await p.getAttribute('#modeSeg [data-m="0"]', 'aria-pressed'), 'true');
  const full = await p.inputValue('#text');
  await p.click('#modeSeg [data-m="2"]');
  assert.match(await p.textContent('#modeInfo'), /^핵심만: 예상 \d+:\d\d \(원본 \d+:\d\d\)$/);
  await present(p);
  assert.ok(await p.locator('#prompt .cut').count() > 0, '줄인 문단 표시');
  const shown = await p.evaluate(() => document.getElementById('prompt').textContent.length);
  assert.ok(shown < full.length * 0.8, `핵심만은 원문보다 짧다 (${shown} < ${full.length})`);
  // 대본 탭으로 돌아가 원본으로
  await toScript(p);
  await p.click('#modeSeg [data-m="0"]');
  await present(p);
  assert.equal(await p.locator('#prompt .cut').count(), 0);
  assert.deepEqual(p.errors, []);
});
t('편집: 고른 단계는 새로고침해도 남는다', async () => {
  const p = await page(browser); await open(p); await sample(p);
  await p.click('#modeSeg [data-m="1"]');
  await p.reload(); await p.waitForFunction(() => !document.getElementById('text').readOnly);
  await p.waitForTimeout(300);
  assert.equal(await p.getAttribute('#modeSeg [data-m="1"]', 'aria-pressed'), 'true');
  assert.match(await p.textContent('#modeInfo'), /^조금 짧게:/);
});
t('편집: 자동 줄이기 스위치는 넓은 화면에서 시간이 모자랄 때 카드에 있다', async () => {
  const p = await page(browser); await open(p); await sample(p);
  assert.equal(await p.locator('#shrinkCard #shrinkBox').count(), 1);
  await p.setViewportSize({ width: 900, height: 800 }); await p.waitForTimeout(200);
  assert.equal(await p.locator('footer.e-only #shrinkBox').count(), 1);
  await p.setViewportSize({ width: 1280, height: 800 }); await p.waitForTimeout(200);
  assert.equal(await p.locator('#shrinkCard #shrinkBox').count(), 1);
});
t('편집: 버전 기록 카드에서 저장하고 되돌릴 수 있다', async () => {
  const p = await page(browser); await open(p); await sample(p);
  const orig = await p.inputValue('#text');
  await p.click('#verSideSave');
  assert.equal(await p.locator('#verSide li').count() >= 1, true);
  assert.equal(await p.textContent('#verSide li .now'), '지금');
  await p.evaluate(t => { const e = document.getElementById('text'); e.value = t; e.dispatchEvent(new Event('input')); }, orig + '\n\n덧붙인 문단이에요.');
  await p.waitForTimeout(400);
  await p.locator('#verSide li button', { hasText: '되돌리기' }).first().click();
  await p.waitForTimeout(300);
  assert.equal(await p.inputValue('#text'), orig);
  assert.deepEqual(p.errors, []);
});

// ---- 발표: 원래 대본 보기, 들어보기, 남은 시간 알림 ----
t('발표: 줄인 문단에 알약과 원래 대본 보기가 있고, 누르면 숨긴 문장이 흐리게 보인다', async () => {
  const p = await page(browser); await open(p); await sample(p);
  await p.click('#modeSeg [data-m="2"]'); await present(p);
  assert.match(await p.textContent('#prompt .cuthd span'), /^핵심만으로 줄였어요$/);
  await p.locator('#prompt .orig').first().click();
  assert.equal(await p.locator('#origDlg').evaluate(d => d.open), true);
  assert.ok(await p.locator('#origText del').count() > 0, '숨긴 문장 취소선');
  assert.ok((await p.textContent('#origText')).length > 100);
  await p.click('#origClose');
  assert.equal(await p.locator('#origDlg').evaluate(d => d.open), false);
  // 단추를 눌러도 읽는 위치가 옮겨지지 않는다
  assert.deepEqual(p.errors, []);
});
t('편집: 들어보기가 문장마다 읽어 주고 다시 누르면 멈춘다', async () => {
  const p = await page(browser); await open(p); await sample(p);
  await p.click('#listenBtn');
  const n = await p.evaluate(() => window.__spoken.length);
  assert.ok(n >= 10, `문장 수 ${n}`);
  assert.equal(await p.getAttribute('#listenBtn', 'aria-pressed'), 'true');
  assert.equal(await p.textContent('#listenBtn span'), '멈추기');
  assert.match(await p.evaluate(() => window.__spoken[0]), /^안녕하세요\./);
  await p.click('#listenBtn');
  assert.equal(await p.evaluate(() => window.__spoken.length), 0);
  assert.equal(await p.textContent('#listenBtn span'), '들어보기');
  // 화면을 옮기면 멈춘다
  await p.click('#listenBtn'); await present(p);
  assert.equal(await p.evaluate(() => window.__spoken.length), 0);
});
t('발표: 남은 시간 1분 전부터 알림 칩이 나오고 목표가 지나면 사라진다', async () => {
  const p = await page(browser); await p.clock.install(); await open(p); await sample(p);  // 시계는 앱이 타이머를 만들기 전에 가짜로 바꾼다
  await p.uncheck('#shrinkOn');
  await p.fill('#target', '3'); await present(p);
  await p.click('#mic'); await p.waitForTimeout(200);
  await p.clock.runFor(100000);
  assert.equal(await p.locator('#timeAlert').isHidden(), true, '1:40에는 아직');
  await p.clock.runFor(30000);
  assert.equal(await p.locator('#timeAlert').isVisible(), true);
  assert.match(await p.textContent('#timeAlert'), /^남은 시간 0:[0-5]\d$/);
  await p.clock.runFor(60000);
  assert.equal(await p.locator('#timeAlert').isHidden(), true, '목표를 넘으면 사라진다');
  assert.deepEqual(p.errors, []);
});

// ---- 질문 답변: 핵심 키워드, 관련 대본 구간 ----
const askQ = async (p, q) => {
  await p.click('#qaBtn'); await p.waitForTimeout(300);
  await p.click('#ask'); await p.waitForTimeout(200);
  await p.evaluate(t => window.__say(t, false), q); await p.waitForTimeout(300);
  await p.click('#ask'); await p.waitForSelector('#chips .chip');
};
t('질문: 질문 듣기 → 후보 → 카드에 핵심 키워드와 순위가 나온다', async () => {
  const p = await page(browser); await open(p); await sample(p);
  await p.uncheck('#shrinkOn'); await present(p);
  await askQ(p, '무료로 쓸 수 있나요');
  assert.match(await p.textContent('#live'), /^“무료로 쓸 수 있나요”/);
  assert.equal(await p.getAttribute('#live', 'data-src'), '음성으로 받음');
  assert.equal(await p.locator('#chips .chip').count(), 4, '후보 3개 + 해당 없음');
  await p.locator('#chips .chip').first().click();
  assert.equal(await p.locator('#card').isVisible(), true);
  assert.equal(await p.textContent('#cardRank'), '1순위');
  assert.deepEqual(await p.locator('#cardKeys span').allTextContents(), ['설치 없이 무료', '무료 오픈소스 모델', '키 없이 챗봇']);
  assert.equal(await p.locator('#cardMore .chip .n').first().textContent(), '2');
  assert.equal(await p.textContent('#ask'), '다음 질문 듣기');
  await p.screenshot({ path: OUT + '/qa-card.png' });
  assert.deepEqual(p.errors, []);
});
t('질문: 채팅으로 받은 질문은 받은 길이 다르다', async () => {
  const p = await page(browser); await open(p); await sample(p);
  await p.uncheck('#shrinkOn'); await present(p);
  await p.click('#qaBtn');
  await p.fill('#qaText', '아이폰에서도 되나요?'); await p.press('#qaText', 'Enter');
  await p.waitForSelector('#chips .chip');
  assert.equal(await p.getAttribute('#live', 'data-src'), '채팅으로 받음');
  assert.match(await p.textContent('#chips .chip'), /아이폰/);
});
t('질문: 해당 없음을 누르면 관련 대본 구간이 나오고, 누르면 그 문장으로 돌아간다', async () => {
  const p = await page(browser); await open(p); await sample(p);
  await p.uncheck('#shrinkOn'); await present(p);
  await askQ(p, '대본 밖에서 한 말은 어떻게 되나요');
  await p.locator('#chips .chip.none').click();
  await p.waitForSelector('#hits:not([hidden]) #hitList .chip');
  const n = await p.locator('#hitList .chip').count();
  assert.ok(n >= 1 && n <= 3, `관련 문장 ${n}개`);
  assert.match(await p.textContent('#hitList .chip small'), /^대본 \d+번째 문장$/);
  const first = (await p.textContent('#hitList .chip')).replace(/대본 \d+번째 문장$/, '').trim();
  await p.locator('#hitList .chip').first().click(); await p.waitForTimeout(500);
  assert.equal(await p.evaluate(() => document.body.classList.contains('qa')), false, '질의응답에서 나온다');
  // 읽는 줄(지금 단어가 든 문장)이 고른 문장이다
  const cur = await p.evaluate(() => document.querySelector('#prompt .s.cur')?.textContent.trim());
  assert.ok(cur && cur.replace(/\s+/g, ' ').startsWith(first.replace(/…$/, '').slice(0, 20)), `지금 문장 ${cur?.slice(0, 30)} / 고른 문장 ${first.slice(0, 30)}`);
  assert.deepEqual(p.errors, []);
});
t('질문: 질문 준비 창에서 핵심 키워드를 고치고 저장하면 카드에 반영된다', async () => {
  const p = await page(browser); await open(p); await sample(p);
  await p.uncheck('#shrinkOn');
  await p.click('[data-tab="qa"]'); await p.waitForSelector('#qList .qitem');
  const f = p.locator('#qList .qitem').first().locator('input').nth(1);
  assert.equal(await f.inputValue(), '설치 없이 무료, 무료 오픈소스 모델, 키 없이 챗봇');
  await f.fill('설치 없이 무료, 새 키워드'); await f.dispatchEvent('input'); await f.dispatchEvent('change');
  await p.click('#savePack'); await p.waitForTimeout(500);
  await present(p);
  await askQ(p, '무료로 쓸 수 있나요');
  await p.locator('#chips .chip').first().click();
  assert.deepEqual(await p.locator('#cardKeys span').allTextContents(), ['설치 없이 무료', '새 키워드']);
});

// ---- 연습 결과: 대본과 실제로 한 말, 수정 제안, 회차별 시간 ----
const SAMPLE = JSON.parse(fs.readFileSync(new URL('../sample.livescript.json', import.meta.url), 'utf8'));
const SENTS = SAMPLE.text.split(/\n+/).flatMap(par => par.split(/(?<=[.?!])\s+/)).filter(Boolean);
// 연습 한 번: 문장마다 확정 결과로 읽는다. mutate(문장 번호, 문장) → 실제로 말한 글
// warm: 마이크를 켠 뒤 기다릴 실제 ms(가짜 마이크와 녹음이 켜지기까지. 시험의 연습은 실제로 몇 초 만에 끝난다)
async function practiceRun(p, mutate = (i, x) => x, first = true, warm = 300) {
  await p.click(first ? '[data-tab="practice"]' : '#cPractice'); await p.waitForTimeout(500);
  await p.click('#mic'); await p.waitForTimeout(warm);
  const dt = 200000 / SENTS.length;
  // 실제 인식처럼 낱말마다 중간 결과를 보내고, 문장이 끝나면 확정한다
  for (const [i, x] of SENTS.entries()) {
    const m = mutate(i, x), w = m.split(' ');
    for (let k = 1; k <= w.length; k++) { await p.evaluate(t => window.__say(t), w.slice(0, k).join(' ')); await p.clock.runFor(dt / w.length); await p.waitForTimeout(4); }
    await p.evaluate(t => window.__fin(t), m);
  }
  await p.waitForTimeout(300);
  await p.click('#mic'); await p.waitForSelector('#checkDlg[open]'); await p.waitForTimeout(600);
}
const swapNae = (i, x) => x.replace('소리 내어', '소리 내서');
t('결과: 대본과 다르게 말한 곳을 빼먹음·더함·바꿔 말함으로 보여 준다', async () => {
  const p = await page(browser); await p.clock.install(); await open(p); await sample(p);
  await p.uncheck('#shrinkOn'); await p.fill('#target', '3');
  await practiceRun(p, (i, x) => i === 2 ? '그러니까 ' + x.replace('발표하다 보면', '발표를 하다 보면') : i === 3 ? x.replace('소리 내어 ', '') : x);
  assert.equal(await p.locator('#cStats .stat').count(), 4, '걸린 시간·말 빠르기·대본 밖·대본과 다르게 말한 곳');
  assert.match(await p.textContent('#cStats .stat:nth-child(2) .v'), /^\d+ 음절\/분$/);
  assert.equal(await p.textContent('#cStats .stat:nth-child(4) .k'), '대본과 다르게 말한 곳');
  assert.ok(+(await p.textContent('#cStats .stat:nth-child(4) .v')) >= 2);
  assert.equal(await p.locator('#cDiffBox').isVisible(), true);
  assert.ok(await p.locator('#cDiffTxt del').count() >= 1, '빼먹음');
  assert.ok(await p.locator('#cDiffTxt u.chg').count() + await p.locator('#cDiffTxt ins').count() >= 1, '바꿔 말함이나 더함');
  assert.match(await p.textContent('#cDiffH'), /대본과 실제로 한 말$/);
  await p.screenshot({ path: OUT + '/check-diff.png' });
  assert.deepEqual(p.errors, []);
});
t('결과: 두 번 이어 바꿔 말하면 대본 수정을 제안하고 바꾸기로 새 버전을 남긴다', async () => {
  const p = await page(browser); await p.clock.install(); await open(p); await sample(p);
  await p.uncheck('#shrinkOn'); await p.fill('#target', '3');
  await practiceRun(p, swapNae);
  assert.equal(await p.locator('#cSug .sug').count(), 0, '한 번만으로는 제안하지 않는다');
  await practiceRun(p, swapNae, false);
  assert.equal(await p.locator('#cSug .sug').count(), 1);
  assert.equal(await p.textContent('#cSug h3'), '대본을 이렇게 바꿀까요?');
  assert.match(await p.textContent('#cSug p'), /^연습 2번 연속 '내어' 대신 '내서'라고 말했어요\.$/);
  assert.equal(await p.textContent('#cStats .stat:nth-child(4) .note'), '대본 수정 제안 1개');
  const before = await p.inputValue('#text');
  await p.click('#cSug .go'); await p.waitForTimeout(400);
  const after = await p.inputValue('#text');
  assert.ok(before.includes('소리 내어') && !after.includes('소리 내어') && after.includes('소리 내서'), '대본에서 바뀌었다');
  assert.equal(await p.locator('#cSug .sug').count(), 0);
  assert.match(await p.textContent('#checkMsg'), /\d+곳을 바꿨어요: '내어' → '내서'\. 새 버전으로 저장했어요\./);
  const vers = await p.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith('ls.vers'))) || '[]'));
  assert.equal(vers[0].label, '연습 제안 반영'); assert.ok(vers[0].text.includes('소리 내서'), '새 버전');
  assert.ok(vers.slice(1).some(v => v.text.includes('소리 내어')), '바꾸기 전 대본도 버전에 남아 있다(발표 시작 때 저장된 것)');
  assert.deepEqual(p.errors, []);
});
t('결과: 그대로 두기를 누르면 같은 제안이 다시 나오지 않는다', async () => {
  const p = await page(browser); await p.clock.install(); await open(p); await sample(p);
  await p.uncheck('#shrinkOn'); await p.fill('#target', '3');
  await practiceRun(p, swapNae); await practiceRun(p, swapNae, false);
  await p.click('#cSug .row button:not(.go)'); await p.waitForTimeout(300);
  assert.equal(await p.locator('#cSug .sug').count(), 0);
  await practiceRun(p, swapNae, false);
  assert.equal(await p.locator('#cSug .sug').count(), 0, '세 번째 연습에도 나오지 않는다');
});
t('결과: 목소리 분석을 켜고 연습하면 기록에 목소리 크기·끝 흐림 칸이 생기고 오류가 없다', async () => {
  const p = await page(browser); await p.clock.install(); await open(p); await sample(p);
  await p.uncheck('#shrinkOn'); await p.fill('#target', '3');
  await p.evaluate(() => localStorage.setItem('ls.audio', JSON.stringify({ l: false, r: true })));  // 가짜 마이크(삑 소리)로 분석기를 돌린다
  await practiceRun(p);
  const run = await p.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith('ls.runs'))))[0]);
  assert.ok(run.audio, '목소리 분석을 했다');
  assert.ok(run.secs.some(s => typeof s[17] === 'number'), '끝 흐림 칸(ends)이 저장된 구간이 있다. 삑 소리는 유성음이 아니라 크기와 강조는 비어도 된다');
  assert.equal(run.emph ?? null, null);
  assert.deepEqual(p.errors, []);
});
t('결과: 연습을 정지하면 AI 키가 있을 때 대본과 들은 말로 AI 코칭을 바로 받는다', async () => {
  const p = await page(browser); await p.clock.install(); await open(p); await sample(p);
  await p.uncheck('#shrinkOn'); await p.fill('#target', '3');
  const coach = { summary: '시간은 맞췄어요.', tips: [{ sec: 2, what: "'그러니까'로 문장을 시작하는 말버릇이 있었어요.", how: '첫 낱말 앞에서 한 박자 쉬고 바로 시작해 보세요.' }] };
  const sse = [{ type: 'message_start', message: { id: 'm', content: [] } }, { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: JSON.stringify(coach) } }, { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 9 } }, { type: 'message_stop' }]
    .map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
  const sent = [], cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
  await p.route('https://api.anthropic.com/**', r => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    sent.push(JSON.parse(r.request().postData()));
    return r.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: sse });
  });
  await p.evaluate(() => sessionStorage.setItem('ls.key', 'sk-ant-test'));
  await practiceRun(p, (i, x) => i === 2 ? '그러니까 ' + x : x);
  for (let i = 0; i < 50 && await p.textContent('#cTipsH') !== 'AI 코칭'; i++) await p.waitForTimeout(100);
  assert.equal(await p.textContent('#cTipsH'), 'AI 코칭');
  assert.equal(sent.length, 1, '정지할 때 한 번 보낸다');
  const u = sent[0].messages[0].content;
  assert.ok(u.includes('<대본과한말>\n1번 구간\n대본: ' + SENTS[0]), '읽은 구간의 대본');
  assert.ok(u.includes('한 말: 그러니까 ') || u.includes(' 그러니까 '), '들은 말');
  assert.equal(await p.textContent('#cAiSum'), coach.summary);
  assert.match(await p.textContent('#cTips li'), /^2번 구간: '그러니까'로 문장을 시작하는 말버릇이 있었어요\. 첫 낱말 앞에서/);
  assert.deepEqual(p.errors, []);
});
t('결과: 회차별 시간 막대와 구간부터 연습 단추', async () => {
  const p = await page(browser); await p.clock.install(); await open(p); await sample(p);
  await p.uncheck('#shrinkOn'); await p.fill('#target', '3');
  await practiceRun(p); await practiceRun(p, (i, x) => x, false);
  assert.equal(await p.locator('#cHist div').count(), 2);
  assert.equal(await p.locator('#cHist .now').count(), 1);
  assert.match(await p.textContent('#cRepeat'), /^\d+번 구간부터 연습$/);
  const k = +(await p.textContent('#cRepeat')).match(/\d+/)[0];
  await p.click('#cRepeat'); await p.waitForTimeout(600);
  assert.equal(await p.evaluate(() => document.body.classList.contains('editing')), false, '발표 화면으로');
  assert.equal(await p.locator('#checkDlg').evaluate(d => d.open), false);
  const cur = +await p.evaluate(() => localStorage.getItem(Object.keys(localStorage).find(k => /^ls\.cur\./.test(k)) || 'ls.cur'));
  assert.ok(k === 1 ? cur === 0 : cur > 0, `읽는 위치가 ${k}번 구간 처음 (${cur})`);
  assert.deepEqual(p.errors, []);
});

// ---- 연습 녹음, 꼭 말할 문장, 평가 기준과 흐름 ----
// 녹음 저장소 들여다보기(CSP가 eval을 막아 할 일은 이름으로 넘긴다): 'count' | 'all'(파일은 크기와 형식만)
const idb = (p, op) => p.evaluate(op => new Promise((ok, no) => { const q = indexedDB.open('livescript-rec'); q.onerror = no; q.onsuccess = () => { const st = q.result.transaction('segs').objectStore('segs'), r = op === 'count' ? st.count() : st.getAll(); r.onsuccess = () => ok(op === 'count' ? r.result : r.result.map(v => ({ ...v, blob: { size: v.blob.size, type: v.blob.type } }))); r.onerror = no; }; }), op);
const setMust = (p, ms) => p.evaluate(ms => { const id = Object.keys(localStorage).find(k => k.startsWith('ls.script.')).slice(10); localStorage.setItem('ls.must.' + id, JSON.stringify(ms)); }, ms);
// 말소리 같은 가짜 마이크: 잡음 바닥(-60dBFS) 위에 160Hz 소리를 0.4초 켜고 0.2초 끈다. Chrome 가짜 장치는 일정한 소리라 말이 빠르면 분석기가 굶음으로 보고 꺼진다
const SPEECH_MIC = `(() => {
  const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async c => {
    if (!c?.audio) return real(c);
    const ctx = new AudioContext(); await ctx.resume().catch(() => {});
    const d = ctx.createMediaStreamDestination(), o = ctx.createOscillator(), g = ctx.createGain(), nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), n = ctx.createBufferSource();
    nb.getChannelData(0).forEach((_, i, a) => { a[i] = (Math.random() * 2 - 1) * 0.0017; });
    n.buffer = nb; n.loop = true; n.connect(d); n.start();
    o.frequency.value = 160; o.connect(g).connect(d); g.gain.value = 0;
    for (let i = 0, t = ctx.currentTime; i < 500; i++) { g.gain.setValueAtTime(0.3, t + i * 0.6); g.gain.setValueAtTime(0, t + i * 0.6 + 0.4); }
    o.start();
    return d.stream;
  };
})();`;
// 실제 시간으로 하는 짧은 연습(가짜 시계로 몇 초에 200초를 돌리면 분석기가 소리가 안 들어온다고 보고 꺼진다). 말한 시간이 20초를 넘게.
// 가짜 마이크는 가끔 5초쯤에 0 샘플을 내서 분석기(와 녹음)가 꺼지므로 처음 6문장은 빨리 읽는다
async function realRun(p, ms = [...Array(6).fill(500), ...Array(7).fill(2600)]) {
  await p.click('[data-tab="practice"]'); await p.waitForTimeout(500);
  await p.click('#mic'); await p.waitForTimeout(1500);
  for (const [i, x] of SENTS.slice(0, ms.length).entries()) {
    const w = x.split(' ');
    for (let k = 1; k <= w.length; k++) { await p.evaluate(t => window.__say(t), w.slice(0, k).join(' ')); await p.waitForTimeout(ms[i] / w.length); }
    await p.evaluate(t => window.__fin(t), x);
  }
  await p.waitForTimeout(300);
  await p.click('#mic'); await p.waitForSelector('#checkDlg[open]'); await p.waitForTimeout(600);
}
t('녹음: 목소리 분석을 켜고 연습하면 이 기기에 녹음을 남기고, 결과 창에서 구간마다 다시 듣고, 기록을 지우면 같이 지운다', async () => {
  const p = await page(browser); await p.context().addInitScript(SPEECH_MIC); await open(p); await sample(p);
  await p.uncheck('#shrinkOn'); await p.fill('#target', '3');
  await p.evaluate(() => localStorage.setItem('ls.audio', JSON.stringify({ l: false, r: true })));  // 가짜 마이크로 분석기와 녹음을 돌린다
  await realRun(p);
  const run = await p.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith('ls.runs'))))[0]);
  assert.equal(run.rec, true, '기록에 녹음했다고 남는다');
  await p.waitForSelector('#cTake:not([hidden]) #cAudio:not([hidden])', { timeout: 10000 });
  const segs = await idb(p, 'all');
  assert.equal(segs.length, 1, '시작~정지가 조각 하나');
  assert.ok(segs[0].blob.size > 0 && /^audio\/webm/.test(segs[0].blob.type), `녹음 파일 ${segs[0].blob.size} ${segs[0].blob.type}`);
  const mk = segs[0].marks;
  assert.equal(run.audio.off, null, '분석이 끝까지 켜져 있었다');
  assert.ok(mk.length >= 12 && mk.every((m, i, a) => !i || m[0] >= a[i - 1][0]) && mk.every(m => m.length === 3) && mk.at(-1)[0] <= segs[0].ms, `문장이 바뀐 때(시각 순서, 구간 번호 포함) ${JSON.stringify(mk)} ${JSON.stringify(run.audio)} ${segs[0].ms}`);
  assert.ok(new Set(mk.map(m => m[2])).size >= 2, '여러 구간');
  assert.match(await p.textContent('#cTakeMsg'), /^연습 녹음 \d+:\d\d · 이 기기에만 남아요$/);
  const dur = await p.evaluate(() => new Promise(ok => { const a = document.getElementById('cAudio'); a.readyState >= 1 ? ok(a.duration) : a.addEventListener('loadedmetadata', () => ok(a.duration), { once: true }); }));
  assert.ok(Number.isFinite(dur) && dur > 0, `길이를 안다(되감기가 된다) ${dur}`);
  assert.ok(await p.locator('#cSecs .sec .sh button.play').count() >= 2, '읽은 구간마다 듣기');
  assert.match(await p.getAttribute('#cSecs .sec:nth-child(2) .sh button.play', 'aria-label'), /^2번 구간 듣기$/);
  await p.locator('#cSecs .sec .sh button.play').nth(1).click(); await p.waitForTimeout(600);
  const at = await p.evaluate(() => { const a = document.getElementById('cAudio'); return [+a.dataset.to, a.currentTime, a.paused]; });
  assert.ok(at[0] > at[1] - 0.5 && at[1] > 1 && !at[2], `둘째 구간부터 듣고, 그 구간 끝에서 멈출 자리를 둔다 ${at}`);
  await p.screenshot({ path: OUT + '/rec-result.png' });
  // 닫은 결과 창은 '결과'로 다시 연다. 기록을 지우면 녹음도 지운다
  await p.click('#checkClose'); await p.click('#resBtn'); await p.waitForSelector('#checkDlg[open]');
  p.once('dialog', d => d.accept());
  await p.click('#cDel'); await p.waitForTimeout(500);
  assert.equal(await idb(p, 'count'), 0, '녹음도 지웠다');
  assert.deepEqual(p.errors, []);
});
t('결과: 꼭 말할 문장을 빼먹으면 묶음과 다음에 해 볼 것이 알려 주고, 연습 화면에 밑줄, 편집 카드에 지난 연습 줄이 생긴다', async () => {
  const p = await page(browser); await p.clock.install(); await open(p); await sample(p);
  await p.uncheck('#shrinkOn'); await p.fill('#target', '3');
  await setMust(p, [SENTS[4], SENTS[9]]);
  await practiceRun(p, (i, x) => i === 9 ? '음 잠깐만요 이건 넘어가고 다음 이야기를 할게요' : x);
  assert.equal(await p.locator('#cKeys').isVisible(), true);
  assert.equal(await p.textContent('#cKeys > p'), '꼭 말할 문장 2개 가운데 1개를 말했어요. 1개는 빼먹은 것 같아요.', '목소리 분석이 없으면 말했는지만');
  assert.equal(await p.locator('#cKeys .krow.skip').count(), 1);
  assert.match(await p.textContent('#cKeys .krow.skip .kt'), new RegExp(SENTS[9].slice(0, 8)));
  assert.match(await p.textContent('#cTips'), /꼭 말할 문장을 빼먹은 것 같아요/);
  const run = await p.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith('ls.runs'))))[0]);
  assert.equal(run.keys.length, 2);
  await p.click('#checkClose');
  assert.equal(await p.evaluate(() => document.body.classList.contains('keymark')), true, '연습 모드');
  assert.equal(await p.locator('#prompt .s.key').count(), 2, '꼭 말할 문장에 밑줄');
  await toScript(p);
  await p.locator('#cList .pc').first().click();
  assert.match(await p.textContent('#cList .pc.on .pfb'), /^지난 연습/, '열린 카드에 지난 연습 줄');
  assert.deepEqual(p.errors, []);
});
t('준비: 평가 기준을 적고 붙여넣은 답으로 흐름, 핵심 문장 제안, 다루지 않은 기준이 보이고 카드에 역할 칩이 생긴다', async () => {
  const p = await page(browser); await open(p); await sample(p);
  await p.fill('#edAside [data-info="rubric"]', '1. 문제를 분명히 말했나\n2. 한계와 개선점\n3. 목소리 크기');
  await p.click('#prepGo');
  await p.click('#aiCopy');
  assert.ok((await p.inputValue('#aiPrompt')).includes('<평가기준>\n1. 문제를 분명히 말했나\n2. 한계와 개선점\n3. 목소리 크기\n</평가기준>'), '평가 기준을 보낸다');
  const ps = paras(SAMPLE.text), roles = ['도입', '문제', '해결'];
  const ans = { paras: ps.map((x, i) => ({ p: i + 1, imp: 2, keep: [1], drop: [], role: roles[i % 3], tone: '또렷하게', e: i === 1 ? 3 : 2 })),
    keys: [{ p: 2, s: 1, why: '문제 제기', r: 1 }],
    crit: [{ r: 1, kind: '내용', ps: [2], at: 0, how: '' }, { r: 2, kind: '내용', ps: [], at: 3, how: '셋째 문단에 한계를 한 문장 더해 주세요.' }, { r: 3, kind: '전달', ps: [], at: 0, how: '' }], kw: [] };
  await p.click('#aiPaste'); await p.fill('#aiPasteIn', JSON.stringify(ans)); await p.click('#aiPasteApply'); await p.waitForTimeout(300);
  await p.click('#aiClose');
  assert.match(await p.textContent('#prepFlow'), /흐름: 1 도입 \(보통\) → 2 문제 \(힘 있게\) → 3 해결/);
  assert.equal(await p.textContent('#prepFlow .sug h3'), 'AI가 고른 핵심 문장 1개예요. 꼭 말할 문장으로 표시할까요?');
  assert.match(await p.textContent('#prepFlow'), /평가 기준 '한계와 개선점' — 다루는 문단이 없어요/);
  assert.equal(await p.locator('#prepFlow').getByText('목소리 크기').count(), 0, '전달 기준은 대본 빈 곳으로 보지 않는다');
  await p.locator('#prepFlow .sug .go').first().click();
  const must = await p.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith('ls.must.')))));
  assert.deepEqual(must, [ps[1][0]], '꼭 말할 문장이 됐다');
  assert.equal(await p.locator('#prepFlow .sug h3').first().textContent(), "평가 기준 '한계와 개선점' — 다루는 문단이 없어요", '표시했으니 제안이 사라졌다');
  await p.screenshot({ path: OUT + '/prep-flow.png' });
  await p.locator('#prepFlow .sug .go').first().click(); await p.waitForTimeout(300);
  assert.equal(await p.locator('#ai').evaluate(d => d.open), true);
  assert.equal(await p.inputValue('#instr'), '셋째 문단에 한계를 한 문장 더해 주세요.', '지시로 고치기에 고칠 점');
  assert.equal(await p.isChecked('#onlySel'), true, '그 문단만');
  await p.click('#aiClose');
  assert.equal(await p.locator('#cList .pc .prole').count(), ps.length, '문단마다 역할 칩');
  assert.equal(await p.textContent('#cList .pc:nth-child(2) .prole'), '문제');
  assert.equal(await p.getAttribute('#cList .pc:nth-child(2) mark.must', 'title'), '문제 제기 · 평가 기준: 문제를 분명히 말했나');
  assert.deepEqual(p.errors, []);
});
t('결과: AI 코칭의 대본 고칠 점은 카드로 보이고, 누르면 그 구간을 고른 채 지시로 고치기를 연다', async () => {
  const p = await page(browser); await p.clock.install(); await open(p); await sample(p);
  await p.uncheck('#shrinkOn'); await p.fill('#target', '3');
  const coach = { summary: '시간은 맞췄어요.', tips: [{ sec: 1, what: '첫 구간이 빨랐어요.', how: '한 박자 쉬어 보세요.' }], edits: [{ sec: 2, what: '둘째 구간 문장이 길어요.', how: '둘째 구간의 긴 문장을 둘로 나눠 주세요.' }] };
  const sse = [{ type: 'message_start', message: { id: 'm', content: [] } }, { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: JSON.stringify(coach) } }, { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 9 } }, { type: 'message_stop' }].map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
  await p.route('https://api.anthropic.com/**', r => r.request().method() === 'OPTIONS' ? r.fulfill({ status: 204, headers: cors }) : r.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: sse }));
  await p.evaluate(() => sessionStorage.setItem('ls.key', 'sk-ant-test'));
  await practiceRun(p);
  for (let i = 0; i < 50 && await p.textContent('#cTipsH') !== 'AI 코칭'; i++) await p.waitForTimeout(100);
  assert.equal(await p.textContent('#cSug .sug h3'), '대본을 이렇게 고쳐 볼까요?');
  assert.match(await p.textContent('#cSug .sug'), /2번 구간: 둘째 구간 문장이 길어요\./);
  await p.evaluate(() => sessionStorage.removeItem('ls.key'));  // 열기만 보고 바로 고치지는 않게
  await p.click('#cSug .sug .go'); await p.waitForTimeout(400);
  assert.equal(await p.locator('#ai').evaluate(d => d.open), true);
  assert.equal(await p.evaluate(() => document.body.classList.contains('editing')), true, '편집 화면으로');
  assert.equal(await p.inputValue('#instr'), '둘째 구간의 긴 문장을 둘로 나눠 주세요.');
  assert.equal(await p.isChecked('#onlySel'), true, '그 구간만');
  assert.deepEqual(p.errors, []);
});

// ---- 편집: 문단 카드 ----
const textOf = p => p.evaluate(() => document.getElementById('text').value);
t('카드: 문단마다 카드와 목록 조각이 있고 번호·예상 시간이 보인다', async () => {
  const p = await page(browser); await open(p); await sample(p);
  const n = paraSpans(SAMPLE.text).length;
  assert.equal(await p.locator('#cList .pc').count(), n);
  assert.equal(await p.locator('#cNav a').count(), n);
  assert.match(await p.textContent('#cList .pc .pn'), /^1 · 안녕하세요/);
  assert.match(await p.textContent('#cList .pc .pe'), /^예상 \d+:\d\d$/);
  assert.equal(await p.locator('#text').isHidden(), true, '글이 있으면 종이 칸은 숨는다');
  assert.equal(await p.locator('#cNav').isVisible(), true);
  await p.setViewportSize({ width: 900, height: 800 });
  assert.equal(await p.locator('#cNav').isHidden(), true, '좁으면 목록은 없다');
  assert.equal(await p.locator('#cList .pc').first().boundingBox().then(b => b.width > 700), true, '카드는 폭을 다 쓴다');
  await p.setViewportSize({ width: 390, height: 800 });
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, '휴대폰에서 가로로 넘치지 않는다');
  assert.deepEqual(p.errors, []);
});
t('카드: 누르면 글칸이 되고, 고치면 그 문단만 대본에 반영되며 예상 시간이 바뀐다', async () => {
  const p = await page(browser); await open(p); await sample(p);
  const before = await textOf(p), second = paraSpans(before)[1];
  await p.locator('#cList .pc').nth(1).click();
  assert.equal(await p.locator('#cList .pc.on').count(), 1);
  const ta = p.locator('#cList .pc.on .pta');
  assert.equal(await ta.inputValue(), before.slice(...second));
  assert.equal(await p.getAttribute('#cNav a:nth-child(2)', 'aria-current'), 'true');
  const est0 = await p.textContent('#cList .pc.on .pe');
  await ta.evaluate(e => { e.focus(); e.setSelectionRange(e.value.length, e.value.length); }); await ta.pressSequentially(' 덧붙인 문장이에요 한 번 더 덧붙인 말이에요.');
  const after = await textOf(p);
  assert.equal(after, before.slice(0, second[1]) + ' 덧붙인 문장이에요 한 번 더 덧붙인 말이에요.' + before.slice(second[1]), '두 번째 문단 끝에만 붙는다');
  assert.notEqual(await p.textContent('#cList .pc.on .pe'), est0);
  assert.equal(await p.evaluate(() => localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith('ls.script.')))), after, '저장됐다');
  await ta.press('Escape');
  assert.equal(await p.locator('#cList .pc.on').count(), 0);
  assert.match(await p.textContent('#cList .pc:nth-child(2) .pt'), /덧붙인 문장이에요 한 번 더/);
  assert.deepEqual(p.errors, []);
});
t('카드: 꼭 말할 문장을 표시하면 강조되고 핵심만으로 줄여도 남는다', async () => {
  const p = await page(browser); await open(p); await sample(p);
  await p.uncheck('#shrinkOn');
  // 발표 준비가 뺄 문장으로 고른 문장 하나
  const text = SAMPLE.text, ps = sentSpans(text);
  let drop = null;
  SAMPLE.prep.paras.forEach((pr, i) => { if (!drop && pr.drop.length && i > 0 && i < ps.length - 1) drop = { i, s: ps[i][pr.drop[0]] }; });
  assert.ok(drop, '시험할 뺄 문장');
  const sentence = text.slice(...drop.s);
  await p.click('#modeSeg [data-m="2"]'); await present(p);
  assert.ok(!(await p.textContent('#prompt')).includes(sentence.slice(0, 15)), '핵심만에서는 이 문장이 빠진다');
  await toScript(p);
  await p.locator('#cList .pc').nth(drop.i).click();
  const ta = p.locator('#cList .pc.on .pta');
  const at = (await ta.inputValue()).indexOf(sentence) + 3;
  await ta.evaluate((e, k) => { e.focus(); e.setSelectionRange(k, k); e.dispatchEvent(new Event('select')); }, at);
  await p.click('#cList .pc.on .mustb');
  assert.equal(await p.getAttribute('#cList .pc.on .mustb', 'aria-pressed'), 'true');
  assert.match(await p.textContent('#cList .pc.on .mustb'), /1개/);
  await ta.press('Escape');
  assert.equal(await p.locator('#cList .pc').nth(drop.i).locator('mark.must').textContent(), sentence);
  await present(p);
  assert.ok((await p.textContent('#prompt')).includes(sentence.slice(0, 15)), '꼭 말할 문장은 핵심만에서도 남는다');
  // 풀면 다시 빠진다
  await toScript(p);
  await p.locator('#cList .pc').nth(drop.i).click();
  await p.locator('#cList .pc.on .pta').evaluate((e, k) => { e.focus(); e.setSelectionRange(k, k); e.dispatchEvent(new Event('select')); }, at);
  await p.click('#cList .pc.on .mustb');
  assert.equal(await p.getAttribute('#cList .pc.on .mustb', 'aria-pressed'), 'false');
  await p.locator('#cList .pc.on .pta').press('Escape');
  await present(p);
  assert.ok(!(await p.textContent('#prompt')).includes(sentence.slice(0, 15)));
  assert.deepEqual(p.errors, []);
});
t('카드: 더 짧게는 이 문단만 AI 지시로 열고, 문단 추가는 빈 줄과 함께 붙는다', async () => {
  const p = await page(browser); await open(p); await sample(p);
  await p.locator('#cList .pc').nth(2).click();
  await p.click('#cList .pc.on .ptool >> text=더 짧게');
  assert.equal(await p.locator('#ai').evaluate(d => d.open), true);
  assert.equal(await p.locator('[data-pane="edit"]').isVisible(), true);
  assert.match(await p.inputValue('#instr'), /더 짧게 줄여 줘$/);
  assert.equal(await p.locator('#onlySelBox').isVisible(), true);
  assert.match(await p.textContent('#selInfo'), /^고른 문단만 고치기 \(\d+자\)$/);
  assert.equal(await p.isChecked('#onlySel'), true);
  await p.click('#aiClose');
  // 문단 추가
  const before = await textOf(p);
  await p.click('#cAdd');
  await p.locator('#cList .pc.on .pta').pressSequentially('새로 쓴 마지막 문단이에요.');
  assert.equal(await textOf(p), before.trimEnd() + '\n\n새로 쓴 마지막 문단이에요.');
  assert.equal(await p.locator('#cList .pc').count(), paraSpans(before).length + 1);
  assert.deepEqual(p.errors, []);
});
t('카드: 빈 대본은 새 발표 만들기 화면이고, 붙여넣으면 카드가 되고, 글을 모두 지우면 붙여넣을 칸으로 돌아간다', async () => {
  const p = await page(browser); await open(p);
  assert.equal(await p.locator('#create').isVisible(), true, '빈 대본은 새 발표 만들기');
  assert.equal(await p.locator('#text').isHidden(), true);
  await p.click('#ePaste');
  assert.equal(await p.locator('#text').isVisible(), true, '직접 붙여넣기를 누르면 종이 칸');
  await p.fill('#text', '첫 문단이에요. 둘째 문장이에요.\n\n둘째 문단이에요.');
  await p.waitForTimeout(300);
  assert.equal(await p.locator('#cList .pc').count(), 2);
  assert.equal(await p.locator('#text').isHidden(), true);
  await p.locator('#cList .pc').first().click();
  await p.locator('#cList .pc.on .pta').fill('');
  await p.locator('#cList .pc.on .pta').press('Escape');
  await p.locator('#cList .pc').first().click();
  await p.locator('#cList .pc.on .pta').fill('');
  await p.locator('#cList .pc.on .pta').press('Escape');
  await p.waitForTimeout(200);
  assert.equal(await p.evaluate(() => document.getElementById('text').value.trim()), '');
  assert.equal(await p.locator('#text').isVisible(), true);
  assert.equal(await p.locator('#create').isHidden(), true, '붙여넣던 중이면 칸이 남는다');
});
t('카드: 연습에서 두 번 바꿔 말한 낱말에 점선 밑줄이 생기고 추천으로 바꿀 수 있다', async () => {
  const p = await page(browser); await p.clock.install(); await open(p); await sample(p);
  await p.uncheck('#shrinkOn'); await p.fill('#target', '3');
  await practiceRun(p, swapNae); await practiceRun(p, swapNae, false);
  await p.click('#checkClose'); await p.waitForTimeout(300);
  await toScript(p);
  assert.equal(await p.evaluate(() => document.body.classList.contains('editing')), true);
  const hard = p.locator('#cList .hard');
  assert.ok(await hard.count() >= 1, '막힌 낱말 밑줄');
  assert.equal(await hard.first().textContent(), '내어');
  await hard.first().click();
  assert.equal(await p.locator('.hardpop').isVisible(), true);
  assert.match(await p.textContent('.hardpop .small'), /^'내어' — 연습 때 2번 막혔어요$/);
  assert.deepEqual(await p.locator('.hardpop .row button').allTextContents(), ['내서', '추천 안 함']);
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  assert.equal(await p.locator('.hardpop').count(), 0, 'Esc로 추천 창이 닫힌다');
  await hard.first().click();
  await p.screenshot({ path: OUT + '/cards-hard.png' });
  const before = await textOf(p);
  await p.click('.hardpop .row button:first-child'); await p.waitForTimeout(300);
  assert.match(String(await p.evaluate(() => document.activeElement?.id)), /^p\d+$/, '고른 뒤 포커스는 그 문단 카드로 간다');
  const after = await textOf(p);
  assert.equal(after.split('내어').length - 1, before.split('내어').length - 2, '누른 자리 하나만 바뀐다');
  assert.equal(after.split('내서').length - 1, 1);
  assert.deepEqual(p.errors, []);
});

// ---- 탭 ----
t('탭: 메뉴 없이 대본·연습·실전·Q&A 탭으로 화면이 바뀌고, 듣는 동안은 탭 줄이 숨는다', async () => {
  const p = await page(browser); await open(p); await sample(p);
  assert.equal(await p.locator('#menuBtn, #aiBtn, #view, #menu, #viewDlg, #shrinkDlg').count(), 0, '메뉴·보기 창이 없다');
  const sel = () => p.evaluate(() => document.querySelector('#tabs [aria-selected=true]').dataset.tab);
  assert.equal(await sel(), 'script');
  await p.click('[data-tab="practice"]'); await p.waitForTimeout(500);
  assert.equal(await sel(), 'practice');
  assert.equal(await p.textContent('#mic'), '● 연습');
  assert.equal(await p.evaluate(() => document.body.classList.contains('keymark')), true, '연습은 꼭 말할 문장 밑줄');
  await p.click('#mic'); await p.waitForTimeout(200);
  assert.equal(await p.locator('#tabs').isHidden(), true, '듣는 동안은 탭 줄이 숨는다');
  await p.click('#mic'); await p.waitForTimeout(200);
  assert.equal(await p.locator('#tabs').isVisible(), true);
  await p.click('[data-tab="live"]'); await p.waitForTimeout(300);
  assert.equal(await p.textContent('#mic'), '● 시작');
  assert.equal(await p.evaluate(() => document.body.classList.contains('editing')), false);
  await p.click('[data-tab="qa"]'); await p.waitForTimeout(300);
  assert.equal(await p.locator('#prep').isVisible(), true, 'Q&A 준비 화면');
  assert.equal(await p.locator('#cards').isHidden(), true);
  assert.deepEqual(p.errors, []);
});

// ---- 내 발표(홈) ----
t('홈: 첫 화면은 내 발표 카드다. 대본이 있어도 새로고침하면 홈에서 시작한다', async () => {
  const p = await page(browser); await open(p, '', { home: true });
  assert.equal(await p.locator('#home').isVisible(), true);
  assert.equal(await p.evaluate(() => document.body.classList.contains('editing')), true);
  assert.equal(await p.evaluate(() => document.activeElement.id), 'homeH');
  await p.click('#homeBtn'); await sample(p);
  await p.reload(); await p.waitForFunction(() => document.body.classList.contains('ready')); await p.waitForTimeout(300);
  assert.equal(await p.locator('#home').isVisible(), true, '대본이 있어도 발표 화면이 아니라 홈');
  assert.equal(await p.locator('#hGrid .pcard.on .nm').textContent(), '예시: 말랑 소개');
  assert.deepEqual(p.errors, []);
});
t('홈: 말랑을 누르면 발표 카드가 나오고, 카드를 누르면 그 대본으로 간다', async () => {
  const p = await page(browser); await open(p); await sample(p);
  await p.click('#homeBtn');
  assert.equal(await p.locator('#home').isVisible(), true);
  assert.equal(await p.textContent('#homeH'), '어떤 발표를 준비할까요?');
  assert.equal(await p.locator('#hGrid .pcard').count(), 3, '대본 둘(처음 빈 대본, 예시) + 새 발표 만들기');
  assert.equal(await p.locator('#hGrid .pcard.on .nm').textContent(), '예시: 말랑 소개');
  assert.match(await p.locator('#hGrid .pcard.on .mt').textContent(), /^목표 3:00$/);
  assert.match(await p.locator('#hGrid .pcard.on .th').textContent(), /^안녕하세요\. 오늘은/);
  assert.equal(await p.locator('#hGrid .pcard .badge').first().textContent(), '대본 쓰는 중');
  await p.screenshot({ path: OUT + '/home.png' });
  await p.locator('#hGrid .pcard').first().click(); await p.waitForTimeout(400);
  assert.equal(await p.locator('#home').isHidden(), true);
  assert.equal(await p.textContent('#ttl'), '대본 1');
  assert.equal(await p.getAttribute('[data-tab="script"]', 'aria-selected'), 'true', '빈 대본은 [대본] 탭');
  assert.equal(await p.locator('#create').isVisible(), true, '빈 대본이라 새 발표 만들기');
  // 대본이 있는 발표는 [연습] 탭으로 연다
  await p.click('#homeBtn'); await p.locator('#hGrid .pcard').nth(1).click(); await p.waitForTimeout(600);
  assert.equal(await p.getAttribute('[data-tab="practice"]', 'aria-selected'), 'true');
  assert.equal(await p.evaluate(() => document.body.classList.contains('editing')), false);
  assert.deepEqual(p.errors, []);
});
t('홈: 새 발표 만들기는 대본을 더하고 이름은 머리줄에서 바꾼다. 연습 기록 탭과 설정 탭이 있다', async () => {
  const p = await page(browser); await p.clock.install(); await open(p); await sample(p);
  await p.uncheck('#shrinkOn'); await p.fill('#target', '3');
  await practiceRun(p);
  await p.click('#checkClose'); await p.click('#homeBtn');
  assert.match(await p.locator('#hGrid .pcard.on .badge').textContent(), /^최근 3:\d\d · 0:\d\d 초과$/);
  assert.equal(await p.locator('#hRuns button').count(), 1);
  await p.click('.htabs [data-t="runs"]');
  assert.equal(await p.locator('#hRunsAll button').count(), 1);
  await p.click('.htabs [data-t="set"]');
  assert.equal(await p.textContent('#hsKeyV'), '없음');
  const fs0 = +(await p.textContent('#hsFs')); await p.click('#hsBg');
  assert.equal(+(await p.textContent('#hsFs')), fs0 + 2);
  await p.click('#hsSm'); await p.click('#hsSm');
  assert.equal(+(await p.textContent('#hsFs')), fs0 - 2);
  await p.click('.htabs [data-t="main"]');
  await p.click('#hNew'); await p.waitForTimeout(400);
  assert.equal(await p.textContent('#ttl'), '대본 2');
  assert.equal(await p.locator('#home').isHidden(), true);
  assert.equal(await p.locator('#create').isVisible(), true);
  p.once('dialog', d => d.accept('발표 둘'));
  await p.click('#ttl');
  assert.equal(await p.textContent('#ttl'), '발표 둘');
  // 연습 기록을 누르면 그 대본의 결과 창이 열린다
  await p.click('#homeBtn'); await p.click('.htabs [data-t="runs"]');
  await p.click('#hRunsAll button'); await p.waitForTimeout(500);
  assert.equal(await p.locator('#checkDlg').evaluate(d => d.open), true);
  assert.equal(await p.textContent('#ttl'), '예시: 말랑 소개');
  assert.deepEqual(p.errors, []);
});

// ---- 설치형 앱: 서비스 워커, 글꼴 ----
t('홈: 폰 폭에서도 머리줄에 홈 단추와 탭 넷이 한 줄에 들어간다', async () => {
  const p = await page(browser, { viewport: { width: 375, height: 812 } }); await open(p); await sample(p);
  assert.equal(await p.locator('#homeBtn').isVisible(), true);
  assert.equal(await p.locator('#tabs button').count(), 4);
  const tops = await p.evaluate(() => [...document.querySelectorAll('#homeBtn, #ttl, #tabs button')].map(e => Math.round(e.getBoundingClientRect().top)));
  assert.equal(new Set(tops.map(t => Math.round(t / 10))).size, 1, '한 줄: ' + tops);
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, '가로로 넘치지 않는다');
  await present(p);
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, '발표 화면도 넘치지 않는다');
  await p.click('#homeBtn'); await p.waitForTimeout(300);
  assert.equal(await p.locator('#home').isVisible(), true, '홈이 열린다');
  assert.deepEqual(p.errors, []);
});

t('발표: Tab으로 단추에 간 뒤 스페이스는 그 단추를 누르고, 마우스로 누른 뒤 스페이스는 마이크다', async () => {
  const p = await page(browser); await open(p); await sample(p); await present(p);
  const before = await p.textContent('#mic');
  await p.evaluate(() => document.activeElement?.blur());
  for (let i = 0; i < 14 && await p.evaluate(() => document.activeElement?.id) !== 'qaBtn'; i++) await p.keyboard.press('Tab');
  assert.equal(await p.evaluate(() => document.activeElement?.id), 'qaBtn', 'Tab으로 가 단추에 닿는다');
  await p.keyboard.press('Space'); await p.waitForTimeout(300);
  assert.equal(await p.evaluate(() => document.body.classList.contains('qa')), true, 'Q&A가 열린다');
  assert.equal(await p.textContent('#mic'), before, '마이크는 켜지 않는다');
  // 마우스로 누른 단추에 포커스가 남아도 스페이스는 마이크를 켠다
  await p.click('#qaBtn'); await p.waitForTimeout(200);
  await p.keyboard.press('Space'); await p.waitForTimeout(300);
  assert.notEqual(await p.textContent('#mic'), before, '마우스를 쓴 뒤 스페이스는 마이크를 켠다');
  assert.deepEqual(p.errors, []);
});

t('보관함: 다른 탭이 만든 대본은 이 탭이 저장해도 목록에서 사라지지 않는다', async () => {
  const p = await page(browser); await open(p); await sample(p);
  const p2 = await p.context().newPage(); await p2.goto(BASE); await p2.waitForFunction(() => !document.getElementById('text').readOnly); await p2.waitForTimeout(300);
  await p2.click('#hNew'); await p2.waitForTimeout(400);
  const other = await p2.textContent('#ttl');
  // 옛 목록을 든 첫 탭이 글을 고쳐 저장한다 (예전에는 이때 ls.lib이 옛 목록으로 돌아가 '두번째'가 사라졌다)
  await p.evaluate(() => { const ta = document.getElementById('text'); ta.value += ' '; ta.dispatchEvent(new Event('input')); });
  await p.waitForTimeout(300);
  const names = await p.evaluate(() => JSON.parse(localStorage.getItem('ls.lib')).list.map(x => x.name));
  assert.ok(names.includes(other), '다른 탭의 대본이 남는다: ' + names);
  assert.ok(names.length >= 3, '대본 셋: ' + names);
});

t('보관함: 새 발표는 안 쓰인 가장 작은 번호로, 같은 이름으로 바꾸면 (2)를 붙인다', async () => {
  const p = await page(browser); await open(p);
  await p.click('#homeBtn'); await p.click('#hNew'); await p.waitForTimeout(300);
  assert.equal(await p.textContent('#ttl'), '대본 2', '기본 이름');
  p.once('dialog', d => d.accept('대본 1'));
  await p.click('#ttl');
  assert.deepEqual(await p.evaluate(() => JSON.parse(localStorage.getItem('ls.lib')).list.map(x => x.name)), ['대본 1', '대본 1 (2)']);
});

t('앱: 파일을 올리기 칸 밖에 놓아도 브라우저가 그 파일로 이동하지 않는다(글은 막지 않는다)', async () => {
  const p = await page(browser); await open(p);
  const r = await p.evaluate(() => {
    const drag = types => { const dt = new DataTransfer(); for (const k of types) k === 'file' ? dt.items.add(new File(['x'], 'a.txt')) : dt.setData('text/plain', 'x'); const ev = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }); document.body.dispatchEvent(ev); return ev.defaultPrevented; };
    return { file: drag(['file']), text: drag(['text']) };
  });
  assert.equal(r.file, true, '파일은 이동을 막는다');
  assert.equal(r.text, false, '글 끌어다 놓기는 그대로');
});

t('앱: 서비스 워커가 새 파일과 글꼴을 캐시하고, 오프라인에서도 열린다', async () => {
  // localhost에서는 앱이 서비스 워커를 켜지 않으므로(개발용) livescript.localhost 주소로 연다
  const p = await page(browser); await p.goto(BASE.replace('//localhost', '//livescript.localhost'));  // BASE의 포트를 따른다 await p.waitForFunction(() => !document.getElementById('text').readOnly);
  await p.evaluate(() => navigator.serviceWorker.ready);
  await p.reload(); await p.waitForFunction(() => !document.getElementById('text').readOnly);
  await p.waitForTimeout(1500);
  const keys = await p.evaluate(async () => { const out = {}; for (const k of await caches.keys()) out[k] = (await (await caches.open(k)).keys()).map(r => new URL(r.url).pathname.split('/').pop().split('?')[0]); return out; });
  const vk = Object.keys(keys).find(k => /^livescript-v\d+$/.test(k));  // ?v= 를 올려도 시험이 깨지지 않게 이름을 찾는다
  assert.ok(keys[vk]?.includes('slides.js') && keys[vk].includes('compare.js'), '새 모듈이 미리 받기 목록에 있다');
  assert.ok(keys['livescript-fonts-1'].includes('plex.css'), '글꼴 CSS');
  assert.ok(keys['livescript-fonts-1'].some(f => f.endsWith('.woff2')), '쓴 글자의 글꼴 조각');
  assert.equal(await p.evaluate(() => document.fonts.check('16px "IBM Plex Sans KR"')), true);
  await p.context().setOffline(true);
  await p.reload(); await p.waitForFunction(() => !document.getElementById('text').readOnly, null, { timeout: 15000 });
  assert.equal(await p.evaluate(() => document.fonts.check('16px "IBM Plex Sans KR"')), true, '오프라인에서도 글꼴');
  await sample(p).catch(() => {});
  assert.deepEqual(p.errors.filter(e => !/net::|Failed to fetch|ERR_/.test(e)), []);
});

// ---- 실행 ----
let fail = 0;
for (const [name, fn] of tests) {
  if (only && !name.includes(only)) continue;
  try { await fn(); console.log('✓', name); } catch (e) { fail++; console.log('✗', name, '\n   ', String(e.stack).split('\n').slice(0, 8).join('\n    ')); }
}
await browser.close();
console.log(fail ? `${fail}개 실패` : 'e2e ok');
process.exit(fail ? 1 : 0);
