"use client"
// NexusLink — G7: خطأ جذري (يحل محل التخطيط الجذري) — نص عام بلا أي تفصيل داخلي.
// يتجنب أي سكربت مضمّن: CSP بالـnonce تبقى سارية.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ar" dir="rtl">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", textAlign: "center", padding: 24 }}>
        <main data-testid="global-error">
          <div style={{ fontSize: 44, fontWeight: 900 }} dir="ltr">500</div>
          <h1 style={{ fontSize: 20 }}>حدث خطأ غير متوقع</h1>
          <p style={{ fontSize: 13, opacity: 0.75 }}>تعذر تشغيل الواجهة. أعد المحاولة، وإن تكرر الخطأ فأعد تشغيل NexusLink.</p>
          {error.digest && <p style={{ fontSize: 11, opacity: 0.6 }}>الرمز المرجعي: <span dir="ltr">{error.digest}</span></p>}
          <button type="button" onClick={reset} style={{ marginTop: 12, padding: "8px 16px", borderRadius: 12, border: "1px solid #ccc", background: "transparent", cursor: "pointer" }}>
            إعادة المحاولة
          </button>
        </main>
      </body>
    </html>
  )
}
