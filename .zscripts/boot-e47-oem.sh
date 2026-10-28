#!/bin/bash
# §47 — إقلاع OEM لانحدار §40 (نفس بيئة البوابة + علم المولود خاصًا)
set -u
cd /home/z/my-project/NexusLink
E47=/tmp/nexuslink-e47-live
mkdir -p "$E47"
cat > "$E47/policy.json" << 'EOF2'
{ "schemaVersion": 2, "organization": "E2E Live Org", "managed": {} }
EOF2
rm -f "$E47/pair-token.json" "$E47/audit.jsonl"
export NEXUSLINK_POLICY_FILE="$E47/policy.json"
export NEXUSLINK_PAIR_FILE="$E47/pair-token.json"
export NEXUSLINK_AUDIT_FILE="$E47/audit.jsonl"
export NEXUSLINK_OEM_PRIVACY=1
nohup setsid bun run dev > /tmp/e47-dev-oem.log 2>&1 < /dev/null &
for i in $(seq 1 60); do
  H=$(curl -s -m 2 http://127.0.0.1:3000/api/health 2>/dev/null)
  echo "$H" | grep -q '"ok":true' && { echo "UP after ${i} probes"; exit 0; }
  sleep 4
done
echo "FATAL: app not up"; tail -5 /tmp/e47-dev-oem.log; exit 1
