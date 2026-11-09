#!/bin/bash
# §58 — بوابات الجولتين المتتاليتين: إقلاع نظيف لكل جولة (نمط gates-e57)
# البوابة الجديدة (قفل الخزنة الساكن) + انحدارا §50 (خزنة الحافظة) و§57 (قفل التسليم)
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

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
  bash .zscripts/boot-e58.sh || { echo "FATAL: boot failed"; exit 1; }
  rm -f /tmp/nexuslink-e58-live/audit.jsonl
  echo "--- §58 قفل الخزنة الساكن ---"
  node scripts/clip-rest-e2e.mjs --app http://127.0.0.1:3000 --db /tmp/nexuslink-e58-live/db/custom.db 2>&1 | tail -1
  echo "--- انحدار §50 خزنة الحافظة الذكية ---"
  node scripts/clip-vault-e2e.mjs --app http://127.0.0.1:3000 2>&1 | tail -1
  echo "--- انحدار §57 قفل التسليم الساكن ---"
  NEXUSLINK_HANDOFF_FILE=/tmp/nexuslink-e58-live/handoff.json node scripts/handoff-rest-e2e.mjs --app http://127.0.0.1:3000 --dir /tmp/nexuslink-e58-live 2>&1 | tail -1
}

run_round "${1:-1}"
run_round "${2:-2}"
echo "════ انتهت الجولتان ════"
