#!/usr/bin/env node
// §61 — مفاتيح عتبة الماسح إلى المعاجم الخمسة بتنسيق مطابق (فاصلة فاصلة)
// درس §42: قرار الترجمة يجب أن يلامس المعاجم الخمسة كلها — التطابق الكامل إلزامي.
// درس §57: وصف الماسح القديم («بلا معالجة صور») حُذف من الخمسة معًا واستُبدل
// بالوصف الجديد الصادق — صفر مفاتيح يتيمة.
import fs from "node:fs"

const OLD_KEY = "صفحات JPEG من هاتفك تُدمج في PDF على هذا الحاسوب حصرًا — بلا سحابة ولا معالجة صور (مرور نقي)"

const KEYS = {
  "صفحات JPEG من هاتفك تُدمج في PDF على هذا الحاسوب حصرًا — بلا سحابة، ومعالجة اختيارية تُطبَّق عند الختم فقط (الأصل لا يُمس)": {
    en: "JPEG pages from your phone become one PDF on this computer only — no cloud, optional enhancement applied at seal time only (the original is never touched)",
    fr: "Les pages JPEG de votre téléphone deviennent un PDF sur cet ordinateur uniquement — sans cloud, amélioration optionnelle appliquée uniquement au scellement (l'original n'est jamais modifié)",
    es: "Las páginas JPEG de tu teléfono se convierten en un PDF solo en este equipo — sin nube, mejora opcional aplicada únicamente al sellar (el original nunca se toca)",
    de: "JPEG-Seiten von Ihrem Telefon werden nur auf diesem Computer zu einem PDF — ohne Cloud, optionale Verbesserung nur beim Versiegeln (das Original bleibt unangetastet)",
    ru: "Страницы JPEG с вашего телефона объединяются в PDF только на этом компьютере — без облака, необязательное улучшение применяется только при запечатывании (оригинал не трогается)",
  },
  "بلا معالجة": {
    en: "No processing",
    fr: "Sans traitement",
    es: "Sin procesamiento",
    de: "Ohne Verarbeitung",
    ru: "Без обработки",
  },
  "رمادي محسّن": {
    en: "Enhanced gray",
    fr: "Gris amélioré",
    es: "Gris mejorado",
    de: "Verbessertes Grau",
    ru: "Улучшенный серый",
  },
  "أبيض وأسود": {
    en: "Black & white",
    fr: "Noir et blanc",
    es: "Blanco y negro",
    de: "Schwarzweiß",
    ru: "Чёрно-белое",
  },
  "حد العتبة": {
    en: "Threshold",
    fr: "Seuil",
    es: "Umbral",
    de: "Schwelle",
    ru: "Порог",
  },
  "المعالجة": {
    en: "Processing",
    fr: "Traitement",
    es: "Procesamiento",
    de: "Verarbeitung",
    ru: "Обработка",
  },
  "المعالجة في الذاكرة عند الختم حصرًا — ملف الصفحة الأصلي على القرص لا يُمس": {
    en: "Processing happens in memory at seal time only — the original page file on disk is never touched",
    fr: "Le traitement se fait en mémoire au scellement uniquement — le fichier de page original sur disque n'est jamais modifié",
    es: "El procesamiento ocurre en memoria solo al sellar — el archivo de página original en disco nunca se toca",
    de: "Verarbeitung erfolgt nur im Speicher beim Versiegeln — die ursprüngliche Seitendatei auf der Festplatte bleibt unangetastet",
    ru: "Обработка происходит в памяти только при запечатывании — исходный файл страницы на диске никогда не трогается",
  },
}

const FILES = {
  en: "src/lib/ar-en-map.json",
  fr: "src/lib/i18n/fr.json",
  es: "src/lib/i18n/es.json",
  de: "src/lib/i18n/de.json",
  ru: "src/lib/i18n/ru.json",
}

// عدد المفاتيح العربية قبل التدوين (حارس أ27 يعدّ العربية حصرًا — درس §57)
const isArabic = (k) => /[\u0600-\u06FF]/.test(k)

for (const [lang, file] of Object.entries(FILES)) {
  const raw = fs.readFileSync(file, "utf8")
  const map = JSON.parse(raw)
  const before = Object.keys(map).filter(isArabic).length
  let removed = 0
  if (OLD_KEY in map) { delete map[OLD_KEY]; removed++ }
  let added = 0
  for (const [k, tr] of Object.entries(KEYS)) {
    if (k in map) continue
    map[k] = tr[lang]
    added++
  }
  // نفس تنسيق المستودع: إزاحة 2 وفاصلة فاصلة بين المدخلات + سطر ختامي
  let out = JSON.stringify(map, null, 2).replace(/,\n/g, ", \n")
  if (!out.endsWith("\n")) out += "\n"
  fs.writeFileSync(file, out)
  const after = Object.keys(map).filter(isArabic).length
  console.log(`${lang}: +${added} −${removed} → ${Object.keys(map).length} (عربي ${before} → ${after})`)
}

// تحقق التطابق الكامل
const keysets = Object.values(FILES).map((f) => Object.keys(JSON.parse(fs.readFileSync(f, "utf8"))).sort())
const base = JSON.stringify(keysets[0])
const allEqual = keysets.every((k) => JSON.stringify(k) === base)
console.log("parity:", allEqual ? "MATCH" : "DRIFT!")
const counts = Object.values(FILES).map((f) => Object.keys(JSON.parse(fs.readFileSync(f, "utf8"))).filter(isArabic).length)
console.log("arabic:", counts.join("/"))
process.exit(allEqual ? 0 : 1)
