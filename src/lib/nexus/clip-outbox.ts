// NexusLink — صندوق صادر الحافظة المشفرة (M1.2 offline-first — عقد §28)
// ============================================================
// الطريق الآمن لاستكمال ما فاته الهاتف وهو منقطع: القناة E2EE (3009) بعصورها
// الرجيعية لا تسمح بإعادة تشغيل إطارات قديمة (مفاتيح العصر مُمحاة عند العودة
// بتصميم PFS) — فالإعادة الصحيحة من **المرسل نفسه**: ما فشل تسليمه يُخزَّن
// هنا محليًا (نص حصرًا، سقف 20) ويُدفع فور اكتمال مصافحة جديدة (عصر حي).
// وحدة صرفة بلا React ولا socket — تخزين قابل للتوصيل (localStorage في العميل).
const CAP = 20
const LS_KEY = "nl-sec-clip-outbox"

interface Store {
  get(): string[]
  set(v: string[]): void
}

function lsStore(): Store | null {
  try {
    if (typeof localStorage === "undefined") return null
    return {
      get: () => {
        try {
          const raw = localStorage.getItem(LS_KEY)
          const arr = raw ? (JSON.parse(raw) as unknown) : []
          return Array.isArray(arr) ? (arr as string[]).filter((x) => typeof x === "string") : []
        } catch {
          return []
        }
      },
      set: (v) => {
        try {
          localStorage.setItem(LS_KEY, JSON.stringify(v))
        } catch { /* ignore */ }
      },
    }
  } catch {
    return null
  }
}

/** بديل الذاكرة (بيئة بلا localStorage — اختبارات/SSR) */
const mem: string[] = []

function store(): Store {
  return lsStore() ?? {
    get: () => [...mem],
    set: (v) => {
      mem.length = 0
      mem.push(...v)
    },
  }
}

/** حجم الصندوق الحالي (تشخيص/فحوص) */
export function clipOutboxSize(): number {
  return store().get().length
}

/** إدراج نص فشل تسليمه — إزالة تكرار للمتتالي المطابق + سقف 20 (الأقدم يُترك والأحدث يدخل) */
export function enqueueClipOutbox(text: string): number {
  const t = String(text ?? "")
  if (!t) return 0
  const s = store()
  const q = s.get()
  if (q.length && q[q.length - 1] === t) return q.length // نفس النص متتاليًا = لا تكرار
  q.push(t)
  while (q.length > CAP) q.shift()
  s.set(q)
  return q.length
}

/** تصريف الصندوق بالترتيب عند جاهزية القناة — فاشل التسليم يبقى بمكانه (ترتيب محفوظ) */
export async function flushClipOutbox(send: (text: string) => Promise<boolean>): Promise<number> {
  const s = store()
  const q = s.get()
  if (!q.length) return 0
  const remaining: string[] = []
  let sent = 0
  for (const t of q) {
    let ok = false
    try {
      ok = await send(t)
    } catch {
      ok = false
    }
    if (ok) sent++
    else remaining.push(t)
  }
  if (remaining.length !== q.length) s.set(remaining)
  return sent
}

/** تفريغ صريح (اختبارات/محو بيانات) */
export function clearClipOutbox(): void {
  store().set([])
}
