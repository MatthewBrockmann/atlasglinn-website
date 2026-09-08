#!/usr/bin/env python3
"""Side by side: the current atlasglinn.com page against the new one, section for section.

Brockmann, 2026-09-08: "side bar = take the current site and drop into new design and see". So this is the seeing.
Left is the live page as captured in reference/live/<slug>.html — the real thing. Right is the page this repo now
serves. Both columns are read out of the same content region by the same extractor, so a row that reads identically
IS identical; the only difference that should ever appear is an internal link, which points at the sibling .html file
instead of the WordPress permalink.

Above each pair sits the count that matters: how many of the live page's visible text units and media URLs the new
page carries. Anything short of every one of them is named, item by item, right there in the sheet.

Writes atlas-compare.html at the repo root (tracked, noindex). Run after scripts/assemble-atlas.py:
    python3 scripts/compare-atlas.py
"""
import html as H
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import atlas_live as live

REPO = live.REPO
OUT = os.path.join(REPO, 'atlas-compare.html')
SKIP = ('Atlas-Glinn-Logo', 'chamber-badge', 'BEST_OF')   # the marks the bar and the footer carry on every page
_TOK = re.compile(r'<(h[1-4])[^>]*>(.*?)</\1>|(?:src|poster)=["\']([^"\']+)["\']'
                  r'|background(?:-image)?:\s*url\((["\']?)([^)"\']+)\4\)', re.S | re.I)
_STRIP = re.compile(r'<(script|style)\b[^>]*>.*?</\1>|<!--.*?-->', re.S | re.I)


def clean(t):
    return re.sub(r'\s+', ' ', H.unescape(re.sub(r'<[^>]+>', '', t))).strip()


def text_units(markup):
    """The visible text, one unit per run between tags — what a reader actually sees, in order."""
    out = []
    for chunk in re.split(r'<[^>]+>', _STRIP.sub(' ', markup)):
        t = re.sub(r'\s+', ' ', H.unescape(chunk)).strip()
        if t:
            out.append(t)
    return out


def label(u):
    return 'YouTube ' + u[3:] if u.startswith('yt:') else (u.split('/')[-1] or u)


def thumb(u):
    if u.startswith('yt:'):
        return 'https://i.ytimg.com/vi/%s/hqdefault.jpg' % u[3:]
    return '' if u.lower().endswith(('.mp4', '.mov', '.webm')) else u


def blocks(markup):
    """The content as a reader meets it: a block per h1/h2, its sub-headings and the media it carries."""
    out, cur = [], None
    for m in _TOK.finditer(_STRIP.sub(' ', markup)):
        if m.group(1):
            t = clean(m.group(2))
            if not t:
                continue
            if m.group(1).lower() in ('h1', 'h2'):
                cur = {'h': t, 'subs': [], 'media': []}
                out.append(cur)
            elif cur is not None and t not in cur['subs']:
                cur['subs'].append(t)
        else:
            u = (m.group(3) or m.group(5) or '').strip()
            if not u or u.startswith('data:') or any(s in u for s in SKIP):
                continue
            if cur is None:
                cur = {'h': '(hero)', 'subs': [], 'media': []}
                out.append(cur)
            if u not in cur['media']:
                cur['media'].append(u)
    return out


def render(bs):
    parts = []
    for b in bs:
        thumbs = ''.join(
            '<figure><img src="%s" loading="lazy" alt=""><figcaption>%s</figcaption></figure>'
            % (H.escape(thumb(u)), H.escape(label(u))) if thumb(u) else
            '<figure class="film"><figcaption>%s</figcaption></figure>' % H.escape(label(u))
            for u in b['media'])
        subs = '<p class="subs">%s</p>' % H.escape(' &middot; '.join(b['subs'])) if b['subs'] else ''
        parts.append('<div class="block"><h4>%s</h4>%s<div class="thumbs">%s</div></div>'
                     % (H.escape(b['h']), subs, thumbs))
    return ''.join(parts) or '<div class="block"><h4>(no headings)</h4></div>'


def new_content(page):
    """The generated page's content region — the same boundaries the live page has, because the shell keeps them."""
    with open(os.path.join(REPO, page), encoding='utf-8') as fh:
        html = fh.read()
    a, b = live._content_span(html)
    return html[a:b]


def missing(want, got):
    """What the live page has that the new page does not, counting repeats."""
    pool, out = list(got), []
    for x in want:
        if x in pool:
            pool.remove(x)
        else:
            out.append(x)
    return out


