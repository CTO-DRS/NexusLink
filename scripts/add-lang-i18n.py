#!/usr/bin/env python3
"""M1.4 (عقد §31): دمج سلاسل الواجهة الجديدة للغات الست — يدوي عالي الجودة بلا اعتماد على الـSDK.
المصدر: سلاسل أدخلتها LANG-A11Y (الإعدادات/الشريط/onboarding/الاختصار/الإعلان).
- ar-en-map.json: مفتاح عربي → إنجليزية (سقوط الجميع)
- i18n/{fr,es,de,ru}.json: نفس المفاتيح → الترجمة (تُترك للمولّد أي مفاتيح مستقبلية)
"""
import json
import sys

# (arabic, en, fr, es, de, ru)
NEW = [
    ("ست لغات: عربي RTL + خمس LTR — التبديل فوري لكل الواجهة",
     "Six languages: Arabic RTL + five LTR — instant switching for the whole UI",
     "Six langues : arabe RTL + cinq LTR — bascule instantanée pour toute l'interface",
     "Seis idiomas: árabe RTL + cinco LTR — cambio instantáneo en toda la interfaz",
     "Sechs Sprachen: Arabisch RTL + fünf LTR — sofortiger Wechsel für die gesamte Oberfläche",
     "Шесть языков: арабский RTL + пять LTR — мгновенное переключение всего интерфейса"),
    ("اللغة", "Language", "Langue", "Idioma", "Sprache", "Язык"),
    ("من اليمين إلى اليسار", "right-to-left", "de droite à gauche", "de derecha a izquierda",
     "von rechts nach links", "справа налево"),
    ("من اليسار إلى اليمين", "left-to-right", "de gauche à droite", "de izquierda a derecha",
     "von links nach rechts", "слева направо"),
    ("اختصار: Ctrl+Shift+E — يدور بين الست لغات",
     "Shortcut: Ctrl+Shift+E — cycles through the six languages",
     "Raccourci : Ctrl+Shift+E — parcourt les six langues",
     "Atajo: Ctrl+Shift+E — recorre los seis idiomas",
     "Kürzel: Ctrl+Shift+E — rotiert durch die sechs Sprachen",
     "Сочетание: Ctrl+Shift+E — переключает шесть языков"),
    ("تم تبديل اللغة إلى", "Language switched to", "Langue changée en", "Idioma cambiado a",
     "Sprache geändert zu", "Язык переключён на"),
    ("حجم الخط", "Font size", "Taille de police", "Tamaño de fuente", "Schriftgröße", "Размер шрифта"),
    ("ثلاثة مستويات تُطبّق على الواجهة كلها",
     "Three levels applied across the whole UI",
     "Trois niveaux appliqués à toute l'interface",
     "Tres niveles aplicados a toda la interfaz",
     "Drei Stufen für die gesamte Oberfläche",
     "Три уровня для всего интерфейса"),
    ("تبديل اللغة (دورة الست)", "Switch language (six-cycle)", "Changer de langue (cycle de six)",
     "Cambiar idioma (ciclo de seis)", "Sprache wechseln (Sechser-Zyklus)", "Сменить язык (цикл из шести)"),
]

def load(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)

def save(p, d):
    with open(p, "w", encoding="utf-8") as f:
        # python-default separators (', ', ': ') — 8 legacy E2E checks grep '"ar": "en"' with the space (lesson)
        json.dump(d, f, ensure_ascii=False)

en_map = load("src/lib/ar-en-map.json")
maps = {c: load(f"src/lib/i18n/{c}.json") for c in ("fr", "es", "de", "ru")}

added_en = added_lang = 0
for ar, en, fr, es, de, ru in NEW:
    if not en_map.get(ar):
        en_map[ar] = en
        added_en += 1
    for c, v in (("fr", fr), ("es", es), ("de", de), ("ru", ru)):
        if not maps[c].get(ar):
            maps[c][ar] = v
            added_lang += 1

save("src/lib/ar-en-map.json", en_map)
for c in maps:
    save(f"src/lib/i18n/{c}.json", maps[c])

print(f"en-map: +{added_en}; new-lang maps: +{added_lang} ({ {c: len(maps[c]) for c in maps} })")
