"""atlas_live.py — hand the classic shell one captured atlasglinn.com page, verbatim.

Brockmann, 2026-09-08, on the preview: "Atlasglinn is not rendering correctly the main site and the should go same font
and sizes into the new design + if video - NO hallucinations just use the new frontend - side bar = take the current site
and drop into new design and see - no changes to anything."

So the shape is settled: the classic shell (scripts/atlas_shell.py) keeps its sticky bar and dropdowns, its mobile menu,
its Enter / Skip Intro splash, its footer and its back-to-top control — and everything between the bar and the footer is
the current page, byte for byte. Its copy, its photographs, its films at their own URLs, its stylesheet and its type
scale. Nothing is re-authored, nothing is re-cut, nothing is swapped for a repo copy.

This module reads one snapshot under reference/live/ and returns the parts:
  head(slug)      the page's own title, description, keywords, canonical, og:*, robots, author, font links and JSON-LD
  styles(slug)    its <style> blocks verbatim, in order (the theme sheet is linked separately, see SHARED_CSS)
  content(slug)   everything between the live chrome boundaries — its own nav, mobile menu and footer removed and
                  nothing else touched, except internal links, which point at the sibling .html file
  scripts(slug)   the tail scripts the CONTENT owns; the live chrome's own scripts are cut out by name
  media(slug)     every image, film, poster and YouTube id the content carries — the parity list
The snapshots are tracked, so a build off main reproduces without the media branch; reference/live/_captured.txt records
when they were taken and from which commit of claude/desktop-assets.

Two rules run through all of it:

  MEDIA URLS ARE LEFT ABSOLUTE. The live page serves its photographs and films from https://atlasglinn.com/wp-content/…
  and those URLs are public and current. A repo copy is a different encode with a different byte count (the disaster
  hero is 44.6 MB live against 3.7 MB here) and a teaser is a different film altogether, so swapping either one in is
  exactly the "re-cut" he ruled out. The pages point at the live files.

  THE SHELL'S CSS NEVER REACHES THE CONTENT. chrome_css() takes the classic stylesheet and keeps only the rules that
  style the bar, the menu, the splash, the footer and the back-to-top button; every global (html, body, a, *) and every
  content rule (section.panel, h1.mega, .cta, .card, the hero block) is dropped by name, so the live body rule, the live
  type scale and the live components win because nothing later overrides them. audit_chrome_css() is the receipt: it
  lists the selectors that survived, and validate-live.py asserts in a real browser that not one of them matches an
  element outside the five chrome roots.
"""
import os
import re

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIVE = os.path.join(REPO, 'reference', 'live')

# The twelve pages the capture covers, in the order the compare sheet lists them.
PAGES = ['index', 'executive-protection', 'residential-protection', 'disaster-recovery', 'training', 'technology',
         'cuas-aerodefense', 'uas', 'about', 'careers', 'contact', 'ep-app']

# The live theme stylesheet every page links, served from the repo instead of the WordPress host so the pages carry
# their own type scale (reference/live/shared-styles.css → vendor/, linked by the same relative path from every page).
SHARED_CSS = 'vendor/atlasglinn-shared-styles.css'
SHARED_CSS_SRC = os.path.join(LIVE, 'shared-styles.css')
_SHARED_LINK = re.compile(r'''<link[^>]+shared-styles\.css[^>]*>''', re.I)

# A body link naming one of these slugs becomes the sibling file. Everything else — /training/shop/, /aimpoint-shop/,
# the one counter-drone article, any wp-content asset — stays exactly as the live page writes it.
LINK_TARGETS = dict([(s, 'index.html' if s == 'index' else s + '.html') for s in PAGES])
LINK_TARGETS['privacy'] = 'privacy.html'
LINK_TARGETS['terms'] = 'terms.html'

_HOST = r'(?:https?://(?:www\.)?atlasglinn\.com)?'
_SLUGLINK = re.compile(r'''(href=["'])%s/([a-z0-9-]+)/(?=["'#?])''' % _HOST)
_HOMELINK = re.compile(r'''(href=["'])(?:https?://(?:www\.)?atlasglinn\.com)?/(?=["'#?])''')

