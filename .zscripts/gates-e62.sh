#!/bin/bash
# §62 — بوابات الجولتين المتتاليتين: إقلاع نظيف لكل جولة (نمط gates-e61)
# البوابة الجديدة (معاينة المعالجة الحية) + انحدارا §61 عتبة الماسح و§55
# الماسح (المعاينة تقرأ من نفس جلسات الختم) + انحدار §53 التسليم اليدوي.
set -u
cd "$(cd "$(dirname "$0")/.." && pwd)"

kill_server() {
  pkill -f "next dev" 2>/dev/null
  pkill -f "next-server" 2>/dev/null
  pkill -f "next-router-worker" 2>/dev/null
  pkill -f "bun run dev" 2>/dev/null
  for i in $(seq 1 20); do
    curl -s -m 1 http://127.0.0.1:3000/api/health >/dev/null 2>&1 || return 0
    sleep 1
  done
}

run_round() {
  local ROUND="$1"
  echo "════ جولة $ROUND ════"
  kill_server
  bash .zscripts/boot-e62.sh || { echo "FATAL: boot failed"; exit 1; }
  echo "--- §62 معاينة المعالجة الحية (بوابة جديدة) ---"
  node scripts/scan-preview-e2e.mjs --app http://127.0.0.1:3000 --dir /tmp/nexuslink-e62-live 2>&1 | tail -1
  echo "--- انحدار §61 عتبة الماسح الموثق ---"
  node scripts/scan-threshold-e2e.mjs --app http://127.0.0.1:3000 --dir /tmp/nexuslink-e62-live 2>&1 | tail -1
  echo "--- انحدار §55 الماسح الموثق الحي ---"
  node scripts/scan-e2e.mjs --app http://127.0.0.1:3000 --dir /tmp/nexuslink-e62-live 2>&1 | tail -1
  echo "--- انحدار §53 التسليم اليدوي ---"
  node scripts/handoff-e2e.mjs --app http://127.0.0.1:3000 --dir /tmp/nexuslink-e62-live 2>&1 | tail -1
}

run_round "${1:-1}"
run_round "${2:-2}"
echo "════ انتهت الجولتان ════"
