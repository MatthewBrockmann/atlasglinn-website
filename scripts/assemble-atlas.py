#!/usr/bin/env python3
"""Assemble the Atlas Glinn pages: the classic shell around the current atlasglinn.com page, verbatim.

Brockmann, 2026-09-08, on the preview: "Atlasglinn is not rendering correctly the main site and the should go same font
and sizes into the new design + if video - NO hallucinations just use the new frontend - side bar = take the current
site and drop into new design and see - no changes to anything."

LIVE-CONTENT MODE IS THE DEFAULT AND IS WHAT SHIPS. Each page is the TRAILER's chrome — the four-corner HUD, the
"MENU ☰" overlay, the standing chapter rail, the Enter / Skip Intro splash, the footer, the back-to-top button —
wrapped around the
live page taken whole from reference/live/<slug>.html (it read "the classic shell's chrome — the sticky bar with its
dropdowns, the mobile menu, …" until 2026-09-09, when Brockmann reversed the 2026-09-08 call over two screenshots:
"the frontend should be the same with the Tesla as a styled"): its head, its stylesheet, its <style> blocks, its copy, its
photographs, its films at their own atlasglinn.com URLs, its own scripts. Nothing is rewritten and nothing is re-cut.
scripts/atlas_live.py does the reading and keeps the shell's stylesheet off the content; scripts/atlas_shell.py is the
chrome; mastsolutions.html is untouched.

  python3 scripts/assemble-atlas.py             writes preview/<page>.html  (noindex, assets via ../)
  python3 scripts/assemble-atlas.py --publish   writes <page>.html at the site root, and build-manifest.json
  python3 scripts/assemble-atlas.py --authored  the hand-authored chapters below instead — DEPRECATED, see next para

DEPRECATED — the hand-authored chapters. Everything from `def opening(` down to the end of this file writes the pages
from copy typed here, against an April 2026 reading of the site. That is what made the preview diverge from the live
site: rewritten headings, a rewritten Atlas EP price table, a six-second re-cut in place of the home film. It is kept
behind --authored for one release so a diff against it is possible, and then it goes. Do not add to it, and do not fix
a live-content problem by editing it — fix reference/live/ or scripts/atlas_live.py.

The twelve pages either mode writes: index, executive-protection, residential-protection, disaster-recovery, training,
technology, cuas-aerodefense, uas, about, careers, contact, ep-app. signup.html is not generated here.
"""
import html as html_mod
import os, re, sys
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLISH = '--publish' in sys.argv
AUTHORED = '--authored' in sys.argv
OUT_DIR = '' if PUBLISH else 'preview/'
# Preview pages sit one folder down, so root-level assets and the hand-authored pages need a ../ in front. The eleven
# rebuilt pages link to each other by bare name and stay inside preview/.
_ROOT_REFS = re.compile(r'''((?:src|href|poster)=")(images/|vendor/|mastsolutions|privacy\.html|terms\.html|signup\.html|ep-app\.html|mast-capability)''')
def _previewize(html):
    html = _ROOT_REFS.sub(r'\1../\2', html).replace("url('images/", "url('../images/")
    html = html.replace("from './vendor/three.module.js'", "from '../vendor/three.module.js'")   # the shell's three.js import
    assert "'./" not in html and '"./' not in html, 'a ./ reference survived previewizing'
    return html.replace('<meta name="robots" content="index, follow">', '<meta name="robots" content="noindex, nofollow">', 1)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cinematic_shell as shell
import atlas_shell as atlas
import atlas_live as live
import build_manifest

# The emoji ranges used to be compiled HERE as well, for an assert that walked icon classes. That assert is gone
# (see D below) and so is the third copy of the pattern: the ranges live in `atlas_shell._EMOJI_ONLY` and
# `compare-atlas._EMOJI`, and two copies of a pattern set is already one more than this repo wants. U+2300-23FF and
# U+2B00-2BFF stay load-bearing in both — ⏱ U+23F1 (APPLE WATCH ULTRA 2) and ⭐ U+2B50 (Leadership) are declared
# swaps and both sit outside the usual U+1F300-1FAFF / U+2600-27BF ranges.

API = 'https://mast-booking-backend.matthew-221.workers.dev'
SITE = 'https://atlasglinn.com/'
PHONE, TEL, EMAIL = '(281) 654-8100', 'tel:+12816548100', 'atlasglinn.hq@atlasglinn.com'
ADDRESS = '2450 Fondren Rd, Suite 255 &middot; Houston, TX 77063'

# Approved Atlas Glinn imagery: exactly what the current atlasglinn.com pages use, section for section. Brockmann,
# 2026-09-04: no MAST photos on Atlas pages and nothing that is not already on the site. Every photo layer, tile and
# portrait below comes from this list; the Atlas assembler must never reach into images/mast/.
# The files are the site's own WordPress uploads, handed off from the Mac on 2026-09-05 (reference/desktop on
# claude/desktop-assets) and kept under images/atlas/ by their WordPress names, so the pages serve them from the repo.
A = 'images/atlas/'
HERO_EP       = A + 'Atlas-Glinn-Executive-Protection-scaled.jpeg'   # EP page hero; home Executive Protection card
EP_MATTERS    = A + 'Executive-Protection.jpg'                       # EP page "Protecting What Matters Most"
CCTV          = A + 'closeup-cctv-camera-wall-min-1024x683.jpg'      # home Residential + AI Surveillance cards
PROTECTION    = A + 'Atlas-Glinn-Protection.png'                     # home Secure Transport card; disaster page
TRAINING      = A + 'Atlas-Glinn-Training-1024x951.jpeg'             # home Training Programs card
AG3           = A + 'Atlas-Glinn-3.jpg'                              # home Disaster Recovery card
RESI_COVERAGE = A + 'Screen-Shot-2025-03-25-at-12.41.58-PM.png'      # residential Comprehensive Coverage
# The WordPress file named after him is the detail at a press line (a scene, not a portrait): Brockmann, 2026-09-05,
# "This is not my picture from atlasglinn.com". The About portrait is the MAST Instructors picture he approved
# (Brockmann, 2026-09-06, asked which of the two: "MAST portrait"); the live About page's matt-ceo-2026.jpg stays in
# images/atlas/ as FOUNDER_LIVE, unused.
FOUNDER_SCENE = A + 'Matthew-Brockmann-Atlas-glenn-security-ceo-protection1-scaled-e1741887403903.jpeg'
FOUNDER       = 'images/team/brockmann.jpg'
FOUNDER_CROP  = 'background-size:auto 118%;background-position:64% 22%'   # same framing as the MAST page; keeps the photographer's mark out of frame
FOUNDER_LIVE  = A + 'matt-ceo-2026.jpg'
CLINE         = A + 'Cline-Bio-Pic-1024x819.jpg'
GLOVER        = A + 'anthony-glover.png'                             # live About page, theme folder (capture-live, 2026-09-05)
CAREERS_HERO  = A + 'IMG_0398.jpg'                                   # the live Careers page's photograph (theme gallery; capture-live 2026-09-06); IMG_0396 was the April build's
AI_SURV       = A + 'AI-surveillance-1.png'                          # technology Deep Sentinel section
AERO          = A + 'AeroDefense-Partner-Atlas-Glinn.jpeg'
UAS_IMG       = A + 'Technology-UAS-1.png'
LOGO          = A + 'Atlas-Glinn-Logo-Rev1-1.png'
LOGO_MARK     = A + 'Atlas-Glinn-Logo-Rev1-2-e1744918824251.png'   # the mark the live site carries in its nav, on every page
BADGE_BEST    = A + 'BEST_OF_BusinessRate_2025_Atlas_Glinn.png'
FILM_POSTER   = 'images/film/atlas-glinn-and-mast-solutions-poster.jpg'       # frame of the home-page film
ABOUT_POSTER  = 'images/film/about-atlas-glinn-poster.jpg'                    # frame of the About film
# The current home and About pages open on a background film; the rebuilt pages open on the same films as six-second snippets
# behind the opening chapter (Brockmann, 2026-09-05: "the video should be in the background, just a snippet playing").
# technology, uas and contact open on films the live site serves from its theme folder; capture-live brought the files
# over on 2026-09-05 and they are in images/film/ (plain files, not LFS). No ffmpeg in the container, so they play whole,
# as the live site plays them, behind the still named beside each one; the About "In Action" clips are the live page's two.
FILM_TEASER   = 'images/film/atlas-glinn-and-mast-solutions-teaser.mp4'
ABOUT_TEASER  = 'images/film/about-atlas-glinn-teaser.mp4'
FILM_TECH     = 'images/film/technology-hero.mp4'          # live technology and uas heroes
FILM_CONTACT  = 'images/film/corporate-buildings.mp4'      # live contact hero
FILM_RESI     = 'images/film/residential-hero.mp4'         # live residential hero (capture-live, 2026-09-06)
FILM_TRAIN    = 'images/film/training-hero.mp4'            # live training hero (capture-live, 2026-09-06)
FILM_DISASTER = 'images/film/disaster-hero.mp4'            # live disaster hero (capture-live, 2026-09-06; 44 MB as the live site serves it — a Mac session with ffmpeg can shrink it)
CLIP_TEAM     = 'images/film/careers-gallery.mp4'          # About "Atlas Glinn Team" clip
CLIP_FORGE    = 'images/film/forge-legend-mast.mp4'        # About "MAST Solutions — Forge & Legend" clip
# Pages whose current hero is a YouTube film keep that film as the first card of chapter 2.
YT_RESIDENTIAL, YT_DISASTER, YT_TRAINING, YT_CUAS = 'bn2eWWJzlDY', 'mI7Ou5P-WHE', 'jwQ5OyKEKwg', 'fO8_EOUrSfg'
def shimmer(t):
    """The live site's hero wordmark: "Details" in the moving gold shimmer (atlasglinn.com .gold-shimmer), "Matter." in blue."""
    return f'<span class="gold-shimmer">{t}</span>'

# Appended after the palette recolor so the gold literals survive (the page is blue everywhere else).
HERO_CSS = """
  h1.mega .gold-shimmer { background:linear-gradient(90deg, #BF953F 0%, #FCF6BA 25%, #B38728 50%, #FBF5B7 75%, #AA771C 100%); background-size:1000px 100%; animation:shimmer 6s linear infinite; -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; text-shadow:0 0 80px rgba(201,168,76,.3); }
  h1.mega .white { color:#1A6BDE; }
  @media (prefers-reduced-motion: reduce) { h1.mega .gold-shimmer { animation:none; } }
"""

def yt_card(vid, title, sub, end=None):
    """end: stop the player at that second (the Training Reel's closing "2023" card is cut this way until the file is local)."""
    return (f'<div class="yt-grid one rise"><div class="yt-card"><div class="frame"><iframe src="https://www.youtube.com/embed/{vid}?rel=0&amp;modestbranding=1&amp;playsinline=1{"&amp;end=%d" % end if end else ""}" title="{title}" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>'
            f'<div class="info"><h4>{title}</h4><p>{sub}</p></div></div></div>')

# The live site's top bar, item for item (capture-live: reference/desktop/live/index.html <nav id="main-nav">). The
# Training dropdown carries the two banners the live menu carries; Aimpoint Optics is the third on the live site and
# stays hidden here (owner, 2026-09-07: "hide Aimpoint for now"). No live page's bar has a Sign in. The descriptor on
# each item is the line the live menu prints under its label, word for word; Technology carries the live menu's
# Counter-Drone, Autonomous UAS and Atlas EP App entries, so uas.html is one tap from every page.
TOPNAV = [
    ('index.html', 'Home', None, 'Atlas Glinn, LLC'),
    ('executive-protection.html', 'Executive Protection', None, 'Dignitary and close protection'),
    ('residential-protection.html', 'Residential Protection', None, 'Estates, guard force, AI surveillance'),
    ('disaster-recovery.html', 'Disaster Recovery', None, 'Asset protection when it counts'),
    ('training.html', 'Training', [
        ('training.html', '&#9881;', 'Training Programs', 'EP, firearms, tactical &amp; security courses'),
        ('https://www.mastsolutions.com/', '&#127919;', 'MAST Solutions', 'Book a course'),
        ('https://www.mastsolutions.com/#gear', '&#128163;', 'IWA Training Products', 'Flashbangs, smoke &amp; diversionary devices'),
    ], 'EP, firearms, tactical &amp; security courses'),
    ('technology.html', 'Technology', [
        ('technology.html', '&#128225;', 'Technology', 'Atlas EP, AI surveillance, drones'),
        ('cuas-aerodefense.html', '&#128737;', 'Counter-Drone', 'AirWarden by AeroDefense'),
        ('uas.html', '&#128641;', 'Autonomous UAS', 'Sunflower Labs'),
        ('ep-app.html', '&#128241;', 'Atlas EP App', 'Now in Early Access'),
    ], 'Atlas EP, AI surveillance, drones'),
    ('about.html', 'About', None, 'Mission and team'),
    ('careers.html', 'Careers', None, 'Open positions'),
    ('contact.html', 'Contact Us', 'cta', PHONE),
    ('privacy.html', 'Privacy Policy', 'mobile', 'What we keep, and for how long'),
]

def _topnav_lists():
    """TOPNAV in the two-list shape nav() takes. Only the deprecated --authored path reads it; the twelve pages that
    ship take their bar and their menu off the capture (atlas_live.nav_items)."""
    bar, mobile = [], []
    for href, label, kind, _desc in TOPNAV:
        drop = kind if isinstance(kind, list) else None
        if kind != 'mobile':
            bar.append((href, label, None if drop else kind, drop))
        mobile.append((href, label, False))
        if drop:
            mobile += [(h, t, True) for h, _ic, t, _d in drop if h != href]
    return bar, mobile


SOCIAL_LINKS = [('https://www.instagram.com/atlasglinn_mastsolutions/', 'Instagram'),
                ('https://www.linkedin.com/in/mastsolutions1/', 'LinkedIn'),
                ('https://www.youtube.com/@atlasglinn', 'YouTube'),
                ('https://www.facebook.com/mastsolutions', 'Facebook'),
                ('https://www.yelp.com/biz/atlas-glinn-houston', 'Yelp')]
SOCIAL_ROW = ''.join(f'<a href="{u}" target="_blank" rel="noopener">{t}</a>' for u, t in SOCIAL_LINKS) + shell.REVIEW_LINK


def badge_pair(cls):
    """The live site's two badges: the image with its caption under it, as the current pages print them."""
    return (f'<div class="{cls}">'
            f'<div class="badge-item"><img src="{BADGE_BEST}" alt="Best of Business 2025" loading="lazy"><p>Best of Business 2025</p></div>'
            '<div class="badge-item"><img src="images/chamber-badge.png" alt="Chamber of Commerce Verified Member" loading="lazy"><p>Chamber of Commerce</p></div></div>')

# The live footer, closing every page: the two badges, its four link groups, the address block with the socials, and
# the rights line. Same links, same wording, in the shell's type.
FOOTER_GROUPS = [
    ('Atlas Glinn', [('index.html', 'Home'), ('executive-protection.html', 'Executive Protection'), ('residential-protection.html', 'Residential Protection'),
                     ('disaster-recovery.html', 'Disaster Recovery'), ('technology.html', 'Technology'), ('ep-app.html', 'Atlas EP App')]),
    ('MAST Solutions', [('training.html', 'Training Programs'), ('ep-app.html', 'Atlas EP Platform'), ('cuas-aerodefense.html', 'Counter-Drone Solutions'), ('uas.html', 'Autonomous UAS'), ('https://www.mastsolutions.com/', 'MAST Solutions')]),
    ('Company', [('about.html', 'About Us'), ('careers.html', 'Careers'), ('contact.html', 'Contact')]),
]


def site_footer():
    groups = ''.join('<div class="footer-section"><h4>%s</h4><ul>' % head
                     + ''.join(f'<li><a href="{u}">{t}</a></li>' for u, t in links) + '</ul></div>'
                     for head, links in FOOTER_GROUPS)
    connect = ('<div class="footer-section"><h4>Connect</h4>'
               f'<p>2450 Fondren Rd, Suite 255<br>Houston, TX 77063<br><a href="{TEL}">{PHONE}</a><br><a href="mailto:{EMAIL}">{EMAIL}</a></p>'
               f'<div class="footer-social">{SOCIAL_ROW}</div></div>')
    return (badge_pair('footer-awards') + '<div class="footer-grid">' + groups + connect + '</div>'
            + '<div class="footer-bottom">'
            '<a href="https://atlasglinn-site.matthew-221.workers.dev/portal" style="color:inherit;text-decoration:none">&copy;</a> '
            '2026 Atlas Glinn, LLC | MAST Solutions. All Rights Reserved. Executive Protection &bull; Training &bull; AI Surveillance &bull; Counter-Drone Solutions &bull; Risk Management<br>'
            '<a href="privacy.html">Privacy Policy</a><a href="terms.html">Terms of Service</a></div>')


