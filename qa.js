// 질의응답 판정. 들은 질문이 준비된 질문 중 무엇인지 고른다.
// 순수 계산 부분은 node에서도 돈다(node qa.js). 모델 부분은 쓸 때만 vendor/에서 불러온다.

export const MODEL = 'Xenova/multilingual-e5-small';
export const REV = '761b726dd34fb83930e26aab4e9ac3899aa1fa78';
export const MODEL_FILE = `https://huggingface.co/${MODEL}/resolve/${REV}/onnx/model_quantized.onnx`;
export const DIM = 384;
const W = 0.1;  // e5 유사도 + 0.1 × 음절 비교 (준비 질문 20개 시험에서 1순위 21 → 25/30)

const norm = s => s.normalize('NFC').toLowerCase().replace(/[^0-9a-z가-힣]/g, '');

// 모든 질문에 흔히 붙는 군말과 질문 어미. 음절 비교를 흐리므로 빼고 비교한다.
const FILLER = /(^|\s)(혹시|음+|어+|아+|그+|저+|저기요?|좀|이제|뭐|막|약간|그냥|일단|그러니까|그런데|근데|있잖아요|궁금한\s*게\s*있는데요?|질문\s*감사합니다|좋은\s*질문(입니다|이네요|이에요)?|감사합니다)(?=\s|$)/g;
const ENDING = /(어떻게\s*)?(되나요|되는지요?|되는\s*건가요|됩니까|될까요|돼요)(?=\s|$)|궁금(합니다|해요|한데요|하네요)|알고\s*싶(습니다|어요|은데요)|말씀해\s*주(세요|시겠어요|실\s*수\s*있나요)/g;
const TAIL = /(인가요|일까요|는지요|나요|까요|가요|는지|습니까|니까|이에요|예요|에요|어요|아요|요|죠)$/;

export function strip(s) {
  s = ' ' + s.normalize('NFC').replace(/[?？.!,~…]/g, ' ') + ' ';
  s = s.replace(ENDING, ' ').replace(FILLER, ' ').replace(/\s+/g, ' ').trim();
  return s.replace(TAIL, '').trim();
}

// 음절 bigram 집합
export function grams(s) {
  s = norm(strip(s));
  const g = new Set();
  for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2));
  return g;
}

// 준비 문장의 bigram이 들은 말에 얼마나 들어 있나. 들은 말 앞뒤 군더더기에 강하다.
export function overlap(heard, sent) {
  let n = 0;
  for (const x of sent) if (heard.has(x)) n++;
  return sent.size ? n / sent.size : 0;
}

// 팩의 모든 문장(질문 원문 + 바꿔 묻는 말). 벡터도 이 순서로 저장한다.
export function prepare(pack) {
  const out = [];
  pack.questions.forEach((q, qi) => [q.q, ...q.alts].forEach(text => out.push({ qi, text, g: grams(text) })));
  return out;
}

// 점수 순으로 [{ q, score, e, b }]. qv(들은 말 벡터)와 V(팩 벡터)가 없으면 음절 비교만 쓴다.
export function rank(pack, sents, text, qv = null, V = null) {
  const n = pack.questions.length, hg = grams(text);
  const b = new Array(n).fill(0), e = new Array(n).fill(-1);
  sents.forEach((s, i) => {
    b[s.qi] = Math.max(b[s.qi], overlap(hg, s.g));
    if (qv) {
      let d = 0;
      for (let k = 0, o = i * DIM; k < DIM; k++) d += qv[k] * V[o + k];
      e[s.qi] = Math.max(e[s.qi], d);
    }
  });
  return pack.questions
    .map((q, i) => ({ q, score: qv ? e[i] + W * b[i] : b[i], e: qv ? e[i] : null, b: b[i] }))
    .sort((x, y) => y.score - x.score);
}

// 벡터에 영향을 주는 부분(질문과 바꿔 묻는 말)만으로 만든 해시. 답을 고쳐도 다시 계산하지 않는다.
export function packHash(pack) {
  const s = JSON.stringify(pack.questions.map(q => [q.q, q.alts]));
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16);
}

// localStorage에 JSON 숫자 배열로 넣으면 팩 하나가 160만 자가 되므로 base64로 저장
export function toB64(f32) {
  const u = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromB64(b64) {
  const s = atob(b64), u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return new Float32Array(u.buffer);
}

// ---- 질문 팩 검사 (AI 결과, 붙여넣은 JSON, 가져온 파일은 모두 믿지 않는다) ----
export const LIMIT = { questions: 60, alts: 12, answer: 6, text: 200, line: 300 };
const str = (v, max) => typeof v === 'string' ? v.normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, max) : '';
const lines = (v, max, n) => [...new Set((Array.isArray(v) ? v : typeof v === 'string' ? v.split('\n') : [])
  .map(x => str(x, max)).filter(Boolean))].slice(0, n);

