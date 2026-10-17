#!/bin/sh
# 전체 시험: 계산 확인(node *.js)과 화면 시험(e2e). 화면 시험은 앱 서버가 필요하다: python3 -m http.server 8765
set -e
cd "$(dirname "$0")"
for f in match qa claude lib shrink check adlib compare slides; do printf '%s: ' "$f"; node $f.js | tail -1; done
if curl -sf -o /dev/null "${BASE:-http://localhost:8765/}"; then node e2e/run.mjs; else echo '화면 시험은 건너뜀: 앱 서버가 없어요 (python3 -m http.server 8765)'; fi
