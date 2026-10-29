import { NextResponse } from "next/server"
import { readEnterprisePolicy, isValidSemver, semverGte } from "@/lib/enterprise-policy"

// /api/version — الإصدار + سجل الإصدارات الحقيقي (عقد §16 بند 2 + §23).
// ============================================================
// الإصدار موحّد 3.1.0 عبر كل المنصات (tauri.conf.json/Cargo.toml/pubspec/package.json
// — أول minor بعد ختم M4: عقود ما بعد الوسم §41–§49 من TLS الذاتي إلى المرحّل
// الذاتي فوق 3.0.0 — إيقاع minor المعتمد في ROADMAP).
// سجل الإصدارات = GitHub Releases للمستودع العام (كاش 10 دقائق) — بلا
// مفاتيح API — مُتحداً مع التاريخ المحلي (البعيد يفوز عند التعارض) وفشل الجلب
// (أوفلاين/معدل) يعيد قائمة من الإصدار المحلي وحده.
const CURRENT = "3.1.0"
const RELEASES_API = "https://api.github.com/repos/CTO-DRS/NexusLink/releases?per_page=12"

type HistoryEntry = { version: string; tag: string; date: string; items: string[] }

let cache: { at: number; history: HistoryEntry[] } | null = null
const CACHE_MS = 10 * 60 * 1000