export function cleanPack(obj) {
  const items = Array.isArray(obj) ? obj : Array.isArray(obj?.questions) ? obj.questions : null;
  if (!items) throw new Error('questions 목록이 없어요.');
  const seen = new Set(), out = [];
  for (const it of items) {
    if (out.length >= LIMIT.questions) break;
    if (!it || typeof it !== 'object') continue;
    const q = str(it.q, LIMIT.text);
    if (!q) continue;
    let id = str(it.id, 20), k = out.length + 1;
    while (!/^[\w-]+$/.test(id) || seen.has(id)) id = 'q' + String(k++).padStart(2, '0');
    seen.add(id);
    out.push({
      id, q,
      alts: lines(it.alts, LIMIT.text, LIMIT.alts).filter(a => a !== q),
      answer: lines(it.answer, LIMIT.line, LIMIT.answer),
      source: str(it.source, LIMIT.line),
      check: it.check === true,
    });
  }
  if (!out.length) throw new Error('쓸 수 있는 질문이 하나도 없어요.');
  return { version: 1, questions: out };
}

// ---- 모델 (브라우저 전용) ----
let modelP = null;

export function loadModel(onProgress) {
  modelP ??= (async () => {
    const { pipeline, env } = await import('./vendor/transformers.min.js');
    const wasm = env.backends.onnx.wasm;
    // transformers가 기기에 맞게 고른 ORT 파일(Safari 26 미만은 asyncify가 아닌 빌드)을 CDN 대신 vendor/에서 받는다.
    // 상대 경로를 주면 /vendor/vendor/를 요청하므로 절대 URL로 준다.
    const local = u => new URL('./vendor/' + u.split('/').pop(), import.meta.url).href;
    wasm.wasmPaths = { mjs: local(wasm.wasmPaths.mjs), wasm: local(wasm.wasmPaths.wasm) };
    wasm.numThreads = 1;
    // 켜 두면 .mjs를 blob: URL로 바꿔 불러오는데, CSP(script-src 'self')가 막는다
    env.useWasmCache = false;
    // 'main'을 묻는 요청도 고정한 revision으로 보낸다. 받아 둔 모델이 있으면 Hugging Face에 묻지 않고 바로 불러온다.
    env.remotePathTemplate = `{model}/resolve/${REV}/`;
    return pipeline('feature-extraction', MODEL, { device: 'wasm', dtype: 'q8', revision: REV, progress_callback: onProgress });
  })();
  modelP.catch(() => { modelP = null; });
  return modelP;
}

// 이 기기에 모델 파일이 받아져 있나 (없으면 자동으로 163MB를 받지 않는다)
export async function modelCached() {
  try { return !!(await (await caches.open('transformers-cache')).match(MODEL_FILE)); } catch { return false; }
}

// e5는 'query: '를 붙여야 한다. 질문끼리 비교하므로 양쪽 다 query.
export async function embed(pipe, texts) {
  const out = await pipe(texts.map(t => 'query: ' + t.normalize('NFC').trim()), { pooling: 'mean', normalize: true });
  return out.data;
}

// ponytail: 4문장씩 묶으면 q8 양자화 범위가 묶음마다 달라져 한 문장씩 계산한 벡터와 조금 다르다
// (시험 데이터에서 1순위 25 → 24/30, 상위 3개는 28/30 그대로, 속도 이득 약 10%). 실제 평가에서 차이가 보이면 1로.
const BATCH = 4;

// BATCH 문장씩 계산하고 사이사이 화면에 양보한다
export async function embedAll(pipe, texts, onProgress) {
  const V = new Float32Array(texts.length * DIM);
  for (let i = 0; i < texts.length; i += BATCH) {
    V.set(await embed(pipe, texts.slice(i, i + BATCH)), i * DIM);
    onProgress?.(Math.min(i + BATCH, texts.length), texts.length);
    await new Promise(r => setTimeout(r));
  }
  return V;
}

