#!/usr/bin/env python3
"""The gate on the twelve rebuilt Atlas Glinn pages: every page, measured against its own live capture, five ways.

Brockmann, 2026-09-08: "side bar = take the current site and drop into new design and see". Left in the sheet is the
live page as captured in reference/live/<slug>.html — the real thing. Right is the page this repo serves. Both columns
are read out of the same page by the same extractor, so a row that reads identically IS identical.

WHAT IS MEASURED, over the WHOLE VISIBLE PAGE — content, bar, mobile menu and footer, everything inside <body>:

  1. TEXT, both ways, repeats counted.  Every visible unit the live page prints must be on the new page, and every
     visible unit the new page prints must be on the live page, except the build-only chrome named in the allowlist
     below and nothing else.
  2. ORDER.  The live page's text-unit sequence must be a SUBSEQUENCE of the build's. The same units in a different
     place — a footer hoisted above the content — is a delta even though both multisets match.
  3. ATTRIBUTE TEXT, both ways, repeats counted: alt, placeholder, value, title, aria-label and label, plus the text
     of <option> and <label> elements. A reader meets these too, and a test over element text alone cannot see a logo
     whose alt was re-typed.
  4. MEDIA, both ways.  Every live image, film, poster and YouTube id must be carried. A build-only URL is excused
     only when it names the SAME FILE as a live URL the build dropped (exact basename, each live URL consumed once)
     or is the backdrop form of a YouTube id the live page already embeds.
  5. HREFS, per anchor.  For every label the live page gives an anchor, the destinations the live page puts behind
     that label must equal the destinations the build puts behind it, counting repeats, after the live absolute URL
     is resolved by the build's own relink rule. The two deliberate §G-6 MAST redirects are the only exceptions and
     are printed per page.
  6. LAZY MEDIA ATTRIBUTES.  srcset and data-src are counted on both sides and printed per page. The media pass reads
     both (atlas_live._MEDIA, r4); srcset measures 0 on both sides on all twelve pages, and that 0 is asserted, so a
     future srcset is a delta somebody has to look at rather than a URL that slips past.

ALLOWLIST — the only build-only TEXT units permitted, printed per page in the sheet and on stdout so a reader sees
exactly what was excused and can object to it:
  * the splash controls "Enter" and "Skip Intro →" — ONLY where the unit is printed inside <button id="intro-enter">
    / <button id="skip-intro">, one spend per element (CONTROLS below)
  * the splash wordmark — ONLY inside <h1 id="intro-title">, once; on index it is the live splash's own <h1>, on the
    other eleven it is chrome the shell prints on every page, as the MAST page does, and it is named as such
  * the back-to-top control "↑" — ONLY inside <button id="back-to-top">, once
  * a chapter-rail label — and ONLY where the unit is printed INSIDE the <a class="agx-rail-link"> element whose
    label repeats a heading of the chapter it links to, one excuse per anchor. Position is the point: the same string
    dropped into a footer is not a rail label and is not excused.
And the only build-only ATTRIBUTE units permitted: the shell's own control labels (A11Y below) and the aria-label a
heading-less chapter's rail tick carries — one per label-less rail anchor, its value "Chapter NN" and nothing else.

MEDIA SET SEMANTICS, stated plainly: the media pass compares the SET of URLs each side carries. A film or photograph
the live page prints twice and the build once is NOT a delta here — element-count parity for media is not
implemented. Text and attribute units are counted with repeats; media is not. Anyone who needs media counted per
element extends live.media to return a multiset first.

DROPPED 2026-09-09 (R4-8, wording corrected R5 after the verifier measured it): the menu glyphs "☰" and "×" were
excused by string. They ARE printed — once on every built page and once on every live capture, as &#9776; and
&times; on the nav-toggle and mobile-nav-close buttons (a raw glyph grep of the markup finds nothing; the extractor's
unescape finds twelve of each) — so they match the live page in the both-ways TEXT pass and never needed an excuse.
The live buttons carry no aria-label, so the attribute pass has nothing to do with it. The excuse was a hole: with it,
a second "☰" anywhere on a page passed; without it, a second &#9776; in about's footer exits 1 and deleting the real
one exits 1 ("MISSING FROM BUILD"). The three splash/chrome controls that are build-only are no longer excused by
string either: each is bound to the element that earns it (CONTROLS) and spent once per page.

DROPPED 2026-09-09 (R4-4): the sound toggle "\U0001f507" and progress text "NN / NN" were excused by string, with no
position check, and MEASURED on the twelve pages neither was ever spent — the shell's own toggle is cut from the
script and .progress has no markup here. An excuse nothing uses is a hole nothing guards: either of those strings
dropped anywhere on a page would have passed. They are gone rather than anchored, because there is no element on
these pages to anchor them to.

Writes atlas-compare.html at the repo root (tracked, noindex) and EXITS NON-ZERO on any delta. Run after
scripts/assemble-atlas.py:
    python3 scripts/compare-atlas.py
"""
import collections
import html as H
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import atlas_live as live
import atlas_shell as atlas

