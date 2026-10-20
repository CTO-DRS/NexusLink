#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# عقد §34 — مفاتيح i18n لسوق التكاملات (M3.2)
# درس موثق: فحوص i18n القديمة تقرأ '"ar": "en"' بمسافة — separators=(", ", ": ") إلزامي
import json

PATH = "src/lib/ar-en-map.json"

NEW = {
    "سوق التكاملات": "Integration Marketplace",
    "قناة موقعة محليًا — تكاملات تصريحية بلا أي كود تنفيذي": "Locally signed channel — declarative integrations, no executable code",
    "تحديث": "Refresh",
    "جارٍ التحميل...": "Loading...",
    "بصمة مفتاح القناة": "Channel key fingerprint",
    "قناة البداية": "Starter channel",
    "مثبت": "Installed",
    "إزالة": "Remove",
    "تثبيت": "Install",
    "التكاملات المثبتة": "Installed integrations",
    "تم تثبيت التكامل": "Integration installed",
    "تمت إزالة التكامل": "Integration removed",
    "تعذر تحميل السوق": "Could not load marketplace",
    # وصف تكاملات القناة (يُترجم في t() عبر الماسح إن غاب المفتاح يظهر بالإنجليزية الخام لا بالعربية)
    "تنبيهات بطارية مركبة عبر الروتينات: نبّهني عند 20% أو عند بلوغ الشحن 80%": "Composite battery alerts via routines: notify at 20% or at 80% charge",
    "روتين «وقت التركيز»: إشعار يومي بلغة المستخدم عبر القناة القائمة": "Focus time routine: daily notification in the user's language via the existing channel",
    "مراقبة الحافظة الموحدة وإشعار عند وصول محتوى جديد من أي جهاز": "Watch the unified clipboard and notify when new content arrives from any device",
    "استئناف المزامنة لياليًا: تذكير يومي بفحص رأس سجل العمليات قبل النوم": "Nightly sync checkup: daily reminder to inspect the op-log head before sleep",
    "سقف صامت على امتلاء التخزين: تنبيه تاريخي عند بقاء التخزين فوق 90% ساعة": "Silent storage guard: sustained alert when storage stays above 90% for an hour",
    "فتح لوحة التسليم المحلية بنقرة من أي سطح — رابط محلي فقط": "Open the local handoff panel with one click from anywhere — local link only",
    "ملخص صحة الأجهزة اليومي من لوحة الرؤى (أرقام حصرًا بلا أي مغادرة)": "Daily device health digest from the insights panel (numbers only, nothing leaves)",
    "تصدير سجل النداءات المحلي عبر واجهة الملفات — بلا مغادرة أي بايت": "Export the local call log through the files view — not a byte leaves",
    "توجيه رسائل الهاتف إلى روتين: إشعار عند وصول رسالة من جهة محددة": "Route phone messages into a routine: notify when a message arrives from a contact",
    "منارة نسخ احتياطي أسبوعية: تذكير بمزامنة النسخ المحلية عبر الروتينات": "Weekly backup beacon: a reminder to sync local backups via routines",
}

m = json.load(open(PATH))
added = 0
for k, v in NEW.items():
    if k not in m:
        m[k] = v
        added += 1
with open(PATH, "w", encoding="utf-8") as f:
    json.dump(m, f, ensure_ascii=False, separators=(", ", ": "))
print(f"added={added} total={len(m)}")
