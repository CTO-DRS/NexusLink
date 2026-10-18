#!/usr/bin/env bash
# ba-live-verify.sh — التحقق الحي من مشغّل بلوغ البطارية (حافة صاعدة — عقد §26.أ)
# دورة كاملة داخل استدعاء واحد (البيئة تجني عمليات الخلفية):
# 1) إقلاع نظيف (dev :3000 + gateway :81) + إشعال جسر الروتينات
# 2) فتح التطبيق (AR) → تبويب الروتينات → إنشاء قاعدة «شحن مكتمل»
#    (battery.above لجهاز galaxy-s24 عتبة 80%) من المقبس الحي
# 3) تقرير 70% (لا عبور) ثم 85% → عبور صاعد عبر 80 → إطلاق حي بواجهة متصلة
# 4) toast الإطلاق + كارت القاعدة (تشغيلات=1) + سجل التشغيل «بلغت 85% (العتبة 80%)»
#    + السجل الدائم + إثبات SQLite: seenAt != null (رؤية عند التسليم)
# 5) EN: ملصق المشغّل «When battery reaches a threshold (charge complete)»
# 6) تنظيف القاعدة وإطلاقاتها + أخطاء الصفحة
set -u
cd /home/z/my-project
AB="agent-browser"
SS=/home/z/my-project/docs/screenshots
DBURL=$(grep '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | tr -d '"')
RULE_NAME='شحن مكتمل — تحقق حي'

kill_all() {
  pkill -f "next dev" 2>/dev/null; pkill -f "next-server" 2>/dev/null
  pkill -f "gateway.cjs" 2>/dev/null
  sleep 1
}

# التقاط نظيف: إزالة بوابة dev التجميلية (الدرس الموثق) + تمرير عنصر للمرأى
shot_clean() { $AB eval "document.querySelector('nextjs-portal')?.remove(); 'portal-removed'" >/dev/null 2>&1; $AB screenshot "$1" 2>&1 | tail -1; }

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
curl -s -m 15 "http://127.0.0.1:3000/api/automation/boot" | head -c 120; echo

echo "── 2) التطبيق → فرض العربية → تبويب الروتينات → قاعدة بلوغ البطارية 80% ──"
$AB open "http://127.0.0.1:81/?app=1" >/dev/null 2>&1
$AB wait --load networkidle >/dev/null 2>&1; sleep 3
$AB eval "
(() => {
  localStorage.setItem('nexus-lang', 'ar');
  localStorage.setItem('nexus-onboarded', '1');
  return 'ar-staged';
})()
" 2>/dev/null | tail -1
$AB open "http://127.0.0.1:81/?app=1" >/dev/null 2>&1
$AB wait --load networkidle >/dev/null 2>&1; sleep 1
$AB eval "
(() => {
  const el = [...document.querySelectorAll('button,[role=button],a,div')].find(x => x.childElementCount <= 2 && x.textContent.trim() === 'الروتينات');
  if (el) { el.click(); return 'tab-ok'; }
  return 'tab-missing';
})()
" 2>/dev/null | tail -1
sleep 2
$AB eval "
(() => {
  const s = window.__nexusAutoSocket
  if (!s || !s.connected) return 'socket-down'
  s.emit('rule:upsert', { rule: { name: '$RULE_NAME', enabled: true, trigger: { kind: 'battery.above', deviceId: 'galaxy-s24', threshold: 80 }, action: { kind: 'notify', text: 'وصلت البطارية 80% — فك الشاحن' } } })
  return 'rule-created'
})()
" 2>/dev/null | tail -1
sleep 2

echo "── 3) تقرير 70% (لا عبور) ثم 85% → عبور صاعد عبر 80 ──"
rep() { curl -s -m 8 -X POST "http://127.0.0.1:3000/api/devices/health" -H "Content-Type: application/json" -d "{\"action\":\"report\",\"deviceId\":\"galaxy-s24\",\"battery\":$1}" | head -c 80; echo; }
rep 70
sleep 7
rep 85

# التقاط toast بنمط bisect المثبت (li[data-sonner-toast] — 16 محاولة × 0.8ث → نافذة 0..14ث)
TOAST="toast-gone"
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16; do
  TOAST=$($AB eval "
(() => {
  const toasts = [...document.querySelectorAll('li[data-sonner-toast]')];
  return 'n=' + toasts.length + ' txt=' + toasts.map(x => x.textContent.slice(0, 120)).join('~');
})()
" 2>/dev/null | tail -1)
  case "$TOAST" in *"n=0"*) :;; *) break;; esac
  sleep 0.8
