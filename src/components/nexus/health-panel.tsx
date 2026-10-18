"use client"

// مركز صحة الأجهزة (عقد §27) — لوحة داخل صفحة الأجهزة
// عينات زمنية (بطارية/استجابة/إتاحة) + تنبيهات عبور — تُحدَّث كل 30 ثانية
// مع زر التقاط عينة فوري ومحدد نافذة (1س/6س/24س).
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNexus } from "@/lib/store"
import { useI18n } from "@/lib/i18n"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip as RTooltip,
} from "recharts"
import {
  HeartPulse, RefreshCcw, Camera, WifiOff, Wifi, BatteryLow, Gauge, HardDrive,
  TriangleAlert, Activity,
} from "lucide-react"
import { toast } from "sonner"

const DEV_COLORS = ["#0d9488", "#f59e0b", "#6366f1", "#e11d48", "#0284c7", "#84cc16", "#a855f7"]
const WINDOWS_OPTS: { id: "1h" | "6h" | "24h"; ar: string }[] = [
  { id: "1h", ar: "ساعة" },
  { id: "6h", ar: "6 ساعات" },
  { id: "24h", ar: "24 ساعة" },
]

interface HealthSnapshot {
  window: string
  devices: {
    deviceId: string; name: string; kind: string; online: boolean
    uptimePct: number | null; avgRttMs: number | null; minBattery: number | null; samples: number
  }[]
  series: { battery: Record<string, number | null>[]; rtt: Record<string, number | null>[] }
  alerts: { id: string; deviceId: string; deviceName: string; type: string; level: string; createdAt: number }[]
  counts: { samples: number; events: number }
  pulse?: { active: boolean; intervalMs: number; startedAt: number }
}

const timeLabel = (t: number) =>
  new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })

