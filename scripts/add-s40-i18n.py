#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# عقد §40 — مفاتيح i18n لوضع OEM «خصوصية افتراضية» (M4.3 النواة المحلية)
# درس موثق (أربع مرات): فحوص i18n تقرأ '"ar": "en"' بمسافة — separators=(", ", ": ") إلزامي
# اللغات الكسولة (fr/es/de/ru) تسقط تعاقديًا إلى en (نمط §37/§38: lang→en→raw).
import json

PATH = "src/lib/ar-en-map.json"

NEW = {
    # شارة وضع OEM (بطاقتا الإدارة المؤسسية والوصول البعيد)
    "وضع OEM: الخصوصية افتراضيًا": "OEM mode: privacy by default",
    # ملاحظتا المولود خاصًا في بطاقة الإدارة المؤسسية
    "جهاز محمّل مسبقًا بوضع «الخصوصية افتراضية» — الخارج مغلق حتى ينشر مدير النظام ملف سياسة": "Preloaded device in privacy-by-default mode — external access stays closed until your admin deploys a policy file",
    "ملف سياسة غير صالح — وضع الخصوصية يبقى مغلقًا (فشل مغلق) حتى يصلحه المدير": "Invalid policy file — the privacy posture stays closed (fail-closed) until your admin fixes it",
    "كل الجسور محجوبة عن الشبكة (وضع الخصوصية)": "All bridges blocked from the network (privacy posture)",
    # ملاحظة القفل في بطاقة الوصول البعيد
    "وضع الخصوصية الافتراضية من الشركة المصنعة يغلق الوصول الخارجي — فكّه يتطلب ملف سياسة من مدير النظام": "The manufacturer's privacy-by-default mode keeps external access closed — unlocking it requires a policy file from your system admin",
    # الحد الصادق الجديد لوضع OEM
    "حد صادق لوضع OEM: العلم بيئي في صورة النظام (NEXUSLINK_OEM_PRIVACY=1) — من يملك القرص وصلاحيات النظام قد يزيله؛ كشف لا منع (نموذج الجهاز المحلي نفسه)": "Honest boundary: the OEM flag is environmental in the system image (NEXUSLINK_OEM_PRIVACY=1) — whoever owns the disk and system privileges can remove it; detection not prevention (same local device model)",
}

with open(PATH, encoding="utf-8") as f:
    m = json.load(f)

added = 0
for k, v in NEW.items():
    if k in m:
        if m[k] != v:
            print(f"CONFLICT {k!r}: exists={m[k]!r} new={v!r}")
        continue
    m[k] = v
    added += 1

with open(PATH, "w", encoding="utf-8") as f:
    json.dump(m, f, ensure_ascii=False, separators=(", ", ": "))

print(f"added={added} total={len(m)}")
