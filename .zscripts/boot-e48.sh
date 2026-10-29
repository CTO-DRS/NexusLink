#!/bin/bash
# §48 — إقلاع تطبيق Next.js ببيئة بوابة emergency-e2e (الطور ب)
# السياسة والرمز والسجل وحالة الطوارئ في مجلد حي مشترك مع البوابة —
# السياسة غير المُدارة تفتح تمكين رمز §37 (ليُختبر تدويره لحظة القتل)،
# وحالة الطوارئ تبدأ غائبة = غير مُسلَّح نظيفًا.
set -u
cd /home/z/my-project/NexusLink
E48=/tmp/nexuslink-e48-live
mkdir -p "$E48"
cat > "$E48/policy.json" << 'EOF'
{ "schemaVersion": 2, "organization": "E2E Emergency Org", "managed": {} }
EOF
rm -f "$E48/pair-token.json" "$E48/audit.jsonl" "$E48/emergency-kill.json"

export NEXUSLINK_POLICY_FILE="$E48/policy.json"
export NEXUSLINK_PAIR_FILE="$E48/pair-token.json"
export NEXUSLINK_AUDIT_FILE="$E48/audit.jsonl"
export NEXUSLINK_EMERGENCY_FILE="$E48/emergency-kill.json"

nohup setsid bun run dev > /tmp/e48-dev.log 2>&1 < /dev/null &
for i in $(seq 1 60); do
  H=$(curl -s -m 2 http://127.0.0.1:3000/api/health 2>/dev/null)
  echo "$H" | grep -q '"ok":true' && { echo "UP after ${i} probes"; exit 0; }
  sleep 4
done
echo "FATAL: app not up — tail:"; tail -5 /tmp/e48-dev.log
exit 1
