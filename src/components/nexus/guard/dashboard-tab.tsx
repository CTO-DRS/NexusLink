"use client"
// NexusLink — لوحة الجهاز: بطارية · تخزين · ذاكرة · معالج · معلومات النظام
import { useEffect, useMemo } from "react"
import { Area, AreaChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts"
import { BatteryCharging, Cpu, HardDrive, Info, MemoryStick, MonitorSmartphone, Zap } from "lucide-react"
import { useGuard, fmtUptime, SYSTEM_INFO } from "@/lib/guard-store"
import { useNexus, fmtSize } from "@/lib/store"
import { GuardCard, InfoRow, RatioRing } from "./guard-bits"
import { cn } from "@/lib/utils"

const DEVICE_COLORS: Record<string, string> = {
  "galaxy-s24": "hsl(174 62% 38%)",
  "redmi-note13": "hsl(32 92% 48%)",
  "pc-office": "hsl(262 60% 55%)",
  "nexus-tv": "hsl(0 78% 56%)",
  "ipad-pro": "hsl(210 12% 55%)",
}

const CATS = [
  { key: "photos", label: "الصور", color: "#10b981" },
  { key: "videos", label: "الفيديو", color: "#f43f5e" },
  { key: "audio", label: "الصوت", color: "#f59e0b" },
  { key: "apps", label: "التطبيقات", color: "#8b5cf6" },
  { key: "docs", label: "المستندات", color: "#14b8a6" },
  { key: "other", label: "أخرى", color: "#64748b" },
]

export function DashboardTab() {
  const { targetDeviceId, setTargetDevice, metrics, apps, setCheck, tickMetrics } = useGuard()
  const devices = useNexus((s) => s.devices)
  const dev = devices.find((d) => d.id === targetDeviceId)

  // إثبات لوحة الجهاز في اختبار النجاح
  useEffect(() => {
    const t = setTimeout(() => setCheck("dashboard"), 600)
    return () => clearTimeout(t)
  }, [setCheck, tickMetrics])

  const m = metrics[targetDeviceId]
  const appsGB = useMemo(() => apps.reduce((acc, a) => acc + a.sizeMB, 0) / 1024, [apps])

  const storageData = useMemo(() => {
    if (!m) return []
    const used = m.storageUsedGB
    const photos = used * 0.32
    const videos = used * 0.22
    const audio = used * 0.08
    const docs = used * 0.07
    const other = Math.max(0.5, used - photos - videos - audio - docs - appsGB)
    return [
      { name: "الصور", value: photos, fill: "#10b981" },
      { name: "الفيديو", value: videos, fill: "#f43f5e" },
      { name: "الصوت", value: audio, fill: "#f59e0b" },
      { name: "التطبيقات", value: appsGB, fill: "#8b5cf6" },
      { name: "المستندات", value: docs, fill: "#14b8a6" },
      { name: "أخرى", value: other, fill: "#64748b" },
    ]
  }, [m, appsGB])

  const cpuData = useMemo(
    () => (m?.cpuHist ?? []).map((v, i) => ({ i, v: Math.round(v * 10) / 10 })),
    [m?.cpuHist]
  )

  if (!m || !dev) return null
  const isPhone = dev.kind === "phone" || dev.kind === "tablet"
  const storagePct = (m.storageUsedGB / m.storageTotalGB) * 100
  const ramPct = (m.ramUsedGB / m.ramTotalGB) * 100

  return (
    <div className="space-y-4">
      {/* اختيار الجهاز */}
      <div className="flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="اختيار جهاز اللوحة">
        {devices.map((d) => (
          <button
            key={d.id}
            onClick={() => setTargetDevice(d.id)}
            role="tab"
            aria-selected={d.id === targetDeviceId}
            className={cn(
              "flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11.5px] font-semibold whitespace-nowrap border transition-all",
              d.id === targetDeviceId ? "bg-primary text-primary-foreground border-primary shadow-md shadow-primary/20" : "bg-card text-muted-foreground hover:bg-accent"
            )}
          >
            <MonitorSmartphone className="w-3.5 h-3.5" />
            {d.name}
            <span className={cn("w-1.5 h-1.5 rounded-full", d.state === "connected" ? "bg-emerald-400" : "bg-zinc-400")} />
          </button>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* البطارية */}
        <GuardCard title={isPhone ? "البطارية" : "الطاقة"} icon={isPhone ? BatteryCharging : Zap}>
          <div className="flex items-center gap-5">
            <RatioRing
              value={m.battery}
              label={`${m.battery}%`}
              sub={m.charging ? "يشحن الآن" : undefined}
              color={m.charging ? "#10b981" : m.battery < 15 ? "#ef4444" : m.battery < 30 ? "#f59e0b" : "#10b981"}
            />
            <div className="flex-1 space-y-1 min-w-0">
              <InfoRow label="الحالة" value={m.charging ? "متصل بالشاحن" : "على البطارية"} />
              <InfoRow label="الحرارة" value={`${m.temp.toFixed(1)}°م`} />
              {isPhone && <InfoRow label="الصحة" value="92% — ممتازة" />}
              {isPhone && <InfoRow label="الاستهلاك المتوقع" value={`≈ ${Math.round(m.battery * 0.55)} ساعة شاشة`} />}
              {!isPhone && <InfoRow label="المصدر" value="طاقة مباشرة" />}
            </div>
          </div>
        </GuardCard>

        {/* التخزين */}
        <GuardCard title="التخزين" icon={HardDrive} extra={<span className="text-[10.5px] text-muted-foreground">{storagePct.toFixed(0)}% مستخدم</span>}>
          <div className="flex items-center gap-4">
            <div className="w-32 h-32 shrink-0 relative">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={storageData} dataKey="value" innerRadius={36} outerRadius={58} paddingAngle={2} strokeWidth={0}>
                    {storageData.map((c, i) => <Cell key={i} fill={c.fill} />)}
                  </Pie>
                  <RTooltip formatter={(v: number) => `${v.toFixed(1)} GB`} contentStyle={{ fontSize: 11, borderRadius: 12, direction: "rtl" }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 grid place-items-center pointer-events-none">
                <div className="text-center leading-tight">
                  <div className="font-black text-[13px]">{m.storageUsedGB.toFixed(0)}</div>
                  <div className="text-[9px] text-muted-foreground">من {m.storageTotalGB} GB</div>
                </div>
              </div>
            </div>
            <div className="flex-1 grid grid-cols-2 gap-x-3 gap-y-1.5 min-w-0">
              {storageData.map((c) => (
                <div key={c.name} className="flex items-center gap-1.5 text-[10.5px] min-w-0">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: c.fill }} />
                  <span className="text-muted-foreground truncate">{c.name}</span>
                  <span className="font-bold ms-auto">{c.value.toFixed(0)}G</span>
                </div>
              ))}
            </div>
          </div>
        </GuardCard>

        {/* الذاكرة */}
        <GuardCard title="الذاكرة العشوائية (RAM)" icon={MemoryStick}>
          <div className="flex items-center gap-5">
            <RatioRing
              value={ramPct}
              label={`${ramPct.toFixed(0)}%`}
              sub={`${m.ramUsedGB.toFixed(1)}/${m.ramTotalGB}G`}
              color={ramPct > 85 ? "#ef4444" : ramPct > 65 ? "#f59e0b" : "#8b5cf6"}
            />
            <div className="flex-1 space-y-1 min-w-0">
              <InfoRow label="المستخدمة" value={`${m.ramUsedGB.toFixed(1)} GB`} />
              <InfoRow label="المتاحة" value={`${(m.ramTotalGB - m.ramUsedGB).toFixed(1)} GB`} />
              <InfoRow label="الإجمالية" value={`${m.ramTotalGB} GB`} />
              <div className="h-10 -mx-2">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={cpuData.slice(-30)}>
                    <defs>
                      <linearGradient id="ramGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <Area type="monotone" dataKey="v" stroke="#8b5cf6" strokeWidth={1.5} fill="url(#ramGrad)" isAnimationActive={false} />
                    <XAxis hide dataKey="i" />
                    <YAxis hide domain={[0, m.ramTotalGB]} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </GuardCard>

        {/* المعالج */}
        <GuardCard
          title="المعالج"
          icon={Cpu}
          extra={<span className="text-[10.5px] font-mono text-muted-foreground dir-ltr">{m.cpu.toFixed(1)}%</span>}
        >
          <div className="h-28 -mx-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={cpuData} margin={{ top: 4, bottom: 0, start: 0, end: 0 }}>
                <defs>
                  <linearGradient id="cpuGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0d9488" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="#0d9488" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis hide dataKey="i" />
                <YAxis hide domain={[0, 100]} />
                <RTooltip
                  formatter={(v: number) => [`${v}%`, "الاستخدام"]}
                  labelFormatter={() => ""}
                  contentStyle={{ fontSize: 11, borderRadius: 12, direction: "rtl" }}
                />
                <Area type="monotone" dataKey="v" stroke="#0d9488" strokeWidth={2} fill="url(#cpuGrad)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-muted/60 py-1.5">
              <div className="text-[10px] text-muted-foreground">الآن</div>
              <div className="text-[12.5px] font-bold">{m.cpu.toFixed(0)}%</div>
            </div>
            <div className="rounded-xl bg-muted/60 py-1.5">
              <div className="text-[10px] text-muted-foreground">الذروة</div>
              <div className="text-[12.5px] font-bold">{Math.max(...m.cpuHist).toFixed(0)}%</div>
            </div>
            <div className="rounded-xl bg-muted/60 py-1.5">
              <div className="text-[10px] text-muted-foreground">التردد</div>
              <div className="text-[12.5px] font-bold" dir="ltr">{dev.kind === "desktop" ? "5.4GHz" : "3.2GHz"}</div>
            </div>
          </div>
        </GuardCard>

        {/* معلومات النظام */}
        <GuardCard title="معلومات النظام" icon={Info} className="md:col-span-2">
          <div className="grid gap-x-8 sm:grid-cols-2">
            <div>
              {SYS_ROWS[targetDeviceId]?.slice(0, Math.ceil((SYS_ROWS[targetDeviceId]?.length ?? 0) / 2)).map((r) => (
                <InfoRow key={r.label} label={r.label} value={r.value} mono />
              ))}
            </div>
            <div>
              {SYS_ROWS[targetDeviceId]?.slice(Math.ceil((SYS_ROWS[targetDeviceId]?.length ?? 0) / 2)).map((r) => (
                <InfoRow key={r.label} label={r.label} value={r.value} mono />
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
            <MiniStat label="مدة التشغيل" value={fmtUptime(m.uptimeSec)} />
            <MiniStat label="آخر ظهور" value={dev.state === "connected" ? "الآن (نبض حي)" : "منذ ساعة"} />
            <MiniStat label="زمن الاستجابة" value={`${dev.rttMs}ms`} />
            <MiniStat label="الحجم الافتراضي" value={fmtSize(dev.storageUsed)} />
          </div>
        </GuardCard>
      </div>
    </div>
  )
}
const SYS_ROWS = SYSTEM_INFO

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-card px-2.5 py-2 text-center">
      <div className="text-[9.5px] text-muted-foreground">{label}</div>
      <div className="text-[11px] font-bold mt-0.5 truncate">{value}</div>
    </div>
  )
}