_STYLE = re.compile(r'<style[^>]*>.*?</style>', re.S | re.I)
_SCRIPT = re.compile(r'<script\b([^>]*)>(.*?)</script>', re.S | re.I)
_LDJSON = re.compile(r'<script[^>]+application/ld\+json[^>]*>.*?</script>', re.S | re.I)


def _read(slug):
    with open(os.path.join(LIVE, slug + '.html'), encoding='utf-8') as fh:
        return fh.read()


# ── Boundaries ────────────────────────────────────────────────────────────────────────────────────────────────────
# Every captured page has the same four landmarks in the same order: <body>, <nav id="main-nav">, the mobile menu that
# follows it, and <footer>. The chrome the shell replaces is everything before the mobile menu's closing tag and
# everything from <footer> on; the content is what sits between. index.html carries one more piece of chrome ahead of
# the bar — its own 3D intro overlay — and that is dropped with the rest of it.
def _content_span(html):
    nav = html.index('<nav id="main-nav"')
    mob = html.index('<div id="mobile-nav"', nav)
    depth, end = 0, None
    for t in re.finditer(r'<(/?)div\b', html[mob:]):
        depth += 1 if t.group(1) == '' else -1
        if depth == 0:
            end = mob + t.end()
            break
    assert end is not None, 'the mobile menu never closes'
    return html.index('>', end) + 1, html.index('<footer')


def _relink(html):
    html = _SLUGLINK.sub(lambda m: m.group(1) + LINK_TARGETS[m.group(2)] if m.group(2) in LINK_TARGETS else m.group(0), html)
    return _HOMELINK.sub(lambda m: m.group(1) + 'index.html', html)


def content(slug):
    """The live page between its own chrome, unmodified except that internal links name the sibling file."""
    html = _read(slug)
    a, b = _content_span(html)
    body = _relink(html[a:b].strip())
    for gone in ('<nav id="main-nav"', 'id="mobile-nav"', 'id="intro-overlay"', 'class="footer-container"'):
        assert gone not in body, '%s: live chrome leaked into the content (%s)' % (slug, gone)
    return body


def after_footer(slug):
    """The markup the live page prints after its footer — on eleven of the twelve that is the `>_` portal button,
    which is site content, not chrome, and would otherwise be the one text unit the new page dropped."""
    html = _read(slug)
    tail = html[html.index('</footer>') + len('</footer>'):html.index('</body>')]
    tail = _SCRIPT.sub('', tail)
    tail = re.sub(r'<!--.*?-->', '', tail, flags=re.S).strip()
    return _relink(tail)


# ── Head ──────────────────────────────────────────────────────────────────────────────────────────────────────────
def head(slug):
    """The page's own head, minus the two tags the shell writes itself (charset, viewport) and minus the theme
    stylesheet link, which becomes the repo copy. Returns the block of tags in the order the live page prints them."""
    html = _read(slug)
    hd = html[:html.index('</head>')]
    out = ['<title>%s</title>' % re.search(r'<title>(.*?)</title>', hd, re.S).group(1)]
    for m in re.finditer(r'<meta\s+(?:name|property)="([^"]+)"[^>]*>', hd):
        if m.group(1) not in ('viewport', 'charset'):
            out.append(m.group(0))
    for m in re.finditer(r'<link\b[^>]*>', hd):
        tag = m.group(0)
        if 'shared-styles.css' in tag:
            continue
        out.append(tag)
    out.append('<link rel="stylesheet" href="%s">' % SHARED_CSS)
    out += [m.group(0) for m in _LDJSON.finditer(hd)]
    return '\n'.join(out) + '\n'


def title(slug):
    return re.search(r'<title>(.*?)</title>', _read(slug), re.S).group(1)


def styles(slug):
    """The page's <style> blocks, verbatim and in order — its @import of the Google families, its component rules and
    the WordPress presets. Kept whole on purpose: a computed-style comparison against the live page can only come out
    equal if the page is carrying the same declarations."""
    hd = _read(slug)
    return [m.group(0) for m in _STYLE.finditer(hd[:hd.index('</head>')])]


