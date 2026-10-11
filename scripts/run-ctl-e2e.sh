#!/usr/bin/env bash
# عدّاء E2E من استدعاء واحد — البيئة تجني عمليات الخلفية بين الاستدعاءات،
# لذا يُقلَع السيرفر ويُختبَر ويُنظَّف داخل نفس العملية.
cd /home/z/my-project

echo "── إقلاع next dev نظيف ──"
pkill -f "next dev" 2>/dev/null
pkill -f "next-server" 2>/dev/null
sleep 1

setsid node node_modules/.bin/next dev -p 3000 >> dev.log 2>&1 < /dev/null &
SRV=$!

READY=""
for i in $(seq 1 40); do
  code=$(curl -s -o /dev/null -w "%{http_code}" -m 3 "http://127.0.0.1:3000/api/tools/ping" 2>/dev/null)
  if [ "$code" = "200" ]; then READY=1; break; fi
  sleep 1
done
if [ -z "$READY" ]; then
  echo "❌ السيرفر لم يقلع"
  tail -n 20 dev.log
  exit 1
fi
echo "✅ السيرفر جاهز (${i}ث)"

# ضمان إقلاع جسر الحماية داخل عملية Next (idempotent)
curl -s -m 8 "http://127.0.0.1:3000/api/guard/boot" > /dev/null
sleep 1

echo "── تشغيل agent-ctl-e2e ──"
node scripts/agent-ctl-e2e.mjs
RC=$?

echo "── تنظيف ──"
pkill -f "next dev" 2>/dev/null
pkill -f "next-server" 2>/dev/null
exit $RC
