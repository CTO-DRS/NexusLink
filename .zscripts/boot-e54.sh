#!/bin/bash
# §53+§54 — إقلاع تطبيق Next.js ببيئة بوابات التسليم اليدوي والدرع المشفّر
# ملفات الحالة في مجلد حي مشترك — المسارات تقرأها لحظيًا (نمط §37/§48/§49/§50).
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
E54=/tmp/nexuslink-e54-live
mkdir -p "$E54"
# حالة نظيفة: لا قائمة تسليم ولا نسخ ولا جدولة + سجل تدقيق جديد
rm -f "$E54/handoff.json" "$E54/backup-secure.json" "$E54/audit.jsonl"
rm -rf "$E54/backups"

export DATABASE_URL="file:$ROOT/db/custom.db"
export NEXUSLINK_HANDOFF_FILE="$E54/handoff.json"
export NEXUSLINK_BACKUP_DIR="$E54/backups"
export NEXUSLINK_BACKUP_SCHEDULE_FILE="$E54/backup-secure.json"
export NEXUSLINK_AUDIT_FILE="$E54/audit.jsonl"

nohup setsid env DATABASE_URL="$DATABASE_URL" NEXUSLINK_HANDOFF_FILE="$NEXUSLINK_HANDOFF_FILE" NEXUSLINK_BACKUP_DIR="$NEXUSLINK_BACKUP_DIR" NEXUSLINK_BACKUP_SCHEDULE_FILE="$NEXUSLINK_BACKUP_SCHEDULE_FILE" NEXUSLINK_AUDIT_FILE="$NEXUSLINK_AUDIT_FILE" bun run dev > /tmp/e54-dev.log 2>&1 < /dev/null &
for i in $(seq 1 75); do
  H=$(curl -s -m 2 http://127.0.0.1:3000/api/health 2>/dev/null)
  echo "$H" | grep -q '"ok":true' && { echo "UP after ${i} probes"; exit 0; }
  sleep 4
done
echo "FATAL: app not up — tail:"; tail -8 /tmp/e54-dev.log
exit 1