CSS = """
body{margin:0;background:#080c14;color:#e6e9ef;font:15px/1.45 -apple-system,Helvetica,Arial,sans-serif}
header{padding:1.2rem 1rem;border-bottom:1px solid #223}h1{font-size:1.2rem;margin:0 0 .4rem}
header p{margin:.25rem 0;color:#9aa3b2;font-size:.9rem}header code{color:#c9d3e4;font-size:.78rem}
nav a{color:#7fb0ff;margin-right:.8rem;font-size:.85rem;text-decoration:none}
section.page{border-bottom:1px solid #223;padding:1rem}
section.page h2{font-size:1.05rem;margin:0 0 .5rem}
section.page h2 a{color:#7fb0ff;font-weight:400;font-size:.85rem;margin-left:.6rem;text-decoration:none}
.verdict{font-size:.82rem;margin:0 0 .7rem;padding:.4rem .6rem;border-left:3px solid #2f6b3f;background:#0d1320;color:#9fe0b4}
.verdict.off{border-left-color:#8a5a1f;color:#f0c98a}
.verdict ul{margin:.35rem 0 0 1rem;padding:0}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:.8rem}
.col h3{font-size:.7rem;letter-spacing:.2em;text-transform:uppercase;color:#9aa3b2;margin:0 0 .5rem}
.block{border:1px solid #1e2738;padding:.55rem;margin-bottom:.55rem;background:#0d1320}
.block h4{margin:0 0 .25rem;font-size:.9rem;color:#fff}
.subs{margin:0 0 .4rem;font-size:.75rem;color:#9aa3b2}
.thumbs{display:flex;flex-wrap:wrap;gap:.4rem}
figure{margin:0;width:calc(50% - .2rem)}
figure img{width:100%;aspect-ratio:16/10;object-fit:cover;display:block;background:#000}
figcaption{font-size:.62rem;color:#8b94a6;word-break:break-all;margin-top:.15rem}
figure.film{width:100%;border:1px dashed #2a3550;padding:.25rem}
@media(max-width:700px){.cols{grid-template-columns:1fr}}
@media(min-width:900px){figure{width:calc(33.33% - .3rem)}}
"""


def main():
    stamp = open(os.path.join(live.LIVE, '_captured.txt'), encoding='utf-8').read().strip().split('\n')[0]
    secs, menu, off = [], [], 0
    for slug in live.PAGES:
        page = 'index.html' if slug == 'index' else slug + '.html'
        old, new = live.content(slug), new_content(page)
        to, tn = text_units(old), text_units(new)
        mo, mn = sorted(live.media(slug, old)), sorted(live.media(slug, new))
        lost_t, lost_m = missing(to, tn), missing(mo, mn)
        ok = not lost_t and not lost_m
        off += 0 if ok else 1
        detail = ''.join('<li>%s</li>' % H.escape(x[:160]) for x in lost_t[:20] + [label(u) for u in lost_m])
        menu.append('<a href="#%s">%s</a>' % (slug, slug))
        secs.append(
            '<section class="page" id="%s"><h2>%s'
            '<a href="https://atlasglinn.com/%s" target="_blank" rel="noopener">current site &#8599;</a>'
            '<a href="%s" target="_blank">new page &#8599;</a></h2>'
            '<p class="verdict%s">text %d/%d &middot; media %d/%d carried across%s</p>'
            '<div class="cols"><div class="col"><h3>Current atlasglinn.com</h3>%s</div>'
            '<div class="col"><h3>New &mdash; same content, classic shell</h3>%s</div></div></section>'
            % (slug, page, '' if slug == 'index' else slug + '/', page,
               '' if ok else ' off', len(to) - len(lost_t), len(to), len(mo) - len(lost_m), len(mo),
               '' if ok else '<ul>%s</ul>' % detail, render(blocks(old)), render(blocks(new))))
    doc = ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
           '<meta name="viewport" content="width=device-width,initial-scale=1">'
           '<meta name="robots" content="noindex, nofollow">'
           '<title>Atlas Glinn &mdash; current site vs new design</title><style>%s</style></head><body>'
           '<header><h1>Atlas Glinn: the current site, side by side with the new design</h1>'
           '<p>Left is atlasglinn.com as captured. Right is the page this repo serves &mdash; the same content, the '
           'same stylesheet and the same films, inside the classic shell. A row that reads the same is the same: both '
           'columns come out of the page through one extractor.</p>'
           '<p><code>%s</code></p><nav>%s</nav></header>%s</body></html>'
           % (CSS, H.escape(stamp), ''.join(menu), ''.join(secs)))
    open(OUT, 'w', encoding='utf-8').write(doc)
    print('wrote atlas-compare.html %d bytes, %d pages, %d with a delta' % (len(doc.encode()), len(live.PAGES), off))
    return 1 if off else 0


if __name__ == '__main__':
    sys.exit(main())
