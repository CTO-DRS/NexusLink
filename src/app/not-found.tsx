// NexusLink — G7: صفحة 404 عامة (لا مسار مطلوب يُعكس ولا تفاصيل خادم)
import { ErrorShell } from "@/components/nexus/error-shell"

export const metadata = { title: "NexusLink — الصفحة غير موجودة" }

export default function NotFound() {
  return (
    <ErrorShell
      code="404"
      title="الصفحة غير موجودة"
      body="الرابط الذي فتحته غير متاح في NexusLink."
    />
  )
}
