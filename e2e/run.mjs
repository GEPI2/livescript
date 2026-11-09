// 화면 시험. 앱 서버를 먼저 띄운다: python3 -m http.server 8765  →  node e2e/run.mjs [이름 조각]
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { launch, page, open, sample, BASE, AI } from './lib.mjs';
import { pptx, pdf, SLIDES } from './fixtures.mjs';
import { paraSpans, sentSpans, paras, headOf } from '../lib.js';

const only = process.argv[2] || '';
const browser = await launch();
const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const OUT = process.env.OUT || '/tmp/e2e-out';
fs.mkdirSync(OUT, { recursive: true });

const mediaKeys = p => p.evaluate(() => new Promise(ok => { const q = indexedDB.open('livescript-rec'); q.onsuccess = () => { const r = q.result.transaction('media').objectStore('media').getAllKeys(); r.onsuccess = () => ok(r.result.map(String)); }; }));

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
  for (let i = 0; i < 50 && (await mediaKeys(p)).length; i++) await p.waitForTimeout(20);
  assert.deepEqual(await mediaKeys(p), [], '뺀 자료는 이 기기에서도 지운다(Q&A 답·문단 칩에 남지 않게)');
  await p.click('#ePaste'); await p.fill('#text', '첫 문단이에요.\n\n둘째 문단이에요.');
  assert.equal(await p.locator('#cList .pc').count(), 2);
  assert.equal(await p.locator('#cList .pslide').count(), 0, '뺀 자료의 슬라이드 칩이 없다');
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

// ---- 질문 답변: Q&A를 켜면 누를 것 없이 답 카드, 답하는 동안 잠금, 관련 대본 구간 ----
// 질문을 따라 말한다(중간 결과 뒤 확정). Q&A가 꺼져 있으면 켠다(켜면 마이크도 켜진다)
const askQ = async (p, q) => {
  if (!await p.evaluate(() => document.body.classList.contains('qa'))) { await p.click('#qaBtn'); await p.waitForTimeout(300); }
  await p.evaluate(t => window.__say(t, false), q.slice(0, Math.ceil(q.length / 2))); await p.waitForTimeout(100);
  await p.evaluate(t => window.__fin(t), q); await p.waitForTimeout(300);
};
t('질문: Q&A를 켜고 질문을 따라 말하면 답 카드가 바로 뜨고, 답하는 동안은 잠겼다가 새 질문에 바뀐다', async () => {
  const p = await page(browser); await open(p); await sample(p);
  await p.uncheck('#shrinkOn'); await present(p);
  await p.click('#qaBtn'); await p.waitForTimeout(300);
  assert.equal(await p.textContent('#mic'), '정지', 'Q&A를 켜면 듣기 시작한다');
  assert.equal(await p.locator('#ask').isHidden(), true);
  await p.evaluate(() => window.__say('무료로 쓸 수', false)); await p.waitForTimeout(100);
  assert.equal(await p.locator('#card').isVisible(), true, '말하는 동안에도 카드');
  assert.match(await p.textContent('#cardHeard'), /^듣는 중/);
  await p.evaluate(() => window.__fin('무료로 쓸 수 있나요')); await p.waitForTimeout(300);
  assert.equal(await p.textContent('#cardHeard'), '가장 비슷한 질문');
  assert.equal(await p.textContent('#cardRank'), '1순위');
  assert.deepEqual(await p.locator('#cardKeys span').allTextContents(), ['설치 없이 무료', '무료 오픈소스 모델', 'AI 비용 없음']);
  assert.match(await p.textContent('#qaTime'), /글자 비교로 골랐어요 · \d+ms$/);
  assert.equal(await p.locator('#ask').isVisible(), true, '잠기면 다음 질문 단추');
  const q1 = await p.textContent('#cardQ');
  // 답하는 말에는 카드가 바뀌지 않는다
  await p.evaluate(() => window.__fin('네 설치 없이 브라우저에서 무료로 쓸 수 있습니다 안드로이드 크롬에서도 됩니다')); await p.waitForTimeout(300);
  assert.equal(await p.textContent('#cardQ'), q1, '답하는 동안 잠금');
  // 묻는 말끝이면 새 질문
  await p.evaluate(() => window.__fin('아이폰이나 안드로이드에서도 되나요')); await p.waitForTimeout(300);
  assert.match(await p.textContent('#cardQ'), /아이폰/);
  await p.screenshot({ path: OUT + '/qa-card.png' });
  // 다음 질문을 누르면 카드를 비우고 다시 듣는다
  await p.click('#ask');
  assert.equal(await p.locator('#card').isHidden(), true);
  assert.deepEqual(p.errors, []);
});
t('질문: 해당 없음을 누르면 관련 대본 구간이 나오고, 누르면 그 문장으로 돌아간다', async () => {
  const p = await page(browser); await open(p); await sample(p);
  await p.uncheck('#shrinkOn'); await present(p);
  await askQ(p, '대본 밖에서 한 말은 어떻게 되나요');
  await p.locator('.chip.none:visible').first().click();
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
t('질문: [Q&A] 탭에서 분류로 묶인 질문을 펼쳐 핵심 키워드를 고치면 바로 저장되고 카드에 반영된다', async () => {
  const p = await page(browser); await open(p); await sample(p);
  await p.uncheck('#shrinkOn');
  await p.click('[data-tab="qa"]'); await p.waitForSelector('#qList .qitem');
  assert.deepEqual(await p.locator('#qList h3').evaluateAll(hs => hs.map(h => h.firstChild.textContent)), ['내용', '근거·숫자', '한계·위험', '활용·계획'], '분류 차례로 묶는다');
  assert.equal(await p.locator('#qList .qitem[open]').count(), 0, '처음엔 접혀 있다');
  const it = p.locator('#qList .qitem', { hasText: '무료로 쓸 수 있나요' });
  await it.locator('summary').click();
  const f = it.locator('input').nth(1);
  assert.equal(await f.inputValue(), '설치 없이 무료, 무료 오픈소스 모델, AI 비용 없음');
  await f.fill('설치 없이 무료, 새 키워드');
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith('ls.pack.')))).questions.find(q => q.q.startsWith('무료')));
  assert.deepEqual([saved.keys, saved.mine], [['설치 없이 무료', '새 키워드'], true], '바로 저장되고 고친 질문으로 표시');
  await p.fill('#qFind', '아이폰');
  assert.equal(await p.locator('#qList .qitem').count(), 1, '찾기');
  await present(p);
  await askQ(p, '무료로 쓸 수 있나요');
  assert.deepEqual(await p.locator('#cardKeys span').allTextContents(), ['설치 없이 무료', '새 키워드']);
});
t('질문: 질문 만들기 한 번으로 분류된 목록이 생기고, 다시 만들어도 고친 질문은 남고, 더 만들기는 겹치지 않게 보탠다', async () => {
  const p = await page(browser); await open(p); await sample(p);
  const pack = (n, w) => ({ version: 1, questions: Array.from({ length: n }, (_, i) => ({ id: 'q0' + i, q: `${w} 질문 ${i}`, alts: ['다른 말 ' + i], answer: ['답'], keys: ['키'], source: '', check: false, cat: i ? '비교' : '내용', slide: 0 })) });
  const sent = [];
  await mockAi(p, b => { sent.push(b.messages[0].content); return pack(sent.length === 1 ? 3 : 2, ['', '첫', '둘째', '셋째'][sent.length]); });
  await p.click('[data-tab="qa"]'); await p.waitForSelector('#qList .qitem');
  assert.equal(await p.textContent('#gen'), '질문 다시 만들기');
  await p.click('#gen'); await p.waitForFunction(() => /질문 3개를 넣었어요/.test(document.getElementById('prepMsg').textContent));
  assert.equal(await p.locator('#qList .qitem').count(), 3, '예시 질문 8개 대신 새 질문 3개');
  assert.deepEqual(await p.locator('#qList h3').evaluateAll(hs => hs.map(h => h.firstChild.textContent)), ['내용', '비교']);
  assert.ok(sent[0].includes('<대본>') && sent[0].includes('주제: 말랑 소개'), '대본과 발표 정보를 보낸다');
  const first = p.locator('#qList .qitem').first();
  await first.locator('summary').click(); await first.locator('input').first().fill('내가 고친 질문');
  await p.click('#gen'); await p.waitForFunction(() => /직접 고친 질문 1개는 그대로/.test(document.getElementById('prepMsg').textContent));
  assert.deepEqual((await p.locator('#qList .qitem .qt').allTextContents()).sort(), ['내가 고친 질문', '둘째 질문 0', '둘째 질문 1'].sort(), '고친 질문은 남고 나머지는 새 질문');
  await p.click('#genMore'); await p.waitForFunction(() => /더 만든 질문 2개를 넣었어요/.test(document.getElementById('prepMsg').textContent));
  assert.equal(await p.locator('#qList .qitem').count(), 5);
  assert.ok(sent[2].includes('<이미있는질문>\n- 내가 고친 질문'), '있는 질문과 겹치지 않게');
  assert.equal(JSON.parse(await p.evaluate(() => localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith('ls.pack.'))))).questions.length, 5, '바로 저장');
  assert.deepEqual(p.errors, []);
});

