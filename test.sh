#!/bin/sh
# 전체 시험: 계산 확인(node *.js, AI 중계 worker/test.mjs)과 화면 시험(e2e). 화면 시험은 앱 서버가 필요하다: python3 -m http.server 8765
set -e -o pipefail  # 'node x.js | tail -1'이 실패하면 멈춘다
cd "$(dirname "$0")"
for f in match qa claude lib shrink check adlib compare slides; do printf '%s: ' "$f"; node $f.js | tail -1; done
printf 'worker: '; node worker/test.mjs | tail -1
if curl -sf -o /dev/null "${BASE:-http://localhost:8765/}"; then node e2e/run.mjs; else echo '화면 시험은 건너뜀: 앱 서버가 없어요 (python3 -m http.server 8765)'; fi
