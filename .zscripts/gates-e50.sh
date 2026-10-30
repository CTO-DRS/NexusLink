#!/bin/bash
# §50–§52 — بوابات الجولتين المتتاليتين: إقلاع نظيف لكل جولة (نمط boot-e47/boot-e48)
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
  bash .zscripts/boot-e50.sh || { echo "FATAL: boot failed"; exit 1; }
  rm -f /tmp/nexuslink-e50-live/audit.jsonl
  echo "--- §50 خزنة الحافظة ---"
  node scripts/clip-vault-e2e.mjs --app http://127.0.0.1:3000 --dir /tmp/nexuslink-e50-live 2>&1 | tail -1
  echo "--- §52 وضع التركيز ---"
  node scripts/focus-e2e.mjs --app http://127.0.0.1:3000 --dir /tmp/nexuslink-e50-live 2>&1 | tail -1
  echo "--- §51 المشاركة الضيوفة ---"
  node scripts/guest-share-e2e.mjs --app http://127.0.0.1:3000 --dir /tmp/nexuslink-e50-live 2>&1 | tail -1
}

run_round "${1:-1}"
run_round "${2:-2}"
echo "════ انتهت الجولتان ════"
