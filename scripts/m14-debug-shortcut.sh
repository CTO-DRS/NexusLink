#!/usr/bin/env bash
set -e
cd /home/z/my-project
ROOT=$(pwd)/
export NEXUS_DATA_ROOT="${ROOT}.next/standalone/data"
node .next/standalone/server.js > /tmp/m14-ui-server.log 2>&1 &
SRV=$!
for i in $(seq 1 50); do sleep 0.5; curl -s http://127.0.0.1:3000/api/health 2>/dev/null | grep -q '"ok":true' && break; done
B() { agent-browser "$@" 2>&1 | tail -2; }
B open http://127.0.0.1:3000
B storage local set nexus-onboarded 1
B reload
B wait --load networkidle
sleep 1
echo "--- dispatch keydown via eval ---"
B eval "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'E', ctrlKey: true, shiftKey: true, bubbles: true })); 'dispatched'"
sleep 2.5
B eval "document.documentElement.lang + '/' + document.documentElement.dir"
echo "--- agent-browser press + focus check ---"
B eval "document.activeElement?.tagName || 'none'"
B press Control+Shift+E
sleep 2
B eval "document.documentElement.lang + '/' + document.documentElement.dir"
echo "--- console errors ---"
B errors || true
kill -9 $SRV 2>/dev/null || true
echo "DEBUG DONE"
