#!/usr/bin/env python3
"""Side-by-side review sheet: the current atlasglinn.com pages (as committed on main) against the preview/ rebuild.

Writes preview/compare.html. For every page, the left column lists the current page's sections in order with the
images each one carries; the right column lists the rebuilt page's chapters with their photo layer and inline media.
Brockmann, 2026-09-04: "I'm gonna need to look at both Atlas Glinn as is and the new rendition."

Run after scripts/assemble-atlas.py:  python3 scripts/compare-atlas.py
"""
import html as H, os, re, subprocess
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGES = ['index', 'executive-protection', 'residential-protection', 'disaster-recovery', 'training', 'technology',
         'cuas-aerodefense', 'uas', 'about', 'careers', 'contact']
WP = 'https://atlasglinn.com/wp-content/uploads/'
SKIP = ('Logo', 'chamber-badge', 'BEST_OF', 'ag-logo', 'favicon', '.js', '.css', 'fonts.g', 'data:')
TOK = re.compile(r'<(h[1-3])[^>]*>(.*?)</\1>|(?:src|poster)="([^"]+)"|background(?:-image)?:\s*url\(([^)]+)\)', re.S | re.I)
YT = re.compile(r'youtube\.com/embed/([\w-]+)')

def clean(t): return re.sub(r'\s+', ' ', H.unescape(re.sub(r'<[^>]+>', '', t))).strip()

def media(u, base):
    """Return (kind, url, label) for a media reference or None when it is chrome or a pointer we cannot show."""
    u = u.strip('\'" ')
    if any(s in u for s in SKIP): return None
    m = YT.search(u)
    if m: return ('yt', f'https://i.ytimg.com/vi/{m.group(1)}/hqdefault.jpg', 'YouTube ' + m.group(1))
    if u.endswith(('.mp4', '.mov')): return ('video', '', 'video ' + u.split('/')[-1])
    if u.startswith('http'): return ('img', u, u.replace(WP, 'WP: '))
    if u.startswith('../'): return ('img', u, u[3:])                     # preview pages already point one level up
    return ('img', '../' + u, u)                                         # main pages sit at the root

def blocks_old(page):
    src = subprocess.run(['git', 'show', f'origin/main:{page}.html'], capture_output=True, text=True, cwd=REPO).stdout
    src = src.split('<footer', 1)[0]
    out, cur = [], None
    for m in TOK.finditer(src):
        if m.group(1):
            t = clean(m.group(2))
            if not t: continue
            if m.group(1).lower() in ('h1', 'h2'):
                cur = {'h': t, 'subs': [], 'media': []}; out.append(cur)
            elif cur is not None and t not in cur['subs'] and t != '0': cur['subs'].append(t)
        else:
            md = media(m.group(3) or m.group(4), 'main')
            if md is None: continue
            if cur is None: cur = {'h': '(hero)', 'subs': [], 'media': []}; out.append(cur)
            if md not in cur['media']: cur['media'].append(md)
    return out

def blocks_new(page):
    src = open(os.path.join(REPO, 'preview', page + '.html'), encoding='utf-8').read()
    layer = dict(re.findall(r'<div class="ph" data-for="(\d+)" style="background-image:url\(\'([^\']+)\'\)', src))
    out = []
    for sec in re.finditer(r'<section class="panel" id="s(\d+)" data-section="(\d+)">(.*?)</section>', src, re.S):
        n, body = sec.group(2), sec.group(3)
        eyebrow = re.search(r'<div class="(?:eyebrow|badge)">(.*?)</div>', body, re.S)
        head = re.search(r'<h[12][^>]*>(.*?)</h[12]>', body, re.S)
        cur = {'h': (clean(eyebrow.group(1)) + ' · ' if eyebrow else '') + (clean(head.group(1)) if head else ''), 'subs': [], 'media': []}
        ph = media(layer.get(n, ''), 'preview')
        if ph: cur['media'].append(('layer',) + ph[1:])
        for t in re.findall(r'<h[34][^>]*>(.*?)</h[34]>', body, re.S):
            t = clean(t)
            if t and t not in cur['subs']: cur['subs'].append(t)
        for m in TOK.finditer(body):
            if m.group(1): continue
            md = media(m.group(3) or m.group(4), 'preview')
            if md and md not in cur['media']: cur['media'].append(md)
        out.append(cur)
    return out

