# NexusLink — منصة ربط الأجهزة عبر الشبكة المحلية

[![GitHub release](https://img.shields.io/github/v/release/CTO-DRS/NexusLink)](https://github.com/CTO-DRS/NexusLink/releases/latest)
[![Platforms](https://img.shields.io/badge/platforms-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Android-009b8f)](https://cto-drs.github.io/NexusLink/)
[![Website](https://img.shields.io/website?url=https%3A%2F%2Fcto-drs.github.io%2FNexusLink%2F&up_color=009b8f)](https://cto-drs.github.io/NexusLink/)
[![Commit activity](https://img.shields.io/github/commit-activity/m/CTO-DRS/NexusLink)](https://github.com/CTO-DRS/NexusLink/commits/main)
[![Last commit](https://img.shields.io/github/last-commit/CTO-DRS/NexusLink)](https://github.com/CTO-DRS/NexusLink/commits/main)

**🌐 الموقع والتحميل المباشر: <https://cto-drs.github.io/NexusLink/>**

> **Quick facts (باهتزاز واحد):** NexusLink · v3.1.0 · مجاني للاستخدام الشخصي ·
> Windows 10/11 · macOS 12+ · Linux x64 · Android 8+ (iOS: وسائط/ملفات/حافظة فقط — حد معلن) ·
> ازدواجية ترخيص صادقة: نواة مملوكة + مجموعة مفتوحة MIT (انظر `LICENSE` و`docs/OPEN-COMPONENTS.md`) ·
> لا سحابة · لا حسابات · لا تتبع · تشفير X25519 + AES-256-GCM من الطرف للطرف ·
> 6 لغات (ar · en · fr · es · de · ru) · 1316 فحص E2E عبر 49 عقدًا موثقًا.

منصة واحدة تربط هاتفك بجهاز الكمبيوتر — كل شيء محلي على شبكتك، بلا سحابة وبلا حسابات.
هذا الملف يشرح التشغيل الكامل: **سطح المكتب (المركز) ← الهاتف (الوكيل) ← الاختبار المشترك**،
مع خريطة المنافذ ونقاط التحقق السريعة لكل طبقة (FA-2 … FA-10).

---

## English — one hub for all your devices, on your own network

**NexusLink** unifies what AirDroid, scrcpy, LocalSend, Phone Link and KDE Connect each
do alone — into **one local-first desktop hub** with one Android agent app. Everything
runs on **your own Wi-Fi**: no cloud account, no relay server, no telemetry — the
Internet is never on the data path.

| Capability | What you get |
|---|---|
| 🖥️ Screen & input | Live second-screen streaming (WebRTC + NexusLive over UDP, P95 ≈ 13 ms stylus), touchpad/touch control, clipboard sync both ways |
| 📁 Files & media | Drag-and-drop transfer, phone file browsing from the desktop, media playback control, virtual camera |
| 🤖 Smart routines | Local automation with live & historical triggers, durable alerts, offline unified search, on-device assistant |
| 🔐 Security | X25519 + AES-256-GCM end-to-end encryption with emoji SAS verification, rotating keys, tamper-evident audit log, zero external calls |
| 🧰 Open tooling | SDK 2.0 + public REST APIs + 16-command CLI (MIT-licensed open set), 6 languages (ar · en · fr · es · de · ru) |
| 🏢 Beyond the desk | Enterprise policy (MDM), OEM privacy-by-default mode, remote assist with short-code pairing & one-tap disconnect |

**Download** (Windows 10/11 · macOS 12+ Apple Silicon · Linux x64 · Android):
[Latest release](https://github.com/CTO-DRS/NexusLink/releases/latest) — install, launch,
scan the QR from the phone app, done. Full guide in §0 below (العربية).
Landing page: <https://cto-drs.github.io/NexusLink/>.

**Keywords / ابحث عنا:** device management · screen mirroring · scrcpy alternative ·
AirDroid alternative · KDE Connect alternative · LocalSend alternative · phone to PC ·
remote assist · clipboard sync · file transfer over LAN · WebRTC streaming ·
E2EE privacy tool · local-first software · بدون إنترنت · بديل أيرو درويد ·
مرآة الشاشة · نقل ملفات واي فاي · مزامنة الحافظة · التحكم بالهاتف من الكمبيوتر ·
خصوصية · مصدر مفتوح جزئيًا (SDK + CLI بترخيص MIT).

**License** — honest dual model (like Obsidian): closed core © 2026 CTO-DRS, all rights
reserved; a declared open set (SDK · CLI · pairing math · oplog · docs) under
[MIT](LICENSES/MIT.txt) — see [LICENSE](LICENSE) and
[docs/OPEN-COMPONENTS.md](docs/OPEN-COMPONENTS.md).

---

## 0) التشغيل السريع الحقيقي — سطح المكتب = المركز، الهاتف = وكيل

**الطريق الأساسي للمستخدم النهائي — صفر خطوات يدوية بعد التثبيت:**

1. **على الكمبيوتر** (Windows 10/11 64-bit — macOS 12+ Apple Silicon — Linux x64):
   حمّل المثبت من [صفحة الإصدارات](https://github.com/CTO-DRS/NexusLink/releases/latest)
   وأثبّته وشغّل NexusLink — هذا كل شيء.

   | المنصة | الحزمة | ملاحظة |
   |---|---|---|
   | Windows | `NexusLink_3.1.0_x64-setup.exe` | NSIS — يثبّت WebView2 تلقائيًا إن غاب؛ بديل MSI أو ZIP محمول |
   | macOS | `NexusLink_3.1.0_aarch64.dmg` | اسحب التطبيق إلى Applications؛ غير موقّع: زر يمين ← Open أول مرة |
   | Linux | `NexusLink_3.1.0_amd64.deb` أو `*.AppImage` | AppImage: `chmod +x` ثم شغّل — بلا تثبيت |
   | Android | `NexusLink-3.1.0-release.apk` | الوكيل — «تثبيت من مصدر غير معروف» مرة واحدة |

2. **المركز يعمل فور الإقلاع بلا أي إعداد**: الواجهة + الخادم المضمّن (:3000)
   + جسور الإشعارات/الوسائط/التحكم (:3003/:3004/:3005/:3006/:3007/:3009)
   + البوابة الموحدة (:81) + أيقونة شريط بحالات حية — كلها عمليات مُدارة من
   التطبيق الأصلي (إغلاق النافذة = تصغير للشريط، لا موت للخدمات).

3. **على الهاتف**: نفس شبكة Wi-Fi ← افتح تطبيق NexusLink ← تبويب **الاتصال** ←
   امسح QR من واجهة التطبيق على الكمبيوتر (نافذة سطح المكتب، أو من المتصفح:
   `http://localhost:3000/?app=1`) — أو إدخال يدوي: IP الكمبيوتر + منفذ 81.
   راية «متصل» تعني أن كل القنوات الأربع (3003/3005/3006/3009) حية.

> **ملاحظة**: الجذر `http://localhost:3000` هو **الموقع الرسمي للمنتج** (تعريف + تحميلات)
> — واجهة التطبيق في المتصفح على `/?app=1` ونافذة سطح المكتب تفتح `/?desktop=1` تلقائيًا.

4. **الاختبار المشترك الأول**: انسخ نصًا من الهاتف ← `Ctrl+V` على الكمبيوتر؛
   حرّك مؤشر الكمبيوتر من شاشة Touchpad بالتطبيق؛ أرسل ملفًا بالسحب والإفلات.
   قائمة التحقق الكاملة لكل ميزة: `docs/e2e-checklist.md`.

**بلا تثبيت إطلاقًا؟** النسخة المحمولة `NexusLink_3.1.0_x64-portable.zip`
(فك ← شغّل NexusLink.exe) أو AppImage على لينكس.

> طريق المطوّر (تشغيل السيرفر بدون تطبيق سطح المكتب) في §2 أدناه —
> مخصص للتطوير فقط؛ المستخدم النهائي لا يحتاج منه شيئًا.

---

## 1) المتطلبات (طريق المطوّر)

| الأداة | الإصدار | الغرض |
|--------|---------|-------|
| Bun | 1.1+ | تشغيل السيرفر والويب |
| Flutter SDK | 3.24.x (Dart 3.5) | تطبيق الهاتف |
| Java JDK | 17 | بناء APK (يحتاج `jlink` — JDK كامل وليس JRE) |
| Android SDK | platform 34 + build-tools 34 | بناء APK |
| Caddy | أي حديث | بوابة 81 الموحّدة (اختياري للتطوير، ضروري للنمط الواقعي) |

---

## 2) السيرفر (الكمبيوتر)

```bash
bun install                 # تبعيات الوِب والسيرفر
bun run db:generate         # عميل Prisma (بعد أي bun install جديد)
bun run db:push             # إنشاء/تحديث قاعدة البيانات
bun run dev                 # next dev على 3000 + كل الجسور داخل نفس العملية
```

- **عقد المسارات**: `/` الموقع الرسمي (بطل + ميزات + أمان) · `/download` صفحة التحميلات
  (أحجام حقيقية + أدوات تثبيت + SHA256) · `/?app=1` واجهة التطبيق في المتصفح ·
  `/?desktop=1` واجهة سطح المكتب (تفتحها النافذة الأصلية حرفيًا — لا تغيّرها).
- الجسور تُقلَع تلقائيًا داخل عملية Next: `ensureSecurityBridge()` وأخواتها.
- تفعيل قناة الأمان صراحة (idempotent): `curl -X POST http://localhost:3000/api/security/boot`
- **البوابة 81 (نمط الإنتاج)**: `caddy run --config Caddyfile` — كل قنوات socket.io
  تعبر `:81` عبر `?XTransformPort=<port>` كما يفعل تطبيق الهاتف.

### خريطة المنافذ

| المنفذ | القناة | الغرض |
|--------|--------|-------|
| 81 | caddy | بوابة موحّدة (XTransformPort) |
| 3000 | Next | REST `/api/*` + الواجهة |
| 3003 | comms | الإشعارات/SMS/المكالمات (مرآة الهاتف) |
| 3004 | remote | التحكم بالكمبيوتر (لمس/كيبورد/وسائط/طاقة/WOL) + جلسة التحكم الموثوقة (§13) |
| 3005 | media | الكاميرا/الميكروفون/المراقبة (WebRTC) |
| 3006 | guard | حضور الوكيل + أوامر الجهاز + عرض النقل (tx:*) |
| 3007 | prod | الحافظة الموحدة + تسليم الروابط |
| 3009 | security | **القناة المشفرة E2E** — ترحيل أعمى لإطارات AES-GCM |

> المرجع الكامل للبروتوكول: `docs/protocol-contract.md` — المصدر الوحيد للحقيقة.

---

## 3) الهاتف (Flutter)

```bash
cd nexuslink_mobile
flutter pub get
flutter run                 # تشغيل تطويري
```

### بناء APK موقّع (إصدار)

```bash
# مرة واحدة: أنشئ مفتاحك (أو استخدم nexuslink-release.jks الموجود محليًا)
keytool -genkeypair -v -keystore android/app/nexuslink-release.jks \
  -alias nexuslink -keyalg RSA -keysize 2048 -validity 10000

# android/key.properties (مُتجاهَل git):
# storeFile=nexuslink-release.jks
# storePassword=...
# keyAlias=nexuslink
# keyPassword=...

flutter build apk --release            # APK موقّع
flutter build appbundle --release      # حزمة Play
```

الناتج: `build/app/outputs/flutter-apk/app-release.apk` — تحقّق التوقيع:

```bash
$ANDROID_HOME/build-tools/34.0.0/apksigner verify --print-certs app-release.apk
```

CI يبني تلقائيًا في `.github/workflows/release.yml` (وظيفة android) — التوقيع من
`secrets.ANDROID_KEYSTORE_BASE64` + `ANDROID_KEYSTORE_PASSWORD` + `ANDROID_KEY_ALIAS` + `ANDROID_KEY_PASSWORD`.

### متطلبات أندرويد الحساسة

- **الإقلاع التلقائي**: مفعّل افتراضيًا (BootReceiver + KeepAliveWorker) — يُقرأ آخر اتصال محفوظ.
- **البطارية**: من تبويب «الأمان» اطلب «تجاهل تحسين البطارية» ليبقى الوكيل حيًا 24 ساعة.
- **وضع الفقدان**: صلاحية الموقع + «الرسم فوق التطبيقات» ترفعان موثوقية الشاشة فوق القفل.

---

## 4) الاقتران (الاختبار المشترك الأول)

1. شغّل السيرفر + البوابة: `bun run dev` ثم `caddy run --config Caddyfile`.
2. افتح `http://<IP-الكمبيوتر>:3000` على المتصفح — تبويب **الاتصال** يعرض QR.
3. على الهاتف: تبويب **الاتصال** ← امسح QR (أو إدخال يدوي: host + منفذ 81).
4. انتظر راية «متصل» — الخدمة الخلفية تبقى حية حتى مع إغلاق التطبيق.

**اختبار النجاح الشامل (FA-9/FA-10):**
`تحرّك مؤشر الكمبيوتر بهاتفك + تنسخ نصًا من الهاتف → Ctrl+V على الكمبيوتر`
ثم من نسخة الويب: تبويب **الأمان ← التشفير** ← «قفل الهاتف» و«مسح الملفات المستلمة»
— يجب أن يُقفل الهاتف برسالة ملء الشاشة ويردّ بالموقع، ويحرق ملفات `Download/NexusLink`.

---

## 5) اختبارات E2E الآلية (كلها ضد السيرفر الحي)

```bash
bash scripts/run-media-e2e.sh   # FA-8: كاميرا/صوت/مستشعرات/أين هاتفي — 21/21
bash scripts/run-ctl-e2e.sh     # FA-7: حقن اللمس — 20/20
node  scripts/agent-rc-e2e.mjs  # FA-9: تحكم الهاتف بالكمبيوتر — 23/23
node  scripts/agent-tx-e2e.mjs  # FA-3: نقل الملفات + استئناف — 27/27
node  scripts/agent-sec-e2e.mjs # FA-10: الأمان E2E — 26/26 (مصافحة/SAS/إطارات/قفل/مسح/حظر/تسريب)
```

> عدّاءات `run-*.sh` تُقلع السيرفر وتفحص وتنظف داخل استدعاء واحد (البيئة تجني الخلفيات).
> عدّاءات `agent-*.mjs` تتطلب سيرفرًا حيًا + `/api/security/boot`.

---

## 6) طبقة الأمان (FA-10) — ما الذي يحميك فعلًا؟

- **E2E حقيقي**: X25519 + HKDF-SHA256 + AES-256-GCM — السيرفر مرحّل أعمى لا يفك أي إطار
  (يُثبت بفحص التسريب في WireTap داخل E2E).
- **بوابة الثقة**: جهاز غير موثوق → `sec:pending-trust` بلا مفاتيح إطلاقًا؛ المحظور → رفض + قطع.
  الموثوقون فقط يدخلون المصافحة (حتى `kex:update` من غير الموثوق مرفوض — حصانة اختطاف الإقران).
- **SAS**: بصمة إيموجي+hex متطابقة على الطرفين للتحقق البصري من غياب رجل في المنتصف.
- **تدوير العصور**: مفاتيح رجيعية جديدة كل 3 دقائق (ويب) مع حماية إعادة per-epoch.
- **قفل التطبيق**: PIN بـ PBKDF2-SHA256 (150k) + بصمة/وجه + قفل تلقائي عند الخلفية.
- **وضع الفقدان**: أمر من الويب → قفل + رسالة ملء الشاشة فوق القفل + إحداثيات عبر القناة المشفرة.
- **الحذف الآمن**: كتابة فوق ملفات `Download/NexusLink` (3/7 تمريرات) ثم حذف من MediaStore.

### حدود صادقة (مثبتة بروتوكوليًا vs فيزيائيًا)

- الـ E2E يثبت مسار البروتوكول والتشفير كاملًا ضد الجسور الحية؛ **التنفيذ الفيزيائي**
  (بصمة حقيقية، GPS، كاميرا، رن) يتطلب هاتفًا فعليًا — قيد موثق في العقد §9.
- «24 ساعة اتصال + بطارية < 3%/يوم في الخمول»: مصمَّمة بسياسة الخمول (منارة 60ث/حالة 120ث
  بلا WakeLock) + KeepAliveWorker — القياس الميداني يحتاج جهازًا فعليًا ليلًا كاملة.

---

## 6.5) التحكم الفعلي بالكمبيوتر من شاشة Touchpad (FA-input)

- **تنفيذ أصلي حقيقي** عبر enigo (Rust): تحريك المؤشر، نقر يمين/يسار/مزدوج، سحب (نقر مطول)،
  تمرير بعصريْن، قرص تكبير/تصغير — على Windows/macOS/Linux.
- **كتابة عربية كاملة**: حقن يونيكودي مستقل عن تخطيط كيبورد الكمبيوتر —
  Windows `KEYEVENTF_UNICODE` · macOS `CGEventKeyboardSetUnicodeString` · Linux/X11 keysym يونيكودي
  (نمط xdotool عبر XWayland أيضًا) — بلا تبديل لغة ولا توقع أحرف.
- **ماوس هوائي**: جيروسكوب الهاتف (50ms + تنعيم + عتبة ميتة) → حركة نسبية للمؤشر.
- **عرض تقديمي**: PageUp/PageDown للتقليب + F5 بدء العرض + Esc إنهاؤه — يعمل مع PowerPoint/Keynote/Google Slides.
- **وسائط**: مفاتيح الوسائط النظامية (Play/Pause/التالي/السابق/كتم) + ضبط مستوى مطلق
  (macOS osascript · Linux pactl→amixer · Windows نقرات مُتبَّعة — موثق بصدق).
- **أمان الجلسة**: تبدأ فقط لجهاز موثوق في سجل الأجهزة، نبض 2ث مع watchdog (6ث جسر + 15ث محلي)،
  إشعار مرئي دائم (أيقونة Tray بنفسجية + لافتة في الواجهة + إشعارات النظام)، وقطع فوري من الطرفين.
- **macOS**: تدفق إذن Accessibility مع شاشة إرشادية عربية وفتح الإعدادات مباشرة.
- **تحقق فعلي**: 28/28 على Xvfb (حركة المؤشر تُثبت بـ XQueryPointer والعربية عبر XTEST)
  + 64/64 E2E تعاقدي (scripts/desktop-e2e.mjs §13) + CI 3/3 منصات.

---

## 7) بنية المستودع

```
├── src/                    # سيرفر Next + واجهة الويب (الجسور في src/lib/nexus/)
│   ├── components/site/    # الموقع الرسمي على الجذر / (بطل/كيف يعمل/أمان/أسئلة)
│   ├── components/download/# صفحة /download (تحميلات المنصات + أدلة + تحقق)
│   └── lib/download-site-data.ts # لقطة أصول الإصدار (أسماء/أحجام من Releases)
├── apps/desktop/           # تطبيق سطح المكتب Tauri 2 — المركز
│   ├── src-tauri/          # الطبقة الأصلية: procman/clipboard/power/input/files/media
│   │                       #   + harden (lock/updater/audit/idle/diag)
│   ├── splash/             # نافذة الإقلاع + شاشة القفل (lock.html)
│   └── build-resources.sh  # تجميع الموارد المدمجة (server/comms/gateway)
├── nexuslink_mobile/       # تطبيق Flutter (lib/) + Kotlin (android/.../mobile/)
│   └── android/app/src/main/kotlin/com/nexuslink/mobile/
│       ├── AgentForegroundService.kt   # 4 سوكِتات دائمة (3006/3007/3005/3009) + إعادة اتصال
│       ├── SecChannel.kt / SecCrypto.kt# عميل 3009 + محرك libsodium (X25519/AES-GCM/SAS)
│       ├── LostMode.kt / SecureWipe.kt # وضع الفقدان + الحذف الآمن
│       ├── BootReceiver.kt / KeepAliveWorker.kt
│       └── NexusWidgets.kt / NexusAccessibilityService.kt / FindMyPhone.kt
├── docs/protocol-contract.md  # عقد البروتوكول — المصدر الوحيد للحقيقة
├── docs/e2e-checklist.md      # قائمة تحقق التكامل النهائية (هاتف حقيقي + كمبيوتر حقيقي)
├── BUILD.md                   # دليل البناء والإصدار لكل المنصات
├── scripts/                   # عدّاءات E2E + أدوات
└── .github/workflows/         # desktop.yml (بوابة بناء) + release.yml (خط الإصدار الكامل)
```

---

## 8) الترخيص — الازدواجية الصادقة (عقد §45)

NexusLink منتج **ازدواج الترخيص الصادق** (نفس نمط Obsidian): نواة مغلقة + مجموعة مفتوحة مصرَّح بها — لا غموض ولا ادعاءات.

| الجزء | الترخيص | ماذا يشمل |
|---|---|---|
| **النواة المغلقة** | مملوك — `LicenseRef-proprietary` | الخادم المضمن، الجسور الست، محرِك سطح المكتب Tauri، وكيل Flutter، خطوط الإصدار |
| **المجموعة المفتوحة** | MIT | `src/lib/pair-math.ts` · `src/lib/nexus/oplog.ts` · `sdk/index.mjs` · `cli/nexus.mjs` · `docs/sdk-guide.md` · `docs/protocol-contract.md` |

- الترخيص الجذري الكامل: [`LICENSE`](LICENSE) — ونص MIT المعياري: [`LICENSES/MIT.txt`](LICENSES/MIT.txt)
- تصريح المجموعة المفتوحة الرسمي: [`docs/OPEN-COMPONENTS.md`](docs/OPEN-COMPONENTS.md) — كل عضو يحمل `SPDX-License-Identifier: MIT` في ترويسته
- بيان Flathub متسق حرفيًا: `project_license = LicenseRef-proprietary` — والحارس `scripts/license-e2e.mjs` (44 فحصًا) يمنع أي انجراف بين الثلاثة
