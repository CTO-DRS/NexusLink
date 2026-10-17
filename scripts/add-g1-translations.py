#!/usr/bin/env python3
"""G-1 — إضافة مفاتيح EN للمفردات الجديدة في تحقق سر الاقتران إلى ar-en-map.json."""
import json
from collections import OrderedDict

PATH = "src/lib/ar-en-map.json"

NEW = {
    # PairDialog (ويب) — toast الرفض + تلميح الصلاحية
    "رُفض الاقتران — أُصدر رمزًا جديدًا":
        "Pairing rejected — a new code was issued",
    "الصلاحية 10 دقائق — كل إصدار جديد يُبطل الرمز السابق (التحقق G-1)":
        "Valid for 10 minutes — each new issue invalidates the previous code (G-1 check)",
    # رسائل رفض الخادم (تُعرض عبر toast/DOM sweeper في وضع EN)
    "لا نافذة اقتران نشطة — افتح مربع «اقتران جهاز جديد» على الكمبيوتر أولًا ليُصدَر رمز QR":
        "No active pairing window — open \u201cPair a new device\u201d on the computer first to issue a QR code",
    "سر الاقتران مفقود — امسح رمز QR المعروض على شاشة الكمبيوتر (الصلاحية 10 دقائق)":
        "Pairing secret missing — scan the QR code shown on the computer screen (valid for 10 minutes)",
    "انتهت صلاحية رمز الاقتران (10 دقائق) — أُصدر رمزًا جديدًا وامسحه":
        "Pairing code expired (10 minutes) — a new code was issued, scan it",
    "سر الاقتران لا يطابق آخر رمز مُصدَر — تأكد من مسح الرمز الأحدث":
        "Pairing secret doesn\u2019t match the latest issued code — make sure you scanned the newest code",
    # شارات تدقيق §16 (audit-tab)
    "اقتران":
        "Pairing",
    "اقتران مرفوض":
        "Pairing rejected",
}

with open(PATH, encoding="utf-8") as f:
    d = json.load(f, object_pairs_hook=OrderedDict)

added = 0
for k, v in NEW.items():
    if k in d:
        print(f"  exists: {k[:40]}…")
        continue
    d[k] = v
    added += 1

out = OrderedDict(sorted(d.items(), key=lambda kv: kv[0]))
with open(PATH, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=2)
    f.write("\n")

print(f"added={added} total={len(out)}")
# تحقق سلامة JSON بعد الكتابة
json.load(open(PATH, encoding="utf-8"))
print("json valid ✓")
