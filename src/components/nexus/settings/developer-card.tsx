"use client"
// About the developer: dark glass card (developer's design spec), RTL-safe.
// The card keeps its own dark palette in both themes; links open only on click.
import { useEffect, useState } from "react"
import Image from "next/image"
import { createPortal } from "react-dom"
import QRCode from "qrcode"
import { toast } from "sonner"
import { Globe, Check, X as XIcon, Copy, ExternalLink, Share2, QrCode, ContactRound } from "lucide-react"
import { useI18n } from "@/lib/i18n"
import { BRAND_PATHS, CARD_THEMES, DEVELOPER, buildVCard } from "@/lib/developer-links"
import { APP_SITE_URL, BANNER_INTERVAL_MS, DEVELOPER_BANNERS, RELEASES_PAGE, activeBanners } from "@/lib/developer-banners"
import pkg from "../../../../package.json"

function Glyph({ id }: { id: string }) {
  if (id === "website") return <Globe className="h-[22px] w-[22px]" aria-hidden />
  return (
    <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" fill="currentColor" aria-hidden>
      <path d={BRAND_PATHS[id as keyof typeof BRAND_PATHS]} />
    </svg>
  )
}

export function DeveloperCard() {
  const { t } = useI18n()
  const [viewer, setViewer] = useState(false)
  const [sel, setSel] = useState<(typeof DEVELOPER.links)[number] | null>(null)
  const [qr, setQr] = useState<{ url: string; data: string } | null>(null)
  useEffect(() => {
    if (!sel) return
    let alive = true
    // QR is generated on-device; nothing leaves the machine.
    QRCode.toDataURL(sel.url, { width: 280, margin: 1, errorCorrectionLevel: "M" }).then((u) => alive && setQr({ url: sel.url, data: u })).catch(() => {})
    const h = (e: KeyboardEvent) => e.key === "Escape" && setSel(null)
    window.addEventListener("keydown", h)
    return () => { alive = false; window.removeEventListener("keydown", h) }
  }, [sel])
  const shareText = async (title: string, text: string) => {
    try {
      if (typeof navigator.share === "function") { await navigator.share({ title, text }); return }
    } catch (e) { if ((e as Error)?.name === "AbortError") return }
    try { await navigator.clipboard.writeText(text); toast.success(t("نُسخ الرابط")) } catch { /* clipboard blocked */ }
  }
  const shareApp = () => shareText("NexusLink", `${t("جرّب NexusLink — اربط أجهزتك عبر شبكتك المحلية، بلا سحابة وبلا حساب.")}\n${APP_SITE_URL}`)
  const shareAll = () =>
    shareText(
      `CTO: DRS • ${t("حسابات المطوّر")}`,
      `CTO: DRS\n` + DEVELOPER.links.map((l) => `${l.id === "github" ? "GitHub" : t(l.label)}: ${l.url}`).join("\n"),
    )
  // Update check: a single request to the public GitHub releases API, only when the user taps the button.
  const [upd, setUpd] = useState<{ state: "idle" | "busy" | "latest" | "new" | "error"; tag?: string }>({ state: "idle" })
  const checkUpdates = async () => {
    setUpd({ state: "busy" })
    try {
      // Same-origin proxy (CSP connect-src 'self'); live=false means GitHub was unreachable.
      const r = await fetch("/api/releases/latest", { cache: "no-store" })
      const d = await r.json()
      if (!r.ok || !d?.live) throw new Error("offline")
      const tag = String(d.version ?? d.tag ?? "").replace(/^v/, "")
      const num = (v: string) => v.split(".").map((x) => parseInt(x, 10) || 0)
      const [a, b] = [num(tag), num(pkg.version)]
      const newer = (() => { for (let i = 0; i < 3; i++) { if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0) } return false })()
      setUpd({ state: newer ? "new" : "latest", tag })
    } catch { setUpd({ state: "error" }) }
  }
  // Banner carousel: auto-advances, pauses on hover/focus, respects reduced motion.
  const [banners] = useState(() => activeBanners(DEVELOPER_BANNERS, Date.now()))
  const [themeId, setThemeId] = useState<string>(() => (typeof window !== "undefined" && localStorage.getItem("nexus.devcard.theme")) || "violet")
  const [anim, setAnim] = useState<boolean>(() => typeof window !== "undefined" && localStorage.getItem("nexus.devcard.anim") === "1")
  const theme = CARD_THEMES.find((x) => x.id === themeId) ?? CARD_THEMES[0]
  const pickTheme = (id: string) => { setThemeId(id); try { localStorage.setItem("nexus.devcard.theme", id) } catch { /* private mode */ } }
  const toggleAnim = () => { const v = !anim; setAnim(v); try { localStorage.setItem("nexus.devcard.anim", v ? "1" : "0") } catch { /* private mode */ } }
  // One-tap contact save: a vCard (.vcf) with the photo, built on-device.
  const saveContact = async () => {
    let b64: string | undefined
    try {
      const buf = new Uint8Array(await (await fetch(DEVELOPER.photo)).arrayBuffer())
      let bin = ""
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
      b64 = btoa(bin)
    } catch { /* photo optional */ }
    const blob = new Blob([buildVCard(b64)], { type: "text/vcard;charset=utf-8" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob); a.download = "CTO-DRS.vcf"; a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
    toast.success(t("حُفظت جهة الاتصال"))
  }
  const [bi, setBi] = useState(0)
  const [paused, setPaused] = useState(false)
  useEffect(() => {
    if (paused || banners.length < 2) return
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return
    const id = setInterval(() => setBi((i) => (i + 1) % banners.length), BANNER_INTERVAL_MS)
    return () => clearInterval(id)
  }, [paused, banners.length])
  // Share the account URL through the native share sheet (Web Share API); clipboard fallback.
  const shareLink = async (l: { label: string; url: string }) => {
    const title = l.label === "GitHub" ? "GitHub" : t(l.label)
    try {
      if (typeof navigator.share === "function") { await navigator.share({ title: `CTO: DRS • ${title}`, url: l.url }); return }
    } catch (e) { if ((e as Error)?.name === "AbortError") return }
    await copy(l.url)
  }
  // Share the on-device QR as a PNG file; when files can't be shared natively, download it.
  const shareQr = async (l: { id: string; url: string }, dataUrl: string) => {
    const blob = await (await fetch(dataUrl)).blob()
    const file = new File([blob], `cto-drs-${l.id}-qr.png`, { type: "image/png" })
    try {
      if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: `CTO: DRS • ${l.id}`, url: l.url }); return
      }
    } catch (e) { if ((e as Error)?.name === "AbortError") return }
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob); a.download = file.name; a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
    toast.success(t("حُفظ رمز QR كصورة"))
  }
  const copy = async (url: string) => {
    try { await navigator.clipboard.writeText(url); toast.success(t("نُسخ الرابط")) } catch { /* clipboard blocked */ }
  }
  useEffect(() => {
    if (!viewer) return
    const h = (e: KeyboardEvent) => e.key === "Escape" && setViewer(false)
    window.addEventListener("keydown", h)
    return () => window.removeEventListener("keydown", h)
  }, [viewer])

  return (
    <section data-testid="developer-card" className="space-y-3">
      <div className="flex items-center gap-2.5">
        <span className="h-5 w-1 rounded-full" style={{ background: "#6D3FC9" }} aria-hidden />
        <h3 className="text-[17px] font-semibold text-foreground">{t("عن المطوّر")}</h3>
        <span className="h-px flex-1" style={{ background: "#40A78BFA" }} aria-hidden />
      </div>

      <div
        data-testid="dev-banner"
        className="relative overflow-hidden rounded-2xl"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocusCapture={() => setPaused(true)}
        onBlurCapture={() => setPaused(false)}
      >
        <div className="flex transition-transform duration-500 ease-out motion-reduce:transition-none" style={{ transform: `translateX(-${bi * 100}%)` }} dir="ltr">
          {banners.map((b) => (
            <a
              key={b.id}
              href={b.url}
              target="_blank"
              rel="noopener noreferrer"
              dir="auto"
              className="flex min-h-[88px] w-full shrink-0 items-center justify-between gap-3 p-4 text-white"
              style={{ background: b.gradient }}
              aria-hidden={(banners[bi] ?? banners[0]).id !== b.id}
              tabIndex={(banners[bi] ?? banners[0]).id === b.id ? 0 : -1}
            >
              <span className="min-w-0 flex-1 text-start">
                <span className="block text-[15px] font-bold leading-6">{t(b.title)}</span>
                <span className="block text-[12px] leading-5 text-white/80">{t(b.body)}</span>
              </span>
              <span className="shrink-0 rounded-full bg-white/20 px-3.5 py-1.5 text-xs font-semibold backdrop-blur">{t(b.cta)}</span>
            </a>
          ))}
        </div>
        {banners.length > 1 && (
          <div className="absolute inset-x-0 bottom-1.5 flex justify-center gap-1.5" dir="ltr">
            {banners.map((b, i) => (
              <button key={b.id} type="button" aria-label={`${i + 1}/${banners.length}: ${t(b.title)}`} aria-current={i === bi ? "true" : undefined} onClick={() => setBi(i)} className="flex h-5 items-center px-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 rounded-full">
                <span className={`block h-1.5 rounded-full transition-all ${i === bi ? "w-4 bg-white" : "w-1.5 bg-white/50"}`} />
              </button>
            ))}
          </div>
        )}
      </div>

      <div
        className="relative overflow-hidden rounded-3xl p-4"
        style={{
          background: "linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.05)), rgba(11,12,36,.92)",
          border: "1px solid transparent",
          backgroundClip: "padding-box",
          boxShadow: "0 0 0 1px rgba(142,91,208,.36), 0 12px 40px -12px rgba(85,88,194,.45)",
        }}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-16" style={{ background: "linear-gradient(180deg,rgba(255,255,255,.11),transparent)" }} aria-hidden />
        <div className="pointer-events-none absolute -top-16 left-1/2 h-40 w-72 -translate-x-1/2 rounded-full blur-3xl" style={{ background: `radial-gradient(closest-side,${theme.glow},transparent)`, animation: anim ? "nx-aurora 9s ease-in-out infinite alternate" : undefined }} aria-hidden />

        <div className="relative flex flex-col items-center text-center">
          <button
            type="button"
            onClick={() => setViewer(true)}
            aria-label={t("صورة المطوّر")}
            className="relative h-24 w-24 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
            style={{ background: theme.ring, padding: 3 }}
          >
            <span className="block h-full w-full rounded-full" style={{ background: "#161437", padding: 3 }}>
              <Image src={DEVELOPER.photo} alt={DEVELOPER.name} width={90} height={90} className="h-full w-full rounded-full object-cover" />
            </span>
            <span
              className="absolute -bottom-0.5 -end-0.5 flex h-[26px] w-[26px] items-center justify-center rounded-full text-white"
              style={{ background: "#1D9BF0", boxShadow: "0 0 0 2px #0B0C24" }}
              title={t("حساب موثّق")}
            >
              <Check className="h-4 w-4" strokeWidth={3} aria-hidden />
            </span>
          </button>

          <div className="mt-3 text-xl font-bold text-white" dir="ltr" data-no-i18n>{DEVELOPER.name}</div>
          <p className="mt-0.5 text-[13px]" style={{ color: "#A5B4FC" }}>{t("مطوّر تطبيقات • استشارات تقنية")}</p>

          <nav aria-label={t("حسابات المطوّر")} className="mt-5 grid w-full max-w-sm grid-cols-4 gap-x-2 gap-y-4">
            {DEVELOPER.links.map((l) => (
              <button
                type="button"
                key={l.id}
                onClick={() => setSel(l)}
                aria-haspopup="dialog"
                data-testid={`dev-link-${l.id}`}
                className="group flex flex-col items-center gap-1.5 focus-visible:outline-none"
              >
                <span
                  className="flex h-[46px] w-[46px] items-center justify-center rounded-full text-white transition-transform group-hover:-translate-y-0.5 group-focus-visible:ring-2 group-focus-visible:ring-indigo-300"
                  style={{ background: l.color, boxShadow: "0 0 0 1px rgba(255,255,255,.25)" }}
                >
                  <Glyph id={l.id} />
                </span>
                <span className="text-[11px]" style={{ color: "#CBD5E1" }}>{l.id === "github" ? "GitHub" : t(l.label)}</span>
              </button>
            ))}
          </nav>

          <div className="mt-5 grid w-full max-w-sm grid-cols-2 gap-3">
            <button type="button" onClick={shareApp} data-testid="dev-share-app" className="flex h-11 items-center justify-center gap-2 rounded-2xl text-sm font-semibold text-white" style={{ background: theme.btn }}>
              <Share2 className="h-4 w-4" /> {t("شارك التطبيق")}
            </button>
            <button type="button" onClick={shareAll} data-testid="dev-share-all" className="flex h-11 items-center justify-center gap-2 rounded-2xl border border-white/20 bg-white/10 text-sm font-semibold text-white hover:bg-white/15">
              <Share2 className="h-4 w-4" /> {t("شارك كل الحسابات")}
            </button>
          </div>

          <button type="button" onClick={saveContact} data-testid="dev-save-contact" className="mt-3 flex h-11 w-full max-w-sm items-center justify-center gap-2 rounded-2xl border border-white/20 bg-white/10 text-sm font-semibold text-white hover:bg-white/15">
            <ContactRound className="h-4 w-4" /> {t("حفظ جهة الاتصال")}
          </button>

          <div className="mt-4 flex items-center gap-2" data-testid="dev-themes" aria-label={t("مظهر البطاقة")} role="group">
            {CARD_THEMES.map((x) => (
              <button key={x.id} type="button" aria-label={t(x.label)} aria-pressed={x.id === theme.id} onClick={() => pickTheme(x.id)}
                className="h-6 w-6 rounded-full transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
                style={{ background: x.swatch, boxShadow: x.id === theme.id ? "0 0 0 2px #0B0C24, 0 0 0 4px rgba(255,255,255,.8)" : "0 0 0 1px rgba(255,255,255,.25)" }} />
            ))}
            <button type="button" onClick={toggleAnim} aria-pressed={anim} className={`ms-2 rounded-full border px-3 py-1 text-[11px] font-medium ${anim ? "border-white/60 bg-white/20 text-white" : "border-white/20 text-white/70"}`}>
              {t("خلفية متحركة")}
            </button>
          </div>

          <div className="mt-5 flex flex-col items-center gap-2">
            <div className="text-[11px]" style={{ color: "#64748B" }} dir="ltr" data-no-i18n>NexusLink • v{pkg.version}</div>
            <button type="button" onClick={checkUpdates} disabled={upd.state === "busy"} data-testid="dev-check-updates" className="rounded-full border border-white/20 bg-white/5 px-4 py-1.5 text-xs font-medium text-white/90 hover:bg-white/10 disabled:opacity-60">
              {upd.state === "busy" ? t("جارٍ التحقق…") : t("التحقق من التحديثات")}
            </button>
            {upd.state === "latest" && <div className="text-xs" style={{ color: "#6EE7B7" }}>{t("أنت على أحدث إصدار")}</div>}
            {upd.state === "error" && <div className="text-xs" style={{ color: "#FCA5A5" }}>{t("تعذّر التحقق — تأكد من اتصالك بالإنترنت")}</div>}
            {upd.state === "new" && (
              <a href={RELEASES_PAGE} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold underline" style={{ color: "#A5B4FC" }}>
                {t("إصدار جديد متاح")} <span dir="ltr" data-no-i18n>v{upd.tag}</span> • {t("عرض الإصدار")}
              </a>
            )}
          </div>
        </div>
      </div>


      {sel && typeof document !== "undefined" && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t(sel.label)}
          data-testid="dev-qr-sheet"
          className="fixed inset-0 z-[100] flex items-end justify-center bg-black/55 p-4 backdrop-blur-md sm:items-center"
          onClick={() => setSel(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-sm overflow-hidden rounded-3xl p-5 text-center text-white"
            style={{
              background: "linear-gradient(180deg,rgba(255,255,255,.10),rgba(255,255,255,.04)), rgba(11,12,36,.82)",
              backdropFilter: "blur(24px) saturate(140%)",
              boxShadow: "0 0 0 1px rgba(142,91,208,.40), 0 24px 60px -12px rgba(0,0,0,.6)",
            }}
          >
            <button type="button" autoFocus aria-label={t("إغلاق")} onClick={() => setSel(null)} className="absolute end-3 top-3 rounded-full bg-white/10 p-1.5 hover:bg-white/20">
              <XIcon className="h-4 w-4" />
            </button>
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full" style={{ background: sel.color, boxShadow: "0 0 0 1px rgba(255,255,255,.25)" }}>
              <Glyph id={sel.id} />
            </div>
            <div className="mt-2 text-base font-bold">{sel.id === "github" ? "GitHub" : t(sel.label)}</div>
            <div className="mx-auto mt-3 flex h-[200px] w-[200px] items-center justify-center rounded-2xl bg-white p-2.5">
              {qr && qr.url === sel.url ? <img src={qr.data} alt={sel.url} className="h-full w-full" /> : <span className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />}
            </div>
            <p className="mt-3 text-[12px]" style={{ color: "#CBD5E1" }}>{t("امسح الرمز بهاتفك لفتح الحساب")}</p>
            <div className="mt-1 truncate text-[11px]" style={{ color: "#64748B" }} dir="ltr" data-no-i18n>{sel.url}</div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <a
                href={sel.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setSel(null)}
                className="flex h-11 items-center justify-center gap-2 rounded-2xl text-sm font-semibold text-white"
                style={{ background: "linear-gradient(135deg,#6366F1,#A855F7)" }}
              >
                <ExternalLink className="h-4 w-4" /> {t("فتح")}
              </a>
              <button
                type="button"
                onClick={() => copy(sel.url)}
                className="flex h-11 items-center justify-center gap-2 rounded-2xl border border-white/20 bg-white/10 text-sm font-semibold text-white hover:bg-white/15"
              >
                <Copy className="h-4 w-4" /> {t("نسخ الرابط")}
              </button>
              <button
                type="button"
                onClick={() => shareLink(sel)}
                className="flex h-11 items-center justify-center gap-2 rounded-2xl border border-white/20 bg-white/10 text-sm font-semibold text-white hover:bg-white/15"
              >
                <Share2 className="h-4 w-4" /> {t("مشاركة الرابط")}
              </button>
              <button
                type="button"
                disabled={!qr || qr.url !== sel.url}
                onClick={() => qr && shareQr(sel, qr.data)}
                className="flex h-11 items-center justify-center gap-2 rounded-2xl border border-white/20 bg-white/10 text-sm font-semibold text-white hover:bg-white/15 disabled:opacity-50"
              >
                <QrCode className="h-4 w-4" /> {t("مشاركة رمز QR")}
              </button>
            </div>
          </div>
        </div>
      , document.body)}

      {viewer && typeof document !== "undefined" && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t("صورة المطوّر")}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-6 backdrop-blur-sm"
          onClick={() => setViewer(false)}
        >
          <button type="button" autoFocus aria-label={t("إغلاق")} className="absolute end-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20" onClick={() => setViewer(false)}>
            <XIcon className="h-5 w-5" />
          </button>
          <img src={DEVELOPER.photo} alt={DEVELOPER.name} className="max-h-full max-w-full rounded-2xl object-contain shadow-2xl" />
        </div>
      , document.body)}
    </section>
  )
}
