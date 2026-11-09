#!/bin/bash
# §53 — بوابات الجولتين المتتاليتين: إقلاع نظيف لكل جولة (نمط gates-e50)
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
  bash .zscripts/boot-e53.sh || { echo "FATAL: boot failed"; exit 1; }
  rm -f /tmp/nexuslink-e53-live/audit.jsonl
  echo "--- §53 التسليم اليدوي الذكي ---"
  node scripts/handoff-e2e.mjs --app http://127.0.0.1:3000 --dir /tmp/nexuslink-e53-live 2>&1 | tail -1
}

run_round "${1:-1}"
run_round "${2:-2}"
echo "════ انتهت الجولتان ════"
