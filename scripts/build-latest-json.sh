#!/usr/bin/env bash
# FA-harden (عقد §16 بند 2) — بناء latest.json الموقعة للإصدار v1.0.0
# ============================================================
# 1) تنزيل الأصول الثلاثة للمنصات المكتبية بالتتابع (توفير القرص — حذف فوري بعد التوقيع)
# 2) توقيع كل أصل بالمفتاح الخاص (minisign — نفس مفاتيح CI)
# 3) بناء latest.json (version=1.0.0 — الإصدار مقفول: الفحص يعيد «أنت على الأحدث»)
# 4) رفع latest.json إلى Release v1.0.0 (نقطة الفحص:
#    https://github.com/CTO-DRS/NexusLink/releases/latest/download/latest.json)
set -euo pipefail

TOKEN="GITHUB_TOKEN_ENV"
API="https://api.github.com"
UPLOAD="https://uploads.github.com"
REPO="CTO-DRS/NexusLink"
RELEASE_ID="409793052"
KEY="/home/z/.tauri/nexuslink.key"
TAURI="/home/z/.local/bin/tauri"
WORK="/tmp/nl-sign"
mkdir -p "$WORK"
cd "$WORK"

BASE="https://github.com/$REPO/releases/download/v1.0.0"

sign_asset() {
  local name="$1"
  echo "== تنزيل $name…"
  curl -sL -H "Authorization: token $TOKEN" -o "$name" "$BASE/$name"
  local sz
  sz=$(stat -c%s "$name")
  echo "== توقيع ($(( sz / 1048576 )) MB)…"
  "$TAURI" signer sign -f "$KEY" --password "nexuslink-harden-2026" "$name"
  local sig
  sig=$(cat "$name.sig")
  rm -f "$name" "$name.sig" # حرر القرص فورًا
  echo "$sig" > "$WORK/$name.sig.txt"
  echo "== $name وقّع ✓"
}

sign_asset "NexusLink_1.0.0_x64-setup.exe"
sign_asset "NexusLink_1.0.0_amd64.deb"
sign_asset "NexusLink_1.0.0_aarch64.dmg"

python3 - <<'PY'
import json

sig = {}
for name in ["NexusLink_1.0.0_x64-setup.exe", "NexusLink_1.0.0_amd64.deb", "NexusLink_1.0.0_aarch64.dmg"]:
    with open(f"/tmp/nl-sign/{name}.sig.txt", encoding="utf-8") as f:
        sig[name] = f.read().strip()

BASE = "https://github.com/CTO-DRS/NexusLink/releases/download/v1.0.0"
latest = {
    "version": "1.0.0",
    "pub_date": "2026-10-12T12:00:00Z",
    "notes": "NexusLink v1.0.0 — الإصدار الثابت (قفل التطبيق + محدّث موقّع + تدقيق أصلي + تحسين خمول + تشخيص فعلي). هذا الإصدار هو الأحدث — لا تحديث مطلوب.",
    "platforms": {
        "windows-x86_64": {"signature": sig["NexusLink_1.0.0_x64-setup.exe"], "url": f"{BASE}/NexusLink_1.0.0_x64-setup.exe"},
        "linux-x86_64": {"signature": sig["NexusLink_1.0.0_amd64.deb"], "url": f"{BASE}/NexusLink_1.0.0_amd64.deb"},
        "darwin-aarch64": {"signature": sig["NexusLink_1.0.0_aarch64.dmg"], "url": f"{BASE}/NexusLink_1.0.0_aarch64.dmg"},
    },
}
with open("/tmp/nl-sign/latest.json", "w", encoding="utf-8") as f:
    json.dump(latest, f, ensure_ascii=False, indent=2)
print("latest.json built:", len(json.dumps(latest)), "bytes")
PY

echo "== رفع latest.json إلى Release v1.0.0…"
curl -s -X POST \
  -H "Authorization: token $TOKEN" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @"$WORK/latest.json" \
  "$UPLOAD/repos/$REPO/releases/$RELEASE_ID/assets?name=latest.json" | python3 -c "
import json,sys
d = json.load(sys.stdin)
print('uploaded:', d.get('name'), d.get('state'), d.get('browser_download_url'))
"

echo "== تحقق: نقطة الفحص تعيد 1.0.0…"
curl -sL "https://github.com/$REPO/releases/latest/download/latest.json" | python3 -c "
import json,sys
d = json.load(sys.stdin)
assert d['version'] == '1.0.0', d['version']
print('CHECK-OK: version =', d['version'], '· platforms =', list(d['platforms'].keys()))
"
echo "LATEST_JSON_DONE"