export function HealthPanel() {
  const { devices } = useNexus()
  const { t, lang } = useI18n()
  const [window_, setWindow_] = useState<"1h" | "6h" | "24h">("1h")
  const [snap, setSnap] = useState<HealthSnapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const wref = useRef(window_)
  wref.current = window_

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/devices/health?device=all&window=${wref.current}`)
      if (r.ok) setSnap(await r.json())
    } catch { /* الشبكة تقطع — التحديث القادم يعيد المحاولة */ }
  }, [])

  useEffect(() => {
    load()
    const iv = setInterval(load, 30_000)
    return () => clearInterval(iv)
  }, [load, window_])

  const capture = async () => {
    setBusy(true)
    try {
      const r = await fetch("/api/devices/health", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "force-sample" }),
      })
      const j = await r.json()
      if (j.ok) toast.success(`${t("التُقطت")} ${j.recorded} ${t("عينة")}`)
      else toast.error(t("فشل التقاط العينة"))
      await load()
    } finally {
      setBusy(false)
    }
  }

  const online = devices.filter((d) => d.state === "connected")
  const onlineSeries = snap?.devices.filter((d) => d.online && d.avgRttMs !== null) ?? []
  const avgRtt = onlineSeries.length
    ? Math.round(onlineSeries.reduce((a, d) => a + (d.avgRttMs ?? 0), 0) / onlineSeries.length)
    : null
  const minBatt = snap?.devices.length
    ? Math.min(...snap.devices.filter((d) => d.minBattery !== null).map((d) => d.minBattery as number))
    : null
  const alerts = snap?.alerts ?? []

  const colorOf = useMemo(() => {
    const m = new Map<string, string>()
    snap?.devices.forEach((d, i) => m.set(d.deviceId, DEV_COLORS[i % DEV_COLORS.length]))
    return m
  }, [snap])

  const relTime = (ts: number) => {
    const diff = Math.max(0, Date.now() - ts)
    const m = Math.floor(diff / 60_000)
    if (lang === "en") return m < 1 ? "just now" : m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago`
    if (m < 1) return "الآن"
    if (m < 60) return `منذ ${m} دقيقة`
    return `منذ ${Math.floor(m / 60)} ساعة`
  }

  const alertIcon = (type: string) =>
    type === "offline" ? WifiOff : type === "low-battery" ? BatteryLow : type === "rtt-degraded" ? Gauge : type === "storage-high" ? HardDrive : Wifi
  const alertPhrase = (type: string) =>
    type === "offline" ? t("انقطع الاتصال")
      : type === "online" ? t("عاد للاتصال")
      : type === "low-battery" ? t("بطارية منخفضة")
      : type === "rtt-degraded" ? t("استجابة متدهورة")
      : type === "storage-high" ? t("التخزين شبه ممتلئ")
      : type

  return (
    <Card className="overflow-hidden border-primary/20">
      <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-l from-teal-400 via-cyan-500 to-teal-400" />
      <CardContent className="p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl grid place-items-center bg-teal-500/12 text-teal-600 dark:text-teal-400">
              <HeartPulse className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="font-bold">{t("مركز صحة الأجهزة")}</h2>
                {snap?.pulse?.active && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-teal-500/12 text-teal-600 dark:text-teal-400 px-2 py-0.5 text-[10px] font-medium" data-testid="pulse-badge">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal-500 opacity-60" />
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-teal-500" />
                    </span>
                    {t("نبض ذاتي من الخادم — كل 4 ثوانٍ")}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t("قياس زمني للبطارية والاستجابة والإتاحة — عينة كل 30 ثانية، احتفاظ 24 ساعة")}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="flex rounded-xl border bg-muted/40 p-0.5">
              {WINDOWS_OPTS.map((w) => (
                <button
                  key={w.id}
                  onClick={() => setWindow_(w.id)}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded-lg transition-all ${
                    window_ === w.id ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t(w.ar)}
                </button>
              ))}
            </div>
            <Button size="sm" variant="outline" className="gap-1.5" disabled={busy} onClick={capture}>
              <Camera className="w-3.5 h-3.5" /> {t("التقاط عينة الآن")}
            </Button>
            <Button size="sm" variant="ghost" className="gap-1.5" onClick={load} aria-label={t("تحديث")}>
              <RefreshCcw className={`w-3.5 h-3.5 ${busy ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {/* شرائح الملخص */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="rounded-xl bg-muted/50 px-3 py-2">
            <div className="text-[11px] text-muted-foreground flex items-center gap-1"><Activity className="w-3 h-3" /> {t("متصل الآن")}</div>
            <div className="text-lg font-bold">{online.length}<span className="text-xs text-muted-foreground"> / {devices.length}</span></div>
          </div>
          <div className="rounded-xl bg-muted/50 px-3 py-2">
            <div className="text-[11px] text-muted-foreground">{t("متوسط الاستجابة")}</div>
            <div className="text-lg font-bold">{avgRtt !== null ? `${avgRtt}ms` : "—"}</div>
          </div>
          <div className="rounded-xl bg-muted/50 px-3 py-2">
            <div className="text-[11px] text-muted-foreground">{t("أدنى بطارية")}</div>
            <div className={`text-lg font-bold ${minBatt !== null && minBatt <= 15 ? "text-rose-600 dark:text-rose-400" : ""}`}>
              {minBatt !== null ? `${minBatt}%` : "—"}
            </div>
          </div>
          <div className="rounded-xl bg-muted/50 px-3 py-2">
            <div className="text-[11px] text-muted-foreground">{t("تنبيهات النافذة")}</div>
            <div className={`text-lg font-bold ${alerts.length ? "text-amber-600 dark:text-amber-400" : ""}`}>{alerts.length}</div>
          </div>
        </div>

        {/* المخططات */}
        <div className="grid gap-3 lg:grid-cols-2">
          <ChartCard
            title={t("البطارية %")}
            data={snap?.series.battery ?? []}
            devices={snap?.devices ?? []}
            colorOf={colorOf}
            yMax={100}
            empty={t("لا عينات بعد — تُسجَّل تلقائيًا من نبض الأجهزة، أو التقط عينة الآن")}
          />
          <ChartCard
            title={t("الاستجابة ms")}
            data={snap?.series.rtt ?? []}
            devices={snap?.devices ?? []}
            colorOf={colorOf}
            yMax={undefined}
            empty={t("لا عينات بعد — تُسجَّل تلقائيًا من نبض الأجهزة، أو التقط عينة الآن")}
          />
        </div>

        {/* جدول الإتاحة (مفتاح المخططات) */}
        {snap && snap.devices.length > 0 && (
          <div className="rounded-xl border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/60 text-muted-foreground">
                <tr>
                  <th className="text-start font-medium px-3 py-2">{t("الجهاز")}</th>
                  <th className="text-start font-medium px-3 py-2">{t("الإتاحة")}</th>
                  <th className="text-start font-medium px-3 py-2 hidden sm:table-cell">{t("متوسط الاستجابة")}</th>
                  <th className="text-start font-medium px-3 py-2 hidden sm:table-cell">{t("أدنى بطارية")}</th>
                  <th className="text-start font-medium px-3 py-2">{t("عينات")}</th>
                </tr>
              </thead>
              <tbody>
                {snap.devices.map((d) => (
                  <tr key={d.deviceId} className="border-t">
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1.5 font-medium">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: colorOf.get(d.deviceId) ?? "#71717a" }} />
                        {d.name}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {d.uptimePct === null ? <span className="text-muted-foreground">—</span> : (
                        <Badge variant={d.uptimePct >= 95 ? "default" : d.uptimePct >= 60 ? "secondary" : "outline"} className="text-[10px]">
                          {d.uptimePct}%
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 hidden sm:table-cell">{d.avgRttMs !== null ? `${d.avgRttMs}ms` : "—"}</td>
                    <td className="px-3 py-2 hidden sm:table-cell">{d.minBattery !== null ? `${d.minBattery}%` : "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{d.samples}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* التنبيهات */}
        <div className="space-y-1.5">
          <h3 className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
            <TriangleAlert className="w-3.5 h-3.5 text-amber-500" /> {t("تنبيهات النافذة")}
          </h3>
          {alerts.length === 0 ? (
            <div className="text-xs text-muted-foreground rounded-xl bg-muted/40 px-3 py-2.5">
              {t("لا تنبيهات خلال النافذة المحددة")}
            </div>
          ) : (
            <ul className="space-y-1">
              {alerts.slice(0, 6).map((a) => {
                const Icon = alertIcon(a.type)
                return (
                  <li key={a.id} className="flex items-center gap-2 rounded-xl bg-amber-500/8 dark:bg-amber-500/10 px-3 py-1.5 text-xs">
                    <Icon className="w-3.5 h-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                    <span className="font-medium">{a.deviceName}</span>
                    <span className="text-muted-foreground">— {alertPhrase(a.type)}</span>
                    <span className="ms-auto text-[10px] text-muted-foreground shrink-0">{relTime(a.createdAt)}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* حد صادق — نبض الخدمة الذاتي (§27.هـ) */}
        <p className="text-[11px] text-muted-foreground border-t pt-2.5">
          {t("القياس ذاتي من عملية الخادم: إغلاق كل الصفحات لا يوقف توليد العينات — أجهزة البذرة تُستنزف محاكاةً ما دام الخادم يعمل، والوكيل الحقيقي يتجاوزها عبر report")}
        </p>
      </CardContent>
    </Card>
  )
}

function ChartCard({
  title, data, devices, colorOf, yMax, empty,
}: {
  title: string
  data: Record<string, number | null>[]
  devices: { deviceId: string; name: string; samples: number }[]
  colorOf: Map<string, string>
  yMax?: number
  empty: string
}) {
  const { t } = useI18n()
  const has = data.length > 0
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="text-xs font-semibold text-muted-foreground mb-1.5">{title}</div>
      {has ? (
        <ResponsiveContainer width="100%" height={168}>
          <LineChart data={data} margin={{ top: 4, bottom: 0, left: -18, right: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.08} />
            <XAxis dataKey="t" tickFormatter={timeLabel} tick={{ fontSize: 10 }} interval="preserveStartEnd" minTickGap={42} stroke="currentColor" opacity={0.4} />
            <YAxis domain={yMax ? [0, yMax] : ["auto", "auto"]} tick={{ fontSize: 10 }} stroke="currentColor" opacity={0.4} width={34} />
            <RTooltip
              contentStyle={{ fontSize: 11, borderRadius: 12, border: "1px solid rgba(0,0,0,0.08)" }}
              labelFormatter={(l) => timeLabel(Number(l))}
            />
            {devices.filter((d) => d.samples > 0).map((d) => (
              <Line
                key={d.deviceId} type="monotone" dataKey={d.deviceId}
                name={d.name} stroke={colorOf.get(d.deviceId) ?? "#71717a"}
                strokeWidth={2} dot={false} connectNulls isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <div className="h-[168px] grid place-items-center text-xs text-muted-foreground px-4 text-center">{empty}</div>
      )}
    </div>
  )
}
