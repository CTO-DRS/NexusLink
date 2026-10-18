#!/usr/bin/env bash
# da-live-verify.sh — التحقق الحي من التنبيهات المرسوخة (عقد §26.ح)
# دورة كاملة داخل استدعاء واحد (البيئة تجني عمليات الخلفية):
# 1) إقلاع نظيف (dev :3000 + gateway :81) + إشعال جسر الروتينات
# 2) فتح التطبيق → تبويب الروتينات → إنشاء قاعدة «موعد بعد 9 ثوانٍ» من المقبس الحي
# 3) إغلاق الصفحة (about:blank = صفر عملاء) → الانتظار حتى الإطلاق بلا أي واجهة
# 4) إثبات من SQLite: صف إطلاق بـ seenAt=null والصفحة مغلقة (التنبيه انتظر لا تبخّر)
# 5) إعادة فتح التطبيق → ملخص العودة (toast) + شارة «تنبيهات لم تُرَ» + السجل الدائم
# 6) «تعليم الكل كمقروء» → الشارة تزول والرسوخ في SQLite → لقطات AR/EN
set -u
cd /home/z/my-project
AB="agent-browser"
SS=/home/z/my-project/docs/screenshots
DBURL=$(grep '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | tr -d '"')

kill_all() {
  pkill -f "next dev" 2>/dev/null; pkill -f "next-server" 2>/dev/null
  pkill -f "gateway.cjs" 2>/dev/null
  sleep 1
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
curl -s -m 15 "http://127.0.0.1:3000/api/automation/boot" | head -c 120; echo

echo "── 2) التطبيق → فرض العربية (تنظيف بقايا localStorage) → تبويب الروتينات → قاعدة موعد بعد 9 ثوانٍ ──"
$AB open "http://127.0.0.1:81/?app=1" >/dev/null 2>&1
$AB wait --load networkidle >/dev/null 2>&1; sleep 3
$AB eval "
(() => {
  const need = localStorage.getItem('nexus-lang') !== 'ar' || localStorage.getItem('nexus-onboarded') !== '1';
  if (need) {
    localStorage.setItem('nexus-lang', 'ar');
    localStorage.setItem('nexus-onboarded', '1');
    location.reload();
    return 'ar+onboarded-forced-reload';
  }
  return 'already-clean';
})()
" 2>/dev/null | tail -1
sleep 3
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
  s.emit('rule:upsert', { rule: { name: 'موعد التنبيه الحي', enabled: true, trigger: { kind: 'time.once', at: Date.now() + 9000 }, action: { kind: 'notify', text: 'تنبيه مرسوخ — تحقق حي §26.ح' } } })
  return 'rule-created'
})()
" 2>/dev/null | tail -1
sleep 2

echo "── 3) إغلاق الصفحة (صفر عملاء) → انتظار الإطلاق بلا أي واجهة ──"
$AB open "about:blank" >/dev/null 2>&1
sleep 24

echo "── 4) الإثبات من SQLite: صف إطلاق بـ seenAt=null والصفحة مغلقة ──"
DATABASE_URL="$DBURL" node -e '
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient({ log: [] });
(async () => {
  const row = await p.nexusAutomationFire.findFirst({ where: { ruleName: "موعد التنبيه الحي" }, orderBy: { at: "desc" } });
  if (!row) { console.log("NO-ROW"); process.exit(1); }
  console.log("fire-at=" + row.at.toISOString());
  console.log("seenAt=" + (row.seenAt ? row.seenAt.toISOString() : "null"));
  console.log(row.seenAt === null ? "✅ أُطلق بلا واجهة وبقي غير مرئي — التنبيه انتظر" : "❌ seenAt ليس null");
  const total = await p.nexusAutomationFire.count();
  console.log("fires-total=" + total);
  await p.$disconnect();
})().catch((e) => { console.log("ERR " + e.message); process.exit(1); });
' 2>/dev/null

