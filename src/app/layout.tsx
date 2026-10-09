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
            __html: `try{var t=localStorage.getItem('nexus-theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark')}}catch(e){}`,
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
