#!/usr/bin/env bash
# sp-live-verify.sh — التحقق الحي من نبض الخدمة الذاتي (§27.هـ)
# دورة كاملة داخل استدعاء واحد (البيئة تجني عمليات الخلفية):
# 1) إقلاع نظيف (dev :3000 + gateway :81) — بلا أي واجهة
# 2) عدّاد عينات قبل (Prisma مباشرة — لا API)
# 3) إشعال واحد: /api/automation/boot (مسار موثق §27.هـ) — لا /api/devices إطلاقًا
# 4) صمت 95 ثانية — لا استدعاءات ولا متصفح
# 5) عدّاد بعد → النمو = التوليد من الخادم بلا واجهة + حقل pulse في اللقطة
# 6) فتح المتصفح: شارة النبض الحية + المخططات → لقطات AR/EN + أخطاء الصفحة
set -u
cd /home/z/my-project
AB="agent-browser"
SS=/home/z/my-project/docs/screenshots
DBURL=$(grep '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | tr -d '"')

kill_all() {
  pkill -f "while true; do cd /home/z/my-project" 2>/dev/null
  pkill -f "next dev" 2>/dev/null; pkill -f "next-server" 2>/dev/null
  pkill -f "gateway.cjs" 2>/dev/null
  sleep 1
}

count_samples() {
  DATABASE_URL="$DBURL" node -e '
    const { PrismaClient } = require("@prisma/client");
    const p = new PrismaClient({ log: [] });
    p.nexusHealthSample.count().then((c) => { console.log(c); return p.$disconnect(); }).catch(() => { console.log("ERR"); process.exit(1); });
  ' 2>/dev/null
}

echo "── 1) إقلاع نظيف ──"
kill_all
( bun run dev >> dev.log 2>&1 & )
( PORT=81 node apps/desktop/src-tauri/resources/gateway/gateway.cjs >> dev.log 2>&1 & )
ok=""
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w "%{http_code}" -m 3 "http://127.0.0.1:3000/api/tools/ping" 2>/dev/null)
  [ "$code" = "200" ] && ok=yes && break
  sleep 1
done
[ -z "$ok" ] && { echo "❌ الخادم لم يقلع"; exit 1; }
gcode=$(curl -s -o /dev/null -w "%{http_code}" -m 3 "http://127.0.0.1:81/__gw/health" 2>/dev/null)
echo "server=200 gateway=$gcode"

echo "── 2) عدّاد قبل + إشعال واحد (بلا /api/devices إطلاقًا) ──"
BEFORE=$(count_samples)
echo "samples-before=$BEFORE"
curl -s -m 15 "http://127.0.0.1:3000/api/automation/boot" | head -c 200; echo

echo "── 3) صمت 95 ثانية — لا API ولا متصفح ──"
sleep 95

echo "── 4) الإثبات: النمو بلا واجهة + حقل pulse ──"
AFTER=$(count_samples)
echo "samples-after=$AFTER"
HEALTH=$(curl -s -m 15 "http://127.0.0.1:3000/api/devices/health?device=all&window=1h")
echo "$HEALTH" | python3 -c "
import json,sys
h=json.load(sys.stdin)
print('pulse=',json.dumps(h.get('pulse')))
print('counts=',json.dumps(h.get('counts')))
per=[(d['deviceId'],d['samples']) for d in h.get('devices',[])]
print('per-device=',per)
"
GROWN=$((AFTER - BEFORE))
[ "$GROWN" -ge 8 ] && echo "✅ نمت العينات $GROWN خلال صمت 95ث بلا أي واجهة (نبض ذاتي)" || echo "❌ نمو غير كافٍ: $GROWN"
echo "$HEALTH" | python3 -c "
import json,sys
h=json.load(sys.stdin)
p=h.get('pulse',{})
sys.exit(0 if p.get('active') and p.get('intervalMs')==4000 else 1)
" && echo "✅ pulse.active=true intervalMs=4000" || echo "❌ pulse غير صحيح"

echo "── 5) المتصفح: شارة النبض + اللقطات ──"
$AB open "http://127.0.0.1:81/?app=1" >/dev/null 2>&1
$AB wait --load networkidle >/dev/null 2>&1
sleep 6
BADGE=$($AB eval "
(() => {
  const b = document.querySelector('[data-testid=pulse-badge]');
  return b ? 'BADGE-OK: ' + b.textContent.trim() : 'badge-missing';
})()
" 2>/dev/null | tail -1)
echo "$BADGE"
$AB screenshot "$SS/sp-live-ar.png" 2>&1 | tail -1
$AB eval "
(() => {
  const btn = [...document.querySelectorAll('button,a')].find(x => x.textContent.trim() === 'EN');
  if (btn) { btn.click(); return 'en-ok'; }
  return 'en-toggle-missing';
})()
" >/dev/null 2>&1
sleep 2
ENBADGE=$($AB eval "
(() => {
  const b = document.querySelector('[data-testid=pulse-badge]');
  const lim = [...document.querySelectorAll('p')].some(x => x.textContent.includes('Measurement runs inside the server process'));
  return b ? 'EN-BADGE-OK: ' + b.textContent.trim() + (lim ? ' + limits-ok' : '') : 'en-badge-missing';
})()
" 2>/dev/null | tail -1)
echo "$ENBADGE"
$AB screenshot "$SS/sp-live-en.png" 2>&1 | tail -1

echo "── 6) أخطاء الصفحة ──"
$AB errors 2>&1 | tail -3

echo "── 7) تنظيف ──"
kill_all
echo "done"
