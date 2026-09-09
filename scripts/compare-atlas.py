#!/usr/bin/env python3
"""Side by side: the current atlasglinn.com page against the new one, section for section — and the gate that fails.

Brockmann, 2026-09-08: "side bar = take the current site and drop into new design and see". So this is the seeing.
Left is the live page as captured in reference/live/<slug>.html — the real thing. Right is the page this repo now
serves. Both columns are read out of the same page by the same extractor, so a row that reads identically IS identical.

WHAT CHANGED IN r2, AND WHY. The r1 sheet measured live-minus-build only, over the CONTENT REGION only. Two whole
classes of defect were invisible to it: a unit the build INVENTED (nothing was ever subtracted from the build side),
and anything in the chrome (the extractor cut the page at the mobile menu and at <footer>, so the bar and the footer
were never read at all). It reported "12 pages / 0 deltas" while ep-app was missing its entire live footer and its
"Talk To A Coordinator" button, every page had lost the footer's "Resources" link, and eleven invented descriptor
lines rode the menu. A one-way test over two thirds of the page cannot see any of that.

So the sheet now reads the WHOLE VISIBLE PAGE — content, bar, mobile menu and footer — and compares it BOTH WAYS:

  live -> build   every visible unit the live page prints must be on the new page, counting repeats. No exceptions.
  build -> live   every visible unit the new page prints must be on the live page, counting repeats, EXCEPT the
                  chrome the cinematic shell contributes, which is the allowlist below and nothing else.

ALLOWLIST — the only build-only units permitted, per page, printed in the sheet and on stdout so a reader sees exactly
what was excused and can object to it:
  * the splash controls "Enter" and "Skip Intro →"
  * the splash wordmark, matched against the live splash's own <h1 id="intro-title"> string and nothing else
  * the back-to-top control "↑"
  * the menu controls "☰" and "×", and the sound toggle "🔇"
  * a chapter-rail label that repeats a heading inside the chapter it links to, or, where that chapter carries no
    heading at all, the chapter's own two-digit number
  * progress text of the form "NN / NN"
Media is compared the same way: every live image, film, poster and YouTube id must be carried, and the only build-only
media permitted is the logo mark the bar and the splash print, and the backdrop form of a YouTube id the live page
already embeds. An invented photograph or badge is a delta.

Writes atlas-compare.html at the repo root (tracked, noindex) and EXITS NON-ZERO on any delta. Run after
scripts/assemble-atlas.py:
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
LOGO_MARKS = ('Atlas-Glinn-Logo',)          # the bar's and the splash's mark, on every page of both sides
SKIP = ('Atlas-Glinn-Logo', 'chamber-badge', 'BEST_OF')   # the marks the block view does not draw thumbnails for
_TOK = re.compile(r'<(h[1-4])[^>]*>(.*?)</\1>|(?:src|poster)=["\']([^"\']+)["\']'
                  r'|background(?:-image)?:\s*url\((["\']?)([^)"\']+)\4\)', re.S | re.I)
_STRIP = re.compile(r'<(script|style)\b[^>]*>.*?</\1>|<!--.*?-->', re.S | re.I)
_RAIL = re.compile(r'<a class="agx-rail-link" href="#(agx-c\d+)"><span>(.*?)</span></a>', re.S)
_CH = re.compile(r'<div class="agx-ch[^"]*" id="(agx-c\d+)"[^>]*>', re.I)
_HEAD = re.compile(r'<(h[1-6])\b[^>]*>(.*?)</\1>', re.S | re.I)
_PROGRESS = re.compile(r'^\d{2} / \d{2}$')
_TWO = re.compile(r'^\d{2}$')
_YT_EMBED = re.compile(r'youtube(?:-nocookie)?\.com/embed/([\w-]+)')

SPLASH = ('Enter', 'Skip Intro →', '↑', '☰', '×', '\U0001f507')


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


def seen_media(markup):
    """Every image, film, poster and YouTube id a reader meets. Scripts and stylesheets are cut first — the live pages
    end in a GoDaddy tracker whose <script src> the media regex would otherwise read as a photograph — and so is the
    logo mark, which is chrome on both sides and is the one asset the new pages serve from the repo (images/atlas/…)
    rather than from wp-content. It is the same file; comparing the two URLs would report a delta that is not one.

    YouTube ids are the exception to the script cut, and cuas-aerodefense is why: the live page does not write an
    <iframe src> for fO8_EOUrSfg at all — it hands the id to the IFrame API in a script (capture :305/:310/:311), so
    an id read only outside scripts would report the live page as carrying no film and the build as inventing one."""
    seen = live.media(None, _STRIP.sub(' ', markup)) | {u for u in live.media(None, markup) if u.startswith('yt:')}
    return {u for u in seen if not any(k in u for k in LOGO_MARKS)}


def visible(html):
    """The whole visible page: everything inside <body>, chrome included. The r1 sheet cut this down to the content
    region, which is precisely why it could not see the footer it had replaced."""
    a = html.index('>', html.index('<body')) + 1
    return html[a:html.index('</body>')]


def read(page):
    with open(os.path.join(REPO, page), encoding='utf-8') as fh:
        return fh.read()


def missing(want, got):
    """What `want` has that `got` does not, counting repeats."""
    pool, out = list(got), []
    for x in want:
        if x in pool:
            pool.remove(x)
        else:
            out.append(x)
    return out


def rail_labels(markup):
    """{label: reason} for every chapter-rail label that is allowed to be build-only, checked against the chapter it
    actually links to — a label naming a heading no chapter carries is NOT excused. The heading is read the way the
    rail generator reads it (atlas_live._label: tags become a space), so a heading that wraps its question mark in a
    span matches its own rail label and nothing else does."""
    chapters, spans = {}, [m for m in _CH.finditer(markup)]
    for k, m in enumerate(spans):
        end = spans[k + 1].start() if k + 1 < len(spans) else len(markup)
        chapters[m.group(1)] = [re.sub(r'\s+', ' ', H.unescape(re.sub(r'<[^>]+>', ' ', h.group(2)))).strip()
                                for h in _HEAD.finditer(markup[m.end():end])]
    out = {}
    for anchor, lab in _RAIL.findall(markup):
        lab = clean(lab)
        heads = chapters.get(anchor, [])
        if lab in heads:
            out[lab] = 'rail label, repeats the chapter %s heading' % anchor[-2:].lstrip('c')
        elif not heads and _TWO.match(lab):
            out[lab] = 'rail tick, chapter %s carries no heading' % lab
    return out


def excuse(slug, added, markup):
    """(excused as [(unit, reason)], unexplained as [unit]) — the allowlist, applied unit by unit."""
    rails = rail_labels(markup)
    word = live.intro_title()
    ok, bad = [], []
    for u in added:
        if u in SPLASH:
            ok.append((u, 'splash / chrome control'))
        elif u == word:
            ok.append((u, 'splash wordmark, the live splash’s own <h1 id="intro-title">'))
        elif u in rails:
            ok.append((u, rails[u]))
        elif _PROGRESS.match(u):
            ok.append((u, 'progress text'))
        else:
            bad.append(u)
    return ok, bad


def excuse_media(added, live_media):
    ids = {u[3:] for u in live_media if u.startswith('yt:')}
    ok, bad = [], []
    for u in added:
        m = _YT_EMBED.search(u)
        if m and m.group(1) in ids:
            ok.append((u, 'backdrop form of the live page’s own YouTube %s' % m.group(1)))
        else:
            bad.append(u)
    return ok, bad


CSS = """
body{margin:0;background:#080c14;color:#e6e9ef;font:15px/1.45 -apple-system,Helvetica,Arial,sans-serif}
header{padding:1.2rem 1rem;border-bottom:1px solid #223}h1{font-size:1.2rem;margin:0 0 .4rem}
header p{margin:.25rem 0;color:#9aa3b2;font-size:.9rem}header code{color:#c9d3e4;font-size:.78rem}
nav a{color:#7fb0ff;margin-right:.8rem;font-size:.85rem;text-decoration:none}
section.page{border-bottom:1px solid #223;padding:1rem}
section.page h2{font-size:1.05rem;margin:0 0 .5rem}
section.page h2 a{color:#7fb0ff;font-weight:400;font-size:.85rem;margin-left:.6rem;text-decoration:none}
.verdict{font-size:.82rem;margin:0 0 .7rem;padding:.4rem .6rem;border-left:3px solid #2f6b3f;background:#0d1320;color:#9fe0b4}
.verdict.off{border-left-color:#a33;color:#f0a0a0}
.verdict ul{margin:.35rem 0 0 1rem;padding:0}
.excused{font-size:.75rem;margin:0 0 .7rem;padding:.4rem .6rem;border-left:3px solid #3a4a6b;background:#0b1020;color:#93a4c4}
.excused ul{margin:.3rem 0 0 1rem;padding:0}
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
        old, new = visible(live._read(slug)), visible(read(page))
        to, tn = text_units(old), text_units(new)
        mo, mn = seen_media(old), seen_media(new)
        lost_t, added_t = missing(to, tn), missing(tn, to)
        lost_m, added_m = sorted(mo - mn), sorted(mn - mo)
        ok_t, bad_t = excuse(slug, added_t, new)
        ok_m, bad_m = excuse_media(added_m, mo)
        ok = not (lost_t or lost_m or bad_t or bad_m)
        off += 0 if ok else 1
        print('%-24s text %3d/%3d live-carried  %2d build-only (%d excused, %d NOT)   media %2d/%2d  %2d build-only '
              '(%d excused, %d NOT)   %s'
              % (slug, len(to) - len(lost_t), len(to), len(added_t), len(ok_t), len(bad_t),
                 len(mo) - len(lost_m), len(mo), len(added_m), len(ok_m), len(bad_m), 'OK' if ok else 'DELTA'))
        print('    excused: %-52s  %s' % (repr('Atlas-Glinn-Logo…png'), 'logo mark, chrome on both sides (repo copy of the live file)'))
        for u, why in ok_t + ok_m:
            print('    excused: %-52s  %s' % (repr(u[:50]), why))
        for u in lost_t:
            print('    MISSING FROM BUILD: %s' % repr(u[:110]))
        for u in lost_m:
            print('    MEDIA MISSING FROM BUILD: %s' % u)
        for u in bad_t:
            print('    NOT ON THE LIVE PAGE: %s' % repr(u[:110]))
        for u in bad_m:
            print('    MEDIA NOT ON THE LIVE PAGE: %s' % u)
        detail = ''.join('<li>live only: %s</li>' % H.escape(x[:160]) for x in lost_t) \
            + ''.join('<li>live only, media: %s</li>' % H.escape(label(u)) for u in lost_m) \
            + ''.join('<li>build only: %s</li>' % H.escape(x[:160]) for x in bad_t) \
            + ''.join('<li>build only, media: %s</li>' % H.escape(u) for u in bad_m)
        excused = ''.join('<li>%s &mdash; %s</li>' % (H.escape(u[:80]), H.escape(w)) for u, w in ok_t + ok_m)
        menu.append('<a href="#%s">%s</a>' % (slug, slug))
        secs.append(
            '<section class="page" id="%s"><h2>%s'
            '<a href="https://atlasglinn.com/%s" target="_blank" rel="noopener">current site &#8599;</a>'
            '<a href="%s" target="_blank">new page &#8599;</a></h2>'
            '<p class="verdict%s">text %d/%d &middot; media %d/%d carried across &middot; %d build-only unit(s), '
            '%d excused by the allowlist%s</p>'
            '<p class="excused">Allowed build-only chrome on this page:<ul>%s</ul></p>'
            '<div class="cols"><div class="col"><h3>Current atlasglinn.com</h3>%s</div>'
            '<div class="col"><h3>New &mdash; same content, cinematic shell</h3>%s</div></div></section>'
            % (slug, page, '' if slug == 'index' else slug + '/', page,
               '' if ok else ' off', len(to) - len(lost_t), len(to), len(mo) - len(lost_m), len(mo),
               len(added_t) + len(added_m), len(ok_t) + len(ok_m),
               '' if ok else '<ul>%s</ul>' % detail, excused or '<li>none</li>',
               render(blocks(old)), render(blocks(new))))
    doc = ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
           '<meta name="viewport" content="width=device-width,initial-scale=1">'
           '<meta name="robots" content="noindex, nofollow">'
           '<title>Atlas Glinn &mdash; current site vs new design</title><style>%s</style></head><body>'
           '<header><h1>Atlas Glinn: the current site, side by side with the new design</h1>'
           '<p>Left is atlasglinn.com as captured. Right is the page this repo serves &mdash; the same content, the '
           'same stylesheet and the same films, inside the cinematic shell. Every visible unit is compared BOTH ways '
           'over the whole page, chrome included: nothing the live page prints may be missing, and nothing the new '
           'page prints may be absent from the live page unless it is one of the shell controls listed under each '
           'section.</p>'
           '<p><code>%s</code></p><nav>%s</nav></header>%s</body></html>'
           % (CSS, H.escape(stamp), ''.join(menu), ''.join(secs)))
    open(OUT, 'w', encoding='utf-8').write(doc)
    print('wrote atlas-compare.html %d bytes, %d pages, %d with a delta' % (len(doc.encode()), len(live.PAGES), off))
    return 1 if off else 0


if __name__ == '__main__':
    sys.exit(main())
