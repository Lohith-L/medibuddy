"""
Builds every MediBuddy logo asset from one source image.

    python scripts/generate-brand-assets.py [resources/logo-full.png]
    npx capacitor-assets generate --android     # then: Android launcher icon + splash

The source is the full logo (symbol on top, "MediBuddy" below it, tagline at
the bottom) on a light background. Re-run this whenever a better (higher
resolution) source arrives: every output is regenerated.

Outputs
  src/assets/brand/   logo-full(-dark), logo-horizontal(-dark), logo-symbol   (app UI)
  public/             favicon.ico/-16/-32, favicon.png, apple-touch-icon, icon-192/512,
                      icon-maskable-512, og-image, brand/logo-full.png (boot splash)
  assets/             icon-only, icon-foreground, icon-background, splash, splash-dark
                      (inputs for @capacitor/assets)
  android/.../res/drawable-*dpi/ic_stat_medibuddy.png   (white notification icon)
"""
import os
import sys
from collections import deque

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "resources", "logo-full.png")

WHITE = (255, 255, 255, 255)
DARK_BG = (15, 23, 42, 255)  # #0f172a, the app's dark background
LIGHT_TEXT = (241, 245, 249)  # slate-100: navy text in dark-mode variants


def out(*parts):
    path = os.path.join(ROOT, *parts)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    return path


# ── 1. Background removal ────────────────────────────────────────────────────

src = np.asarray(Image.open(SRC).convert("RGB")).astype(np.float64)
H, W, _ = src.shape

# The light background has a slight gradient: model it from the four corners.
k = max(4, min(H, W) // 40)
corners = [src[:k, :k], src[:k, -k:], src[-k:, :k], src[-k:, -k:]]
tl, tr, bl, br = (c.reshape(-1, 3).mean(axis=0) for c in corners)
v = np.linspace(0, 1, H)[:, None, None]
u = np.linspace(0, 1, W)[None, :, None]
bg = (1 - v) * (1 - u) * tl + (1 - v) * u * tr + v * (1 - u) * bl + v * u * br

dist = np.sqrt(((src - bg) ** 2).sum(axis=2))
# JPEG noise on the plain background reaches ~14: ignore it.
alpha = np.clip((dist - 16) / 44, 0, 1)
a3 = alpha[..., None]
# Un-mix the background from anti-aliased edge pixels.
rgb = np.where(a3 > 0.02, (src - (1 - a3) * bg) / np.maximum(a3, 1e-6), src)
rgb = np.clip(rgb, 0, 255)

# Edge pixels: JPEG ringing leaves light fringes that show on dark backgrounds.
# Give semi-transparent pixels the colour of the nearest solid logo pixel.
solid = alpha >= 0.95
fill = np.where(solid[..., None], rgb, 0.0)
have = solid.copy()
for _ in range(4):
    acc = np.zeros_like(fill)
    cnt = np.zeros(have.shape)
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, -1), (1, -1), (-1, 1)):
        sh = np.roll(np.roll(fill, dy, 0), dx, 1)
        hv = np.roll(np.roll(have, dy, 0), dx, 1)
        acc += sh * hv[..., None]
        cnt += hv
    new = ~have & (cnt > 0)
    fill[new] = acc[new] / cnt[new][:, None]
    have |= new
edge = (alpha > 0) & ~solid & have
rgb[edge] = fill[edge]
rgba = np.dstack([rgb, alpha * 255]).round().astype(np.uint8)

# ── 2. Find the three parts: symbol, wordmark, tagline (rows of ink) ─────────

ink = dist > 60
rows = np.where(ink.any(axis=1))[0]
bands, start, prev = [], None, None
for r in rows:
    if start is None:
        start = r
    elif r != prev + 1:
        bands.append((start, prev))
        start = r
    prev = r
bands.append((start, prev))
bands = [b for b in bands if b[1] - b[0] >= 8]  # ignore specks
if len(bands) < 3:
    sys.exit(f"Expected symbol, wordmark and tagline; found {len(bands)} bands: {bands}")
# Biggest band on top is the symbol; then the wordmark; the last is the tagline.
sym_band, word_band, tag_band = bands[0], bands[1], bands[-1]


