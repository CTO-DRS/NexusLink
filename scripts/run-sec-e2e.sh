#!/usr/bin/env bash
# عدّاء E2E للأمان (FA-10) من استدعاء واحد — البيئة تجني عمليات الخلفية
# بين الاستدعاءات، لذا يُقلَع السيرفر والبوابة ويُختبَر ويُنظَّف داخل نفس العملية.
# الفحوص: جسر 3009 مباشر + عبر البوابة 81 (XTransformPort) + مصافحة/إطارات/قفل/مسح/صلاحيات/تدقيق.
cd /home/z/my-project

echo "── تنظيف المنافذ والعمليات القديمة ──"
pkill -f "next dev" 2>/dev/null
pkill -f "next-server" 2>/dev/null
fuser -k 81/tcp 3000/tcp 3009/tcp 2>/dev/null
sleep 1

echo "── إقلاع caddy 81 (البوابة) ──"
setsid caddy run --config Caddyfile > caddy-sec-e2e.log 2>&1 < /dev/null &
for i in $(seq 1 15); do
  if curl -s -o /dev/null -m 2 http://127.0.0.1:81/; then break; fi
  sleep 1
done

echo "── إقلاع next dev ──"
setsid node node_modules/.bin/next dev -p 3000 >> dev.log 2>&1 < /dev/null &
READY=""
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w "%{http_code}" -m 3 "http://127.0.0.1:3000/api/tools/ping" 2>/dev/null)
  if [ "$code" = "200" ]; then READY=1; break; fi
  sleep 1
done
if [ -z "$READY" ]; then
  echo "❌ السيرفر لم يقلع"
  tail -n 25 dev.log
  exit 1
fi
echo "✅ السيرفر جاهز (${i}ث)"

# تفعيل جسر الأمان صراحة (ensureSecurityBridge عبر مسار boot)
curl -s -X POST http://127.0.0.1:3000/api/security/boot > /dev/null 2>&1
sleep 1
code=$(curl -s -o /dev/null -w "%{http_code}" -m 3 "http://127.0.0.1:3009/" 2>/dev/null)
echo "── جسر 3009 يستجيب (socket.io polling): HTTP $code ──"

echo "── تشغيل agent-sec-e2e ──"
node scripts/agent-sec-e2e.mjs
RC=$?

echo "── تنظيف ──"
pkill -f "next dev" 2>/dev/null
pkill -f "next-server" 2>/dev/null
pkill -f "caddy run" 2>/dev/null
fuser -k 81/tcp 3000/tcp 3009/tcp 2>/dev/null
exit $RC