t('질문: 발표 자료를 올리면 질문마다 슬라이드를 고르고, 그림을 붙이면 답 카드에 함께 보인다', async () => {
  const p = await page(browser); await open(p); await sample(p);
  await p.uncheck('#shrinkOn');
  await p.click('[data-tab="qa"]'); await p.waitForSelector('#qList .qitem');
  await p.setInputFiles('#qaFile', { name: '발표.pdf', mimeType: 'application/pdf', buffer: await pdf(browser) });
  await p.waitForFunction(() => /^발표 자료: 발표\.pdf · 4장/.test(document.getElementById('qaMatT').textContent), null, { timeout: 20000 });
  for (let i = 0; i < 100 && !(await mediaKeys(p)).some(k => k.endsWith(':thumb:4')); i++) await p.waitForTimeout(100);
  assert.ok((await mediaKeys(p)).some(k => k.endsWith(':thumb:2')), 'PDF 쪽 그림을 이 기기에 둔다');
  const outline = await p.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith('ls.qaInfo.')))).outline);
  assert.equal(outline.split('\n').length, 4, '질문을 만들 때 보낼 슬라이드 개요');
  // 무료 질문에 2번 슬라이드, 아이폰 질문에 그림
  const it = p.locator('#qList .qitem', { hasText: '무료로 쓸 수 있나요' });
  await it.locator('summary').click();
  await it.locator('select').nth(1).selectOption('2');
  assert.match(await p.locator('#qList .qitem', { hasText: '무료로 쓸 수 있나요' }).locator('summary').textContent(), /슬라이드 2/);
  const ip = p.locator('#qList .qitem', { hasText: '아이폰이나' });
  await ip.locator('summary').click();
  const png = Buffer.from(await p.evaluate(() => new Promise(ok => { const c = document.createElement('canvas'); c.width = 40; c.height = 30; c.getContext('2d').fillRect(0, 0, 20, 15); c.toBlob(b => b.arrayBuffer().then(a => ok([...new Uint8Array(a)])), 'image/png'); })));
  await ip.locator('input[type=file]').setInputFiles({ name: 'a.png', mimeType: 'image/png', buffer: png });
  await p.waitForSelector('#qList .qitem img.qimg');
  assert.match(await p.locator('#qList .qitem', { hasText: '아이폰이나' }).locator('summary').textContent(), /그림/);
  await present(p);
  await askQ(p, '무료로 쓸 수 있나요');
  await p.waitForSelector('#cardMat img');
  assert.equal(await p.getAttribute('#cardMat img', 'alt'), '슬라이드 2: 문제');
  assert.equal(await p.textContent('#cardMat .ms'), '슬라이드 2');
  await askQ(p, '아이폰이나 안드로이드에서도 되나요');
  await p.waitForFunction(() => document.querySelector('#cardMat img')?.alt === '답에 붙인 그림');
  assert.deepEqual(p.errors, []);
});

