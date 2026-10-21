// 발표 점검: 연습을 재고 실시간 힌트를 정하는 순수 계산. 브라우저 API를 쓰지 않는다. node check.js 로 확인한다.
// 구간 기대 시간(C1), 들은 음절과 구간 누적(C4), 말 빠르기(C5), 높낮이·쉼(C6), 충돌 감시(C7), 힌트(C8), 말투 신호(C10), 결과 글(C11), 기록(C12).
// 시각(now, t)은 ms, 길이와 시간 값은 초, 빠르기는 초당 음절(정규화 글자), 높낮이는 55Hz 기준 반음.

// ---- 기준값 (한곳에 둔다. 학생 리허설 기록(기록 형식 9의 m 이벤트)으로 다시 맞춘다) ----
export const R0 = 5;  // app.js R0와 같은 기본 말 속도
// 기대 시간
export const TOL_S = 5, TOL_P = 0.15;  // ponytail: 구간 띠 ± max(5초, 15%). 구간 경계 오차 ±1~2초, 개인 빠르기 ±10%로 잡은 추정
export const OK_LO = 0.85, OK_HI = 15; // ponytail: 목표의 85% 이상, 목표 + 15초 이하면 목표 안(추정). 인식 경계 오차를 15초로 흡수
export const SPREAD = 0.1;            // 목표가 없으면 띠 = 글자 수 ÷ ((1 ± 0.1) × 시작 때 말 속도)
// 실시간 말 빠르기
export const FAST_ON = 5.8, FAST_OFF = 5.5, FAST_FOR = 10;  // ponytail: 뉴스 아나운서 5.7~6.0(최관해 외 2017) 근처, 0.3 히스테리시스. 추정
export const SLOW_ON = 3.5, SLOW_OFF = 3.8, SLOW_FOR = 20;  // ponytail: 자유 발화 약 4.2보다 낮게 잡은 추정
export const NEED_MAX = 5.8, SPARE = 30;  // 목표 안에 끝내려면 5.8 넘게 말해야 하거나 30초 넘게 여유면 '빠르게'를 내지 않는다(분량은 상태줄과 자동 줄이기)
export const RATE_WIN = 20, RATE_MIN = 10;  // ponytail: 말한 시간 20초 창, 10초 미만이면 재지 않음. 인식 결과 도착 시각 기반이라 ±10~15%
export const RING_STEP = 5, RING_SEC = 120;  // 5초마다 한 줄, 최근 2분
export const HOLD_START = 30, HOLD_MOVE = 3000, HOLD_END = 15, REC_GAP = 700;  // 판정하지 않는 때: 시작 뒤 30초, 손으로 옮긴 뒤 3초, 끝 15초 전, 인식기 꺼짐 700ms
// 타이머 한 번에 더하는 시간 상한(초). 창이 가려져 타이머가 늦어져도 실제 시각 차이로 더한다. 말하는 중(마지막 결과 뒤 3초 안)이면 65초까지:
// 탭이 5분 넘게 숨으면 Chrome이 타이머를 1분에 한 번으로 늦춘다. 아무 말이 없던 사이(기기 잠자기 뒤 첫 타이머)는 2초까지
export const DT_MAX = 65, DT_IDLE = 2;
// 결과 창 정도 낱말
export const PACE_SLOW = 4.0, PACE_FAST = 5.5, PACE_NEWS = 6.0, PACE_TALK = 8;  // ponytail: 1분에 240~330자가 보통(낭독 4.8~5.1). 구간 말한 시간 8초 이상만
export const NARROW = 5, WIDE = 10;  // ponytail: 높낮이 폭 5반음 미만 좁음, 10 넘음 넓음(반음 SD 2.0, 3.9). 한국어 규준이 없어 추정
export const LONG_RUN = 12;  // ponytail: 쉬지 않고 12초 넘게 말한 구간(낭독은 문장마다 약 2.8번 쉼). 추정
// 높낮이와 쉼. p10~p90 폭 ≈ 2.56 × 반음 SD(정규분포 가정). Hincks PVQ 0.15 ≈ 반음 SD 2.6 ≈ 폭 6.6반음
export const F_MIN = 70, F_MAX = 450, YIN_TH = 0.15, YIN_W = 0.02, SR16 = 16000;  // YIN 문턱 0.15(de Cheveigné & Kawahara 2002), 창 20ms
export const GAP_MS = 120;  // 프레임 사이가 이보다 벌어지면(타이머가 늦어짐) 진행 중인 쉼과 연속 발화를 끊는다
export const FLOOR_SEC = 30, FLOOR_Q = 0.05, FLOOR_UP = 1;  // 잡음 바닥: 최근 30초 모든 프레임 dB의 5백분위, 내려갈 때는 바로, 오를 때는 초당 1dB까지
export const SILENT = -100;  // 이보다 작은 프레임(샘플이 거의 0)은 마이크가 아직 소리를 주지 않는 것이라 바닥에 넣지 않는다
export const ON_DB = 10, OFF_DB = 6, OFF_MS = 200;  // 말소리 켬: 바닥 + 10dB 넘음, 끔: 바닥 + 6dB 아래가 200ms
export const MED = 5, RUN_MIN = 3, PARTS = 8;  // 높낮이 5프레임 중앙값, 3프레임보다 짧은 유성 구간은 버림. 쉼 끝은 프레임을 8조각(약 5ms)으로 나눠 잰다
export const P_SHORT = 0.25, P_LONG = 1, P_MAX = 3;  // 쉼: 0.25~1초 짧은 쉼, 1~3초 긴 쉼, 3초 넘으면 세지 않음(대본 밖 길이)
export const F0 = 55, BIN = 0.5, BINS = 96;  // 55Hz부터 0.5반음 칸 96개(880Hz까지)
export const VOICED_MIN = 75;  // 유성 3초(40ms 프레임 75개) 미만이면 높낮이 폭을 내지 않는다
// 목소리 크기·문장 끝 흐림·강조. dB는 잡음 바닥 위다(마이크 거리에 따라 달라서 같은 연습 안에서 비교한다. 자동 음량 보정은 끄고 받는다)
export const QUIET_DB = 6, LOW_VOL = 20;  // ponytail: 다른 구간 중앙값보다 6dB 넘게 작으면 작아짐, 바닥 위 20dB 미만이면 작게 들림. 노트북 마이크로 잡은 추정
export const TAIL_MS = 300, FALL_DB = 10, FALL_N = 25, FALL_P = 0.3;  // ponytail: 쉬기 직전 0.3초가 그 말 덩어리(앞부분 1초 이상) 중앙값보다 10dB 넘게 작으면 끝 흐림. 한국어 문장 끝의 자연스러운 내려감보다 크게 잡은 추정. 30% 넘으면 팁
export const JUMP = 1.2;  // ponytail: 구간 빠르기가 읽은 구간 중앙값의 1.2배를 넘으면 갑자기 빨라짐(인식 시각 오차 ±15%보다 크게). 추정
export const EMPH_DB = 1, EMPH_ST = 1, EMPH_MIN = 25;  // ponytail: 꼭 말할 문장의 p90이 다른 문장보다 1dB, 1반음 넘게 높지 않으면 강조가 약함(유성 1초 이상일 때만). 커서가 인식보다 약 1초 늦어 문장 앞머리가 앞 문장에 섞인다
export const WIN_SEC = 10, WIN_N = 3;  // ponytail: 실시간 높낮이 10초 창, 최근 유효 창 3개 평균(US11205418B2, 재확인 필요)
// 흐름(목소리 힘)·핵심 문장 강조·'크게'는 잡음 바닥 위가 아니라 원래 dBFS로 견준다(같은 연습 안 비교. 방 소음이 바뀌어도 흔들리지 않게, 브라우저 자동 음량 조절은 끄고 받는다)
export const E_DB = 3, E_ST = 1.5, E_WD = 2;  // ponytail: 구간 중앙값에서 크기 3dB, 높이 1.5반음, 높낮이 폭 2반음 넘게 벗어나야 '큼/작음'(추정). 빠르기는 오차가 커서 넣지 않는다
// ponytail: 한국어 초점은 낱말 크기 +1.4dB, 최고 F0 +1.3반음(Lee & Xu 2010), 1.5반음이면 두드러짐이 달라진다(Rietveld & Gussenhoven 1985).
// 노트북 마이크에서 10cm 다가가면 1.9dB라 그보다 크게 잡은 추정. 칸이 1dB, 0.5반음이라 그대로 ≥로 쓴다
export const KEY_DB = 2, KEY_ST = 1.5;
export const KEY_N = 50, KEYS = 20;  // 유성 2초(50프레임) 미만은 못 잼(1초면 p90이 셋째로 큰 프레임이라 한 번 튄 소리가 정한다), 핵심 문장 20개까지 기록
export const KEY_PRE = 0.5, KEY_PRE_X = 1.5, PRE_WIN = [2500, 300];  // ponytail: 앞 쉼 ≥ max(0.5초, 이번 쉼 중앙값 × 1.5). 낭독은 문장마다 쉬므로 그냥 쉼은 단서가 아니다. 커서가 약 1초 늦어 [Ts-2.5초, Ts+0.3초]에 끝난 가장 긴 쉼
export const KEY_DW = 1.2, KEY_CH = 15, KEY_SAID = 0.5;  // ponytail: 글자당 머문 시간이 다른 문장 중앙값의 1.2배 넘으면 천천히(15자 이상만), 받아 적은 말에 절반 넘게 없으면 빼먹은 것 같음
export const DRIFT = 6;  // 잡음 바닥 p90-p10이 6dB 넘으면 마이크 음량이 바뀐 것으로 보고 dB 비교를 하지 않는다(OS·드라이버 음량 조절은 브라우저가 끄지 못한다)
export const LOUD_SEC = 60, QUIET_FOR = 10, QUIET_OFF = 4;  // '크게': 유성 60초가 찬 뒤, 10초 창 중앙값이 이번 중앙값보다 6dB(QUIET_DB) 넘게 작은 것이 10초 이어지면. 4dB 안으로 오면 끈다
export const LAG = 1000;  // 녹음 듣기는 문장 표시 시각보다 1초 앞에서(커서가 말보다 약 1초 늦다)
// 실시간 힌트(초)
export const CUE_GAP = { practice: 20, live: 60 }, CUE_SAME = { practice: 60, live: 180 }, READ_SAME = 180, BRIGHT = 6;  // Rhema 20초(재확인 필요)
// '말하듯이'
export const READ_WIN = 60, READ_P = 0.95, FLAT = 5;  // ponytail: 최근 말한 60초, 대본 그대로 95% 이상, 높낮이 창 폭 5반음 미만. 약한 신호, 추정
// 충돌 감시
export const W_SPEECH = 2, W_REC = 3, W_HEARD = 6, W_AUD = 2, W_ZERO = 2, BLOCK_MS = 5000;
// 인식기 굶음은 1초 칸이 8개 찬 뒤에만 본다. 시작하자마자 말하고 첫 결과가 네트워크 때문에 늦게 오면(3~5초) 충돌로 보고 막힘을 적었다(흉내로 확인)
export const W_WIN = 8;
// 기록
export const RUN_TALK = 20, RUNS = 20, REC_MAX = 12000;  // 말한 시간 20초 미만은 잘못 누른 시작, 대본마다 최근 20회(회차 그래프), 하나 12000자 미만(핵심 문장·AI 고칠 점이 들어도 30구간이 남게)
// ponytail: 98% 넘게 읽었으면 끝까지 간 것으로 본다(마지막 문장을 인식하지 못했거나 확정 결과가 정지 뒤에 옴). 20% 미만이면 끝까지 걸릴 시간을 어림하지 않는다
export const DONE_P = 98, PROJ_P = 20;

// ---- 모드 ----
export const MODES = ['read', 'practice', 'live'], KINDS = [...MODES, 'mixed'];
export const NAME = { read: '리딩', practice: '연습', live: '실전', mixed: '여러 모드' };
export const modeOf = v => MODES.includes(v) ? v : 'live';  // sessionStorage ls.coach. 없거나 틀리면 실전
export const micIdle = m => '● ' + (m === 'read' || m === 'practice' ? NAME[m] : '시작');
export const mixKind = (kind, mode) => !kind || kind === mode ? mode : 'mixed';  // 같은 발표를 다른 모드로 이어 하면 섞임

