// Claude 호출. 키가 있으면 브라우저가 Anthropic API를 바로 부르고, 없으면 프롬프트를 복사해 챗봇에 붙여넣는다.
import { cleanPack } from './qa.js';

const API = 'https://api.anthropic.com/v1/messages';
export const MODEL = 'claude-opus-5-5', EFFORT = 'medium';

// ---- 키: 기본은 이 탭에만(sessionStorage), '이 기기에 기억'일 때만 localStorage ----
const K = 'ls.key';
const tryDo = f => { try { return f(); } catch { return null; } };
export const keyStore = {
  get: () => tryDo(() => sessionStorage.getItem(K) || localStorage.getItem(K)) || '',
  remembered: () => !!tryDo(() => localStorage.getItem(K)),
  set(key, remember) {
    this.clear();
    tryDo(() => (remember ? localStorage : sessionStorage).setItem(K, key));
  },
  clear() { tryDo(() => sessionStorage.removeItem(K)); tryDo(() => localStorage.removeItem(K)); },
};
// 헤더에 넣을 수 있는 글자만 (한글이나 보이지 않는 글자가 섞이면 fetch가 네트워크 오류처럼 실패한다)
export const keyOk = k => /^[\x21-\x7e]+$/.test(k);
const BAD_KEY = '키에 쓸 수 없는 글자가 있어요. AI 키 설정에서 키를 다시 복사해 넣어 주세요.';

// ---- 예상 질문 프롬프트 (API와 붙여넣기가 같은 글을 쓴다) ----
export const PACK_SCHEMA = {
  type: 'object',
  properties: {
    version: { type: 'integer' },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          q: { type: 'string' },
          alts: { type: 'array', items: { type: 'string' } },
          answer: { type: 'array', items: { type: 'string' } },
          source: { type: 'string' },
          check: { type: 'boolean' },
        },
        required: ['id', 'q', 'alts', 'answer', 'source', 'check'],
        additionalProperties: false,
      },
    },
  },
  required: ['version', 'questions'],
  additionalProperties: false,
};

export function qaPrompt({ topic, audience, n, script }) {
  const system = `너는 발표 준비를 돕는다. 발표가 끝난 뒤 질의응답에서 청중이 물을 만한 예상 질문과 답을 만든다.
발표자는 질문을 듣고 따라 말하며, 앱이 그 말을 준비된 질문과 비교해 답 카드를 띄운다.

규칙
- 질문을 ${n}개 만든다. 청중이 실제로 물을 법한 것부터 쓴다.
- q: 질문 원문 한 문장.
- alts: 같은 질문을 청중이 소리 내어 다르게 묻는 말 6~8개. 짧은 구어체로 쓰고 낱말과 어순을 다양하게 바꾼다.
- 비슷하지만 다른 질문이 있으면(예: "아이폰에서 되나요"와 "안드로이드에서 되나요"), 한 질문의 alts에 다른 질문을 구별하는 낱말(아이폰, 안드로이드)을 넣지 않는다.
- answer: 발표자가 바로 소리 내어 읽을 짧은 답. 최대 3줄, 한 줄에 한 문장.
- 답은 아래 자료(발표 정보와 대본)에 있는 내용으로만 쓴다. 숫자나 사실을 지어내지 않는다.
- 자료만으로 답할 수 없으면 답에 확인할 점을 적고 check를 true로 한다. 자료에 근거가 있으면 false.
- source: 답의 근거가 된 대본 문장을 그대로 옮긴다. 없으면 빈 문자열.
- id: q01, q02처럼 차례로 붙인다.

답은 아래 형식의 JSON 하나로만 한다. 앞뒤 설명이나 코드 블록 표시는 붙이지 않는다.
{"version":1,"questions":[{"id":"q01","q":"...","alts":["...","..."],"answer":["..."],"source":"...","check":false}]}`;
  const user = `<발표정보>
주제: ${topic || '(적지 않음)'}
청중: ${audience || '(적지 않음)'}
</발표정보>
<대본>
${script}
</대본>

위 자료로 예상 질문 ${n}개를 만들어 주세요.`;
  return { system, user, text: system + '\n\n' + user };
}

