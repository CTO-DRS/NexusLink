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
  ["الوضع السحابي (اختياري)", "Cloud mode (optional)", "Mode cloud (optionnel)", "Modo nube (opcional)", "Cloud-Modus (optional)", "Облачный режим (необязательно)"],
  ["صفحة روابط مستضافة مع إحصاءات. مُعطَّل افتراضيًا، ولا يُرسل التطبيق أي شيء إلى السحابة ما دام مُعطَّلًا.", "A hosted links page with analytics. Off by default; while off, the app sends nothing to the cloud.", "Une page de liens hébergée avec statistiques. Désactivé par défaut ; tant qu'il l'est, l'app n'envoie rien au cloud.", "Una página de enlaces alojada con analítica. Desactivado por defecto; mientras lo esté, la app no envía nada a la nube.", "Eine gehostete Linkseite mit Statistiken. Standardmäßig aus; solange es aus ist, sendet die App nichts an die Cloud.", "Размещённая страница ссылок со статистикой. Выключено по умолчанию; пока выключено, приложение ничего не отправляет в облако."],
  ["تفعيل الوضع السحابي", "Enable cloud mode", "Activer le mode cloud", "Activar el modo nube", "Cloud-Modus aktivieren", "Включить облачный режим"],
  ["الوضع السحابي مُفعَّل: بيانات زيارات صفحتك تُرسَل إلى الخدمة المستضافة.", "Cloud mode is on: your page's visit data is sent to the hosted service.", "Le mode cloud est activé : les données de visite de votre page sont envoyées au service hébergé.", "El modo nube está activo: los datos de visitas de tu página se envían al servicio alojado.", "Cloud-Modus ist an: Besuchsdaten deiner Seite werden an den gehosteten Dienst gesendet.", "Облачный режим включён: данные о посещениях вашей страницы отправляются в размещённый сервис."],
  ["الخدمة المستضافة لم تُفعَّل بعد", "The hosted service isn't live yet", "Le service hébergé n'est pas encore actif", "El servicio alojado aún no está activo", "Der gehostete Dienst ist noch nicht aktiv", "Размещённый сервис ещё не запущен"],
  ["معرّف الصفحة", "Page handle", "Identifiant de la page", "Identificador de la página", "Seiten-Kennung", "Идентификатор страницы"],
  ["جمع البريد أو الرقم من الزوار", "Collect visitors' email or number", "Collecter l'e-mail ou le numéro des visiteurs", "Recoger el correo o número de los visitantes", "E-Mail oder Nummer der Besucher erfassen", "Собирать email или номер посетителей"],
  ["نشر الصفحة", "Publish page", "Publier la page", "Publicar página", "Seite veröffentlichen", "Опубликовать страницу"],
  ["حذف الصفحة وبياناتها", "Delete page and its data", "Supprimer la page et ses données", "Eliminar la página y sus datos", "Seite und Daten löschen", "Удалить страницу и её данные"],
  ["معرّف غير صالح (حروف إنجليزية صغيرة وأرقام وشرطة، من 3 إلى 32)", "Invalid handle (lowercase letters, digits and dashes, 3 to 32)", "Identifiant invalide (minuscules, chiffres et tirets, 3 à 32)", "Identificador no válido (minúsculas, dígitos y guiones, de 3 a 32)", "Ungültige Kennung (Kleinbuchstaben, Ziffern, Bindestriche, 3 bis 32)", "Недопустимый идентификатор (строчные буквы, цифры и дефис, от 3 до 32)"],
  ["اترك بريدك أو رقمك وسنتواصل معك", "Leave your email or number and we'll get in touch", "Laissez votre e-mail ou numéro et nous vous contacterons", "Deja tu correo o número y nos pondremos en contacto", "Hinterlasse deine E-Mail oder Nummer, wir melden uns", "Оставьте email или номер, и мы свяжемся с вами"],
  ["أوافق على التواصل معي", "I agree to be contacted", "J'accepte d'être contacté", "Acepto que se pongan en contacto conmigo", "Ich stimme der Kontaktaufnahme zu", "Я согласен на связь со мной"],
  ["تم نشر الصفحة", "Page published", "Page publiée", "Página publicada", "Seite veröffentlicht", "Страница опубликована"],
  ["هذا المعرّف مأخوذ", "That handle is taken", "Cet identifiant est pris", "Ese identificador ya está en uso", "Diese Kennung ist vergeben", "Этот идентификатор занят"],
  ["تعذّر الاتصال بالخدمة", "Couldn't reach the service", "Service injoignable", "No se pudo contactar con el servicio", "Dienst nicht erreichbar", "Не удалось связаться с сервисом"],
  ["حُذفت الصفحة وبياناتها", "Page and its data deleted", "Page et données supprimées", "Página y datos eliminados", "Seite und Daten gelöscht", "Страница и её данные удалены"],
  ["قبل تفعيل الوضع السحابي", "Before you enable cloud mode", "Avant d'activer le mode cloud", "Antes de activar el modo nube", "Bevor du den Cloud-Modus aktivierst", "Прежде чем включить облачный режим"],
  ["اقرأ ما سيُرسَل ويُحفظ على الخدمة المستضافة.", "Read what will be sent to and stored on the hosted service.", "Lisez ce qui sera envoyé et conservé sur le service hébergé.", "Lee lo que se enviará y guardará en el servicio alojado.", "Lies, was an den gehosteten Dienst gesendet und dort gespeichert wird.", "Прочитайте, что будет отправлено и сохранено в размещённом сервисе."],
  ["عند التفعيل تُنشر بطاقة المطوّر كصفحة عامة على خدمة مستضافة.", "When enabled, the developer card is published as a public page on a hosted service.", "Une fois activé, la carte du développeur est publiée en page publique sur un service hébergé.", "Al activarlo, la tarjeta del desarrollador se publica como página pública en un servicio alojado.", "Bei Aktivierung wird die Entwicklerkarte als öffentliche Seite auf einem gehosteten Dienst veröffentlicht.", "При включении карточка разработчика публикуется как общедоступная страница в размещённом сервисе."],
  ["يُرسَل إلى الخدمة ويُحفظ فيها: عدد زيارات الصفحة والنقرات ومصدر الزيارة (اسم الموقع المُحيل فقط) وبلد الزائر التقريبي وساعة الزيارة. لا تُحفظ عناوين IP ولا ملفات تعريف الارتباط.", "Sent to and stored on the service: page views, clicks, the traffic source (referring site name only), the visitor's approximate country and the hour of the visit. IP addresses and cookies are not stored.", "Envoyé et conservé sur le service : vues de la page, clics, source du trafic (nom du site référent uniquement), pays approximatif du visiteur et heure de la visite. Les adresses IP et les cookies ne sont pas conservés.", "Se envía y guarda en el servicio: visitas a la página, clics, origen del tráfico (solo el nombre del sitio de referencia), país aproximado del visitante y hora de la visita. No se guardan direcciones IP ni cookies.", "An den Dienst gesendet und dort gespeichert: Seitenaufrufe, Klicks, Verkehrsquelle (nur Name der verweisenden Seite), ungefähres Land des Besuchers und Uhrzeit des Besuchs. IP-Adressen und Cookies werden nicht gespeichert.", "Отправляется в сервис и хранится там: просмотры страницы, клики, источник трафика (только имя сайта-источника), примерная страна посетителя и час визита. IP-адреса и cookie не хранятся."],
  ["إن فعّلتَ نموذج جمع البيانات، يُحفظ البريد أو الرقم الذي يرسله الزائر بنفسه على الخدمة، وأنت مسؤول عن إشعار الخصوصية في صفحتك.", "If you turn on the collection form, the email or number a visitor submits is stored on the service, and you are responsible for the privacy notice on your page.", "Si vous activez le formulaire de collecte, l'e-mail ou le numéro soumis par le visiteur est conservé sur le service, et vous êtes responsable de l'avis de confidentialité de votre page.", "Si activas el formulario de recogida, el correo o número que envíe el visitante se guarda en el servicio, y eres responsable del aviso de privacidad de tu página.", "Wenn du das Erfassungsformular aktivierst, werden die vom Besucher eingegebene E-Mail oder Nummer auf dem Dienst gespeichert, und du bist für den Datenschutzhinweis deiner Seite verantwortlich.", "Если включить форму сбора, email или номер, отправленные посетителем, сохраняются в сервисе, а за уведомление о конфиденциальности на странице отвечаете вы."],
  ["يمكنك الإيقاف وحذف الصفحة وكل بياناتها في أي وقت. وبقية التطبيق يبقى محليًا بالكامل.", "You can turn it off and delete the page and all its data at any time. The rest of the app stays fully local.", "Vous pouvez le désactiver et supprimer la page et toutes ses données à tout moment. Le reste de l'app reste entièrement local.", "Puedes desactivarlo y eliminar la página y todos sus datos en cualquier momento. El resto de la app sigue siendo totalmente local.", "Du kannst es jederzeit ausschalten und die Seite samt Daten löschen. Der Rest der App bleibt komplett lokal.", "Вы можете отключить его и удалить страницу со всеми данными в любой момент. Остальное приложение остаётся полностью локальным."],
  ["أفهم أن بيانات زيارات الصفحة تُرسَل إلى الخدمة المستضافة", "I understand that page-visit data is sent to the hosted service", "Je comprends que les données de visite de la page sont envoyées au service hébergé", "Entiendo que los datos de visitas de la página se envían al servicio alojado", "Ich verstehe, dass Besuchsdaten der Seite an den gehosteten Dienst gesendet werden", "Я понимаю, что данные о посещениях страницы отправляются в размещённый сервис"],
  ["إلغاء", "Cancel", "Annuler", "Cancelar", "Abbrechen", "Отмена"],
  ["تفعيل", "Enable", "Activer", "Activar", "Aktivieren", "Включить"],
  ["إحصاءات آخر 30 يومًا", "Last 30 days", "30 derniers jours", "Últimos 30 días", "Letzte 30 Tage", "Последние 30 дней"],
  ["زيارات", "Views", "Vues", "Visitas", "Aufrufe", "Просмотры"],
  ["نقرات", "Clicks", "Clics", "Clics", "Klicks", "Клики"],
  ["المصادر", "Sources", "Sources", "Orígenes", "Quellen", "Источники"],
  ["الدول", "Countries", "Pays", "Países", "Länder", "Страны"],
  ["ساعة الذروة (UTC)", "Peak hour (UTC)", "Heure de pointe (UTC)", "Hora pico (UTC)", "Spitzenstunde (UTC)", "Час пик (UTC)"],
  ["تصدير جهات الاتصال (CSV)", "Export contacts (CSV)", "Exporter les contacts (CSV)", "Exportar contactos (CSV)", "Kontakte exportieren (CSV)", "Экспорт контактов (CSV)"],
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
