"use client"
/**
 * NexusLink i18n engine — المرحلة 11 + M1.4 (اللغات الست — عقد §31)
 * -------------------------------------------------------------
 * المبدأ: النص العربي هو المفتاح المصدر (single source of truth).
 * - اللغات الست (عقد §31.أ): ar (rtl) · en · fr · es · de · ru (كلها ltr).
 * - سلسلة السقوط التعاقدية: map(lang) → map(en) → النص العربي الخام —
 *   أي سلسلة غير مُترجَمة تظهر بالإنجليزية لا بالعربية.
 * - ar بلا معجم (المفاتيح نفسها) · en معجم ثابت (سقوط الجميع) ·
 *   fr/es/de/ru تحميل كسول import() — الحزمة الأساسية لا تتضخم.
 * - الماسح (الشاشات القديمة) يعمل في كل اللغات غير العربية (كان en حصرًا).
 * - html.dataset.i18nReady لا يُختم إلا بعد جاهزية معجم اللغة الجارية —
 *   إشارة مزامن لفحوص E2E (عقد §31.أ).
 */
import { create } from "zustand"
import RAW_MAP from "./ar-en-map.json"

export type Lang = "ar" | "en" | "fr" | "es" | "de" | "ru"

export interface LangMeta {
  code: Lang
  native: string
  dir: "rtl" | "ltr"
  locale: string
  speedUnit: string
}

/** سجل اللغات المعاقد (عقد §31.أ) */
export const LANGS: LangMeta[] = [
  { code: "ar", native: "العربية", dir: "rtl", locale: "ar", speedUnit: "/ث" },
  { code: "en", native: "English", dir: "ltr", locale: "en", speedUnit: "/s" },
  { code: "fr", native: "Français", dir: "ltr", locale: "fr", speedUnit: "/s" },
  { code: "es", native: "Español", dir: "ltr", locale: "es", speedUnit: "/s" },
  { code: "de", native: "Deutsch", dir: "ltr", locale: "de", speedUnit: "/s" },
  { code: "ru", native: "Русский", dir: "ltr", locale: "ru", speedUnit: "/с" },
]

export function isLang(v: string | null | undefined): v is Lang {
  return !!v && LANGS.some((l) => l.code === v)
}

export function langMeta(l: Lang): LangMeta {
  return LANGS.find((x) => x.code === l) ?? LANGS[0]
}

/* ---------- dictionary normalization (per-language, lazy) ---------- */
interface PatternEntry {
  re: RegExp
  tpl: string
}
interface Dict {
  exact: Map<string, string>
  patterns: PatternEntry[]
}

function esc(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

const rePlaceholder = /\$\{[^}]*\}/g

function buildDict(raw: Record<string, string>): Dict {
  const exact = new Map<string, string>()
  const patterns: PatternEntry[] = []
  for (const [ar, target] of Object.entries(raw)) {
    if (!target || !target.trim()) continue
    if (ar.includes("${")) {
      const arSegs = ar.split(rePlaceholder)
      const tSegs = target.split(rePlaceholder)
      const reSrc = arSegs.map((s, i) => (i < arSegs.length - 1 ? esc(s) + "(.+?)" : esc(s))).join("")
      const tpl = tSegs.map((s, i) => (i < tSegs.length - 1 ? s + `$${i + 1}` : s)).join("")
      try {
        patterns.push({ re: new RegExp(`^${reSrc}$`), tpl })
      } catch {
        /* ignore malformed */
      }
    } else {
      exact.set(ar, target)
    }
  }
  patterns.sort((a, b) => b.re.source.length - a.re.source.length)
  return { exact, patterns }
}

const EN_DICT = buildDict(RAW_MAP as Record<string, string>)

/* loaded non-ar/non-en dicts (عقد §31.أ — تحميل كسول) */
const DICTS: Partial<Record<Lang, Dict | "loading">> = { en: EN_DICT }
let dictWaiters: Array<() => void> = []

