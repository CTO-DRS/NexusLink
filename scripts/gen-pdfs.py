#!/usr/bin/env python3
"""NexusLink — generate real PDF documents for preview testing."""
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor

BASE = "/home/z/my-project/data/nexus-storage/media/Documents"

TEAL = HexColor("#0d9488")
DARK = HexColor("#134e4a")
GRAY = HexColor("#475569")


def doc_invoice():
    path = f"{BASE}/invoice_march.pdf"
    c = canvas.Canvas(path, pagesize=A4)
    w, h = A4
    c.setFillColor(DARK)
    c.rect(0, h - 40 * mm, w, 40 * mm, fill=1, stroke=0)
    c.setFillColor(HexColor("#ffffff"))
    c.setFont("Helvetica-Bold", 24)
    c.drawString(20 * mm, h - 25 * mm, "INVOICE #2026-0341")
    c.setFont("Helvetica", 11)
    c.drawString(20 * mm, h - 32 * mm, "NexusLink Technologies - March 2026")
    rows = [
        ("Item", "Qty", "Price"),
        ("NexusLink Pro License", "2", "$120.00"),
        ("Cloud Sync Add-on", "1", "$35.00"),
        ("Priority Support", "12 months", "$96.00"),
    ]
    y = h - 60 * mm
    for i, (a, b, cc) in enumerate(rows):
        c.setFillColor(TEAL if i == 0 else GRAY)
        c.setFont("Helvetica-Bold" if i == 0 else "Helvetica", 12)
        c.drawString(20 * mm, y, a)
        c.drawString(110 * mm, y, b)
        c.drawString(150 * mm, y, cc)
        y -= 12 * mm
    c.setFillColor(DARK)
    c.setFont("Helvetica-Bold", 16)
    c.drawString(110 * mm, y - 6 * mm, "TOTAL: $251.00")
    c.setFillColor(GRAY)
    c.setFont("Helvetica", 10)
    c.drawString(20 * mm, 30 * mm, "Thank you for choosing NexusLink. Payment due within 30 days.")
    c.showPage()
    c.save()
    print("OK", path)


def doc_notes():
    path = f"{BASE}/meeting_notes.pdf"
    c = canvas.Canvas(path, pagesize=A4)
    w, h = A4
    c.setFillColor(TEAL)
    c.setFont("Helvetica-Bold", 22)
    c.drawString(20 * mm, h - 30 * mm, "Team Meeting Notes")
    c.setFillColor(GRAY)
    c.setFont("Helvetica", 12)
    lines = [
        "Date: March 12, 2026",
        "Attendees: Sara, Omar, Layla, Yousef",
        "",
        "1. File transfer engine reached 42 MB/s on WiFi 6.",
        "2. Resume-on-disconnect verified with 2GB test file.",
        "3. Video preview streaming via Range requests works.",
        "4. Next sprint: APK silent install permissions.",
        "5. QA reports zero critical bugs this week.",
    ]
    y = h - 45 * mm
    for ln in lines:
        c.drawString(20 * mm, y, ln)
        y -= 9 * mm
    c.showPage()
    c.save()
    print("OK", path)


if __name__ == "__main__":
    doc_invoice()
    doc_notes()
