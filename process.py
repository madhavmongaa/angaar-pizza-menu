"""Cut the generated photos into transparent WebP pieces and embed them in the menu page.

Run from the angaar-pizza folder:   python -I process.py
Reads 03-images/ and src/index.html (the page without photos), writes 04-processed/ and the finished 05-site/index.html.
"""
import io, os, re, json, base64, glob
import numpy as np
from PIL import Image, ImageFilter, ImageDraw
from scipy import ndimage as ndi

HERE = os.path.dirname(os.path.abspath(__file__))
SRC, OUT, TPL, SITE = (os.path.join(HERE, d) for d in ('03-images', '04-processed', 'src/index.html', '05-site/index.html'))

# file name starts with -> what it is
PIZZAS = {'margherita': 'Whole_Margherita', 'farmhouse': 'Farmhouse', 'paneer-tikka': 'Paneer_tikka',
          'mexican-wave': 'Mexican_wave', 'pesto-garden': 'Pesto_garden', 'pepperoni-feast': 'Double_pepperoni',
          'chicken-fajita': 'Pizza_with_chicken', 'bbq-chicken': 'BBQ_chicken', 'nawab-special': 'Meat_supreme'}
SAUCE_GRID, CHEESE = 'Four_pizza_doughs', 'Pizza_covered'
SAUCES = [['tomato', 'pesto'], ['garlic', 'bbq']]
SHEETS = {
    'Arranged_vegetable': [['red-onion', 'white-onion', 'green-capsicum'], ['red-capsicum', 'yellow-capsicum', 'mushroom'],
                           ['black-olives', 'green-olives', 'sweet-corn']],
    'Food_ingredients': [['tomato', 'cherry-tomato', 'jalapeno'], ['paneer', 'tandoori-paneer', 'spinach'],
                         ['pineapple', 'basil', 'broccoli']],
    'Topings_arranged': [['pepperoni', 'chicken-tikka', 'grilled-chicken'], ['chicken-sausage', 'bacon', 'salami'],
                         ['mutton-keema', 'prawns', 'extra-cheese']],
    'Feta_cheese': [['feta', 'chili-flakes'], ['roasted-garlic', None]],
}
WHITE = {'red-onion', 'white-onion', 'paneer', 'feta', 'extra-cheese', 'mushroom'}      # pale pieces: also use difference from background
MERGE = {'chili-flakes': 14, 'mutton-keema': 5, 'extra-cheese': 5, 'feta': 3, 'broccoli': 3}   # px to join crumbs into one piece
PIECE_PX, PIZZA_PX, BASE_PX = 120, 640, 560


def find(prefix):
    hits = [f for f in glob.glob(os.path.join(SRC, '*')) if os.path.basename(f).startswith(prefix)]
    assert len(hits) == 1, (prefix, hits)
    return Image.open(hits[0]).convert('RGB')


