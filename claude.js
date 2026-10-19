// Claude 호출. 키가 있으면 브라우저가 Anthropic API를 바로 부르고, 없으면 프롬프트를 복사해 챗봇에 붙여넣는다.
import { cleanPack } from './qa.js?v=14';
import { cleanAi } from './adlib.js?v=14';
import { bands, cleanAiCoach, NAME, PACE_TALK, finished } from './check.js?v=14';

const API = 'https://api.anthropic.com/v1/messages';
export const MODEL = 'claude-opus-5-5', EFFORT = 'medium';
// '다른 말'은 짧고 자주 부르므로 Haiku. Haiku 5.5는 서버 대체 모델(fallbacks)을 받지 않는다.
export const ALT_MODEL = 'claude-haiku-5-5';

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
const BAD_KEY = '키에 쓸 수 없는 글자가 있어요. AI 키에서 키를 다시 복사해 넣어 주세요.';
// 붙여넣은 답이든 API로 받은 답이든 같은 글을 쓴다. 필드 이름 같은 개발자 말은 화면에 내지 않는다
const NOT_FOUND = what => `받은 글에서 ${what} 찾지 못했어요. 답이 처음부터 끝까지 다 들어갔는지 확인해 주세요.`;

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
          keys: { type: 'array', items: { type: 'string' } },
          source: { type: 'string' },
          check: { type: 'boolean' },
        },
        required: ['id', 'q', 'alts', 'answer', 'keys', 'source', 'check'],
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
- keys: 답의 핵심 키워드 2~3개. 발표자가 한눈에 보고 말을 시작할 수 있는 짧은 말(한 개에 12자 안쪽). 답에 없는 말은 쓰지 않는다.
- 답은 아래 자료(발표 정보와 대본)에 있는 내용으로만 쓴다. 숫자나 사실을 지어내지 않는다.
- 자료만으로 답할 수 없으면 답에 확인할 점을 적고 check를 true로 한다. 자료에 근거가 있으면 false.
- source: 답의 근거가 된 대본 문장을 그대로 옮긴다. 없으면 빈 문자열.
- id: q01, q02처럼 차례로 붙인다.

답은 아래 형식의 JSON 하나로만 한다. 앞뒤 설명이나 코드 블록 표시는 붙이지 않는다.
{"version":1,"questions":[{"id":"q01","q":"...","alts":["...","..."],"answer":["..."],"keys":["...","..."],"source":"...","check":false}]}`;
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

// 챗봇 답에 설명이나 ``` 표시가 붙어도 JSON 부분만 골라 clean으로 검사한다. 코드 블록이 있으면 그 안부터 본다.
function parseJson(text, clean, what) {
  let err = null;
  for (const s of [String(text).match(/```(?:json)?\s*([\s\S]*?)```/)?.[1], String(text)]) {
    if (s == null) continue;
    const spans = [['{', '}'], ['[', ']']].map(([o, c]) => [s.indexOf(o), s.lastIndexOf(c)])
      .filter(([a, b]) => a >= 0 && b > a).sort((x, y) => x[0] - y[0]);
    for (const [a, b] of spans) {
      try { return clean(JSON.parse(s.slice(a, b + 1))); } catch (e) { if (!(e instanceof SyntaxError)) err ??= e; }
    }
  }
  throw err ?? new Error(`JSON을 읽지 못했어요. ${what} JSON이 처음부터 끝까지 다 들어갔는지 확인해 주세요.`);
}
export const parsePack = text => parseJson(text, cleanPack, '질문 팩');

export async function generatePack(info, opts) {
  const p = qaPrompt(info);
  return parsePack(await callClaude({ ...opts, system: p.system, user: p.user, schema: PACK_SCHEMA }));
}

// ---- 대본 쓰기와 고치기 (답은 대본 글 그대로. 앱이 다시 세고 비교 화면을 보여 준다) ----
const SPOKEN = `- 말하듯이 짧은 문장으로 쓴다. 한 문장은 한 호흡에 소리 내어 읽을 수 있는 길이로 한다.
- 어려운 한자어나 외래어보다 말하기 쉬운 낱말을 쓴다.
- 마크다운, 제목, 번호, 글머리표, 괄호 속 지시문(예: (슬라이드 넘김), (웃으며))을 쓰지 않는다. 소리 내어 읽을 문장만 쓴다.
- 자료에 없는 숫자, 이름, 사실을 지어내지 않는다. 꼭 필요한데 자료에 없으면 그 자리에 [확인 필요]라고 쓴다.
- 글자 수는 공백과 문장부호를 뺀 글자 수로 센다.
- 대본 본문만 답한다. 앞뒤 설명이나 인사는 붙이지 않는다.`;

// info: { topic, audience, goal, tone, outline(한 줄에 슬라이드 하나), refs, minutes, chars(목표 글자 수, 없으면 0) }
export function scriptPrompt({ topic, audience, goal, tone, outline, refs, minutes, chars }) {
  const slides = String(outline || '').split('\n').map(s => s.trim()).filter(Boolean);
  const per = chars && slides.length ? Math.round(chars / slides.length) : 0;
  const system = `너는 발표 대본을 쓴다. 발표자는 이 대본을 휴대폰 화면에 띄워 놓고 소리 내어 읽고, 앱이 목소리를 듣고 읽는 위치를 따라간다.

규칙
- 슬라이드 하나에 문단 하나를 쓴다. 문단 사이는 빈 줄 하나로 나눈다. 슬라이드 개요가 없으면 내용에 맞게 문단을 나눈다.
- 말투는 ${tone || '합니다체'}로 통일한다.
${SPOKEN}
- ${chars ? `전체 길이는 약 ${chars}자로 맞춘다.${per ? ` 슬라이드마다 개요에 적힌 글자 수에 맞춘다.` : ''}` : '길이는 내용에 맞게 정한다.'}`;
  const user = `<발표정보>
주제: ${topic || '(적지 않음)'}
청중: ${audience || '(적지 않음)'}
목적과 핵심 메시지: ${goal || '(적지 않음)'}
목표 시간: ${minutes ? `약 ${minutes}분${chars ? ` (전체 약 ${chars}자)` : ''}` : '(적지 않음)'}
</발표정보>
<슬라이드개요>
${slides.length ? slides.map((s, i) => `${i + 1}. ${s}${per ? ` (약 ${per}자)` : ''}`).join('\n') : '(없음)'}
</슬라이드개요>
<참고자료>
${String(refs || '').trim() || '(없음)'}
</참고자료>

위 정보로 발표 대본을 써 주세요.`;
  return { system, user, text: system + '\n\n' + user };
}

