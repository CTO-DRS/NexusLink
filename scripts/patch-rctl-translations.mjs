// NexusLink — حقن ترجمات FA-9 (rctl.* + nav.control) إلى ar.json وen.json
import { readFileSync, writeFileSync } from "node:fs"

const AR = "/home/z/my-project/nexuslink_mobile/assets/translations/ar.json"
const EN = "/home/z/my-project/nexuslink_mobile/assets/translations/en.json"

const rctlAr = {
  desktop: "الكمبيوتر",
  power: "الطاقة",
  offline: "قناة التحكم غير متصلة — اربط بالسيرفر أولًا",
  tab: { pad: "لوحة لمس", kbd: "كيبورد", air: "ماوس هوائي", sys: "نظام", clip: "حافظة", hand: "تسليم" },
  pad: {
    title: "لوحة اللمس — حرّك مؤشر الكمبيوتر",
    tap: "نقرة يسرى", dbl: "نقرة مزدوجة", drag: "وضع السحب نشط",
    left: "نقرة يسرى", right: "نقرة أيمن",
    speed: "السرعة", dragk: "سحب",
    hint: "اسحب للحركة · نقر مزدوج · اضغط مطولًا للسحب · الإصبعان للتمرير/القرص",
  },
  kbd: {
    title: "كيبورد لاسلكي (عربي/إنجليزي)",
    hint: "اكتب هنا — تُرسل الضغطات مباشرة إلى الكمبيوتر",
    live: "أُرسلت {n} ضغطة",
    sp: {
      enter: "إدخال", space: "مسافة", backspace: "حذف", tab: "تاب", esc: "خروج",
      up: "أعلى", down: "أسفل", left: "يسار", right: "يمين",
    },
  },
  air: {
    title: "الماوس الهوائي — جيروسكوب الهاتف",
    on: "الهوائي نشط — حرّك هاتفك لتحريك المؤشر",
    off: "الهوائي متوقف",
    gesture: "إيماءة التفعيل: 3 نقرات سريعة ({n})",
    gyro: "الجيروسكوب",
    moves: "الحركات المرسلة: {n}",
  },
  sys: {
    media: "تحكم بالوسائط على الكمبيوتر",
    vol: "مستوى الصوت",
    power: "أوامر الطاقة",
    confirm: "تأكيد أمر النظام",
    confirmBody: "سيُنفَّذ «{a}» على الكمبيوتر — هل أنت متأكد؟",
    rejected: "رفض الجسر الأمر الأخير ({r}) — الكمبيوتر مطفأ؟",
    wol: "إيقاظ Wake-on-LAN — عنوان MAC المسجل",
    macEmpty: "لا MAC بعد — يتصل تلقائيًا عند جهوز الكمبيوتر",
    wake: "أرسل الحزمة السحرية",
    act: {
      lock: "قفل", sleep: "سكون", hibernate: "إسبات", restart: "إعادة تشغيل", shutdown: "إغلاق",
    },
  },
  clip: {
    title: "الحافظة الموحدة — هاتف ↔ كمبيوتر",
    count: "دفعات: {n}",
    watch: "مراقبة حافظة الهاتف",
    watchSub: "استقصاء كل 1.5 ثانية أثناء فتح هذه الشاشة (قيد Android 10+)",
    auto: "إرسال تلقائي عند النسخ",
    autoSub: "أو استخدم زر الإرسال اليدوي أدناه",
    send: "إرسال الحافظة الآن",
    pull: "طلب حافظة الكمبيوتر",
    fromPc: "آخر نص ورد من الكمبيوتر",
    empty: "لا شيء بعد — اضغط «طلب حافظة الكمبيوتر» أو انسخ هناك",
    copyPhone: "نسخ إلى حافظة الهاتف",
  },
  hand: {
    title: "أكمل من حيث توقفت",
    shared: "وارد من زر المشاركة",
    openPc: "افتح على الكمبيوتر",
    notUrl: "المشاركة ليست رابطًا — التسليم يقبل http/https فقط",
    urlHint: "https://…",
    titleHint: "عنوان اختياري (يظهر على الكمبيوتر)",
    count: "تسليمات: {n}",
    send: "تسليم إلى الكمبيوتر",
    explain: "سيظهر الرابط في شريط «أكمل من حيث توقفت» فوق سطح كمبيوتر السيرفر، وزر «افتح هنا» يفتحه ثم يزيله.",
  },
}