async function loadMap(lang: Lang): Promise<Record<string, string> | null> {
  switch (lang) {
    case "fr":
      return ((await import("./i18n/fr.json")).default ?? null) as Record<string, string> | null
    case "es":
      return ((await import("./i18n/es.json")).default ?? null) as Record<string, string> | null
    case "de":
      return ((await import("./i18n/de.json")).default ?? null) as Record<string, string> | null
    case "ru":
      return ((await import("./i18n/ru.json")).default ?? null) as Record<string, string> | null
    default:
      return null
  }
}

async function ensureDict(lang: Lang): Promise<Dict | null> {
  if (lang === "ar") return null
  const cur = DICTS[lang]
  if (cur && cur !== "loading") return cur
  if (cur === "loading") {
    await new Promise<void>((res) => dictWaiters.push(res))
    return (DICTS[lang] as Dict) ?? null
  }
  DICTS[lang] = "loading"
  try {
    const raw = await loadMap(lang)
    const d = raw ? buildDict(raw) : null
    DICTS[lang] = d ?? undefined
    return d
  } catch {
    DICTS[lang] = undefined
    return null
  } finally {
    const w = dictWaiters
    dictWaiters = []
    for (const fn of w) fn()
  }
}

/* ---------- translation core (سلسلة السقوط: lang → en → raw) ---------- */
function fromDict(d: Dict | null, input: string): string | null {
  if (!d) return null
  const e = d.exact.get(input)
  if (e) return e
  for (const p of d.patterns) {
    const m = p.re.exec(input)
    if (m) {
      let out = p.tpl
      for (let i = m.length - 1; i >= 1; i--) out = out.split(`$${i}`).join(m[i] ?? "")
      return out
    }
  }
  return null
}

export function translateTextTo(input: string, lang: Lang): string {
  if (!input || !/[\u0600-\u06FF]/.test(input)) return input
  if (lang === "ar") return input
  const cur = DICTS[lang]
  const hit = fromDict(cur && cur !== "loading" ? cur : null, input)
  if (hit !== null) return hit
  const en = fromDict(EN_DICT, input)
  if (en !== null) return en
  return input
}

export function translateText(input: string): string {
  return translateTextTo(input, currentLang)
}

/* ---------- language store ---------- */
let currentLang: Lang = "ar"

interface I18nState {
  lang: Lang
  /** يزداد عند اكتمال تحميل معجم اللغة — لإعادة الرسم بعد وصول المعجم */
  mapRev: number
  t: (ar: string) => string
  setLang: (l: Lang) => void
}

function applyHtmlAttrs(l: Lang) {
  const html = document.documentElement
  html.lang = l
  html.dir = langMeta(l).dir
}

export const useI18n = create<I18nState>((set, get) => ({
  lang: "ar",
  mapRev: 0,
  t: (ar) => translateTextTo(ar, get().lang),
  setLang: (l) => {
    currentLang = l
    set({ lang: l })
    try {
      localStorage.setItem("nexus-lang", l)
    } catch {
      /* ignore */
    }
    applyHtmlAttrs(l)
    document.documentElement.removeAttribute("data-i18n-ready")
    void (async () => {
      await ensureDict(l)
      applyHtmlAttrs(l)
      // إشارة الجاهزية بعد اكتمال المعجم (عقد §31.أ)
      document.documentElement.dataset.i18nReady = "1"
      if (l !== "ar") {
        // remount of React tree happens via page key; sweep after paint
        requestAnimationFrame(() => sweepDom())
        ensureSweepObserver()
      } else {
        stopSweepObserver()
      }
      set({ mapRev: get().mapRev + 1 })
    })()
  },
}))

/** الدورة الكاملة الست (عقد §31.أ): ar→en→fr→es→de→ru→ar */
export function cycleLang(): Lang {
  const i = LANGS.findIndex((x) => x.code === currentLang)
  const next = LANGS[(i + 1) % LANGS.length]
  useI18n.getState().setLang(next.code)
  return next.code
}

