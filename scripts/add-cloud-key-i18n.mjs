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
const T = [["نسخ مفتاح الصفحة", "Copy page key", "Copier la clé de la page", "Copiar clave de la página", "Seitenschlüssel kopieren", "Копировать ключ страницы"], ["نُسخ مفتاح الصفحة", "Page key copied", "Clé de la page copiée", "Clave de la página copiada", "Seitenschlüssel kopiert", "Ключ страницы скопирован"], ["تعذّر النسخ", "Couldn't copy", "Copie impossible", "No se pudo copiar", "Kopieren fehlgeschlagen", "Не удалось скопировать"], ["استخدام مفتاح موجود", "Use an existing key", "Utiliser une clé existante", "Usar una clave existente", "Vorhandenen Schlüssel verwenden", "Использовать имеющийся ключ"], ["الصق مفتاح الصفحة الذي نسخته من تطبيق آخر. المفتاح سرّي، لا تشاركه مع أحد.", "Paste the page key you copied from another app. The key is secret; share it with no one.", "Collez la clé de page copiée depuis une autre application. La clé est secrète, ne la partagez avec personne.", "Pega la clave de página copiada desde otra app. La clave es secreta; no la compartas con nadie.", "Füge den Seitenschlüssel ein, den du aus einer anderen App kopiert hast. Der Schlüssel ist geheim; teile ihn mit niemandem.", "Вставьте ключ страницы, скопированный из другого приложения. Ключ секретный, никому его не передавайте."], ["مفتاح غير صالح", "Invalid key", "Clé invalide", "Clave no válida", "Ungültiger Schlüssel", "Недопустимый ключ"], ["حُفظ المفتاح", "Key saved", "Clé enregistrée", "Clave guardada", "Schlüssel gespeichert", "Ключ сохранён"]]
const langs = ["en", "fr", "es", "de", "ru"]
for (const [li, lang] of langs.entries()) {
  const file = FILES[lang]
  const j = JSON.parse(fs.readFileSync(file, "utf8"))
  let n = 0
  for (const row of T) if (!(row[0] in j)) { j[row[0]] = row[li + 1]; n++ }
  fs.writeFileSync(file, JSON.stringify(j, null, 2).replace(/,(\n)/g, ", $1") + "\n")
  console.log(lang, "+" + n)
}
