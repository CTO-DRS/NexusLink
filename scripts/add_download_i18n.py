#!/usr/bin/env python3
"""Add download-site i18n keys to src/lib/ar-en-map.json (additive, idempotent).

The i18n engine (src/lib/i18n.ts) uses the Arabic string as the source key.
Missing keys fall back to Arabic, so this only ADDS English translations.
Run: python3 scripts/add_download_i18n.py
"""
import json
import sys

PATH = "src/lib/ar-en-map.json"

NEW_KEYS = {
    # ---- header / nav ----
    "التحميلات": "Downloads",
    "الميزات": "Features",
    "دليل التثبيت": "Installation guide",
    "التحديث والتحقق": "Updates & verification",
    "الأسئلة الشائعة": "FAQ",
    "المستودع على GitHub": "GitHub repository",
    "تبديل اللغة": "Switch language",
    # ---- hero ----
    "اربط أجهزتك… بخصوصية كاملة": "Link your devices… with full privacy",
    "NexusLink يصل هاتفك بجهاز الكمبيوتر محليًا على شبكتك: حافظة مشتركة، نقل ملفات، تحكم عن بُعد، ومرآة شاشة — بتشفير من الطرف إلى الطرف ودون أي سحابة.": "NexusLink connects your phone to your computer locally on your network: shared clipboard, file transfer, remote control, and screen mirroring — end-to-end encrypted with no cloud in between.",
    "مجاني للاستخدام الشخصي": "Free for personal use",
    "أحدث إصدار": "Latest release",
    "مباشر من GitHub": "Live from GitHub",
    "منشور في": "Published on",
    "جميع التحميلات": "All downloads",
    "تحميل لنظام Windows": "Download for Windows",
    "تحميل لنظام macOS": "Download for macOS",
    "تحميل لنظام Linux": "Download for Linux",
    "تحميل لنظام Android": "Download for Android",
    "كمبيوتر + هاتف على شبكتك المحلية": "PC + phone on your local network",
    "جارٍ جلب بيانات الإصدار…": "Fetching release info…",
    # ---- platforms / downloads ----
    "المتطلبات: Windows 10/11 (64-bit)": "Requirements: Windows 10/11 (64-bit)",
    "المتطلبات: macOS 12+ (Apple Silicon)": "Requirements: macOS 12+ (Apple Silicon)",
    "المتطلبات: Ubuntu 20.04+ / Debian 11+ (64-bit)": "Requirements: Ubuntu 20.04+ / Debian 11+ (64-bit)",
    "المتطلبات: Android 7+ (يُنصح 10 وما فوق)": "Requirements: Android 7+ (10+ recommended)",
    "مُوصى به لنظامك": "Recommended for your system",
    "المثبّت الرسمي": "Official installer",
    "حزمة MSI للمؤسسات": "MSI package for enterprises",
    "نسخة محمولة دون تثبيت": "Portable version, no installation",
    "صورة قرص Mac (Apple Silicon)": "Mac disk image (Apple Silicon)",
    "تطبيق macOS مضغوط": "Compressed macOS app",
    "تشغيل مباشر بنقرة واحدة": "One-click direct run",
    "حزمة Debian/Ubuntu": "Debian/Ubuntu package",
    "تثبيت مباشر على هاتفك": "Direct install on your phone",
    "للنشر عبر Google Play أو أدوات MDM": "For Play Store or MDM distribution",
    "تنزيل": "Download",
    "التوقيع الرقمي": "Digital signature",
    "جميع الملفات والتوقيعات في صفحة الإصدارات": "All files and signatures on the releases page",
    "بصمات SHA256 لكل الملفات": "SHA256 checksums for every file",
    "ملف نقطة التحديث التلقائي": "Auto-update endpoint file",
    "الملفات المصدرية للتوقيع": "Signature source files",
    # ---- features ----
    "لماذا NexusLink؟": "Why NexusLink?",
    "حافظة مشتركة فورية": "Instant shared clipboard",
    "انسخ على هاتفك والصق على الكمبيوتر والعكس — نصوص وصور وروابط، كل ذلك محليًا وبلا سحابة.": "Copy on your phone, paste on your computer and vice versa — text, images and links, all locally with no cloud.",
    "نقل ملفات سريع": "Fast file transfer",
    "اسحب وأفلت بين الأجهزة مع استكمال تلقائي ومهام نقل خلفية واستكشاف تخزين الهاتف.": "Drag and drop between devices with auto-resume, background queue and phone storage browsing.",
    "تحكم بالكمبيوتر من هاتفك": "Control your PC from your phone",
    "شاشة حية ولمسات ولوحة مفاتيح — أطفئ الجهاز أو شغّله وتحكّم بالماوس من غرفة أخرى.": "Live screen, touch and keyboard — lock or wake the machine and drive the mouse from another room.",
    "تحكم بهاتف من هاتف آخر": "Phone-to-phone control",
    "جديد في 1.1.0: اعرض شاشة هاتفك الثاني وتحكّم بها من هاتفك الأول عبر المركز — بجلسة موثقة وقطع فوري.": "New in 1.1.0: view and control your second phone from your first one via the hub — with a trusted session and instant disconnect.",
    "مرآة شاشة وNexusLive": "Screen mirroring & NexusLive",
    "بث شاشة الهاتف إلى الكمبيوتر مع لوحة رسم وشاشة ثانية افتراضية للعمل المزدوج.": "Stream the phone screen to the computer with a drawing board and a virtual second display.",
    "إشعارات ورسائل ومكالمات": "Notifications, SMS & calls",
    "استقبل إشعارات الهاتف على الكمبيوتر، وأرسل SMS، وأجرِ المكالمات من الواجهة نفسها.": "Receive phone notifications on the desktop, send SMS, and place calls from the same interface.",
    "تشفير من الطرف إلى الطرف": "End-to-end encryption",
    "X25519 + AES-256-GCM على كل قناة — التقاط الحزم لا يُظهر محتوى مقروءًا.": "X25519 + AES-256-GCM on every channel — packet capture reveals no readable content.",
    "تحديث تلقائي آمن": "Safe automatic updates",
    "يتحقق التطبيق من latest.json ويحدّث نفسه بتوقيعات رقمية على Windows وmacOS وLinux.": "The app checks latest.json and updates itself with digital signatures on Windows, macOS and Linux.",
    # ---- install guides ----
    "خطوات التثبيت": "Installation steps",
    "Windows — المثبّت": "Windows — installer",
    "نزّل NexusLink_1.1.0_x64-setup.exe وشغّله": "Download NexusLink_1.1.0_x64-setup.exe and run it",
    "إن ظهر SmartScreen اختر «مزيد من المعلومات» ثم «تشغيل على أي حال»": "If SmartScreen appears choose «More info» then «Run anyway»",
    "أكمل المعالج ثم افتح NexusLink من قائمة ابدأ": "Finish the wizard then open NexusLink from the Start menu",
    "Windows — نسخة محمولة": "Windows — portable",
    "فك ضغط NexusLink_1.1.0_x64-portable.zip في مجلد من اختيارك وشغّل NexusLink.exe": "Extract NexusLink_1.1.0_x64-portable.zip to a folder of your choice and run NexusLink.exe",
    "macOS — Apple Silicon": "macOS — Apple Silicon",
    "افتح ملف DMG واسحب NexusLink إلى مجلد التطبيقات": "Open the DMG and drag NexusLink into Applications",
    "عند أول تشغيل: كليك يمين على الأيقونة ثم «فتح» لتجاوز Gatekeeper": "On first launch: right-click the icon and choose «Open» to bypass Gatekeeper",
    "أو بديلًا: فك NexusLink.app.tar.gz إلى /Applications": "Alternatively: extract NexusLink.app.tar.gz into /Applications",
    "Linux — AppImage أو deb": "Linux — AppImage or deb",
    "أعطِ صلاحية التنفيذ ثم شغّل الملف مباشرة": "Make it executable then run it directly",
    "ثبّت حزمة deb بالأمر": "Install the deb package with",
    "قد تحتاج لتثبيت libwebkit2gtk-4.1 وlibayatana-appindicator3": "You may need libwebkit2gtk-4.1 and libayatana-appindicator3",
    "Android — APK": "Android — APK",
    "نزّل NexusLink-1.1.0-release.apk على هاتفك وافتحه": "Download NexusLink-1.1.0-release.apk on your phone and open it",
    "فعّل «السماح من هذا المصدر» عند طلب النظام": "Enable «Allow from this source» when the system asks",
    "على أندرويد 13+ إن ظهرت رسالة الإعدادات المحظورة اتبع خطوات مركز رفع القيود أدناه": "On Android 13+ if the restricted-settings message appears follow the Unblock Center steps below",
    "مركز رفع القيود (أندرويد 13+)": "Unblock Center (Android 13+)",
    "أندرويد 13+ يحجب خدمات إمكانية الوصول للتطبيقات المثبتة خارج المتجر — الفك يدوي ومقصود من جوجل، وهذه خطواته الرسمية:": "Android 13+ blocks accessibility services for sideloaded apps — the block is intentional by Google, and these are the official unblock steps:",
    "افتح إعدادات النظام ← التطبيقات ← إدارة التطبيقات ← NexusLink": "Open system Settings → Apps → All apps → NexusLink",
    "من قائمة ⋮ أعلى اليمين اختر «السماح بالإعدادات المحظورة»": "From the ⋮ menu at the top choose «Allow restricted settings»",
    "عد إلى تطبيق NexusLink وفعّل خدمة إمكانية الوصول من شاشة التحكم": "Return to NexusLink and enable the accessibility service from the Control screen",
    "تنبيه": "Note",
    # ---- verify / updates ----
    "تحقّق قبل التشغيل": "Verify before you run",
    "قارن بصمة SHA256 مع ملف SHA256SUMS.txt المنشور مع الإصدار": "Compare the SHA256 digest against the published SHA256SUMS.txt",
    "الأمر على Windows (PowerShell)": "Command on Windows (PowerShell)",
    "الأمر على macOS وLinux": "Command on macOS & Linux",
    "التحديث التلقائي (للمثبّتات الرسمية)": "Automatic updates (for official installers)",
    "تطبيق الكمبيوتر يفحص ملف latest.json دوريًا، يُنزّل التحديث ويجري توقيعه قبل التثبيت — يمكنك التعطيل من الإعدادات.": "The desktop app periodically checks latest.json, downloads the update and verifies its signature before installing — you can disable this in Settings.",
    "إصدارات سابقة وسجل التغييرات": "Previous releases and changelog",
    # ---- FAQ ----
    "هل يعمل NexusLink دون إنترنت؟": "Does NexusLink work without internet?",
    "نعم — كل شيء يعمل على شبكتك المحلية مباشرة. الاتصال الخارجي الوحيد هو فحص التحديث، وهو قابل للتعطيل كليًا من الإعدادات.": "Yes — everything runs directly on your local network. The only outbound connection is the update check, and it can be disabled entirely in Settings.",
    "أين تذهب بياناتي؟": "Where does my data go?",
    "لا تغادر أجهزتك إطلاقًا: لا سحابة ولا حسابات ولا تحليلات — القنوات مشفرة من الطرف إلى الطرف بين أجهزتك فقط.": "Your data never leaves your devices: no cloud, no accounts, no analytics — channels are end-to-end encrypted between your devices only.",
    "ما الفرق بين ملفات Windows الثلاثة؟": "What is the difference between the three Windows files?",
    "setup.exe للمستخدم العادي (مع تحديث تلقائي)، msi للنشر المؤسسي الصامت، وportable.zip للاستخدام دون تثبيت من USB.": "setup.exe for regular users (with auto-update), msi for silent enterprise deployment, and portable.zip to run without installing from a USB stick.",
    "لماذا يحتاج تطبيق الهاتف صلاحيات إمكانية الوصول؟": "Why does the phone app need accessibility permissions?",
    "لحقن اللمسات في التحكم عن بُعد وقراءة الإشعارات — أندرويد 13+ يحجبها للتطبيقات المثبتة بجانب المتجر، والحل في «مركز رفع القيود» أعلاه.": "To inject remote-control touches and read notifications — Android 13+ blocks this for sideloaded apps; the fix is the Unblock Center above.",
    "هل يوجد إصدار iPhone؟": "Is there an iPhone version?",
    "بصدق: iOS يدعم الحافظة والملفات فقط بقيود Apple — لا إشعارات ولا SMS ولا مكالمات ولا تحكم. أندرويد هو المنصة الكاملة.": "Honestly: iOS supports clipboard and files only due to Apple's limits — no notifications, SMS, calls or control. Android is the full platform.",
    "كيف أُحدّث التطبيق لاحقًا؟": "How do I update later?",
    "تطبيق الكمبيوتر يحدّث نفسه تلقائيًا، وهاتف يُنصح بإعادة تنزيل APK الجديد من هذه الصفحة عند صدوره.": "The desktop app updates itself automatically; for the phone, download the new APK from this page when released.",
    # ---- footer ----
    "موقع التنزيل الرسمي لمشروع NexusLink — ربط الأجهزة محليًا بخصوصية كاملة.": "Official download site for the NexusLink project — local device linking with full privacy.",
    "صفحة الإصدارات": "Releases page",
    "التبليغ عن مشكلة": "Report an issue",
    "الإصدار الحالي": "Current version",
    "بُني بحب للأجهزة المتصلة": "Built with care for connected devices",
}


def main() -> int:
    with open(PATH, encoding="utf-8") as f:
        data = json.load(f)
    added = 0
    for ar, en in NEW_KEYS.items():
        if ar not in data:
            data[ar] = en
            added += 1
        elif data[ar] != en:
            data[ar] = en
            added += 1
    with open(PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"map now has {len(data)} keys (+{added} new/updated from download-site set)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
