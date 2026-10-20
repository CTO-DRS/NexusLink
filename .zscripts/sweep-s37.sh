#!/bin/bash
# §37 — المسحة المتصفحية الحية الكاملة (استدعاء واحد: إقلاع → مسح → لقطات → تنظيف)
set -u
cd /home/z/my-project
ZS=/home/z/my-project/.zshots
mkdir -p "$ZS"

echo "== [1] إقلاع الكومة =="
nohup setsid bash .zscripts/dev.sh > /tmp/devstack-sweep.log 2>&1 < /dev/null &
NEXTUP=""
for i in $(seq 1 45); do
  H=$(curl -s -m 2 http://127.0.0.1:3000/api/health 2>/dev/null)
  if echo "$H" | grep -q '"ok":true'; then NEXTUP=1; echo "next up (${i})"; break; fi
  sleep 4
done
if [ -z "$NEXTUP" ]; then echo "FATAL: next لم ينتبض"; tail -5 /tmp/devstack-sweep.log; exit 1; fi
GW=""
for i in $(seq 1 20); do
  for p in 8180 81; do
    G=$(curl -s -m 2 "http://127.0.0.1:$p/__gw/health" 2>/dev/null)
    if echo "$G" | grep -q '"role":"gateway"'; then GW=$p; break 2; fi
  done
  sleep 3
done
echo "gateway=${GW:-NONE}"
COMMS=$(curl -s -m 2 http://127.0.0.1:3003/status 2>/dev/null | head -c 60)
echo "comms=${COMMS:0:50}"
LAN=$(node -e "const os=require('os');for(const v of Object.values(os.networkInterfaces()))for(const a of v||[])if(!a.internal&&a.family==='IPv4'){console.log(a.address);process.exit(0)}")
echo "LAN=$LAN"
curl -s -m 3 -X POST http://127.0.0.1:3000/api/desktop/status > /dev/null 2>&1 || true

echo "== [2] المسحة: بطاقة الإعدادات =="
AB="agent-browser"
$AB set viewport 1440 900 2>/dev/null
$AB open "http://127.0.0.1:3000/?app=1" > /dev/null 2>&1
sleep 10
# إغلاق حوار الترحيب إن ظهر (يغطي التطبيق كله)
$AB find role button click --name "Close" > /dev/null 2>&1 || $AB press Escape > /dev/null 2>&1
sleep 2
$AB find role button click --name "Close" > /dev/null 2>&1 || true
sleep 1
# التنقل إلى الإعدادات: زر الإعدادات في الشريط الجانبي
$AB find text "الإعدادات" click 2>&1 | head -1
sleep 5
$AB wait --text "الوصول البعيد" --timeout 30000 2>/dev/null || { echo "FATAL: بطاقة الوصول البعيد غير ظاهرة"; $AB snapshot -c 2>/dev/null | head -30; }
CARD_ON=$($AB eval "!!document.querySelector('[data-remote-access-card]')" 2>/dev/null)
echo "card present: $CARD_ON"
STATUS_OFF=$($AB eval "document.querySelector('[data-ra-status]')?.getAttribute('data-ra-status')" 2>/dev/null)
echo "status: $STATUS_OFF"
$AB scrollintoview "[data-remote-access-card]" > /dev/null 2>&1
$AB screenshot "$ZS/s37-card-off.png" > /dev/null 2>&1
echo "shot1: card-off"

echo "== [3] التمكين الحي من البطاقة =="
$AB click "[data-ra-enable]" > /dev/null 2>&1
sleep 3
ISSUED=$($AB eval "!!document.querySelector('[data-ra-issued]')" 2>/dev/null)
URLT=$($AB eval "document.querySelector('[data-ra-url]')?.textContent?.trim() || ''" 2>/dev/null)
echo "issued panel: $ISSUED"
echo "url head: ${URLT:0:60}..."
TOKEN=$(echo "$URLT" | sed -n 's/.*pair=\([A-Za-z0-9_-]*\).*/\1/p')
echo "token len: ${#TOKEN}"
$AB screenshot "$ZS/s37-issued-once.png" > /dev/null 2>&1
FP=$($AB eval "document.querySelector('[data-ra-fp]')?.getAttribute('data-ra-fp') || ''" 2>/dev/null)
echo "fingerprint: $FP"

echo "== [4] العميل الوِب عبر البوابة من LAN — الحجب ثم الرمز =="
$AB open "http://$LAN:$GW/web-client/index.html" > /dev/null 2>&1
sleep 2
BLOCKED=$($AB eval "document.body?.innerText?.slice(0,120) || ''" 2>/dev/null | head -c 120)
echo "LAN no-token body: $BLOCKED"
$AB screenshot "$ZS/s37-lan-blocked.png" > /dev/null 2>&1
$AB open "http://$LAN:$GW/web-client/index.html?pair=$TOKEN" > /dev/null 2>&1
sleep 5
CLIENT=$($AB eval "!!document.querySelector('[data-client=\"nexus-web\"]')" 2>/dev/null)
APIOK=$($AB eval "fetch('/api/version').then(r=>r.status).catch(e=>'ERR')" 2>/dev/null)
echo "client via LAN+token: $CLIENT / api fetch status: $APIOK"
$AB screenshot "$ZS/s37-lan-client.png" > /dev/null 2>&1

echo "== [5] عودة للبطاقة: التعطيل والعودة للتاريخي =="
$AB open "http://127.0.0.1:3000/?app=1" > /dev/null 2>&1
sleep 8
$AB find role button click --name "Close" > /dev/null 2>&1 || $AB press Escape > /dev/null 2>&1
sleep 2
$AB find text "الإعدادات" click > /dev/null 2>&1
sleep 4
$AB click "[data-ra-disable]" > /dev/null 2>&1
sleep 3
STATUS_END=$($AB eval "document.querySelector('[data-ra-status]')?.getAttribute('data-ra-status')" 2>/dev/null)
ISSUED_END=$($AB eval "!!document.querySelector('[data-ra-issued]')" 2>/dev/null)
echo "status after disable: $STATUS_END / issued panel gone: $([ "$ISSUED_END" = "false" ] && echo yes || echo no)"
$AB screenshot "$ZS/s37-card-off-end.png" > /dev/null 2>&1

echo "== [6] فحوص الإغلاق =="
echo "-- console errors:"
$AB console 2>/dev/null | grep -iE "error" | grep -vE "401|pair-token" | head -5 || echo "(صفر أخطاء console غير المتوقعة)"
echo "-- API حالة نهائية:"
curl -s -m 3 http://127.0.0.1:3000/api/remote-access | head -c 80; echo
echo "-- ملف الرمز:"
ls /home/z/my-project/.zstate/pair-token.json 2>/dev/null || echo "محذوف ✓"

$AB close > /dev/null 2>&1
echo "== [7] تنظيف الكومة =="
pkill -9 -f "my-project/.next/standalone/server.js" 2>/dev/null
pkill -9 -f "next-server" 2>/dev/null
pkill -9 -f "resources/gateway/gateway.cjs" 2>/dev/null
pkill -9 -f "resources/comms/comms.cjs" 2>/dev/null
pkill -9 -f "next dev" 2>/dev/null
pkill -9 -f "zscripts/dev.sh" 2>/dev/null
rm -f /home/z/my-project/.zstate/pair-token.json
sleep 2
echo "SWEEP DONE"
ls -la "$ZS"/s37-*.png 2>/dev/null
