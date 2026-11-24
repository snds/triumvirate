# Regenerates apps/web/src/assets/masterwork-header.svg from the PNG art:
#   python3 apps/web/scripts/masterwork-banner.py <masterwork-header.png> apps/web/src/assets/masterwork-header.svg 271
# The last argument is the width of one repeat block in pixels.
# Traces masterwork-header.png into an SVG. The art is made only of 45° stripes, so it is sampled
# on a grid turned 45°, thresholded, and merged into rectangles that are rotated back: every edge
# comes out at an exact 45° angle. The downward fade is kept separately as a gradient mask.
import sys, math
from PIL import Image
src, out = sys.argv[1], sys.argv[2]
im = Image.open(src).convert('RGBA'); W, H = im.size
FULL = [[im.getpixel((x, y))[3] / 255 for x in range(W)] for y in range(H)]
# The art repeats every P pixels (measured: shifting by 271 matches almost exactly), so keep one
# block, averaging the two copies the image holds where both exist.
P = int(sys.argv[3]) if len(sys.argv) > 3 else W
A = [[(row[x] + row[x + P]) / 2 if x + P < W else row[x] for x in range(P)] for row in FULL]
W = P
PAD = 3
BAR = 5
# Fade envelope: the strong stripe alpha per row (90th percentile of lit pixels), kept falling.
env = []
for y in range(H):
    lit = sorted(a for a in A[y] if a > 0.004)
    env.append(lit[int(len(lit) * 0.9)] if len(lit) > 4 else 0)
for y in range(H - 2, BAR - 1, -1): env[y] = max(env[y], env[y + 1])
env = [sum(env[max(BAR, y - 2):y + 3]) / len(env[max(BAR, y - 2):y + 3]) if y >= BAR else env[y] for y in range(H)]
def a(x, y):
    # Wraps sideways, so stripes run across the block's edges; the clip trims them to the block.
    if x < -PAD or x > W + PAD or y < 0 or y > H - 1: return 0
    x0, y0 = math.floor(x), int(y); fx, fy = x - x0, y - y0
    x1, y1 = (x0 + 1) % W, min(y0 + 1, H - 1); x0 %= W
    v = (A[y0][x0] * (1 - fx) + A[y0][x1] * fx) * (1 - fy) + (A[y1][x0] * (1 - fx) + A[y1][x1] * fx) * fy
    e = env[min(int(round(y)), H - 1)]
    return v / e if e > 0.02 else 0
S = 0.5 / math.sqrt(2) * math.sqrt(2)  # grid step in rotated units (0.5 px)
r2 = math.sqrt(2)
# u along "\" direction, v along "/" direction: x = (u + v)/√2, y = (u - v)/√2 ... use u=(x+y)/√2, v=(x-y)/√2
umin, umax = -PAD / r2, (W + PAD + H) / r2
vmin, vmax = (-PAD - H) / r2, (W + PAD) / r2
nu, nv = int((umax - umin) / S) + 1, int((vmax - vmin) / S) + 1
# Each stripe family is found on its own: "\\" stripes run along u, "/" stripes along v. A cell
# belongs to a family when the art stays lit along that direction (averaged over ~2 px, which
# smooths the pixel stair-steps of 1 px hairlines) for at least MIN_RUN px. Crossings of the
# other family are too short to count, so they don't fatten the stripes.
T, MIN_RUN = 0.45, 3.0
OFF = (-0.9, -0.45, 0, 0.45, 0.9)
def xy(i, j):
    u, v = umin + (i + 0.5) * S, vmin + (j + 0.5) * S
    return (u + v) / r2, (u - v) / r2
d1 = [[False] * nu for _ in range(nv)]
d2 = [[False] * nu for _ in range(nv)]
for j in range(nv):
    for i in range(nu):
        x, y = xy(i, j)
        if y < BAR - 0.5: continue
        d1[j][i] = sum(a(x + t, y + t) for t in OFF) / 5 >= T
        d2[j][i] = sum(a(x + t, y - t) for t in OFF) / 5 >= T
need = int(MIN_RUN / S)
grid = [[False] * nu for _ in range(nv)]
for j in range(nv):          # family 1: runs along i
    i = 0
    while i < nu:
        if d1[j][i]:
            k = i
            while k < nu and d1[j][k]: k += 1
            if k - i >= need:
                for t in range(i, k): grid[j][t] = True
            i = k
        else: i += 1
for i in range(nu):          # family 2: runs along j
    j = 0
    while j < nv:
        if d2[j][i]:
            k = j
            while k < nv and d2[k][i]: k += 1
            if k - j >= need:
                for t in range(j, k): grid[t][i] = True
            j = k
        else: j += 1
# Greedy rectangles: horizontal runs per row, extended down while the same run repeats.
used = [[False] * nu for _ in range(nv)]
rects = []
for j in range(nv):
    i = 0
    while i < nu:
        if grid[j][i] and not used[j][i]:
            k = i
            while k < nu and grid[j][k] and not used[j][k]: k += 1
            h = 1
            while j + h < nv and all(grid[j + h][t] and not used[j + h][t] for t in range(i, k)): h += 1
            for jj in range(j, j + h):
                for t in range(i, k): used[jj][t] = True
            rects.append((umin + i * S, vmin + j * S, (k - i) * S, h * S))
            i = k
        else: i += 1
# The file holds only the shape: no fade and no bar. The app fills it with a CSS gradient and draws
# the bar itself, so each can be sized for where it's used. The fade stops are printed for the CSS.
top = max(env[BAR:BAR + 4]) or 1
print('peak opacity', round(top, 3))
print('fade stops:', ', '.join(f'{min(1, env[y] / top):.2f} {(y - BAR) / (H - BAR) * 100:.0f}%' for y in range(BAR, H, 5)))
f = lambda n: f'{n:.2f}'.rstrip('0').rstrip('.')
# One path, so neighboring rectangles fill as one shape with no hairline seams between them.
body = ''.join(f'M{f(u)} {f(v)}h{f(w)}v{f(h)}h{f(-w)}z' for u, v, w, h in rects)
svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 {BAR} {W} {H - BAR}" width="{W}" height="{H - BAR}">
<!-- Masterwork banner pattern, traced from the original art: 45 degree chevron stripes, one repeat block {W} units wide. Shape only; the app adds the fade and the gold bar. Regenerate with apps/web/scripts/masterwork-banner.py. -->
<clipPath id="c"><rect y="{BAR}" width="{W}" height="{H - BAR}"/></clipPath>
<g clip-path="url(#c)"><path fill="#ccb829" transform="matrix({1/r2:.6f} {1/r2:.6f} {1/r2:.6f} {-1/r2:.6f} 0 0)" d="{body}"/></g>
</svg>'''
open(out, 'w').write(svg)
print(len(rects), 'rects', len(svg), 'bytes')
