#!/usr/bin/env node
// About-the-developer card: new i18n keys for the five dictionaries (Arabic text is the source key).
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
  ["عن المطوّر", "About the developer", "À propos du développeur", "Sobre el desarrollador", "Über den Entwickler", "О разработчике"],
  ["مطوّر تطبيقات • استشارات تقنية", "App developer • Tech consulting", "Développeur d'applications • Conseil technique", "Desarrollador de apps • Consultoría técnica", "App-Entwickler • Technische Beratung", "Разработчик приложений • Техническое консультирование"],
  ["حسابات المطوّر", "Developer accounts", "Comptes du développeur", "Cuentas del desarrollador", "Konten des Entwicklers", "Аккаунты разработчика"],
  ["واتساب", "WhatsApp", "WhatsApp", "WhatsApp", "WhatsApp", "WhatsApp"],
  ["تيليجرام", "Telegram", "Telegram", "Telegram", "Telegram", "Telegram"],
  ["تيك توك", "TikTok", "TikTok", "TikTok", "TikTok", "TikTok"],
  ["إنستغرام", "Instagram", "Instagram", "Instagram", "Instagram", "Instagram"],
  ["إكس", "X", "X", "X", "X", "X"],
  ["يوتيوب", "YouTube", "YouTube", "YouTube", "YouTube", "YouTube"],
  ["الموقع", "Website", "Site web", "Sitio web", "Webseite", "Сайт"],
  ["صورة المطوّر", "Developer photo", "Photo du développeur", "Foto del desarrollador", "Foto des Entwicklers", "Фото разработчика"],
  ["إغلاق", "Close", "Fermer", "Cerrar", "Schließen", "Закрыть"],
  ["فتح", "Open", "Ouvrir", "Abrir", "Öffnen", "Открыть"],
  ["نسخ الرابط", "Copy link", "Copier le lien", "Copiar enlace", "Link kopieren", "Копировать ссылку"],
  ["نُسخ الرابط", "Link copied", "Lien copié", "Enlace copiado", "Link kopiert", "Ссылка скопирована"],
  ["امسح الرمز بهاتفك لفتح الحساب", "Scan the code with your phone to open the account", "Scannez le code avec votre téléphone pour ouvrir le compte", "Escanea el código con tu teléfono para abrir la cuenta", "Scanne den Code mit deinem Telefon, um das Konto zu öffnen", "Отсканируйте код телефоном, чтобы открыть аккаунт"],
  ["حساب موثّق", "Verified account", "Compte vérifié", "Cuenta verificada", "Verifiziertes Konto", "Подтверждённый аккаунт"],
]
const langs = ["en", "fr", "es", "de", "ru"]
for (const [li, lang] of langs.entries()) {
  const file = FILES[lang]
  const j = JSON.parse(fs.readFileSync(file, "utf8"))
  let n = 0
  for (const row of T) if (!(row[0] in j)) { j[row[0]] = row[li + 1]; n++ }
  fs.writeFileSync(file, JSON.stringify(j, null, 2).replace(/,(\n)/g, ", $1") + "\n")
  console.log(lang, "+" + n)
}