def render_col(blocks):
    parts = []
    for b in blocks:
        thumbs = ''.join(
            f'<figure><img src="{H.escape(u)}" loading="lazy" alt=""><figcaption>{"photo layer · " if k == "layer" else ""}{H.escape(l)}</figcaption></figure>' if u
            else f'<figure class="novid"><figcaption>{H.escape(l)}</figcaption></figure>' for k, u, l in b['media'])
        subs = f'<p class="subs">{H.escape(" · ".join(b["subs"]))}</p>' if b['subs'] else ''
        parts.append(f'<div class="block"><h4>{H.escape(b["h"])}</h4>{subs}<div class="thumbs">{thumbs}</div></div>')
    return ''.join(parts)

CSS = """
body{margin:0;background:#080c14;color:#e6e9ef;font:15px/1.45 -apple-system,Helvetica,Arial,sans-serif}
header{padding:1.2rem 1rem;border-bottom:1px solid #223}h1{font-size:1.2rem;margin:0 0 .4rem}header p{margin:.2rem 0;color:#9aa3b2;font-size:.9rem}
nav a{color:#7fb0ff;margin-right:.8rem;font-size:.85rem}
section.page{border-bottom:1px solid #223;padding:1rem}
section.page h2{font-size:1.05rem;margin:0 0 .6rem}section.page h2 a{color:#7fb0ff;font-weight:400;font-size:.85rem;margin-left:.6rem}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:.8rem}.col h3{font-size:.7rem;letter-spacing:.2em;text-transform:uppercase;color:#9aa3b2;margin:0 0 .5rem}
.block{border:1px solid #1e2738;padding:.55rem;margin-bottom:.55rem;background:#0d1320}.block h4{margin:0 0 .25rem;font-size:.9rem;color:#fff}
.subs{margin:0 0 .4rem;font-size:.75rem;color:#9aa3b2}.thumbs{display:flex;flex-wrap:wrap;gap:.4rem}
figure{margin:0;width:calc(50% - .2rem)}figure img{width:100%;aspect-ratio:16/10;object-fit:cover;display:block;background:#000}
figcaption{font-size:.62rem;color:#8b94a6;word-break:break-all;margin-top:.15rem}figure.novid{width:100%}
@media(min-width:900px){figure{width:calc(33.33% - .3rem)}}
"""

def main():
    secs, nav = [], []
    for p in PAGES:
        live = 'https://atlasglinn.com/' + ('' if p == 'index' else p + '.html')
        nav.append(f'<a href="#{p}">{p}</a>')
        secs.append(f'<section class="page" id="{p}"><h2>{p}.html <a href="{live}" target="_blank" rel="noopener">current site ↗</a><a href="{p}.html" target="_blank">new rendition ↗</a></h2>'
                    f'<div class="cols"><div class="col"><h3>As is (main)</h3>{render_col(blocks_old(p))}</div>'
                    f'<div class="col"><h3>New (preview/)</h3>{render_col(blocks_new(p))}</div></div></section>')
    doc = ('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex, nofollow">'
           f'<title>Atlas Glinn — as is vs new</title><style>{CSS}</style></head><body><header><h1>Atlas Glinn: as is vs the new rendition</h1>'
           '<p>Left: every section of the current page in order, with the images it carries. Right: the rebuilt chapters, each with its background photo layer and inline media. Images marked WP: load from the WordPress uploads folder.</p>'
           f'<nav>{"".join(nav)}</nav></header>{"".join(secs)}</body></html>')
    out = os.path.join(REPO, 'preview', 'compare.html')
    open(out, 'w', encoding='utf-8').write(doc)
    print('wrote preview/compare.html', len(doc.encode()), 'bytes')

if __name__ == '__main__': main()
