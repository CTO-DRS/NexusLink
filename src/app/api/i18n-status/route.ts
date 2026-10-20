import { NextResponse } from "next/server"
import RAW_MAP from "@/lib/ar-en-map.json"
import FR_MAP from "@/lib/i18n/fr.json"
import ES_MAP from "@/lib/i18n/es.json"
import DE_MAP from "@/lib/i18n/de.json"
import RU_MAP from "@/lib/i18n/ru.json"

export const dynamic = "force-dynamic"

/**
 * M1.4 (عقد §31) — نقطة تشخيص اللغات الست.
 * بيانات وصفية حصرًا (رموز · اتجاهات · عدّادات مدخلات) — لا محتوى ترجمة
 * (حرس F6 متوافق: ما لا يعطيه بث الواجهة لا يسرّبه التشخيص).
 */
const AR_RE = /[\u0600-\u06FF]/

const countArabicKeys = (m: Record<string, string>) =>
  Object.keys(m).filter((k) => AR_RE.test(k)).length

export async function GET() {
  const en = countArabicKeys(RAW_MAP as Record<string, string>)
  const fr = countArabicKeys(FR_MAP as Record<string, string>)
  const es = countArabicKeys(ES_MAP as Record<string, string>)
  const de = countArabicKeys(DE_MAP as Record<string, string>)
  const ru = countArabicKeys(RU_MAP as Record<string, string>)
  return NextResponse.json({
    ok: true,
    contract: "§31",
    fallback: "lang→en→raw",
    langs: [
      { code: "ar", native: "العربية", dir: "rtl", locale: "ar", entries: null },
      { code: "en", native: "English", dir: "ltr", locale: "en", entries: en },
      { code: "fr", native: "Français", dir: "ltr", locale: "fr", entries: fr },
      { code: "es", native: "Español", dir: "ltr", locale: "es", entries: es },
      { code: "de", native: "Deutsch", dir: "ltr", locale: "de", entries: de },
      { code: "ru", native: "Русский", dir: "ltr", locale: "ru", entries: ru },
    ],
    at: Date.now(),
  })
}
