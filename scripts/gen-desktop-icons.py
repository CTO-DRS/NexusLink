#!/usr/bin/env python3
# NexusLink — توليد أيقونات Tauri (app icon + 5 حالات tray)
# أسلوب بصرى: خلفية كحلية داكنة مستديرة + حلقة نكسس سماوية + عقدة وصلة (nexus node)
from PIL import Image, ImageDraw
import struct, os

OUT = "apps/desktop/src-tauri/icons"
os.makedirs(OUT, exist_ok=True)

NAVY = (11, 18, 32, 255)        # 0B1220
CYAN = (34, 211, 238)           # 22D3EE
CYAN_DIM = (34, 211, 238, 90)

def rounded_rect(draw, box, radius, fill):
    draw.rounded_rectangle(box, radius=radius, fill=fill)

def base_icon(size, ring_color, dot_color=None, dim=False, pause_bars=False):
    S = size * 4  # supersample
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    m = int(S * 0.04)
    rounded_rect(d, (m, m, S - m, S - m), int(S * 0.22), NAVY)

    # حلقة النكسس (الشعار) — قوس مفتوح يرمز للاتصال الجاري
    cx, cy = S / 2, S / 2
    r = S * 0.30
    w = int(S * 0.055)
    bbox = (cx - r, cy - r, cx + r, cy + r)
    # حلقة أساس خافتة + قوس ساطع 270°
    d.arc(bbox, 0, 360, fill=(255, 255, 255, 28), width=w)
    d.arc(bbox, -90, 180, fill=ring_color + (255 if not dim else 160,), width=w)

    # عقدة الوصلة على طرف القوس (نقطة النكسس)
    import math
    ang = math.radians(180)  # نهاية القوس عند -90→180 = يسار علوي→يسار
    nx, ny = cx + r * math.cos(math.radians(180)), cy + r * math.sin(math.radians(180))
    nr = S * 0.085
    d.ellipse((nx - nr, ny - nr, nx + nr, ny + nr), fill=ring_color + (255,))

    # نقطة مركزية = الهاتف/السيرفر
    cr = S * 0.065
    dc = dot_color or ring_color
    d.ellipse((cx - cr, cy - cr, cx + cr, cy + cr), fill=dc + (255 if dc != ring_color else 255,))

    if pause_bars:
        bw = S * 0.075
        gap = S * 0.045
        for dx in (-gap - bw / 2, gap + bw / 2):
            d.rounded_rectangle(
                (cx + dx - bw / 2, cy - S * 0.16, cx + dx + bw / 2, cy + S * 0.16),
                radius=bw / 3, fill=(255, 255, 255, 235),
            )
    return img.resize((size, size), Image.LANCZOS)

def write_icns(pngs: dict, path):
    # icns حديث: أجزاء PNG (ic07 128, ic08 256, ic09 512, ic10 1024)
    entries = b""
    for t, data in pngs.items():
        entries += t.encode() + struct.pack(">I", len(data) + 8) + data
    with open(path, "wb") as f:
        f.write(b"icns" + struct.pack(">I", len(entries) + 8) + entries)

# الحالات: متصل (أخضر)، منتظر (رمادي/أزرق خافت)، إيقاف مؤقت (كهرماني+شرطات)، خطأ (أحمر)
states = {
    "connected": dict(ring_color=(52, 211, 153)),    # emerald-400
    "waiting":   dict(ring_color=(96, 165, 250)),    # blue-400
    "paused":    dict(ring_color=(251, 191, 36), pause_bars=True),  # amber-400
    "error":     dict(ring_color=(248, 113, 113)),   # red-400
}

for name, kw in states.items():
    base_icon(32, **kw).save(f"{OUT}/tray-{name}.png")
    base_icon(64, **kw).save(f"{OUT}/tray-{name}@2x.png")

# أيقونة التطبيق الأساسية (سماوية — هوية NexusLink)
app512 = base_icon(512, ring_color=CYAN)
app512.save(f"{OUT}/icon.png")
app512.save(f"{OUT}/128x128.png")
app512.save(f"{OUT}/128x128@2x.png")  # 512 = @2x of 128... يجب 256 فعليًا:
base_icon(256, ring_color=CYAN).save(f"{OUT}/128x128@2x.png")
base_icon(32, ring_color=CYAN).save(f"{OUT}/32x32.png")

# ICO (ويندوز) من 16/32/48/256
ico_sizes = [16, 32, 48, 256]
app512.save(f"{OUT}/icon.ico", sizes=[(s, s) for s in ico_sizes])

# ICNS (ماك) — png bytes لكل مقاس
import io as _io
pngs = {}
for t, s in [("ic07", 128), ("ic08", 256), ("ic09", 512), ("ic10", 1024)]:
    buf = _io.BytesIO()
    base_icon(min(s, 1024), ring_color=CYAN).save(buf, "PNG")
    pngs[t] = buf.getvalue()
write_icns(pngs, f"{OUT}/icon.icns")

print("icons written:", sorted(os.listdir(OUT)))
