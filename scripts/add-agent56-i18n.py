#!/usr/bin/env python3
# §56 — إضافة مفاتيح handoff وscan لترجمات الوكيل المحمول (6 لغات)
import json, collections

BASE = "/home/z/my-project/nexuslink/nexuslink_mobile/assets/translations"

T = {
 "ar": {
  "handoff": {
   "title": "أرسل إلى الحاسوب",
   "targetNamed": "سيصل إلى: {name}",
   "needConnect": "اتصل بالسيرفر أولًا — شاشة الاتصال",
   "payload": "رابط أو نص",
   "payloadHint": "الصق رابطًا يبدأ http/https أو نصًا حرًّا…",
   "note": "ملاحظة (اختياري)",
   "noteHint": "تظهر بجوار العنصر على الكمبيوتر",
   "send": "أرسل إلى الكمبيوتر",
   "sending": "جارٍ الإرسال…",
   "sent": "وصل إلى الكمبيوتر — راية الجرس في الشريط العلوي",
   "failed": "تعذر الإرسال — أعد المحاولة",
   "privacyNote": "محليًا عبر شبكتك حصرًا — بلا سحابة ولا حساب ولا وسيط",
   "err": {
    "empty": "المحتوى فارغ",
    "scheme": "الرابط يجب أن يبدأ http:// أو https://",
    "tooLong": "المحتوى أطول من الحد المسموح",
    "noHost": "الرابط بلا مستضيف صالح",
    "rate": "إرسال متتابع سريع — مهّل قليلًا ثم أعد"
   }
  },
  "scan": {
   "title": "الماسح الموثق",
   "needConnect": "اتصل بالسيرفر أولًا — شاشة الاتصال",
   "intro": "صفحات من هاتفك تُدمج في PDF على حاسوبك حرفيًا — محليًا بلا سحابة",
   "limits": "السقوف: {pages} صفحة/جلسة · {mb} ميجابايت/صفحة",
   "titleLabel": "عنوان الجلسة (اختياري)",
   "titleHint": "مثلًا: عقد الإيجار — نوفمبر",
   "openSession": "فتح جلسة مسح",
   "sessionNoTitle": "جلسة بلا عنوان",
   "addPages": "إضافة صفحات",
   "cancelSession": "إلغاء الجلسة وحذف صفحاتها",
   "empty": "لا صفحات بعد — أضف صورًا JPEG من معرض الصور",
   "moveUp": "تقديم ترتيبًا",
   "moveDown": "تأخير ترتيبًا",
   "rotate": "تدوير 90°",
   "remove": "إزالة",
   "seal": "ختم PDF على الكمبيوتر",
   "sealedTitle": "خُتم PDF",
   "sealedBody": "{pages} صفحة · {size} — كُتب الملف على حاسوبك",
   "sealedTo": "خُتم: {file}",
   "cancelled": "أُلغيت الجلسة",
   "ok": "حسنًا",
   "failed": "تعذّر الفعل — أعد المحاولة",
   "err": {
    "notFound": "الجلسة لم تعد موجودة على الكمبيوتر",
    "tooManySessions": "ثلاث جلسات مفتوحة كحد أقصى — أختم أو ألغِ إحداها",
    "tooManyPages": "ثلاثون صفحة كحد أقصى للجلسة",
    "rate": "رفع متتابع سريع — مهّل قليلًا ثم أعد",
    "notJpeg": "الملف ليس JPEG — الماسح يقبل صور الكاميرا JPEG حصرًا",
    "notJpegNamed": "{name} ليس JPEG — قُفز",
    "tooLarge": "الصفحة أكبر من 12 ميجابايت",
    "noPages": "لا صفحات لختمها — أضف صورًا أولًا",
    "escape": "مسار غير آمن رفضه الكمبيوتر",
    "badArgs": "وسائط غير صالحة"
   }
  }
 },
 "en": {
  "handoff": {
   "title": "Send to PC",
   "targetNamed": "Will arrive at: {name}",
   "needConnect": "Connect to the server first — Connect screen",
   "payload": "Link or text",
   "payloadHint": "Paste a link starting with http/https or plain text…",
   "note": "Note (optional)",
   "noteHint": "Shown next to the item on the PC",
   "send": "Send to computer",
   "sending": "Sending…",
   "sent": "Arrived on the PC — see the bell badge in the top bar",
   "failed": "Could not send — try again",
   "privacyNote": "Over your own network only — no cloud, no account, no relay",
   "err": {
    "empty": "Content is empty",
    "scheme": "Link must start with http:// or https://",
    "tooLong": "Content exceeds the allowed limit",
    "noHost": "Link has no valid host",
    "rate": "Sending too fast — wait a moment and retry"
   }
  },
  "scan": {
   "title": "Document Scanner",
   "needConnect": "Connect to the server first — Connect screen",
   "intro": "Pages from your phone become a PDF on your computer — locally, no cloud",
   "limits": "Limits: {pages} pages/session · {mb} MB/page",
   "titleLabel": "Session title (optional)",
   "titleHint": "e.g. Rental contract — November",
   "openSession": "Start scan session",
   "sessionNoTitle": "Untitled session",
   "addPages": "Add pages",
   "cancelSession": "Cancel session and delete pages",
   "empty": "No pages yet — add JPEG photos from the gallery",
   "moveUp": "Move up",
   "moveDown": "Move down",
   "rotate": "Rotate 90°",
   "remove": "Remove",
   "seal": "Seal PDF on the computer",
   "sealedTitle": "PDF sealed",
   "sealedBody": "{pages} pages · {size} — the file was written on your computer",
   "sealedTo": "Sealed: {file}",
   "cancelled": "Session cancelled",
   "ok": "OK",
   "failed": "Action failed — try again",
   "err": {
    "notFound": "The session no longer exists on the computer",
    "tooManySessions": "Three open sessions max — seal or cancel one",
    "tooManyPages": "Thirty pages max per session",
    "rate": "Uploading too fast — wait a moment and retry",
    "notJpeg": "Not a JPEG — the scanner accepts camera JPEGs only",
    "notJpegNamed": "{name} is not a JPEG — skipped",
    "tooLarge": "Page is larger than 12 MB",
    "noPages": "Nothing to seal — add photos first",
    "escape": "Unsafe path rejected by the computer",
    "badArgs": "Invalid arguments"
   }
  }
 }
}