REPO = live.REPO
OUT = os.path.join(REPO, 'atlas-compare.html')
SKIP = ('Atlas-Glinn-Logo', 'chamber-badge', 'BEST_OF')   # the marks the block view does not draw thumbnails for
_TOK = re.compile(r'<(h[1-4])[^>]*>(.*?)</\1>|(?:src|poster)=["\']([^"\']+)["\']'
                  r'|background(?:-image)?:\s*url\((["\']?)([^)"\']+)\4\)', re.S | re.I)
_STRIP = re.compile(r'<(script|style)\b[^>]*>.*?</\1>|<!--.*?-->', re.S | re.I)
_TAG = re.compile(r'<[^>]+>')
_RAIL_A = re.compile(r'<a class="agx-rail-link"([^>]*)>(.*?)</a>', re.S)
_RAIL_HREF = re.compile(r'href="#(agx-c\d+)"')
_CH = re.compile(r'<div class="agx-ch[^"]*" id="(agx-c\d+)"[^>]*>', re.I)
_HEAD = re.compile(r'<(h[1-6])\b[^>]*>(.*?)</\1>', re.S | re.I)
# The rail tick's aria-label and nothing else: the attribute excuse is bounded by VALUE as well as by position.
_TICK_LABEL = re.compile(r'Chapter \d\d')
# srcset / data-src, counted on both sides so a lazy attribute cannot carry a URL past the media pass unseen.
_SRCSET_ATTR = re.compile(r'\bsrcset\s*=', re.I)
_LAZY_ATTR = re.compile(r'\bdata-src\s*=', re.I)
_YT_EMBED = re.compile(r'youtube(?:-nocookie)?\.com/embed/([\w-]+)')
_A = re.compile(r'<a\b([^>]*)>(.*?)</a>', re.S | re.I)
_HREF = re.compile(r'\bhref=["\']([^"\']*)["\']', re.I)
_ATTR = re.compile(r'''\b(?:alt|placeholder|value|title|aria-label|label)\s*=\s*(["'])(.*?)\1''', re.S | re.I)
_ELEM = re.compile(r'<(option|label)\b[^>]*>(.*?)</\1>', re.S | re.I)
# Every emoji code point the captures carry. U+2300-23FF and U+2B00-2BFF are load-bearing: \u23f1 and \u2b50
# are both in ICON_SWAPS and both outside the usual U+1F300-1FAFF / U+2600-27BF ranges.
_EMOJI = re.compile('[\U0001F300-\U0001FAFF\u2600-\u27BF\u2B00-\u2BFF\u2300-\u23FF]')

# The printed chrome controls and the ONE element each may be printed in. A unit is excused only where it sits inside
# that element's own span, and each element is spent once per page — "Enter" dropped into a footer has no element
# to spend and is a delta. The wordmark is bound to #intro-title the same way (see excuse()).
CONTROLS = (('Enter', 'intro-enter'), ('Skip Intro →', 'skip-intro'), ('↑', 'back-to-top'))
WORDMARK_ID = 'intro-title'
_ID_ELEM = {i: re.compile(r'<(\w+)\b[^>]*\bid="%s"[^>]*>(.*?)</\1>' % re.escape(i), re.S | re.I)
            for i in [e for _u, e in CONTROLS] + [WORDMARK_ID]}

# The shell's own control labels — the only build-only attribute units that are not read off a live page. A tuple and
# not a set, because "Back to top" is two units: the button carries it as title and as aria-label.
A11Y = ('Main', 'Menu', 'Site menu', 'Close menu', 'Chapters', 'Back to top', 'Back to top')

# The two deliberate redirects (§G-6 / AG-5), and there are only two: the menu's IWA entry and the footer's MAST
# Solutions entry, both of which the live site points at its own pages. Matched on the label AND on the live
# destination, so the other anchors that also point at /training/ are untouched. On eleven pages this covers three
# anchors — the bar dropdown banner, the mobile menu item and the footer link — and two on ep-app, whose live footer
# carries no MAST Solutions link.
REDIRECTS = (('IWA Training Products', 'https://atlasglinn.com/training/shop/', 'https://www.mastsolutions.com/#gear'),
             ('MAST Solutions', 'training.html', 'https://www.mastsolutions.com/'))


