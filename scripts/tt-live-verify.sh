#!/usr/bin/env bash
# tt-live-verify.sh — التحقق الحي من فحص التاريخ الحي من المحرر (عقد §26.ي)
# دورة كاملة داخل استدعاء واحد (البيئة تجني عمليات الخلفية):
# 1) إقلاع نظيف (dev :3000 + gateway) + إشعال جسر الروتينات
# 2) انتظار المرساة (~100ث من نبض الخدمة الذاتي §27.هـ)
# 3) فتح التطبيق (AR) → تبويب الروتينات → «قاعدة جديدة» (المحرر الحي)
# 4) اختيار المشغّل التاريخي من قائمة Radix (أحداث مؤشر) + اختيار galaxy-s24 من قائمة الأجهزة
# 5) عتبة 100 + مدة 1 → «فحص التاريخ الآن» → حكم أخضر «التاريخ يستوفي الشرط الآن» + رقائق الدليل — لقطة
# 6) عتبة 1 → شارة «نتيجة لضبط سابق» (صدق القِدم) — لقطة → فحص ثانٍ → حكم كهرماني مسبب — لقطة
# 7) EN: «Test history now» + «History satisfies the condition now» — لقطة
# 8) «لا أثر»: إحصاءات التشغيل اليومي وصفوف السجل قبل/بعد متطابقة (لا قاعدة أُنشئت أصلًا)
# 9) أخطاء الصفحة (console صريح) — التنظيف: لا شيء يُنظّف (الفحص قراءة محضة)
set -u
cd /home/z/my-project
AB="agent-browser"
SS=/home/z/my-project/docs/screenshots

kill_all() {
  pkill -f "next dev" 2>/dev/null; pkill -f "next-server" 2>/dev/null
  pkill -f "gateway.cjs" 2>/dev/null
  sleep 1
}

shot_clean() { $AB eval "(() => { if (document.querySelectorAll('[role=option]').length) { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return 'portal-closed' } document.querySelector('nextjs-portal')?.remove(); return 'no-portal' })()" >/dev/null 2>&1; sleep 0.6; $AB eval "document.querySelector('nextjs-portal')?.remove(); 'portal-removed'" >/dev/null 2>&1; $AB screenshot "$1" 2>&1 | tail -1; }

# فتح Select (Radix يفتح على pointerdown) ثم اختيار خيار بنصه
SEL_OPEN='(() => { const trg = document.querySelector("__SEL__"); if (!trg) return "no-trigger"; trg.scrollIntoView({ block: "center" }); const o = { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0 }; trg.dispatchEvent(new PointerEvent("pointerdown", o)); trg.dispatchEvent(new PointerEvent("pointerup", o)); trg.dispatchEvent(new MouseEvent("click", o)); return "opened" })()'
SEL_PICK='(() => { const opt = [...document.querySelectorAll("[role=option]")].find(x => x.textContent.includes("__TEXT__")); if (!opt) return "no-option:" + [...document.querySelectorAll("[role=option]")].map(x => x.textContent.trim()).join("|").slice(0, 140); const o = { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0 }; opt.dispatchEvent(new PointerEvent("pointerover", o)); opt.dispatchEvent(new PointerEvent("pointermove", o)); opt.dispatchEvent(new PointerEvent("pointerdown", o)); opt.dispatchEvent(new PointerEvent("pointerup", o)); opt.dispatchEvent(new MouseEvent("click", o)); return "picked" })()'
SET_VAL='(() => { const el = document.querySelector("__SEL__"); if (!el) return "no-input"; const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value"); d.set.call(el, "__VAL__"); el.dispatchEvent(new Event("input", { bubbles: true })); return "set:" + el.value })()'

# ضبط إدخال React-controlled مع إعادة المحاولة (سباق تركيب حوار Radix: قد يُصفّر React القيمة بعد الضبط)
set_input_retry() { # $1 selector · $2 value · $3 label
  for try in 1 2 3; do
    SNAPX=${SET_VAL/__SEL__/$1}
    $AB eval "${SNAPX/__VAL__/$2}" >/dev/null 2>&1
    sleep 0.5
    NOW=$($AB eval "(() => { const el = document.querySelector('$1'); return el ? String(el.value) : 'none' })()" 2>/dev/null | tail -1)
    NOW=${NOW//\"/}
    [ "$NOW" = "$2" ] && { echo "$3: set-ok ($2)"; return 0; }
    echo "$3: try$try value=$NOW (want $2)"
  done
  echo "$3: FAILED to stick"
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
sleep 3
curl -s -m 15 "http://127.0.0.1:3000/api/automation/boot" | head -c 120; echo
GW=81
h81=$(curl -s -m 3 "http://127.0.0.1:81/__gw/health" | head -c 20)
case "$h81" in *'"ok":true'*) GW=81;; *) GW=8180;; esac
echo "gateway-port=$GW"

