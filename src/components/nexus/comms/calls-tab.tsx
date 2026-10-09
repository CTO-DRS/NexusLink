"use client"
// الهاتف — لوحة الاتصال من الكمبيوتر (سماعة الكمبيوتر كمكبر)
import { useState } from "react"
import { useComms } from "@/lib/comms-store"
import { dial } from "./dialer"
import { CallLogList } from "./call-log-list"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Delete, Phone, Keyboard } from "lucide-react"

const KEYS = [
  ["1", ""], ["2", "ABC"], ["3", "DEF"],
  ["4", "GHI"], ["5", "JKL"], ["6", "MNO"],
  ["7", "PQRS"], ["8", "TUV"], ["9", "WXYZ"],
  ["*", ""], ["0", "+"], ["#", ""],
] as const

export function CallsTab() {
  const [number, setNumber] = useState("")
  const liveCall = useComms((s) => s.liveCall)
  const contacts = useComms((s) => s.contacts)

  // البحث عن اسم جهة الاتصال
  const match = contacts.find((c) => c.phone === number)
  const display = number || ""

  const press = (k: string) => setNumber((n) => (n.length < 16 ? n + k : n))

  return (
    <div className="grid md:grid-cols-[minmax(0,380px)_1fr] gap-4 items-start">
      {/* لوحة الاتصال */}
      <div className="rounded-2xl border bg-card p-4 space-y-4">
        <div className="flex items-center gap-2 text-[13px] font-semibold">
          <Keyboard className="w-4 h-4 text-primary" /> الاتصال من الكمبيوتر
        </div>

        <div className="text-center py-2 min-h-16">
          {match ? (
            <div className="space-y-0.5">
              <div className="text-[15px] font-bold">{match.name}</div>
              <div className="text-[12px] text-muted-foreground" dir="ltr">{number}</div>
            </div>
          ) : (
            <div className="text-2xl font-bold tracking-wider min-h-8" dir="ltr">{display || <span className="text-muted-foreground/40 text-lg">أدخل الرقم</span>}</div>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2">
          {KEYS.map(([k, sub]) => (
            <button
              key={k}
              onClick={() => press(k)}
              className="rounded-2xl border bg-background hover:bg-accent active:scale-95 transition-all py-2.5 text-center"
            >
              <div className="text-xl font-bold leading-none">{k}</div>
              {sub && <div className="text-[8px] text-muted-foreground tracking-widest mt-0.5">{sub}</div>}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Button
            className="flex-1 h-12 rounded-2xl gap-2 text-[14px] bg-emerald-600 hover:bg-emerald-700"
            disabled={!number.trim() || !!liveCall}
            onClick={() => dial(number, match?.name)}
          >
            <Phone className="w-4.5 h-4.5" /> اتصال
          </Button>
          <Button variant="outline" size="icon" className="h-12 w-12 rounded-2xl" onClick={() => setNumber((n) => n.slice(0, -1))} aria-label="حذف رقم">
            <Delete className="w-4.5 h-4.5" />
          </Button>
        </div>

        <div className="rounded-xl bg-muted/60 px-3 py-2 text-[11px] text-muted-foreground leading-relaxed">
          يتم الاتصال عبر هاتفك المتصل، ويُبث صوت المكالمة عبر سماعات الكمبيوتر — استخدم النافذة المنبثقة للتحكم (كتم/مكبر/إنهاء).
        </div>
      </div>

      {/* أحدث المكالمات */}
      <div className="rounded-2xl border bg-card p-3">
        <CallLogList compact />
      </div>
    </div>
  )
}