# ── Page-level styles on top of the shell: text cards, steps, specs, forms, quotes, link tiles, team blocks ──
EXTRA_CSS = r"""
  .cta, .cta-button { color:#fff; text-shadow:0 1px 2px rgba(0,0,0,.35); }
  .tile a.cover { position:absolute; inset:0; z-index:3; }
  .tile .txt .more { display:inline-block; margin-top:.6rem; font-family:'Share Tech Mono',monospace; font-size:.62rem; letter-spacing:.3em; color:var(--gold-champagne); text-transform:uppercase; }
  .cards { display:grid; grid-template-columns:repeat(3,1fr); gap:1.1rem; max-width:1200px; margin:0 auto; text-align:left; }
  .cards.two { grid-template-columns:repeat(2,1fr); max-width:1000px; }
  .cards.four { grid-template-columns:repeat(4,1fr); }
  .card { position:relative; padding:1.5rem 1.4rem 1.4rem; border:1px solid rgba(201,168,76,.22); background:linear-gradient(180deg, rgba(30,42,58,.5) 0%, rgba(11,18,33,.72) 100%); backdrop-filter:blur(12px); transition:transform .4s, border-color .4s; }
  .card::before { content:''; position:absolute; top:0; left:0; width:100%; height:1px; background:linear-gradient(90deg, transparent, var(--gold), transparent); }
  .card:hover { transform:translateY(-5px); border-color:var(--gold); }
  .card .num { font-family:'Share Tech Mono',monospace; font-size:.62rem; letter-spacing:.4em; color:var(--gold); margin-bottom:.6rem; }
  /* The current site's emoji icon on a card or tile, in the number's place (Brockmann, 2026-09-05: same content, same way). */
  .card .ico, .tile .txt .num.ico { font-size:1.5rem; line-height:1; letter-spacing:0; margin-bottom:.6rem; }
  /* A section photograph in the flow of the page, where the current page shows it. */
  img.figure { display:block; width:100%; max-width:900px; margin:2rem auto 0; border:1px solid rgba(201,168,76,.22); }
  .quotes .card .meta { margin-bottom:.4rem; }
  .team.nopic { grid-template-columns:1fr; }   /* a team member without a photograph: the bio takes the row */
  /* Atlas EP page: the live page's capability tags and tier prices. */
  .tags { margin-top:.8rem; display:flex; flex-wrap:wrap; gap:.35rem; }
  .tags span { font-family:'Share Tech Mono',monospace; font-size:.56rem; letter-spacing:.2em; text-transform:uppercase; color:var(--gold-champagne); border:1px solid rgba(201,168,76,.3); padding:.15rem .45rem; }
  .card .price { margin:.6rem 0 .9rem; color:var(--text); } .card .price b { font-family:'Orbitron',sans-serif; font-size:1.5rem; color:var(--gold-champagne); }
  .card .cta-button { display:inline-block; margin-top:.4rem; }
  .card h3 { font-family:'Orbitron',sans-serif; font-weight:700; font-size:1rem; color:var(--gold-champagne); letter-spacing:.04em; margin-bottom:.55rem; line-height:1.35; }
  .card p { font-size:.95rem; color:var(--text-dim); line-height:1.55; font-weight:300; }
  .card ul { margin:.4rem 0 0 1rem; color:var(--text-dim); font-size:.92rem; line-height:1.6; }
  .card .meta { font-family:'Share Tech Mono',monospace; font-size:.62rem; letter-spacing:.25em; color:var(--text-dim); text-transform:uppercase; margin-bottom:.8rem; }
  .card .cta-button, .card .secondary-cta { margin:1rem 0 0; padding:.8rem 1.4rem; font-size:.72rem; }
  .steps { counter-reset:st; display:grid; grid-template-columns:repeat(3,1fr); gap:1rem; max-width:1100px; margin:0 auto; text-align:left; }
  .steps .card::after { counter-increment:st; content:counter(st, decimal-leading-zero); position:absolute; top:.9rem; right:1rem; font-family:'Orbitron',sans-serif; font-weight:900; font-size:1.6rem; color:rgba(201,168,76,.22); }
  .spec { max-width:760px; margin:0 auto; text-align:left; border:1px solid rgba(201,168,76,.22); background:rgba(11,18,33,.7); backdrop-filter:blur(12px); }
  .spec div { display:flex; justify-content:space-between; gap:1rem; padding:.85rem 1.2rem; border-top:1px solid rgba(201,168,76,.12); font-size:.98rem; }
  .spec div:first-child { border-top:0; }
  .spec b { font-family:'Share Tech Mono',monospace; font-weight:400; font-size:.7rem; letter-spacing:.25em; text-transform:uppercase; color:var(--text-dim); }
  .spec span { color:var(--gold-champagne); font-weight:600; text-align:right; }
  .quotes { display:grid; grid-template-columns:repeat(3,1fr); gap:1.1rem; max-width:1200px; margin:0 auto; text-align:left; }
  .quotes .card p { font-style:italic; color:var(--text); }
  .quotes .card .by { margin-top:.8rem; font-family:'Share Tech Mono',monospace; font-size:.65rem; letter-spacing:.25em; color:var(--gold-champagne); text-transform:uppercase; }
  .stars { color:var(--gold); letter-spacing:.15em; font-size:.85rem; margin-bottom:.5rem; }
  .form { max-width:640px; margin:0 auto; text-align:left; border:1px solid rgba(201,168,76,.22); background:linear-gradient(180deg, rgba(30,42,58,.5) 0%, rgba(11,18,33,.78) 100%); backdrop-filter:blur(14px); padding:1.6rem; }
  .form label { display:block; font-family:'Share Tech Mono',monospace; font-size:.62rem; letter-spacing:.3em; text-transform:uppercase; color:var(--gold-champagne); margin:1rem 0 .4rem; }
  .form label:first-child { margin-top:0; }
  .form input, .form select, .form textarea { width:100%; padding:.85rem 1rem; background:rgba(5,8,16,.7); border:1px solid rgba(255,255,255,.14); color:var(--text); font-family:'Rajdhani',sans-serif; font-size:1.05rem; border-radius:3px; outline:none; -webkit-appearance:none; appearance:none; }
  .form select { background-image:linear-gradient(45deg, transparent 50%, var(--gold-champagne) 50%), linear-gradient(135deg, var(--gold-champagne) 50%, transparent 50%); background-position:calc(100% - 20px) 50%, calc(100% - 14px) 50%; background-size:6px 6px; background-repeat:no-repeat; }
  .form select option { background:#0B1221; color:#fff; }
  .form input:focus, .form select:focus, .form textarea:focus { border-color:var(--gold); }
  .form textarea { min-height:140px; resize:vertical; }
  .form .row { display:grid; grid-template-columns:1fr 1fr; gap:.8rem; }
  .form .hp { position:absolute; left:-9999px; width:1px; height:1px; opacity:0; }
  .form .cta-button { width:100%; margin-top:1.3rem; border-radius:0; }
  .form .cta-button[disabled] { opacity:.5; }
  .form-msg { margin-top:.9rem; font-size:.95rem; line-height:1.5; min-height:1.2em; }
  .form-msg.ok { color:#7fd4a1; } .form-msg.err { color:#ff8a80; }
  .form .fine { font-size:.82rem; color:var(--text-dim); margin-top:.9rem; line-height:1.5; }
  .form .fine a { color:var(--gold-champagne); text-decoration:none; }
  /* .team blocks (portrait + name, role, bio) live in the shell, shared with the MAST Instructors chapter. */
  .yt-grid { display:grid; grid-template-columns:1fr 1fr; gap:1.1rem; max-width:1100px; margin:0 auto 1.6rem; text-align:left; }
  .yt-card { border:1px solid rgba(201,168,76,.22); background:rgba(11,18,33,.8); overflow:hidden; }
  .yt-card .frame { position:relative; aspect-ratio:16/9; background:#000; }
  .yt-card iframe { position:absolute; inset:0; width:100%; height:100%; border:0; }
  .yt-card .info { padding:.9rem 1rem; }
  .yt-card h4 { font-family:'Orbitron',sans-serif; font-size:.9rem; color:var(--gold-champagne); margin-bottom:.2rem; }
  .yt-card p { font-size:.88rem; color:var(--text-dim); }
  .yt-card video { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; background:#000; }
  .yt-grid.one { grid-template-columns:1fr; max-width:860px; }
  .stats.four { grid-template-columns:repeat(4,1fr); max-width:1100px; }
  .badges { display:flex; gap:1.4rem; justify-content:center; align-items:center; flex-wrap:wrap; margin-top:2rem; }
  .badges img { height:84px; width:auto; border:0; filter:drop-shadow(0 6px 18px rgba(0,0,0,.5)); }
  .badges .badge-item { text-align:center; }
  .badges .badge-item p { margin-top:.8rem; font-family:'Orbitron',sans-serif; font-size:.7rem; font-weight:700; letter-spacing:.12em; text-transform:uppercase; color:var(--gold-champagne); }
  .lede { font-size:clamp(1.05rem,1.4vw,1.3rem); color:var(--text); max-width:820px; margin:0 auto 2rem; line-height:1.6; font-weight:300; }
  .lede b { color:var(--gold-champagne); font-weight:600; }
  .partner { display:grid; grid-template-columns:1fr minmax(240px,420px); gap:1.6rem; max-width:1150px; margin:0 auto; text-align:left; align-items:center; }
  .partner img { width:100%; border:1px solid rgba(201,168,76,.3); display:block; }
  .partner p { color:var(--text-dim); line-height:1.6; font-weight:300; font-size:1.02rem; margin-bottom:1rem; }
  .partner .ctas { justify-content:flex-start; }
  @media (max-width:900px) { .cards, .cards.four, .steps, .quotes { grid-template-columns:1fr 1fr; } .partner { grid-template-columns:1fr; } }
  @media (max-width:768px) { .cards, .cards.two, .cards.four, .steps, .quotes, .yt-grid { grid-template-columns:1fr; } .stats.four { grid-template-columns:1fr 1fr; gap:.8rem; } .form { padding:1.1rem; } .form .row { grid-template-columns:1fr; } .badges img { height:64px; } .spec div { flex-direction:column; gap:.2rem; } .spec span { text-align:left; } }
"""

FORM_JS = r"""
(function(){
  document.querySelectorAll('form[data-endpoint]').forEach(f => {
    f.addEventListener('submit', async e => {
      e.preventDefault();
      const btn = f.querySelector('button[type=submit]'), msg = f.querySelector('.form-msg');
      const data = Object.fromEntries(new FormData(f).entries()); data.page = location.pathname.split('/').pop() || 'index.html';
      // The contact page asks for first and last name and a confirming email, as the live page does; the Worker takes one name.
      if (data.first_name !== undefined || data.last_name !== undefined) {
        data.name = [data.first_name, data.last_name].map(s => (s || '').trim()).filter(Boolean).join(' '); delete data.first_name; delete data.last_name;
      }
      if (data.role !== undefined && !data.message) { data.message = 'Atlas EP access request · Role: ' + (data.role || '(not chosen)'); }   // the Atlas EP access form has no message field
      if (data.confirm_email !== undefined) {
        if (data.confirm_email.trim().toLowerCase() !== (data.email || '').trim().toLowerCase()) { msg.textContent = 'The two email addresses do not match.'; msg.className = 'form-msg err'; return; }
        delete data.confirm_email;
      }
      btn.disabled = true; const label = btn.textContent; btn.textContent = 'Sending…'; msg.textContent = ''; msg.className = 'form-msg';
      if (window.mastAttribution) data.attribution = mastAttribution();   // first touch, UTM, referrer, landing page, visitor id → the CRM lead
      try {
        const r = await fetch(f.dataset.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) throw new Error(j.error || 'Could not send');
        f.reset(); msg.textContent = f.dataset.success || 'Sent. We will respond as soon as possible.'; msg.classList.add('ok');
      } catch (err) { msg.textContent = err.message + ' You can also call (281) 654-8100.'; msg.classList.add('err'); }
      btn.disabled = false; btn.textContent = label;
    });
  });
})();
"""

# ── Chapter builders ──
def opening(eyebrow, h1, sub, ctas, num='01'):
    """The hero: build() drops the page's film, its scrim and the sound toggle in at the marker."""
    return f'''
  <section class="panel hero" id="s1" data-section="{num}">
    <!--HERO-MEDIA-->
    <div>
      <div class="eyebrow">{eyebrow}</div>
      <h1 class="mega">{h1}</h1>
      <p class="sub">{sub}</p>
      <div class="ctas rise">{ctas}</div>
    </div>
    <div class="scroll-cue">SCROLL &darr;</div>
  </section>
'''

def section(i, eyebrow, h2, sub, body, badge=None):
    return f'''
  <section class="panel" id="s{i}" data-section="{i:02d}">
    <div>
      {('<div class="badge">' + badge + '</div>') if badge else ('<div class="eyebrow">' + eyebrow + '</div>')}
      {('<h2 class="section-h">' + h2 + '</h2>') if h2 else ''}
      {('<p class="sub">' + sub + '</p>') if sub else ''}
      {body}
    </div>
  </section>
'''

def cta(href, label): return f'<a href="{href}" class="cta">{label}</a>'
def cta2(href, label): return f'<a href="{href}" class="secondary-cta">{label}</a>'
def blue(t): return f'<span class="gold">{t}</span>'

def cards(items, cls='cards', numbered=True):
    """items: (title, body[, extra html[, icon]]). An icon (the current site's emoji on that card) takes the number's place."""
    out = []
    for k, it in enumerate(items, 1):
        title, body = it[0], it[1]; extra = it[2] if len(it) > 2 else ''; icon = it[3] if len(it) > 3 else ''; meta = it[4] if len(it) > 4 else ''
        head = f'<div class="ico" aria-hidden="true">{icon}</div>' if icon else (f'<div class="num">{k:02d}</div>' if numbered else '')
        if meta: head += f'<div class="meta">{meta}</div>'   # a category label above the title (the current site's Insights cards)
        out.append(f'<div class="card rise">{head}<h3>{title}</h3>' + (f'<p>{body}</p>' if body else '') + extra + '</div>')
    return f'<div class="{cls}">' + ''.join(out) + '</div>'

def chips(items): return '<div class="chips rise">' + ''.join(f'<span class="chip">{c}</span>' for c in items) + '</div>'

def film_card(mp4, poster, title, sub):
    """A local film in the yt-card frame: poster until tapped, native controls, nothing loads before then."""
    return (f'<div class="yt-card"><div class="frame"><video controls preload="none" playsinline poster="{poster}" src="{mp4}" title="{title}"></video></div>'
            f'<div class="info"><h4>{title}</h4><p>{sub}</p></div></div>')

def ltile(num, title, body, img, href, pos='center', more='Learn more &rarr;', icon=False):
    """icon=True: num is the current site's emoji for that tile, shown at icon size instead of as a numeral."""
    return (f'<div class="tile rise"><div class="bg" style="background-image:url(\'{img}\');background-position:{pos}"></div>'
            f'<div class="txt"><div class="num{" ico" if icon else ""}">{num}</div><h3>{title}</h3><p>{body}</p><span class="more">{more}</span></div>'
            f'<a class="cover" href="{href}" aria-label="{title}"></a></div>')

def tiles(items, four=False): return f'<div class="tiles{" four" if four else ""}">' + ''.join(items) + '</div>'

def quotes(items):
    return '<div class="quotes">' + ''.join(f'<div class="card rise"><div class="stars">&#9733;&#9733;&#9733;&#9733;&#9733;</div><p>&ldquo;{q}&rdquo;</p><div class="by">{by}</div></div>' for q, by in items) + '</div>'

def contact_chapter(i, eyebrow, h2, sub, ctas):
    return section(i, eyebrow, h2, sub,
        f'<div class="contact-lines rise">{ADDRESS}<br><a href="{TEL}">{PHONE}</a> &middot; <a href="mailto:{EMAIL}">{EMAIL}</a></div>'
        f'<div class="ctas rise">{ctas}</div>')   # the site footer is added to the page's last chapter by build()

def contact_form(kind='contact'):
    if kind == 'capability':
        # The live home page's form, field for field: Full Name, Email Address, Company, the two selects, the button.
        fields = ('<label for="cs-name">Full Name</label><input id="cs-name" name="name" type="text" autocomplete="name" placeholder="Full Name" required>'
                  '<div class="row"><div><label for="cs-email">Email Address</label><input id="cs-email" name="email" type="email" autocomplete="email" inputmode="email" placeholder="Email Address" required></div>'
                  '<div><label for="cs-company">Company</label><input id="cs-company" name="company" type="text" autocomplete="organization" placeholder="Company"></div></div>'
                  '<div class="row"><div><label for="cs-status">Do you currently have or need security?</label><select id="cs-status" name="status"><option>Currently have security</option><option>Need security</option><option>Evaluating options</option></select></div>'
                  '<div><label for="cs-type">RFP / RFQ</label><select id="cs-type" name="request_type"><option>RFP &mdash; Request for Proposal</option><option>RFQ &mdash; Request for Quote</option><option>General Inquiry</option></select></div></div>'
                  '<input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">'
                  '<input type="hidden" name="kind" value="capability">')
        btn, success = 'Request Capability Statement', 'Request received. We&rsquo;ll be in touch shortly.'
        fine = 'Your request goes to Atlas Glinn HQ only. See the <a href="privacy.html">Privacy Policy</a>.'
    else:
        # The live contact page's form, field for field. FORM_JS joins the two names into `name` and checks the confirm field
        # before posting, so the Worker's /contact sees what it always saw.
        fields = ('<div class="row"><div><label for="ct-first">First Name</label><input id="ct-first" name="first_name" type="text" autocomplete="given-name" placeholder="First Name" required></div>'
                  '<div><label for="ct-last">Last Name</label><input id="ct-last" name="last_name" type="text" autocomplete="family-name" placeholder="Last Name" required></div></div>'
                  '<div class="row"><div><label for="ct-email">Email Address</label><input id="ct-email" name="email" type="email" autocomplete="email" inputmode="email" placeholder="Email Address" required></div>'
                  '<div><label for="ct-email2">Confirm Email</label><input id="ct-email2" name="confirm_email" type="email" autocomplete="email" inputmode="email" placeholder="Confirm Email" required></div></div>'
                  '<label for="ct-phone">Phone (optional)</label><input id="ct-phone" name="phone" type="tel" autocomplete="tel" inputmode="tel" placeholder="Phone (optional)">'
                  '<label for="ct-msg">How can we help?</label><textarea id="ct-msg" name="message" placeholder="How can we help?" required></textarea>'
                  '<input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">')
        btn, success = 'Send Message', 'Thank you for your interest in Atlas Glinn. We will respond as soon as possible.'
        fine = f'Or call <a href="{TEL}">{PHONE}</a>. Your message goes to Atlas Glinn HQ only. See the <a href="privacy.html">Privacy Policy</a>.'
    return (f'<form class="form rise" data-endpoint="{API}/contact" data-success="{success}" novalidate>{fields}'
            f'<button class="cta-button" type="submit">{btn}</button><div class="form-msg" role="status" aria-live="polite"></div><p class="fine">{fine}</p></form>')

def jsonld_org():
    return ('<script type="application/ld+json">\n{\n  "@context": "https://schema.org",\n  "@type": "Organization",\n  "name": "Atlas Glinn, LLC",\n'
            '  "alternateName": "Atlas Glinn",\n  "url": "https://atlasglinn.com/",\n  "logo": "' + SITE + LOGO + '",\n'
            '  "description": "Executive protection, residential protection, disaster recovery and asset protection, AI surveillance, counter-drone and autonomous UAS solutions, and tactical training through MAST Solutions. Houston, Texas.",\n'
            '  "founder": { "@type": "Person", "name": "Matthew Brockmann", "jobTitle": "Founder & CEO" },\n'
            '  "address": { "@type": "PostalAddress", "streetAddress": "2450 Fondren Rd, Suite 255", "addressLocality": "Houston", "addressRegion": "TX", "postalCode": "77063", "addressCountry": "US" },\n'
            '  "telephone": "+1-281-654-8100",\n  "email": "atlasglinn.hq@atlasglinn.com",\n'
            '  "sameAs": ["https://www.instagram.com/atlasglinn_mastsolutions/", "https://www.linkedin.com/in/mastsolutions1/", "https://www.youtube.com/@atlasglinn", "https://www.facebook.com/mastsolutions", "https://www.yelp.com/biz/atlas-glinn-houston", "https://maps.google.com/?cid=4511758973651106295"]\n}\n</script>\n')

