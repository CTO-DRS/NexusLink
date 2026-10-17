#!/usr/bin/env python3
"""Add official-site (home page) i18n keys to src/lib/ar-en-map.json.

Additive + idempotent, same pattern as scripts/add_download_i18n.py.
The i18n engine uses the Arabic string as the source key; missing keys
fall back to Arabic, so this only ADDS English translations.

The script also verifies completeness: it extracts every t("...") and
*Key:/q:/a: literal from the site components + shared header/footer and
fails if any extracted key is still missing after the update.

Run: python3 scripts/add_site_i18n.py
"""
import json
import re
import glob
import sys

ROOT = "/home/z/my-project"
PATH = f"{ROOT}/src/lib/ar-en-map.json"

NEW_KEYS = {
    # ---- shared header / footer ----
    "الموقع الرسمي": "Official website",
    "الرئيسية": "Home",
    "كيف يعمل": "How it works",
    "الأمان": "Security",
    "تحميل NexusLink": "Download NexusLink",
    "واجهة التطبيق (تجريبية في المتصفح)": "App interface (beta in browser)",
    "الموقع الرسمي لمشروع NexusLink — ربط الأجهزة محليًا بخصوصية كاملة، ودون أي سحابة.":
        "The official website of the NexusLink project — link your devices locally with full privacy, and no cloud at all.",
    # ---- home hero ----
    "حوّل أجهزتك إلى منظومة واحدة… بلا سحابة":
        "Turn your devices into one seamless system… with no cloud",
    "NexusLink يربط هاتفك بجهاز الكمبيوتر محليًا على شبكتك: حافظة مشتركة، نقل ملفات يستأنف بعد الانقطاع، تحكم عن بُعد، مرآة إشعارات ورسائل ومكالمات، وكاميرا افتراضية — كل قناة مشفرة من الطرف إلى الطرف، وكل شيء يعمل على أجهزتك أنت.":
        "NexusLink connects your phone to your computer locally on your own network: shared clipboard, resumable file transfer, remote control, mirrored notifications, SMS and calls, and a virtual camera — every channel end-to-end encrypted, and everything runs on your devices.",
    "تنزيل NexusLink": "Download NexusLink",
    "تجربة واجهة التطبيق": "Try the app interface",
    "لا سحابة — شبكتك المحلية فقط": "No cloud — your local network only",
    # ---- how it works ----
    "ثلاث خطوات بينك وبين منظومة أجهزة موحدة — دقائق معدودة حتى أول نقل ملفات.":
        "Three steps between you and a unified device system — minutes until your first file transfer.",
    "ثبّت التطبيق": "Install the app",
    "مثبّتات رسمية موقّعة لأربع منصات — Windows وmacOS وLinux وAndroid — مع بصمات SHA256 منشورة للتحقق قبل التشغيل.":
        "Official signed installers for four platforms — Windows, macOS, Linux and Android — with published SHA256 checksums to verify before running.",
    "اقترن بمسح رمز QR": "Pair by scanning a QR code",
    "امسح الرمز من واجهة الكمبيوتر بكاميرا هاتفك، فيتبادل الجهازان مفاتيح جلسة مشتقة من سر الاقتران — بلا حسابات ولا تسجيل.":
        "Scan the code from the computer interface with your phone camera, and the two devices exchange session keys derived from the pairing secret — no accounts, no sign-up.",
    "استخدم — كل شيء محلي": "Use it — everything stays local",
    "حافظة مشتركة، ملفات، تحكم عن بُعد، إشعارات ورسائل — كل البايتات تمر عبر شبكتك المحلية المشفرة ولا يلمس أي منها خادمًا خارجيًا.":
        "Shared clipboard, files, remote control, notifications and messages — every byte travels across your encrypted local network and never touches an external server.",
    "بصدق: الاتصال الخارجي الوحيد الذي يجريه التطبيق هو فحص التحديثات — ويمكنك تعطيله كليًا من الإعدادات فيصبح التطبيق معزولًا على شبكتك تمامًا.":
        "To be honest: the only outbound connection the app makes is the update check — and you can disable it entirely from settings, leaving the app fully isolated on your network.",
    # ---- stats band ----
    "أرقام من المشروع": "Numbers from the project",
    "زمن استجابة التحكم P95 (مقاس)": "P95 remote-control response time (measured)",
    "سرعة نقل مقاسة عبر الجسور": "Measured transfer speed across the bridges",
    "ذاكرة واجهة سطح المكتب عند التشغيل": "Desktop UI memory at runtime",
    "فحص E2E آلي أخضر على المشروع": "Automated E2E checks passing green",
    "أرقام مقاسة فعليًا داخل بيئة التطوير الموثقة — قد تختلف حسب شبكتك وأجهزتك.":
        "Numbers actually measured in the documented development environment — yours may vary with your network and devices.",
    # ---- security section ----
    "الأمان أولًا": "Security first",
    "عقد تشفيري موثق بالبايت في المستودع المفتوح — يُراجع ويُختبر آليًا مع كل جولة إصدار.":
        "A cryptographic contract documented byte-by-byte in the open repository — reviewed and automatically tested with every release round.",
    "اقتران متبادل بمفاتيح حية": "Mutual pairing with live keys",
    "مسح QR يشتق مفاتيح جلسة X25519 من سر الاقتران، مع مقارنة سلسلة تحقق قصيرة (SAS) تمنع هجوم الوسيط حتى على شبكة غير موثوقة.":
        "Scanning the QR derives X25519 session keys from the pairing secret, with a short authentication string (SAS) comparison that blocks man-in-the-middle attacks even on an untrusted network.",
    "تشفير كل قناة بايتًا بايتًا": "Every channel encrypted byte by byte",
    "AES-256-GCM بعدّاد تسلسلي وبيانات مصادقة إضافية لكل رسالة — التقاط الحزم بـWireshark لا يُظهر محتوى مقروءًا، وهو معيار قبول معلن في المشروع.":
        "AES-256-GCM with a per-message sequence counter and additional authenticated data — packet captures in Wireshark reveal no readable content, a publicly stated acceptance criterion of the project.",
    "تحديثات موقّعة رقميًا": "Digitally signed updates",
    "أصول التحديث لسطح المكتب تحمل توقيع minisign/Ed25519 مع prehash Blake2b — التطبيق يرفض أي تحديث لا يطابق المفتاح العام المضمّن فيه.":
        "Desktop update assets carry a minisign/Ed25519 signature with a Blake2b prehash — the app refuses any update that does not match its embedded public key.",
    "خصوصية بالتصميم لا بالوعد": "Privacy by design, not by promise",
    "لا حسابات ولا تتبع ولا تحليلات: الخوادم هي جهازك نفسه، والاقتران محلي عبر QR، وفحص التحديث الوحيد القابل للتعطيل هو كل ما يلمس الإنترنت.":
        "No accounts, no tracking, no analytics: the server is your own machine, pairing is local via QR, and the only internet touchpoint — the update check — can be disabled.",
    # ---- platforms strip ----
    "منصتك… مغطاة": "Your platform… covered",
    "خط إصدار واحد يبني المنصات الأربع ويوقع أصولها في نفس الجولة الخضراء.":
        "One release pipeline builds all four platforms and signs their assets in the same green run.",
    "Windows 10/11 (64-bit) — مثبّت وMSI ونسخة محمولة":
        "Windows 10/11 (64-bit) — installer, MSI and portable build",
    "macOS 12+ على Apple Silicon — صورة قرص موقعة":
        "macOS 12+ on Apple Silicon — signed disk image",
    "Ubuntu 20.04+ / Debian 11+ — AppImage وdeb":
        "Ubuntu 20.04+ / Debian 11+ — AppImage and deb",
    "Android 7+ (يُنصح 10 وما فوق) — APK موقّع بالكامل الوظائف":
        "Android 7+ (10+ recommended) — signed APK with the full feature set",
    "حد صادق: يوجد بناء iOS في خط الإصدار، لكن قيود Apple تمنع مرآة SMS والمكالمات والتحكم الكامل — الأندرويد هو التجربة الكاملة.":
        "Honest limit: an iOS build exists in the release pipeline, but Apple's restrictions block SMS mirroring, calls and full remote control — Android is the complete experience.",
    # ---- home FAQ ----
    "أسئلة يسألها الجميع": "Questions everyone asks",
    "أجوبة صادقة بلا تسويق — وللتفاصيل الكاملة: صفحة التحميل والأسئلة الشائعة هناك.":
        "Honest answers with no marketing — for the full details, see the download page and its FAQ.",
    "هل يحتاج NexusLink اتصال إنترنت؟":
        "Does NexusLink need an internet connection?",
    "لا. الاقتران والنقل والتحكم والمرايا — كلها تجري على شبكتك المحلية بين أجهزتك. الاتصال الخارجي الوحيد هو فحص التحديثات، ويمكن تعطيله كليًا من الإعدادات فيصبح النظام معزولًا تمامًا.":
        "No. Pairing, transfers, remote control and mirroring all run on your local network between your devices. The only outbound connection is the update check, which can be disabled entirely from settings to make the system fully isolated.",
    "هل تخرج بياناتي إلى أي خادم سحابي؟":
        "Does any of my data reach a cloud server?",
    "لا يوجد خادم سحابي أصلًا: الخادم هو جهاز الكمبيوتر عندك، والهاتف وكيل على شبكتك. كل قناة مشفرة من الطرف إلى الطرف بـAES-256-GCM فوق مفاتيح مشتقة من اقتران QR — حتى على شبكتك نفسها تظل الحزم غير مقروءة لأي متطفل.":
        "There is no cloud server at all: the server is your own computer, and the phone is an agent on your network. Every channel is end-to-end encrypted with AES-256-GCM over keys derived from the QR pairing — even on your own network, captures stay unreadable to any eavesdropper.",
    "هل يعمل على iPhone؟":
        "Does it work on iPhone?",
    "بصدق: يوجد بناء iOS في خط الإصدار، لكن قيود Apple تغلق مرآة الإشعارات وSMS والمكالمات والتحكم الكامل — لذا تجربة iOS أقل بوظائف معلنة. الأندرويد (7+) هو المنصة الكاملة الوظائف.":
        "To be honest: an iOS build ships in the release pipeline, but Apple's restrictions close notification/SMS mirroring, calls and full control — so the iOS experience has fewer documented features. Android (7+) is the complete platform.",
    "كيف أحدث التطبيق لاحقًا؟":
        "How do I update the app later?",
    "تطبيق سطح المكتب يفحص latest.json المنشور مع كل إصدار ويحدّث نفسه تلقائيًا بعد التحقق من التوقيع الرقمي لمنصتك. أندرويد يحدث بالتثبيت فوق النسخة القديمة من صفحة التحميل، وقاعدة بياناتك وإعداداتك تُحفظ عبر ترقيات مخطط مضمونة.":
        "The desktop app checks the published latest.json with each release and updates itself automatically after verifying the digital signature for your platform. Android updates by installing the new APK over the old one from the download page, and your database and settings survive through guaranteed schema migrations.",
    # ---- CTA band ----
    "جاهز تربط أجهزتك؟": "Ready to link your devices?",
    "حمّل النسخة الموقعة لمنصتك، امسح رمز الاقتران، ودع الباقي على شبكتك — حرفيًا في دقائق.":
        "Grab the signed build for your platform, scan the pairing code, and let the rest stay on your network — literally minutes.",
    "تنزيل الآن": "Download now",
    "المستودع المفتوح على GitHub": "Open repository on GitHub",
}