def box(band, pad=4):
    a, b = band
    cols = np.where(ink[a : b + 1].any(axis=0))[0]
    return (max(0, a - pad), max(0, cols.min() - pad), min(H, b + pad + 1), min(W, cols.max() + pad + 1))


def crop(arr, b):
    y0, x0, y1, x1 = b
    return arr[y0:y1, x0:x1].copy()


def crop_band(arr, band):
    """Like crop(box(band)) but transparent outside the band's own rows (no bits of the next line)."""
    b = box(band)
    c = crop(arr, b)
    for i in range(c.shape[0]):
        if not (band[0] <= b[0] + i <= band[1]):
            c[i, :, 3] = 0
    return c


# ── 3. Symbol ────────────────────────────────────────────────────────────────
# The white heart is negative space (it opens to the outside next to the hand),
# so it stays transparent like the rest of the background.

sb = box(sym_band, pad=6)
sym = crop(rgba, sb)
sym_solid = sym
print(f"symbol {sym.shape[1]}x{sym.shape[0]} px")

# Silhouette for the notification icon: the coloured shape, heart cut out.
silhouette = sym[..., 3]


def to_image(arr):
    return Image.fromarray(arr, "RGBA")


def dark_text(arr):
    """Navy text -> light, for dark backgrounds (green / blue stay)."""
    a = arr.copy()
    lum = 0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]
    navy = (lum < 95) & (a[..., 3] > 0)
    a[navy, 0], a[navy, 1], a[navy, 2] = LIGHT_TEXT
    return a


symbol_img = to_image(sym_solid)
word = crop_band(rgba, word_band)
tag = crop_band(rgba, tag_band)

# ── 4. UI logos ──────────────────────────────────────────────────────────────


def compose_full(word_arr, tag_arr):
    """Symbol, wordmark and tagline at their original positions."""
    y0 = sb[0]
    y1 = box(tag_band)[2]
    x0 = min(sb[1], box(word_band)[1], box(tag_band)[1])
    x1 = max(sb[3], box(word_band)[3], box(tag_band)[3])
    canvas = Image.new("RGBA", (x1 - x0, y1 - y0), (0, 0, 0, 0))
    for arr, b in ((sym_solid, sb), (word_arr, box(word_band)), (tag_arr, box(tag_band))):
        canvas.alpha_composite(to_image(arr), (b[1] - x0, b[0] - y0))
    return canvas


