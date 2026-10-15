#!/usr/bin/env python3
# §22 — إضافة ترجمات EN للمفاتيح العربية الجديدة (المرحلة 0-وسائط)
# القاموس مصدره العربي (src/lib/ar-en-map.json) — نضيف الفاقد حصرًا.
import json, sys

PATH = "/home/z/my-project/src/lib/ar-en-map.json"
m = json.load(open(PATH, encoding="utf-8"))
before = len(m)

entries = {
    # لوحة الأدوات — تبويب الأجهزة الافتراضية
    "الأجهزة الافتراضية": "Virtual devices",
    "الأجهزة الافتراضية — كاميرا وميكروفون الهاتف": "Virtual devices — phone camera & microphone",
    "حالة كل جهاز افتراضي: مثبت/غير مثبت/نسخته — مع التثبيت والإرشاد بلا أي خطوة يدوية": "Every virtual device status: installed/not installed/its version — with installation and guidance, zero manual steps",
    "هذه اللوحة تعمل في نافذة تطبيق سطح المكتب (Tauri) حيث تعيش الأجهزة الافتراضية": "This panel runs inside the desktop app window (Tauri) where the virtual devices live",
    "الكاميرا الافتراضية": "Virtual camera",
    "مثبتة": "Installed",
    "غير مثبتة": "Not installed",
    "الأجهزة المسجلة": "Registered devices",
    "لا كاميرا افتراضية مسجلة بعد": "No virtual camera registered yet",
    "خطوات الإعداد": "Setup steps",
    "اختبار النجاح: مكالمة Meet على كمبيوتر بأي كاميرا حقيقية ← اختر «NexusLink Camera» من قائمة كاميرات Meet مباشرة": "Success test: a Meet call on a computer with any real camera → pick “NexusLink Camera” straight from Meet's camera list",
    "تثبيت حزمة الكاميرا": "Install camera package",
    "جارٍ التثبيت…": "Installing…",
    "الميكروفون الافتراضي": "Virtual microphone",
    "مثبت": "Installed",
    "غير مثبت": "Not installed",
    "لينكس: مصدر النظام عبر module-pipe-source — لا حاجة لدرايفر خارجي": "Linux: system source via module-pipe-source — no external driver needed",
    "درايفر صوت مفتوح قابل للتوزيع غير متاح على ويندوز — VB-CABLE (مجاني) هو البديل المكتشف، وBlackHole على ماك": "No open redistributable virtual-audio driver exists on Windows — VB-CABLE (free) is the discovered fallback, BlackHole on macOS",
    "إعدادات صوت النظام": "System sound settings",
    "حزمة الكاميرا: akvirtualcamera الرسمي غير المعدَّل (GPL-3.0) — الترخيص والمصدر في مجلد vcam التابع للتطبيق": "Camera package: unmodified official akvirtualcamera (GPL-3.0) — license and source in the app's vcam folder",
    "سيُشغّل مثبّت akvirtualcamera الرسمي المرفق (9.3.1 — GPL) بصمت، وقد يطلب إذن مدير النظام. متابعة؟": "The bundled official akvirtualcamera installer (9.3.1 — GPL) will run silently and may request administrator rights. Continue?",
    "اكتمل التثبيت — «NexusLink Camera» أصبحت متاحة لكل التطبيقات": "Install complete — “NexusLink Camera” is now available to all apps",
    "فُتحت إعدادات الصوت — اختر «NexusLink Mic»/«CABLE Output» كمدخل": "Sound settings opened — pick “NexusLink Mic”/“CABLE Output” as input",
    "أجهزة": "devices",
    "نسخة": "version",
    # التشخيص
    "الكاميرا الافتراضية (NexusLink Camera)": "Virtual camera (NexusLink Camera)",
    "«NexusLink Camera» جاهزة لـ Zoom/Meet": "“NexusLink Camera” ready for Zoom/Meet",
    "لا جهاز v4l2loopback — حمّل الوحدة (راجع الإرشاد)": "No v4l2loopback device — load the module (see guide)",
    "غير مثبتة — «تثبيت حزمة الكاميرا» من تبويب الأجهزة الافتراضية": "Not installed — “Install camera package” from the Virtual devices tab",
    "مكتشف": "detected",
    "غير مثبت — VB-CABLE/BlackHole (راجع الإرشاد)": "Not installed — VB-CABLE/BlackHole (see guide)",
    # بث الوسائط (الماسح النصي)
    "افتح في مشغل النظام (stream مؤقت)": "Open in system player (temporary stream)",
    "العرض على شاشة كبيرة (هاتف ← TV) — الوضع المدعوم فعليًا": "Big-screen playback (phone → TV) — the actually supported mode",
    "نافذة «Nexus-TV» أعلاه: معاينة داخل التطبيق تعمل دائمًا.": "The “Nexus-TV” window above: an in-app preview that always works.",
    "أي شاشة بمتصفح على الشبكة المحلية (تلفاز ذكي/جهاز استقبال): افتح": "Any browser-capable screen on your LAN (smart TV/receiver): open",
    "— تصبح مستقبل بث حقيقيًا بنفس التحكم.": "— it becomes a real cast receiver with the same controls.",
    "مشغل سطح المكتب الافتراضي (VLC/Windows Media Player) عبر زر «افتح في مشغل النظام».": "The default desktop player (VLC/Windows Media Player) via the “Open in system player” button.",
    "صادق: بروتوكول Chromecast الأصلي (mDNS) غير مدعوم — مسار /tv هو البديل المكافئ عمليًا.": "Honest: native Chromecast (mDNS) is not supported — the /tv route is the practical equivalent.",
    "(نسخ)": "(copy)",
    # صفحة /tv
    "NexusLink Cast — شاشة الاستقبال": "NexusLink Cast — receiver screen",
    "افتح تطبيق NexusLink على الكمبيوتر ← الوسائط ← بث الوسائط، اختر مقطعًا من هاتفك ووجهة «Nexus-TV» — سيبدأ العرض هنا فورًا.": "Open NexusLink on the computer → Media → Cast, pick a clip from your phone with the “Nexus-TV” destination — playback starts here instantly.",
    "متصل بجسر الوسائط (3005)": "Connected to the media bridge (3005)",
    "جارٍ الاتصال…": "Connecting…",
    "بث وارد": "Incoming cast",
    "تشغيل/إيقاف": "Play/pause",
    "كتم": "Mute",
    "ملء الشاشة": "Fullscreen",
}

added = 0
for ar, en in entries.items():
    if ar not in m or not m[ar].strip():
        m[ar] = en
        added += 1

json.dump(m, open(PATH, "w", encoding="utf-8"), ensure_ascii=False, indent=2, sort_keys=False)
print(f"before={before} added={added} after={len(m)}")
