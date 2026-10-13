#!/usr/bin/env python3
"""تحديث جسم Release v1.0.0 + SHA256SUMS شاملة + تحقق نهائي."""
import hashlib
import json
import os
import urllib.request

TOKEN = os.environ["GH_TOKEN"]
API = "https://api.github.com/repos/CTO-DRS/NexusLink"


def req(method, url, data=None, headers=None):
    r = urllib.request.Request(url, method=method, data=data,
                               headers={"Authorization": f"token {TOKEN}", **(headers or {})})
    with urllib.request.urlopen(r) as resp:
        return resp.status, resp.read()


BODY = """# NexusLink v1.0.0 — الإصدار الثابت لكل المنصات

**سطح المكتب = المركز** (يضم السيرفر كاملًا: واجهة + جسور + بوابة + mDNS) · **الهاتف = الوكيل**.
كل شيء محلي على شبكتك — بلا سحابة وبلا حسابات، والتشفير من الطرف للطرف (X25519 + AES-256-GCM).

## الحزم

| المنصة | الحزمة | لمن؟ |
|---|---|---|
| **Windows** | `NexusLink_1.0.0_x64-setup.exe` | **الموصى بها** — مثبت NSIS يثبّت WebView2 تلقائيًا، صفر خطوات يدوية |
| **Windows** | `NexusLink_1.0.0_x64_en-US.msi` | مثبت WiX للتوزيع المؤسسي (GPO/SCCM) |
| **Windows** | `NexusLink_1.0.0_x64-portable.zip` | بلا تثبيت — فك وشغّل (يعمل من USB) |
| **macOS** (Apple Silicon) | `NexusLink_1.0.0_aarch64.dmg` | اسحب إلى Applications؛ غير موقّع: زر يمين ← Open أول مرة |
| **Linux** | `NexusLink_1.0.0_amd64.deb` | Debian/Ubuntu/Mint |
| **Linux** | `NexusLink_1.0.0_amd64.AppImage` | أي توزيعة — `chmod +x` ثم شغّل |
| **Android** | `NexusLink-1.0.0-release.apk` | الوكيل — فعّل «تثبيت من مصادر غير معروفة» |
| **Android** | `NexusLink-1.0.0-arm64-release.apk` | ARM64 فقط (أخف) |
| iOS | — | يتطلب حساب Apple Developer (IPA بلا توقيع في CI) |

## التشغيل (باختصار)

1. ثبّت حزمة الكمبيوتر وشغّل NexusLink — كل الخدمات تعمل فورًا بلا أي إعداد.
2. على الهاتف: نفس شبكة Wi-Fi ← تطبيق NexusLink ← امسح QR من `http://localhost:3000` على الكمبيوتر.
3. القائمة الكاملة خطوة-خطوة لكل ميزة: `docs/e2e-checklist.md` في المستودع.

## الأمان

- القناة المشفرة E2E (3009) — مرحّل أعمى لا يفك إطارات.
- المحدّث: `latest.json` موقّعة minisign/Ed25519 — فحص التحديث هو الاتصال الخارجي الوحيد وقابل للتعطيل.
- `SHA256SUMS.txt` لكل الأصول + تواقيع `.sig` للمحدّث.

## موثق بصدق

- macOS/Windows غير موقعة Authenticode/Developer ID (شهادات مدفوعة) — تحذير أول تشغيل متوقع (الدليل: BUILD.md §3).
- iOS بلا SMS/مكالمات (قيود Apple) · قياس السرعة للشبكة المحلية فقط.
- كامل التفاصيل: `README.md` · `BUILD.md` · `docs/protocol-contract.md` · `docs/e2e-checklist.md`.
"""

st, _ = req("PATCH", f"{API}/releases/409793052",
            data=json.dumps({"body": BODY}).encode(),
            headers={"Content-Type": "application/json"})
print("PATCH body:", st)

# SHA256SUMS شاملة لكل الأصول (بما فيها APKs)
st, assets = req("GET", f"{API}/releases/409793052/assets?per_page=50")
by_name = {a["name"]: a for a in json.loads(assets)}
lines = []
for name in sorted(by_name):
    if name == "SHA256SUMS.txt":
        continue
    url = by_name[name]["browser_download_url"]
    with urllib.request.urlopen(urllib.request.Request(url)) as resp:
        h = hashlib.sha256(resp.read()).hexdigest()
    lines.append(f"{h}  {name}")
    print("hash", name)
sums = "\n".join(lines) + "\n"
if "SHA256SUMS.txt" in by_name:
    st, _ = req("DELETE", f"{API}/releases/assets/{by_name['SHA256SUMS.txt']['id']}")
    print("DELETE old SHA256SUMS:", st)
st, _ = req("POST", f"{API}/releases/409793052/assets?name=SHA256SUMS.txt",
            data=sums.encode(), headers={"Content-Type": "text/plain"})
print("UPLOAD SHA256SUMS:", st, f"({len(lines)} assets)")