def clean(t):
    return re.sub(r'\s+', ' ', H.unescape(re.sub(r'<[^>]+>', '', t))).strip()


def _blank(m):
    return ' ' * len(m.group(0))


def text_spans(markup):
    """(unit, start, end) for the visible text, one unit per run between tags, in the order a reader meets it. The
    offsets are into `markup` itself — scripts, styles and comments are blanked at their own length rather than
    replaced — so a unit's position is the position it holds on the page. That is what lets an excuse be tied to the
    element the unit is printed inside."""
    src = _STRIP.sub(_blank, markup)
    out, pos = [], 0
    for m in _TAG.finditer(src):
        t = re.sub(r'\s+', ' ', H.unescape(src[pos:m.start()])).strip()
        if t:
            out.append((t, pos, m.start()))
        pos = m.end()
    t = re.sub(r'\s+', ' ', H.unescape(src[pos:])).strip()
    if t:
        out.append((t, pos, len(src)))
    return out


def text_units(markup):
    return [t for t, _, _ in text_spans(markup)]


def attr_spans(markup):
    """(unit, start, end) for the attribute text a reader meets — alt, placeholder, value, title, aria-label, label —
    and for the text of <option> and <label> elements, in document order."""
    src = _STRIP.sub(_blank, markup)
    out = [(clean(m.group(2)), m.start(), m.end()) for m in _ATTR.finditer(src)]
    out += [(clean(m.group(2)), m.start(), m.end()) for m in _ELEM.finditer(src)]
    return sorted([(t, a, b) for t, a, b in out if t], key=lambda x: x[1])


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
    """Every image, film, poster and YouTube id a reader meets, the logo mark included. Scripts and stylesheets are
    cut first — the live pages end in a GoDaddy tracker whose <script src> the media regex would otherwise read as a
    photograph.

    The logo used to be dropped from BOTH sides by a substring match on its name, because the build serves it from the
    repo (images/atlas/…) and the live page from wp-content. Dropping by substring makes any URL carrying that
    substring invisible to this gate, invented or not, so it is compared by exact basename instead (see pair_media).

    YouTube ids are the exception to the script cut, and cuas-aerodefense is why: the live page does not write an
    <iframe src> for fO8_EOUrSfg at all — it hands the id to the IFrame API in a script (capture :305/:310/:311), so
    an id read only outside scripts would report the live page as carrying no film and the build as inventing one."""
    return live.media(None, _STRIP.sub(' ', markup)) | {u for u in live.media(None, markup) if u.startswith('yt:')}


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


def added_spans(spans, other):
    """The runs of `spans` that `other` does not print, counting repeats — `missing` with the positions kept."""
    pool, out = list(other), []
    for t, a, b in spans:
        if t in pool:
            pool.remove(t)
        else:
            out.append((t, a, b))
    return out


def out_of_order(want, got):
    """The units of `want` that cannot be matched in `got` without going backwards — what stops the live sequence
    from being a subsequence of the build's. Empty means the build prints the live page's units in the live page's
    own order."""
    pos, out = 0, []
    for x in want:
        try:
            pos = got.index(x, pos) + 1
        except ValueError:
            out.append(x)
    return out


def rail_anchors(markup):
    """Every <a class="agx-rail-link"> on the page: (anchor id, label, start, end, reason or None). The reason is set
    only where the label repeats a heading of the chapter the link actually points at — a label naming a heading no
    chapter carries is NOT excusable. The heading is read the way the rail generator reads it (atlas_live._label: tags
    become a space), so a heading that wraps its question mark in a span matches its own rail label and nothing else.
    A heading-less chapter prints no label at all, so it has nothing here to excuse and carries an aria-label the
    attribute pass excuses in its place."""
    chapters, spans = {}, list(_CH.finditer(markup))
    for k, m in enumerate(spans):
        end = spans[k + 1].start() if k + 1 < len(spans) else len(markup)
        chapters[m.group(1)] = [re.sub(r'\s+', ' ', H.unescape(re.sub(r'<[^>]+>', ' ', h.group(2)))).strip()
                                for h in _HEAD.finditer(markup[m.end():end])]
    out = []
    for m in _RAIL_A.finditer(markup):
        href = _RAIL_HREF.search(m.group(1))
        anchor = href.group(1) if href else ''
        lab = clean(m.group(2))
        reason = ('rail label, repeats the chapter %s heading' % anchor[-2:].lstrip('c')) \
            if lab and lab in chapters.get(anchor, []) else None
        out.append((anchor, lab, m.start(), m.end(), reason))
    return out


