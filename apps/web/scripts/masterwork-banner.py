# Regenerates apps/web/src/assets/masterwork-header.svg from the PNG art:
#   python3 apps/web/scripts/masterwork-banner.py <masterwork-header.png> apps/web/src/assets/masterwork-header.svg 271
# 271 is the width in pixels of one repeat block of the pattern.
# Rebuilds the masterwork pattern as clean geometry on the art's own pixel lattice.
# The art was drawn with 45° lines on a pixel grid, so every lit pixel belongs to a "\" or "/"
# line. Along each line direction, runs of lit pixels become one band with straight 45° edges
# (no staircase). Hairlines stay 1 px; wide bands stay wide. Output is shape only.
import sys, math
from PIL import Image
src, out, P = sys.argv[1], sys.argv[2], int(sys.argv[3])
im = Image.open(src).convert('RGBA'); W0, H = im.size; BAR = 5
raw = [[im.getpixel((x, y))[3] for x in range(W0)] for y in range(H)]
A = [[(r[x] + r[x + P]) / 2 if x + P < W0 else r[x] for x in range(P)] for r in raw]
env = []
for y in range(H):
    lit = sorted(v for v in A[y] if v > 1)
    env.append(lit[int(len(lit) * 0.9)] if len(lit) > 4 else 0)
for y in range(H - 2, BAR - 1, -1): env[y] = max(env[y], env[y + 1])
LIT = float(sys.argv[4]) if len(sys.argv) > 4 else 0.5
def lit(x, y):
    if y < BAR or y >= H or env[y] < 3: return False
    return A[y][x % P] / env[y] >= LIT
PAD = 4
xs = range(-PAD - H, P + PAD + H)
f = lambda n: f'{n:.1f}'.rstrip('0').rstrip('.')
bands = []   # (family, m, p0, p1): family 1 "\" has m = x - y; family 2 "/" has m = x + y
for fam, (dx, dy) in ((1, (1, 1)), (2, (-1, 1))):
    # Each lattice line: all pixels with the same m. Walk it and collect runs of lit pixels.
    ms = range(-H - PAD, P + PAD + 1) if fam == 1 else range(BAR - PAD, P + H + PAD)
    for m in ms:
        run = None
        for y in range(BAR, H):
            x = m + y if fam == 1 else m - y
            on = -PAD <= x < P + PAD and lit(x, y)
            # A pixel counts for this family only if its line neighbor is lit too (it's part of
            # a run along this direction, not just a crossing of the other family).
            if on and not (lit(x + dx, y + 1) or lit(x - dx, y - 1)): on = False
            if on and run is None: run = y
            if not on and run is not None:
                bands.append((fam, m, run, y - 1)); run = None
        if run is not None: bands.append((fam, m, run, H - 1))
# Merge neighboring lines (m, m+1) whose runs line up into one wide band.
from collections import defaultdict
paths = []
for fam in (1, 2):
    rows = defaultdict(list)
    for fm, m, y0, y1 in bands:
        if fm == fam: rows[m].append([y0, y1])
    done = set(); 
    for m in sorted(rows):
        for r in rows[m]:
            key = (m, r[0], r[1])
            if key in done: continue
            done.add(key); m1 = m; ys0 = [r[0]]; ys1 = [r[1]]
            while True:
                nxt = next((q for q in rows.get(m1 + 1, []) if (m1 + 1, q[0], q[1]) not in done
                            and abs(q[0] - ys0[-1]) <= 1 and abs(q[1] - ys1[-1]) <= 1), None)
                if not nxt: break
                m1 += 1; done.add((m1, nxt[0], nxt[1])); ys0.append(nxt[0]); ys1.append(nxt[1])
            # Band covers lattice lines m..m1: edges at m-0.5 and m1+0.5 (in x∓y units).
            # Ends: the first and last pixel rows, averaged across the band so the end is square.
            a0 = sum(ys0) / len(ys0) - 0.5; a1 = sum(ys1) / len(ys1) + 0.5
            # Specks: a band shorter than 2 px along and only a line or two wide is antialiasing noise.
            if a1 - a0 < 2.5 and m1 - m <= 1: continue
            lo, hi = m - 0.5, m1 + 0.5
            # Corners in x,y: family 1 lines are x - y = c; family 2 are x + y = c.
            # Use the band's centerline y-range [a0, a1]; ends perpendicular to the band.
            if fam == 1:
                # point on line c at "along" s: x = c + s, y = s; perpendicular end through mid-line.
                def pt(c, s): return (c + s, s)
                mid = (lo + hi) / 2
                # convert y-range at centerline to along s (= y) and keep ends perpendicular:
                # perpendicular direction to (1,1) is (1,-1): moving c by d shifts s by -d/2.
                corners = [pt(lo, a0 + (mid - lo) / 2), pt(hi, a0 - (hi - mid) / 2), pt(hi, a1 - (hi - mid) / 2), pt(lo, a1 + (mid - lo) / 2)]
            else:
                def pt(c, s): return (c - s, s)
                mid = (lo + hi) / 2
                corners = [pt(lo, a0 - (mid - lo) / 2), pt(hi, a0 + (hi - mid) / 2), pt(hi, a1 + (hi - mid) / 2), pt(lo, a1 - (mid - lo) / 2)]
            paths.append('M' + 'L'.join(f'{f(x + 0.5)} {f(y + 0.5)}' for x, y in corners) + 'z')
svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 {BAR} {P} {H - BAR}" width="{P}" height="{H - BAR}">
<!-- Masterwork banner pattern, one repeat block {P} units wide: 45 degree bands and hairlines. Shape only; the app adds the fade and the gold bar. Regenerate with apps/web/scripts/masterwork-banner.py. -->
<clipPath id="c"><rect y="{BAR}" width="{P}" height="{H - BAR}"/></clipPath>
<path clip-path="url(#c)" fill="#ccb829" d="{''.join(paths)}"/>
</svg>'''
open(out, 'w').write(svg); print(len(paths), 'bands', len(svg), 'bytes')