// ---- 연습 결과: 대본과 실제로 한 말, 수정 제안, 회차별 시간 ----
const SAMPLE = JSON.parse(fs.readFileSync(new URL('../sample.livescript.json', import.meta.url), 'utf8'));
const SENTS = SAMPLE.text.split(/\n+/).flatMap(par => par.split(/(?<=[.?!])\s+/)).filter(Boolean);
// 연습 한 번: 문장마다 확정 결과로 읽는다. mutate(문장 번호, 문장) → 실제로 말한 글
// warm: 마이크를 켠 뒤 기다릴 실제 ms(가짜 마이크와 녹음이 켜지기까지. 시험의 연습은 실제로 몇 초 만에 끝난다)
async function practiceRun(p, mutate = (i, x) => x, first = true, warm = 300, total = 200000) {
  await p.click(first ? '[data-tab="practice"]' : '#cPractice'); await p.waitForTimeout(500);
  await p.click('#mic'); await p.waitForTimeout(warm);
  const dt = total / SENTS.length;
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
// AI 중계를 흉내 낸다
const mockAi = (p, f) => {
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
  const sse = o => [{ type: 'message_start', message: { id: 'm', content: [] } }, { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: JSON.stringify(o) } }, { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 9 } }, { type: 'message_stop' }].map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
  return p.route(AI, r => r.request().method() === 'OPTIONS' ? r.fulfill({ status: 204, headers: cors })
    : r.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: sse(f(JSON.parse(r.request().postData()))) }));
};
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
  assert.equal(await p.textContent('#cSug .why'), '연습 2번 연속 이렇게 말했어요');
  assert.deepEqual([await p.textContent('#cSug .chg del'), await p.textContent('#cSug .chg ins')], ['내어', '내서']);
  assert.equal(await p.textContent('#cStats .stat:nth-child(4) .note'), '대본 고칠 점 1개');
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
t('결과: 연습을 정지하면 대본과 들은 말로 AI 코칭을 바로 받는다', async () => {
  const p = await page(browser); await p.clock.install(); await open(p); await sample(p);
  await p.uncheck('#shrinkOn'); await p.fill('#target', '3');
  const coach = { summary: '시간은 맞췄어요.', tips: [{ sec: 2, what: "'그러니까'로 문장을 시작하는 말버릇이 있었어요.", how: '첫 낱말 앞에서 한 박자 쉬고 바로 시작해 보세요.' }] };
  const sse = [{ type: 'message_start', message: { id: 'm', content: [] } }, { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: JSON.stringify(coach) } }, { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 9 } }, { type: 'message_stop' }]
    .map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
  const sent = [], cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
  await p.route(AI, r => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    sent.push(JSON.parse(r.request().postData()));
    return r.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: sse });
  });
  await practiceRun(p, (i, x) => i === 2 ? '그러니까 ' + x : x);
  for (let i = 0; i < 50 && await p.textContent('#cTipsH') !== 'AI 코칭'; i++) await p.waitForTimeout(100);
  assert.equal(await p.textContent('#cTipsH'), 'AI 코칭');
  assert.equal(sent.length, 1, '정지할 때 한 번 보낸다');
  const u = sent[0].messages[0].content;
  assert.ok(u.includes('<대본과한말>\n1번 구간\n대본: ' + SENTS[0]), '읽은 구간의 대본');
  assert.ok(u.includes('한 말: 그러니까 ') || u.includes(' 그러니까 '), '들은 말');
  assert.equal(await p.textContent('#cAiSum'), coach.summary);
  assert.match(await p.textContent('#cTips li .tip-t'), /^2번 구간: '그러니까'로 문장을 시작하는 말버릇이 있었어요\.$/);
  assert.match(await p.textContent('#cTips li .tip-a'), /^첫 낱말 앞에서/, 'AI 팁도 무엇과 어떻게를 나눠 보인다');
  assert.deepEqual(p.errors, []);
});
t('결과: 회차별 시간 막대와 구간부터 연습 단추', async () => {
  const p = await page(browser); await p.clock.install(); await open(p); await sample(p);
  await p.uncheck('#shrinkOn'); await p.fill('#target', '3');
  await practiceRun(p); await practiceRun(p, (i, x) => x, false);
  assert.equal(await p.locator('#cHist div').count(), 2);
  assert.equal(await p.locator('#cHist .now').count(), 1);
  await p.click('#cHistM [data-m="rate"]');
  assert.match(await p.textContent('#cHist div span'), /^\d+$/, '말 빠르기로 바꿔 본다');
  // 지난번 고칠 점: 같은 연습을 되풀이했으니 목표를 넘은 것은 아직이다
  assert.equal(await p.locator('#cFixed').isVisible(), true);
  assert.equal(await p.getAttribute('#cFixedList li', 'class'), 'still');
  assert.match(await p.textContent('#cFixedList li'), /^아직이에요.*\d+:\d\d (넘었어요|길어요)\.$/);
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
  // 고칠 점마다 기준 한 줄, 지적한 구간은 녹음으로 다시 듣는다(가짜 마이크는 한 음 높이라 높낮이 폭이 좁다고 나온다)
  const tipN = await p.locator('#cTips li').count();
  assert.ok(tipN >= 1, '고칠 점');
  assert.equal(await p.locator('#cTips li .tip-h').count(), tipN, '고칠 점마다 머리줄(기준 이름 · 기준)');
  assert.match(await p.locator('#cTips li .tip-h').first().textContent(), /^\S+( \S+)*기준 \S/);
  assert.equal(await p.locator('#cTips li .tip-t').count(), tipN, '무엇이 문제였는지 한 줄');
  assert.equal(await p.locator('#cTips li .tip-h').evaluateAll(es => es.every(e => e.getBoundingClientRect().height < 30)), true, '머리줄은 줄을 바꾸지 않는다');
  assert.match(await p.textContent('#cCritList dd'), / · /, '평가 기준 목록은 · 로 이은 한 줄');
  await p.evaluate(() => { document.getElementById('cCrit').open = true; }); await p.locator('#cTipsH').scrollIntoViewIfNeeded();
  await p.screenshot({ path: OUT + '/rec-tips.png' });
  const vp = p.viewportSize(); await p.setViewportSize({ width: 375, height: 812 }); await p.locator('#cTipsH').scrollIntoViewIfNeeded();
  await p.screenshot({ path: OUT + '/rec-tips-phone.png' });
  assert.equal(await p.locator('#checkDlg').evaluate(d => d.scrollWidth <= d.clientWidth + 1), true, '폰에서 결과 창이 가로로 넘치지 않는다');
  await p.setViewportSize(vp); await p.evaluate(() => { document.getElementById('cCrit').open = false; });
  const cb = p.locator('#cTips .clips button.play');
  assert.ok(await cb.count() >= 1, `지적한 구간 듣기 ${await p.textContent('#cTips')}`);
  assert.match(await cb.first().getAttribute('aria-label'), /^\d+번 구간 녹음 듣기$/);
  await p.evaluate(() => document.getElementById('cAudio').pause());
  await cb.first().click(); await p.waitForTimeout(600);
  assert.equal(await p.evaluate(() => !document.getElementById('cAudio').paused && +document.getElementById('cAudio').dataset.to > 0), true, '누르면 그 구간만 들려 준다');
  assert.equal(await p.locator('#cCritList dt').count(), 10, '평가 기준 전체 목록');
  // 녹음 아래 구간 띠: 누르면 그 자리부터 듣고, 듣는 구간 줄에 불이 들어온다
  assert.ok(await p.locator('#cMarks button').count() >= 2, '구간 띠');
  await p.locator('#cMarks button').nth(1).click(); await p.waitForTimeout(800);
  assert.equal(await p.locator('#cSecs .sec.now').count(), 1, '듣는 구간 줄');
  assert.equal(await p.locator('#cMarks button.now').count(), 1);
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
t('준비: 평가 기준을 적고 발표 준비를 하면 흐름, 핵심 문장 제안, 다루지 않은 기준이 보이고 카드에 역할 칩이 생긴다', async () => {
  const p = await page(browser); await open(p); await sample(p);
  await p.fill('#edAside [data-info="rubric"]', '1. 문제를 분명히 말했나\n2. 한계와 개선점\n3. 목소리 크기');
  const ps = paras(SAMPLE.text), roles = ['도입', '문제', '해결'];
  const ans = { paras: ps.map((x, i) => ({ p: i + 1, imp: 2, keep: [1], drop: [], role: roles[i % 3], tone: '또렷하게', e: i === 1 ? 3 : 2 })),
    keys: [{ p: 2, s: 1, why: '문제 제기', r: 1 }],
    crit: [{ r: 1, kind: '내용', ps: [2], at: 0, how: '' }, { r: 2, kind: '내용', ps: [], at: 3, how: '셋째 문단에 한계를 한 문장 더해 주세요.' }, { r: 3, kind: '전달', ps: [], at: 0, how: '' }], kw: [] };
  const sent = [];
  await mockAi(p, b => (sent.push(b), ans));
  await p.click('#prepGo');  // 누르면 바로 보낸다
  await p.waitForFunction(() => /^발표 준비를 저장했어요/.test(document.getElementById('aiMsg').textContent));
  assert.ok(sent[0].messages[0].content.includes('<평가기준>\n1. 문제를 분명히 말했나\n2. 한계와 개선점\n3. 목소리 크기\n</평가기준>'), '평가 기준을 보낸다');
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
  assert.ok(sent[1]?.messages[0].content.includes('셋째 문단에 한계를 한 문장 더해 주세요.'), '바로 고치기를 보낸다');
  await p.click('#aiClose');
  assert.equal(await p.locator('#cList .pc .prole').count(), ps.length, '문단마다 역할 칩');
  assert.equal(await p.textContent('#cList .pc:nth-child(2) .prole'), '문제');
  assert.equal(await p.getAttribute('#cList .pc:nth-child(2) mark.must', 'title'), '문제 제기 · 평가 기준: 문제를 분명히 말했나');
  assert.deepEqual(p.errors, []);
});
t('결과: AI 코칭의 대본 고칠 점은 까닭과 바뀌는 곳을 보이고 바로 바꾼다. 옛 모양(지시)은 그 구간을 고른 채 AI로 고치기를 연다', async () => {
  const p = await page(browser); await p.clock.install(); await open(p); await sample(p);
  await p.uncheck('#shrinkOn'); await p.fill('#target', '3');
  const from = '크롬은 구글 서버로, 사파리는 애플 서버로 보냅니다.', to = '크롬은 구글 서버로 보냅니다. 사파리는 애플 서버로 보냅니다.';
  const coach = { summary: '시간은 맞췄어요.', tips: [{ sec: 1, what: '첫 구간이 빨랐어요.', how: '한 박자 쉬어 보세요.' }],
    edits: [{ sec: 2, why: '한 문장이 길어 숨이 차요.', from, to }, { sec: 2, what: '둘째 구간 문장이 길어요.', how: '둘째 구간의 긴 문장을 둘로 나눠 주세요.' }] };
  const sse = [{ type: 'message_start', message: { id: 'm', content: [] } }, { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: JSON.stringify(coach) } }, { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 9 } }, { type: 'message_stop' }].map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
  await p.route(AI, r => r.request().method() === 'OPTIONS' ? r.fulfill({ status: 204, headers: cors }) : r.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: sse }));
  await practiceRun(p);
  for (let i = 0; i < 50 && await p.textContent('#cTipsH') !== 'AI 코칭'; i++) await p.waitForTimeout(100);
  assert.deepEqual(await p.locator('#cSug .why').allTextContents(), ['2번 구간 · 한 문장이 길어 숨이 차요.', '2번 구간 · 둘째 구간 문장이 길어요.']);
  assert.equal(await p.textContent('#cSug .sug .chg del'), from);
  await p.locator('#cSug .sug .go').first().click(); await p.waitForTimeout(400);
  assert.ok((await textOf(p)).includes(to) && !(await textOf(p)).includes(from), '대본에서 바로 바꿨다');
  assert.match(await p.textContent('#checkMsg'), /^바꿨어요/);
  assert.equal(await p.locator('#cSug .sug').count(), 1, '바꾼 고칠 점은 사라진다');
  const ed = [];  // 이제 AI 고치기는 바로 보낸다. 받은 요청만 모으고 답하지 않는다(코칭 답이 대본 답으로 들어가지 않게)
  await p.route(AI, r => r.request().method() === 'OPTIONS' ? r.fulfill({ status: 204, headers: cors }) : void ed.push(JSON.parse(r.request().postData())));
  assert.equal(await p.textContent('#cSug .sug .go'), '2번 구간 고치기');
  await p.click('#cSug .sug .go'); await p.waitForTimeout(400);
  assert.equal(await p.locator('#ai').evaluate(d => d.open), true);
  assert.equal(await p.evaluate(() => document.body.classList.contains('editing')), true, '편집 화면으로');
  assert.equal(await p.inputValue('#instr'), '둘째 구간의 긴 문장을 둘로 나눠 주세요.');
  assert.equal(await p.isChecked('#onlySel'), true, '그 구간만');
  assert.ok(ed[0].messages[0].content.includes('<고칠부분>') && ed[0].messages[0].content.includes('둘째 구간의 긴 문장을 둘로 나눠 주세요.'), '그 구간만 바로 고치기를 보낸다');
  assert.equal(await p.textContent('#aiGo'), '멈추기');
  assert.deepEqual(p.errors, []);
});

