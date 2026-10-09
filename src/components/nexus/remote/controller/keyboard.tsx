"use client"
// لوحة المفاتيح اللاسلكية — عربية/إنجليزية تكتب مباشرة في المفكرة على الكمبيوتر
import { useState } from "react"
import { Delete, CornerDownLeft, Languages, Keyboard as KbIcon } from "lucide-react"
import { rcKey } from "@/lib/remote-socket"

const AR_ROWS = [
  ["ض", "ص", "ق", "ث", "غ", "ة", "خ", "ح", "ج", "د"],
  ["ش", "س", "ي", "ب", "ل", "ا", "ت", "ن", "م", "ك", "ط"],
  ["ئ", "ء", "ؤ", "ر", "لا", "ى", "ة", "و", "ز", "ظ"],
]
const EN_ROWS = [
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
  ["z", "x", "c", "v", "b", "n", "m"],
]
const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"]
const SYMS = ["-", "/", ":", "؛", "!", "؟", ".", "،", "@", "#"]
const QUICK = ["مرحباً 👋", "تمام 👍", "شكراً لك", "أوكي أراك لاحقاً", "نexus@localhost"]

export function KeyboardMode() {
  const [lang, setLang] = useState<"ar" | "en">("ar")
  const [pressed, setPressed] = useState<string | null>(null)

  function hit(id: string, fn: () => void) {
    setPressed(id)
    setTimeout(() => setPressed(null), 130)
    try { navigator.vibrate?.(8) } catch { /* ignore */ }
    fn()
  }

  const [shift, setShift] = useState(false)
  const rows = lang === "ar" ? AR_ROWS : EN_ROWS
  const key = (ch: string) =>
    hit(`k-${ch}`, () => rcKey({ ch: lang === "en" && shift ? ch.toUpperCase() : ch }))

  function KeyBtn({ k, wide = false, cls = "" }: { k: string; wide?: boolean; cls?: string }) {
    return (
      <button
        onClick={() => key(k)}
        className={`h-9 rounded-lg border bg-card text-[12.5px] font-semibold hover:bg-accent active:scale-90 transition-all ${wide ? "px-2.5" : ""} ${
          pressed === `k-${k}` ? "bg-primary text-primary-foreground border-primary scale-95" : ""
        } ${cls}`}
        dir="ltr"
      >
        {lang === "en" && shift ? k.toUpperCase() : k}
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-2 h-full min-h-0">
      <div className="flex items-center gap-2 text-[10.5px] text-muted-foreground">
        <KbIcon className="w-3.5 h-3.5 text-primary shrink-0" />
        <span>الكتابة تذهب فوراً إلى <b className="text-foreground">المفكرة</b> على الكمبيوتر (المسافة تقلّب الشرائح في العرض، والمسافة تشغّل الوسائط)</span>
      </div>

      {/* عبارات جاهزة */}
      <div className="flex gap-1.5 overflow-x-auto nexus-scroll pb-0.5">
        {QUICK.map((q) => (
          <button
            key={q}
            onClick={() => hit(`q-${q}`, () => rcKey({ ch: q + " " }))}
            className="shrink-0 rounded-full border bg-card px-2.5 py-1 text-[10px] font-medium hover:bg-accent active:scale-95 transition-all"
          >
            {q}
          </button>
        ))}
      </div>

      {/* أرقام ورموز */}
      <div className="flex gap-1 justify-center">
        {DIGITS.map((d) => <KeyBtn key={d} k={d} cls="flex-1 min-w-0" />)}
      </div>
      <div className="flex gap-1 justify-center">
        {SYMS.map((s) => <KeyBtn key={s} k={s} cls="flex-1 min-w-0 text-[11px]" />)}
      </div>

      {/* صفوف الحروف */}
      <div className="space-y-1">
        {rows.map((row, i) => (
          <div key={i} className="flex gap-1 justify-center px-0.5">
            {row.map((ch) => <KeyBtn key={ch} k={ch} cls="flex-1 min-w-0" />)}
          </div>
        ))}
      </div>

      {/* الصف السفلي */}
      <div className="flex gap-1.5">
        <button
          onClick={() => hit("lang", () => setLang((l) => (l === "ar" ? "en" : "ar")))}
          className={`h-9 px-3 rounded-lg border text-[11px] font-bold flex items-center gap-1 transition-all ${
            pressed === "lang" ? "bg-primary text-primary-foreground scale-95" : "bg-card hover:bg-accent"
          }`}
        >
          <Languages className="w-3.5 h-3.5" /> {lang === "ar" ? "عربي" : "EN"}
        </button>
        <button
          onClick={() => hit("shift", () => setShift((s) => !s))}
          className={`h-9 px-3 rounded-lg border text-[12px] font-bold transition-all ${
            shift ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-accent"
          } ${pressed === "shift" ? "scale-95" : ""}`}
        >
          ⇧
        </button>
        <button
          onClick={() => hit("space", () => rcKey({ special: "space" }))}
          className={`h-9 flex-1 rounded-lg border bg-card text-[11px] font-semibold hover:bg-accent active:scale-95 transition-all ${
            pressed === "space" ? "bg-primary text-primary-foreground scale-95" : ""
          }`}
        >
          مسافة
        </button>
        <button
          onClick={() => hit("bs", () => rcKey({ special: "backspace" }))}
          className={`h-9 px-3 rounded-lg border bg-card hover:bg-accent active:scale-90 transition-all flex items-center ${
            pressed === "bs" ? "bg-red-500 text-white border-red-500 scale-95" : ""
          }`}
          aria-label="مسح حرف"
        >
          <Delete className="w-4 h-4" />
        </button>
        <button
          onClick={() => hit("enter", () => rcKey({ special: "enter" }))}
          className={`h-9 px-3 rounded-lg border text-[12px] font-bold flex items-center transition-all ${
            pressed === "enter" ? "bg-emerald-500 text-white border-emerald-500 scale-95" : "bg-card hover:bg-accent"
          }`}
          aria-label="سطر جديد"
        >
          <CornerDownLeft className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