def icon_spans(slug, markup):
    """(start, end, class, glyph) of every LIVE glyph run this build swaps for an SVG, in document order.

    Position-anchored like every other excuse in this file: the run must sit inside an element whose class is one of
    atlas.ICON_CLASSES and whose whole content is that glyph, and the sequence must equal atlas.ICON_SWAPS[slug]
    element for element. A glyph anywhere ELSE on the live page is compared exactly as it always was, and a glyph
    dropped from a card the table does not name is still a MISSING FROM BUILD delta."""
    src = _STRIP.sub(_blank, markup)
    want, out = list(atlas.ICON_SWAPS.get(slug, ())), []
    for m in atlas.ICON_EL.finditer(src):
        g = clean(m.group(4))
        if g:
            out.append((m.start(4), m.end(4), m.group(3), g))
    got = [(c, g) for _s, _e, c, g in out]
    assert got == [(c, g) for c, g, _t in want], \
        '%s: the capture no longer matches ICON_SWAPS — %d live icon glyphs, %d declared' \
        % (slug, len(got), len(want))
    return out


def blank_icons(markup, icons):
    """`markup` with the declared glyph runs replaced by spaces of the same length — the same 70 positions the text
    pass withholds, withheld from the ANCHOR LABEL too. cuas-aerodefense is why: its blog card is one <a> whose
    label the live page opens with 📄, so with the glyph left in, the live label and the build label are different
    strings and the href pass reports the card's destination as dropped. Offsets are into the blanked-script copy,
    which is the same length as `markup`, so they index it directly."""
    out = list(markup)
    for a, b, _c, _g in icons:
        out[a:b] = ' ' * (b - a)
    return ''.join(out)


def icon_receipts(slug, new_markup):
    """The build's side of the swap: one <svg class="agx-icon" data-agx-glyph="..."> per declared swap, in the same
    order, and no emoji code point left inside any icon class."""
    keys = re.findall(r'<svg class="agx-icon"[^>]*data-agx-glyph="([0-9A-F-]+)"', new_markup)
    want = [atlas._glyph_key(g) for _c, g, _t in atlas.ICON_SWAPS.get(slug, ())]
    bad = []
    if keys != want:
        bad.append('svg receipts %r != declared %r' % (keys[:6], want[:6]))
    for m in atlas.ICON_EL.finditer(new_markup):
        if _EMOJI.search(H.unescape(m.group(4))):
            bad.append('emoji survives inside .%s' % m.group(3))
    return keys, bad


def control_spans(markup):
    """{element id: (start, end)} for the chrome controls and the wordmark — the FIRST element carrying each id, its
    offsets into `markup` (scripts blanked at their own length, as text_spans does, so the offsets agree). An id the
    page does not carry is simply absent, and the unit it would have excused is then a delta."""
    src = _STRIP.sub(_blank, markup)
    out = {}
    for i, rx in _ID_ELEM.items():
        m = rx.search(src)
        if m:
            out[i] = (m.start(), m.end())
    return out


def excuse(slug, added, rails, chrome):
    """(excused as [(unit, reason)], unexplained as [unit]) — the allowlist, applied unit by unit and POSITION by
    position. A rail label is excused only where the unit is printed inside the rail anchor that earns the excuse, and
    each anchor is spent once: a Counter keyed by the anchors themselves, never by the bare strings, so a second copy
    of the same string anywhere else on the page has nothing left to spend. The chrome controls and the wordmark are
    held to the same bar since r4 (2026-09-09): `chrome` is {element id: (start, end)} for the control elements the
    BUILD prints and the LIVE page does not (main() computes it from control_spans on both sides), each unit is
    excused only inside its own element, and each element is spent once. An element the live page carries too —
    index's own splash, with its <h1 id="intro-title">, "Enter" and "Skip Intro →" — is not chrome and is not here:
    its units are matched against the live page like any other, and a second copy of "Enter" printed anywhere on
    that page has no element left to spend."""
    word = live.intro_title()
    budget = collections.Counter(k for k, r in enumerate(rails) if r[4])
    elems = chrome
    spent = collections.Counter({i: 1 for i in elems})
    ok, bad = [], []
    for u, a, b in added:
        ctl = next((i for lab, i in CONTROLS if lab == u), None)
        if ctl is not None:
            s, e = elems.get(ctl, (None, None))
            if s is not None and spent[ctl] and s <= a and b <= e:
                spent[ctl] -= 1
                ok.append((u, 'chrome control, printed inside #%s' % ctl))
            else:
                bad.append(u)
        elif u == word:
            s, e = elems.get(WORDMARK_ID, (None, None))
            if s is not None and spent[WORDMARK_ID] and s <= a and b <= e:
                spent[WORDMARK_ID] -= 1
                ok.append((u, 'splash wordmark, the live splash’s own <h1 id="intro-title">' if slug == 'index' else
                           'splash wordmark inside #intro-title, chrome the shell prints on all twelve pages as the '
                           'MAST page does'))
            else:
                bad.append(u)
        else:
            hit = next((k for k, (_a, lab, s, e, r) in enumerate(rails)
                        if r and budget[k] and lab == u and s <= a and b <= e), None)
            if hit is None:
                bad.append(u)
            else:
                budget[hit] -= 1
                ok.append((u, rails[hit][4]))
    return ok, bad


