"use client"
// NexusLink — أين هاتفي: رنين قوي يتجاوز الوضع الصامت + إضاءة الشاشة
import { BellRing, BellOff, Lightbulb, Smartphone, Wifi, MapPin, VolumeX, BadgeAlert } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { useGuard } from "@/lib/guard-store"
import { useNexus } from "@/lib/store"
import { cmdRing, cmdLight } from "@/lib/guard-socket"
import { GuardCard, InfoRow, RssiMeter, ProxStateBadge } from "./guard-bits"
import { cn } from "@/lib/utils"

export function FindTab() {
  const { ringing, strobe, setRinging, setStrobe, setCheck, prox, phoneOnline } = useGuard()
  const devices = useNexus((s) => s.devices)
  const dev = devices.find((d) => d.id === "galaxy-s24")

  const ring = (on: boolean) => {
    setRinging(on)
    cmdRing(on)
    if (on) {
      setCheck("ring")
      toast.success("الهاتف يرن الآن بأقصى صوت — يتجاوز الوضع الصامت", { description: phoneOnline ? "اضغط «إيقاف» هنا أو «أنا هنا» على الهاتف" : "الرن يعمل على مرآة الهاتف — افتح /phone بهاتفك لسماعه فعلياً" })
    } else {
      toast.message("أُوقف الرنين")
    }
  }

  return (
    <div className="space-y-4">
      {/* بطاقة الرنين */}
      <GuardCard
        title="رنين قوي على الهاتف"
        icon={BellRing}
        tone={ringing ? "danger" : undefined}
        extra={ringing ? <Badge className="bg-red-500 hover:bg-red-500 rounded-full animate-pulse text-[10px]">يرن الآن</Badge> : undefined}
      >
        <div className="flex flex-col items-center gap-4 py-3">
          <button
            onClick={() => ring(!ringing)}
            aria-label={ringing ? "إيقاف الرنين" : "رن الهاتف بقوة"}
            className={cn(
              "relative w-32 h-32 rounded-full grid place-items-center transition-all active:scale-95 shadow-xl",
              ringing
                ? "bg-red-500 text-white shadow-red-500/40"
                : "bg-gradient-to-br from-teal-500 to-teal-600 text-white shadow-teal-600/30 hover:shadow-lg"
            )}
          >
            {ringing && <span className="absolute inset-0 rounded-full bg-red-500 animate-ping opacity-30" />}
            <div className="text-center">
              {ringing ? <BellOff className="w-11 h-11 mx-auto" /> : <BellRing className="w-11 h-11 mx-auto" />}
              <span className="text-[11px] font-bold block mt-1">{ringing ? "أوقف الرنين" : "رنّ بقوة"}</span>
            </div>
          </button>
          <div className="flex items-center gap-2 flex-wrap justify-center">
            <Badge variant="outline" className="rounded-full gap-1 text-[10px]">
              <VolumeX className="w-3 h-3" /> يتجاوز الوضع الصامت والاهتزاز
            </Badge>
            <Badge variant="outline" className="rounded-full gap-1 text-[10px]">
              <BadgeAlert className="w-3 h-3" /> حتى لو كان الشاشة مطفأة
            </Badge>
          </div>
        </div>

        {/* إضاءة الشاشة */}
        <div className="rounded-2xl border bg-card p-3.5 flex items-center gap-3">
          <div className={cn("w-10 h-10 rounded-xl grid place-items-center transition-colors", strobe ? "bg-amber-400 text-black" : "bg-muted text-muted-foreground")}>
            <Lightbulb className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[12.5px] font-bold">إضاءة الشاشة / الفلاش</div>
            <div className="text-[10.5px] text-muted-foreground">يضيء الهاتف بضوء أبيض نابض ليلفت الانتباه في الظلام</div>
          </div>
          <Switch
            checked={strobe}
            onCheckedChange={(v) => { setStrobe(v); cmdLight(v) }}
            aria-label="إضاءة شاشة الهاتف"
          />
        </div>
      </GuardCard>

      {/* أين الهاتف */}
      <GuardCard title="أين الهاتف؟" icon={MapPin}>
        <div className="flex items-center gap-3 mb-2">
          <div className="flex-1 flex items-center gap-2 rounded-2xl border bg-gradient-to-l from-teal-500/10 to-transparent p-3">
            <Smartphone className="w-8 h-8 text-primary shrink-0" />
            <div className="min-w-0">
              <div className="text-[12.5px] font-bold flex items-center gap-1.5">
                Galaxy-S24
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 nexus-live" />
              </div>
              <div className="text-[10px] text-muted-foreground">متصل على شبكتك المحلية الآن — لا GPS، دقة الشبكة</div>
            </div>
          </div>
          <div className="flex flex-col items-center gap-1.5">
            <RssiMeter rssi={prox.rssi} />
            <ProxStateBadge state={prox.state} leftMs={prox.leftMs} />
          </div>
        </div>
        <div>
          <InfoRow label="شبكة Wi-Fi" value="NEXUS-HOME · 5GHz" />
          <InfoRow label="عنوان IP" value={dev?.ip ?? "192.168.1.14"} mono />
          <InfoRow label="قوة الإشارة" value={prox.rssi != null ? `${Math.round(prox.rssi)} dBm` : "—"} mono />
          <InfoRow label="زمن الاستجابة" value={`${dev?.rttMs ?? 11}ms`} mono />
          <InfoRow label="البطارية" value={`${useGuard.getState().metrics["galaxy-s24"].battery}%`} />
          <InfoRow label="آخر نبض" value="قبل ثوانٍ (نبض Nexus Protocol)" />
        </div>
        <div className="rounded-xl bg-muted/60 p-2.5 text-[10.5px] text-muted-foreground flex items-start gap-1.5">
          <Wifi className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          NexusLink يعمل محلياً بالكامل — الموقع يُقدَّر من قوة إشارة الشبكة داخل منزلك (غرفة تقريبية)، دون أي خدمة خارجية.
        </div>
      </GuardCard>
    </div>
  )
}
