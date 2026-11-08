#!/bin/bash
# §56 — إقلاع تطبيق Next.js ببيئة بوابة عقد الوكيل المحمول (نمط boot-e55)
set -u
cd /home/z/my-project/nexuslink
E56=/tmp/nexuslink-e56-live
mkdir -p "$E56"
# حالة نظيفة: لا قائمة تسليم ولا جلسات مسح + سجل تدقيق جديد
rm -f "$E56/handoff.json" "$E56/audit.jsonl"
rm -rf "$E56/scans"

export DATABASE_URL="file:/home/z/my-project/nexuslink/db/custom.db"
export NEXUSLINK_HANDOFF_FILE="$E56/handoff.json"
export NEXUSLINK_SCANS_DIR="$E56/scans"
export NEXUSLINK_AUDIT_FILE="$E56/audit.jsonl"

nohup setsid env DATABASE_URL="$DATABASE_URL" NEXUSLINK_HANDOFF_FILE="$NEXUSLINK_HANDOFF_FILE" NEXUSLINK_SCANS_DIR="$NEXUSLINK_SCANS_DIR" NEXUSLINK_AUDIT_FILE="$NEXUSLINK_AUDIT_FILE" bun run dev > /tmp/e56-dev.log 2>&1 < /dev/null &
for i in $(seq 1 75); do
  H=$(curl -s -m 2 http://127.0.0.1:3000/api/health 2>/dev/null)
  echo "$H" | grep -q '"ok":true' && { echo "UP after ${i} probes"; exit 0; }
  sleep 4
done
echo "FATAL: app not up — tail:"; tail -8 /tmp/e56-dev.log
exit 1