def mono(slug):
    """The monospace family the page already pays to load, for the shell chrome's own small caps. Eleven pages request
    Inconsolata (and use it nowhere); ep-app requests Share Tech Mono. Neither is a new font on that page."""
    return 'Share Tech Mono' if 'Share+Tech+Mono' in _read(slug) else 'Inconsolata'


# ── Tail scripts ──────────────────────────────────────────────────────────────────────────────────────────────────
# Everything after </footer> is either the host's or the page's. The host's four are byte-identical on all twelve
# pages — GoDaddy's _trfq tracker, its click handler, its tccl-tti loader and Chrome's speculation rules — and none of
# them carries site behaviour. What is left is the page's own: its scroll reveal, its card tilt, its parallax helper,
# its gold-dust canvas, its form post. Those come across.
#
# Two pages mix live chrome into the same <script> as their content, so those blocks are cut by name. index.html holds
# its 3D intro, its enterSite() and its 3.5-second auto-enter in one block with the gold dust, the reveals, the photo
# strip and the capability form; ep-app.html ends its form script with a nav auto-hide that would fight the shell's
# bar by writing an inline transform. Cutting by marker rather than by line means a re-capture that moves the code
# still cuts the right thing, and an assert fires if a marker ever goes away.
SCRIPT_CUTS = {
    'index': [('// ── THREE.JS 3D INTRO ──', '// ── HERO GOLD DUST PARTICLES ──'),
              ('// Auto-enter after 12 seconds', '// ── CAPABILITY FORM AJAX ──')],
    'ep-app': [('// Nav auto-hide on scroll', None)],
}
# After the cuts, no kept script may still reach for a piece of chrome that is no longer on the page.
_CHROME_REFS = ('three-canvas', 'flying-logo', 'intro-overlay', 'intro-content', 'intro-enter', 'skip-intro',
                'enterSite', 'main-nav', 'THREE.')


def _is_host_boilerplate(attrs, body):
    return ('speculationrules' in attrs or 'src=' in attrs or '_trfq' in body
            or '_window$_t' in body or '_elem$target' in body)


def scripts(slug):
    """The tail scripts the content owns, chrome cut out."""
    html = _read(slug)
    tail = html[html.index('</footer>'):html.index('</body>')]
    kept = []
    for m in _SCRIPT.finditer(tail):
        attrs, body = m.group(1), m.group(2)
        if _is_host_boilerplate(attrs, body):
            continue
        for start, stop in SCRIPT_CUTS.get(slug, []):
            if start not in body:
                continue
            a = body.index(start)
            b = len(body) if stop is None else body.index(stop, a)
            body = body[:a] + body[b:]
        kept.append(body)
    for start, _ in SCRIPT_CUTS.get(slug, []):
        assert not any(start in b for b in kept), '%s: %r survived the cut' % (slug, start)
    for b in kept:
        for ref in _CHROME_REFS:
            assert ref not in b, '%s: a kept script still reaches for %s' % (slug, ref)
    return kept


# ── Media ─────────────────────────────────────────────────────────────────────────────────────────────────────────
_MEDIA = re.compile(r'''(?:src|poster)=["']([^"']+)["']|background(?:-image)?:\s*url\((['"]?)([^)'"]+)\2\)''', re.I)
_YT = re.compile(r'''(?:youtube(?:-nocookie)?\.com/(?:embed/|watch\?v=)|videoId:\s*['"])([\w-]{6,})''')


def media(slug, html=None):
    """Every image, film, poster and YouTube id the content carries, as the page writes them. The compare sheet lists
    this set on both sides and validate-live.py asserts the two sets are equal."""
    if html is None:
        html = content(slug)
    out = set()
    for m in _MEDIA.finditer(html):
        u = (m.group(1) or m.group(3) or '').strip()
        if u and not u.startswith('data:'):
            out.add(u)
    for m in _YT.finditer(html):
        out.add('yt:' + m.group(1))
    return out


def hero_media(slug, html=None):
    """The opening film's own src, or a YouTube id, or None where the page opens on a still."""
    if html is None:
        html = content(slug)
    v = re.search(r'<video\b[^>]*>.*?</video>|<video\b[^>]*>', html, re.S | re.I)
    if v:
        src = re.search(r'<source[^>]+src=["\']([^"\']+)', v.group(0)) or re.search(r'\bsrc=["\']([^"\']+)', v.group(0))
        if src:
            return src.group(1)
    y = _YT.search(html)
    return 'yt:' + y.group(1) if y else None


