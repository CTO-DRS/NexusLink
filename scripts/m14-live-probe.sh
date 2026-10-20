#!/usr/bin/env bash
# M1.4 — مسحة حية داخل-استدعاء: standalone → /api/health + /api/i18n-status (عقد §31)
set -e
cd /home/z/my-project
PORT=3111
cp -r .next/standalone /tmp/nx-standalone-m14 2>/dev/null || true
mkdir -p /tmp/nx-standalone-m14/.next
cp -r .next/static /tmp/nx-standalone-m14/.next/static 2>/dev/null || true
cp -r public /tmp/nx-standalone-m14/public 2>/dev/null || true
cp -r db /tmp/nx-standalone-m14/db 2>/dev/null || true

cd /tmp/nx-standalone-m14
PORT=$PORT HOSTNAME=127.0.0.1 node server.js > /tmp/m14-server.log 2>&1 &
SRV=$!
for i in $(seq 1 40); do
  sleep 0.5
  if curl -s "http://127.0.0.1:$PORT/api/health" | grep -q '"ok":true'; then break; fi
done
echo "health: $(curl -s http://127.0.0.1:$PORT/api/health | head -c 120)"
echo "i18n-status: $(curl -s http://127.0.0.1:$PORT/api/i18n-status | python3 -m json.tool 2>/dev/null | head -40)"
kill -9 $SRV 2>/dev/null || true
