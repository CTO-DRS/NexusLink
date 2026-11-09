"use client"
// FA-18 (تكليف 45) — مزوّد React Query على الشجرة كلها
// =====================================================
// العيب الذي كشفه الفحص الحي بالمتصفح (وكان موجودًا في main قبل الموجة):
// useQueryClient() في جرس التسليم (TopBar → HandoffBell) كان يرمي
// «No QueryClient set» أثناء SSR — فكانت /?desktop=1 (نافذة سطح المكتب
// نفسها!) و /?app=1 تجيبان 500 وصفحة خطأ __next_error__ بلا واجهة —
// لم يكشفه أي E2E قائم على fetch لأنه يفحص الـAPI والأسماء لا رسم الصفحة.
// مزوّد واحد هنا = مصدر حقيقة واحد للذاكرة الاستعلامية عبر كل الأوضاع
// (سطح المكتب · متصفح المالك · /phone) — بلا تعديل أي مستهلك.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useState } from "react"

export function QueryProviders({ children }: { children: React.ReactNode }) {
  const [qc] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // تطبيق محلي: بيانات حية كل ثوانٍ — إعادة جلب عند التركيز زائدة
            staleTime: 3_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  )
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}
