#!/bin/bash
# §53–§55 — إقلاع تطبيق Next.js ببيئة بوابات الموجة الثانية كاملة
# التسليم اليدوي + الدرع المشفّر + الماسح الموثق (نمط boot-e50/boot-e54)
set -u
cd /home/z/my-project/nexuslink_repo
E55=/tmp/nexuslink-e55-live
mkdir -p "$E55"
# حالة نظيفة: لا قائمة تسليم ولا نسخ ولا جلسات مسح + سجل تدقيق جديد
rm -f "$E55/handoff.json" "$E55/backup-secure.json" "$E55/audit.jsonl"
rm -rf "$E55/backups" "$E55/scans"

export DATABASE_URL="file:/home/z/my-project/nexuslink_repo/db/custom.db"
export NEXUSLINK_HANDOFF_FILE="$E55/handoff.json"
export NEXUSLINK_BACKUP_DIR="$E55/backups"
export NEXUSLINK_BACKUP_SCHEDULE_FILE="$E55/backup-secure.json"
export NEXUSLINK_SCANS_DIR="$E55/scans"
export NEXUSLINK_AUDIT_FILE="$E55/audit.jsonl"

nohup setsid env DATABASE_URL="$DATABASE_URL" NEXUSLINK_HANDOFF_FILE="$NEXUSLINK_HANDOFF_FILE" NEXUSLINK_BACKUP_DIR="$NEXUSLINK_BACKUP_DIR" NEXUSLINK_BACKUP_SCHEDULE_FILE="$NEXUSLINK_BACKUP_SCHEDULE_FILE" NEXUSLINK_SCANS_DIR="$NEXUSLINK_SCANS_DIR" NEXUSLINK_AUDIT_FILE="$NEXUSLINK_AUDIT_FILE" bun run dev > /tmp/e55-dev.log 2>&1 < /dev/null &
for i in $(seq 1 75); do
  H=$(curl -s -m 2 http://127.0.0.1:3000/api/health 2>/dev/null)
  echo "$H" | grep -q '"ok":true' && { echo "UP after ${i} probes"; exit 0; }
  sleep 4
done
echo "FATAL: app not up — tail:"; tail -8 /tmp/e55-dev.log
exit 1
