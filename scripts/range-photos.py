#!/usr/bin/env python3
"""The Range chapter's photographs: every range picture from the old MAST website (owner, 2026-09-04: "Enter the range should
have all of our range pictures"), read from the handoff branch and written to images/mast/range/rNNN.jpg with a manifest.

The numbers are the P.nnn numbers on preview/old-range-photos.html (scripts/old-range-photos.py). Left out on purpose: the
water / VBSS / boat and tower sets, shoothouse and CQB interiors, the gym (hand and knife), instructor portraits, documents,
gear close-ups, aircraft. Add or drop a number and re-run; then re-run scripts/assemble-cinematic.py.

    python3 scripts/range-photos.py
"""
import io
import os
import re
import subprocess
import sys

sys.path.insert(0, '/tmp/claude-0/-home-user/c68647ba-19e2-5698-87aa-7898bed60191/scratchpad/pylib')
from PIL import Image, ImageOps  # noqa: E402

REF = 'origin/claude/desktop-assets'
TOP = 'reference/desktop/mast-new-web-2026/'
OUT = 'images/mast/range/'
MAX_W = 1600

# P.nnn numbers, in the order they appear on the chapter (the first twelve are the ones shown before "show all").
PICKS = [78, 162, 111, 9, 1, 25, 59, 80, 133, 122, 17, 138,
         2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 18, 20, 21, 22, 23, 24, 26, 28,
         55, 56, 57, 58, 61, 62, 63, 64, 65, 66, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88,
         93, 94, 95, 96, 100, 101, 102, 103, 104, 105, 109, 110, 114, 115, 116, 118, 119, 123, 124, 125, 126, 127, 128, 130, 132, 134,
         150, 151, 152, 153, 154, 155, 157, 159, 160, 163, 166, 167, 168, 169, 171, 172, 173, 176, 177, 178, 182, 185, 186, 188, 189,
         191, 192, 194, 195, 196, 198]

# Same listing and order as scripts/old-range-photos.py, so the P numbers match the sheets.
MAST_RE = re.compile(r'(MAST|_FV_|^\d{4}-\d\d-\d\d |^DSCN|^IMG_|^IMG0|Low Light|Mil:|^PSD0|SWAT|Tactical_Training|Team.?Tac|^h-|^header-|^c-handgun|^carbine|^handgun|long.range|low.light|^medical|^shotgun|^weapon|^ladies|^direct|Recon_|^Gallery|Circle of trust|brockmann|chauvin|mccusker|kramer|^sl-|^slider-|^team\.jpg|video-poster|Firearms|KNife|Leadership|Carbine|^B-mast|^[0-9A-F]{8}-)', re.I)
variant = re.compile(r'-\d+x\d+(@2x)?\.|@2x\.')
paths = subprocess.run(['git', 'ls-tree', '-r', '--name-only', REF, '--', TOP], capture_output=True, text=True, check=True).stdout.split('\n')
top = sorted(p for p in paths if '/mast-new-web-2026/mast/' not in p and re.search(r'\.(jpe?g|png)$', p, re.I) and not variant.search(p) and MAST_RE.search(p.rsplit('/', 1)[-1]))
# the sheet numbers skip images under 400 px wide, so number the same way
numbered = []
for p in top:
    data = subprocess.run(['git', 'show', f'{REF}:{p}'], capture_output=True, check=True).stdout
    try:
        im = ImageOps.exif_transpose(Image.open(io.BytesIO(data)))
    except Exception:
        continue
    if im.width < 400:
        continue
    numbered.append((p, im))
by_num = {i + 1: pi for i, pi in enumerate(numbered)}

os.makedirs(OUT, exist_ok=True)
for f in os.listdir(OUT):
    if re.match(r'r\d+\.jpg$', f):
        os.remove(OUT + f)
lines = []
for k, n in enumerate(PICKS, 1):
    p, im = by_num[n]
    im = im.convert('RGB')
    if im.width > MAX_W:
        im = im.resize((MAX_W, round(im.height * MAX_W / im.width)), Image.LANCZOS)
    name = f'r{k:03d}.jpg'
    im.save(OUT + name, quality=82, optimize=True)
    lines.append(f'{name}\tP.{n:03d}\t{p[len(TOP):]}\t{im.width}x{im.height}')
open(OUT + 'manifest.txt', 'w', encoding='utf-8').write('# tile\tsheet number\tsource on the handoff branch\tsize\n' + '\n'.join(lines) + '\n')
print(f'{len(PICKS)} photographs → {OUT} (manifest.txt maps each tile to its P number and source)')
