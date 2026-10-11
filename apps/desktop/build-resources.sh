#!/usr/bin/env bash
# NexusLink — تجميع موارد حزمة سطح المكتب (Tauri resources)
# ============================================================
# يُنتج محتوى apps/desktop/src-tauri/resources/:
#   server/    → Next.js standalone (server.js + .next/static + public)
#   comms/     → comms.cjs (حزمة esbuild لجسر 3003 + mDNS)
#   gateway/   → gateway.cjs (بوابة :81 — بديل Caddy بنفس العقد)
# يتطلب: bun run build (في الجذر) أولاً + esbuild (bunx).
set -euo pipefail
cd "$(dirname "$0")/../.."   # → جذر المونو-ريبو (apps/desktop → root)

RES="apps/desktop/src-tauri/resources"
echo "== [1/4] Next standalone → $RES/server =="
test -f .next/standalone/server.js || { echo "الخطأ: شغّل 'bun run build' أولًا"; exit 1; }
rm -rf "$RES/server"
mkdir -p "$RES/server"
cp -r .next/standalone/. "$RES/server/"
# احتياط: static/public قد تكون داخل standalone (سكربت البناء ينسخهما) — نضمن الوجود
[ -d "$RES/server/.next/static" ] || { echo "نسخ .next/static يدويًا…"; cp -r .next/static "$RES/server/.next/static"; }
[ -d "$RES/server/public" ] || { echo "نسخ public يدويًا…"; cp -r public "$RES/server/public"; }

echo "== [2/4] comms-service → $RES/comms/comms.cjs =="
mkdir -p "$RES/comms"
bunx esbuild mini-services/comms-service/index.ts --bundle --platform=node --format=cjs \
  --outfile="$RES/comms/comms.cjs" --log-level=error

echo "== [3/4] gateway → $RES/gateway/gateway.cjs =="
mkdir -p "$RES/gateway"
cp mini-services/gateway/index.cjs "$RES/gateway/gateway.cjs"

echo "== [4/4] sidecar node placeholder =="
mkdir -p apps/desktop/src-tauri/binaries
[ -f apps/desktop/src-tauri/binaries/.gitkeep ] || touch apps/desktop/src-tauri/binaries/.gitkeep

echo "DONE — resources:"
du -sh "$RES/server" "$RES/comms" "$RES/gateway" 2>/dev/null
