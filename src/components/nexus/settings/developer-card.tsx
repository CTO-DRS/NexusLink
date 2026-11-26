"use client"
// About the developer: dark glass card (developer's design spec), RTL-safe.
// The card keeps its own dark palette in both themes; links open only on click.
import { useEffect, useState } from "react"
import Image from "next/image"
import { createPortal } from "react-dom"
import QRCode from "qrcode"
import { toast } from "sonner"
import { Globe, Check, X as XIcon, Copy, ExternalLink } from "lucide-react"
import { useI18n } from "@/lib/i18n"
import { BRAND_PATHS, DEVELOPER } from "@/lib/developer-links"
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
        className="relative overflow-hidden rounded-3xl p-4"
        style={{
          background: "linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.05)), rgba(11,12,36,.92)",
          border: "1px solid transparent",
          backgroundClip: "padding-box",
          boxShadow: "0 0 0 1px rgba(142,91,208,.36), 0 12px 40px -12px rgba(85,88,194,.45)",
        }}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-16" style={{ background: "linear-gradient(180deg,rgba(255,255,255,.11),transparent)" }} aria-hidden />
        <div className="pointer-events-none absolute -top-16 left-1/2 h-40 w-72 -translate-x-1/2 rounded-full blur-3xl" style={{ background: "radial-gradient(closest-side,rgba(99,102,241,.35),transparent)" }} aria-hidden />

        <div className="relative flex flex-col items-center text-center">
          <button
            type="button"
            onClick={() => setViewer(true)}
            aria-label={t("صورة المطوّر")}
            className="relative h-24 w-24 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
            style={{ background: "linear-gradient(135deg,#6366F1,#06B6D4,#A855F7)", padding: 3 }}
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

          <div className="mt-5 text-[11px]" style={{ color: "#64748B" }} dir="ltr" data-no-i18n>NexusLink • v{pkg.version}</div>
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
            <button type="button" aria-label={t("إغلاق")} onClick={() => setSel(null)} className="absolute end-3 top-3 rounded-full bg-white/10 p-1.5 hover:bg-white/20">
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
          <button type="button" aria-label={t("إغلاق")} className="absolute end-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20" onClick={() => setViewer(false)}>
            <XIcon className="h-5 w-5" />
          </button>
          <img src={DEVELOPER.photo} alt={DEVELOPER.name} className="max-h-full max-w-full rounded-2xl object-contain shadow-2xl" />
        </div>
      , document.body)}
    </section>
  )
}
