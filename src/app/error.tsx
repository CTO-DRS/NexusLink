"use client"
// NexusLink — G7: حد خطأ التطبيق — رسالة عامة فقط. error.message لا يُعرض أبدًا
// (قد يحمل مسارات أو تفاصيل داخلية)؛ الرمز المرجعي digest يربط بسجل الخادم.
import { ErrorShell } from "@/components/nexus/error-shell"

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <ErrorShell
      code="500"
      title="حدث خطأ غير متوقع"
      body="تعذر عرض هذه الصفحة. أعد المحاولة، وإن تكرر الخطأ فأعد تشغيل NexusLink."
      digest={error.digest}
      onRetry={reset}
    />
  )
}
