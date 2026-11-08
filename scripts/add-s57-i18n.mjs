#!/usr/bin/env node
// §57 — إضافة مفتاحَي شارة القفل الساكن إلى المعاجم الخمسة بتنسيق مطابق (فاصلة فاصلة)
// درس §42: قرار الترجمة يجب أن يلامس المعاجم الخمسة كلها — التطابق الكامل إلزامي.
import fs from "node:fs"

const KEYS = {
  "القائمة مقفلة على القرص — حمولات مشفرة لا نصًّا عاريًا": {
    en: "Queue sealed on disk — payloads encrypted, never bare text",
    fr: "File scellée sur disque — charges chiffrées, jamais en texte brut",
    es: "Cola sellada en disco — cargas cifradas, nunca texto plano",
    de: "Warteschlange auf der Festplatte versiegelt — Nutzdaten verschlüsselt, nie Klartext",
    ru: "Очередь запечатана на диске — данные зашифрованы, никогда не в открытом виде",
  },
  "سيُختم القرص تلقائيًا عند أول دفعة تسليم": {
    en: "Disk sealing activates automatically on the first handoff push",
    fr: "Le scellement du disque s'active dès le premier envoi",
    es: "El sellado del disco se activa en el primer envío",
    de: "Die Festplatten-Versiegelung aktiviert sich beim ersten Senden",
    ru: "Запечатывание диска активируется при первой отправке",
  },
}

const FILES = {
  en: "src/lib/ar-en-map.json",
  fr: "src/lib/i18n/fr.json",
  es: "src/lib/i18n/es.json",
  de: "src/lib/i18n/de.json",
  ru: "src/lib/i18n/ru.json",
}

for (const [lang, file] of Object.entries(FILES)) {
  const raw = fs.readFileSync(file, "utf8")
  const map = JSON.parse(raw)
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
  console.log(`${lang}: +${added} → ${Object.keys(map).length}`)
}

// تحقق التطابق الكامل
const keysets = Object.values(FILES).map((f) => Object.keys(JSON.parse(fs.readFileSync(f, "utf8"))).sort())
const base = JSON.stringify(keysets[0])
const allEqual = keysets.every((k) => JSON.stringify(k) === base)
console.log("parity:", allEqual ? "MATCH" : "DRIFT!")
process.exit(allEqual ? 0 : 1)