def compose_horizontal(word_arr):
    wimg = to_image(word_arr)
    sh = round(wimg.height * 1.25)
    s = symbol_img.resize((round(symbol_img.width * sh / symbol_img.height), sh), Image.LANCZOS)
    gap = round(sh * 0.16)
    canvas = Image.new("RGBA", (s.width + gap + wimg.width, max(sh, wimg.height)), (0, 0, 0, 0))
    canvas.alpha_composite(s, (0, (canvas.height - sh) // 2))
    canvas.alpha_composite(wimg, (s.width + gap, (canvas.height - wimg.height) // 2))
    return canvas


def square(img, size, scale, bg=(0, 0, 0, 0)):
    """img centred on a size x size canvas, its longer side = scale * size."""
    f = scale * size / max(img.size)
    r = img.resize((max(1, round(img.width * f)), max(1, round(img.height * f))), Image.LANCZOS)
    c = Image.new("RGBA", (size, size), bg)
    c.alpha_composite(r, ((size - r.width) // 2, (size - r.height) // 2))
    return c


def fit_circle(img, size, diameter_ratio, bg=(0, 0, 0, 0)):
    """img centred with its bounding box inside a circle (adaptive / maskable safe zone)."""
    diag = (img.width ** 2 + img.height ** 2) ** 0.5
    f = diameter_ratio * size / diag
    r = img.resize((round(img.width * f), round(img.height * f)), Image.LANCZOS)
    c = Image.new("RGBA", (size, size), bg)
    c.alpha_composite(r, ((size - r.width) // 2, (size - r.height) // 2))
    return c


full = compose_full(word, tag)
full_dark = compose_full(dark_text(word), dark_text(tag))
horizontal = compose_horizontal(word)
horizontal_dark = compose_horizontal(dark_text(word))
sym_square = square(symbol_img, round(max(symbol_img.size) * 1.08), 1 / 1.08)

for name, img in (
    ("logo-full.png", full),
    ("logo-full-dark.png", full_dark),
    ("logo-horizontal.png", horizontal),
    ("logo-horizontal-dark.png", horizontal_dark),
    ("logo-symbol.png", sym_square),
):
    img.save(out("src", "assets", "brand", name), optimize=True)
    print(f"src/assets/brand/{name}: {img.width}x{img.height}")
full.save(out("public", "brand", "logo-full.png"), optimize=True)
full_dark.save(out("public", "brand", "logo-full-dark.png"), optimize=True)  # boot screen, dark theme

# ── 5. Website icons ─────────────────────────────────────────────────────────

ico_sizes = [16, 32, 48]
square(symbol_img, 256, 0.96).save(out("public", "favicon.ico"), sizes=[(s, s) for s in ico_sizes])
square(symbol_img, 16, 1.0).save(out("public", "favicon-16.png"))
square(symbol_img, 32, 0.98).save(out("public", "favicon-32.png"))
square(symbol_img, 64, 0.96).save(out("public", "favicon.png"))
square(symbol_img, 180, 0.76, WHITE).convert("RGB").save(out("public", "apple-touch-icon.png"))
square(symbol_img, 192, 0.8, WHITE).save(out("public", "icon-192.png"))
square(symbol_img, 512, 0.8, WHITE).save(out("public", "icon-512.png"))
fit_circle(symbol_img, 512, 0.78, WHITE).save(out("public", "icon-maskable-512.png"))
og = Image.new("RGBA", (1200, 630), WHITE)
f = min(1000 / full.width, 520 / full.height)
ogl = full.resize((round(full.width * f), round(full.height * f)), Image.LANCZOS)
og.alpha_composite(ogl, ((1200 - ogl.width) // 2, (630 - ogl.height) // 2))
og.convert("RGB").save(out("public", "og-image.png"), optimize=True)
print(f"public icons done (OG logo scale {f:.2f}x, 512 icon symbol scale {0.8 * 512 / max(symbol_img.size):.2f}x)")

# ── 6. @capacitor/assets inputs (Android launcher icon + splash) ─────────────

square(symbol_img, 1024, 0.72, WHITE).save(out("assets", "icon-only.png"))
# Adaptive icon: @capacitor/assets draws this image into the middle 66.6% (72dp)
# of the 108dp layer (inset 16.7%). A diagonal of 0.86 x 72dp = ~61dp keeps the
# symbol inside the 66dp safe circle, so round launcher icons never crop it.
fit_circle(symbol_img, 1024, 0.86, (0, 0, 0, 0)).save(out("assets", "icon-foreground.png"))
Image.new("RGBA", (1024, 1024), WHITE).save(out("assets", "icon-background.png"))
for name, logo, bgc in (("splash.png", full, WHITE), ("splash-dark.png", full_dark, DARK_BG)):
    c = Image.new("RGBA", (2732, 2732), bgc)
    f = 1000 / logo.width
    s = logo.resize((1000, round(logo.height * f)), Image.LANCZOS)
    c.alpha_composite(s, ((2732 - s.width) // 2, (2732 - s.height) // 2))
    c.convert("RGB").save(out("assets", name))
print("assets/ (capacitor-assets inputs) done")

# ── 7. Notification small icon: white silhouette ─────────────────────────────

sil = np.zeros((*silhouette.shape, 4), np.uint8)
sil[..., :3] = 255
sil[..., 3] = silhouette
sil_img = to_image(sil)
for folder, px in (("mdpi", 24), ("hdpi", 36), ("xhdpi", 48), ("xxhdpi", 72), ("xxxhdpi", 96)):
    square(sil_img, px, 22 / 24).save(out("android", "app", "src", "main", "res", f"drawable-{folder}", "ic_stat_medibuddy.png"))
print("ic_stat_medibuddy (white silhouette) done")
