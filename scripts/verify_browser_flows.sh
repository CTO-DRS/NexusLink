#!/bin/bash
# One-shot browser verification of download-site flows (server may die to OOM — keep it fast)
set -u
cd /home/z/my-project

# 1) ensure server
if ! curl -s -o /dev/null --max-time 2 http://localhost:3000/; then
  echo "[boot] starting dev server..."
  nohup bun run dev > /dev/null 2>&1 &
fi
ok=""
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://localhost:3000/download 2>/dev/null)
  if [ "$code" = "200" ]; then ok=1; echo "[boot] /download 200 after ~$((i*2))s"; break; fi
  sleep 2
done
if [ -z "$ok" ]; then echo "[boot] SERVER-NOT-UP"; exit 1; fi

# 2) browser flows
agent-browser open http://localhost:3000/download && agent-browser wait --load networkidle

echo "== [1] Android tab → Unblock Center =="
agent-browser find text "Android" click 2>/dev/null || agent-browser eval "document.querySelectorAll('[role=tab]')[3].click()"
agent-browser wait 800
agent-browser eval "document.body.innerText.includes('مركز رفع القيود (أندرويد 13+)') && document.body.innerText.includes('السماح بالإعدادات المحظورة') ? 'UNBLOCK-VISIBLE' : 'UNBLOCK-MISSING'"

echo "== [2] FAQ accordion =="
agent-browser eval "var t=document.querySelector('#faq') ? 'FAQ-SECTION-OK' : 'FAQ-SECTION-MISSING'"
agent-browser find text "هل يعمل NexusLink دون إنترنت؟" click 2>/dev/null && agent-browser wait 400
agent-browser eval "document.body.innerText.includes('نعم — كل شيء يعمل على شبكتك المحلية مباشرة') ? 'FAQ-OPENS-OK' : 'FAQ-OPENS-MISSING'"

echo "== [3] language toggle AR→EN =="
agent-browser find text "EN" click 2>/dev/null || agent-browser eval "document.querySelectorAll('header button')[0].click()"
agent-browser wait 1200
agent-browser eval "document.documentElement.dir + '|' + document.documentElement.lang + '|' + (document.body.innerText.includes('Link your devices') ? 'EN-HERO-OK' : 'EN-HERO-MISSING')"

echo "== [4] back to AR =="
agent-browser eval "document.querySelectorAll('header button')[0].click()"
agent-browser wait 1000
agent-browser eval "document.documentElement.dir + '|' + document.documentElement.lang"

echo "== [5] footer sticky at bottom =="
agent-browser eval "var f=document.querySelector('footer'); var r=f.getBoundingClientRect(); var v=window.innerHeight; (r.bottom <= v+2 && r.top < v) ? 'FOOTER-STICKY-OK bottom='+Math.round(r.bottom)+' viewport='+v : 'FOOTER-CHECK bottom='+Math.round(r.bottom)+' viewport='+v"

echo "== [6] mobile viewport =="
agent-browser set viewport 390 844
agent-browser wait 800
agent-browser screenshot /home/z/my-project/scripts/evidence/download-site-mobile.png
agent-browser eval "var f=document.querySelector('footer'); var r=f.getBoundingClientRect(); var v=window.innerHeight; (r.bottom <= v+2) ? 'MOBILE-FOOTER-OK' : 'MOBILE-FOOTER-CHECK bottom='+Math.round(r.bottom)+' viewport='+v"

agent-browser set viewport 1280 720
agent-browser screenshot /home/z/my-project/scripts/evidence/download-site-final.png
echo "== done =="