# de / fr / ru / es — تُبنى من الإنجليزية بترجمة حقيقية كاملة (لا placeholders)
T["de"] = {
 "handoff": {
  "title": "An PC senden",
  "targetNamed": "Kommt an bei: {name}",
  "needConnect": "Zuerst mit dem Server verbinden — Bildschirm „Verbinden“",
  "payload": "Link oder Text",
  "payloadHint": "Link mit http/https einfügen oder Text eingeben…",
  "note": "Notiz (optional)",
  "noteHint": "Wird am PC neben dem Eintrag angezeigt",
  "send": "An den Computer senden",
  "sending": "Wird gesendet…",
  "sent": "Am PC angekommen — Klingel-Badge in der oberen Leiste",
  "failed": "Senden fehlgeschlagen — erneut versuchen",
  "privacyNote": "Nur über Ihr eigenes Netzwerk — keine Cloud, kein Konto, kein Relay",
  "err": {
   "empty": "Inhalt ist leer",
   "scheme": "Link muss mit http:// oder https:// beginnen",
   "tooLong": "Inhalt überschreitet das zulässige Limit",
   "noHost": "Link ohne gültigen Host",
   "rate": "Zu schnell gesendet — kurz warten und wiederholen"
  }
 },
 "scan": {
  "title": "Dokument-Scanner",
  "needConnect": "Zuerst mit dem Server verbinden — Bildschirm „Verbinden“",
  "intro": "Seiten vom Handy werden zu einem PDF auf Ihrem Computer — lokal, ohne Cloud",
  "limits": "Grenzen: {pages} Seiten/Sitzung · {mb} MB/Seite",
  "titleLabel": "Sitzungstitel (optional)",
  "titleHint": "z. B. Mietvertrag — November",
  "openSession": "Scan-Sitzung starten",
  "sessionNoTitle": "Sitzung ohne Titel",
  "addPages": "Seiten hinzufügen",
  "cancelSession": "Sitzung abbrechen und Seiten löschen",
  "empty": "Noch keine Seiten — JPEG-Fotos aus der Galerie hinzufügen",
  "moveUp": "Nach oben",
  "moveDown": "Nach unten",
  "rotate": "90° drehen",
  "remove": "Entfernen",
  "seal": "PDF am Computer versiegeln",
  "sealedTitle": "PDF versiegelt",
  "sealedBody": "{pages} Seiten · {size} — die Datei wurde auf Ihrem Computer geschrieben",
  "sealedTo": "Versiegelt: {file}",
  "cancelled": "Sitzung abgebrochen",
  "ok": "OK",
  "failed": "Aktion fehlgeschlagen — erneut versuchen",
  "err": {
   "notFound": "Die Sitzung existiert am Computer nicht mehr",
   "tooManySessions": "Maximal drei offene Sitzungen — eine versiegeln oder abbrechen",
   "tooManyPages": "Maximal dreißig Seiten pro Sitzung",
   "rate": "Zu schnell hochgeladen — kurz warten und wiederholen",
   "notJpeg": "Kein JPEG — der Scanner akzeptiert nur Kamera-JPEGs",
   "notJpegNamed": "{name} ist kein JPEG — übersprungen",
   "tooLarge": "Seite ist größer als 12 MB",
   "noPages": "Nichts zu versiegeln — zuerst Fotos hinzufügen",
   "escape": "Unsicherer Pfad vom Computer abgelehnt",
   "badArgs": "Ungültige Argumente"
  }
 }
}
T["fr"] = {
 "handoff": {
  "title": "Envoyer vers le PC",
  "targetNamed": "Arrivera sur : {name}",
  "needConnect": "Connectez-vous d'abord au serveur — écran « Connexion »",
  "payload": "Lien ou texte",
  "payloadHint": "Collez un lien commençant par http/https ou saisissez du texte…",
  "note": "Note (facultatif)",
  "noteHint": "Affichée à côté de l'élément sur le PC",
  "send": "Envoyer vers l'ordinateur",
  "sending": "Envoi…",
  "sent": "Arrivé sur le PC — badge de la cloche dans la barre supérieure",
  "failed": "Échec de l'envoi — réessayez",
  "privacyNote": "Sur votre propre réseau uniquement — sans cloud, sans compte, sans relais",
  "err": {
   "empty": "Le contenu est vide",
   "scheme": "Le lien doit commencer par http:// ou https://",
   "tooLong": "Le contenu dépasse la limite autorisée",
   "noHost": "Lien sans hôte valide",
   "rate": "Envoi trop rapide — patientez un instant puis réessayez"
  }
 },
 "scan": {
  "title": "Scanner de documents",
  "needConnect": "Connectez-vous d'abord au serveur — écran « Connexion »",
  "intro": "Les pages de votre téléphone deviennent un PDF sur votre ordinateur — en local, sans cloud",
  "limits": "Limites : {pages} pages/session · {mb} Mo/page",
  "titleLabel": "Titre de la session (facultatif)",
  "titleHint": "ex. : Contrat de location — novembre",
  "openSession": "Démarrer une session de scan",
  "sessionNoTitle": "Session sans titre",
  "addPages": "Ajouter des pages",
  "cancelSession": "Annuler la session et supprimer les pages",
  "empty": "Aucune page — ajoutez des photos JPEG depuis la galerie",
  "moveUp": "Monter",
  "moveDown": "Descendre",
  "rotate": "Pivoter de 90°",
  "remove": "Retirer",
  "seal": "Sceller le PDF sur l'ordinateur",
  "sealedTitle": "PDF scellé",
  "sealedBody": "{pages} pages · {size} — le fichier a été écrit sur votre ordinateur",
  "sealedTo": "Scellé : {file}",
  "cancelled": "Session annulée",
  "ok": "OK",
  "failed": "Échec de l'action — réessayez",
  "err": {
   "notFound": "La session n'existe plus sur l'ordinateur",
   "tooManySessions": "Trois sessions ouvertes maximum — scellez-en ou annulez-en une",
   "tooManyPages": "Trente pages maximum par session",
   "rate": "Téléversement trop rapide — patientez puis réessayez",
   "notJpeg": "Pas un JPEG — le scanner n'accepte que les JPEG d'appareil photo",
   "notJpegNamed": "{name} n'est pas un JPEG — ignoré",
   "tooLarge": "La page dépasse 12 Mo",
   "noPages": "Rien à sceller — ajoutez d'abord des photos",
   "escape": "Chemin non sûr rejeté par l'ordinateur",
   "badArgs": "Arguments invalides"
  }
 }
}
T["ru"] = {
 "handoff": {
  "title": "Отправить на ПК",
  "targetNamed": "Придёт на: {name}",
  "needConnect": "Сначала подключитесь к серверу — экран «Подключение»",
  "payload": "Ссылка или текст",
  "payloadHint": "Вставьте ссылку http/https или введите текст…",
  "note": "Заметка (необязательно)",
  "noteHint": "Показывается рядом с элементом на ПК",
  "send": "Отправить на компьютер",
  "sending": "Отправка…",
  "sent": "Доставлено на ПК — значок колокольчика в верхней панели",
  "failed": "Не удалось отправить — попробуйте снова",
  "privacyNote": "Только по вашей собственной сети — без облака, без аккаунта, без посредника",
  "err": {
   "empty": "Содержимое пусто",
   "scheme": "Ссылка должна начинаться с http:// или https://",
   "tooLong": "Содержимое превышает допустимый лимит",
   "noHost": "Ссылка без корректного хоста",
   "rate": "Слишком часто — подождите немного и повторите"
  }
 },
 "scan": {
  "title": "Сканер документов",
  "needConnect": "Сначала подключитесь к серверу — экран «Подключение»",
  "intro": "Страницы с телефона станут PDF на вашем компьютере — локально, без облака",
  "limits": "Ограничения: {pages} страниц/сессия · {mb} МБ/страница",
  "titleLabel": "Название сессии (необязательно)",
  "titleHint": "напр.: Договор аренды — ноябрь",
  "openSession": "Начать сессию сканирования",
  "sessionNoTitle": "Сессия без названия",
  "addPages": "Добавить страницы",
  "cancelSession": "Отменить сессию и удалить страницы",
  "empty": "Пока нет страниц — добавьте JPEG-фото из галереи",
  "moveUp": "Выше",
  "moveDown": "Ниже",
  "rotate": "Повернуть на 90°",
  "remove": "Убрать",
  "seal": "Запечатать PDF на компьютере",
  "sealedTitle": "PDF запечатан",
  "sealedBody": "{pages} страниц · {size} — файл записан на вашем компьютере",
  "sealedTo": "Запечатано: {file}",
  "cancelled": "Сессия отменена",
  "ok": "ОК",
  "failed": "Действие не удалось — попробуйте снова",
  "err": {
   "notFound": "Сессии больше нет на компьютере",
   "tooManySessions": "Максимум три открытые сессии — запечатайте или отмените одну",
   "tooManyPages": "Максимум тридцать страниц на сессию",
   "rate": "Загрузка слишком быстрая — подождите и повторите",
   "notJpeg": "Не JPEG — сканер принимает только JPEG с камеры",
   "notJpegNamed": "{name} — не JPEG, пропущено",
   "tooLarge": "Страница больше 12 МБ",
   "noPages": "Нечего запечатывать — сначала добавьте фото",
   "escape": "Небезопасный путь отклонён компьютером",
   "badArgs": "Недопустимые аргументы"
  }
 }
}
T["es"] = {
 "handoff": {
  "title": "Enviar al PC",
  "targetNamed": "Llegará a: {name}",
  "needConnect": "Conéctate primero al servidor — pantalla «Conexión»",
  "payload": "Enlace o texto",
  "payloadHint": "Pega un enlace que empiece por http/https o escribe texto…",
  "note": "Nota (opcional)",
  "noteHint": "Se muestra junto al elemento en el PC",
  "send": "Enviar al ordenador",
  "sending": "Enviando…",
  "sent": "Llegó al PC — insignia de la campana en la barra superior",
  "failed": "No se pudo enviar — inténtalo de nuevo",
  "privacyNote": "Solo por tu propia red — sin nube, sin cuenta, sin intermediario",
  "err": {
   "empty": "El contenido está vacío",
   "scheme": "El enlace debe empezar por http:// o https://",
   "tooLong": "El contenido supera el límite permitido",
   "noHost": "El enlace no tiene un host válido",
   "rate": "Envío demasiado rápido — espera un momento y reintenta"
  }
 },
 "scan": {
  "title": "Escáner de documentos",
  "needConnect": "Conéctate primero al servidor — pantalla «Conexión»",
  "intro": "Las páginas de tu teléfono se convierten en un PDF en tu ordenador — local, sin nube",
  "limits": "Límites: {pages} páginas/sesión · {mb} MB/página",
  "titleLabel": "Título de la sesión (opcional)",
  "titleHint": "p. ej.: Contrato de alquiler — noviembre",
  "openSession": "Iniciar sesión de escaneo",
  "sessionNoTitle": "Sesión sin título",
  "addPages": "Añadir páginas",
  "cancelSession": "Cancelar sesión y borrar páginas",
  "empty": "Aún no hay páginas — añade fotos JPEG de la galería",
  "moveUp": "Subir",
  "moveDown": "Bajar",
  "rotate": "Girar 90°",
  "remove": "Quitar",
  "seal": "Sellar el PDF en el ordenador",
  "sealedTitle": "PDF sellado",
  "sealedBody": "{pages} páginas · {size} — el archivo se escribió en tu ordenador",
  "sealedTo": "Sellado: {file}",
  "cancelled": "Sesión cancelada",
  "ok": "OK",
  "failed": "La acción falló — inténtalo de nuevo",
  "err": {
   "notFound": "La sesión ya no existe en el ordenador",
   "tooManySessions": "Máximo tres sesiones abiertas — sella o cancela una",
   "tooManyPages": "Máximo treinta páginas por sesión",
   "rate": "Subida demasiado rápida — espera y reintenta",
   "notJpeg": "No es JPEG — el escáner solo acepta JPEG de cámara",
   "notJpegNamed": "{name} no es JPEG — omitido",
   "tooLarge": "La página supera los 12 MB",
   "noPages": "Nada que sellar — añade fotos primero",
   "escape": "Ruta insegura rechazada por el ordenador",
   "badArgs": "Argumentos no válidos"
  }
 }
}

