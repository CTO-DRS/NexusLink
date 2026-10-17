#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""إضافة ترجمات EN لمفاتيح تبويب الروتينات (عقد §26) — add-only (لا يكتب فوق موجودة)."""
import json, sys

PATH = "/home/z/my-project/src/lib/ar-en-map.json"

ADD = {
    # الرأس والحالة
    "الروتينات": "Routines",
    "محرّك الأتمتة — عند حدوث X نفّذ Y فوق القنوات القائمة": "Automation engine — when X happens, do Y over the existing channels",
    "المحرك متصل": "Engine connected",
    "المحرك غير متصل": "Engine offline",
    # الإحصاءات
    "قواعد مفعّلة": "Rules enabled",
    "تشغيلات ناجحة اليوم": "Successful runs today",
    "آخر تشغيل": "Last run",
    # القواعد
    "القواعد": "Rules",
    "قاعدة جديدة": "New rule",
    "لا قواعد بعد — أنشئ أول روتين": "No rules yet — create your first routine",
    "لم تُطلق بعد": "Never fired",
    "تشغيل": "runs",
    "تفعيل القاعدة": "Toggle rule",
    "شغّل الآن": "Run now",
    "تعديل": "Edit",
    "حذف": "Delete",
    "أي جهاز": "Any device",
    # سجل التشغيل
    "سجل التشغيل": "Run log",
    "تفريغ السجل": "Clear log",
    "لا تشغيلات بعد": "No runs yet",
    "يدوي": "manual",
    # حدود صادقة
    "حدود الإصدار الأول": "v1 limitations",
    "القواعد والسجل في ذاكرة الجسر — تُستبدل بالقواعد البذرية عند إعادة تشغيل الخادم": "Rules and log live in bridge memory — reset to seed rules on server restart",
    "أفعال الهاتف تعبر قناة الحماية القائمة وتتطلب وكيل هاتف متصلًا": "Phone actions go through the existing guard channel and require a connected phone agent",
    "إيقاظ WoL يعمل داخل الشبكة المحلية فقط (بث UDP :9)": "WoL wake works on the local network only (UDP broadcast :9)",
    "مشغلات الأجهزة تقرأ سجل الأجهزة (الاقتران/القطع) لا نبض الوكيل الحي": "Device triggers read the device registry (pair/forget), not the live agent heartbeat",
    # المحرر
    "تعديل القاعدة": "Edit rule",
    "اسم القاعدة": "Rule name",
    "مثال: نبّهني عند انخفاض البطارية": "e.g. Alert me when the battery runs low",
    "المشغّل": "Trigger",
    "الفعل": "Action",
    "عند عودة جهاز للشبكة": "When a device joins the network",
    "عند انقطاع جهاز عن الشبكة": "When a device leaves the network",
    "عند هبوط البطارية تحت عتبة": "When battery drops below a threshold",
    "عند وصول محتوى للحافظة الموحدة": "When content arrives in the unified clipboard",
    "مرة واحدة عند موعد": "Once at a scheduled time",
    "يوميًا عند ساعة محددة": "Daily at a set time",
    "معرّف الجهاز (اختياري — فارغ = أي جهاز)": "Device ID (optional — empty = any device)",
    "العتبة %": "Threshold %",
    "حدد موعدًا صالحًا": "Pick a valid time",
    "الساعة": "Hour",
    "الدقيقة": "Minute",
    "نص الإشعار (اختياري)": "Notification text (optional)",
    "النص المطلوب دفعه للحافظة": "Text to push to the clipboard",
    "إلغاء": "Cancel",
    "حفظ التعديلات": "Save changes",
    "إنشاء القاعدة": "Create rule",
    # الأفعال
    "إشعار على الكمبيوتر": "Notify on the computer",
    "دفع نص إلى الحافظة الموحدة": "Push text to the unified clipboard",
    "رنين الهاتف": "Ring the phone",
    "إيقاظ جهاز على الشبكة (WoL)": "Wake a device on the network (WoL)",
    # أسماء القواعد البذرية (بيانات وقت التشغيل — يترجمها ماسح DOM في وضع EN)
    "بطارية جهاز منخفضة": "Low device battery",
    "جهاز غادر الشبكة": "Device left the network",
    "وصل محتوى جديد للحافظة": "Clipboard content arrived",
}

def main() -> int:
    with open(PATH, encoding="utf-8") as f:
        data = json.load(f)
    added = 0
    for k, v in ADD.items():
        if k not in data:
            data[k] = v
            added += 1
    with open(PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    # تحقق سلامة
    with open(PATH, encoding="utf-8") as f:
        json.load(f)
    print(f"OK: added {added} EN keys (of {len(ADD)}), total keys now {len(data)}")
    return 0

if __name__ == "__main__":
    sys.exit(main())
