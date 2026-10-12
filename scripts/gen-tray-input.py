#!/usr/bin/env python3
# NexusLink — توليد أيقونة tray-input (جلسة تحكم نشطة — FA-input)
# نفس اللغة البصرية لـ gen-desktop-icons.py: قاعدة كحلية + حلقة — بنفسجي مميز
from PIL import Image, ImageDraw
import math, os

OUT = "apps/desktop/src-tauri/icons"
NAVY = (11, 18, 32, 255)
VIOLET = (167, 139, 250)  # violet-400 — جلسة تحكم عن بُعد نشطة

def rounded_rect(draw, box, radius, fill):
    draw.rounded_rectangle(box, radius=radius, fill=fill)

def base_icon(size, ring_color):
    S = size * 4
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    m = int(S * 0.04)
    rounded_rect(d, (m, m, S - m, S - m), int(S * 0.22), NAVY)

    cx, cy = S / 2, S / 2
    r = S * 0.30
    w = int(S * 0.055)
    bbox = (cx - r, cy - r, cx + r, cy + r)
    d.arc(bbox, 0, 360, fill=(255, 255, 255, 28), width=w)
    d.arc(bbox, -90, 180, fill=ring_color + (255,), width=w)

    # عقدة الوصلة + نقطة مركزية (هاتف يتحكم بالكمبيوتر)
    nx, ny = cx + r * math.cos(math.radians(180)), cy + r * math.sin(math.radians(180))
    nr = S * 0.085
    d.ellipse((nx - nr, ny - nr, nx + nr, ny + nr), fill=ring_color + (255,))
    cr = S * 0.065
    d.ellipse((cx - cr, cy - cr, cx + cr, cy + cr), fill=(255, 255, 255, 240))
    return img.resize((size, size), Image.LANCZOS)

base_icon(32, VIOLET).save(f"{OUT}/tray-input.png")
base_icon(64, VIOLET).save(f"{OUT}/tray-input@2x.png")
print("tray-input icons written")
