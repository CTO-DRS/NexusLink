"use client"

/**
 * أدوات NexusLink — المرحلة 11 (بنود 7 و9 و10 + بوابة التحديث)
 * تبويبات: اختبار السرعة · التشخيص · الأجهزة الافتراضية (§22) · الطرفية CLI · البناء والتوزيع
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Progress } from "@/components/ui/progress"
import { useNexus } from "@/lib/store"
import { useI18n } from "@/lib/i18n"
import { isTauri, tauriInvoke } from "@/lib/tauri"
import { CliTerminal } from "./cli-terminal"
import { GuestShareTab } from "./guest-share-tab"
import {
  Gauge, Stethoscope, SquareTerminal, Package, Download, Upload, Timer,
  RefreshCw, CheckCircle2, AlertTriangle, XCircle, MinusCircle, Battery,
  BatteryCharging, Wifi, Database, Server, Cpu, FileDown, Rocket, Plane,
  History, Languages, ShieldCheck, MonitorSmartphone, HardDriveDownload,
  Camera, Mic, Wrench, DownloadCloud, Volume2, Share2,
} from "lucide-react"

/* ============ Speed test ============ */
interface SpeedResult {
  downMBs: number
  upMBs: number
  rttMs: number
  at: number
}

function SpeedTestTab() {
  const { t } = useI18n()
  const [phase, setPhase] = useState<"idle" | "rtt" | "down" | "up" | "done">("idle")
  const [progress, setProgress] = useState(0)
  const [rtt, setRtt] = useState<number | null>(null)
  const [down, setDown] = useState<number | null>(null)
  const [up, setUp] = useState<number | null>(null)
  const [history, setHistory] = useState<SpeedResult[]>([])
  const abortRef = useRef<AbortController | null>(null)

  const measureRtt = useCallback(async () => {
    const samples: number[] = []
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now()
      await fetch("/api/tools/ping", { cache: "no-store" })
      samples.push(performance.now() - t0)
    }
    samples.sort((a, b) => a - b)
    return samples[Math.floor(samples.length / 2)]
  }, [])

  const run = useCallback(async () => {
    if (phase !== "idle" && phase !== "done") return
    abortRef.current = new AbortController()
    const sig = abortRef.current.signal
    try {
      setPhase("rtt"); setProgress(5); setDown(null); setUp(null)
      const r = await measureRtt()
      setRtt(r)
      setProgress(20)

      setPhase("down")
      const bytes = 12 * 1024 * 1024
      const t0 = performance.now()
      const resp = await fetch(`/api/tools/speedtest?bytes=${bytes}`, { cache: "no-store", signal: sig })
      const reader = resp.body?.getReader()
      let received = 0
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          received += value?.length ?? 0
          setProgress(20 + Math.round((received / bytes) * 45))
        }
      } else {
        await resp.arrayBuffer()
      }
      const dSecs = (performance.now() - t0) / 1000
      const dMBs = bytes / 1048576 / dSecs
      setDown(dMBs)
      setProgress(68)

      setPhase("up")
      const upBytes = 4 * 1024 * 1024
      const chunk = new Uint8Array(256 * 1024)
      crypto.getRandomValues(chunk)
      const t1 = performance.now()
      let sent = 0
      for (let i = 0; i < upBytes / chunk.length; i++) {
        await fetch("/api/tools/speedtest", { method: "POST", body: chunk, cache: "no-store", signal: sig })
        sent += chunk.length
        setProgress(68 + Math.round((sent / upBytes) * 28))
      }
      const uSecs = (performance.now() - t1) / 1000
      const uMBs = upBytes / 1048576 / uSecs
      setUp(uMBs)
      setProgress(100)
      setPhase("done")
      setHistory((h) => [{ downMBs: dMBs, upMBs: uMBs, rttMs: r, at: Date.now() }, ...h].slice(0, 8))
    } catch {
      setPhase("idle")
      setProgress(0)
    }
  }, [phase, measureRtt])

  useEffect(() => () => abortRef.current?.abort(), [])

  const best = history.reduce((a, h) => (h.downMBs > (a?.downMBs ?? 0) ? h : a), history[0])

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-primary/12 text-primary grid place-items-center">
                <Gauge className="w-5 h-5" />
              </div>
              <div>
                <div className="font-bold">{t("اختبار سرعة الشبكة المحلية")}</div>
                <p className="text-xs text-muted-foreground max-w-md">
                  {t("يقيس المسار الحقيقي بين هذا المتصفح وخادم نواة NexusLink عبر الشبكة — وليس الإنترنت")}
                </p>
              </div>
            </div>
            <Button onClick={run} disabled={phase !== "idle" && phase !== "done"} className="gap-2">
              {(phase !== "idle" && phase !== "done") ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Timer className="w-4 h-4" />}
              {phase === "idle" || phase === "done" ? t("بدء الاختبار") : t("جارٍ القياس…")}
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-6">
            <div className="rounded-2xl border p-4 text-center" aria-live="polite">
              <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground"><Download className="w-3.5 h-3.5" /> {t("تنزيل")}</div>
              <div className="text-3xl font-extrabold mt-1 tabular-nums" data-no-i18n>{down != null ? down.toFixed(1) : "—"}</div>
              <div className="text-[11px] text-muted-foreground" data-no-i18n>MB/s</div>
            </div>
            <div className="rounded-2xl border p-4 text-center">
              <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground"><Upload className="w-3.5 h-3.5" /> {t("رفع")}</div>
              <div className="text-3xl font-extrabold mt-1 tabular-nums" data-no-i18n>{up != null ? up.toFixed(1) : "—"}</div>
              <div className="text-[11px] text-muted-foreground" data-no-i18n>MB/s</div>
            </div>
            <div className="rounded-2xl border p-4 text-center">
              <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground"><Timer className="w-3.5 h-3.5" /> {t("زمن الاستجابة")}</div>
              <div className="text-3xl font-extrabold mt-1 tabular-nums" data-no-i18n>{rtt != null ? Math.round(rtt) : "—"}</div>
              <div className="text-[11px] text-muted-foreground" data-no-i18n>ms</div>
            </div>
          </div>

          {(phase !== "idle" && phase !== "done") && (
            <div className="mt-5 space-y-1.5">
              <Progress value={progress} />
              <div className="text-[11px] text-muted-foreground text-center">
                {phase === "rtt" && t("يقيس زمن الاستجابة…")}
                {phase === "down" && t("ينقل بيانات الاختبار (تنزيل 12MB)…")}
                {phase === "up" && t("يرفع بيانات الاختبار (رفع 4MB)…")}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {history.length > 0 && (
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2 text-sm font-semibold mb-3">
              <History className="w-4 h-4 text-primary" /> {t("سجل القياسات")}
              {best && <Badge variant="secondary" className="ms-auto">{t("أفضل تنزيل")} {best.downMBs.toFixed(1)} MB/s</Badge>}
            </div>
            <div className="space-y-1.5">
              {history.map((h) => (
                <div key={h.at} className="flex items-center gap-3 text-xs rounded-xl border px-3 py-2" data-no-i18n>
                  <span className="text-muted-foreground tabular-nums">{new Date(h.at).toLocaleTimeString()}</span>
                  <span className="tabular-nums">↓ {h.downMBs.toFixed(1)}</span>
                  <span className="tabular-nums">↑ {h.upMBs.toFixed(1)}</span>
                  <span className="tabular-nums text-muted-foreground ms-auto">{Math.round(h.rttMs)} ms</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

/* ============ Diagnostics ============ */
type CheckStatus = "pass" | "warn" | "fail" | "na"
interface Check {
  id: string
  label: string
  status: CheckStatus
  detail: string
}

const STATUS_ICON: Record<CheckStatus, typeof CheckCircle2> = {
  pass: CheckCircle2,
  warn: AlertTriangle,
  fail: XCircle,
  na: MinusCircle,
}
const STATUS_CLS: Record<CheckStatus, string> = {
  pass: "text-emerald-500",
  warn: "text-amber-500",
  fail: "text-red-500",
  na: "text-muted-foreground",
}

function DiagnosticsTab() {
  const { t } = useI18n()
  const [checks, setChecks] = useState<Check[]>([])
  const [running, setRunning] = useState(false)
  const [nativeBusy, setNativeBusy] = useState(false)
  const versionRef = useRef<string>("1.0.0")

  // FA-harden — القياس الأصلي الحقيقي (من محرك Rust لا المتصفح): تنزيل 24MB + رفع 8MB
  const runNativeSpeed = useCallback(async () => {
    if (!isTauri()) return
    setNativeBusy(true)
    try {
      const r = await tauriInvoke<{ ok: boolean; downMBs: number | null; upMBs: number | null; downError?: string; upError?: string }>("diag_speed_test")
      setChecks((cur) => [
        ...cur.filter((c) => c.id !== "native-speed"),
        {
          id: "native-speed",
          label: t("قياس السرعة الأصلي (محرك Rust)"),
          status: r?.ok ? "pass" : "fail",
          detail: r?.ok
            ? `↓ ${r.downMBs ?? "—"} MB/s · ↑ ${r.upMBs ?? "—"} MB/s`
            : r?.downError || r?.upError || t("تعذر القياس"),
        },
      ])
    } catch {
      setChecks((cur) => [...cur.filter((c) => c.id !== "native-speed"), { id: "native-speed", label: t("قياس السرعة الأصلي (محرك Rust)"), status: "fail", detail: t("متاح في نافذة التطبيق فقط") }])
    } finally {
      setNativeBusy(false)
    }
  }, [t])

  const runDiag = useCallback(async () => {
    setRunning(true)
    const out: Check[] = []
    const push = (id: string, label: string, status: CheckStatus, detail: string) =>
      out.push({ id, label, status, detail })

    // 1) API RTT
    try {
      const t0 = performance.now()
      await fetch("/api/tools/ping", { cache: "no-store" })
      const ms = performance.now() - t0
      push("rtt", t("زمن استجابة النواة"), ms < 150 ? "pass" : ms < 400 ? "warn" : "fail", `${Math.round(ms)} ms`)
    } catch {
      push("rtt", t("زمن استجابة النواة"), "fail", t("تعذر الوصول إلى النواة"))
    }

    // 2) server snapshot + كل منافذ Sidecar (العقد §1 حرفيًا — FA-harden بند 5)
    try {
      const r = await fetch("/api/tools/diag", { cache: "no-store" })
      const j = await r.json()
      push("comms", t("جسر الاتصالات (الهاتف الافتراضي)"), j.services.commsBridge === "up" ? "pass" : "fail", `:3003 ${j.services.commsBridge}`)
      push("remote", t("جسر التحكم عن بُعد"), j.services.remoteBridge === "up" ? "pass" : "fail", `:3004 ${j.services.remoteBridge}`)
      push("srvmem", t("ذاكرة النواة (RSS)"), j.memory.rssMB < 200 ? "pass" : "warn", `${j.memory.rssMB} MB · ${j.runtime}`)
      push("storage", t("تخزين NexusLink المحلي"), "pass", `${(j.storageBytes / 1048576).toFixed(1)} MB`)
      // منافذ الجسور المتبقية + البوابة — فحص handshake فعلي من النواة
      const roleNames: Record<string, string> = { media: t("الوسائط"), guard: t("الحماية"), prod: t("الإنتاجية"), sec: t("التشفير E2E"), gateway: t("البوابة العامة") }
      for (const p of j.ports ?? []) {
        if (p.port === 3000 || p.port === 3003 || p.port === 3004) continue // مغطاة أعلاه
        push(`port-${p.port}`, `${t("منفذ Sidecar")} :${p.port} (${roleNames[p.role] ?? p.role})`, p.ok ? "pass" : "warn", p.ok ? t("يعمل") : t("متوقف"))
      }
    } catch {
      push("srv", t("لقطة النواة التشخيصية"), "fail", t("تعذر جلب /api/tools/diag"))
    }

    // 2-ب) FA-harden — الفحص الأصلي من الطبقة Rust (TCP حقيقي + حالة الخمول/القفل)
    if (isTauri()) {
      try {
        const r = await tauriInvoke<{ ports: { port: number; role: string; ok: boolean; ms: number }[]; up: number; total: number }>("diag_sidecar_ports")
        push("native-ports", t("فحص أصلي لمنافذ Sidecar (TCP)"), r?.up === r?.total ? "pass" : r?.up ? "warn" : "fail", `${r?.up ?? 0}/${r?.total ?? 0} ${t("تعمل")} · ${r?.ports?.map((p) => `:${p.port}${p.ok ? "✓" : "✗"}`).join(" ") ?? ""}`)
      } catch { push("native-ports", t("فحص أصلي لمنافذ Sidecar (TCP)"), "na", t("الطبقة الأصلية غير جاهزة")) }
      try {
        const r = await tauriInvoke<{ idleSecs: number | null; idleMode: boolean; locked: boolean }>("diag_idle_state")
        push("native-idle", t("كشف الخمول الأصلي"), r?.idleSecs !== null && r?.idleSecs !== undefined ? "pass" : "na", r?.idleSecs != null ? `${r.idleSecs}s · ${r.idleMode ? t("وضع التوفير مفعّل") : t("نشط")} · ${r.locked ? t("مقفول") : t("غير مقفول")}` : t("المنصة بلا كشف خمول (Wayland)"))
      } catch { push("native-idle", t("كشف الخمول الأصلي"), "na", "—") }
      // R4 ① (عقد §19) — الشاشة الثانية: حالة السائق/المنصة بصدق
      try {
        const r = await tauriInvoke<{
          platform: string; supported: boolean; note?: string;
          driverInstalled?: boolean; driverEnabled?: boolean; settingsFile?: boolean; modesReady?: boolean; virtualActive?: boolean;
          x11?: boolean; wayland?: boolean; xrandr?: boolean; hasCandidateOutput?: boolean;
          session?: { targetId: string; w: number; h: number } | null;
        }>("vdisplay_status")
        let det = ""
        let st: "pass" | "warn" | "fail" | "na" = "na"
        if (r?.platform === "windows") {
          det = r.driverInstalled
            ? `${t("السائق مثبت")} · ${r.driverEnabled ? t("ممكّن") : t("معطّل")} · ${r.modesReady ? t("الأوضاع جاهزة") : t("أوضاع NexusLink غير مكتوبة")} · ${r.virtualActive ? t("الشاشة الافتراضية نشطة") : t("غير نشطة")}`
            : (r.note ?? t("غير مثبت"))
          st = r.driverInstalled ? (r.virtualActive || !r.modesReady ? "warn" : "pass") : "warn"
        } else if (r?.platform === "linux") {
          det = `${r.x11 ? "X11" : r.wayland ? "Wayland" : t("بلا جلسة عرض")} · xrandr:${r.xrandr ? "✓" : "✗"} · ${r.hasCandidateOutput ? t("مخرج فارغ متاح") : t("لا مخرج فارغ")} ${r.note ?? ""}`
          st = r.supported ? "pass" : "warn"
        } else {
          det = r?.note ?? t("غير مسند — بديل «بث نافذة محددة» جاهز من شاشة الكمبيوتر")
          st = "na"
        }
        if (r?.session) det += ` · ${t("جلسة NexusLink")}: ${r.session.targetId} (${r.session.w}×${r.session.h})`
        push("vdisplay", t("الشاشة الثانية (سائق العرض الافتراضي)"), st, det)
      } catch { push("vdisplay", t("الشاشة الثانية (سائق العرض الافتراضي)"), "na", "—") }
      // §22 (المرحلة 0-وسائط) — حالة كل جهاز افتراضي (مثبت/غير مثبت/نسخته)
      try {
        const r = await tauriInvoke<{ platform?: string; video?: { driver: string; ok: boolean; version?: string | null }; audio?: { driver: string; ok: boolean } }>("media_vcam_status")
        const v = r?.video
        const a = r?.audio
        const camDet = v?.ok
          ? `${v.driver}${v.version ? ` v${v.version}` : ""} — ${t("«NexusLink Camera» جاهزة لـ Zoom/Meet")}`
          : (v?.driver === "v4l2loopback" ? t("لا جهاز v4l2loopback — حمّل الوحدة (راجع الإرشاد)") : t("غير مثبتة — «تثبيت حزمة الكاميرا» من تبويب الأجهزة الافتراضية"))
        push("vcam", t("الكاميرا الافتراضية (NexusLink Camera)"), v?.ok ? "pass" : "warn", camDet)
        push("vmic", t("الميكروفون الافتراضي"), a?.ok ? "pass" : "warn",
          a?.ok ? `${a.driver} — ${t("مكتشف")}` : t("غير مثبت — VB-CABLE/BlackHole (راجع الإرشاد)"))
      } catch {
        push("vcam", t("الكاميرا الافتراضية (NexusLink Camera)"), "na", "—")
        push("vmic", t("الميكروفون الافتراضي"), "na", "—")
      }
    }

    // 3) browser heap
    const perfMem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
    if (perfMem?.usedJSHeapSize) {
      const mb = Math.round(perfMem.usedJSHeapSize / 1048576)
      push("heap", t("ذاكرة واجهة الويب (JS Heap)"), mb < 200 ? "pass" : "warn", `${mb} MB ${t("— هدف التصميم <200MB")}`)
    } else {
      push("heap", t("ذاكرة واجهة الويب (JS Heap)"), "na", t("غير متاح في هذا المتصفح"))
    }

    // 4) storage estimate
    try {
      const est = await navigator.storage?.estimate?.()
      if (est) {
        push("quota", t("حصة التخزين للمتصفح"), "pass", `${((est.usage ?? 0) / 1048576).toFixed(1)} / ${((est.quota ?? 0) / 1073741824).toFixed(1)} GB`)
      }
    } catch { /* skip */ }

    // 5) battery
    try {
      const nav = navigator as unknown as { getBattery?: () => Promise<{ level: number; charging: boolean }> }
      if (nav.getBattery) {
        const b = await nav.getBattery()
        push("battery", t("بطارية هذا الجهاز"), "pass", `${Math.round(b.level * 100)}% · ${b.charging ? t("يشحن الآن") : t("على البطارية")}`)
      } else {
        push("battery", t("بطارية هذا الجهاز"), "na", t("واجهة البطارية غير متاحة في هذا المتصفح"))
      }
    } catch { /* skip */ }

    // 6) network info
    const conn = (navigator as unknown as { connection?: { effectiveType?: string; downlink?: number; rtt?: number } }).connection
    if (conn?.effectiveType) {
      push("net", t("اتصال الشبكة"), "pass", `${conn.effectiveType} · ↓${conn.downlink ?? "—"}Mbps · rtt≈${conn.rtt ?? "—"}ms`)
    } else {
      push("net", t("اتصال الشبكة"), "na", t("معلومات الشبكة غير متاحة"))
    }

    // 7) notifications permission
    try {
      push("notif", t("إذن الإشعارات"), Notification.permission === "granted" ? "pass" : "warn", Notification.permission)
    } catch {
      push("notif", t("إذن الإشعارات"), "na", "—")
    }

    // 8) clipboard permission
    try {
      const p = await navigator.permissions?.query?.({ name: "clipboard-read" as PermissionName })
      push("clip", t("إذن قراءة الحافظة"), p?.state === "granted" ? "pass" : "warn", p?.state ?? "—")
    } catch {
      push("clip", t("إذن قراءة الحافظة"), "na", t("لا يدعم الاستعلام المباشر"))
    }

    // 9) persistent storage
    try {
      const persisted = await navigator.storage?.persisted?.()
      push("persist", t("تخزين دائم (لا eviction)"), persisted ? "pass" : "warn", persisted ? "persisted" : "best-effort")
    } catch { /* skip */ }

    setChecks(out)
    setRunning(false)
  }, [t])

  useEffect(() => {
    const tm = setTimeout(() => {
      void runDiag()
    }, 60)
    return () => clearTimeout(tm)
  }, [runDiag])

  const exportReport = async () => {
    // FA-harden — الإصدار الحقيقي + كامل التفاصيل؛ في نافذة التطبيق حوار حفظ أصلي
    try {
      const v = await fetch("/api/version", { cache: "no-store" }).then((r) => r.json()).catch(() => null)
      versionRef.current = v?.current ?? "1.0.0"
    } catch { /* محلي */ }
    const report = {
      app: "NexusLink",
      version: versionRef.current,
      at: new Date().toISOString(),
      checks,
      platform: typeof navigator !== "undefined" ? navigator.userAgent : "",
    }
    const content = JSON.stringify(report, null, 2)
    if (isTauri()) {
      try {
        const saved = await tauriInvoke<{ save: string | null }>("plugin:dialog|save", {
          options: { title: "NexusLink — تقرير التشخيص", defaultPath: "nexuslink-diagnostic-report.json", filters: [{ name: "JSON", extensions: ["json"] }] },
        })
        const path = (saved as unknown as { save?: string })?.save ?? (saved as unknown as string)
        if (typeof path === "string" && path) {
          const r = await tauriInvoke<{ ok: boolean; bytes: number }>("diag_export", { path, content })
          if (r?.ok) setChecks((cur) => [...cur, { id: "export", label: t("تصدير التقرير"), status: "pass", detail: path }])
          return
        }
      } catch { /* يسقط إلى التنزيل */ }
    }
    const blob = new Blob([content], { type: "application/json" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = "nexuslink-diagnostic-report.json"
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-primary/12 text-primary grid place-items-center">
                <Stethoscope className="w-5 h-5" />
              </div>
              <div>
                <div className="font-bold">{t("أداة تشخيص المشاكل")}</div>
                <p className="text-xs text-muted-foreground max-w-md">
                  {t("فحص شامل: النواة، الجسور الفورية، التخزين، البطارية، الشبكة والأذونات")}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              {isTauri() && (
                <Button variant="outline" onClick={() => void runNativeSpeed()} disabled={nativeBusy} className="gap-2">
                  <Gauge className={`w-4 h-4 ${nativeBusy ? "animate-pulse" : ""}`} /> {t("قياس أصلي")}
                </Button>
              )}
              <Button variant="outline" onClick={() => void exportReport()} disabled={!checks.length} className="gap-2">
                <FileDown className="w-4 h-4" /> {t("تصدير التقرير")}
              </Button>
              <Button onClick={runDiag} disabled={running} className="gap-2">
                <RefreshCw className={`w-4 h-4 ${running ? "animate-spin" : ""}`} /> {t("إعادة الفحص")}
              </Button>
            </div>
          </div>

          <div className="mt-5 space-y-1.5">
            {checks.length === 0 && !running && (
              <div className="text-sm text-muted-foreground py-6 text-center">{t("لم يُنفذ فحص بعد")}</div>
            )}
            {checks.map((c) => {
              const Icon = STATUS_ICON[c.status]
              return (
                <div key={c.id} className="flex items-center gap-3 rounded-xl border px-3.5 py-2.5">
                  <Icon className={`w-4.5 h-4.5 shrink-0 ${STATUS_CLS[c.status]}`} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{c.label}</div>
                    <div className="text-[11px] text-muted-foreground truncate" data-no-i18n>{c.detail}</div>
                  </div>
                  <Badge variant="outline" className="shrink-0" data-no-i18n>
                    {c.status === "pass" ? t("سليم") : c.status === "warn" ? t("تحذير") : c.status === "fail" ? t("فشل") : t("غير متاح")}
                  </Badge>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

/* ============ الأجهزة الافتراضية (المرحلة 0-وسائط — عقد §22) ============ */
interface VcamGuide { title?: string; steps?: string[] }
interface VcamStatusV2 {
  platform?: string
  video?: {
    driver: string; ok: boolean; guide: VcamGuide | null
    version?: string | null; api?: string | null
    devices?: string[]; obs?: { installed?: boolean; note?: string }
  }
  audio?: { driver: string; ok: boolean; guide: VcamGuide | null }
  loopback?: { devices?: number; version?: string | null } | null
}

function VirtualDevicesTab() {
  const { t } = useI18n()
  const [st, setSt] = useState<VcamStatusV2 | null>(null)
  const [busy, setBusy] = useState<"" | "install" | "sound">("")
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const refresh = useCallback(() => {
    if (!isTauri()) return
    void tauriInvoke<VcamStatusV2>("media_vcam_status")
      .then((r) => setSt(r))
      .catch(() => null)
  }, [])
  useEffect(() => {
    refresh()
    const iv = setInterval(refresh, 6000)
    return () => clearInterval(iv)
  }, [refresh])

  const install = async () => {
    if (!confirm(t("سيُشغّل مثبّت akvirtualcamera الرسمي المرفق (9.3.1 — GPL) بصمت، وقد يطلب إذن مدير النظام. متابعة؟"))) return
    setBusy("install"); setMsg(null)
    try {
      const r = await tauriInvoke<{ ok: boolean; status: VcamStatusV2 }>("media_vcam_install")
      setSt(r.status)
      setMsg({ ok: true, text: t("اكتمل التثبيت — «NexusLink Camera» أصبحت متاحة لكل التطبيقات") })
    } catch (e) {
      setMsg({ ok: false, text: String(e).slice(0, 220) })
    }
    setBusy("")
  }
  const openSound = async () => {
    setBusy("sound"); setMsg(null)
    try {
      await tauriInvoke("media_open_sound_settings")
      setMsg({ ok: true, text: t("فُتحت إعدادات الصوت — اختر «NexusLink Mic»/«CABLE Output» كمدخل") })
    } catch (e) {
      setMsg({ ok: false, text: String(e).slice(0, 220) })
    }
    setBusy("")
  }

  const camOk = st?.video?.ok === true
  const micOk = st?.audio?.ok === true
  const platform = st?.platform ?? ""
  const linux = platform === "linux"

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-primary/12 text-primary grid place-items-center">
                <Wrench className="w-5 h-5" />
              </div>
              <div>
                <div className="font-bold">{t("الأجهزة الافتراضية — كاميرا وميكروفون الهاتف")}</div>
                <p className="text-xs text-muted-foreground max-w-lg">
                  {t("حالة كل جهاز افتراضي: مثبت/غير مثبت/نسخته — مع التثبيت والإرشاد بلا أي خطوة يدوية")}
                </p>
              </div>
            </div>
            <Badge variant="outline" data-no-i18n>{platform || "—"}</Badge>
          </div>

          {!isTauri() && (
            <p className="text-xs text-muted-foreground rounded-xl border p-3">
              {t("هذه اللوحة تعمل في نافذة تطبيق سطح المكتب (Tauri) حيث تعيش الأجهزة الافتراضية")}
            </p>
          )}

          {/* ==== الكاميرا ==== */}
          <div className="rounded-xl border p-4 space-y-2.5">
            <div className="flex items-center gap-2">
              <Camera className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold">{t("الكاميرا الافتراضية")}</span>
              <Badge className={camOk ? "bg-emerald-500 hover:bg-emerald-500 text-white" : "bg-amber-500 hover:bg-amber-500 text-white"}>
                {camOk ? t("مثبتة") : t("غير مثبتة")}
              </Badge>
              <span className="ms-auto text-[11px] text-muted-foreground" data-no-i18n>
                {st?.video?.driver === "akvirtualcamera" ? "akvirtualcamera" : st?.video?.driver === "v4l2loopback" ? "v4l2loopback" : "—"}
                {st?.video?.version ? ` · v${st.video.version}` : ""}
                {st?.video?.api ? ` · ${st.video.api}` : ""}
              </span>
            </div>
            <div className="text-[11px] text-muted-foreground space-y-1">
              <p>
                {st?.video?.devices?.length
                  ? `${t("الأجهزة المسجلة")}: ${st.video.devices.join(" · ")}`
                  : t("لا كاميرا افتراضية مسجلة بعد")}
              </p>
              {st?.video?.obs?.installed && (
                <p className="rounded-lg bg-accent px-2.5 py-1.5">{st.video.obs.note}</p>
              )}
              {linux && st?.loopback && (
                <p>
                  v4l2loopback · {t("أجهزة")}: {st.loopback.devices ?? 0}
                  {st.loopback.version ? ` · ${t("نسخة")}: ${st.loopback.version}` : ""}
                </p>
              )}
              {st?.video?.guide?.steps && (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 space-y-1">
                  <p className="font-semibold text-foreground">{st.video.guide.title ?? t("خطوات الإعداد")}</p>
                  <ol className="list-decimal ms-4 space-y-0.5">
                    {st.video.guide.steps.map((s, i) => <li key={i} data-no-i18n>{s}</li>)}
                  </ol>
                </div>
              )}
              <p>
                {t("اختبار النجاح: مكالمة Meet على كمبيوتر بأي كاميرا حقيقية ← اختر «NexusLink Camera» من قائمة كاميرات Meet مباشرة")}
              </p>
            </div>
            {!linux && !camOk && isTauri() && (
              <Button size="sm" className="gap-1.5 h-8" onClick={() => void install()} disabled={busy === "install"}>
                <DownloadCloud className={`w-3.5 h-3.5 ${busy === "install" ? "animate-pulse" : ""}`} />
                {busy === "install" ? t("جارٍ التثبيت…") : t("تثبيت حزمة الكاميرا")}
              </Button>
            )}
          </div>

          {/* ==== الميكروفون ==== */}
          <div className="rounded-xl border p-4 space-y-2.5">
            <div className="flex items-center gap-2">
              <Mic className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold">{t("الميكروفون الافتراضي")}</span>
              <Badge className={micOk ? "bg-emerald-500 hover:bg-emerald-500 text-white" : "bg-amber-500 hover:bg-amber-500 text-white"}>
                {micOk ? t("مثبت") : t("غير مثبت")}
              </Badge>
              <span className="ms-auto text-[11px] text-muted-foreground" data-no-i18n>
                {st?.audio?.driver && st.audio.driver !== "none" ? st.audio.driver : "—"}
              </span>
            </div>
            <div className="text-[11px] text-muted-foreground space-y-1">
              <p>
                {linux
                  ? t("لينكس: مصدر النظام عبر module-pipe-source — لا حاجة لدرايفر خارجي")
                  : t("درايفر صوت مفتوح قابل للتوزيع غير متاح على ويندوز — VB-CABLE (مجاني) هو البديل المكتشف، وBlackHole على ماك")}
              </p>
              {st?.audio?.guide?.steps && (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 space-y-1">
                  <p className="font-semibold text-foreground">{st.audio.guide.title}</p>
                  <ol className="list-decimal ms-4 space-y-0.5">
                    {st.audio.guide.steps.map((s, i) => <li key={i} data-no-i18n>{s}</li>)}
                  </ol>
                </div>
              )}
            </div>
            {isTauri() && (
              <Button variant="outline" size="sm" className="gap-1.5 h-8" onClick={() => void openSound()} disabled={busy === "sound"}>
                <Volume2 className="w-3.5 h-3.5" /> {t("إعدادات صوت النظام")}
              </Button>
            )}
          </div>

          {msg && (
            <p className={`text-xs rounded-lg px-3 py-2 ${msg.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`} data-no-i18n>
              {msg.text}
            </p>
          )}
          <p className="text-[10px] text-muted-foreground">
            {t("حزمة الكاميرا: akvirtualcamera الرسمي غير المعدَّل (GPL-3.0) — الترخيص والمصدر في مجلد vcam التابع للتطبيق")}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

/* ============ Builds & distribution ============ */
function BuildsTab() {
  const { t } = useI18n()
  const { silentUpdates, setSilentUpdates } = useNexus()
  const [ver, setVer] = useState<{ current: string; latest: string; channel: string; updatedAt: string; changelog: { version: string; date: string; items: string[] }[] } | null>(null)
  const [checking, setChecking] = useState(false)
  const [upToDate, setUpToDate] = useState<boolean | null>(null)

  const check = useCallback(async () => {
    setChecking(true)
    try {
      const r = await fetch("/api/version", { cache: "no-store" })
      const j = await r.json()
      setVer(j)
      setUpToDate(j.latest === j.current)
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    void check()
  }, [check])

  const platforms = [
    { os: "Windows", formats: "NSIS · MSI · Portable ZIP", sign: "Authenticode (اختياري)", status: "ready", icon: MonitorSmartphone },
    { os: "macOS", formats: "DMG · App", sign: "Developer ID + Notarization", status: "needs-account", icon: Rocket },
    { os: "Linux", formats: "AppImage · deb · rpm", sign: "GPG", status: "ready", icon: Plane },
    { os: "Android", formats: "APK · AAB", sign: "Play Signing", status: "ready", icon: SmartphoneIcon },
    { os: "iOS", formats: "IPA · TestFlight", sign: "Apple Distribution", status: "needs-account", icon: SmartphoneIcon },
  ]

  return (
    <div className="space-y-5">
      {/* التحديث */}
      <Card>
        <CardContent className="p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-primary/12 text-primary grid place-items-center">
                <HardDriveDownload className="w-5 h-5" />
              </div>
              <div>
                <div className="font-bold">{t("التحديث التلقائي الصامت")}</div>
                <p className="text-xs text-muted-foreground max-w-md">
                  {t("تنزيل بالخلفية بتوقيع رقمي (minisign) والتثبيت عند إعادة التشغيل — هذا الفحص هو الاتصال الخارجي الوحيد ويُعطّل كليًا من المفتاح")}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {silentUpdates ? <Rocket className="w-3.5 h-3.5 text-emerald-500" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                {silentUpdates ? t("صامت") : t("يدوي")}
              </div>
              <Switch checked={silentUpdates} onCheckedChange={setSilentUpdates} aria-label={t("التحديث الصامت")} />
              <Button variant="outline" size="sm" onClick={check} disabled={checking} className="gap-1.5">
                <RefreshCw className={`w-3.5 h-3.5 ${checking ? "animate-spin" : ""}`} /> {t("فحص الآن")}
              </Button>
            </div>
          </div>
          {ver && (
            <div className="flex flex-wrap items-center gap-2 text-xs" data-no-i18n>
              <Badge variant="secondary">v{ver.current}</Badge>
              <Badge variant="outline">{ver.channel}</Badge>
              {upToDate ? (
                <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30">✓ {t("أنت على أحدث إصدار")}</Badge>
              ) : (
                <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30">{t("يتوفر تحديث")} v{ver.latest}</Badge>
              )}
              <span className="text-muted-foreground">{t("آخر تحديث")} {ver.updatedAt}</span>
            </div>
          )}
          {ver && (
            <div className="space-y-2.5 pt-1">
              {ver.changelog.map((c) => (
                <div key={c.version} className="rounded-xl border px-4 py-3">
                  <div className="flex items-center gap-2 text-sm font-bold" data-no-i18n>
                    v{c.version}
                    <span className="text-[11px] font-normal text-muted-foreground">{c.date}</span>
                  </div>
                  <ul className="mt-1 space-y-0.5">
                    {c.items.map((it, i) => (
                      <li key={i} className="text-xs text-muted-foreground leading-5">• {it}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* نسخة Portable */}
      <Card>
        <CardContent className="p-5 flex flex-wrap items-center gap-4">
          <div className="w-9 h-9 rounded-xl bg-primary/12 text-primary grid place-items-center"><Package className="w-4.5 h-4.5" /></div>
          <div className="flex-1 min-w-56">
            <div className="text-sm font-bold">{t("نسخة Portable بدون تثبيت")}</div>
            <p className="text-xs text-muted-foreground leading-5">
              {t("Windows: ZIP فك وفشغّل — لا كتابة في Registry · Linux: AppImage واحد · البيانات بجانب الملف التنفيذي في مجلد nexus-data")}
            </p>
          </div>
          <Badge variant="outline">{t("متوفرة في كل الإصدارات")}</Badge>
        </CardContent>
      </Card>

      {/* مصفوفة المنصات */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center gap-2 text-sm font-bold mb-4">
            <Package className="w-4 h-4 text-primary" /> {t("مصفوفة البناء النهائي — 5 منصات")}
          </div>
          <div className="space-y-2">
            {platforms.map((p) => (
              <div key={p.os} className="flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3" data-no-i18n>
                <p.icon className="w-4.5 h-4.5 text-primary shrink-0" />
                <div className="font-bold text-sm w-24">{p.os}</div>
                <div className="text-xs text-muted-foreground flex-1 min-w-40">{p.formats}</div>
                <div className="text-[11px] text-muted-foreground">{p.sign}</div>
                {p.status === "ready" ? (
                  <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30">{t("جاهز")}</Badge>
                ) : (
                  <Badge variant="outline" className="border-amber-500/40 text-amber-600 dark:text-amber-400">{t("يتطلب حساب مطوّر")}</Badge>
                )}
              </div>
            ))}
          </div>

          <div className="grid sm:grid-cols-2 gap-3 mt-5">
            <div className="rounded-xl border p-4">
              <div className="flex items-center gap-2 text-sm font-semibold"><Server className="w-4 h-4 text-primary" /> {t("خط CI الموحد")}</div>
              <p className="text-xs text-muted-foreground mt-1.5 leading-5" data-no-i18n>.github/workflows/release.yml — {t("بناء المصفوفة كاملة عند كل وسم إصدار، مع اختبارات وتوقيع وتجميع المسودات")}</p>
            </div>
            <div className="rounded-xl border p-4">
              <div className="flex items-center gap-2 text-sm font-semibold"><Languages className="w-4 h-4 text-primary" /> {t("واجهة الويب الخفيفة")}</div>
              <p className="text-xs text-muted-foreground mt-1.5 leading-5">
                {t("أنت تستخدمها الآن — تعمل من أي متصفح بلا تثبيت، وتغطي الملفات والإشعارات والرسائل عبر /phone و /controller")}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function SmartphoneIcon(props: { className?: string }) {
  return <MonitorSmartphone {...props} />
}

/* ============ Shell ============ */
export function ToolsView() {
  const { t } = useI18n()
  const setView = useNexus((s) => s.setView)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">{t("الأدوات")}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t("قياس الشبكة، تشخيص المشاكل، طرفية المستخدمين المتقدمين، والبناء النهائي")}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setView("settings")} className="gap-1.5">
          <Cpu className="w-3.5 h-3.5" /> {t("إعدادات الأداء")}
        </Button>
      </div>

      <Tabs defaultValue="speed" dir="ltr">
        <TabsList className="mb-4 flex-wrap h-auto">
          <TabsTrigger value="speed" className="gap-1.5"><Gauge className="w-3.5 h-3.5" /> {t("اختبار السرعة")}</TabsTrigger>
          <TabsTrigger value="diag" className="gap-1.5"><Stethoscope className="w-3.5 h-3.5" /> {t("التشخيص")}</TabsTrigger>
          <TabsTrigger value="vdev" className="gap-1.5"><Wrench className="w-3.5 h-3.5" /> {t("الأجهزة الافتراضية")}</TabsTrigger>
          <TabsTrigger value="guest" className="gap-1.5"><Share2 className="w-3.5 h-3.5" /> {t("المشاركة الضيوفة")}</TabsTrigger>
          <TabsTrigger value="cli" className="gap-1.5"><SquareTerminal className="w-3.5 h-3.5" /> CLI</TabsTrigger>
          <TabsTrigger value="builds" className="gap-1.5"><Package className="w-3.5 h-3.5" /> {t("البناء والتوزيع")}</TabsTrigger>
        </TabsList>
        <TabsContent value="speed"><SpeedTestTab /></TabsContent>
        <TabsContent value="diag"><DiagnosticsTab /></TabsContent>
        <TabsContent value="vdev"><VirtualDevicesTab /></TabsContent>
        <TabsContent value="guest"><GuestShareTab /></TabsContent>
        <TabsContent value="cli"><CliTerminal /></TabsContent>
        <TabsContent value="builds"><BuildsTab /></TabsContent>
      </Tabs>
    </div>
  )
}

// icons used inside tabs list rows (imported above, referenced lazily)
void Battery
void BatteryCharging
void Wifi
void Database
