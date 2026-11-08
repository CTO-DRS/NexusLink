#!/bin/bash
# §53–§55 — بوابات الجولتين المتتاليتين للموجة الثانية كاملة (نمط gates-e54)
set -u
cd /home/z/my-project/nexuslink_repo

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
  bash .zscripts/boot-e55.sh || { echo "FATAL: boot failed"; exit 1; }
  rm -f /tmp/nexuslink-e55-live/audit.jsonl
  echo "--- §53 التسليم اليدوي ---"
  node scripts/handoff-e2e.mjs --app http://127.0.0.1:3000 --dir /tmp/nexuslink-e55-live 2>&1 | tail -1
  echo "--- §54 الدرع الاحتياطي المشفّر ---"
  node scripts/backup-secure-e2e.mjs --app http://127.0.0.1:3000 --dir /tmp/nexuslink-e55-live 2>&1 | tail -1
  echo "--- §55 الماسح الموثق الحي ---"
  node scripts/scan-e2e.mjs --app http://127.0.0.1:3000 --dir /tmp/nexuslink-e55-live 2>&1 | tail -1
}

run_round "${1:-1}"
run_round "${2:-2}"
echo "════ انتهت الجولتان ════"
