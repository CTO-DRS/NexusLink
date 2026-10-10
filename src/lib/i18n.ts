"use client"
/**
 * NexusLink i18n engine — المرحلة 11
 * -------------------------------------------------------------
 * المبدأ: النص العربي هو المفتاح المصدر (single source of truth).
 * - المكونات الجديدة تستدعي t("نص") فتُترجم فوريًا إلى الإنجليزية.
 * - الشاشات القديمة (المكتوبة بعربية ثابتة) تُترجم عبر ماسح DOM
 *   يعمل في وضع EN فقط: يبدّل عُقد النصوص والسمات من القاموس.
 * - القاموس مولّد في src/lib/ar-en-map.json (سكربت build-time).
 */
import { create } from "zustand"
import RAW_MAP from "./ar-en-map.json"

export type Lang = "ar" | "en"

const MAP = RAW_MAP as Record<string, string>

/* ---------- dictionary normalization ---------- */
interface PatternEntry {
  re: RegExp
  tpl: string
}
const exact = new Map<string, string>()
const patterns: PatternEntry[] = []

function esc(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

const rePlaceholder = /\$\{[^}]*\}/g

for (const [ar, en] of Object.entries(MAP)) {
  if (!en || !en.trim()) continue
  if (ar.includes("${")) {
    // align ${var} placeholders positionally between source & target:
    // pattern: escaped segments joined by (.+?) ; template: EN segments joined by $i
    const arSegs = ar.split(rePlaceholder)
    const enSegs = en.split(rePlaceholder)
    const reSrc = arSegs.map((s, i) => (i < arSegs.length - 1 ? esc(s) + "(.+?)" : esc(s))).join("")
    const tpl = enSegs.map((s, i) => (i < enSegs.length - 1 ? s + `$${i + 1}` : s)).join("")
    try {
      patterns.push({ re: new RegExp(`^${reSrc}$`), tpl })
    } catch {
      /* ignore malformed */
    }
  } else {
    exact.set(ar, en)
  }
}
patterns.sort((a, b) => b.re.source.length - a.re.source.length)

/* ---------- translation core ---------- */
export function translateText(input: string): string {
  if (!input || !/[\u0600-\u06FF]/.test(input)) return input
  const e = exact.get(input)
  if (e) return e
  for (const p of patterns) {
    const m = p.re.exec(input)
    if (m) {
      let out = p.tpl
      for (let i = m.length - 1; i >= 1; i--) out = out.split(`$${i}`).join(m[i] ?? "")
      return out
    }
  }
  return input
}

/* ---------- language store ---------- */
let currentLang: Lang = "ar"

interface I18nState {
  lang: Lang
  t: (ar: string) => string
  setLang: (l: Lang) => void
}

export const useI18n = create<I18nState>((set, get) => ({
  lang: "ar",
  t: (ar) => (get().lang === "ar" ? ar : translateText(ar)),
  setLang: (l) => {
    currentLang = l
    set({ lang: l })
    try {
      localStorage.setItem("nexus-lang", l)
    } catch {
      /* ignore */
    }
    const html = document.documentElement
    html.lang = l
    html.dir = l === "ar" ? "rtl" : "ltr"
    html.dataset.i18nReady = "1"
    if (l === "en") {
      // remount of React tree happens via page key; sweep after paint
      requestAnimationFrame(() => sweepDom())
      ensureSweepObserver()
    } else {
      stopSweepObserver()
    }
  },
}))

/** reads saved language (call once on app mount) */
export function initLang(): Lang {
  let l: Lang = "ar"
  try {
    const saved = localStorage.getItem("nexus-lang")
    if (saved === "en" || saved === "ar") l = saved
  } catch {
    /* ignore */
  }
  currentLang = l
  useI18n.setState({ lang: l })
  const html = document.documentElement
  html.lang = l
  html.dir = l === "ar" ? "rtl" : "ltr"
  if (l === "en") {
    requestAnimationFrame(() => sweepDom())
    ensureSweepObserver()
  }
  return l
}

export function getCurrentLang(): Lang {
  return currentLang
}

export function isRTL(): boolean {
  return currentLang === "ar"
}

/* ---------- DOM sweeper (legacy views, EN mode only) ---------- */
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
  if (currentLang !== "en") return
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
    if (sweeping || currentLang !== "en") return
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
  const msg = currentLang === "en" ? translateText(message) : message
  el.textContent = ""
  setTimeout(() => {
    if (el) el.textContent = msg
  }, 30)
}

/* ---------- formatting helpers (locale-aware) ---------- */
export function fmtDateLang(ms: number): string {
  if (!ms) return "—"
  try {
    return new Intl.DateTimeFormat(currentLang === "en" ? "en" : "ar", {
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
  return currentLang === "en" ? "/s" : "/ث"
}
