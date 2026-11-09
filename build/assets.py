"""Prepare scene textures from the artwork.

Run once after the artwork changes: npm run assets (python build/assets.py)
Sources: artwork/evening.jpg (evening, all lights on) and artwork/day.jpg (the
same room by day, aligned pixel for pixel).
Writes src/assets/scene-assets.js (data URLs, loads under file:// as well)
and debug images in .cache/assets/. Requires Pillow and numpy.

All coordinates below are pixels of the 2752x1536 source artwork.
"""
import base64
import io
import json
import sys
from pathlib import Path

import os

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'artwork/evening.jpg'
DAY_SOURCE = ROOT / 'artwork/day.jpg'
CACHE = ROOT / '.cache/assets'
OUT = ROOT / 'src/assets/scene-assets.js'

# Scene geometry shared with the shader (exported to scene-assets.js).
PANES = [  # visible window glass: left, top, right, bottom
    (820, 318, 1016, 880),
    (1100, 345, 1212, 482),
    (1091, 520, 1217, 878),
]
# Mantel clock. The dial stands parallel to the right wall: its horizontal
# lines run to the wall's vanishing point VP (fitted to the right wall's
# cornice, the sideboard counter, drawers and shelf), verticals stay vertical.
# Dial plane: unit circle = inner edge of the gold bezel, 12 o'clock at (0, -1).
# Plane -> image: x = (a u VPx + cx) / (a u + 1), y = (a u VPy + b v + cy) / (a u + 1);
# cx, cy, a, b fitted to the bezel edge.
VP = (-145.0, 810.0)
DIAL = dict(cx=2136.991, cy=311.804, a=-.0125631, b=38.3746)
CLOCK = dict(cx=DIAL['cx'], cy=DIAL['cy'])
TV = dict(cx=1579.5, cy=911.0, hx=102.0, hy=84.0)
LAMP = [(1737, 600), (1868, 600), (1868, 740), (1709, 740)]
TREE = [(468, 110), (520, 300), (640, 640), (800, 1060), (830, 1250), (20, 1250), (60, 1000), (230, 560), (410, 230)]
FLAMES = [(1028, 808, 6, 8), (929, 847, 6, 9), (911, 880, 5, 6)]  # cx, cy, rx, ry
OFF_BOX = (0, 90, 1072, 1262)  # region of the lights-off plate (tree and window sill)
STAR = [(372, 100), (505, 100), (505, 236), (372, 236)]
# Wall calendar sheet corners (top-left, top-right, bottom-right, bottom-left).
# The year and the month grid are erased and drawn by the shader in the
# sheet's perspective; the shader holds the inverse of this homography.
CAL_QUAD = [(1514, 350), (1700, 371), (1700, 727), (1514, 723)]
CAL_ERASE = (.025, .603, .985, .975)  # sheet area of the printed year and grid (u0, v0, u1, v1)
# Glyph atlas for the calendar: one row of digits and weekday letters, then
# the month names two per row. Roboto (Apache License 2.0) has Cyrillic.
FONT_CANDIDATES = [os.environ.get('NY_FONT', ''), r'C:\python314\Lib\site-packages\customtkinter\assets\fonts\Roboto\Roboto-Medium.ttf',
                   '/usr/share/fonts/truetype/roboto/Roboto-Medium.ttf', '/usr/share/fonts/google-roboto/Roboto-Medium.ttf']
MONTHS = ['ЯНВАРЬ', 'ФЕВРАЛЬ', 'МАРТ', 'АПРЕЛЬ', 'МАЙ', 'ИЮНЬ', 'ИЮЛЬ', 'АВГУСТ', 'СЕНТЯБРЬ', 'ОКТЯБРЬ', 'НОЯБРЬ', 'ДЕКАБРЬ']
WEEKDAYS = 'ПВСЧПСВ'
# Ceiling above the cornice, where the floor lamp throws the shadows of the
# branches on the sideboard and of the curtain rod bracket.
CEILING = [(0, 0), (2470, 0), (1745, 214), (1460, 182), (1300, 162), (700, 100), (380, 62), (0, 26)]
# Narrow band between the cornice and the curtain rod: the rod and its bracket.
# Shadow of the curtain rod on the wall and the cornice moulding above it:
# from the cornice edge down to the top of the rod (measured luminance profiles).
ROD_BAND = [(430, 54), (950, 98), (1350, 150), (1452, 166), (1458, 190), (1350, 220), (950, 162), (430, 90)]
# Shadow of the rod end and its wall bracket, filled from the surroundings.
BRACKET = [(1404, 180), (1430, 182), (1446, 226), (1410, 226)]  # thin shadow of the wall bracket
TULLE = [  # sheer curtains (left and right), for daylight transmission
    [(640, 140), (812, 150), (820, 1210), (640, 1215)],
    [(1236, 220), (1335, 225), (1345, 1220), (1240, 1220)],
]


