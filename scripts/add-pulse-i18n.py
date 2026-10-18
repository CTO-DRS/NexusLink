# add-pulse-i18n.py — دمج آمن لمفاتيح نبض الخدمة الذاتي (§27.هـ) في القاموس المشترك
import json, sys

PATH = "/home/z/my-project/src/lib/ar-en-map.json"
with open(PATH, encoding="utf-8") as f:
    m = json.load(f)

add = {
    "نبض ذاتي من الخادم — كل 4 ثوانٍ":
        "Autonomous server pulse — every 4s",
    "القياس ذاتي من عملية الخادم: إغلاق كل الصفحات لا يوقف توليد العينات — أجهزة البذرة تُستنزف محاكاةً ما دام الخادم يعمل، والوكيل الحقيقي يتجاوزها عبر report":
        "Measurement runs inside the server process: closing all pages never stops sampling — seed devices keep simulated drain while the server runs, real agents override via report",
    "النبض الذاتي من الخادم يولّد العينات (كل 30 ث لكل جهاز) ما دامت عملية الخادم تعمل — إغلاق الواجهة لا يوقف الكشف":
        "The autonomous server pulse generates samples (every 30s per device) as long as the server process runs — closing the UI never stops detection",
}

conflicts = [k for k in add if k in m and m[k] != add[k]]
if conflicts:
    print("CONFLICT:", conflicts)
    sys.exit(1)

before = len(m)
for k, v in add.items():
    m[k] = v
with open(PATH, "w", encoding="utf-8") as f:
    json.dump(m, f, ensure_ascii=False, indent=2, sort_keys=False)
    f.write("\n")
print(f"ok: {before} -> {len(m)} keys (+{len(add)})")
