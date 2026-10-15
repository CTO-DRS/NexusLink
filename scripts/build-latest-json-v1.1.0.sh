#!/usr/bin/env bash
# R4-release (عقد §23) — بناء latest.json الموقعة للإصدار v1.1.0
# ============================================================
# نفس خط v1.0.0 الأخضر (build-latest-json.sh) — الفروق:
# · الإصدار 1.1.0 (الجولة 4: NexusLive + الشاشة الثانية + اللوحة + الثلاثية + الأجهزة الافتراضية)
# · معرف الإصدار يُكتشف من الوسم عبر API (لا معرف مثبت — الإصدار يُنشأ مسودة من release.yml)
# 1) تنزيل أصول المنصات المكتبية الثلاثة بالتتابع (توفير القرص — حذف فوري بعد التوقيع)
# 2) توقيع كل أصل بالمفتاح الخاص (minisign — نفس مفاتيح CI)
# 3) بناء latest.json (version=1.1.0 — الفحص يعيد «يتوفر تحديث» لمستخدمي 1.0.0)
# 4) رفع latest.json إلى Release v1.1.0 (نقطة الفحص:
#    https://github.com/CTO-DRS/NexusLink/releases/latest/download/latest.json)
# ⚠️ تشغّل بعد نشر مسودة الـ Release (لا مسودة تظهر في releases/latest) — عقد §23.
set -euo pipefail

VERSION="1.1.0"
TAG="v${VERSION}"
TOKEN="${GITHUB_TOKEN:-GITHUB_TOKEN_ENV}"
API="https://api.github.com"
UPLOAD="https://uploads.github.com"
REPO="CTO-DRS/NexusLink"
KEY="${TAURI_KEY_PATH:-/home/z/.tauri/nexuslink.key}"
TAURI="${TAURI_CLI:-/home/z/.local/bin/tauri}"
WORK="/tmp/nl-sign-${VERSION}"
mkdir -p "$WORK"
cd "$WORK"

echo "== اكتشاف معرف الإصدار $TAG…"
RELEASE_ID=$(curl -s -H "Authorization: token $TOKEN" "$API/repos/$REPO/releases/tags/$TAG" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id') or sys.exit('الإصدار غير موجود — انشر المسودة أولًا'))")
echo "RELEASE_ID=$RELEASE_ID"

BASE="https://github.com/$REPO/releases/download/$TAG"

sign_asset() {
  local name="$1"
  echo "== تنزيل $name…"
  curl -sL -H "Authorization: token $TOKEN" -o "$name" "$BASE/$name"
  local sz
  sz=$(stat -c%s "$name")
  echo "== توقيع ($(( sz / 1048576 )) MB)…"
  "$TAURI" signer sign -f "$KEY" --password "${TAURI_KEY_PASSWORD:?مطلوب كلمة سر المفتاح}" "$name"
  local sig
  sig=$(cat "$name.sig")
  rm -f "$name" "$name.sig" # حرر القرص فورًا
  echo "$sig" > "$WORK/$name.sig.txt"
  echo "== $name وقّع ✓"
}

sign_asset "NexusLink_${VERSION}_x64-setup.exe"
sign_asset "NexusLink_${VERSION}_amd64.deb"
sign_asset "NexusLink_${VERSION}_aarch64.app.tar.gz"

python3 - "$VERSION" <<'PY'
import json, sys

version = sys.argv[1]
sig = {}
for name in [
    f"NexusLink_{version}_x64-setup.exe",
    f"NexusLink_{version}_amd64.deb",
    f"NexusLink_{version}_aarch64.app.tar.gz",
]:
    with open(f"/tmp/nl-sign-{version}/{name}.sig.txt", encoding="utf-8") as f:
        sig[name] = f.read().strip()

BASE = f"https://github.com/CTO-DRS/NexusLink/releases/download/v{version}"
latest = {
    "version": version,
    "pub_date": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "notes": (
        f"NexusLink v{version} — الجولة 4 كاملة: قناة NexusLive الحية فوق UDP (P95=13ms قلمًا)، "
        "الهاتف شاشة ثانية فعلية، لوحة رسم بقلم وضغط (uinput على لينكس)، ثلاثية التحكم المتقدم "
        "(جيمباد حساسات 100Hz + ماوس هوائي معاير + عارض عروض)، و«NexusLink Camera» بلا خطوات يدوية. "
        "التفاصيل: docs/releases/v" + version + ".md (عربي/English)."
    ),
    "platforms": {
        "windows-x86_64": {"signature": sig[f"NexusLink_{version}_x64-setup.exe"], "url": f"{BASE}/NexusLink_{version}_x64-setup.exe"},
        "linux-x86_64": {"signature": sig[f"NexusLink_{version}_amd64.deb"], "url": f"{BASE}/NexusLink_{version}_amd64.deb"},
        "darwin-aarch64": {"signature": sig[f"NexusLink_{version}_aarch64.app.tar.gz"], "url": f"{BASE}/NexusLink_{version}_aarch64.app.tar.gz"},
    },
}
with open(f"/tmp/nl-sign-{version}/latest.json", "w", encoding="utf-8") as f:
    json.dump(latest, f, ensure_ascii=False, indent=2)
print("latest.json built:", len(json.dumps(latest)), "bytes · platforms:", list(latest["platforms"]))
PY

echo "== رفع latest.json إلى Release $TAG…"
curl -s -X POST \
  -H "Authorization: token $TOKEN" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @"$WORK/latest.json" \
  "$UPLOAD/repos/$REPO/releases/$RELEASE_ID/assets?name=latest.json" | python3 -c "
import json,sys
d = json.load(sys.stdin)
print('uploaded:', d.get('name'), d.get('state'), d.get('browser_download_url'))
"

echo "== تحقق: نقطة الفحص تعيد $VERSION…"
curl -sL "https://github.com/$REPO/releases/latest/download/latest.json" | python3 -c "
import json,sys
d = json.load(sys.stdin)
assert d['version'] == '$VERSION', d['version']
print('CHECK-OK: version =', d['version'], '· platforms =', list(d['platforms'].keys()))
"
echo "LATEST_JSON_DONE"