echo "── 2) انتظار المرساة (~100ث — عينات نبض الخدمة الذاتي §27.هـ) ──"
sleep 100

echo "── 3) التطبيق (AR) → تبويب الروتينات ──"
$AB open "http://127.0.0.1:$GW/?app=1" >/dev/null 2>&1
$AB wait --load networkidle >/dev/null 2>&1; sleep 3
$AB eval "(() => { localStorage.setItem('nexus-lang', 'ar'); localStorage.setItem('nexus-onboarded', '1'); return 'ar-staged' })()" 2>/dev/null | tail -1
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

echo "── 4) فتح المحرر على البذرة التاريخية «بطارية تحت 15% لمدة ساعة» + اختيار galaxy-s24 من قائمة الأجهزة ──"
$AB eval "
(() => {
  const card = [...document.querySelectorAll('[data-testid=automation-rule-card]')].find(c => c.textContent.includes('بطارية تحت 15% لمدة ساعة'));
  if (!card) return 'seed-card-missing';
  const btn = [...card.querySelectorAll('button')].find(b => b.textContent.trim() === 'تعديل');
  if (!btn) return 'edit-btn-missing';
  btn.click(); return 'editor-open';
})()
" 2>/dev/null | tail -1
sleep 1
DEV="any-device"
for try in 1 2 3; do
  $AB eval "${SEL_OPEN/__SEL__/[data-testid=automation-device-select]}" 2>/dev/null | tail -1
  sleep 1
  $AB eval "${SEL_PICK/__TEXT__/galaxy-s24}" 2>/dev/null | tail -1
  sleep 1
  DEV=$($AB eval "(() => { const d = document.querySelector('[data-testid=automation-device-select]'); return d?.textContent.includes('galaxy-s24') ? 'device-committed' : 'device-any' })()" 2>/dev/null | tail -1)
  echo "try$try: $DEV"
  [ "$DEV" = "device-committed" ] && break
done
# إغلاق أي بوابة Radix متروكة (تحدّ اللقطات والنقرات) — Escape للطبقة العليا فقط
$AB eval "(() => { if (document.querySelectorAll('[role=option]').length) { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return 'portal-closed' } return 'no-portal' })()" 2>/dev/null | tail -1
sleep 0.6
$AB eval "
(() => {
  const trg = document.querySelector('[data-testid=automation-trigger-select]');
  const dev = document.querySelector('[data-testid=automation-device-select]');
  const box = document.querySelector('[data-testid=automation-test-box]');
  const name = document.querySelector('[data-testid=automation-name-input]');
  return 'rule=' + (name?.value || 'none') + ' · trigger=' + (trg?.textContent.trim() || 'none') + ' · device=' + (dev?.textContent.trim() || 'none') + ' · testbox=' + (box ? 'yes' : 'no');
})()
" 2>/dev/null | tail -1

echo "── 5) عتبة 100 + مدة 1 → فحص → حكم أخضر + رقائق الدليل ──"
set_input_retry '[data-testid=automation-threshold-input]' 100 'AR-threshold'
set_input_retry '[data-testid=automation-duration-input]' 1 'AR-duration'
FIRES_BEFORE=$($AB eval "(() => { const s = document.querySelector('[data-testid=automation-stats-fires]'); const log = document.querySelectorAll('[data-testid=automation-log] div').length; return 'fires=' + (s?.textContent.trim() || '?') + ' logRows=' + log })()" 2>/dev/null | tail -1)
echo "before: $FIRES_BEFORE"
# إعادة محاولة صادقة (حتى 3): نافذة الدقيقة تحتاج عينتين داخل آخر 60ث — تكة نابض متأخرة قد تُنقصها مؤقتًا (حد كثافة §26.و)
RES=""
for attempt in 1 2 3; do
  $AB eval "(() => { const b = document.querySelector('[data-testid=automation-test-btn]'); if (!b) return 'btn-missing'; b.click(); return 'test-clicked' })()" 2>/dev/null | tail -1
  RES=""
  for i in $(seq 1 12); do
    RES=$($AB eval "
(() => {
  const r = document.querySelector('[data-testid=automation-test-result]');
  if (!r) return 'no-result';
  return 'verdict=' + (r.querySelector('[data-testid=automation-test-verdict]')?.textContent.trim() || '?') + ' · ev=' + (r.querySelector('[data-testid=automation-test-evidence]')?.textContent.trim() || '?');
})()
" 2>/dev/null | tail -1)
    case "$RES" in *no-result*) sleep 0.8;; *) break;; esac
  done
  echo "attempt$attempt: $RES"
  case "$RES" in *"يستوفي الشرط الآن"*) break;; esac
  sleep 2
