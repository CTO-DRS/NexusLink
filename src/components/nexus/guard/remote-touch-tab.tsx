"use client"
// NexusLink — FA-7: التحكم باللمس والإدخال من الكمبيوتر (بديل AirMirror)
// سطح مقياس الدقة: إحداثيات الويب → بكسل شاشة الهاتف الحقيقية (عقد §4.8)
// + شريط نص (حقن ACTION_SET_TEXT) + أزرار النظام + مشغل تطبيقات (dev:app open)
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import {
  Bell, Check, Delete, Eraser, ExternalLink, Hand, Home, Keyboard,
  LayoutGrid, MousePointerClick, RectangleHorizontal, Send, SquareStack,
  TouchpadOff, X,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Slider } from "@/components/ui/slider"
import { useGuard } from "@/lib/guard-store"
import { cmdApp, cmdKey, cmdText, cmdTouch, ctlStart, ctlStop } from "@/lib/guard-socket"
import { GuardCard } from "./guard-bits"
import { cn } from "@/lib/utils"

const PC_DEVICE_ID = "pc-office"
const PC_DEVICE_NAME = "PC-OFFICE"
const FALLBACK_SCREEN = { w: 1080, h: 2340, density: 440 }
const TAP_SLOP_PX = 7 // حد الفرق بين النقرة والسحبة (بكسل عرض الويب)
const LONG_MS = 550 // حد الضغط المطوّل

