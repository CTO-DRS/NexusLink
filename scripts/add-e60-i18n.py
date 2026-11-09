#!/usr/bin/env python3
# §60 — إضافة مفاتيح أنواع الدفع الكاملة (file-ref · media-position)
# لترجمات الوكيل المحمول (6 لغات — شجرة متطابقة حرفيًا)
import json, collections, os

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                    "..", "nexuslink_mobile", "assets", "translations")

K = {
 "ar": {
  "kindUrl": "رابط",
  "kindText": "نص",
  "kindRef": "مرجع ملف",
  "kindMedia": "موضع وسائط",
  "pickFile": "اختيار ملف من الهاتف",
  "filePicked": "الملف: {name}",
  "refHint": "مسار الملف كما سيعرض على الكمبيوتر — ≤512 محرفًا",
  "mediaName": "اسم الوسيط",
  "mediaNameHint": "مثلًا: محاضرة-الذكاء.mp4",
  "positionLabel": "الموضع بالثواني",
  "positionHint": "مثلًا: 125",
  "noFile": "لم يُختر ملف",
 },
 "en": {
  "kindUrl": "Link",
  "kindText": "Text",
  "kindRef": "File reference",
  "kindMedia": "Media position",
  "pickFile": "Pick a file from the phone",
  "filePicked": "File: {name}",
  "refHint": "File path as shown on the computer — ≤512 chars",
  "mediaName": "Media name",
  "mediaNameHint": "e.g. lecture-ai.mp4",
  "positionLabel": "Position in seconds",
  "positionHint": "e.g. 125",
  "noFile": "No file picked",
 },
 "de": {
  "kindUrl": "Link",
  "kindText": "Text",
  "kindRef": "Dateireferenz",
  "kindMedia": "Medienposition",
  "pickFile": "Datei vom Handy wählen",
  "filePicked": "Datei: {name}",
  "refHint": "Dateipfad wie am Computer angezeigt — ≤512 Zeichen",
  "mediaName": "Medienname",
  "mediaNameHint": "z. B. vorlesung-ki.mp4",
  "positionLabel": "Position in Sekunden",
  "positionHint": "z. B. 125",
  "noFile": "Keine Datei ausgewählt",
 },
 "fr": {
  "kindUrl": "Lien",
  "kindText": "Texte",
  "kindRef": "Référence de fichier",
  "kindMedia": "Position média",
  "pickFile": "Choisir un fichier du téléphone",
  "filePicked": "Fichier : {name}",
  "refHint": "Chemin du fichier tel qu'affiché sur l'ordinateur — ≤512 caractères",
  "mediaName": "Nom du média",
  "mediaNameHint": "ex. : conference-ia.mp4",
  "positionLabel": "Position en secondes",
  "positionHint": "ex. : 125",
  "noFile": "Aucun fichier choisi",
 },
 "ru": {
  "kindUrl": "Ссылка",
  "kindText": "Текст",
  "kindRef": "Ссылка на файл",
  "kindMedia": "Позиция медиа",
  "pickFile": "Выбрать файл на телефоне",
  "filePicked": "Файл: {name}",
  "refHint": "Путь к файлу, как на компьютере — ≤512 символов",
  "mediaName": "Название медиа",
  "mediaNameHint": "напр. lekcija-ii.mp4",
  "positionLabel": "Позиция в секундах",
  "positionHint": "напр. 125",
  "noFile": "Файл не выбран",
 },
 "es": {
  "kindUrl": "Enlace",
  "kindText": "Texto",
  "kindRef": "Referencia de archivo",
  "kindMedia": "Posición multimedia",
  "pickFile": "Elegir un archivo del teléfono",
  "filePicked": "Archivo: {name}",
  "refHint": "Ruta del archivo tal como se muestra en el ordenador — ≤512 caracteres",
  "mediaName": "Nombre del medio",
  "mediaNameHint": "p. ej.: clase-ia.mp4",
  "positionLabel": "Posición en segundos",
  "positionHint": "p. ej.: 125",
  "noFile": "Ningún archivo elegido",
 },
}

E = {
 "ar": {"refLong": "مرجع الملف أطول من 512 محرفًا",
        "mediaBad": "اسم الوسيط ≤200 محرفًا والموضع رقم بالثواني"},
 "en": {"refLong": "File reference exceeds 512 characters",
        "mediaBad": "Media name ≤200 chars and position in seconds"},
 "de": {"refLong": "Dateireferenz überschreitet 512 Zeichen",
        "mediaBad": "Medienname ≤200 Zeichen und Position in Sekunden"},
 "fr": {"refLong": "La référence de fichier dépasse 512 caractères",
        "mediaBad": "Nom du média ≤200 caractères et position en secondes"},
 "ru": {"refLong": "Ссылка на файл длиннее 512 символов",
        "mediaBad": "Название медиа ≤200 символов и позиция в секундах"},
 "es": {"refLong": "La referencia de archivo supera los 512 caracteres",
        "mediaBad": "Nombre del medio ≤200 caracteres y posición en segundos"},
}

def key_count(d):
    n = 0
    for v in d.values():
        n += key_count(v) if isinstance(v, dict) else 1
    return n

LANGS = ["ar", "en", "de", "fr", "ru", "es"]
for lang in LANGS:
    path = os.path.join(BASE, f"{lang}.json")
    with open(path, encoding="utf-8") as f:
        data = json.load(f, object_pairs_hook=collections.OrderedDict)
    h = data["handoff"]
    for k, v in K[lang].items():
        assert k not in h, f"{lang}.handoff.{k} already exists"
        h[k] = v
    for k, v in E[lang].items():
        assert k not in h["err"], f"{lang}.handoff.err.{k} already exists"
        h["err"][k] = v
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"{lang}: total keys now {key_count(data)} (+{len(K[lang]) + len(E[lang])})")

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
for lang in LANGS:
    with open(os.path.join(BASE, f"{lang}.json"), encoding="utf-8") as f:
        trees[lang] = keytree(json.load(f))
ref = trees["en"]
ok_all = True
for lang, t in trees.items():
    missing = ref - t
    extra = t - ref
    if missing or extra:
        ok_all = False
    print(f"{lang}: missing={sorted(missing) if missing else 0} extra={sorted(extra) if extra else 0}")
print("TREE-IDENTICAL" if ok_all else "TREE-MISMATCH")
