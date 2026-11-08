#!/bin/bash
# §56 — بوابة عقد الوكيل المحمول + انحدارات الموجة الثانية — جولتان متتاليتان (نمط gates-e55)
set -u
cd /home/z/my-project/nexuslink

kill_server() {
  pkill -f "next dev" 2>/dev/null
  pkill -f "next-server" 2>/dev/null
  pkill -f "bun run dev" 2>/dev/null
  sleep 3
}

run_round() {
  local ROUND="$1"
  echo "════ جولة $ROUND ════"
  kill_server
  bash .zscripts/boot-e56.sh || { echo "FATAL: boot failed"; exit 1; }
  rm -f /tmp/nexuslink-e56-live/audit.jsonl
  echo "--- §56 بوابة عقد الوكيل المحمول (مرآة Dart) ---"
  node scripts/agent-bridge-e2e.mjs --app http://127.0.0.1:3000 --dir /tmp/nexuslink-e56-live 2>&1 | grep "═══" | tail -1
  echo "--- انحدار §53 التسليم اليدوي ---"
  node scripts/handoff-e2e.mjs --app http://127.0.0.1:3000 --dir /tmp/nexuslink-e56-live 2>&1 | grep "═══" | tail -1
  echo "--- انحدار §55 الماسح الموثق الحي ---"
  node scripts/scan-e2e.mjs --app http://127.0.0.1:3000 --dir /tmp/nexuslink-e56-live 2>&1 | grep "═══" | tail -1
}

run_round "${1:-1}"
run_round "${2:-2}"
echo "════ انتهت الجولتان ════"