const rctlEn = {
  desktop: "Desktop",
  power: "Power",
  offline: "Control bridge offline — connect to the server first",
  tab: { pad: "Touchpad", kbd: "Keyboard", air: "Air Mouse", sys: "System", clip: "Clipboard", hand: "Handoff" },
  pad: {
    title: "Touchpad — move the computer cursor",
    tap: "Left click", dbl: "Double click", drag: "Drag mode active",
    left: "Left click", right: "Right click",
    speed: "Speed", dragk: "Drag",
    hint: "Drag to move · double-tap · long-press to drag · two fingers to scroll/pinch",
  },
  kbd: {
    title: "Wireless keyboard (Arabic/English)",
    hint: "Type here — keystrokes go straight to the computer",
    live: "{n} keystrokes sent",
    sp: {
      enter: "Enter", space: "Space", backspace: "Backspace", tab: "Tab", esc: "Esc",
      up: "Up", down: "Down", left: "Left", right: "Right",
    },
  },
  air: {
    title: "Air Mouse — phone gyroscope",
    on: "Air mouse active — move your phone to steer the cursor",
    off: "Air mouse off",
    gesture: "Activation gesture: 3 quick taps ({n})",
    gyro: "Gyroscope",
    moves: "Moves sent: {n}",
  },
  sys: {
    media: "Media control on the computer",
    vol: "Volume level",
    power: "Power commands",
    confirm: "Confirm system command",
    confirmBody: "This will run «{a}» on the computer — are you sure?",
    rejected: "Bridge rejected the last command ({r}) — is the PC off?",
    wol: "Wake-on-LAN — registered MAC",
    macEmpty: "No MAC yet — arrives automatically when the PC is ready",
    wake: "Send the magic packet",
    act: {
      lock: "Lock", sleep: "Sleep", hibernate: "Hibernate", restart: "Restart", shutdown: "Shut down",
    },
  },
  clip: {
    title: "Unified clipboard — phone ↔ computer",
    count: "Pushes: {n}",
    watch: "Watch phone clipboard",
    watchSub: "Polls every 1.5s while this screen is open (Android 10+ limit)",
    auto: "Auto-send on copy",
    autoSub: "Or use the manual send button below",
    send: "Send clipboard now",
    pull: "Request PC clipboard",
    fromPc: "Latest text from the computer",
    empty: "Nothing yet — press «Request PC clipboard» or copy there",
    copyPhone: "Copy to phone clipboard",
  },
  hand: {
    title: "Continue where you left off",
    shared: "Received from the share button",
    openPc: "Open on the computer",
    notUrl: "Shared text is not a URL — handoff accepts http/https only",
    urlHint: "https://…",
    titleHint: "Optional title (shown on the computer)",
    count: "Handoffs: {n}",
    send: "Hand off to the computer",
    explain: "The link appears in the «Continue where you left off» bar above the server desktop; the «Open here» button opens then removes it.",
  },
}

for (const [path, block] of [[AR, rctlAr], [EN, rctlEn]]) {
  const j = JSON.parse(readFileSync(path, "utf8"))
  j.rctl = block
  j.nav = { ...(j.nav || {}), control: path === AR ? "التحكم" : "Control" }
  if (!j.common || !j.common.cancel) {
    j.common = { ...(j.common || {}), ...(path === AR ? { cancel: "إلغاء", ok: "تأكيد" } : { cancel: "Cancel", ok: "OK" }) }
  }
  writeFileSync(path, JSON.stringify(j, null, 2) + "\n")
  console.log(path, "→ rctl keys:", Object.keys(block).length, "· nav.control added · common:", Object.keys(j.common).length)
}