def jsonld_service(name, desc, path):
    return ('<script type="application/ld+json">\n{\n  "@context": "https://schema.org",\n  "@type": "Service",\n'
            f'  "name": "{name}",\n  "serviceType": "{name}",\n  "description": "{desc}",\n  "url": "{SITE}{path}",\n'
            '  "provider": { "@type": "Organization", "name": "Atlas Glinn, LLC", "url": "https://atlasglinn.com/", "telephone": "+1-281-654-8100" },\n'
            '  "areaServed": { "@type": "Place", "name": "Houston, Texas" }\n}\n</script>\n')

def meta(title, desc, path, og_image, jsonld=''):
    url = SITE + ('' if path == 'index.html' else path)
    if not og_image.startswith('http'): og_image = SITE + og_image   # share cards need an absolute URL; local images are repo paths
    return (f'<title>{title}</title>\n<meta name="description" content="{desc}">\n<link rel="canonical" href="{url}">\n'
            f'<link rel="icon" href="{LOGO_MARK}" type="image/png">\n'
            f'<meta property="og:title" content="{title}">\n<meta property="og:description" content="{desc}">\n<meta property="og:image" content="{og_image}">\n'
            f'<meta property="og:type" content="website">\n<meta property="og:url" content="{url}">\n<meta name="twitter:card" content="summary_large_image">\n'
            '<meta name="robots" content="index, follow">\n<meta name="author" content="Atlas Glinn, LLC">\n<meta name="theme-color" content="#050810">\n' + jsonld)

def build(path, title, desc, og_image, credits, chapters, photos, jsonld=''):
    """DEPRECATED — the hand-authored page. Writes nothing unless --authored is passed; build_live() is what ships.

    chapters: [(label, html)]; photos: [(image, pos or None[, film])] one per section, in order. The first entry's
    film is the hero: it autoplays muted and full-bleed behind the opening headline, with the live sound toggle. Every
    section stays in one scroll and keeps its `id="sN"`, so every link that ever pointed at one still lands."""
    if not AUTHORED:
        return
    n = len(chapters)
    assert len(photos) == n, f'{path}: {len(photos)} backdrops for {n} sections'
    assert len(photos[0]) <= 3 and all(len(e) == 2 for e in photos[1:]), f'{path}: only the opening section takes a film'
    first_label, first_html = chapters[0]
    assert '<!--HERO-MEDIA-->' in first_html, f'{path}: the opening section is not a hero'
    chapters = [(first_label, first_html.replace('<!--HERO-MEDIA-->', atlas.hero_media(*photos[0])))] + chapters[1:]
    chrome = atlas.chrome(credits[0], 'ATLAS GLINN', credits[1], [(img, pos) for img, pos, *_ in photos])
    body = ('\n' + chrome + atlas.nav(*_topnav_lists(), here=path, logo=LOGO_MARK) + '\n<div class="content">\n'
            + ''.join(h for _, h in chapters) + '\n</div>\n' + atlas.footer(site_footer()) + atlas.BACK_TO_TOP)
    css = atlas.css(shell.ATLAS, EXTRA_CSS) + HERO_CSS
    html = shell.head(meta(title, desc, path, og_image, jsonld), css) + body + shell.tail(atlas.three(n, shell.ATLAS), atlas.CLASSIC_JS + FORM_JS)
    for banned in ('images/mast/', 'images/gallery/', 'deep-sentinel', 'man-s-hand-holding-drone'):
        assert banned not in html, f'{path}: {banned} is not approved Atlas Glinn imagery'
    if LIVE_LINKS:
        html = _LIVE_RE.sub(lambda m: 'href="%s"' % LIVE_URLS[m.group(1)], html)
    if not PUBLISH: html = _previewize(html)
    out = os.path.join(REPO, OUT_DIR, path)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    open(out, 'w', encoding='utf-8').write(html)
    if PUBLISH:
        import build_manifest; build_manifest.stamp_and_write([out])   # the page's own hash + build-manifest.json (self-refresh)
    print('wrote', OUT_DIR + path, len(html.encode('utf-8')), 'bytes,', n, 'chapters')

# No `M = 'images/mast/'` here on purpose: the Atlas pages draw only from the approved list above; build() enforces it.

# Brockmann, 2026-09-05: "when you click on the card, it should take it to the same as atlasglinn.com now. So we're not changing
# actual content." While LIVE_LINKS is True every card, button and menu item that names one of the ten content pages goes to
# that page's current address on atlasglinn.com (the canonical URLs the current pages carry), so a visitor reads today's content.
# The rebuilt pages still generate for his review. Flip to False on the day the full set publishes, and the links turn back into
# the local pages. Home, the MAST page, signup, privacy and terms are untouched.
LIVE_LINKS = False   # 2026-09-05 "Publish AG preview": the full set is published, links stay on the new pages
LIVE_URLS = {
    'executive-protection.html':  'https://atlasglinn.com/executive-protection/',
    'residential-protection.html': 'https://atlasglinn.com/residential-protection/',
    'disaster-recovery.html':     'https://atlasglinn.com/disaster-recovery/',
    'training.html':              'https://atlasglinn.com/training/',
    'technology.html':            'https://atlasglinn.com/technology/',
    'cuas-aerodefense.html':      'https://atlasglinn.com/cuas-aerodefense/',
    'uas.html':                   'https://atlasglinn.com/uas/',
    'about.html':                 'https://atlasglinn.com/about/',
    'careers.html':               'https://atlasglinn.com/careers/',
    'contact.html':               'https://atlasglinn.com/contact/',
}
_LIVE_RE = re.compile(r'href="(%s)(?:[?#][^"]*)?"' % '|'.join(re.escape(p) for p in LIVE_URLS))   # anchors and ?subject= prefills drop: the live pages have neither

CREDITS = ('Houston &middot; Texas', 'Executive Protection &middot; Intelligence &middot; Training')
OG_DEFAULT = HERO_EP
# held back 2026-09-08: not on the live site; publish only on Brockmann's word
PRIVACY_LINE = ('Former Head of Security, Sen. Ted Cruz; security for U.S. Senators Josh Hawley and Eric &ldquo;Bulldog&rdquo; Schmitt, a former Vice President, and Ivanka Trump, '
                'named as media exist. Other high-profile and high-net-worth individuals follow our privacy standards. We don&rsquo;t do media. Names appear only where the media captured them.')

# ── Shared with every content page (Brockmann, 2026-09-05: "structured to pull the exact same way, load, pre-embedded,
#    etc. on every page") ─────────────────────────────────────────────────────────────────────────────────────────────
def yt_bg(vid):
    """The current page's hero: its YouTube film playing muted behind the opening chapter (controls=0, loop), exactly as
    the live page embeds it. The still under it is the film's own frame from YouTube."""
    return (f'https://i.ytimg.com/vi/{vid}/maxresdefault.jpg', None, 'yt:' + vid)

def figure(src, alt):
    """A section photograph in the flow of the page, where the current page shows it (not only as a backdrop)."""
    return f'<img class="figure rise" src="{src}" alt="{alt}" loading="lazy">'

# The Reviews block every current content page ends with: six quotes, each under its audience label, then the two
# links and the two badges. Names and titles as the current site prints them.
REVIEWS = [
    ('Law Enforcement', 'Matthew is an expert in his field. He is highly motivated, knowledgeable and I highly recommend him for top-tier performance.', 'Kenny Upton &mdash; Deputy, Harris County Sheriff'),
    ('Navy SEAL / Former CIA', 'His leadership, dedication, drive, and passion is second to none. A master at teamwork, problem-solving, leadership, and communication.', 'Ray Cash Care &mdash; Navy SEAL / Former CIA'),
    ('Reconnaissance Marine', 'As a former Reconnaissance Marine, Matthew&rsquo;s teaching has not only made me a better shooter, he has made me a better team player.', 'Arthur Metcalfe &mdash; Recon Marine, 18yr O&amp;G'),
    ('Flight Paramedic', 'Brockmann had hosted and taught some of the best classes I have been a part of. I can&rsquo;t recommend him enough.', 'William H. Miller BS, TP-C, FP-C, CPM &mdash; Flight Paramedic'),
    ('President &amp; CEO', 'Extremely professional. In an extremely competitive industry Matt has never failed to provide exceptional guidance. I recommend him without hesitation.', 'Craig Etkin &mdash; President &amp; CEO, intelligence360'),
    ('CxO / Investor', 'I&rsquo;ve trained with some big-name national &amp; global self-defense trainers. I&rsquo;ve always felt safe training with Matt &mdash; the #1 criterion for choosing a trainer.', 'Wayne Sadin &mdash; CxO/VP Investor'),
]
STARS = '&#9733;&#9733;&#9733;&#9733;&#9733;'
def reviews_chapter(i):
    body = ('<div class="quotes">' + ''.join(f'<div class="card rise"><div class="meta">{lab}</div><div class="stars">{STARS}</div><p>&ldquo;{q}&rdquo;</p><div class="by">{by}</div></div>' for lab, q, by in REVIEWS) + '</div>'
            + '<div class="ctas rise" style="margin-top:2rem">' + cta2('https://www.google.com/search?q=Atlas+Glinn+Houston+reviews', 'Google Reviews &rarr;') + cta2('https://www.linkedin.com/in/mastsolutions1/', 'LinkedIn &rarr;') + '</div>'
            + badge_pair('badges rise'))
    return section(i, 'Reviews', f'Google Reviews &amp; LinkedIn {blue("Recommendations.")}', f'<span class="stars">{STARS}</span> 5.0 &middot; Google Reviews', body)

def partner(paras, ctas, img, alt):
    return '<div class="partner rise"><div>' + ''.join(f'<p>{p}</p>' for p in paras) + f'<div class="ctas">{ctas}</div></div><img src="{img}" alt="{alt}" loading="lazy"></div>'

# ═══════════════════════════════ index.html ═══════════════════════════════
build('index.html',
      'Atlas Glinn | Executive Protection, Risk Management & Training — Houston, TX',
      'Elite security services by Atlas Glinn: dignitary and executive protection, residential security, secure transport, disaster recovery, AI surveillance and counter-drone solutions, and tactical training through MAST Solutions. Houston, Texas.',
      OG_DEFAULT, CREDITS, [
    ('Opening', opening('Security, Training, Dignitary Protection',   # the home hero line (owner, 2026-09-05: '"Security, Training, Dignitary Protection" on the Atlas side'), replacing "34+ Years · …"
        f'{shimmer("Details")} <span class="white">Matter.</span>', '',   # the live home page has no hero sub-paragraph
        cta('contact.html', 'Request a posture assessment') + cta2('#s2', 'Our Services'))),   # the live home page's hero button
    ('Services', section(2, 'Our Services', f'Customized {blue("Security.")}', 'Protection that doesn&rsquo;t show up in the news.',
        tiles([
            ltile('01', 'Executive Protection', 'Discreet, adaptive security for high-level executives and dignitaries.', HERO_EP, 'executive-protection.html'),
            ltile('02', 'Residential Protection', '24/7 security guards and AI surveillance for your home and estate.', CCTV, 'residential-protection.html'),
            ltile('03', 'Secure Transport', 'Armed drivers, route planning, and tactical escort for motorcade operations.', PROTECTION, 'executive-protection.html#s7'),
            ltile('04', 'Training Programs', 'Rigorous training for real-world challenges. Delivered by operators, for operators.', TRAINING, 'training.html'),
            ltile('05', 'Disaster Recovery', 'Rapid response and asset protection during crisis situations.', AG3, 'disaster-recovery.html'),
        ]))),
    # No counters chapter: the live site states none of these figures on any page (audit 2026-09-08).
    ('The Film', section(3, 'Atlas Glinn &amp; MAST Solutions', f'Watch the {blue("Film.")}', '',
        '<div class="yt-grid one rise">' + film_card('images/film/atlas-glinn-and-mast-solutions.mp4', 'images/film/atlas-glinn-and-mast-solutions-poster.jpg', 'Atlas Glinn &amp; MAST Solutions', 'The film from the atlasglinn.com home page') + '</div>')),
    # The live home page's Atlas EP section, word for word: the lead line, "AI Intelligence Features" (four), "Operator
    # Benefits" (four), the plans. (Before 2026-09-05 the eight features were listed twice and the lead named a year figure.)
    ('Atlas EP', section(4, 'Built By Atlas Glinn', f'The Atlas EP {blue("Platform.")}',
        'We didn&rsquo;t just build a security company &mdash; we built the intelligence platform behind it. Because the right tech didn&rsquo;t exist yet.',
        '<div class="eyebrow in">AI Intelligence Features</div>'
        + cards([('AI Threat Analysis &amp; Scoring', 'Real-time threat intelligence powered by Anthropic Claude AI. Automated situation reports, risk scoring, and predictive threat modeling.'),
               ('Blue Force Tracking', 'Real-time GPS positioning of your entire protection team. Anti-spoofing technology ensures accurate, tamper-proof location data.'),
               ('Encrypted Push-to-Talk Radio', 'Military-grade AES-256-GCM encrypted voice comms. No third-party servers, no interception risk.'),
               ('Crime Data Intelligence', 'Live crime feeds, sex offender mapping, aviation/airspace monitoring &mdash; all layered on Google Earth for advance work.')], 'cards four', numbered=False)
        + '<div class="eyebrow in" style="margin-top:2.2rem">Operator Benefits</div>'
        + cards([('Covert Emergency Stream', 'Silent SOS with live audio/video streaming. Your team sees and hears everything without alerting the threat.'),
                 ('Duress Detection', 'Dead man&rsquo;s switch + heart rate monitoring. If you go down, your team knows immediately. Apple Watch companion with wrist SOS.'),
                 ('Counter-Surveillance Sweep', 'BLE + IR camera detection for room sweeps. Identify hidden surveillance devices before your principal arrives.'),
                 ('Cyber Defense Suite', 'Evil twin WiFi detection, jailbreak monitoring, MITM protection. Your device security is part of the mission.')], 'cards four', numbered=False)
        + '<div class="eyebrow in" style="margin-top:2.2rem">Choose Your Plan</div>'
        # The four tiers Brockmann decided on 2026-09-08. They supersede both the live home table ($0 / $9.99 / $49 / $149 /
        # $249 / $500+) and the live Atlas EP page's six; Solo, Trial, Personal Safety and Command are gone.
        + '<div class="cards four">' + ''.join(f'<div class="card rise"><h3>{n}</h3><p><b style="color:var(--gold-champagne);font-size:1.3rem">{p}</b><br><span class="meta">{u}</span></p></div>' for n, p, u in [
            ('Family', '$19.99', '/month &middot; up to 6'), ('Operator', '$149.99', '/month &middot; 1'),
            ('Protection Team', '$199.99', '/seat/month &middot; unlimited seats'), ('Enterprise', '$5,000+', '/month &middot; custom')]) + '</div>'
        + '<p class="sub" style="margin-top:1.2rem">Every tier pairs with a Protectee.</p>'
        + '<div class="ctas rise" style="margin-top:2rem">' + cta('ep-app.html', 'Explore Atlas EP &rarr;') + '</div>')),
    ('No Press', section(5, '', '', '',
        '<p class="sub quote lead">&ldquo;We don&rsquo;t do press. We let our work speak for itself.&rdquo;</p>'
        '<div class="eyebrow" style="margin-top:2rem;">Request the Capability Statement</div>'
        '<p class="sub" style="margin-bottom:1.4rem">Submit your request and we&rsquo;ll send our capability statement directly to your email.</p>' + contact_form('capability'),
        badge='We Don&rsquo;t Do Press.')),
    ('Reviews', reviews_chapter(6)),   # the live home page's Reviews block: the six Google / LinkedIn quotes under their labels
    ('Contact', contact_chapter(7, 'Get in Touch', f'Protecting What {blue("Matters Most.")}', 'From U.S. Senators to Fortune 500 executives &mdash; discreet, adaptive protection at the highest level.',
        cta('contact.html', 'Contact Us') + cta2('https://www.mastsolutions.com/', 'Book Training &rarr;'))),
], photos=[(FILM_POSTER, None, FILM_TEASER), (HERO_EP, None), (FILM_POSTER, None), (CCTV, None), (EP_MATTERS, None), (AG3, None), (HERO_EP, None)],
      jsonld=jsonld_org())

