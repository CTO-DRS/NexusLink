"use client"
// NexusLink — القرب التلقائي: قفل الكمبيوتر عند ابتعاد الهاتف (Bluetooth proximity)
// منارة عبر Nexus Protocol + محاكاة قوة الإشارة للاختبار الفوري
import { Lock, LockOpen, RadioTower, Smartphone, Signal, TimerReset, Info, Play, Footprints, Home, WifiOff } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { useGuard } from "@/lib/guard-store"
import { guardSettings, proxManualLock, proxManualUnlock } from "@/lib/guard-socket"
import { GuardCard, InfoRow, RssiMeter, ProxStateBadge, LogList } from "./guard-bits"
import { cn } from "@/lib/utils"

function rssiMeters(rssi: number | null) {
  if (rssi == null) return null
  // تقدير تقريبي: -40 ≈ 1م، كل -6.5dBm يضاعف المسافة
  const d = Math.max(0.5, Math.pow(10, (-rssi - 40) / 20))
  if (d < 10) return `≈ ${d.toFixed(1)} متر`
  return `≈ ${Math.round(d)} متر`
}

export function ProximityTab() {
  const { prox, setProx, simMode, setSimMode, simRssi, setSimRssi, pcLocked, logs, phoneOnline } = useGuard()

  const patch = (p: Parameters<typeof setProx>[0]) => {
    setProx(p)
    guardSettings({
      enabled: p.enabled ?? prox.enabled,
      thresholdRssi: p.thresholdRssi ?? prox.thresholdRssi,
      graceSec: p.graceSec ?? prox.graceSec,
      autoUnlock: p.autoUnlock ?? prox.autoUnlock,
    })
  }

  const stateText =
    prox.state === "near" ? "الهاتف قريب — الكمبيوتر آمن"
    : prox.state === "grace" ? `ال هاتف بعيد — قفل بعد ${Math.ceil((prox.leftMs ?? 0) / 1000)} ثانية`
    : prox.state === "locked" ? "الكمبيوتر مقفل الآن"
    : "مراقبة القرب متوقفة"

  return (
    <div className="space-y-4">
      {/* الحالة الحية */}
      <GuardCard
        title="مراقبة القرب المباشرة"
        icon={RadioTower}
        tone={prox.state === "grace" ? "warn" : prox.state === "locked" ? "danger" : "ok"}
        extra={<ProxStateBadge state={prox.state} leftMs={prox.leftMs} />}
      >
        <div className="flex items-center gap-4">
          <div className={cn(
            "w-16 h-16 rounded-3xl grid place-items-center shrink-0 transition-all",
            prox.state === "near" ? "bg-emerald-500/15 text-emerald-500" : prox.state === "grace" ? "bg-amber-500/15 text-amber-500 animate-pulse" : prox.state === "locked" ? "bg-red-500/15 text-red-500" : "bg-muted text-muted-foreground"
          )}>
            {prox.state === "near" ? <Home className="w-8 h-8" /> : prox.state === "grace" ? <Footprints className="w-8 h-8" /> : <Lock className="w-8 h-8" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13.5px] font-bold">{stateText}</div>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <RssiMeter rssi={prox.rssi} />
              <span className="text-[10.5px] text-muted-foreground dir-ltr font-mono">{rssiMeters(prox.rssi)}</span>
              {prox.source && (
                <Badge variant="secondary" className="rounded-full text-[9px] gap-1">
                  {prox.source === "real" ? <><Smartphone className="w-2.5 h-2.5" /> منارة هاتفك الحقيقي</> : <><Signal className="w-2.5 h-2.5" /> محاكاة القرب</>}
                </Badge>
              )}
              {phoneOnline && <Badge variant="outline" className="rounded-full text-[9px] border-emerald-500/50 text-emerald-600 dark:text-emerald-400">/phone متصل</Badge>}
            </div>
          </div>
        </div>
      </GuardCard>

      {/* الإعدادات */}
      <GuardCard title="إعدادات القفل التلقائي" icon={TimerReset}>
        <div className="rounded-2xl border bg-card p-3.5 flex items-center gap-3">
          <div className="flex-1">
            <div className="text-[12.5px] font-bold">مراقبة القرب</div>
            <div className="text-[10.5px] text-muted-foreground">قفل الكمبيوتر تلقائياً عند فقدان منارة الهاتف</div>
          </div>
          <Switch checked={prox.enabled} onCheckedChange={(v) => patch({ enabled: v })} aria-label="تفعيل مراقبة القرب" />
        </div>

        <div className={cn("space-y-4 transition-opacity", !prox.enabled && "opacity-40 pointer-events-none")}>
          {/* عتبة الإشارة */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11.5px]">
              <span className="font-semibold flex items-center gap-1.5"><Signal className="w-3.5 h-3.5" /> عتبة الانقطاع</span>
              <span className="font-mono text-muted-foreground dir-ltr">{prox.thresholdRssi} dBm</span>
            </div>
            <Slider
              value={[prox.thresholdRssi]}
              min={-85} max={-45} step={1}
              onValueChange={([v]) => patch({ thresholdRssi: v })}
              aria-label="عتبة قوة الإشارة"
            />
            <div className="flex justify-between text-[9px] text-muted-foreground">
              <span>−85: ابتعاد طويل قبل القفل</span>
              <span>−45: قفل عند أول ابتعاد</span>
            </div>
          </div>

          {/* مهلة السماح */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11.5px]">
              <span className="font-semibold">مهلة السماح قبل القفل</span>
              <span className="font-mono text-muted-foreground dir-ltr">{prox.graceSec} ثانية</span>
            </div>
            <Slider
              value={[prox.graceSec]}
              min={3} max={60} step={1}
              onValueChange={([v]) => patch({ graceSec: v })}
              aria-label="مهلة السماح"
            />
          </div>

          {/* فتح تلقائي */}
          <div className="rounded-2xl border bg-card p-3.5 flex items-center gap-3">
            <div className="flex-1">
              <div className="text-[12.5px] font-bold">فتح تلقائي عند العودة</div>
              <div className="text-[10.5px] text-muted-foreground">عندما تعود منارة الهاتف للنطاق يُفتح القفل دون كلمة مرور</div>
            </div>
            <Switch checked={prox.autoUnlock} onCheckedChange={(v) => patch({ autoUnlock: v })} aria-label="فتح تلقائي" />
          </div>
        </div>
      </GuardCard>

      {/* محاكاة القرب — اختبار النجاح فوراً */}
      <GuardCard title="اختبار الابتعاد" icon={Play} tone="ok">
        <p className="text-[11.5px] text-muted-foreground leading-relaxed">
          للتجربة الفورية على هذا الكمبيوتر حرّك شريط القوة — أو <b>الحقيقي</b>: افتح <span className="font-mono dir-ltr">/phone</span> على هاتفك وامشِ به بعيداً، ستتوقف منارته فيقفل الكمبيوتر تلقائياً.
        </p>
        <div className="rounded-2xl border bg-card p-3.5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-primary" />
              <span className="text-[12px] font-bold">منارة المحاكاة</span>
            </div>
            <Switch checked={simMode} onCheckedChange={(v) => { setSimMode(v); toast.message(v ? "محاكاة المنارة تعمل" : "أُوقفت المحاكاة — استخدم هاتفك الحقيقي") }} aria-label="منارة محاكاة" />
          </div>
          <div className={cn("space-y-2 transition-opacity", !simMode && "opacity-40 pointer-events-none")}>
            <div className="flex items-center gap-3">
              <RssiMeter rssi={simRssi} />
              <Slider
                value={[simRssi]}
                min={-95} max={-35} step={1}
                onValueChange={([v]) => setSimRssi(v)}
                className="flex-1"
                aria-label="قوة إشارة الهاتف المحاكاة"
              />
              <span className="text-[10px] font-mono text-muted-foreground w-14 dir-ltr text-end">{simRssi}dBm</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Button variant="secondary" size="sm" className="h-9 rounded-xl text-[10.5px] gap-1" onClick={() => { setSimRssi(-48); toast.success("وضعت الهاتف بجوار الكمبيوتر") }}>
                <Home className="w-3.5 h-3.5" /> قريب جداً
              </Button>
              <Button variant="secondary" size="sm" className="h-9 rounded-xl text-[10.5px] gap-1" onClick={() => { setSimRssi(-72); toast.message("خرجت بالهاتف من الغرفة") }}>
                <Footprints className="w-3.5 h-3.5" /> الغرفة المجاورة
              </Button>
              <Button variant="destructive" size="sm" className="h-9 rounded-xl text-[10.5px] gap-1" onClick={() => { setSimRssi(-94); toast.error("ابتعدت بالهاتف — القفل قادم!") }}>
                <WifiOff className="w-3.5 h-3.5" /> ابتعدت تماماً
              </Button>
            </div>
          </div>
        </div>

        {/* قفل/فتح يدوي */}
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" className="rounded-2xl gap-2 h-10" onClick={() => { proxManualLock(); toast.message("قُفل الكمبيوتر يدوياً") }} disabled={!!pcLocked}>
            <Lock className="w-4 h-4" /> قفل الآن
          </Button>
          <Button variant="outline" className="rounded-2xl gap-2 h-10" onClick={() => { proxManualUnlock(); toast.success("فُتح القفل") }} disabled={!pcLocked}>
            <LockOpen className="w-4 h-4" /> فتح بكلمة المرور
          </Button>
        </div>
      </GuardCard>

      {/* كيف يعمل + السجل */}
      <GuardCard title="كيف يعمل؟" icon={Info}>
        <div className="rounded-xl bg-muted/60 p-3 text-[11px] text-muted-foreground leading-relaxed space-y-1.5">
          <p>• يبث الهاتف منارة قرب كل ثانيتين عبر Nexus Protocol (نفس مبدأ Bluetooth LE RSSI بدون الحاجة له).</p>
          <p>• يحسب جسر النظام قوة الإشارة والمسافة التقريبية — عند تجاوز العتبة تبدأ مهلة السماح.</p>
          <p>• إذا لم تعد المنارة قبل انتهاء المهلة: يُقفل الكمبيوتر فوراً (في إنتاج Tauri: أمر قفل نظام حقيقي + BLE beacons).</p>
          <p>• عند عودة الهاتف للنطاق يُفتح القفل تلقائياً، أو بكلمة المرور الافتراضية <b>1234</b>.</p>
        </div>
      </GuardCard>

      <GuardCard title="سجل أحداث القرب" icon={RadioTower}>
        <LogList logs={logs.filter((l) => l.text.includes("قرب") || l.text.includes("قفل") || l.text.includes("منارة") || l.text.includes("النطاق") || l.text.includes("الإشارة"))} />
      </GuardCard>
    </div>
  )
}
