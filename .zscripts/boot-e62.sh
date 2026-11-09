#!/bin/bash
# §62 — إقلاع تطبيق Next.js ببيئة بوابة معاينة المعالجة الحية
# قاعدة معزولة: نسخة طازجة من بذرة db/custom.db في مجلد حي — درس §58/§59.
set -u
cd "$(cd "$(dirname "$0")/.." && pwd)"
E62=/tmp/nexuslink-e62-live
mkdir -p "$E62/db"
rm -f "$E62"/db/custom.db "$E62"/db/custom.db-wal "$E62"/db/custom.db-shm "$E62"/audit.jsonl "$E62"/handoff.json
rm -rf "$E62/scans"
cp db/custom.db "$E62/db/custom.db"

export DATABASE_URL="file:/tmp/nexuslink-e62-live/db/custom.db"
export NEXUSLINK_HANDOFF_FILE="$E62/handoff.json"
export NEXUSLINK_SCANS_DIR="$E62/scans"
export NEXUSLINK_AUDIT_FILE="$E62/audit.jsonl"

nohup setsid env DATABASE_URL="$DATABASE_URL" NEXUSLINK_HANDOFF_FILE="$NEXUSLINK_HANDOFF_FILE" NEXUSLINK_SCANS_DIR="$NEXUSLINK_SCANS_DIR" NEXUSLINK_AUDIT_FILE="$NEXUSLINK_AUDIT_FILE" bun run dev > /tmp/e62-dev.log 2>&1 < /dev/null &
UP=0
for i in $(seq 1 75); do
  H=$(curl -s -m 2 http://127.0.0.1:3000/api/health 2>/dev/null)
  echo "$H" | grep -q '"ok":true' && { echo "UP after ${i} probes"; UP=1; break; }
  sleep 4
done
if [ "$UP" -ne 1 ]; then
  echo "FATAL: app not up — tail:"; tail -8 /tmp/e62-dev.log
  exit 1
fi
curl -s --max-time 20 http://127.0.0.1:3000/api/desktop/status > /dev/null
sleep 2
exit 0