# ═══════════════════════════ executive-protection.html ═══════════════════════════
build('executive-protection.html',
      'Executive & Dignitary Protection Houston TX | Atlas Glinn',
      'Expert dignitary protection services by Atlas Glinn. Discreet, adaptable security for U.S. Senators, Fortune 500 executives, dignitaries, and their families. Houston, TX.',
      OG_DEFAULT, CREDITS, [
    ('Opening', opening('Executive Protection', f'{shimmer("Details")} <span class="white">Matter.</span>',
        'Discreet, adaptable security &mdash; so you focus on what matters, not on us. Our team brings decades of combined experience protecting high-level executives, dignitaries, and their families.',   # the live page's lead
        cta('contact.html', 'Request a 30-minute posture assessment') + cta2('#s2', 'Our Services'))),   # the live page's hero button
    ('Services', section(2, 'Our Services', f'Comprehensive {blue("Protection.")}', 'Comprehensive Dignitary Protection Tailored to Your Needs.',
        cards([('Close Protection', 'Dedicated personal protection officers providing 24/7 security coverage with discreet, professional presence tailored to your lifestyle and threat profile.'),
               ('Advance Operations', 'Thorough pre-deployment reconnaissance and venue assessment. Our advance teams identify and mitigate threats before you arrive at any location.'),
               ('Motorcade Planning', 'Strategic route planning, secure vehicle coordination, and tactical motorcade operations ensuring safe movement through any environment.'),
               ('Body Man Duties', 'Close-proximity personal security serving as your dedicated detail agent, managing immediate security concerns and daily logistics seamlessly.'),
               ('Crisis Management', 'Rapid response protocols and contingency planning for high-threat scenarios. Expert coordination during emergencies to protect lives and assets.'),
               ('Emergency Response', 'Immediate tactical response capabilities including evacuation procedures, medical coordination, and real-time threat neutralization protocols.')]))),
    ('Who Leads', section(3, 'Who Leads the Detail', f'Led From {blue("Experience.")}',
        '',   # the live page's "two sitting U.S. Senators" line is the figure he called wrong (2026-09-04); removed
        '<p class="sub quote lead">&ldquo;At Atlas Glinn, we understand that details matter. Our team of highly trained professionals is dedicated to providing exceptional dignitary protection tailored to your unique needs. Whether you require discreet, low-profile security or a highly visible presence, we adapt seamlessly to ensure your safety and peace of mind.&rdquo;</p>'
        '<div class="ctas rise">' + cta2('about.html', 'Meet the Team') + '</div>')),
    ('OPORD', section(4, 'Method', f'The OPORD {blue("Framework.")}', 'Atlas Glinn applies military-grade Operations Order (OPORD) methodology to every executive protection engagement.',
        '<div class="steps">' + ''.join(f'<div class="card rise"><h3>{t}</h3><p>{b}</p></div>' for t, b in [
            ('Situation', 'Threat assessment, terrain analysis, weather, and hostile/friendly force identification.'),
            ('Mission', 'Clear objective definition &mdash; who, what, when, where, and why for every protective detail.'),
            ('Execution', 'Concept of operations, maneuver plan, routes, contingencies, and emergency action protocols.'),
            ('Sustainment', 'Logistics, communications plan, medical support, vehicle assignments, and equipment allocation.'),
            ('Command', 'Chain of command, signal plan, reporting procedures, and succession of authority.')]) + '</div>')),
    ('Selection', section(5, 'Selection Baseline', f'The {blue("Standard.")}', 'The standard we hold every operator to &mdash; before they ever step on a detail.',
        '<div class="eyebrow in" style="margin-top:1rem">10 Attributes for Dignitary Protection</div>'
        + chips(['Integrity', 'Determination', 'Effective Intelligence', 'Physical Ability', 'Dependability', 'Teamwork', 'Adaptability', 'Interpersonal Skills', 'Initiative', 'Stress Tolerance'])
        + '<div class="eyebrow in">Five Leadership Traits</div>' + chips(['Courage', 'Honor', 'Integrity', 'Loyalty', 'Discipline'])
        + '<div class="eyebrow in">Soft Skills</div>'
        + cards([('Combative Disruptions', 'Understanding and managing confrontational scenarios with tactical composure.'),
                 ('Direct &amp; Consistent Response', 'Immediate, measured response to disruptive behavior &mdash; every time, without hesitation.'),
                 ('Kill With Kindness', 'Read intent. Disarm tension through professionalism and interpersonal intelligence before it escalates.'),
                 ('Verbal Judo', 'React and initiate a disruptive response that de-escalates the situation through tactical verbal communication.'),
                 ('Command Presence', 'Project authority, confidence, and control through bearing, posture, and professional demeanor.'),
                 ('Attention &amp; Effective Intelligence', 'Capacity for sustained situational awareness and real-time threat assessment in dynamic environments.')]))),
    ('SOP', section(6, 'Standard Operating Procedure', f'The Protective {blue("Detail SOP.")}', 'The operational framework behind every detail.',
        cards([('Critical Time', 'The window of maximum vulnerability &mdash; arrival, departure, transitions, and exposed movements.'),
               ('Hit Time', 'The precise moment an adversary is most likely to act &mdash; identified, planned for, and neutralized.')], 'cards two', numbered=False)
        + '<div class="eyebrow in" style="margin-top:1.6rem">PACE Planning</div>'
        + cards([('Primary', 'First-choice route, venue, and protocol. Fully advanced and verified.'), ('Alternate', 'Secondary option &mdash; pre-scouted, ready to execute if primary is compromised.'),
                 ('Contingency', 'Emergency fallback when both primary and alternate are unavailable.'), ('Emergency', 'Last resort &mdash; immediate extraction, safe haven, or emergency action protocol.')], 'cards four')
        + '<div class="eyebrow in" style="margin-top:1.6rem">Location Baseline</div>'
        + cards([('Terrain', 'Physical environment, entry/exit points, elevation, cover, and concealment.'), ('Weather', 'Conditions affecting visibility, movement, comms, and threat posture.'),
                 ('Range of Ops', 'Operational radius, response times, and jurisdictional boundaries.'), ('Advance Recon', 'Advance team reconnaissance &mdash; site surveys, threat ID, and venue clearance.'),
                 ('Schedule Tempo', 'Schedule and locations tempo &mdash; timing, transitions, and movement patterns.')]))),
    ('Transport', section(7, 'Secure Transport', f'Moving {blue("Safely.")}', 'Armed drivers, route planning, and tactical escort for motorcade operations. Motorcade and vehicular tactics are taught at MAST Solutions and run by the same people.',
        '<div class="ctas rise">' + cta('contact.html', 'Plan a Movement') + cta2('https://www.mastsolutions.com/', 'Vehicular Tactics Courses') + '</div>')),
    ('Contact', contact_chapter(8, 'Protecting What Matters Most', f'From Senators to {blue("Fortune 500.")}', 'From U.S. Senators to Fortune 500 executives &mdash; discreet, adaptive protection at the highest level.',
        cta('contact.html', 'Contact Us') + cta2('residential-protection.html', 'Residential Protection &rarr;'))),
    ('Reviews', reviews_chapter(9)),
], photos=[(HERO_EP, None), (EP_MATTERS, None), (PROTECTION, None), (HERO_EP, None), (EP_MATTERS, None), (PROTECTION, None), (HERO_EP, None), (EP_MATTERS, None), (HERO_EP, None)],
      jsonld=jsonld_service('Executive Protection', 'Dignitary and executive protection: close protection, advance operations, motorcade planning, body man duties, crisis management and emergency response.', 'executive-protection.html'))

# ═══════════════════════════ residential-protection.html ═══════════════════════════
build('residential-protection.html',
      'Residential Protection Houston TX | Atlas Glinn',
      'Unmatched residential security for your home. 24/7 trained guards, AI surveillance, and round-the-clock protection for your family and assets. Houston, TX.',
      CCTV, CREDITS, [
    ('Opening', opening('Residential Protection', f'{shimmer("Details")} <span class="white">Matter.</span>',
        'Atlas Glinn provides comprehensive residential protection with highly trained security guards available 24/7, ensuring round-the-clock protection for your home and valuable assets. Whether you require an on-site presence or remote surveillance, we customize our protection to your exact needs &mdash; adapting to your lifestyle while maintaining an uncompromising security posture.',
        cta('contact.html', 'Contact Us') + cta2('#s2', 'Four Pillars'))),
    ('Four Pillars', section(2, 'Unmatched Security For Your Home', f'Four Pillars of {blue("Residential Defense.")}',
        'Our residential security programs are built on a layered defense philosophy: physical presence, advanced technology, and intelligence-driven protocols working in concert to create an impenetrable shield around your property.',
        cards([('24/7 Guard Force', 'Trained, licensed security officers providing round-the-clock physical presence. Background-verified and professionally equipped.', '', '🛡'),
               ('AI Surveillance', 'Integrated camera systems with AI-driven analytics &mdash; facial recognition, behavior detection, and real-time alerts.', '', '👁'),
               ('Access Control', 'Perimeter security, visitor management, vehicle screening, and electronic access systems for complete control.', '', '🔒'),
               ('Emergency Response', 'Documented emergency action plans, law enforcement coordination, and rapid response protocols tailored to your property.', '', '⚠')], 'cards four')
        + figure(RESI_COVERAGE, 'Atlas Glinn residential protection'))),
    ('Coverage', section(3, 'Peace of Mind &middot; Your Family&rsquo;s Safety Is Non-Negotiable.', f'Comprehensive {blue("Coverage.")}', 'Every residential engagement is tailored to the property, the family, and the threat environment.',
        cards([('Estate Security', 'Full perimeter protection for high-value residences &mdash; gates, fencing, lighting assessments, and dedicated guard posts. Comprehensive coverage for estates of any size.', '', '🏠'),
               ('Remote Monitoring', '24/7 camera surveillance with AI analytics &mdash; Deep Sentinel live agents, Rhombus smart cameras, and LVT mobile units providing constant vigilance.', '', '📹'),
               ('Alarm Integration', 'Direct integration with your existing alarm and automation systems. Atlas Glinn becomes your monitoring center with guaranteed response times.', '', '🚨'),
               ('Safe Room Planning', 'Threat assessment and safe room design consultation for high-risk residences and families requiring enhanced protection layers.', '', '🔑'),
               ('K-9 Security', 'Trained security K-9 units available for patrol and detection operations on large residential properties. A proven force multiplier.', '', '🐶'),
               ('Vulnerability Assessment', 'Comprehensive property security audits identifying entry points, blind spots, and upgrade recommendations to harden your residence.', '', '📋')]))),
    ('Contact', contact_chapter(4, 'Ready to Secure Your Home?', f'Start With an {blue("Assessment.")}', 'Every engagement begins with a confidential property assessment. Reach out to discuss your family&rsquo;s security requirements.',
        cta('contact.html', 'Contact Us') + cta2('technology.html', 'View Technology') + cta2(TEL, PHONE))),
    ('Reviews', reviews_chapter(5)),
], photos=[(CCTV, None, FILM_RESI), (CCTV, None), (RESI_COVERAGE, None), (CCTV, None), (HERO_EP, None)],   # the live page opens on residential_hero.mp4 (no YouTube film there)
      jsonld=jsonld_service('Residential Protection', '24/7 guard force, AI surveillance, access control and emergency response for estates and residences in Houston, Texas.', 'residential-protection.html'))

# ═══════════════════════════ disaster-recovery.html ═══════════════════════════
build('disaster-recovery.html',
      'Disaster Recovery & Asset Protection Houston TX | Atlas Glinn',
      'Disaster recovery and asset protection services by Atlas Glinn. Immediate response, asset safeguarding, and rapid recovery for floods, hurricanes, and crisis events. Houston, TX and the Gulf Coast.',
      'images/disaster-hurricane.jpg', CREDITS, [
    ('Opening', opening('Disaster Recovery &amp; Asset Protection', f'{shimmer("Details")} <span class="white">Matter.</span>',
        'Atlas Glinn offers comprehensive disaster recovery and asset protection services designed to help clients rebuild and protect assets following natural catastrophes, industrial incidents, and crisis events. From hurricanes and flooding to fire and power grid failures, we deploy rapidly to secure what matters most.',
        cta('contact.html', 'Contact Us') + cta2('#s2', 'Core Capabilities'))),
    ('Capabilities', section(2, 'Disaster Recovery &amp; Asset Protection', f'Core {blue("Capabilities.")}',
        'We specialize in safeguarding and securely storing your most valued assets when danger is imminent, and providing the personnel and logistics to get operations back online as quickly as possible. Our teams are trained for the worst-case scenario so you never have to face it alone.',
        '<div class="cards">' + ''.join(f'<div class="card rise"><div class="meta">{m}</div><h3>{t}</h3><p>{b}</p></div>' for m, t, b in [
            ('01 &mdash; Emergency Response', 'Immediate Deployment', 'Immediate deployment of trained security and logistics personnel when disaster strikes. First responder coordination, site lockdown, emergency communication establishment, and 24/7 operations center activation to ensure rapid, organized crisis management from the first moments.'),
            ('02 &mdash; Asset Protection', 'Safeguard What Matters', 'Comprehensive strategies to safeguard your assets before, during, and after a disaster. Secure transport and relocation, temporary storage coordination, chain-of-custody documentation, and perimeter security to prevent loss, theft, or further damage during vulnerable periods.'),
            ('03 &mdash; Recovery Assistance', 'Minimize Losses, Expedite Recovery', 'Post-event site security, damage assessment support, insurance documentation assistance, and coordination with contractors and recovery teams. We help minimize losses and get your operations back online with structured recovery protocols and experienced personnel.')]) + '</div>')),
    ('Rapid Deployment', section(3, 'Rapid Deployment', f'Your Assets Don&rsquo;t Wait. {blue("Neither Do We.")}', '',
        figure(PROTECTION, 'Atlas Glinn asset protection'))),
    ('Scenarios', section(4, 'Prepared for Anything', f'Every {blue("Scenario.")}', 'Atlas Glinn deploys for natural disasters, man-made crises, and everything in between.',
        tiles([ltile('🌀', 'Hurricanes &amp; Storms', 'Pre-storm boarding and asset relocation. Post-storm site security, access control, and recovery logistics throughout the Gulf Coast and beyond.', 'images/disaster-hurricane.jpg', 'contact.html', more='Talk to us &rarr;', icon=True),
               ltile('🌊', 'Flooding', 'Emergency asset extraction, temporary storage coordination, and 24/7 site security during flood events and extended recovery periods.', 'images/disaster-flood.jpg', 'contact.html', more='Talk to us &rarr;', icon=True),
               ltile('🔥', 'Fire &amp; Structural', 'Post-fire perimeter security, salvage coordination, and asset protection during reconstruction and insurance investigations.', 'images/disaster-fire.jpg', 'contact.html', more='Talk to us &rarr;', icon=True),
               ltile('🏗', 'Industrial Incidents', 'Plant and facility security following industrial accidents. Personnel accountability, perimeter control, and evidence preservation for investigations.', 'images/disaster-industrial.jpg', 'contact.html', more='Talk to us &rarr;', icon=True),
               ltile('⚡', 'Power Grid Failures', 'Security augmentation during extended power outages. Generator coordination, access control, and anti-looting patrols to protect your property.', 'images/disaster-lightning.jpg', 'contact.html', more='Talk to us &rarr;', icon=True),
               ltile('🏢', 'Commercial Properties', 'Retail, office, and warehouse security during and after disaster events. Inventory protection and controlled access for repair crews and contractors.', 'images/disaster-commercial.jpg', 'contact.html', more='Talk to us &rarr;', icon=True)]))),
    ('Contact', contact_chapter(5, 'Don&rsquo;t Wait for the Storm', f'Plan {blue("Before.")}', 'Proactive planning saves assets and lives. Contact us to develop a disaster recovery plan before you need one.',
        cta('contact.html', 'Contact Us') + cta2('residential-protection.html', 'Residential Protection &rarr;'))),
    ('Reviews', reviews_chapter(6)),
], photos=[('images/disaster-hurricane.jpg', None, FILM_DISASTER), (PROTECTION, None), (PROTECTION, None), ('images/disaster-hurricane.jpg', None), ('images/disaster-lightning.jpg', None), ('images/disaster-commercial.jpg', None)],
      jsonld=jsonld_service('Disaster Recovery and Asset Protection', 'Immediate deployment, asset safeguarding and recovery assistance for hurricanes, flooding, fire, industrial incidents and power grid failures.', 'disaster-recovery.html'))

# ═══════════════════════════ training.html ═══════════════════════════
build('training.html',
      'Executive Protection & Security Training Houston TX | Atlas Glinn / MAST Solutions',
      'Elite tactical training by Atlas Glinn and MAST Solutions. Executive protection training, firearms, CQB, medical, and leadership programs for professionals.',
      TRAINING, CREDITS, [
    ('Opening', opening('Dignitary Protection Training', f'{shimmer("Details")} <span class="white">Matter.</span>',
        'At Atlas Glinn, our lead instructor brings decades of experience, safeguarding dignitaries globally. We offer unparalleled Dignitary Protection training for professionals seeking to excel in high-stakes environments.',   # live: "over 30 years"; Brockmann 2026-09-05: decades, no year figure
        cta('https://www.mastsolutions.com/', 'Explore MAST Solutions') + cta2('#s2', 'Focus Areas'))),
    ('Focus Areas', section(2, 'Training', f'Core Training {blue("Focus Areas.")}', '',
        cards([('Advanced Threat Assessment &amp; Risk Management', 'Learn to identify, evaluate, and mitigate threats before they materialize. Comprehensive risk analysis methodologies used by top-tier protection teams worldwide.', '', '🔎'),
               ('Tactical Driving &amp; Motorcade Operations', 'Master evasive driving techniques, route planning, and multi-vehicle motorcade coordination for secure ground transportation in any environment.', '', '🚗'),
               ('Strategic Mission Planning &amp; Execution', 'Develop operational plans from advance work through mission completion. Intelligence gathering, contingency planning, and real-time decision making.', '', '📋'),
               ('Close Protection Techniques &amp; Body Man Duties', 'Hands-on training in personal protection formations, crowd management, venue security, and the art of seamless close-proximity security.', '', '🛡'),
               ('Crisis Management &amp; Emergency Response', 'Prepare for worst-case scenarios with crisis management protocols, evacuation procedures, medical response, and real-time coordination under pressure.', '', '⚠')]))),
    ('Disciplines', section(3, 'Competence Standards', f'Seven Core {blue("Disciplines.")}', 'Every operator is measured against our Selection Baseline before they ever step on a detail.',
        cards([('Firearms', 'Advanced marksmanship and weapon handling', '', '🎯'), ('Hand Combat', 'Close-quarters fighting techniques', '', '🥊'), ('Knife Combat', 'Defensive and tactical knife skills', '', '🗡'), ('CQB', 'Close Quarters Battle operations', '', '⚔'),
               ('Fitness', 'Peak physical conditioning for duty', '', '💪'), ('Medical', 'Emergency medical &amp; trauma care', '', '⚕'), ('Leadership', 'Command, decision-making, dynamics', '', '⭐')], 'cards four')
        + '<p class="sub" style="margin-top:1.6rem">These seven disciplines are the foundation of every MAST Solutions program.</p>'
        + '<div class="ctas rise">' + cta('https://www.mastsolutions.com/', 'Explore MAST Solutions') + '</div>')),
    ('Media', section(4, 'Training Media', f'Featured on Modern Shooter TV and {blue("The Washington Post.")}', '',
        '<div class="yt-grid rise">'
        '<div class="yt-card"><div class="frame"><iframe src="https://www.youtube.com/embed/pSGWdaDglZE?rel=0&amp;modestbranding=1" title="Modern Shooter TV — MAST Solutions" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div><div class="info"><h4>Modern Shooter TV</h4><p>Lance M / Castro / Ray Cash &mdash; MAST Solutions</p></div></div>'
        '<div class="yt-card"><div class="frame"><iframe src="https://www.youtube.com/embed/OfXe_bdH6t4?rel=0&amp;modestbranding=1" title="Modern Shooter TV — Tactical Training Feature" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div><div class="info"><h4>Modern Shooter TV</h4><p>Tactical Training Feature</p></div></div>'
        '</div>'
        '<div class="eyebrow in" style="margin-top:2rem">Press Feature</div>'
        '<a href="https://www.washingtonpost.com/graphics/2018/national/amp-stories/arming-american-teachers/" target="_blank" rel="noopener" class="post"><small>The Washington Post</small>Active Shooter: Arming American Teachers</a>'
        '<p class="sub" style="margin-top:1.4rem;font-size:.95rem">MAST Solutions featured in The Washington Post&rsquo;s coverage on active shooter preparedness and school security training. An in-depth look at how Atlas Glinn&rsquo;s training programs prepare educators and security professionals for real-world threats. <a href="https://www.washingtonpost.com/graphics/2018/national/amp-stories/arming-american-teachers/" target="_blank" rel="noopener">Read The Feature &rarr;</a></p>')),
    ('Reviews', reviews_chapter(5)),
], photos=[(TRAINING, None, FILM_TRAIN), (TRAINING, None), (HERO_EP, None), (EP_MATTERS, None), (TRAINING, None)],   # the live page opens on training_hero.mp4; its two Modern Shooter TV embeds are in the Media chapter
      jsonld=jsonld_service('Executive Protection and Tactical Training', 'Dignitary protection training and the seven MAST Solutions disciplines: firearms, hand combat, knife combat, CQB, fitness, medical, leadership.', 'training.html'))

