#!/usr/bin/env python3
# R4-s3 (§21) — إضافة قاموس gyro.* إلى ترجمتَي الهاتف (ar/en)
import json, io

AR = {
    "title": "التحكم المتقدم (الجيروسكوب)",
    "entry": "جيمباد + ماوس هوائي + عارض عروض",
    "entryDesc": "ألعب بجيروسكوب هاتفك (قوالب منصة/سباقات/قتال بمفاتيح قابلة للتعيين)، وأشير بماوس هوائي معاير، وأقلّب عرض PowerPoint بإيماءة المعصم مع مؤقت يهتز عند الانتهاء.",
    "open": "افتح التحكم المتقدم",
    "sessionOn": "جلسة نشطة", "sessionOff": "لا جلسة",
    "liveReady": "القناة الحية جاهزة", "liveWait": "بانتظار القناة الحية…", "liveOff": "القناة الحية مغلقة",
    "rtt": "الزمن {n}ms",
    "startSession": "ابدأ جلسة التحكم",
    "mode": "الوضع (من الكمبيوتر — مصدر الحقيقة)",
    "modeOff": "معطّل", "modeGamepad": "جيمباد", "modeAirmouse": "ماوس هوائي", "modePresenter": "عارض عروض",
    "template": "القالب",
    "tplPlatformer": "منصة (مسافة = قفز)", "tplRacing": "سباقات (مسافة = فرامل يد)", "tplFighting": "قتال (ZXCV)", "tplCustom": "مخصص",
    "flipHint": "عصا التقليب: أمِل الهاتف يمينًا/يسارًا وأمامًا/خلفًا — زاوية الجاذبية تحرّك الأسهم، والنافذة الميتة تحمي من الانطلاق العشوائي.",
    "deadzone": "النافذة الميتة (إمالة)", "deadzoneVal": "النافذة الميتة {n}°",
    "keysTitle": "مفاتيح الأزرار (لكل لعبة)", "keysHint": "حرف ASCII واحد أو مفتاح مسمّى: up/down/left/right/space/enter/esc/tab/shift/ctrl/pageup/pagedown/home/end/f5/f11",
    "save": "حفظ على الكمبيوتر",
    "tuning": "ضبط دقيق",
    "sens": "الحساسية", "shake": "عتبة تجاهل الاهتزاز", "tilt": "عتبة إيماءة التقليب",
    "airHint": "أمسِك الزر وحرّك المعصم — المؤشر يتبع دوران اليد بعد فلترة الاهتزاز. اترك الزر فيتجمّد المؤشر.",
    "grabBtn": "إمساك — اضغط باستمرار وحرّك", "grabbing": "أنت تُشير الآن…",
    "calibrate": "معايرة: نقطة الصفير", "calibrating": "جارٍ التقاط الصفير…", "calibrated": "معايَر", "notCalibrated": "غير معايَر",
    "calibrateHint": "امسك الهاتف بوضعيتك المريحة الساكنة ثم اضغط — يُلتقط متوسط 12 عينة كنقطة صفير (يزيل الانحياز ووضع اليد).",
    "presentHint": "قلّب المعصم يمينًا/يسارًا قليلاً (تجاوز العتبة ثم عُد) لشريحة تالية/سابقة — أو استعمل الأزرار.",
    "f5": "بدء العرض (F5)", "esc": "إنهاء (Esc)", "prev": "السابقة", "next": "التالية",
    "laser": "ليزر (Ctrl+L)", "black": "شاشة سوداء",
    "timerDone": "انتهى الوقت!",
    "timerStart": "ابدأ", "timerPause": "إيقاف مؤقت", "timerReset": "تصفير", "timerMin": "{n} دقيقة",
    "hint": "البث 100Hz فوق NexusLive UDP — نشط مع وضع مفعّل وجلسة وقناة حية حصرًا. الليزر يعمل في عرض PowerPoint (Ctrl+L)؛ بقية العارضات تتحرك بالمؤشر فقط.",
}

EN = {
    "title": "Advanced control (gyroscope)",
    "entry": "Gamepad + air mouse + presenter",
    "entryDesc": "Play with your phone's gyroscope (platformer/racing/fighting templates with assignable keys), point with a calibrated air mouse, and flip PowerPoint slides with a wrist gesture plus a timer that vibrates when time is up.",
    "open": "Open advanced control",
    "sessionOn": "Session active", "sessionOff": "No session",
    "liveReady": "Live channel ready", "liveWait": "Waiting for live channel…", "liveOff": "Live channel closed",
    "rtt": "Latency {n}ms",
    "startSession": "Start control session",
    "mode": "Mode (from the computer — source of truth)",
    "modeOff": "Off", "modeGamepad": "Gamepad", "modeAirmouse": "Air mouse", "modePresenter": "Presenter",
    "template": "Template",
    "tplPlatformer": "Platformer (Space = jump)", "tplRacing": "Racing (Space = handbrake)", "tplFighting": "Fighting (ZXCV)", "tplCustom": "Custom",
    "flipHint": "Flip stick: tilt the phone right/left and forward/back — gravity angle drives the arrow keys, the dead window guards against accidental triggers.",
    "deadzone": "Dead window (tilt)", "deadzoneVal": "Dead window {n}°",
    "keysTitle": "Button keys (per game)", "keysHint": "One ASCII char or a named key: up/down/left/right/space/enter/esc/tab/shift/ctrl/pageup/pagedown/home/end/f5/f11",
    "save": "Save on computer",
    "tuning": "Fine tuning",
    "sens": "Sensitivity", "shake": "Jitter ignore threshold", "tilt": "Flip gesture threshold",
    "airHint": "Hold the grab button and move your wrist — the cursor follows hand rotation after jitter filtering. Release it and the cursor freezes.",
    "grabBtn": "GRAB — hold and move", "grabbing": "Pointing now…",
    "calibrate": "Calibrate: zero point", "calibrating": "Capturing zero…", "calibrated": "Calibrated", "notCalibrated": "Not calibrated",
    "calibrateHint": "Hold the phone still in your comfortable grip then press — the average of 12 samples is captured as the zero point (removes bias and hand pose).",
    "presentHint": "Twist your wrist slightly right/left (past the threshold then back) for next/previous slide — or use the buttons.",
    "f5": "Start show (F5)", "esc": "End (Esc)", "prev": "Previous", "next": "Next",
    "laser": "Laser (Ctrl+L)", "black": "Black screen",
    "timerDone": "Time is up!",
    "timerStart": "Start", "timerPause": "Pause", "timerReset": "Reset", "timerMin": "{n} min",
    "hint": "100Hz streaming over NexusLive UDP — active only with an enabled mode plus an active session and live channel. The laser works in PowerPoint shows (Ctrl+L); other presenters move the cursor only.",
}

for lang, add in (("ar", AR), ("en", EN)):
    p = f"/home/z/my-project/nexuslink_mobile/assets/translations/{lang}.json"
    with io.open(p, encoding="utf-8") as f:
        d = json.load(f)
    d["gyro"] = add
    with io.open(p, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(lang, "gyro keys:", len(add))
