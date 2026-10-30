#!/usr/bin/env node
// §50–§52 — إضافة مفاتيح i18n الجديدة للمعاجم الخمسة بالتوازن التام (عقد §31/§42)
// النص العربي هو المفتاح المصدر — تُضاف المفاتيح غير الموجودة فقط لكل معجم.
// الاستخدام: node scripts/add-vault-guest-focus-i18n.mjs
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
  ["فشل الإجراء", "Action failed", "Échec de l'action", "Acción fallida", "Aktion fehlgeschlagen", "Действие не выполнено"],
  ["أدخل مسارًا واحدًا على الأقل للمشاركة", "Enter at least one path to share", "Saisissez au moins un chemin à partager", "Introduce al menos una ruta para compartir", "Gib mindestens einen Pfad zum Teilen ein", "Укажите хотя бы один путь для общего доступа"],
  ["فُتحت المشاركة الضيوفة", "Guest sharing opened", "Partage invité ouvert", "Compartir con invitados abierto", "Gästfreigabe geöffnet", "Гостевой доступ открыт"],
  ["امسح الرمز من الجهاز الآخر — الصلاحية مؤقتة", "Scan the code from the other device — access is temporary", "Scannez le code depuis l'autre appareil — l'accès est temporaire", "Escanea el código desde el otro dispositivo — el acceso es temporal", "Scanne den Code vom anderen Gerät — der Zugriff ist temporär", "Отсканируйте код с другого устройства — доступ временный"],
  ["حُفظ في تنزيلات الكمبيوتر", "Saved to computer downloads", "Enregistré dans les téléchargements", "Guardado en descargas del PC", "In PC-Downloads gespeichert", "Сохранено в загрузки ПК"],
  ["المشاركة الضيوفة المباشرة", "Direct guest sharing", "Partage direct avec invités", "Compartir directo con invitados", "Direkte Gästefreigabe", "Прямой гостевой обмен"],
  ["شارك ملفات مع أي جهاز عبر متصفحه — بلا تطبيق ولا حساب ولا سحابة", "Share files with any device via its browser — no app, no account, no cloud", "Partagez des fichiers avec tout appareil via son navigateur — sans appli, compte ni cloud", "Comparte archivos con cualquier dispositivo vía su navegador — sin app, cuenta ni nube", "Dateien mit jedem Gerät über den Browser teilen — ohne App, Konto oder Cloud", "Делитесь файлами с любым устройством через браузер — без приложения, аккаунта и облака"],
  ["تدوير الرمز", "Rotate code", "Régénérer le code", "Rotar código", "Code rotieren", "Сменить код"],
  ["إغلاق المشاركة", "Close sharing", "Fermer le partage", "Cerrar compartición", "Freigabe schließen", "Закрыть доступ"],
  ["فتح المشاركة الضيوفة", "Open guest sharing", "Ouvrir le partage invité", "Abrir compartición de invitados", "Gästfreigabe öffnen", "Открыть гостевой доступ"],
  ["الوضع", "Mode", "Mode", "Modo", "Modus", "Режим"],
  ["استقبال من ضيف", "Receive from guest", "Recevoir d'un invité", "Recibir de un invitado", "Von Gast empfangen", "Получить от гостя"],
  ["إرسال ملفات", "Send files", "Envoyer des fichiers", "Enviar archivos", "Dateien senden", "Отправить файлы"],
  ["الصلاحية", "Validity", "Validité", "Validez", "Gültigkeit", "Срок действия"],
  ["د", "m", "min", "min", "Min", "мин"],
  ["مسارات الملفات (مسار لكل سطر)", "File paths (one per line)", "Chemins des fichiers (un par ligne)", "Rutas de archivos (una por línea)", "Dateipfade (einer pro Zeile)", "Пути файлов (по одному в строке)"],
  ["مسار افتراضي واحد لكل سطر — من ملفات الكمبيوتر في تبويب الملفات", "One virtual path per line — from computer files in the Files tab", "Un chemin virtuel par ligne — depuis les fichiers de l'onglet Fichiers", "Una ruta virtual por línea — de los archivos en la pestaña Archivos", "Ein virtueller Pfad pro Zeile — aus den Dateien im Tab „Dateien“", "Один виртуальный путь в строке — из файлов на вкладке «Файлы»"],
  ["فتح المشاركة", "Open sharing", "Ouvrir le partage", "Abrir compartición", "Freigabe öffnen", "Открыть доступ"],
  ["أرسل الرمز لمن يريد إرسال ملف إليك — يرفع من متصفحه مباشرة إلى صندوق الاستقبال", "Send the code to whoever wants to send you a file — they upload straight from their browser to your inbox", "Envoyez le code à qui veut vous envoyer un fichier — il téléverse depuis son navigateur vers votre boîte", "Envía el código a quien quiera enviarte un archivo — sube desde su navegador a tu bandeja", "Sende den Code an alle, die dir eine Datei schicken wollen — Upload direkt aus dem Browser in deinen Posteingang", "Отправьте код тому, кто хочет прислать файл — он загрузит его из браузера прямо в ваш почтовый ящик"],
  ["أرسل الرمز لمن تريد مشاركة الملفات معه — ينزّلها من متصفحه مباشرة", "Send the code to whoever you want to share files with — they download straight from their browser", "Envoyez le code à qui vous voulez partager des fichiers — il les télécharge depuis son navigateur", "Envía el código a quien quieras compartir archivos — los descarga desde su navegador", "Sende den Code an alle, mit denen du Dateien teilen willst — Download direkt im Browser", "Отправьте код тому, с кем хотите поделиться файлами — он скачает их из браузера"],
  ["بصمة الرمز", "Code fingerprint", "Empreinte du code", "Huella del código", "Code-Fingerabdruck", "Отпечаток кода"],
  ["صندوق الاستقبال", "Inbox", "Boîte de réception", "Bandeja de entrada", "Posteingang", "Входящие"],
  ["تفريغ الصندوق", "Empty inbox", "Vider la boîte", "Vaciar bandeja", "Posteingang leeren", "Очистить входящие"],
  ["لا ملفات مستلمة بعد — شارك الرمز مع ضيف وأرسل منه ملفًا", "No files received yet — share the code with a guest and have them send a file", "Aucun fichier reçu — partagez le code avec un invité et faites envoyer un fichier", "Aún no hay archivos — comparte el código con un invitado y que envíe uno", "Noch keine Dateien — teile den Code mit einem Gast und lass ihn eine Datei senden", "Файлов пока нет — поделитесь кодом с гостем и попросите прислать файл"],
  ["حفظ في التنزيلات", "Save to downloads", "Enregistrer dans les téléchargements", "Guardar en descargas", "In Downloads speichern", "Сохранить в загрузки"],
  ["رمز المشاركة", "Share code", "Code de partage", "Código de compartir", "Freigabe-Code", "Код доступа"],
  ["رمز QR للمشاركة الضيوفة", "Guest sharing QR code", "QR du partage invité", "QR de compartición de invitados", "QR-Code der Gästefreigabe", "QR-код гостевого доступа"],
  ["نسخ الرابط", "Copy link", "Copier le lien", "Copiar enlace", "Link kopieren", "Копировать ссылку"],
  ["افتح المشاركة ليظهر رمز QR — يمسحه الطرف الآخر فيفتح صفحة الاستقبال في متصفحه حصرًا على الشبكة المحلية.", "Open sharing to show the QR code — the other side scans it and opens the receive page in their browser, on the local network only.", "Ouvrez le partage pour afficher le QR — l'autre côté le scanne et ouvre la page de réception dans son navigateur, en réseau local uniquement.", "Abre la compartición para mostrar el QR — el otro lado lo escanea y abre la página de recepción en su navegador, solo en red local.", "Freigabe öffnen, um den QR anzuzeigen — die Gegenseite scannt ihn und öffnet die Empfangsseite im Browser, nur im lokalen Netz.", "Откройте доступ, чтобы показать QR — другая сторона отсканирует его и откроет страницу приёма в браузере, только в локальной сети."],
  ["كيف تعمل المشاركة الضيوفة؟", "How does guest sharing work?", "Comment fonctionne le partage invité ?", "¿Cómo funciona la compartición de invitados?", "Wie funktioniert die Gästefreigabe?", "Как работает гостевой обмен?"],
  ["مقابل LocalSend", "Versus LocalSend", "Face à LocalSend", "Frente a LocalSend", "Gegenüber LocalSend", "В сравнении с LocalSend"],
  ["الطرف الآخر لا يحتاج أي تطبيق — متصفح حصرًا، والنقل محلي بلا وسيط سحابي.", "The other side needs no app — just a browser, and the transfer is local with no cloud middleman.", "L'autre côté n'a besoin d'aucune appli — juste un navigateur, et le transfert est local sans intermédiaire cloud.", "El otro lado no necesita app — solo un navegador, y la transferencia es local sin intermediario en la nube.", "Die Gegenseite braucht keine App — nur einen Browser, und die Übertragung bleibt lokal ohne Cloud-Mittler.", "Другой стороне не нужно приложение — только браузер, передача локальная без облачного посредника."],
  ["أمان مؤقت", "Temporary security", "Sécurité temporaire", "Seguridad temporal", "Temporäre Sicherheit", "Временная безопасность"],
  ["الرمز يموت بانتهاء الصلاحية أو بإغلاقك المشاركة — ومحاولات الرمز الخاطئ تُقفل المؤقتة.", "The code dies on expiry or when you close sharing — repeated wrong-code attempts trigger a temporary lockout.", "Le code meurt à l'expiration ou à la fermeture — les tentatives erronées répétées déclenchent un blocage temporaire.", "El código muere al expirar o al cerrar — los intentos erróneos repetidos activan un bloqueo temporal.", "Der Code stirbt bei Ablauf oder beim Schließen — wiederholte Fehlversuche lösen eine temporäre Sperre aus.", "Код умирает по истечении срока или при закрытии — повторные неверные попытки вызывают временную блокировку."],
  ["حدود صادقة", "Honest limits", "Limites honnêtes", "Límites honestos", "Ehrliche Grenzen", "Честные ограничения"],
  ["الشبكة المحلية حصرًا — بلا عبور إنترنت — وحد الاستقبال 200MB للملف الواحد.", "Local network only — no internet crossing — receive cap 200MB per file.", "Réseau local uniquement — sans passage Internet — plafond de réception 200 Mo par fichier.", "Solo red local — sin cruce de Internet — tope de recepción 200MB por archivo.", "Nur lokales Netz — kein Internet-Durchgang — Empfangslimit 200 MB pro Datei.", "Только локальная сеть — без выхода в интернет — лимит приёма 200 МБ на файл."],
  ["نُسخ رابط المشاركة", "Share link copied", "Lien de partage copié", "Enlace copiado", "Freigabe-Link kopiert", "Ссылка скопирована"],
  ["انقضى وضع التركيز واستُعيدت الحالة السابقة", "Focus mode expired — previous state restored", "Mode focus expiré — état précédent restauré", "Modo enfoque expiró — estado anterior restaurado", "Fokusmodus abgelaufen — vorheriger Zustand wiederhergestellt", "Режим фокуса истёк — предыдущее состояние восстановлено"],
  ["التركيز نشط بالفعل — استعمل التمديد", "Focus is already active — use Extend", "Le focus est déjà actif — utilisez Prolonger", "El enfoque ya está activo — usa Extender", "Fokus ist bereits aktiv — nutze Verlängern", "Фокус уже активен — используйте Продлить"],
  ["بدأ وضع التركيز", "Focus mode started", "Mode focus démarré", "Modo enfoque iniciado", "Fokusmodus gestartet", "Режим фокуса запущен"],
  ["الكتم موحد: التعكيس + عدم الإزعاج", "Unified muting: mirroring + do-not-disturb", "Silencement unifié: miroir + ne pas déranger", "Silencio unificado: espejo + no molestar", "Vereinigtes Stummschalten: Spiegelung + Nicht-stören", "Единое отключение: зеркалирование + не беспокоить"],
  ["بدون كتم التعكيس", "Without mirroring mute", "Sans silence du miroir", "Sin silenciar el espejo", "Ohne Spiegel-Stummschaltung", "Без отключения зеркалирования"],
  ["أُوقف التركيز واستُعيدت الحالة السابقة", "Focus stopped — previous state restored", "Focus arrêté — état précédent restauré", "Enfoque detenido — estado anterior restaurado", "Fokus gestoppt — vorheriger Zustand wiederhergestellt", "Фокус остановлен — состояние восстановлено"],
  ["مُددت جلسة التركيز", "Focus session extended", "Session de focus prolongée", "Sesión de enfoque extendida", "Fokus-Sitzung verlängert", "Сессия фокуса продлена"],
  ["وضع التركيز الموحد", "Unified focus mode", "Mode focus unifié", "Modo enfoque unificado", "Vereinheitlichter Fokusmodus", "Единый режим фокуса"],
  ["كُتم", "muted", "mis en silence", "silenciadas", "stummgeschaltet", "заглушено"],
  ["يتداخل مع ساعات الهدوء", "overlaps quiet hours", "chevauche les heures calmes", "se solapa con horas tranquilas", "überlappt Ruhezeiten", "пересекается с тихими часами"],
  ["الكتم موحد — الإشعارات تُحفظ مكتمة ولا يُفقد شيء", "Muting is unified — notifications are saved muted, nothing is lost", "Silencement unifié — les notifications sont gardées silencieuses, rien ne se perd", "Silencio unificado — las notificaciones se guardan silenciadas, nada se pierde", "Stummschaltung ist vereinheitlicht — Mitteilungen bleiben stumm gespeichert, nichts geht verloren", "Отключение едино — уведомления сохраняются заглушенными, ничего не теряется"],
  ["نشط بلا كتم التعكيس — الجلسة تُعدّ فقط", "Active without mirroring mute — the session only counts", "Actif sans silence du miroir — la session ne fait que compter", "Activo sin silenciar el espejo — la sesión solo cuenta", "Aktiv ohne Spiegel-Stummschaltung — die Sitzung zählt nur", "Активен без отключения зеркала — сессия только считает"],
  ["مفتاح واحد لكتم التعكيس وعدم الإزعاج عبر أجهزتك — بانتهاء ذاتي واستعادة تلقائية", "One switch to mute mirroring and do-not-disturb across your devices — auto-expiring with automatic restore", "Un seul commutateur pour couper miroir et ne-pas-déranger sur vos appareils — expiration auto et restaure automatique", "Un interruptor para silenciar espejo y no-molestar en tus dispositivos — expira solo y se restaura automático", "Ein Schalter für Spiegel- und Nicht-stören-Stumm über deine Geräte — läuft auto ab und stellt auto wieder her", "Один переключатель для зеркала и «не беспокоить» на всех устройствах — авто-истечение и авто-восстановление"],
  ["تمديد 30 دقيقة", "Extend 30 minutes", "Prolonger 30 minutes", "Extender 30 minutos", "30 Minuten verlängern", "Продлить на 30 минут"],
  ["إيقاف", "Stop", "Arrêter", "Detener", "Stoppen", "Стоп"],
  ["كتم التعكيس", "Mirror mute", "Silence du miroir", "Silenciar espejo", "Spiegel stumm", "Заглушить зеркалирование"],
  ["كتم تعكيس الإشعارات", "Mute notification mirroring", "Couper le miroir des notifications", "Silenciar espejo de notificaciones", "Mitteilungsspiegel stumm", "Заглушить зеркалирование уведомлений"],
  ["ابدأ التركيز", "Start focus", "Démarrer le focus", "Iniciar enfoque", "Fokus starten", "Начать фокус"],
  ["المشاركة الضيوفة", "Guest sharing", "Partage invité", "Invitados", "Gästfreigabe", "Гостевой обмен"],
  ["نتائج بحث الخزنة", "Vault search results", "Résultats de recherche du coffre", "Resultados de la bóveda", "Tresor-Suchergebnisse", "Результаты поиска хранилища"],
  ["ابحث في الخزنة…", "Search the vault…", "Rechercher dans le coffre…", "Buscar en la bóveda…", "Tresor durchsuchen…", "Поиск в хранилище…"],
  ["بحث في خزنة الحافظة", "Search clipboard vault", "Rechercher dans le coffre-pressepapiers", "Buscar en la bóveda del portapapeles", "Zwischenablage-Tresor durchsuchen", "Поиск в хранилище буфера"],
  ["لا نتائج في الخزنة", "No vault results", "Aucun résultat du coffre", "Sin resultados de la bóveda", "Keine Tresor-Treffer", "Нет результатов в хранилище"],
  ["الحافظة فارغة — انسخ نصًا من هاتفك عبر", "Clipboard is empty — copy text from your phone via", "Pressepapiers vide — copiez du texte depuis votre téléphone via", "Portapapeles vacío — copia texto desde tu teléfono vía", "Zwischenablage leer — kopiere Text vom Handy über", "Буфер пуст — скопируйте текст с телефона через"],
  ["دُبّس — لن ينتهي ولا يُنقّى", "Pinned — never expires, never purged", "Épinglé — n'expire jamais, n'est jamais purgé", "Fijado — nunca expira, nunca se purga", "Angeheftet — läuft nie ab, wird nie bereinigt", "Закреплено — не истекает и не удаляется"],
  ["فُكّ التدبيس", "Unpinned", "Désépinglé", "Desfijado", "Entpinnt", "Откреплено"],
  ["مثبّت", "Pinned", "Épinglé", "Fijado", "Angeheftet", "Закреплено"],
  ["حساس", "Sensitive", "Sensible", "Sensible", "Sensibel", "Конфиденциально"],
  ["ينتهي قريبًا", "Expiring soon", "Expire bientôt", "Expira pronto", "Läuft bald ab", "Скоро истечёт"],
  ["كشف العنصر الحساس (مُدقَّق)", "Reveal sensitive item (audited)", "Révéler l'élément sensible (audité)", "Revelar elemento sensible (auditado)", "Sensibles Element aufdecken (auditiert)", "Показать конфиденциальное (с аудитом)"],
  ["إلغاء التدبيس", "Unpin", "Désépingler", "Desfijar", "Lösen", "Открепить"],
  ["تدبيس العنصر", "Pin item", "Épingler l'élément", "Fijar elemento", "Element anheften", "Закрепить элемент"],
  ["خزنة الحافظة (§50)", "Clipboard vault (§50)", "Coffre-pressepapiers (§50)", "Bóveda del portapapeles (§50)", "Zwischenablage-Tresor (§50)", "Хранилище буфера (§50)"],
  ["الحساس (رمز دخول/كلمة سر/بطاقة) يُقنَّع تلقائيًا وينتهي بعد 15 دقيقة — الكشف المقصود مُدقَّق، والتدبيس يحفظ ما لا تريد فقدانه، واللصق المؤقت يختفي بذاته.", "Sensitive items (logins, passwords, cards) are auto-masked and expire after 15 minutes — deliberate reveal is audited, pinning keeps what you must not lose, and ephemeral pastes vanish on their own.", "Les éléments sensibles (identifiants, mots de passe, cartes) sont masqués automatiquement et expirent après 15 minutes — la révélation délibérée est auditée, l'épinglage garde ce qu'il ne faut pas perdre, et le collage éphémère disparaît seul.", "Los elementos sensibles (accesos, contraseñas, tarjetas) se enmascaran automáticamente y expiran tras 15 minutos — la revelación deliberada se audita, fijar guarda lo que no debes perder, y el pegado efímero desaparece solo.", "Sensible Elemente (Logins, Passwörter, Karten) werden automatisch maskiert und laufen nach 15 Minuten ab — gezieltes Aufdecken wird auditiert, Anheften bewahrt Unverzichtbares, und flüchtiges Einfügen verschwindet von selbst.", "Конфиденциальное (логины, пароли, карты) маскируется автоматически и истекает через 15 минут — намеренный показ фиксируется аудитом, закрепление сохраняет важное, а временное вставление исчезает само."],
]

const maps = {}
for (const [lang, file] of Object.entries(FILES)) {
  maps[lang] = JSON.parse(fs.readFileSync(file, "utf8"))
}
const langs = Object.keys(FILES)
let added = 0
let skipped = 0
for (const [ar, ...rest] of T) {
  if (maps.en[ar] !== undefined) { skipped++; continue }
  langs.forEach((lang, i) => {
    maps[lang][ar] = rest[i]
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
const ARAR = /[\u0600-\u06FF]/
const aCounts = langs.map((l) => Object.keys(maps[l]).filter((k) => ARAR.test(k)).length)
if (new Set(aCounts).size !== 1) {
  console.error("❌ خلل توازن المفاتيح العربية بين المعاجم!", aCounts)
  process.exit(1)
}
console.log(`✅ توازن المفاتيح العربية: ${aCounts[0]} × ${langs.length}`)
