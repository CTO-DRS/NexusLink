#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# عقد §35 — مفاتيح i18n للتنبؤ الاستباقي وقناة الناشر والفرض اللحظي
# درس موثق (ثلاث مرات): فحوص i18n تقرأ '"ar": "en"' بمسافة — separators=(", ", ": ") إلزامي
import json

PATH = "src/lib/ar-en-map.json"

NEW = {
    # تبويب التنبؤ (§35.ج — intel-view)
    "التنبؤ": "Predict",
    "توقعات إطلاق الروتينات": "Routine fire forecasts",
    "حتمي من تاريخ 14 يومًا": "Deterministic, from 14-day history",
    "لا توقعات بعد — ثلاثة إطلاقات فأكثر تبني النمط": "No forecasts yet — three or more fires build a pattern",
    "النمط اليومي": "Daily pattern",
    "وسيط الفترة": "Median interval",
    "إطلاقات": "fires",
    "توقع متأخر": "Stale forecast",
    "اقتراحات روتينات مسبّبة": "Evidence-based routine suggestions",
    "الإنشاء بيدك حصرًا": "Creation is yours alone",
    "لا اقتراحات بعد — الأنماط تحتاج 3 مشاهدات على يومين مختلفين": "No suggestions yet — patterns need 3 sightings across 2 days",
    "من تاريخ العمليات": "From ops history",
    "من عينات الصحة": "From health samples",
    "إنشاء قاعدة": "Create rule",
    "أُنشئت القاعدة": "Rule created",
    "توقعات حتمية من تاريخك المحلي — بلا نماذج وبلا مغادرة أي بايت": "Deterministic forecasts from your local history — no models, nothing leaves",
    "…جارٍ حساب التوقعات": "…Computing forecasts",
    "تعذّر حساب التوقعات الآن": "Could not compute forecasts now",
    "تذكير بطارية": "Battery reminder",
    "تذكير عمليات": "Ops reminder",
    # قناة الناشر (§35.أ — settings-view)
    "الناشر": "Publisher",
    "إصدار المفتاح": "Key version",
    "موقوف": "Revoked",
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
