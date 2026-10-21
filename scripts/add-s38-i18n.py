#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# عقد §38 — مفاتيح i18n للإدارة المؤسسية (M4.1 النواة المحلية — بطاقة الإعدادات)
# درس موثق (ثلاث مرات): فحوص i18n تقرأ '"ar": "en"' بمسافة — separators=(", ", ": ") إلزامي
# اللغات الكسولة (fr/es/de/ru) تسقط تعاقديًا إلى en (نمط §37: lang→en→raw).
import json

PATH = "src/lib/ar-en-map.json"

NEW = {
    # شارة الإدارة في بطاقة الوصول البعيد (§38 على §37)
    "تُدار بالمؤسسة": "Managed by your organization",
    "الإدارة المؤسسية تغلق الوصول البعيد — التفعيل من مدير مؤسستك حصرًا": "Your organization locks remote access — enabling is up to your IT admin only",
    # بطاقة الإدارة المؤسسية (§38)
    "الإدارة المؤسسية": "Enterprise management",
    "سياسات مركزية من ملف المؤسسة — المُدار فوق المستخدم، والفرض لحظي بلا إعادة تشغيل": "Centralized policies from the organization's file — managed overrides user, enforcement is live with no restart",
    "مُدار بواسطة مؤسستك": "Managed by your organization",
    "ملف سياسة غير صالح — لا فرض حتى يصلحه المدير": "Invalid policy file — no enforcement until your admin fixes it",
    "غير مُدار": "Unmanaged",
    "الوصول البعيد مفروض دائمًا برمز": "Remote access always enforced with token",
    "الوصول البعيد مغلق مؤسسيًا": "Remote access locked by organization",
    "جسور محجوبة عن الشبكة": "Bridges blocked from the network",
    "بصمة ملف السياسة": "Policy file fingerprint",
    "غير مُدار: الجهاز بيد مستخدمه بالكامل (الافتراضي) — نشر ملف السياسة يجعل هذا الجهاز قابلًا للإدارة المركزية": "Unmanaged: the device is fully in its user's hands (default) — deploying a policy file makes this device centrally manageable",
    "حد صادق: ملف السياسة مصدر الحقيقة الواحد بلا قراءة سجل النظام، والحجب يمس الخارج حصرًا (loopback معفى — الجهاز هي الحدود)، والقبول المؤسسي الموسع (نشر صامت على عشرات الأجهزة/مدقق SOC 2/عقد OEM) بند خارجي M4": "Honest boundary: the policy file is the single source of truth with no OS registry reads; blocking targets external callers only (loopback exempt — the device is the boundary); broad enterprise acceptance (silent deploy on dozens of devices / SOC 2 auditor / OEM contract) remains an external M4 item",
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