def blur(a, sigma):
    """Gaussian approximation by three box passes along each axis (edge clamped)."""
    if sigma <= 0:
        return a.copy()
    r = max(1, int(round(np.sqrt(12 * sigma * sigma / 3 + 1) / 2)))
    out = a.astype(np.float32)
    for axis in (0, 1):
        for _ in range(3):
            pad = [(0, 0)] * out.ndim
            pad[axis] = (r + 1, r)
            p = np.pad(out, pad, mode='edge')
            c = np.cumsum(p, axis=axis, dtype=np.float64)
            hi = np.take(c, range(2 * r + 1, c.shape[axis]), axis=axis)
            lo = np.take(c, range(0, c.shape[axis] - 2 * r - 1), axis=axis)
            out = ((hi - lo) / (2 * r + 1)).astype(np.float32)
    return out


def polygon_mask(shape, polys, feather=0.0):
    img = Image.new('L', (shape[1], shape[0]), 0)
    d = ImageDraw.Draw(img)
    for p in polys:
        d.polygon(p, fill=255)
    m = np.asarray(img, np.float32) / 255
    return blur(m, feather) if feather else m


def rect_mask(shape, rects, feather=0.0):
    return polygon_mask(shape, [[(l, t), (r, t), (r, b), (l, b)] for l, t, r, b in rects], feather)


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def lum(c):
    return c[..., 0] * .2126 + c[..., 1] * .7152 + c[..., 2] * .0722


def fill_masked(img, hole, sigmas=(2, 4, 8, 16, 32)):
    """Fill hole (1 = unknown) from surroundings by normalized convolution."""
    known = 1 - hole
    expand = (lambda a: a[..., None]) if img.ndim == 3 else (lambda a: a)
    # Coarse to fine: a very wide pass guarantees coverage, each finer estimate
    # replaces it only where enough known pixels lie within its radius.
    s = max(sigmas) * 3
    fill = blur(img * expand(known), s) / expand(np.maximum(blur(known, s), 1e-6))
    for s in sorted(sigmas, reverse=True):
        w = blur(known, s)
        est = blur(img * expand(known), s) / expand(np.maximum(w, 1e-6))
        c = expand(np.clip(w * 4, 0, 1))
        fill = fill * (1 - c) + est * c
    h = expand(hole)
    return img * (1 - h) + fill * h


def max_filter(a, r):
    out = a.copy()
    for axis in (0, 1):
        src = out.copy()
        for k in range(1, r + 1):
            out = np.maximum(out, np.roll(src, k, axis))
            out = np.maximum(out, np.roll(src, -k, axis))
    return out


def closing(L, region, r):
    """Grey closing restricted to region: fills dark features narrower than 2r."""
    inside = region > .5
    up = max_filter(np.where(inside, L, 0), r)
    return -max_filter(np.where(inside, -up, -10), r)


def smooth_fit(logL, region, degree=4, iterations=8):
    """Robust polynomial surface of log brightness; dark outliers (shadows) are excluded."""
    h, w = logL.shape
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    x, y = x / w * 2 - 1, y / h * 2 - 1
    terms = [x ** i * y ** j for i in range(degree + 1) for j in range(degree + 1 - i)]
    A = np.stack([t[region] for t in terms], 1)
    b = logL[region]
    weight = np.ones_like(b)
    for _ in range(iterations):
        coef = np.linalg.lstsq(A * weight[:, None], b * weight, rcond=None)[0]
        residual = b - A @ coef
        weight = np.where(residual < -.025, 0., 1.).astype(np.float32)
    return sum(c * t for c, t in zip(coef, terms))


def running(a, r, op):
    """Running max/mean along axis 1 with window 2r+1 (edge clamped)."""
    p = np.pad(a, ((0, 0), (r, r)), mode='edge')
    if op == 'mean':
        c = np.cumsum(np.pad(p, ((0, 0), (1, 0))), axis=1)
        return (c[:, 2 * r + 1:] - c[:, :-2 * r - 1]) / (2 * r + 1)
    out = a.copy()
    for k in range(2 * r + 1):
        out = np.maximum(out, p[:, k:k + a.shape[1]])
    return out


