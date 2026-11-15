import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { QueryProviders } from "@/components/nexus/query-providers";
import { DemoModeProvider } from "@/components/nexus/demo-mode-provider";
import { isDemoMode } from "@/lib/nexus/demo-mode";

export const metadata: Metadata = {
  title: "NexusLink — منصة إدارة الأجهزة الموحدة",
  description:
    "منصة موحدة لربط وإدارة أجهزتك: نقل الملفات، استكشاف التخزين، المعاينة الفورية — كل شيء محلياً على شبكتك.",
  icons: { icon: "/logo.svg" },
};

export const viewport: Viewport = {
  themeColor: "#0d9488",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // FA-18 (تكليف 45): سكربت الثيم المضمّن يحمل نفس nonce الذي وضعه الوسيط
  // في CSP — بلا nonce سيرفضه المتصفح فورًا (script-src nonce + strict-dynamic).
  // قراءة headers() تجعل التخطيط ديناميكيًا — التكلفة مللي ثوانٍ محليًا مقابل
  // قفل XSS كامل (موثقة بصدق في §FA-18).
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  // G2/P0: علم العرض التوضيحي يُقرأ وقت الطلب على الخادم ويُمرَّر خاصيةً (قيمة منطقية فقط)
  const demo = isDemoMode();
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('nexus-theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark')}}catch(e){}
try{var l=localStorage.getItem('nexus-lang');if(l==='en'){document.documentElement.lang='en';document.documentElement.dir='ltr'}else{document.documentElement.lang='ar';document.documentElement.dir='rtl'}}catch(e){}
try{var fs=localStorage.getItem('nexus-font-scale');if(fs)document.documentElement.style.fontSize=(16*parseFloat(fs))+'px';var ct=localStorage.getItem('nexus-contrast');if(ct==='high')document.documentElement.classList.add('contrast-high');var mo=localStorage.getItem('nexus-motion');if(mo==='reduced')document.documentElement.classList.add('motion-reduced')}catch(e){}`,
          }}
        />
      </head>
      <body className="antialiased bg-background text-foreground nexus-font">
        {/* FA-18: مزوّد الاستعلامات على الشجرة كلها — كان غيابه يُسقط SSR لواجهة
            التطبيق (/?desktop=1 و /?app=1) بخطأ No QueryClient set (كشف حي) */}
        <QueryProviders>
          <DemoModeProvider demo={demo}>
            {children}
          </DemoModeProvider>
        </QueryProviders>
        <Toaster />
      </body>
    </html>
  );
}
