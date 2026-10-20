#!/usr/bin/env python3
# إضافة مفاتيح §33 (طبقة الذكاء المحلي) إلى خريطة ar→en — محافظة على التنسيق
# (json.dumps مع ensure_ascii=False ومسافتان — نفس نمط add-lang-i18n السابق)
import json

PATH = "src/lib/ar-en-map.json"

NEW = {
    # §33.أ — البحث الموحد
    "بحث موحد": "Unified search",
    "بحث موحد عبر الأجهزة والملفات والرسائل": "Unified search across devices, files and messages",
    "ابحث عبر الأجهزة والملفات والرسائل والروتينات…": "Search devices, files, messages, routines…",
    "…بحث": "searching…",
    "لا نتائج في الفهرس المحلي": "No results in the local index",
    "فشل البحث — أعد المحاولة": "Search failed — try again",
    "نتائج محلية حصريًا": "Local-only results",
    "الأجهزة": "Devices",
    "الروتينات": "Routines",
    "الحافظة": "Clipboard",
    "الرسائل": "Messages",
    "جهات الاتصال": "Contacts",
    "النداءات": "Calls",
    "التسليم المتصل": "Handoff",
    "الملفات المتزامنة": "Synced files",
    # §33.ب — المساعد
    "الذكاء المحلي": "Local intelligence",
    "مساعد ورؤى على الجهاز — بلا مغادرة أي بايت": "On-device assistant and insights — no byte leaves",
    "أقسام الذكاء": "Intelligence sections",
    "المساعد": "Assistant",
    "الرؤى": "Insights",
    "محرك حتمي محلي + فهرس الأجهزة والملفات والروتينات": "Local deterministic engine + devices, files and routines index",
    "بلا نموذج — حتمي": "No model — deterministic",
    "اسألني عن أجهزتك أو ملفاتك أو روتيناتك — كل الإجابات من فهرسك المحلي": "Ask about your devices, files or routines — every answer comes from your local index",
    "اسأل المساعد المحلي…": "Ask the local assistant…",
    "سؤال للمساعد": "Question for the assistant",
    "إرسال": "Send",
    "نية": "intent",
    "محرك حتمي محلي": "local deterministic engine",
    "تعذّرت الإجابة": "Could not answer",
    # §33.د — الرؤى
    "…جارٍ تجميع الرؤى": "gathering insights…",
    "تعذّر جمع الرؤى الآن": "Could not gather insights now",
    "عمليات 14 يومًا": "Ops (14 days)",
    "أنواع": "kinds",
    "إطلاقات الروتينات": "Routine fires",
    "خلال 14 يومًا": "in 14 days",
    "مقاطع الحافظة": "Clipboard items",
    "خلال 7 أيام": "in 7 days",
    "اقترانات مكتملة": "Completed pairings",
    "العمليات يوميًا (14 يومًا)": "Ops per day (14 days)",
    "إطلاقات الروتينات يوميًا": "Routine fires per day",
    "مزامنة 14 يومًا": "Sync (14 days)",
    "رسائل 7 أيام": "Messages (7 days)",
    "واردة / صادرة": "in / out",
    "عينات الصحة": "Health samples",
    "أجهزة تُبلّغ": "reporting devices",
    "حجم الحافظة": "Clipboard size",
    "أكثر الأجهزة نشاطًا (عمليات)": "Most active devices (ops)",
    "كل الأرقام محسوبة محليًا من قواعد بيانات جهازك — لا يغادر أي محتوى": "Every number is computed locally from your device's databases — no content leaves",
    # §33.ج — الدمج
    "شرط إضافي (و/AND) — حالة يجب أن تتحقق الآن أيضًا": "Additional condition (AND) — a state that must also hold now",
    "بطارية تحت العتبة": "battery below threshold",
    "بطارية فوق العتبة": "battery above threshold",
    "يوجد جهاز متصل الآن": "a device is connected now",
    "يوجد جهاز غير متصل الآن": "a device is disconnected now",
    "معرّف جهاز — فارغ = أي جهاز": "Device id — empty = any device",
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
