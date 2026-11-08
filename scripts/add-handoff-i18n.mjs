#!/usr/bin/env node
// §53 — إضافة مفاتيح i18n الجديدة للمعاجم الخمسة بالتوازن التام (عقد §31/§42)
// + إصلاح انجراف التطابق الكامل: مفتاحا المنصتين «Android — APK» و
//   «macOS — Apple Silicon» دخلا لمعجم en حصرًا في موجة §50–§52 —
//   يُكملان هنا للأربع (أسماء منصات لا تُترجم — نفس قيمة en).
// النص العربي هو المفتاح المصدر — تُضاف المفاتيح غير الموجودة فقط لكل معجم.
// الاستخدام: node scripts/add-handoff-i18n.mjs
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
  // إصلاح التطابق الكامل §42 — مفتاحا منصتين من موقع التنزيل (لا يُترجمان)
  ["Android — APK", "Android — APK", "Android — APK", "Android — APK", "Android — APK", "Android — APK"],
  ["macOS — Apple Silicon", "macOS — Apple Silicon", "macOS — Apple Silicon", "macOS — Apple Silicon", "macOS — Apple Silicon", "macOS — Apple Silicon"],
  // §53 — التسليم اليدوي الذكي
  ["س", "h", "h", "h", "Std", "ч"],
  ["ي", "d", "j", "d", "T", "д"],
  ["التسليم اليدوي — أكمل من حيث توقفت", "Smart handoff — resume where you left off", "Transfert intelligent — reprenez où vous en étiez", "Entrega inteligente — continúa donde lo dejaste", "Smartes Handoff — weiter da, wo du aufgehört hast", "Умная передача — продолжите с того же места"],
  ["التسليم", "Handoff", "Transfert", "Entrega", "Handoff", "Передача"],
  ["لا عناصر تسليم — ادفع رابطًا أو نصًا من هاتفك ليظهر هنا بفعل بنقرة", "No handoff items — push a link or text from your phone and it appears here, one tap to act", "Aucun élément — envoyez un lien ou du texte depuis votre téléphone, une touche pour agir", "Sin elementos — envía un enlace o texto desde tu teléfono y aparecerá aquí, un toque para actuar", "Keine Handoff-Elemente — schicke einen Link oder Text vom Handy, ein Tippeln zum Handeln", "Нет элементов — отправьте ссылку или текст с телефона, одно нажатие для действия"],
  ["محلي حصرًا — بلا حساب ولا سحابة، والقائمة تنتهي بعد 24 ساعة", "Local only — no account, no cloud; the queue expires after 24 hours", "Local uniquement — sans compte ni cloud ; la file expire après 24 heures", "Solo local — sin cuenta ni nube; la cola expira tras 24 horas", "Nur lokal — ohne Konto oder Cloud; die Liste läuft nach 24 Stunden ab", "Только локально — без аккаунта и облака; очередь истекает через 24 часа"],
  ["العنصر استُهلك أو انتهى", "Item already consumed or expired", "Élément déjà consommé ou expiré", "Elemento ya consumido o expirado", "Element bereits verbraucht oder abgelaufen", "Элемент уже использован или истёк"],
  ["نُسخ إلى الحافظة", "Copied to clipboard", "Copié dans le presse-papiers", "Copiado al portapapeles", "In die Zwischenablage kopiert", "Скопировано в буфер"],
  ["موضع التشغيل جاهز للاستئناف", "Playback position ready to resume", "Position de lecture prête à reprendre", "Posición de reproducción lista para continuar", "Wiedergabeposition bereit zum Fortsetzen", "Позиция воспроизведения готова к продолжению"],
  ["الملف جاهز للفتح من تبويب الملفات", "File ready to open from the Files tab", "Fichier prêt à ouvrir depuis l'onglet Fichiers", "Archivo listo para abrir desde la pestaña Archivos", "Datei bereit zum Öffnen im Tab „Dateien“", "Файл готов к открытию во вкладке «Файлы»"],
  ["فُرّغت قائمة التسليم", "Handoff queue cleared", "File de transfert vidée", "Cola de entrega vaciada", "Handoff-Liste geleert", "Очередь передачи очищена"],
  ["عند وصول عنصر تسليم يدوي من الهاتف", "When a smart handoff item arrives from the phone", "Quand un élément de transfert arrive du téléphone", "Cuando llega un elemento de entrega del teléfono", "Wenn ein Handoff-Element vom Handy ankommt", "Когда приходит элемент передачи с телефона"],
]

const maps = {}
for (const [lang, file] of Object.entries(FILES)) {
  maps[lang] = JSON.parse(fs.readFileSync(file, "utf8"))
}
const langs = Object.keys(FILES)
let added = 0
let skipped = 0
for (const [ar, ...rest] of T) {
  // الإضافة لكل معجم ما ينقصه هو — التخطي عند اكتمال الخمسة حصرًا
  // (درس الإصلاح: قرار التخطي من en وحدها يترك انجراف التطابق الكامل §42 قائمًا)
  const missing = langs.filter((lang, i) => maps[lang][ar] === undefined)
  if (missing.length === 0) { skipped++; continue }
  langs.forEach((lang, i) => {
    if (maps[lang][ar] === undefined) maps[lang][ar] = rest[i]
  })
  added++
}
for (const [lang, file] of Object.entries(FILES)) {
  const sortedKeys = Object.keys(maps[lang])
  // مطابقة تنسيق المعاجم القائمة حرفيًا: «, \n» بعد كل سطر (بفاصلة ومسافة) — فرق نظيف
  const ser = (obj) => JSON.stringify(obj, null, 2).replace(/,(\n)/g, ", $1") + "\n"
  fs.writeFileSync(file, ser(maps[lang]))
  console.log(`${lang}: ${sortedKeys.length} مفتاحًا`)
}
console.log(`أُضيف ${added} مفتاحًا × ${langs.length} لغات (وتُخطى ${skipped} موجودًا مسبقًا)`)
// التوازن التعاقدي (حارس أ27 في emergency-e2e) يعدّ المفاتيح العربية حصرًا
// والتطابق الكامل (§42) يفرض تساوي الطول الكلي للمعاجم الخمسة
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
