import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

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

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('nexus-theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark')}}catch(e){}
try{var l=localStorage.getItem('nexus-lang');if(l==='en'){document.documentElement.lang='en';document.documentElement.dir='ltr'}else{document.documentElement.lang='ar';document.documentElement.dir='rtl'}}catch(e){}
try{var fs=localStorage.getItem('nexus-font-scale');if(fs)document.documentElement.style.fontSize=(16*parseFloat(fs))+'px';var ct=localStorage.getItem('nexus-contrast');if(ct==='high')document.documentElement.classList.add('contrast-high');var mo=localStorage.getItem('nexus-motion');if(mo==='reduced')document.documentElement.classList.add('motion-reduced')}catch(e){}`,
          }}
        />
      </head>
      <body className="antialiased bg-background text-foreground nexus-font">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
