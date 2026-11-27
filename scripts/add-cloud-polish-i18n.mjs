#!/usr/bin/env node
// Cloud stats polish: new i18n keys for the five dictionaries (Arabic text is the source key).
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
const T = [["تحديث", "Refresh", "Actualiser", "Actualizar", "Aktualisieren", "Обновить"], ["تعذّر تحميل الإحصاءات", "Couldn't load stats", "Impossible de charger les statistiques", "No se pudieron cargar las estadísticas", "Statistiken konnten nicht geladen werden", "Не удалось загрузить статистику"], ["جارٍ تحميل الإحصاءات…", "Loading stats…", "Chargement des statistiques…", "Cargando estadísticas…", "Statistiken werden geladen…", "Загрузка статистики…"], ["لا زيارات بعد. شارك رابط صفحتك لتظهر الإحصاءات هنا.", "No visits yet. Share your page link and stats will show here.", "Aucune visite pour l'instant. Partagez le lien de votre page pour voir les statistiques ici.", "Aún no hay visitas. Comparte el enlace de tu página y las estadísticas aparecerán aquí.", "Noch keine Besuche. Teile den Link deiner Seite, dann erscheinen hier die Statistiken.", "Пока нет посещений. Поделитесь ссылкой на страницу, и статистика появится здесь."]]
const langs = ["en", "fr", "es", "de", "ru"]
for (const [li, lang] of langs.entries()) {
  const file = FILES[lang]
  const j = JSON.parse(fs.readFileSync(file, "utf8"))
  let n = 0
  for (const row of T) if (!(row[0] in j)) { j[row[0]] = row[li + 1]; n++ }
  fs.writeFileSync(file, JSON.stringify(j, null, 2).replace(/,(\n)/g, ", $1") + "\n")
  console.log(lang, "+" + n)
}
