#!/bin/bash
# §37 — الإثبات النهائي المصغر: تمكين بـcurl → عميل LAN بالرمز → fetch بالترويسة → تعطيل
set -u
cd /home/z/my-project
ZS=/home/z/my-project/.zshots
nohup setsid bash .zscripts/dev.sh > /tmp/devstack-p.log 2>&1 < /dev/null &
UP=""
for i in $(seq 1 45); do
  H=$(curl -s -m 2 http://127.0.0.1:3000/api/health 2>/dev/null)
  echo "$H" | grep -q '"ok":true' && { UP=1; echo "next up (${i})"; break; }
  sleep 4
done
[ -z "$UP" ] && { echo "FATAL next"; exit 1; }
GW=""
for i in $(seq 1 20); do
  for p in 8180 81; do
    curl -s -m 2 "http://127.0.0.1:$p/__gw/health" 2>/dev/null | grep -q '"role":"gateway"' && { GW=$p; break 2; }
  done
  sleep 3
done
echo "gateway=$GW"
LAN=$(node -e "const os=require('os');for(const v of Object.values(os.networkInterfaces()))for(const a of v||[])if(!a.internal&&a.family==='IPv4'){console.log(a.address);process.exit(0)}")

EN=$(curl -s -m 5 -X POST http://127.0.0.1:3000/api/remote-access -H 'content-type: application/json' -d '{"action":"enable"}')
TOKEN=$(echo "$EN" | python3 -c "import json,sys; print(json.load(sys.stdin).get('token',''))")
echo "token len: ${#TOKEN} fp: $(echo "$EN" | python3 -c "import json,sys; print(json.load(sys.stdin).get('fingerprint',''))")"

AB="agent-browser"
$AB set viewport 1440 900 2>/dev/null
$AB open "http://$LAN:$GW/web-client/index.html?pair=$TOKEN" > /dev/null 2>&1
sleep 5
CLIENT=$($AB eval "!!document.querySelector('[data-client=\"nexus-web\"]')" 2>/dev/null)
WITHHDR=$($AB eval "fetch('/api/version',{headers:{'x-pair-token':'$TOKEN'}}).then(r=>r.status).catch(e=>'ERR')" 2>/dev/null)
BADHDR=$($AB eval "fetch('/api/version',{headers:{'x-pair-token':'bad-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'}}).then(r=>r.status).catch(e=>'ERR')" 2>/dev/null)
echo "client: $CLIENT / fetch WITH token: $WITHHDR / fetch BAD token: $BADHDR"
$AB screenshot "$ZS/s37-lan-client-live.png" > /dev/null 2>&1
$AB close > /dev/null 2>&1

echo "-- disable:"
curl -s -m 5 -X POST http://127.0.0.1:3000/api/remote-access -H 'content-type: application/json' -d '{"action":"disable"}' | head -c 60; echo
ls /home/z/my-project/.zstate/pair-token.json 2>/dev/null || echo "file gone ✓"

pkill -9 -f "my-project/.next/standalone/server.js" 2>/dev/null; pkill -9 -f "next-server" 2>/dev/null
pkill -9 -f "resources/gateway/gateway.cjs" 2>/dev/null; pkill -9 -f "resources/comms/comms.cjs" 2>/dev/null
pkill -9 -f "next dev" 2>/dev/null; pkill -9 -f "zscripts/dev.sh" 2>/dev/null
rm -f /home/z/my-project/.zstate/pair-token.json
echo "PROOF DONE"
