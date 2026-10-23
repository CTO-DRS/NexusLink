#!/usr/bin/env bash
# NexusLink §43 — عقل إعدادات التوقيع في البناء (النواة النائمة لـ X1/X2)
# -----------------------------------------------------------
# المدخلات (بيئة): UPDATER_SIGN=true|false · WIN_THUMBPRINT=<بصمة SHA-1 أو فارغ>
# الخرج: JSON سطر واحد لـ --config في Tauri — يُطابق السلوك التاريخي حرفيًا
# عند غياب التوقيع (نفس سلسلتي UPDATER_SIGN الحاليتين بلا أي إزاحة)، ويضيف
# كتلة bundle.windows لحظة وجود بصمة شهادة Authenticode (§43: قدرة نائمة).
# فشل-مغلق: بصمة غير سداسية 40 خانة = خروج 2 (النفاية تُرفض مبكرًا لا متأخرًا
# في عمق signtool) — نمط REFUSING في §41.
set -euo pipefail

BASE='{"bundle":{"externalBin":["binaries/node"]'
THUMB="${WIN_THUMBPRINT:-}"

if [ -n "$THUMB" ]; then
  # بصمة Authenticode = SHA-1 سداسي 40 خانة (بنية سلسلة الشهادة المعيارية)
  if ! printf '%s' "$THUMB" | grep -Eq '^[0-9a-fA-F]{40}$'; then
    echo "REFUSING: WIN_THUMBPRINT ليست بصمة سداسية 40 خانة — ارفض مبكرًا بدل فشل signtool متأخر" >&2
    exit 2
  fi
  # كتلة windows تُغلق نفسها — الإغلاق النهائي (bundle + الجذر) في الأسفل
  OUT="$BASE,\"windows\":{\"certificateThumbprint\":\"$THUMB\",\"digestAlgorithm\":\"sha256\",\"timestampUrl\":\"http://timestamp.digicert.com\"}"
else
  OUT="$BASE"
fi

if [ "${UPDATER_SIGN:-false}" = "true" ]; then
  OUT="$OUT}}"
else
  OUT="$OUT,\"createUpdaterArtifacts\":false}}"
fi

printf '%s' "$OUT"
