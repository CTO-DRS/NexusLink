"use client"

import { useState } from "react"
import { useNexus, fmtSize } from "@/lib/store"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"
import {
  Smartphone, Tablet, Monitor, Wifi, Usb, QrCode, Unplug, Trash2,
  Signal, BatteryMedium, ShieldCheck, Plus, RefreshCcw, ChevronLeft,
} from "lucide-react"
import { toast } from "sonner"
import type { NexusDevice } from "@/lib/nexus/types"

const kindIcon = (k: string) => (k === "phone" ? Smartphone : k === "tablet" ? Tablet : Monitor)
const modeLabel = (m: string) => (m === "wifi" ? "واي فاي" : m === "hotspot" ? "نقطة اتصال" : "USB")

function DeviceCard({ d }: { d: NexusDevice }) {
  const { setActiveDeviceId, setView } = useNexus()
  const Icon = kindIcon(d.kind)
  const online = d.state === "connected"
  const usedPct = Math.round((d.storageUsed / d.storageTotal) * 100)

  const post = async (body: Record<string, unknown>) => {
    await fetch("/api/devices", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    })
    const r = await fetch("/api/devices")
    useNexus.getState().setDevices((await r.json()).devices)
  }

  return (
    <Card className={`relative overflow-hidden transition-all hover:shadow-lg ${online ? "border-primary/30" : "opacity-80"}`}>
      {online && <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-l from-emerald-400 via-teal-500 to-emerald-400" />}
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={`relative w-12 h-12 rounded-2xl grid place-items-center ${online ? "bg-primary/12 text-primary" : "bg-muted text-muted-foreground"}`}>
              <Icon className="w-6 h-6" />
              <span className={`absolute -bottom-0.5 -end-0.5 w-3.5 h-3.5 rounded-full border-2 border-card ${online ? "bg-emerald-500 nexus-live" : "bg-zinc-400"}`} />
            </div>
            <div>
              <div className="font-bold">{d.name}</div>
              <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                <Signal className="w-3 h-3" /> {d.ip} · {d.rttMs}ms
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <Badge variant={online ? "default" : "secondary"} className="text-[10px]">
              {online ? "متصل" : "غير متصل"}
            </Badge>
            <Badge variant="outline" className="text-[10px] gap-1">
              {d.mode === "usb" ? <Usb className="w-3 h-3" /> : <Wifi className="w-3 h-3" />}
              {modeLabel(d.mode)}
            </Badge>
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><BatteryMedium className="w-3.5 h-3.5" /> البطارية {d.battery}%</span>
            <span>{fmtSize(d.storageUsed)} / {fmtSize(d.storageTotal)}</span>
          </div>
          <Progress value={usedPct} className="h-1.5" />
        </div>

        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <ShieldCheck className="w-3.5 h-3.5 text-teal-500" />
          موثوق · مقترن منذ {Math.round((Date.now() - d.pairedAt) / 864e5)} يوماً · نبض Nexus Protocol نشط
        </div>

        <Separator />
        <div className="flex gap-2">
          <Button
            size="sm" className="flex-1 gap-1.5"
            disabled={!online}
            onClick={() => { setActiveDeviceId(d.id); setView("files"); }}
          >
            استكشاف الملفات
            <ChevronLeft className="w-4 h-4" />
          </Button>
          {d.kind !== "desktop" && (
            online ? (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => { post({ action: "disconnect", id: d.id }); toast("تم قطع الاتصال") }}>
                <Unplug className="w-4 h-4" /> قطع
              </Button>
            ) : (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => { post({ action: "connect", id: d.id }); toast.success("جارٍ إعادة الاتصال…") }}>
                <RefreshCcw className="w-4 h-4" /> اتصال
              </Button>
            )
          )}
          <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => { post({ action: "forget", id: d.id }); toast("تم حذف الاقتران") }}>
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function PairDialog() {
  const [qr, setQr] = useState<string | null>(null)
  const [code, setCode] = useState<string | null>(null)
  const [step, setStep] = useState<"scan" | "confirm">("scan")
  const [loading, setLoading] = useState(false)

  const begin = async () => {
    setLoading(true)
    try {
      const r = await fetch("/api/devices/qr")
      const j = await r.json()
      setQr(j.qr); setCode(j.code); setStep("scan")
    } finally {
      setLoading(false)
    }
  }

  const confirm = async () => {
    setLoading(true)
    try {
      const name = `Device-${code}`
      await fetch("/api/devices", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pair", name, kind: "phone" }),
      })
      const r = await fetch("/api/devices")
      useNexus.getState().setDevices((await r.json()).devices)
      setStep("confirm")
      toast.success("تم الاقتران بنجاح — تم تبادل المفاتيح وتشفير القناة")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button onClick={begin} className="gap-2 shadow-md shadow-primary/25">
          <QrCode className="w-4 h-4" /> اقتران جهاز جديد
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrCode className="w-5 h-5 text-primary" /> اقتران جهاز جديد
          </DialogTitle>
          <DialogDescription>
            افتح تطبيق NexusLink على الجهاز الآخر وامسح رمز الاستجابة، أو أدخل الرمز اليدوي.
          </DialogDescription>
        </DialogHeader>

        {qr ? (
          <div className="space-y-4">
            <div className="mx-auto w-fit p-3 rounded-2xl bg-white shadow-inner border">
              <img src={qr} alt="رمز الاقتران QR" width={220} height={220} className="rounded-lg" />
            </div>
            <div className="text-center">
              <div className="text-xs text-muted-foreground">الرمز اليدوي</div>
              <div className="font-mono text-2xl font-bold tracking-[0.3em] text-primary">{code}</div>
            </div>
            {step === "scan" ? (
              <Button className="w-full" onClick={confirm} disabled={loading}>
                {loading ? "جارٍ تبادل المفاتيح…" : "لقد مسحت الرمز — تأكيد الاقتران"}
              </Button>
            ) : (
              <div className="rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-sm font-medium text-center py-3">
                تم الاقتران وتشفير القناة بنجاح (TLS + E2E)
              </div>
            )}
          </div>
        ) : (
          <div className="py-8 text-center text-muted-foreground">جارٍ توليد الرمز…</div>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function DevicesView() {
  const { devices } = useNexus()
  const online = devices.filter((d) => d.state === "connected")
  const offline = devices.filter((d) => d.state !== "connected")

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">الأجهزة المقترنة</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            الاكتشاف عبر mDNS · اقتران بـ QR · قناة مشفرة ببروتوكول Nexus
          </p>
        </div>
        <div className="flex gap-2">
          <PairDialog />
          <Button variant="outline" size="sm" className="gap-1.5">
            <Plus className="w-4 h-4" /> محاكاة اكتشاف
          </Button>
        </div>
      </div>

      <section>
        <h2 className="text-sm font-semibold text-muted-foreground mb-3">متصل الآن ({online.length})</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {online.map((d) => <DeviceCard key={d.id} d={d} />)}
        </div>
      </section>

      {offline.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground mb-3">غير متصل ({offline.length})</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {offline.map((d) => <DeviceCard key={d.id} d={d} />)}
          </div>
        </section>
      )}
    </div>
  )
}