# ═══════════════════════════ technology.html ═══════════════════════════
build('technology.html',
      'Security Technology & AI Surveillance | Atlas Glinn',
      'Atlas Glinn technology solutions: the Atlas EP platform, AI surveillance with Rhombus, Deep Sentinel and LVT, counter-drone defense with AeroDefense, and autonomous UAS with Sunflower Labs.',
      AI_SURV, CREDITS, [
    ('Opening', opening('Technology', f'{shimmer("Details")} <span class="white">Matter.</span>', '',
        cta('ep-app.html', 'Explore Atlas EP') + cta2('#s2', 'Atlas EP Platform'))),
    ('Atlas EP', section(2, 'Atlas EP Platform', f'The Atlas EP {blue("Platform.")}', 'Our proprietary executive protection platform integrates AI threat analysis, Blue Force Tracking, encrypted comms, and covert emergency streaming &mdash; all in one secure iOS app.',
        '<div class="ctas rise">' + cta('ep-app.html', 'Explore Atlas EP') + '</div>')),
    ('AI Surveillance', section(3, 'AI Surveillance', f'AI {blue("Surveillance.")}', 'Atlas Glinn offers cutting-edge AI surveillance technology through our exclusive partnerships with Rhombus, Deep Sentinel &amp; LVT.',
        cards([('Rhombus', 'Physical security shouldn&rsquo;t be stressful. With Rhombus, you can make your spaces safer and smarter. Built by cybersecurity experts, Rhombus delivers a cloud-based platform with built-in AI analytics.', '<a class="secondary-cta" href="https://www.rhombus.com/" target="_blank" rel="noopener">Learn More &rarr;</a>'),
               ('Deep Sentinel', 'The only system that actually stops crime before it happens. Deep Sentinel&rsquo;s patented AI-powered live guard solution combines AI-driven surveillance with live guard response, turning passive cameras into powerful crime prevention tools.', '<a class="secondary-cta" href="https://www.deepsentinel.com/partners/?utm_source=atlasglinn&amp;utm_medium=partner&amp;utm_campaign=technology" target="_blank" rel="noopener">Learn More &rarr;</a>'),
               ('LVT (Live View Technologies)', 'Atlas Glinn partners with Live View Technologies. Solar-powered, wireless surveillance with advanced cameras, analytics, and real-time monitoring.', '<a class="secondary-cta" href="https://www.lvt.com/partner/atlas-glinn" target="_blank" rel="noopener">Learn More &rarr;</a>')], numbered=False))),
    ('Deep Sentinel', section(4, 'Deep Sentinel', f'Deep {blue("Sentinel.")}', 'Deep Sentinel is revolutionizing physical security as the only system that actually stops crime before it happens. Trusted by thousands of businesses and homes across the U.S., their patented solution combines AI-driven surveillance with live guard response &mdash; integrating seamlessly with third-party cameras or Deep Sentinel&rsquo;s own hardware.',
        '<div class="ctas rise">' + cta2('https://www.deepsentinel.com/partners/?utm_source=atlasglinn&amp;utm_medium=partner&amp;utm_campaign=technology', 'Partner Page &rarr;') + '</div>' + figure(AI_SURV, 'Deep Sentinel AI surveillance'))),
    ('Counter-Drone', section(5, 'Counter-Drone Solutions', f'Counter-Drone {blue("Solutions.")}', '',
        partner(['Atlas Glinn, in partnership with AeroDefense, delivers advanced drone detection solutions to safeguard critical infrastructure, public safety, &amp; national security &mdash; locating both drones &amp; their operators in real time.',
                 'AeroDefense&rsquo;s Made-in-the-USA system simultaneously locates both the drone and its pilot. DHS Safety Act Designated.'],
                cta2('cuas-aerodefense.html', 'Learn More'), AERO, 'AeroDefense partner — Atlas Glinn'))),
    ('Advanced UAS', section(6, 'Advanced UAS Solutions', f'Advanced UAS {blue("Solutions.")}', '',
        partner(['Through elite partnership with Sunflower Labs, Atlas Glinn delivers autonomous drones for real-time surveillance, instant threat response, and seamless security integration.',
                 'Sunflower Labs&rsquo; fully autonomous drones provide real-time, intelligent surveillance. These drones fly without human intervention, responding instantly to alarms and security system triggers.'],
                cta2('contact.html', 'Inquire About UAS'), UAS_IMG, 'Sunflower Labs autonomous UAS'))),
    ('Reviews', reviews_chapter(7)),
], photos=[(AI_SURV, None, FILM_TECH), (CCTV, None), (AI_SURV, None), (AI_SURV, None), (AERO, None), (UAS_IMG, None), (HERO_EP, None)],
      jsonld=jsonld_service('Security Technology', 'Atlas EP platform, AI surveillance with Rhombus, Deep Sentinel and LVT, counter-drone with AeroDefense, autonomous UAS with Sunflower Labs.', 'technology.html'))

# ═══════════════════════════ cuas-aerodefense.html ═══════════════════════════
build('cuas-aerodefense.html',
      'Counter-Drone Solutions Houston TX | AirWarden cUAS — Atlas Glinn',
      'Counter-drone defense with AirWarden by AeroDefense. DHS SAFETY Act designated. Simultaneously locates drones AND pilots in real time. Atlas Glinn, Texas regional partner.',
      AERO, CREDITS, [
    ('Opening', opening('Counter-Drone Solutions', f'{shimmer("Details")} <span class="white">Matter.</span>',
        'AirWarden by AeroDefense &mdash; The Only System That Simultaneously Locates Both Drone AND Pilot',
        cta('contact.html', 'Contact Us') + cta2('#s2', 'System Capabilities'))),
    ('Capabilities', section(2, 'AirWarden by AeroDefense', f'System {blue("Capabilities.")}',
        'Atlas Glinn is the Texas regional partner for AeroDefense, bringing cutting-edge counter-drone technology to critical infrastructure, high-profile events, and security-sensitive facilities. AirWarden simultaneously locates both the drone and its pilot, enabling security and law enforcement personnel to quickly address the source of potential threats &mdash; not just the drone in the air. Made in the USA, AirWarden provides real-time early warning and situational awareness for critical infrastructure, public safety, and national security applications. All solutions are FAA-compliant, ensuring lawful and effective deployment.',
        cards([('Dual Detection', 'Simultaneously locates both drones and their operators in real time &mdash; the only way to truly neutralize the threat at its source. Know where the pilot is hiding, not just where the drone is flying.'),
               ('Real-Time Early Warning', 'Instant alerting and situational awareness. Know about drone incursions before they reach your protected airspace, giving your team critical response time.'),
               ('DHS SAFETY Act Designated', 'AirWarden has received the Department of Homeland Security SAFETY Act Designation, providing important legal liability protections for providers of qualified anti-terrorism technologies.'),
               ('Made in the USA', 'Designed and manufactured in the United States. No foreign dependencies. Trusted by government agencies and critical infrastructure operators nationwide.'),
               ('FAA Compliant', 'All Atlas Glinn counter-drone solutions are fully FAA-compliant, ensuring lawful deployment without regulatory risk. Protect your airspace within the bounds of federal aviation law.'),
               ('Scalable Architecture', 'From single-site protection to enterprise-wide deployments, AirWarden scales to meet the demands of any environment &mdash; stadiums, campuses, industrial facilities, and more.')]))),
    ('SAFETY Act', section(3, 'Department of Homeland Security', f'SAFETY Act {blue("Designated.")}',
        'AirWarden has received the DHS SAFETY Act Designation &mdash; providing important legal liability protections for providers of Qualified Anti-Terrorism Technologies deployed in the defense of critical infrastructure.', '')),
    ('Threats', section(4, 'Countering Drone Threats', f'The {blue("Threat.")}', 'Malicious drone operations are growing. AirWarden detects and locates threats before damage is done.',
        cards([('Espionage', 'Corporate and government surveillance via unauthorized drones over sensitive facilities and executive residences.', '', '🕵'),
               ('Contraband Delivery', 'Drone-based delivery of contraband to correctional facilities, secure sites, and restricted zones.', '', '📦'),
               ('Criminal Warning', 'Drones used as early warning systems for criminal operations, providing real-time surveillance of law enforcement movements.', '', '⚠'),
               ('Infrastructure Attacks', 'Direct attacks on critical infrastructure &mdash; power grids, water systems, communications networks, and transportation hubs.', '', '🏭')], 'cards four'))),
    ('Proven', section(5, 'Proven in the Field', f'Real-World {blue("Deployment.")}', '',
        '<p class="sub quote lead">&ldquo;Recently, we protected a high-profile event from a potential drone threat, ensuring safety without disruption. Our team deployed AirWarden to establish a secure airspace perimeter, detecting and locating an unauthorized drone and its operator within minutes &mdash; allowing law enforcement to respond before any incident occurred.&rdquo;</p>'
        '<p class="sub" style="font-family:\'Share Tech Mono\',monospace;font-size:.7rem;letter-spacing:.25em;text-transform:uppercase">Atlas Glinn &mdash; Real-World Deployment</p>')),
    ('Integration', section(6, 'Autonomous Drone Integration', f'Detection &rarr; Alert &rarr; {blue("Autonomous Response.")}',
        'Atlas Glinn integrates AirWarden counter-drone detection with Sunflower Labs autonomous drone systems for comprehensive perimeter protection. When a threat is detected, autonomous response drones can be deployed to visually verify and track incursions in real time.',
        '<p class="sub">This layered approach combines passive RF detection with active autonomous response &mdash; delivering a complete airspace security solution that stays ahead of evolving threats.</p>'
        '<p class="sub">Detection &rarr; Alert &rarr; Autonomous Response</p>'   # the live page's line, above its Layered Airspace Security label
        '<div class="ctas rise">' + cta2('uas.html', 'Learn About UAS Drones') + '</div>'
        '<p class="sub" style="margin-top:1.4rem;font-family:\'Share Tech Mono\',monospace;font-size:.7rem;letter-spacing:.25em;text-transform:uppercase">Layered Airspace Security</p>')),
    ('Stay Ahead', section(7, 'Stay Ahead', f'Stay {blue("Ahead.")}', 'Stay ahead of drone-related risks with Atlas Glinn&rsquo;s expertise in counter-drone strategies. Our team brings decades of security experience to every deployment, ensuring your airspace remains secure and your operations uninterrupted.',
        '<div class="eyebrow in" style="margin-top:2rem">From Our Blog</div>'
        + cards([('How cUAS Aerodefense Stops Drone Threats', 'Learn how counter-UAS technology is transforming airspace security for critical infrastructure and high-profile events.', '<a class="secondary-cta" href="https://atlasglinn.com/counter-drone-solutions/how-cuas-aerodefense-stops-drone-threats-in-their-tracks/">Read &rarr;</a>')], 'cards two', numbered=False))),
    ('Contact', contact_chapter(8, 'Is Your Airspace Protected?', f'Assess Your {blue("Vulnerability.")}', 'Drone threats are real and growing. Contact Atlas Glinn to assess your facility&rsquo;s vulnerability and deploy AirWarden protection.',
        cta('contact.html', 'Contact Us') + cta2(TEL, 'Phone: ' + PHONE))),
    ('Reviews', reviews_chapter(9)),
], photos=[yt_bg(YT_CUAS), (AERO, None), (AERO, None), (UAS_IMG, None), (AERO, None), (UAS_IMG, None), (AERO, None), (AERO, None), (HERO_EP, None)],
      jsonld=jsonld_service('Counter-Drone Solutions', 'AirWarden by AeroDefense counter-UAS detection locating drones and their pilots; DHS SAFETY Act designated; Atlas Glinn is the Texas regional partner.', 'cuas-aerodefense.html'))

# ═══════════════════════════ uas.html ═══════════════════════════
build('uas.html',
      'Autonomous Drone Security Houston TX | Sunflower Labs — Atlas Glinn',
      'Fully autonomous drone surveillance by Sunflower Labs. Real-time intelligent monitoring, AI detection, and 24/7 property protection through Atlas Glinn.',
      UAS_IMG, CREDITS, [
    ('Opening', opening('Autonomous Drones That Never Sleep', f'{shimmer("Details")} <span class="white">Matter.</span>',
        'Sunflower Labs partnership delivering fully autonomous aerial surveillance. Atlas Glinn partners with Sunflower Labs to deliver cutting-edge autonomous drone technology integrated into complete security solutions. The Beehive system deploys The Bee &mdash; a fully autonomous drone &mdash; on demand or on schedule, with zero human intervention required. AI detection identifies people, vehicles, and animals with real-time tracking. The drone autonomously navigates, surveys, deters, and returns to base to recharge &mdash; all without a pilot. This is security that never takes a break.',
        cta('contact.html', 'Contact Us') + cta2('#s2', 'Intelligent Detection'))),
    ('Detection', section(2, 'Intelligent Detection', f'AI-Powered Threat Identification and {blue("Real-Time Response.")}', '',
        cards([('People Detection', 'Advanced AI identifies and tracks human subjects in real time, day or night. Low-light and optional thermal imaging ensure no gap in coverage.'),
               ('Vehicle Recognition', 'Automated vehicle detection and tracking across parking lots, driveways, and perimeters. Instant alerts for unauthorized access.'),
               ('Animal Classification', 'AI distinguishes between human threats and wildlife, reducing false alarms while maintaining maximum threat awareness.'),
               ('Real-Time Tracking', 'Continuous subject tracking from detection through resolution. Live HD video feeds to security teams and monitoring centers.'),
               ('Autonomous Deterrence', 'Visible drone presence deters intruders on contact. No waiting for human response &mdash; the system acts immediately and autonomously.'),
               ('Zero Human Intervention', 'From launch to landing, The Bee operates entirely on its own. Self-deploying, self-navigating, self-charging. Fully autonomous.')]))),
    ('No Pilot', section(3, '24/7 Autonomous', f'No Pilot Required. {blue("No Gaps in Coverage.")}', 'Autonomous drones via Sunflower Labs. Real-time intelligent surveillance with instant threat response.',
        figure(UAS_IMG, 'Sunflower Labs autonomous drone'))),
    ('How It Works', section(4, 'How It Works', f'Six-Step Autonomous {blue("Security Cycle.")}', '',
        '<div class="steps">' + ''.join(f'<div class="card rise"><h3>{t}</h3><p>{b}</p></div>' for t, b in [
            ('Trigger', 'Flight triggered automatically by motion sensors, cameras, scheduled intervals, or manual demand via app.'),
            ('Navigate', 'The Bee autonomously navigates to the destination with obstacle avoidance in 99% of weather conditions.'),
            ('Monitor', 'Real-time HD video with AI detection &mdash; identifying people, vehicles, and animals. Low-light and optional thermal imaging.'),
            ('Deter', 'Visible drone presence deters intruders. Tracking provides real-time alerts to security teams and monitoring centers.'),
            ('Return', 'Autonomous return-to-base and self-charging. Ready for the next flight within minutes.'),
            ('Repeat', 'Up to 8 hours of daily drone coverage. Continuous autonomous protection without interruption.')]) + '</div>')),
    ('Specifications', section(5, 'System Specifications', f'The {blue("Beehive.")}', 'Purpose-built for security. The Beehive houses, charges, and deploys The Bee autonomously. Operates within geocaged airspace restricted to your property.',
        f'<div class="partner rise"><div class="spec">' + ''.join(f'<div><b>{k}</b><span>{v}</span></div>' for k, v in [
            ('Operational Radius', '~600m (1,800 ft)'), ('Flight Duration', 'Up to 20 min'), ('Daily Coverage', 'Up to 8 hours'), ('Operating Cost', '$4&ndash;7/hour'),
            ('Installation', '8&ndash;12 weeks'), ('Weather', '99% conditions'), ('Integrations', 'RTSP, Webhooks, API')]) + f'</div><img src="{UAS_IMG}" alt="Sunflower Labs Beehive system" loading="lazy"></div>')),
    ('Contact', contact_chapter(6, 'Ready for Autonomous Protection?', f'Design {blue("Yours.")}', 'Contact Atlas Glinn to design a custom autonomous drone surveillance solution for your property.',
        cta('contact.html', 'Contact Us') + cta2(TEL, PHONE))),
    ('Reviews', reviews_chapter(7)),
], photos=[(UAS_IMG, None, FILM_TECH), (UAS_IMG, None), (UAS_IMG, None), (UAS_IMG, None), (UAS_IMG, None), (UAS_IMG, None), (HERO_EP, None)],   # the live uas page: the technology film, then its one photograph (the Beehive upload answers 404 on the live host)
      jsonld=jsonld_service('Autonomous UAS Security', 'Sunflower Labs Beehive autonomous drone surveillance with AI detection of people, vehicles and animals, integrated by Atlas Glinn.', 'uas.html'))

# ═══════════════════════════ about.html ═══════════════════════════
# held back 2026-09-08: not on the live site; publish only on Brockmann's word
BROCKMANN_BIO = ('Matthew Brockmann is the visionary founder of both MAST Solutions and Atlas Glinn, bringing decades of expertise in security, training, and dignitary protection. A seasoned civilian contractor, he specializes in Military, Law Enforcement, and Homeland Security Special Response Teams (SRT), with extensive experience collaborating with elite Tier 1 Operators from units like Navy SEALs, Recon Marines, and USASOC. His career began in 1991 at Gunsite under Col. Jeff Cooper. '
                 + PRIVACY_LINE + ' He is a certified Firearms Instructor for civilians, law enforcement, and agencies, and a Gracie Jiu-Jitsu practitioner.')
