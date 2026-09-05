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
# 2026-09-04, owner: "The range photos are the ones that were posted on the old website, with the classroom, the range." The export
# holds no classroom and its media stops at January 2015, so this is the facility set that exists: the private-session sign, the
# shelter, the range with its tables, the tower, the flat range and berms, the indoor bays, the building. His set replaces it.
PICKS = [9, 10, 111, 33, 35, 36, 37, 1, 2, 78, 79, 80,
         162, 163, 178, 114, 115, 118, 116, 12, 25, 59, 73, 88]

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
