#!/usr/bin/env node
// §55 — إضافة مفاتيح i18n للماسح الموثق الحي بالتوازن التام (عقد §31/§42)
// النص العربي هو المفتاح المصدر — يُضاف لكل معجم ما ينقصه هو.
// الاستخدام: node scripts/add-scan-i18n.mjs
import fs from "node:fs"
import path from "node:path"

const ROOT = process.cwd()
const FILES = {
  en: path.join(ROOT, "src/lib/ar-en-map.json"),
  fr: path.join(ROOT, "src/lib/i18n/fr.json"),
  es: path.join(ROOT, "src/lib/i18n/es.json"),
  de: path.join(ROOT, "src/lib/i18n/de.json"),
  ru: path.join(ROOT, "src/lib/i18n/ru.json"),
}

// [ar, en, fr, es, de, ru]
const T = [
  ["الماسح الموثق الحي (§55)", "Live document scanner (§55)", "Scanner de documents en direct (§55)", "Escáner de documentos en vivo (§55)", "Live-Dokumentenscanner (§55)", "Живой сканер документов (§55)"],
  ["صفحات JPEG من هاتفك تُدمج في PDF على هذا الحاسوب حصرًا — بلا سحابة ولا معالجة صور (مرور نقي)", "JPEG pages from your phone become a PDF on this computer only — no cloud, no image processing (lossless passthrough)", "Pages JPEG de votre téléphone en PDF sur cet ordinateur uniquement — sans cloud ni retouche (transfert sans perte)", "Páginas JPEG de tu teléfono a PDF solo en esta computadora — sin nube ni procesamiento (paso sin pérdidas)", "JPEG-Seiten vom Handy werden nur auf diesem PC zu PDF — ohne Cloud oder Bildbearbeitung (verlustfrei)", "Страницы JPEG с телефона в PDF только на этом ПК — без облака и обработки (без потерь)"],
  ["صفحة", "page", "page", "página", "Seite", "стр."],
  ["لا جلسة مفتوحة", "No open session", "Aucune session ouverte", "Sin sesión abierta", "Keine offene Sitzung", "Нет открытой сессии"],
  ["عنوان المسح (مثلًا: عقد الإيجار)", "Scan title (e.g., rental contract)", "Titre du scan (ex. : bail)", "Título del escaneo (p. ej., contrato)", "Scantitel (z. B. Mietvertrag)", "Название скана (напр., договор)"],
  ["افتح جلسة مسح", "Open scan session", "Ouvrir une session", "Abrir sesión de escaneo", "Scansitzung öffnen", "Открыть сессию сканирования"],
  ["فُتحت جلسة المسح", "Scan session opened", "Session ouverte", "Sesión abierta", "Scansitzung geöffnet", "Сессия сканирования открыта"],
  ["أضف صفحات JPEG", "Add JPEG pages", "Ajouter des pages JPEG", "Añadir páginas JPEG", "JPEG-Seiten hinzufügen", "Добавить страницы JPEG"],
  ["ختم PDF", "Seal PDF", "Sceller le PDF", "Sellar PDF", "PDF versiegeln", "Запечатать PDF"],
  ["خُتم PDF في مجلد المستندات", "PDF sealed into the Documents folder", "PDF scellé dans Documents", "PDF sellado en Documentos", "PDF in Dokumente versiegelt", "PDF запечатан в Документы"],
  ["إلغاء الجلسة", "Cancel session", "Annuler la session", "Cancelar sesión", "Sitzung abbrechen", "Отменить сессию"],
  ["أُلغيت الجلسة ونُظّفت الصفحات", "Session cancelled and pages cleaned", "Session annulée et pages nettoyées", "Sesión cancelada y páginas limpiadas", "Sitzung abgebrochen, Seiten bereinigt", "Сессия отменена, страницы очищены"],
  ["لا صفحات بعد — ادفع صفحات JPEG من هاتفك أو أضفها من هنا", "No pages yet — push JPEG pages from your phone or add them here", "Aucune page — envoyez des pages JPEG de votre téléphone ou ajoutez-les ici", "Sin páginas — envía páginas JPEG de tu teléfono o añádelas aquí", "Noch keine Seiten — JPEG-Seiten vom Handy schicken oder hier hinzufügen", "Страниц пока нет — отправьте JPEG с телефона или добавьте здесь"],
  ["أُضيفت", "added", "ajoutée(s)", "añadida(s)", "hinzugefügt", "добавлено"],
  ["للأعلى", "Move up", "Monter", "Subir", "Nach oben", "Вверх"],
  ["للأسفل", "Move down", "Descendre", "Bajar", "Nach unten", "Вниз"],
  ["الماسح الموثق", "Document scanner", "Scanner de documents", "Escáner de documentos", "Dokumentenscanner", "Сканер документов"],
  ["الحدود: 30 صفحة لكل جلسة و12MB للصفحة و3 جلسات مفتوحة — JPEG حصرًا بفحص السحر حرفيًا", "Limits: 30 pages per session, 12MB per page, 3 open sessions — JPEG only, verified by magic bytes", "Limites : 30 pages par session, 12 Mo par page, 3 sessions ouvertes — JPEG uniquement, vérifié par signature", "Límites: 30 páginas por sesión, 12MB por página, 3 sesiones abiertas — solo JPEG, verificado por firma", "Grenzen: 30 Seiten pro Sitzung, 12MB pro Seite, 3 offene Sitzungen — nur JPEG, per Signatur geprüft", "Пределы: 30 страниц на сессию, 12МБ на страницу, 3 открытые сессии — только JPEG, по подписи"],
  ["صفحة المسح", "Scan page", "Page scannée", "Página escaneada", "Scanseite", "Страница скана"],
]

const maps = {}
for (const [lang, file] of Object.entries(FILES)) {
  maps[lang] = JSON.parse(fs.readFileSync(file, "utf8"))
}
const langs = Object.keys(FILES)
let added = 0
let skipped = 0
for (const [ar, ...rest] of T) {
  const missing = langs.filter((lang) => maps[lang][ar] === undefined)
  if (missing.length === 0) { skipped++; continue }
  langs.forEach((lang) => {
    if (maps[lang][ar] === undefined) maps[lang][ar] = rest[langs.indexOf(lang)]
  })
  added++
}
for (const [lang, file] of Object.entries(FILES)) {
  const ser = (obj) => JSON.stringify(obj, null, 2).replace(/,(\n)/g, ", $1") + "\n"
  fs.writeFileSync(file, ser(maps[lang]))
  console.log(`${lang}: ${Object.keys(maps[lang]).length} مفتاحًا`)
}
console.log(`أُضيف ${added} مفتاحًا × ${langs.length} لغات (وتُخطى ${skipped} موجودًا مسبقًا)`)
const ARAR = /[\u0600-\u06FF]/
const aCounts = langs.map((l) => Object.keys(maps[l]).filter((k) => ARAR.test(k)).length)
if (new Set(aCounts).size !== 1) {
  console.error("❌ خلل توازن المفاتيح العربية بين المعاجم!", aCounts)
  process.exit(1)
}
const totals = langs.map((l) => Object.keys(maps[l]).length)
if (new Set(totals).size !== 1) {
  console.error("❌ خلل التطابق الكامل §42 بين المعاجم!", totals)
  process.exit(1)
}
console.log(`✅ توازن المفاتيح العربية: ${aCounts[0]} × ${langs.length} — التطابق الكامل: ${totals[0]} × ${langs.length}`)