# The live About page's team, word for word (capture-live, 2026-09-05): its founder lead, and the two members the April
# build did not have. Renobato has no photograph on the live page (an icon), so her block carries the wordmark.
FOUNDER_LEAD = ('When a principal&rsquo;s safety is non-negotiable, the margin for error is exactly zero. That&rsquo;s the standard Matthew Brockmann built his work around &mdash; running protection details where intent, baseline cues, and seconds decide outcomes. He founded MAST Solutions in 2005. Atlas Glinn followed in 2019. Atlas EP &mdash; the intelligence platform &mdash; came after, because the right tech didn&rsquo;t exist yet.')
CLINE_BIO = ('As the Chief Operating Officer at Atlas Glinn, Michael Cline brings a wealth of experience and a strategic vision to the company. With a distinguished 12-year career as a Navy SEAL, Michael has honed exceptional leadership, discipline, and problem-solving skills that are now pivotal in driving Atlas Glinn&rsquo;s operational excellence.')
GLOVER_BIO = ('Anthony Glover serves as the Houston Region Operations Manager and Level 3 Private Protection Officer at Atlas Glinn, a role he assumed in January 2026. A seasoned security leader with over a decade of experience in the private sector, Glover directs multi-site protective operations, oversees agent deployment and performance, and drives operational strategy across the Houston region. He leads a team of security professionals delivering 24/7 protection. Prior to his promotion, Glover served as Site Supervisor at Atlas Glinn, managing a six-agent detail providing round-the-clock protection. Before joining Atlas Glinn, he spent seven years in Chicago&rsquo;s high-risk environment protecting families and children, developing deep expertise in conflict resolution, de-escalation, and discreet protective operations.')
RENOBATO_BIO = ('J. Rene&eacute; Renobato serves as Office Manager and Executive Assistant to CEO Matthew Brockmann. A seasoned operations professional with over 25 years of management experience, she oversees daily administrative operations, manages executive scheduling, and ensures seamless coordination across security, training, and consulting divisions. Renobato holds a Bachelor of Arts in Communication from the University of Houston and a Master of Business Administration from Marylhurst University. Prior to joining the team, she built a distinguished career in operations management across firms including AvalonBay/Archstone Communities, Windsor Communities, and EQS Construction &mdash; managing portfolios of up to 794 units with teams of 20+. A recipient of the Houston Apartment Association&rsquo;s On-Site Manager of the Year award and a Property of the Year finalist, she brings proven expertise in budget planning, vendor relations, financial reporting, and process optimization to every aspect of her role.')
def member(img, crop, cap, name, role, paras):
    """img=None: no portrait panel at all (Brockmann, 2026-09-06: "No photo Renobato"); the bio takes the full width."""
    portrait = f'<div class="portrait" style="background-image:url(\'{img}\');{crop}"><div class="cap">{cap}</div></div>' if img else ''
    return (f'<div class="team rise{"" if img else " nopic"}">{portrait}'
            f'<div class="bio"><h3>{name}</h3><div class="role">{role}</div>' + ''.join(f'<p>{p}</p>' for p in paras) + '</div></div>')
build('about.html',
      'About Atlas Glinn | Elite Security Leadership — Houston, TX',
      'Meet the Atlas Glinn leadership team. Decades of elite security, dignitary protection, and tactical training expertise led by Matthew Brockmann and Michael Cline.',
      FOUNDER, CREDITS, [
    ('Opening', opening('About Atlas Glinn &middot; Our Mission', f'{shimmer("Details")} <span class="white">Matter.</span>',
        'Our mission is to provide you with unparalleled peace of mind, safeguarding what matters most &mdash; your safety, your assets, and your way of life. With a foundation built on elite expertise and a relentless pursuit of excellence, we deliver tailored protection solutions that blend seamlessly into your world.',
        cta('#s2', 'Meet the Team') + cta2('contact.html', 'Contact Us'))),
    ('Team', section(2, 'Meet the Team', f'Precision. Discretion. {blue("Commitment.")}', 'We redefine security with precision, discretion, and unwavering commitment.',
        member(FOUNDER, FOUNDER_CROP, 'Founder &amp; CEO', 'Matthew Brockmann', 'Founder &amp; CEO', [FOUNDER_LEAD])
        + member(CLINE, 'background-position:center 15%', 'Chief Operating Officer', 'Michael Cline', 'Chief Operating Officer', [CLINE_BIO])
        + member(GLOVER, 'background-position:center 12%', 'Houston Region Operations Manager', 'Anthony Glover', 'Level 3 &amp; PPO &mdash; Houston Region Operations Manager', [GLOVER_BIO])
        + member(None, '', '', 'J. Rene&eacute; Renobato', 'MBA, CAM, CAPS &mdash; Office Manager &amp; Executive Assistant to the CEO', [RENOBATO_BIO]))),   # no photograph, his call (2026-09-06)
    ('In Action', section(3, 'Atlas Glinn In Action', f'Behind the {blue("Mission.")}', 'Training, operations, and the people behind the mission.',
        '<div class="yt-grid rise">' + film_card(CLIP_TEAM, CAREERS_HERO, 'Atlas Glinn Team', 'Behind the scenes with our executive protection team')
        + film_card(CLIP_FORGE, TRAINING, 'MAST Solutions &mdash; Forge &amp; Legend', 'Training excellence through MAST Solutions') + '</div>')),
    ('Clients', section(4, 'What Clients Say', f'In Their {blue("Words.")}', '',
        quotes([('I&rsquo;ve worked with Matt &amp; his team for several years. They are extremely professional, and their training &amp; expertise is second to none.', 'Craig E. &middot; President &amp; CEO'),
                ('I trained with Matt &amp; the team at MAST Solutions for over a year. The techniques, skills &amp; mentality I learned in the first class were well more advanced.', 'Brian S. &middot; IRC &amp; MBA'),
                ('Simply THE BEST hands on tactical training you can find local to Houston, TX.', 'Guadalupe A. &middot; Power Testing Specialist'),
                ('Matthew is an expert in his field, I have had the privilege to train with &amp; work alongside him on numerous occasions.', 'Kenny U. &middot; Deputy'),
                ('I highly recommend Matthew &amp; his team for your security &amp; training needs.', 'Charles W. &middot; Business Operations Manager'),
                ('Matthew is a highly skilled individual with ample knowledge of firearm operations, safety &amp; security.', 'Alf T. &middot; Senior Operations Advisor')]))),
    ('Insights', section(5, 'Insights &amp; Resources', f'From the {blue("Field.")}', 'Expert perspectives on security, protection, and preparedness',
        cards([('Raising the Bar: Why the Security Industry Needs Higher Standards', 'Discover why Atlas Glinn is leading the charge to elevate training standards across the security industry.', '<a class="secondary-cta" href="training.html">Read More &rarr;</a>', '', 'Training &amp; Certification'),
               ('Why Real-World Experience Matters in Executive Protection', 'A lesson from the front lines on why field-tested expertise outperforms theory every time.', '<a class="secondary-cta" href="executive-protection.html">Read More &rarr;</a>', '', 'Case Studies'),
               ('How We Secured a CEO&rsquo;s Global Tour', 'An inside look at the coordination and planning behind protecting a Fortune 500 executive across multiple countries.', '<a class="secondary-cta" href="executive-protection.html">Read More &rarr;</a>', '', 'Case Studies'),
               ('Why Atlas Glinn&rsquo;s Security Training Sets the Standard', 'Our training programs are built on decades of real-world experience with elite military and law enforcement units.', '<a class="secondary-cta" href="training.html">Read More &rarr;</a>', '', 'Training &amp; Certification'),
               ('Preparing for Natural Disasters: A Security Must', 'Why disaster preparedness is a critical component of any comprehensive security strategy.', '<a class="secondary-cta" href="disaster-recovery.html">Read More &rarr;</a>', '', 'Disaster Recovery'),
               ('5 Essential Tips for VIP Security in 2025', 'Key strategies every VIP protection detail should implement to stay ahead of evolving threats.', '<a class="secondary-cta" href="executive-protection.html">Read More &rarr;</a>', '', 'Executive Protection')], numbered=False))),
    ('Contact', contact_chapter(6, 'Ready to Work With Us?', f'Let&rsquo;s {blue("Talk.")}', '',
        cta('contact.html', 'Contact Us') + cta2(TEL, 'Phone: ' + PHONE) + cta2('mailto:' + EMAIL, 'Email: ' + EMAIL))),
    ('Reviews', reviews_chapter(7)),
], photos=[(ABOUT_POSTER, None, ABOUT_TEASER), (FOUNDER_SCENE, 'center 20%'), (ABOUT_POSTER, None), (EP_MATTERS, None), (HERO_EP, None), (PROTECTION, None), (HERO_EP, None)],
      jsonld=jsonld_org())

# ═══════════════════════════ careers.html ═══════════════════════════
REQ = '<ul><li>Resume</li><li>Guard Card</li><li>MMPI</li><li>Firearm Proficiency</li></ul>'
build('careers.html',
      'Careers in Executive Protection | Atlas Glinn — Houston, TX',
      'Join Atlas Glinn&rsquo;s elite security team. Open positions for Personal Protection Officers and Commissioned Security Guards in Houston, TX.',
      CAREERS_HERO, CREDITS, [
    ('Opening', opening('Careers', f'{shimmer("Details")} <span class="white">Matter.</span>',
        'Part-time, flexible details in Houston for licensed officers who hold themselves to the standard. Training through MAST Solutions comes with the job.',
        cta('#s2', 'Open Positions') + cta2('contact.html', 'Apply Now'))),
    ('Positions', section(2, 'Open Positions', f'Join the {blue("Detail.")}', 'We are looking for driven professionals ready to join a world-class security team.',
        cards([('Level 4 Personal Protection Officer (Flex)', 'Provide close protection, conduct risk assessments, and escort clients during travel and events. Respond to threats with precision, maintain detailed logs, collaborate with law enforcement when necessary.',
                '<div class="meta">Houston, TX &middot; Part-Time, Flexible Schedule</div><div class="eyebrow in" style="margin:.8rem 0 .2rem;font-size:.6rem">Requirements</div>' + REQ + '<a class="cta-button" href="contact.html?subject=Level%204%20PPO%20(Flex)%20application">Apply Now</a>'),
               ('Level 3 Commissioned Security Guard (Flex)', 'Armed security at various client sites. Conduct regular patrols and inspections, respond rapidly to emergencies, collaborate with law enforcement, maintain detailed incident reports.',
                '<div class="meta">Houston, TX &middot; Part-Time, Flexible Schedule</div><div class="eyebrow in" style="margin:.8rem 0 .2rem;font-size:.6rem">Requirements</div>' + REQ + '<a class="cta-button" href="contact.html?subject=Level%203%20Commissioned%20Security%20Guard%20(Flex)%20application">Apply Now</a>')], 'cards two', numbered=False))),
    ('Why Atlas Glinn', section(3, 'Why Atlas Glinn', f'What Sets Us {blue("Apart.")}', 'What sets us apart from the rest.',
        cards([('1.5x Holiday Pay', 'Compensated at 1.5x rate for Thanksgiving, Christmas, and New Year&rsquo;s Day. 12:00 AM to 11:59 PM.'),
               ('Paid Time Off (PTO)', 'Full-time employees accrue PTO after 365 days. 4 hours per 160 hours worked, up to 48 hours per year.'),
               ('Paid Vacation', '7 days of vacation per year after 1 year of employment. Up to 14 days maximum accrual.'),
               ('Military Leave (USERRA)', 'Full compliance with federal and state military leave laws. Reinstated to your position upon return from service.'),
               ('Bereavement Leave', '2 days of leave for the death of an immediate family member &mdash; spouse, child, sibling, parent, or grandparent.'),
               ('Travel Expenses Covered', 'All travel expenses covered for out-of-town assignments &mdash; advances, air travel, rental cars, and lodging.'),
               ('Merit-Based Pay Raises', 'Performance reviews drive compensation increases. Exceptional work gets exceptional pay.'),
               ('Elite MAST Training', 'Access to MAST Solutions training programs &mdash; firearms, CQB, medical, and EP certification courses.')], 'cards four', numbered=False))),
    ('Contact', contact_chapter(4, 'Ready to Join the Team?', f'Speak With a {blue("Coordinator.")}', 'Speak with a coordinator today about available positions and next steps.',
        cta('contact.html', 'Contact Us') + cta2(TEL, PHONE))),
    ('Reviews', reviews_chapter(5)),
], photos=[(CAREERS_HERO, None), (HERO_EP, None), (TRAINING, None), (CAREERS_HERO, None), (HERO_EP, None)])

# ═══════════════════════════ contact.html ═══════════════════════════
build('contact.html',
      'Contact Atlas Glinn | Security Consultation — Houston, TX',
      'Contact Atlas Glinn for a personalized security assessment. Executive protection, training, and risk management services in Houston, TX.',
      OG_DEFAULT, CREDITS, [
    ('Opening', opening('Contact', f'{shimmer("Details")} <span class="white">Matter.</span>',
        'Every engagement begins with a conversation. Tell us what you are protecting.',
        cta('#s2', 'Send a Message') + cta2(TEL, PHONE))),
    ('Message', section(2, 'Contact Information', f'Reach {blue("Us.")}',
        f'Atlas Glinn, LLC | MAST Solutions<br>2450 Fondren Road, Suite 255<br>Houston, TX 77063<br>Phone: <a href="{TEL}" style="color:var(--gold-champagne);text-decoration:none">{PHONE}</a><br>Email: <a href="mailto:{EMAIL}" style="color:var(--gold-champagne);text-decoration:none">{EMAIL}</a><br>'
        '<a href="https://www.instagram.com/atlasglinn_mastsolutions/" target="_blank" rel="noopener" style="color:var(--gold-champagne);text-decoration:none">Instagram</a> &middot; <a href="https://www.linkedin.com/in/mastsolutions1" target="_blank" rel="noopener" style="color:var(--gold-champagne);text-decoration:none">LinkedIn</a> &middot; <a href="https://www.yelp.com/biz/atlas-glinn-houston" target="_blank" rel="noopener" style="color:var(--gold-champagne);text-decoration:none">Yelp</a>',
        contact_form('contact'))),
    ('Details', contact_chapter(3, 'Atlas Glinn, LLC', f'Details {blue("Matter.")}', 'Executive Protection &middot; Training &middot; AI Surveillance &middot; Counter-Drone Solutions &middot; Risk Management',
        cta('https://www.mastsolutions.com/', 'Book Training') + cta2('index.html', 'Home &rarr;'))),
], photos=[(HERO_EP, None, FILM_CONTACT), (PROTECTION, None), (AG3, None)],   # the live contact page opens on the corporate-buildings film
      jsonld=jsonld_org())