function localHistory(): HistoryEntry[] {
  return [
    {
      version: CURRENT,
      tag: "v3.1.0",
      date: "2026-10-29",
      items: [
        "عقد §49 — المرحّل الذاتي: وصول عبر الإنترنت عبر مرحّل تملكه حصرًا (صفر تبعيات صفر تخزين) — إغلاق آخر ثغرة في وعد «بلا سحابة»",
        "عقد §48 — وضع الطوارئ الذكي: القتل النهائي بيد المالك حصرًا (PIN زمن-ثابت + كلمة «اقتل») + قائمة دائمة تواجه العودة + تصعيد ذاتي محلي",
        "عقد §47 — إدارة الأسطول: مخطط السياسة v2 بتوافق رجعي + مولّد تقارير الامتثال (JSON+PDF محلي صفر-اعتماد) + حزم MDM الثلاث",
        "عقد §46 — المساعدة عن بعد برمز قصير: اقتران بلا مسح QR (رمز ستّي حتمي) بموافقة صريحة من المالك وقطع بضغطة",
        "عقود §43–§45 — سلسلة الثقة النائمة (توقيع ويندوز/notarization آلي عند الأسرار) + تعبئة Flathub الجاهزة للمراجعة + الازدواجية الصادقة للترخيص",
        "عقد §42 — إكمال اللغات: المعاجم الأربع كاملة بلا بقايا عربية والحارس يفرض التطابق آليًا (أساس هذا الإصدار 3,725×5)",
        "عقد §41 — النقل المشفر الذاتي: TLS/WSS في البوابة OFF بالتصميم بفشل-مغلق إقلاعي (نصف متغيري الشهادة يرفض الإقلاع)",
        "إصلاحان من بوابة الإصدار: قناع الطابع الزمني الحي (>>> 0 — قنبلة موقّتة بنوافذ Int32) وسجل الإصدارات اتحاد المحلي والبعيد",
        "أساس E2E: 1080 → 1316 فحصًا (ست بوابات عقود جديدة + انحدارات كاملة مرتين متتاليتين)",
      ],
    },
    {
      version: "3.0.0",
      tag: "v3.0.0",
      date: "2026-10-22",
      items: [
        "الثقل المؤسسي M4 كاملًا — ثلاثة عقود فوق 2.0.0: §38 النشر المؤسسي · §39 أدلة شهادات الثقة · §40 وضع OEM «خصوصية افتراضية»",
        "سياسات مركزية بفرض لحظي: مخطط v1 (remoteAccess force-on/off + blockedBridges) + تقرير امتثال حلقي ببصمة sha256 + MDM kit — الجهاز «قابل للإدارة»",
        "سجل تدقيقي مؤسسي: JSONL إلحاقي بسلسلة بصمات (كشف تعديل رجعي) + كاتب واحد + fsync + تجميد فوق دليل مكسور + عرض حلقي — الجهاز «مولد أدلة»",
        "وضع OEM «خصوصية افتراضية»: علم NEXUSLINK_OEM_PRIVACY=1 يولد الجهاز مولودًا خاصًا — الخارج مرفوض ولو برمز صحيح + فشل-مغلق + التخفيف بسياسة MDM حصرًا",
        "فحوص حية: enterprise-e2e ‏26×2 + audit-e2e ‏20×2 + oem-e2e ‏39×2 مرتين متتاليتين — بلا انحدار على أساس 1080",
        "قبول M4 المؤسسي (نشر فعلي/مدقق SOC 2/عقد OEM/النفق) يبقى خارجيًا بقرار المالك — النوى المحلية مكتملة كلها",
      ],
    },
    {
      version: "2.0.0",
      tag: "v2.0.0",
      date: "2026-10-21",
      items: [
        "الذكاء المحلي كاملًا: بحث موحد عبر 8 مخازن + مساعد على الجهاز (حتمي + LLM محلي اختياري بحرس 127.0.0.1) + رؤى 14 يومًا",
        "المنظومة المفتوحة: SDK 2.0 صفر-اعتماد + واجهات REST عامة + سوق 10 تكاملات موقعة + CLI 16 أمرًا",
        "عمق ما بعد M3: قناة الناشر المركزية بتوقيع ثنائي + الفرض اللحظي للقدرات + التنبؤ الاستباقي الحتمي",
        "العميل الوِب المستقل: PWA قابل للتثبيت ووضع TV — صفر بايت خارجي مفحوص فوق الأسطح الثمانية",
        "الوصول البعيد برمز اقتران: حسم زمن-ثابت + حجب تجريبي + إدارة loopback — البوابة OFF افتراضيًا",
        "إدارة وحسم وقراءة عبر API: /api/remote-access (تمكين/تدوير/تعطيل) و/api/predictions و/api/pair-metrics — بيانات وصفية حرس F6 متوافق",
      ],
    },
    {
      version: "1.2.0",
      tag: "v1.2.0",
      date: "2026-10-19",
      items: [
        "الروتينات الذكية × مشغّلات الصحة التاريخية: «نبّهني إذا كانت بطارية X تحت 15% لمدة ساعة»",
        "11 مشغّلًا: 7 لحظية (منها بلوغ الشحن 80%) + 4 تاريخية (بطارية/استجابة/صمت/تخزين) بمقيّم سلسلة دليل",
        "نبض خدمة ذاتي من الخادم كل 4 ثوانٍ — التاريخ يتولد والروتينات تعمل حتى بلا واجهة مفتوحة",
        "قواعد دائمة تُستعاد حرفيًا بعد إعادة التشغيل + تنبيهات «لم تُرَ» تنتظر ملخص العودة",
        "«فحص التاريخ الآن» من المحرر: حكم فوري بالسبب ورقائق الدليل بلا أي أثر",
        "التحكم بهاتفك من هاتفك الآخر + مركز فك الحجب في تطبيق الهاتف",
      ],
    },
    {
      version: "1.1.0",
      tag: "v1.1.0",
      date: "2026-10-15",
      items: [
        "قناة NexusLive الحية فوق UDP — إدخال حي P95=13ms قلمًا وP50=8ms بثًا 60Hz",
        "الهاتف شاشة ثانية فعلية (سائق موقّع على ويندوز + xrandr على لينكس)",
        "لوحة رسم احترافية: التقاط 240Hz + ضغط→فرشاة + لوحة uinput أصلية على لينكس",
        "ثلاثية التحكم المتقدم: جيمباد حساسات 100Hz + ماوس هوائي معاير + عارض عروض",
        "«NexusLink Camera» بلا خطوات يدوية + ميكروفون افتراضي + مشغل النظام + هاتف→TV (/tv)",
        "ملاحظات إصدار عربية/إنجليزية + مسار ترقية موقّع 1.0.0→1.1.0 يحفظ كل الإعدادات",
      ],
    },
    {
      version: "1.0.0",
      tag: "v1.0.0",
      date: "2026-10-12",
      items: [
        "تطبيق سطح المكتب (Tauri 2) بكل الطبقات الأصلية: بث شاشة WebRTC، حافظة نظام، طاقة، تحكم لمسي، ملفات، وسائط افتراضية",
        "صلّب الإصدار: قفل التطبيق (PIN + Windows Hello/Touch ID) + قفل الخمول",
        "محدّث موقّع (minisign) + سجل إصدارات",
        "سجل تدقيق أصلي موحّد (نفس SQLite) + تحسين الخمول + تشخيص فعلي",
      ],
    },
  ]
}