/** reads saved language (call once on app mount) */
export function initLang(): Lang {
  let l: Lang = "ar"
  try {
    const saved = localStorage.getItem("nexus-lang")
    if (isLang(saved)) l = saved
  } catch {
    /* ignore */
  }
  currentLang = l
  useI18n.setState({ lang: l })
  applyHtmlAttrs(l)
  void (async () => {
    await ensureDict(l)
    if (l !== "ar") {
      requestAnimationFrame(() => sweepDom())
      ensureSweepObserver()
    }
    document.documentElement.dataset.i18nReady = "1"
    useI18n.setState({ mapRev: useI18n.getState().mapRev + 1 })
  })()
  return l
}

export function getCurrentLang(): Lang {
  return currentLang
}

export function isRTL(): boolean {
  return currentLang === "ar"
}

/* ---------- DOM sweeper (legacy views, non-ar languages) ---------- */
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "CODE", "PRE", "KBD"])
const AR_RE = /[\u0600-\u06FF]/

function sweepTextNode(node: Text) {
  const data = node.data
  if (!AR_RE.test(data)) return
  const lead = /^\s*/.exec(data)?.[0] ?? ""
  const trail = /\s*$/.exec(data)?.[0] ?? ""
  const core = data.slice(lead.length, data.length - trail.length)
  if (!core) return
  const translated = translateText(core)
  if (translated !== core) node.data = lead + translated + trail
}

function sweepAttrs(root: ParentNode) {
  const els = root.querySelectorAll("[aria-label],[placeholder],[title]")
  for (const el of Array.from(els)) {
    for (const attr of ["aria-label", "placeholder", "title"]) {
      const v = el.getAttribute(attr)
      if (v && AR_RE.test(v)) {
        const t = translateText(v)
        if (t !== v) el.setAttribute(attr, t)
      }
    }
  }
}

export function sweepDom(root?: ParentNode) {
  if (currentLang === "ar") return
  const target = root ?? document.body
  if (!target) return
  sweeping = true
  try {
    sweepAttrs(target)
    const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT)
    let n = walker.nextNode()
    while (n) {
      const parent = (n as Text).parentElement
      if (!parent || !SKIP_TAGS.has(parent.tagName)) sweepTextNode(n as Text)
      n = walker.nextNode()
    }
  } finally {
    sweeping = false
  }
}

let observer: MutationObserver | null = null
let sweeping = false
let debounceTimer: ReturnType<typeof setTimeout> | null = null

function ensureSweepObserver() {
  if (observer || typeof document === "undefined") return
  observer = new MutationObserver((muts) => {
    if (sweeping || currentLang === "ar") return
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      if (document.hidden) return
      sweepDom()
    }, 140)
    void muts
  })
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
}

function stopSweepObserver() {
  observer?.disconnect()
  observer = null
}

/* ---------- screen-reader announcements ---------- */
export function announce(message: string) {
  if (typeof document === "undefined") return
  let el = document.getElementById("nexus-sr-live")
  if (!el) {
    el = document.createElement("div")
    el.id = "nexus-sr-live"
    el.className = "sr-only"
    el.setAttribute("aria-live", "assertive")
    el.setAttribute("role", "status")
    document.body.appendChild(el)
  }
  const msg = translateTextTo(message, currentLang)
  el.textContent = ""
  setTimeout(() => {
    if (el) el.textContent = msg
  }, 30)
}

/* ---------- formatting helpers (locale-aware) ---------- */
export function fmtDateLang(ms: number): string {
  if (!ms) return "—"
  try {
    return new Intl.DateTimeFormat(langMeta(currentLang).locale, {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(ms))
  } catch {
    return new Date(ms).toLocaleDateString()
  }
}

export function speedUnit(): string {
  return langMeta(currentLang).speedUnit
}
