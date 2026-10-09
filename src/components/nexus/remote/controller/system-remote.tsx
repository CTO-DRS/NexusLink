"use client"
// أوامر النظام من الهاتف — إيقاف، إعادة تشغيل، سكون، إسبات، قفل، وإيقاظ عبر Wake-on-LAN
import { useState } from "react"
import {
  Power, RotateCcw, MoonStar, BatteryCharging, Lock, Zap, Info, ShieldAlert,
} from "lucide-react"
import { toast } from "sonner"
import { rcPower, rcWakeLan } from "@/lib/remote-socket"
import { useRcMirror } from "@/lib/remote-store"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"

type PowerAction = "shutdown" | "restart" | "sleep" | "hibernate" | "lock"

const ACTIONS: { id: PowerAction; label: string; icon: typeof Power; cls: string; confirm: string }[] = [
  { id: "shutdown", label: "إيقاف التشغيل", icon: Power, cls: "text-red-500 border-red-500/40 hover:bg-red-500/10", confirm: "سيتم إيقاف تشغيل الكمبيوتر بالكامل. لا يمكن إيقاظه إلا بحزمة Wake-on-LAN." },
  { id: "restart", label: "إعادة التشغيل", icon: RotateCcw, cls: "text-amber-500 border-amber-500/40 hover:bg-amber-500/10", confirm: "سيتم إعادة تشغيل الكمبيوتر — سيغيب عن الشبكة لحظة الإقلاع." },
  { id: "sleep", label: "سكون (Sleep)", icon: MoonStar, cls: "text-indigo-500 border-indigo-500/40 hover:bg-indigo-500/10", confirm: "دخول وضع السكون — أي إدخال من الهاتف سيوقظه فوراً." },
  { id: "hibernate", label: "إسبات (Hibernate)", icon: BatteryCharging, cls: "text-sky-500 border-sky-500/40 hover:bg-sky-500/10", confirm: "حفظ الجلسة على القرص وإطفاء كامل — الاستيقاظ بحزمة Wake-on-LAN فقط." },
  { id: "lock", label: "قفل الشاشة", icon: Lock, cls: "text-zinc-500 border-zinc-500/40 hover:bg-zinc-500/10", confirm: "قفل شاشة الكمبيوتر — انقر من لوحة اللمس لفتح القفل." },
]

export function SystemRemoteMode() {
  const report = useRcMirror((s) => s.report)
  const mac = useRcMirror((s) => s.desktopMac)
  const [confirm, setConfirm] = useState<PowerAction | null>(null)
  const [macInput, setMacInput] = useState(mac)
  const [packet, setPacket] = useState<string | null>(null)

  const power = report?.power ?? "on"
  const offLike = power === "off" || power === "hibernating"

  function sendWake() {
    const norm = macInput.trim().replace(/-/g, ":").toUpperCase()
    if (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(norm)) {
      toast.error("صيغة MAC غير صحيحة", { description: "الصيغة المطلوبة: A4:5E:60:C1:2D:9F" })
      return
    }
    rcWakeLan(norm)
    const hex = "FF FF FF FF FF FF" + " · " + norm.replace(/:/g, "").match(/.{2}/g)!.join(" ") + " ×16"
    setPacket(hex)
    toast.success("أُرسلت حزمة Wake-on-LAN السحرية", { description: `${norm} · 112 بايت عبر UDP 9` })
  }

  return (
    <div className="flex flex-col gap-2.5 h-full min-h-0">
      {/* حالة الطاقة */}
      <div className={`rounded-2xl border px-3 py-2.5 flex items-center gap-2.5 ${offLike ? "border-red-500/40 bg-red-500/5" : "border-emerald-500/30 bg-emerald-500/5"}`}>
        {offLike ? <ShieldAlert className="w-5 h-5 text-red-500 shrink-0" /> : <Zap className="w-5 h-5 text-emerald-500 shrink-0" />}
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-extrabold">{offLike ? "الكمبيوتر خارج التشغيل" : "الكمبيوتر يستقبل الأوامر"}</p>
          <p className="text-[9.5px] text-muted-foreground">
            {offLike ? "كل الإدخال مرفوض — أرسل حزمة الإيقاظ أدناه" : "التحكم الكامل مفعّل عبر Nexus Protocol"}
          </p>
        </div>
      </div>

      {/* شبكة الأوامر */}
      <div className="grid grid-cols-2 gap-1.5 shrink-0">
        {ACTIONS.map((a) => {
          const Icon = a.icon
          return (
            <button
              key={a.id}
              onClick={() => setConfirm(a.id)}
              className={`rounded-2xl border bg-card py-3 flex flex-col items-center gap-1 text-[10.5px] font-bold active:scale-95 transition-all ${a.cls}`}
            >
              <Icon className="w-5 h-5" />
              {a.label}
            </button>
          )
        })}
      </div>

      {/* Wake-on-LAN */}
      <div className="rounded-2xl border bg-card p-3 space-y-2">
        <div className="flex items-center gap-1.5 text-[11.5px] font-bold">
          <Zap className="w-4 h-4 text-amber-500" /> الإيقاظ عبر الشبكة (Wake-on-LAN)
        </div>
        <p className="text-[9.5px] text-muted-foreground leading-relaxed">
          حزمة سحرية: 6 بايتات FF ثم عنوان MAC مكرراً 16 مرة — تُبَث UDP إلى المنفذ 9 داخل الشبكة المحلية.
        </p>
        <div className="flex gap-1.5">
          <Input
            value={macInput}
            onChange={(e) => setMacInput(e.target.value)}
            className="h-9 rounded-xl text-[11px] font-mono text-start"
            dir="ltr"
            placeholder="A4:5E:60:C1:2D:9F"
            aria-label="عنوان MAC"
          />
          <Button className="h-9 rounded-xl px-3 text-[11px] font-bold shrink-0" onClick={sendWake}>
            <Zap className="w-3.5 h-3.5" /> إيقاظ
          </Button>
        </div>
        {packet && (
          <div className="rounded-xl bg-black/85 text-emerald-400 font-mono text-[8.5px] px-2.5 py-2 overflow-hidden" dir="ltr">
            <p className="text-white/40 mb-0.5">magic packet → UDP :9</p>
            <p className="whitespace-nowrap overflow-x-auto nexus-scroll">{packet}</p>
          </div>
        )}
        {offLike && (
          <p className="flex items-center gap-1 text-[9.5px] font-bold text-amber-500">
            <Info className="w-3 h-3" /> الكمبيوتر {power === "off" ? "مطفأ" : "في الإسبات"} — أرسل الحزمة الآن للاستيقاظ
          </p>
        )}
      </div>

      {/* تأكيد */}
      <AlertDialog open={confirm != null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent className="max-w-[300px] rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[15px]">تأكيد: {ACTIONS.find((a) => a.id === confirm)?.label}</AlertDialogTitle>
            <AlertDialogDescription className="text-[11.5px] leading-relaxed">
              {ACTIONS.find((a) => a.id === confirm)?.confirm}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="rounded-xl h-9 text-[12px]">تراجع</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-xl h-9 text-[12px]"
              onClick={() => {
                if (confirm) {
                  rcPower({ action: confirm })
                  toast.success(`أُرسل أمر: ${ACTIONS.find((a) => a.id === confirm)?.label}`)
                }
                setConfirm(null)
              }}
            >
              تنفيذ على الكمبيوتر
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
