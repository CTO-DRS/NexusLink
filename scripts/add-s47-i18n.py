#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# عقد §47 — مفاتيح i18n للإدارة المركزية الجماعية الموسّعة
# درس موثق (أربع مرات): فحوص i18n تقرأ '"ar": "en"' بمسافة — separators=(", ", ": ") إلزامي
# §42 يفرض التطابق الكامل: المفاتيح تُضاف للمعاجم الخمسة كافة (ar مفتاح خام بلا معجم).
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
        "إعدادات مقفولة مؤسسيًا": "Settings locked by policy",
        "تدوير رمز الوصول مستحق الآن": "Access-code rotation due now",
        "تدوير الرمز كل": "Rotate the code every",
        "قدرات معطلة مؤسسيًا": "Capabilities disabled by policy",
        "أرضية الإصدار": "Version floor",
        "الجهاز تحت الأرضية": "Device below the floor",
        "الرمز الحالي تجاوز أجلة التدوير المؤسسية — دوّره الآن: الاستمرار أولًا والإنذار صاخب لا صامت (لا قطع ذاتي)": "The current code exceeded the enterprise rotation period — rotate it now: continuity first, the alarm is loud never silent (no auto-revocation)",
        "إصدار هذا الجهاز تحت الأرضية المؤسسية — أعلِم مديرك وحدّثه (ختم معلن لا حجب حي)": "This device's version is below the enterprise floor — notify your admin and update (an announced stamp, not a live block)",
        "تصدير تقرير الامتثال": "Export compliance report",
        "…جارٍ التصدير": "Exporting…",
        "تقرير JSON الكامل": "Full JSON report",
        "تقرير PDF للمُدقّقين (إنجليزي)": "Auditor PDF report (English)",
        "التقرير يُصدَّر محليًا حصرًا (تنزيل في متصفحك — لا يُرسل لأي طرف): بيانات وصفية فقط من سياسة وأجهزة وإصدارات ومقاييس وسجل تدقيقي": "The report is exported locally only (a download in your browser — never sent anywhere): descriptive data only from policy, devices, versions, metrics and the audit trail",
        "كتابة إعدادات مرفوضة (قفل مؤسسي)": "Settings write denied (policy lock)",
        "استحقاق تدوير الرمز": "Access-code rotation due",
        "قدرة مرفوضة بالسياسة": "Capability denied by policy",
    },
    "fr": {
        "إعدادات مقفولة مؤسسيًا": "Paramètres verrouillés par la politique",
        "تدوير رمز الوصول مستحق الآن": "Rotation du code d'accès exigée maintenant",
        "تدوير الرمز كل": "Rotation du code tous les",
        "قدرات معطلة مؤسسيًا": "Fonctionnalités désactivées par la politique",
        "أرضية الإصدار": "Plancher de version",
        "الجهاز تحت الأرضية": "Appareil sous le plancher",
        "الرمز الحالي تجاوز أجلة التدوير المؤسسية — دوّره الآن: الاستمرار أولًا والإنذار صاخب لا صامت (لا قطع ذاتي)": "Le code actuel a dépassé la période de rotation d'entreprise — renouvelez-le maintenant : la continuité d'abord, l'alerte est sonore jamais silencieuse (pas de révocation automatique)",
        "إصدار هذا الجهاز تحت الأرضية المؤسسية — أعلِم مديرك وحدّثه (ختم معلن لا حجب حي)": "La version de cet appareil est sous le plancher d'entreprise — informez votre administrateur et mettez à jour (un tampon annoncé, pas un blocage en direct)",
        "تصدير تقرير الامتثال": "Exporter le rapport de conformité",
        "…جارٍ التصدير": "Export en cours…",
        "تقرير JSON الكامل": "Rapport JSON complet",
        "تقرير PDF للمُدقّقين (إنجليزي)": "Rapport PDF pour auditeurs (anglais)",
        "التقرير يُصدَّر محليًا حصرًا (تنزيل في متصفحك — لا يُرسل لأي طرف): بيانات وصفية فقط من سياسة وأجهزة وإصدارات ومقاييس وسجل تدقيقي": "Le rapport est exporté localement uniquement (un téléchargement dans votre navigateur — jamais envoyé nulle part) : données descriptives uniquement, de la politique, des appareils, des versions, des métriques et du journal d'audit",
        "كتابة إعدادات مرفوضة (قفل مؤسسي)": "Écriture de paramètres refusée (verrouillage)",
        "استحقاق تدوير الرمز": "Rotation du code exigée",
        "قدرة مرفوضة بالسياسة": "Fonctionnalité refusée par la politique",
    },
    "es": {
        "إعدادات مقفولة مؤسسيًا": "Ajustes bloqueados por política",
        "تدوير رمز الوصول مستحق الآن": "Rotación del código de acceso vencida",
        "تدوير الرمز كل": "Rotar el código cada",
        "قدرات معطلة مؤسسيًا": "Capacidades desactivadas por política",
        "أرضية الإصدار": "Suelo de versión",
        "الجهاز تحت الأرضية": "Dispositivo bajo el suelo",
        "الرمز الحالي تجاوز أجلة التدوير المؤسسية — دوّره الآن: الاستمرار أولًا والإنذار صاخب لا صامت (لا قطع ذاتي)": "El código actual superó el período de rotación empresarial — renuévelo ahora: la continuidad primero, la alarma es sonora nunca silenciosa (sin revocación automática)",
        "إصدار هذا الجهاز تحت الأرضية المؤسسية — أعلِم مديرك وحدّثه (ختم معلن لا حجب حي)": "La versión de este dispositivo está bajo el suelo empresarial — avise a su administrador y actualice (un sello anunciado, no un bloqueo en vivo)",
        "تصدير تقرير الامتثال": "Exportar informe de cumplimiento",
        "…جارٍ التصدير": "Exportando…",
        "تقرير JSON الكامل": "Informe JSON completo",
        "تقرير PDF للمُدقّقين (إنجليزي)": "Informe PDF para auditores (inglés)",
        "التقرير يُصدَّر محليًا حصرًا (تنزيل في متصفحك — لا يُرسل لأي طرف): بيانات وصفية فقط من سياسة وأجهزة وإصدارات ومقاييس وسجل تدقيقي": "El informe se exporta solo localmente (una descarga en su navegador — nunca se envía a nadie): únicamente datos descriptivos de política, dispositivos, versiones, métricas y registro de auditoría",
        "كتابة إعدادات مرفوضة (قفل مؤسسي)": "Escritura de ajustes rechazada (bloqueo)",
        "استحقاق تدوير الرمز": "Rotación del código vencida",
        "قدرة مرفوضة بالسياسة": "Capacidad rechazada por política",
    },
    "de": {
        "إعدادات مقفولة مؤسسيًا": "Durch Richtlinie gesperrte Einstellungen",
        "تدوير رمز الوصول مستحق الآن": "Rotation des Zugriffscodes jetzt fällig",
        "تدوير الرمز كل": "Code rotieren alle",
        "قدرات معطلة مؤسسيًا": "Durch Richtlinie deaktivierte Funktionen",
        "أرضية الإصدار": "Versionsuntergrenze",
        "الجهاز تحت الأرضية": "Gerät unter der Untergrenze",
        "الرمز الحالي تجاوز أجلة التدوير المؤسسية — دوّره الآن: الاستمرار أولًا والإنذار صاخب لا صامت (لا قطع ذاتي)": "Der aktuelle Code hat den Unternehmens-Rotationszeitraum überschritten — jetzt erneuern: Kontinuität zuerst, der Alarm ist laut, nie still (keine automatische Sperrung)",
        "إصدار هذا الجهاز تحت الأرضية المؤسسية — أعلِم مديرك وحدّثه (ختم معلن لا حجب حي)": "Die Version dieses Geräts liegt unter der Unternehmens-Untergrenze — informieren Sie Ihren Administrator und aktualisieren Sie (ein angekündigter Stempel, keine Live-Sperre)",
        "تصدير تقرير الامتثال": "Compliance-Bericht exportieren",
        "…جارٍ التصدير": "Wird exportiert…",
        "تقرير JSON الكامل": "Vollständiger JSON-Bericht",
        "تقرير PDF للمُدقّقين (إنجليزي)": "PDF-Bericht für Prüfer (Englisch)",
        "التقرير يُصدَّر محليًا حصرًا (تنزيل في متصفحك — لا يُرسل لأي طرف): بيانات وصفية فقط من سياسة وأجهزة وإصدارات ومقاييس وسجل تدقيقي": "Der Bericht wird ausschließlich lokal exportiert (ein Download in Ihrem Browser — wird nirgends hingesendet): nur beschreibende Daten aus Richtlinie, Geräten, Versionen, Metriken und Prüfprotokoll",
        "كتابة إعدادات مرفوضة (قفل مؤسسي)": "Einstellungsschreiben abgelehnt (Sperre)",
        "استحقاق تدوير الرمز": "Coderotation fällig",
        "قدرة مرفوضة بالسياسة": "Funktion durch Richtlinie abgelehnt",
    },
    "ru": {
        "إعدادات مقفولة مؤسسيًا": "Настройки, заблокированные политикой",
        "تدوير رمز الوصول مستحق الآن": "Ротация кода доступа просрочена",
        "تدوير الرمز كل": "Ротация кода каждые",
        "قدرات معطلة مؤسسيًا": "Возможности, отключённые политикой",
        "أرضية الإصدار": "Нижняя граница версии",
        "الجهاز تحت الأرضية": "Устройство ниже границы",
        "الرمز الحالي تجاوز أجلة التدوير المؤسسية — دوّره الآن: الاستمرار أولًا والإنذار صاخب لا صامت (لا قطع ذاتي)": "Текущий код превысил корпоративный период ротации — обновите его сейчас: сначала непрерывность, тревога громкая, никогда не молчит (без автоотзыва)",
        "إصدار هذا الجهاز تحت الأرضية المؤسسية — أعلِم مديرك وحدّثه (ختم معلن لا حجب حي)": "Версия этого устройства ниже корпоративной границы — сообщите администратору и обновите (объявленный штамп, а не живая блокировка)",
        "تصدير تقرير الامتثال": "Экспортировать отчёт о соответствии",
        "…جارٍ التصدير": "Экспорт…",
        "تقرير JSON الكامل": "Полный JSON-отчёт",
        "تقرير PDF للمُدقّقين (إنجليزي)": "PDF-отчёт для аудиторов (английский)",
        "التقرير يُصدَّر محليًا حصرًا (تنزيل في متصفحك — لا يُرسل لأي طرف): بيانات وصفية فقط من سياسة وأجهزة وإصدارات ومقاييس وسجل تدقيقي": "Отчёт экспортируется только локально (загрузка в вашем браузере — никуда не отправляется): только описательные данные из политики, устройств, версий, метрик и журнала аудита",
        "كتابة إعدادات مرفوضة (قفل مؤسسي)": "Запись настроек отклонена (блокировка)",
        "استحقاق تدوير الرمز": "Ротация кода просрочена",
        "قدرة مرفوضة بالسياسة": "Возможность отклонена политикой",
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