def extract_keys():
    """Every Arabic literal the site pages pass through t() (direct or via data arrays)."""
    keys = set()
    files = sorted(glob.glob(f"{ROOT}/src/components/site/*.tsx")) + [
        f"{ROOT}/src/components/download/site-header.tsx",
        f"{ROOT}/src/components/download/site-footer.tsx",
    ]
    pat_direct = re.compile(r't\(\s*("(?:[^"\\]|\\.)*")')
    pat_data = re.compile(r'(?:titleKey|bodyKey|labelKey|descKey|q|a):\s*("(?:[^"\\]|\\.)*")')
    for f in files:
        src = open(f, encoding="utf-8").read()
        for m in pat_direct.findall(src) + pat_data.findall(src):
            keys.add(json.loads(m))
    return keys


def main():
    with open(PATH, encoding="utf-8") as fh:
        mapping = json.load(fh)
    before = len(mapping)

    added = 0
    for k, v in NEW_KEYS.items():
        if k not in mapping:
            mapping[k] = v
            added += 1
        elif mapping[k] != v:
            print(f"CONFLICT for existing key: {k!r}")
            sys.exit(1)

    with open(PATH, "w", encoding="utf-8") as fh:
        json.dump(mapping, fh, ensure_ascii=False, indent=2)
        fh.write("\n")

    # completeness guard — no silent Arabic fallback in EN mode
    still_missing = sorted(k for k in extract_keys() if k not in mapping)
    if still_missing:
        print("STILL MISSING AFTER UPDATE:")
        for k in still_missing:
            print(repr(k))
        sys.exit(1)

    print(f"OK: {before} -> {len(mapping)} keys (+{added}) — completeness guard PASS")


if __name__ == "__main__":
    main()