t('결과: 연습 때 대본에 없던 말은 AI가 정리해 넣을 만한 것을 결과에 보이고, 누르면 대본에 넣는다', async () => {
  const p = await page(browser); await p.clock.install(); await open(p); await sample(p);
  await p.uncheck('#shrinkOn'); await p.fill('#target', '3');
  const AD = '여기서 잠깐 제 경험을 말씀드리면 저는 발표할 때마다 대본을 자주 놓쳐서 곤란했던 적이 많았어요', add = '저도 발표할 때마다 읽던 곳을 자주 놓쳤어요.';
  await mockAi(p, b => b.system.includes('애드리브') ? { items: [{ n: 1, title: '발표자의 경험', points: ['대본을 자주 놓쳤다'], worth: true, add: [add] }] }
    : { summary: '좋아요.', tips: [{ sec: 1, what: '첫 구간이 빨랐어요.', how: '한 박자 쉬어 보세요.' }] });
  await practiceRun(p, (i, x) => i === 3 ? x + ' ' + AD : x);
  await p.waitForSelector('#cAds:not([hidden]) .adw', { timeout: 10000 });
  assert.match(await p.textContent('#cAdSum'), /가운데 1개를 대본에 넣을 만해요\.$/);
  assert.equal(await p.textContent('#cAdList .adw .t'), '발표자의 경험');
  await p.click('#cAdList .adw button'); await p.waitForSelector('#adDlg[open]');
  await p.click('#adApply'); await p.waitForTimeout(300);
  assert.ok((await textOf(p)).includes(add), '대본에 들어갔다');
  assert.deepEqual(p.errors, []);
});