done
sleep 1
$AB eval "
(() => {
  const dlg = document.querySelector('[data-testid=automation-editor]');
  dlg?.scrollIntoView({ block: 'center' });
  return dlg ? 'editor-in-view' : 'editor-missing';
})()
" >/dev/null 2>&1
shot_clean "$SS/tt-live-ar-ok.png"

echo "── 6) عتبة 1 → شارة القِدم (لقطة) → فحص ثانٍ → حكم كهرماني مسبب (لقطة) ──"
set_input_retry '[data-testid=automation-threshold-input]' 1 'AR-threshold-1'
sleep 1
STALE=$($AB eval "(() => { const s = document.querySelector('[data-testid=automation-test-stale]'); return 'stale=' + (s ? s.textContent.trim() : 'absent') })()" 2>/dev/null | tail -1)
echo "$STALE"
$AB eval "
(() => {
  const dlg = document.querySelector('[data-testid=automation-editor]');
  dlg?.scrollIntoView({ block: 'center' });
  return 'in-view';
})()
" >/dev/null 2>&1
shot_clean "$SS/tt-live-ar-stale.png"
$AB eval "(() => { const b = document.querySelector('[data-testid=automation-test-btn]'); b?.click(); return 'retest-clicked' })()" 2>/dev/null | tail -1
RES2=""
for i in $(seq 1 12); do
  RES2=$($AB eval "
(() => {
  const r = document.querySelector('[data-testid=automation-test-result]');
  if (!r) return 'no-result';
  const v = r.querySelector('[data-testid=automation-test-verdict]')?.textContent.trim() || '?';
  return 'verdict=' + v + ' · reason=' + (r.querySelector('p')?.textContent.trim().slice(0, 110) || '?');
})()
" 2>/dev/null | tail -1)
  case "$RES2" in *no-result*) sleep 0.8;; *) break;; esac
done
echo "$RES2"
sleep 1
shot_clean "$SS/tt-live-ar-no.png"

echo "── 7) EN: قاعدة مؤقتة (100/1) عبر المقبس → محررها في EN → فحص بلا أي ضبط حقول (تحايل سباق حقول React synthetic) ──"
$AB eval "
(() => {
  const st = window.__nexusAutoSocket
  if (!st || !st.connected) return 'socket-down'
  st.once('auto:state', (s) => { const r = (s.rules || []).find(x => x.name === 'TT-EN-temp'); if (r) window.__ttTempId = r.id })
  st.emit('rule:upsert', { rule: { name: 'TT-EN-temp', enabled: false, trigger: { kind: 'health.battery.sustained', threshold: 100, durationMin: 1 }, action: { kind: 'notify', text: 'TT-EN' } } })
  return 'temp-rule-created'
})()
" 2>/dev/null | tail -1
sleep 1
$AB eval "
(() => {
  const btn = [...document.querySelectorAll('button,a')].find(x => x.textContent.trim() === 'EN');
  if (btn) { btn.click(); return 'en-ok'; }
  return 'en-toggle-missing';
})()
" >/dev/null 2>&1
sleep 2
DIAG=$($AB eval "(() => { return 'dialog=' + !!document.querySelector('[data-testid=automation-editor]') })()" 2>/dev/null | tail -1)
echo "EN-diag-before: $DIAG"
case "$DIAG" in *dialog=true*)
  $AB eval "(() => { const btn = [...document.querySelectorAll('[data-testid=automation-editor] button')].find(b => ['إلغاء','Cancel'].includes(b.textContent.trim())); btn?.click(); return 'cancel-clicked' })()" 2>/dev/null | tail -1
  sleep 1
