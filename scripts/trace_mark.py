# Traces brand/deka-mark.png into the Deka SVG marks.
#
# Finds the ten dots, measures each centre and radius to a fraction of a pixel,
# and writes:
#   brand/deka-mark.svg        black dots, the traced master
#   brand/deka-mark-ink.svg    near black ink on transparent, for use on ivory
#   brand/deka-icon.svg        app icon: ink ground, ivory dots, day 10 in chartreuse
#   brand/deka-mark-small.svg  favicon version: small dots enlarged so they survive 16 and 32 px
# It then renders the master back over the PNG and reports how closely they match.
#
# Needs Python 3 with numpy, scipy and pillow. Run from the repo root:
#   python3 scripts/trace_mark.py [overlay.png]

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage, optimize

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'brand' / 'deka-mark.png'
OUT = ROOT / 'brand'
INK, PAPER, GREEN = '#141310', '#F5F3EC', '#B8F06E'


def measure(path):
    img = np.asarray(Image.open(path).convert('L'), dtype=float)
    ink = 1 - img / 255.0  # 1 inside a dot, 0 on white, fractional on the anti aliased edge
    labels, n = ndimage.label(ink > 0.02)
    if n != 10:
        raise SystemExit(f'Expected 10 dots, found {n}')
    dots = []
    for i in range(1, n + 1):
        mask = labels == i
        ys, xs = np.nonzero(mask)
        w = ink[ys, xs]
        area = w.sum()
        cx, cy = (w * xs).sum() / area + .5, (w * ys).sum() / area + .5
        edge = mask & (ink > .2) & (ink < .8)
        ey, ex = np.nonzero(edge)
        fit = optimize.least_squares(lambda p: np.hypot(ex + .5 - p[0], ey + .5 - p[1]) - p[2], [cx, cy, np.sqrt(area / np.pi)]).x
        dots.append({'cx': fit[0], 'cy': fit[1], 'r': fit[2]})
    dots.sort(key=lambda d: d['r'])  # day 1 is the smallest, day 10 the largest
    return img.shape, dots


def bbox(dots):
    x0 = min(d['cx'] - d['r'] for d in dots); x1 = max(d['cx'] + d['r'] for d in dots)
    y0 = min(d['cy'] - d['r'] for d in dots); y1 = max(d['cy'] + d['r'] for d in dots)
    return x0, y0, x1, y1


def centred(dots, side):
    """Moves the dots so their bounding box sits in the middle of a square of this side."""
    x0, y0, x1, y1 = bbox(dots)
    dx, dy = side / 2 - (x0 + x1) / 2, side / 2 - (y0 + y1) / 2
    return [{'cx': d['cx'] + dx, 'cy': d['cy'] + dy, 'r': d['r']} for d in dots]


def circles(dots, fills):
    return '\n'.join(
        f'  <circle id="day{i}" cx="{d["cx"]:.2f}" cy="{d["cy"]:.2f}" r="{d["r"]:.2f}"{f" fill=\"{fills[i - 1]}\"" if fills[i - 1] else ""}/>'
        for i, d in enumerate(dots, 1))


def svg(side, body, title, fill=None):
    head = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {side:g} {side:g}" role="img" aria-label="{title}"'
    return f'{head}{f" fill=\"{fill}\"" if fill else ""}>\n  <title>{title}</title>\n{body}\n</svg>\n'


def small_variant(dots, side, out_px=32, min_d_px=2.6, min_gap_px=0.9):
    """Enlarges the small dots and opens the gaps so each dot reads at 32 px,
    staying as close as possible to the traced spiral and keeping every dot
    larger than the one before it."""
    unit = side / out_px
    rmin, gap = min_d_px * unit / 2, min_gap_px * unit
    r0 = np.array([d['r'] for d in dots])
    c0 = np.array([[d['cx'], d['cy']] for d in dots])
    x0 = np.concatenate([c0.ravel(), np.maximum(r0, rmin)])

    def unpack(x):
        return x[:20].reshape(10, 2), x[20:]

    def cost(x):
        c, r = unpack(x)
        return ((c - c0) ** 2).sum() / unit ** 2 + 4 * ((np.log(r) - np.log(np.maximum(r0, rmin))) ** 2).sum()

    cons = [{'type': 'ineq', 'fun': lambda x, i=i: unpack(x)[1][i] - rmin} for i in range(10)]
    cons += [{'type': 'ineq', 'fun': lambda x, i=i: unpack(x)[1][i + 1] - 1.08 * unpack(x)[1][i]} for i in range(9)]
    for i in range(10):
        for j in range(i + 1, 10):
            cons.append({'type': 'ineq', 'fun': lambda x, i=i, j=j: np.hypot(*(unpack(x)[0][i] - unpack(x)[0][j])) - unpack(x)[1][i] - unpack(x)[1][j] - gap})
    for i in range(10):
        cons.append({'type': 'ineq', 'fun': lambda x, i=i: unpack(x)[0][i][0] - unpack(x)[1][i]})
        cons.append({'type': 'ineq', 'fun': lambda x, i=i: side - unpack(x)[0][i][0] - unpack(x)[1][i]})
        cons.append({'type': 'ineq', 'fun': lambda x, i=i: unpack(x)[0][i][1] - unpack(x)[1][i]})
        cons.append({'type': 'ineq', 'fun': lambda x, i=i: side - unpack(x)[0][i][1] - unpack(x)[1][i]})
    res = optimize.minimize(cost, x0, constraints=cons, method='SLSQP', options={'maxiter': 500, 'ftol': 1e-9})
    if not res.success:
        raise SystemExit(f'Small variant did not converge: {res.message}')
    c, r = unpack(res.x)
    return centred([{'cx': c[i][0], 'cy': c[i][1], 'r': r[i]} for i in range(10)], side), unit


