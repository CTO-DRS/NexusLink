#!/usr/bin/env bash
# ap-reshoot.sh — لقطات توثيقية نظيفة لترسيخ القواعد (§26.ز)
# الفرق عن ap-live-verify.sh: فضّ حوار الترحيب أولًا + أغلق الصفحة قبل قتل
# الخادم فلا ChunkLoadError أصلًا (لا شارة dev overlay في اللقطات).
set -u
cd /home/z/my-project
AB="agent-browser"
SS=/home/z/my-project/docs/screenshots

kill_all() { pkill -f "next dev" 2>/dev/null; pkill -f "next-server" 2>/dev/null; sleep 1; }
start_server() {
  ( bun run dev >> dev.log 2>&1 & )
  for i in $(seq 1 60); do
    code=$(curl -s -o /dev/null -w "%{http_code}" -m 3 "http://127.0.0.1:3000/api/tools/ping" 2>/dev/null)
    [ "$code" = "200" ] && return 0; sleep 1
  done
  echo "❌ الخادم لم يقلع"; return 1
}
open_app() {
  $AB open "http://127.0.0.1:81/?app=1" >/dev/null 2>&1
  $AB wait --load networkidle >/dev/null 2>&1; sleep 4
  dismiss_overlays
  sleep 1
  $AB eval "
(() => {
  const el = [...document.querySelectorAll('button,[role=button],a,div')].find(x => x.childElementCount <= 2 && x.textContent.trim() === 'الروتينات');
  el?.click(); return 'tab-ok';
})()
"
  sleep 2
}
dismiss_overlays() {
  $AB eval "
(() => {
  // 1) حوار الترحيب: زر X (أيقونة lucide-x) داخل [role=dialog]
  const dlg = document.querySelector('[role=\"dialog\"]');
  if (dlg) {
    const xb = [...dlg.querySelectorAll('button')].find(b => b.querySelector('svg.lucide-x, svg[class*=\"lucide-x\"]'));
    (xb || [...dlg.querySelectorAll('button')].find(b => b.textContent.includes('البداية')))?.click();
  }
  // 2) overlay التطوير (شارة Issues) — تجميلي فقط (الأخطاء تُقاس بمجمّع مستقل)
  document.querySelector('nextjs-portal')?.remove();
  return 'overlays-cleared';
})()
" >/dev/null 2>&1
}
shoot() {
  dismiss_overlays
  sleep 1
  $AB screenshot "$1" 2>&1 | tail -1
}

echo "── إقلاع ──"
kill_all; start_server || exit 1
curl -s -m 15 "http://127.0.0.1:3000/api/automation/boot"; echo
open_app

echo "── إنشاء القاعدة + تشغيل الآن + لقطة قبل ──"
$AB eval "document.querySelector('[data-testid=automation-new-rule]')?.click(); 'new-ok'"
sleep 1
$AB eval "
(() => {
  const inp = document.querySelector('#auto-name');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(inp, 'قاعدة الترسيخ الحي');
  inp.dispatchEvent(new Event('input', { bubbles: true })); return 'name-ok';
})()
" >/dev/null
sleep 1
$AB eval "document.querySelector('[data-testid=automation-save]')?.click(); 'save-ok'"
sleep 2
$AB eval "
(() => {
  const card = [...document.querySelectorAll('[data-testid=automation-rule-card]')].find(c => c.textContent.includes('قاعدة الترسيخ الحي'));
  card?.querySelector('[data-testid=automation-run-now]')?.click();
  return card ? 'runnow-ok' : 'card-missing';
})()
"
sleep 2
shoot "$SS/ap-live-before.png"

echo "── إعادة تشغيل حقيقية (الصفحة مغلقة أولًا — لا أخطاء chunks) ──"
$AB close >/dev/null 2>&1
kill_all; echo "killed — 3s"; sleep 3
start_server || exit 1
curl -s -m 15 "http://127.0.0.1:3000/api/automation/boot"; echo
open_app

echo "── القاعدة مستعادة؟ + لقطة بعد ──"
$AB eval "
(() => {
  const card = [...document.querySelectorAll('[data-testid=automation-rule-card]')].find(c => c.textContent.includes('قاعدة الترسيخ الحي'));
  if (!card) return 'RESTORED=NO — cards=' + document.querySelectorAll('[data-testid=automation-rule-card]').length;
  const state = card.className.includes('opacity-60') ? 'disabled' : 'enabled';
  return 'RESTORED=YES state=' + state;
})()
"
shoot "$SS/ap-live-after-restart.png"

echo "── EN ──"
$AB eval "
(() => {
  const btn = [...document.querySelectorAll('button,a')].find(x => x.textContent.trim() === 'EN');
  btn?.click(); return 'en-ok';
})()
" >/dev/null
sleep 2
shoot "$SS/ap-live-en.png"

echo "── أخطاء الصفحة (جلسة نظيفة) ──"
$AB errors --json 2>&1 | python3 -c "import json,sys; d=json.load(sys.stdin); print('errors-count:', len(d['data']['errors']))"

echo "── تنظيف القاعدة التجريبية ──"
$AB eval "
(() => {
  const btn = [...document.querySelectorAll('button,a')].find(x => x.textContent.trim() === 'ع' || x.textContent.trim() === 'AR');
  btn?.click(); return 'ar-ok';
})()
" >/dev/null 2>&1
sleep 1
$AB eval "
(() => {
  const card = [...document.querySelectorAll('[data-testid=automation-rule-card]')].find(c => c.textContent.includes('قاعدة الترسيخ الحي'));
  card?.querySelector('[data-testid=automation-rule-delete]')?.click();
  return card ? 'cleanup-ok' : 'already-gone';
})()
"
sleep 2
$AB eval "['final-rules', [...document.querySelectorAll('[data-testid=automation-rule-name]')].map(x => x.textContent).join(' | ')].join(': ')"
echo "── done ──"
