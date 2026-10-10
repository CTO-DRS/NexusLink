#!/bin/bash
# حلقة استئناف تلقائي حتى اكتمال تنزيل Flutter SDK (3.24.5 stable linux)
URL="https://storage.googleapis.com/flutter_infra_release/releases/stable/linux/flutter_linux_3.24.5-stable.tar.xz"
OUT="/home/z/flutter-3.24.5.tar.xz"
for i in $(seq 1 90); do
  # -C - استئناف من حيث توقف؛ --max-time يمنع التعليق اللانهائي
  curl -sL -C - --retry 2 --max-time 150 -o "$OUT" "$URL"
  rc=$?
  sz=$(stat -c%s "$OUT" 2>/dev/null || echo 0)
  echo "[try $i] rc=$rc size=$sz"
  # الحجم المتوقع للإصدار 3.24.5 ≈ 693MB — نتحقق عبر اكتمال curl (rc=0)
  if [ $rc -eq 0 ]; then break; fi
  sleep 1
done
echo "final size: $(stat -c%s "$OUT" 2>/dev/null)"