// 챗봇 답에 설명이나 ``` 표시가 붙어도 JSON 부분만 골라 검사한다. 코드 블록이 있으면 그 안부터 본다.
export function parsePack(text) {
  let err = null;
  for (const s of [String(text).match(/```(?:json)?\s*([\s\S]*?)```/)?.[1], String(text)]) {
    if (s == null) continue;
    const spans = [['{', '}'], ['[', ']']].map(([o, c]) => [s.indexOf(o), s.lastIndexOf(c)])
      .filter(([a, b]) => a >= 0 && b > a).sort((x, y) => x[0] - y[0]);
    for (const [a, b] of spans) {
      try { return cleanPack(JSON.parse(s.slice(a, b + 1))); } catch (e) { if (!(e instanceof SyntaxError)) err ??= e; }
    }
  }
  throw err ?? new Error('JSON을 읽지 못했어요. 질문 팩 JSON이 처음부터 끝까지 다 들어갔는지 확인해 주세요.');
}

export async function generatePack(info, opts) {
  const p = qaPrompt(info);
  return parsePack(await callClaude({ ...opts, system: p.system, user: p.user, schema: PACK_SCHEMA }));
}

// ---- API 호출 (스트리밍: 질문이 많아도 시간 초과 없이 받고, 받은 만큼 진행을 보여 준다) ----
function errorText(status, err = {}) {
  const t = err.type || '';
  if (status === 401 || t === 'authentication_error') return 'API 키가 맞지 않아요(401). AI 키 설정에서 키를 다시 넣어 주세요.';
  // 지출 한도(429나 400)와 크레딧 부족(400)은 기다려도 풀리지 않는다
  if (/usage limit|credit balance/i.test(err.message || '')) return `지출 한도에 걸렸거나 크레딧이 부족해요(${status || t}). Claude Console에서 결제와 한도 설정을 확인해 주세요.`;
  if (status === 403 || t === 'permission_error') return '이 키로는 쓸 수 없어요(403). 키의 권한을 확인해 주세요.';
  if (status === 402 || t === 'billing_error') return '크레딧이나 월 지출 한도를 확인해 주세요(402).';
  if (status === 404 || t === 'not_found_error') return `이 키로는 ${MODEL} 모델을 쓸 수 없어요(404). 키의 워크스페이스 설정을 확인해 주세요.`;
  if (status === 429 || t === 'rate_limit_error') return '요청이 너무 많아요(429). 1분쯤 뒤에 다시 해 주세요.';
  if (status === 413 || t === 'request_too_large') return '대본이 너무 길어요(413).';
  if (status >= 500 || t === 'overloaded_error' || t === 'api_error') return `Anthropic 서버가 바빠요(${status || t}). 잠시 뒤 다시 해 주세요.`;
  return `요청 오류(${status || t}): ${err.message || '알 수 없는 오류'}`;
}

// 반환: 모델이 쓴 글(text 블록만). 앞에 thinking 블록이 와도 건너뛴다.
export async function callClaude({ key, system, user, schema, signal, onProgress, fallback = true }) {
  if (!keyOk(key)) throw new Error(BAD_KEY);
  const body = {
    model: MODEL,
    max_tokens: 64000,
    stream: true,
    system,
    messages: [{ role: 'user', content: user }],
    output_config: { effort: EFFORT, ...(schema && { format: { type: 'json_schema', schema } }) },
  };
  const headers = {
    'content-type': 'application/json',
    'x-api-key': key,
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
  };
  // 안전 분류기가 잘못 거절하면 서버가 다른 모델로 다시 돌린다
  if (fallback) { body.fallbacks = 'default'; headers['anthropic-beta'] = 'server-side-fallback-2026-07-01'; }

  let res;
  try { res = await globalThis.fetch(API, { method: 'POST', headers, body: JSON.stringify(body), signal }); }
  catch (e) { if (e.name === 'AbortError') throw e; throw new Error('Anthropic에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.'); }
  if (!res.ok) {
    let err = {};
    try { err = (await res.json()).error || {}; } catch {}
    // 조직에서 대체 모델 베타를 못 쓰면 그것만 빼고 한 번 더
    if (fallback && res.status === 400 && /anthropic-beta|fallbacks/.test(err.message || ''))
      return callClaude({ key, system, user, schema, signal, onProgress, fallback: false });
    throw new Error(errorText(res.status, err));
  }

  let buf = '', text = '', stop = null, done = false, streamErr = null;
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  try {
    for (;;) {
      const { value, done: end } = await reader.read();
      signal?.throwIfAborted();
      if (end) break;
      buf += value.replace(/\r/g, '');
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const data = buf.slice(0, i).split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('');
        buf = buf.slice(i + 2);
        if (!data) continue;
        const ev = JSON.parse(data);
        if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
          text += ev.delta.text;
          onProgress?.({ chars: text.length, questions: (text.match(/"q"\s*:/g) || []).length });
        } else if (ev.type === 'content_block_start' && ev.content_block?.type === 'thinking') onProgress?.({ chars: 0, questions: 0 });
        else if (ev.type === 'message_delta') stop = ev.delta?.stop_reason ?? stop;
        else if (ev.type === 'message_stop') done = true;
        else if (ev.type === 'error') streamErr = ev.error || {};
      }
    }
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new Error('답을 받다가 연결이 끊겼어요. 다시 해 주세요.');
  }
  if (streamErr) throw new Error(errorText(0, streamErr));
  if (stop === 'refusal') throw new Error('AI가 이 요청을 거절했어요. 대본 내용을 확인하거나 붙여넣기 방식으로 해 보세요.');
  if (stop === 'max_tokens') throw new Error('답이 너무 길어서 잘렸어요. 질문 수를 줄여서 다시 해 주세요.');
  if (!done) throw new Error('답을 받다가 연결이 끊겼어요. 다시 해 주세요.');
  return text;
}

