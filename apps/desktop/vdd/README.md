# vdd/ — سائق الشاشة الافتراضية (الشاشة الثانية — عقد §19)

حزمة مُتحققة من مصادرها حرفيًا قبل الإدخال (القاعدة الذهبية — لا كرِيت/حزمة
قبل التحقق). تُثبَّت من مثبت NSIS (src-tauri/installer-hooks.nsh) وتُحمل ضمن
bundle.resources إلى `$INSTDIR\vdd`.

## المصادر الحرفية

| الملف | المصدر |
|---|---|
| `MttVDD.inf` `MttVDD.dll` `mttvdd.cat` | **VirtualDrivers/Virtual-Display-Driver** — إصدار `25.7.23` (MIT) — أصل `VirtualDisplayDriver-x86.Driver.Only.zip` (محتوى مجلد `VirtualDisplayDriver/` كما هو بلا تعديل) — https://github.com/VirtualDrivers/Virtual-Display-Driver/releases/tag/25.7.23 |
| `nefconc.exe` | **nefarius/nefcon** — إصدار `v1.21.0` (MIT) — أصل `x64/nefconc.exe` من `nefcon_v1.21.0.zip` — https://github.com/nefarius/nefcon/releases/tag/v1.21.0 |
| `vdd_settings.xml` | **كتابة NexusLink** (ليست من المشروع الأصلي): count=1 + الأوضاع التعاقدية 1080×2400/2400×1080/1080×1920/1920×1080 @60Hz — بنية الوسوم مطابقة لما يقرأه السائق (مسار القراءة `C:\VirtualDisplayDriver\vdd_settings.xml` مثبت من مصدر السائق `Driver.cpp:94 confpath`) |
| `SHA256SUMS.txt` | بصمات الملفات الخمسة أعلاه |
| `LICENSE-*` | ترخيصا MIT للمشروعين (الإدخال داخل توزيع MIT مع ذكر المصدر) |

## لماذا هذا السائق تحديدًا (مقارنة متحققة)

- **virtual-display-rs (MolotovCherry)**: بنية IPC أجمل (driver-ipc + CLI) لكن
  **بلا إصدارات ثنائية حديثة** (آخر إصدار v0.3.1 — 2023-10، قبله CID والCLI) و
  `driver-ipc` **غير منشور على crates.io** («crate does not exist») — بناء سائق
  UMDF يتطلب VS2022+WDK (غير متاح في CI الحالي) ⇒ غير قابل للاعتماد.
- **VirtualDrivers VDD (المختار)**: نشط (winget + إصدارات)، توقيع SignPath،
  مسار تحكم موثق من سكربتاته الرسمية (silent-install.ps1: شهادات من .cat →
  TrustedPublisher ثم `nefcon install INF HWID`)، وتشغيل/إطفاء وقت الرِجِيم
  بلا صلاحيات عبر CCD (QueryDisplayConfig/SetDisplayConfig — آلية Win+P).
- البديلان المرفوضان: IddSampleDriver (متجمد، أوضاع ثابتة عبر inf) — Sunshine
  (يعكس الشاشات القائمة لا ينشئ).

## التوقيع والثقة

السائق موقّع SignPath (شهادته داخل mttvdd.cat) — ويندوز يرفض تثبيت سائق غير
موثوق إلا بعد إضافة الشهادة إلى `TrustedPublisher` — هذا أول عمل hook التثبيت
(نفس تدفق silent-install.ps1 الرسمي). التطبيق NexusLink نفسه غير موقّع
Authenticode (قيود موثقة في BUILD/checklist) — SmartScreen قد يحذر أول تشغيل.
