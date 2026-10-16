#!/usr/bin/env python3
# الجولة 5 — إضافة مفاتيح القاموس: p2p (هاتف→هاتف) + unblock (مركز رفع القيود)
# + mirror (مشاركة الشاشة) + مدخلات الإعدادات — نفس القاموس easy_localization.
# الاندماج إضافي حصرًا: أي مفتاح موجود لا يُلمس (نمط add-media0-translations.py).
import json
import sys

AR = "/home/z/my-project/nexuslink_mobile/assets/translations/ar.json"
EN = "/home/z/my-project/nexuslink_mobile/assets/translations/en.json"

AR_ADD = {
    "settings": {
        "p2pEntry": "التحكم بهاتف آخر",
        "p2pHint": "اعرض شاشة هاتفك الآخر ويتحكم بها عن بُعد عبر المركز",
    },
    "p2p": {
        "title": "التحكم بهاتف آخر",
        "waitingConfirm": "بانتظار موافقة «{0}»…",
        "controlling": "التحكم مفعّل: {0}",
        "cutNow": "قطع فوري",
        "rejectedReason": "رُفض الطلب: {0}",
        "targetSurface": "سطح الهاتف الهدف",
        "noMirrorHint": "التحكم نشط — اطلب من صاحب الهاتف الآخر تفعيل «مشاركة شاشتي» لرؤية شاشته هنا، وإلا فاللمس يعمل بالإحداثيات.",
        "startHint": "اختر هاتفًا من القائمة ثم ابدأ الجلسة — سيرى صاحبه طلبًا ويوافق أو يرفض.",
        "systemKeys": "أزرار النظام",
        "keyBack": "رجوع",
        "keyHome": "الرئيسية",
        "keyRecents": "الحديثة",
        "keyNotif": "الإشعارات",
        "textTitle": "الإدخال النصي في الحقل المركّز على الهدف",
        "textHint": "اكتب نصًا يُحقن في الهاتف الآخر…",
        "targetsTitle": "الهواتف المتاحة للتحكم",
        "bridgeOffline": "الجسر غير متصل",
        "noTargets": "لا هواتف أخرى مقترنة — اقرن الهاتف الثاني بنفس المركز أولًا (الاتصال ← اقتران).",
        "targetLive": "متصل الآن",
        "targetOffline": "غير متصل",
        "howTitle": "كيف يعمل؟",
        "howBody": "الهاتفان متصلان بالمركز (سيرفر سطح المكتب): طلبك يمر ببوابة ثقة صارمة — يجب أن يكون الهاتفان مقترنين وموثوقين، ولا يمكن لهاتف أن يتحكم بنفسه، والهدف يرى طلبًا صريحًا يوافق عليه، وقطع الاتصال من أي طرف ينهي كل شيء فورًا. شاشة الهدف تصل عبر بث مباشر داخل الشبكة المحلية.",
    },
    "unblock": {
        "title": "مركز رفع القيود",
        "entryHint": "أندرويد 13+ يمنع تفعيل الإتاحة للتطبيقات المثبتة من APK — هنا الفك خطوة بخطوة",
        "entryFromCtl": "منع أندرويد التفعيل؟ افتح مركز رفع القيود",
        "openCenterShort": "الإعدادات المقيّدة تمنع التفعيل؟ — مركز رفع القيود",
        "statusFree": "خدمة الإتاحة مفعّلة — لا قيد",
        "statusBlocked": "خدمة الإتاحة غير مفعّلة",
        "restrictedDetected": "أندرويد يطبّق «الإعدادات المقيّدة» على هذا التطبيق (تثبيت من خارج المتجر) — اتبع الخطوات.",
        "explainTitle": "ما القيد ولماذا؟",
        "explainBody": "منذ أندرويد 13 يحمي النظام خدمة الإتاحة القوية (القدرة على اللمس والكتابة نيابة عنك): التطبيقات المثبتة يدويًا (ملف APK من خارج متجر) تُوضع في قيد «الإعدادات المقيّدة» فتصبح خيار تفعيلها رماديًا مع رسالة «الإجراء غير مسموح». هذا سلوك نظام مقصود وليس عطلًا في NexusLink — الفك يتم مرة واحدة يدويًا من صفحة التطبيق نفسها، وبعدها يعمل التحكم عن بعد كالمعتاد.",
        "stepsTitle": "خطوات الفك (مرة واحدة)",
        "step1": "افتح صفحة التطبيق في الإعدادات",
        "step1Body": "زر «صفحة التطبيق» بالأسفل يفتحها مباشرة (App Info) — أو يدويًا: الإعدادات ← التطبيقات ← NexusLink.",
        "step2": "اضغط قائمة النقاط الثلاث ⋮",
        "step2Body": "أعلى صفحة التطبيق من زاوية (قد تحتاج تمرير شريط العنوان). في بعض الأجهزة تظهر النقاط الثلاث بجانب «مطلوب النظر» أو تحت زر البحث.",
        "step3": "اختر «السماح بالإعدادات المقيّدة»",
        "step3Body": "قد يطلب النظام التحقق ببصمتك أو وجهك أو رقم القفل (حماية من تثبيت التطبيقات الخبيثة عنك) — أكّده.",
        "step4": "فعّل خدمة NexusLink في الإتاحة",
        "step4Body": "زر «إعدادات الإتاحة» بالأسفل يفتح القائمة مباشرة — اختر NexusLink ثم فعّل الخدمة ووافق «سماح». ارجع للتحكم عن بعد وستجد الحالة خضراء.",
        "openAppInfo": "فتح صفحة التطبيق في الإعدادات",
        "detectLimitation": "ملاحظة صادقة: فحص القيد آليًا غير مضمون على كل نسخ أندرويد (واجهته غير عامة) — إن لم نستطع الفحص فاعتمد على رسالة «الإجراء غير مسموح» عند التفعيل واتبع الخطوات.",
    },
    "mirror": {
        "shareCard": "مشاركة شاشتي مع هاتف آخر",
        "shareCard_desc": "بث شاشة هذا الهاتف مباشرة لهاتف مقترن آخر عبر المركز (التحكم من هناك من الإعدادات ← التحكم بهاتف آخر). حوار موافقة النظام يظهر أول مرة.",
        "startShare": "بدء المشاركة",
        "stopShare": "إيقاف",
        "liveHint": "شاشتك تُبث الآن إلى الهاتف الطالب — إيقاف المشاركة أو إغلاق التطبيق ينهيها.",
    },
}

