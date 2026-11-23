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
# FA-harden (win-symlinks): .next/node_modules في standalone روابط رمزية بأسماء مُجزّأة
# (‏@prisma/client-<hash> · sharp-<hash>) — Git Bash على ويندوز يفشل في نسخها
# («cannot create symbolic link»). ننسخ كل شيء عداها، ثم نبنيها نسخًا حقيقية أدناه.
SA=.next/standalone
for e in "$SA"/* "$SA"/.[!.]*; do
  [ -e "$e" ] || continue
  [ "$(basename "$e")" = ".next" ] && continue
  cp -r "$e" "$RES/server/"
done
mkdir -p "$RES/server/.next"
for e in "$SA/.next"/* "$SA/.next"/.[!.]*; do
  [ -e "$e" ] || continue
  [ "$(basename "$e")" = "node_modules" ] && continue
  cp -r "$e" "$RES/server/.next/"
done
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
# FA-harden (seed-clean): لا نشحن بيانات التطوير/الاختبار للمستخدمين — المخطط فقط
# (db/custom.db في المستودع تبقى كما هي لاختبارات E2E).
mkdir -p "$RES/server/db"
bun scripts/make-clean-seed.mjs db/custom.db "$RES/server/db/custom.db"

# FA-harden (prisma-hashed-external): Turbopack يحل @prisma/client باسم مُجزّأ
# (@prisma/client-<hash>) من .next/node_modules — وهي روابط رمزية تسقط عند حزم
# Tauri (deb/AppImage/MSI) ⇒ كل مسارات قاعدة البيانات 500 «Cannot find module».
# نحوّل الروابط لنسخ حقيقية، وننشئ أي اسم مُجزّأ مذكور في الـchunks وغير موجود.
NM_HASHED="$RES/server/.next/node_modules"
mkdir -p "$NM_HASHED"
# كل اسم مُجزّأ في standalone/.next/node_modules (مع النطاقات @scope/) ← نسخة حقيقية من الحزمة الأصل
if [ -d "$SA/.next/node_modules" ]; then
  for link in $(cd "$SA/.next/node_modules" && ls -d @*/* [!@]* 2>/dev/null); do
    base="${link%-*}"
    dest="$NM_HASHED/$link"
    src="$RES/server/node_modules/$base"
    [ -d "$src" ] || src="node_modules/$base"
    if [ -d "$src" ]; then
      mkdir -p "$(dirname "$dest")"; rm -rf "$dest"; cp -rL "$src" "$dest"
      echo "   hashed external → $link"
    else
      echo "   تحذير: لا مصدر لـ $link ($base)"
    fi
  done
fi
for hashed in $(grep -rhoE "@prisma/client-[0-9a-f]{16}" "$RES/server/.next/server" 2>/dev/null | sort -u); do
  dest="$NM_HASHED/$hashed"
  if [ ! -f "$dest/package.json" ]; then
    mkdir -p "$(dirname "$dest")"
    rm -rf "$dest"
    cp -rL "$RES/server/node_modules/@prisma/client" "$dest"
    echo "   prisma hashed external → $hashed"
  fi
done

# FA-harden (no-sourcemaps): خرائط المصدر تكشف كود النواة المغلقة وتضخم الحزمة
find "$RES/server" -type f -name "*.map" -delete 2>/dev/null || true

# الجولة 3 (G-28): متغيرات musl في node_modules غير مستعملة على أي منصة مستهدفة
# (glibc لينكس / ويندوز / ماك) — وlinuxdeploy يفشل صامتًا على ELF musl
# («Could not find dependency: libc.musl-x86_64.so.1» — r5 verbose) — حذفها من الحزمة
find "$RES/server/node_modules" -depth -type d -name "*musl*" -exec rm -rf {} + 2>/dev/null || true

# الجولة 3 (G-29): تتبع Next (Turbopack) يضمّن شجرة المستودع كاملة في standalone
# (skills/ بأسماء ملفات صينية + download/ scripts/ .git/ …) — تسرّب حجم (~160MB)
# وكسر MSI (LGHT0311: أسماء غير ASCII خارج code page 1252). Keep-list:
# ما يحتاجه server.js وقت التشغيل حصرًا.
cd "$RES/server"
find . -mindepth 1 -maxdepth 1 \
  ! -name 'server.js' ! -name '.next' ! -name 'public' ! -name 'db' \
  ! -name 'node_modules' ! -name 'package.json' \
  -exec rm -rf {} + 2>/dev/null || true
cd - >/dev/null

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
# P1 — منارة الاكتشاف (يتطلبها gateway.cjs بمسار نسبي ./discovery-beacon.cjs)
cp mini-services/gateway/discovery-beacon.cjs "$RES/gateway/discovery-beacon.cjs"

echo "== [4/4] sidecar node placeholder =="
mkdir -p apps/desktop/src-tauri/binaries
[ -f apps/desktop/src-tauri/binaries/.gitkeep ] || touch apps/desktop/src-tauri/binaries/.gitkeep

echo "DONE — resources:"
du -sh "$RES/server" "$RES/comms" "$RES/gateway" 2>/dev/null