done
echo "$TOAST"
shot_clean "$SS/ba-live-ar-toast.png"
$AB eval "
(() => {
  const el = [...document.querySelectorAll('button,[role=button],a,div')].find(x => x.childElementCount <= 2 && x.textContent.trim() === 'الروتينات');
  el?.click(); return 'tab-ok';
})()
" >/dev/null 2>&1
sleep 2
# تمرير كارت القاعدة الجديدة للمرأى (كارت + شارة المشغّل الصاعد + العدّاد)
$AB eval "
(() => {
  document.querySelector('nextjs-portal')?.remove();
  const card = [...document.querySelectorAll('[data-testid=automation-rule-card]')].find(c => c.textContent.includes('شحن مكتمل'));
  card?.scrollIntoView({ block: 'center' });
  return card ? 'card-in-view' : 'card-missing';
})()
" 2>/dev/null | tail -1
sleep 1
CARD=$($AB eval "
(() => {
  const cards = [...document.querySelectorAll('[data-testid=automation-rule-card]')];
  const card = cards.find(c => c.textContent.includes('شحن مكتمل'));
  if (!card) return 'card-missing';
  const logRow = [...document.querySelectorAll('[data-testid=automation-log] div')].map(x => x.textContent).find(t => t && t.includes('بلغت')) || 'log-missing';
  const durRow = [...document.querySelectorAll('[data-testid=automation-fire-row]')].map(x => x.textContent).find(t => t && t.includes('شحن مكتمل')) || 'durable-missing';
  return 'CARD-OK · log=' + logRow.slice(0, 80) + ' · durable=' + durRow.slice(0, 100);
})()
" 2>/dev/null | tail -1)
echo "$CARD"
shot_clean "$SS/ba-live-ar.png"
DATABASE_URL="$DBURL" node -e '
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient({ log: [] });
(async () => {
  const row = await p.nexusAutomationFire.findFirst({ where: { ruleName: "شحن مكتمل — تحقق حي" }, orderBy: { at: "desc" } });
  if (!row) { console.log("NO-ROW"); process.exit(1); }
  console.log("fire-at=" + row.at.toISOString());
  console.log("detail=" + row.detail.slice(0, 90));
  console.log(row.seenAt ? "✅ seenAt مرسوخ (رؤية عند التسليم — واجهة متصلة): " + row.seenAt.toISOString() : "❌ seenAt=null رغم واجهة متصلة");
  await p.$disconnect();
})().catch((e) => { console.log("ERR " + e.message); process.exit(1); });
' 2>/dev/null

echo "── 5) EN — ملصق المشغّل الصاعد ──"
$AB eval "
(() => {
  const btn = [...document.querySelectorAll('button,a')].find(x => x.textContent.trim() === 'EN');
  if (btn) { btn.click(); return 'en-ok'; }
  return 'en-toggle-missing';
})()
" >/dev/null 2>&1
sleep 2
EN=$($AB eval "
(() => {
  document.querySelector('nextjs-portal')?.remove();
  const found = document.body.textContent.includes('When battery reaches a threshold');
  const card = [...document.querySelectorAll('[data-testid=automation-rule-card]')].find(c => c.textContent.includes('شحن مكتمل'));
  card?.scrollIntoView({ block: 'center' });
  return found ? 'EN-OK: label visible (card centered)' : 'en-missing';
})()
" 2>/dev/null | tail -1)
echo "$EN"
sleep 1
shot_clean "$SS/ba-live-en.png"

echo "── 6) أخطاء الصفحة (console صريح) + تنظيف قاعدة الاختبار ──"
echo "[console-errors]"
$AB errors 2>&1 | tail -5
DATABASE_URL="$DBURL" node -e '
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient({ log: [] });
(async () => {
  const a = await p.nexusAutomationFire.deleteMany({ where: { ruleName: "شحن مكتمل — تحقق حي" } });
  const b = await p.nexusAutomationRule.deleteMany({ where: { name: "شحن مكتمل — تحقق حي" } });
  console.log("cleanup fires=" + a.count + " rules=" + b.count);
  await p.$disconnect();
})().catch((e) => { console.log("ERR " + e.message); });
' 2>/dev/null
kill_all
echo "done"
