# NexusLink — دليل البناء والإصدار (الجولة 3)

كل ما تحتاجه لبناء حزم المنصات الخمس محليًا أو عبر CI — نفس الخطوات التي ينفذها
`.github/workflows/release.yml` حرفيًا (وصفة مجرّبة أخضر 3/3).

**رقم الإصدار موحّد ومقفول: `1.0.0`** — يُصرَّح به في 4 ملفات يجب أن تبقى متطابقة:

| الملف | الحقل | القيمة |
|---|---|---|
| `apps/desktop/src-tauri/tauri.conf.json` | `version` | 1.0.0 |
| `apps/desktop/src-tauri/Cargo.toml` | `package.version` | 1.0.0 |
| `nexuslink_mobile/pubspec.yaml` | `version` | 1.0.0+1 |
| `package.json` (الجذر) | `version` | 1.0.0 |

> قاعدة صارمة: أي تغيير مستقبلي للإصدار يتم في الملفات الأربعة معًا وبإنشاء وسم
> `v*` جديد — لا تُعدّل أصول إصدار منشور أبدًا (تواقيع `latest.json` تُبنى على
> محتوى الملفات الحالي).

---

## مصفوفة الحزم

| المنصة | الصيغ | المُنتِج | التوقيع |
|---|---|---|---|
| Windows | NSIS `x64-setup.exe` · MSI · **Portable ZIP** | job `desktop` (matrix) | minisign (updater) · Authenticode اختياري |
| macOS | DMG + `.app.tar.gz` (updater) | job `desktop` | Developer ID + Notarization (يتطلب حساب) |
| Linux | AppImage · deb | job `desktop` | minisign (updater) |
| Android | APK موقّع · AAB | job `android` | keystore من الـ secrets |
| iOS | IPA (بلا توقيع) | job `ios` | يتطلب حساب Apple Developer |

---

## 1) المتطلبات المشتركة

| الأداة | الإصدار | ملاحظات |
|---|---|---|
| Bun | 1.1+ | الوِب والسيرفر والـ CLI |
| Rust | stable | `rustup` — الطبقة الأصلية (Tauri) |
| Node.js | 20.x | يُنزَّل كـ sidecar تلقائيًا في CI (v20.18.1) |
| Python 3 | 3.8+ | سكربتات مساعدة فقط |

---

## 2) سطح المكتب (Tauri 2) — الخطوات الكاملة

من جذر المونو-ريبو:

```bash
# (أ) الوِب والسيرفر المضمّن
bun install --frozen-lockfile
bunx prisma generate
bunx next build
cp -r .next/static .next/standalone/.next/
cp -r public .next/standalone/

# (ب) تجميع الموارد: server/ + comms/ + gateway/ داخل src-tauri/resources
bash apps/desktop/build-resources.sh

# (ج) sidecar Node — انسخه إلى binaries بالاسم الثلاثي لمنصتك:
mkdir -p apps/desktop/src-tauri/binaries
#   لينكس x64:
curl -fL -o node.tar.xz https://nodejs.org/dist/v20.18.1/node-v20.18.1-linux-x64.tar.xz
tar -xJf node.tar.xz
cp node-v20.18.1-linux-x64/bin/node apps/desktop/src-tauri/binaries/node-x86_64-unknown-linux-gnu
#   (ويندوز: node.exe → binaries/node-x86_64-pc-windows-msvc.exe — ماك: darwin-arm64)
```

### البناء لكل منصة

