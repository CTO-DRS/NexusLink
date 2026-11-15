"use client"
// NexusLink — G7: هيكل صفحات الخطأ العامة (404 · خطأ تطبيق · خطأ جذري)
// لا مسارات داخلية ولا رسائل استثناء ولا آثار مكدس — نص عام + رمز مرجعي (digest)
// يطابق سجل الخادم دون كشف أي تفصيل. النص عربي مصدري ويُترجم بماسح i18n.
import { useEffect } from "react"
import Link from "next/link"
import { initLang } from "@/lib/i18n"

export function ErrorShell({
  code,
  title,
  body,
  digest,
  onRetry,
}: {
  code: string
  title: string
  body: string
  digest?: string
  onRetry?: () => void
}) {
  useEffect(() => {
    try {
      initLang()
    } catch { /* ignore */ }
  }, [])
  return (
    <main className="min-h-[70vh] grid place-items-center px-6 py-16" data-testid="error-shell">
      <div className="max-w-md text-center space-y-3">
        <div className="text-5xl font-black text-primary/80 tabular-nums" dir="ltr">{code}</div>
        <h1 className="text-xl font-extrabold">{title}</h1>
        <p className="text-[13px] text-muted-foreground leading-relaxed">{body}</p>
        {digest && (
          <p className="text-[11px] text-muted-foreground">
            الرمز المرجعي: <span className="font-mono" dir="ltr">{digest}</span>
          </p>
        )}
        <div className="flex items-center justify-center gap-2 pt-2">
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="rounded-xl border px-4 py-2 text-[13px] font-semibold hover:bg-accent"
            >
              إعادة المحاولة
            </button>
          )}
          <Link href="/" className="rounded-xl bg-primary text-primary-foreground px-4 py-2 text-[13px] font-semibold">
            العودة إلى الرئيسية
          </Link>
        </div>
      </div>
    </main>
  )
}
