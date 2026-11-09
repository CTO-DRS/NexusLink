#!/bin/bash
# §60 — بوابات الجولتين المتتاليتين: إقلاع نظيف لكل جولة (نمط gates-e58)
# البوابة الجديدة (أنواع الدفع الكاملة من الهاتف) + البطارية كاملة بلا إخفاق:
# §56 الوكيل · §53 التسليم · §57 القفل الساكن · §50 الخزنة · §58 قفل الخزنة · §59 مفاتيح الأجهزة
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
  bash .zscripts/boot-e60.sh || { echo "FATAL: boot failed"; exit 1; }
  echo "--- §60 أنواع الدفع الكاملة من الهاتف (بوابة جديدة) ---"
  node scripts/agent-handoff-kinds-e2e.mjs --app http://127.0.0.1:3000 --dir /tmp/nexuslink-e60-live 2>&1 | tail -1
  echo "--- انحدار §56 جسر الوكيل المحمول ---"
  node scripts/agent-bridge-e2e.mjs --app http://127.0.0.1:3000 --dir /tmp/nexuslink-e60-live 2>&1 | tail -1
  echo "--- انحدار §53 التسليم اليدوي ---"
  node scripts/handoff-e2e.mjs --app http://127.0.0.1:3000 --dir /tmp/nexuslink-e60-live 2>&1 | tail -1
  echo "--- انحدار §57 قفل التسليم الساكن ---"
  node scripts/handoff-rest-e2e.mjs --app http://127.0.0.1:3000 --dir /tmp/nexuslink-e60-live 2>&1 | tail -1
  echo "--- انحدار §50 خزنة الحافظة الذكية ---"
  node scripts/clip-vault-e2e.mjs --app http://127.0.0.1:3000 2>&1 | tail -1
  echo "--- انحدار §58 قفل الخزنة الساكن ---"
  node scripts/clip-rest-e2e.mjs --app http://127.0.0.1:3000 --db /tmp/nexuslink-e60-live/db/custom.db 2>&1 | tail -1
  echo "--- انحدار §59 مفاتيح الأجهزة ---"
  node scripts/clip-multikey-e2e.mjs --app http://127.0.0.1:3000 --db /tmp/nexuslink-e60-live/db/custom.db 2>&1 | tail -1
}

run_round "${1:-1}"
run_round "${2:-2}"
echo "════ انتهت الجولتان ════"
