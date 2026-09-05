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

# Two sources on the handoff branch: the WordPress uploads (mostly the theme's demo images) and the top-level folder, where the
# old site's own photographs live (the 2013–2014 FV shoots, the 2012 course phone photos, the section headers, the instructors).
TOP = 'reference/desktop/mast-new-web-2026/'
MAST_RE = re.compile(r'(MAST|_FV_|^\d{4}-\d\d-\d\d |^DSCN|^IMG_|^IMG0|Low Light|Mil:|^PSD0|SWAT|Tactical_Training|Team.?Tac|^h-|^header-|^c-handgun|^carbine|^handgun|long.range|low.light|^medical|^shotgun|^weapon|^ladies|^direct|Recon_|^Gallery|Circle of trust|brockmann|chauvin|mccusker|kramer|^sl-|^slider-|^team\.jpg|video-poster|Firearms|KNife|Leadership|Carbine|^B-mast|^[0-9A-F]{8}-)', re.I)
def listing(prefix):
    return subprocess.run(['git', 'ls-tree', '-r', '--name-only', REF, '--', prefix], capture_output=True, text=True, check=True).stdout.split('\n')
variant = re.compile(r'-\d+x\d+(@2x)?\.|@2x\.')
uploads = sorted(p for p in listing(ROOT) if re.search(r'/20\d\d/\d\d/[^/]+\.(jpe?g|png)$', p, re.I) and not variant.search(p))
top = sorted(p for p in listing(TOP) if '/mast-new-web-2026/mast/' not in p and re.search(r'\.(jpe?g|png)$', p, re.I) and not variant.search(p) and MAST_RE.search(p.rsplit('/', 1)[-1]))
SOURCES = [('P', 'The old site\'s own photographs (top-level folder)', TOP, top), ('R', 'WordPress uploads (mostly the theme\'s demo images)', ROOT, uploads)]

font = ImageFont.load_default()
sections = []
for tag, title, root, paths in SOURCES:
    thumbs = []
    for p in paths:
        data = subprocess.run(['git', 'show', f'{REF}:{p}'], capture_output=True, check=True).stdout
        try:
            im = ImageOps.exif_transpose(Image.open(io.BytesIO(data)))
        except Exception:
            continue
        if im.width < 400:
            continue
        size = im.size
        im = ImageOps.fit(im.convert('RGB'), (TW, TH))
        thumbs.append((p[len(root):], im, size))
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
            d.rectangle([x, y, x + 40, y + 16], fill=(201, 168, 76)); d.text((x + 4, y + 2), f'{tag}.{n:03d}', fill=(0, 0, 0), font=font)
            d.text((x, y + TH + 2), rel[-38:], fill=(139, 149, 168), font=font)
        name = f'old-range-photos-{tag.lower()}{si // per + 1}.jpg'
        sheet.save(OUT + name, quality=72, optimize=True)
        sheets.append((name, si + 1, si + len(chunk)))
    items = ''.join(f'<li><b>{tag}.{i + 1:03d}</b> {H.escape(rel)} <span>{w}&times;{h}</span></li>' for i, (rel, _, (w, h)) in enumerate(thumbs))
    sections.append((tag, title, len(thumbs), sheets, items))

page = f'''<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Old MAST website photos — pick by number</title>
<style>body{{margin:0;background:#080c14;color:#f0f4ff;font:15px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;padding:1.5rem}}h1{{font-size:1.3rem}}h2{{font-size:1.05rem;margin-top:2rem}}p,li{{color:#b0b8c8}}img{{max-width:100%;display:block;margin:.6rem 0 1.4rem;border:1px solid #223}}
ol{{columns:3;column-gap:2rem;padding-left:3.5rem;font-size:.82rem;list-style:none}}li span{{color:#6b7488}}b{{color:#c9a84c}}@media(max-width:900px){{ol{{columns:1}}}}</style></head><body>
<h1>Old MAST website photos</h1>
<p>Read from the handoff branch; nothing here is on the page yet. Reply with the numbers (for example "P.014, P.031 → the Range") and they go where you say. Size variants and images under 400&nbsp;px are skipped.</p>
{''.join(f'<h2>{H.escape(t)} · {n} photos</h2>' + ''.join(f'<h3>Sheet · {tag}.{a:03d}–{tag}.{b:03d}</h3><img src="{nm}" alt="" loading="lazy">' for nm, a, b in sh) + f'<ol>{it}</ol>' for tag, t, n, sh, it in sections)}
</body></html>'''
open(OUT + 'old-range-photos.html', 'w', encoding='utf-8').write(page)
print(' | '.join(f'{tag}: {n} photos on {len(sh)} sheets' for tag, _, n, sh, _ in sections), '→', OUT + 'old-range-photos.html')
