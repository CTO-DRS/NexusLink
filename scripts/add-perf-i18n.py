#!/usr/bin/env python3
# PERF §29 — إضافة مفاتيح rctl.perf إلى ترجمات Flutter (عربي/إنجليزي) بلا كسر JSON
import json, io

FILES = {
    "/home/z/my-project/nexuslink_mobile/assets/translations/ar.json": {
        "p95": "p95 {v}ms · {n} قياسًا",
        "wait": "الأداء: بانتظار عينات",
    },
    "/home/z/my-project/nexuslink_mobile/assets/translations/en.json": {
        "p95": "p95 {v}ms · {n} samples",
        "wait": "perf: waiting for samples",
    },
}

for path, perf in FILES.items():
    with io.open(path, encoding="utf-8") as f:
        data = json.load(f)
    rctl = data.setdefault("rctl", {})
    if "perf" not in rctl:
        rctl["perf"] = perf
        with io.open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print(f"OK  {path} → rctl.perf added")
    else:
        print(f"SKIP {path} (rctl.perf already present)")