def raster(dots, h, w, ss=4):
    """Coverage of the dots on a w by h grid, supersampled."""
    yy, xx = np.mgrid[0:h * ss, 0:w * ss]
    xx = (xx + .5) / ss; yy = (yy + .5) / ss
    cov = np.zeros((h * ss, w * ss), dtype=bool)
    for d in dots:
        x0, x1 = int(max(0, (d['cx'] - d['r'] - 1) * ss)), int(min(w * ss, (d['cx'] + d['r'] + 1) * ss))
        y0, y1 = int(max(0, (d['cy'] - d['r'] - 1) * ss)), int(min(h * ss, (d['cy'] + d['r'] + 1) * ss))
        cov[y0:y1, x0:x1] |= (xx[y0:y1, x0:x1] - d['cx']) ** 2 + (yy[y0:y1, x0:x1] - d['cy']) ** 2 <= d['r'] ** 2
    return cov.reshape(h, ss, w, ss).mean(axis=(1, 3))


def main():
    (h, w), dots = measure(SRC)
    x0, y0, x1, y1 = bbox(dots)
    side = round(max(x1 - x0, y1 - y0))
    mark = centred(dots, side)

    OUT.joinpath('deka-mark.svg').write_text(svg(side, circles(mark, [None] * 10), 'Deka'))
    OUT.joinpath('deka-mark-ink.svg').write_text(svg(side, circles(mark, [None] * 10), 'Deka', fill=INK))

    icon_side = 1024
    scale = icon_side * 0.62 / side  # the mark fills 62 percent of the tile, clear of iOS rounded corners
    icon = [{'cx': (d['cx'] - side / 2) * scale + icon_side / 2, 'cy': (d['cy'] - side / 2) * scale + icon_side / 2, 'r': d['r'] * scale} for d in mark]
    body = f'  <rect width="{icon_side}" height="{icon_side}" fill="{INK}"/>\n' + circles(icon, [PAPER] * 9 + [GREEN])
    OUT.joinpath('deka-icon.svg').write_text(svg(icon_side, body, 'Deka'))

    small, unit = small_variant(mark, side)
    OUT.joinpath('deka-mark-small.svg').write_text(svg(side, circles(small, [None] * 10), 'Deka', fill=INK))

    # Overlay check: render the traced circles at the source size and compare with the PNG.
    src = 1 - np.asarray(Image.open(SRC).convert('L'), dtype=float) / 255
    ours = raster(dots, h, w)
    diff = np.abs(src - ours)
    inter, union = np.minimum(src, ours).sum(), np.maximum(src, ours).sum()
    report = {
        'dots': [{'day': i, 'cx': round(d['cx'], 2), 'cy': round(d['cy'], 2), 'r': round(d['r'], 2)} for i, d in enumerate(dots, 1)],
        'viewBox': side,
        'iou': round(float(inter / union), 5),
        'mean_abs_diff': round(float(diff.mean()), 5),
        'pixels_off_by_more_than_half': int((diff > .5).sum()),
        'small_min_diameter_px_at_32': round(min(d['r'] for d in small) * 2 / unit, 2),
        'small_min_gap_px_at_32': round(min(np.hypot(a['cx'] - b['cx'], a['cy'] - b['cy']) - a['r'] - b['r'] for i, a in enumerate(small) for b in small[i + 1:]) / unit, 2),
    }
    print(json.dumps(report, indent=1))
    if len(sys.argv) > 1:
        rgb = np.stack([255 * (1 - src)] * 3, axis=-1)
        edge = (ours > .2) & (ours < .8)
        rgb[edge] = [230, 40, 40]
        Image.fromarray(rgb.astype(np.uint8)).save(sys.argv[1])


if __name__ == '__main__':
    main()
