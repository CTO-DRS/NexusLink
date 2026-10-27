#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# عقد §46 — مفاتيح i18n للمساعدة عن بعد برمز قصير (سيناريو العائلة)
# درس موثق (أربع مرات): فحوص i18n تقرأ '"ar": "en"' بمسافة — separators=(", ", ": ") إلزامي
# اللغات الكسولة (fr/es/de/ru) تسقط تعاقديًا إلى en (نمط §37/§38/§40: lang→en→raw) —
# لكن §42 رفع الباب إلى التطابق الكامل فتُضاف المفاتيح العشرة للمعاجم الخمسة كافة.
import json

PATHS = {
    "en": "src/lib/ar-en-map.json",
    "fr": "src/lib/i18n/fr.json",
    "es": "src/lib/i18n/es.json",
    "de": "src/lib/i18n/de.json",
    "ru": "src/lib/i18n/ru.json",
}

NEW = {
    "en": {
        "رمز المساعدة (بديل المسح للعائلة)": "Assist code (no-scan option for family)",
        "اقرأ الرمز هاتفيًا لمن تُساعده — يدخله تطبيق NexusLink على جهازه، والاقتران يكتمل بموافقتك هنا": "Read this code over a phone call to the person you're helping — they type it into NexusLink on their device, and pairing completes only with your approval here",
        "طلب اقتران مساعدة": "Assist pairing request",
        "يطلب الاقتران برمز المساعدة — لا يكتمل الاقتران إلا بموافقتك": "wants to pair via the assist code — pairing completes only with your approval",
        "قبول وفتح جلسة": "Accept & open session",
        "رفض": "Deny",
        "جلسة مساعدة نشطة مع": "Assist session active with",
        "قطع الجلسة": "End session",
        "نافذة الرمز منتهية — أعد فتح الاقتران لإصدار رمز جديد": "Code window expired — reopen pairing to issue a new code",
        "بانتظار موافقة مالك الكمبيوتر…": "Waiting for the computer owner's approval…",
    },
    "fr": {
        "رمز المساعدة (بديل المسح للعائلة)": "Code d'assistance (option sans scan pour la famille)",
        "اقرأ الرمز هاتفيًا لمن تُساعده — يدخله تطبيق NexusLink على جهازه، والاقتران يكتمل بموافقتك هنا": "Lisez ce code par téléphone à la personne que vous aidez — elle le saisit dans NexusLink sur son appareil, et l'appairage ne se termine qu'avec votre approbation ici",
        "طلب اقتران مساعدة": "Demande d'appairage d'assistance",
        "يطلب الاقتران برمز المساعدة — لا يكتمل الاقتران إلا بموافقتك": "souhaite s'appairer via le code d'assistance — l'appairage ne se termine qu'avec votre approbation",
        "قبول وفتح جلسة": "Accepter et ouvrir la session",
        "رفض": "Refuser",
        "جلسة مساعدة نشطة مع": "Session d'assistance active avec",
        "قطع الجلسة": "Terminer la session",
        "نافذة الرمز منتهية — أعد فتح الاقتران لإصدار رمز جديد": "Fenêtre du code expirée — rouvrez l'appairage pour émettre un nouveau code",
        "بانتظار موافقة مالك الكمبيوتر…": "En attente de l'approbation du propriétaire de l'ordinateur…",
    },
    "es": {
        "رمز المساعدة (بديل المسح للعائلة)": "Código de asistencia (opción sin escaneo para la familia)",
        "اقرأ الرمز هاتفيًا لمن تُساعده — يدخله تطبيق NexusLink على جهازه، والاقتران يكتمل بموافقتك هنا": "Lea este código por teléfono a la persona que ayuda — lo introduce en NexusLink en su dispositivo, y el emparejamiento solo se completa con su aprobación aquí",
        "طلب اقتران مساعدة": "Solicitud de emparejamiento de asistencia",
        "يطلب الاقتران برمز المساعدة — لا يكتمل الاقتران إلا بموافقتك": "quiere emparejarse mediante el código de asistencia — el emparejamiento solo se completa con su aprobación",
        "قبول وفتح جلسة": "Aceptar y abrir sesión",
        "رفض": "Rechazar",
        "جلسة مساعدة نشطة مع": "Sesión de asistencia activa con",
        "قطع الجلسة": "Terminar sesión",
        "نافذة الرمز منتهية — أعد فتح الاقتران لإصدار رمز جديد": "Ventana del código caducada — vuelva a abrir el emparejamiento para emitir un nuevo código",
        "بانتظار موافقة مالك الكمبيوتر…": "Esperando la aprobación del propietario del ordenador…",
    },
    "de": {
        "رمز المساعدة (بديل المسح للعائلة)": "Hilfscode (Scan-freie Option für die Familie)",
        "اقرأ الرمز هاتفيًا لمن تُساعده — يدخله تطبيق NexusLink على جهازه، والاقتران يكتمل بموافقتك هنا": "Lesen Sie diesen Code am Telefon der Person vor, der Sie helfen — sie tippt ihn in NexusLink auf ihrem Gerät ein, und die Kopplung wird erst mit Ihrer Zustimmung hier abgeschlossen",
        "طلب اقتران مساعدة": "Hilfs-Kopplungsanfrage",
        "يطلب الاقتران برمز المساعدة — لا يكتمل الاقتران إلا بموافقتك": "möchte sich über den Hilfscode koppeln — die Kopplung wird erst mit Ihrer Zustimmung abgeschlossen",
        "قبول وفتح جلسة": "Annehmen & Sitzung öffnen",
        "رفض": "Ablehnen",
        "جلسة مساعدة نشطة مع": "Hilfssitzung aktiv mit",
        "قطع الجلسة": "Sitzung beenden",
        "نافذة الرمز منتهية — أعد فتح الاقتران لإصدار رمز جديد": "Code-Fenster abgelaufen — Kopplung erneut öffnen, um einen neuen Code auszustellen",
        "بانتظار موافقة مالك الكمبيوتر…": "Warten auf die Zustimmung des Computer-Besitzers…",
    },
    "ru": {
        "رمز المساعدة (بديل المسح للعائلة)": "Код помощи (вариант без сканирования для семьи)",
        "اقرأ الرمز هاتفيًا لمن تُساعده — يدخله تطبيق NexusLink على جهازه، والاقتران يكتمل بموافقتك هنا": "Прочитайте этот код по телефону человеку, которому помогаете, — он введёт его в NexusLink на своём устройстве, а сопряжение завершится только с вашего одобрения здесь",
        "طلب اقتران مساعدة": "Запрос на сопряжение помощи",
        "يطلب الاقتران برمز المساعدة — لا يكتمل الاقتران إلا بموافقتك": "хочет выполнить сопряжение через код помощи — сопряжение завершится только с вашим одобрением",
        "قبول وفتح جلسة": "Принять и открыть сеанс",
        "رفض": "Отклонить",
        "جلسة مساعدة نشطة مع": "Активный сеанс помощи с",
        "قطع الجلسة": "Завершить сеанс",
        "نافذة الرمز منتهية — أعد فتح الاقتران لإصدار رمز جديد": "Срок действия кода истёк — заново откройте сопряжение, чтобы выдать новый код",
        "بانتظار موافقة مالك الكمبيوتر…": "Ожидание одобрения владельца компьютера…",
    },
}

total_added = 0
for lang, path in PATHS.items():
    with open(path, encoding="utf-8") as f:
        m = json.load(f)
    added = 0
    for k, v in NEW[lang].items():
        if k in m:
            if m[k] != v:
                print(f"CONFLICT [{lang}] {k!r}: exists={m[k]!r} new={v!r}")
            continue
        m[k] = v
        added += 1
    with open(path, "w", encoding="utf-8") as f:
        json.dump(m, f, ensure_ascii=False, separators=(", ", ": "))
    print(f"[{lang}] added={added} total={len(m)}")
    total_added += added

print(f"TOTAL added={total_added}")
