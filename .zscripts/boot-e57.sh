#!/bin/bash
# §57 — إقلاع تطبيق Next.js ببيئة بوابة قفل التسليم الساكن (نمط boot-e53)
# ملف الحالة في مجلد حي مشترك — المسار يقرأه لحظيًا.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
E57=/tmp/nexuslink-e57-live
mkdir -p "$E57"
# حالة نظيفة: لا قائمة تسليم + سجل تدقيق جديد (المفتاح يبقى في القاعدة — قصد)
rm -f "$E57/handoff.json" "$E57/audit.jsonl"

export DATABASE_URL="file:$ROOT/db/custom.db"
export NEXUSLINK_HANDOFF_FILE="$E57/handoff.json"
export NEXUSLINK_AUDIT_FILE="$E57/audit.jsonl"

nohup setsid env DATABASE_URL="$DATABASE_URL" NEXUSLINK_HANDOFF_FILE="$NEXUSLINK_HANDOFF_FILE" NEXUSLINK_AUDIT_FILE="$NEXUSLINK_AUDIT_FILE" bun run dev > /tmp/e57-dev.log 2>&1 < /dev/null &
for i in $(seq 1 75); do
  H=$(curl -s -m 2 http://127.0.0.1:3000/api/health 2>/dev/null)
  echo "$H" | grep -q '"ok":true' && { echo "UP after ${i} probes"; exit 0; }
  sleep 4
done
echo "FATAL: app not up — tail:"; tail -8 /tmp/e57-dev.log
exit 1
