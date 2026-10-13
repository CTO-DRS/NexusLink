#!/usr/bin/env python3
"""R3 — رفع/استبدال أصول Release v1.0.0 من الجولة الخضراء f6b9e74 (run 38396047063).
- يستبدل: x64-setup.exe · amd64.deb · aarch64.dmg (بأصول الجولة الأخضر — كل إصلاحات الجولة 3)
- يضيف: msi · portable zip · AppImage · app.tar.gz · التواقيع · latest.json · SHA256SUMS.txt
- لا يمس: APKs (خضراء من FA-media كما هي) — الوسم v1.0.0 والإصدار مقفولان.
"""
import base64
import glob
import hashlib
import json
import os
import sys
import urllib.request

TOKEN = os.environ["GH_TOKEN"]
API = "https://api.github.com/repos/CTO-DRS/NexusLink"
UP = "https://uploads.github.com/repos/CTO-DRS/NexusLink/releases/409793052/assets"
A = "/home/z/my-project/download/r3-assets"


def req(method, url, data=None, headers=None, raw=False):
    r = urllib.request.Request(url, method=method, data=data,
                               headers={"Authorization": f"token {TOKEN}", **(headers or {})})
    with urllib.request.urlopen(r) as resp:
        body = resp.read()
        return (resp.status, body if raw else (json.loads(body) if body else {}))


# 1) جلب الأصول الحالية
st, assets = req("GET", f"{API}/releases/409793052/assets?per_page=50")
by_name = {a["name"]: a for a in assets}
print("الحالية:", sorted(by_name))

# 2) حذف ما سيُستبدل (exe/deb/dmg/latest.json — تواقيعها القديمة لا تطابق الجديدة)
for name in ["NexusLink_1.0.0_x64-setup.exe", "NexusLink_1.0.0_amd64.deb",
             "NexusLink_1.0.0_aarch64.dmg", "latest.json"]:
    if name in by_name:
        st, _ = req("DELETE", f"{API}/releases/assets/{by_name[name]['id']}")
        print("DELETE", name, st)

# 3) الأصول الجديدة (اسم → مسار)
uploads = {
    "NexusLink_1.0.0_x64-setup.exe": f"{A}/desktop-windows/release/bundle/nsis/NexusLink_1.0.0_x64-setup.exe",
    "NexusLink_1.0.0_x64_en-US.msi": f"{A}/desktop-windows/release/bundle/msi/NexusLink_1.0.0_x64_en-US.msi",
    "NexusLink_1.0.0_x64-portable.zip": f"{A}/desktop-windows/portable/NexusLink_1.0.0_x64-portable.zip",
    "NexusLink_1.0.0_amd64.deb": f"{A}/desktop-linux/release/bundle/deb/NexusLink_1.0.0_amd64.deb",
    "NexusLink_1.0.0_amd64.AppImage": f"{A}/desktop-linux/release/bundle/appimage/NexusLink_1.0.0_amd64.AppImage",
    "NexusLink_1.0.0_aarch64.dmg": f"{A}/desktop-macos/release/bundle/dmg/NexusLink_1.0.0_aarch64.dmg",
    "NexusLink_1.0.0_aarch64.app.tar.gz": f"{A}/desktop-macos/release/bundle/macos/NexusLink.app.tar.gz",
    "NexusLink_1.0.0_x64-setup.exe.sig": f"{A}/windows-sigs/nsis/NexusLink_1.0.0_x64-setup.exe.sig",
    "NexusLink_1.0.0_x64_en-US.msi.sig": f"{A}/windows-sigs/msi/NexusLink_1.0.0_x64_en-US.msi.sig",
    "NexusLink_1.0.0_amd64.AppImage.sig": f"{A}/linux-sigs/appimage/NexusLink_1.0.0_amd64.AppImage.sig",
    "NexusLink_1.0.0_aarch64.app.tar.gz.sig": f"{A}/macos-sigs/macos/NexusLink.app.tar.gz.sig",
}
for name, path in uploads.items():
    data = open(path, "rb").read()
    st, _ = req("POST", f"{UP}?name={name}", data=data,
                headers={"Content-Type": "application/octet-stream"})
    print("UPLOAD", name, st, f"{len(data)/1048576:.1f}MB")

# 4) latest.json — تواقيع الجولة نفسها (نفس مفتاح pubkey في tauri.conf)
def sig(p):
    return open(p, encoding="utf-8").read().strip()

BASE = "https://github.com/CTO-DRS/NexusLink/releases/download/v1.0.0"
latest = {
    "version": "1.0.0",
    "pub_date": "2026-10-13T12:45:00Z",
    "notes": ("NexusLink v1.0.0 — الإصدار الثابت لكل المنصات (NSIS+MSI+Portable · DMG · AppImage+deb) "
              "مع كامل ميزات الجولات: بث الشاشة/الوسائط الافتراضية، الحافظة النظامية، الطاقة، التحكم اللمسي، "
              "الملفات، قفل التطبيق، المحدّث الموقّع، سجل التدقيق، التشخيص. هذا الإصدار هو الأحدث."),
    "platforms": {
        "windows-x86_64": {
            "signature": sig(f"{A}/windows-sigs/nsis/NexusLink_1.0.0_x64-setup.exe.sig"),
            "url": f"{BASE}/NexusLink_1.0.0_x64-setup.exe",
        },
        "linux-x86_64": {
            "signature": sig(f"{A}/linux-sigs/appimage/NexusLink_1.0.0_amd64.AppImage.sig"),
            "url": f"{BASE}/NexusLink_1.0.0_amd64.AppImage",
        },
        "darwin-aarch64": {
            "signature": sig(f"{A}/macos-sigs/macos/NexusLink.app.tar.gz.sig"),
            "url": f"{BASE}/NexusLink_1.0.0_aarch64.app.tar.gz",
        },
    },
}
latest_bytes = json.dumps(latest, ensure_ascii=False, indent=2).encode()
st, _ = req("POST", f"{UP}?name=latest.json", data=latest_bytes,
            headers={"Content-Type": "application/octet-stream"})
print("UPLOAD latest.json", st)

# 5) SHA256SUMS.txt على كل الأصول النهائية
st, assets2 = req("GET", f"{API}/releases/409793052/assets?per_page=50")
final = {a["name"]: a for a in assets2}
lines = []
for name in sorted(final):
    if name == "SHA256SUMS.txt":
        continue
    if name.endswith((".apk", ".aab")):
        continue  # الـ AAB غير موجود هنا — نحسب لما هو موجود فقط
    url = final[name]["browser_download_url"]
    with urllib.request.urlopen(urllib.request.Request(url)) as resp:
        h = hashlib.sha256(resp.read()).hexdigest()
    lines.append(f"{h}  {name}")
sums = "\n".join(lines) + "\n"
st, _ = req("POST", f"{UP}?name=SHA256SUMS.txt", data=sums.encode(),
            headers={"Content-Type": "text/plain"})
print("UPLOAD SHA256SUMS.txt", st, f"({len(final)} entries)")
print("DONE")