// script: 지금 대본, part: 고칠 부분(선택한 문단, 없으면 전체), instr: 지시, rate: 초당 글자 수, chars: 고칠 글의 글자 수
export function editPrompt({ script, part = '', instr, rate, chars }) {
  const system = `너는 발표 대본을 고친다. 발표자는 이 대본을 소리 내어 읽고, 앱이 목소리를 듣고 읽는 위치를 따라간다.

규칙
- 발표자의 지시대로 고친다. 지시와 상관없는 문장은 글자 하나 바꾸지 않고 그대로 둔다.
- 문단 나눔(빈 줄)과 말투를 지킨다. 원래 있던 [확인 필요]는 그대로 둔다.
${SPOKEN}
- 말 속도는 초당 약 ${Math.round(rate * 10) / 10}자다. 시간으로 지시하면(예: 30초 줄이기) 이 속도로 글자 수를 어림한다.
- ${part ? '<고칠부분>만 고쳐서 그 부분만 답한다. <대본>은 앞뒤 흐름을 보라고 주는 것이다.' : '고친 대본 전체를 답한다.'}`;
  const user = `<대본>
${script}
</대본>
${part ? `<고칠부분>\n${part}\n</고칠부분>\n` : ''}고칠 글의 길이: 약 ${chars}자 (예상 ${Math.floor(Math.round(chars / rate) / 60)}분 ${Math.round(chars / rate) % 60}초)
<지시>
${instr}
</지시>`;
  return { system, user, text: system + '\n\n' + user };
}

// ---- 발표 준비: 문단마다 줄일 때 쓸 정보(새 문장은 쓰지 않고 원문 문장 번호만), 키워드마다 다른 말 ----
export const PREP_SCHEMA = {
  type: 'object',
  properties: {
    paras: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          p: { type: 'integer' },
          imp: { type: 'integer', enum: [1, 2, 3] },
          keep: { type: 'array', items: { type: 'integer' } },
          drop: { type: 'array', items: { type: 'integer' } },
        },
        required: ['p', 'imp', 'keep', 'drop'],
        additionalProperties: false,
      },
    },
    kw: {
      type: 'array',
      items: {
        type: 'object',
        properties: { k: { type: 'string' }, v: { type: 'array', items: { type: 'string' } } },
        required: ['k', 'v'],
        additionalProperties: false,
      },
    },
  },
  required: ['paras', 'kw'],
  additionalProperties: false,
};

// ps: 문단마다 [{ t: 문장, kw: [키워드] }] (키워드는 match.js anchors()가 뽑은 것)
export function prepPrompt(ps) {
  const system = `너는 발표 대본을 살펴 두 가지를 정한다. 발표 중에는 AI를 부르지 않고 앱이 이 결과로만 계산한다.
1. 발표가 늦어지면 앱이 덜 중요한 문단부터 문장을 숨겨 시간을 맞춘다. 새 문장은 쓰지 않고 원문 문장 번호만 고른다.
2. 발표자가 키워드를 다르게 말해도 앱이 읽는 위치를 따라가도록, 키워드마다 발표자가 대신 말할 법한 말을 모은다.

규칙
- paras: 문단마다 하나씩 문단 번호 순서대로 쓴다. p는 문단 번호다.
  - imp: 1은 빼면 발표 목적이 무너지는 문단, 2는 보통, 3은 예시나 여담.
  - keep: 시간이 없어도 꼭 남길 문장 번호 1~2개. 문장 번호는 문단 안에서 1부터 센다.
  - drop: 늦어지면 빼도 되는 문장 번호. keep에 넣은 번호는 넣지 않는다. 없으면 빈 배열.
  - 다음 문장이 '그래서', '이처럼', '앞서 말씀드린'처럼 앞 문장을 가리키면 그 앞 문장은 drop에 넣지 않는다.
- kw: 다른 말이 있는 키워드만 하나씩 쓴다. k는 키워드를 적힌 그대로, v는 다른 말 1~4개.
  - 키워드는 앱이 공백과 문장부호를 빼고 숫자와 대문자 약어를 소리 나는 대로 바꿔 적은 것이다(30명 → 삼십명, AI → 에이아이).
  - v에는 발표자가 그 낱말 대신 말할 법한 말(휴대폰 → 핸드폰, 스마트폰)과 숫자·영어를 다르게 읽는 말(iphone → 아이폰, 에이아이 → 인공지능)을 쓴다.
  - 조사는 붙이지 않는다. 뜻이 넓어 다른 문장에도 나올 법한 말은 쓰지 않는다. 마땅한 다른 말이 없는 키워드는 kw에 쓰지 않는다.

답은 아래 형식의 JSON 하나로만 한다. 앞뒤 설명이나 코드 블록 표시는 붙이지 않는다.
{"paras":[{"p":1,"imp":2,"keep":[1],"drop":[3]}],"kw":[{"k":"휴대폰","v":["핸드폰"]}]}`;
  const body = ps.map((p, i) => `[문단 ${i + 1}]\n` + p.map((s, j) => `${j + 1}. ${s.t}` + (s.kw.length ? `\n   키워드: ${s.kw.join(', ')}` : '')).join('\n')).join('\n\n');
  const user = `<대본>\n${body}\n</대본>\n\n위 대본의 문단 ${ps.length}개를 모두 정해 주세요.`;
  return { system, user, text: system + '\n\n' + user };
}

