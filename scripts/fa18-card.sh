#!/bin/bash
# FA-18 — بطاقة واحدة: إقلاع المكدس + fa18-e2e (العمليات تموت بين الاستدعاءات — نمط موثق)
cd /home/z/my-project/nexuslink
pkill -f "standalone/server.js" 2>/dev/null; pkill -f "gateway/index.cjs" 2>/dev/null; sleep 1

setsid nohup env PORT=3000 HOSTNAME=127.0.0.1 NODE_ENV=production \
  NEXUS_WOL_BROADCAST=127.0.0.1 NEXUS_WOL_PORT=9009 \
  node .next/standalone/server.js > /tmp/live-next.log 2>&1 < /dev/null &
for i in $(seq 1 45); do curl -s --max-time 2 http://127.0.0.1:3000/api/health | grep -q '"ok":true' && break; sleep 1; done
echo "next: $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/health)"

curl -s --max-time 25 http://127.0.0.1:3000/api/desktop/status -o /dev/null -w "bridges:%{http_code}\n"
curl -s --max-time 10 http://127.0.0.1:3000/api/automation/boot -o /dev/null -w "auto-boot:%{http_code}\n"

setsid nohup env GATEWAY_PORT=8207 REST_PORT=3000 node mini-services/gateway/index.cjs > /tmp/live-gw.log 2>&1 < /dev/null &
for i in $(seq 1 20); do curl -s --max-time 2 "http://127.0.0.1:8207/__gw/health" | grep -q ok && break; sleep 1; done
echo "gw: $(curl -s -o /dev/null -w '%{http_code}' 'http://127.0.0.1:8207/__gw/health')"

echo "=== fa13-e2e round 1 ==="
node scripts/fa13-e2e.mjs
FA13_1=$?
echo "=== fa13-e2e round 2 ==="
node scripts/fa13-e2e.mjs
FA13_2=$?
echo "RESULTS fa13: r1=$FA13_1 r2=$FA13_2"
exit $(( FA13_1 | FA13_2 ))