echo "── 5) إعادة الفتح → فرض العربية → ملخص العودة (تحقق فوري) + شارة لم تُرَ ──"
$AB open "http://127.0.0.1:81/?app=1" >/dev/null 2>&1
$AB wait --load networkidle >/dev/null 2>&1; sleep 1
$AB eval "
(() => {
  localStorage.setItem('nexus-lang', 'ar');
  localStorage.setItem('nexus-onboarded', '1');
  return 'ar-staged';
})()
" >/dev/null 2>&1
$AB open "http://127.0.0.1:81/?app=1" >/dev/null 2>&1
$AB wait --load networkidle >/dev/null 2>&1; sleep 1
TOAST=$($AB eval "
(() => {
  const toasts = [...document.querySelectorAll('[data-sonner-toast]')].map(x => x.textContent).join(' | ');
  return toasts.includes('تنبيهات روتين لم تُرَ') ? 'TOAST-OK: ' + toasts.slice(0, 140) : 'toast-gone: ' + toasts.slice(0, 80);
})()
" 2>/dev/null | tail -1)
echo "$TOAST"
$AB screenshot "$SS/da-live-ar-toast.png" 2>&1 | tail -1
$AB eval "
(() => {
  const el = [...document.querySelectorAll('button,[role=button],a,div')].find(x => x.childElementCount <= 2 && x.textContent.trim() === 'الروتينات');
  el?.click(); return 'tab-ok';
})()
" >/dev/null 2>&1
sleep 2
BANNER=$($AB eval "
(() => {
  const badge = document.querySelector('[data-testid=automation-unseen-badge]');
  const dur = document.querySelectorAll('[data-testid=automation-fire-row]').length;
  const unseen = document.querySelectorAll('[data-testid=automation-fire-unseen]').length;
  return badge ? 'BANNER-OK: ' + badge.textContent.trim() + ' · fireRows=' + dur + ' · unseenRows=' + unseen : 'banner-missing · fireRows=' + dur;
})()
" 2>/dev/null | tail -1)
echo "$BANNER"
$AB screenshot "$SS/da-live-ar.png" 2>&1 | tail -1

echo "── 6) تعليم الكل كمقروء → الشارة تزول والرسوخ يثبت ──"
$AB eval "document.querySelector('[data-testid=automation-mark-seen]')?.click(); 'mark-ok'" >/dev/null 2>&1
sleep 2
SEEN=$($AB eval "
(() => {
  const badge = document.querySelector('[data-testid=automation-unseen-badge]');
  const dur = document.querySelectorAll('[data-testid=automation-fire-row]').length;
  const unseen = document.querySelectorAll('[data-testid=automation-fire-unseen]').length;
  return (!badge && dur > 0 && unseen === 0) ? 'SEEN-OK: badge-gone fireRows=' + dur : 'badge=' + !!badge + ' fireRows=' + dur + ' unseen=' + unseen;
})()
" 2>/dev/null | tail -1)
echo "$SEEN"
$AB screenshot "$SS/da-live-ar-seen.png" 2>&1 | tail -1
DATABASE_URL="$DBURL" node -e '
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient({ log: [] });
p.nexusAutomationFire.findFirst({ where: { ruleName: "موعد التنبيه الحي" }, orderBy: { at: "desc" } })
  .then((row) => { console.log(row && row.seenAt ? "✅ seenAt مرسوخ في SQLite: " + row.seenAt.toISOString() : "❌ لم يُرسَّخ"); return p.$disconnect(); })
  .catch(() => process.exit(1));
' 2>/dev/null

echo "── 7) EN ──"
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
  const dur = [...document.querySelectorAll('h3')].some(x => x.textContent.includes('Durable fire log'));
  const lim = [...document.querySelectorAll('p')].some(x => x.textContent.includes('Fires themselves are persisted'));
  return (dur || lim) ? 'EN-OK durable=' + dur + ' limits=' + lim : 'en-missing';
})()
" 2>/dev/null | tail -1)
echo "$EN"
$AB screenshot "$SS/da-live-en.png" 2>&1 | tail -1

echo "── 8) أخطاء الصفحة + تنظيف قاعدة الاختبار ──"
$AB errors 2>&1 | tail -3
DATABASE_URL="$DBURL" node -e '
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient({ log: [] });
(async () => {
  const a = await p.nexusAutomationFire.deleteMany({ where: { ruleName: "موعد التنبيه الحي" } });
  const b = await p.nexusAutomationRule.deleteMany({ where: { name: "موعد التنبيه الحي" } });
  console.log("cleanup fires=" + a.count + " rules=" + b.count);
  await p.$disconnect();
})().catch((e) => { console.log("ERR " + e.message); });
' 2>/dev/null
kill_all
echo "done"
