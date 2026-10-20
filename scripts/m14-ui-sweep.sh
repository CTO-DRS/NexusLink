#!/usr/bin/env bash
# M1.4 — مسحة حية بالمتصفح v2: محددات محايدة لغويًا (اختصار Ctrl+Shift+E = دورة الست المعاقدة)
set -e
cd /home/z/my-project
ROOT=$(pwd)/
export NEXUS_DATA_ROOT="${ROOT}.next/standalone/data"

node .next/standalone/server.js > /tmp/m14-ui-server.log 2>&1 &
SRV=$!
UP=0
for i in $(seq 1 50); do
  sleep 0.5
  if curl -s http://127.0.0.1:3000/api/health 2>/dev/null | grep -q '"ok":true'; then UP=1; break; fi
done
echo "health=$UP"

B() { agent-browser "$@" 2>&1 | tail -2; }
EV() { B eval "$1"; }

B open "http://127.0.0.1:3000/?app=1"
B storage local set nexus-onboarded 1
B reload
B wait --load networkidle
sleep 1
echo "--- 1) ar default ---"
EV "document.documentElement.lang + '/' + document.documentElement.dir"

echo "--- 2) Ctrl+Shift+E ×1 → en (dir flips + dock EN) ---"
B press Control+Shift+e
sleep 2.5
EV "document.documentElement.lang + '/' + document.documentElement.dir"
EV "(document.body.innerText.match(/\bDevices\b/) || ['no-match'])[0]"

echo "--- 3) ×2 more → fr (sweeper + dict lazy) ---"
B press Control+Shift+e; sleep 2.5
B press Control+Shift+e; sleep 2.5
EV "document.documentElement.lang + '/' + document.documentElement.dir"
EV "(document.body.innerText.match(/Appareils/) || ['no-match'])[0]"

echo "--- 4) persistence: reload keeps fr ---"
B reload
B wait --load networkidle
sleep 1.5
EV "document.documentElement.lang + ' / LS=' + localStorage.getItem('nexus-lang')"

echo "--- 5) Alt+7 → settings: six language buttons visible ---"
B press Alt+7
sleep 1.5
EV "[...document.querySelectorAll('button')].filter(x => ['العربية','English','Français','Español','Deutsch','Русский'].some(n => x.textContent.includes(n))).length"

echo "--- 6) click Русский → ru/rtl? no — ltr ---"
EV "(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Русский'); b && b.click(); return b ? 'ok' : 'missing' })()"
sleep 2.5
EV "document.documentElement.lang + '/' + document.documentElement.dir"

echo "--- 7) a11y: font scale A+ → 18px + aria-pressed ---"
EV "(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'A+'); b && b.click(); return b ? 'ok' : 'missing' })()"
sleep 1
EV "document.documentElement.style.fontSize"
EV "[...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'A+')?.getAttribute('aria-pressed')"

echo "--- 8) focus ring rule present (computed check on focused el) ---"
EV "(() => { const b = [...document.querySelectorAll('button')][3]; b.focus(); return getComputedStyle(b).outlineColor !== 'rgba(0, 0, 0, 0)' ? 'outline-on-focus' : 'transparent' })()"

echo "--- 9) six buttons in onboarding? (skip: verified E2E) — final: cycle back to ar via ×4 ---"
B press Control+Shift+e; sleep 2
B press Control+Shift+e; sleep 2
B press Control+Shift+e; sleep 2
B press Control+Shift+e; sleep 2
EV "document.documentElement.lang + '/' + document.documentElement.dir"

B screenshot /home/z/my-project/scripts/m14-ui-ar-final.png || true
B close || true
kill -9 $SRV 2>/dev/null || true
sleep 1
echo "SWEEP DONE"