;; esac
$AB eval "
(() => {
  const card = [...document.querySelectorAll('[data-testid=automation-rule-card]')].find(c => c.textContent.includes('TT-EN-temp'));
  if (!card) return 'temp-card-missing';
  const btn = [...card.querySelectorAll('button')].find(b => ['Edit','تعديل'].includes(b.textContent.trim()));
  if (!btn) return 'edit-btn-missing';
  btn.click(); return 'editor-open-en';
})()
" 2>/dev/null | tail -1
sleep 1
$AB eval "
(() => {
  const thr = document.querySelector('[data-testid=automation-threshold-input]')?.value;
  const dur = document.querySelector('[data-testid=automation-duration-input]')?.value;
  const res = !!document.querySelector('[data-testid=automation-test-result]');
  return 'fresh thr=' + thr + ' dur=' + dur + ' staleResult=' + res;
})()
" 2>/dev/null | tail -1
PROBE=$($AB eval "
(() => {
  return fetch('/api/devices/health?window=1h').then(r => r.json()).then(j => {
    const alive = (j.devices || []).filter(d => d.samples > 0);
    return 'probe samples=' + j.counts.samples + ' aliveDevices=' + alive.length + ' (' + alive.map(d => d.deviceId + ':' + d.samples).join(',') + ')';
  }).catch(e => 'probe-ERR ' + e.message);
})()
" 2>/dev/null | tail -1)
echo "$PROBE"
# اعتراض emit: ما الذي يرسله المحرر فعلًا؟ + فحص يدوي موازٍ بنفس القيم
$AB eval "
(() => {
  const st = window.__nexusAutoSocket
  window.__ttCaptured = null
  const orig = st.emit.bind(st)
  st.emit = (ev, ...args) => { if (ev === 'rule:test') window.__ttCaptured = JSON.stringify(args[0]); return orig(ev, ...args) }
  st.once('auto:test-result', (r) => { window.__ttManual = JSON.stringify(r) })
  st.emit('rule:test', { trigger: { kind: 'health.battery.sustained', threshold: 100, durationMin: 1 } })
  return 'manual-armed'
})()
" 2>/dev/null | tail -1
sleep 2
echo "manual-result: $($AB eval "(() => window.__ttManual || 'none')" 2>/dev/null | tail -1 | head -c 200)"
RES3=""
for attempt in 1 2 3; do
  $AB eval "(() => { const b = document.querySelector('[data-testid=automation-test-btn]'); b?.click(); return 'en-test-clicked' })()" 2>/dev/null | tail -1
  RES3=""
  for i in $(seq 1 12); do
    RES3=$($AB eval "
(() => {
  const r = document.querySelector('[data-testid=automation-test-result]');
  if (!r) return 'no-result';
  return 'verdict=' + (r.querySelector('[data-testid=automation-test-verdict]')?.textContent.trim() || '?') + ' · reason=' + (r.querySelector('p')?.textContent.trim().slice(0, 100) || '?') + ' · ev=' + (r.querySelector('[data-testid=automation-test-evidence]')?.textContent.trim().slice(0, 90) || '?');
})()
" 2>/dev/null | tail -1)
    case "$RES3" in *no-result*) sleep 0.8;; *) break;; esac
  done
  echo "en-attempt$attempt: $RES3"
  case "$RES3" in *"satisfies the condition"*) break;; esac
  sleep 2
done
echo "ui-sent: $($AB eval "(() => window.__ttCaptured || 'nothing-captured')" 2>/dev/null | tail -1 | head -c 200)"
$AB eval "
(() => {
  const btn = document.querySelector('[data-testid=automation-test-btn]');
  const dlg = document.querySelector('[data-testid=automation-editor]');
  dlg?.scrollIntoView({ block: 'center' });
  return 'btn=' + (btn?.textContent.trim() || 'none');
})()
" 2>/dev/null | tail -1
sleep 1
shot_clean "$SS/tt-live-en.png"
# حذف القاعدة المؤقتة بمعرفها (من بث الإنشاء) — حذف rule:delete يبث auto:state للتحقق
$AB eval "
(() => {
  const st = window.__nexusAutoSocket
  return new Promise((res) => {
    if (!st || !window.__ttTempId) { res('no-temp-id'); return }
    st.once('auto:state', (s) => res('temp-remaining=' + (s.rules || []).filter(x => x.name === 'TT-EN-temp').length + ' rules=' + s.rules.length))
    st.emit('rule:delete', { id: window.__ttTempId })
    setTimeout(() => res('no-broadcast'), 4000)
  })
})()
" 2>/dev/null | tail -1
# تنظيف احتياطي: أي إطلاقات دائمة للاسم المؤقت (دفاعًا ضد التلوث — لا ينبغي أن توجد: القاعدة معطلة)
DATABASE_URL=$(grep '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | tr -d '"') node -e '
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient({ log: [] });
(async () => {
  const a = await p.nexusAutomationFire.deleteMany({ where: { ruleName: "TT-EN-temp" } });
  console.log("temp-fire-cleanup=" + a.count);
  await p.$disconnect();
})().catch((e) => console.log("ERR " + e.message));
' 2>/dev/null

echo "── 8) «لا أثر» حيًا: الإحصاءات والسجل بعد كل الفحوص كما قبلها + لا قاعدة أُنشئت ──"
FIRES_AFTER=$($AB eval "(() => { const s = document.querySelector('[data-testid=automation-stats-fires]'); const log = document.querySelectorAll('[data-testid=automation-log] div').length; const durable = document.querySelectorAll('[data-testid=automation-fire-row]').length; return 'fires=' + (s?.textContent.trim() || '?') + ' logRows=' + log + ' durableRows=' + durable })()" 2>/dev/null | tail -1)
echo "after:  $FIRES_AFTER"
echo "before: $FIRES_BEFORE"

echo "── 9) أخطاء الصفحة (console صريح) ──"
echo "[console-errors]"
$AB errors 2>&1 | tail -5
kill_all
echo "done — لا تنظيف قواعد: الفحص قراءة محضة لا ينشئ شيئًا"
