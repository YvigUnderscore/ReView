# SPDX-FileCopyrightText: 2026 Yvig Bidon
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Génère les visuels de l'application desktop à partir du logo de ReView.

Le dépôt n'a pas de logo vectoriel : la marque « V » n'existe qu'en PNG 512 px
(`frontend/public/logo.png`). Ce script en extrait le contour (marching squares sur la
couverture d'anticrénelage, donc au sous-pixel), l'écrit en SVG, puis rend à partir de ce
tracé — et non du PNG agrandi — l'icône source 1024 px et les bandeaux des installeurs.

    python -I desktop/scripts/make_brand_assets.py

Sorties (dans desktop/) :
  assets/logo-mark.svg          marque vectorielle, blanche, viewBox du PNG d'origine
  assets/icon-source.png        1024 px, source de `tauri icon`
  src-tauri/installer/*.bmp     bandeaux NSIS et WiX (BMP 24 bits, sans alpha)
  launcher/brand/logo-mark.svg  copie servie par le lanceur
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
DESKTOP = ROOT / "desktop"
SOURCE = ROOT / "frontend/public/logo.png"
WORDMARK = ROOT / "frontend/public/logo_banner.png"

BG = (11, 14, 20)  # --background sombre : 220 29% 6%
BG_TOP = (21, 26, 38)
EDGE = (34, 42, 58)
WHITE = (255, 255, 255)


def coverage(path: Path) -> np.ndarray:
    """Couverture de la marque, 0 (fond) → 1 (blanc), pixel par pixel."""
    rgb = np.asarray(Image.open(path).convert("RGB"), dtype=np.float64)
    lum = rgb.mean(axis=2)
    bg = np.median(lum[:8, :8])
    return np.clip((lum - bg) / (255.0 - bg), 0.0, 1.0)


def marching_squares(field: np.ndarray, level: float = 0.5) -> list[list[tuple[float, float]]]:
    """Contours fermés de `field` à `level`, interpolés linéairement sur les arêtes."""
    h, w = field.shape
    padded = np.zeros((h + 2, w + 2))
    padded[1:-1, 1:-1] = field

    def interp(p, q):
        # Arête orientée toujours dans le même sens : deux cellules voisines calculent
        # alors le même point au bit près, et les segments se raccordent.
        (y0, x0), (y1, x1) = sorted((p, q))
        v0, v1 = padded[y0, x0], padded[y1, x1]
        t = 0.5 if v1 == v0 else (level - v0) / (v1 - v0)
        # -1 : on revient dans le repère de l'image non bordée ; +0.5 : centre du pixel.
        return (x0 + t * (x1 - x0) - 0.5, y0 + t * (y1 - y0) - 0.5)

    segments: dict[tuple, list[tuple]] = {}
    for y in range(h + 1):
        for x in range(w + 1):
            corners = [(y, x), (y, x + 1), (y + 1, x + 1), (y + 1, x)]
            idx = sum(1 << i for i, c in enumerate(corners) if padded[c] >= level)
            if idx in (0, 15):
                continue
            edges = [(corners[i], corners[(i + 1) % 4]) for i in range(4)]
            crossing = [e for e in edges if (padded[e[0]] >= level) != (padded[e[1]] >= level)]
            pts = [interp(*e) for e in crossing]
            # Cas selle (2 diagonales) : on tranche par la moyenne, sans incidence ici.
            for i in range(0, len(pts) - 1, 2):
                a, b = pts[i], pts[i + 1]
                segments.setdefault(a, []).append(b)
                segments.setdefault(b, []).append(a)

    contours, seen = [], set()
    for start in list(segments):
        if start in seen:
            continue
        loop, prev, cur = [start], None, start
        seen.add(start)
        while True:
            nxt = next((p for p in segments[cur] if p != prev and p not in seen), None)
            if nxt is None:
                break
            loop.append(nxt)
            seen.add(nxt)
            prev, cur = cur, nxt
        if len(loop) > 8:
            contours.append(loop)
    return contours


def simplify(points: list[tuple[float, float]], eps: float) -> list[tuple[float, float]]:
    """Ramer-Douglas-Peucker sur un polygone fermé."""

    def rdp(pts):
        if len(pts) < 3:
            return pts
        (ax, ay), (bx, by) = pts[0], pts[-1]
        abx, aby = bx - ax, by - ay
        norm = np.hypot(abx, aby) or 1.0
        # Distance au segment : |AB × AP| / |AB| (produit vectoriel 2D écrit à la main).
        d = [abs(abx * (py - ay) - aby * (px - ax)) / norm for px, py in pts[1:-1]]
        i = int(np.argmax(d)) + 1
        if d[i - 1] > eps:
            return rdp(pts[: i + 1])[:-1] + rdp(pts[i:])
        return [pts[0], pts[-1]]

    far = max(range(len(points)), key=lambda i: np.hypot(points[i][0] - points[0][0], points[i][1] - points[0][1]))
    return rdp(points[: far + 1])[:-1] + rdp(points[far:] + [points[0]])[:-1]


def mark_polygons() -> list[list[tuple[float, float]]]:
    field = coverage(SOURCE)
    return [simplify(c, 0.35) for c in marching_squares(field)]


def svg_path(polys, scale=1.0, dx=0.0, dy=0.0) -> str:
    out = []
    for poly in polys:
        pts = [f"{x * scale + dx:.2f} {y * scale + dy:.2f}" for x, y in poly]
        out.append("M" + " L".join(pts) + "Z")
    return " ".join(out)


def draw_mark(img: Image.Image, polys, box, fill, supersample=4):
    """Dessine la marque dans `box` (x0, y0, x1, y1) en gardant ses proportions."""
    xs = [x for p in polys for x, _ in p]
    ys = [y for p in polys for _, y in p]
    mx0, my0, mx1, my1 = min(xs), min(ys), max(xs), max(ys)
    bx0, by0, bx1, by1 = box
    s = min((bx1 - bx0) / (mx1 - mx0), (by1 - by0) / (my1 - my0))
    ox = bx0 + ((bx1 - bx0) - (mx1 - mx0) * s) / 2 - mx0 * s
    oy = by0 + ((by1 - by0) - (my1 - my0) * s) / 2 - my0 * s
    w, h = img.size
    mask = Image.new("L", (w * supersample, h * supersample), 0)
    d = ImageDraw.Draw(mask)
    for poly in polys:
        d.polygon([((x * s + ox) * supersample, (y * s + oy) * supersample) for x, y in poly], fill=255)
    mask = mask.resize((w, h), Image.LANCZOS)
    img.paste(Image.new(img.mode, (w, h), fill), (0, 0), mask)


def gradient(size, top, bottom) -> Image.Image:
    w, h = size
    t = np.linspace(0, 1, h)[:, None, None]
    arr = (np.array(top) * (1 - t) + np.array(bottom) * t).repeat(w, axis=1)
    return Image.fromarray(arr.astype(np.uint8))


def app_icon(polys) -> Image.Image:
    """Carré arrondi sombre, marque blanche. Marge de 64 px sur 1024 : lisible en barre des
    tâches Windows, proche de la grille macOS sans la reproduire."""
    n, ss = 1024, 4
    big = n * ss
    inset, radius = 64 * ss, 200 * ss
    shape = Image.new("L", (big, big), 0)
    ImageDraw.Draw(shape).rounded_rectangle((inset, inset, big - inset, big - inset), radius, fill=255)
    rim = Image.new("L", (big, big), 0)
    ImageDraw.Draw(rim).rounded_rectangle(
        (inset, inset, big - inset, big - inset), radius, outline=255, width=6 * ss
    )
    shape, rim = shape.resize((n, n), Image.LANCZOS), rim.resize((n, n), Image.LANCZOS)
    icon = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    fill = gradient((n, n), BG_TOP, BG).convert("RGBA")
    icon.paste(fill, (0, 0), shape)
    icon.paste(Image.new("RGBA", (n, n), EDGE + (255,)), (0, 0), rim)
    draw_mark(icon, polys, (300, 270, 724, 754), WHITE + (255,))
    return icon


def wordmark(height: int, color) -> Image.Image:
    """Logotype « ReView » recoloré, depuis le masque alpha du bandeau de l'app web."""
    src = Image.open(WORDMARK).convert("RGBA")
    alpha = src.getchannel("A").crop(src.getchannel("A").getbbox())
    w = round(alpha.width * height / alpha.height)
    alpha = alpha.resize((w, height), Image.LANCZOS)
    out = Image.new("RGBA", alpha.size, color + (0,))
    out.putalpha(alpha)
    return out


def bmp(img: Image.Image, path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    img.convert("RGB").save(path, format="BMP")


def installer_images(polys):
    out = DESKTOP / "src-tauri/installer"
    # NSIS — bandeau des pages intérieures (150×57, fond blanc de l'assistant).
    header = Image.new("RGB", (150, 57), WHITE)
    wm = wordmark(26, BG)
    header.paste(wm, ((150 - wm.width) // 2, (57 - wm.height) // 2), wm)
    bmp(header, out / "nsis-header.bmp")
    # NSIS — panneau latéral des pages d'accueil et de fin (164×314).
    side = gradient((164, 314), BG_TOP, BG)
    draw_mark(side, polys, (42, 70, 122, 160), WHITE)
    wm = wordmark(30, WHITE)
    side.paste(wm, ((164 - wm.width) // 2, 186), wm)
    bmp(side, out / "nsis-sidebar.bmp")
    # WiX — bandeau (493×58) : WiX écrit ses titres à gauche, la marque se tient à droite.
    banner = Image.new("RGB", (493, 58), WHITE)
    draw_mark(banner, polys, (440, 10, 478, 48), BG)
    bmp(banner, out / "wix-banner.bmp")
    # WiX — fond des pages d'accueil et de fin (493×312) : 164 px sombres à gauche.
    dialog = Image.new("RGB", (493, 312), WHITE)
    dialog.paste(gradient((164, 312), BG_TOP, BG), (0, 0))
    draw_mark(dialog, polys, (42, 70, 122, 160), WHITE)
    wm = wordmark(30, WHITE)
    dialog.paste(wm, ((164 - wm.width) // 2, 186), wm)
    bmp(dialog, out / "wix-dialog.bmp")


def main() -> int:
    polys = mark_polygons()
    if len(polys) != 2:
        print(f"attendu : 2 contours (les deux jambages du V), trouvé : {len(polys)}", file=sys.stderr)
        return 1
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="#fff">'
        f'<path d="{svg_path(polys)}"/></svg>\n'
    )
    for target in (DESKTOP / "assets/logo-mark.svg", DESKTOP / "launcher/brand/logo-mark.svg"):
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(svg, encoding="utf-8", newline="\n")
    app_icon(polys).save(DESKTOP / "assets/icon-source.png")
    installer_images(polys)
    print(f"2 contours, {sum(len(p) for p in polys)} sommets — visuels écrits")
    return 0


if __name__ == "__main__":
    sys.exit(main())