def excuse_attrs(added, rails):
    """The same discipline for attribute text: the shell's control labels, spent one per declared unit, plus the
    aria-label a heading-less chapter's rail tick carries — excused only where it sits inside that tick's own tag,
    ONE unit per label-less anchor, and only where the value is "Chapter NN".

    Both bounds are r4 (2026-09-09). The r3 excuse was matched by position and nothing else: any number of attribute
    units, of any name and any value, printed inside a label-less a.agx-rail-link were excused — a second aria-label,
    a title, an invented alt, all of them. It is budgeted like excuse() now: a Counter keyed by the anchors
    themselves, so the second unit inside the same tick has nothing left to spend."""
    budget = collections.Counter(A11Y)
    ticks = collections.Counter(k for k, r in enumerate(rails) if not r[1])
    ok, bad = [], []
    for u, a, b in added:
        if budget[u]:
            budget[u] -= 1
            ok.append((u, 'shell control label'))
            continue
        hit = next((k for k, (_a, lab, s, e, _r) in enumerate(rails)
                    if not lab and ticks[k] and s <= a and b <= e), None)
        if hit is None or not _TICK_LABEL.fullmatch(u):
            bad.append(u)
        else:
            ticks[hit] -= 1
            ok.append((u, 'rail tick aria-label, chapter %s carries no heading and prints no label'
                       % rails[hit][0][-2:].lstrip('c')))
    return ok, bad


def lazy_attr_counts(markup):
    """(srcset attributes, data-src attributes) — how many lazy media attributes the markup carries."""
    return len(_SRCSET_ATTR.findall(markup)), len(_LAZY_ATTR.findall(markup))


def _basename(u):
    return re.split(r'[?#]', u)[0].rstrip('/').split('/')[-1]


def pair_media(lost, added, live_media):
    """(excused as [(url, reason)], still missing, still invented). A build-only URL is excused only when it is the
    backdrop form of a YouTube id the live page already embeds, or when it names exactly the same FILE as a live URL
    the build dropped — the logo, which the build serves from the repo and the live page from wp-content. Each live
    URL is consumed once, so images/atlas/INVENTED-Atlas-Glinn-Logo-fake.png pairs with nothing and is a delta."""
    ids = {u[3:] for u in live_media if u.startswith('yt:')}
    pool, ok, bad = list(lost), [], []
    for u in added:
        m = _YT_EMBED.search(u)
        if m and m.group(1) in ids:
            ok.append((u, 'backdrop form of the live page’s own YouTube %s' % m.group(1)))
            continue
        hit = next((x for x in pool if _basename(x) == _basename(u)), None)
        if hit is None:
            bad.append(u)
        else:
            pool.remove(hit)
            ok.append((u, 'same file as the live page’s %s, served from the repo' % hit))
    return ok, pool, bad


def _resolve(href):
    """A live href as the build must write it — resolved by the build's own rule (atlas_live._relink), so this asserts
    the rule was applied rather than re-implementing it."""
    m = _HREF.search(live._relink('href="%s"' % href))
    return m.group(1) if m else href


def anchor_pairs(markup, drop_rail=False):
    """(label, destination) for every anchor that prints a label, destinations resolved. The rail is dropped from the
    build side: its links are in-page fragments the live page never had, and its labels are already accounted for by
    the text allowlist."""
    out = []
    for m in _A.finditer(_STRIP.sub(_blank, markup)):
        if drop_rail and 'agx-rail-link' in m.group(1):
            continue
        lab = clean(m.group(2))
        if not lab:
            continue
        h = _HREF.search(m.group(1))
        out.append((lab, _resolve(h.group(1)) if h else ''))
    return out


