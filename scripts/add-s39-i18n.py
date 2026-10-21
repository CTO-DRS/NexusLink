#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# عقد §39 — مفاتيح i18n للسجل التدقيقي المؤسسي (M4.2 نواة أدلة SOC 2 — بطاقة الإعدادات)
# درس موثق (ثلاث مرات): فحوص i18n تقرأ '"ar": "en"' بمسافة — separators=(", ", ": ") إلزامي
# اللغات الكسولة (fr/es/de/ru) تسقط تعاقديًا إلى en (نمط §37: lang→en→raw).
import json

PATH = "src/lib/ar-en-map.json"

NEW = {
    # قسم السجل التدقيقي في بطاقة الإدارة المؤسسية (§39 على §38)
    "السجل التدقيقي المؤسسي": "Enterprise audit trail",
    "سلسلة سليمة": "Chain intact",
    "سلسلة مكسورة — السجل متجمد": "Chain broken — log frozen",
    "سجل إلحاقي بسلسلة بصمات للأفعال الإدارية وانتقالات السياسة — أي تعديل رجعي يكسر السلسلة ويُعلن": "Append-only hash-chained log of administrative actions and policy transitions — any retroactive edit breaks the chain and is declared",
    "آخر الأحداث المدققة": "Latest audited events",
    "تفعيل الوصول البعيد": "Remote access enabled",
    "تدوير رمز الوصول البعيد": "Remote access token rotated",
    "تعطيل الوصول البعيد": "Remote access disabled",
    "رفض فعل إداري": "Admin action denied",
    "رصد أولي للسياسة": "Policy first observed",
    "تغير ملف السياسة": "Policy file changed",
    "محلي": "local",
    "خارجي": "remote",
    "مرفوض": "denied",
    "حد صادق للسجل: كاتبٌ واحد (خادم الويب) وحلقي العرض، ومن يملك القرص قد يعيد بناء السلسلة كاملة — كشف تعديل لا منعه (نموذج الجهاز المحلي نفسه)، والجمع المركزي للأدلة بند النشر الخارجي": "Honest boundary: the log has a single writer (the web server) and loopback-only viewing; whoever owns the disk can rebuild the whole chain — tamper detection, not prevention (same device-local model); centralized evidence collection is an external deployment item",
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
