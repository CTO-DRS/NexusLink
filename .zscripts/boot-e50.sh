#!/bin/bash
# §50–§52 — إقلاع تطبيق Next.js ببيئة بوابات الخزنة والضيف والتركيز (الطور ب)
# ملفات الحالة في مجلد حي مشترك — المسار يقرأها لحظيًا (نمط §37/§48/§49).
set -u
cd /home/z/my-project/nexuslink_repo
E50=/tmp/nexuslink-e50-live
mkdir -p "$E50"
# حالة نظيفة: لا ضيف ولا تركيز + سجل تدقيق جديد
rm -f "$E50/guest-share.json" "$E50/focus.json" "$E50/audit.jsonl"

export DATABASE_URL="file:/home/z/my-project/nexuslink_repo/db/custom.db"
export NEXUSLINK_GUEST_FILE="$E50/guest-share.json"
export NEXUSLINK_FOCUS_FILE="$E50/focus.json"
export NEXUSLINK_AUDIT_FILE="$E50/audit.jsonl"

nohup setsid env DATABASE_URL="$DATABASE_URL" NEXUSLINK_GUEST_FILE="$NEXUSLINK_GUEST_FILE" NEXUSLINK_FOCUS_FILE="$NEXUSLINK_FOCUS_FILE" NEXUSLINK_AUDIT_FILE="$NEXUSLINK_AUDIT_FILE" bun run dev > /tmp/e50-dev.log 2>&1 < /dev/null &
for i in $(seq 1 75); do
  H=$(curl -s -m 2 http://127.0.0.1:3000/api/health 2>/dev/null)
  echo "$H" | grep -q '"ok":true' && { echo "UP after ${i} probes"; exit 0; }
  sleep 4
done
echo "FATAL: app not up — tail:"; tail -8 /tmp/e50-dev.log
exit 1
