#!/usr/bin/env python3
"""Numbered review sheet of mastsolutions.html as generated: every chapter with its photo layer, tiles and inline media,
then the media strip in order. Brockmann marks changes against the numbers ("move 4.03 to 3", "replace 7.2 with ...").

Writes preview/mast-review.html. Run after scripts/assemble-cinematic.py:  python3 scripts/mast-review.py
"""
import html as H, importlib.util, os, re
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location('compare_atlas', os.path.join(REPO, 'scripts', 'compare-atlas.py'))
ca = importlib.util.module_from_spec(spec); spec.loader.exec_module(ca)

def chapters(src):
    layer = dict(re.findall(r'<div class="ph" data-for="(\d+)" style="background-image:url\(\'([^\']+)\'\)', src))
    out = []
    for sec in re.finditer(r'<section class="panel" id="s(\d+)" data-section="(\d+)">(.*?)</section>', src, re.S):
        n, body = sec.group(2), sec.group(3)
        eyebrow = re.search(r'<div class="(?:eyebrow|badge)">(.*?)</div>', body, re.S)
        head = re.search(r'<h[12][^>]*>(.*?)</h[12]>', body, re.S)
        items = []
        ph = layer.get(n)
        if ph: items.append(('photo layer (background)', ph))
        for t in re.finditer(r'<div class="tile[^"]*"><div class="bg" style="background-image:url\(\'([^\']+)\'\)[^>]*></div>.*?<h3>(.*?)</h3>', body, re.S):
            items.append(('tile: ' + ca.clean(t.group(2)), t.group(1)))
        for m in re.finditer(r'<img[^>]+src="([^"]+)"', body): items.append(('image', m.group(1)))
        for m in re.finditer(r'<video[^>]+poster="([^"]+)"[^>]*src="([^"]+)"', body): items.append(('film ' + m.group(2), m.group(1)))
        for m in re.finditer(r'style="background-image:url\(\'([^\']+)\'\)', body):
            if not any(m.group(1) == u for _, u in items): items.append(('portrait / background', m.group(1)))
        out.append({'n': n, 'title': (ca.clean(eyebrow.group(1)) + ' · ' if eyebrow else '') + (ca.clean(head.group(1)) if head else ''),
                    'subs': [ca.clean(t) for t in re.findall(r'<h[34][^>]*>(.*?)</h[34]>', body, re.S) if ca.clean(t)], 'items': items})
    return out

def media_strip(src):
    arr = re.search(r'const MEDIA = \[(.*?)\n\];', src, re.S).group(1)
    out = []
    for row in re.finditer(r'\{([^}]*)\}', arr):
        d = dict(re.findall(r"(\w+):\s*'([^']*)'", row.group(1)))
        thumb = d.get('poster') or (f"https://i.ytimg.com/vi/{d['yt']}/hqdefault.jpg" if 'yt' in d else '')
        out.append((d.get('title', ''), d.get('sub', ''), d.get('mp4') or ('YouTube ' + d['yt']), thumb, 'teaser' in d))
    return out

def main():
    src = open(os.path.join(REPO, 'mastsolutions.html'), encoding='utf-8').read()
    secs = []
    for c in chapters(src):
        figs = ''.join(f'<figure><img src="../{H.escape(u)}" loading="lazy" alt=""><figcaption>{c["n"]}.{i:02d} · {H.escape(k)}<br>{H.escape(u)}</figcaption></figure>'
                       for i, (k, u) in enumerate(c['items'], 1))
        subs = f'<p class="subs">{H.escape(" · ".join(c["subs"]))}</p>' if c['subs'] else ''
        secs.append(f'<section class="page"><h2>Chapter {c["n"]} · {H.escape(c["title"])}</h2>{subs}<div class="thumbs">{figs or "<p class=subs>text only</p>"}</div></section>')
    strip = ''.join(f'<figure><img src="{H.escape(t if t.startswith("http") else "../" + t)}" loading="lazy" alt=""><figcaption>M.{i:02d} · {H.escape(title)}<br>{H.escape(sub)}<br>{H.escape(f)}{" · teaser" if tz else ""}</figcaption></figure>'
                    for i, (title, sub, f, t, tz) in enumerate(media_strip(src), 1))
    secs.append(f'<section class="page"><h2>Media strip, in order (chapter 07)</h2><div class="thumbs">{strip}</div></section>')
    doc = ('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex, nofollow">'
           f'<title>MAST Solutions — review sheet</title><style>{ca.CSS} figure{{width:calc(33.33% - .3rem)}} @media(min-width:900px){{figure{{width:calc(20% - .35rem)}}}}</style></head><body>'
           '<header><h1>MAST Solutions page: every picture and clip, numbered</h1><p>Chapters in page order. Each item has a number like 4.03 (chapter 4, item 3); media strip items are M.01 onward. Reply with moves and swaps against these numbers. The course list is loaded live from the booking Worker and is not shown here.</p>'
           '<nav><a href="../mastsolutions.html" target="_blank">open the page ↗</a></nav></header>' + ''.join(secs) + '</body></html>')
    out = os.path.join(REPO, 'preview', 'mast-review.html')
    open(out, 'w', encoding='utf-8').write(doc)
    print('wrote preview/mast-review.html', len(doc.encode()), 'bytes')

if __name__ == '__main__': main()
