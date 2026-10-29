#!/bin/bash
# §39 — إقلاع تطبيق Next.js ببيئة بوابة audit-e2e (الوصفة الأصلية الموثقة في worklog M4.2)
# الفارق الجوهري عن boot-e47: ملف السياسة «غائب» عند الإقلاع — الجهاز unmanaged
# من اللحظة الأولى فتتوقع جولة §39 من.state=unmanaged في S6 — والملفات الثلاثة نظيفة.
# (درس إصدار v3.1.0: boot-e47 بسياسة managed:{} يجعل from.state=managed فتفشل S6 وحدها)
set -u
cd /home/z/my-project/NexusLink
E39=/tmp/nexuslink-e39-live
mkdir -p "$E39"
rm -f "$E39/policy.json" "$E39/pair-token.json" "$E39/audit.jsonl"

export NEXUSLINK_POLICY_FILE="$E39/policy.json"
export NEXUSLINK_PAIR_FILE="$E39/pair-token.json"
export NEXUSLINK_AUDIT_FILE="$E39/audit.jsonl"

nohup setsid bun run dev > /tmp/e39-dev.log 2>&1 < /dev/null &
for i in $(seq 1 60); do
  H=$(curl -s -m 2 http://127.0.0.1:3000/api/health 2>/dev/null)
  echo "$H" | grep -q '"ok":true' && { echo "UP after ${i} probes"; exit 0; }
  sleep 4
done
echo "FATAL: app not up — tail:"; tail -5 /tmp/e39-dev.log
exit 1