def href_diff(old, new):
    """([(label, live destinations, build destinations)], [the allowlist line for each redirect]) — for every label
    the live page gives an anchor, the destinations behind it must match the build's, counting repeats, after the two
    allowlisted MAST redirects are applied to the live side."""
    L, B = collections.defaultdict(collections.Counter), collections.defaultdict(collections.Counter)
    used = collections.Counter()
    for lab, href in anchor_pairs(old):
        for name, src, dst in REDIRECTS:
            if name in lab and href == src:
                href = dst
                used[(name, src, dst)] += 1
                break
        L[lab][href] += 1
    for lab, href in anchor_pairs(new, drop_rail=True):
        B[lab][href] += 1
    bad = [(lab, dict(L[lab]), dict(B.get(lab, {}))) for lab in L if L[lab] != B.get(lab, collections.Counter())]
    lines = ['%s → %s, on %d anchor(s) labelled “%s”' % (src, dst, used[(name, src, dst)], name)
             for name, src, dst in REDIRECTS]
    return sorted(bad), lines


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


def dump_units(path):
    """{'units': {slug: [every live text unit the build carries as text]}, 'icons': {slug: swaps}} for
    scripts/render-audit.mjs, which asserts each unit renders a non-zero box at one of the two widths and each swap
    renders an <svg class="agx-icon">. Written by the extractor the sheet itself uses, so the browser pass cannot
    drift from the parity pass: `python3 scripts/compare-atlas.py --units <path>`.

    The swapped glyph units are WITHHELD, not excused: HIDDEN_ON_LIVE's bar is "the reason it is invisible AND the
    evidence the live page hides it", and that is false here — the live page shows them and this build replaces
    them. Putting them there would be the excuse-laundering that list exists to stop. They are asserted positively
    instead, by render-audit check 6."""
    import json
    data, icons = {}, {}
    for slug in live.PAGES:
        vis = visible(live._read(slug))
        cut = icon_spans(slug, vis)
        data[slug] = [t for t, a, b in text_spans(vis)
                      if not any(s <= a and b <= e for s, e, _c, _g in cut)]
        icons[slug] = len(cut)
    open(path, 'w', encoding='utf-8').write(json.dumps({'units': data, 'icons': icons}))
    print('wrote %s: %d pages, %d live text units, %d glyph units withheld as ICON_SWAPS '
          '(they render as <svg class="agx-icon">, asserted by render-audit check 6)'
          % (path, len(data), sum(len(v) for v in data.values()), sum(icons.values())))