def key_count(d):
    n = 0
    for v in d.values():
        n += key_count(v) if isinstance(v, dict) else 1
    return n

for lang in ["ar", "en", "de", "fr", "ru", "es"]:
    path = f"{BASE}/{lang}.json"
    with open(path, encoding="utf-8") as f:
        data = json.load(f, object_pairs_hook=collections.OrderedDict)
    assert "handoff" not in data and "scan" not in data, f"{lang} already has keys"
    data["handoff"] = T[lang]["handoff"]
    data["scan"] = T[lang]["scan"]
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"{lang}: total keys now {key_count(data)} (+{key_count(T[lang])})")

# تحقق التطابق الكامل بين اللغات الست (شجرة المفاتيح)
def keytree(d, prefix=""):
    s = set()
    for k, v in d.items():
        p = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            s |= keytree(v, p)
        else:
            s.add(p)
    return s

trees = {}
for lang in ["ar", "en", "de", "fr", "ru", "es"]:
    with open(f"{BASE}/{lang}.json", encoding="utf-8") as f:
        trees[lang] = keytree(json.load(f))
ref = trees["en"]
for lang, t in trees.items():
    missing = ref - t
    extra = t - ref
    print(f"{lang}: missing={sorted(missing) if missing else 0} extra={sorted(extra) if extra else 0}")
