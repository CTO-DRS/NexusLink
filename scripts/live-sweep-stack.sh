#!/bin/bash
# مسحة حية شاملة على المكدس الحقيقي — داخل استدعاء واحد (القيد البيئي الجديد:
# حتى setsid لا تنجو عبر الاستدعاءات — الإقلاع الحي أصبح داخل-استدعاء بنمط E2E).
# السلسلة الكاملة عبر البوابة 8180: إقلاع → QR → pair → أول قيمة (3007) → القياس.
set -u
cd /home/z/my-project

pkill -f "standalone/server.js" 2>/dev/null
pkill -f "gateway/gateway.cjs" 2>/dev/null
pkill -f "comms/comms.cjs" 2>/dev/null
pkill -f "next dev" 2>/dev/null
sleep 1

echo "== [1] next standalone :3000 =="
env PORT=3000 HOSTNAME=127.0.0.1 NODE_ENV=production \
  NEXUS_WOL_BROADCAST=127.0.0.1 NEXUS_WOL_PORT=9009 \
  node .next/standalone/server.js > .zscripts/live-next.log 2>&1 < /dev/null &
NEXT_BG=$!

for i in $(seq 1 60); do
  if curl -s --max-time 2 http://127.0.0.1:3000/api/health | grep -q '"ok":true'; then break; fi
  sleep 1
done
echo "3000 health: $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/health)"

echo "== [2] wake bridges (3004/3005/3006/3007/3009) =="
curl -s --max-time 25 http://127.0.0.1:3000/api/desktop/status > /dev/null
sleep 1

echo "== [3] gateway :8180 =="
env GATEWAY_PORT=81 REST_PORT=3000 node apps/desktop/src-tauri/resources/gateway/gateway.cjs \
  > .zscripts/live-gateway.log 2>&1 < /dev/null &
GW_BG=$!
for i in $(seq 1 40); do
  if curl -s --max-time 2 http://127.0.0.1:8180/__gw/health | grep -q '"role":"gateway"'; then break; fi
  sleep 1
done
echo "8180 health: $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8180/__gw/health)"

echo "== [4] comms :3003 =="
env PORT=3003 NEXT_BASE="http://127.0.0.1:3000" NEXUSLINK_NAME="NEXUS-PC" NEXUSLINK_GATEWAY_PORT=8180 \
  node apps/desktop/src-tauri/resources/comms/comms.cjs \
  > .zscripts/live-comms.log 2>&1 < /dev/null &
COMMS_BG=$!
for i in $(seq 1 30); do
  if curl -s --max-time 2 http://127.0.0.1:3003/status | grep -q '"role":"comms"'; then break; fi
  sleep 1
done

echo "== [5] الربعي الحي =="
H3000=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/health)
H8180=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8180/__gw/health)
H3003=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3003/status)
H3004=$(curl -s -o /dev/null -w '%{http_code}' 'http://127.0.0.1:8180/status?XTransformPort=3004')
echo "3000=$H3000 8180=$H8180 3003=$H3003 gw->3004=$H3004 (400=engine.io guard=alive)"

echo "== [6] مسحة PAIR-MET عبر البوابة حصرًا =="
 node scripts/pair-live-sweep.mjs 2>&1 || true
echo "== [7] نظيفة =="
kill -9 $NEXT_BG $GW_BG $COMMS_BG 2>/dev/null
pkill -f "standalone/server.js" 2>/dev/null
pkill -f "gateway/gateway.cjs" 2>/dev/null
pkill -f "comms/comms.cjs" 2>/dev/null
echo "done"
