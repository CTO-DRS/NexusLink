#!/usr/bin/env bash
# sl-live-verify.sh — التحقق الحي من مشغّل التخزين التاريخي (عقد §26.ط)
# دورة كاملة داخل استدعاء واحد (البيئة تجني عمليات الخلفية):
# 1) إقلاع نظيف (dev :3000 + gateway :81 أو fallback) + إشعال جسر الروتينات
# 2) انتظار تراكم عينات (المرساة) → فتح التطبيق (AR) → تبويب الروتينات
# 3) إنشاء قاعدة «بقاء التخزين فوق 75% لمدة دقيقة» لجهاز redmi-note13 (80%) من المقبس الحي
# 4) toast الإطلاق + كارت القاعدة (تشغيلات=1) + سجل «مستمن منذ … وفق التاريخ المسجل»
#    + السجل الدائم + إثبات SQLite: seenAt != null (رؤية عند التسليم) + عينات storagePct=80
# 5) EN: ملصق المشغّل «Storage stays above threshold for a duration (history)»
# 6) تنظيف القاعدة وإطلاقاتها + أخطاء الصفحة
set -u
cd /home/z/my-project
AB="agent-browser"
SS=/home/z/my-project/docs/screenshots
DBURL=$(grep '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | tr -d '"')
RULE_NAME='تخزين ممتلئ — تحقق حي'

kill_all() {
  pkill -f "next dev" 2>/dev/null; pkill -f "next-server" 2>/dev/null
  pkill -f "gateway.cjs" 2>/dev/null
  sleep 1
}

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
sleep 3
curl -s -m 15 "http://127.0.0.1:3000/api/automation/boot" | head -c 120; echo
# منفذ البوابة الفعلي: 81 أو fallback 8180 (caddy الحاوية يحتجز 81 الآن)
GW=81
h81=$(curl -s -m 3 "http://127.0.0.1:81/__gw/health" | head -c 20)
case "$h81" in *'"ok":true'*) GW=81;; *) GW=8180;; esac
echo "gateway-port=$GW"

echo "── 2) انتظار المرساة (عينات ما قبل القاعدة — ~100ث من نبض الخدمة الذاتي §27.هـ) ──"
sleep 100

echo "── 3) التطبيق → فرض العربية → تبويب الروتينات → قاعدة التخزين التاريخية ──"
$AB open "http://127.0.0.1:$GW/?app=1" >/dev/null 2>&1
$AB wait --load networkidle >/dev/null 2>&1; sleep 3
$AB eval "
(() => {
  localStorage.setItem('nexus-lang', 'ar');
  localStorage.setItem('nexus-onboarded', '1');
  return 'ar-staged';
})()
" 2>/dev/null | tail -1
$AB open "http://127.0.0.1:$GW/?app=1" >/dev/null 2>&1
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
  s.emit('rule:upsert', { rule: { name: '$RULE_NAME', enabled: true, trigger: { kind: 'health.storage.sustained', deviceId: 'redmi-note13', threshold: 75, durationMin: 1 }, action: { kind: 'notify', text: 'تخزين الهاتف ممتلئ — فرّغ مساحة' } } })
  return 'rule-created'
})()
" 2>/dev/null | tail -1

echo "── 4) التقاط toast الإطلاق التاريخي (نافذة 0..30ث — أول تكة تقييم ≤15ث) ──"
TOAST="toast-gone"
for i in $(seq 1 38); do
  TOAST=$($AB eval "
(() => {
  const toasts = [...document.querySelectorAll('li[data-sonner-toast]')];
  return 'n=' + toasts.length + ' txt=' + toasts.map(x => x.textContent.slice(0, 140)).join('~');
})()
" 2>/dev/null | tail -1)
  case "$TOAST" in *"n=0"*) :;; *) break;; esac
  sleep 0.8
