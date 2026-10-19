#!/usr/bin/env python3
"""Post-process the roadmap DOCX for WPS/Word page-number compatibility:
1. Remove empty <w:pgNumType/> elements from document.xml (docx-js artifact).
2. Patch footer PAGE fields with explicit format switches:
   - TOC section footer  -> PAGE \\* ROMAN \\* MERGEFORMAT
   - body section footer -> PAGE \\* arabic \\* MERGEFORMAT
Footer-to-section mapping is resolved via sectPr order + document.xml.rels.
"""
import re
import shutil
import sys
import zipfile
import tempfile
import os

DOCX = "/home/z/my-project/download/NexusLink-خارطة-الطريق-الشاملة.docx"


def main():
    tmpdir = tempfile.mkdtemp(prefix="roadmap-docx-")
    with zipfile.ZipFile(DOCX, "r") as z:
        z.extractall(tmpdir)

    doc_path = os.path.join(tmpdir, "word", "document.xml")
    rels_path = os.path.join(tmpdir, "word", "_rels", "document.xml.rels")
    with open(doc_path, encoding="utf-8") as f:
        doc = f.read()
    with open(rels_path, encoding="utf-8") as f:
        rels = f.read()

    # 1. remove empty pgNumType artifacts
    n_removed = len(re.findall(r"<w:pgNumType/>", doc))
    doc = doc.replace("<w:pgNumType/>", "")
    with open(doc_path, "w", encoding="utf-8") as f:
        f.write(doc)
    print(f"pgNumType removed: {n_removed}")

    # 2. map sections -> footer rIds (in document order)
    sect_blocks = re.findall(r"<w:sectPr[^>]*>.*?</w:sectPr>", doc, re.S)
    print(f"sectPr blocks: {len(sect_blocks)}")
    footer_targets = []  # (footer file, fmt)
    rel_map = dict(re.findall(r'<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"', rels))
    for i, blk in enumerate(sect_blocks):
        m = re.search(r'<w:footerReference[^>]*w:type="default"[^>]*r:id="([^"]+)"', blk)
        if not m:
            m = re.search(r'<w:footerReference[^>]*r:id="([^"]+)"[^>]*w:type="default"', blk)
        fmt = None
        if "ROMAN" in blk or "upperRoman" in blk:
            fmt = "roman"
        elif "w:fmt=\"decimal\"" in blk or "<w:pgNumType" not in blk:
            fmt = "arabic"
        if m and fmt:
            target = rel_map.get(m.group(1), "")
            fname = os.path.basename(target)
            footer_targets.append((fname, fmt))
            print(f"section {i}: footer={fname} fmt={fmt}")

    for fname, fmt in footer_targets:
        fpath = os.path.join(tmpdir, "word", fname)
        if not os.path.exists(fpath):
            print(f"WARN missing {fname}")
            continue
        with open(fpath, encoding="utf-8") as f:
            xml = f.read()
        switch = "ROMAN" if fmt == "roman" else "arabic"
        new_xml, n = re.subn(
            r"(<w:instrText[^>]*>)\s*PAGE\s*(</w:instrText>)",
            rf"\1 PAGE \\* {switch} \\* MERGEFORMAT \2",
            xml,
        )
        if n:
            with open(fpath, "w", encoding="utf-8") as f:
                f.write(new_xml)
        print(f"{fname}: patched {n} PAGE field(s) -> {switch}")

    # rezip
    out_tmp = DOCX + ".tmp"
    with zipfile.ZipFile(out_tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for root, _dirs, files in os.walk(tmpdir):
            for name in files:
                full = os.path.join(root, name)
                arc = os.path.relpath(full, tmpdir)
                zout.write(full, arc)
    shutil.move(out_tmp, DOCX)
    shutil.rmtree(tmpdir)
    print(f"OK repacked {DOCX}")


if __name__ == "__main__":
    sys.exit(main())