// node claude.js 로 실행하면 확인 (실제 키 없이 fetch를 흉내 낸다)
if (import.meta.main ?? (typeof process === 'object' && process.argv[1]?.endsWith('claude.js'))) {
  const assert = (await import('node:assert')).default;
  const mem = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
  globalThis.sessionStorage = mem(); globalThis.localStorage = mem();

  keyStore.set('k1', false);
  assert.equal(keyStore.get(), 'k1'); assert.equal(localStorage.getItem(K), null, '기본은 탭에만');
  keyStore.set('k2', true);
  assert.equal(keyStore.get(), 'k2'); assert.equal(sessionStorage.getItem(K), null); assert.ok(keyStore.remembered());
  keyStore.clear(); assert.equal(keyStore.get(), '');

  const p = qaPrompt({ topic: '라이브스크립트', audience: '대학생', n: 7, script: '안녕하세요.' });
  assert.ok(p.system.includes('7개') && p.system.includes('6~8개') && p.system.includes('check를 true') && p.system.includes('"version":1'));
  assert.ok(p.user.includes('<대본>\n안녕하세요.\n</대본>') && p.text.startsWith(p.system));
  assert.ok(!JSON.stringify(PACK_SCHEMA).match(/maxItems|minItems|minLength|maxLength/), '구조화 출력이 받지 않는 제약은 넣지 않는다');

  const good = { version: 1, questions: [{ id: 'q01', q: '아이폰에서도 되나요?', alts: ['사파리에서 돼요'], answer: ['네.'], source: '', check: false }] };
  assert.equal(parsePack('네, 여기 있습니다.\n```json\n' + JSON.stringify(good) + '\n```').questions[0].q, '아이폰에서도 되나요?', '코드 블록이 붙어도');
  assert.equal(parsePack(JSON.stringify(good.questions)).questions.length, 1, '배열만 붙여넣어도');
  assert.throws(() => parsePack('{"questions": [ {"q": "잘린'), /JSON/);
  assert.throws(() => parsePack('{"foo": 1}'), /questions/);
  assert.equal(parsePack('```json\n' + JSON.stringify(good) + '\n```\n참고: {끝} [1]').questions.length, 1, '코드 블록 뒤 설명에 }와 ]가 있어도');

  // SSE 응답을 7바이트씩 잘라서 보낸다 (한글이 중간에 잘려도 되는지)
  const sse = events => events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
  const stream = s => { const b = new TextEncoder().encode(s); let i = 0; return new ReadableStream({ pull(c) { if (i >= b.length) return c.close(); c.enqueue(b.slice(i, i += 7)); } }); };
  const reply = (text, stop = 'end_turn', end = true) => sse([
    { type: 'message_start', message: { id: 'm', content: [] } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'x' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'ping' },
    { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
    ...(text.match(/.{1,5}/gs) || []).map(t => ({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: t } })),
    { type: 'content_block_stop', index: 1 },
    { type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: 9 } },
    ...(end ? [{ type: 'message_stop' }] : []),
  ]);
  const calls = [];
  const mock = (...answers) => { calls.length = 0; globalThis.fetch = async (url, init) => { calls.push({ url, init }); const a = answers.shift(); if (a instanceof Error) throw a; return a(); }; };
  const ok = (text, stop, end) => () => new Response(stream(reply(text, stop, end)), { status: 200 });
  const fail = (status, type, message) => () => new Response(JSON.stringify({ type: 'error', error: { type, message } }), { status });
  const info = { topic: '', audience: '', n: 1, script: '대본' };

  mock(ok(JSON.stringify(good)));
  const seen = [];
  const pack = await generatePack(info, { key: 'test-key', onProgress: x => seen.push(x) });
  assert.equal(pack.questions[0].alts[0], '사파리에서 돼요');
  assert.equal(seen.at(-1).questions, 1, '진행 표시');
  const { url, init } = calls[0], body = JSON.parse(init.body);
  assert.equal(url, 'https://api.anthropic.com/v1/messages');
  assert.equal(init.headers['x-api-key'], 'test-key');
  assert.equal(init.headers['anthropic-version'], '2023-06-01');
  assert.equal(init.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(init.headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
  assert.equal(body.model, 'claude-opus-5-5'); assert.equal(body.stream, true); assert.equal(body.fallbacks, 'default');
  assert.equal(body.output_config.effort, 'medium');
  assert.deepEqual(body.output_config.format, { type: 'json_schema', schema: PACK_SCHEMA });
  assert.equal(body.thinking, undefined, 'Opus 5.5는 thinking을 끌 수 없으니 보내지 않는다');

  const err = async (re, ...answers) => { mock(...answers); await assert.rejects(generatePack(info, { key: 'k' }), re); };
  await err(/키가 맞지 않아요\(401\)/, fail(401, 'authentication_error', 'invalid x-api-key'));
  await err(/너무 많아요\(429\)/, fail(429, 'rate_limit_error', 'slow down'));
  await err(/지출 한도/, fail(429, 'rate_limit_error', 'You have reached your API usage limits: please try again later.'));
  await err(/크레딧이 부족/, fail(400, 'invalid_request_error', 'Your credit balance is too low to access the Anthropic API.'));
  await err(/쓸 수 없어요\(404\)/, fail(404, 'not_found_error', 'model: claude-opus-5-5'));
  for (const bad of ['sk-ant-abc\u200b', 'sk-ant-테스트', '']) {
    mock(ok(JSON.stringify(good)));
    await assert.rejects(generatePack(info, { key: bad }), /쓸 수 없는 글자/);
    assert.equal(calls.length, 0, '이상한 키는 보내지 않는다');
  }
  await err(/바빠요\(529\)/, fail(529, 'overloaded_error', 'Overloaded'));
  await err(/인터넷 연결/, new TypeError('Failed to fetch'));
  await err(/거절했어요/, ok('', 'refusal'));
  await err(/잘렸어요/, ok('{"version":1,"questions":[{"id":"q01","q":"잘', 'max_tokens'));
  await err(/연결이 끊겼어요/, ok(JSON.stringify(good), 'end_turn', false));
  await err(/바빠요\(overloaded_error\)/, () => new Response(stream(sse([{ type: 'message_start', message: {} }, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }]))));

  // 대체 모델 베타를 못 쓰는 조직이면 빼고 다시
  mock(fail(400, 'invalid_request_error', 'Unexpected value(s) `server-side-fallback-2026-07-01` for the `anthropic-beta` header.'), ok(JSON.stringify(good)));
  assert.equal((await generatePack(info, { key: 'k' })).questions.length, 1);
  assert.equal(calls.length, 2); assert.equal(calls[1].init.headers['anthropic-beta'], undefined); assert.equal(JSON.parse(calls[1].init.body).fallbacks, undefined);

  const ctl = new AbortController(); ctl.abort();
  globalThis.fetch = async (u, init) => { init.signal.throwIfAborted(); };
  await assert.rejects(generatePack(info, { key: 'k', signal: ctl.signal }), { name: 'AbortError' });

  console.log('claude.js ok');
}