# ── The shell stylesheet, cut down to the chrome ──────────────────────────────────────────────────────────────────
# Everything the classic shell styles that is NOT the bar, the menu, the splash, the footer or the back-to-top button
# is dropped here by name. Two kinds go: the globals, because the live body rule has to win (the shell sets a font
# stack, a background and cursor:none on html,body and a colour on every a), and the content rules, because the
# content is the live page's and is already styled by the live page's own sheet. section.panel, h1.mega, .cta and the
# shell's hero block have no markup to match on a live page anyway; #sound-toggle and .hero-media do, which is exactly
# why they are named.
DROP_SELECTORS = frozenset([
    # globals — the live page's own body, reset and link rules have to win
    'html, body',
    # the shell's hero block: the live hero is the live page's own <section class="hero">, film and toggle included
    'section.hero', 'section.hero > div', '.hero-media', '.hero-media video, .hero-media .still',
    '.hero-media .still', '.hero-media iframe', '.hero-scrim',
    '#sound-toggle', '#sound-toggle:hover', '#sound-toggle.on',
    # one-scroll furniture with no markup on a live page, and the read-position line the shell draws over the bar
    'section.panel', '.progress', '.scroll-cue',
    # the custom pointer: cursor:none is gone with html,body, so the reticle and its cursor overrides go too
    '.reticle', '.cta, .cta-button, .secondary-cta, .qty button, .nav-logo, .nav-links a',
])
# The five roots the chrome is allowed to touch. validate-live.py resolves every surviving selector against a rendered
# page and fails if one matches an element outside them.
CHROME_ROOTS = ('#intro-overlay', '#main-nav', '#mobile-nav', 'footer.site-footer', '#back-to-top')

_COMMENT = re.compile(r'/\*.*?\*/', re.S)


def _norm(sel):
    return re.sub(r'\s+', ' ', sel).strip()


def _rules(css):
    """(selector, body) for each top-level rule; an @media block comes back whole as one entry."""
    out, depth, buf = [], 0, ''
    for ch in css:
        buf += ch
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                sel, _, rest = buf.partition('{')
                out.append((_norm(sel), rest[:-1]))
                buf = ''
    assert not buf.strip(), 'unbalanced CSS'
    return out


def _block(css, opener):
    """The rule that starts with `opener`, braces balanced — @keyframes nests, so a regex cannot cut it."""
    a = css.index(opener)
    depth, i = 0, a
    while True:
        if css[i] == '{':
            depth += 1
        elif css[i] == '}':
            depth -= 1
            if depth == 0:
                return css[a:i + 1]
        i += 1


def _filter(css, seen):
    out = []
    for sel, body in _rules(css):
        if sel.startswith('@media'):
            inner = _filter(body, seen)
            if inner.strip():
                out.append('%s {%s}' % (sel, inner))
            continue
        if sel.startswith('@'):
            out.append('%s {%s}' % (sel, body))
            continue
        if sel in DROP_SELECTORS:
            seen.add(sel)
        else:
            out.append('%s {%s}' % (sel, body))
    return '\n'.join(out)


def chrome_css(mono_family='Inconsolata'):
    """The classic chrome's stylesheet: its custom properties, the sparkle ring, the shimmer keyframes and every rule
    from atlas_shell that styles the bar, the menu, the splash, the footer or the back-to-top button. Nothing else."""
    import atlas_shell as atlas
    import cinematic_shell as shell
    # The palette is declared on the five chrome roots, not on :root. ep-app.html's own stylesheet declares --gold and
    # --blue on :root and its content reads them; a second :root later in the cascade would repaint that page's cards
    # and headings in the shell's blue. Declared on the roots, the chrome inherits the palette and the content keeps
    # its own. (Measured: ep-app content elements came back rgb(26,107,222) against the live rgb(201,168,76).)
    palette = _block(shell.CSS_A, ':root {')
    palette = ', '.join(CHROME_ROOTS) + palette[palette.index(' {'):]
    parts = [palette] + [_block(shell.CSS_A, tok) for tok in ('.intro-ring {', '@keyframes shimmer {')]
    seen = set()
    body = _filter(_COMMENT.sub('', atlas.CLASSIC_CSS), seen)
    missing = DROP_SELECTORS - seen
    assert not missing, 'atlas_shell.CLASSIC_CSS no longer carries %s — decide which side of the line it is on' % sorted(missing)
    css = '\n'.join(parts + [body])
    css = shell._recolor(css, shell.ATLAS) + atlas.CLASSIC_RAW_CSS
    # The shell hides the pointer and draws a reticle in its place; the live pages do not, and html,body is dropped
    # above, so cursor:none here would only blank the pointer over the chrome's own links.
    css = css.replace('cursor:none', 'cursor:pointer')
    # The chrome's small caps take the mono the page already loads. Adding a face the live site does not request is
    # the "same font" line he drew, and Share Tech Mono is an ep-app font on the live site, not a site-wide one.
    return css.replace("'Share Tech Mono',monospace", "'%s',monospace" % mono_family)