```bash
cd apps/desktop

# لينكس (deb + AppImage) — يلزم: libwebkit2gtk-4.1-dev libappindicator3-dev
#   librsvg2-dev patchelf libxkbcommon-dev cmake g++
#   NO_STRIP: linuxdeploy يفشل على strip لمكتبات .relr.dyn (tauri#14796)
NO_STRIP=true APPIMAGE_EXTRACT_AND_RUN=1 CMAKE_POLICY_VERSION_MINIMUM=3.5 \
  bunx @tauri-apps/cli@^2 build --bundles "deb appimage" \
  --config '{"bundle":{"externalBin":["binaries/node"]}}'

# ويندوز (NSIS + MSI) — PowerShell عادي. ملاحظة: MSI يتطلب ميزة VBScript
#   مفعّلة (تحقق ICE في light.exe) — على runners 2026:
#   Add-WindowsCapability -Online -Name VBSCRIPT~~~~0.0.1.0
bunx @tauri-apps/cli@^2 build --bundles "nsis msi" --config '{"bundle":{"externalBin":["binaries/node"]}}'

# ماك (DMG + أصل updater) — "app" هو من ينتج .app.tar.gz + .sig (لا dmg وحده)
bunx @tauri-apps/cli@^2 build --bundles "dmg app" --config '{"bundle":{"externalBin":["binaries/node"]}}'
```

> **متغيران إلزاميان على لينكس** (دروس CI موثقة):
> `APPIMAGE_EXTRACT_AND_RUN=1` — linuxdeploy بلا FUSE على المُشغّلات.
> `CMAKE_POLICY_VERSION_MINIMUM=3.5` — CMake 4 أزال توافق <3.5 وlibopus المضمن قديم.

النواتج في `apps/desktop/src-tauri/target/release/bundle/`:
`nsis/NexusLink_1.0.0_x64-setup.exe` · `msi/NexusLink_1.0.0_x64_en-US.msi` ·
`appimage/*.AppImage` · `deb/*.deb` · `dmg/*.dmg`.

### نسخة Portable ZIP (ويندوز)

لا ينتجها Tauri — تُجمَّع بعد البناء بنفس تخطيط NSIS تمامًا (والذي يقرؤه
`procman::resolve_resources` أولًا):

```
NexusLink-Portable-1.0.0/
├── NexusLink.exe        ← target/release (أو nexuslink-desktop.exe مُعاد تسميته)
├── node.exe             ← sidecar node-x86_64-pc-windows-msvc.exe مُعاد تسميته
├── resources/
│   ├── server/          ← Next standalone كامل
│   ├── comms/comms.cjs
│   └── gateway/gateway.cjs
└── README.txt           ← apps/desktop/PORTABLE-README.txt
```

ضغط: `/c/Windows/System32/tar.exe -a -cf NexusLink_1.0.0_x64-portable.zip NexusLink-Portable-1.0.0`
(bsdtar يتجاوز مشاكل المسارات الطويلة في Compress-Archive مع node_modules).

### متغيرات بيئة التوقيع للمحدّث (updater)

```bash
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/nexuslink.key)"        # مفتاح minisign الخاص
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="..."                          # كلمة مرور المفتاح
```

وجود المفتاح + `createUpdaterArtifacts: true` (مفعّل في tauri.conf.json) يُنتج
بجوار كل حزمة ملف `.sig` — وهي مدخل `latest.json`. **بلا مفتاح: مرّر
`"createUpdaterArtifacts":false` في الـ config وإلا فشل البناء.**

توليد مفتاح جديد (مرة واحدة فقط — تغييره يبطّل التحديث لكل المستخدمين):

```bash
bunx @tauri-apps/cli signer generate -w ~/.tauri/nexuslink.key
# المفتاح العام يوضع في tauri.conf.json → plugins.updater.pubkey
# الخاص يُخزَّن في secrets: TAURI_SIGNING_PRIVATE_KEY + TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

---

## 3) macOS — توقيع Developer ID وNotarization

البناء الافتراضي (CI) ينتج DMG **غير موقّع** (ad-hoc) — يعمل محليًا مع
Right-click → Open، والتوزيع الواسع يتطلب حساب Apple Developer ($99/سنة).

### 3-أ) الإعداد مرة واحدة

```bash
# شهادة Developer ID Application (من developer.apple.com → Certificates)
# تُصدَّر .p12 وتُستورد إلى Keychain:
security import DeveloperID.p12 -k ~/Library/Keychains/login.keychain-db