// ---- 글 ----
export const mmss = s => { s = Math.max(0, Math.round(s) || 0); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
export const perMin = r => `1분에 약 ${Math.round(r * 6) * 10}자`;
export const paceWord = r => r < PACE_SLOW ? '느림' : r <= PACE_FAST ? '보통' : '빠름';
export const pitchWord = w => w < NARROW ? '좁음' : w <= WIDE ? '보통' : '넓음';

// ---- 구간과 기대 시간 ----
// 구간은 자동 줄이기 단위(shrink.js units, 발표 준비가 없으면 units(text, [], spoken)). 보이는 문장 → 구간. lv: 자동 줄이기 단계(없으면 모든 문장)
export const secMap = (SU, lv) => SU.flatMap((u, i) => u.s.filter(x => !lv || x.top >= lv[i]).map(() => i));
// 지금 위치의 문장: 마지막으로 읽기 시작한 어절의 문장(처음이면 첫 문장). 문단 끝까지 읽고 대본 밖 말을 하면 그 시간은
// 방금 읽은 구간에 든다(애드리브의 '앞 문장'과 같다). words: app.js build()의 [{ s, n0 }]
export const sentAt = (words, cur) => (words.findLast(w => w.n0 < cur) ?? words[0])?.s ?? 0;

// 구간마다 { n, b: 기대 초 | null, lo, hi }. ns: 구간 글자 수, goal: 목표 초(0이면 없음), r0: 발표를 시작할 때의 말 속도
// 목표가 있으면 글자 수 비율로 나눈다. 누적값을 반올림해서 합이 목표와 같고 음수가 없다.
export function bands(ns, goal, r0) {
  const N = ns.reduce((x, y) => x + y, 0) || 1, r = r0 > 0 ? r0 : R0;
  let c = 0;
  return ns.map(n => {
    if (!goal) return { n, b: null, lo: n / ((1 + SPREAD) * r), hi: n / ((1 - SPREAD) * r) };
    const b = Math.round(goal * (c + n) / N) - Math.round(goal * c / N), t = Math.max(TOL_S, TOL_P * b);
    c += n;
    return { n, b, lo: Math.max(0, b - t), hi: b + t };
  });
}
export const expect = (SU, lv, goal, r0) => bands(SU.map((u, i) => u.len[lv?.[i] ?? 0]), goal, r0);
export const judge = (wall, e) => wall > e.hi ? `기대보다 ${mmss(Math.max(1, wall - e.hi))} 넘음` : wall < e.lo ? `기대보다 ${mmss(Math.max(1, e.lo - wall))} 짧음` : '기대 안';
export function totalText(sum, goal) {
  if (!goal) return '';
  return sum > goal + OK_HI ? `목표보다 ${mmss(sum - goal)} 길어요` : sum < OK_LO * goal ? `목표보다 ${mmss(goal - sum)} 짧아요` : `목표 ${mmss(goal)} 안에 들어왔어요`;
}

// ---- 들은 음절과 구간 누적 ----
// 들은 음절: 세션마다 확정 길이 합(base) + 지금 결과 길이의 최댓값. 중간 결과가 줄었다 늘어도(5→3→6) 두 번 세지 않는다.
export const newHear = () => ({ n: 0, base: 0 });
export function hearStep(st, len) { const n = Math.max(st.n, st.base + len), d = n - st.n; st.n = n; return d; }
export function hearReset(st, len) { st.base += len; }  // 인식 세션이 바뀔 때, 결과를 비우기 전에
export const readHear = v => ({ n: num(v?.n), base: num(v?.base) });

const ACC = ['wall', 'talk', 'off', 'chars', 'heard', 'anch', 'gaps'];
export const newAcc = k => Array.from({ length: k }, () => Object.fromEntries(ACC.map(x => [x, 0])));
// 500ms 타이머: 실제 시각 차이 dt(초)만큼 그 구간의 걸린 시간, 말한 시간(마지막 결과 뒤 3초 안), 대본 밖 시간을 더한다
export function tickAcc(acc, s, dt, { talk, off }) {
  const a = acc[s];
  if (!a) return;
  dt = Math.min(talk ? DT_MAX : DT_IDLE, Math.max(0, dt));
  a.wall += dt;
  if (talk) a.talk += dt;
  if (off) a.off += dt;
}
export const packAcc = acc => acc.map(a => ACC.map(x => Math.round(a[x] * 10) / 10));  // ls.talk에: 구간마다 숫자 7개
export const readAcc = (v, k) => Array.isArray(v) && v.length === k ? v.map(r => Object.fromEntries(ACC.map((x, j) => [x, num(r?.[j])]))) : null;

// ---- 말 빠르기 ----
// ring: 5초마다 [말한 초, 들은 음절, 따라간 글자, 키워드 이동, 애드리브 수]를 넣고 최근 2분만 둔다. 빠르기와 '말하듯이'가 같이 쓴다.
export function ringPush(w, row) { w.push(row); if (w.length > RING_SEC / RING_STEP + 1) w.shift(); return w; }
// 말한 시간 기준 최근 20초 창의 들은 음절 ÷ 말한 시간. 창 안 말한 시간이 10초 미만이면 null.
// 진도(따라간 글자)는 다시 읽거나 바꿔 말하면 낮게 나와서 쓰지 않는다.
export function speechRate(w) {
  const L = w.at(-1), E = L && w.find(r => L[0] - r[0] <= RATE_WIN);
  return E && L[0] - E[0] >= RATE_MIN ? (L[1] - E[1]) / (L[0] - E[0]) : null;
}
// 판정하지 않는 때(판정과 지속 시간을 멈춘다). now, lastMove, recOff는 ms, rest는 남은 글자
export const paceHold = ({ sec, off, qa, now, lastMove, rest, r0, recOn, recOff }) =>
  sec < HOLD_START || !!off || !!qa || now - lastMove < HOLD_MOVE || rest / (r0 > 0 ? r0 : R0) < HOLD_END || (!recOn && now - recOff > REC_GAP);
// 5초마다. 빠름: 5.8 넘음이 10초 이어지면 켜고 5.5 아래면 끈다. 느림: 3.5 아래가 20초 이어지면 켜고 3.8 위면 끈다.
// st.f, st.s: 조건이 이어진 초(-1이면 조건 아님). hold나 r 없음이면 멈춘다(그 사이는 세지 않음).
// ctx = { hold, goal: 목표 초(0이면 없음), sec: 경과 초, rest: 남은 글자, d: 상태줄 차이(초, -면 여유) }. 반환 'fast' | 'slow' | null
export const newPace = () => ({ fast: false, slow: false, f: -1, s: -1, t: null });
export function paceStep(st, r, now, ctx = {}) {
  const out = () => st.fast ? 'fast' : st.slow ? 'slow' : null;
  if (ctx.hold || r == null) { st.t = null; return out(); }
  const dt = st.t == null ? 0 : (now - st.t) / 1000, left = ctx.goal ? ctx.goal - ctx.sec : Infinity;
  const block = ctx.goal > 0 && (left <= 0 || ctx.rest / left >= NEED_MAX || ctx.d <= -SPARE);
  st.t = now;
  st.f = r > FAST_ON ? (st.f < 0 ? 0 : st.f + dt) : -1;
  st.s = r < SLOW_ON && !block ? (st.s < 0 ? 0 : st.s + dt) : -1;
  if (st.f >= FAST_FOR) st.fast = true;
  if (r < FAST_OFF) st.fast = false;
  if (st.s >= SLOW_FOR) st.slow = true;
  if (r > SLOW_OFF || block) st.slow = false;
  return out();
}
// '크게'(연습만). 5초마다 frames().live()의 { vol: 최근 10초 유성 원 dB 중앙값, base: 이번 발표 유성 중앙값, vsec: 유성 초 }를 넣는다.
// 이번 중앙값보다 6dB 넘게 작은 것이 10초 이어지면 켜고 4dB 안으로 오면 끈다. 유성 60초 전, dB를 믿지 못함(nodb),
// 차분하게 말할 구간(calm: 발표 준비의 힘 1)이면 끈다. hold면 멈춘다(보이던 것은 둔다). 반환 켜졌나
export const newQuiet = () => ({ on: false, f: -1, t: null });
export function quietStep(st, v, now, ctx = {}) {
  if (ctx.hold) { st.t = null; return st.on; }
  if (!v || v.vol == null || v.base == null || v.vsec < LOUD_SEC || ctx.nodb || ctx.calm) { Object.assign(st, newQuiet()); return false; }
  const dt = st.t == null ? 0 : (now - st.t) / 1000, d = v.base - v.vol;
  st.t = now;
  st.f = d > QUIET_DB ? (st.f < 0 ? 0 : st.f + dt) : -1;
  if (st.f >= QUIET_FOR) st.on = true;
  if (d < QUIET_OFF) st.on = false;
  return st.on;
}
// 5초마다 기록 { m }: [빠르기 × 10, 높낮이 창 폭 × 10, 최근 연속 발화 최장 초]. 없으면 null
export const mRow = (r, flat, run) => [r == null ? null : Math.round(r * 10), flat == null ? null : Math.round(flat * 10), run == null ? null : Math.round(run * 10) / 10];

// ---- '말하듯이' ----
// 말한 시간 기준 최근 60초: 대본 그대로(따라간 글자 ÷ 들은 음절) 95% 이상, 키워드 이동 0, 새 애드리브 0, 목소리 분석 켬, 높낮이 창 평균 폭 5반음 미만.
// 말한 시간이 60초 미만이거나 분석이 꺼져 있으면 false(분석 없는 판정은 하지 않는다). 기준은 절대값이고 본인 기준은 쓰지 않는다.
export function readSignal(w, flatW, audioOn) {
  const L = w.at(-1), E = L && w.findLast(r => L[0] - r[0] >= READ_WIN);
  if (!E || !audioOn || flatW == null) return false;
  const dh = L[1] - E[1];
  return dh > 0 && (L[2] - E[2]) / dh >= READ_P && L[3] === E[3] && L[4] === E[4] && flatW < FLAT;
}

// ---- 실시간 힌트 ----
// 한 번에 하나. 연습: 천천히·빠르게·말하듯이(빠르기가 먼저), 실전: 천천히와 말하듯이(분석을 켰을 때만 참)만, 처음부터 흐림. 리딩이나 끄면 없음.
// 실전에서 상태줄이 '초과'인데 자동 줄이기가 꺼져 있으면 '천천히'를 내지 않는다(서로 반대 말).
// 간격: 힌트를 지운 뒤 연습 20초·실전 60초, 같은 힌트는 보인 때부터 연습 60초·실전 180초('말하듯이'는 180초). 조건이 풀리면 바로 지운다('좋아요' 없음).
// hold: 새 힌트를 내지 않음(보이던 것은 둠). hide(대본 밖, 질의응답, 편집, 듣지 않음, 인식기 꺼짐): 바로 지움.
// '크게'(quiet)는 연습에서만, 빠르기 다음 차례다(빠르게 > 천천히 > 크게 > 말하듯이).
// inp = { mode, on, pace, quiet, read, late, shrinkOn, hold, hide }. 500ms마다 불러도 된다(판정 입력은 5초마다 바뀐다). 반환 { k, word, dim } | null
export const WORD = { fast: '천천히', slow: '빠르게', quiet: '크게', read: '말하듯이' };
export const newCue = () => ({ k: null, at: 0, end: -Infinity, last: {} });
export function cueStep(st, inp, now) {
  const live = inp.mode === 'live';
  const want = k => k === 'fast' ? inp.pace === 'fast' && !(live && inp.late && !inp.shrinkOn) : k === 'slow' ? !live && inp.pace === 'slow' : k === 'quiet' ? !live && !!inp.quiet : !!inp.read;
  const clear = () => { if (st.k) { st.k = null; st.end = now; } return null; };
  if (!MODES.includes(inp.mode) || inp.mode === 'read' || !inp.on || inp.hide) return clear();
  if (st.k && !want(st.k)) clear();
  if (!st.k && !inp.hold) {
    const k = ['fast', 'slow', 'quiet', 'read'].find(want), same = (k === 'read' ? READ_SAME : CUE_SAME[inp.mode]) * 1000;
    if (k && now - st.end >= CUE_GAP[inp.mode] * 1000 && !(now - st.last[k] < same)) { st.k = k; st.at = st.last[k] = now; }
  }
  return st.k && { k: st.k, word: WORD[st.k], dim: live || now - st.at >= BRIGHT * 1000 };
}

// ---- 높낮이와 쉼 (마이크 프레임) ----
// 약 16kHz로 줄인다(k개씩 평균). 48kHz → 16kHz, 44.1kHz → 14.7kHz. yin에는 돌려준 sr을 넘긴다.
export function down(buf, sr) {
  const k = Math.max(1, Math.round(sr / SR16)), x = new Float32Array(Math.floor(buf.length / k));
  for (let i = 0; i < x.length; i++) { let s = 0; for (let j = 0; j < k; j++) s += buf[i * k + j]; x[i] = s / k; }
  return { x, sr: sr / k };
}
export function db(x) { let s = 0; for (const v of x) s += v * v; return 20 * Math.log10(Math.sqrt(s / (x.length || 1)) + 1e-9); }
// YIN(de Cheveigné & Kawahara 2002): 누적 평균으로 정규화한 차이가 문턱 아래로 처음 내려간 골, 포물선 보간. 없으면 null(무성)
export function yin(x, sr, { min = F_MIN, max = F_MAX, th = YIN_TH } = {}) {
  const W = Math.round(YIN_W * sr), t0 = Math.max(2, Math.floor(sr / max)), t1 = Math.min(Math.ceil(sr / min), x.length - W - 2);
  if (t1 <= t0) return null;
  const d = new Float64Array(t1 + 2);
  d[0] = 1;
  for (let t = 1, sum = 0; t <= t1 + 1; t++) {
    let s = 0;
    for (let j = 0; j < W; j++) { const v = x[j] - x[j + t]; s += v * v; }
    sum += s;
    d[t] = sum ? s * t / sum : 1;
  }
  for (let t = t0; t <= t1; t++) {
    if (d[t] >= th) continue;
    while (t < t1 && d[t + 1] < d[t]) t++;
    const a = d[t - 1], b = d[t], c = d[t + 1], q = a - 2 * b + c;
    return sr / (t + (q > 0 ? (a - c) / (2 * q) : 0));
  }
  return null;
}
// 히스토그램의 q 백분위(칸 가운데, 반음). 비었으면 null
export function pct(h, q) {
  let n = 0, a = 0;
  for (const c of h) n += c;
  if (!n) return null;
  for (let i = 0; i < h.length; i++) if ((a += h[i]) >= q * n) return i * BIN + BIN / 2;
}
const semi = f => 12 * Math.log2(f / F0);
const binOf = p => Math.min(BINS - 1, Math.max(0, Math.floor(p / BIN)));
const median = a => { const s = [...a].sort((x, y) => x - y), h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
const width = ps => { const h = new Uint16Array(BINS); for (const p of ps) h[binOf(p)]++; return pct(h, 0.9) - pct(h, 0.1); };
const tot = h => h.reduce((a, b) => a + b, 0);
const dbq = (h, q) => { const n = tot(h); for (let i = 0, a = 0; i < h.length; i++) if ((a += h[i]) >= q * n) return i; return null; };  // 1dB 칸 히스토그램의 q 백분위
const DBS = 81;  // 바닥 위 0~80dB

// 40ms마다 마이크 프레임(AnalyserNode 2048샘플)을 넣는다. k: 구간 수
// push(x, sr, t, s, key, sid, off): x 원래 샘플, t 프레임 끝 시각(ms, performance.now()), s 지금 구간, key 지금 문장이 꼭 말할 문장인가,
//   sid 지금 문장 번호(문장별 강조를 잴 때), off 대본 밖인가(대본 밖 말은 꼭 말할 문장에 넣지 않는다). 반환 { db, f: 높낮이 Hz | null, v: 유성음, on: 말소리, floor }
// 쉼 = 다음 말소리 시작 - 마지막으로 바닥 + 6dB를 넘은 때. 200ms 대기는 말소리를 끌 때만 쓰고 길이에는 넣지 않는다.
// 시작과 끝은 프레임을 8조각(약 5ms)으로 나눈 조각 시작 시각으로 잰다(40ms 프레임 시각으로 재면 0.25초 문턱 근처 쉼이 ±40ms 흔들린다).
// ponytail: 쉼 사이에 바닥 + 6dB를 넘는 잡음 조각이 끼면 쉼이 둘로 나뉜다(프레임으로 재도 같다). 교실 기록에서 잦으면 짧은 조각을 무시한다.
const NO_AUD = { st: null, p25: null, p1: null, run: null, vol: null, ends: null, fall: null, pm: null, rv: null };
const RAW = 121;  // 원 dBFS -120~0, 1dB 칸
const rawBin = e => Math.min(RAW - 1, Math.max(0, Math.round(e) + 120));
const minus = (a, ...bs) => a.map((v, i) => Math.max(0, bs.reduce((x, b) => x - b[i], v)));  // 히스토그램 빼기(칸마다 0 아래로 내리지 않는다)
export function frames(k) {
  const fq = [], fh = new Int32Array(121), hist = Array.from({ length: k }, () => new Uint16Array(BINS));
  const vn = new Array(k).fill(0), seen = new Array(k).fill(0), p25 = new Array(k).fill(0), p1 = new Array(k).fill(0), rn = new Array(k).fill(0);
  let floor = Infinity, tPrev = null, tFirst = null, on = false, loudT = null, prevLoud = false, gap = null, rise = null, runStart = null, sRun = 0, sGap = 0;
  let vr = [], vc = 0, win = [], vwin = [], flats = [], runs = [], seg = [];  // seg: 지금 말 덩어리의 프레임 [t, 바닥 위 dB], vwin: 최근 10초 유성 프레임 [t, 원 dB 칸]
  // 목소리 크기: 구간마다 유성 프레임의 바닥 위 dB. 강조: [다른 문장, 꼭 말할 문장]의 크기와 높낮이. 끝 흐림: 잰 문장 끝 수와 흐린 수
  const vh = Array.from({ length: k }, () => new Uint32Array(DBS)), kd = [new Uint32Array(DBS), new Uint32Array(DBS)], kp = [new Uint32Array(BINS), new Uint32Array(BINS)];
  const ends = new Array(k).fill(0), fall = new Array(k).fill(0);
  // 원 dB: 구간마다(rdh), 발표 전체(gh). 꼭 말할 문장마다(ks: sid → { s, dh, ph }). 쉼 목록 pz: [끝난 때, 길이 초]. 잡음 바닥 값(flh)
  const rdh = Array.from({ length: k }, () => new Uint32Array(RAW)), gh = new Uint32Array(RAW), ks = new Map(), pz = [], flh = new Uint32Array(RAW);
  const kOf = (sid, s) => { let o = ks.get(sid); if (!o) ks.set(sid, o = { s, dh: new Uint32Array(RAW), ph: new Uint32Array(BINS) }); return o; };
  const add = (p, t, s, key, sid) => { const h = hist[s], b = binOf(p); if (h[b] < 65535) h[b]++; vn[s]++; kp[+key][b]++; win.push([t, p]); if (sid != null) kOf(sid, s).ph[b]++; };
  const commit = m => { for (; vc < m; vc++) { const o = vr[vc]; add(median(vr.slice(Math.max(0, vc - 2), vc + 3).map(o => o.p)), o.t, o.s, o.key, o.ks); } };
  // 끝 흐림: 쉬기 직전 0.3초의 크기 중앙값이 그 말 덩어리 앞부분(말소리 프레임 1초 이상)보다 10dB 넘게 작았나. end: 말소리가 끝난 때
  const tailFall = (end, s) => {
    const a = seg.filter(f => f[0] <= end), body = a.filter(f => f[0] <= end - TAIL_MS && f[1] > OFF_DB).map(f => f[1]), tail = a.filter(f => f[0] > end - TAIL_MS).map(f => f[1]);
    seg = seg.filter(f => f[0] > end);
    if (body.length < FALL_N || !tail.length) return;
    ends[s]++;
    if (median(body) - median(tail) >= FALL_DB) fall[s]++;
  };
  const endVoiced = () => { if (vr.length >= RUN_MIN) commit(vr.length); vr = []; vc = 0; };
  const endRun = (end, s) => {
    if (runStart == null || end < runStart) return;
    const len = (end - runStart) / 1000;
    rn[s] = Math.max(rn[s], len); runs.push([end, len]);
  };
  function brk() {  // 프레임이 끊기면 진행 중인 쉼과 연속 발화를 끊는다(그 틈은 쉼으로 세지 않음)
    endRun(loudT, sRun); endVoiced(); seg = [];
    on = false; loudT = null; prevLoud = false; gap = null; rise = null; runStart = null;
  }
  return {
    push(x, sr, t, s = 0, key = false, sid = null, off = false) {
      s = Math.min(k - 1, Math.max(0, s));
      if (tPrev != null && t - tPrev > GAP_MS) brk();
      const dtF = tPrev == null ? 0 : (t - tPrev) / 1000;
      tPrev = t; tFirst ??= t; seen[s]++;
      // 잡음 바닥: 최근 30초 모든 프레임 dB의 5백분위(1dB 칸). 내려갈 때는 바로, 오를 때는 초당 1dB까지
      // 켜자마자 오는 0 샘플을 넣으면 바닥이 -120dB에 붙어 1분 가까이 쉼을 못 찾는다
      const e = db(x), i = Math.min(120, Math.max(0, Math.floor(e) + 120));
      if (e > SILENT) { fq.push([t, i]); fh[i]++; }
      while (fq.length && fq[0][0] < t - FLOOR_SEC * 1000) fh[fq.shift()[1]]--;
      if (fq.length) {
        let need = Math.ceil(FLOOR_Q * fq.length), b = 0;
        while ((need -= fh[b]) > 0) b++;
        floor = Math.min(b - 120, floor + FLOOR_UP * dtF);
      }
      if (floor < Infinity) { seg.push([t, e - floor]); if (seg.length > 1500) seg.shift(); }  // 1분까지
      if (floor < Infinity && t - tFirst > 3000) flh[rawBin(floor)]++;  // 처음 3초는 바닥이 아직 내려오는 중
      // 조각마다 바닥 + 6dB를 넘나: 말소리 끝(loudT)과 다시 시작한 때(rise), 그 사이 틈(gap)
      const n = x.length / PARTS, bd = x.length / sr * 1000 / PARTS;
      for (let j = 0; j < PARTS; j++) {
        const ts = t - (PARTS - j) * bd, loud = db(x.subarray(Math.round(j * n), Math.round((j + 1) * n))) > floor + OFF_DB;
        if (loud) {
          if (!prevLoud) { gap = loudT == null ? null : ts - loudT; rise = ts; sGap = sRun; }  // sGap: 쉼 앞 말소리의 구간
          loudT = ts; sRun = s;
        }
        prevLoud = loud;
      }
      // 말소리 켬·끔. 끈 뒤 다시 켜면 그 틈이 쉼이다. 0.25초 넘는 쉼은 연속 발화를 끊는다.
      if (!on && e > floor + ON_DB) {
        on = true;
        if (gap != null && gap >= P_SHORT * 1000) {
          if (gap <= P_MAX * 1000) { (gap < P_LONG * 1000 ? p25 : p1)[sGap]++; pz.push([rise, gap / 1000]); }
          endRun(rise - gap, sGap);
          tailFall(rise - gap, sGap);
          runStart = rise;
        }
        runStart ??= rise;
      } else if (on && loudT != null && t - (loudT + bd) >= OFF_MS) on = false;
      // 유성음 높낮이: 5프레임 중앙값, 3프레임보다 짧은 유성 구간은 버린다(2프레임 늦게 넣는다)
      const { x: y, sr: r } = down(x, sr), f = yin(y, r), v = f != null && e > floor + ON_DB;
      if (v) {
        const u = Math.min(DBS - 1, Math.max(0, Math.round(e - floor))), rb = rawBin(e), kk = key && sid != null && !off ? sid : null;
        vh[s][u]++; kd[+key][u]++; rdh[s][rb]++; gh[rb]++; vwin.push([t, rb]);
        if (kk != null) kOf(kk, s).dh[rb]++;
        vr.push({ p: semi(f), t, s, key, ks: kk }); if (vr.length >= RUN_MIN) commit(vr.length - 2);
      }
      else endVoiced();
      while (win.length && win[0][0] < t - WIN_SEC * 1000) win.shift();
      while (vwin.length && vwin[0][0] < t - WIN_SEC * 1000) vwin.shift();
      return { db: e, f, v, on, floor };
    },
    // 5초마다: 최근 10초 유성 프레임의 p10~p90 폭(유성 3초 미만 창은 버림), 최근 유효 창 3개 평균. run: 최근 10초 안에 끝났거나 이어지는 연속 발화 최장 초
    // vol: 최근 10초 유성 원 dB 중앙값(유성 3초 미만이면 null), base: 이번 발표 유성 원 dB 중앙값, vsec: 유성 초('크게' 판정)
    live(t) {
      if (win.length >= VOICED_MIN) { flats.push(width(win.map(w => w[1]))); if (flats.length > WIN_N) flats.shift(); }
      runs = runs.filter(r => r[0] >= t - WIN_SEC * 1000);
      while (vwin.length && vwin[0][0] < t - WIN_SEC * 1000) vwin.shift();
      const cur = runStart != null && loudT != null && loudT >= runStart ? (loudT - runStart) / 1000 : null;
      const rs = [...runs.map(r => r[1]), ...(cur == null ? [] : [cur])], gn = tot(gh);
      return { flat: flats.length ? flats.reduce((a, b) => a + b, 0) / flats.length : null, run: rs.length ? Math.max(...rs) : null,
        vol: vwin.length >= VOICED_MIN ? median(vwin.map(w => w[1])) - 120 : null, base: gn ? dbq(gh, 0.5) - 120 : null, vsec: gn * 0.04 };
    },
    // 구간마다 { st: [p10, p90] 반음 | null(유성 3초 미만), p25: 짧은 쉼, p1: 긴 쉼, run: 쉬지 않고 가장 길게 말한 초,
    //   vol: 유성 프레임 바닥 위 dB 중앙값 | null(유성 3초 미만), ends: 잰 문장 끝 수, fall: 그 가운데 흐린 수,
    //   pm: 유성 반음 중앙값, rv: 유성 원 dB 중앙값(둘 다 유성 3초 미만이면 null) }. 프레임이 없던 구간은 모두 null
    secs() {
      const cur = runStart != null && loudT != null && loudT >= runStart ? (loudT - runStart) / 1000 : 0;
      return hist.map((h, i) => seen[i] ? {
        st: vn[i] >= VOICED_MIN ? [pct(h, 0.1), pct(h, 0.9)] : null,
        p25: p25[i], p1: p1[i], run: Math.max(rn[i], i === sRun ? cur : 0),
        vol: tot(vh[i]) >= VOICED_MIN ? dbq(vh[i], 0.5) : null, ends: ends[i], fall: fall[i],
        pm: vn[i] >= VOICED_MIN ? pct(h, 0.5) : null, rv: tot(rdh[i]) >= VOICED_MIN ? dbq(rdh[i], 0.5) - 120 : null,
      } : { ...NO_AUD });
    },
    // 강조: 꼭 말할 문장과 다른 문장의 유성 프레임 p90 차이 { db, st: 반음, n: 꼭 말할 문장 유성 프레임 수 }. 어느 쪽이든 모자라면 null
    emph() {
      if (tot(kd[1]) < EMPH_MIN || tot(kp[1]) < EMPH_MIN || tot(kd[0]) < VOICED_MIN || tot(kp[0]) < VOICED_MIN) return null;
      return { db: dbq(kd[1], 0.9) - dbq(kd[0], 0.9), st: pct(kp[1], 0.9) - pct(kp[0], 0.9), n: tot(kd[1]) };
    },
    // 꼭 말할 문장마다 { sid, s: 구간, n: 유성 프레임 수, db: 원 dB p90 차이, st: 반음 p90 차이 }(n이 KEY_N 미만이면 db·st null).
    // 견주는 기준은 같은 구간의 다른 문장(그 구간의 꼭 말할 문장을 모두 뺀 것)이다. 위치에 따른 높이 차(문단 첫머리는 높고 끝은 낮다)를 줄인다.
    // 그 구간에 다른 문장이 유성 3초가 안 되면 발표 전체의 다른 문장으로 견준다
    keys() {
      const inSec = s => [...ks.values()].filter(o => o.s === s), all = [...ks.values()];
      return [...ks].map(([sid, o]) => {
        const n = tot(o.dh), ko = inSec(o.s);
        let bd = minus(rdh[o.s], ...ko.map(x => x.dh)), bp = minus(hist[o.s], ...ko.map(x => x.ph));
        if (tot(bd) < VOICED_MIN || tot(bp) < VOICED_MIN) { bd = minus(rdh.reduce((a, h) => a.map((v, i) => v + h[i]), new Uint32Array(RAW)), ...all.map(x => x.dh)); bp = minus(hist.reduce((a, h) => a.map((v, i) => v + h[i]), new Uint32Array(BINS)), ...all.map(x => x.ph)); }
        const ok = n >= KEY_N && tot(o.ph) >= KEY_N && tot(bd) >= VOICED_MIN && tot(bp) >= VOICED_MIN;
        return { sid, s: o.s, n, db: ok ? dbq(o.dh, 0.9) - dbq(bd, 0.9) : null, st: ok ? pct(o.ph, 0.9) - pct(bp, 0.9) : null };
      });
    },
    pauses: () => pz.slice(),  // [끝난 때(ms), 길이 초]. 0.25~3초 쉼
    // 잡음 바닥이 이번 발표 동안 움직인 폭(p90-p10 dB). 바닥 값이 3초어치 안 되면 null
    drift: () => tot(flh) < VOICED_MIN ? null : dbq(flh, 0.9) - dbq(flh, 0.1),
  };
}

// ---- 흐름(목소리 힘)과 꼭 말할 문장 강조 ----
// 감정은 재지 않는다. 같은 연습의 다른 구간과 견준 목소리 크기·높이·높낮이 폭으로 힘 있게 들렸는지 어림할 뿐이다.
// 구간마다 'high' | 'mid' | 'low' | null(잰 값이 둘 미만). 구간 중앙값과의 차이를 고정 바닥(E_DB, E_ST, E_WD)으로 나눠
// 둘 이상이 +1 넘으면 high, -1 아래면 low. 잰 구간이 셋 미만인 값은 쓰지 않는다. nodb(dB를 믿지 못함)면 크기를 빼고 나머지 둘이 같은 쪽이어야 한다
export function energy(S, nodb = false) {
  const F = [[s => s.rv, E_DB], [s => s.pm, E_ST], [s => s.st ? s.st[1] - s.st[0] : null, E_WD]].slice(nodb ? 1 : 0);
  const mid = F.map(([g]) => { const v = S.map(g).filter(x => x != null); return v.length >= 3 ? median(v) : null; });
  return S.map(s => {
    const d = F.map(([g, fl], j) => { const v = g(s); return v == null || mid[j] == null ? null : (v - mid[j]) / fl; }).filter(x => x != null);
    if (d.length < 2) return null;
    return d.filter(x => x >= 1).length >= 2 ? 'high' : d.filter(x => x <= -1).length >= 2 ? 'low' : 'mid';
  });
}
// 구간의 계획 힘(발표 준비의 e: 1 차분하게, 2 보통, 3 힘 있게). ps: 구간에 든 문단 [{ n: 글자 수, e }]. 글자가 가장 많은 문단의 값,
// 문단끼리 2 차이 나면(1과 3) null(정하지 않음)
export function secPe(ps) {
  const v = ps.filter(p => [1, 2, 3].includes(p.e));
  if (!v.length || Math.max(...v.map(p => p.e)) - Math.min(...v.map(p => p.e)) >= 2) return null;
  return v.reduce((a, b) => b.n > a.n ? b : a).e;
}
// 계획과 들은 힘이 두 칸 다를 때만: 'more'(힘 있게 말할 곳인데 작음), 'less'(차분하게 말할 곳인데 큼). 한 칸 차이는 어림이라 말하지 않는다
export const flowGap = (pe, lv) => pe === 3 && lv === 'low' ? 'more' : pe === 1 && lv === 'high' ? 'less' : null;
// 문장마다 커서가 머문 시간을 글자 수로 나눠 다른 문장(꼭 말할 문장이 아닌 것) 중앙값과 견준다. 15자 미만 문장은 재지 않는다.
// ev: [[시각 ms, sid | null(정지·질의응답)]] 문장이 바뀐 차례, end: 마지막 시각, len: Map(sid → 글자 수), keys: 꼭 말할 sid Set. 반환 Map(sid → 비)
// ponytail: 문장 끝 쉼과 대본 밖 말도 그 문장에 든다(다른 문장도 같으므로 견주기는 된다). 애드리브가 잦으면 대본 밖 시간을 뺀다
export function dwell(ev, end, len, keys) {
  const tot = new Map();
  ev.forEach(([t, sid], i) => { if (sid != null) tot.set(sid, (tot.get(sid) ?? 0) + (ev[i + 1]?.[0] ?? end) - t); });
  const per = sid => (len.get(sid) ?? 0) >= KEY_CH ? tot.get(sid) / len.get(sid) : null;
  const others = [...tot.keys()].filter(s => !keys.has(s)).map(per).filter(x => x != null);
  if (others.length < 3) return new Map();
  const m = median(others);
  return new Map([...keys].filter(s => tot.has(s) && per(s) != null).map(s => [s, per(s) / m]));
}
// 문장 앞 쉼(초): 커서가 문장에 든 때 ts 기준 [ts-2.5초, ts+0.3초]에 끝난 가장 긴 쉼의 길이, 없으면 0(문장 첫머리 쉼표 쉼이 앞 쉼을 덮지 않게). pz: frames().pauses()
export const prePause = (pz, ts) => Math.max(0, ...pz.filter(([e]) => e >= ts - PRE_WIN[0] && e <= ts + PRE_WIN[1]).map(p => p[1]));
export const pauseMid = pz => pz.length >= 5 ? median(pz.map(p => p[1])) : null;  // 이번 발표 쉼 길이 중앙값(쉼 5번 넘을 때)
// 꼭 말할 문장 판정. k = 기록 keys 한 줄 { db, st, n, pre: 앞 쉼 초 | null, dw: 머문 시간 비 | null, sd: 말한 비율 0~1 | null },
// o = { read: 그 구간을 읽었나, nodb, pzm: 이번 쉼 중앙값 }. 반환 { v, cues: 참인 단서, miss: 잴 수 있었는데 아닌 단서 }
// v: 'unread' 읽지 않음, 'skip' 빼먹은 것 같음, 'na' 못 잼(잴 수 있는 단서가 둘 미만), 'ok' 단서 2개 이상, 'weak'
export const CUES = ['pause', 'slow', 'loud', 'high'];
export function keyVerdict(k, { read = true, nodb = false, pzm = null } = {}) {
  const c = {
    pause: k.pre == null ? null : k.pre >= Math.max(KEY_PRE, KEY_PRE_X * (pzm ?? 0)),
    slow: k.dw == null ? null : k.dw >= KEY_DW,
    loud: nodb || k.db == null ? null : k.db >= KEY_DB,
    high: k.st == null ? null : k.st >= KEY_ST,
  };
  const cues = CUES.filter(x => c[x]), miss = CUES.filter(x => c[x] === false);
  const v = !read ? 'unread' : k.sd != null && k.sd < KEY_SAID ? 'skip' : cues.length + miss.length < 2 ? 'na' : cues.length >= 2 ? 'ok' : 'weak';
  return { v, cues, miss };
}
// 녹음 조각에서 has(표시)가 참인 첫 이어진 자리 { i: 조각 번호, from, to }(초). 조각 { ms: 길이, marks: [[ms, sid, 구간]] }(문장이 바뀐 때, sid는 정지·질의응답이면 null).
// 커서가 말보다 늦으므로 1초 앞에서 시작하고 끝도 1초 당긴다. 1.5초보다 짧으면 1.5초까지. 없으면 null
export function clip(segs, has) {
  for (const [i, g] of segs.entries()) {
    const m = g.marks, j = m.findIndex(x => x[1] != null && has(x));
    if (j < 0) continue;
    let e = j;
    while (e + 1 < m.length && m[e + 1][1] != null && has(m[e + 1])) e++;
    const nx = m[e + 1], tail = !nx || (nx[1] == null && g.ms - nx[0] < LAG);  // 정지 단추로 닫힌 끝은 커서 늦음이 없어 당기지 않는다
    const from = Math.max(0, m[j][0] - LAG), to = Math.min(g.ms, Math.max(from + 1500, tail ? g.ms : nx[0] - LAG));
    return { i, from: from / 1000, to: to / 1000 };
  }
  return null;
}

// ---- 목소리 분석 켜기와 충돌 감시 ----
// 'desktop'(Windows·macOS·Linux·ChromeOS의 Chrome, Edge), 'mobile'(userAgentData가 있는 그 밖), 'other'(Safari, Firefox, iPhone·iPad).
// n: navigator, coarse: matchMedia('(pointer: coarse)').matches, ac: AudioContext가 있나. 시작할 때마다 부른다.
export function deviceKind(n, coarse, ac) {
  const u = n?.userAgentData;
  if (!u) return 'other';
  return !u.mobile && !/Android/.test(n.userAgent || '') && !coarse && !!n.mediaDevices?.getUserMedia && !!ac ? 'desktop' : 'mobile';
}
// 막힘 기록 키: 'Google Chrome 141'. GREASE 항목은 무시한다. 없으면 null
export function browserKey(n) {
  const bs = n?.userAgentData?.brands || [];
  for (const name of ['Google Chrome', 'Microsoft Edge', 'Chromium']) {
    const b = bs.find(x => x?.brand === name);
    if (b) return name + ' ' + String(b.version).split('.')[0];
  }
  return null;
}
// 목소리 분석 기본값. desktop에서 리딩·연습은 켬, 실전은 끔. user: ls.audio { r, l }(사용자가 바꾼 값), blocked: ls.audioBlock[키]가 있나
export const audioDefault = (kind, mode, user, blocked) => kind === 'desktop' && !blocked && (mode === 'live' ? user?.l === true : user?.r !== false);
// 1초마다 최근 8초(1초 칸 8개, 오래된 것부터)를 본다. win: [{ sp: 분석기 말소리 초, res: 인식 결과 수, hn: 늘어난 들은 음절, mx: 프레임 최대 dB, fl: 잡음 바닥, z: 샘플이 모두 0 }]
// x = { recOn, muted, ended }. 반환 null | 'rec?'(인식기 굶음 세 번 이어짐) | 'audio'(분석기 굶음 두 번 이어짐, 2초 무음 샘플) | 'lost'(트랙 muted, ended)
// 'lost'는 마이크를 뽑거나 장치에서 소리를 끈 것이라 인식기와 부딪친 것이 아니다. 분석만 끄고 막힘으로 적지 않는다
// 인식기는 건드리지 않는다. 앱은 분석만 끄고, 멈춘 인식기는 기존 '다시 듣기'가 맡는다.
export const newWatch = () => ({ r: 0, a: 0 });
export function watchdog(st, win, x = {}) {
  if (x.muted || x.ended) return 'lost';
  if (win.length >= W_ZERO && win.slice(-W_ZERO).every(b => b.z)) return 'audio';
  const sum = k => win.reduce((a, b) => a + (b[k] || 0), 0), fl = win.at(-1)?.fl ?? -Infinity;
  st.r = x.recOn && win.length >= W_WIN && sum('sp') > W_SPEECH && sum('res') === 0 ? st.r + 1 : 0;
  st.a = sum('hn') > W_HEARD && Math.max(...win.map(b => b.mx)) <= fl + OFF_DB ? st.a + 1 : 0;
  if (st.r >= W_REC) { st.r = 0; return 'rec?'; }
  if (st.a >= W_AUD) { st.a = 0; return 'audio'; }
  return null;
}
// 막힘 기록: 'audio'는 바로, 'rec?'는 분석을 끈 뒤 5초 안에 인식 결과가 다시 왔을 때만(분석을 끄자 풀림) 'rec'. 'lost', 'denied', 'qa'는 적지 않는다
export const blockOf = (why, offAt, resAt) => why === 'audio' ? 'audio' : why === 'rec?' && resAt > offAt && resAt - offAt <= BLOCK_MS ? 'rec' : null;
// 꺼진 이유. 'qa': 발표 중 질의응답에 다녀와 이어 읽었다(분석은 다음 마이크 시작에 다시 켠다)
const WHY = { 'rec?': '음성 인식이 멈춰서', audio: '분석기에 소리가 안 들어옴', lost: '마이크가 끊김', denied: '마이크를 열지 못함', qa: 'Q&A에 다녀옴' };
// 결과 창과 실전 뒤 편집 화면 안내에 같이 쓴다. 꺼지지 않았으면 ''. 시작하자마자 꺼졌으면(0초) 켜지 못한 것
export const audioNote = run => !run.audio?.off ? '' : run.audio.at ? `목소리 분석이 ${mmss(run.audio.at)}에 꺼져 그 뒤 높낮이·쉼·목소리 크기는 없어요(이유: ${WHY[run.audio.off]}).`
  : `목소리 분석을 켜지 못해 높낮이·쉼·목소리 크기는 재지 않았어요(이유: ${WHY[run.audio.off]}).`;

// ---- 기록 ----
// { v: 1, t0, kind, h: 대본 해시, target: 목표 초, r0, el: 상태줄 경과 초, wall, talk, off, chars, heard, anch, gaps, pct, lv: 자동 줄이기 단계 | null,
//   re: 발표 중 새로고침(그 앞 높낮이·쉼 빠짐), audio: null(분석 안 함) | { off: 'rec?' | 'audio' | 'lost' | 'denied' | 'qa' | null, at: 초 | null },
//   secs: [{ w: 첫 20자, n, lv, wall, talk, off, chars, heard, anch, gaps, st: [p10, p90] | null, p25, p1, run, rd: 말투 신호 수, ad: 애드리브 수, vol, ends, fall,
//     pm: 유성 반음 중앙값, rv: 유성 원 dB 중앙값(음수), pe: 발표 준비의 계획 힘 1~3 | null }],
//   emph: 꼭 말할 문장 강조 { db, st, n } | null,
//   keys: 꼭 말할 문장마다 [{ sid, s: 구간, w: 첫 20자, db, st, n, pre: 앞 쉼 초, dw: 머문 시간 비, sd: 말한 비율, r: 평가 기준 번호(0 없음) }] (20개까지),
//   nodb: dB 비교를 믿지 못함(자동 음량 조절이 켜졌거나 잡음 바닥이 6dB 넘게 움직임), pzm: 이번 쉼 중앙값 초, ph: 그때 발표 준비의 t, rh: 그때 평가 기준 해시, rec: 녹음했나,
//   cues: [[k, 초]], read: 말투 신호 수, ai: AI 코칭 | null }
const num = x => Number.isFinite(x) && x > 0 ? x : 0;
const r1 = x => Math.round(num(x) * 10) / 10, int = x => Math.round(num(x));
const opt = (x, f) => x == null ? null : f(x);
const str = (x, n) => typeof x === 'string' ? x.slice(0, n) : '';
const lvl = x => [1, 2].includes(x) ? x : 0;
const sg = x => Math.round((Number.isFinite(x) ? x : 0) * 10) / 10;  // 음수일 수 있는 값(강조 차이, 원 dB)
// AI 코칭 결과 { summary, tips: [{ sec, what, how }], edits?: 대본 고칠 점 [{ sec, why, from?, to?, how? }] } 검사(claude.js cleanCoach와 저장값이 같이 쓴다).
// 고칠 점은 대본 글 from을 to로 바꾸자는 것이다(why: 까닭). 옛 기록은 { what, how }(AI로 고치기 지시)라서 what을 why로 받는다.
// tips 3개, edits 2개까지. walls(구간마다 걸린 시간)를 주면 읽지 않은 구간의 고칠 점은 버린다. 팁도 고칠 점도 없으면 null. 고칠 점이 없으면 edits 키를 두지 않는다(옛 모양)
export function cleanAiCoach(o, k, walls = null) {
  const line = (s, n) => typeof s === 'string' ? s.normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, n) : '';
  const items = (v, n) => (Array.isArray(v) ? v : []).map(t => ({ sec: Number.isInteger(t?.sec) && t.sec >= 0 && t.sec <= k ? t.sec : 0, what: line(t?.what, 300), how: line(t?.how, 300) }))
    .filter(t => t.what && t.how).slice(0, n);
  const sec = v => Number.isInteger(v) && v >= 0 && v <= k ? v : 0;
  const edits = (Array.isArray(o?.edits) ? o.edits : []).map(t => ({ sec: sec(t?.sec), why: line(t?.why ?? t?.what, 120), from: line(t?.from, 200), to: line(t?.to, 300), how: line(t?.how, 300) }))
    .filter(t => t.why && ((t.from && t.to && t.from !== t.to) || t.how)).filter(t => !walls || !t.sec || walls[t.sec - 1] > 0).slice(0, 2)
    .map(t => Object.fromEntries(Object.entries(t).filter(([, v]) => v !== '')));  // 빈 칸은 저장하지 않는다
  const tips = items(o?.tips, 3);
  return tips.length || edits.length ? { summary: line(o.summary, 200), tips, ...(edits.length && { edits }) } : null;
}
// 저장할 때는 구간을 배열로 줄인다(키 이름을 빼면 30구간 기록이 8000자 안에 넉넉히 든다). 대본마다 sk('runs')에 저장하고 readRuns로 읽는다.
const SEC = ['w', 'n', 'lv', 'wall', 'talk', 'off', 'chars', 'heard', 'anch', 'gaps', 'st', 'p25', 'p1', 'run', 'rd', 'ad', 'vol', 'ends', 'fall', 'pm', 'rv', 'pe'];  // 새 값은 끝에 더한다(옛 기록은 null)
const KEY = ['sid', 's', 'w', 'db', 'st', 'n', 'pre', 'dw', 'sd', 'r'];
const arr = (o, ks) => { const a = ks.map(k => o[k]); while (a.length && a.at(-1) == null) a.pop(); return a; };  // 끝의 빈 값은 뺀다(목소리 분석 없는 기록)
const packRun = r => ({ ...r, secs: r.secs.map(s => arr(s, SEC)), ...(r.keys && { keys: r.keys.map(x => arr(x, KEY)) }) });
export const saveRuns = runs => JSON.stringify(runs.map(packRun));
// localStorage 값은 믿지 않는다: 모양이 틀리면 null, 숫자는 유한한 0 이상(아니면 0), 모르는 키는 버린다. 구간은 배열과 객체를 다 받는다.
export function cleanRun(o) {
  if (!o || typeof o !== 'object' || !Array.isArray(o.secs)) return null;
  const secs = o.secs.slice(0, 300).map(x => Array.isArray(x) ? Object.fromEntries(SEC.map((k, j) => [k, x[j]])) : x).map(s => ({
    w: str(s?.w, 20), n: int(s?.n), lv: lvl(s?.lv), wall: r1(s?.wall), talk: r1(s?.talk), off: r1(s?.off), chars: int(s?.chars), heard: int(s?.heard),
    anch: int(s?.anch), gaps: int(s?.gaps), st: Array.isArray(s?.st) && s.st.length === 2 && s.st.every(Number.isFinite) ? s.st.map(r1) : null,
    p25: opt(s?.p25, int), p1: opt(s?.p1, int), run: opt(s?.run, r1), rd: int(s?.rd), ad: int(s?.ad),
    vol: opt(s?.vol, r1), ends: opt(s?.ends, int), fall: s?.ends == null ? null : Math.min(int(s?.fall), int(s.ends)),
    pm: opt(s?.pm, r1), rv: opt(s?.rv, sg), pe: [1, 2, 3].includes(s?.pe) ? s.pe : null,
  }));
  const em = o.emph;
  const a = o.audio, r2 = x => Math.round(num(x) * 100) / 100;
  const keys = (Array.isArray(o.keys) ? o.keys : []).slice(0, KEYS).map(x => Array.isArray(x) ? Object.fromEntries(KEY.map((k, j) => [k, x[j]])) : x)
    .filter(x => Number.isInteger(x?.sid) && x.sid >= 0 && Number.isInteger(x.s) && x.s >= 0 && x.s < secs.length).map(x => ({
      sid: x.sid, s: x.s, w: str(x.w, 20), db: opt(x.db, sg), st: opt(x.st, sg), n: int(x.n), pre: opt(x.pre, r2), dw: opt(x.dw, r2),
      sd: opt(x.sd, v => Math.min(1, r2(v))), r: Number.isInteger(x.r) && x.r > 0 && x.r <= 10 ? x.r : 0,
    }));
  return {
    v: 1, t0: int(o.t0), kind: KINDS.includes(o.kind) ? o.kind : 'live', h: str(o.h, 16), target: int(o.target), r0: Math.round(num(o.r0) * 100) / 100, el: r1(o.el),
    wall: r1(o.wall), talk: r1(o.talk), off: r1(o.off), chars: int(o.chars), heard: int(o.heard), anch: int(o.anch), gaps: int(o.gaps), pct: Math.min(100, int(o.pct)),
    lv: Array.isArray(o.lv) ? o.lv.map(lvl) : null, re: o.re === true,
    audio: a && typeof a === 'object' ? { off: WHY[a.off] ? a.off : null, at: opt(a.at, r1) } : null,
    secs, cues: (Array.isArray(o.cues) ? o.cues : []).filter(c => Array.isArray(c) && WORD[c[0]]).slice(-50).map(c => [c[0], r1(c[1])]),
    read: int(o.read), ai: cleanAiCoach(o.ai, secs.length),
    emph: em && typeof em === 'object' && Number.isFinite(em.db) && Number.isFinite(em.st) ? { db: sg(em.db), st: sg(em.st), n: int(em.n) } : null,
    ...(keys.length && { keys }), ...(o.nodb === true && { nodb: true }), ...(o.pzm != null && { pzm: r2(o.pzm) }),
    ...(o.ph && { ph: int(o.ph) }), ...(typeof o.rh === 'string' && o.rh && { rh: str(o.rh, 16) }), ...(o.rec === true && { rec: true }),
  };
}
// 저장 모양이 12000자를 넘으면(구간이 50개 넘는 긴 대본) 힌트 기록, 꼭 말할 문장 첫 글, 구간 첫 글, AI 결과 순서로 뺀다.
// ponytail: 구간이 100개쯤 넘으면 그래도 넘는다. 그런 대본이 흔하면 구간을 더 크게 묶는다.
export function fitRun(r) {
  const big = () => JSON.stringify(packRun(r)).length >= REC_MAX;
  if (big()) r = { ...r, cues: [] };
  if (big() && r.keys) r = { ...r, keys: r.keys.map(x => ({ ...x, w: '' })) };
  if (big()) r = { ...r, secs: r.secs.map(s => ({ ...s, w: '' })) };
  if (big()) r = { ...r, ai: null };
  return r;
}
// 기록을 만든다. o = { t0, kind, h, target(초), r0, el, pct, lv, re, audio, acc: newAcc 값, info: [{ w, n, lv, pe }], aud: frames().secs() | null,
//   emph: frames().emph() | null, rd: 구간마다 말투 신호 수, ad: 구간마다 애드리브 수, cues, ai, keys, nodb, pzm, ph, rh }. 말한 시간이 20초 미만이면 null(저장하지 않음)
export function buildRun(o) {
  const sum = k => o.acc.reduce((x, a) => x + a[k], 0);
  if (sum('talk') < RUN_TALK) return null;
  const all = Object.fromEntries(ACC.map(k => [k, sum(k)]));
  const secs = o.info.map((x, i) => ({ ...x, ...o.acc[i], ...(o.aud?.[i] ?? NO_AUD), rd: o.rd?.[i] ?? 0, ad: o.ad?.[i] ?? 0 }));
  return fitRun(cleanRun({ ...o, ...all, secs, read: secs.reduce((x, s) => x + s.rd, 0) }));
}
export function readRuns(json) {
  let v;
  try { v = JSON.parse(json); } catch { return []; }
  return (Array.isArray(v) ? v : []).map(cleanRun).filter(Boolean).slice(-RUNS);
}
// 같은 발표(t0)면 바꿔 쓰고, 아니면 끝에 더한다. 최근 5회
export function upsertRun(runs, r) {
  r = fitRun(r);
  return runs.some(x => x.t0 === r.t0) ? runs.map(x => x.t0 === r.t0 ? r : x) : [...runs, r].slice(-RUNS);
}

// ---- 결과 창 글 ----
const nos = a => a.map(i => i + 1).join(', ');
export const PE = ['', '차분하게', '보통', '힘 있게'];  // 계획 힘(발표 준비의 e)
const rateOf = s => s.talk >= PACE_TALK ? s.heard / s.talk : null;
// 팁의 구간 목록. 읽은 구간(말한 시간 8초 이상)이 셋 넘게 모두 들어 있으면 번호를 늘어놓지 않는다
function secsOf(a, S) {
  const rd = S.flatMap((s, i) => rateOf(s) != null ? [i] : []);
  return rd.length > 2 && rd.every(i => a.includes(i)) ? (rd.length === S.length ? '모든 구간' : '읽은 모든 구간') : `${nos(a)}번 구간`;
}
export const finished = r => r.pct >= DONE_P;  // 끝까지 읽었나
// 끝까지 걸릴 시간: 끝까지 갔으면 걸린 시간, 20% 넘게 읽고 멈췄으면 이 빠르기로 어림, 아니면 null
const fullTime = r => finished(r) ? r.wall : r.pct >= PROJ_P ? r.wall * 100 / r.pct : null;
export function runLabel(r) {
  const d = new Date(r.t0), p = n => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())} · ${NAME[r.kind]} · ${mmss(r.wall)}` + (finished(r) ? '' : ` · ${r.pct}%까지`);
}
// 요약 줄. goal: 지금 목표 초(결과 창에서 바꿀 수 있다), prev: 고른 기록 바로 앞 기록(없으면 null)
// 끝까지 가지 않은 기록은 남은 대본을 읽지 않았으므로 '안에 들어왔어요'와 '짧아요'를 말하지 않고, 이 빠르기로 끝까지 가면 목표를 넘을 때만 말한다.
export function sumLines(run, prev, goal) {
  // 총 시간 비교는 둘 다 끝까지 갔을 때만(중간에 멈춘 기록과 비교하면 짧아졌다고 잘못 말한다). 구간 비교는 secRows가 한다
  const r = rateOf(run), d = prev ? run.wall - prev.wall : 0, full = finished(run), proj = full ? null : fullTime(run);
  const out = [[mmss(run.wall), full ? totalText(run.wall, goal) : `${run.pct}%까지 읽음`,
    !full && proj == null && goal && run.wall > goal + OK_HI && totalText(run.wall, goal),
    prev && full && finished(prev) && (Math.abs(d) < 1 ? '지난번과 같아요' : `지난번보다 ${mmss(Math.abs(d))} ${d > 0 ? '길어요' : '짧아요'}`)].filter(Boolean).join(' · ')];
  if (goal && proj > goal + OK_HI) out.push(`이 빠르기면 끝까지 약 ${mmss(proj)}로, 목표보다 ${mmss(proj - goal)} 길어요.`);
  if (r != null) out.push(`평균 빠르기 ${paceWord(r)} · 기준은 보통 낭독 빠르기(1분에 240~330자)`);
  const ads = run.secs.reduce((x, s) => x + s.ad, 0);
  out.push(`대본 밖 ${mmss(run.off)}` + (ads ? ` · 애드리브 ${ads}개` : ''));
  if (run.lv?.some(Boolean)) out.push('줄인 대본으로 읽었어요.');
  else if (run.lv && run.kind === 'read') out.push('리딩은 자동 줄이기 없이 쟀어요.');
  if (run.el > run.wall + 5) out.push(`멈춘 시간 ${mmss(run.el - run.wall)}은 빼고 쟀어요.`);
  if (run.re && run.audio) out.push('새로고침 전 높낮이·쉼은 빠졌어요.');
  if (audioNote(run)) out.push(audioNote(run));
  if (prev && prev.h !== run.h) out.push('대본이 바뀌어 구간은 비교하지 않아요.');
  return out;
}
// 결과 창 맨 위 숫자 카드(시안의 PracticeStats): 걸린 시간 / 말 빠르기 / 대본 밖. over: 목표를 넘었으니 해석을 주황으로
export function statCards(run, prev, goal) {
  const r = rateOf(run), d = prev ? run.wall - prev.wall : 0, full = finished(run), proj = full ? null : fullTime(run), ads = run.secs.reduce((x, s) => x + s.ad, 0);
  const note = [full ? totalText(run.wall, goal) : `${run.pct}%까지 읽음`,
    !full && proj == null && goal && run.wall > goal + OK_HI && totalText(run.wall, goal),
    prev && full && finished(prev) && (Math.abs(d) < 1 ? '지난번과 같아요' : `지난번보다 ${mmss(Math.abs(d))} ${d > 0 ? '길어요' : '짧아요'}`)].filter(Boolean).join(' · ');
  return [{ label: '걸린 시간', value: mmss(run.wall), note, over: !!goal && run.wall > goal + OK_HI },
    ...(r != null ? [{ label: '말 빠르기', value: String(Math.round(r * 60)), unit: ' 음절/분', note: paceWord(r) + (prev && rateOf(prev) != null ? (r > rateOf(prev) * 1.05 ? ' · 지난번보다 빨라졌어요' : r < rateOf(prev) * 0.95 ? ' · 지난번보다 느려졌어요' : ' · 지난번과 비슷해요') : ' · ' + perMin(r)) }] : []),
    { label: '대본 밖', value: mmss(run.off), note: ads ? `애드리브 ${ads}개` : '대본에 없는 말을 한 시간' }];
}
// 구간 블록: head '3 · 첫 20자…', time '1:00 · 기대보다 0:15 넘음 · 줄임'(걸린 시간이 없으면 '읽지 않음'), bar { lo, hi, b(목표 눈금, 목표가 없으면 null), wall, over, max }(초, 전체 폭 max),
// words: 정도 낱말(소수 없음), nums: '숫자 보기' 안 글(첫 줄은 막대 띠와 같은 기대 시간. 막대는 화면 읽기에서 빠지므로)
// 끝까지 가지 않은 기록에서 멈춘 구간(걸린 시간이 있는 마지막 구간)은 다 읽지 않았으므로 '짧음'을 붙이지 않는다.
// '반음은 피아노 건반 한 칸'은 결과 창 범례에 둔다(구간 하나만 열어도 보이게)
export function secRows(run, prev, goal) {
  const E = bands(run.secs.map(s => s.n), goal, run.r0), same = prev && prev.h === run.h && prev.secs.length === run.secs.length;
  const stopAt = finished(run) ? -1 : run.secs.findLastIndex(s => s.wall > 0), vm = volMid(run.secs), L = energy(run.secs, run.nodb);
  return run.secs.map((s, i) => {
    const e = E[i], r = rateOf(s), wd = s.st ? s.st[1] - s.st[0] : null, g = flowGap(s.pe, L[i]);
    const words = [r != null && '빠르기 ' + paceWord(r), wd != null && '높낮이 ' + pitchWord(wd), vm != null && s.vol != null && s.vol < vm - QUIET_DB && '목소리 작아짐',
      s.fall > 0 && `끝 흐림 ${s.fall}번`, s.off >= 1 && '대본 밖 ' + mmss(s.off),
      g ? (g === 'more' ? '힘 있게 말할 곳인데 차분하게 들림' : '차분하게 말할 곳인데 힘 있게 들림') : L[i] === 'high' ? '다른 구간보다 힘 있게 들림' : L[i] === 'low' && '다른 구간보다 차분하게 들림'].filter(Boolean).join(' · ');
    const nums = [
      `기대 ${mmss(e.lo)}~${mmss(e.hi)}`,
      s.pe && `발표 준비의 계획: ${PE[s.pe]}`,
      r != null && perMin(r),
      wd != null && `높낮이 폭 ${Math.round(wd)}반음`,
      s.p25 != null && `쉼 ${s.p25 + s.p1}번(1초 넘는 쉼 ${s.p1}번)`,
      s.run >= 1 && `쉬지 않고 가장 길게 ${Math.round(s.run)}초`,
      s.vol != null && `목소리 크기: 주변 소리보다 ${Math.round(s.vol)}dB 큼`,
      s.ends > 0 && `문장 끝 ${s.ends}번 가운데 ${s.fall}번 작아짐`,
      s.p25 == null && s.talk > 0 && `1.5초 넘게 멈춤 ${s.gaps}번`,  // 읽지 않은 구간에는 내지 않는다
      r > PACE_NEWS && '뉴스 아나운서(1분에 약 350자)보다 빨랐어요.',
      same && prev.secs[i].wall > 0 && `지난번 ${mmss(prev.secs[i].wall)}`,
    ].filter(Boolean);
    return {
      head: `${i + 1} · ${s.w}${s.w.length >= 20 ? '…' : ''}`,
      time: (s.wall ? mmss(s.wall) + (i === stopAt && s.wall < e.lo ? '' : ' · ' + judge(s.wall, e)) : '읽지 않음') + (s.lv ? ' · 줄임' : ''),
      bar: { lo: e.lo, hi: e.hi, b: e.b, wall: s.wall, over: s.wall > e.hi, max: Math.max(e.hi, s.wall) * 1.15 }, words, nums,
    };
  });
}
// '읽는 말투' 줄(연습·실전·여러 모드 기록만, 리딩은 []): 말투 신호 횟수와 구간, 대본 그대로 비율, 키워드 이동, 애드리브, 설명.
// 분석을 하지 않았거나 60초가 차기 전에 꺼졌으면 신호를 낼 수 없었으므로 통계만 둔다(그 까닭은 요약 줄이 이미 말한다).
export function toneLines(run) {
  const e = run.emph, sgn = x => { x = Math.round(x) || 0; return (x > 0 ? '+' : '') + x; };  // -0과 +0은 0
  const em = e && !run.keys?.length ? [`꼭 말할 문장은 다른 문장보다 소리 ${sgn(e.db)}dB, 높이 ${sgn(e.st)}반음이었어요.`] : [];  // 문장별 판정이 있으면 '꼭 말할 문장' 묶음이 말한다
  if (run.kind === 'read') return em;
  const rd = run.secs.flatMap((s, i) => s.rd ? [i] : []), sum = k => run.secs.reduce((x, s) => x + s[k], 0);
  const stat = `대본 그대로 ${run.heard ? Math.min(100, Math.round(run.chars / run.heard * 100)) : 0}% · 키워드로 따라감 ${run.anch}번 · 애드리브 ${sum('ad')}개`;
  if (!run.audio || (run.audio.off && run.audio.at < READ_WIN)) return [stat, ...em];
  return [rd.length ? `말투 신호 ${sum('rd')}번(${nos(rd)}번 구간)` : '말투 신호는 나오지 않았어요.', stat, ...em,
    '눈 맞춤은 잴 수 없어요. 대본과 똑같이, 높낮이 변화가 적게 읽으면 나오는 신호예요. 판정이 아니에요.'];
}
// '다음에 해 볼 것' n개(화면은 3개)까지, 이 순서로: 목표를 넘음, 빠른 구간, 꼭 말할 문장을 빼먹음, 꼭 말할 문장을 살리지 못함, 갑자기 빨라진 구간, 문장 끝 흐림,
// 작은 목소리, 계획과 다른 힘, 강조가 약함(문장별 판정이 없는 옛 기록만), 높낮이가 좁은 구간, 12초 넘게 쉬지 않은 구간, 말투 신호, 목표보다 짧음.
// 끝까지 가지 않았으면 '넘음'은 이 빠르기로 끝까지 간 어림으로 보고, '짧음'은 내지 않는다.
// 반환 [{ k, text }]. k 'over'이면 앱이 '자동 줄이기 켜기' 버튼을 붙인다(지금 대본으로 한 발표 준비가 있고 꺼져 있을 때).
// 구간 목소리 크기의 중앙값(잰 구간이 셋 넘을 때만. 적으면 비교하지 않는다)
const volMid = S => { const v = S.map(s => s.vol).filter(x => x != null); return v.length >= 3 ? median(v) : null; };
// 꼭 말할 문장마다 판정(keyVerdict). 읽지 않은 구간과, 끝까지 가지 않은 기록에서 멈춘 구간의 빼먹음은 '읽지 않음'이다(멈춘 뒤 문장일 수 있다).
// 목소리 분석을 하지 않은 기록은 말했는지만 본다('said')
const TODO = { pause: '그 문장 앞에서 한 박자 쉬어 보세요.', slow: '그 문장은 조금 천천히 말해 보세요.', loud: '그 문장은 조금 크고 높게 말해 보세요.', high: '그 문장은 조금 크고 높게 말해 보세요.' };
export function keyStates(run) {
  const stopAt = finished(run) ? -1 : run.secs.findLastIndex(s => s.wall > 0);
  return (run.keys ?? []).map(k => {
    const read = run.secs[k.s]?.wall > 0, x = keyVerdict(k, { read, nodb: run.nodb, pzm: run.pzm });
    if (x.v === 'skip' && k.s === stopAt) x.v = 'unread';
    if (!run.audio && (x.v === 'na' || x.v === 'weak' || x.v === 'ok')) x.v = 'said';
    return { ...k, ...x };
  });
}
// '꼭 말할 문장' 묶음: { sum: 요약 한 줄, rows: [{ ...판정, label, detail, todo }] }. 꼭 말할 문장이 없으면 null
export const KEY_LABEL = { ok: '살려 말했어요', weak: '더 살려 보세요', skip: '빼먹은 것 같아요', na: '못 쟀어요', unread: '읽지 않았어요', said: '말했어요' };
export function keyRows(run) {
  const K = keyStates(run);
  if (!K.length) return null;
  const c = v => K.filter(x => x.v === v).length, sgn = x => (x > 0 ? '+' : '') + Math.round(x * 10) / 10;
  const rows = K.map(k => {
    const d = [k.pre != null && (k.pre ? `앞 쉼 ${k.pre.toFixed(1)}초` : '앞 쉼 없음'), k.dw != null && `머문 시간 ${k.dw.toFixed(1)}배`,
      k.db != null && !run.nodb && `소리 ${sgn(k.db)}dB`, k.st != null && `높이 ${sgn(k.st)}반음`].filter(Boolean);
    const detail = k.v === 'skip' ? '받아 적은 말에 이 문장이 절반 넘게 없어요. 빼먹었거나 인식이 놓쳤을 수 있어요.'
      : k.v === 'na' ? (k.n < KEY_N ? '목소리가 2초 넘게 잡히지 않아 못 쟀어요.' : '잴 수 있는 단서가 둘이 안 돼 못 쟀어요.')
      : k.v === 'unread' || k.v === 'said' ? '' : d.join(' · ') + ` → 강조 단서 ${k.cues.length}개`;
    return { ...k, label: KEY_LABEL[k.v], detail, todo: k.v === 'weak' && k.miss.length ? TODO[k.miss[0]] : '' };
  });
  const meas = c('ok') + c('weak');
  const sum = !run.audio ? `꼭 말할 문장 ${K.length}개 가운데 ${c('said')}개를 말했어요.` + (c('skip') ? ` ${c('skip')}개는 빼먹은 것 같아요.` : '')
    : ((meas ? `꼭 말할 문장 ${meas}개 가운데 ${c('ok')}개를 살려 말했어요.` : c('unread') === K.length ? '꼭 말할 문장이 있는 구간까지 읽지 않았어요.'
      : K.some(x => x.v === 'na' && x.n < KEY_N) ? '꼭 말할 문장을 잴 만큼 목소리가 잡히지 않았어요.' : c('na') ? '꼭 말할 문장을 잴 단서가 모자랐어요.' : '')
      + (c('skip') ? ` ${c('skip')}개는 빼먹은 것 같아요.` : '')).trim();
  return { sum, rows };
}
export function tips(run, goal, n = 3) {
  const S = run.secs, E = bands(S.map(s => s.n), goal, run.r0), out = [], at = f => S.flatMap((s, i) => f(s, i) ? [i] : []);
  const full = finished(run), all = fullTime(run) ?? run.wall;
  if (goal && all > goal + OK_HI) {
    const d = mmss(all - goal), o = S.map((s, i) => s.wall - E[i].hi), w = o.indexOf(Math.max(...o));
    out.push({ k: 'over', s: [], text: rateOf(run) > PACE_FAST ? `빠르게 읽었는데도 ${full ? d + ' 넘었어요' : '끝까지 가면 ' + d + ' 넘어요'}. 대본을 줄이거나 자동 줄이기를 켜 보세요.`
      : `${full ? '' : '이 빠르기면 끝까지 '}목표보다 ${d} 길어요.` + (o[w] > 0 ? ` ${w + 1}번 구간이 가장 많이 넘었어요.` : '') });
  }
  const fast = at(s => rateOf(s) > PACE_FAST), flat = at(s => s.st && s.st[1] - s.st[0] < NARROW), rd = at(s => s.rd > 0);
  if (fast.length) out.push({ k: 'fast', s: fast, text: `${secsOf(fast, S)}이 빨랐어요. 문장 끝에서 한 박자 쉬어 보세요.` });
  const K = keyStates(run), meas = K.filter(x => x.v === 'ok' || x.v === 'weak'), weak = meas.filter(x => x.v === 'weak'), skip = K.filter(x => x.v === 'skip');
  if (skip.length) out.push({ k: 'key-skip', s: [...new Set(skip.map(x => x.s))], text: `${nos([...new Set(skip.map(x => x.s))])}번 구간에서 꼭 말할 문장을 빼먹은 것 같아요. 그 문장은 꼭 읽어 주세요.` });
  // 문장 하나의 판정은 틀릴 수 있어서, 잰 문장이 셋 넘고 절반 넘게 약할 때만 하나로 묶어 말한다
  if (meas.length >= 3 && weak.length * 2 >= meas.length) {
    const m = CUES.map(c => [c, weak.filter(x => x.miss.includes(c)).length]).sort((a, b) => b[1] - a[1])[0][0];
    out.push({ k: 'key-weak', s: [], text: `꼭 말할 문장 ${meas.length}개 가운데 ${weak.length}개를 다른 문장과 비슷하게 말했어요. ${TODO[m]}` });
  }
  const rates = S.map(rateOf).filter(r => r != null), mid = rates.length >= 3 ? median(rates) : null;
  const jump = mid ? at(s => rateOf(s) > JUMP * mid).filter(i => !fast.includes(i)) : [];
  if (jump.length) out.push({ k: 'jump', s: jump, text: `${secsOf(jump, S)}에서 다른 구간보다 갑자기 빨라졌어요. 구간이 바뀔 때 한 박자 쉬고 시작해 보세요.` });
  const ends = S.reduce((x, s) => x + (s.ends ?? 0), 0), fell = S.reduce((x, s) => x + (s.fall ?? 0), 0);
  if (fell >= 3 && fell >= FALL_P * ends) out.push({ k: 'fall', s: at(s => s.fall > 0), text: `문장 끝 ${ends}번 가운데 ${fell}번 소리가 작아졌어요(${secsOf(at(s => s.fall > 0), S)}). 마지막 낱말까지 또렷하게 말해 보세요.` });
  const vm = volMid(S), quiet = vm == null ? [] : at(s => s.vol != null && s.vol < vm - QUIET_DB);
  if (vm != null && vm < LOW_VOL) out.push({ k: 'low', s: [], text: '목소리가 주변 소리보다 크게 들리지 않았어요. 마이크에 가까이 가거나 조금 더 크게 말해 보세요.' });
  else if (quiet.length) out.push({ k: 'quiet', s: quiet, text: `${secsOf(quiet, S)}은 다른 구간보다 목소리가 작아졌어요. 처음과 같은 크기로 말해 보세요.` });
  const EN = energy(S, run.nodb), more = at((s, i) => flowGap(s.pe, EN[i]) === 'more'), less = at((s, i) => flowGap(s.pe, EN[i]) === 'less');
  if (more.length) out.push({ k: 'tone', s: more, text: `${secsOf(more, S)}은 힘 있게 말할 곳인데 다른 구간보다 차분하게 들렸어요. 조금 더 크고 높게 말해 보세요.` });
  else if (less.length) out.push({ k: 'tone', s: less, text: `${secsOf(less, S)}은 차분하게 말할 곳인데 다른 구간보다 힘 있게 들렸어요. 조금 낮추고 차분하게 말해 보세요.` });
  if (!K.length && run.emph && run.emph.db < EMPH_DB && run.emph.st < EMPH_ST) out.push({ k: 'emph', s: [], text: '꼭 말할 문장을 다른 문장과 비슷한 크기와 높이로 말했어요. 그 문장 앞에서 한 박자 쉬고 조금 크고 높게 말해 보세요.' });
  if (flat.length) out.push({ k: 'flat', s: flat, text: `${secsOf(flat, S)}은 높낮이 폭이 좁았어요. 강조할 낱말을 조금 높게 말해 보세요.` });
  const L = S.reduce((b, s, i) => (s.run ?? 0) > (S[b].run ?? 0) ? i : b, 0);
  if (S[L]?.run > LONG_RUN) out.push({ k: 'run', s: [L], text: `${L + 1}번 구간에서 ${Math.round(S[L].run)}초 동안 쉬지 않았어요. 쉼표에서 쉬어 보세요.` });
  if (rd.length) out.push({ k: 'read', s: rd, text: `${secsOf(rd, S)}은 대본 그대로, 고른 높낮이로 읽었어요. 한두 문장은 대본을 보지 않고 말해 보세요.` });
  if (goal && full && run.wall < OK_LO * goal) out.push({ k: 'short', s: [], text: `목표보다 ${mmss(goal - run.wall)} 짧아요. 천천히 읽거나 설명을 더해 보세요.` });
  return out.slice(0, n);
}
// 지난 연습의 고칠 점(화면에 보인 3개)이 이번에 나아졌나: [{ k, text: 지난번 글, v: 'done' 고쳤어요 | 'still' 아직이에요 | 'unread' 이번에 그 구간을 읽지 않음 }].
// 같은 종류의 팁이 이번에도 같은 구간(발표 전체 팁이면 그냥)에 나왔으면 아직이다. 대본 구간 수가 달라졌으면 종류만 본다
export function fixedTips(run, prev, goal) {
  if (!prev) return [];
  const now = tips(run, goal, 99), same = prev.secs.length === run.secs.length;
  return tips(prev, goal).map(t => {
    const n = now.find(x => x.k === t.k), read = !same || !t.s.length || t.s.some(i => run.secs[i]?.wall > 0);
    const still = !!n && (!same || !t.s.length || !n.s.length || n.s.some(i => t.s.includes(i)));
    return { k: t.k, text: t.text, v: still ? 'still' : read ? 'done' : 'unread' };
  });
}

// node check.js 로 실행하면 확인
if (import.meta.main ?? (typeof process === 'object' && process.argv[1]?.endsWith('check.js'))) {
  const assert = (await import('node:assert')).default;
  const { readFileSync } = await import('node:fs');
  (await import('node:vm')).runInThisContext(readFileSync(new URL('./match.js', import.meta.url), 'utf8'));
  const { units } = await import('./shrink.js?v=18');
  const { readScript } = await import('./lib.js?v=18');
  const len = t => norm(t).length;
  const near = (a, b, tol, m) => assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} (기대 ${b} ±${tol})`);

  // 1. 구간과 기대 시간 (예시 대본, 목표 3분)
  const ex = readScript(readFileSync(new URL('./sample.livescript.json', import.meta.url), 'utf8'), 'sample.livescript.json');
  const text = ex.text, SU = units(text, [], len);
  assert.equal(SU.length, 8, '예시 대본 8구간');
  const E = expect(SU, null, ex.target * 60, 5);
  assert.equal(E.reduce((x, e) => x + e.b, 0), 180, '기대 시간 합 = 목표');
  assert.ok(E.every(e => e.hi - e.b >= TOL_S && e.b - e.lo >= TOL_S), '띠 ± 5초 이상');
  const lines = text.split('\n\n').flatMap(p => p.match(/[^.?!]+[.?!]/g).map(x => x.trim())).join('\n');
  assert.equal(units(lines, [], len).length, 8, '한 줄 한 문장으로 바꿔도 8구간');
  assert.equal(units(text.replace(/\s*\n\s*/g, ' '), [], len).length, 4, '줄바꿈 없는 한 덩어리는 4구간');
  const SUt = units('발표 점검 기능 소개\n\n' + text, [], len);
  assert.equal(SUt.length, 8, '앞에 10자 제목 문단을 더해도 8구간');
  assert.equal(secMap(SUt)[0], 0, '제목 문장은 0번 구간');
  assert.equal(secMap(SU).length, SU.reduce((x, u) => x + u.s.length, 0));
  const E0 = expect(SU, null, 0, 5);
  assert.ok(E0.every(e => e.b === null && e.lo <= e.n / 5 && e.n / 5 <= e.hi), '목표 없으면 빠르기로 띠');
  const e3 = E[3], tol = e3.hi - e3.b;
  assert.match(judge(e3.b + tol + 1, e3), /^기대보다 0:01 넘음$/);
  assert.equal(judge(e3.b, e3), '기대 안');
  assert.match(judge(0.5, e3), /짧음$/);
  assert.equal(judge(60, { b: 40, lo: 34, hi: 46 }), '기대보다 0:14 넘음');
  assert.match(totalText(0.84 * 180, 180), /^목표보다 0:29 짧아요$/);
  assert.match(totalText(196, 180), /^목표보다 0:16 길어요$/);
  assert.equal(totalText(180, 180), '목표 3:00 안에 들어왔어요');
  assert.equal(totalText(180, 0), '');
  assert.deepEqual(bands([1, 1, 1], 10, 5).map(e => e.b), [3, 4, 3], '나머지는 누적 반올림으로 나눈다');
  assert.ok(bands(Array(40).fill(1).concat([0]), 20, 5).every(e => e.b >= 0), '작은 구간이 많아도 음수가 없다');
  // 자동 줄이기로 숨긴 문장은 빼고 센다
  assert.deepEqual(secMap([{ s: [{ top: 2 }, { top: 0 }] }, { s: [{ top: 1 }] }], [1, 1]), [0, 1]);
  assert.equal(sentAt([{ s: 0, n0: 0 }, { s: 1, n0: 5 }], 0), 0);
  assert.equal(sentAt([{ s: 0, n0: 0 }, { s: 1, n0: 5 }], 5), 0, '문장 끝까지 읽었으면 그 문장');
  assert.equal(sentAt([{ s: 0, n0: 0 }, { s: 1, n0: 5 }], 6), 1);
  assert.equal(sentAt([], 3), 0);
  const run0 = { wall: 196, pct: 100, off: 5, talk: 100, heard: 500, secs: [{ ad: 1 }, { ad: 0 }] }, st = statCards(run0, null, 180);
  assert.deepEqual(st.map(c => c.label), ['걸린 시간', '말 빠르기', '대본 밖']);
  assert.equal(st[0].value, '3:16'); assert.equal(st[0].note, '목표보다 0:16 길어요'); assert.ok(st[0].over);
  assert.equal(st[1].value, '300'); assert.equal(st[1].unit, ' 음절/분'); assert.equal(st[1].note, '보통 · 1분에 약 300자'); assert.equal(st[2].note, '애드리브 1개');
  assert.equal(statCards(run0, { ...run0, talk: 100, heard: 400 }, 180)[1].note, '보통 · 지난번보다 빨라졌어요');
  assert.ok(!statCards({ ...run0, talk: 0 }, null, 0)[0].over && statCards({ ...run0, talk: 0 }, null, 0).length === 2, '말한 시간이 짧으면 빠르기 카드를 뺀다');

  // 2. 모드
  assert.equal(modeOf(null), 'live'); assert.equal(modeOf('practice'), 'practice'); assert.equal(modeOf('x'), 'live');
  assert.deepEqual(MODES.map(micIdle), ['● 리딩', '● 연습', '● 시작']);
  assert.equal(mixKind(null, 'read'), 'read'); assert.equal(mixKind('practice', 'practice'), 'practice'); assert.equal(mixKind('practice', 'live'), 'mixed');

  // 3. 들은 음절
  let hs = newHear();
  for (const n of [5, 3, 6]) hearStep(hs, n);
  assert.equal(hs.n, 6, '중간 결과가 줄었다 늘어도 6');
  hearReset(hs, 6); hearStep(hs, 2);
  assert.equal(hs.n, 8, '새 세션은 이어서');
  hs = newHear(); hearStep(hs, 5); hearStep(hs, 3); hearReset(hs, 3); hearStep(hs, 2);
  assert.equal(hs.n, 5, '중간 5, 확정 3, 새 세션 2: 두 번 세지 않음');
  assert.deepEqual(readHear({ n: 'x', base: 3 }), { n: 0, base: 3 });
  // 구간 누적: 실제 시각 차이로 더한다
  const A1 = newAcc(1), A2 = newAcc(1);
  tickAcc(A1, 0, 1, {}); tickAcc(A1, 0, 1, {});
  for (let i = 0; i < 4; i++) tickAcc(A2, 0, 0.5, {});
  assert.equal(A1[0].wall, 2); assert.equal(A2[0].wall, 2);
  tickAcc(A1, 0, 9, { off: true });
  assert.deepEqual([A1[0].wall, A1[0].talk, A1[0].off], [4, 0, 2], '말이 없던 사이(잠자기)는 한 번에 2초까지');
  tickAcc(A1, 0, 60, { talk: true }); tickAcc(A1, 0, 100, { talk: true });
  assert.deepEqual([A1[0].wall, A1[0].talk], [129, 125], '말하는 중이면 1분에 한 번으로 늦어진 타이머도 더한다(65초까지)');
  tickAcc(A1, 5, 1, {});  // 없는 구간은 무시
  assert.deepEqual(readAcc(packAcc(A1), 1), A1);
  assert.equal(readAcc(packAcc(A1), 2), null, '구간 수가 다르면 되살리지 않는다');
  assert.deepEqual(readAcc([[1, -2, 'x', NaN, 5, 0, 1]], 1)[0], { wall: 1, talk: 0, off: 0, chars: 0, heard: 5, anch: 0, gaps: 1 });

  // app.js와 같은 흐름(match.js follow, 어절 2개씩 늘어나는 중간 결과, 330ms 간격, 줄마다 인식 세션 하나, 500ms 타이머)으로 예시 대본을 읽는다
  // from: 대본 글자 자리에서 손으로 옮겨(탭) 시작한다
  function sim(script, from = 0) {
    const S = normMap(text), words = [], acc = newAcc(SU.length), secOf = secMap(SU), hs = newHear(), ring = [];
    let k = 0;
    for (const m of text.matchAll(/\S+/g)) {
      words.push({ s: k, n0: len(text.slice(0, m.index)), n1: len(text.slice(0, m.index + m[0].length)) });
      if (/[.?!…。]["'”’)\]]*$/.test(m[0]) || /^\s*\n/.test(text.slice(m.index + m[0].length))) k++;
    }
    // 지금 구간: 목소리로 왔으면 마지막으로 읽기 시작한 어절의 문장, 키워드로 옮겼으면 옮겨 간 어절의 문장 (app.js secNow)
    let by = from ? 'tap' : null;
    const A = anchors(S.s, words, ex.prep?.kw), sec = () => secOf[sentAt(words, cur + (by === 'voice' ? 0 : 1))], tot = key => acc.reduce((x, a) => x + a[key], 0);
    let now = 0, cur = len(text.slice(0, from)), pending = null, approx = null, heard = '', said = 0, matched = 0, talkSec = 0, maxOff = 0;
    let lastHeard = -1e9, lastMatch = 0, lastAnchor = -1e9, lastResume = 0, lastMove = 0, lastTick = 0, nextTick = 500;
    const tick = t => {
      const off = lastHeard - Math.max(lastMatch, lastAnchor, lastResume, lastMove) > 3000, talk = t - lastHeard < 3000, dt = Math.min(2, (t - lastTick) / 1000);
      lastTick = t;
      tickAcc(acc, sec(), dt, { talk, off });
      if (talk) talkSec += dt;
      if (off) maxOff = Math.max(maxOff, sec());
      if (t % 5000 === 0) ringPush(ring, [talkSec, hs.n, tot('chars'), tot('anch'), 0]);
    };
    const until = t => { while (nextTick <= t) { tick(nextTick); nextTick += 500; } };
    if (from) until(now = 1500);  // 옮기고 1.5초 뒤에 읽기 시작
    for (const line of script) {
      const ws = line.split(' ');
      let sn = '', cut = 0;
      for (let i = 2; ; i += 2) {
        until(now += 330);
        const n0 = sn.length;
        sn = norm(ws.slice(0, i).join(' ')); said += Math.max(0, sn.length - n0);
        if (now - lastHeard > 1500) lastResume = now;
        lastHeard = now;
        const dh = hearStep(hs, sn.length);
        const f = follow(S, A, heard + sn.slice(cut), cur, pending, now - lastAnchor < 10000 ? approx : null);
        pending = f.pending;
        if (f.how === 'anchor') { acc[sec()].anch++; heard = ''; cut = sn.length; said = 0; approx = f.sent; lastAnchor = now; cur = f.pos; by = 'anchor'; }
        else if (f.how) {
          lastMatch = now;
          if (f.how === 'voice') {
            approx = null;
            // 따라간 글자와 들은 음절은 옮긴 뒤 구간에 (구간 첫 어절을 읽은 것이 앞 구간에 들지 않게)
            if (f.pos !== cur) { const d = f.pos > cur ? Math.min(f.pos - cur, said) : 0; matched += d; said = 0; cur = f.pos; by = 'voice'; acc[sec()].chars += d; }
          }
        }
        acc[sec()].heard += dh;
        if (i >= ws.length) break;
      }
      heard = (heard + sn.slice(cut)).slice(-60);
      hearReset(hs, sn.length);
    }
    until(now + 4000);
    return { acc, matched, talkSec, hs, ring, cur, tot };
  }
  const sents = text.split('\n\n').map(p => p.match(/[^.?!]+[.?!]/g).map(x => x.trim()));
  const AD = ['어제 저녁에 친구들이랑 영화를 보러 갔는데요', '팝콘이 너무 짜서 콜라를 두 잔이나 마셨어요', '주말에는 비가 온다고 해서 우산을 챙겨야겠어요', '점심으로 김치찌개를 먹었는데 정말 맛있었어요'];
  const adl = [];
  for (let t = 0, i = 0; t < 20; i++) { const l = AD[i % AD.length]; adl.push(l); t += Math.ceil(l.split(' ').length / 2) * 0.33; }
  const run = sim([...sents.slice(0, 3).flat(), ...adl, ...sents.slice(3).flat()]);
  near(run.acc[2].off, 20, 3, '셋째 문단 끝 20초 대본 밖 말은 셋째 구간(2)');
  assert.ok(run.acc.every((a, i) => i === 2 || a.off < 1), '다른 구간에는 대본 밖이 없다');
  assert.equal(run.tot('chars'), run.matched, 'Σchars = matched');
  near(run.tot('talk'), run.talkSec, 0.5, 'Σtalk');
  assert.equal(run.tot('heard'), run.hs.n, 'Σheard = 들은 음절');
  assert.ok(run.acc.every(a => a.wall > 5 && a.talk > 5 && a.heard >= a.chars * 0.9), '모든 구간에 걸린 시간, 말한 시간, 들은 음절');
  assert.equal(run.cur, len(text), '끝까지 따라감');
  assert.ok(run.acc.every((a, i) => a.chars <= SU[i].len[0]), '구간 첫 어절을 읽은 글자는 앞 구간에 들지 않는다');
  // 마지막 구간 첫 어절로 옮겨(탭) 읽으면 건너뛴 앞 구간에는 시간도 글자도 들지 않는다
  const jumped = sim(sents.at(-1), SU.at(-1).s[0].a);
  assert.deepEqual(['wall', 'chars', 'heard'].map(k => jumped.acc.at(-2)[k]), [0, 0, 0], '옮겨 간 구간에 든다');
  assert.ok(jumped.acc.at(-1).chars > 100 && jumped.cur === len(text));

  // 4. 말 빠르기
  const ringOf = (rate, sec, chars = rate) => { const w = []; for (let t = 0; t <= sec; t += 5) ringPush(w, [t, rate * t, chars * t, 0, 0]); return w; };
  near(speechRate(ringOf(6.2, 40)), 6.2, 1e-9, '빠르기');
  assert.equal(speechRate(ringOf(6.2, 5)), null, '말한 시간 5초');
  assert.equal(speechRate([[0, 0], [8, 50]]), null, '창 안 말한 시간 8초뿐이면 null');
  assert.equal(ringOf(5, 600).length, 25, '최근 2분');
  // 같은 문장을 두 번 읽음: 들은 음절은 늘고 따라간 글자는 그대로
  near(speechRate(ringOf(5.3, 60, 0)), 5.3, 5.3 * 0.05, '다시 읽어도 들은 음절로 잰다');
  const steps = (st, rs, t0 = 0, ctx = {}) => rs.map((r, i) => paceStep(st, r, t0 + i * 5000, typeof ctx === 'function' ? ctx(i) : ctx));
  let ps = newPace();
  assert.deepEqual(steps(ps, Array(9).fill(6.2)), [null, null, 'fast', 'fast', 'fast', 'fast', 'fast', 'fast', 'fast'], '6.2가 10초 이어지면 켬');
  assert.equal(paceStep(ps, 5.6, 45000), 'fast', '5.6이면 유지');
  assert.equal(paceStep(ps, 5.4, 50000), null, '5.4면 끔');
  assert.deepEqual(steps(ps = newPace(), [6.2, 6.2, 5.7, 6.2, 6.2, 6.2]), [null, null, null, null, null, 'fast'], '조건이 끊기면 다시 센다');
  assert.deepEqual(steps(ps = newPace(), Array(6).fill(3.2)), [null, null, null, null, 'slow', 'slow'], '3.2가 20초면 느림');
  assert.equal(paceStep(ps, 3.6, 30000), 'slow'); assert.equal(paceStep(ps, 3.9, 35000), null, '3.8 넘으면 끔');
  const goalCtx = need => ({ goal: 300, sec: 100, rest: need * 200, d: 0 });
  assert.ok(steps(newPace(), Array(8).fill(3.2), 0, goalCtx(6.0)).every(x => x === null), '필요 속도 6.0이면 느림 없음');
  assert.ok(steps(newPace(), Array(8).fill(3.2), 0, { ...goalCtx(4), d: -40 }).every(x => x === null), '40초 여유면 느림 없음');
  assert.ok(steps(newPace(), Array(8).fill(3.2), 0, { goal: 300, sec: 300, rest: 10, d: 0 }).every(x => x === null), '목표 시간이 지났으면 느림 없음');
  assert.equal(steps(newPace(), Array(8).fill(3.2), 0, goalCtx(4)).at(-1), 'slow', '목표가 있어도 넉넉하면 느림');
  // hold 동안은 지속 시간이 늘지 않는다: 6.2 두 번(5초) → hold 4번(20초) → 6.2 두 번이면 5초 + 5초 = 10초에 켬
  ps = newPace();
  assert.deepEqual(steps(ps, Array(8).fill(6.2), 0, i => ({ hold: i >= 2 && i < 6 })), [null, null, null, null, null, null, null, 'fast']);
  assert.deepEqual(steps(newPace(), [6.2, 6.2, null, 6.2, 6.2]), [null, null, null, null, 'fast'], '빠르기를 못 재면 멈춤');
  const H = { sec: 40, off: false, qa: false, now: 1e6, lastMove: 0, rest: 500, r0: 5, recOn: true, recOff: 0 };
  assert.equal(paceHold(H), false);
  for (const [k, v] of [['sec', 20], ['off', true], ['qa', true], ['lastMove', 1e6 - 1000], ['rest', 60]]) assert.equal(paceHold({ ...H, [k]: v }), true, k);
  assert.equal(paceHold({ ...H, recOn: false, recOff: 1e6 - 500 }), false, '인식기가 다시 켜지는 짧은 틈');
  assert.equal(paceHold({ ...H, recOn: false, recOff: 1e6 - 800 }), true, '인식기 꺼짐');
  assert.deepEqual(mRow(5.83, 4.46, 12.34), [58, 45, 12.3]); assert.deepEqual(mRow(null, null, null), [null, null, null]);

  // 5. '말하듯이'
  const rw = (talk, heard, chars, anch = 0, ad = 0) => [[0, 0, 0, 0, 0], [talk, heard, chars, anch, ad]];
  assert.equal(readSignal(rw(60, 310, 300), 4.5, true), true);
  assert.equal(readSignal(rw(60, 310, 300), 5.5, true), false, '높낮이 폭 5.5');
  assert.equal(readSignal(rw(60, 310, 300), 4.5, false), false, '분석 끔');
  assert.equal(readSignal(rw(60, 310, 300), null, true), false, '높낮이 창 없음');
  assert.equal(readSignal(rw(60, 310, 300, 1), 4.5, true), false, '키워드 이동');
  assert.equal(readSignal(rw(60, 310, 300, 0, 1), 4.5, true), false, '애드리브');
  assert.equal(readSignal(rw(60, 300, 270), 4.5, true), false, '그대로 비율 0.9');
  assert.equal(readSignal(rw(50, 260, 250), 4.5, true), false, '말한 시간 50초');

  // 6. 실시간 힌트 (가짜 시계, 초)
  const cue = (st, inp, s) => cueStep(st, { on: true, ...inp }, s * 1000);
  for (const mode of ['read', 'practice', 'live']) for (const on of [true, false]) {
    if (mode !== 'read' && on) continue;
    const st = newCue();
    assert.ok([0, 30, 300].every(s => cueStep(st, { mode, on, pace: 'fast', read: true }, s * 1000) === null), `${mode} ${on}`);
  }
  assert.equal(cue(newCue(), { mode: 'live', pace: 'slow' }, 0), null, '실전에서 빠르게는 없음');
  assert.deepEqual(cue(newCue(), { mode: 'live', pace: 'fast' }, 0), { k: 'fast', word: '천천히', dim: true }, '실전은 처음부터 흐림');
  assert.equal(cue(newCue(), { mode: 'live', pace: 'fast', late: true }, 0), null, '실전 초과, 자동 줄이기 없음');
  assert.equal(cue(newCue(), { mode: 'live', pace: 'fast', late: true, shrinkOn: true }, 0).word, '천천히');
  assert.deepEqual(cue(newCue(), { mode: 'live', read: true }, 0), { k: 'read', word: '말하듯이', dim: true });
  let cs = newCue();
  assert.deepEqual(cue(cs, { mode: 'practice', pace: 'fast', read: true }, 0), { k: 'fast', word: '천천히', dim: false }, '빠르기가 먼저, 처음은 보통 밝기');
  assert.equal(cue(cs, { mode: 'practice', pace: 'fast', read: true }, 5).dim, false);
  assert.equal(cue(cs, { mode: 'practice', pace: 'fast', read: true }, 6).dim, true, '6초 뒤 흐림');
  assert.equal(cue(cs, { mode: 'practice', read: true }, 10), null, '조건이 풀리면 바로 지움');
  assert.equal(cue(cs, { mode: 'practice', read: true }, 25), null, '지운 뒤 15초: 간격 20초 전');
  assert.equal(cue(cs, { mode: 'practice', read: true }, 30).word, '말하듯이', '20초 뒤');
  assert.equal(cue(cs, { mode: 'practice', pace: 'fast' }, 35), null, '말하듯이가 풀림');
  assert.equal(cue(cs, { mode: 'practice', pace: 'fast' }, 55), null, '같은 천천히는 60초 안에 다시 안 보임');
  assert.equal(cue(cs, { mode: 'practice', pace: 'fast' }, 60).word, '천천히');
  cs = newCue();
  cue(cs, { mode: 'live', pace: 'fast' }, 0); cue(cs, { mode: 'live' }, 10);
  assert.equal(cue(cs, { mode: 'live', pace: 'fast' }, 170), null, '실전 같은 힌트 180초');
  assert.equal(cue(cs, { mode: 'live', pace: 'fast' }, 180).word, '천천히');
  cs = newCue();
  assert.equal(cue(cs, { mode: 'practice', pace: 'fast', hold: true }, 0), null, 'hold면 새 힌트 없음');
  assert.equal(cue(cs, { mode: 'practice', pace: 'fast' }, 5).word, '천천히');
  assert.equal(cue(cs, { mode: 'practice', pace: 'fast', hold: true }, 10).word, '천천히', 'hold여도 보이던 것은 둠');
  assert.equal(cue(cs, { mode: 'practice', pace: 'fast', hide: true }, 11), null, 'hide면 바로 지움');
  assert.equal(cue(cs, { mode: 'practice', pace: 'fast' }, 12), null, '돌아와도 다시 보이지 않음');
  cs = newCue();
  cue(cs, { mode: 'practice', read: true }, 0); cue(cs, { mode: 'practice' }, 5);
  assert.equal(cue(cs, { mode: 'practice', read: true }, 100), null, '말하듯이는 연습에서도 180초');

  // 7. 높낮이와 쉼 (합성 신호, 48kHz, 2048샘플 프레임, 무음 = -60dBFS 백색 잡음)
  const SR = 48000, N = 2048;
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 * 2 - 1; };  // 고르게 -1~1
  const NOISE = 0.001 * Math.sqrt(3);  // rms 0.001
  // 조각 [[초, Hz | 0 | (초 => Hz), 'saw'?], ...]를 이어 붙인다. 소리는 진폭 0.3, 모두 -60dBFS 잡음 위
  function sig(parts, sr = SR, amp = 0.3) {
    const out = new Float32Array(Math.round(parts.reduce((x, p) => x + p[0], 0) * sr));
    let o = 0, ph = 0;
    for (const [d, f, saw] of parts) for (let i = 0, n = Math.round(d * sr); i < n; i++) {
      const hz = typeof f === 'function' ? f(i / sr) : f;
      ph = (ph + hz / sr) % 1;
      out[o++] = (hz ? amp * (saw ? 2 * ph - 1 : Math.sin(2 * Math.PI * ph)) : 0) + NOISE * rnd();
    }
    return out;
  }
  const pitch = (x, sr) => { const d = down(x, sr); return yin(d.x, d.sr); };
  const one = (f, sr = SR, saw) => sig([[N / sr, f, saw]], sr).subarray(0, N);
  for (const [f, saw] of [[100], [150, 1], [220], [300], [440]]) near(pitch(one(f, SR, saw), SR), f, f * 0.01, `${saw ? '톱니' : '사인'} ${f}Hz`);
  for (const f of [100, 150, 220, 300]) near(pitch(one(f, 44100), 44100), f, f * 0.01, `44.1kHz 사인 ${f}Hz`);
  assert.equal(down(new Float32Array(2048), 48000).x.length, 682); near(down(new Float32Array(2048), 44100).sr, 14700, 0, '44.1kHz → 14.7kHz');
  const noisy = one(220).map(v => v + 0.3 / Math.SQRT2 / 10 * Math.sqrt(3) * rnd());
  near(pitch(noisy, SR), 220, 220 * 0.02, '사인 220Hz + 잡음(SNR 20dB)');
  for (const f of [100, 150, 220, 300]) {
    const x = one(f).map((v, i) => v + 0.15 * Math.sin(2 * Math.PI * 2 * f * i / SR) + 0.1 * Math.sin(2 * Math.PI * 3 * f * i / SR) + 0.02 * rnd());
    near(pitch(x, SR), f, f * 0.02, `배음과 잡음 ${f}Hz`);
  }
  assert.equal(pitch(one(0), SR), null, '무음');
  assert.equal(pitch(new Float32Array(N), SR), null, '0만');
  assert.equal(pitch(new Float32Array(N).map(() => 0.3 * rnd()), SR), null, '백색 잡음');
  near(db(new Float32Array(48000).map((_, i) => 0.5 * Math.sin(2 * Math.PI * 220 * i / SR))), -9.03, 0.1, '진폭 0.5 사인 dB');
  let t = performance.now();
  const fr = one(150);
  for (let i = 0; i < 250; i++) pitch(fr, SR);
  const tYin = performance.now() - t;
  assert.ok(tYin < 500, `프레임 250개 ${tYin.toFixed(0)}ms`);

  // 이어진 신호를 40ms마다 끝 2048샘플씩 넣는다 (앱의 40ms setInterval과 AnalyserNode). drop: [시작, 끝) ms의 프레임은 빠뜨림
  function feed(F, x, { s = 0, drop = null, sr = SR } = {}) {
    const out = [];
    for (let t = 43; t * sr / 1000 <= x.length; t += 40) {
      if (drop && t >= drop[0] && t < drop[1]) continue;
      const e = Math.round(t * sr / 1000);
      out.push({ t, ...F.push(x.subarray(e - N, e), sr, t, s) });
    }
    return out;
  }
  const voiced = (rs, a, b) => { const r = rs.filter(f => f.t - 43 >= a * 1000 && f.t <= b * 1000); return r.filter(f => f.v).length / r.length; };
  const wd = F => { const st = F.secs()[0].st; return st && st[1] - st[0]; };
  let F = frames(1);
  let rs = feed(F, sig([[1, 0], [10, s => 100 * 2 ** (s / 10)], [1, 0]]));
  assert.ok(voiced(rs, 1, 11) >= 0.9, `글라이드 유성 비율 ${voiced(rs, 1, 11)}`);
  near(wd(F), 9.6, 0.6, '100→200Hz 글라이드 폭');
  near(F.live(12000).flat, 8.6, 0.6, '실시간 창: 최근 10초(2~11초 글라이드, 0.8 × 10.8반음)');
  F = frames(1); feed(F, sig([[1, 0], [10, 180], [1, 0]]));
  assert.ok(wd(F) < 0.5, '180Hz 고정');
  assert.ok(F.live(12000).flat < 0.5, '실시간 창도 좁음');
  F = frames(1); feed(F, sig([[1, 0], [2, 180], [1, 0]]));
  assert.deepEqual([F.live(4000).flat, F.secs()[0].st], [null, null], '유성 3초 미만은 버림');
  F = frames(1); rs = feed(F, sig([[1, 0], [20, 200]]));
  assert.ok(voiced(rs, 1, 21) >= 0.9, `무음 1초 뒤 사인 20초: 바닥이 따라 오르지 않음 ${voiced(rs, 1, 21)}`);
  F = frames(1); rs = feed(F, sig([[1, 0], [20, 200]], SR, 0.3));
  assert.ok(rs.at(-1).floor < -50, '바닥은 무음 근처');
  // 쉼: 150ms는 말소리 사이 짧은 틈(세지 않음), 260·300·450ms는 짧은 쉼, 1.2초는 긴 쉼, 4초는 세지 않음.
  // 250ms는 0.25초 문턱과 같아서 어떤 측정도 반반이므로 260ms로 시험한다. 150ms 틈은 2초 말소리 안에 둔다(연속 발화를 끊지 않으므로).
  const S2 = [2, 160];
  const pz = [[0.5, 0], [0.9, 160], [0.15, 0], [0.95, 160], [0.26, 0], S2, [0.3, 0], S2, [0.45, 0], S2, [1.2, 0], S2, [4, 0], S2, [0.5, 0]];
  for (let k = 0; k < 4; k++) {  // 프레임 시각을 10ms씩 밀어도 같다
    F = frames(1);
    feed(F, sig([[k * 0.01, 0], ...pz]));
    const z = F.secs()[0];
    assert.deepEqual([z.p25, z.p1], [3, 1], `짧은 쉼 3, 긴 쉼 1 (밀기 ${k})`);
    near(z.run, 2.0, 0.1, '연속 발화 최장');
    assert.ok(z.st, '유성 3초 넘음');
  }
  // 켜자마자 0 샘플이 와도 바닥이 그 값에 붙지 않는다 (붙으면 1초에 1dB씩만 올라 처음 1분 동안 쉼을 못 센다)
  F = frames(1); feed(F, Float32Array.from([...new Float32Array(SR / 2), ...sig(pz)]));
  assert.deepEqual([F.secs()[0].p25, F.secs()[0].p1], [3, 1], '처음 0.5초 0 샘플 뒤에도 쉼을 센다');
  // 프레임이 300ms 끊기면(타이머가 늦어짐) 그 틈은 쉼으로 세지 않는다
  const brkSig = sig([[0.5, 0], [2, 160], [0.6, 0], [2, 160], [0.5, 0]]);
  F = frames(1); feed(F, brkSig);
  assert.equal(F.secs()[0].p25, 1, '끊기지 않으면 0.6초 쉼 하나');
  F = frames(1); feed(F, brkSig, { drop: [2780, 3080] });
  assert.deepEqual([F.secs()[0].p25, F.secs()[0].p1], [0, 0], '프레임 사이 300ms 빈 틈은 쉼이 아님');
  // 한 프레임만 두 배로 튄 높낮이는 중앙값이 없앤다 (8프레임에 하나씩 튀면 중앙값 없이는 p90이 튄 값)
  F = frames(1);
  for (let i = 0; i < 100; i++) F.push(one(i % 8 === 4 ? 300 : 150), SR, 1000 + i * 40);
  assert.ok(wd(F) < 0.5, `튄 높낮이 ${wd(F)}`);
  // 짧은 유성 구간(2프레임)은 버린다
  F = frames(1);
  for (let i = 0; i < 300; i++) F.push(one(i % 3 === 2 ? 0 : 150), SR, 1000 + i * 40);
  assert.equal(F.secs()[0].st, null, '2프레임 유성 구간뿐');
  // 구간마다 따로 센다. 프레임이 없던 구간은 null
  F = frames(3); feed(F, sig([[0.5, 0], [4, 150], [0.4, 0]]), { s: 1 });
  const z3 = F.secs();
  assert.deepEqual(z3[0], { st: null, p25: null, p1: null, run: null, vol: null, ends: null, fall: null, pm: null, rv: null });
  assert.ok(z3[1].st && z3[1].run > 3.8, '1번 구간에 유성과 연속 발화');
  // 쉼과 끝난 연속 발화는 쉼 앞 말소리의 구간에 든다 (구간 0에서 말하고 쉰 뒤 구간 1에서 다시 말함)
  F = frames(2); feed(F, sig([[0.5, 0], [3, 150], [0.6, 0]]), { s: 0 });
  const tail = sig([[3, 150], [0.5, 0]]), base0 = 4100;
  for (let t = 43; t * SR / 1000 <= tail.length; t += 40) { const e = Math.round(t * SR / 1000); F.push(tail.subarray(e - N, e), SR, base0 + t, 1); }
  const z2 = F.secs();
  assert.deepEqual([z2[0].p25, z2[1].p25], [1, 0], '쉼은 앞 구간');
  near(z2[0].run, 3, 0.1, '끝난 연속 발화는 앞 구간'); near(z2[1].run, 3, 0.1, '이어지는 연속 발화는 지금 구간');
  // 목소리 크기: 구간마다 바닥 위 dB. 진폭 0.3(-13.5dBFS)은 잡음(-60dBFS) 위 약 46dB, 0.06은 약 14dB 작다
  const cat = (...xs) => { const o = new Float32Array(xs.reduce((a, x) => a + x.length, 0)); let i = 0; for (const x of xs) { o.set(x, i); i += x.length; } return o; };
  F = frames(2); feed(F, sig([[1, 0], [4, 150], [0.4, 0]]), { s: 0 });
  const quiet = sig([[4, 150], [0.4, 0]], SR, 0.06);
  for (let t = 43; t * SR / 1000 <= quiet.length; t += 40) { const e = Math.round(t * SR / 1000); F.push(quiet.subarray(e - N, e), SR, 5400 + t, 1); }
  const zv = F.secs();
  near(zv[0].vol, 46.5, 2, '큰 목소리 바닥 위 dB'); near(zv[0].vol - zv[1].vol, 14, 1.5, '진폭 1/5이면 약 14dB 작다');
  // 끝 흐림: 1.5초 말하고 마지막 0.3초를 진폭 1/10(20dB 작게)로 흐린 뒤 쉼. 흐리지 않은 말 덩어리는 세기만 한다
  const fallSig = (end) => cat(sig([[1, 0], [1.5, 150]]), sig([[0.3, 150]], SR, 0.3 * end), sig([[0.6, 0], [1.5, 150], [0.6, 0]]));
  F = frames(1); feed(F, fallSig(0.1));
  assert.deepEqual([F.secs()[0].ends, F.secs()[0].fall], [1, 1], '흐린 끝 1번');
  F = frames(1); feed(F, fallSig(1));
  assert.deepEqual([F.secs()[0].ends, F.secs()[0].fall], [1, 0], '또렷한 끝');
  F = frames(1); feed(F, sig([[1, 0], [0.6, 150], [0.6, 0], [1.5, 150], [0.6, 0]]));
  assert.equal(F.secs()[0].ends, 0, '1초 안 되는 말 덩어리는 재지 않는다');
  // 강조: 꼭 말할 문장(key)을 2배 크게(+6dB), 높게(150 → 200Hz, +5반음) 말했다
  const emphOf = (amp, hz) => {
    const F2 = frames(1), a = sig([[1, 0], [4, 150], [0.4, 0]]), b = sig([[3, hz], [0.4, 0]], SR, amp);
    for (let t = 43; t * SR / 1000 <= a.length; t += 40) { const e = Math.round(t * SR / 1000); F2.push(a.subarray(e - N, e), SR, t, 0, false); }
    for (let t = 43; t * SR / 1000 <= b.length; t += 40) { const e = Math.round(t * SR / 1000); F2.push(b.subarray(e - N, e), SR, 5400 + t, 0, true); }
    return F2.emph();
  };
  const em = emphOf(0.6, 200);
  near(em.db, 6, 1, '꼭 말할 문장 +6dB'); near(em.st, 5, 0.6, '꼭 말할 문장 +5반음'); assert.ok(em.n > 60);
  const em0 = emphOf(0.3, 150);
  assert.ok(Math.abs(em0.db) <= 1 && Math.abs(em0.st) <= 0.5, '같은 크기·높이');
  assert.equal(frames(1).emph(), null, '꼭 말할 문장이 없으면 null');

  // 8. 목소리 분석 켜기와 충돌 감시
  const nav = (o = {}) => ({ userAgent: 'Mozilla/5.0 (Macintosh)', mediaDevices: { getUserMedia() {} }, userAgentData: { mobile: false, brands: [{ brand: 'Not.A/Brand', version: '99' }, { brand: 'Chromium', version: '141' }, { brand: 'Google Chrome', version: '141.0.1' }] }, ...o });
  assert.equal(deviceKind(nav(), false, true), 'desktop');
  assert.equal(deviceKind(nav({ userAgentData: undefined }), false, true), 'other', 'Safari, Firefox');
  assert.equal(deviceKind(nav({ userAgentData: { mobile: true, brands: [] } }), true, true), 'mobile', 'Android');
  assert.equal(deviceKind(nav({ userAgent: 'Linux; Android 14' }), false, true), 'mobile');
  assert.equal(deviceKind(nav(), true, true), 'mobile', '터치 위주 기기');
  assert.equal(deviceKind(nav({ mediaDevices: undefined }), false, true), 'mobile');
  assert.equal(browserKey(nav()), 'Google Chrome 141');
  assert.equal(browserKey(nav({ userAgentData: { brands: [{ brand: 'Microsoft Edge', version: '140' }, { brand: 'Chromium', version: '140' }] } })), 'Microsoft Edge 140');
  assert.equal(browserKey(nav({ userAgentData: undefined })), null);
  assert.equal(audioDefault('desktop', 'practice', null, false), true);
  assert.equal(audioDefault('desktop', 'read', { r: false }, false), false);
  assert.equal(audioDefault('desktop', 'live', null, false), false, '실전은 기본 끔');
  assert.equal(audioDefault('desktop', 'live', { l: true }, false), true);
  assert.equal(audioDefault('desktop', 'practice', { r: true }, true), false, '막힘 기록이 있으면 끔');
  assert.equal(audioDefault('mobile', 'practice', { r: true }, false), false);
  const B = (o, n = 8) => Array.from({ length: n }, () => ({ sp: 0, res: 0, hn: 0, mx: -60, fl: -60, z: false, ...o }));
  const watchSeq = (wins, x = { recOn: true }) => { const st = newWatch(); return wins.map(w => watchdog(st, w, x)); };
  const starve = B({ sp: 1, mx: -20 });
  assert.deepEqual(watchSeq([starve, starve, starve, starve]), [null, null, 'rec?', null], '인식기 굶음은 세 번째에만');
  assert.deepEqual(watchSeq([starve, starve, starve], { recOn: false }), [null, null, null], '인식기가 꺼진 동안은 다시 듣기가 맡음');
  const grow = n => B({ sp: 1, mx: -20 }, n);
  assert.deepEqual(watchSeq([1, 2, 3, 4, 5, 6, 7, 8, 8, 8].map(grow)), [null, null, null, null, null, null, null, null, null, 'rec?'], '시작 뒤에는 8초가 찬 뒤 세 번째에');
  const late = [...B({ sp: 1, mx: -20 }, 5), ...B({ sp: 1, res: 4, hn: 20, mx: -20 }, 6)];
  assert.ok(watchSeq(late.map((_, i) => late.slice(0, i + 1).slice(-W_WIN))).every(x => x === null), '첫 결과가 5초 늦게 옴');
  const deaf = B({ res: 2, hn: 2, mx: -58 });
  assert.deepEqual(watchSeq([deaf, deaf]), [null, 'audio'], '분석기 굶음은 두 번째에');
  const ok = { sp: 0.8, res: 3, hn: 5, mx: -15 };
  assert.ok(watchSeq(Array(20).fill(B(ok))).every(x => x === null), '정상');
  const burst = [...B(ok), ...B({ sp: 1, mx: -15 }, 4), ...B({ sp: 1, res: 6, hn: 25, mx: -15 }, 4), ...B(ok, 4)];
  assert.ok(watchSeq(burst.map((_, i) => burst.slice(Math.max(0, i - 7), i + 1))).every(x => x === null), '인식 결과가 4초 비었다가 몰려 옴');
  assert.equal(watchdog(newWatch(), B({ z: true }, 2), {}), 'audio', '샘플이 2초 동안 0');
  assert.equal(watchdog(newWatch(), B({ z: true }, 1), {}), null);
  assert.equal(watchdog(newWatch(), [], { muted: true }), 'lost', '장치에서 끊김은 막힘으로 적지 않는다');
  assert.equal(watchdog(newWatch(), [], { ended: true }), 'lost');
  assert.equal(blockOf('lost', 0, 1), null);
  assert.equal(blockOf('audio', 0, 0), 'audio');
  assert.equal(blockOf('rec?', 1000, 4000), 'rec', '끄자 5초 안에 결과가 옴');
  assert.equal(blockOf('rec?', 1000, 9000), null);
  assert.equal(blockOf('rec?', 1000, 0), null, '결과가 오지 않음');
  assert.equal(blockOf('denied', 0, 1), null);

  // 9. 기록
  for (const bad of ['x', '{}', 'null', '[1, null, {"secs": 3}]']) assert.deepEqual(readRuns(bad), [], bad);
  const s0 = { w: '안녕하세요. 오늘은 발표 대본을 따라가는', n: 160, lv: 0, wall: 32.4, talk: 30.1, off: 0, chars: 150, heard: 160, anch: 0, gaps: 1, st: [12.25, 19.75], p25: 4, p1: 1, run: 7.2, rd: 0, ad: 0 };
  const base = { v: 1, t0: 1760245500000, kind: 'practice', h: 'abc123', target: 180, r0: 4.83, el: 250, wall: 242.3, talk: 230, off: 12, chars: 1200, heard: 1250, anch: 1, gaps: 4, pct: 100, lv: null, re: false, audio: { off: null, at: null }, secs: [s0], cues: [['fast', 61.5]], read: 0, ai: null };
  const c = cleanRun({ ...base, wall: '242', off: -3, chars: NaN, kind: 'abc', extra: 1, secs: [{ ...s0, w: s0.w + '더 긴 글', wall: '1', x: 2 }], cues: [['fast', 3], ['boo', 4], 5] });
  assert.deepEqual([c.wall, c.off, c.chars, c.kind, c.extra, c.secs[0].w.length, c.secs[0].wall, c.secs[0].x, c.cues], [0, 0, 0, 'live', undefined, 20, 0, undefined, [['fast', 3]]], '숫자·kind·모르는 키');
  assert.deepEqual(readRuns(JSON.stringify(Array.from({ length: 22 }, (_, i) => ({ ...base, t0: i })))).map(r => r.t0), Array.from({ length: 20 }, (_, i) => i + 2), '22개 → 마지막 20개');
  let runs = upsertRun([], base);
  runs = upsertRun(runs, { ...base, t0: 2 });
  runs = upsertRun(runs, { ...base, wall: 99 });
  assert.deepEqual(runs.map(r => [r.t0, r.wall]), [[base.t0, 99], [2, 242.3]], '같은 t0는 바꿔 씀');
  assert.equal(cleanRun({ ...base, ai: { summary: 'x', tips: [{ sec: 1, what: '가'.repeat(400), how: '나' }] } }).ai.tips[0].what.length, 300, 'AI 글은 300자');
  // 30구간 기록이 8000자 미만 (AI 결과와 힌트 기록이 가득 차도)
  const big = { ...base, kind: 'mixed', lv: Array(30).fill(2), audio: { off: 'rec?', at: 1234.56 }, cues: Array.from({ length: 80 }, (_, i) => ['read', 1000.55 + i]),
    secs: Array.from({ length: 30 }, () => ({ ...s0, w: '가나다라마바사아자차카타파하가나다라마바', n: 1234, wall: 1234.56, talk: 1234.56, off: 1234.56, chars: 12345, heard: 12345, anch: 99, gaps: 99, st: [41.25, 47.75], p25: 99, p1: 99, run: 123.4, rd: 9, ad: 9 })),
    ai: { summary: '가'.repeat(250), tips: Array.from({ length: 5 }, () => ({ sec: 30, what: '나'.repeat(350), how: '다'.repeat(350) })) } };
  const bigLen = saveRuns([cleanRun(big)]).length - 2;
  assert.ok(bigLen < REC_MAX, `30구간 기록 ${bigLen}자`);
  assert.deepEqual(fitRun(cleanRun(big)), cleanRun(big), '30구간이면 빼는 것 없음');
  const b60 = fitRun(cleanRun({ ...big, secs: Array(60).fill(s0) }));
  assert.ok(saveRuns([b60]).length - 2 < REC_MAX && b60.ai && b60.secs[0].w, '보통 값의 60구간도 첫 글과 AI 결과가 남음');
  assert.ok(saveRuns([fitRun(cleanRun({ ...big, secs: Array(90).fill(big.secs[0]) }))]).length - 2 < REC_MAX, '90구간');
  assert.deepEqual(readRuns(saveRuns([cleanRun(big), base])), [cleanRun(big), cleanRun(base)], '저장 모양을 다시 읽으면 같다');
  // buildRun: 말한 시간 20초 미만은 저장하지 않음
  const acc8 = newAcc(8), info = SU.map(u => ({ w: text.slice(u.s[0].a, u.s[0].a + 20), n: u.len[0], lv: 0 }));
  assert.equal(buildRun({ t0: 1, kind: 'read', acc: acc8, info }), null);
  acc8.forEach((a, i) => Object.assign(a, { wall: 30 + i, talk: 28, heard: 160, chars: 150 + i }));
  const br = buildRun({ t0: 1, kind: 'read', h: 'h', target: 180, r0: 5, el: 260, pct: 100, lv: null, acc: acc8, info, aud: null, rd: [0, 2], ad: [0, 0, 1], cues: [['fast', 40.04]] });
  assert.deepEqual([br.wall, br.talk, br.chars, br.read, br.secs[1].rd, br.secs[2].ad, br.secs[0].st, br.secs[0].p25, br.audio, br.cues], [268, 224, 1228, 2, 2, 1, null, null, null, [['fast', 40]]]);
  assert.equal(br.secs[0].w, '안녕하세요. 오늘은 발표 대본을 따라');

  // 10. 결과 창 글
  const view = (run, prev, goal) => [...sumLines(run, prev, goal), ...secRows(run, prev, goal).flatMap(r => [r.head, r.time, r.words, ...r.nums]), ...tips(run, goal).map(x => x.text)].join('\n');
  for (const [run, prev, goal] of [[br, null, 180], [br, null, 0], [br, base, 240], [cleanRun({ ...br, audio: { off: 'audio', at: 192 } }), br, 180]])
    assert.ok(!/NaN|undefined|null|Infinity/.test(view(run, prev, goal)), '창 글에 NaN·undefined·null 없음');
  assert.ok(secRows(cleanRun(big), null, 180).every(r => !/\d\.\d/.test(r.words)), '셋째 줄에 소수점 숫자 없음');
  const one60 = cleanRun({ ...base, wall: 60, secs: [{ ...s0, n: 100, wall: 60 }] });
  const row = secRows(one60, null, 40)[0];
  assert.equal(row.time, '1:00 · 기대보다 0:14 넘음', '걸린 60초, 기대 40±6초');
  assert.ok(row.bar.wall > row.bar.hi && row.bar.max >= row.bar.wall);
  assert.deepEqual(row.nums.slice(0, 5), ['기대 0:34~0:46', '1분에 약 320자', '높낮이 폭 8반음', '쉼 5번(1초 넘는 쉼 1번)', '쉬지 않고 가장 길게 7초'], '첫 줄은 막대 띠와 같은 기대 시간');
  assert.equal(row.words, '빠르기 보통 · 높낮이 보통');
  assert.ok(secRows(br, null, 180)[0].nums.includes('1.5초 넘게 멈춤 0번'), '분석이 없으면 멈춤');
  const unread = cleanRun({ ...br, pct: 14, secs: br.secs.map((s, i) => i < 2 ? s : { ...s, wall: 0, talk: 0, heard: 0, chars: 0 }) });
  assert.deepEqual(secRows(unread, null, 180)[2].nums.slice(1), [], '읽지 않은 구간에는 멈춤을 내지 않는다');
  assert.equal(secRows(br, br, 180)[0].nums.at(-1), '지난번 0:30', '같은 대본이면 지난번');
  assert.ok(!secRows(br, unread, 180)[2].nums.some(x => x.startsWith('지난번')), '지난번에 읽지 않은 구간은 비교하지 않는다');
  const part = cleanRun({ ...br, pct: 14, secs: br.secs.map((s, i) => ({ ...s, wall: i === 0 ? 33 : i === 1 ? 3 : 0 })) });
  assert.deepEqual(secRows(part, null, 180).slice(1, 3).map(r => r.time), ['0:03', '읽지 않음'], '멈춘 구간은 짧다고 하지 않고, 가지 않은 구간은 읽지 않음');
  assert.match(secRows({ ...part, pct: 100 }, null, 180)[1].time, /짧음$/, '끝까지 갔으면 짧음');
  assert.equal(secRows(br, { ...br, h: 'x' }, 180)[0].nums.some(x => x.startsWith('지난번')), false);
  assert.deepEqual(sumLines(br, { ...br, wall: 250, h: 'x' }, 240), ['4:28 · 목표보다 0:28 길어요 · 지난번보다 0:18 길어요', '평균 빠르기 빠름 · 기준은 보통 낭독 빠르기(1분에 240~330자)', '대본 밖 0:00 · 애드리브 1개', '대본이 바뀌어 구간은 비교하지 않아요.']);
  assert.deepEqual(sumLines(cleanRun({ ...br, pct: 40, wall: 60 }), null, 180).slice(0, 2), ['1:00 · 40%까지 읽음', '평균 빠르기 빠름 · 기준은 보통 낭독 빠르기(1분에 240~330자)'], '끝까지 가지 않았으면 짧다고 하지 않는다');
  assert.deepEqual(sumLines(cleanRun({ ...br, pct: 53, wall: 126 }), null, 120).slice(0, 2), ['2:06 · 53%까지 읽음', '이 빠르기면 끝까지 약 3:58로, 목표보다 1:58 길어요.'], '이 빠르기로 끝까지 가면 넘음');
  assert.equal(sumLines(cleanRun({ ...br, pct: 21, wall: 82 }), br, 0)[0], '1:22 · 21%까지 읽음', '중간에 멈춘 기록은 총 시간을 비교하지 않는다');
  assert.equal(sumLines(br, cleanRun({ ...br, pct: 50 }), 0)[0], '4:28', '지난번이 중간에 멈췄어도');
  assert.equal(sumLines(cleanRun({ ...br, pct: 90, wall: 170 }), null, 180)[0], '2:50 · 90%까지 읽음', '끝까지 가지 않았으면 안에 들어왔다고도 하지 않는다');
  assert.equal(sumLines(cleanRun({ ...br, pct: 90, wall: 170 }), null, 180)[1].startsWith('이 빠르기면'), false);
  assert.equal(sumLines(cleanRun({ ...br, pct: 10, wall: 200 }), null, 180)[0], '3:20 · 10%까지 읽음 · 목표보다 0:20 길어요', '어림하기에 짧아도 이미 넘었으면 말한다');
  assert.equal(sumLines(cleanRun({ ...br, pct: 98, wall: 175 }), br, 180)[0], '2:55 · 목표 3:00 안에 들어왔어요 · 지난번보다 1:33 짧아요', '98%면 끝까지 간 것(마지막 문장 인식 실패)');
  assert.equal(runLabel(cleanRun({ ...br, pct: 98 })).includes('%까지'), false);
  assert.ok(sumLines(cleanRun({ ...br, el: 300, re: true, audio: { off: 'rec?', at: 192 }, kind: 'read', lv: [0, 0] }), null, 0).join('|')
    .includes('리딩은 자동 줄이기 없이 쟀어요.|멈춘 시간 0:32은 빼고 쟀어요.|새로고침 전 높낮이·쉼은 빠졌어요.|목소리 분석이 3:12에 꺼져 그 뒤 높낮이·쉼·목소리 크기는 없어요(이유: 음성 인식이 멈춰서).'));
  assert.equal(audioNote(br), '');
  assert.equal(audioNote({ audio: { off: 'denied', at: 0 } }), '목소리 분석을 켜지 못해 높낮이·쉼·목소리 크기는 재지 않았어요(이유: 마이크를 열지 못함).', '시작하자마자 실패');
  assert.equal(cleanRun({ ...br, audio: { off: 'qa', at: 83 } }).audio.off, 'qa');
  assert.equal(runLabel(cleanRun({ ...base, t0: new Date(2026, 9, 12, 14, 5).getTime(), wall: 292, pct: 42 })), '10/12 14:05 · 연습 · 4:52 · 42%까지');
  assert.deepEqual(toneLines(br), [], '리딩은 말투 줄 없음');
  assert.deepEqual(toneLines(cleanRun({ ...br, kind: 'practice' })), ['대본 그대로 96% · 키워드로 따라감 0번 · 애드리브 1개'], '분석이 없으면 통계만(까닭은 요약 줄에)');
  assert.equal(toneLines(cleanRun({ ...br, kind: 'practice', audio: { off: 'rec?', at: 25 } })).length, 1, '60초 전에 꺼졌으면 신호를 낼 수 없었다');
  assert.equal(toneLines(cleanRun({ ...br, kind: 'practice', audio: { off: 'rec?', at: 75 } })).length, 3);
  assert.equal(toneLines(cleanRun({ ...br, kind: 'live', audio: { off: null, at: null } }))[0], '말투 신호 2번(2번 구간)');
  assert.equal(toneLines(cleanRun({ ...br, kind: 'mixed', audio: { off: null, at: null }, secs: br.secs.map(s => ({ ...s, rd: 0 })) }))[0], '말투 신호는 나오지 않았어요.');
  // 다음에 해 볼 것
  const tr = (secs, o = {}) => cleanRun({ ...base, ...o, secs: secs.map(x => ({ ...s0, ...x })) });
  assert.deepEqual(tips(tr([{ wall: 100 }, { wall: 130, talk: 20, heard: 120 }], { wall: 230, talk: 40, heard: 180 }), 180).map(x => x.text),
    ['목표보다 0:50 길어요. 2번 구간이 가장 많이 넘었어요.', '2번 구간이 빨랐어요. 문장 끝에서 한 박자 쉬어 보세요.'], '목표 넘음, 빠른 구간');
  assert.equal(tips(tr([{ wall: 230 }], { wall: 230, talk: 200, heard: 1200 }), 180)[0].text, '빠르게 읽었는데도 0:50 넘었어요. 대본을 줄이거나 자동 줄이기를 켜 보세요.');
  assert.deepEqual(tips(tr([{ st: [10, 13] }, { run: 14.2 }, { rd: 1 }, { st: [10, 12] }]), 0).map(x => x.k), ['flat', 'run', 'read']);
  assert.equal(tips(tr([{ st: [10, 13] }, {}, {}, { st: [10, 12] }]), 0)[0].text, '1, 4번 구간은 높낮이 폭이 좁았어요. 강조할 낱말을 조금 높게 말해 보세요.');
  assert.equal(tips(tr([{ wall: 30, talk: 20, heard: 120 }, { wall: 30, talk: 20, heard: 120 }, { wall: 30, talk: 20, heard: 120 }]), 0)[0].text, '모든 구간이 빨랐어요. 문장 끝에서 한 박자 쉬어 보세요.');
  assert.equal(tips(tr([{ run: 14.2 }]), 0)[0].text, '1번 구간에서 14초 동안 쉬지 않았어요. 쉼표에서 쉬어 보세요.');
  assert.equal(tips(tr([{ wall: 30, talk: 20, heard: 120 }, { wall: 30, talk: 20, heard: 120 }, { wall: 30, talk: 20, heard: 120 }, { wall: 0, talk: 0, heard: 0 }], { pct: 75 }), 0)[0].text,
    '읽은 모든 구간이 빨랐어요. 문장 끝에서 한 박자 쉬어 보세요.', '중간에 멈췄으면 읽은 구간만');
  assert.equal(tips(tr([{}], { wall: 110 }), 180)[0].text, '목표보다 1:10 짧아요. 천천히 읽거나 설명을 더해 보세요.');
  assert.deepEqual(tips(tr([{}], { wall: 110, pct: 70 }), 180), [], '끝까지 가지 않았으면 짧다고 하지 않는다');
  assert.equal(tips(tr([{}], { wall: 110, pct: 98 }), 180)[0].k, 'short', '98%면 끝까지 간 것');
  assert.equal(tips(tr([{ wall: 100 }, { wall: 26 }], { wall: 126, pct: 53, talk: 120, heard: 500 }), 120)[0].text, '이 빠르기면 끝까지 목표보다 1:58 길어요. 1번 구간이 가장 많이 넘었어요.', '어림으로 넘음');
  assert.equal(tips(tr([{ st: [1, 2] }, { st: [1, 2] }, { run: 20 }, { rd: 1 }], { wall: 300, talk: 100, heard: 600 }), 180).length, 3, '3개까지');
  // 갑자기 빨라짐(다른 구간 중앙값의 1.2배, '빠름'은 아님), 문장 끝 흐림, 작은 목소리, 강조
  const slow = { talk: 30, heard: 120 }, tk = (secs, o) => Object.fromEntries(tips(tr(secs, o), 0, 9).map(x => [x.k, x.text]));
  assert.equal(tk([slow, slow, { talk: 30, heard: 150 }, slow]).jump, '3번 구간에서 다른 구간보다 갑자기 빨라졌어요. 구간이 바뀔 때 한 박자 쉬고 시작해 보세요.');
  assert.equal(tk([slow, slow, { talk: 30, heard: 140 }, slow]).jump, undefined, '1.2배 안');
  assert.equal(tk([slow, { talk: 30, heard: 150 }]).jump, undefined, '읽은 구간이 셋 미만이면 비교하지 않는다');
  assert.equal(tk([{ ends: 3, fall: 2 }, { ends: 3, fall: 1 }, { ends: 3, fall: 0 }]).fall, '문장 끝 9번 가운데 3번 소리가 작아졌어요(1, 2번 구간). 마지막 낱말까지 또렷하게 말해 보세요.');
  assert.equal(tk([{ ends: 6, fall: 2 }, { ends: 5, fall: 1 }]).fall, undefined, '30% 미만');
  assert.equal(tk([{ vol: 40 }, { vol: 41 }, { vol: 30 }, { vol: 40 }]).quiet, '3번 구간은 다른 구간보다 목소리가 작아졌어요. 처음과 같은 크기로 말해 보세요.');
  assert.deepEqual(Object.keys(tk([{ vol: 15 }, { vol: 16 }, { vol: 9 }])).filter(k => /low|quiet/.test(k)), ['low'], '전체가 작으면 작은 구간 대신 전체를');
  assert.equal(tk([{ vol: 40 }, { vol: 30 }]).quiet, undefined, '잰 구간이 셋 미만');
  assert.match(tk([{}], { emph: { db: 0.4, st: -0.3, n: 80 } }).emph, /^꼭 말할 문장을 다른 문장과 비슷한/);
  assert.equal(tk([{}], { emph: { db: 3, st: 0, n: 80 } }).emph, undefined, '크게 말했으면 강조한 것');
  assert.equal(tips(tr([{ st: [1, 2] }, { st: [1, 2] }, { run: 20 }, { rd: 1 }], { wall: 300, talk: 100, heard: 600 }), 180, 9).length, 4, 'AI에는 3개 넘게');
  // 지난번 고칠 점: 같은 구간에 같은 팁이 또 나오면 아직, 없어졌으면 고쳤어요, 그 구간을 읽지 않았으면 모름
  const qk = { wall: 30, talk: 20, heard: 120 }, ok3 = { wall: 30, talk: 20, heard: 60 }, fA = tr([qk, ok3, ok3]);
  assert.deepEqual(fixedTips(tr([ok3, ok3, ok3]), fA, 0).map(x => [x.k, x.v]), [['fast', 'done']]);
  assert.deepEqual(fixedTips(fA, fA, 0).map(x => [x.k, x.v]), [['fast', 'still']]);
  assert.deepEqual(fixedTips(tr([ok3, qk, ok3]), fA, 0).map(x => [x.k, x.v]), [['fast', 'done']], '다른 구간이 빨라진 것은 이 팁을 고친 것으로 본다');
  assert.deepEqual(fixedTips(tr([{ wall: 0 }, ok3, ok3], { pct: 60 }), fA, 0).map(x => [x.k, x.v]), [['fast', 'unread']]);
  assert.deepEqual(fixedTips(fA, null, 0), []);
  const vr = secRows(tr([{ vol: 40, ends: 3, fall: 2 }, { vol: 41 }, { vol: 30.4 }]), null, 0);
  assert.match(vr[0].words, /끝 흐림 2번/); assert.match(vr[2].words, /목소리 작아짐/); assert.doesNotMatch(vr[0].words, /목소리 작아짐/);
  assert.ok(vr[2].nums.includes('목소리 크기: 주변 소리보다 30dB 큼') && vr[0].nums.includes('문장 끝 3번 가운데 2번 작아짐'));
  assert.ok(!secRows(tr([{}]), null, 0)[0].nums.some(x => /목소리 크기|문장 끝/.test(x)), '목소리 값이 없으면 내지 않는다');
  const et = tr([{}], { emph: { db: 3.4, st: -0.6, n: 80 } });
  assert.ok(toneLines(et).includes('꼭 말할 문장은 다른 문장보다 소리 +3dB, 높이 -1반음이었어요.'));
  assert.deepEqual(toneLines({ ...et, kind: 'read' }), ['꼭 말할 문장은 다른 문장보다 소리 +3dB, 높이 -1반음이었어요.'], '리딩에도 강조는 보인다');
  assert.ok(toneLines(tr([{}], { emph: { db: 0.3, st: -0.4, n: 80 } })).includes('꼭 말할 문장은 다른 문장보다 소리 0dB, 높이 0반음이었어요.'), '반올림해 0이면 기호 없이');
  // 기록: 강조 차이는 음수도 둔다, 틀린 값은 null, 흐린 수는 잰 수를 넘지 않는다, 옛 기록은 null
  assert.deepEqual(cleanRun({ ...base, emph: { db: -2.345, st: 1, n: 50 } }).emph, { db: -2.3, st: 1, n: 50 });
  assert.equal(cleanRun({ ...base, emph: { db: 'x', st: 1 } }).emph, null);
  assert.deepEqual([cleanRun({ ...base, secs: [{ ...s0, ends: 2, fall: 5 }] }).secs[0].fall, cleanRun(base).secs[0].vol, cleanRun(base).secs[0].fall], [2, null, null]);
  assert.deepEqual(readRuns(saveRuns([cleanRun({ ...base, secs: [{ ...s0, vol: 33.3, ends: 4, fall: 1 }], emph: { db: 1, st: 2, n: 30 } })]))[0].secs[0].vol, 33.3, '저장했다 읽어도');
  assert.equal(JSON.parse(saveRuns([cleanRun(base)]))[0].secs[0].length, 16, '목소리 값이 없으면 저장 배열이 늘지 않는다');
  const v60 = fitRun(cleanRun({ ...big, secs: Array(60).fill({ ...big.secs[0], vol: 46.5, ends: 99, fall: 99 }) }));
  assert.ok(saveRuns([v60]).length - 2 < REC_MAX, '목소리 값이 다 찬 60구간');

  // 11. 흐름(목소리 힘)과 꼭 말할 문장
  // 힘: 고정 바닥으로 본다. 고르게 읽으면 모두 보통(z점수처럼 작은 차이를 키우지 않는다)
  const en = (rows, nodb) => energy(rows.map(([rv, pm, w]) => ({ rv, pm, st: w == null ? null : [10, 10 + w] })), nodb);
  assert.deepEqual(en([[-30, 20, 6], [-30.5, 20.3, 6.5], [-29.8, 19.9, 5.8], [-30.2, 20, 6.2]]), ['mid', 'mid', 'mid', 'mid'], '고르게 읽으면 모두 보통');
  assert.deepEqual(en([[-30, 20, 6], [-30, 20, 6], [-26, 22, 9], [-30, 20, 6]]), ['mid', 'mid', 'high', 'mid']);
  assert.deepEqual(en([[-30, 20, 6], [-34, 18, 6], [-30, 20, 6]]), ['mid', 'low', 'mid'], '크기·높이 둘이 같은 쪽이면');
  assert.deepEqual(en([[-30, 20, 6], [-34, 20, 6], [-30, 20, 6]]), ['mid', 'mid', 'mid'], '하나만 벗어나면 보통');
  assert.deepEqual(en([[-30, 20, 6], [-20, 18, 4]]), [null, null], '잰 구간이 셋 미만');
  assert.deepEqual(en([[-30, 20, 6], [-20, 20, 6], [-30, 20, 6]], true), ['mid', 'mid', 'mid'], 'dB를 믿지 못하면 크기를 뺀다');
  assert.deepEqual(en([[null, 20, null], [null, 23, null], [null, 20, null]]), [null, null, null], '잰 값이 둘 미만이면 null');
  assert.equal(secPe([{ n: 100, e: 3 }, { n: 40, e: 2 }]), 3, '글자가 많은 문단');
  assert.equal(secPe([{ n: 100, e: 1 }, { n: 40, e: 3 }]), null, '1과 3이 묶이면 정하지 않는다');
  assert.equal(secPe([{ n: 10 }]), null);
  assert.deepEqual([flowGap(3, 'low'), flowGap(1, 'high'), flowGap(3, 'mid'), flowGap(2, 'low'), flowGap(null, 'low')], ['more', 'less', null, null, null], '두 칸 차이만');
  // 머문 시간: 같은 문장은 더하고, 정지(null) 사이는 뺀다. 다른 문장 중앙값(200ms/자)과 견준다
  const L4 = new Map([[0, 20], [1, 20], [2, 20], [3, 20], [4, 10]]);
  near(dwell([[0, 0], [4000, 1], [8000, 2], [12000, 3], [18000, null], [30000, 4], [31000, 3]], 32000, L4, new Set([3])).get(3), 7000 / 20 / 200, 1e-9, '머문 시간 비');
  assert.equal(dwell([[0, 0], [1000, 1]], 2000, L4, new Set([1])).size, 0, '다른 문장이 셋 미만이면 재지 않는다');
  assert.ok(!dwell([[0, 0], [1, 1], [2, 2], [3, 4]], 9, L4, new Set([4])).has(4), '15자 미만은 재지 않는다');
  assert.equal(prePause([[1000, 0.3], [9000, 0.8], [12000, 1.2]], 10000), 0.8, 'ts-2.5초 ~ ts+0.3초에 끝난 쉼');
  assert.equal(prePause([[9000, 0.9], [9850, 0.35]], 10000), 0.9, '문장 안 쉼표 쉼이 앞 쉼을 덮지 않는다(가장 긴 쉼)');
  assert.equal(prePause([[1000, 0.3]], 10000), 0);
  assert.equal(pauseMid([[0, 0.3], [0, 0.4], [0, 0.5], [0, 0.6], [0, 2]]), 0.5); assert.equal(pauseMid([[0, 1]]), null);
  const kv = (k, o) => keyVerdict({ db: null, st: null, n: 0, pre: null, dw: null, sd: null, ...k }, o);
  assert.deepEqual(kv({ db: 2.4, st: 1.5, n: 80, pre: 0.2, dw: 1 }, { pzm: 0.4 }), { v: 'ok', cues: ['loud', 'high'], miss: ['pause', 'slow'] }, '크고 높게');
  assert.equal(kv({ db: 1, st: 0.5, n: 80, pre: 0.9, dw: 1.3 }, { pzm: 0.4 }).v, 'ok', '앞에서 쉬고 천천히');
  assert.deepEqual(kv({ db: 1, st: 0.5, n: 80, pre: 0.55, dw: 1.1 }, { pzm: 0.4 }), { v: 'weak', cues: [], miss: ['pause', 'slow', 'loud', 'high'] }, '0.55초 쉼은 이번 쉼 중앙값 × 1.5(0.6초)보다 짧다');
  assert.equal(kv({ db: 3, st: 2, n: 80 }, { nodb: true }).v, 'na', 'dB를 믿지 못하면 높이 하나뿐이라 못 잼');
  assert.equal(kv({ sd: 0.3, db: 3, st: 2 }).v, 'skip'); assert.equal(kv({ sd: 0.3 }, { read: false }).v, 'unread');
  // 녹음 듣기 자리
  const segs = [{ ms: 30000, marks: [[0, 0, 0], [5000, 1, 0], [9000, 2, 1], [9200, 3, 1], [20000, 4, 2], [25000, null, 2]] }, { ms: 8000, marks: [[0, 7, 3], [3000, 8, 3]] }];
  const sid = n => m => m[1] === n;
  assert.deepEqual(clip(segs, sid(1)), { i: 0, from: 4, to: 8 }, '1초 앞에서');
  assert.deepEqual(clip(segs, sid(2)), { i: 0, from: 8, to: 9.5 }, '짧으면 1.5초까지');
  assert.deepEqual(clip(segs, m => m[2] === 1), { i: 0, from: 8, to: 19 }, '구간의 이어진 문장들');
  assert.deepEqual(clip(segs, sid(4)), { i: 0, from: 19, to: 24 }, '정지(null)에서 끝');
  assert.deepEqual(clip(segs, m => m[2] === 3), { i: 1, from: 0, to: 8 }, '다음 조각, 조각 끝까지');
  assert.equal(clip(segs, sid(9)), null);
  assert.deepEqual(clip([{ ms: 25010, marks: [[0, 0, 0], [20000, 4, 1], [25000, null, null]] }], sid(4)), { i: 0, from: 19, to: 25.01 }, '정지 단추 끝은 당기지 않는다');
  // '크게'
  let qs = newQuiet();
  const qv = vol => ({ vol, base: -30, vsec: 90 }), qrun = (vs, ctx) => vs.map((v, i) => quietStep(qs, v, i * 5000, ctx));
  assert.deepEqual(qrun([qv(-37), qv(-37), qv(-37), qv(-35), qv(-33)]), [false, false, true, true, false], '6dB 넘게 작은 것이 10초면 켜고, 4dB 안이면 끈다');
  qs = newQuiet(); assert.deepEqual(qrun([qv(-37), qv(-37), qv(-37)], { calm: true }), [false, false, false], '차분하게 말할 구간');
  qs = newQuiet(); assert.deepEqual(qrun([qv(-37), qv(-37), qv(-37)], { nodb: true }), [false, false, false], 'dB를 믿지 못함');
  qs = newQuiet(); assert.deepEqual(qrun([50, 55, 59].map(vsec => ({ vol: -40, base: -30, vsec }))), [false, false, false], '유성 60초 전');
  qs = newQuiet(); qrun([qv(-37), qv(-37), qv(-37)]); assert.equal(quietStep(qs, qv(-37), 20000, { hold: true }), true, 'hold면 보이던 것은 둔다');
  assert.equal(cueStep(newCue(), { mode: 'practice', on: true, quiet: true }, 0)?.word, '크게');
  assert.equal(cueStep(newCue(), { mode: 'live', on: true, quiet: true }, 0), null, '실전에는 없다');
  assert.equal(cueStep(newCue(), { mode: 'practice', on: true, quiet: true, pace: 'fast' }, 0).word, '천천히', '빠르기가 먼저');
  // 문장별 강조(합성 신호): 꼭 말할 문장(sid 5)을 같은 구간 다른 문장보다 2배 크게(+6dB), 높게(150 → 200Hz, +5반음)
  {
    const F3 = frames(2), put = (x, t0, s, key, sid, off = false) => { for (let t = 43; t * SR / 1000 <= x.length; t += 40) { const e = Math.round(t * SR / 1000); F3.push(x.subarray(e - N, e), SR, t0 + t, s, key, sid, off); } };
    put(sig([[1, 0], [4, 150], [0.4, 0]]), 0, 0, false, 4);
    put(sig([[3, 200], [0.4, 0]], SR, 0.6), 5400, 0, true, 5);
    put(sig([[0.5, 0], [4, 300], [0.4, 0]], SR, 0.6), 8800, 1, false, 6);  // 다른 구간은 견주는 기준에 들지 않는다
    const kk = F3.keys(), sc = F3.secs();
    assert.deepEqual(kk.map(x => [x.sid, x.s]), [[5, 0]]);
    near(kk[0].db, 6, 1, '같은 구간 다른 문장보다 +6dB'); near(kk[0].st, 5, 0.6, '+5반음'); assert.ok(kk[0].n > 60);
    near(sc[1].pm - sc[0].pm, 12, 0.6, '구간 높이 중앙값(150Hz와 300Hz)'); near(sc[1].rv - sc[0].rv, 6, 1, '구간 원 dB 중앙값(진폭 0.3과 0.6)');
    const lv = F3.live(13800);
    near(lv.vsec, 11, 1.5, '유성 초'); near(lv.base, -7.5, 1, '유성 원 dB 중앙값(진폭 0.6이 더 많다)'); near(lv.vol, -7.5, 1, '최근 10초');
    assert.ok(F3.pauses().length >= 1 && F3.pauses().every(p => p[1] >= P_SHORT)); near(F3.drift(), 0, 1, '잡음 바닥이 그대로');
    const F4 = frames(1);
    for (let t = 43; t <= 3000; t += 40) F4.push(one(200), SR, t, 0, true, 2, true);
    assert.deepEqual(F4.keys(), [], '대본 밖일 때는 꼭 말할 문장에 넣지 않는다');
  }
  // 기록: 꼭 말할 문장, 고칠 점
  const kc = cleanRun({ ...base, keys: [{ sid: 3, s: 0, w: '가'.repeat(30), db: -1.26, st: 2.04, n: 80, pre: 0.83, dw: 1.234, sd: 0.876, r: 2 }, { sid: 'x', s: 0 }, { sid: 1, s: 9 }], nodb: true, pzm: 0.44, ph: 123, rh: 'abc' });
  assert.deepEqual(kc.keys, [{ sid: 3, s: 0, w: '가'.repeat(20), db: -1.3, st: 2, n: 80, pre: 0.83, dw: 1.23, sd: 0.88, r: 2 }], '틀린 sid, 없는 구간은 버린다(쉼은 0.01초까지: 문턱 근처 판정이 저장으로 바뀌지 않게)');
  assert.deepEqual([kc.nodb, kc.pzm, kc.ph, kc.rh], [true, 0.44, 123, 'abc']);
  assert.deepEqual(readRuns(saveRuns([kc]))[0], kc, '저장했다 읽어도 같다');
  assert.deepEqual(['keys', 'nodb', 'pzm', 'ph', 'rh', 'rec'].map(k => k in cleanRun(base)), [false, false, false, false, false, false], '없으면 키를 두지 않는다');
  assert.equal(cleanRun({ ...base, rec: true }).rec, true); assert.equal(cleanRun({ ...base, rec: 1 }).rec, undefined);
  assert.deepEqual(cleanRun({ ...base, secs: [{ ...s0, pm: 17.25, rv: -23.46, pe: 3 }] }).secs[0], { ...cleanRun(base).secs[0], pm: 17.3, rv: -23.5, pe: 3 }, '원 dB는 음수');
  assert.deepEqual(cleanAiCoach({ summary: 's', tips: [], edits: [{ sec: 2, what: 'a', how: 'b' }, { sec: 1, what: 'c', how: 'd' }, { sec: 0, what: 'e', how: 'f' }, { sec: 0, what: 'g', how: 'h' }] }, 3, [10, 0, 5]).edits.map(x => x.why), ['c', 'e'], '읽지 않은 구간은 버리고 2개까지(옛 모양은 what이 까닭)');
  assert.deepEqual(cleanAiCoach({ summary: 's', tips: [], edits: [{ sec: 1, why: '길어요', from: ' 가 나 ', to: '가나' }, { sec: 1, why: '같아요', from: '가', to: '가' }, { sec: 1, why: '', from: '가', to: '나' }] }, 3).edits,
    [{ sec: 1, why: '길어요', from: '가 나', to: '가나' }], '바꿀 글이 같거나 까닭이 없으면 버린다');
  assert.deepEqual(cleanAiCoach({ summary: 's', tips: [{ sec: 1, what: 'a', how: 'b' }] }, 3), { summary: 's', tips: [{ sec: 1, what: 'a', how: 'b' }] }, '고칠 점이 없으면 옛 모양');
  assert.equal(cleanAiCoach({ summary: 's', tips: [], edits: [] }, 3), null);
  const full = cleanRun({ ...big, secs: big.secs.map(s => ({ ...s, vol: 46.5, ends: 99, fall: 99, pm: 33.25, rv: -23.5, pe: 3 })), nodb: true, pzm: 0.5, ph: 1760245500000, rh: 'abcdef12',
    keys: Array.from({ length: 30 }, (_, i) => ({ sid: 100 + i, s: i, w: '가나다라마바사아자차카타파하가나다라마바', db: -12.3, st: 12.5, n: 1234, pre: 1.2, dw: 1.23, sd: 0.88, r: 9 })),
    ai: { ...big.ai, edits: Array.from({ length: 2 }, () => ({ sec: 30, why: '라'.repeat(120), from: '마'.repeat(200), to: '바'.repeat(300) })) } });
  assert.equal(full.keys.length, KEYS, '꼭 말할 문장 20개까지');
  assert.ok(saveRuns([full]).length - 2 < REC_MAX && fitRun(full) === full, `값이 다 찬 30구간 기록 ${saveRuns([full]).length - 2}자, 빼는 것 없음`);
  // 결과 글
  const kr = tr([{ wall: 30 }, { wall: 30 }, { wall: 0 }], { pzm: 0.4, keys: [{ sid: 1, s: 0, w: '첫째', db: 3, st: 2, n: 80, pre: 0.2, dw: 1, sd: 1 },
    { sid: 4, s: 1, w: '둘째', db: 0.5, st: 0, n: 80, pre: 0.2, dw: 1, sd: 1 }, { sid: 6, s: 1, w: '셋째', db: 3, st: 2, n: 80, sd: 0.2 }, { sid: 9, s: 2, w: '넷째', sd: 0 }] });
  const kz = keyRows(kr);
  assert.deepEqual(kz.rows.map(r => r.label), ['살려 말했어요', '더 살려 보세요', '빼먹은 것 같아요', '읽지 않았어요']);
  assert.equal(kz.sum, '꼭 말할 문장 2개 가운데 1개를 살려 말했어요. 1개는 빼먹은 것 같아요.');
  assert.equal(kz.rows[0].detail, '앞 쉼 0.2초 · 머문 시간 1.0배 · 소리 +3dB · 높이 +2반음 → 강조 단서 2개');
  assert.equal(kz.rows[1].todo, '그 문장 앞에서 한 박자 쉬어 보세요.');
  assert.equal(tk(kr.secs, kr)['key-skip'], '2번 구간에서 꼭 말할 문장을 빼먹은 것 같아요. 그 문장은 꼭 읽어 주세요.');
  assert.equal(keyRows(tr([{}])), null, '꼭 말할 문장이 없으면');
  assert.equal(keyRows(tr([{ wall: 30 }, { wall: 0 }], { keys: [{ sid: 5, s: 1, sd: 0 }] })).sum, '꼭 말할 문장이 있는 구간까지 읽지 않았어요.');
  const nd = keyRows(tr([{ wall: 30 }], { nodb: true, keys: [{ sid: 1, s: 0, n: 200, st: 2, sd: 1 }] }));
  assert.deepEqual([nd.rows[0].detail, nd.sum], ['잴 수 있는 단서가 둘이 안 돼 못 쟀어요.', '꼭 말할 문장을 잴 단서가 모자랐어요.'], '목소리 탓이 아니면 그렇게 말한다');
  assert.equal(keyRows({ ...kr, audio: null }).sum, '꼭 말할 문장 4개 가운데 2개를 말했어요. 1개는 빼먹은 것 같아요.', '목소리 분석이 없으면 말했는지만');
  assert.equal(keyStates({ ...kr, pct: 40, secs: kr.secs.map((s, i) => ({ ...s, wall: i < 2 ? 30 : 0 })) })[2].v, 'unread', '멈춘 구간의 빼먹음은 읽지 않음');
  const wk = { db: 0.5, st: 0, n: 80, pre: 0.9, dw: 1 };
  assert.equal(tk([{}, {}, {}], { pzm: 0.4, keys: [0, 1, 2].map(s => ({ sid: s, s, w: '', ...wk, sd: 1 })), emph: { db: 0.2, st: 0, n: 80 } })['key-weak'],
    '꼭 말할 문장 3개 가운데 3개를 다른 문장과 비슷하게 말했어요. 그 문장은 조금 천천히 말해 보세요.', '많이 빠진 단서로 하나');
  assert.equal(tk([{}], { keys: [{ sid: 0, s: 0, ...wk, sd: 1 }], emph: { db: 0.2, st: 0, n: 80 } }).emph, undefined, '문장별 판정이 있으면 옛 강조 팁은 없다');
  assert.ok(!toneLines(tr([{}], { keys: [{ sid: 0, s: 0, sd: 1 }], emph: { db: 3.4, st: -0.6, n: 80 } })).some(x => /꼭 말할 문장은/.test(x)));
  const fl = [{ rv: -30, pm: 20, st: [10, 16], pe: 3 }, { rv: -30, pm: 20, st: [10, 16], pe: 2 }, { rv: -34, pm: 18, st: [10, 16], pe: 3 }, { rv: -30, pm: 20, st: [10, 16], pe: 2 }];
  assert.equal(tk(fl).tone, '3번 구간은 힘 있게 말할 곳인데 다른 구간보다 차분하게 들렸어요. 조금 더 크고 높게 말해 보세요.');
  assert.match(secRows(tr(fl), null, 0)[2].words, /힘 있게 말할 곳인데 차분하게 들림/);
  assert.ok(secRows(tr(fl), null, 0)[0].nums.includes('발표 준비의 계획: 힘 있게'));
  assert.equal(tk(fl.map(s => ({ ...s, pe: null }))).tone, undefined, '계획이 없으면 말하지 않는다');

  console.log(`check.js ok (yin 프레임 250개 ${tYin.toFixed(0)}ms)`);
}