export function RemoteTouchTab() {
  const { ctl, ctlPending, phoneOnline, phoneScreen, phoneAccessibility, apps, setCtlPending, pushLog } = useGuard()

  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const pressRef = useRef<{ cx: number; cy: number; t: number } | null>(null)
  const seqRef = useRef(1)
  const [pointer, setPointer] = useState<{ x: number; y: number; down: boolean } | null>(null)
  const [customPkg, setCustomPkg] = useState("")
  const [textDraft, setTextDraft] = useState("")
  const [scrollSens, setScrollSens] = useState(1.6)
  const [scaleLabel, setScaleLabel] = useState("")

  const screen = phoneScreen ?? FALLBACK_SCREEN
  const sessionActive = ctl.active

  // ---------- مقياس الدقة (البند 2): عرض الويب → بكسل الشاشة الفعلية ----------
  useEffect(() => {
    const el = surfaceRef.current
    if (!el) return
    const update = () => {
      const rect = el.getBoundingClientRect()
      if (rect.width > 0) {
        const sx = screen.w / rect.width
        setScaleLabel(`1px عرض ← ${sx.toFixed(2)}px هاتف`)
      }
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [screen.w, screen.h])

  // ---------- تحويل الإحداثيات ----------
  const toScreen = (clientX: number, clientY: number) => {
    const el = surfaceRef.current
    if (!el) return { x: 0, y: 0 }
    const rect = el.getBoundingClientRect()
    return {
      x: Math.round(((clientX - rect.left) / rect.width) * screen.w),
      y: Math.round(((clientY - rect.top) / rect.height) * screen.h),
    }
  }

  // ---------- إيماءات السطح ----------
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!sessionActive) return
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    pressRef.current = { cx: e.clientX, cy: e.clientY, t: Date.now() }
    const p = toScreen(e.clientX, e.clientY)
    setPointer({ x: p.x, y: p.y, down: true })
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pressRef.current) return
    const p = toScreen(e.clientX, e.clientY)
    setPointer({ x: p.x, y: p.y, down: true })
  }

  const finishPress = (e: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const press = pressRef.current
    pressRef.current = null
    setPointer(null)
    if (!press || cancelled || !sessionActive) return
    const dist = Math.hypot(e.clientX - press.cx, e.clientY - press.cy)
    const dur = Date.now() - press.t
    const p1 = toScreen(press.cx, press.cy)
    if (dist < TAP_SLOP_PX) {
      if (dur >= LONG_MS) {
        cmdTouch({ op: "long", x: p1.x, y: p1.y, durationMs: 700, seq: seqRef.current++ })
        pushLog(`ضغط مطوّل عند (${p1.x}, ${p1.y})`, "in")
      } else {
        cmdTouch({ op: "tap", x: p1.x, y: p1.y, seq: seqRef.current++ })
        pushLog(`نقرة عند (${p1.x}, ${p1.y})`, "in")
      }
    } else {
      const p2 = toScreen(e.clientX, e.clientY)
      cmdTouch({
        op: "swipe",
        x: p1.x, y: p1.y, x2: p2.x, y2: p2.y,
        durationMs: Math.min(1200, Math.max(90, dur)),
        seq: seqRef.current++,
      })
      pushLog(`سحبة (${p1.x}, ${p1.y}) → (${p2.x}, ${p2.y}) خلال ${dur}ms`, "in")
    }
  }

  // تمرير بعجلة الفأرة — يُحوَّل لسحبة إصبع على الهاتف بمقياس الحساسية
  useEffect(() => {
    const el = surfaceRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (!sessionActive) return
      const p = toScreen(e.clientX, e.clientY)
      const amount = Math.min(900, Math.max(60, Math.abs(e.deltaY))) * scrollSens
      // عجلة للأسفل (deltaY>0) = محتوى ينزل = إصبع يصعد
      const dir = e.deltaY > 0 ? -1 : 1
      cmdTouch({
        op: "scroll",
        x: p.x,
        y: p.y,
        x2: p.x,
        y2: Math.max(0, Math.min(screen.h, p.y + dir * amount)),
        durationMs: 240,
        seq: seqRef.current++,
      })
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [sessionActive, scrollSens, screen.h])

  // ---------- الجلسة ----------
  const startSession = () => {
    if (!phoneOnline) {
      toast.error("لا هاتف وكيل متصل — افتح تطبيق NexusLink على هاتفك أولًا")
      return
    }
    setCtlPending(true)
    pushLog(`طلب تحكم باللمس من ${PC_DEVICE_NAME}…`, "in")
    ctlStart(PC_DEVICE_ID, PC_DEVICE_NAME)
  }

  const stopSession = () => {
    ctlStop()
    pushLog("إنهاء جلسة التحكم من الكمبيوتر…", "info")
  }

  // ---------- أزرار النظام (البند 4) ----------
  const sysKey = (action: "back" | "home" | "recents" | "notifications" | "keyboard") => {
    if (!sessionActive) return
    cmdKey(action)
  }

  const openApp = (pkg: string, name: string) => {
    if (!sessionActive) {
      toast.error("ابدأ جلسة التحكم أولًا")
      return
    }
    cmdApp("open", pkg, name)
    toast.message(`جارٍ فتح ${name} على الهاتف…`)
  }

  const sendText = (t: string) => {
    if (!sessionActive) {
      toast.error("ابدأ جلسة التحكم أولًا")
      return
    }
    cmdText(t)
  }

  const aspect = `${screen.w} / ${screen.h}`

  return (
    <div className="space-y-4">
      {/* ==== شريط الجلسة (البند 6/7) ==== */}
      <GuardCard title="جلسة التحكم باللمس" icon={Hand}>
        <div className="flex items-center gap-2.5 flex-wrap">
          {sessionActive ? (
            <Badge className="rounded-full gap-1.5 bg-red-500 hover:bg-red-500 animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-white" />
              التحكم مفعّل من: {ctl.name || PC_DEVICE_NAME}
            </Badge>
          ) : ctlPending ? (
            <Badge variant="outline" className="rounded-full gap-1.5 animate-pulse">
              بانتظار موافقة الهاتف…
            </Badge>
          ) : (
            <Badge variant="outline" className="rounded-full">لا جلسة نشطة</Badge>
          )}
          <span className="text-[11px] text-muted-foreground">
            الهاتف: {phoneOnline ? <b className="text-emerald-600 dark:text-emerald-400">متصل</b> : <b className="text-red-500">غير متصل</b>}
            {" · "}الإتاحة: {phoneAccessibility === null ? "—" : phoneAccessibility
              ? <b className="text-emerald-600 dark:text-emerald-400">مفعّلة</b>
              : <b className="text-amber-600 dark:text-amber-400">غير مفعّلة</b>}
            {phoneScreen && <>{" · "}الشاشة: <span className="font-mono dir-ltr">{screen.w}×{screen.h}</span></>}
          </span>
          <span className="flex-1" />
          {sessionActive ? (
            <Button size="sm" variant="destructive" className="h-8 rounded-xl gap-1.5 text-[11px]" onClick={stopSession}>
              <TouchpadOff className="w-3.5 h-3.5" /> إنهاء التحكم
            </Button>
          ) : (
            <Button size="sm" className="h-8 rounded-xl gap-1.5 text-[11px]" onClick={startSession} disabled={!phoneOnline || ctlPending}>
              <MousePointerClick className="w-3.5 h-3.5" /> بدء التحكم
            </Button>
          )}
        </div>
        {phoneAccessibility === false && (
          <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-400 mt-2.5">
            خدمة الإتاحة غير مفعّلة على الهاتف — من التطبيق: <b>الإعدادات ← التحكم عن بعد</b> ثم اتبع خطوات التفعيل، وإلا ستُرفض كل اللمسات.
          </div>
        )}
        {!phoneScreen && (
          <div className="rounded-xl bg-muted/60 px-3 py-2 text-[10.5px] text-muted-foreground mt-2.5">
            أبعاد الشاشة الحقيقية تصل تلقائيًا من الهاتف (dev:screen) — حاليًا تُستخدم قياس افتراضي <span className="font-mono dir-ltr">1080×2340</span> للتحويل.
          </div>
        )}
      </GuardCard>

      <div className="grid gap-4 lg:grid-cols-[300px_1fr] items-start">
        {/* ==== سطح اللمس بمقياس الدقة (البند 2) ==== */}
        <GuardCard title="سطح الهاتف (إحداثيات حقيقية)" icon={RectangleHorizontal}>
          <div
            ref={surfaceRef}
            role="application"
            aria-label="سطح لمس الهاتف — النقر ينقر ويجر يسحب على الشاشة الفعلية"
            className={cn(
              "relative w-full max-w-[280px] mx-auto rounded-[22px] border-4 border-zinc-800 bg-gradient-to-b from-zinc-900 to-black overflow-hidden select-none",
              sessionActive ? "cursor-crosshair touch-none" : "cursor-not-allowed",
            )}
            style={{ aspectRatio: aspect }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={(e) => finishPress(e, false)}
            onPointerCancel={(e) => finishPress(e, true)}
            onContextMenu={(e) => e.preventDefault()}
          >
            {/* شبكة إرشادية خفيفة */}
            <div
              className="absolute inset-0 opacity-[0.13]"
              style={{
                backgroundImage:
                  "linear-gradient(to right, rgba(255,255,255,.5) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,.5) 1px, transparent 1px)",
                backgroundSize: "12.5% 8.33%",
              }}
            />
            <div className="absolute inset-0 grid place-items-center pointer-events-none px-4 text-center">
              {sessionActive ? (
                <p className="text-[10.5px] text-white/45 leading-relaxed">
                  انقر لتنقر على هاتفك · اسحب لتنقل ·
                  <br />
                  اضغط مطوّلًا للضغط الطويل · العجلة للتمرير
                </p>
              ) : (
                <p className="text-[10.5px] text-white/30 leading-relaxed">
                  ابدأ جلسة التحكم ليصبح هذا السطح
                  <br />
                  إصبعك على شاشة الهاتف الحقيقية
                </p>
              )}
            </div>
            {/* مؤشر الموضع الحي بإحداثيات الهاتف */}
            {pointer && (
              <>
                <div
                  className="absolute rounded-full border-2 border-teal-400/90 bg-teal-400/20 pointer-events-none transition-[top,left] duration-75"
                  style={{
                    width: 22, height: 22,
                    left: `calc(${(pointer.x / screen.w) * 100}% - 11px)`,
                    top: `calc(${(pointer.y / screen.h) * 100}% - 11px)`,
                  }}
                />
                <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 rounded-md bg-black/60 px-1.5 py-0.5 text-[9px] font-mono text-teal-300 pointer-events-none" dir="ltr">
                  {pointer.x}, {pointer.y}{pointer.down ? " · ▼" : ""}
                </div>
              </>
            )}
          </div>
          <div className="mt-2.5 flex items-center justify-between text-[10.5px] text-muted-foreground">
            <span className="font-mono dir-ltr">{scaleLabel || "—"}</span>
            <div className="flex items-center gap-2 w-32">
              <span className="whitespace-nowrap">حساسية التمرير</span>
              <Slider value={[scrollSens]} min={0.5} max={4} step={0.1} onValueChange={([v]) => setScrollSens(v)} aria-label="حساسية التمرير" />
            </div>
          </div>
        </GuardCard>

        <div className="space-y-4 min-w-0">
          {/* ==== أزرار النظام (البند 4) ==== */}
          <GuardCard title="أزرار النظام" icon={SquareStack}>
            <div className="grid grid-cols-4 gap-2">
              {(
                [
                  { action: "back", label: "رجوع", Icon: X },
                  { action: "home", label: "الرئيسية", Icon: Home },
                  { action: "recents", label: "الحديثة", Icon: LayoutGrid },
                  { action: "notifications", label: "الإشعارات", Icon: Bell },
                ] as const
              ).map((b) => (
                <button
                  key={b.action}
                  disabled={!sessionActive}
                  onClick={() => sysKey(b.action)}
                  aria-label={`زر ${b.label}`}
                  className={cn(
                    "rounded-2xl flex flex-col items-center justify-center gap-1.5 py-3.5 border transition-all border",
                    sessionActive
                      ? "bg-card hover:bg-accent active:scale-95"
                      : "bg-muted/40 text-muted-foreground/50 cursor-not-allowed",
                  )}
                >
                  <b.Icon className="w-5 h-5" />
                  <span className="text-[10px] font-semibold">{b.label}</span>
                </button>
              ))}
            </div>
          </GuardCard>

          {/* ==== الإدخال النصي (البند 3) ==== */}
          <GuardCard title="الإدخال النصي في الحقل المركّز" icon={Keyboard}>
            <div className="flex gap-2">
              <Input
                value={textDraft}
                onChange={(e) => setTextDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && textDraft) {
                    sendText(textDraft)
                    setTextDraft("")
                  }
                }}
                placeholder="اكتب النص… يُحقن في الحقل المركّز على الهاتف (ACTION_SET_TEXT)"
                className="h-10 rounded-xl text-[12.5px]"
                dir="auto"
              />
              <Button
                size="icon"
                className="h-10 w-10 rounded-xl shrink-0"
                disabled={!sessionActive || !textDraft}
                onClick={() => {
                  sendText(textDraft)
                  setTextDraft("")
                }}
                aria-label="إرسال النص"
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              <Button size="sm" variant="outline" className="h-8 rounded-xl gap-1.5 text-[11px]" disabled={!sessionActive} onClick={() => sendText("\n")}>
                <Check className="w-3.5 h-3.5" /> إدخال (سطر جديد)
              </Button>
              <Button size="sm" variant="outline" className="h-8 rounded-xl gap-1.5 text-[11px]" disabled={!sessionActive} onClick={() => sendText("")}>
                <Eraser className="w-3.5 h-3.5" /> مسح الحقل
              </Button>
              <Button size="sm" variant="outline" className="h-8 rounded-xl gap-1.5 text-[11px]" disabled={!sessionActive} onClick={() => sysKey("keyboard")}>
                <Keyboard className="w-3.5 h-3.5" /> إظهار/إخفاء لوحة المفاتيح
              </Button>
              <Button size="sm" variant="outline" className="h-8 rounded-xl gap-1.5 text-[11px]" disabled={!sessionActive} onClick={() => sendText(" ")}>
                <Delete className="w-3.5 h-3.5" /> مسافة
              </Button>
            </div>
          </GuardCard>

          {/* ==== مشغل التطبيقات (اختبار النجاح: افتح تطبيقًا من الويب) ==== */}
          <GuardCard title="فتح تطبيق على الهاتف" icon={ExternalLink}>
            <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
              {apps.slice(0, 12).map((a) => (
                <button
                  key={a.pkg}
                  disabled={!sessionActive}
                  onClick={() => openApp(a.pkg, a.name)}
                  aria-label={`فتح ${a.name}`}
                  className={cn(
                    "rounded-2xl flex flex-col items-center gap-1.5 py-2.5 px-1 border transition-all",
                    sessionActive ? "bg-card hover:bg-accent active:scale-95" : "bg-muted/40 text-muted-foreground/50 cursor-not-allowed",
                  )}
                >
                  <span
                    className="w-8 h-8 rounded-xl grid place-items-center text-white text-[13px] font-black"
                    style={{ background: `hsl(${a.hue} 55% 45%)` }}
                  >
                    {a.name.replace(/[^\p{L}\p{N}]/gu, "").slice(0, 1) || "?"}
                  </span>
                  <span className="text-[9px] font-semibold leading-tight text-center line-clamp-1 w-full">{a.name}</span>
                </button>
              ))}
            </div>
            <div className="flex gap-2 mt-2.5">
              <Input
                value={customPkg}
                onChange={(e) => setCustomPkg(e.target.value)}
                placeholder="حزمة أي تطبيق (مثال: com.whatsapp)"
                className="h-9 rounded-xl text-[12px] dir-ltr text-left"
              />
              <Button
                size="sm"
                className="h-9 rounded-xl shrink-0"
                disabled={!sessionActive || !customPkg.trim()}
                onClick={() => {
                  openApp(customPkg.trim(), customPkg.trim())
                  setCustomPkg("")
                }}
              >
                فتح
              </Button>
            </div>
          </GuardCard>
        </div>
      </div>
    </div>
  )
}
