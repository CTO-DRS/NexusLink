"use client"
// About the developer: dark glass card (developer's design spec), RTL-safe.
// The card keeps its own dark palette in both themes; links open only on click.
import { useEffect, useState } from "react"
import Image from "next/image"
import { Globe, Check, X as XIcon } from "lucide-react"
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
              <a
                key={l.id}
                href={l.url}
                target="_blank"
                rel="noopener noreferrer"
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
              </a>
            ))}
          </nav>

          <div className="mt-5 text-[11px]" style={{ color: "#64748B" }} dir="ltr" data-no-i18n>NexusLink • v{pkg.version}</div>
        </div>
      </div>

      {viewer && (
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
      )}
    </section>
  )
}
