#!/usr/bin/env bash
# عدّاء E2E للتحكم بالهاتف (FA-9) من استدعاء واحد — البيئة تجني عمليات الخلفية
# بين الاستدعاءات، لذا يُقلَع السيرفر ويُختبَر ويُنظَّف داخل نفس العملية.
cd /home/z/my-project

# فإذا: fuser غير مثبت في البيئة — قتل حقيقي عبر ss → pid → kill -9 مع حلقة تحقق
kill_port() {
  local port="$1" pids
  for _ in 1 2 3; do
    pids=$(ss -tlnp 2>/dev/null | grep ":${port} " | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u)
    [ -z "$pids" ] && return 0
    kill -9 $pids 2>/dev/null
    sleep 1
  done
  ss -tlnp 2>/dev/null | grep -q ":${port} " && return 1 || return 0
}

echo "── إقلاع next dev نظيف ──"
pkill -f "next dev" 2>/dev/null
pkill -f "next-server" 2>/dev/null
# FA-9: الخدمة المستقلة القديمة (mini-service bun) قد تحتكر 3004 ببروتوكول قديم — نظفها فعلياً
# (درس إعادة الاعتماد: fuser غير موجود فكان التنظيف صامتاً وجسر next استسلم للمنفذ المشغول)
kill_port 3004 || { echo "❌ المنفذ 3004 لم يتحرر من الخدمة القديمة"; ss -tlnp | grep 3004; exit 1; }
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

# تحقق حيازة 3004 بعد التمهيد: أي حائز غير node = خدمة قديمة ببروتوكول ناقص → فشل صريح فوراً
HOLDER=$(ss -tlnp 2>/dev/null | grep ":3004 " | grep -oE '\("[a-z-]+' | tr -d '("' | head -1)
if [ -n "$HOLDER" ] && [ "$HOLDER" != "node" ]; then
  echo "❌ 3004 مملوك لـ $HOLDER (ليس next/node) — بروتوكول قديم محتمل"; exit 1
fi

echo "── تشغيل agent-rc-e2e ──"
node scripts/agent-rc-e2e.mjs
RC=$?

echo "── تنظيف ──"
pkill -f "next dev" 2>/dev/null
pkill -f "next-server" 2>/dev/null
kill_port 3004 2>/dev/null || true
exit $RC