def main():
    if '--units' in sys.argv:
        dump_units(sys.argv[sys.argv.index('--units') + 1])
        return 0
    stamp = open(os.path.join(live.LIVE, '_captured.txt'), encoding='utf-8').read().strip().split('\n')[0]
    secs, menu, off = [], [], 0
    for slug in live.PAGES:
        page = 'index.html' if slug == 'index' else slug + '.html'
        old, new = visible(live._read(slug)), visible(read(page))
        so, sn = text_spans(old), text_spans(new)
        to, tn = [t for t, _a, _b in so], [t for t, _a, _b in sn]
        ao, an = attr_spans(old), attr_spans(new)
        uo, un = [t for t, _a, _b in ao], [t for t, _a, _b in an]
        mo, mn = seen_media(old), seen_media(new)
        rails = rail_anchors(new)
        icons = icon_spans(slug, old)
        svg_keys, icon_bad = icon_receipts(slug, new)

        # The rail is separated from the body BEFORE anything is compared. A rail label repeats a heading the page
        # already prints, so a rail run left in the pool would satisfy the live page's own heading and push the
        # heading itself into the build-only list, where it would then fail for sitting outside a rail anchor. Every
        # live unit must be carried by the BODY; the rail's runs are build-only by construction and are excused, or
        # not, one anchor at a time.
        # The chrome controls are separated the same way, and for the same reason: matching is greedy in document
        # order, so a splash <h1>Atlas Glinn</h1> at the top of the build would consume the live page's own
        # "Atlas Glinn" (a chapter heading, the footer) and push THAT unit into the build-only list, where it sits
        # outside any control element and fails (measured on ten of twelve pages, 2026-09-09, the first time the
        # wordmark was bound to its element). Only the control elements the LIVE page does not carry are chrome:
        # index's live splash prints #intro-title, #intro-enter and #skip-intro itself, so on index those runs stay
        # in the body and are matched, not excused.
        chrome = {i: span for i, span in control_spans(new).items() if i not in control_spans(old)}
        outside = [(s, e) for _a, _l, s, e, _r in rails] + list(chrome.values())
        body = [x for x in sn if not any(s <= x[1] and x[2] <= e for s, e in outside)]
        chrome_runs = [x for x in sn if any(s <= x[1] and x[2] <= e for s, e in outside)]
        tb = [t for t, _a, _b in body]
        # The swapped glyphs are cut from the LIVE side before anything is compared, BY POSITION, exactly as the
        # rail is cut from the build side above. Every other live unit is still compared both ways, and the order
        # pass runs on the units the build actually carries.
        live_body = [x for x in so if not any(s <= x[1] and x[2] <= e for s, e, _c, _g in icons)]
        tlb = [t for t, _a, _b in live_body]
        lost_t, added_t = missing(tlb, tb), added_spans(body, tlb) + chrome_runs
        order = out_of_order(tlb, tb)
        lost_a, added_a = missing(uo, un), added_spans(an, uo)
        ok_t, bad_t = excuse(slug, added_t, rails, chrome)
        ok_a, bad_a = excuse_attrs(added_a, rails)
        extra_m = sorted(mn - mo)
        ok_m, lost_m, bad_m = pair_media(sorted(mo - mn), extra_m, mo)
        bad_h, redirects = href_diff(blank_icons(old, icons), new)
        # The media pass reads srcset candidates and data-src since r4. srcset MEASURES 0 on both sides of all twelve
        # pages today, so its absence is asserted: if either side ever grows one, this fails, and whoever added it
        # re-measures the pass rather than trusting a regex nobody has exercised. data-src is not asserted away — the
        # build carries ten (the lazy YouTube backdrops on cuas-aerodefense) and the media pass reads them by name.
        srcset_o, lazy_o = lazy_attr_counts(old)
        srcset_n, lazy_n = lazy_attr_counts(new)
        bad_srcset = srcset_o or srcset_n

        ok = not (lost_t or order or lost_a or lost_m or bad_t or bad_a or bad_m or bad_h or bad_srcset
                  or icon_bad)
        off += 0 if ok else 1
        # NEVER print len(to) as the numerator here: `to` counts the swapped glyphs, which are not carried as
        # text. The honest line is "N body units carried + K icon glyphs swapped = len(to) live units accounted".
        print('%-24s text %3d/%3d %2d build-only (%d ok, %d NOT)  icons %2d->%2d  '
              'attr %2d/%2d %2d build-only (%d ok, %d NOT)  '
              'media %2d/%2d %2d build-only (%d ok, %d NOT)  srcset %d/%d  data-src %d/%d  order %d  hrefs %d  %s'
              % (slug, len(tlb) - len(lost_t), len(tlb), len(added_t), len(ok_t), len(bad_t),
                 len(icons), len(svg_keys),
                 len(uo) - len(lost_a), len(uo), len(added_a), len(ok_a), len(bad_a),
                 len(mo) - len(lost_m), len(mo), len(extra_m), len(ok_m), len(bad_m),
                 srcset_o, srcset_n, lazy_o, lazy_n, len(order), len(bad_h), 'OK' if ok else 'DELTA'))
        for _s, _e, c, g in icons:
            print('    excused (icon swap): %-6s in .%-14s -> <svg class="agx-icon" data-agx-glyph="%s">'
                  % (repr(g), c, atlas._glyph_key(g)))
        for b in icon_bad:
            print('    ICON SWAP NOT HONOURED: %s' % b)
        for u, why in ok_t + ok_a + ok_m:
            print('    excused: %-52s  %s' % (repr(u[:50]), why))
        for line in redirects:
            print('    redirect allowlist: %s' % line)
        for u in lost_t:
            print('    MISSING FROM BUILD: %s' % repr(u[:110]))
        for u in order:
            print('    OUT OF ORDER (the live sequence is not a subsequence of the build): %s' % repr(u[:110]))
        for u in lost_a:
            print('    ATTRIBUTE MISSING FROM BUILD: %s' % repr(u[:110]))
        for u in lost_m:
            print('    MEDIA MISSING FROM BUILD: %s' % u)
        for u in bad_t:
            print('    NOT ON THE LIVE PAGE: %s' % repr(u[:110]))
        for u in bad_a:
            print('    ATTRIBUTE NOT ON THE LIVE PAGE: %s' % repr(u[:110]))
        for u in bad_m:
            print('    MEDIA NOT ON THE LIVE PAGE: %s' % u)
        for lab, l, b in bad_h:
            print('    HREF BEHIND %s  live=%s  build=%s' % (repr(lab[:60]), l, b))
        if bad_srcset:
            print('    SRCSET APPEARED (live %d, build %d): it measured 0 on both sides when the media pass learned '
                  'to read it (2026-09-09). Re-measure both sides, confirm every candidate URL is carried, then '
                  'update this assertion.' % (srcset_o, srcset_n))

        detail = ''.join('<li>live only: %s</li>' % H.escape(x[:160]) for x in lost_t) \
            + ''.join('<li>out of order: %s</li>' % H.escape(x[:160]) for x in order) \
            + ''.join('<li>live only, attribute: %s</li>' % H.escape(x[:160]) for x in lost_a) \
            + ''.join('<li>live only, media: %s</li>' % H.escape(label(u)) for u in lost_m) \
            + ''.join('<li>build only: %s</li>' % H.escape(x[:160]) for x in bad_t) \
            + ''.join('<li>build only, attribute: %s</li>' % H.escape(x[:160]) for x in bad_a) \
            + ''.join('<li>build only, media: %s</li>' % H.escape(u) for u in bad_m) \
            + ''.join('<li>href behind &ldquo;%s&rdquo;: live %s, build %s</li>'
                      % (H.escape(lab[:80]), H.escape(repr(l)), H.escape(repr(b))) for lab, l, b in bad_h) \
            + ('<li>srcset appeared (live %d, build %d) &mdash; re-measure the media pass</li>'
               % (srcset_o, srcset_n) if bad_srcset else '')
        excused = ''.join('<li>%s &mdash; %s</li>' % (H.escape(u[:80]), H.escape(w)) for u, w in ok_t + ok_a + ok_m) \
            + ''.join('<li>redirect allowlist: %s</li>' % H.escape(x) for x in redirects)
        menu.append('<a href="#%s">%s</a>' % (slug, slug))
        secs.append(
            '<section class="page" id="%s"><h2>%s'
            '<a href="https://atlasglinn.com/%s" target="_blank" rel="noopener">current site &#8599;</a>'
            '<a href="%s" target="_blank">new page &#8599;</a></h2>'
            '<p class="verdict%s">text %d/%d body units carried + %d icon glyph(s) swapped to '
            '&lt;svg class="agx-icon"&gt; = %d/%d live units accounted &middot; attributes %d/%d &middot; '
            'media %d/%d carried across &middot; '
            'order %s &middot; %d build-only unit(s), %d excused by the allowlist%s</p>'
            '<p class="excused">Allowed build-only chrome on this page:<ul>%s</ul></p>'
            '<div class="cols"><div class="col"><h3>Current atlasglinn.com</h3>%s</div>'
            '<div class="col"><h3>New &mdash; same content, cinematic shell</h3>%s</div></div></section>'
            % (slug, page, '' if slug == 'index' else slug + '/', page,
               '' if ok else ' off', len(tlb) - len(lost_t), len(tlb), len(icons),
               len(tlb) - len(lost_t) + len(icons), len(to), len(uo) - len(lost_a), len(uo),
               len(mo) - len(lost_m), len(mo), 'kept' if not order else 'BROKEN',
               len(added_t) + len(added_a) + len(extra_m), len(ok_t) + len(ok_a) + len(ok_m),
               '' if ok else '<ul>%s</ul>' % detail, excused or '<li>none</li>',
               render(blocks(old)), render(blocks(new))))
    doc = ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
           '<meta name="viewport" content="width=device-width,initial-scale=1">'
           '<meta name="robots" content="noindex, nofollow">'
           '<title>Atlas Glinn &mdash; current site vs new design</title><style>%s</style></head><body>'
           '<header><h1>Atlas Glinn: the current site, side by side with the new design</h1>'
           '<p>Left is atlasglinn.com as captured. Right is the page this repo serves &mdash; the same content, the '
           'same stylesheet and the same films, inside the cinematic shell. Every visible unit is compared BOTH ways '
           'over the whole page, chrome included, and so are the attribute text, the order the units are printed in, '
           'the media and the destination behind every anchor the live page labels. Nothing the live page prints may '
           'be missing, and nothing the new page prints may be absent from the live page unless it is one of the '
           'shell controls listed under each section.</p>'
           '<p><code>%s</code></p><nav>%s</nav></header>%s</body></html>'
           % (CSS, H.escape(stamp), ''.join(menu), ''.join(secs)))
    open(OUT, 'w', encoding='utf-8').write(doc)
    print('wrote atlas-compare.html %d bytes, %d pages, %d with a delta' % (len(doc.encode()), len(live.PAGES), off))
    return 1 if off else 0


if __name__ == '__main__':
    sys.exit(main())