# تحقق:
security find-identity -v -p codesigning
# … "Developer ID Application: Your Name (TEAMID)"
```

### 3-ب) التوقيع عبر Tauri (يعمل محليًا وفي CI)

في `tauri.conf.json` → `bundle.macOS` أضف:

```json
{ "signingIdentity": "Developer ID Application: Your Name (TEAMID)" }
```

ومعها متغيرات البيئة (أسرار CI المقترحة بين قوسين):

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export APPLE_CERTIFICATE="[APPLE_CERTIFICATE_BASE64]"           # ملف .p12 بترميز base64
export APPLE_CERTIFICATE_PASSWORD="[APPLE_CERTIFICATE_PASSWORD]"
export APPLE_API_ISSUER="[APPLE_API_ISSUER]"                    # App Store Connect API
export APPLE_API_KEY="[APPLE_API_KEY_ID]"
export APPLE_API_KEY_PATH="[APPLE_API_KEY_PATH]"                # .p8
```

Tauri يوقّع .app ويدمج الـ entitlements (`Info.plist` موجود في src-tauri) ثم
**يُرسل للـ Notarization تلقائيًا** عند اكتمال الحزمة وينتظر النتيجة
(staple تلقائي).

### 3-ج) التوقيع اليدوي (بديل — بدون Tauri)

```bash
codesign --deep --force --options runtime \
  --entitlements entitlements.plist \
  --sign "Developer ID Application: …" NexusLink.app

# Notarization عبر notarytool ثم staple:
xcrun notarytool submit NexusLink_1.0.0_aarch64.dmg \
  --key ~/AuthKey.p8 --key-id KEYID --issuer ISSUERID --wait
xcrun stapler staple NexusLink_1.0.0_aarch64.dmg

# تحقق نهائي:
spctl -a -vv -t install NexusLink.app
stapler validate NexusLink_1.0.0_aarch64.dmg
```

> حدود صادقة: بلا حساب مدفوع يبقى Gatekeeper يحذر — موثق في §15 من العقد.

---

## 4) Android / iOS

موثقة كاملة في `README.md` §3 (keystore + patch flutter_webrtc + analyze
الصفرية). iOS: `flutter build ipa --release --no-codesign` — التوقيع
وTestFlight يتطلبان حساب Apple.

---

## 5) خط الإصدار CI (release.yml) — دليل التشغيل

| الحدث | ماذا يحدث |
|---|---|
| `workflow_dispatch` (افتراضي) | lint 3 OS → بناء desktop matrix (NSIS+MSI+ZIP / DMG / AppImage+deb) → APK/AAB → **artifacts فقط** — لا يمس أي Release |
| `workflow_dispatch` + `attach_to_release=true` | نفس السابق + إرفاق الأصول بالـ Release المحدد (`release_tag`) — **استخدمه بحذر: لا يستبدل أصولًا موقعة في latest.json** |
| `push` وسم `v*` | كل السابق + إرفاق تلقائي + `latest.json` موقعة + SHA256SUMS + Draft Release |

أسرار CI المطلوبة:

| السر | الغرض | الحالة |
|---|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` + `_PASSWORD` | توقيع updater artifacts + latest.json | ✅ مضبوطة |
| `ANDROID_KEYSTORE_BASE64` + 3 أسرار | توقيع APK/AAB | ✅ مضبوطة |
| `APPLE_*` (اختياري) | توقيع/Notarization ماك | ⬜ تتطلب حساب |

التحقق بعد أي إرفاق:

```bash
curl -sL https://github.com/CTO-DRS/NexusLink/releases/latest/download/latest.json | python3 -m json.tool
# يجب أن يرد platforms الثلاثة وversion = رقم الوسم
```

---

## 6) قواعد إصدار لا تُخالف

1. **أصول إصدار منشور لا تُستبدل** — تواقيع latest.json مبنية على محتواها.
2. الوسم فقط يُنشئ إصدارًا جديدًا تلقائيًا (draft أولًا، مراجعة ثم Publish).
3. تحديث `latest.json` يدويًا (بعد استبدال قسري): `scripts/build-latest-json.sh`
   (يتطلب المفتاح الخاص محليًا — عند فقدانه استخدم مسار الوسم في CI).
4. الملفات الأربعة للإصدار تُعدّل معًا (جدول أعلى الملف) — أي اختلاف = فشل
   فحص E2E التعاقدي (توحيد الإصدار).
