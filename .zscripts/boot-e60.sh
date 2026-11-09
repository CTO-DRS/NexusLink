#!/bin/bash
# §60 — إقلاع تطبيق Next.js ببيئة بوابة أنواع الدفع الكاملة من الهاتف
# قاعدة معزولة: نسخة طازجة من بذرة db/custom.db في مجلد حي — درس §58/§59:
# البرهان البايتي لا يلمس قاعدة التطوير أبدًا وكل جولة تبدأ من بذرة نظيفة.
set -u
cd "$(cd "$(dirname "$0")/.." && pwd)"
E60=/tmp/nexuslink-e60-live
mkdir -p "$E60/db"
# حالة نظيفة: قاعدة طازجة + سجل تدقيق جديد + بلا قائمة تسليم ولا جلسات مسح
rm -f "$E60"/db/custom.db "$E60"/db/custom.db-wal "$E60"/db/custom.db-shm "$E60"/audit.jsonl "$E60"/handoff.json
rm -rf "$E60/scans"
cp db/custom.db "$E60/db/custom.db"

export DATABASE_URL="file:/tmp/nexuslink-e60-live/db/custom.db"
export NEXUSLINK_HANDOFF_FILE="$E60/handoff.json"
export NEXUSLINK_SCANS_DIR="$E60/scans"
export NEXUSLINK_AUDIT_FILE="$E60/audit.jsonl"

nohup setsid env DATABASE_URL="$DATABASE_URL" NEXUSLINK_HANDOFF_FILE="$NEXUSLINK_HANDOFF_FILE" NEXUSLINK_SCANS_DIR="$NEXUSLINK_SCANS_DIR" NEXUSLINK_AUDIT_FILE="$NEXUSLINK_AUDIT_FILE" bun run dev > /tmp/e60-dev.log 2>&1 < /dev/null &
UP=0
for i in $(seq 1 75); do
  H=$(curl -s -m 2 http://127.0.0.1:3000/api/health 2>/dev/null)
  echo "$H" | grep -q '"ok":true' && { echo "UP after ${i} probes"; UP=1; break; }
  sleep 4
done
if [ "$UP" -ne 1 ]; then
  echo "FATAL: app not up — tail:"; tail -8 /tmp/e60-dev.log
  exit 1
fi
# إيقاظ الجسور المدمجة (3007 للسوكِت — بوابة §59 ضمن البطارية) — نمط boot-live-stack [2]
curl -s --max-time 20 http://127.0.0.1:3000/api/desktop/status > /dev/null
sleep 2
exit 0