def cornice_shadow_gain(full):
    """Gain that removes the lamp shadows on the cornice and the wall above the rod."""
    H, W = full.shape
    x0, x1 = 0, 1720
    xs = np.arange(x0, x1)
    top = 18 + .112 * xs                      # ceiling / cornice boundary
    rod = 94 + (xs - 450) * .1467             # top edge of the curtain rod
    vs = np.arange(-60, 72)
    ys = top[None, :] + vs[:, None]           # sheared strip: rows parallel to the cornice
    # Same integer rows for reading and writing back: no half-pixel offset at edges.
    yi = np.clip(np.round(ys).astype(int), 0, H - 1)
    strip = full[yi, xs[None, :]]
    # Mouldings: fine smoothing; striped wallpaper rows: average over the stripes.
    fine, coarse = running(strip, 1, 'mean'), running(strip, 20, 'mean')
    wall = smooth(36, 46, vs)[:, None].astype(np.float32)
    local = fine * (1 - wall) + coarse * wall
    # Lit level of each line: a smooth curve through its lit parts only
    # (light from the lamp grows toward the right end).
    t = (xs - x0) / (x1 - x0) * 2 - 1
    basis = np.stack([t ** k for k in range(5)], 1)
    env = np.empty_like(local)
    for row in range(local.shape[0]):
        y_row = np.log(np.maximum(local[row], 1e-4))
        keep = np.ones_like(y_row, bool)
        for _ in range(8):
            coef = np.linalg.lstsq(basis[keep], y_row[keep], rcond=None)[0]
            fit = basis @ coef
            keep = (y_row - fit) > -.035
        env[row] = np.exp(fit)
    # Lines shadowed along almost the whole rod (lower cornice fascia, wall)
    # have too little lit length for their own fit. They follow the falloff of
    # a lit reference line on the ceiling, scaled where both are lit (past the
    # rod end). Left of x = 760 the reference itself lies in the curtain's shadow.
    ref = running(local[np.searchsorted(vs, -26)][None, :], 12, 'mean')[0]
    lit = (xs > 1475) & (xs < 1700)
    scale = np.median(local[:, lit] / ref[None, lit], axis=1)
    env_ref = ref[None, :] * scale[:, None] * smooth(700, 820, xs)[None, :]
    env_ref *= (vs > -14)[:, None]  # ceiling lines are lit along their length: own fit only
    env = np.maximum(np.maximum(blur(env, 2), env_ref), local)
    g = np.clip(env / np.maximum(local, 1e-4), 1, 3)
    g = 1 + (g - 1) * smooth(1.015, 1.05, g)  # keep the soft penumbra too
    # Only above the rod (never the rod itself), fading out at the strip ends.
    below_rod = smooth(-1, -5, ys - rod[None, :])
    g = 1 + (g - 1) * below_rod * smooth(1530, 1485, xs)[None, :]  # shadows end with the rod
    # On the ceiling the only cast shadow is the curtain's wedge on the left.
    g = 1 + (g - 1) * np.where((vs < -14)[:, None], smooth(950, 820, xs)[None, :], 1.)
    g = 1 + blur(g - 1, 1.0)
    gain = np.ones((H, W), np.float32)
    for k, v in enumerate(vs):
        yy = np.round(ys[k]).astype(int)
        ok = (yy >= 0) & (yy < H)
        gain[yy[ok], xs[ok]] = np.maximum(gain[yy[ok], xs[ok]], g[k, ok])
    return 1 + blur(gain - 1, 1.0)


