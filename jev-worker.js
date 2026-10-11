// JEV 모델(Kev-0.6B)을 도는 워커. e5와 ONNX Runtime을 나눠 쓰지 않아서 여기서 GPU 오류가 나도 e5 판정은 그대로 된다.
// 받는 메시지: { load: true } → { progress } 여러 번, 그다음 { ready: true } 또는 { error }
//              { id, state, opts } → { id, probs } 또는 { id, error }
import { setup } from './qa.js?v=4';
import { MODEL, REV, sequence, softmax, escape } from './jev.js?v=4';

let judge = null, queue = Promise.resolve();

async function load() {
  const { AutoConfig, AutoTokenizer, PreTrainedModel, Tensor, env } = await import('./vendor/transformers.min.js');
  setup(env, REV);
  const o = { revision: REV, progress_callback: p => postMessage({ progress: p }) };
  const config = await AutoConfig.from_pretrained(MODEL, o);
  const tok = await AutoTokenizer.from_pretrained(MODEL, o);
  // transformers는 qwen3를 글 생성용(KV 캐시 그래프)으로 다루므로, 입력을 이름 그대로 넘기는 기본 클래스로 불러온다
  const model = await PreTrainedModel.from_pretrained(MODEL, { ...o, config, dtype: 'q4f16', device: 'webgpu' });
  const D = config.kev.delimiter_ids;
  const enc = t => Array.from(tok(escape(t), { add_special_tokens: false }).input_ids.data, Number);
  const int64 = a => new Tensor('int64', BigInt64Array.from(a, BigInt), [1, a.length]);
  judge = async (state, opts) => {
    const { ids, ends } = sequence(D, enc, state, opts);
    const { logits } = await model({ input_ids: int64(ids), attention_mask: int64(ids.map(() => 1)) });
    // q4f16 모델의 logits는 float16이다. Float16Array가 없는 브라우저에서는 Uint16Array(비트 그대로)로 오므로 float32로 바꿔 읽는다.
    const z = logits.to('float32').data;
    return softmax(ends.map(i => z[i]));
  };
  await judge('준비', ['준비가 되었나요?']);  // 첫 판정이 늦지 않게 한 번 돌려 둔다 (셰이더 준비)
}

// 한 세션을 동시에 두 번 돌리지 않게 차례로 처리한다
onmessage = ({ data: d }) => {
  queue = queue.then(async () => {
    if (d.load) {
      try { await load(); postMessage({ ready: true }); } catch (e) { postMessage({ error: String(e?.message || e) }); }
      return;
    }
    try { postMessage({ id: d.id, probs: await judge(d.state, d.opts) }); } catch (e) { postMessage({ id: d.id, error: String(e?.message || e) }); }
  });
};
