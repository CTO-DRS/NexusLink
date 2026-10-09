"use client"
// NexusLink — التحكم في منبهات الهاتف وإعداداته السريعة من الكمبيوتر
import { useState } from "react"
import { toast } from "sonner"
import {
  AlarmClock, Plus, Trash2, Wifi, Bluetooth, Flashlight, BellOff, RotateCcw,
  Signal, Router, BatteryCharging, Sun, Volume2, BellRing, SlidersHorizontal,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { useGuard, alarmTime, alarmDaysText, nextAlarmIn, DAY_NAMES, type AlarmEntry } from "@/lib/guard-store"
import { cmdAlarm, cmdQs } from "@/lib/guard-socket"
import { syncDnd } from "@/hooks/use-comms"
import { GuardCard, fmtCountdown } from "./guard-bits"
import { cn } from "@/lib/utils"

export function ControlTab() {
  const { alarms, addAlarm, updateAlarm, deleteAlarm, qs, setQsKey, setCheck } = useGuard()
  const [addOpen, setAddOpen] = useState(false)
  const [newHour, setNewHour] = useState("7")
  const [newMinute, setNewMinute] = useState("0")
  const [newLabel, setNewLabel] = useState("")
  const [newDays, setNewDays] = useState<number[]>([])

  const markControl = () => setTimeout(() => setCheck("control"), 50)

  const saveAlarm = () => {
    const h = Math.min(23, Math.max(0, parseInt(newHour) || 0))
    const m = Math.min(59, Math.max(0, parseInt(newMinute) || 0))
    addAlarm({ hour: h, minute: m, label: newLabel.trim() || "منبه", days: newDays, enabled: true })
    cmdAlarm({ action: "add", time: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`, label: newLabel.trim() || "منبه" })
    markControl()
    setAddOpen(false)
    setNewLabel("")
    setNewDays([])
    toast.success(`أُضيف منبه ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} إلى هاتفك`)
  }

  const toggleAlarm = (a: AlarmEntry) => {
    updateAlarm(a.id, { enabled: !a.enabled })
    cmdAlarm({ action: "toggle", id: a.id, enabled: !a.enabled, time: alarmTime(a) })
    markControl()
  }

  const removeAlarm = (a: AlarmEntry) => {
    deleteAlarm(a.id)
    cmdAlarm({ action: "delete", id: a.id })
    markControl()
    toast.message(`حُذف منبه ${a.label}`)
  }

  const setQ = (k: keyof typeof qs, v: boolean | number) => {
    setQsKey(k, v)
    cmdQs(k, v)
    markControl()
    if (k === "dnd") void syncDnd(!!v)
  }

  const TILES: { key: keyof typeof qs; label: string; Icon: typeof Wifi }[] = [
    { key: "wifi", label: "Wi-Fi", Icon: Wifi },
    { key: "bluetooth", label: "بلوتوث", Icon: Bluetooth },
    { key: "flashlight", label: "الكشاف", Icon: Flashlight },
    { key: "dnd", label: "عدم الإزعاج", Icon: BellOff },
    { key: "rotate", label: "تدوير تلقائي", Icon: RotateCcw },
    { key: "data", label: "بيانات الجوال", Icon: Signal },
    { key: "hotspot", label: "نقطة اتصال", Icon: Router },
    { key: "saver", label: "موفر الطاقة", Icon: BatteryCharging },
  ]

  const nexts = alarms.filter((a) => a.enabled).map((a) => ({ a, in: nextAlarmIn(a) })).sort((x, y) => (x.in ?? 1e9) - (y.in ?? 1e9))

  return (
    <div className="space-y-4">
      {/* المنبهات */}
      <GuardCard
        title={`منبهات الهاتف (${alarms.filter((a) => a.enabled).length} مفعّل)`}
        icon={AlarmClock}
        extra={
          <Button size="sm" className="h-8 rounded-xl gap-1.5 text-[11px]" onClick={() => setAddOpen(true)}>
            <Plus className="w-3.5 h-3.5" /> منبه جديد
          </Button>
        }
      >
        {nexts[0] && (
          <div className="rounded-xl bg-primary/10 border border-primary/20 px-3 py-2 text-[11.5px] flex items-center gap-2">
            <BellRing className="w-3.5 h-3.5 text-primary shrink-0" />
            <span>القادم: <b>{nexts[0].a.label}</b> {alarmTime(nexts[0].a)} — {fmtCountdown(nexts[0].in)}</span>
          </div>
        )}
        <div className="divide-y divide-border/50">
          {alarms.map((a) => (
            <div key={a.id} className="flex items-center gap-3 py-2.5">
              <Switch checked={a.enabled} onCheckedChange={() => toggleAlarm(a)} aria-label={`تفعيل منبه ${a.label}`} />
              <div className="text-[17px] font-black tabular-nums dir-ltr w-14 text-center" style={{ opacity: a.enabled ? 1 : 0.4 }}>
                {alarmTime(a)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-bold" style={{ opacity: a.enabled ? 1 : 0.5 }}>{a.label}</div>
                <div className="text-[10px] text-muted-foreground">{alarmDaysText(a)}{a.enabled ? ` · ${fmtCountdown(nextAlarmIn(a))}` : " · معطّل"}</div>
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl text-red-500 shrink-0" onClick={() => removeAlarm(a)} aria-label={`حذف ${a.label}`}>
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          ))}
        </div>
      </GuardCard>

      {/* الإعدادات السريعة */}
      <GuardCard title="إعدادات الهاتف السريعة" icon={SlidersHorizontal}>
        <div className="grid grid-cols-4 gap-2">
          {TILES.map((t) => {
            const on = !!qs[t.key]
            return (
              <button
                key={t.key}
                onClick={() => setQ(t.key, !on)}
                aria-pressed={on}
                className={cn(
                  "rounded-2xl aspect-square flex flex-col items-center justify-center gap-1.5 transition-all active:scale-95 border",
                  on ? "bg-primary text-primary-foreground border-primary shadow-md shadow-primary/25" : "bg-card text-muted-foreground hover:bg-accent"
                )}
              >
                <t.Icon className="w-5 h-5" />
                <span className="text-[9px] font-semibold leading-none">{t.label}</span>
              </button>
            )
          })}
        </div>

        <div className="space-y-3 pt-1">
          <div className="flex items-center gap-3">
            <Sun className="w-4 h-4 text-muted-foreground shrink-0" />
            <Slider value={[qs.brightness]} min={5} max={100} onValueChange={([v]) => setQ("brightness", v)} aria-label="سطوع الشاشة" />
            <span className="text-[10.5px] font-mono w-8 text-muted-foreground dir-ltr text-end">{qs.brightness}%</span>
          </div>
          <div className="flex items-center gap-3">
            <Volume2 className="w-4 h-4 text-muted-foreground shrink-0" />
            <Slider value={[qs.volMedia]} min={0} max={100} onValueChange={([v]) => setQ("volMedia", v)} aria-label="صوت الوسائط" />
            <span className="text-[10.5px] font-mono w-8 text-muted-foreground dir-ltr text-end">{qs.volMedia}%</span>
          </div>
          <div className="flex items-center gap-3">
            <BellRing className="w-4 h-4 text-muted-foreground shrink-0" />
            <Slider value={[qs.volRing]} min={0} max={100} onValueChange={([v]) => setQ("volRing", v)} aria-label="صوت الرنين" />
            <span className="text-[10.5px] font-mono w-8 text-muted-foreground dir-ltr text-end">{qs.volRing}%</span>
          </div>
        </div>

        <div className="rounded-xl bg-muted/60 p-2.5 text-[10.5px] text-muted-foreground">
          كل تغيير يُطبَّق فوراً على الهاتف عبر Nexus Protocol — «عدم الإزعاج» يتزامن أيضاً مع مركز الاتصالات.
        </div>
      </GuardCard>

      {/* نافذة منبه جديد */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><AlarmClock className="w-4 h-4" /> منبه جديد</DialogTitle>
            <DialogDescription>سيُضاف إلى ساعة هاتفك فوراً</DialogDescription>
          </DialogHeader>
          <div className="space-y-3.5">
            <div className="flex items-center gap-2 justify-center">
              <Select value={newHour} onValueChange={setNewHour}>
                <SelectTrigger className="w-20 h-14 rounded-2xl text-2xl font-black justify-center"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-56">
                  {Array.from({ length: 24 }, (_, h) => <SelectItem key={h} value={String(h)}>{String(h).padStart(2, "0")}</SelectItem>)}
                </SelectContent>
              </Select>
              <span className="text-2xl font-black">:</span>
              <Select value={newMinute} onValueChange={setNewMinute}>
                <SelectTrigger className="w-20 h-14 rounded-2xl text-2xl font-black justify-center"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-56">
                  {Array.from({ length: 12 }, (_, i) => <SelectItem key={i} value={String(i * 5)}>{String(i * 5).padStart(2, "0")}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="التسمية (مثلاً: اجتماع الفريق)" className="h-10 rounded-xl text-[12.5px]" />
            <div>
              <div className="text-[11px] font-semibold mb-1.5">الأيام (اتركها فارغة = كل يوم)</div>
              <div className="flex flex-wrap gap-1.5">
                {DAY_NAMES.map((d, i) => {
                  const on = newDays.includes(i)
                  return (
                    <button
                      key={d}
                      onClick={() => setNewDays((prev) => on ? prev.filter((x) => x !== i) : [...prev, i])}
                      className={cn(
                        "rounded-full px-3 py-1.5 text-[10.5px] font-semibold border transition-all",
                        on ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground hover:bg-accent"
                      )}
                    >
                      {d}
                    </button>
                  )
                })}
              </div>
            </div>
            <Button className="w-full h-11 rounded-2xl font-bold" onClick={saveAlarm}>
              <Plus className="w-4 h-4" /> أضف المنبه للهاتف
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
