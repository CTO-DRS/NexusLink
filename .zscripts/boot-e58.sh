#!/bin/bash
# §58 — إقلاع تطبيق Next.js ببيئة بوابة قفل الخزنة الساكن (نمط boot-e57)
# قاعدة معزولة: نسخة طازجة من بذرة db/custom.db في مجلد حي — البرهان الجوهري
# (قراءة بايتات القاعدة) لا يلمس قاعدة التطوير أبدًا.
set -u
cd /home/z/my-project/nexuslink_repo
E58=/tmp/nexuslink-e58-live
mkdir -p "$E58/db"
# حالة نظيفة: نسخة قاعدة طازجة + سجل تدقيق جديد + بلا قائمة تسليم (المفتاحان يبقيان في القاعدة — قصد)
rm -f "$E58"/db/custom.db "$E58"/db/custom.db-wal "$E58"/db/custom.db-shm "$E58"/audit.jsonl "$E58"/handoff.json
cp db/custom.db "$E58/db/custom.db"

export DATABASE_URL="file:/tmp/nexuslink-e58-live/db/custom.db"
export NEXUSLINK_AUDIT_FILE="$E58/audit.jsonl"
export NEXUSLINK_HANDOFF_FILE="$E58/handoff.json"

nohup setsid env DATABASE_URL="$DATABASE_URL" NEXUSLINK_AUDIT_FILE="$NEXUSLINK_AUDIT_FILE" NEXUSLINK_HANDOFF_FILE="$NEXUSLINK_HANDOFF_FILE" bun run dev > /tmp/e58-dev.log 2>&1 < /dev/null &
UP=0
for i in $(seq 1 75); do
  H=$(curl -s -m 2 http://127.0.0.1:3000/api/health 2>/dev/null)
  echo "$H" | grep -q '"ok":true' && { echo "UP after ${i} probes"; UP=1; break; }
  sleep 4
done
if [ "$UP" -ne 1 ]; then
  echo "FATAL: app not up — tail:"; tail -8 /tmp/e58-dev.log
  exit 1
fi
# إيقاظ الجسور المدمجة (3007 للسوكِت حصرًا يلزمنا هنا) — نمط boot-live-stack [2]
curl -s --max-time 20 http://127.0.0.1:3000/api/desktop/status > /dev/null
sleep 2
echo "bridges awake"
exit 0
