// AI 중계 (Cloudflare Worker). 앱은 키 없이 여기로 보내고, 여기서 서비스 키를 붙여 Anthropic에 넘긴다. 요금은 서비스가 낸다.
// 키는 Worker 비밀값(ANTHROPIC_API_KEY)에만 있다. 배포 방법은 wrangler.toml 맨 위에 있다.
// 아무나 이 주소로 다른 일을 시키지 못하게 앱이 보내는 모양(모델 둘, 사용자 글 하나)만 받는다.
// 출처 검사는 다른 사이트의 브라우저만 막는다(curl은 출처를 꾸밀 수 있다). 비용의 진짜 상한은 Anthropic 콘솔의 워크스페이스 월 지출 한도다.
const ORIGINS = ['https://gepi2.github.io', 'http://localhost:8765', 'http://127.0.0.1:8765'];
const MODELS = ['claude-opus-5-5', 'claude-haiku-5-5'];
const MAX_TOKENS = 64000;  // 앱이 보내는 값
const MAX_CHARS = 300000;  // 대본·슬라이드·참고 자료를 다 넣어도 이보다 짧다

const fail = (status, type, message, headers) => Response.json({ type: 'error', error: { type, message } }, { status, headers });

export default {
  async fetch(req, env) {
    const o = req.headers.get('origin'), h = o ? { 'access-control-allow-origin': o, vary: 'origin' } : {};
    // 미리 묻기(preflight)는 어느 출처든 받는다. 막힌 출처도 아래 403을 읽어서 '인터넷 연결'이 아니라 '설정 문제'로 보인다. 보내는 일은 막는다
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...h, 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' } });
    if (!ORIGINS.includes(o)) return fail(403, 'permission_error', 'origin not allowed', h);
    if (req.method !== 'POST' || new URL(req.url).pathname !== '/v1/messages') return fail(404, 'not_found_error', 'not found', h);
    // ponytail: IP마다 1분 대략치(Cloudflare 지역마다 따로 센다). 하루 상한이 필요하면 KV나 Durable Object
    if (env.RL && !(await env.RL.limit({ key: req.headers.get('cf-connecting-ip') || '' })).success) return fail(429, 'rate_limit_error', 'too many requests', h);

    const raw = await req.text();
    if (raw.length > MAX_CHARS) return fail(413, 'request_too_large', 'request too large', h);
    let b = null;
    try { b = JSON.parse(raw); } catch {}
    const { model, max_tokens, system, messages, output_config, fallbacks } = b || {}, m = messages?.[0];
    if (!MODELS.includes(model) || !(Number.isInteger(max_tokens) && max_tokens > 0 && max_tokens <= MAX_TOKENS) || typeof system !== 'string'
      || messages?.length !== 1 || m?.role !== 'user' || typeof m.content !== 'string'
      || (output_config != null && typeof output_config !== 'object')) return fail(400, 'invalid_request_error', 'unsupported request', h);

    // 브라우저 헤더(Origin 등)는 넘기지 않고 새로 만든다. 서버에서 부르니 direct-browser-access 헤더도 없다
    const headers = { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' };
    const body = { model, max_tokens, stream: true, system, messages: [{ role: 'user', content: m.content }], ...(output_config && { output_config }) };
    // 안전 분류기가 잘못 거절하면 Anthropic이 다른 모델로 다시 돌린다 (앱이 fallbacks를 보낼 때만)
    if (fallbacks === 'default') { body.fallbacks = 'default'; headers['anthropic-beta'] = 'server-side-fallback-2026-07-01'; }
    let up;
    try { up = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(body) }); }
    catch { return fail(502, 'api_error', 'upstream unreachable', h); }
    // 스트리밍 답과 오류 JSON을 상태 그대로 흘려보낸다. content-encoding·length는 옮기지 않고, no-transform으로 압축·버퍼링을 막는다
    return new Response(up.body, { status: up.status, headers: { ...h, 'content-type': up.headers.get('content-type') || 'application/json', 'cache-control': 'no-cache, no-transform' } });
  },
};
