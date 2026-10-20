#!/usr/bin/env python3
# PAIR §30 — إضافة مفاتيح pair.speed إلى ترجمات Flutter (عربي/إنجليزي) بلا كسر JSON
import json, io

FILES = {
    "/home/z/my-project/nexuslink_mobile/assets/translations/ar.json": {
        "title": "اقتران فوري",
        "last": "الأخير {v}",
        "wait": "بانتظار أول اقتران مكتمل",
        "detail": "{n} اقترانًا مكتملًا · p95 {p95} · الأقصى {max} · اجتياز {rate}",
    },
    "/home/z/my-project/nexuslink_mobile/assets/translations/en.json": {
        "title": "Instant pairing",
        "last": "last {v}",
        "wait": "waiting for first completed pairing",
        "detail": "{n} completed pairings · p95 {p95} · max {max} · pass {rate}",
    },
}

for path, keys in FILES.items():
    with io.open(path, encoding="utf-8") as f:
        data = json.load(f)
    pair = data.setdefault("pair", {})
    if "speed" not in pair:
        pair["speed"] = keys
        with io.open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print(f"OK  {path} → pair.speed added")
    else:
        print(f"SKIP {path} (pair.speed already present)")
