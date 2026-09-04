#!/usr/bin/env python3
"""Contact sheets of the old MAST website's photos (its WordPress uploads, 2014–2015) so Brockmann can pick by number.

The photos live on the handoff branch (claude/desktop-assets, reference/desktop/mast-new-web-2026/mast/wp-content/uploads/);
this reads them straight from that ref — nothing is merged or checked out — and writes numbered sheets plus an index page
to preview/. Re-run after a new handoff. Size variants (-WxH, @2x) and images under 400 px wide are skipped.

    python3 scripts/old-range-photos.py
"""
import html as H
import io
import re
import subprocess
import sys

sys.path.insert(0, '/tmp/claude-0/-home-user/c68647ba-19e2-5698-87aa-7898bed60191/scratchpad/pylib')
from PIL import Image, ImageDraw, ImageFont, ImageOps  # noqa: E402

REF = 'origin/claude/desktop-assets'
ROOT = 'reference/desktop/mast-new-web-2026/mast/wp-content/uploads/'
COLS, ROWS, TW, TH, PAD = 8, 6, 236, 168, 10
OUT = 'preview/'

paths = subprocess.run(['git', 'ls-tree', '-r', '--name-only', REF, '--', ROOT], capture_output=True, text=True, check=True).stdout.split()
paths = [p for p in paths if re.search(r'/20\d\d/\d\d/[^/]+\.(jpe?g|png)$', p, re.I) and not re.search(r'-\d+x\d+(@2x)?\.|@2x\.', p)]
paths.sort()

font = ImageFont.load_default()
thumbs = []
for p in paths:
    data = subprocess.run(['git', 'show', f'{REF}:{p}'], capture_output=True, check=True).stdout
    try:
        im = ImageOps.exif_transpose(Image.open(io.BytesIO(data)))
    except Exception:
        continue
    if im.width < 400:
        continue
    im = ImageOps.fit(im.convert('RGB'), (TW, TH))
    thumbs.append((p[len(ROOT):], im, Image.open(io.BytesIO(data)).size))

per = COLS * ROWS
sheets = []
for si in range(0, len(thumbs), per):
    chunk = thumbs[si:si + per]
    rows = (len(chunk) + COLS - 1) // COLS
    sheet = Image.new('RGB', (COLS * (TW + PAD) + PAD, rows * (TH + PAD + 14) + PAD), (8, 12, 20))
    d = ImageDraw.Draw(sheet)
    for i, (rel, im, _) in enumerate(chunk):
        n = si + i + 1
        x = PAD + (i % COLS) * (TW + PAD); y = PAD + (i // COLS) * (TH + PAD + 14)
        sheet.paste(im, (x, y))
        d.rectangle([x, y, x + 40, y + 16], fill=(201, 168, 76)); d.text((x + 4, y + 2), f'R.{n:03d}', fill=(0, 0, 0), font=font)
        d.text((x, y + TH + 2), rel[-38:], fill=(139, 149, 168), font=font)
    name = f'old-range-photos-{si // per + 1}.jpg'
    sheet.save(OUT + name, quality=72, optimize=True)
    sheets.append((name, si + 1, si + len(chunk)))

items = ''.join(f'<li><b>R.{i + 1:03d}</b> {H.escape(rel)} <span>{w}&times;{h}</span></li>' for i, (rel, _, (w, h)) in enumerate(thumbs))
page = f'''<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Old MAST website photos — pick by number</title>
<style>body{{margin:0;background:#080c14;color:#f0f4ff;font:15px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;padding:1.5rem}}h1{{font-size:1.3rem}}p,li{{color:#b0b8c8}}img{{max-width:100%;display:block;margin:.6rem 0 1.4rem;border:1px solid #223}}
ol{{columns:3;column-gap:2rem;padding-left:3.5rem;font-size:.82rem}}li span{{color:#6b7488}}b{{color:#c9a84c}}@media(max-width:900px){{ol{{columns:1}}}}</style></head><body>
<h1>Old MAST website photos ({len(thumbs)} originals, WordPress uploads 2014–2015)</h1>
<p>Read from the handoff branch; nothing here is on the page yet. Reply with the numbers (for example "R.014, R.031 → Courses chapter") and they go where you say. Size variants and images under 400&nbsp;px are skipped.</p>
{''.join(f'<h2>Sheet {k + 1} · R.{a:03d}–R.{b:03d}</h2><img src="{n}" alt="" loading="lazy">' for k, (n, a, b) in enumerate(sheets))}
<h2>Index</h2><ol>{items}</ol></body></html>'''
open(OUT + 'old-range-photos.html', 'w', encoding='utf-8').write(page)
print(f'{len(thumbs)} photos on {len(sheets)} sheets → {OUT}old-range-photos.html')
