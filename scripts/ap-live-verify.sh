#!/usr/bin/env bash
# ap-live-verify.sh — التحقق الحي من ترسيخ قواعد الروتينات (§26.ز)
# دورة إعادة تشغيل حقيقية داخل استدعاء واحد (البيئة تجني عمليات الخلفية):
# 1) قاعدة جديدة من المحرر الحي + «شغّل الآن» (fireCount=1) → لقطة قبل
# 2) قتل الخادم وإعادة إقلاعه فعليًا
# 3) القاعدة ظاهرة بعد الإقلاع (استُعيدت من SQLite) وfireCount محفوظ → لقطة بعد
set -u
cd /home/z/my-project
AB="agent-browser"
SS=/home/z/my-project/docs/screenshots

kill_all() {
  pkill -f "while true; do cd /home/z/my-project" 2>/dev/null
  pkill -f "next dev" 2>/dev/null; pkill -f "next-server" 2>/dev/null
  sleep 1
}

start_server() {
  ( bun run dev >> dev.log 2>&1 & ) 
  for i in $(seq 1 60); do
    code=$(curl -s -o /dev/null -w "%{http_code}" -m 3 "http://127.0.0.1:3000/api/tools/ping" 2>/dev/null)
    [ "$code" = "200" ] && return 0
    sleep 1
  done
  echo "❌ الخادم لم يقلع"; return 1
}

echo "── 1) إقلاع نظيف ──"
kill_all
start_server || exit 1
curl -s -m 15 "http://127.0.0.1:3000/api/automation/boot"; echo

echo "── 2) فتح التطبيق وتبويب الروتينات ──"
$AB open "http://127.0.0.1:81/?app=1" >/dev/null 2>&1
$AB wait --load networkidle >/dev/null 2>&1; sleep 3
$AB eval "
(() => {
  const el = [...document.querySelectorAll('button,[role=button],a,div')].find(x => x.childElementCount <= 2 && x.textContent.trim() === 'الروتينات');
  if (el) { el.click(); return 'tab-ok'; }
  return 'tab-missing: ' + document.body.textContent.slice(0, 120);
})()
"

echo "── 3) إنشاء قاعدة الترسيخ من المحرر الحي ──"
sleep 2
$AB eval "document.querySelector('[data-testid=automation-new-rule]')?.click(); 'new-ok'"
sleep 1
$AB eval "
(() => {
  const inp = document.querySelector('#auto-name');
  if (!inp) return 'no-input';
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(inp, 'قاعدة الترسيخ الحي');
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  return 'name-ok';
})()
"
sleep 1
$AB eval "document.querySelector('[data-testid=automation-save]')?.click(); 'save-ok'"
sleep 2

echo "── 4) تشغيل الآن للقاعدة (fireCount=1) + لقطة قبل ──"
$AB eval "
(() => {
  const card = [...document.querySelectorAll('[data-testid=automation-rule-card]')].find(c => c.textContent.includes('قاعدة الترسيخ الحي'));
  if (!card) return 'card-missing';
  card.querySelector('[data-testid=automation-run-now]')?.click();
  return 'runnow-ok';
})()
"
sleep 2
$AB screenshot "$SS/ap-live-before.png" 2>&1 | tail -1

echo "── 5) إعادة تشغيل حقيقية (قتل + إقلاع) ──"
kill_all
echo "server killed — waiting 3s"; sleep 3
start_server || exit 1
curl -s -m 15 "http://127.0.0.1:3000/api/automation/boot"; echo

echo "── 6) التحقق: القاعدة مستعادة من SQLite بعد الإقلاع ──"
$AB open "http://127.0.0.1:81/?app=1" >/dev/null 2>&1
$AB wait --load networkidle >/dev/null 2>&1; sleep 4
$AB eval "
(() => {
  const el = [...document.querySelectorAll('button,[role=button],a,div')].find(x => x.childElementCount <= 2 && x.textContent.trim() === 'الروتينات');
  el?.click(); return 'tab-ok';
})()
"
sleep 3
$AB eval "
(() => {
  const card = [...document.querySelectorAll('[data-testid=automation-rule-card]')].find(c => c.textContent.includes('قاعدة الترسيخ الحي'));
  if (!card) return 'RESTORED=NO — cards=' + document.querySelectorAll('[data-testid=automation-rule-card]').length;
  const name = card.querySelector('[data-testid=automation-rule-name]')?.textContent;
  const state = card.className.includes('opacity-60') ? 'disabled' : 'enabled';
  return 'RESTORED=YES name=' + name + ' state=' + state;
})()
"

echo "── 7) لقطة بعد + EN ──"
$AB screenshot "$SS/ap-live-after-restart.png" 2>&1 | tail -1
$AB eval "
(() => {
  const btn = [...document.querySelectorAll('button,a')].find(x => x.textContent.trim() === 'EN');
  if (btn) { btn.click(); return 'en-ok'; }
  return 'en-toggle-missing';
})()
"
sleep 2
$AB eval "
(() => {
  const card = [...document.querySelectorAll('[data-testid=automation-rule-card]')].find(c => c.textContent.includes('Live persistence rule') || c.textContent.includes('قاعدة الترسيخ'));
  return card ? 'EN-CARD-OK' : 'en-card-note';
})()
"
$AB screenshot "$SS/ap-live-en.png" 2>&1 | tail -1

echo "── 8) أخطاء الصفحة ──"
$AB errors 2>&1 | tail -3

echo "── 9) تنظيف القاعدة التجريبية (تبقى البذور حرفيًا) ──"
$AB eval "
(() => {
  const btn = [...document.querySelectorAll('button,a')].find(x => x.textContent.trim() === 'AR' || x.textContent.trim() === 'ع');
  btn?.click(); return 'ar-ok';
})()
" >/dev/null 2>&1
sleep 1
$AB eval "
(() => {
  const card = [...document.querySelectorAll('[data-testid=automation-rule-card]')].find(c => c.textContent.includes('قاعدة الترسيخ الحي'));
  if (!card) return 'already-gone';
  card.querySelector('[data-testid=automation-rule-delete]')?.click();
  return 'cleanup-ok';
})()
"
sleep 2
$AB eval "
(() => {
  const n = [...document.querySelectorAll('[data-testid=automation-rule-name]')].map(x => x.textContent).join(' | ');
  return 'final-rules: ' + n;
})()
"
echo "── done ──"
