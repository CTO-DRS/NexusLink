#!/usr/bin/env node
// §54 — إضافة مفاتيح i18n للدرع الاحتياطي المشفّر بالتوازن التام (عقد §31/§42)
// النص العربي هو المفتاح المصدر — يُضاف لكل معجم ما ينقصه هو (درس §53).
// الاستخدام: node scripts/add-backup-shield-i18n.mjs
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
  ["الدرع الاحتياطي المشفّر (§54)", "Encrypted backup shield (§54)", "Bouclier de sauvegarde chiffrée (§54)", "Escudo de copia cifrada (§54)", "Verschlüsseltes Backup-Schild (§54)", "Шифрованный щит резервных копий (§54)"],
  ["نسخ AES-256-GCM على هذا الجهاز حصرًا — بلا سحابة ولا حساب، وفقدان عبارة المرور يعني فقدان النسخة بصدق", "AES-256-GCM backups on this device only — no cloud, no account; losing the passphrase honestly means losing the backup", "Sauvegardes AES-256-GCM sur cet appareil uniquement — sans cloud ni compte ; perdre la phrase secrète signifie perdre la sauvegarde", "Copias AES-256-GCM solo en este dispositivo — sin nube ni cuenta; perder la frase significa perder la copia", "AES-256-GCM-Backups nur auf diesem Gerät — ohne Cloud oder Konto; die Passphrase verloren heißt das Backup verloren", "Копии AES-256-GCM только на этом устройстве — без облака и аккаунта; потеря парольной фразы означает потерю копии"],
  ["الجدولة مفعّلة", "Schedule active", "Planification active", "Programación activa", "Zeitplan aktiv", "Расписание активно"],
  ["يدوي حصرًا", "Manual only", "Manuel uniquement", "Solo manual", "Nur manuell", "Только вручную"],
  ["عبارة مرور النسخة (8 محارف فأكثر)", "Backup passphrase (8+ characters)", "Phrase secrète de la sauvegarde (8+ caractères)", "Frase de la copia (8+ caracteres)", "Backup-Passphrase (8+ Zeichen)", "Парольная фраза копии (8+ символов)"],
  ["أنشئ نسخة الآن", "Create backup now", "Créer une sauvegarde", "Crear copia ahora", "Jetzt Backup erstellen", "Создать копию сейчас"],
  ["المغلف سليم والعدّادات مطابقة", "Envelope intact, counts match", "Enveloppe intacte, compteurs corrects", "Sobre intacto, contadores coinciden", "Umschlag intakt, Zähler stimmen", "Конверт цел, счётчики совпадают"],
  ["استعادة (دمج)", "Restore (merge)", "Restaurer (fusion)", "Restaurar (fusión)", "Wiederherstellen (Zusammenführen)", "Восстановить (слияние)"],
  ["تحقق", "Verify", "Vérifier", "Verificar", "Prüfen", "Проверить"],
  ["أُنشئت نسخة مشفّرة", "Encrypted backup created", "Sauvegarde chiffrée créée", "Copia cifrada creada", "Verschlüsseltes Backup erstellt", "Шифрованная копия создана"],
  ["استُعيدت النسخة بدمج", "Backup restored with merge", "Sauvegarde restaurée en fusion", "Copia restaurada con fusión", "Backup mit Zusammenführen wiederhergestellt", "Копия восстановлена со слиянием"],
  ["كل", "Every", "Toutes les", "Cada", "Alle", "Каждые"],
  ["أوقف الجدولة", "Stop schedule", "Arrêter la planification", "Detener programación", "Zeitplan stoppen", "Остановить расписание"],
  ["أُوقفت الجدولة", "Schedule stopped", "Planification arrêtée", "Programación detenida", "Zeitplan gestoppt", "Расписание остановлено"],
  ["جدولة بمفتاح محلي لا يغادر الجهاز:", "Schedule with a local key that never leaves the device:", "Planifier avec une clé locale qui ne quitte jamais l'appareil :", "Programar con una clave local que nunca sale del dispositivo:", "Zeitplan mit lokalem Schlüssel, der das Gerät nie verlässt:", "Расписание с локальным ключом, не покидающим устройство:"],
  ["أسبوعيًا", "Weekly", "Hebdomadaire", "Semanal", "Wöchentlich", "Еженедельно"],
  ["فُعّلت الجدولة", "Schedule enabled", "Planification activée", "Programación activada", "Zeitplan aktiviert", "Расписание включено"],
  ["نسخة مجدولة أُنشئت الآن", "Scheduled backup created now", "Sauvegarde planifiée créée maintenant", "Copia programada creada ahora", "Geplantes Backup jetzt erstellt", "Запланированная копия создана"],
  ["لا نسخ مشفّرة بعد — أنشئ أول نسخة بعبارة مرور تعرفها وحدك", "No encrypted backups yet — create the first one with a passphrase only you know", "Aucune sauvegarde chiffrée — créez la première avec une phrase que vous seul connaissez", "Aún no hay copias cifradas — crea la primera con una frase que solo tú sepas", "Noch keine verschlüsselten Backups — erstelle das erste mit einer Phrase, die nur du kennst", "Шифрованных копий пока нет — создайте первую с фразой, известной только вам"],
  ["مجدولة", "Scheduled", "Planifiée", "Programada", "Geplant", "По расписанию"],
  ["حُذفت النسخة", "Backup deleted", "Sauvegarde supprimée", "Copia eliminada", "Backup gelöscht", "Копия удалена"],
  ["الاحتفاظ: آخر 10 يدوية و5 مجدولة — البقية تُطرد حتميًا. التدوير يغلق النسخ المجدولة القديمة بصدق.", "Retention: last 10 manual and 5 scheduled — the rest are evicted deterministically. Rotation honestly locks older scheduled backups.", "Rétention : 10 manuelles et 5 planifiées au plus — le reste est évincé. La rotation verrouille honnêtement les anciennes planifiées.", "Retención: últimas 10 manuales y 5 programadas — el resto se expulsa. La rotación bloquea honestamente las antiguas.", "Aufbewahrung: letzte 10 manuelle und 5 geplante — der Rest wird verdrängt. Rotation sperrt ältere ehrlich.", "Хранение: последние 10 ручных и 5 плановых — остальные вытесняются. Ротация честно закрывает старые плановые."],
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