# ═══════════════════════════ ep-app.html ═══════════════════════════
# The live atlasglinn.com/ep-app/ page, word for word (captured 2026-09-05 21:22 UTC; Brockmann, 2026-09-06: "Add all content
# as in the old version - just updating the front end"). Until then ep-app.html was a hand-authored draft that carried 10 of
# the live page's 42 headings. The live page has no photographs (a dark gradient), so the backdrops are the platform's own
# stills from the approved list. Its "Watch the Trailer / Brand Film" buttons open films the capture could not find a file
# for; they return when the files do. The access form posts to the Worker's /contact like every other form here.
def tags(items): return '<div class="tags">' + ''.join(f'<span>{t}</span>' for t in items) + '</div>'
EP_CAPS = [
    ('🧠', 'Proactive Biometric Monitoring', 'Continuous heart rate, motion, gyroscope, and ambient audio analysis. Atlas EP detects physiological stress signatures and environmental anomalies &mdash; automatically recognizing threats before you&rsquo;re even aware of them.', ['Heart Rate', 'Motion', 'Gyro', 'Audio']),
    ('🗺', 'Blue Force Tracking', 'Military-grade GPS tracking for teams and families. See every member on an encrypted shared map in real time. Separation alerts, geofence triggers, and anti-spoofing verification built in.', ['Military-Grade', 'Encrypted GPS', 'Real-Time']),
    ('🔒', 'Encrypted Comms', 'AES-256 encrypted Push-to-Talk radio and secure messaging. No consumer apps, no metadata leaks, no interception risk. Military-grade communications for your detail, your family, or your team.', ['AES-256', 'PTT Radio', 'Secure Msg']),
    ('🚨', 'Smart Emergency Chain', 'One tap fires the full chain: trusted contacts notified, 911 auto-dialed, audio/video recording activated, GPS coordinates streamed. If you can&rsquo;t press anything, biometric triggers do it for you.', ['Auto-911', 'Recording', 'GPS Stream']),
    ('🌎', 'World Intelligence', 'Live feeds of global conflict zones, natural disaster alerts, cyber threat advisories, and flight tracking data. Know what&rsquo;s happening around you and around your principal &mdash; before it reaches the news.', ['Conflict', 'Disaster', 'Cyber', 'Flights']),
    ('🛰', '6-Layer Comms Stack', 'Never lose communications. Six redundant layers &mdash; Cellular, WiFi, Bluetooth Mesh, Iridium Satellite, Starlink, and Garmin Sat Phone &mdash; with automatic failover. Gov and enterprise clients always have satellite backup.', ['Cellular', 'Mesh', 'Iridium', 'Starlink']),
    ('🛡️', 'Counter-UAS Detection', 'Scans for FAA Remote ID drone signals via Bluetooth &mdash; no hardware needed. Integrated with AeroDefense AirWarden for professional deployments. Detects drone AND pilot location simultaneously.', ['Remote ID', 'AirWarden', 'Pilot GPS', 'AI Threat']),
    ('💪', 'Cyber Defense &amp; Auto-Disconnect', 'Real-time detection of evil twin WiFi, MITM attacks, IMSI catchers, and Bluetooth spoofing. When a threat is detected, Atlas EP automatically kills compromised connections, forces LTE, alerts your team, and starts covert recording.', ['MITM Detect', 'IMSI Catcher', 'Auto-LTE', 'Zero-Tap']),
]
EP_LAYERS = [('📶', 'Cellular', 'LTE / 5G'), ('📡', 'WiFi', 'Venue / HQ'), ('🔗', 'Mesh', 'Bluetooth'), ('🛰️', 'Iridium', 'iRD 955'), ('✨', 'Starlink', 'Satellite WiFi'), ('📱', 'Sat Phone', 'Garmin H1i')]
EP_SCENARIOS = [
    ('🏙️', 'Standard EP Detail', 'Urban operations with full cell coverage. Cellular primary, Bluetooth Mesh auto-activates in garages and basements. Seamless failover.', ['Cellular', 'Mesh']),
    ('🏔️', 'Rural / Low Coverage', 'Ranch, rural estate, hunting property. Starlink Mini at command post provides full satellite internet. Garmin as always-on backup.', ['Starlink', 'Mesh', 'Garmin']),
    ('🌍', 'International / Denied', 'Hostile territory, embassy ops, disaster zones. All 6 layers active. Bypasses local infrastructure entirely. Cyber defense auto-disconnects from compromised networks.', ['All 6 Layers', 'Zero Trust']),
    ('🏛️', 'Government / Enterprise', 'Federal, embassy, Fortune 500 C-suite. All 6 layers mandatory at all times. No consumer apps. AES-256 encryption. Full compliance.', ['Mandatory 6-Layer', 'AES-256']),
]
EP_WHO = [
    ('🛡️', 'Executive Protection Teams', 'Blue Force Tracking, encrypted PTT, threat scoring, advance work tools, and satellite comms. The complete EP operations platform.'),
    ('👪', 'Families &amp; Parents', 'Always know where your family is. Silent SOS, location sharing, emergency chains, and fall detection &mdash; peace of mind without being invasive.'),
    ('🎓', 'College Students', 'Walking alone at night? Atlas EP monitors your biometrics and surroundings. One tap or automatic trigger sends your GPS and starts recording.'),
    ('🏥', 'Healthcare Workers', 'Late shifts, parking garages, home visits. Discreet SOS, automatic duress detection, and instant emergency escalation for those who care for others.'),
    ('🧓', 'Elderly / Fall Detection', 'AI-powered fall detection with automatic emergency response. No buttons to press, no apps to navigate. If a fall is detected, help is dispatched immediately.'),
    ('🏢', 'Corporate Security', 'Protect executives, manage traveling employees, coordinate response teams. Enterprise dashboards, compliance reporting, and integration APIs.'),
]
EP_TIERS = [   # (name, price, unit, note, body, button) — the four tiers Brockmann decided on 2026-09-08; they supersede the live page's six
    ('Family', '$19.99', '/month', 'Up to 6 family members', 'Location sharing, SOS, fall detection, emergency chains, and biometric monitoring for your whole family.', 'Get Started'),
    ('Operator', '$149.99', '/month', 'One operator', 'For licensed EP agents, security professionals, and consultants. Full ops suite with priority support.', 'Get Started'),
    ('Protection Team', '$199.99', '/seat/month', 'Unlimited seats', 'Full command dashboard, team deployment board, shared ops map, and multi-agent coordination tools.', 'Get Started'),
    ('Enterprise', '$5,000+', '/month', 'Custom deployment', 'For corporations, law enforcement, and government. Dedicated infrastructure, SLA, and white-label options.', 'Contact Sales'),
]
EP_GEAR = [   # (icon, name, price, body, button, href) — the live page's Amazon links, as they are
    ('🔄', 'Atlas EP Radar Companion', 'From $15', 'Detect humans in a room before you enter &mdash; no line of sight required. M5Stack AtomS3 Lite (ESP32-S3) uses WiFi CSI to sense occupancy through interior drywall up to ~15 ft. USB-C flash, ~10s calibration, BLE-paired to the Atlas EP iPhone app for pre-entry sweeps and covert advance work.', 'Buy on Amazon &rarr;', 'https://www.amazon.com/s?k=M5Stack+AtomS3+Lite+ESP32-S3+Dev+Kit&amp;tag=atlasglinn-20'),
    ('📡', 'Garmin inReach Mini 2', '$399', 'Two-way satellite messaging when cellular networks fail. Global SOS coverage via the Iridium constellation. Atlas EP auto-routes through inReach when off-grid.', 'View on Amazon &rarr;', 'https://www.amazon.com/dp/B09X5FYD6T?tag=atlasglinn-20'),
    ('⏱', 'Apple Watch Ultra 2', '$799', 'Continuous heart rate, blood oxygen, crash detection, and fall detection. Atlas EP reads biometric data in real time for proactive duress and fall alerts.', 'View on Amazon &rarr;', 'https://www.amazon.com/dp/B0CHX3JBZB?tag=atlasglinn-20'),
    ('📷', 'Hytera HP682 DMR Radio', '$varies', 'Professional-grade encrypted digital mobile radio. DMR Tier II/III, AES-256 encryption, GPS, and Bluetooth. Integrates with Atlas EP encrypted PTT.', 'View on Amazon &rarr;', 'https://www.amazon.com/s?k=Hytera+HP682&amp;tag=atlasglinn-20'),
    ('🌡️', 'InfiRay P2 Pro', '$299', 'Smartphone thermal camera attachment. Detects hidden cameras, identifies heat signatures behind walls, and enables thermal room sweeps for advance work.', 'View on Amazon &rarr;', 'https://www.amazon.com/dp/B0BGJMV8SV?tag=atlasglinn-20'),
    ('🔥', 'FLIR ONE Pro', '$399', 'Professional thermal imaging for iPhone. MSX technology overlays thermal on visible imagery. Ideal for security sweeps, hidden electronics detection, and situational awareness.', 'View on Amazon &rarr;', 'https://www.amazon.com/dp/B0BXK22BTY?tag=atlasglinn-20'),
    ('👁', 'Seek Thermal CompactPRO', '$499', '320x240 thermal sensor with 550m detection range. The highest-resolution smartphone thermal camera for professional security and surveillance detection.', 'View on Amazon &rarr;', 'https://www.amazon.com/dp/B00VHNKP0M?tag=atlasglinn-20'),
    ('📶', 'Motorola CLP1010', '$149', 'Ultra-compact business radio for discreet team communication. Lightweight, license-free, and compatible with covert earpieces for low-profile operations.', 'View on Amazon &rarr;', 'https://www.amazon.com/s?k=Motorola+CLP1010&amp;tag=atlasglinn-20'),
    ('🎧', 'Otto Covert Earpiece', '$79', 'Professional covert communications earpiece with clear acoustic tube. Invisible under hair or collar. Used by Secret Service, EP teams, and event security worldwide.', 'View on Amazon &rarr;', 'https://www.amazon.com/s?k=Otto+earpiece+surveillance&amp;tag=atlasglinn-20'),
]
def ep_access_form():
    fields = ('<div class="row"><div><label for="ea-name">Full Name *</label><input id="ea-name" name="name" type="text" autocomplete="name" required></div>'
              '<div><label for="ea-email">Email Address *</label><input id="ea-email" name="email" type="email" autocomplete="email" inputmode="email" required></div></div>'
              '<div class="row"><div><label for="ea-company">Company / Organization</label><input id="ea-company" name="company" type="text" autocomplete="organization"></div>'
              '<div><label for="ea-role">Role *</label><select id="ea-role" name="role" required><option value="">Select your role</option><option>Individual</option><option>Family</option><option>EP Team</option><option>Corporate</option><option>Government</option></select></div></div>'
              '<label for="ea-phone">Phone (Optional)</label><input id="ea-phone" name="phone" type="tel" autocomplete="tel" inputmode="tel">'
              '<input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true"><input type="hidden" name="request_type" value="Atlas EP access request">')
    success = '&#9989; ACCESS REQUEST RECEIVED &mdash; The Atlas Glinn team will review your request and contact you within 24-48 hours. Welcome to the future of protection.'
    fine = 'Your information is encrypted and never sold. Atlas Glinn LLC operates under strict confidentiality protocols. By submitting you agree to our <a href="privacy.html">Privacy Policy</a> and <a href="terms.html">Terms of Service</a>.'
    return (f'<form class="form rise" data-endpoint="{API}/contact" data-success="{success}" novalidate>{fields}'
            f'<button class="cta-button" type="submit">REQUEST ACCESS</button><div class="form-msg" role="status" aria-live="polite"></div><p class="fine">{fine}</p></form>')
build('ep-app.html',
      'Atlas EP — The First Proactive AI Protection Agent | Atlas Glinn',
      'Atlas EP: the first proactive biometric and environmental AI protection agent — your digital bodyguard for teams, families, and individuals.',
      LOGO, CREDITS, [
    ('Opening', opening('Atlas EP App &middot; Now in Early Access', f'The First Proactive AI {blue("Protection Agent.")}',
        'Your Digital Bodyguard &mdash; Always Watching, Never Intrusive. Biometric monitoring, encrypted comms, Blue Force Tracking, and AI-powered emergency chains built for everyone from EP teams to families.',
        cta('#s8', 'Request Access') + cta2('#s3', 'See Features'))),
    # The live page's trailer block: its label, its button and its caption, opening the brand film the live page opens.
    ('Trailer', section(2, 'WATCH THE TRAILER', '', '',
        '<div class="ctas rise">' + cta2('https://atlasglinn.com/wp-content/themes/atlasglinn/ep-trailer.html', 'WATCH BRAND FILM') + '</div>'
        '<p class="sub" style="margin-top:1.2rem">150-second cinematic brand film &mdash; real-world scenarios, automatic protection, professional-grade tools</p>')),
    ('Capabilities', section(3, 'Core Capabilities', f'What Atlas EP {blue("Does.")}',
        'Eight integrated systems that turn your phone into a proactive protection platform &mdash; monitoring, tracking, communicating, and responding before you even reach for a button.',
        '<div class="stats four rise" style="margin-top:0;margin-bottom:2.4rem">' + ''.join(f'<div class="stat"><div class="stat-num">{v}</div><div class="stat-label">{l}</div></div>' for v, l in [('AES-256', 'Encryption'), ('17+', 'Modules'), ('24/7', 'AI Monitoring'), ('&lt;3s', 'Emergency Response')]) + '</div>'
        + cards([(t, b, tags(tg), ic) for ic, t, b, tg in EP_CAPS], 'cards four'))),
    ('Comms Stack', section(4, 'Communications', f'6-Layer Comms {blue("Stack.")}',
        'Never lose communications. Six redundant layers with automatic failover &mdash; from cellular to satellite. Government and enterprise details always have all six active.',
        chips([f'{ic} {n} &middot; {s}' for ic, n, s in EP_LAYERS])
        + cards([(t, b, tags(tg), ic) for ic, t, b, tg in EP_SCENARIOS], 'cards four'))),
    ('Who It Is For', section(5, 'Built For Everyone', f'Who Atlas EP {blue("Is For.")}',
        'Not just for professionals. Atlas EP protects anyone who wants proactive, AI-powered safety &mdash; from elite security teams to families walking home at night.',
        cards([(t, b, '', ic) for ic, t, b in EP_WHO]))),
    ('Pricing', section(6, 'Pricing', f'Every Tier Gets {blue("Every Tool.")}',
        'No feature gates. No upsells. No crippled free tier. Every Atlas EP subscriber gets every module, every capability, every update. The only difference is scale.',
        cards([(name, body, f'<p class="price"><b>{price}</b> <span class="meta">{unit}</span>' + (f'<br><span class="meta">{note}</span>' if note else '') + f'</p><a class="cta-button" href="#s8">{btn}</a>')
               for name, price, unit, note, body, btn in EP_TIERS], 'cards four', numbered=False)
        + '<p class="sub" style="margin-top:1.6rem">Every tier gets every tool. No feature gates.</p>'
        + '<p class="sub">Every tier pairs with a Protectee.</p>')),
    ('Hardware', section(7, 'Hardware Ecosystem', f'Works With {blue("Atlas EP.")}',
        'Optional hardware that extends your protection envelope. Satellite comms, biometric sensors, thermal imaging, and tactical radios &mdash; all integrated into the Atlas EP platform.',
        cards([(f'{name} <span class="meta">{price}</span>', body, f'<a class="secondary-cta" href="{href}" target="_blank" rel="noopener sponsored">{btn}</a>', ic) for ic, name, price, body, btn, href in EP_GEAR]))),
    ('Request Access', section(8, 'Get Started', f'Request {blue("Access.")}',
        'Atlas EP is in limited early access. Qualified professionals, families, and organizations are being onboarded now.',
        ep_access_form() + '<div class="ctas rise" style="margin-top:1.6rem">' + cta2('contact.html', 'Talk To A Coordinator') + '</div>')),
    ('Legal', section(9, 'Legal &amp; Compliance', f'Transparency &amp; {blue("Compliance.")}', '',
        cards([('Terms of Service', 'Review our complete terms governing use of the Atlas EP platform, data handling, and user obligations.', '<a class="secondary-cta" href="terms.html">Read Terms of Service &rarr;</a>'),
               ('Privacy Policy', 'How we collect, store, and protect your data. Atlas EP uses AES-256 encryption and zero-knowledge architecture.', '<a class="secondary-cta" href="privacy.html">Read Privacy Policy &rarr;</a>'),
               ('Two-Party Consent &amp; Emergency Recording Notice', 'Atlas EP may automatically activate audio and video recording when the system detects imminent threat to your safety. By using Atlas EP, you acknowledge that emergency recording may activate automatically during detected duress events. In jurisdictions requiring two-party consent for recording, Atlas EP complies by notifying all parties through audible and visual indicators when recording is active. Users are responsible for understanding and complying with local recording laws in their jurisdiction. Atlas EP is designed to prioritize life safety &mdash; emergency recordings are encrypted, time-stamped, and stored securely for evidentiary purposes only.')], numbered=False)
        + f'<p class="sub" style="margin-top:1.6rem">Questions? Contact us at <a href="mailto:{EMAIL}" style="color:var(--gold-champagne)">{EMAIL}</a></p>'   # his 2026-09-06 decision stands over the live atlas.hq@
        + '<p class="sub" style="margin-top:1.6rem">Elite Security. No Compromise. Protecting those who matter most with AI-powered technology and decades of operational experience.</p>'
        + chips(['Houston, TX', 'Licensed PPO', 'AES-256 Encrypted']))),   # the live page's credential tags
], photos=[(AI_SURV, None), (HERO_EP, None), (CCTV, None), (HERO_EP, None), (PROTECTION, None), (AI_SURV, None), (CCTV, None), (HERO_EP, None), (AI_SURV, None)],
      jsonld=jsonld_service('Atlas EP', 'Proactive biometric and environmental AI protection agent: encrypted comms, Blue Force Tracking, emergency chains, counter-UAS detection and cyber defense for teams, families and individuals.', 'ep-app.html'))


# ═══════════════════════════ live-content mode — what ships ═══════════════════════════
# The page is the classic chrome with the current atlasglinn.com page inside it. Reading order matters and is the
# reason the live type wins: the theme stylesheet, then the page's own <style> blocks, then the shell's chrome sheet —
# which atlas_live.chrome_css() has already cut down to the bar, the menu, the splash, the footer and the back-to-top
# button, so there is nothing left in it that could reach the content.
# ── The live chrome, page by page ─────────────────────────────────────────────────────────────────────────────────
# r1 gave all twelve pages one hand-written bar, one hand-written menu and one hand-written footer. Measured against
# the capture that cost ep-app its "Talk To A Coordinator" button and its whole four-column footer (8 units), cost
# every page the live footer's "Resources" link, and added units no live page carries — "Autonomous UAS" and a Google
# Reviews link in the footer, eleven descriptor lines under the menu items, two award badges on ep-app. So the bar,
# the menu and the footer are now read off the capture per page, exactly like the content between them.
#
# Two hrefs are redirected on top of that, and only two. Both are AG-5 / §G-6 ("every Atlas page →
# https://www.mastsolutions.com/ absolute, and /#gear for the IWA entry") applied to a link the live page already
# prints, under its own label: the menu's IWA entry and the footer's "MAST Solutions" entry, which the live site
# points at its own /training/ page. No label changes, no unit is added or removed by this.
# The three off-page destinations the overlay must reach, stated HERE and not read out of the table that fills it.
# A coverage assert whose requirement comes from the same tuple as its content proves nothing: deleting the
# mastsolutions row from atlas_live.SITENAV_FIXED shrank the requirement with the content and the build stayed
# green — measured 2026-09-10, which is why this line exists. mastsolutions.html is the AG-5 / §G-6 redirect
# target; privacy.html and terms.html are the two legal pages only ep-app's own footer has ever linked.
SITENAV_MUST_REACH = ('mastsolutions.html', 'privacy.html', 'terms.html')

MAST_HREFS = {'https://atlasglinn.com/training/shop/': 'https://www.mastsolutions.com/#gear',
              'https://atlasglinn.com/aimpoint-shop/': 'https://atlasglinn.com/aimpoint-shop/'}
MAST_FOOTER_LINK = ('<a href="training.html">MAST Solutions</a>', '<a href="https://www.mastsolutions.com/">MAST Solutions</a>')


# live_nav() STOOD HERE and it is gone with the bar (r8, 2026-09-09). It built `atlas.nav()` from the capture and
# nothing calls it any more — live_sitenav() below reads the same two lists through live.sitenav_items() and prints
# them into the overlay. `atlas.nav()` itself stays: build() — the --authored path — still uses it, from
# _topnav_lists(), and deleting it would break that path. A function nothing calls is not kept "just in case"; it is
# in the history, on this branch, which is where a deletion belongs.


def live_sitenav(slug, page):
    main, index, extra = live.sitenav_items(slug)
    main = [(MAST_HREFS.get(h, h), l, k,
             [(MAST_HREFS.get(dh, dh), ic, ti, de) for dh, ic, ti, de in drop] if drop else None)
            for h, l, k, drop in main]
    index = [(MAST_HREFS.get(h, h), l, sub) for h, l, sub in index]
    return atlas.sitenav(main, index, extra, page, LOGO_MARK, live.logo_alt(slug))


def live_footer(slug):
    inner = live.footer_inner(slug)
    old, new = MAST_FOOTER_LINK
    if old in inner:
        inner = inner.replace(old, new, 1)
    return atlas.footer(inner, container=False)


# THE PER-PAGE CONTROL LEDGER. (controls the skin reaches, {class list -> count} for the ones it does not), read
# off a clean build of a5fd31e + this change and encoded so the numbers are what fails, not a printed line a human
# has to read.
#
# WHAT THIS REPLACES AND WHY. The assert here read `assert bool(matched) == (slug in CTA_PAGES)` — a PRESENCE test
# against a tuple of page NAMES. Nothing compared a number, so reintroducing the exact defect the assert was
# written for passed: renaming `.agx-content .btn-gold` and `.agx-content .form-submit` out of the skin left
# `assemble-atlas.py --publish` exiting 0 while ep-app dropped from 18 reached controls to 16 and printed
# `UNMATCHED: (no class) x5, btn-gold x1, form-submit x1`. Green build, defect present. CLAUDE.md described the
# assert as testing the per-page count; it did not, and both are corrected in the same pass.
#
# The unmatched map is encoded too, not just the total. `(no class)` is the honest residue — bare <a> anchors the
# live pages carry inside prose and inside the footer-adjacent blocks, which have no class for a skin selector to
# name. training's `reveal x1` is its only classed anchor, an outbound Washington Post link, and it is the one page
# of the twelve the skin reaches zero controls on.
SKIN_CONTROLS = {
    'index':                  (7,  {'(no class)': 4}),
    'executive-protection':   (1,  {'(no class)': 2}),
    'residential-protection': (2,  {'(no class)': 4}),
    'disaster-recovery':      (2,  {'(no class)': 3}),
    'training':               (0,  {'(no class)': 3, 'reveal': 1}),
    'technology':             (7,  {'(no class)': 2}),
    'cuas-aerodefense':       (3,  {'(no class)': 4}),
    'uas':                    (1,  {'(no class)': 3}),
    'about':                  (7,  {'(no class)': 4}),
    'careers':                (2,  {'(no class)': 2}),
    'contact':                (1,  {'(no class)': 5}),
    'ep-app':                 (18, {'(no class)': 5}),
}
CTA_PAGES = tuple(s for s, (m, _u) in SKIN_CONTROLS.items() if m)
_CONTROL = re.compile(r'<(?:a|button)\b([^>]*)>', re.I)
_CLASS_ATTR = re.compile(r'\bclass="([^"]*)"', re.I)
_CLASS_ONLY = re.compile(r'(?:\.[A-Za-z0-9_-]+)+$')