def audit_chrome_css(css=None):
    """Every selector that survived the cut, for the record and for the browser check."""
    sels = []
    for sel, body in _rules(css if css is not None else chrome_css()):
        if sel.startswith('@media'):
            sels += [s for s, _ in _rules(body)]
        elif not sel.startswith('@'):
            sels.append(sel)
    return [s.strip() for s in sels]


# ── The chrome's behaviour ────────────────────────────────────────────────────────────────────────────────────────
# The classic script minus its sound toggle: five of the twelve live pages ship their own #sound-toggle button and the
# script that works it, inside the content, and both come across verbatim. Binding a second handler to the same button
# would mute and unmute it on one click.
_SOUND_A = '  // ── Hero sound toggle'
_SOUND_B = '  // ── Back to top ──'
# The live index auto-enters 3.5 seconds after load; the classic splash waits for a click, which on a phone is a black
# screen until someone taps it. The live timer comes across with the rest of the live behaviour.
_AUTO_ENTER = """
  // The live site enters by itself after 3.5s (atlasglinn.com index.html); Enter and Skip Intro still work first.
  if (intro && !seen && !reduce) setTimeout(function () { if (!intro.classList.contains('hidden')) enterSite(); }, 3500);
"""


def chrome_js():
    import atlas_shell as atlas
    js = atlas.CLASSIC_JS
    a, b = js.index(_SOUND_A), js.index(_SOUND_B)
    js = js[:a] + js[b:]
    assert 'sound-toggle' not in js, 'the classic script still binds the sound toggle'
    close = js.rindex('})();')
    return js[:close] + _AUTO_ENTER + js[close:]


def intro_overlay(eyebrow, wordmark, tagline):
    """The classic splash on its own — the shell's own markup, cut before the canvas, the photo layer, the grain, the
    vignette, the read-position line and the reticle. Those five sit fixed over the whole viewport and would tint,
    grain and cover the live page; the splash is the only piece of that block the new design needs."""
    import atlas_shell as atlas
    full = atlas.chrome(eyebrow, wordmark, tagline, [])
    intro = full[:full.index('<canvas id="three-canvas">')]
    assert intro.rstrip().endswith('</div>') and 'id="skip-intro"' in intro, 'the shell splash no longer ends where it did'
    return intro.rstrip() + '\n'


def intro_ring_js():
    """The sparkle ring around the splash wordmark — the shell's own, lifted out of its three.js module because the
    ring is plain 2D canvas and needs nothing else. The rest of that module (the emblem scene, the photo layer, the
    scroll camera) styles and covers the page body, so it has no place over live content."""
    import atlas_shell as atlas
    import cinematic_shell as shell
    src = shell.THREE_JS
    ring = src[src.index('// Gold ring'):src.index('// ── Reticle ──')]
    assert atlas._FADE_OLD in ring and atlas._STOP_OLD in ring, 'the gold ring no longer fades on the trailer schedule'
    ring = ring.replace(atlas._FADE_OLD, atlas._FADE_NEW).replace(atlas._STOP_OLD, '')
    pre = ("var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;\n"
           "var mobile = matchMedia('(max-width: 768px)').matches;\n")
    return '(function(){\n' + pre + ring + '})();\n'
