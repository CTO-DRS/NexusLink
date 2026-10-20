#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# عقد §37 — مفاتيح i18n للوصول البعيد برمز اقتران (بطاقة الإعدادات)
# درس موثق (ثلاث مرات): فحوص i18n تقرأ '"ar": "en"' بمسافة — separators=(", ", ": ") إلزامي
import json

PATH = "src/lib/ar-en-map.json"

NEW = {
    # بطاقة الوصول البعيد (§37 — settings-view)
    "الوصول البعيد": "Remote access",
    "اقتران الوصول عبر الإنترنت — معطّل افتراضيًا؛ عند التفعيل يحتاج كل واصل من خارج الجهاز الرمز": "Internet access pairing — off by default; once on, every non-device caller must carry the token",
    "معطّل": "Off",
    "تفعيل": "Enable",
    "تدوير الرمز": "Rotate token",
    "تعطيل": "Disable",
    "بصمة الرمز": "Token fingerprint",
    "أُنشئ": "created",
    "رابط الوصول برمزه — معروض مرة واحدة، احتفظ به": "Access URL with its token — shown once, keep it safe",
    "تم تفعيل الوصول البعيد": "Remote access enabled",
    "تم تدوير الرمز": "Token rotated",
    "تم تعطيل الوصول البعيد": "Remote access disabled",
    "حد صادق: تشفير النقل عبر النفق/البنية الخارجية مسؤولية نشرها — البوابة تحسم الرمز قبل وصول أي طلب للخدمات، والإدارة من خارج الجهاز مرفوضة ولو برمز صحيح": "Honest boundary: transport encryption across the tunnel/external infrastructure is its operator's responsibility — the gateway decides on the token before any request reaches services, and administration from off-device is rejected even with a valid token",
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
