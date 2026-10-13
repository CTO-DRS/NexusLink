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

# FA-harden (G-26): حذف .env المضمنة — Next ينسخها مع مسار DATABASE_URL المطلق
# لآلة البناء (مكسور على أجهزة المستخدمين). procman يضبط DATABASE_URL بيئيًا
# إلى مسار قابل للكتابة لكل جهاز (قيمة env الأب تتفوق على .env دائمًا)، ويزرع
# قاعدة seed أدناه عند أول إقلاع.
rm -f "$RES/server/.env" "$RES/server/.env.production"

# FA-harden (G-26): قاعدة seed (SQLite) — تُزرع إلى مجلد إعدادات التطبيق عند أول
# إقلاع وتُحدَّث نسختها عند إعادة الحزم (prisma db push قبل البناء).
mkdir -p "$RES/server/db"
cp db/custom.db "$RES/server/db/custom.db"

# الجولة 3 (G-28): متغيرات musl في node_modules غير مستعملة على أي منصة مستهدفة
# (glibc لينكس / ويندوز / ماك) — وlinuxdeploy يفشل صامتًا على ELF musl
# («Could not find dependency: libc.musl-x86_64.so.1» — r5 verbose) — حذفها من الحزمة
find "$RES/server/node_modules" -depth -type d -name "*musl*" -exec rm -rf {} + 2>/dev/null || true

echo "== [2/4] comms-service → $RES/comms/comms.cjs =="
# الجولة 3 (G-27): تبعيات comms-service حصرية في ملفه (الجذر بلا workspaces —
# وbun install الجذر لا يثبتها). بلا هذا الحرس يفشل esbuild في الحل فيترك
# import("bonjour-service") خارجيًا ⇒ mDNS مكسور داخل الحزم الموزعة (فشل صامت
# وقت البناء — يظهر فقط عند تشغيل الحزمة). CI كان يبنيه مكسورًا حتى هذه الجولة.
if [ ! -d mini-services/comms-service/node_modules ]; then
  echo "   تبعيات comms-service غائبة — bun install (lockfile ملتزم)…"
  (cd mini-services/comms-service && bun install --frozen-lockfile)
fi
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
