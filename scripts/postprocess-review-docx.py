#!/usr/bin/env python3
"""Post-process the quarterly review docx (WPS/Word compatibility):
1. Strip empty <w:pgNumType/> emitted for sections without pageNumbers.
2. Patch footer PAGE fields with explicit format switch (\\* arabic).
"""
import re
import shutil
import sys
import zipfile

src = sys.argv[1]
tmp = src + ".tmp"

with zipfile.ZipFile(src, "r") as zin:
    items = zin.infolist()
    data = {i.filename: zin.read(i.filename) for i in items}

changed = []

# 1. document.xml: remove empty pgNumType
doc = data["word/document.xml"].decode("utf-8")
new_doc, n = re.subn(r"<w:pgNumType/>", "", doc)
if n:
    changed.append(f"document.xml: removed {n} empty pgNumType")
data["word/document.xml"] = new_doc.encode("utf-8")

# 2. footers: PAGE -> PAGE \* arabic \* MERGEFORMAT
for name in list(data.keys()):
    if re.match(r"word/footer\d+\.xml", name):
        xml = data[name].decode("utf-8")
        new_xml, n = re.subn(
            r"(<w:instrText[^>]*>)\s*PAGE\s*(</w:instrText>)",
            r"\1 PAGE \\* arabic \\* MERGEFORMAT \2",
            xml,
        )
        if n:
            changed.append(f"{name}: patched {n} PAGE field(s) with \\* arabic")
        data[name] = new_xml.encode("utf-8")

with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
    for i in items:
        zout.writestr(i, data[i.filename])

shutil.move(tmp, src)
print("POSTPROCESS OK:", "; ".join(changed) if changed else "no changes needed")
