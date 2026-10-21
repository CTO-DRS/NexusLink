import { NextResponse } from "next/server"

// /api/version — الإصدار + سجل الإصدارات الحقيقي (عقد §16 بند 2 + §23).
// ============================================================
// الإصدار موحّد 2.0.0 عبر كل المنصات (tauri.conf.json/Cargo.toml/pubspec/package.json
// — المنظومة المفتوحة SDK 2.0 + الذكاء المحلي + عمق ما بعد M3 والعميل الوِب والوصول البعيد
// اكتملت فوق 1.2.0 ووسم v2.0.0 هو إصدارها — ترقيم M3 المعتمد في ROADMAP).
// سجل الإصدارات = GitHub Releases للمستودع العام (كاش 10 دقائق) — بلا
// مفاتيح API، وفشل الجلب (أوفلاين/معدل) يعيد قائمة من الإصدار المحلي وحده.
const CURRENT = "2.0.0"
const RELEASES_API = "https://api.github.com/repos/CTO-DRS/NexusLink/releases?per_page=12"

type HistoryEntry = { version: string; tag: string; date: string; items: string[] }

let cache: { at: number; history: HistoryEntry[] } | null = null
const CACHE_MS = 10 * 60 * 1000

function localHistory(): HistoryEntry[] {
  return [
    {
      version: CURRENT,
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
      .filter((h) => h.version)
    if (!history.some((h) => h.version === CURRENT)) {
      history.push(...localHistory())
    }
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
  return NextResponse.json(
    {
      current: CURRENT,
      latest,
      channel: "stable",
      updatedAt: history[0]?.date ?? "",
      portable: true,
      signature: "minisign (Ed25519) — tauri-plugin-updater",
      changelog: history,
      t: Date.now(),
    },
    { headers: { "Cache-Control": "no-store" } },
  )
}
