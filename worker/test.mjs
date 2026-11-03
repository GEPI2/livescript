// node worker/test.mjs 로 실행하면 확인 (Anthropic은 fetch를 흉내 낸다)
import assert from 'node:assert';
import fs from 'node:fs';
import worker from './index.js';

const KEY = 'sk-ant-service', O = 'https://gepi2.github.io';
let up = [], answer = () => new Response('event: message_stop\ndata: {"type":"message_stop"}\n\n', { headers: { 'content-type': 'text/event-stream', 'content-encoding': 'gzip' } });
globalThis.fetch = async (url, init) => { up.push({ url, init }); return answer(); };
let allow = true;
const env = { ANTHROPIC_API_KEY: KEY, RL: { limit: async ({ key }) => (assert.equal(key, '1.2.3.4'), { success: allow }) } };
const good = { model: 'claude-opus-5-5', max_tokens: 64000, stream: true, system: '시스템', messages: [{ role: 'user', content: '대본' }], output_config: { effort: 'medium' }, fallbacks: 'default' };
const call = (body, { origin = O, method = 'POST', path = '/v1/messages' } = {}) => {
  up = [];
  const headers = { 'content-type': 'application/json', 'cf-connecting-ip': '1.2.3.4', ...(origin && { origin }) };
  return worker.fetch(new Request('https://livescript-ai.x.workers.dev' + path, { method, headers, ...(method === 'POST' && { body: typeof body === 'string' ? body : JSON.stringify(body) }) }), env);
};
const err = async (res, status, type) => { assert.equal(res.status, status); assert.equal((await res.json()).error.type, type); assert.equal(up.length, 0, '이상한 요청은 Anthropic에 보내지 않는다'); };

// 다른 사이트(또는 출처 없음)는 막는다. 막힌 사이트의 브라우저도 403을 읽을 수 있다('인터넷 연결'로 잘못 보이지 않게)
const evil = await call(good, { origin: 'https://evil.example' });
assert.equal(evil.headers.get('access-control-allow-origin'), 'https://evil.example'); await err(evil, 403, 'permission_error');
assert.equal((await call(null, { method: 'OPTIONS', origin: 'https://evil.example' })).status, 204, '미리 묻기는 받고 보내기에서 막는다');
const none = await call(good, { origin: null });
assert.equal(none.headers.get('access-control-allow-origin'), null); await err(none, 403, 'permission_error');
// 미리 묻기(preflight)
const pre = await call(null, { method: 'OPTIONS' });
assert.equal(pre.status, 204); assert.equal(pre.headers.get('access-control-allow-origin'), O); assert.match(pre.headers.get('access-control-allow-headers'), /content-type/);
assert.equal((await call(null, { method: 'OPTIONS', origin: 'http://localhost:8765' })).headers.get('access-control-allow-origin'), 'http://localhost:8765', '개발 주소');
await err(await call(good, { path: '/v1/models' }), 404, 'not_found_error');
// 앱이 보내지 않는 모양은 받지 않는다
for (const bad of ['{잘린', { ...good, model: 'claude-opus-4-1' }, { ...good, max_tokens: 64001 }, { ...good, max_tokens: '100' }, { ...good, system: [{ type: 'text', text: 'x' }] },
  { ...good, messages: undefined }, { ...good, messages: [...good.messages, { role: 'assistant', content: 'x' }] }, { ...good, messages: [{ role: 'user', content: [{ type: 'image' }] }] }, { ...good, output_config: 'x' }])
  await err(await call(bad), 400, 'invalid_request_error');
await err(await call({ ...good, system: 'x'.repeat(300001) }), 413, 'request_too_large');
allow = false; await err(await call(good), 429, 'rate_limit_error'); allow = true;

// 받는 요청: 서비스 키를 붙이고, 앱이 보낸 칸만 넘기고, 답은 그대로 흘려보낸다
const res = await call({ ...good, tools: [{ type: 'web_search' }], metadata: { user_id: 'x' } });
assert.equal(res.status, 200); assert.equal(res.headers.get('access-control-allow-origin'), O);
assert.equal(res.headers.get('content-type'), 'text/event-stream'); assert.equal(res.headers.get('content-encoding'), null); assert.match(res.headers.get('cache-control'), /no-transform/);
assert.match(await res.text(), /message_stop/);
const { url, init } = up[0], sent = JSON.parse(init.body);
assert.equal(url, 'https://api.anthropic.com/v1/messages');
assert.deepEqual(init.headers, { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'server-side-fallback-2026-07-01' }, '브라우저 헤더(출처)는 넘기지 않는다');
assert.deepEqual(sent, good, '도구·metadata 같은 다른 칸은 뺀다');
// fallbacks가 없으면(Haiku, 대체 모델 베타를 못 쓰는 조직) 베타 헤더도 없다
const { fallbacks, output_config, ...alt } = good;
await call({ ...alt, model: 'claude-haiku-5-5', max_tokens: 1000 });
assert.equal(up[0].init.headers['anthropic-beta'], undefined); assert.deepEqual(JSON.parse(up[0].init.body), { ...alt, model: 'claude-haiku-5-5', max_tokens: 1000 });

// Anthropic 오류는 상태와 본문 그대로 (앱의 errorText가 읽는다)
answer = () => Response.json({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, { status: 401 });
const e401 = await call(good);
assert.equal(e401.status, 401); assert.equal((await e401.json()).error.type, 'authentication_error'); assert.equal(e401.headers.get('access-control-allow-origin'), O, '오류도 앱이 읽을 수 있게');
answer = () => { throw new TypeError('fetch failed'); };
assert.equal((await call(good)).status, 502);

// 앱(claude.js)이 실제로 만드는 요청이 이 중계를 통과한다 (모델·max_tokens를 한쪽만 바꾸면 여기서 걸린다)
const { API, callClaude, suggestAlts } = await import('../claude.js');
const sse = t => [{ type: 'content_block_delta', delta: { type: 'text_delta', text: t } }, { type: 'message_delta', delta: { stop_reason: 'end_turn' } }, { type: 'message_stop' }].map(e => `data: ${JSON.stringify(e)}\n\n`).join('');
const app = globalThis.fetch;  // 위의 Anthropic 흉내
globalThis.fetch = (url, init) => url === API ? worker.fetch(new Request(url, { ...init, headers: { ...init.headers, origin: O, 'cf-connecting-ip': '1.2.3.4' } }), env) : app(url, init);
answer = () => new Response(sse('{"alts":["가","나"]}'), { headers: { 'content-type': 'text/event-stream' } }); up = [];
assert.equal(await callClaude({ system: 's', user: 'u', schema: { type: 'object' } }), '{"alts":["가","나"]}');
assert.equal(JSON.parse(up[0].init.body).model, 'claude-opus-5-5'); assert.equal(up[0].init.headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
up = [];
assert.deepEqual(await suggestAlts({ phrase: '다', sentence: '다 라' }), ['가', '나']);
assert.equal(JSON.parse(up[0].init.body).model, 'claude-haiku-5-5'); assert.equal(up[0].init.headers['anthropic-beta'], undefined);
// 배포한 주소를 claude.js와 index.html CSP에 같이 넣었나
const csp = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').match(/connect-src([^;"]*)/)[1].trim().toLowerCase().split(/\s+/);  // 호스트는 대소문자를 가리지 않는다
assert.ok(csp.includes(new URL(API).origin), `index.html CSP connect-src에 ${new URL(API).origin}이 없다`);
console.log('worker ok');
