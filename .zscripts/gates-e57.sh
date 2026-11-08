#!/bin/bash
# §57 — بوابات الجولتين المتتاليتين: إقلاع نظيف لكل جولة (نمط gates-e53)
# البوابة الجديدة (قفل التسليم الساكن) + انحدار §53 (التسليم اليدوي)
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
  bash .zscripts/boot-e57.sh || { echo "FATAL: boot failed"; exit 1; }
  rm -f /tmp/nexuslink-e57-live/audit.jsonl
  echo "--- §57 قفل التسليم الساكن ---"
  node scripts/handoff-rest-e2e.mjs --app http://127.0.0.1:3000 --dir /tmp/nexuslink-e57-live 2>&1 | tail -1
  echo "--- انحدار §53 التسليم اليدوي الذكي ---"
  node scripts/handoff-e2e.mjs --app http://127.0.0.1:3000 --dir /tmp/nexuslink-e57-live 2>&1 | tail -1
}

run_round "${1:-1}"
run_round "${2:-2}"
echo "════ انتهت الجولتان ════"