def _skin_control_groups(skin):
    """Each skin selector that targets ONE element by class alone, as a set of class names. `.pricing-cta.primary-cta`
    becomes {pricing-cta, primary-cta}; a descendant selector like `.service-card:hover .card-icon` is not a control
    target and is dropped. Pseudo-states are stripped: :hover is a state, not a target."""
    out = set()
    for sel in atlas.assert_skin_scope(skin):
        rest = ' '.join(sel.split())
        if not rest.startswith('.agx-content '):
            continue
        rest = re.sub(r':[a-zA-Z-]+(\([^)]*\))?', '', rest[len('.agx-content '):]).strip()
        if _CLASS_ONLY.fullmatch(rest):
            out.add(frozenset(rest.strip('.').split('.')))
    return out


def _controls(skin, body):
    """(controls the skin reaches, {class list -> count} for the ones it does not) over one page's content markup."""
    groups = _skin_control_groups(skin)
    matched, unmatched = 0, {}
    for m in _CONTROL.finditer(body):
        c = _CLASS_ATTR.search(m.group(1))
        classes = set(c.group(1).split()) if c else set()
        if any(g <= classes for g in groups):
            matched += 1
        else:
            key = ' '.join(sorted(classes)) or '(no class)'
            unmatched[key] = unmatched.get(key, 0) + 1
    return matched, unmatched




_INLINE_GRID = re.compile(r'''\sstyle=["'][^"']*grid-template-columns\s*:\s*([^;"']+)''')


def build_live(slug):
    page = 'index.html' if slug == 'index' else slug + '.html'
    body = live.content(slug)
    body = atlas.skin_icons(slug, body)   # ICON_SWAPS: the declared emoji-as-icon glyphs become inline SVG
    # C — the hero re-set. Two unit-neutral edits inside the opening chapter (the headline's trailing word wrapped
    #     blue, an empty scroll cue appended) and NOTHING ELSE MOVES. hero_reset() asserts its own text-unit and
    #     media equality against the markup it was handed; the numbers are printed below so the equality is a
    #     measurement in the build log rather than a silent pass.
    hero_before = body
    body = live.hero_reset(slug, body)
    hero_u0, hero_u1, hero_m0, hero_m1 = live.hero_report(slug, hero_before, body)
    assert body.count(live.BLUE_CLASS) == 1, \
        '%s: %d runs painted %s in the content, expected the headline\'s trailing word and nothing else' \
        % (slug, body.count(live.BLUE_CLASS), live.BLUE_CLASS)
    # The cinematic pass: the page is cut at its own section boundaries and each piece becomes a chapter — a full
    # viewport with the section's own photograph or film behind it, arriving on its own motion, with a tick on the rail
    # and the read-position line at the top. The markup inside a chapter is the live markup, byte for byte; the wrapper
    # is the only thing added, and _chapters_html() asserts that concatenating the chapters returns content(slug).
    chs = live.chapters(slug, body)
    marks = [('agx-c%d' % (k + 1), label, back) for k, (label, _, back) in enumerate(chs)]
    body = _chapters_html(chs, body, page)
    chrome = ''.join('<script>%s</script>\n' % s for s in live.scripts(slug))
    sheet = live.chrome_css(live.mono(slug))   # assert_chrome_scope() runs inside: every selector anchored to the chrome
    cinema = atlas.cinema_css(live.mono(slug))  # assert_cinema_scope() runs inside: every selector anchored to agx-
    skin = atlas.skin_css()                 # assert_skin_scope() runs inside: .agx-content only, no type, no gold
    hero = atlas.hero_css(live.mono(slug))  # assert_hero_scope() runs inside: the opening chapter only, five owned
    snav = live_sitenav(slug, page)
    html = ('<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">\n'
            '<meta name="build" content="">\n'
            + live.head(slug)
            + f'<link rel="icon" href="{SITE}{LOGO_MARK}" type="image/png">\n'
            + '\n'.join(live.styles(slug)) + '\n'
            + '<style>' + sheet + cinema + skin + hero + '</style>\n'
            + '</head>\n<body>\n<script>' + shell.REFRESH_JS + '</script>\n\n'
            + atlas.cinema_chrome(marks)
            + live.intro_overlay('', live.intro_title(), '') + '\n'
            + snav + '\n'
            + body + '\n\n'
            + live_footer(slug) + live.after_footer(slug) + '\n' + atlas.BACK_TO_TOP + '\n'
            + chrome
            + '<script>' + live.intro_ring_js() + '</script>\n'
            + '<script>' + live.chrome_js() + '</script>\n'
            + '<script>' + atlas.CINEMA_JS + '</script>\n'
            + '<script>' + shell.TRACK_JS + '</script>\n'
            + '<script type="module">' + atlas.cinema_three(len(chs), shell.ATLAS) + '</script>\n'
            + '</body>\n</html>\n')
    # NO BAR, one overlay, one splash, one footer, one scene: the live chrome is out, the trailer's is in exactly
    # once, and the two ids the sticky bar used to own must not appear anywhere on the page.
    # The two ids are matched with their `id=` attribute and not as bare substrings: the LIVE pages' own <style>
    # blocks are carried byte for byte and they still declare `#main-nav` and `.mobile-nav` rules with no markup
    # left to match. That is the live page's stylesheet, not this build's chrome, and it is not ours to edit.
    for tag, n in (('id="main-nav"', 0), ('id="mobile-nav"', 0), ('class="nav-dropdown-menu"', 0),
                   ('id="intro-overlay"', 1),
                   ('<footer', 1), ('</footer>', 1), ('<canvas id="agx-canvas"', 1), ('<div id="agx-photos"', 1),
                   (atlas.AGX_SKIN_MARK, 1),                    # F: the content skin, exactly once
                   (atlas.AGX_HERO_MARK, 1),                    # the hero type sheet, exactly once
                   ('class="agx-scroll-cue"', 1),
                   ('<div class="agx-sitenav"', 1), ('id="agx-menu-btn"', 1), ('id="agx-sitenav-close"', 1),
                   ('class="agx-hud agx-hud-tl"', 1), ('class="agx-hud agx-hud-tr"', 1),
                   ('class="agx-hud agx-hud-bl"', 1), ('class="agx-hud agx-hud-br"', 1),
                   ('id="agx-section-hud"', 1)):                # the section counter, now the top-right corner
        assert html.count(tag) == n, f'{page}: {tag} appears {html.count(tag)} times, expected {n}'
    # A — the rail carries one link per chapter and its labels ARE the chapter labels, in order
    rail_labels = re.findall(r'<a class="agx-rail-link"[^>]*><span>(.*?)</span></a>', html, re.S)
    assert rail_labels == [l for _a, l, _b in marks], '%s: rail labels are not the chapter labels' % page
    # B — the counter's denominator is the chapter count, two-digit padded, as MAST prints it
    assert 'data-of="%02d"' % len(chs) in html, '%s: HUD denominator != chapter count' % page
    # D — one <svg class="agx-icon"> per declared swap, and the emoji STILL STANDING ANYWHERE INSIDE .agx-content
    #     are exactly the ones ICON_KEEP names. The assert this replaces read "no emoji survives inside an icon
    #     class", which was true, structurally blind and green while eleven emoji tiles rendered: six on ep-app and
    #     five on executive-protection carry no class, so the class-keyed walk never looked at them. It measures the
    #     page now instead of the classes the guard already knew about.
    swaps = atlas.ICON_SWAPS.get(slug, ())
    assert html.count('<svg class="agx-icon"') == len(swaps), \
        '%s: %d agx-icon svg, %d declared swaps' % (page, html.count('<svg class="agx-icon"'), len(swaps))
    left = atlas.icon_leaves(body)
    kept = [(c, g) for c, g, _r in atlas.ICON_KEEP.get(slug, ())]
    assert left == kept, '%s: emoji leaves inside .agx-content are %r; ICON_KEEP declares %r' % (page, left, kept)
    # E — the skin's button treatment reaches THIS PAGE'S OWN controls, counted on this page's markup.
    #     This used to read `assert '.agx-content .cta-button' in skin` — a substring test on a module-level
    #     constant, identical on all twelve pages, which could only ever prove the skin still DECLARES a rule.
    #     It could not see that ep-app's hero secondary CTA is class="btn-gold" and that no skin selector named
    #     it. So the enumeration IS the assert now: every <a>/<button> inside .agx-content is resolved against
    #     the skin's own selectors, the count is asserted per page, and every class the skin does not reach is
    #     printed by name — a miss is surfaced at build time instead of found in a screenshot.
    # A — SITENAV COVERAGE, which is the reachability his 2026-09-08 "too many clicks to get to content and back"
    #     call was actually about, asserted rather than asserted away. Every one of the twelve Atlas pages, plus
    #     MAST / Privacy / Terms, is one click from here; and every destination the LIVE bar or the LIVE mobile
    #     menu named is still reachable, so the bar's removal took no route with it.
    snav_hrefs = set(re.findall(r'<a[^>]*\bhref="([^"]*)"', snav))
    want = set(('index.html' if s == 'index' else s + '.html') for s in live.PAGES) | set(SITENAV_MUST_REACH)
    assert want <= snav_hrefs, '%s: the overlay does not reach %s' % (page, sorted(want - snav_hrefs))
    bar_i, mob_i = live.nav_items(slug)
    live_hrefs = set(MAST_HREFS.get(h, h) for h, _l, _k, _d in bar_i)
    live_hrefs |= set(MAST_HREFS.get(h, h) for h, _l, _s in mob_i)
    live_hrefs |= set(MAST_HREFS.get(dh, dh) for _h, _l, _k, d in bar_i for dh, _i, _t, _d in (d or ()))
    assert live_hrefs <= snav_hrefs, \
        '%s: the live nav reached %s and the overlay does not' % (page, sorted(live_hrefs - snav_hrefs))
    # B — SITENAV PARITY, and this is the assert that makes out_of_order() pass. The overlay's text units, in order,
    #     are the live BAR's units, then the live MOBILE menu's units, then exactly the third list's labels. Three
    #     lists in live document order is the only shape in which the bar's removal costs no live unit; a session
    #     that "simplifies" the overlay to one list fails HERE, with the reason, instead of failing twelve pages of
    #     compare-atlas with a temptation to add a lost-unit allowlist.
    main_i, index_i, extra_i = live.sitenav_items(slug)
    snav_units = live._units(snav)
    bar_units = live._units(atlas.nav(main_i, [], page, LOGO_MARK, logo_alt=live.logo_alt(slug)))
    bar_units = [u for u in bar_units if u not in ('ATLAS GLINN', '☰', '×')]
    idx_units = [l for _h, l, _s in index_i]
    # 'MENU' is the ONE build-only word in the overlay and it sits between the two live glyphs, which is where the
    # live page prints its bar's hamburger and its mobile menu's close. compare-atlas.CONTROLS spends it once,
    # inside #agx-menu-word, and nowhere else.
    lead = ['ATLAS GLINN'] + bar_units + ['MENU', '☰', '×'] + idx_units
    assert snav_units == lead + [l for _h, l in extra_i], \
        ('%s: the overlay prints %r; the live bar then the live mobile menu then the third list is %r'
         % (page, snav_units, lead + [l for _h, l in extra_i]))
    # F — the inline grid values this page carries are ones the phone block knows how to reflow. A capture that
    #     grows a repeat(7,1fr) fails the build instead of shipping a seven-column row on a 393px screen.
    inline_grids = set(m.group(1).strip() for m in _INLINE_GRID.finditer(body))
    unknown = inline_grids - set(atlas.PHONE_GRID_OK)
    assert not unknown, '%s: inline grid value(s) the phone block does not enumerate: %s' % (page, sorted(unknown))
    matched, unmatched = _controls(skin, body)
    assert (matched, unmatched) == SKIN_CONTROLS[slug], \
        ('%s: the skin reaches %d control(s) and misses %r; SKIN_CONTROLS says %r'
         % (page, matched, unmatched, SKIN_CONTROLS[slug]))
    if unmatched:
        print('    %-22s skin reaches %2d of %2d controls; UNMATCHED: %s'
              % (slug, matched, matched + sum(unmatched.values()),
                 ', '.join('%s x%d' % (k, v) for k, v in sorted(unmatched.items()))))
    # C — the tilt script's inline transform is beaten on every class it actually reaches on this page
    tilt_named, tilt_here = atlas.assert_tilt_override(slug, live.scripts(slug), body)
    if not PUBLISH:
        html = _previewize(html)
    out = os.path.join(REPO, OUT_DIR, page)
    os.makedirs(os.path.dirname(out) or '.', exist_ok=True)
    open(out, 'w', encoding='utf-8').write(html)
    backs = [b for _, _, b in marks if b]
    print('wrote %-30s %7d bytes   %2d chapters, %d backdrops   %2d chrome + %d cinema selectors   hero %s'
          % (OUT_DIR + page, len(html.encode('utf-8')), len(chs), len(set(backs)),
             len(live.audit_chrome_css(sheet)), len(atlas.assert_cinema_scope(cinema)),
             (live.hero_media(slug, body) or 'still').split('/')[-1]))
    print('    %-22s skin-matched controls %2d   tilt classes named by the page %d, matching an element here %d %s'
          % (slug, matched, len(tilt_named), len(tilt_here), list(tilt_here)))
    print('    %-22s hero re-set: text units %d -> %d, media URLs %d -> %d (both asserted equal in hero_reset)'
          % (slug, hero_u0, hero_u1, hero_m0, hero_m1))
    return out


def _chapters_html(chs, body, page):
    """The chapters wrapped, and nothing else touched. The wrapper carries the anchor the rail links to and, on the
    opening chapter, the class that drops the reading scrim — the live hero is already its own full-bleed frame."""
    out = []
    for k, (label, markup, _back) in enumerate(chs):
        cls = 'agx-ch agx-hero' if k == 0 else 'agx-ch'
        # The label is the chapter eyebrow's text, printed by CSS `content` and never as a node. A chapter with no
        # heading of its own gets NO attribute — `[data-agxlabel]` matches an empty one, and an empty one would
        # print a bare "02 · ". Two chapters page-set-wide are label-less: executive-protection ch2 and ep-app ch2,
        # the same two the rail draws as ticks.
        lab = (' data-agxlabel="%s"' % html_mod.escape(label, quote=True)) if label else ''
        out.append('<div class="%s" id="agx-c%d" data-agx-ch="%02d"%s>%s</div>\n' % (cls, k + 1, k + 1, lab, markup))
    assert ''.join(m for _, m, _ in chs) == body, '%s: the chapter split lost markup' % page
    return '<div class="agx-content">\n' + ''.join(out) + '</div>'


# MAST is not in this change. Byte-identical to origin/main or the build stops — CHECKED BEFORE THE FIRST PAGE IS
# WRITTEN, not after. It used to run at the end of build_live(), so an assembler that had already rewritten
# mastsolutions.html would have rewritten it before anything looked.
def assert_mast_untouched():
    """The four MAST paths, byte-identical to origin/main, WITH THE OFFENDING NAME PRINTED.

    It ran `git diff --quiet` and, on failure, named all four paths — so the operator was told MAST had been
    edited without being told WHICH file, and `--quiet` exits 1 for a missing ref exactly as it does for a real
    difference. A worktree with no `origin/main` therefore reported "MAST paths differ", which is a false
    accusation, not a measurement. Both are separated here: the ref is resolved first and its absence is reported
    as UNVERIFIABLE, and a real difference is printed by name from `git diff --name-only`.
    """
    import subprocess
    paths = ['scripts/cinematic_shell.py', 'mastsolutions.html', 'mastsolutions-tesla.html',
             'scripts/assemble-cinematic.py']
    ref = subprocess.run(['git', 'rev-parse', '--verify', '--quiet', 'origin/main'], cwd=REPO,
                         capture_output=True, text=True)
    if ref.returncode != 0 or not ref.stdout.strip():
        raise SystemExit('cannot resolve origin/main — MAST parity UNVERIFIABLE FROM HERE '
                         '(fetch the remote, or name the ref this tree should be compared against)')
    sha = ref.stdout.strip()
    diff = subprocess.run(['git', 'diff', '--name-only', sha, '--'] + paths, cwd=REPO,
                          capture_output=True, text=True)
    if diff.returncode != 0:
        raise SystemExit('git diff against origin/main (%s) failed, MAST parity UNVERIFIABLE FROM HERE: %s'
                         % (sha[:9], diff.stderr.strip()[:200]))
    changed = [ln for ln in diff.stdout.split('\n') if ln.strip()]
    if changed:
        raise SystemExit('MAST is not in this change and these paths differ from origin/main (%s): %s'
                         % (sha[:9], ', '.join(changed)))
    print('MAST byte-identical to origin/main %s: %s' % (sha[:9], ', '.join(paths)))


if not AUTHORED:
    assert_mast_untouched()
    # The theme stylesheet the live pages link, served from the repo: same bytes, same relative path from every page,
    # and the staging workflow's asset resolver follows the <link> and copies it.
    vendor = os.path.join(REPO, live.SHARED_CSS)
    os.makedirs(os.path.dirname(vendor), exist_ok=True)
    with open(live.SHARED_CSS_SRC, encoding='utf-8') as fh:
        css = fh.read()
    open(vendor, 'w', encoding='utf-8').write(css)
    print('wrote %-30s %7d bytes   (reference/live/shared-styles.css)' % (live.SHARED_CSS, len(css.encode('utf-8'))))
    written = [build_live(s) for s in live.PAGES]
    if PUBLISH:
        build_manifest.stamp_and_write(written)
