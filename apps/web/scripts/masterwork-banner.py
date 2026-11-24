# Regenerates apps/web/src/assets/masterwork-header.svg. Edit the chevron lists, then run:
#   python3 apps/web/scripts/masterwork-banner.py apps/web/src/assets/masterwork-header.svg
# Each entry is (apex depth, stroke width) for one nested V; A sits under x=135, B under x=0 and x=270.
# Generates the masterwork banner: a gold bar over nested 45° chevrons that fade out downward.
import sys
W, H, BAR = 270, 90, 5
A = [(22, 1.5), (35, 4.5), (49.5, 5), (63, 4.5), (86, 10)]          # under centers 135 (+270k)
B = [(17, 2), (21.5, 1.2), (27, 3), (36, 4), (45, 3.5), (54, 3), (63, 3), (88, 10)]  # under 0 / 270
def v(c, apex, w):
    # A V whose stroke centerline has its apex at (c, apex) and arms rising at 45° past the bar.
    d = apex  # reach y=0
    return f'<path d="M{c-d-w} {-w}L{c} {apex}L{c+d+w} {-w}" stroke-width="{w}"/>'
paths = []
for c in (0, 270):
    paths += [v(c, a, w) for a, w in B]
paths += [v(135, a, w) for a, w in A]
paths.append(f'<path d="M126 {BAR}L135 {BAR+8}L144 {BAR}z" stroke="none"/>')
svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" preserveAspectRatio="none">
  <!-- Masterwork banner: a gold bar over nested 45° chevrons that fade out downward. Repeats every {W} units across. The app uses it as a mask filled with the masterwork color token, so only its shape and opacity matter there. -->
  <defs>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="{H}" gradientUnits="userSpaceOnUse">
      <stop offset="{BAR/H:.3f}" stop-color="#fff" stop-opacity="1"/>
      <stop offset="{15/H:.3f}" stop-color="#fff" stop-opacity=".8"/>
      <stop offset="{22/H:.3f}" stop-color="#fff" stop-opacity=".55"/>
      <stop offset="{32/H:.3f}" stop-color="#fff" stop-opacity=".27"/>
      <stop offset="{48/H:.3f}" stop-color="#fff" stop-opacity=".13"/>
      <stop offset="{65/H:.3f}" stop-color="#fff" stop-opacity=".08"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="{W}" height="{H}"><rect width="{W}" height="{H}" fill="url(#fade)"/></mask>
    <clipPath id="c"><rect y="{BAR}" width="{W}" height="{H-BAR}"/></clipPath>
  </defs>
  <g clip-path="url(#c)" mask="url(#m)"><g fill="none" stroke="#ccb829" opacity=".37" stroke-linecap="butt" stroke-linejoin="miter">
    {"".join(paths).replace('stroke="none"/>', 'stroke="none" fill="#ccb829"/>')}
  </g></g>
  <rect width="{W}" height="{BAR}" fill="#ccb829" fill-opacity=".95"/>
</svg>'''
open(sys.argv[1], 'w').write(svg)