async function fetchHistory(): Promise<HistoryEntry[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.history
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 4000)
    const r = await fetch(RELEASES_API, {
      signal: ctrl.signal,
      cache: "no-store",
      headers: { "User-Agent": "NexusLink-Server/2.0.0", Accept: "application/vnd.github+json" },
    })
    clearTimeout(timer)
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const arr = (await r.json()) as Array<{
      tag_name?: string
      name?: string
      body?: string
      published_at?: string
      draft?: boolean
    }>
    const history: HistoryEntry[] = arr
      .filter((rel) => !rel.draft)
      .slice(0, 12)
      .map((rel) => ({
        version: (rel.tag_name ?? "").replace(/^v/, ""),
        tag: rel.tag_name ?? "",
        date: (rel.published_at ?? "").slice(0, 10),
        // body = ملاحظات الإصدار — مقسمة أسطرًا (الواجهة تعرضها قائمة)
        items: (rel.body ?? "")
          .split(/\r?\n/)
          .map((l) => l.replace(/^[-*#\s]+/, "").trim())
          .filter(Boolean)
          .slice(0, 10),
      }))
      // الجولات الفاشلة المحفوظة (v2.0.0-fix1/fix2) نُشرت بلا ملاحظات — عقد العرض:
      // لا قائمة ملاحظات فارغة في السجل (كل مدخل يُعرض بملاحظات غير فارغة ≤10)
      .filter((h) => h.version && h.items.length > 0)
    // اتحاد المحلي والبعيد (البعيد يفوز حرفيًا عند التعارض ثم ترتيب تاريخ تنازلي):
    // البعيد يحمل ملاحظات المنشور الحي، والمحلي يضمن التاريخ الغني (1.0→…→الحالي)
    // حتى والإصدارات القديمة غير منشورة — فلا يعود الواصل للشبكة بسجل أفقر من
    // الأوفلاين (إصلاح عقد العرض §16/§23 الذي كشفه فحص «تاريخ ترقية حقيقي ≥3»)
    const local = localHistory()
    const seen = new Set(history.map((h) => h.version))
    for (const h of local) {
      if (!seen.has(h.version)) {
        history.push(h)
        seen.add(h.version)
      }
    }
    history.sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1))
    cache = { at: Date.now(), history }
    return history
  } catch {
    // أوفلاين/محدود المعدل — لا نُخزّن الفشل؛ الإصدار المحلي يكفي بصدق
    return localHistory()
  }
}

export async function GET() {
  const history = await fetchHistory()
  const latest = history[0]?.version ?? CURRENT
  // §47 — ختم الإصدار الأدنى المؤسسي (إعلان لا حجب — الحد 47.و.3):
  // managed.minimumVersion من ملف السياسة v2 يُعلن هنا وفي الامتثال
  // والتقرير — الجهاز تحت الأرضية يُعلَن صاخبًا ولا يُرفض اتصاله.
  const pol = readEnterprisePolicy()
  const minimumVersion = pol.state === "managed" ? pol.minimumVersion : null
  const belowMinimum =
    minimumVersion !== null && isValidSemver(CURRENT) ? !semverGte(CURRENT, minimumVersion) : false
  return NextResponse.json(
    {
      current: CURRENT,
      latest,
      channel: "stable",
      updatedAt: history[0]?.date ?? "",
      portable: true,
      signature: "minisign (Ed25519) — tauri-plugin-updater",
      changelog: history,
      policy: { minimumVersion, belowMinimum },
      t: Date.now(),
    },
    { headers: { "Cache-Control": "no-store" } },
  )
}