def background(rgb):
    """Smooth estimate of the (nearly white, slightly graded) studio background brightness."""
    lum = rgb.mean(2) if rgb.ndim == 3 else rgb
    h, w = lum.shape
    small = np.array(Image.fromarray(lum.astype('float32')).resize((w // 8, h // 8), Image.BILINEAR))
    small = ndi.gaussian_filter(ndi.median_filter(small, size=31, mode='nearest'), 3)
    return np.array(Image.fromarray(small).resize((w, h), Image.BILINEAR))


def colour_mask(rgb, warm=False):
    """Foreground = colourful, dark or warm pixels. Neutral grey shadows are none of these."""
    r, g, b = (rgb[..., i].astype(int) for i in range(3))
    mn, mx = rgb.min(2).astype(int), rgb.max(2).astype(int)
    return (mx - mn > 34) | (mn < 110) | (warm & (r - b > 14))


def pad(a, shape):
    out = np.zeros(shape, a.dtype); out[:a.shape[0], :a.shape[1]] = a[:shape[0], :shape[1]]; return out


def with_alpha(im, m, blur=1.0):
    a = Image.fromarray((ndi.binary_erosion(m) * 255).astype('uint8')).filter(ImageFilter.GaussianBlur(blur))
    im = im.convert('RGBA'); im.putalpha(a); return im


def cut_round(im, size, box=None):
    """Whole pizza / base: biggest blob, holes filled, cropped to a square."""
    if box: im = im.crop(box)
    rgb = np.array(im)
    # colour only (pale shadows on the backdrop stay out), biggest blob, then clip to a disc:
    # the food is round, so anything outside the disc is a shadow flap
    m = ndi.binary_opening(ndi.binary_fill_holes(ndi.binary_closing(colour_mask(rgb, True), iterations=3)), iterations=6)
    lab, n = ndi.label(m)
    m = lab == 1 + np.argmax(ndi.sum(m, lab, range(1, n + 1)))
    cy, cx = ndi.center_of_mass(m); yy, xx = np.mgrid[:m.shape[0], :m.shape[1]]
    m &= np.hypot(xx - cx, yy - cy) < np.sqrt(m.sum() / np.pi) * 1.035
    ys, xs = np.where(m)
    cx, cy, r = (xs.min() + xs.max()) / 2, (ys.min() + ys.max()) / 2, max(xs.max() - xs.min(), ys.max() - ys.min()) / 2 + 3
    out = with_alpha(im, m, 1.5).crop(tuple(int(v) for v in (cx - r, cy - r, cx + r, cy + r)))
    return out.resize((size, size), Image.LANCZOS)


def soft_disc(im, frac):
    """Keep only the centre of a round image, fading out at frac of the radius (cheese layer)."""
    n = im.size[0]; yy, xx = np.mgrid[:n, :n]
    d = np.hypot(xx - n / 2, yy - n / 2) / (n / 2)
    fade = np.clip((frac + 0.05 - d) / 0.1, 0, 1)
    a = np.array(im.getchannel('A')) * fade
    im.putalpha(Image.fromarray(a.astype('uint8'))); return im


def cut_sheet(im, grid):
    """Topping sheet -> {topping id: [piece images]}."""
    rgb = np.array(im); h, w = rgb.shape[:2]
    lum = rgb.mean(2); bg = background(rgb)
    warm = rgb[..., 0].astype(float) - rgb[..., 2]; warm -= background(warm)      # warmer than the backdrop
    base = colour_mask(rgb)
    base[int(h * .9):, int(w * .9):] = False                       # generator's corner mark
    ys, xs = np.where(ndi.binary_opening(base, iterations=2))
    rows, cols = len(grid), len(grid[0])
    if rows == 2: y0, y1, x0, x1 = 0, h, 0, w
    else: y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    out = {}
    for r in range(rows):
        for c in range(cols):
            tid = grid[r][c]
            if not tid: continue
            # cell with a small margin so pieces near a border are not clipped
            cy0, cy1 = int(y0 + (y1 - y0) * r / rows), int(y0 + (y1 - y0) * (r + 1) / rows)
            cx0, cx1 = int(x0 + (x1 - x0) * c / cols), int(x0 + (x1 - x0) * (c + 1) / cols)
            cy0, cx0, cy1, cx1 = max(0, cy0 - 12), max(0, cx0 - 12), min(h, cy1 + 12), min(w, cx1 + 12)
            m = base[cy0:cy1, cx0:cx1].copy()
            if tid in WHITE:
                m |= (warm[cy0:cy1, cx0:cx1] > 5) | ((bg - lum)[cy0:cy1, cx0:cx1] > 24)
                m = ndi.binary_closing(m, iterations=1)
            # label on an opened core so thin shadow bridges do not join neighbours, then grow back into the mask
            k = MERGE.get(tid, 0)
            if k:
                lab, n = ndi.label(ndi.binary_dilation(m, iterations=k))
            else:
                lab, n = ndi.label(ndi.binary_opening(m, iterations=1))
                lab = np.where(m, ndi.grey_dilation(lab, size=(5, 5)), 0)
                ar = ndi.sum(m, lab, range(1, n + 1)); big = ar[ar >= .25 * ar.max()]
                # a blob much bigger than its siblings (or a lone blob) is several pieces stuck together: split it
                for i in range(n):
                    if ar[i] < .25 * ar.max() or not (len(big) < 3 or ar[i] > 1.7 * np.median(big)): continue
                    blob = lab == i + 1; best = None
                    for e in (2, 4, 6, 9, 12, 16):
                        cl, cn = ndi.label(ndi.binary_erosion(blob, iterations=e))
                        if not cn: break
                        ca = ndi.sum(np.ones_like(cl), cl, range(1, cn + 1)); good = int((ca >= .3 * ca.max()).sum())
                        if best is None or good > best[0]: best = (good, cl)
                    if best is None or best[0] < 2: continue
                    idx = ndi.distance_transform_edt(best[1] == 0, return_distances=False, return_indices=True)
                    sub = best[1][tuple(idx)]                      # nearest core: a simple watershed
                    lab[blob] = 0; lab[blob & (sub > 0)] = sub[blob & (sub > 0)] + lab.max()
                n = lab.max()
            area = ndi.sum(m, lab, range(1, n + 1))
            cell = im.crop((cx0, cy0, cx1, cy1)); got = []
            for i in np.argsort(-area):
                if area[i] < .25 * area.max() or area[i] < 150: continue
                reg = (lab == i + 1) & m
                py, px = np.where(reg)
                if py.min() == 0 or px.min() == 0 or py.max() == reg.shape[0] - 1 or px.max() == reg.shape[1] - 1: continue  # belongs to a neighbour cell
                bx = (px.min() - 2, py.min() - 2, px.max() + 3, py.max() + 3)
                p = with_alpha(cell, reg, .7).crop(bx)
                s = PIECE_PX / max(p.size)
                if s < 1: p = p.resize((max(1, round(p.width * s)), max(1, round(p.height * s))), Image.LANCZOS)
                got.append((p, float(reg.sum()), reg.sum() / ((px.max() - px.min() + 1) * (py.max() - py.min() + 1))))
            # drop leftovers: stuck-together groups (too big), clipped fragments (too small)
            if len(got) >= 3:
                med = np.median([g[1] for g in got]); got = [g for g in got if .45 * med <= g[1] <= 1.5 * med]
            elif len(got) == 2:
                got = [max(got, key=lambda g: g[2])]
            out[tid] = [g[0] for g in got[:6]]
    return out


def b64(im, q=80):
    buf = io.BytesIO(); im.save(buf, 'WEBP', quality=q, method=6)
    return 'data:image/webp;base64,' + base64.b64encode(buf.getvalue()).decode()


def main():
    os.makedirs(os.path.join(OUT, 'pieces'), exist_ok=True)
    A = {'pizza': {}, 'sauce': {}, 'pieces': {}}
    for pid, pre in PIZZAS.items():
        im = cut_round(find(pre), PIZZA_PX); im.save(os.path.join(OUT, pid + '.webp'), quality=80); A['pizza'][pid] = b64(im)
    g = find(SAUCE_GRID); w, h = g.size
    for r in range(2):
        for c in range(2):
            im = cut_round(g, BASE_PX, (c * w // 2, r * h // 2, (c + 1) * w // 2, (r + 1) * h // 2))
            im.save(os.path.join(OUT, 'sauce-' + SAUCES[r][c] + '.webp'), quality=80); A['sauce'][SAUCES[r][c]] = b64(im)
    ch = soft_disc(cut_round(find(CHEESE), BASE_PX), .68)
    ch.save(os.path.join(OUT, 'cheese.webp'), quality=80); A['cheese'] = b64(ch)
    for pre, grid in SHEETS.items():
        for tid, ps in cut_sheet(find(pre), grid).items():
            print(f'{tid:16s} {len(ps)} pieces', [p.size for p in ps])
            for i, p in enumerate(ps): p.save(os.path.join(OUT, 'pieces', f'{tid}-{i}.webp'), quality=82)
            A['pieces'][tid] = [{'u': b64(p, 82), 'a': round(p.width / p.height, 3)} for p in ps]
    # contact sheet for a quick visual check
    ids = list(A['pieces']); sheet = Image.new('RGB', (6 * 130 + 150, len(ids) * 130), '#c9862f'); dr = ImageDraw.Draw(sheet)
    for y, tid in enumerate(ids):
        dr.text((6, y * 130 + 55), tid, fill='white')
        for x, f in enumerate(sorted(glob.glob(os.path.join(OUT, 'pieces', tid + '-*.webp')))):
            p = Image.open(f).convert('RGBA'); sheet.paste(p, (150 + x * 130 + 5, y * 130 + 5), p)
    sheet.save(os.path.join(OUT, '_check-pieces.jpg'), quality=85)
    html = open(TPL, encoding='utf-8').read()
    blob = json.dumps(A, separators=(',', ':'))
    html, n = re.subn(r'(<script id="assets" type="application/json">).*?(</script>)', lambda m: m.group(1) + blob + m.group(2), html, flags=re.S)
    if n: open(SITE, 'w', encoding='utf-8').write(html)
    # copy for publishing as a Claude artifact: the host adds its own page skeleton, so strip ours
    art = re.sub(r'<!doctype html>|</?html[^>]*>|</?head>|</?body>|<meta charset[^>]*>|<meta name="viewport"[^>]*>', '', html, flags=re.I)
    open(os.path.join(os.path.dirname(SITE), 'artifact.html'), 'w', encoding='utf-8').write(art.lstrip())
    print('assets', round(len(blob) / 1e6, 2), 'MB', 'embedded' if n else 'NOT embedded')


if __name__ == '__main__':
    main()