// 뒤 문장이 이런 말로 시작하면 앞 문장을 가리키므로, 앞 문장은 빼지 않는다 (AI가 규칙을 어겨도 앱이 한 번 더 막는다)
const BACKREF = /^["'“‘(]?(그래서|그러므로|따라서|그러니까|그 결과|이처럼|이렇게|이와 같이|이러한|이런|이 때문에|이는|이것은|그것은|즉|앞서|앞에서)(?![가-힣])/;

// 발표 준비 결과 검사. ps: 문단마다 문장 글 목록 (lib.js paras()). 반환 { paras: [{ imp, keep, drop }] (문장 번호는 0부터), kw: { 키워드: [다른 말] } }
export function cleanPrep(obj, ps) {
  if (!obj || !Array.isArray(obj.paras)) throw new Error(NOT_FOUND('문단별 결과를'));
  const flat = ps.flat();
  let o = 0;
  const paras = ps.map((sents, i) => {
    const it = obj.paras.find(x => x?.p === i + 1) ?? obj.paras[i] ?? {}, n = sents.length;
    const idx = v => [...new Set((Array.isArray(v) ? v : []).filter(k => Number.isInteger(k) && k >= 1 && k <= n).map(k => k - 1))].sort((a, b) => a - b);
    const keep = idx(it.keep);
    let drop = idx(it.drop).filter(k => !keep.includes(k) && !BACKREF.test(flat[o + k + 1] ?? ''));  // 다음 문단 첫 문장까지 본다
    if (!keep.length) keep.push([...Array(n).keys()].find(k => !drop.includes(k)) ?? 0);
    drop = drop.filter(k => !keep.includes(k));
    o += n;
    return { imp: [1, 2, 3].includes(it.imp) ? it.imp : 2, keep, drop };
  });
  const kw = Object.create(null);  // 'constructor' 같은 이름도 키워드가 될 수 있다 (app.js·match.js는 Object.entries/keys만 쓴다)
  for (const it of Array.isArray(obj.kw) ? obj.kw : []) {
    const k = typeof it?.k === 'string' ? it.k.normalize('NFC').trim().slice(0, 30) : '';
    const v = (Array.isArray(it?.v) ? it.v : []).filter(x => typeof x === 'string')
      .map(x => x.normalize('NFC').replace(/\s+/g, ' ').trim()).filter(x => x && x !== k && x.length <= 20);
    if (k && v.length && (kw[k] || Object.keys(kw).length < 600)) kw[k] = [...new Set([...(kw[k] || []), ...v])].slice(0, 4);  // 다른 말이 있는 키워드 600개까지
  }
  return { paras, kw };
}
export const parsePrep = (text, ps) => parseJson(text, o => cleanPrep(o, ps), '발표 준비');

// ---- 다른 말: 고른 말과 그 문장만 보낸다 ----
export const ALT_SCHEMA = {
  type: 'object',
  properties: { alts: { type: 'array', items: { type: 'string' } } },
  required: ['alts'],
  additionalProperties: false,
};

export function altPrompt({ phrase, sentence }) {
  const system = `너는 발표 대본에서 고른 말을 소리 내어 말하기 쉬운 다른 말로 바꿔 준다.

규칙
- 대안을 3개 쓴다. 고른 말과 뜻이 같고, 문장에서 고른 말 자리에 그대로 넣어도 자연스러워야 한다.
- 고른 말 끝의 조사와 어미까지 포함해서 바꾼다. 문장에 넣었을 때 조사가 맞아야 한다(예: '레버리지를' → '지렛대를', '활용을').
- 숫자, 영어 표기, 사람·제품·기관 이름 같은 고유명사는 바꾸지 않고 그대로 둔다.
- 더 짧고 쉬운 말을 먼저 쓴다.

답은 JSON 하나로만 한다. {"alts":["...","...","..."]}`;
  const user = `<문장>${sentence}</문장>\n<고른말>${phrase}</고른말>`;
  return { system, user, text: system + '\n\n' + user };
}

// 숫자와 영문은 그대로 남은 대안만 쓴다 (바뀌면 음성 인식 결과와 대본이 어긋난다)
export function cleanAlts(obj, phrase) {
  const fixed = phrase.match(/[0-9]+|[A-Za-z]+/g) || [];
  const out = [...new Set((Array.isArray(obj?.alts) ? obj.alts : []).filter(x => typeof x === 'string')
    .map(x => x.normalize('NFC').replace(/\s+/g, ' ').trim()))]
    .filter(x => x && x !== phrase && x.length <= Math.max(40, phrase.length * 3) && fixed.every(f => x.includes(f)));
  if (!out.length) throw new Error('쓸 만한 다른 말을 찾지 못했어요. 조금 더 길게 골라 보세요.');
  return out.slice(0, 3);
}

export async function suggestAlts({ phrase, sentence }, opts) {
  const p = altPrompt({ phrase, sentence });
  const text = await callClaude({ ...opts, system: p.system, user: p.user, schema: ALT_SCHEMA, model: ALT_MODEL, effort: 'low', fallback: false });
  return parseJson(text, o => cleanAlts(o, phrase), '다른 말');
}

// ---- 애드리브 정리: 발표 중 대본에 없던 말마다 제목, 말한 내용, 대본에 넣을 문장 ----
// 대본 전체는 보내지 않는다. 애드리브와 그 앞뒤 대본 문장만 보낸다.
export const ADLIB_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          n: { type: 'integer' },
          title: { type: 'string' },
          points: { type: 'array', items: { type: 'string' } },
          worth: { type: 'boolean' },
          add: { type: 'array', items: { type: 'string' } },
        },
        required: ['n', 'title', 'points', 'worth', 'add'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

// segs: 오래된 것부터 [{ prev: 앞 문장(없으면 발표 처음), text: 들은 말(군말 뺀 것), next: 뒤 문장 }]
export function adlibPrompt(segs) {
  const system = `너는 발표가 끝난 뒤 정리를 돕는다. 발표자가 대본을 읽다가 대본에 없는 말(애드리브)을 했고, 앱이 음성 인식으로 받아 적었다.
받아 적은 글이라 띄어쓰기와 낱말이 틀릴 수 있고 문장부호가 없다.

규칙
- items: 애드리브마다 하나씩 번호(n) 순서대로 쓴다.
- title: 무슨 이야기인지 15자 안팎의 짧은 제목.
- points: 발표자가 한 말을 1~3줄로 정리한다. 한 줄에 한 문장. 들은 말에 없는 내용은 더하지 않는다.
- worth: 다음 발표에서도 하면 좋은 내용이라 대본에 넣을 만하면 true. 인사, 진행 말(예: "화면 잘 보이시나요"), 말실수를 고친 말, 앞뒤 대본을 다시 말한 것이면 false.
- add: worth가 true일 때만, 앞 문장 바로 뒤에 넣을 대본 문장 1~2개. 앞뒤 대본 문장과 같은 말투(합니다체나 해요체)로, 소리 내어 읽기 쉬운 짧은 문장으로 쓴다. 들은 말에 없는 숫자나 사실은 지어내지 않는다. worth가 false면 빈 배열.

답은 아래 형식의 JSON 하나로만 한다. 앞뒤 설명이나 코드 블록 표시는 붙이지 않는다.
{"items":[{"n":1,"title":"...","points":["..."],"worth":true,"add":["..."]}]}`;
  const body = segs.map((g, i) => `<애드리브 ${i + 1}>
앞 문장: ${g.prev || '(발표 처음)'}
들은 말: ${g.text}
뒤 문장: ${g.next || '(없음)'}
</애드리브 ${i + 1}>`).join('\n');
  const user = `${body}\n\n위 애드리브 ${segs.length}개를 모두 정리해 주세요.`;
  return { system, user, text: system + '\n\n' + user };
}

// AI 답 검사(adlib.js cleanAi). 반환: 애드리브 순서대로 정리 또는 null(빠졌거나 모양이 틀림). 하나도 없으면 Error.
// 붙여넣기에서는 items 배열만 와도 받는다.
export function cleanAdlib(obj, n) {
  const items = Array.isArray(obj) ? obj : obj?.items;
  if (!Array.isArray(items)) throw new Error(NOT_FOUND('애드리브 정리를'));
  const out = Array.from({ length: n }, (_, i) => cleanAi(items.find(x => x?.n === i + 1) ?? (Number.isInteger(items[i]?.n) ? null : items[i])));
  if (!out.some(Boolean)) throw new Error('정리한 내용이 없어요.');
  return out;
}
export const parseAdlib = (text, n) => parseJson(text, o => cleanAdlib(o, n), '애드리브 정리');

// 짧은 글 정리라 생각은 적게(effort low). 모델은 기본(MODEL)이고 대체 모델(fallbacks)도 그대로 쓴다.
export async function summarizeAdlib(segs, opts) {
  const p = adlibPrompt(segs);
  return parseAdlib(await callClaude({ ...opts, system: p.system, user: p.user, schema: ADLIB_SCHEMA, effort: 'low' }), segs.length);
}

// ---- 발표 점검 코칭: 구간 번호, 위치, 글자 수와 잰 숫자만 보낸다. 대본 글과 목소리는 보내지 않는다 ----
// 첫 구간에는 반과 이름이 들어가기 쉽다. 팁은 구간 번호로 돌아오고 앱이 구간 글을 가지고 있다.
export const COACH_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    tips: {
      type: 'array',
      items: {
        type: 'object',
        properties: { sec: { type: 'integer' }, what: { type: 'string' }, how: { type: 'string' } },
        required: ['sec', 'what', 'how'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'tips'],
  additionalProperties: false,
};

// run: check.js 기록, prev: 고른 기록 바로 앞 기록(없으면 null), tips: check.js tips()의 [{ text }](구간 번호와 숫자만 담김),
// goal: 지금 목표 초(결과 창에서 바꿀 수 있다, 기본은 기록의 목표)
export function coachPrompt(run, prev, tips = [], goal = run.target) {
  const k = run.secs.length, E = bands(run.secs.map(s => s.n), goal, run.r0), n = x => x == null ? '-' : Math.round(x);
  const where = i => i < k / 3 ? '처음' : i < 2 * k / 3 ? '중간' : '끝';
  const perMin = s => s.talk >= PACE_TALK ? Math.round(s.heard / s.talk * 6) * 10 : null;
  const system = `너는 학생의 발표 연습을 돕는 코치다. 앱이 발표 연습을 재서 구간 번호와 잰 숫자만 보낸다. 대본 글과 목소리는 받지 않는다.

잰 값의 뜻과 한계
- 감정은 재지 않는다. 높낮이 폭, 쉼, 빠르기는 감정 표현과 함께 달라지는 대리 지표일 뿐이다.
- 높낮이 폭: 유성음 높낮이를 반음으로 바꾼 값의 10~90백분위 폭이다. 5반음 미만이면 좁고 10반음 넘으면 넓다고 본다(추정).
- 1분에 자: 음성 인식이 받아 적은 음절 수를 말한 시간으로 나눈 빠르기다. 인식 결과가 도착한 시각으로 재서 ±15% 흔들린다.
- 쉼 수: 0.25~3초 쉰 횟수다. 쉬지 않고 가장 긴 초: 0.25초 넘는 쉼 없이 이어 말한 가장 긴 시간이다.
- 1.5초 넘는 멈춤: 인식 결과 사이의 틈이다. 목소리 분석을 하지 않았으면 쉼 대신 이 값을 본다.
- 대본 밖 초: 대본에 없는 말을 한 시간이다. 그대로 %: 받아 적은 음절 가운데 대본을 따라간 비율이다.
- 기대 초: 목표 시간을 구간 글자 수 비율로 나눈 값이다. 목표가 없으면 발표를 시작할 때의 말 속도로 잡은 범위다.
- '-'는 재지 않은 값이다. 걸린 초가 '-'인 구간은 읽지 않은 구간이다(중간에 멈췄거나 건너뜀).

한국어 기준
- 소리 내어 읽기(낭독)는 초당 4.8~5.1음절, 1분에 약 290~305자다. 자유롭게 말하면 초당 약 4.2음절이고, 뉴스 아나운서는 5.7~6.0음절이다.

규칙
- tips는 3개까지 쓴다. sec는 구간 번호이고, 발표 전체에 대한 팁이면 0이다. 읽지 않은 구간에는 팁을 쓰지 않는다.
- 받은 숫자 밖의 숫자를 지어내지 않는다. 감정이나 성격을 판단하지 않는다.
- what에는 숫자로 본 점을, how에는 다음 연습에서 할 행동 하나를 쓴다. 모두 해요체 한국어로 쓴다.
- summary는 한 문장이다.

답은 아래 형식의 JSON 하나로만 한다. 앞뒤 설명이나 코드 블록 표시는 붙이지 않는다.
{"summary":"...","tips":[{"sec":2,"what":"...","how":"..."}]}`;
  // 읽지 않은 구간(걸린 시간 0)은 번호, 위치, 글자 수, 기대 초만 두고 잰 값은 '-' (0초나 멈춤 0번으로 읽히지 않게)
  const rows = run.secs.map((s, i) => [i + 1, where(i), s.n, n(s.wall), E[i].b ?? `${n(E[i].lo)}~${n(E[i].hi)}`, n(perMin(s)),
    s.st ? n(s.st[1] - s.st[0]) : '-', s.p25 == null ? '-' : s.p25 + s.p1, n(s.run), n(s.off), s.heard ? Math.min(100, Math.round(s.chars / s.heard * 100)) : '-', s.gaps]
    .map((x, j) => s.wall || [0, 1, 2, 4].includes(j) ? x : '-').join(' | '));
  const user = `<발표점검>
모드: ${NAME[run.kind]}
목표: ${goal ? goal + '초' : '없음'}
총 시간: ${n(run.wall)}초
진행: ${finished(run) ? '끝까지 읽음' : run.pct + '%까지 읽고 멈춤'}
평균 빠르기: ${perMin(run) == null ? '-' : `1분에 약 ${perMin(run)}자`}
목소리 분석: ${!run.audio ? '하지 않음(높낮이 폭과 쉼 없음)' : run.audio.off ? `${n(run.audio.at)}초에 꺼짐(그 뒤 높낮이 폭과 쉼 없음)` : '함'}
구간 수: ${k}
구간 | 위치 | 글자 수 | 걸린 초 | 기대 초 | 1분에 자 | 높낮이 폭 반음 | 쉼 수 | 쉬지 않고 가장 긴 초 | 대본 밖 초 | 그대로 % | 1.5초 넘는 멈춤
${rows.join('\n')}
지난 기록 총 시간: ${!prev ? '없음' : !(finished(run) && finished(prev)) ? '비교 안 함(끝까지 읽지 않은 기록이 있음)' : n(prev.wall) + '초' + (prev.h === run.h ? '' : '(대본이 달라 구간은 비교하지 않음)')}
</발표점검>
<규칙으로찾은것>
${tips.length ? tips.map(t => '- ' + (t.text ?? t)).join('\n') : '(없음)'}
</규칙으로찾은것>

위 숫자로 다음 연습에서 해 볼 것을 정해 주세요.`;
  return { system, user, text: system + '\n\n' + user };
}

// AI 답 검사(check.js cleanAiCoach, 저장값도 같은 검사): summary 200자, 팁 3개까지, sec가 0~k 정수가 아니면 0, 빈 팁은 버림. 남은 팁이 없으면 Error
export function cleanCoach(o, k) {
  const c = cleanAiCoach(o, k);
  if (!c) throw new Error(Array.isArray(o?.tips) ? '쓸 만한 팁이 없어요.' : NOT_FOUND('코칭 내용을'));
  return c;
}
export const parseCoach = (text, k) => parseJson(text, o => cleanCoach(o, k), '발표 코칭');

// 짧은 답이라 생각은 적게(effort low). 모델은 기본(MODEL)이고 대체 모델도 그대로 쓴다. opts.goal: 지금 목표 초
export async function coachRun(run, prev, tips, { goal, ...opts } = {}) {
  const p = coachPrompt(run, prev, tips, goal ?? run.target);
  return parseCoach(await callClaude({ ...opts, system: p.system, user: p.user, schema: COACH_SCHEMA, effort: 'low' }), run.secs.length);
}

// ---- API 호출 (스트리밍: 질문이 많아도 시간 초과 없이 받고, 받은 만큼 진행을 보여 준다) ----
function errorText(status, err = {}, model = MODEL) {
  const t = err.type || '';
  if (status === 401 || t === 'authentication_error') return 'API 키가 맞지 않아요(401). AI 키에서 키를 다시 넣어 주세요.';
  // 지출 한도(429나 400)와 크레딧 부족(400)은 기다려도 풀리지 않는다
  if (/usage limit|credit balance/i.test(err.message || '')) return `지출 한도에 걸렸거나 크레딧이 부족해요(${status || t}). Claude Console에서 결제와 한도 설정을 확인해 주세요.`;
  if (status === 403 || t === 'permission_error') return '이 키로는 쓸 수 없어요(403). 키의 권한을 확인해 주세요.';
  if (status === 402 || t === 'billing_error') return '크레딧이나 월 지출 한도를 확인해 주세요(402).';
  if (status === 404 || t === 'not_found_error') return `이 키로는 ${model} 모델을 쓸 수 없어요(404). 키의 워크스페이스 설정을 확인해 주세요.`;
  if (status === 429 || t === 'rate_limit_error') return '요청이 너무 많아요(429). 1분쯤 뒤에 다시 해 주세요.';
  // 너무 긴 글은 413이 아니라 400 'prompt is too long'으로 온다
  if (status === 413 || t === 'request_too_large' || /too long|too many tokens|maximum context/i.test(err.message || '')) return `대본이 너무 길어서 보내지 못했어요(${status || t}). 문단을 나눠 고르거나 대본을 줄여 주세요.`;
  if (status >= 500 || t === 'overloaded_error' || t === 'api_error') return `Anthropic 서버가 바빠요(${status || t}). 잠시 뒤 다시 해 주세요.`;
  console.warn('Anthropic 오류', status, err);  // 영어 원문은 화면에 내지 않고 콘솔에만 남긴다
  return `AI가 요청을 처리하지 못했어요(${status || t || '?'}). 같은 오류가 되풀이되면 이 숫자를 알려 주세요.`;
}

// 반환: 모델이 쓴 글(text 블록만). 앞에 thinking 블록이 와도 건너뛴다.
// onProgress({ chars, questions, text }): text는 지금까지 받은 글 전체 (대본 미리보기에 바로 보여 준다)
export async function callClaude(o) {
  const { key, system, user, schema, signal, onProgress, model = MODEL, effort = EFFORT, fallback = true } = o;
  if (!keyOk(key)) throw new Error(BAD_KEY);
  const body = {
    model,
    max_tokens: 64000,
    stream: true,
    system,
    messages: [{ role: 'user', content: user }],
    output_config: { effort, ...(schema && { format: { type: 'json_schema', schema } }) },
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
      return callClaude({ ...o, fallback: false });
    throw new Error(errorText(res.status, err, model));
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
          onProgress?.({ chars: text.length, questions: (text.match(/"q"\s*:/g) || []).length, text });
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
  if (streamErr) throw new Error(errorText(0, streamErr, model));
  if (stop === 'refusal') throw new Error('AI가 이 요청을 거절했어요. 대본 내용을 확인한 뒤 다시 해 보세요.');
  if (stop === 'max_tokens') throw new Error('답이 너무 길어서 잘렸어요. 대본을 나누거나 요청을 줄여서 다시 해 주세요.');
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
  assert.throws(() => parsePack('{"foo": 1}'), /질문을 찾지/);
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
  await err(/너무 길어서/, fail(400, 'invalid_request_error', 'prompt is too long: 250000 tokens > 200000 maximum'));
  await err(/처리하지 못했어요\(400\)/, fail(400, 'invalid_request_error', 'something odd'));
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

  // 대본 쓰기: 슬라이드마다 글자 수, 규칙
  const sp = scriptPrompt({ topic: '출석 앱', audience: '교수님', goal: '시간 절약', tone: '해요체', outline: '도입\n\n문제\n해결', refs: '', minutes: 3, chars: 900 });
  assert.ok(sp.system.includes('해요체로') && sp.system.includes('[확인 필요]') && sp.system.includes('빈 줄') && sp.system.includes('약 900자'));
  assert.ok(sp.user.includes('1. 도입 (약 300자)\n2. 문제 (약 300자)\n3. 해결 (약 300자)') && sp.user.includes('약 3분 (전체 약 900자)'));
  assert.ok(scriptPrompt({}).system.includes('합니다체로') && scriptPrompt({}).system.includes('내용에 맞게'), '목표가 없으면 길이는 자유');
  const ep = editPrompt({ script: '가.\n\n나.', part: '나.', instr: '30초 줄이기', rate: 5, chars: 400 });
  assert.ok(ep.user.includes('<고칠부분>\n나.\n</고칠부분>') && ep.user.includes('예상 1분 20초') && ep.system.includes('그 부분만 답한다') && ep.system.includes('초당 약 5자'));
  assert.ok(editPrompt({ script: '가', instr: 'x', rate: 4.83, chars: 2 }).system.includes('대본 전체를 답한다'));

  // 대본 스트리밍: 받은 글이 진행 표시로 온다
  mock(ok('안녕하세요.\n\n반갑습니다.'));
  const texts = [];
  assert.equal(await callClaude({ key: 'k', system: sp.system, user: sp.user, onProgress: x => x.text && texts.push(x.text) }), '안녕하세요.\n\n반갑습니다.');
  assert.ok(texts.length > 2 && texts.at(-1) === '안녕하세요.\n\n반갑습니다.' && texts[0].length < texts.at(-1).length, '받는 대로 보여 주기');
  assert.equal(JSON.parse(calls[0].init.body).output_config.format, undefined, '대본은 글 그대로 받는다');

  // 발표 준비
  const PS = [['도입입니다.', '예시를 듭니다.', '그래서 이 앱을 만들었습니다.', '여담입니다.'], ['한 문장 문단.'], ['앞 문단 끝.', '덧붙임.'], ['이처럼 끝납니다.']];
  const pp = prepPrompt(PS.map(p => p.map(t => ({ t, kw: t === '도입입니다.' ? ['도입', '에이아이'] : [] }))));
  assert.ok(pp.user.includes('[문단 1]\n1. 도입입니다.\n   키워드: 도입, 에이아이\n2. 예시를 듭니다.') && pp.user.includes('문단 4개'));
  assert.ok(pp.system.includes("'그래서'") && pp.system.includes('새 문장은 쓰지 않고'));
  assert.ok(!JSON.stringify([PREP_SCHEMA, ALT_SCHEMA]).match(/maxItems|minItems|minLength|maxLength|minimum|maximum/));
  const prep = cleanPrep({ paras: [
    { p: 1, imp: 3, keep: [1], drop: [1, 2, 4, 9, 0, 2.5] },
    { p: 2, imp: 7, keep: [], drop: [1] },
    { p: 3, imp: 1, keep: [], drop: [1, 2] },
  ], kw: [{ k: '도입', v: ['인트로', ' 인트로 ', '도입', '', 3, '아주아주아주아주아주아주아주긴다른말입니다'] }, { k: '에이아이', v: [] }, null] }, PS);
  assert.deepEqual(prep.paras[0], { imp: 3, keep: [0], drop: [3] }, 'keep은 빼지 않고, 다음 문장이 그래서로 시작하면 앞 문장(2)도 안 뺀다, 범위 밖 번호는 버림');
  assert.deepEqual(prep.paras[1], { imp: 2, keep: [0], drop: [] }, '이상한 중요도는 2, 한 문장 문단은 남김');
  assert.deepEqual(prep.paras[2], { imp: 1, keep: [1], drop: [0] }, '다음 문단 첫 문장(이처럼)이 가리키는 끝 문장은 안 뺀다, keep이 비면 빼지 않는 문장 하나');
  assert.deepEqual(prep.paras[3], { imp: 2, keep: [0], drop: [] }, '빠진 문단은 기본값');
  assert.deepEqual(prep.kw, { 도입: ['인트로'] }, '다른 말 다듬기');
  assert.deepEqual(Object.keys(cleanPrep({ paras: [], kw: [{ k: 'constructor', v: ['생성자'] }, { k: 'toString', v: ['글자로'] }] }, []).kw), ['constructor', 'toString'], 'Object 속성 이름도 키워드로 쓴다');
  const many = Array.from({ length: 900 }, (_, i) => ({ k: '키' + i, v: i % 3 ? [] : ['말' + i] }));
  assert.equal(Object.keys(cleanPrep({ paras: [], kw: many }, []).kw).length, 300, '빈 항목은 600개 한도에 세지 않는다');
  assert.equal(parsePrep('네.\n```json\n{"paras":[{"p":1,"imp":1,"keep":[1],"drop":[]}],"kw":[]}\n```', [['가.']]).paras[0].imp, 1, '붙여넣은 JSON');
  assert.throws(() => parsePrep('{"questions":[]}', [['가.']]), /문단별 결과를/);

  // 다른 말: Haiku, 대체 모델 없이, 숫자·영문은 그대로
  assert.deepEqual(cleanAlts({ alts: ['지렛대를', '지렛대를', ' 활용을 ', '레버리지를', '', 5] }, '레버리지를'), ['지렛대를', '활용을']);
  assert.deepEqual(cleanAlts({ alts: ['2026년에 인공지능을', '2026년에 AI를 써서', '올해 AI를'] }, '2026년에 AI를'), ['2026년에 AI를 써서'], '숫자와 영문이 빠진 대안은 버림');
  assert.throws(() => cleanAlts({ alts: ['레버리지를'] }, '레버리지를'), /찾지 못했어요/);
  const ap = altPrompt({ phrase: '레버리지를', sentence: '이 레버리지를 쓰면' });
  assert.ok(ap.user === '<문장>이 레버리지를 쓰면</문장>\n<고른말>레버리지를</고른말>' && ap.system.includes('조사와 어미까지') && ap.system.includes('고유명사'));
  mock(ok(JSON.stringify({ alts: ['지렛대를', '활용을', '힘을'] })));
  assert.deepEqual(await suggestAlts({ phrase: '레버리지를', sentence: '이 레버리지를 쓰면' }, { key: 'k' }), ['지렛대를', '활용을', '힘을']);
  const ab = JSON.parse(calls[0].init.body);
  assert.equal(ab.model, 'claude-haiku-5-5'); assert.equal(ab.output_config.effort, 'low');
  assert.deepEqual(ab.output_config.format, { type: 'json_schema', schema: ALT_SCHEMA });
  assert.equal(ab.fallbacks, undefined, 'Haiku 5.5는 서버 대체 모델이 없다'); assert.equal(calls[0].init.headers['anthropic-beta'], undefined);
  await (async () => { mock(fail(404, 'not_found_error', 'model')); await assert.rejects(suggestAlts({ phrase: '가', sentence: '가' }, { key: 'k' }), /claude-haiku-5-5 모델/); })();

  // 애드리브 정리: 애드리브와 앞뒤 문장만 보낸다
  const AD = [{ prev: '오늘은 라이브스크립트를 소개하겠습니다.', text: '제가 작년에 발표하다가 대본을 놓쳤거든요', next: '발표할 때 대본을 놓치지 않게 도와줍니다.', raw: '음 제가', cur: 9 },
    { prev: '', text: '안녕하세요 반갑습니다 화면 잘 보이시나요', next: '' }];
  const adp = adlibPrompt(AD);
  assert.ok(adp.user.includes('<애드리브 1>\n앞 문장: 오늘은 라이브스크립트를 소개하겠습니다.\n들은 말: 제가 작년에 발표하다가 대본을 놓쳤거든요\n뒤 문장: 발표할 때 대본을 놓치지 않게 도와줍니다.\n</애드리브 1>'));
  assert.ok(adp.user.includes('앞 문장: (발표 처음)') && adp.user.includes('애드리브 2개') && !adp.user.includes('음 제가'), '군말 뺀 글만');
  assert.ok(adp.system.includes('합니다체나 해요체') && adp.system.includes('지어내지 않는다') && adp.system.includes('"items"'));
  assert.ok(!JSON.stringify(ADLIB_SCHEMA).match(/maxItems|minItems|minLength|maxLength|minimum|maximum/));
  const adr = cleanAdlib({ items: [
    { n: 2, title: '인사', points: ['인사했다'], worth: false, add: ['안녕하세요.'] },
    { n: 1, title: '작년 경험', points: ['작년에 대본을 놓쳤다'], worth: true, add: ['저도 작년에 발표하다가 대본을 놓친 적이 있습니다.'] },
    { n: 7, title: '없는 번호' },
  ] }, 2);
  assert.deepEqual(adr, [{ title: '작년 경험', points: ['작년에 대본을 놓쳤다'], worth: true, add: ['저도 작년에 발표하다가 대본을 놓친 적이 있습니다.'] },
    { title: '인사', points: ['인사했다'], worth: false, add: [] }], '번호로 맞추고, 넣지 않을 것의 문장은 버린다');
  assert.deepEqual(cleanAdlib([{ title: '첫째', points: [], worth: false, add: [] }, 'x'], 3), [{ title: '첫째', points: [], worth: false, add: [] }, null, null], '배열만, 번호 없으면 차례로, 빠진 것은 null');
  assert.deepEqual(cleanAdlib({ items: [{ n: 5, title: '없는 번호' }, { n: 1, title: '첫째' }] }, 2), [{ title: '첫째', points: [], worth: false, add: [] }, null], '번호가 있는데 다르면 차례로 쓰지 않는다');
  assert.throws(() => cleanAdlib({ items: [{ n: 1, title: 3 }] }, 1), /정리한 내용이 없어요/);
  assert.throws(() => parseAdlib('{"paras":[]}', 1), /애드리브 정리를 찾지/);
  assert.equal(parseAdlib('네.\n```json\n{"items":[{"n":1,"title":"제목","points":["점"],"worth":true,"add":["문장."]}]}\n```', 1)[0].add[0], '문장.', '붙여넣은 JSON');
  mock(ok(JSON.stringify({ items: [{ n: 1, title: '작년 경험', points: ['점'], worth: true, add: ['문장.'] }, { n: 2, title: '인사', points: [], worth: false, add: [] }] })));
  assert.equal((await summarizeAdlib(AD, { key: 'k' }))[1].title, '인사');
  const adb = JSON.parse(calls[0].init.body);
  assert.equal(adb.model, 'claude-opus-5-5'); assert.equal(adb.output_config.effort, 'low'); assert.equal(adb.fallbacks, 'default');
  assert.deepEqual(adb.output_config.format, { type: 'json_schema', schema: ADLIB_SCHEMA });
  assert.equal(adb.messages[0].content, adp.user, '보내는 글은 프롬프트 복사와 같다');

  // 발표 점검 코칭: 예시 대본으로 잰 기록을 보내도 대본 글은 한 조각도 들어가지 않는다
  const { readFileSync } = await import('node:fs');
  (await import('node:vm')).runInThisContext(readFileSync(new URL('./match.js', import.meta.url), 'utf8'));
  const { units } = await import('./shrink.js?v=14');
  const { readScript: readEx } = await import('./lib.js?v=14');
  const { buildRun, newAcc, tips: ruleTips } = await import('./check.js?v=14');
  const ex = readEx(readFileSync(new URL('./sample.livescript.json', import.meta.url), 'utf8'), 'sample.livescript.json');
  const SU = units(ex.text, [], t => norm(t).length), acc = newAcc(SU.length);
  acc.forEach((a, i) => Object.assign(a, { wall: 25 + 4 * i, talk: 23 + 3 * i, off: i === 2 ? 18 : 0, chars: SU[i].len[0] - 5, heard: SU[i].len[0] + 2 * i, anch: i % 3, gaps: i % 2 }));
  const aud = SU.map((_, i) => ({ st: [10 + i, 13 + 2 * i], p25: i, p1: i % 2, run: 6 + 2 * i }));
  const secInfo = SU.map(u => ({ w: ex.text.slice(u.s[0].a, u.s[0].a + 20), n: u.len[0], lv: 0 }));
  const cr = buildRun({ t0: 1760245500000, kind: 'practice', h: 'h1', target: 180, r0: 4.9, el: 260, pct: 100, lv: null, audio: { off: null, at: null }, acc, info: secInfo, aud, rd: [0, 1], ad: [0, 0, 2], cues: [['fast', 61]] });
  const prev = { ...cr, t0: 1, wall: 250 }, ct = ruleTips(cr, 180);
  assert.ok(ct.length >= 2 && cr.secs[0].w, '규칙 팁과 구간 첫 글이 있는 기록');
  const cp = coachPrompt(cr, prev, ct);
  assert.equal(cp.text, cp.system + '\n\n' + cp.user);
  const sn = norm(ex.text), pn = norm(cp.text);
  assert.ok(sn.length >= 1200, `예시 대본 ${sn.length}자`);
  for (let i = 0; i + 8 <= sn.length; i++) assert.ok(!pn.includes(sn.slice(i, i + 8)), `대본 글이 프롬프트에 들어감: ${sn.slice(i, i + 8)}`);
  assert.ok(cp.user.includes('목표: 180초') && cp.user.includes('구간 수: 8') && cp.user.includes('\n1 | 처음 | ') && cp.user.includes('\n8 | 끝 | ') && cp.user.includes('지난 기록 총 시간: 250초'));
  assert.ok(ct.every(t => cp.user.includes('- ' + t.text)), '규칙으로 찾은 것');
  assert.ok(cp.system.includes('감정은 재지 않는다') && cp.system.includes('±15%') && cp.system.includes('4.8~5.1') && cp.system.includes('5.7~6.0') && cp.system.includes('해요체') && cp.system.includes('"tips"'));
  assert.ok(!/undefined|NaN|null/.test(cp.text));
  assert.ok(coachPrompt({ ...cr, audio: null, secs: cr.secs.map(s => ({ ...s, st: null, p25: null, p1: null, run: null })) }, null, [], 0).user.includes('목표: 없음'), '목표와 분석이 없어도');
  // 중간에 멈춘 기록: 진행을 알리고, 읽지 않은 구간은 잰 값을 '-'로, 총 시간은 비교하지 않는다
  const part = { ...cr, pct: 26, secs: cr.secs.map((s, i) => i < 2 ? s : { ...s, wall: 0, talk: 0, off: 0, chars: 0, heard: 0, anch: 0, gaps: 0, st: null, p25: null, p1: null, run: null }) };
  const pu = coachPrompt(part, prev, [], 180).user;
  assert.ok(pu.includes('진행: 26%까지 읽고 멈춤') && pu.includes('지난 기록 총 시간: 비교 안 함') && cp.user.includes('진행: 끝까지 읽음'), '진행');
  assert.match(pu, /\n3 \| 처음 \| \d+ \| - \| \d+ \| - \| - \| - \| - \| - \| - \| -\n/, '읽지 않은 구간');
  assert.ok(cp.system.includes('읽지 않은 구간에는 팁을 쓰지 않는다'));
  assert.ok(!JSON.stringify(COACH_SCHEMA).match(/maxItems|minItems|minLength|maxLength|minimum|maximum/));
  const coach = { summary: '시간은 맞췄어요.', tips: [{ sec: 3, what: '3번 구간이 빨랐어요.', how: '문장 끝에서 한 박자 쉬어 보세요.' }] };
  assert.deepEqual(parseCoach('네, 코칭 결과입니다.\n```json\n' + JSON.stringify(coach) + '\n```\n도움이 되길 바랍니다.', 8), coach, '코드 블록과 앞뒤 설명이 붙어도');
  const five = cleanCoach({ summary: '가'.repeat(300), tips: Array.from({ length: 5 }, (_, i) => ({ sec: i ? 99 : 2, what: ' 무엇 ' + i, how: '어떻게'.repeat(200) })) }, 8);
  assert.deepEqual([five.tips.length, five.tips[0].sec, five.tips[1].sec, five.tips[0].what, five.tips[0].how.length, five.summary.length], [3, 2, 0, '무엇 0', 300, 200], '팁 3개, sec 99 → 0, 300자, summary 200자');
  assert.deepEqual(cleanCoach({ summary: '', tips: [{ sec: 1.5, what: '가', how: '나' }, { sec: 1, what: '', how: '나' }] }, 8).tips, [{ sec: 0, what: '가', how: '나' }], '빈 팁은 버림');
  assert.throws(() => cleanCoach({ summary: '요약', tips: [{ sec: 1, what: ' ', how: '' }] }, 8), /팁이 없어요/, '빈 팁만');
  assert.throws(() => parseCoach('{"summary":"x"}', 8), /코칭 내용을/);
  assert.throws(() => parseCoach('{"summary": "잘', 8), /JSON/);
  mock(ok(JSON.stringify(coach)));
  assert.deepEqual(await coachRun(cr, prev, ct, { key: 'k', goal: 240 }), coach);
  const cb = JSON.parse(calls[0].init.body);
  assert.deepEqual(cb.output_config.format, { type: 'json_schema', schema: COACH_SCHEMA });
  assert.equal(cb.output_config.effort, 'low'); assert.equal(cb.model, 'claude-opus-5-5'); assert.equal(cb.goal, undefined);
  assert.equal(cb.messages[0].content, coachPrompt(cr, prev, ct, 240).user, '보내는 글은 프롬프트 복사와 같다');

  console.log('claude.js ok');
}
