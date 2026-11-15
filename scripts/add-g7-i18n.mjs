#!/usr/bin/env node
// G7 + P0 (بيانات العرض على العميل) — مفاتيح صفحات الخطأ العامة والحالات الفارغة
// الصادقة (حماية · وسائط) إلى المعاجم الخمسة بتنسيق مطابق (فاصلة فاصلة) وتطابق كامل.
// الاستخدام: node scripts/add-g7-i18n.mjs
import fs from "node:fs"

const FILES = {
  en: "src/lib/ar-en-map.json",
  fr: "src/lib/i18n/fr.json",
  es: "src/lib/i18n/es.json",
  de: "src/lib/i18n/de.json",
  ru: "src/lib/i18n/ru.json",
}

const KEYS = {
  // ---- صفحات الخطأ العامة (G7) ----
  "الصفحة غير موجودة": { en: "Page not found", fr: "Page introuvable", es: "Página no encontrada", de: "Seite nicht gefunden", ru: "Страница не найдена" },
  "الرابط الذي فتحته غير متاح في NexusLink.": { en: "The link you opened isn't available in NexusLink.", fr: "Le lien que vous avez ouvert n'est pas disponible dans NexusLink.", es: "El enlace que abriste no está disponible en NexusLink.", de: "Der geöffnete Link ist in NexusLink nicht verfügbar.", ru: "Открытая ссылка недоступна в NexusLink." },
  "NexusLink — الصفحة غير موجودة": { en: "NexusLink — Page not found", fr: "NexusLink — Page introuvable", es: "NexusLink — Página no encontrada", de: "NexusLink — Seite nicht gefunden", ru: "NexusLink — Страница не найдена" },
  "حدث خطأ غير متوقع": { en: "Something went wrong", fr: "Une erreur inattendue s'est produite", es: "Se produjo un error inesperado", de: "Ein unerwarteter Fehler ist aufgetreten", ru: "Произошла непредвиденная ошибка" },
  "تعذر عرض هذه الصفحة. أعد المحاولة، وإن تكرر الخطأ فأعد تشغيل NexusLink.": { en: "This page couldn't be displayed. Try again, and if the error repeats, restart NexusLink.", fr: "Impossible d'afficher cette page. Réessayez et, si l'erreur se répète, redémarrez NexusLink.", es: "No se pudo mostrar esta página. Inténtalo de nuevo y, si el error se repite, reinicia NexusLink.", de: "Diese Seite konnte nicht angezeigt werden. Versuchen Sie es erneut und starten Sie NexusLink neu, falls der Fehler erneut auftritt.", ru: "Не удалось отобразить эту страницу. Повторите попытку, а если ошибка повторится, перезапустите NexusLink." },
  "تعذر تشغيل الواجهة. أعد المحاولة، وإن تكرر الخطأ فأعد تشغيل NexusLink.": { en: "The interface couldn't start. Try again, and if the error repeats, restart NexusLink.", fr: "L'interface n'a pas pu démarrer. Réessayez et, si l'erreur se répète, redémarrez NexusLink.", es: "No se pudo iniciar la interfaz. Inténtalo de nuevo y, si el error se repite, reinicia NexusLink.", de: "Die Oberfläche konnte nicht gestartet werden. Versuchen Sie es erneut und starten Sie NexusLink neu, falls der Fehler erneut auftritt.", ru: "Не удалось запустить интерфейс. Повторите попытку, а если ошибка повторится, перезапустите NexusLink." },
  "الرمز المرجعي:": { en: "Reference code:", fr: "Code de référence :", es: "Código de referencia:", de: "Referenzcode:", ru: "Код ссылки:" },
  "إعادة المحاولة": { en: "Try again", fr: "Réessayer", es: "Reintentar", de: "Erneut versuchen", ru: "Повторить" },
  "العودة إلى الرئيسية": { en: "Back to home", fr: "Retour à l'accueil", es: "Volver al inicio", de: "Zur Startseite", ru: "На главную" },
  "خطأ داخلي": { en: "Internal error", fr: "Erreur interne", es: "Error interno", de: "Interner Fehler", ru: "Внутренняя ошибка" },
  // ---- الحماية: حالات فارغة صادقة بلا NEXUSLINK_DEMO ----
  "مؤشرات الجهاز": { en: "Device metrics", fr: "Indicateurs de l'appareil", es: "Indicadores del dispositivo", de: "Gerätekennzahlen", ru: "Показатели устройства" },
  "لا توجد مؤشرات حية لهذا الجهاز بعد": { en: "No live metrics for this device yet", fr: "Aucun indicateur en direct pour cet appareil pour l'instant", es: "Aún no hay indicadores en vivo para este dispositivo", de: "Noch keine Live-Kennzahlen für dieses Gerät", ru: "Для этого устройства пока нет живых показателей" },
  "تظهر البطارية والتخزين والذاكرة والمعالج هنا عندما يرسلها جهاز مقترن حقيقي — لا نعرض أرقامًا تقديرية.": { en: "Battery, storage, memory and CPU appear here once a real paired device reports them — we never show estimated numbers.", fr: "La batterie, le stockage, la mémoire et le processeur s'affichent ici dès qu'un véritable appareil appairé les transmet — nous n'affichons jamais de chiffres estimés.", es: "La batería, el almacenamiento, la memoria y la CPU aparecen aquí cuando un dispositivo emparejado real los envía — nunca mostramos cifras estimadas.", de: "Akku, Speicher, Arbeitsspeicher und CPU erscheinen hier, sobald ein echtes gekoppeltes Gerät sie meldet — wir zeigen nie geschätzte Werte.", ru: "Батарея, хранилище, память и процессор появятся здесь, когда их передаст реальное сопряжённое устройство, — мы не показываем приблизительные цифры." },
  "لا توجد قائمة تطبيقات من هاتف مقترن بعد": { en: "No app list from a paired phone yet", fr: "Aucune liste d'applications d'un téléphone appairé pour l'instant", es: "Aún no hay lista de apps de un teléfono emparejado", de: "Noch keine App-Liste von einem gekoppelten Telefon", ru: "Пока нет списка приложений с сопряжённого телефона" },
  "تظهر التطبيقات هنا عندما يرسلها هاتفك الحقيقي — لا نعرض قائمة نموذجية.": { en: "Apps appear here once your real phone sends them — we never show a sample list.", fr: "Les applications s'affichent ici dès que votre vrai téléphone les envoie — nous n'affichons jamais de liste d'exemple.", es: "Las apps aparecen aquí cuando tu teléfono real las envía — nunca mostramos una lista de ejemplo.", de: "Apps erscheinen hier, sobald Ihr echtes Telefon sie sendet — wir zeigen nie eine Beispielliste.", ru: "Приложения появятся здесь, когда их пришлёт ваш реальный телефон, — мы не показываем примерный список." },
  "لا منبهات بعد — أضف منبهًا جديدًا ليُرسل إلى هاتفك": { en: "No alarms yet — add a new alarm to send it to your phone", fr: "Aucune alarme pour l'instant — ajoutez-en une pour l'envoyer à votre téléphone", es: "Aún no hay alarmas — añade una nueva para enviarla a tu teléfono", de: "Noch keine Wecker — fügen Sie einen neuen hinzu, um ihn an Ihr Telefon zu senden", ru: "Будильников пока нет — добавьте новый, чтобы отправить его на телефон" },
  "لا هاتف مقترن": { en: "No paired phone", fr: "Aucun téléphone appairé", es: "Ningún teléfono emparejado", de: "Kein gekoppeltes Telefon", ru: "Нет сопряжённого телефона" },
  "اقرن هاتفك ليظهر موقعه التقريبي على شبكتك": { en: "Pair your phone to see its approximate location on your network", fr: "Appairez votre téléphone pour voir sa position approximative sur votre réseau", es: "Empareja tu teléfono para ver su ubicación aproximada en tu red", de: "Koppeln Sie Ihr Telefon, um seinen ungefähren Standort in Ihrem Netzwerk zu sehen", ru: "Выполните сопряжение телефона, чтобы видеть его примерное местоположение в вашей сети" },
  // ---- الوسائط: عتاد حقيقي فقط بلا NEXUSLINK_DEMO ----
  "الوسائط تعمل بعتاد حقيقي فقط: كاميرا وميكروفون هذا الكمبيوتر أو هاتف مقترن عبر": { en: "Media works with real hardware only: this computer's camera and microphone, or a phone paired via", fr: "Les médias fonctionnent uniquement avec du matériel réel : la caméra et le micro de cet ordinateur, ou un téléphone appairé via", es: "Los medios funcionan solo con hardware real: la cámara y el micrófono de este equipo, o un teléfono emparejado mediante", de: "Medien funktionieren nur mit echter Hardware: Kamera und Mikrofon dieses Computers oder ein Telefon, gekoppelt über", ru: "Медиа работает только с реальным оборудованием: камера и микрофон этого компьютера или телефон, сопряжённый через" },
  "— لا بث محاكى ولا أرقام تقديرية.": { en: "— no simulated streams and no estimated numbers.", fr: "— aucun flux simulé ni chiffre estimé.", es: "— sin transmisiones simuladas ni cifras estimadas.", de: "— keine simulierten Streams und keine geschätzten Werte.", ru: "— без имитации потоков и приблизительных цифр." },
  "لا توجد كاميرا حقيقية متاحة — البث المحاكى متاح في وضع العرض التوضيحي فقط": { en: "No real camera available — simulated streams are only available in demo mode", fr: "Aucune caméra réelle disponible — les flux simulés ne sont disponibles qu'en mode démo", es: "No hay cámara real disponible — las transmisiones simuladas solo están disponibles en modo demo", de: "Keine echte Kamera verfügbar — simulierte Streams gibt es nur im Demo-Modus", ru: "Нет доступной реальной камеры — имитация потока доступна только в демо-режиме" },
  "لا يوجد ميكروفون حقيقي متاح — البث المحاكى متاح في وضع العرض التوضيحي فقط": { en: "No real microphone available — simulated streams are only available in demo mode", fr: "Aucun micro réel disponible — les flux simulés ne sont disponibles qu'en mode démo", es: "No hay micrófono real disponible — las transmisiones simuladas solo están disponibles en modo demo", de: "Kein echtes Mikrofon verfügbar — simulierte Streams gibt es nur im Demo-Modus", ru: "Нет доступного реального микрофона — имитация потока доступна только в демо-режиме" },
  "تعذر فتح الميكروفون": { en: "Couldn't open the microphone", fr: "Impossible d'ouvrir le micro", es: "No se pudo abrir el micrófono", de: "Mikrofon konnte nicht geöffnet werden", ru: "Не удалось открыть микрофон" },
}

for (const [lang, file] of Object.entries(FILES)) {
  const map = JSON.parse(fs.readFileSync(file, "utf8"))
  let added = 0
  for (const [k, tr] of Object.entries(KEYS)) {
    if (!tr[lang]) throw new Error(`missing ${lang} for ${k}`)
    if (k in map) continue
    map[k] = tr[lang]
    added++
  }
  let out = JSON.stringify(map, null, 2).replace(/,\n/g, ", \n")
  if (!out.endsWith("\n")) out += "\n"
  fs.writeFileSync(file, out)
  console.log(`${lang}: +${added} → ${Object.keys(map).length}`)
}

const keysets = Object.values(FILES).map((f) => Object.keys(JSON.parse(fs.readFileSync(f, "utf8"))).sort())
const allEqual = keysets.every((k) => JSON.stringify(k) === JSON.stringify(keysets[0]))
console.log("parity:", allEqual ? "MATCH" : "DRIFT!")
process.exit(allEqual ? 0 : 1)