def lamp_shadow_gain(plate):
    """Gain removing the lamp's cast shadows on the ceiling and cornice (full resolution)."""
    h, w = plate.shape[0] // 2, plate.shape[1] // 2
    small = np.asarray(Image.fromarray(np.clip(plate * 255 + .5, 0, 255).astype(np.uint8)).resize((w, h), Image.BOX), np.float32) / 255
    L = blur(lum(small ** 2.2), 2)  # film grain must not count as shadow
    logL = np.log(np.maximum(L, 1e-4))
    ceiling = polygon_mask((h, w), [[(x / 2, y / 2) for x, y in CEILING]])
    fit = smooth_fit(logL, ceiling > .5, degree=3)
    # Elsewhere the ceiling only darkens with distance; the cast shadow of the
    # branches lies right of x = 1650.
    right = smooth(1550 / 2, 1700 / 2, np.arange(w, dtype=np.float32))[None, :]
    g = np.exp(np.clip(fit - logL, 0, 1.1))
    g = 1 + (g - 1) * smooth(1.02, 1.07, g)
    gain = 1 + blur((g - 1) * right * polygon_mask((h, w), [[(x / 2, y / 2) for x, y in CEILING]], 2), 2)
    # Shadow of the curtain rod, its end and bracket on the cornice and the wall
    # strip above the rod. The cornice mouldings run straight, so each line
    # parallel to them is compared with its own lit part.
    lin = plate ** 2.2
    ratio = cornice_shadow_gain(blur(lum(lin), 1.2))
    # The shadow is lit by cooler fill light, the rest by the warm lamp:
    # measured chroma ratio lit / shadow in linear light, luminance-neutral.
    depth = np.clip((ratio - 1) / .6, 0, 1)[..., None]
    ratio = ratio[..., None] * (1 + (np.array([.92, 1.02, 1.04], np.float32) - 1) * depth)
    # The bracket's thin shadow on the striped wall: fill from the corrected surroundings.
    full = lum(lin)
    corrected = blur(full, 1.2) * lum(ratio)
    hole = polygon_mask(full.shape, [BRACKET], 1.5)
    filled = fill_masked(corrected, (hole > .02).astype(np.float32), sigmas=(2, 4, 8, 16))
    fixed = corrected * (1 - hole) + filled * hole
    stem = 1 + (np.clip(blur(fixed, 1.5) / np.maximum(blur(full, 1.5), 1e-4), 1, 3) - 1) * np.clip(hole * 1.5, 0, 1)
    ratio = np.maximum(ratio, stem[..., None])
    # Full resolution: the rod end and bracket shadows have sharp edges.
    gain = np.asarray(Image.fromarray(gain.astype(np.float32), 'F').resize((plate.shape[1], plate.shape[0]), Image.BILINEAR), np.float32)
    return np.maximum(gain[..., None], ratio)


def to_png(arr):
    b = io.BytesIO()
    Image.fromarray(np.clip(arr * 255 + .5, 0, 255).astype(np.uint8)).save(b, 'PNG', optimize=True)
    return b.getvalue()


def to_jpg(arr, quality):
    b = io.BytesIO()
    Image.fromarray(np.clip(arr * 255 + .5, 0, 255).astype(np.uint8)).save(
        b, 'JPEG', quality=quality, subsampling=0, optimize=True)
    return b.getvalue()


def dial_plane(x, y):
    """Image -> dial plane coordinates (inverse of the dial homography)."""
    a, b, cx, cy = DIAL['a'], DIAL['b'], DIAL['cx'], DIAL['cy']
    # Solve x (a u + 1) = a u VPx + cx and y (a u + 1) = a u VPy + b v + cy.
    u = (x - cx) / (a * (VP[0] - x))
    w = a * u + 1
    v = (y * w - a * u * VP[1] - cy) / b
    return u, v


def redraw_dial(plate):
    """Erase the painted (crooked) hour marks and hands, draw marks in the dial's perspective."""
    box = (slice(250, 375), slice(2085, 2190))
    sub = plate[box].copy()
    y, x = np.mgrid[box[0], box[1]].astype(np.float64)
    u, v = dial_plane(x, y)
    r = np.hypot(u, v)
    lin = sub ** 2.2
    # Face colour: smooth fit over the bright face pixels (marks and hands excluded).
    face = (r < .94) & (lum(lin) > np.percentile(lum(lin)[r < .94], 35))
    terms = [np.ones_like(u), u, v, u * u, u * v, v * v]
    A = np.stack([t[face] for t in terms], 1)
    fit = np.stack([sum(c * t for c, t in zip(np.linalg.lstsq(A, lin[..., ch][face], rcond=None)[0], terms))
                    for ch in range(3)], -1).astype(np.float32)
    rng = np.random.default_rng(7)
    grain = rng.normal(0, 1, sub.shape[:2]).astype(np.float32)
    grain = (grain - blur(grain, 1.2))[..., None] * .02
    hole = smooth(.965, .925, r).astype(np.float32)[..., None]
    out = lin * (1 - hole) + np.maximum(fit, 0) * hole
    # Marks: slim ovals between r = .70 and .87, colour of the painted ones.
    mark_color = np.array([.035, .040, .055], np.float32)
    cover = np.zeros(sub.shape[:2], np.float32)
    offsets = [(i + .5) / 4 - .5 for i in range(4)]
    for oy in offsets:
        for ox in offsets:
            uu, vv = dial_plane(x + ox, y + oy)
            for k in range(12):
                t = np.radians(k * 30)
                du, dv = np.sin(t), -np.cos(t)
                along = uu * du + vv * dv - .785
                across = -uu * dv + vv * du
                half_w = .036 if k % 3 else .046
                cover += ((along / .085) ** 2 + (across / half_w) ** 2 <= 1) / 16
    cover = np.clip(cover, 0, 1)[..., None]
    out = out * (1 - cover * .85) + mark_color * cover * .85 * (lum(fit)[..., None] / .55)
    out = out ** (1 / 2.2) + grain * hole
    plate[box] = np.clip(out, 0, 1)
    return plate


