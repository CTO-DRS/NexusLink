#!/bin/bash
# إقلاع المكدس الحي الربعي — نمط E2E الحرفي (standalone إنتاجي)
# كل خدمة setsid مستقلة تنجو عبر الاستدعاءات (قانون ops) —
# الجسور تُقلع آليًا بضربة /api/desktop/status (نمط E2E [2]).
cd /home/z/my-project

pkill -f "standalone/server.js" 2>/dev/null
pkill -f "gateway/gateway.cjs" 2>/dev/null
pkill -f "comms/comms.cjs" 2>/dev/null
pkill -f "next dev" 2>/dev/null
sleep 1

# [1] Next standalone على 3000 (نفس متغيرات E2E)
setsid nohup env PORT=3000 HOSTNAME=127.0.0.1 NODE_ENV=production \
  NEXUS_WOL_BROADCAST=127.0.0.1 NEXUS_WOL_PORT=9009 \
  node .next/standalone/server.js > .zscripts/live-next.log 2>&1 < /dev/null &
echo "next standalone booting..."

for i in $(seq 1 60); do
  if curl -s --max-time 2 http://127.0.0.1:3000/api/health | grep -q '"ok":true'; then break; fi
  sleep 1
done
echo "next: $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/health)"

# [2] إيقاظ الجسور المدمجة (3004/3005/3006/3007/3009) — نمط E2E [2]
curl -s --max-time 20 http://127.0.0.1:3000/api/desktop/status > /dev/null
echo "bridges awake"

# [3] البوابة (81 → 8180 عند الحجب — node لا bun: غيّة bun الموثقة)
setsid nohup node apps/desktop/src-tauri/resources/gateway/gateway.cjs \
  > .zscripts/live-gateway.log 2>&1 < /dev/null &
echo "gateway booting..."

# [4] comms (3003 + mDNS بالمنفذ الفعلي — البوابة 8180 المحجوزة هنا)
sleep 2
setsid nohup env PORT=3003 NEXT_BASE="http://127.0.0.1:3000" NEXUSLINK_NAME="NEXUS-PC" NEXUSLINK_GATEWAY_PORT=8180 \
  node apps/desktop/src-tauri/resources/comms/comms.cjs \
  > .zscripts/live-comms.log 2>&1 < /dev/null &
echo "comms booting..."

sleep 6
echo "=== health ==="
echo "3000: $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/health)"
echo "8180: $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8180/__gw/health)"
echo "3003: $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3003/status)"
echo "gw->3004: $(curl -s -o /dev/null -w '%{http_code}' 'http://127.0.0.1:8180/status?XTransformPort=3004') (400=engine.io guard=alive)"
