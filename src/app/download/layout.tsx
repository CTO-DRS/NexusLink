import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "تحميل NexusLink — Windows وmacOS وLinux وAndroid",
  description:
    "الموقع الرسمي لتنزيل NexusLink: اربط هاتفك بجهاز الكمبيوتر محليًا — حافظة مشتركة، نقل ملفات، تحكم عن بُعد، ومرآة شاشة بتشفير من الطرف إلى الطرف. مثبّتات رسمية موقّعة مع بصمات SHA256 وتحديث تلقائي.",
  openGraph: {
    title: "تحميل NexusLink",
    description:
      "اربط أجهزتك محليًا بخصوصية كاملة — تحميل لأنظمة Windows وmacOS وLinux وAndroid.",
    type: "website",
  },
}

export default function DownloadLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children
}
