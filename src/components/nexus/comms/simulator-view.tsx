"use client"
// الهاتف الافتراضي — محاكي أندرويد متصل عبر Nexus Protocol
// يُظهر ما يصل للهاتف: ردود سريعة، رسائل SMS من الكمبيوتر، أوامر المكالمات وعدم الإزعاج
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { useComms, relTime } from "@/lib/comms-store"
import { simulate, setAutoMode, pushDndToPhone } from "@/lib/comms-socket"
import { syncDnd } from "@/hooks/use-comms"
import { appMeta } from "@/lib/nexus/comms-types"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  MessageCircle, Send, PhoneIncoming, BellOff, Bell, Zap, Smartphone, BatteryMedium,
  Wifi, ArrowDownLeft, ArrowUpRight, CheckCircle2, Info, CircleDot, Gauge,
} from "lucide-react"

const SIM_BUTTONS: { kind: string; label: string; icon: typeof MessageCircle; color: string }[] = [
  { kind: "whatsapp", label: "إشعار واتساب وارد", icon: MessageCircle, color: "#25D366" },
  { kind: "telegram", label: "إشعار تيليجرام وارد", icon: Send, color: "#229ED9" },
  { kind: "gmail", label: "إشعار Gmail وارد", icon: MessageCircle, color: "#EA4335" },
  { kind: "instagram", label: "إشعار إنستغرام وارد", icon: MessageCircle, color: "#E1306C" },
  { kind: "sms", label: "رسالة SMS واردة", icon: MessageCircle, color: "#0d9488" },
  { kind: "call", label: "مكالمة واردة", icon: PhoneIncoming, color: "#16a34a" },
]

function LogIcon({ kind }: { kind: string }) {
  if (kind === "in") return <ArrowDownLeft className="w-3.5 h-3.5 text-primary" />
  if (kind === "out") return <ArrowUpRight className="w-3.5 h-3.5 text-amber-500" />
  if (kind === "ok") return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
  return <Info className="w-3.5 h-3.5 text-muted-foreground" />
}

