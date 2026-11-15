#!/usr/bin/env python3
"""G3 — حارس «صفر سحابة» لوكيل أندرويد (CI).

يفشل (exit 1) إن ظهر أي SDK سحابي من Google داخل الحزم المبنية أو شجرة الاعتماديات:
  · com.google.mlkit            (ML Kit — مسح/OCR)
  · com.google.firebase         (Firebase — يأتي عادةً مع ML Kit: components/encoders/datatransport)
  · com.google.android.gms      (Google Play Services)
  · com.google.android.datatransport (قناة تلِمتري Firebase/ML Kit)

ما يُفحص:
  1) كل ملف .apk/.aab مُمرَّر: أسماء المدخلات (META-INF/*.version، *.properties، نماذج
     mlkit، libbarhopper…) + جداول نصوص dex (واصفات الأصناف Lcom/google/mlkit/… إلخ).
  2) اختياريًا --deps <ملف>: مخرجات `gradlew :app:dependencies` — أي إحداثي Maven
     بمجموعة محظورة.

الاستخدام:
  python3 scripts/android-zero-cloud-check.py [--deps deps.txt] build/**/*.apk build/**/*.aab
"""
import re
import sys
import zipfile

# واصفات الأصناف داخل dex (MUTF-8) — مرجع نوع حقيقي لا مجرد نص عابر
DEX_PATTERNS = [
    b"Lcom/google/mlkit/",
    b"Lcom/google/firebase/",
    b"Lcom/google/android/gms/",
    b"Lcom/google/android/datatransport/",
]

# أسماء مدخلات الحزمة الدالّة على هذه المكتبات
ENTRY_PATTERNS = [
    re.compile(p, re.I)
    for p in (
        r"com\.google\.mlkit",
        r"com\.google\.firebase",
        r"com\.google\.android\.gms",
        r"com\.google\.android\.datatransport",
        r"(^|/)firebase-[^/]*\.properties$",
        r"(^|/)play-services-[^/]*\.properties$",
        r"(^|/)transport-[^/]*\.properties$",
        r"mlkit",
        r"libbarhopper",  # المكتبة الأصلية لماسح ML Kit المضمّن
    )
]

DEP_PATTERN = re.compile(
    r"\b(com\.google\.mlkit|com\.google\.firebase|com\.google\.android\.gms|com\.google\.android\.datatransport):[\w.\-]+"
)


def scan_archive(path: str) -> list[str]:
    hits: list[str] = []
    with zipfile.ZipFile(path) as z:
        for info in z.infolist():
            name = info.filename
            for rx in ENTRY_PATTERNS:
                if rx.search(name):
                    hits.append(f"entry  {name}")
                    break
            if name.endswith(".dex"):
                data = z.read(info)
                for pat in DEX_PATTERNS:
                    n = data.count(pat)
                    if n:
                        hits.append(f"dex    {name}: {pat.decode()}… ×{n}")
    return hits


def scan_deps(path: str) -> list[str]:
    found = set()
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            for m in DEP_PATTERN.finditer(line):
                found.add(m.group(0))
    return [f"dep    {d}" for d in sorted(found)]


def main(argv: list[str]) -> int:
    deps = None
    files: list[str] = []
    i = 0
    while i < len(argv):
        if argv[i] == "--deps":
            deps = argv[i + 1]
            i += 2
            continue
        files.append(argv[i])
        i += 1
    if not files and not deps:
        print("::error::لا حزم ولا شجرة اعتماديات للفحص")
        return 2

    failed = False
    if deps:
        hits = scan_deps(deps)
        print(f"== dependency tree: {deps} → {'CLEAN' if not hits else f'{len(hits)} hit(s)'}")
        for h in hits:
            print("   " + h)
        failed |= bool(hits)
    for f in files:
        hits = scan_archive(f)
        print(f"== {f} → {'CLEAN' if not hits else f'{len(hits)} hit(s)'}")
        for h in hits[:200]:
            print("   " + h)
        failed |= bool(hits)

    if failed:
        print("::error::G3 — Google cloud SDK (ML Kit / Firebase / GMS) found in the Android agent. "
              "NexusLink promises zero-cloud: replace it with a local alternative.")
        return 1
    print("✅ G3 zero-cloud: no com.google.mlkit / com.google.firebase / com.google.android.gms artifacts")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
