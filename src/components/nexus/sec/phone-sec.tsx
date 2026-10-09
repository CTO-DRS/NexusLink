"use client"
// NexusLink — المرحلة 10: تبويب الأمان في صفحة الهاتف الحقيقي (/phone)
// قفل التطبيق: PIN + نمط + بصمة/وجه (WebAuthn حقيقي عبر HTTPS)
// + صلاحيات لكل ميزة (الإنفاذ محلي هنا) + إرسال مشفر (لصق/تخفي) + استقبال الأوامر
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import {
  ShieldCheck, LockKeyhole, Fingerprint, Delete, Ghost, Send, KeyRound,
  ScanFace, Grip, Timer, Unlock, EyeOff, CheckCircle2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { getSecSocket } from "@/lib/sec-socket"
import { useSec } from "@/lib/sec-store"
import {
  useSecBridge, SEC_FEATURES, sendSecureClip, sendEncryptedFile, clientAudit, announceLockState,
} from "@/hooks/use-sec-bridge"
import { pbkdf2Hash, pbkdf2Verify, toB64, fromB64 } from "@/lib/nexus/e2e-crypto"
import { cn } from "@/lib/utils"

// ---------- تخزين قفل الهاتف ----------
interface LockCfg {
  pin?: { salt: string; hash: string; iters: number }
  pattern?: { salt: string; hash: string; iters: number }
  credId?: string
  autoLockSec: number
}
function loadCfg(): LockCfg {
  try { return { autoLockSec: 60, ...JSON.parse(localStorage.getItem("nl-sec-lock") || "{}") } } catch { return { autoLockSec: 60 } }
}
function saveCfg(cfg: LockCfg) { localStorage.setItem("nl-sec-lock", JSON.stringify(cfg)) }

export function PhoneSecTab() {
  // جسر الأمان بدور الهاتف — يستقبل الأوامر المشفرة (رن/قفل) ويتحقق من الصلاحيات
  useSecBridge("phone")
  const { kexDone, perms, stealth, transfer, receivedClip, phoneLock, setCheck } = useSec()
  const [cfg, setCfg] = useState<LockCfg>(() => ({ autoLockSec: 60 }))
  const [locked, setLocked] = useState(false)
  const [pin, setPin] = useState("")
  const [pinStage, setPinStage] = useState<"idle" | "set1" | "set2" | "unlock">("idle")
  const [pinFirst, setPinFirst] = useState("")
  const [pattern, setPattern] = useState<number[]>([])
  const [patternStage, setPatternStage] = useState<"idle" | "set1" | "set2" | "unlock">("idle")
  const [patternFirst, setPatternFirst] = useState<number[]>([])
  const [clipText, setClipText] = useState("")
  const [biometricReady, setBiometricReady] = useState(false)
  const failedRef = useRef(0)
  const idleRef = useRef<number | null>(null)

  // تهيئة
  useEffect(() => {
    const c = loadCfg()
    setCfg(c)
    if (c.credId) setBiometricReady(true)
    // WebAuthn متاح؟
    void (async () => {
      try {
        const available = await (window as unknown as { PublicKeyCredential?: { isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean> } })
          .PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable?.()
        setBiometricReady((prev) => prev || !!available)
      } catch { /* ignore */ }
    })()
  }, [])

  // إعلان حالة القفل للكمبيوتر
  const announce = useCallback((isLocked: boolean, c: LockCfg) => {
    try { announceLockState({ locked: isLocked, hasPin: !!c.pin, hasPattern: !!c.pattern, hasBiometric: !!c.credId, autoLockSec: c.autoLockSec }) } catch { /* ignore */ }
  }, [])

  const doLock = useCallback((reason: string) => {
    const c = loadCfg()
    if (!c.pin && !c.pattern && !c.credId) { toast.error("اضبط طريقة قفل أولاً (PIN أو نمط أو بصمة)"); return }
    ;(window as unknown as { __nlSecLocked?: boolean }).__nlSecLocked = true
    setLocked(true)
    setPin(""); setPattern([]); setPinStage(c.pin ? "unlock" : "idle"); setPatternStage(c.pattern && !c.pin ? "unlock" : "idle")
    clientAudit({ actor: "Galaxy-S24", action: "lock", detail: `قُفل تطبيق الهاتف (${reason})`, severity: "warn" })
    announce(true, c)
  }, [announce])

  const doUnlock = useCallback(() => {
    ;(window as unknown as { __nlSecLocked?: boolean }).__nlSecLocked = false
    failedRef.current = 0
    setLocked(false)
    setPin(""); setPattern([]); setPinStage("idle"); setPatternStage("idle")
    clientAudit({ actor: "Galaxy-S24", action: "unlock", detail: "فُتح قفل تطبيق الهاتف", severity: "info" })
    const c = loadCfg()
    announce(false, c)
    setCheck("applock", true)
  }, [announce, setCheck])

  // أمر القفل عن بُعد من الكمبيوتر (يصل مشفراً عبر sec:frame → حدث مخصص)
  useEffect(() => {
    const h = () => doLock("أمر مشفر من الكمبيوتر")
    window.addEventListener("nl-sec-lock-now", h)
    return () => window.removeEventListener("nl-sec-lock-now", h)
  }, [doLock])

  // قفل تلقائي عند الخمول
  useEffect(() => {
    const reset = () => {
      if (idleRef.current) window.clearTimeout(idleRef.current)
      if (cfg.autoLockSec > 0 && !locked && (cfg.pin || cfg.pattern || cfg.credId)) {
        idleRef.current = window.setTimeout(() => doLock("خمول تلقائي"), cfg.autoLockSec * 1000)
      }
    }
    reset()
    window.addEventListener("touchstart", reset, { passive: true })
    window.addEventListener("mousemove", reset, { passive: true })
    window.addEventListener("keydown", reset)
    return () => {
      if (idleRef.current) window.clearTimeout(idleRef.current)
      window.removeEventListener("touchstart", reset)
      window.removeEventListener("mousemove", reset)
      window.removeEventListener("keydown", reset)
    }
  }, [cfg.autoLockSec, cfg.pin, cfg.pattern, cfg.credId, locked, doLock])

  // ---------- WebAuthn (بصمة/وجه نظامية حقيقية) ----------
  async function enrollBiometric() {
    try {
      const cred = await navigator.credentials.create({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          rp: { name: "NexusLink" },
          user: { id: crypto.getRandomValues(new Uint8Array(16)), name: "nexus-phone", displayName: "هاتف NexusLink" },
          pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
          authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "preferred" },
          timeout: 45000, attestation: "none",
        },
      }) as PublicKeyCredential | null
      if (!cred) throw new Error("أُلغيت العملية")
      const c = loadCfg()
      c.credId = toB64(new Uint8Array(cred.rawId))
      saveCfg(c); setCfg(c)
      toast.success("سُجّلت البصمة/الوجه بنجاح — جهازك نفسه هو المفتاح")
      announce(locked, c)
    } catch (e) {
      toast.error(`تعذر التسجيل: ${e instanceof Error ? e.message : "غير مدعوم"}`, { description: "البصمة تعمل على الهاتف الحقيقي عبر HTTPS" })
    }
  }

  async function unlockBiometric() {
    try {
      const c = loadCfg()
      await navigator.credentials.get({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          allowCredentials: c.credId ? [{ type: "public-key", id: fromB64(c.credId) as unknown as BufferSource }] : [],
          userVerification: "required", timeout: 45000,
        },
      })
      doUnlock()
    } catch {
      failedRef.current++
      toast.error("لم يُتحقق من البصمة")
    }
  }

  // ---------- PIN ----------
  function pressDigit(d: string) {
    const next = (pin + d).slice(0, 6)
    setPin(next)
    if (next.length === 4 && (pinStage === "set1" || pinStage === "set2")) void commitPin(next)
    if (next.length >= 4 && pinStage === "unlock" && cfg.pin) void tryUnlockPin(next)
  }

  async function commitPin(value: string) {
    if (pinStage === "set1") {
      setPinFirst(value); setPin(""); setPinStage("set2")
      toast.info("أعد إدخال الرمز للتأكيد")
      return
    }
    if (value !== pinFirst) {
      toast.error("الرمزان غير متطابقين — ابدأ من جديد")
      setPin(""); setPinFirst(""); setPinStage("set1")
      return
    }
    const stored = await pbkdf2Hash(value)
    const c = loadCfg(); c.pin = stored; saveCfg(c); setCfg(c)
    setPin(""); setPinStage("idle"); setPinFirst("")
    toast.success("ضُبط رمز القفل — مخزن بـ PBKDF2-SHA256 (150 ألف تكرار)")
    announce(locked, c)
  }

  async function tryUnlockPin(value: string) {
    const ok = await pbkdf2Verify(value, loadCfg().pin!)
    if (ok) doUnlock()
    else {
      failedRef.current++
      setPin("")
      if (failedRef.current >= 3) {
        toast.error("3 محاولات فاشلة — انتظر 20 ثانية قبل المحاولة مجدداً")
        await new Promise((r) => setTimeout(r, 20000))
        failedRef.current = 0
      } else toast.error(`رمز خاطئ (محاولة ${failedRef.current}/3)`)
    }
  }

  // ---------- النمط ----------
  function patternDone(seq: number[]) {
    if (seq.length < 4) { toast.error("ارسم 4 نقاط على الأقل"); return }
    if (patternStage === "set1") {
      setPatternFirst(seq); setPattern([]); setPatternStage("set2")
      toast.info("أعد رسم النمط للتأكيد")
      return
    }
    if (patternStage === "set2") {
      if (seq.join("") !== patternFirst.join("")) {
        toast.error("النمطان غير متطابقين — ابدأ من جديد")
        setPattern([]); setPatternFirst([]); setPatternStage("set1")
        return
      }
      void (async () => {
        const stored = await pbkdf2Hash(seq.join("-"))
        const c = loadCfg(); c.pattern = stored; saveCfg(c); setCfg(c)
        setPattern([]); setPatternStage("idle")
        toast.success("ضُبط نمط القفل — مخزن بـ PBKDF2 (لا يُحفظ الرسم أبداً)")
        announce(locked, c)
      })()
      return
    }
    if (patternStage === "unlock") {
      void (async () => {
        const ok = await pbkdf2Verify(seq.join("-"), loadCfg().pattern!)
        if (ok) doUnlock()
        else { failedRef.current++; setPattern([]); toast.error(`نمط خاطئ (محاولة ${failedRef.current}/3)`) }
      })()
    }
  }

  // ---------- صلاحيات (الإنفاذ من هنا) ----------
  function togglePerm(feature: string, enabled: boolean) {
    getSecSocket().emit("sec:perm-set", { feature, deviceId: "galaxy-s24", enabled })
    toast.info(enabled ? "سُمحت الميزة" : "أُوقفت الميزة — سترفض أوامر الكمبيوتر المشفرة فوراً")
  }

  // ---------- إرسال مشفر ----------
  async function sendClip() {
    if (!clipText.trim()) return
    const ok = await sendSecureClip(clipText.trim())
    if (ok) { toast.success("أُرسل مشفراً إلى الكمبيوتر — ستجده في تبويب التشفير"); setCheck("clip", true); setClipText("") }
  }

  async function sendStealthFile() {
    const secret = `بند سري ${Date.now().toString(36)} — يُنقل في وضع التخفي بلا أثر`
    const bytes = new TextEncoder().encode((secret + "\n" + "محتوى عربي للتعبئة والحجم. ".repeat(40) + "\n").repeat(30))
    const ok = await sendEncryptedFile(bytes, "مستند-سرّي.txt", true)
    if (ok) { setCheck("stealth", true); toast.success("أُرسل في التخفي — لن يظهر في سجل الكمبيوتر نهائياً") }
  }

  // ============ شاشة القفل (تغطي كل شيء) ============
  if (locked) {
    return (
      <div className="fixed inset-0 z-[100] bg-zinc-950/95 backdrop-blur-xl flex flex-col items-center justify-center gap-5 p-6 text-white">
        <div className="w-16 h-16 rounded-3xl bg-primary text-primary-foreground grid place-items-center shadow-xl">
          <LockKeyhole className="w-8 h-8" />
        </div>
        <div className="text-center">
          <div className="font-bold text-lg">التطبيق مقفول</div>
          <div className="text-[12px] text-muted-foreground">أدخل رمزك أو ارسم نمطك أو استخدم بصمتك</div>
        </div>

        {/* نقاط الرمز */}
        {(pinStage === "unlock") && (
          <div className="flex gap-2" dir="ltr">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className={cn("w-3.5 h-3.5 rounded-full border-2", pin.length > i ? "bg-primary border-primary" : "border-muted-foreground/40")} />
            ))}
          </div>
        )}

        {/* لوحة الأرقام */}
        {pinStage === "unlock" && (
          <div className="grid grid-cols-3 gap-2.5">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"].map((d, i) => (
              <button
                key={i}
                disabled={!d}
                onClick={() => d === "⌫" ? setPin(pin.slice(0, -1)) : pressDigit(d)}
                className={cn(
                  "w-16 h-16 rounded-2xl text-xl font-bold transition-all",
                  d ? "bg-muted hover:bg-accent active:scale-95" : "opacity-0 pointer-events-none",
                )}
              >
                {d === "⌫" ? <Delete className="w-5 h-5 mx-auto" /> : d}
              </button>
            ))}
          </div>
        )}

        {/* شبكة النمط */}
        {patternStage === "unlock" && (
          <PatternGrid selected={pattern} onSelect={(idx) => {
            if (!pattern.includes(idx)) setPattern([...pattern, idx])
          }} />
        )}
        {patternStage === "unlock" && pattern.length >= 4 && (
          <Button className="rounded-xl gap-1.5" onClick={() => patternDone(pattern)}>تحقق من النمط</Button>
        )}

        {/* البصمة */}
        {biometricReady && cfg.credId && (
          <Button variant="outline" size="lg" className="rounded-2xl gap-2 h-14 px-6" onClick={() => void unlockBiometric()}>
            <Fingerprint className="w-6 h-6" /> بصمة / وجه
          </Button>
        )}

        {(failedRef.current >= 3) && (
          <div className="text-[12px] text-red-500 font-bold animate-pulse">محاولات فاشلة متكررة — البروتوكول يبطئك عمداً</div>
        )}
      </div>
    )
  }

  // ============ التبويب العادي ============
  return (
    <div className="space-y-3 pb-4 text-zinc-900">
      {/* شارة القناة */}
      <div className="rounded-2xl border bg-card p-3 flex items-center justify-between text-zinc-900">
        <div className="flex items-center gap-2 text-[13px] font-bold">
          <ShieldCheck className={cn("w-4 h-4", kexDone ? "text-emerald-500" : "text-muted-foreground")} />
          القناة المشفرة
        </div>
        <Badge variant={kexDone ? "default" : "outline"} className={kexDone ? "bg-emerald-600" : ""}>
          {kexDone ? "E2E نشط (AES-256-GCM)" : "بانتظار الكمبيوتر"}
        </Badge>
      </div>

      {/* قفل التطبيق */}
      <div className="rounded-2xl border bg-card p-3 space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="font-bold text-[13px] flex items-center gap-1.5"><LockKeyhole className="w-4 h-4 text-teal-500" /> قفل التطبيق</div>
          <Button size="sm" variant="outline" className="h-7 rounded-lg gap-1 text-[11px]" onClick={() => doLock("يدوي")}>
            <LockKeyhole className="w-3 h-3" /> اقفل الآن
          </Button>
        </div>

        {/* PIN */}
        <div className="rounded-xl border p-2.5 space-y-2">
          <div className="flex items-center justify-between text-[12px]">
            <span className="font-bold flex items-center gap-1.5"><KeyRound className="w-3.5 h-3.5" /> رمز PIN</span>
            {cfg.pin ? <Badge variant="outline" className="text-emerald-600 border-emerald-500/40">مضبوط ✓</Badge>
              : <Button size="sm" variant="outline" className="h-6 rounded-lg text-[10px]" onClick={() => { setPinStage("set1"); setPin("") }}>اضبط</Button>}
          </div>
          {(pinStage === "set1" || pinStage === "set2") && (
            <div>
              <div className="text-[11px] text-muted-foreground mb-1.5">{pinStage === "set1" ? "أدخل 4 أرقام:" : "أعد الإدخال للتأكيد:"}</div>
              <div className="grid grid-cols-6 gap-1.5">
                {["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "⌫"].map((d, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      if (d === "C") { setPin(""); return }
                      if (d === "⌫") { setPin(pin.slice(0, -1)); return }
                      pressDigit(d)
                    }}
                    className="h-10 rounded-xl bg-muted hover:bg-accent active:scale-95 text-[15px] font-bold"
                  >
                    {d === "⌫" ? <Delete className="w-4 h-4 mx-auto" /> : d}
                  </button>
                ))}
              </div>
            </div>
          )}
          {cfg.pin && pinStage === "idle" && (
            <Button size="sm" variant="ghost" className="h-6 text-[10px] text-muted-foreground" onClick={() => { setCfg(loadCfg()); toast.info("لتغيير الرمز: امسحه من إعدادات المتصفح أو أعد الضبط") }}>تغيير</Button>
          )}
        </div>

        {/* النمط */}
        <div className="rounded-xl border p-2.5 space-y-2">
          <div className="flex items-center justify-between text-[12px]">
            <span className="font-bold flex items-center gap-1.5"><Grip className="w-3.5 h-3.5" /> نمط الرسم</span>
            {cfg.pattern ? <Badge variant="outline" className="text-emerald-600 border-emerald-500/40">مضبوط ✓</Badge>
              : <Button size="sm" variant="outline" className="h-6 rounded-lg text-[10px]" onClick={() => { setPatternStage("set1"); setPattern([]) }}>اضبط</Button>}
          </div>
          {(patternStage === "set1" || patternStage === "set2") && (
            <div className="grid place-items-center">
              <PatternGrid selected={pattern} onSelect={(idx) => {
                if (!pattern.includes(idx)) setPattern([...pattern, idx])
              }} onDone={() => patternDone(pattern)} />
              <div className="text-[11px] text-muted-foreground mt-1">{patternStage === "set1" ? "ارسم 4+ نقاط ثم اضغط تم" : "أعد رسم النمط"}</div>
              <Button size="sm" variant="outline" className="h-7 mt-1 rounded-lg text-[11px]" disabled={pattern.length < 4} onClick={() => patternDone(pattern)}>تم</Button>
            </div>
          )}
        </div>

        {/* البصمة */}
        <div className="rounded-xl border p-2.5 flex items-center justify-between">
          <div className="text-[12px] font-bold flex items-center gap-1.5"><ScanFace className="w-3.5 h-3.5" /> بصمة / وجه</div>
          {cfg.credId ? (
            <Badge variant="outline" className="text-emerald-600 border-emerald-500/40">مسجّل ✓</Badge>
          ) : (
            <Button size="sm" variant="outline" className="h-7 rounded-lg gap-1 text-[11px]" onClick={() => void enrollBiometric()} disabled={!biometricReady}>
              <Fingerprint className="w-3 h-3" /> {biometricReady ? "سجّل الآن" : "غير متاح"}
            </Button>
          )}
        </div>

        {/* خمول */}
        <div className="rounded-xl border p-2.5 flex items-center justify-between">
          <div className="text-[12px] font-bold flex items-center gap-1.5"><Timer className="w-3.5 h-3.5" /> قفل تلقائي</div>
          <select
            value={cfg.autoLockSec}
            onChange={(e) => { const c = { ...loadCfg(), autoLockSec: Number(e.target.value) }; saveCfg(c); setCfg(c); announce(locked, c) }}
            className="h-7 rounded-lg border bg-background px-2 text-[11px]"
            aria-label="مدة القفل التلقائي"
          >
            <option value={15}>15 ثانية</option>
            <option value={30}>30 ثانية</option>
            <option value={60}>دقيقة</option>
            <option value={180}>3 دقائق</option>
            <option value={0}>معطّل</option>
          </select>
        </div>
      </div>

      {/* الصلاحيات */}
      <div className="rounded-2xl border bg-card p-3 space-y-2">
        <div className="font-bold text-[13px] flex items-center gap-1.5"><Unlock className="w-4 h-4 text-teal-500" /> صلاحيات هذا الهاتف</div>
        <div className="text-[11px] text-muted-foreground">أنت مصدر الميزات — إيقافك هنا يمنع أوامر الكمبيوتر المشفرة فعلياً</div>
        {SEC_FEATURES.map((f) => {
          const rule = perms.find((p) => p.feature === f.id && p.deviceId === "galaxy-s24")
          const enabled = rule?.enabled ?? false
          return (
            <div key={f.id} className="flex items-center justify-between rounded-xl border px-2.5 py-2">
              <span className="text-[12px]">{f.name}</span>
              <Switch checked={enabled} onCheckedChange={(v) => togglePerm(f.id, v)} aria-label={f.name} />
            </div>
          )
        })}
      </div>

      {/* إرسال مشفر */}
      <div className="rounded-2xl border bg-card p-3 space-y-2">
        <div className="font-bold text-[13px] flex items-center gap-1.5"><Send className="w-4 h-4 text-teal-500" /> إرسال مشفر إلى الكمبيوتر</div>
        <textarea
          value={clipText}
          onChange={(e) => setClipText(e.target.value)}
          placeholder="اكتب نصاً (رابط، ملاحظة، كود)…"
          className="w-full h-20 rounded-xl border bg-background p-2.5 text-[13px] resize-none"
        />
        <Button size="sm" className="w-full rounded-xl gap-1.5" disabled={!kexDone || !clipText.trim()} onClick={() => void sendClip()}>
          <Send className="w-3.5 h-3.5" /> أرسل مشفراً (E2E)
        </Button>
        {receivedClip && (
          <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-2 text-[11px]">
            وصل نص مشفر من الكمبيوتر: {receivedClip.text.slice(0, 60)}
          </div>
        )}
      </div>

      {/* التخفي */}
      <div className="rounded-2xl border bg-card p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="font-bold text-[13px] flex items-center gap-1.5"><Ghost className="w-4 h-4 text-slate-400" /> وضع التخفي</div>
          <div className="flex items-center gap-2">
            {stealth && <EyeOff className="w-4 h-4 text-slate-400" />}
            <Switch checked={stealth} onCheckedChange={(v) => { getSecSocket().emit("sec:stealth-set", { on: v }); useSec.setState({ stealth: v }) }} aria-label="وضع التخفي" />
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">عند التفعيل: أي نقل من هذا الهاتف لن يُسجل في سجل الكمبيوتر إطلاقاً — وبلا آثار في الذاكرة.</p>
        <Button size="sm" variant="outline" className="w-full rounded-xl gap-1.5" disabled={!kexDone || !stealth} onClick={() => void sendStealthFile()}>
          <Ghost className="w-3.5 h-3.5" /> أرسل مستنداً في وضع التخفي
        </Button>
      </div>

      {/* النقل الحي */}
      {transfer && (
        <div className={cn("rounded-2xl border p-3 text-[12px] space-y-1", transfer.stealth ? "border-slate-500/40 bg-slate-500/10" : "border-teal-500/40 bg-teal-500/10")}>
          <div className="flex justify-between font-bold">
            <span>{transfer.stealth && <Ghost className="w-3.5 h-3.5 inline me-1" />}{transfer.name}</span>
            <span>{transfer.status === "done" ? <CheckCircle2 className="w-4 h-4 inline text-emerald-500" /> : `${Math.round((transfer.sent / Math.max(transfer.size, 1)) * 100)}%`}</span>
          </div>
          {transfer.status === "done" && (
            <div className={transfer.stealth ? "text-slate-400" : "text-emerald-600 font-bold"}>
              {transfer.stealth ? "استلام تخفي — يُمحى من الذاكرة الآن…" : "فُك التشفير وتحققت البصمة ✓ حُفظ الملف"}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------- شبكة النمط 3×3 ----------
function PatternGrid({ selected, onSelect, onDone }: {
  selected: number[]
  onSelect: (idx: number) => void
  onDone?: () => void
}) {
  const drawing = useRef(false)
  useEffect(() => {
    const up = () => { if (drawing.current) { drawing.current = false; onDone?.() } }
    window.addEventListener("pointerup", up)
    return () => window.removeEventListener("pointerup", up)
  }, [onDone])
  return (
    <div className="grid grid-cols-3 gap-2.5 w-fit mx-auto" dir="ltr">
      {Array.from({ length: 9 }).map((_, i) => {
        const on = selected.includes(i)
        return (
          <button
            key={i}
            onPointerDown={() => { drawing.current = true; onSelect(i) }}
            onPointerEnter={() => { if (drawing.current) onSelect(i) }}
            className={cn(
              "w-12 h-12 rounded-full border-2 transition-all touch-none",
              on ? "bg-teal-500 border-teal-500 scale-110 shadow-lg shadow-teal-500/30" : "border-muted-foreground/30 bg-muted/40",
            )}
            aria-label={`نقطة النمط ${i + 1}`}
          />
        )
      })}
    </div>
  )
}