EN_ADD = {
    "settings": {
        "p2pEntry": "Control another phone",
        "p2pHint": "View and remotely control your other phone through the hub",
    },
    "p2p": {
        "title": "Control another phone",
        "waitingConfirm": "Waiting for “{0}” to approve…",
        "controlling": "Controlling: {0}",
        "cutNow": "Cut now",
        "rejectedReason": "Request rejected: {0}",
        "targetSurface": "Target phone surface",
        "noMirrorHint": "Control is active — ask the other phone's owner to enable “Share my screen” to see it here; touch still works by coordinates.",
        "startHint": "Pick a phone from the list and start a session — its owner sees a request and can allow or deny.",
        "systemKeys": "System keys",
        "keyBack": "Back",
        "keyHome": "Home",
        "keyRecents": "Recents",
        "keyNotif": "Notifications",
        "textTitle": "Text input into the target's focused field",
        "textHint": "Type text to inject on the other phone…",
        "targetsTitle": "Phones available to control",
        "bridgeOffline": "Bridge offline",
        "noTargets": "No other paired phones — pair the second phone to the same hub first (Connect tab).",
        "targetLive": "Connected now",
        "targetOffline": "Offline",
        "howTitle": "How it works",
        "howBody": "Both phones connect to the hub (desktop server): your request passes a strict trust gate — both phones must be paired and trusted, a phone can never control itself, the target sees an explicit request and must approve, and disconnect from either side ends everything instantly. The target's screen arrives as a live stream inside your local network.",
    },
    "unblock": {
        "title": "Unblock Center",
        "entryHint": "Android 13+ blocks accessibility for APK-installed apps — unblock step by step here",
        "entryFromCtl": "Android refuses to enable? Open the Unblock Center",
        "openCenterShort": "Restricted Settings blocking it? — Unblock Center",
        "statusFree": "Accessibility service is enabled — no restriction",
        "statusBlocked": "Accessibility service is not enabled",
        "restrictedDetected": "Android applies “Restricted Settings” to this app (installed outside a store) — follow the steps.",
        "explainTitle": "What is the restriction and why?",
        "explainBody": "Since Android 13 the system protects the powerful accessibility service (touching and typing on your behalf): apps installed manually (an APK outside a store) get the “Restricted settings” flag so their enable switch stays disabled with “Action not allowed”. This is intended OS behavior, not a NexusLink bug — the unblock is a one-time manual step from the app's own page, after which remote control works normally.",
        "stepsTitle": "Unblock steps (one time)",
        "step1": "Open the app's page in Settings",
        "step1Body": "The “App page” button below opens it directly (App Info) — or manually: Settings → Apps → NexusLink.",
        "step2": "Tap the three-dot menu ⋮",
        "step2Body": "Top corner of the app page (you may need to scroll the toolbar). On some devices the dots appear next to “Need to look into it” or under search.",
        "step3": "Choose “Allow restricted settings”",
        "step3Body": "The system may ask for your fingerprint, face or PIN (protection against malware enabling itself) — confirm it.",
        "step4": "Enable the NexusLink service in Accessibility",
        "step4Body": "The “Accessibility settings” button below opens the list — choose NexusLink, enable the service and confirm “Allow”. Return to Remote control and the status turns green.",
        "openAppInfo": "Open the app's page in Settings",
        "detectLimitation": "Honest note: automatically detecting the restriction is not guaranteed on every Android build (its interface is not public) — if we cannot check, rely on the “Action not allowed” message when enabling and follow the steps.",
    },
    "mirror": {
        "shareCard": "Share my screen with another phone",
        "shareCard_desc": "Stream this phone's screen live to another paired phone through the hub (control it from there: Settings → Control another phone). The system consent dialog appears the first time.",
        "startShare": "Start sharing",
        "stopShare": "Stop",
        "liveHint": "Your screen is streaming to the requesting phone — stopping the share or closing the app ends it.",
    },
}


def merge(base: dict, add: dict) -> bool:
    changed = False
    for k, v in add.items():
        if isinstance(v, dict):
            cur = base.setdefault(k, {})
            if not isinstance(cur, dict):
                raise SystemExit(f"key conflict at {k}")
            changed = merge(cur, v) or changed
        else:
            if base.get(k) != v:
                base[k] = v
                changed = True
    return changed


for path, add in ((AR, AR_ADD), (EN, EN_ADD)):
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    changed = merge(data, add)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(("updated: " if changed else "no changes: ") + path)

sys.exit(0)
