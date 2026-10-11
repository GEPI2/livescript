// JEV 모드(실험, 기본 꺼짐): 판정 모델 Kev-0.6B(Apache-2.0)가 e5의 후보 5개와 '해당 없음' 가운데 하나를 고른다.
// WebGPU가 되는 기기에서만 쓴다(WASM이면 판정 1회 약 4.7초라서 못 쓴다). node jev.js 로 순수 계산을 확인한다.
// 입력 형식은 open-jev(Apache-2.0)의 Kev 소스(encoding.ts, models.ts)를 읽고 다시 썼다. 패키지는 쓰지 않는다.
//   <state> 들은 질문 <question> 지시 <opt> 선택지 </opt> ... <decide>
//   선택지 점수는 각 </opt> 자리의 logit이고, 한 질문 안에서 softmax 한다. 구분 기호 번호는 모델 config.json의 kev.delimiter_ids.
// 모델은 워커(jev-worker.js)에서 돈다. e5와 ONNX Runtime을 같이 쓰면 WebGPU 쪽 오류 한 번에 e5 판정까지 멈췄다(브라우저에서 재현).

export const MODEL = 'onnx-community/kev-0.6b-ONNX';
export const REV = '5a827091b3d58fe4fdfc02a5a5b2ce364047d678';
export const FILE = `https://huggingface.co/${MODEL}/resolve/${REV}/onnx/model_q4f16.onnx_data`;
export const SIZE = '약 340MB';  // model_q4f16 335MB + 3MB, tokenizer 7MB
export const NONE = '해당 없음';
// 우리 시험(준비 질문 20개, 시험 40개, e5 후보 5개 + 해당 없음, 한국어 지시)에서 1순위 23/30, 상위 3개 26/30, 상관없는 질문 거름 8/10
export const INSTR = "청중이 방금 한 질문과 같은 것을 묻는 준비된 질문을 고르세요. 맞는 것이 없으면 '해당 없음'을 고르세요.";
// '해당 없음' 확률이 이 이상이면 '해당 없음'을 맨 앞에 둔다. 앱 안에서 같은 시험 질문을 넣어 보니(e5 + 음절 비교 상위 5개)
// 0.9 이상은 준비된 질문 3/30(그중 2개는 e5 1등이 맞았다), 상관없는 질문 3/10이었고, 0.95 이상은 준비된 질문 0/30, 상관없는 질문 2/10이었다.
// 맞는 답을 뒤로 미는 쪽이 더 나빠서 0.95로 둔다. ponytail: 실제 질문 기록(qa: 'judge'의 jev.none)으로 다시 맞춘다.
export const NONE_P = 0.95;
export const TIMEOUT = 2000;  // 이보다 늦으면 이번 판정은 e5로

// 들은 말이나 준비 질문에 구분 기호 모양(<|name|>)이 있어도 구분 기호가 되지 않게 (open-jev와 같은 처리)
export const escape = t => String(t).replace(/<\|([A-Za-z0-9_]+)\|>/g, '<¦$1¦>');

// D: 구분 기호 번호, enc: 글 → 토큰 번호 목록. 반환 { ids, ends: 선택지마다 </opt> 자리 }
export function sequence(D, enc, state, opts) {
  const ids = [D.state, ...enc(state), D.question, ...enc(INSTR)], ends = [];
  for (const o of [...opts, NONE]) { ids.push(D.option_start, ...enc(o), D.option_end); ends.push(ids.length - 1); }
  ids.push(D.decide);
  return { ids, ends };
}

export function softmax(z) {
  const m = Math.max(...z), e = z.map(x => Math.exp(x - m)), s = e.reduce((a, b) => a + b, 0);
  return e.map(x => x / s);
}

// top: e5 순위 앞 5개 [{ q, ... }], probs: 그 순서의 확률 + 마지막에 '해당 없음'
// 반환 { top: JEV 확률 순 [{ ...r, p }], chips: 보여 줄 후보 3개, none: '해당 없음' 확률, noneFirst }
// 칩은 JEV 순서로 보이되 e5 1등이 빠지면 셋째 자리에 둔다. Kev가 맞는 질문을 '해당 없음'으로 보내는 일이 잦아서다
// (같은 시험에서 상위 3개 안에 정답: JEV 순서만 25/30, e5 1등을 남기면 27/30, e5만 27/30).
export function rerank(top, probs) {
  const none = probs[top.length], all = top.map((r, i) => ({ ...r, p: probs[i] })).sort((a, b) => b.p - a.p);
  const chips = all.slice(0, 3);
  if (top.length && !chips.some(r => r.q === top[0].q)) chips[Math.min(2, chips.length - 1)] = all.find(r => r.q === top[0].q);
  return { top: all, chips, none, noneFirst: none >= NONE_P };
}

// WebGPU 어댑터가 있고 f16 셰이더가 되는지. 없으면 모델 파일을 받지도 불러오지도 않는다.
export async function gpuOk() {
  try {
    const a = await globalThis.navigator?.gpu?.requestAdapter();
    return !!a && a.features.has('shader-f16');
  } catch { return false; }
}

// 이 기기에 모델 파일이 받아져 있나
export async function jevCached() {
  try { return await caches.has('transformers-cache') && !!(await (await caches.open('transformers-cache')).match(FILE)); } catch { return false; }
}

