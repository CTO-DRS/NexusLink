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
  ["مشاركة الرابط", "Share link", "Partager le lien", "Compartir enlace", "Link teilen", "Поделиться ссылкой"],
  ["مشاركة رمز QR", "Share QR code", "Partager le QR", "Compartir código QR", "QR-Code teilen", "Поделиться QR-кодом"],
  ["حُفظ رمز QR كصورة", "QR code saved as an image", "QR enregistré en image", "Código QR guardado como imagen", "QR-Code als Bild gespeichert", "QR-код сохранён как изображение"],
  ["NexusLink متاح للتحميل الآن", "NexusLink is available to download", "NexusLink est disponible au téléchargement", "NexusLink ya está disponible para descargar", "NexusLink steht jetzt zum Download bereit", "NexusLink доступен для загрузки"],
  ["اربط أجهزتك عبر شبكتك المحلية — بلا سحابة وبلا حساب", "Link your devices over your local network — no cloud, no account", "Reliez vos appareils sur votre réseau local — sans cloud, sans compte", "Conecta tus dispositivos por tu red local — sin nube y sin cuenta", "Verbinde deine Geräte über dein lokales Netzwerk — ohne Cloud, ohne Konto", "Свяжите устройства через локальную сеть — без облака и аккаунта"],
  ["تحميل", "Download", "Télécharger", "Descargar", "Herunterladen", "Скачать"],
  ["عندك فكرة تطبيق؟", "Have an app idea?", "Une idée d'application ?", "¿Tienes una idea de app?", "Eine App-Idee?", "Есть идея приложения?"],
  ["نصمّم ونطوّر تطبيقك — تواصل مع المطوّر مباشرة", "We design and build your app — contact the developer directly", "Nous concevons et développons votre application — contactez directement le développeur", "Diseñamos y desarrollamos tu app — contacta directamente al desarrollador", "Wir entwerfen und entwickeln deine App — kontaktiere den Entwickler direkt", "Мы проектируем и создаём ваше приложение — свяжитесь с разработчиком напрямую"],
  ["تواصل", "Contact", "Contacter", "Contactar", "Kontakt", "Связаться"],
  ["شارك التطبيق", "Share the app", "Partager l'app", "Compartir la app", "App teilen", "Поделиться приложением"],
  ["شارك كل الحسابات", "Share all accounts", "Partager tous les comptes", "Compartir todas las cuentas", "Alle Konten teilen", "Поделиться всеми аккаунтами"],
  ["جرّب NexusLink — اربط أجهزتك عبر شبكتك المحلية، بلا سحابة وبلا حساب.", "Try NexusLink — link your devices over your local network, no cloud and no account.", "Essayez NexusLink — reliez vos appareils sur votre réseau local, sans cloud ni compte.", "Prueba NexusLink — conecta tus dispositivos por tu red local, sin nube ni cuenta.", "Probiere NexusLink — verbinde deine Geräte über dein lokales Netzwerk, ohne Cloud und ohne Konto.", "Попробуйте NexusLink — свяжите устройства через локальную сеть, без облака и аккаунта."],
  ["التحقق من التحديثات", "Check for updates", "Rechercher des mises à jour", "Buscar actualizaciones", "Nach Updates suchen", "Проверить обновления"],
  ["جارٍ التحقق…", "Checking…", "Vérification…", "Comprobando…", "Prüfe…", "Проверка…"],
  ["أنت على أحدث إصدار", "You're on the latest version", "Vous avez la dernière version", "Tienes la última versión", "Du hast die neueste Version", "У вас последняя версия"],
  ["إصدار جديد متاح", "A new version is available", "Une nouvelle version est disponible", "Hay una nueva versión disponible", "Eine neue Version ist verfügbar", "Доступна новая версия"],
  ["عرض الإصدار", "View release", "Voir la version", "Ver versión", "Version ansehen", "Открыть релиз"],
  ["تعذّر التحقق — تأكد من اتصالك بالإنترنت", "Couldn't check — make sure you're online", "Vérification impossible — vérifiez votre connexion", "No se pudo comprobar — verifica tu conexión", "Prüfung fehlgeschlagen — prüfe deine Internetverbindung", "Не удалось проверить — проверьте подключение к интернету"],
  ["حفظ جهة الاتصال", "Save contact", "Enregistrer le contact", "Guardar contacto", "Kontakt speichern", "Сохранить контакт"],
  ["حُفظت جهة الاتصال", "Contact file saved", "Fiche contact enregistrée", "Contacto guardado", "Kontaktdatei gespeichert", "Контакт сохранён"],
  ["مظهر البطاقة", "Card theme", "Thème de la carte", "Tema de la tarjeta", "Kartenthema", "Тема карточки"],
  ["خلفية متحركة", "Animated background", "Arrière-plan animé", "Fondo animado", "Animierter Hintergrund", "Анимированный фон"],
  ["بنفسجي", "Violet", "Violet", "Violeta", "Violett", "Фиолетовый"],
  ["محيط", "Ocean", "Océan", "Océano", "Ozean", "Океан"],
  ["غروب", "Sunset", "Coucher de soleil", "Atardecer", "Sonnenuntergang", "Закат"],
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
