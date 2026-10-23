# Flathub — حزمة NexusLink (عقد §44 — نواة X3)

هذا المجلد هو **النواة المحلية الكاملة لبند X3**: كل ملفات meta المطلوبة لمراجعة
Flathub، جاهزة للنسخ إلى فرع إرسال `flathub/flathub`. ما يبقى على المالك حصرًا:
حساب Flathub + البريد في جهة الاتصال + فتح طلب الإرسال — لا تحرير ملفات يلزمه.

## الملفات

| الملف | الدور |
|---|---|
| `sa.drs.nexuslink.yml` | بيان البناء — غلاف AppImage المستخرَج (نمط مثبت على Flathub) |
| `sa.drs.nexuslink.metainfo.xml` | AppStream metainfo — السجل متزامن مع `/api/version` ببوابة آلية |
| `sa.drs.nexuslink.desktop` | مطلق التطبيق باسم التطبيق الموحد |

## لماذا غلاف AppImage لا بناء من مصدر؟

المستودع خاص، والثنائي ذاتي الاكتفاء عمدًا (webkit2gtk 4.1 وGTK 3 وGStreamer مضمّنة
داخل `usr/lib`). نمط الاستخراج (`--appimage-extract` ثم النسخ إلى `/app`) هو النمط
المعتمد لعشرات التطبيقات المملوكة على Flathub (منها Obsidian). الغلاف المولّد في
البناء يعيد إنتاج خطّاف GTK الخاص بالـ AppImage حرفيًا بـ `APPDIR=/app` — نفس
متغيرات البيئة التي تُظهر أن الإصدار المنشور يعمل فعلًا.

## خطوات المالك (عند قرار الإرسال)

```bash
# 0) المتطلبات: حساب flathub + flatpak + flatpak-builder
flatpak remote-add --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
flatpak install -y flathub org.freedesktop.Platform//25.08 org.freedesktop.Sdk//25.08

# 1) اختبار البناء محليًا (من هذا المجلد)
flatpak-builder --user --install --force-clean build sa.drs.nexuslink.yml

# 2) اختبار التشغيل الحي — تحقق يدوي: الإقلاع، الاقتران، بث الشاشة، نقل ملف
flatpak run sa.drs.nexuslink

# 3) الإرسال: fork لنفسك ثم فرع جديد في مستودع flathub/flathub
#    انسخ الملفات الثلاثة إلى فرعك، اجعل طلب الدمج نحو flathub/flathub
#    (فحوص التحقق الآلي على Flathub ستبني الطلب على مشغلات x86_64)
```

## إجراء ترقية الإصدار (عند كل إصدار جديد)

1. حدّث الرابط والبصمة في `sa.drs.nexuslink.yml` (سطرا `url` و`sha256`) — البصمة
   من `SHA256SUMS.txt` في صفحة الإصدار، أو اترك `x-checker-data` يتتبعها آليًا
   (مدقق البيانات الخارجية على Flathub يفتح PR ترقية تلقائيًا).
2. أضف `<release version=... date=...>` في `sa.drs.nexuslink.metainfo.xml` —
   **بوابة `scripts/flathub-e2e.mjs` تفحص التزامن مع سجل `/api/version` وترفض
   الانجراف** (نفس عقد التزامن المفروض على الإصدارات).
3. شغّل `node scripts/flathub-e2e.mjs` — يجب أن يمر كاملًا.

## الحدود الصادقة (موثقة في عقد §44)

1. **x86_64 حصرًا**: لا يوجد بناء `aarch64` لنكس لينكس في الإصدارات — البيان
   يصرّح `only-arches: [x86_64]` ولا يدّعي ما لا يوجد.
2. **الصندوق الرملي يقيّد الطبقات العميقة**: `vdd` (تعريف الشاشة الثانية) و`vcam`
   (الكاميرا الافتراضية على النظام المضيف) و`uinput` (جيمباد/ماوس هوائي) قد تكون
   محدودة داخل Flatpak — نواة المزامنة والبث والملفات والحافظة والروتينات كاملة.
   هذا مصرّح به في وصف المتجر نفسه (فقرة الصندوق الرملي).
3. **التحقق الحي داخل Flatpak** (خطوة 2 أعلاه) على المالك — بيئة التطوير لا تملك
   flatpak-builder؛ بوابة E2E المحلية تغطي البنية والتزامن حصرًا وتصرّح بذلك.
4. **`project_license` = proprietary**: المستودع خاص والإصدار ثنائي موقّع —
   `metadata_license` = `CC0-1.0` (شرط Flathub أن تكون البيانات الوصفية حرة).
5. **لا `update_contact` في metainfo بعد**: يتطلب بريد المالك — يُضاف لحظة
   الإرسال (سطر واحد قبل الـ `releases`): `<update_contact>EMAIL</update_contact>`.

## لقطات المتجر

`metainfo` يشير إلى 4 لقطات حقيقية من `docs/screenshots/` عبر روابط
`raw.githubusercontent.com` على فرع `main`. عند الإرسال: إن غيّرت اللقطات أو
ودّعت أدق، حدّث الروابط في `sa.drs.nexuslink.metainfo.xml` فحسب — البنية والعدد
(≥2) مفحوصان بالبوابة.
