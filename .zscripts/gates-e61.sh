#!/bin/bash
# §61 — بوابات الجولتين المتتاليتين: إقلاع نظيف لكل جولة (نمط gates-e60)
# البوابة الجديدة (عتبة الماسح الموثق) + انحدار §55 الماسح (الختم مس) +
# انحدار §53 التسليم اليدوي و§57 القفل الساكن (نفس عائلة بوابات التسليم).
set -u
cd "$(cd "$(dirname "$0")/.." && pwd)"

kill_server() {
  pkill -f "next dev" 2>/dev/null
  pkill -f "next-server" 2>/dev/null
  pkill -f "next-router-worker" 2>/dev/null
  pkill -f "bun run dev" 2>/dev/null
  # درس §59: انتظار تحرر المنفذ بعد القتل قبل الإقلاع — الخادم العالق يجعل
  # الإقلاع التالي يتحقق صحته من القديم
  for i in $(seq 1 20); do
    curl -s -m 1 http://127.0.0.1:3000/api/health >/dev/null 2>&1 || return 0
    sleep 1
  done
}

run_round() {
  local ROUND="$1"
  echo "════ جولة $ROUND ════"
  kill_server
  bash .zscripts/boot-e61.sh || { echo "FATAL: boot failed"; exit 1; }
  echo "--- §61 عتبة الماسح الموثق (بوابة جديدة) ---"
  node scripts/scan-threshold-e2e.mjs --app http://127.0.0.1:3000 --dir /tmp/nexuslink-e61-live 2>&1 | tail -1
  echo "--- انحدار §55 الماسح الموثق الحي ---"
  node scripts/scan-e2e.mjs --app http://127.0.0.1:3000 --dir /tmp/nexuslink-e61-live 2>&1 | tail -1
  echo "--- انحدار §53 التسليم اليدوي ---"
  node scripts/handoff-e2e.mjs --app http://127.0.0.1:3000 --dir /tmp/nexuslink-e61-live 2>&1 | tail -1
  echo "--- انحدار §57 قفل التسليم الساكن ---"
  node scripts/handoff-rest-e2e.mjs --app http://127.0.0.1:3000 --dir /tmp/nexuslink-e61-live 2>&1 | tail -1
}

run_round "${1:-1}"
run_round "${2:-2}"
echo "════ انتهت الجولتان ════"