export function SimulatorView() {
  const phone = useComms((s) => s.phone)
  const phoneLogs = useComms((s) => s.phoneLogs)
  const notifications = useComms((s) => s.notifications)
  const [clock, setClock] = useState("")

  useEffect(() => {
    const tick = () => setClock(new Intl.DateTimeFormat("ar", { hour: "2-digit", minute: "2-digit" }).format(new Date()))
    tick()
    const iv = setInterval(tick, 15000)
    return () => clearInterval(iv)
  }, [])

  const screenNotifs = notifications.filter((n) => n.status === "new").slice(0, 3)

  return (
    <div className="grid lg:grid-cols-[minmax(0,340px)_1fr] gap-5 items-start">
      {/* الهاتف */}
      <div className="mx-auto w-[300px]">
        <div className="rounded-[2.4rem] border-4 border-foreground/80 bg-foreground/5 p-2 shadow-2xl" dir="ltr">
          <div className="rounded-[1.9rem] bg-background overflow-hidden">
            {/* شريط الحالة */}
            <div className="flex items-center justify-between px-5 pt-2.5 pb-1 text-[11px] font-semibold">
              <span>{clock}</span>
              <span className="flex items-center gap-1.5">
                {phone.dnd && <BellOff className="w-3 h-3 text-amber-500" />}
                <Wifi className="w-3 h-3" />
                <BatteryMedium className="w-3.5 h-3.5" />
                <span>{phone.battery}%</span>
              </span>
            </div>
            {/* النوتش */}
            <div className="flex justify-center py-1">
              <div className="w-20 h-4 rounded-full bg-foreground/80" />
            </div>
            {/* الشاشة */}
            <div className="px-3 pb-4 min-h-[380px]">
              <div className="text-center py-3">
                <p className="text-[12px] text-muted-foreground">شاشة القفل</p>
                <p className="text-[11px] text-muted-foreground/70 mt-0.5">
                  {phone.name} · متصل عبر Nexus Protocol
                </p>
              </div>
              {/* إشعارات على الشاشة */}
              <div className="space-y-1.5" dir="rtl">
                {phone.dnd && (
                  <div className="rounded-2xl bg-amber-500/15 border border-amber-500/30 px-3 py-2 text-[11px] text-amber-600 flex items-center gap-2">
                    <BellOff className="w-3.5 h-3.5" /> وضع عدم الإزعاج مفعّل — الإشعارات صامتة
                  </div>
                )}
                {screenNotifs.length === 0 && !phone.dnd && (
                  <p className="text-center text-[11px] text-muted-foreground/60 py-8">لا توجد إشعارات جديدة</p>
                )}
                {screenNotifs.map((n) => {
                  const meta = appMeta(n.appId)
                  return (
                    <div key={n.id} className="rounded-2xl bg-card border px-3 py-2 shadow-sm flex items-start gap-2">
                      <div className="w-6 h-6 rounded-lg grid place-items-center text-white text-[9px] font-bold shrink-0" style={{ background: meta.color }}>
                        {n.appName.slice(0, 1)}
                      </div>
                      <div className="min-w-0">
                        <div className="text-[11px] font-bold truncate">{n.title}</div>
                        <div className="text-[10px] text-muted-foreground line-clamp-2">{n.body}</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
        <p className="text-center text-[10px] text-muted-foreground mt-2">
          هذا جهاز افتراضي يمثل هاتفك المتصل — كل إشعار أو رسالة تُرسله يمر عبر جسر Nexus Protocol الحقيقي
        </p>
      </div>

      {/* لوحة التحكم */}
      <div className="space-y-4">
        {/* توليد أحداث */}
        <div className="rounded-2xl border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2 text-[13px] font-semibold">
            <Zap className="w-4 h-4 text-amber-500" /> محاكاة أحداث على الهاتف
          </div>
          <div className="grid sm:grid-cols-2 gap-2">
            {SIM_BUTTONS.map((b) => (
              <Button
                key={b.kind}
                variant="outline"
                className="h-10 rounded-2xl justify-start gap-2.5 text-[12.5px]"
                onClick={() => {
                  simulate(b.kind)
                  toast(`تم إرسال ${b.label} عبر Nexus Protocol`)
                }}
              >
                <span className="w-5 h-5 rounded-lg grid place-items-center" style={{ background: b.color }}>
                  <b.icon className="w-3 h-3 text-white" />
                </span>
                {b.label}
              </Button>
            ))}
          </div>
        </div>

        {/* مزامنة الحالة */}
        <div className="rounded-2xl border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2 text-[13px] font-semibold">
            <Gauge className="w-4 h-4 text-primary" /> حالة الهاتف والمزامنة
          </div>
          <div className="grid sm:grid-cols-2 gap-2">
            <div className="flex items-center justify-between rounded-2xl border px-3 py-2.5">
              <div className="flex items-center gap-2 text-[12.5px] font-medium">
                {phone.dnd ? <BellOff className="w-4 h-4 text-amber-500" /> : <Bell className="w-4 h-4 text-emerald-500" />}
                عدم الإزعاج (من الهاتف)
              </div>
              <Switch
                checked={phone.dnd}
                onCheckedChange={(v) => {
                  // التبديل من جهة الهاتف
                  simulate("dnd")
                }}
                aria-label="تبديل عدم الإزعاج من الهاتف"
              />
            </div>
            <div className="flex items-center justify-between rounded-2xl border px-3 py-2.5">
              <div className="flex items-center gap-2 text-[12.5px] font-medium">
                <Zap className="w-4 h-4 text-amber-500" /> محاكاة تلقائية
              </div>
              <Switch
                checked={phone.autoMode}
                onCheckedChange={(v) => {
                  setAutoMode(v)
                  useComms.getState().setPhone({ autoMode: v })
                }}
                aria-label="محاكاة تلقائية"
              />
            </div>
          </div>
          {phone.dnd && (
            <Button
              variant="secondary"
              size="sm"
              className="h-8 rounded-xl text-[12px]"
              onClick={() => syncDnd(false)}
            >
              إيقاف عدم الإزعاج من الكمبيوتر (مزامنة)
            </Button>
          )}
          <p className="text-[11px] text-muted-foreground">
            المصدر الحالي لعدم الإزعاج:{" "}
            {phone.dndSource === "pc" ? <Badge className="text-[10px]">الكمبيوتر</Badge> : phone.dndSource === "phone" ? <Badge variant="secondary" className="text-[10px]">الهاتف</Badge> : "—"}
          </p>
        </div>

        {/* سجل الهاتف */}
        <div className="rounded-2xl border bg-card p-4">
          <div className="flex items-center gap-2 text-[13px] font-semibold mb-2">
            <Smartphone className="w-4 h-4 text-primary" /> سجل الهاتف — ما وصل للجهاز فعلياً
            <Badge variant="secondary" className="text-[10px]">{phoneLogs.length}</Badge>
          </div>
          <ScrollArea className="h-64 nexus-scroll">
            <div className="space-y-1 pe-2">
              {phoneLogs.length === 0 ? (
                <p className="text-center text-[12px] text-muted-foreground py-10">
                  سجل الهاتف فارغ — جرّب الرد على إشعار واتساب أو إرسال SMS من الكمبيوتر وسيظهر السجل هنا
                </p>
              ) : (
                phoneLogs.map((l) => (
                  <div key={l.id} className="flex items-start gap-2.5 rounded-xl px-2.5 py-2 hover:bg-accent/50 text-[12px]">
                    <LogIcon kind={l.kind} />
                    <span className="flex-1 leading-relaxed">{l.text}</span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="text-[9px] text-muted-foreground shrink-0 mt-0.5"><CircleDot className="w-3 h-3" /></span>
                      </TooltipTrigger>
                      <TooltipContent>{relTime(l.at)}</TooltipContent>
                    </Tooltip>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  )
}