// ---- 모델 (브라우저 전용, 워커와 주고받기) ----
// 반환: judge(들은 질문, 준비 질문 글 목록) → 선택지마다 확률(마지막이 '해당 없음')
let jobP = null, worker = null, stopLoad = null;  // stopLoad: 준비를 기다리는 중이면 그 기다림을 끝낸다(closeJev)
export function loadJev(onProgress) {
  jobP ??= (async () => {
    if (!await gpuOk()) throw new Error('nogpu');
    const w = worker = new Worker(new URL('./jev-worker.js?v=3', import.meta.url), { type: 'module' }), calls = new Map();
    let n = 0;
    await new Promise((ok, no) => {
      stopLoad = no;
      w.onmessage = ({ data: d }) => d.progress ? onProgress?.(d.progress) : d.ready ? ok() : no(new Error(d.error));
      w.onerror = e => no(new Error(e.message || 'JEV 워커를 시작하지 못했어요'));
      w.postMessage({ load: true });
    });
    stopLoad = null;
    const fail = e => { for (const c of calls.values()) c.no(e); calls.clear(); };
    w.onmessage = ({ data: d }) => { const c = calls.get(d.id); calls.delete(d.id); d.error ? c?.no(new Error(d.error)) : c?.ok(d.probs); };
    w.onerror = e => fail(new Error(e.message || 'JEV 워커 오류'));
    return (state, opts) => new Promise((ok, no) => { calls.set(++n, { ok, no }); w.postMessage({ id: n, state, opts }); });
  })();
  jobP.catch(closeJev);
  return jobP;
}
// 오류가 나거나 JEV 모드를 끄면 워커를 닫는다(받는 중이면 받기도 멈춘다). 다시 불러오면 새 워커로 시작한다.
export function closeJev() { stopLoad?.(new Error('off')); stopLoad = null; worker?.terminate(); worker = null; jobP = null; }

// node jev.js 로 실행하면 확인
if (import.meta.main ?? (typeof process === 'object' && process.argv[1]?.endsWith('jev.js'))) {
  const assert = (await import('node:assert')).default;
  assert.equal(escape('a <|fim_prefix|> b <|x|'), 'a <¦fim_prefix¦> b <|x|', '들은 말이 구분 기호가 되지 않게');
  const D = { state: 1, question: 2, option_start: 3, option_end: 4, decide: 5 };
  const enc = t => [...t].map(c => c.charCodeAt(0));
  const { ids, ends } = sequence(D, enc, '가', ['나', '다라']);
  const I = enc(INSTR);
  assert.deepEqual(ids, [1, ...enc('가'), 2, ...I, 3, ...enc('나'), 4, 3, ...enc('다라'), 4, 3, ...enc(NONE), 4, 5]);
  assert.deepEqual(ends.map(i => ids[i]), [4, 4, 4], '점수는 </opt> 자리');
  assert.equal(ends.length, 3, "선택지 + '해당 없음'");
  const p = softmax([1, 2, 3]);
  assert.ok(Math.abs(p.reduce((a, b) => a + b) - 1) < 1e-9 && p[2] > p[1] && p[1] > p[0]);
  assert.deepEqual(softmax([1000, 1000]), [0.5, 0.5], '큰 값도 넘치지 않게');
  const top = ['q1', 'q2', 'q3', 'q4', 'q5'].map(id => ({ q: { id } })), idOf = a => a.map(x => x.q.id);
  const r = rerank(top, [0.1, 0.5, 0.2, 0.15, 0.04, 0.01]);
  assert.deepEqual(idOf(r.top), ['q2', 'q3', 'q4', 'q1', 'q5']);
  assert.deepEqual(idOf(r.chips), ['q2', 'q3', 'q1'], 'e5 1등(q1)이 JEV 상위 3개에서 빠지면 셋째 자리에');
  assert.deepEqual(idOf(rerank(top, [0.2, 0.5, 0.1, 0.1, 0.05, 0.05]).chips), ['q2', 'q1', 'q3'], '들어 있으면 JEV 순서 그대로');
  assert.equal(r.noneFirst, false);
  assert.equal(rerank(top, [0.01, 0.01, 0.01, 0.01, 0.01, 0.95]).noneFirst, true, "'해당 없음' 확률이 높으면 맨 앞");
  assert.equal(rerank(top, [0.02, 0.02, 0.02, 0.02, 0.02, 0.9]).noneFirst, false, '0.9로는 앞세우지 않는다');
  assert.deepEqual(idOf(rerank(top.slice(0, 2), [0.1, 0.8, 0.1]).chips), ['q2', 'q1'], '후보가 적어도');
  // WebGPU가 없으면 받지 않는다
  assert.equal(await gpuOk(), false, 'node에는 WebGPU가 없다');
  await assert.rejects(loadJev(), /nogpu/);
  const gpu = a => Object.defineProperty(globalThis, 'navigator', { value: { gpu: { requestAdapter: async () => a } }, configurable: true });
  gpu({ features: new Set() });
  assert.equal(await gpuOk(), false, 'f16 셰이더가 없으면 안 씀');
  gpu(null);
  assert.equal(await gpuOk(), false, '어댑터가 없으면 안 씀');
  gpu({ features: new Set(['shader-f16']) });
  assert.equal(await gpuOk(), true);
  console.log('jev.js ok');
}