def homography(src, dst):
    A = []
    for (x, y), (u, v) in zip(src, dst):
        A.append([-x, -y, -1, 0, 0, 0, u * x, u * y, u])
        A.append([0, 0, 0, -x, -y, -1, v * x, v * y, v])
    H = np.linalg.svd(np.array(A, float))[2][-1].reshape(3, 3)
    return H / H[2, 2]


CAL_INV = homography(CAL_QUAD, [(0, 0), (1, 0), (1, 1), (0, 1)])


def erase_calendar(plate):
    """Paper in place of the printed year and month grid (both artworks)."""
    box = (slice(570, 735), slice(1505, 1710))
    sub = plate[box].copy()
    y, x = np.mgrid[box[0], box[1]].astype(np.float64)
    w = CAL_INV[2, 0] * x + CAL_INV[2, 1] * y + CAL_INV[2, 2]
    u = (CAL_INV[0, 0] * x + CAL_INV[0, 1] * y + CAL_INV[0, 2]) / w
    v = (CAL_INV[1, 0] * x + CAL_INV[1, 1] * y + CAL_INV[1, 2]) / w
    u0, v0, u1, v1 = CAL_ERASE
    inside = (u > u0) & (u < u1) & (v > v0) & (v < v1)
    lin = sub ** 2.2
    L = lum(lin)
    paper = inside & (L > np.percentile(L[inside], 45))
    terms = [np.ones_like(u), u, v, u * u, u * v, v * v]
    A = np.stack([t[paper] for t in terms], 1)
    fit = np.stack([sum(c * t for c, t in zip(np.linalg.lstsq(A, lin[..., ch][paper], rcond=None)[0], terms))
                    for ch in range(3)], -1).astype(np.float32)
    green = smooth(.0, .05, sub[..., 1] - sub[..., 0])  # the fir branch in front stays
    edge = np.minimum.reduce([(u - u0) / .01, (u1 - u) / .01, (v - v0) / .006, (v1 - v) / .006])
    hole = (np.clip(edge, 0, 1) * (1 - green)).astype(np.float32)[..., None]
    rng = np.random.default_rng(11)
    grain = rng.normal(0, 1, sub.shape[:2]).astype(np.float32)
    grain = (grain - blur(grain, 1.2))[..., None] * .018
    out = (lin * (1 - hole) + np.maximum(fit, 0) * hole) ** (1 / 2.2) + grain * hole
    plate[box] = np.clip(out, 0, 1)
    return plate