// node qa.js 로 실행하면 확인 (import.meta.main이 없는 node에서도)
if (import.meta.main ?? (typeof process === 'object' && process.argv[1]?.endsWith('qa.js'))) {
  const assert = (await import('node:assert')).default;

  assert.equal(strip('혹시 아이폰에서도 어떻게 되나요?'), '아이폰에서도', '군말과 질문 어미 빼기');
  assert.equal(strip('음 그 가격이 얼마예요'), '가격이 얼마', '앞 군말과 끝 어미');
  assert.equal(strip('좋은 질문 감사합니다. 요금제가 궁금합니다'), '요금제가', '인사말과 궁금합니다');
  assert.equal(strip('필요한 게 뭔가요'), '필요한 게 뭔', '끝 어절만 다듬기');
  assert.equal(strip('어떻게 되나요'), '', '어미만 있으면 빈 문자열');
  assert.deepEqual([...grams('가격이 어떻게 되나요')], ['가격', '격이']);

  const pack = cleanPack({ version: 1, questions: [
    { id: 'q01', q: '아이폰에서도 되나요?', alts: ['사파리에서 작동하나요', 'iOS에서도 돌아가요', '애플 폰으로도 쓸 수 있나요'], answer: ['네, iOS Safari에서 됩니다.'], source: '', check: false },
    { id: 'q02', q: '안드로이드에서도 되나요?', alts: ['갤럭시에서 작동하나요', '크롬 모바일에서 돼요'], answer: ['네, Android Chrome에서 됩니다.'], source: '', check: false },
    { id: 'q03', q: '요금은 얼마인가요?', alts: ['가격이 얼마예요', '유료인가요 무료인가요', '돈 내고 써야 해요'], answer: ['무료입니다.'], source: '', check: true },
  ] });
  const sents = prepare(pack);
  assert.equal(sents.length, 4 + 3 + 4);
  const top = text => rank(pack, sents, text)[0].q.id;
  assert.equal(top('혹시 아이폰 사파리에서도 작동하는지 궁금합니다'), 'q01', '음절 비교: 아이폰');
  assert.equal(top('갤럭시 쓰는데 작동하나요'), 'q02', '음절 비교: 안드로이드');
  assert.equal(top('좋은 질문 감사합니다 그러니까 가격이 얼마인지'), 'q03', '음절 비교: 앞에 인사말이 붙어도');

  // e5 + 0.1 × 음절 비교, 질문마다 원문과 바꿔 묻는 말 중 가장 가까운 것
  const V = new Float32Array(sents.length * DIM), qv = new Float32Array(DIM);
  qv[0] = 1;
  sents.forEach((s, i) => { V[i * DIM] = s.qi === 1 ? 0.9 : 0.8; });  // 벡터로는 q02가 가깝다
  V[0] = 0.85;  // q01 원문만 조금 더 가깝게
  const r = rank(pack, sents, '아이폰에서도 되나요', qv, V);
  assert.equal(r[0].q.id, 'q01', '음절 비교 0.1이 0.05 차이를 뒤집는다');
  assert.ok(Math.abs(r[0].score - (0.85 + 0.1 * 1)) < 1e-6, '점수 = e5 + 0.1 × bigram');
  assert.ok(Math.abs(r[1].score - (0.9 + 0.1 * r[1].b)) < 1e-6);
  assert.equal(rank(pack, sents, '점심 메뉴', qv, V).length, 3, '후보는 모든 질문');

  const h = packHash(pack);
  assert.equal(packHash(cleanPack(JSON.parse(JSON.stringify(pack)))), h, '같은 팩이면 같은 해시');
  assert.equal(packHash({ questions: pack.questions.map(q => ({ ...q, answer: ['다른 답'] })) }), h, '답만 바꾸면 그대로');
  assert.notEqual(packHash({ questions: pack.questions.map((q, i) => i ? q : { ...q, alts: [...q.alts, '새 말'] }) }), h, '바꿔 묻는 말이 바뀌면 다른 해시');

  const f = Float32Array.from({ length: 1000 }, (_, i) => Math.sin(i) / 3);
  assert.deepEqual(fromB64(toB64(f)), f, 'base64 왕복');
  assert.deepEqual(fromB64(toB64(f.subarray(10, 20))), f.subarray(10, 20), 'base64 부분 배열');

  // 팩 검사
  const c = cleanPack({ questions: [
    { id: 'q01', q: '  첫 질문  ', alts: ['가', '가', '', 3, '첫 질문'], answer: '줄1\n\n줄2', check: 'true' },
    { id: 'q01', q: '두 번째', alts: 'x' },
    { id: '<img>', q: '세 번째' },
    { q: '' }, null, 'abc', { q: 42 },
    { id: 'q05', q: 'x'.repeat(500), alts: Array.from({ length: 30 }, (_, i) => 'alt' + i), answer: Array(10).fill(0).map((_, i) => '답' + i) },
  ] });
  assert.equal(c.version, 1);
  assert.deepEqual(c.questions.map(q => q.id), ['q01', 'q02', 'q03', 'q05'], 'id 중복과 이상한 id 고치기');
  assert.deepEqual(c.questions[0], { id: 'q01', q: '첫 질문', alts: ['가'], answer: ['줄1', '줄2'], source: '', check: false }, '다듬기, 중복 제거, 문자열 아닌 값 버리기');
  assert.deepEqual(c.questions[1].alts, ['x']);
  assert.equal(c.questions[3].q.length, LIMIT.text);
  assert.equal(c.questions[3].alts.length, LIMIT.alts);
  assert.equal(c.questions[3].answer.length, LIMIT.answer);
  assert.equal(cleanPack(Array(100).fill({ q: '질문' })).questions.length, LIMIT.questions, '질문 수 상한');
  assert.throws(() => cleanPack({}), /questions/);
  assert.throws(() => cleanPack({ questions: [{ q: ' ' }] }), /하나도/);
  assert.throws(() => cleanPack(null), /questions/);

  // 속도: 질문 40개 × 문장 8개
  const big = cleanPack(Array.from({ length: 40 }, (_, i) => ({ q: pack.questions[i % 3].q + i, alts: [...pack.questions[i % 3].alts, '하나', '둘', '셋', '넷'] })));
  const bs = prepare(big), t0 = performance.now();
  for (let i = 0; i < 1000; i++) rank(big, bs, '혹시 아이폰 사파리에서도 작동하는지 궁금합니다');
  console.log(`qa.js ok (음절 비교 1회 ${((performance.now() - t0) / 1000).toFixed(3)}ms, 문장 ${bs.length}개)`);
}