// ---- 발표 시간 줄과 내 읽기 속도 ----
const lsGet = (p, k) => p.evaluate(k => JSON.parse(localStorage.getItem(k)), k);
// 읽기 시험 글을 낱말마다 중간 결과로 읽는다(0.5초 간격). n: 읽을 낱말 수(없으면 끝까지). 낱말마다 들은 음절 수를 돌려준다
async function readTest(p, n) {
  const words = (await p.textContent('#spText')).split(' ').slice(0, n);
  await p.click('#spGo'); await p.clock.runFor(2000);
  const lens = await p.evaluate(ws => ws.map((_, i) => norm(ws.slice(0, i + 1).join(' ')).length), words);
  for (let k = 1; k <= words.length; k++) { await p.evaluate(t => window.__say(t), words.slice(0, k).join(' ')); await p.clock.runFor(500); await p.waitForTimeout(4); }
  return lens;
}
const mmssOf = sec => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
t('편집: 발표 시간은 한 줄이고, 예상을 누르면 홈의 내 말하기로 간다', async () => {
  const p = await page(browser); await open(p); await sample(p);
  await p.setViewportSize({ width: 1280, height: 800 });
  await p.fill('#target', '3'); await p.waitForTimeout(400);
  const box = await p.locator('footer.e-only').boundingBox();
  assert.ok(box.height <= 72, `한 줄 높이 ${box.height}`);
  assert.match(await p.textContent('#est'), /^예상 \d+:\d\d \(\+\d+:\d\d\)$/);
  assert.equal(await p.locator('#est').evaluate(e => e.scrollWidth <= e.clientWidth + 1), true, '넘친 시간이 잘리지 않는다');
  const est = (await p.textContent('#est')).match(/\d+:\d\d/)[0];
  await p.click('#est');
  assert.equal(await p.locator('#home').isVisible(), true, '창이 아니라 홈으로 간다');
  assert.equal(await p.locator('dialog[open]').count(), 0);
  assert.equal(await p.evaluate(() => document.activeElement.id), 'spTitle');
  assert.match(await p.textContent('#spSrc'), /^아직 안 쟀어요/);
  assert.equal(await p.textContent('#hGrid .pcard.on .mt'), `예상 ${est} · 목표 3:00`, '발표 카드와 시간 줄이 같은 예상');
  assert.equal(await p.textContent('#spGo'), '1분 읽고 내 속도 재기');
  assert.equal(await p.locator('#spCards').isHidden(), true, '재기 전에는 말하는 방식 카드가 없다');
  assert.match(await p.textContent('#spWhy'), /목소리 분석을 켜면|PC Chrome에서/, '잴 수 없는 기기에는 재기 전부터 까닭을 말한다(시험은 분석을 꺼 둔다)');
  assert.deepEqual(await p.locator('#spCrit dt').allTextContents(), ['빠르기', '문장 끝', '목소리 크기', '높낮이', '쉼'], '말하는 방식의 평가 기준');
  await p.setViewportSize({ width: 375, height: 812 }); await p.waitForTimeout(200);
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.getElementById('home').scrollWidth <= innerWidth), true, '폰에서 홈이 가로로 넘치지 않는다');
  await p.setViewportSize({ width: 375, height: 553 }); await p.click('#spGo'); await p.waitForTimeout(300);
  const tb = await p.locator('#spTest').boundingBox();
  assert.ok(tb.y >= 0 && tb.y + tb.height <= 553 + 1, `키 작은 폰에서도 시험 글과 단추가 한 화면에 들어간다 ${tb.y} ${tb.height}`);
  await p.keyboard.press('Escape');
  assert.equal(await p.locator('#home').isVisible(), true, 'Esc는 시험만 그만두고 홈은 그대로');
  assert.equal(await p.locator('#spDash').isVisible(), true);
  await p.click('#homeBtn');
  assert.equal(await p.locator('#est').isVisible(), true, '홈 단추를 다시 누르면 보던 편집 화면');
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, '폰에서 가로로 넘치지 않는다');
  assert.deepEqual(p.errors, []);
});
t('읽기 속도: 시험 글을 읽으면 기다린 시간은 빼고 재고, 예상 시간이 내 속도를 따른다', async () => {
  const p = await page(browser); await p.clock.install(); await open(p); await sample(p);
  await p.click('#est');
  const lens = await readTest(p);
  assert.equal(await p.locator('#spTest').isVisible(), true, '끝말을 듣고 1.5초 동안은 기다린다');
  await p.clock.runFor(2000); await p.waitForTimeout(50);
  // 가짜 시계도 실제 시간만큼은 흐른다(낱말마다 몇 ms). 그래서 3% 안에서 맞춘다
  const want = (lens.at(-1) - lens[0]) / ((lens.length - 1) * 0.5), lr = await lsGet(p, 'ls.rate'), r = lr.m / lr.s;
  assert.equal(lr.by, 'test');
  assert.equal(lr.m, lens.at(-1) - lens[0], '첫 결과부터 들은 음절');
  assert.ok(Math.abs(r - want) / want < 0.03, `잰 빠르기 ${r} ≈ ${want}`);
  assert.equal(await p.locator('#spDash').isVisible(), true, '다 읽으면 저절로 결과');
  assert.equal(await p.textContent('#spR'), `${Math.round(r * 60)} 음절/분`);
  assert.match(await p.textContent('#spSrc'), /^읽기 시험 · /);
  assert.match(await p.textContent('#spMsg'), /내 속도를 쟀어요/);
  assert.equal(await p.textContent('#spGo'), '다시 재기');
  const L = await p.evaluate(t => norm(t).length, SAMPLE.text), sec = Math.round(L / r);
  assert.ok((await p.textContent('#est')).startsWith(`예상 ${mmssOf(sec)}`), '시간 줄 예상이 잰 빠르기를 그대로 쓴다');
  assert.ok((await p.textContent('#hGrid .pcard.on .mt')).startsWith(`예상 ${mmssOf(sec)}`), '발표 카드도 새 속도로 다시 그린다');
  assert.equal(await p.locator('#spCards').isHidden(), true, '목소리 분석을 끈 브라우저는 카드 대신 까닭 한 줄');
  assert.match(await p.textContent('#spWhy'), /목소리 분석을 켜면|PC Chrome/);
  assert.equal((await lsGet(p, 'ls.readTest')).v, null);
  assert.deepEqual(p.errors, []);
});
t('읽기 속도: 절반만 읽으면 저장하지 않고, 시험 뒤에도 연습 인식이 된다', async () => {
  const p = await page(browser); await p.clock.install(); await open(p); await sample(p);
  // 연습 인식기를 먼저 만들어 둔다(시험 인식기가 따로 생겨도 연습으로 돌아가면 다시 듣는지 보려고)
  await p.click('[data-tab="practice"]'); await p.clock.runFor(500);
  await p.click('#mic'); await p.clock.runFor(300); await p.click('#mic'); await p.clock.runFor(800);
  if (await p.locator('#checkDlg[open]').count()) await p.click('#checkClose');
  await p.click('#homeBtn'); await p.clock.runFor(300);
  await readTest(p, 40);
  assert.equal(await p.textContent('#spEnd'), '다 읽었어요');
  await p.click('#spEnd');
  assert.match(await p.textContent('#spMsg'), /끝까지/);
  assert.equal(await p.textContent('#spEnd'), '다시 읽기');
  assert.equal(await lsGet(p, 'ls.rate'), null, '못 잰 값은 저장하지 않는다');
  // 못 잰 화면에서 다른 홈 탭으로 가면 결과 화면으로 돌리고, 거기서 Esc는 홈을 닫는다
  await p.click('.htabs [data-t="set"]'); await p.keyboard.press('Escape');
  assert.equal(await p.locator('#home').isHidden(), true, '설정 탭에서 Esc는 홈을 닫는다');
  await p.click('#homeBtn');
  assert.equal(await p.locator('#spDash').isVisible(), true, '다시 오면 시험 글이 아니라 결과');
  assert.equal(await p.textContent('#spMsg'), '', '못 잰 안내도 지운다');
  // 읽는 중에 홈을 닫으면 시험을 버린다(그 뒤에 들린 말은 세지 않는다)
  await readTest(p, 10);
  await p.click('#homeBtn');
  await p.evaluate(() => window.__say(document.getElementById('spText').textContent)); await p.clock.runFor(3000);
  assert.equal(await lsGet(p, 'ls.rate'), null, '닫은 뒤에는 재지 않는다');
  await p.click('[data-tab="practice"]'); await p.clock.runFor(500);
  await p.click('#mic'); await p.clock.runFor(300);
  await p.evaluate(() => window.__say('안녕하세요 오늘은 발표 대본을'));
  await p.clock.runFor(200);
  assert.match(await p.textContent('#heardT'), /안녕하세요 오늘은/, '연습 인식기가 다시 듣는다');
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
t('카드: 자료를 올리면 문단마다 슬라이드 칩이 붙고, 고른 쪽은 문단을 따라가며 내보내기·가져오기·지우기에 함께한다', async () => {
  const p = await page(browser); await open(p); await sample(p);
  await p.uncheck('#shrinkOn');
  const picked = () => p.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter(k => k.startsWith('ls.paraSlide.')).map(k => [k, JSON.parse(localStorage.getItem(k))])));
  const chips = () => p.locator('#cList .pc .pslide').allTextContents().then(a => a.map(x => +x.replace('슬라이드 ', '')));
  assert.equal(await p.locator('#cList .pslide').count(), 0, '자료가 없으면 칩도 없다');
  await p.click('[data-tab="qa"]'); await p.waitForSelector('#qList .qitem');
  await p.setInputFiles('#qaFile', { name: '발표.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: pptx() });
  await p.waitForFunction(() => /· 4장/.test(document.getElementById('qaMatT').textContent));
  await toScript(p);
  assert.deepEqual(await chips(), [1, 2, 3, 4, 4, 4, 4, 4], '문단 순서대로, 장수를 넘으면 마지막 쪽');
  // 2번 문단에 1쪽을 고른다
  await p.locator('#cList .pc').nth(1).click();
  const sel = p.locator('#cList .pc.on .pslidesel select');
  assert.equal(await sel.inputValue(), '0', '처음엔 자동');
  assert.equal(await sel.locator('option').first().textContent(), '자동 (2)', '자동이 몇 쪽인지 보인다');
  assert.equal(await sel.locator('option').count(), 5, '자동과 4장');
  const el = await sel.elementHandle();
  await sel.selectOption('1');
  assert.equal(await p.textContent('#cList .pc.on .pslide'), '슬라이드 1');
  assert.equal(await el.evaluate(e => e.isConnected), true, '카드를 다시 그리지 않아 고르던 칸이 그대로다');
  const h2 = headOf(SAMPLE.text.slice(...paraSpans(SAMPLE.text)[1]));
  assert.deepEqual(Object.values(await picked()), [{ [h2]: 1 }], '문단 머리글로 저장');
  // 열린 카드에서 첫머리를 고쳐도 고른 쪽이 따라간다
  const ta = p.locator('#cList .pc.on .pta');
  await ta.evaluate(e => { e.focus(); e.setSelectionRange(0, 0); }); await ta.pressSequentially('음, ');
  assert.deepEqual(Object.values(await picked()), [{ [headOf('음, ' + SAMPLE.text.slice(...paraSpans(SAMPLE.text)[1]))]: 1 }], '머리글이 바뀌면 키도 옮긴다');
  await sel.press('Escape');
  assert.equal(await p.locator('#cList .pc.on').count(), 0, '고르는 칸에서 Esc로 닫힌다');
  assert.deepEqual(await chips(), [1, 1, 3, 4, 4, 4, 4, 4]);
  await p.locator('#cList .pc').nth(1).click(); await p.locator('#cList .pc.on .pta').evaluate(e => { e.focus(); e.setSelectionRange(0, 3); }); await p.keyboard.press('Backspace'); await p.keyboard.press('Escape');
  assert.deepEqual(Object.values(await picked()), [{ [h2]: 1 }], '되돌려도 따라간다');
  // 앞에 문단을 넣어도 고른 쪽은 그 문단(이제 3번)을 따라간다
  await p.evaluate(() => { const k = Object.keys(localStorage).find(k => k.startsWith('ls.script.')); localStorage.setItem(k, '새 문단입니다.\n\n' + localStorage.getItem(k)); });
  await open(p); await toScript(p);
  await p.waitForFunction(() => document.querySelectorAll('#cList .pslide').length === 9);
  assert.deepEqual(await chips(), [1, 2, 1, 4, 4, 4, 4, 4, 4]);
  // 내보내면 고른 쪽이 같이 가고, 가져오면 새 대본에도 생긴다(자료는 그 기기에서 다시 올린다)
  const [dl] = await Promise.all([p.waitForEvent('download'), p.evaluate(() => document.getElementById('mExport').click())]);
  const file = fs.readFileSync(await dl.path(), 'utf8');
  assert.deepEqual(JSON.parse(file).paraSlide, { [h2]: 1 });
  // '자동'을 고르면 지운다
  await p.locator('#cList .pc').nth(2).click();
  await p.locator('#cList .pc.on .pslidesel select').selectOption('0');
  assert.equal(await p.textContent('#cList .pc.on .pslide'), '슬라이드 3');
  assert.deepEqual(await picked(), {}, '고른 것이 없으면 키도 없다');
  await p.setInputFiles('#scriptFile', { name: 'x.livescript.json', mimeType: 'application/json', buffer: Buffer.from(file) });
  await p.waitForFunction(() => Object.keys(localStorage).some(k => k.startsWith('ls.paraSlide.')));
  assert.deepEqual(Object.values(await picked()), [{ [h2]: 1 }]);
  assert.equal(await p.locator('#cList .pslide').count(), 0, '가져온 대본엔 자료가 없어 칩이 없다');
  p.once('dialog', d => d.accept());
  await p.evaluate(() => document.getElementById('eDel').click());
  assert.deepEqual(await picked(), {}, '대본을 지우면 고른 쪽도 지운다');
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
t('AI: 뒤에서 하던 일이 있으면 바로 시작하는 단추는 그 일을 멈추지 않고, 연습에 들어가도 발표 준비를 또 보내지 않는다', async () => {
  const p = await page(browser); await open(p); await sample(p);
  const sent = [], cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
  await p.route(AI, r => r.request().method() === 'OPTIONS' ? r.fulfill({ status: 204, headers: cors }) : void sent.push(JSON.parse(r.request().postData())));  // 답하지 않아서 계속 하는 중
  await p.evaluate(() => { const t = document.getElementById('text'); t.value += ' 끝.'; t.dispatchEvent(new Event('input')); });  // 지난 발표 준비가 대본과 안 맞게
  await p.click('#prepGo'); await p.waitForTimeout(300);
  assert.equal(sent.length, 1); assert.equal(await p.textContent('#aiGo'), '멈추기');
  await p.click('#aiClose');
  await p.click('[data-tab="practice"]'); await p.waitForTimeout(500);
  assert.equal(sent.length, 1, 'AI 창의 발표 준비가 끝나지 않았으니 또 보내지 않는다');
  await toScript(p);
  await p.locator('#cList .pc').nth(2).click();
  await p.click('#cList .pc.on .ptool >> text=더 짧게'); await p.waitForTimeout(300);
  assert.equal(sent.length, 1, '새로 보내지 않는다');
  assert.equal(await p.textContent('#aiGo'), '멈추기', '하던 발표 준비는 계속');
  assert.match(await p.textContent('#aiMsg'), /^AI가 앞의 일을 하는 중이에요/);
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

// ---- 읽는 화면 ----
t('읽는 화면: 연습은 문단 위에 지난 피드백, 실전은 피드백을 켰을 때만 보이고, 시작하면 남은 시간을 크게 보인다', async () => {
  const p = await page(browser); await p.clock.install(); await open(p); await sample(p);
  await p.uncheck('#shrinkOn'); await p.fill('#target', '3');
  await practiceRun(p, (i, x) => x, true, 300, 300000);  // 3분 목표를 5분에 읽어 모든 문단이 시간을 넘는다
  await p.click('#checkClose');
  assert.ok(await p.locator('#prompt .fb').count() >= 1, '연습은 문단 위에 지난 피드백');
  await p.click('[data-tab="live"]'); await p.waitForTimeout(400);
  assert.equal(await p.locator('#prompt .fb').count(), 0, '실전은 처음엔 대본만');
  assert.equal(await p.evaluate(() => document.body.classList.contains('keymark')), false);
  await p.click('#fbBtn');
  assert.equal(await p.getAttribute('#fbBtn', 'aria-pressed'), 'true');
  assert.ok(await p.locator('#prompt .fb').count() >= 1);
  assert.equal(await p.textContent('#prompt .fb'), '지난번 시간을 넘었어요', '실전은 시간을 넘은 문단만');
  await p.click('#fbBtn');
  assert.equal(await p.locator('#prompt .fb').count(), 0);
  // 남은 시간: 대본 끝이라 처음부터 할지 묻는다
  p.once('dialog', d => d.accept());
  await p.click('#mic'); await p.waitForTimeout(200);
  await p.evaluate(t => window.__fin(t), SENTS[0]); await p.clock.runFor(10000); await p.waitForTimeout(200);
  assert.match(await p.textContent('#stSec'), /^남은 2:[45]\d$/);
  assert.equal(await p.locator('#fbBtn').isHidden(), true, '듣는 동안에는 바꾸지 않는다');
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
  assert.match(await p.locator('#hGrid .pcard.on .mt').textContent(), /^예상 \d+:\d\d · 목표 3:00$/);
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
  for (let i = 0; i < 14 && await p.evaluate(() => document.activeElement?.id) !== 'fbBtn'; i++) await p.keyboard.press('Tab');
  assert.equal(await p.evaluate(() => document.activeElement?.id), 'fbBtn', 'Tab으로 가 단추에 닿는다');
  await p.keyboard.press('Space'); await p.waitForTimeout(300);
  assert.equal(await p.getAttribute('#fbBtn', 'aria-pressed'), 'true', '피드백이 켜진다');
  assert.equal(await p.textContent('#mic'), before, '마이크는 켜지 않는다');
  // 마우스로 누른 단추에 포커스가 남아도 스페이스는 마이크를 켠다
  await p.click('#fbBtn'); await p.waitForTimeout(200);
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

t('앱: 예전에 넣어 둔 사용자 AI 키는 열 때 지운다', async () => {
  const p = await page(browser); await open(p);
  await p.evaluate(() => { localStorage.setItem('ls.key', 'sk-ant-old'); sessionStorage.setItem('ls.key', 'sk-ant-old'); });
  await open(p);
  assert.deepEqual(await p.evaluate(() => [localStorage.getItem('ls.key'), sessionStorage.getItem('ls.key')]), [null, null]);
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