def glyph_atlas():
    """Coverage atlas, 1024 x 512 (layout below in 512 x 256 units, rendered at 2x so
    that Qt never packs it into its shared texture atlas). Large: digits and
    weekday letters (24 x 32 cells), month names (256 x 32). Small, prefiltered for
    the tiny grid print: the same glyphs at 6 x 8 (row y = 224) and month names at
    64 x 8 (rows y = 232, 240)."""
    path = next((f for f in FONT_CANDIDATES if f and Path(f).exists()), None)
    if not path:
        raise SystemExit('Roboto-Medium.ttf not found: set NY_FONT to a TTF with Cyrillic.')
    k = 2
    img = Image.new('L', (512 * k, 256 * k), 0)
    d = ImageDraw.Draw(img)
    small = ImageFont.truetype(path, 30 * k)
    for i, ch in enumerate('0123456789' + WEEKDAYS):
        d.text(((i * 24 + 12) * k, 16 * k), ch, fill=255, font=small, anchor='mm')
    names = ImageFont.truetype(path, 26 * k)
    for i, name in enumerate(MONTHS):
        d.text((((i % 2) * 256 + 128) * k, (32 + (i // 2) * 32 + 16) * k), name, fill=255, font=names, anchor='mm')
    big = img.copy()
    bold = lambda c: min(255, int(c * 1.35))
    for i in range(17):  # digits and weekday letters, 4x smaller, slightly emboldened
        cell = big.crop((i * 24 * k, 0, (i * 24 + 24) * k, 32 * k)).resize((6 * k, 8 * k), Image.BOX)
        img.paste(cell.point(bold), (i * 6 * k, 224 * k))
    for i in range(12):
        x, y = (i % 2) * 256, 32 + (i // 2) * 32
        strip = big.crop((x * k, y * k, (x + 256) * k, (y + 32) * k)).resize((64 * k, 8 * k), Image.BOX)
        img.paste(strip.point(bold), ((i % 8) * 64 * k, (232 + (i // 8) * 8) * k))
    return np.asarray(img, np.float32) / 255


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    src = np.asarray(Image.open(SOURCE).convert('RGB'), np.float32) / 255
    H, W, _ = src.shape
    assert (W, H) == (2752, 1536), (W, H)
    plate = erase_calendar(redraw_dial(src.copy()))
    L = lum(src)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)

    # ---- window glass and what is in front of it (sill objects, frames) ----
    panes = rect_mask(src.shape[:2], PANES)
    warmth = src[..., 0] - src[..., 2]
    # Outdoor light is blue; indoor objects on the sill are lit warm. Exclude
    # them below the sill line; above it warm pixels are outdoor lamps.
    indoor = smooth(-.02, .05, warmth) * smooth(735, 760, yy)
    greenish = smooth(.0, .06, src[..., 1] - src[..., 2]) * smooth(735, 760, yy)
    indoor = np.maximum(indoor, greenish)
    indoor = np.clip(blur(np.clip(blur(indoor, 1.5) * 3, 0, 1), 1.0), 0, 1)
    glass = np.clip(blur(panes, .8) * (1 - indoor), 0, 1)

    # ---- outdoor lamps and lit house windows (warm, bright, above the sill) ----
    lights = smooth(.06, .20, warmth) * smooth(.30, .55, L) * smooth(770, 740, yy) * panes
    lights_soft = np.clip(blur(lights, 3) * 2.2, 0, 1)
    # The outer sash and the frame edges seen through the glass are wood lit
    # warm by the room; everything outdoors is cold. Snow must stay behind them.
    sash = smooth(-.07, 0., warmth) * (1 - np.clip(blur(lights_soft, 6) * 3, 0, 1))
    glass = np.clip(glass * (1 - blur(sash, .8)), 0, 1)

    # ---- sky (above the horizon in the outdoor view) and frost on the glass ----
    horizon = np.full((H, W), 600, np.float32)
    horizon[:, :900] = 560  # house roof on the left
    horizon[:, 1080:] = 612  # right pane, roof of the far house
    # Roof line steps are blended horizontally so no vertical seam shows by day.
    horizon = blur(horizon, 22)
    sky = smooth(horizon + 30, horizon - 30, yy) * glass
    # Frost: lighter than the surrounding night sky, neutral, high frequency.
    base_sky = blur(L * (sky > .5) + .0, 18) / np.maximum(blur((sky > .5).astype(np.float32), 18), 1e-3)
    frost = smooth(.04, .30, L - base_sky) * sky
    # Right panes are fogged; the frost border hugs every pane edge.
    edge = np.zeros((H, W), np.float32)
    for l, t, r, b in PANES:
        d = np.minimum.reduce([xx - l, r - xx, yy - t, b - yy])
        edge = np.maximum(edge, smooth(26, 2, d) * ((xx >= l) & (xx <= r) & (yy >= t) & (yy <= b)))
    frost = np.clip(np.maximum(frost, edge * smooth(.25, .55, L) * .8), 0, 1) * glass
    frost = blur(frost, 1.0)

    # ---- tree bulbs: small bright cores inside the tree silhouette ----
    tree = polygon_mask(src.shape[:2], [TREE], 4)
    V = src.max(axis=2)
    local = V - blur(V, 5)
    sat = (V - src.min(axis=2)) / np.maximum(V, 1e-3)
    cores = smooth(.12, .30, local) * smooth(.55, .85, V) * smooth(.15, .45, sat + smooth(.9, 1, V))
    bulbs = np.clip(np.maximum(cores, blur(cores, 3) * 2.5) + blur(cores, 9) * 1.2, 0, 1) * tree

    # ---- star on top: translucent red glass lit from inside ----
    star_box = polygon_mask(src.shape[:2], [STAR], 2)
    redness = smooth(.10, .30, src[..., 0] - np.maximum(src[..., 1], src[..., 2])) * smooth(.18, .40, src[..., 0])
    star = np.clip(blur(redness * star_box, .8) * 1.3, 0, 1) * star_box

    # ---- tinsel glitter: small neutral highlights that are not bulbs ----
    glints = smooth(.06, .20, V - blur(V, 2.5)) * smooth(.45, .75, V) * smooth(.45, .20, sat)
    tinsel = np.clip(glints * (1 - np.clip(cores * 4, 0, 1)), 0, 1) * tree

    # ---- garland and star emission, spread as glow (bloom) and light spill ----
    emission = src * np.clip(cores * 1.6, 0, 1)[..., None] + src * star[..., None] * .8
    emission = (np.clip(emission, 0, 1) ** 1.3) * (1 - panes)[..., None]  # outdoor lamps switch off by day
    glow = blur(emission, 5) * .9 + blur(emission, 16) * 1.8 + blur(emission, 48) * 2.8
    glow = glow / np.percentile(glow.max(axis=2)[tree > .5], 99.7)
    glow = np.clip(glow, 0, 1)

    # ---- candle flames on the sill ----
    flames = np.zeros((H, W), np.float32)
    for cx, cy, rx, ry in FLAMES:
        flames = np.maximum(flames, smooth(1.0, .55, np.hypot((xx - cx) / rx, (yy - cy) / ry)))
    flames = blur(flames, .8)

    # ---- lights-off plate: garland, star and candles unlit ----
    # Baked colour spill of the bulbs is divided out, the bulbs and their
    # halos are filled from the surrounding needles and redrawn as dim glass.
    lin = plate ** 2.2
    hole = np.clip(blur(cores, 4.5) * 7, 0, 1) * tree
    hole = np.maximum(hole, np.clip(blur(flames, 3) * 3, 0, 1))
    filled = fill_masked(lin, (hole > .04).astype(np.float32), sigmas=(1.5, 3, 6, 12))
    off = lin * (1 - hole[..., None]) + filled * hole[..., None]
    spill = glow * tree[..., None]
    off = off / (1 + 3.2 * spill + 4. * spill * spill)
    hue = src / np.maximum(src.max(axis=2, keepdims=True), 1e-3)
    glass_bulb = (hue ** 2.2) * .035
    core_sharp = np.clip(cores * 1.4, 0, 1)[..., None] * tree[..., None]
    off = off * (1 - core_sharp * .9) + glass_bulb * core_sharp * .9
    off = off * (1 - star[..., None] * .45)
    # The candles lose the warm light of their own flames.
    candle_light = blur(flames, 6) * 1.5 + blur(flames, 18) * 2.5
    off = off / (1 + 1.2 * np.clip(candle_light, 0, 1))[..., None]
    off = np.clip(off, 0, 1) ** (1 / 2.2)

    # ---- lamp shade (emissive) ----
    shade = polygon_mask(src.shape[:2], [LAMP], 1.0) * smooth(.45, .65, L)

    # ---- lamp shadows on the ceiling: removed while the lamp is off ----
    shadow_gain = lamp_shadow_gain(plate)
    Image.fromarray(np.clip((lum(shadow_gain) - 1) * 255, 0, 255).astype(np.uint8)).resize((shadow_gain.shape[1] // 2, shadow_gain.shape[0] // 2)).save(CACHE / 'shadow.png')

    # ---- sheer curtains: daylight transmission ----
    tulle = polygon_mask(src.shape[:2], TULLE, 6)

    masks = np.stack([bulbs, shade, glass], -1)
    # masks2 holds two disjoint regions: inside the window glass sky, outdoor
    # lamps and frost; on the tree (no overlap with the glass) star and tinsel.
    outside_glass = 1 - panes
    # Candle flames sit in front of the glass where the glass mask is zero.
    masks2 = np.stack([np.maximum(sky, star * outside_glass), np.maximum(lights_soft, tinsel * outside_glass),
                       np.maximum(frost, flames * (1 - glass))], -1)

    # ---- daytime plate (artwork/day.jpg, aligned with the evening artwork) ----
    # Garland, lamp and candles are already off there. Same redrawn dial;
    # the outdoor lamps still glowing in the view are switched off.
    day = erase_calendar(redraw_dial(np.asarray(Image.open(DAY_SOURCE).convert('RGB'), np.float32) / 255))
    d_hole = np.clip(blur(lights_soft, 4) * 3, 0, 1) * panes
    d_lin = day ** 2.2
    d_fill = fill_masked(d_lin, (d_hole > .04).astype(np.float32), sigmas=(1.5, 3, 6, 12))
    day = np.clip(d_lin * (1 - d_hole[..., None]) + d_fill * d_hole[..., None], 0, 1) ** (1 / 2.2)

    # ---- debug overlays ----
    dbg = src * .45
    dbg[..., 0] += masks[..., 0] * .55
    dbg[..., 1] += masks[..., 1] * .55
    dbg[..., 2] += masks[..., 2] * .55
    Image.fromarray(np.clip(dbg * 255, 0, 255).astype(np.uint8)).save(CACHE / 'debug-masks.jpg', quality=88)
    dbg2 = src * .45 + masks2 * .55
    Image.fromarray(np.clip(dbg2 * 255, 0, 255).astype(np.uint8)).save(CACHE / 'debug-masks2.jpg', quality=88)
    Image.fromarray(np.clip(day * 255, 0, 255).astype(np.uint8)).save(CACHE / 'day.jpg', quality=90)
    Image.fromarray(np.clip(glow * 255, 0, 255).astype(np.uint8)).save(CACHE / 'glow.png')
    tdbg = src * .35
    tdbg[..., 0] += star * .65
    tdbg[..., 1] += tinsel * .65
    Image.fromarray(np.clip(tdbg[80:1300, 0:900] * 255, 0, 255).astype(np.uint8)).save(CACHE / 'debug-tree.jpg', quality=90)
    pc = plate[250:370, 2080:2200]
    Image.fromarray(np.clip(pc * 255, 0, 255).astype(np.uint8)).resize((480, 480), Image.LANCZOS).save(CACHE / 'clock.png')

    assets = {
        'plate': 'data:image/jpeg;base64,' + base64.b64encode(to_jpg(plate, 94)).decode(),
        'masks': 'data:image/png;base64,' + base64.b64encode(to_png(masks)).decode(),
        'masks2': 'data:image/png;base64,' + base64.b64encode(to_png(masks2)).decode(),
        'day': 'data:image/jpeg;base64,' + base64.b64encode(to_jpg(day, 93)).decode(),
        # RGB = (gain - 1) / 2 per channel of the lamp shadows.
        'glyphs': 'data:image/png;base64,' + base64.b64encode(to_png(np.repeat(glyph_atlas()[..., None], 3, -1))).decode(),
        'shade': 'data:image/png;base64,' + base64.b64encode(to_png((shadow_gain - 1) / 2)).decode(),
        'off': 'data:image/jpeg;base64,' + base64.b64encode(to_jpg(off[OFF_BOX[1]:OFF_BOX[3], OFF_BOX[0]:OFF_BOX[2]], 93)).decode(),
        # Half resolution, square-root encoded for precision in the dark falloff.
        'glow': 'data:image/png;base64,' + base64.b64encode(to_png(np.sqrt(np.asarray(Image.fromarray(
            np.clip(glow * 255 + .5, 0, 255).astype(np.uint8)).resize((W // 2, H // 2), Image.BOX), np.float32) / 255))).decode(),
    }
    Image.fromarray(np.clip(off[OFF_BOX[1]:OFF_BOX[3], OFF_BOX[0]:OFF_BOX[2]] * 255, 0, 255).astype(np.uint8)).save(CACHE / 'off.png')
    geometry = dict(size=[W, H], offBox=OFF_BOX, clock=CLOCK, tv=TV, panes=PANES)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, 'w', encoding='utf8', newline='\n') as f:
        f.write('// Generated by build/assets.py from artwork/evening.jpg and artwork/day.jpg. Do not edit.\n')
        f.write('window.NY_GEOMETRY=' + json.dumps(geometry) + ';\n')
        f.write('window.NY_ASSETS=' + json.dumps(assets) + ';\n')
    for name, data in assets.items():
        print(f'{name}: {len(data) * 3 // 4 // 1024} KiB')


if __name__ == '__main__':
    sys.exit(main())
