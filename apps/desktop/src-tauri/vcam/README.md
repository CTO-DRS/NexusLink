# vcam/ — حزمة الكاميرا الافتراضية (المرحلة 0-وسائط — عقد §22)

## المصدر والتصديق (قاعدة الجولة: «لا حزمة قبل التحقق من مصدرها»)

| الملف | المصدر | التحقق |
|---|---|---|
| `akvirtualcamera-windows-9.3.1.exe` | الرسمي: `github.com/webcamoid/akvirtualcamera/releases/download/9.3.1/akvirtualcamera-windows-9.3.1.exe` | SHA256 في `SHA256SUMS.txt` (6a17c098…) + installer NSIS مُتحقق بـ `file` |
| `LICENSE-akvirtualcamera` | `COPYING` من مستودع المصدر (GPL-3.0) | حرفي من master |
| `README-akvirtualcamera.md` | README المشروع الأصلي | حرفي من master |

## لماذا هذا الأساس تحديدًا (متحقق من مصدره، لا من التصريحات)

- **مفتوح المصدر وقابل للتوزيع**: GPL-3.0 — توزيع المثبّت الرسمي غير المعدَّل مع إرفاق
  الترخيص ورابط المصدر مذكور أعلاه = توزيع قانوني كامل (نمط vdd/MIT في §19).
- **مثبّت NSIS رسمي** (`package_info.conf.in`: `Nsis/requiresAdminRights=true`) →
  التثبيت الصامت بـ `/S` (ميزة NSIS المعيارية) يعمل داخل hook مثبّت NexusLink
  (الذي يعمل مرفوعًا أصلًا — لا موجة UAC ثانية).
- **مفتاح التسجيل موثق من المصدر** (`ports/deploy/installscript.nsi`):
  `HKLM\SOFTWARE\Webcamoid\VirtualCamera` قيمة `installPath` — كشفنا للمسار
  يقرأه حرفيًا (لا تخمين مسارات).
- **إدارة الأجهزة CLI موثقة من المصدر** (`Manager/src/cmdparser.cpp`):
  `devices -p` (معرف لكل سطر) · `add-device DESCRIPTION` ·
  `add-format DEVICE FORMAT WIDTH HEIGHT FPS` · `description DEVICE` ·
  `stream DEVICE FORMAT WIDTH HEIGHT [-f FPS]` (المستخدم قائمًا في media.rs) ·
  `-v` (نسخة) · `system-api` (DirectShow/MediaFoundation).
- **الهدف التعاقدي**: Zoom/Meet يرى «NexusLink Camera» بعد تثبيت NexusLink
  بلا أي خطوة يدوية (يُنشأ الجهاز من hook المثبّت + ضمانة وقت التشغيل).

## حدود صادقة

- macOS: pkg الرسمي يُترك خارج الحزمة (قيود توقيع CoreMediaIO الموثقة §3
  من round4-audit) — الإرشاد اليدوي يبقى.
- «NexusLink Camera» تُنشأ بـ add-device (لا `load` الذي يمسح كل أجهزة
  akvirtualcamera للمستخدم — قرار موثق في §22).
- OBS Virtual Camera بديل مكتشف (وجود obs64.exe) — CLSID الخاص به يُحقن
  وقت بناء OBS فلا يصلح علامة كشف ثابتة (موثق §22).
