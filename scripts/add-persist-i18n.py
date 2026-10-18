# add-persist-i18n.py — دمج آمن لمفاتيح §26.ز في القاموس المشترك
import json, sys

PATH = "/home/z/my-project/src/lib/ar-en-map.json"
with open(PATH, encoding="utf-8") as f:
    m = json.load(f)

add = {
    "القواعد محفوظة في قاعدة البيانات وتُستعاد حرفيًا عند إعادة تشغيل الخادم — وحذف قاعدة بذرية يبقى حذفًا":
        "Rules are persisted in the database and restored verbatim on server restart — deleting a seed rule stays deleted",
    "سجل التشغيل (آخر 80) يبقى في ذاكرة الجسر ويبدأ نظيفًا عند الإقلاع":
        "The run log (last 80) stays in bridge memory and starts clean on boot",
}
# مفتاح مهجور (لم يعد في أي مصدر بعد تحديث بطاقة الحدود §26.ز)
drop = "القواعد والسجل في ذاكرة الجسر — تُستبدل بالقواعد البذرية عند إعادة تشغيل الخادم"

conflicts = [k for k in add if k in m and m[k] != add[k]]
if conflicts:
    print("CONFLICT:", conflicts)
    sys.exit(1)

before = len(m)
for k, v in add.items():
    m[k] = v
removed = m.pop(drop, None)
with open(PATH, "w", encoding="utf-8") as f:
    json.dump(m, f, ensure_ascii=False, indent=2, sort_keys=False)
    f.write("\n")
print(f"ok: {before} -> {len(m)} keys (+{len(add)}, dropped={'yes' if removed else 'no'})")