done
echo "$TOAST"
shot_clean "$SS/sl-live-ar-toast.png"
$AB eval "
(() => {
  const el = [...document.querySelectorAll('button,[role=button],a,div')].find(x => x.childElementCount <= 2 && x.textContent.trim() === 'الروتينات');
  el?.click(); return 'tab-ok';
})()
" >/dev/null 2>&1
sleep 2
$AB eval "
(() => {
  document.querySelector('nextjs-portal')?.remove();
  const card = [...document.querySelectorAll('[data-testid=automation-rule-card]')].find(c => c.textContent.includes('تخزين ممتلئ'));
  card?.scrollIntoView({ block: 'center' });
  return card ? 'card-in-view' : 'card-missing';
})()
" 2>/dev/null | tail -1
sleep 1
CARD=$($AB eval "
(() => {
  const cards = [...document.querySelectorAll('[data-testid=automation-rule-card]')];
  const card = cards.find(c => c.textContent.includes('تخزين ممتلئ'));
  if (!card) return 'card-missing';
  const logRow = [...document.querySelectorAll('[data-testid=automation-log] div')].map(x => x.textContent).find(t => t && t.includes('وفق التاريخ المسجل')) || 'log-missing';
  const durRow = [...document.querySelectorAll('[data-testid=automation-fire-row]')].map(x => x.textContent).find(t => t && t.includes('تخزين ممتلئ')) || 'durable-missing';
  return 'CARD-OK · log=' + logRow.slice(0, 90) + ' · durable=' + durRow.slice(0, 100);
})()
" 2>/dev/null | tail -1)
echo "$CARD"
shot_clean "$SS/sl-live-ar.png"
echo "[SQLite] الإطلاق المرسوخ + رؤية عند التسليم + عينات storagePct"
DATABASE_URL="$DBURL" node -e '
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient({ log: [] });
(async () => {
  const row = await p.nexusAutomationFire.findFirst({ where: { ruleName: "تخزين ممتلئ — تحقق حي" }, orderBy: { at: "desc" } });
  if (!row) { console.log("NO-ROW"); process.exit(1); }
  console.log("fire-at=" + row.at.toISOString());
  console.log("detail=" + row.detail.slice(0, 100));
  console.log(row.seenAt ? "✅ seenAt مرسوخ (رؤية عند التسليم — واجهة متصلة): " + row.seenAt.toISOString() : "❌ seenAt=null رغم واجهة متصلة");
  const s = await p.nexusHealthSample.findMany({ where: { deviceId: "redmi-note13" }, orderBy: { createdAt: "desc" }, take: 5 });
  console.log("samples-storagePct=" + s.map((x) => x.storagePct).join(",") + " (آخر 5 عينات)");
  await p.$disconnect();
})().catch((e) => { console.log("ERR " + e.message); process.exit(1); });
' 2>/dev/null

echo "── 5) EN — ملصق المشغّل التاريخي للتخزين ──"
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
  const found = document.body.textContent.includes('Storage stays above threshold for a duration');
  const card = [...document.querySelectorAll('[data-testid=automation-rule-card]')].find(c => c.textContent.includes('تخزين ممتلئ'));
  card?.scrollIntoView({ block: 'center' });
  return found ? 'EN-OK: label visible (card centered)' : 'en-missing';
})()
" 2>/dev/null | tail -1)
echo "$EN"
sleep 1
shot_clean "$SS/sl-live-en.png"

echo "── 6) أخطاء الصفحة (console صريح) + تنظيف قاعدة الاختبار ──"
echo "[console-errors]"
$AB errors 2>&1 | tail -5
DATABASE_URL="$DBURL" node -e '
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient({ log: [] });
(async () => {
  const a = await p.nexusAutomationFire.deleteMany({ where: { ruleName: "تخزين ممتلئ — تحقق حي" } });
  const b = await p.nexusAutomationRule.deleteMany({ where: { name: "تخزين ممتلئ — تحقق حي" } });
  console.log("cleanup fires=" + a.count + " rules=" + b.count);
  await p.$disconnect();
})().catch((e) => { console.log("ERR " + e.message); });
' 2>/dev/null
kill_all
echo "done"
