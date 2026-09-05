#!/usr/bin/env python3
"""Assemble the Atlas Glinn pages on the cinematic shell (scripts/cinematic_shell.py, ATLAS blue palette).

Brockmann, 2026-09-03: "use SAME front end and redo Atlasglinn.com", mobile first. Every page here is chapters on the
Tier 3 trailer shell that carries mastsolutions.html, with a site menu (MENU button, full-screen overlay) so the
pages reach each other. Copy is the site's own copy, kept word for word where it makes a claim; images are local
where the repo has them and WordPress-hosted where it does not (scripts/handoff-urls.txt brings those over).

Edit THIS FILE and re-run it; never hand-edit the generated pages, the next run overwrites them:
  index.html, executive-protection.html, residential-protection.html, disaster-recovery.html, training.html,
  technology.html, cuas-aerodefense.html, uas.html, about.html, careers.html, contact.html
ep-app.html and signup.html are not generated here.

Preview vs publish (Brockmann, 2026-09-04: "let me review it before we publish"):
  python3 scripts/assemble-atlas.py             writes preview/<page>.html  (noindex, assets via ../, live pages untouched)
  python3 scripts/assemble-atlas.py --publish   writes <page>.html at the site root: the real thing, only on his word
"""
import os, re, sys
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLISH = '--publish' in sys.argv
OUT_DIR = '' if PUBLISH else 'preview/'
# Preview pages sit one folder down, so root-level assets and the hand-authored pages need a ../ in front. The eleven
# rebuilt pages link to each other by bare name and stay inside preview/.
_ROOT_REFS = re.compile(r'''((?:src|href|poster)=")(images/|mastsolutions|privacy\.html|terms\.html|signup\.html|ep-app\.html|mast-capability)''')
def _previewize(html):
    html = _ROOT_REFS.sub(r'\1../\2', html).replace("url('images/", "url('../images/")
    html = html.replace("from './vendor/three.module.js'", "from '../vendor/three.module.js'")   # the shell's three.js import
    assert "'./" not in html and '"./' not in html, 'a ./ reference survived previewizing'
    return html.replace('<meta name="robots" content="index, follow">', '<meta name="robots" content="noindex, nofollow">', 1)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cinematic_shell as shell

API = 'https://mast-booking-backend.matthew-221.workers.dev'
SITE = 'https://atlasglinn.com/'
PHONE, TEL, EMAIL = '(281) 654-8100', 'tel:+12816548100', 'atlasglinn.hq@atlasglinn.com'
ADDRESS = '2450 Fondren Rd, Suite 255 &middot; Houston, TX 77063'
WP = 'https://atlasglinn.com/wp-content/uploads/'   # only for what has not landed in images/atlas/ yet (see BEEHIVE)

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
# "This is not my picture from atlasglinn.com". The About portrait is the one he approved on the MAST Instructors
# chapter ("Instruct pic Y its ok"), copied to images/team/ so the no-images/mast/ rule below still holds.
FOUNDER_SCENE = A + 'Matthew-Brockmann-Atlas-glenn-security-ceo-protection1-scaled-e1741887403903.jpeg'
FOUNDER       = 'images/team/brockmann.jpg'
FOUNDER_CROP  = 'background-size:auto 118%;background-position:64% 22%'   # same framing as the MAST page; keeps the photographer's mark out of frame
CLINE         = A + 'Cline-Bio-Pic-1024x819.jpg'
CAREERS_HERO  = A + 'IMG_0396-e1742749164806.jpg'
AI_SURV       = A + 'AI-surveillance-1.png'                          # technology Deep Sentinel section
AERO          = A + 'AeroDefense-Partner-Atlas-Glinn.jpeg'
UAS_IMG       = A + 'Technology-UAS-1.png'
LOGO          = A + 'Atlas-Glinn-Logo-Rev1-1.png'
BADGE_BEST    = A + 'BEST_OF_BusinessRate_2025_Atlas_Glinn.png'
BEEHIVE       = WP + '2025/03/IMG_1837-1024x751.jpeg'                # not on the handoff yet (the Mac's fetch skipped it)
FILM_POSTER   = 'images/film/atlas-glinn-and-mast-solutions-poster.jpg'       # frame of the home-page film
ABOUT_POSTER  = 'images/film/about-atlas-glinn-poster.jpg'                    # frame of the About film
# The current home and About pages open on a background film; the rebuilt pages open on the same films as six-second snippets
# behind the opening chapter (Brockmann, 2026-09-05: "the video should be in the background, just a snippet playing").
# technology, uas and contact also open on a film today, but those files are LFS pointers in this repo (no bytes) and have
# not come over on the handoff; they keep their photographs until they do.
FILM_TEASER   = 'images/film/atlas-glinn-and-mast-solutions-teaser.mp4'
ABOUT_TEASER  = 'images/film/about-atlas-glinn-teaser.mp4'
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

NAV = [
    ('index.html', 'Home', 'Atlas Glinn, LLC'),
    ('executive-protection.html', 'Executive Protection', 'Dignitary and close protection'),
    ('residential-protection.html', 'Residential Protection', 'Estates, guard force, AI surveillance'),
    ('disaster-recovery.html', 'Disaster Recovery', 'Asset protection when it counts'),
    ('training.html', 'Training', 'Dignitary protection curriculum'),
    ('mastsolutions.html', 'MAST Solutions', 'Book a course'),
    ('technology.html', 'Technology', 'Atlas EP, AI surveillance, drones'),
    ('cuas-aerodefense.html', 'Counter-Drone', 'AirWarden by AeroDefense'),
    ('uas.html', 'Autonomous UAS', 'Sunflower Labs'),
    ('signup.html', 'Atlas EP App', 'On the App Store'),
    ('about.html', 'About', 'Mission and team'),
    ('careers.html', 'Careers', 'Open positions'),
    ('contact.html', 'Contact', PHONE),
    ('privacy.html', 'Privacy Policy', 'What we keep, and for how long'),
]

SOCIAL = ('<a href="https://www.instagram.com/atlasglinn_mastsolutions/" target="_blank" rel="noopener">Instagram</a>&middot;'
          '<a href="https://www.linkedin.com/in/mastsolutions1/" target="_blank" rel="noopener">LinkedIn</a>&middot;'
          '<a href="https://www.youtube.com/@atlasglinn" target="_blank" rel="noopener">YouTube</a>&middot;'
          '<a href="https://www.facebook.com/mastsolutions" target="_blank" rel="noopener">Facebook</a>&middot;'
          '<a href="https://www.yelp.com/biz/atlas-glinn-houston" target="_blank" rel="noopener">Yelp</a>')
FOOT = ('&copy; 2026 Atlas Glinn, LLC &middot; MAST Solutions &middot; Executive Protection &middot; Training &middot; AI Surveillance &middot; Counter-Drone &middot; Risk Management<br>'
        '<a href="privacy.html">Privacy Policy</a>&middot;<a href="terms.html">Terms of Service</a>&middot;' + SOCIAL)

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
      btn.disabled = true; const label = btn.textContent; btn.textContent = 'Sending…'; msg.textContent = ''; msg.className = 'form-msg';
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
    return f'''
  <section class="panel" id="s1" data-section="{num}">
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
        title, body = it[0], it[1]; extra = it[2] if len(it) > 2 else ''; icon = it[3] if len(it) > 3 else ''
        head = f'<div class="ico" aria-hidden="true">{icon}</div>' if icon else (f'<div class="num">{k:02d}</div>' if numbered else '')
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
        f'<div class="ctas rise">{ctas}</div><div class="foot">{FOOT}</div>')

def contact_form(kind='contact'):
    if kind == 'capability':
        fields = ('<label for="cs-name">Full name</label><input id="cs-name" name="name" type="text" autocomplete="name" required>'
                  '<div class="row"><div><label for="cs-email">Email</label><input id="cs-email" name="email" type="email" autocomplete="email" inputmode="email" required></div>'
                  '<div><label for="cs-company">Company or agency</label><input id="cs-company" name="company" type="text" autocomplete="organization"></div></div>'
                  '<div class="row"><div><label for="cs-status">Do you currently have or need security?</label><select id="cs-status" name="status"><option>Currently have security</option><option>Need security</option><option>Evaluating options</option></select></div>'
                  '<div><label for="cs-type">Request type</label><select id="cs-type" name="request_type"><option>General Inquiry</option><option>RFP &mdash; Request for Proposal</option><option>RFQ &mdash; Request for Quote</option></select></div></div>'
                  '<input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">'
                  '<input type="hidden" name="kind" value="capability">')
        btn, success = 'Request Capability Statement', 'Request received. The capability statement goes to your email.'
        fine = 'Your request goes to Atlas Glinn HQ only. See the <a href="privacy.html">Privacy Policy</a>.'
    else:
        fields = ('<div class="row"><div><label for="ct-name">Name</label><input id="ct-name" name="name" type="text" autocomplete="name" required></div>'
                  '<div><label for="ct-phone">Phone</label><input id="ct-phone" name="phone" type="tel" autocomplete="tel" inputmode="tel"></div></div>'
                  '<label for="ct-email">Email</label><input id="ct-email" name="email" type="email" autocomplete="email" inputmode="email" required>'
                  '<label for="ct-msg">Message</label><textarea id="ct-msg" name="message" required></textarea>'
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
            '  "sameAs": ["https://www.instagram.com/atlasglinn_mastsolutions/", "https://www.linkedin.com/in/mastsolutions1/", "https://www.youtube.com/@atlasglinn", "https://www.facebook.com/mastsolutions", "https://www.yelp.com/biz/atlas-glinn-houston"]\n}\n</script>\n')

def jsonld_service(name, desc, path):
    return ('<script type="application/ld+json">\n{\n  "@context": "https://schema.org",\n  "@type": "Service",\n'
            f'  "name": "{name}",\n  "serviceType": "{name}",\n  "description": "{desc}",\n  "url": "{SITE}{path}",\n'
            '  "provider": { "@type": "Organization", "name": "Atlas Glinn, LLC", "url": "https://atlasglinn.com/", "telephone": "+1-281-654-8100" },\n'
            '  "areaServed": { "@type": "Place", "name": "Houston, Texas" }\n}\n</script>\n')

def meta(title, desc, path, og_image, jsonld=''):
    url = SITE + ('' if path == 'index.html' else path)
    if not og_image.startswith('http'): og_image = SITE + og_image   # share cards need an absolute URL; local images are repo paths
    return (f'<title>{title}</title>\n<meta name="description" content="{desc}">\n<link rel="canonical" href="{url}">\n'
            f'<meta property="og:title" content="{title}">\n<meta property="og:description" content="{desc}">\n<meta property="og:image" content="{og_image}">\n'
            f'<meta property="og:type" content="website">\n<meta property="og:url" content="{url}">\n<meta name="twitter:card" content="summary_large_image">\n'
            '<meta name="robots" content="index, follow">\n<meta name="author" content="Atlas Glinn, LLC">\n<meta name="theme-color" content="#050810">\n' + jsonld)

def build(path, title, desc, og_image, credits, chapters, photos, jsonld=''):
    """chapters: [(label, html)]; photos: [(image, pos or None)] one per chapter."""
    n = len(chapters)
    chrome = shell.chrome(credits=credits, wordmark='ATLAS GLINN',
                          photos=[(f'{k:02d}', *entry) for k, entry in enumerate(photos, 1)],
                          hud_tl='&#9679; ATLAS GLINN &middot; HOUSTON', hud_tl_href='index.html',
                          hud_bl='HOU &middot; 29.7604&deg;N &middot; 95.3698&deg;W', hud_br='DETAILS MATTER',
                          chapters=[(f's{k}', f'{k:02d} &middot; {label}') for k, (label, _) in enumerate(chapters, 1)])
    body = ('\n' + chrome + shell.sitenav(NAV, path, FOOT) + '\n<div class="content">\n' + ''.join(h for _, h in chapters) + '\n</div>\n')
    css = shell.css(shell.ATLAS, '', shell._recolor(shell.SITENAV_CSS + EXTRA_CSS, shell.ATLAS)) + HERO_CSS
    html = shell.head(meta(title, desc, path, og_image, jsonld), css) + body + shell.tail(shell.three(n, shell.ATLAS), shell.SITENAV_JS + FORM_JS)
    for banned in ('images/mast/', 'images/gallery/', 'deep-sentinel', 'man-s-hand-holding-drone'):
        assert banned not in html, f'{path}: {banned} is not approved Atlas Glinn imagery'
    if LIVE_LINKS:
        html = _LIVE_RE.sub(lambda m: 'href="%s"' % LIVE_URLS[m.group(1)], html)
    if not PUBLISH: html = _previewize(html)
    out = os.path.join(REPO, OUT_DIR, path)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    open(out, 'w', encoding='utf-8').write(html)
    print('wrote', OUT_DIR + path, len(html.encode('utf-8')), 'bytes,', n, 'chapters')

# No `M = 'images/mast/'` here on purpose: the Atlas pages draw only from the approved list above; build() enforces it.

# Brockmann, 2026-09-05: "when you click on the card, it should take it to the same as atlasglinn.com now. So we're not changing
# actual content." While LIVE_LINKS is True every card, button and menu item that names one of the ten content pages goes to
# that page's current address on atlasglinn.com (the canonical URLs the current pages carry), so a visitor reads today's content.
# The rebuilt pages still generate for his review. Flip to False on the day the full set publishes, and the links turn back into
# the local pages. Home, the MAST page, signup, privacy and terms are untouched.
LIVE_LINKS = True
LIVE_URLS = {
    'executive-protection.html':  'https://atlasglinn.com/executive-protection/',
    'residential-protection.html': 'https://atlasglinn.com/residential-protection/',
    'disaster-recovery.html':     'https://atlasglinn.com/disaster-recovery-asset-protection/',
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
            + f'<div class="badges rise"><img src="{BADGE_BEST}" alt="Best of Business 2025" loading="lazy"><img src="images/chamber-badge.png" alt="Chamber of Commerce Verified Member" loading="lazy"></div>')
    return section(i, 'Reviews', f'Google Reviews &amp; LinkedIn {blue("Recommendations.")}', f'<span class="stars">{STARS}</span> 5.0 &middot; Google Reviews', body)

def partner(paras, ctas, img, alt):
    return '<div class="partner rise"><div>' + ''.join(f'<p>{p}</p>' for p in paras) + f'<div class="ctas">{ctas}</div></div><img src="{img}" alt="{alt}" loading="lazy"></div>'

# ═══════════════════════════════ index.html ═══════════════════════════════
build('index.html',
      'Atlas Glinn | Executive Protection, Risk Management & Training — Houston, TX',
      'Elite security services by Atlas Glinn: dignitary and executive protection, residential security, secure transport, disaster recovery, AI surveillance and counter-drone solutions, and tactical training through MAST Solutions. Houston, Texas.',
      OG_DEFAULT, CREDITS, [
    ('Opening', opening('Security, Training, Dignitary Protection',   # the home hero line (owner, 2026-09-05: '"Security, Training, Dignitary Protection" on the Atlas side'), replacing "34+ Years · …"
        f'{shimmer("Details")} <span class="white">Matter.</span>',
        'Discreet, adaptive security for those who cannot afford a mistake. Executive and residential protection, disaster recovery, technology, and the training behind all of it. Houston, Texas.',
        cta('#s2', 'Our Services') + cta2('contact.html', 'Contact Us'))),
    ('Services', section(2, 'Our Services', f'Customized {blue("Security.")}', 'Customized Security Solutions Tailored to Every Client&rsquo;s Needs.',
        tiles([
            ltile('01', 'Executive Protection', 'Discreet, adaptive security for high-level executives and dignitaries.', HERO_EP, 'executive-protection.html'),
            ltile('02', 'Residential Protection', '24/7 security guards and AI surveillance for your home and estate.', CCTV, 'residential-protection.html'),
            ltile('03', 'Secure Transport', 'Armed drivers, route planning, and tactical escort for motorcade operations.', PROTECTION, 'executive-protection.html#s7'),
            ltile('04', 'Training Programs', 'Rigorous training for real-world challenges. Delivered by operators, for operators.', TRAINING, 'training.html'),
            ltile('05', 'AI Surveillance', 'AI-powered intelligence gathering, threat assessment, and real-time analytics.', CCTV, 'technology.html'),
            ltile('06', 'Disaster Recovery', 'Rapid response and asset protection during crisis situations.', AG3, 'disaster-recovery.html'),
        ]))),
    # Brockmann, 2026-09-04: "Hours of experience is wrong, and number of US senators is wrong" (the current site said
    # 1,500 hours / 2 senators). Brockmann, 2026-09-05: "34 years of expertise = change to decades", so the bio says
    # decades, the tile counts three decades, and no page states the year figure; three senators are named in the protectee
    # line; the trained count rolls to an odd number ("seven twenty nine or something like that") until he has the exact one.
    ('By the Numbers', section(3, 'Atlas Glinn &middot; Houston', f'By the {blue("Numbers.")}', '',
        '<div class="stats four rise"><div class="stat"><div class="stat-num" data-count="3">0</div><div class="stat-label">Decades of Experience</div></div>'
        '<div class="stat"><div class="stat-num" data-count="3">0</div><div class="stat-label">U.S. Senators Protected</div></div>'
        '<div class="stat"><div class="stat-num" data-count="17">0</div><div class="stat-label">Partnerships</div></div>'
        '<div class="stat"><div class="stat-num" data-count="1701" data-suffix="+">0</div><div class="stat-label">Professionals Trained</div></div></div>')),   # same metric as the MAST page's 1,701+ (owner, 2026-09-05: "Y")
    ('The Film', section(4, 'Atlas Glinn &amp; MAST Solutions', f'Watch the {blue("Film.")}', 'Twenty-seven seconds of the work: motorcade operations, the shoothouse, and the team behind both companies.',
        '<div class="yt-grid one rise">' + film_card('images/film/atlas-glinn-and-mast-solutions.mp4', 'images/film/atlas-glinn-and-mast-solutions-poster.jpg', 'Atlas Glinn &amp; MAST Solutions', 'The film from the atlasglinn.com home page') + '</div>')),
    ('Atlas EP', section(5, 'Built by Atlas Glinn', f'The Atlas EP {blue("Platform.")}',
        'We didn&rsquo;t just build a security company &mdash; we built the intelligence platform behind it. Powered by artificial intelligence, designed by a 34-year EP veteran.',
        cards([('AI Threat Analysis &amp; Scoring', 'Real-time threat intelligence powered by Anthropic Claude AI. Automated situation reports, risk scoring, and predictive threat modeling.'),
               ('Blue Force Tracking', 'Real-time GPS positioning of your entire protection team. Anti-spoofing technology ensures accurate, tamper-proof location data.'),
               ('Encrypted Push-to-Talk Radio', 'AES-256-GCM encrypted voice comms. No third-party servers, no interception risk.'),
               ('Crime Data Intelligence', 'Live crime feeds, sex offender mapping, aviation/airspace monitoring &mdash; all layered on Google Earth for advance work.'),
               ('Covert Emergency Stream', 'Silent SOS with live audio/video streaming. Your team sees and hears everything without alerting the threat.'),
               ('Duress Detection', 'Dead man&rsquo;s switch + heart rate monitoring. If you go down, your team knows immediately. Apple Watch companion with wrist SOS.'),
               ('Counter-Surveillance Sweep', 'BLE + IR camera detection for room sweeps. Identify hidden surveillance devices before your principal arrives.'),
               ('Cyber Defense Suite', 'Evil twin WiFi detection, jailbreak monitoring, MITM protection. Your device security is part of the mission.')], 'cards four')
        + '<div class="ctas rise" style="margin-top:2rem">' + cta('signup.html', 'Explore Atlas EP') + cta2('technology.html', 'All Technology') + '</div>')),
    ('No Press', section(6, '', '', '',
        '<p class="sub quote lead">&ldquo;We don&rsquo;t do press. We let our work speak for itself.&rdquo;</p>'
        f'<p class="sub" style="font-size:.98rem;">{PRIVACY_LINE}</p>'
        '<div class="eyebrow" style="margin-top:2rem;">Request the Capability Statement</div>'
        '<p class="sub" style="margin-bottom:1.4rem">Submit your request and we&rsquo;ll send our capability statement directly to your email.</p>' + contact_form('capability'),
        badge='We Don&rsquo;t Do Press.')),
    ('Reviews', section(7, 'Google Reviews &middot; 5.0 &middot; Based on 10 reviews', f'What Clients {blue("Say.")}', '',
        quotes([('I&rsquo;ve worked with Matt and his team for several years. They are extremely professional, and their training and expertise is second to none.', 'Craig E. &middot; President &amp; CEO'),
                ('Simply THE BEST hands on tactical training you can find local to Houston, TX.', 'Guadalupe A. &middot; Power Testing Specialist'),
                ('Matthew is an expert in his field. I have had the privilege to train with and work alongside him on numerous occasions.', 'Kenny U. &middot; Deputy')])
        + '<div class="ctas rise" style="margin-top:2rem">' + cta2('https://www.google.com/search?q=Atlas+Glinn+Houston+reviews', 'View All Google Reviews') + '</div>'
        + f'<div class="badges rise"><img src="{BADGE_BEST}" alt="Best of Business 2025" loading="lazy"><img src="images/chamber-badge.png" alt="Chamber of Commerce Verified Member" loading="lazy"></div>')),
    ('Contact', contact_chapter(8, 'Get in Touch', f'Protecting What {blue("Matters Most.")}', 'From U.S. Senators to Fortune 500 executives &mdash; discreet, adaptive protection at the highest level.',
        cta('contact.html', 'Contact Us') + cta2('mastsolutions.html', 'Book Training &rarr;'))),
], photos=[(FILM_POSTER, None, FILM_TEASER), (HERO_EP, None), (PROTECTION, None), (FILM_POSTER, None), (CCTV, None), (EP_MATTERS, None), (AG3, None), (HERO_EP, None)],
      jsonld=jsonld_org())

# ═══════════════════════════ executive-protection.html ═══════════════════════════
build('executive-protection.html',
      'Executive & Dignitary Protection Houston TX | Atlas Glinn',
      'Expert dignitary protection services by Atlas Glinn. Discreet, adaptable security for U.S. Senators, Fortune 500 executives, dignitaries, and their families. Houston, TX.',
      OG_DEFAULT, CREDITS, [
    ('Opening', opening('Executive Protection', f'{shimmer("Details")} <span class="white">Matter.</span>',
        'With unmatched precision, Atlas Glinn provides discreet, adaptable security&mdash;so you can focus on what matters most. Our team brings decades of combined experience protecting high-level executives, dignitaries, and their families.',
        cta('contact.html', 'Request a Consultation') + cta2('#s2', 'Our Services'))),
    ('Services', section(2, 'Our Services', f'Comprehensive {blue("Protection.")}', 'Comprehensive Dignitary Protection Tailored to Your Needs.',
        cards([('Close Protection', 'Dedicated personal protection officers providing 24/7 security coverage with discreet, professional presence tailored to your lifestyle and threat profile.'),
               ('Advance Operations', 'Thorough pre-deployment reconnaissance and venue assessment. Our advance teams identify and mitigate threats before you arrive at any location.'),
               ('Motorcade Planning', 'Strategic route planning, secure vehicle coordination, and tactical motorcade operations ensuring safe movement through any environment.'),
               ('Body Man Duties', 'Close-proximity personal security serving as your dedicated detail agent, managing immediate security concerns and daily logistics seamlessly.'),
               ('Crisis Management', 'Rapid response protocols and contingency planning for high-threat scenarios. Expert coordination during emergencies to protect lives and assets.'),
               ('Emergency Response', 'Immediate tactical response capabilities including evacuation procedures, medical coordination, and real-time threat neutralization protocols.')]))),
    ('Who Leads', section(3, 'Who Leads the Detail', f'Led From {blue("Experience.")}',
        'Led by the former Head of Security for Senator Ted Cruz, who has provided security for U.S. Senators Josh Hawley and Eric &ldquo;Bulldog&rdquo; Schmitt, a former Vice President, and Ivanka Trump (named only where media coverage exists), we understand the complexity of executive safety in an ever-changing threat landscape.',
        '<p class="sub quote lead">&ldquo;At Atlas Glinn, we understand that details matter. Whether you require discreet, low-profile security or a highly visible presence, we adapt seamlessly to ensure your safety and peace of mind.&rdquo;</p>'
        '<div class="ctas rise">' + cta2('about.html', 'Meet the Team') + '</div>')),
    ('OPORD', section(4, 'Method', f'The OPORD {blue("Framework.")}', 'Atlas Glinn applies military Operations Order (OPORD) methodology to every executive protection engagement.',
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
        '<div class="ctas rise">' + cta('contact.html', 'Plan a Movement') + cta2('mastsolutions.html', 'Vehicular Tactics Courses') + '</div>')),
    ('Contact', contact_chapter(8, 'Protecting What Matters Most', f'From Senators to {blue("Fortune 500.")}', 'Discreet, adaptive protection at the highest level.',
        cta('contact.html', 'Contact Us') + cta2('residential-protection.html', 'Residential Protection &rarr;'))),
], photos=[(HERO_EP, None), (EP_MATTERS, None), (PROTECTION, None), (HERO_EP, None), (EP_MATTERS, None), (PROTECTION, None), (HERO_EP, None), (EP_MATTERS, None)],
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
], photos=[yt_bg(YT_RESIDENTIAL), (CCTV, None), (RESI_COVERAGE, None), (CCTV, None), (HERO_EP, None)],
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
], photos=[yt_bg(YT_DISASTER), (PROTECTION, None), (PROTECTION, None), ('images/disaster-hurricane.jpg', None), ('images/disaster-lightning.jpg', None), ('images/disaster-commercial.jpg', None)],
      jsonld=jsonld_service('Disaster Recovery and Asset Protection', 'Immediate deployment, asset safeguarding and recovery assistance for hurricanes, flooding, fire, industrial incidents and power grid failures.', 'disaster-recovery.html'))

# ═══════════════════════════ training.html ═══════════════════════════
build('training.html',
      'Executive Protection & Security Training Houston TX | Atlas Glinn / MAST Solutions',
      'Elite tactical training by Atlas Glinn and MAST Solutions. Executive protection training, firearms, CQB, medical, and leadership programs for professionals.',
      TRAINING, CREDITS, [
    ('Opening', opening('Dignitary Protection Training', f'{shimmer("Details")} <span class="white">Matter.</span>',
        'At Atlas Glinn, our lead instructor brings over 30 years of experience, safeguarding dignitaries globally. We offer unparalleled Dignitary Protection training for professionals seeking to excel in high-stakes environments.',
        cta('mastsolutions.html', 'Explore MAST Solutions') + cta2('#s2', 'Focus Areas'))),
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
        + '<div class="ctas rise">' + cta('mastsolutions.html', 'Explore MAST Solutions') + '</div>')),
    ('Media', section(4, 'Training Media', f'Featured on Modern Shooter TV and {blue("The Washington Post.")}', '',
        '<div class="yt-grid rise">'
        '<div class="yt-card"><div class="frame"><iframe src="https://www.youtube.com/embed/pSGWdaDglZE?rel=0&amp;modestbranding=1" title="Modern Shooter TV — MAST Solutions" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div><div class="info"><h4>Modern Shooter TV</h4><p>Lance M / Castro / Ray Cash &mdash; MAST Solutions</p></div></div>'
        '<div class="yt-card"><div class="frame"><iframe src="https://www.youtube.com/embed/OfXe_bdH6t4?rel=0&amp;modestbranding=1" title="Modern Shooter TV — Tactical Training Feature" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div><div class="info"><h4>Modern Shooter TV</h4><p>Tactical Training Feature</p></div></div>'
        '</div>'
        '<a href="https://www.washingtonpost.com/graphics/2018/national/amp-stories/arming-american-teachers/" target="_blank" rel="noopener" class="post"><small>The Washington Post</small>Active Shooter: Arming American Teachers</a>'
        '<p class="sub" style="margin-top:1.4rem;font-size:.95rem">MAST Solutions featured in The Washington Post&rsquo;s coverage on active shooter preparedness and school security training. An in-depth look at how Atlas Glinn&rsquo;s training programs prepare educators and security professionals for real-world threats. <a href="https://www.washingtonpost.com/graphics/2018/national/amp-stories/arming-american-teachers/" target="_blank" rel="noopener">Read The Feature &rarr;</a></p>')),
    ('Reviews', reviews_chapter(5)),
], photos=[yt_bg(YT_TRAINING), (TRAINING, None), (HERO_EP, None), (EP_MATTERS, None), (TRAINING, None)],
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
               ('Deep Sentinel', 'At Atlas Glinn, we are proud to be an authorized partner with Deep Sentinel, offering 24/7 live agent monitoring with AI-driven analytics.', '<a class="secondary-cta" href="https://www.deepsentinel.com/" target="_blank" rel="noopener">Learn More &rarr;</a>'),
               ('LVT (Live View Technologies)', 'Atlas Glinn partners with Live View Technologies. Solar-powered, wireless surveillance with advanced cameras, analytics, and real-time monitoring.', '<a class="secondary-cta" href="https://www.lvt.com/partner/atlas-glinn" target="_blank" rel="noopener">Learn More &rarr;</a>')], numbered=False))),
    ('Deep Sentinel', section(4, 'Deep Sentinel', f'Deep {blue("Sentinel.")}', 'The only video surveillance cameras with live security guards that prevent crime. AI-driven analytics with 24/7 live agent monitoring.',
        '<div class="ctas rise">' + cta2('https://www.deepsentinel.com/', 'Learn More') + '</div>' + figure(AI_SURV, 'Deep Sentinel AI surveillance'))),
    ('Counter-Drone', section(5, 'Counter-Drone Solutions', f'Counter-Drone {blue("Solutions.")}', '',
        partner(['Atlas Glinn, in partnership with AeroDefense, delivers advanced drone detection solutions to safeguard critical infrastructure, public safety, &amp; national security &mdash; locating both drones &amp; their operators in real time.',
                 'AeroDefense&rsquo;s Made-in-the-USA system simultaneously locates both the drone and its pilot. DHS Safety Act Designated.'],
                cta2('cuas-aerodefense.html', 'Learn More'), AERO, 'AeroDefense partner — Atlas Glinn'))),
    ('Advanced UAS', section(6, 'Advanced UAS Solutions', f'Advanced UAS {blue("Solutions.")}', '',
        partner(['Through elite partnership with Sunflower Labs, Atlas Glinn delivers autonomous drones for real-time surveillance, instant threat response, and seamless security integration.',
                 'Sunflower Labs&rsquo; fully autonomous drones provide real-time, intelligent surveillance. These drones fly without human intervention, responding instantly to alarms and security system triggers.'],
                cta2('contact.html', 'Inquire About UAS'), UAS_IMG, 'Sunflower Labs autonomous UAS'))),
    ('Reviews', reviews_chapter(7)),
], photos=[(AI_SURV, None), (CCTV, None), (AI_SURV, None), (AI_SURV, None), (AERO, None), (UAS_IMG, None), (HERO_EP, None)],
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
    ('No Pilot', section(3, 'Autonomous Drones via Sunflower Labs', f'No Pilot Required. {blue("No Gaps in Coverage.")}', 'Real-time intelligent surveillance with instant threat response.',
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
            ('Installation', '8&ndash;12 weeks'), ('Weather', '99% conditions'), ('Integrations', 'RTSP, Webhooks, API')]) + f'</div><img src="{BEEHIVE}" alt="Sunflower Labs Beehive system" loading="lazy"></div>')),
    ('Contact', contact_chapter(6, 'Ready for Autonomous Protection?', f'Design {blue("Yours.")}', 'Contact Atlas Glinn to design a custom autonomous drone surveillance solution for your property.',
        cta('contact.html', 'Contact Us') + cta2(TEL, PHONE))),
    ('Reviews', reviews_chapter(7)),
], photos=[(UAS_IMG, None), (BEEHIVE, None), (UAS_IMG, None), (BEEHIVE, None), (UAS_IMG, None), (BEEHIVE, None), (HERO_EP, None)],
      jsonld=jsonld_service('Autonomous UAS Security', 'Sunflower Labs Beehive autonomous drone surveillance with AI detection of people, vehicles and animals, integrated by Atlas Glinn.', 'uas.html'))

# ═══════════════════════════ about.html ═══════════════════════════
BROCKMANN_BIO = ('Matthew Brockmann is the visionary founder of both MAST Solutions and Atlas Glinn, bringing decades of expertise in security, training, and dignitary protection. A seasoned civilian contractor, he specializes in Military, Law Enforcement, and Homeland Security Special Response Teams (SRT), with extensive experience collaborating with elite Tier 1 Operators from units like Navy SEALs, Recon Marines, and USASOC. His career began in 1991 at Gunsite under Col. Jeff Cooper. '
                 + PRIVACY_LINE + ' He is a certified Firearms Instructor for civilians, law enforcement, and agencies, and a Gracie Jiu-Jitsu practitioner.')
build('about.html',
      'About Atlas Glinn | Elite Security Leadership — Houston, TX',
      'Meet the Atlas Glinn leadership team. Decades of elite security, dignitary protection, and tactical training expertise led by Matthew Brockmann and Michael Cline.',
      FOUNDER, CREDITS, [
    ('Opening', opening('About Atlas Glinn', f'{shimmer("Details")} <span class="white">Matter.</span>',
        'Our mission is to provide you with unparalleled peace of mind, safeguarding what matters most &mdash; your safety, your assets, and your way of life. With a foundation built on elite expertise and a relentless pursuit of excellence, we deliver tailored protection solutions that blend seamlessly into your world.',
        cta('#s2', 'Meet the Team') + cta2('contact.html', 'Contact Us'))),
    ('Team', section(2, 'Meet the Team', f'Precision. Discretion. {blue("Commitment.")}', 'We redefine security with precision, discretion, and unwavering commitment.',
        f'<div class="team rise"><div class="portrait" style="background-image:url(\'{FOUNDER}\');{FOUNDER_CROP}"><div class="cap">Founder &amp; CEO</div></div><div class="bio"><h3>Matthew Brockmann</h3><div class="role">Founder &amp; CEO</div><p>{BROCKMANN_BIO}</p></div></div>'
        f'<div class="team rise"><div class="portrait" style="background-image:url(\'{CLINE}\');background-position:center 15%"><div class="cap">Chief Operating Officer</div></div><div class="bio"><h3>Michael Cline</h3><div class="role">Chief Operating Officer</div><p>As the Chief Operating Officer at Atlas Glinn, Michael Cline brings a wealth of experience and a strategic vision to the company. With a distinguished 12-year career as a Navy SEAL, Michael has honed exceptional leadership, discipline, and problem-solving skills that are now pivotal in driving Atlas Glinn&rsquo;s operational excellence.</p></div></div>')),
    ('In Action', section(3, 'Atlas Glinn In Action', f'Behind the {blue("Mission.")}', 'Training, operations, and the people behind the mission.',
        '<div class="yt-grid one rise">' + film_card('images/film/about-atlas-glinn.mp4', ABOUT_POSTER, 'About Atlas Glinn', 'The film from the About page') + '</div>')),
    ('Clients', section(4, 'What Clients Say', f'In Their {blue("Words.")}', '',
        quotes([('I&rsquo;ve worked with Matt &amp; his team for several years. They are extremely professional, and their training &amp; expertise is second to none.', 'Craig E. &middot; President &amp; CEO'),
                ('I trained with Matt &amp; the team at MAST Solutions for over a year. The techniques, skills &amp; mentality I learned in the first class were well more advanced.', 'Brian S. &middot; IRC &amp; MBA'),
                ('Simply THE BEST hands on tactical training you can find local to Houston, TX.', 'Guadalupe A. &middot; Power Testing Specialist'),
                ('Matthew is an expert in his field, I have had the privilege to train with &amp; work alongside him on numerous occasions.', 'Kenny U. &middot; Deputy'),
                ('I highly recommend Matthew &amp; his team for your security &amp; training needs.', 'Charles W. &middot; Business Operations Manager'),
                ('Matthew is a highly skilled individual with ample knowledge of firearm operations, safety &amp; security.', 'Alf T. &middot; Senior Operations Advisor')]))),
    ('Insights', section(5, 'Insights &amp; Resources', f'From the {blue("Field.")}', '',
        cards([('Raising the Bar: Why the Security Industry Needs Higher Standards', 'Discover why Atlas Glinn is leading the charge to elevate training standards across the security industry.', '<a class="secondary-cta" href="https://atlasglinn.com/training-certification/raising-the-bar-why-the-security-industry-needs-higher-standards-and-how-atlas-glinn-is-leading-the-charge/">Read &rarr;</a>'),
               ('Why Real-World Experience Matters in Executive Protection', 'A lesson from the front lines on why field-tested expertise outperforms theory every time.', '<a class="secondary-cta" href="https://atlasglinn.com/case-studies-success-stories/why-real-world-experience-matters-in-executive-protection-a-lesson-from-the-front-lines/">Read &rarr;</a>'),
               ('How We Secured a CEO&rsquo;s Global Tour', 'An inside look at the coordination and planning behind protecting a Fortune 500 executive across multiple countries.', '<a class="secondary-cta" href="https://atlasglinn.com/case-studies-success-stories/how-we-secured-a-ceos-global-tour/">Read &rarr;</a>'),
               ('Why Atlas Glinn&rsquo;s Security Training Sets the Standard', 'Our training programs are built on decades of real-world experience with elite military and law enforcement units.', '<a class="secondary-cta" href="https://atlasglinn.com/training-certification/why-atlas-glinns-security-training-sets-the-standard/">Read &rarr;</a>'),
               ('Preparing for Natural Disasters: A Security Must', 'Why disaster preparedness is a critical component of any comprehensive security strategy.', '<a class="secondary-cta" href="https://atlasglinn.com/disaster-recovery-asset-protection/preparing-for-natural-disasters-a-security-must/">Read &rarr;</a>'),
               ('5 Essential Tips for VIP Security in 2025', 'Key strategies every VIP protection detail should implement to stay ahead of evolving threats.', '<a class="secondary-cta" href="https://atlasglinn.com/executive-residential-protection/5-essential-tips-for-vip-security-in-2025/">Read &rarr;</a>')], numbered=False))),
    ('Contact', contact_chapter(6, 'Ready to Work With Us?', f'Let&rsquo;s {blue("Talk.")}', '',
        cta('contact.html', 'Contact Us') + cta2('careers.html', 'Careers &rarr;'))),
], photos=[(ABOUT_POSTER, None, ABOUT_TEASER), (FOUNDER_SCENE, 'center 20%'), (ABOUT_POSTER, None), (EP_MATTERS, None), (HERO_EP, None), (PROTECTION, None)],
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
    ('Positions', section(2, 'Open Positions', f'Join the {blue("Detail.")}', '',
        cards([('Level 4 Personal Protection Officer (Flex)', 'Provide close protection, conduct risk assessments, and escort clients during travel and events. Respond to threats with precision, maintain detailed logs, collaborate with law enforcement when necessary.',
                '<div class="meta">Houston, TX &middot; Part-Time, Flexible Schedule</div><div class="eyebrow in" style="margin:.8rem 0 .2rem;font-size:.6rem">Requirements</div>' + REQ + '<a class="cta-button" href="contact.html?subject=Level%204%20PPO%20(Flex)%20application">Apply Now</a>'),
               ('Level 3 Commissioned Security Guard (Flex)', 'Armed security at various client sites. Conduct regular patrols and inspections, respond rapidly to emergencies, collaborate with law enforcement, maintain detailed incident reports.',
                '<div class="meta">Houston, TX &middot; Part-Time, Flexible Schedule</div><div class="eyebrow in" style="margin:.8rem 0 .2rem;font-size:.6rem">Requirements</div>' + REQ + '<a class="cta-button" href="contact.html?subject=Level%203%20Commissioned%20Security%20Guard%20(Flex)%20application">Apply Now</a>')], 'cards two', numbered=False))),
    ('Why Atlas Glinn', section(3, 'Why Atlas Glinn', f'What Sets Us {blue("Apart.")}', '',
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
], photos=[(CAREERS_HERO, None), (HERO_EP, None), (TRAINING, None), (CAREERS_HERO, None)])

# ═══════════════════════════ contact.html ═══════════════════════════
build('contact.html',
      'Contact Atlas Glinn | Security Consultation — Houston, TX',
      'Contact Atlas Glinn for a personalized security assessment. Executive protection, training, and risk management services in Houston, TX.',
      OG_DEFAULT, CREDITS, [
    ('Opening', opening('Contact', f'{shimmer("Details")} <span class="white">Matter.</span>',
        'Every engagement begins with a conversation. Tell us what you are protecting.',
        cta('#s2', 'Send a Message') + cta2(TEL, PHONE))),
    ('Message', section(2, 'Contact Information', f'Reach {blue("Us.")}',
        f'Atlas Glinn, LLC &middot; MAST Solutions<br>2450 Fondren Road, Suite 255, Houston, TX 77063<br><a href="{TEL}" style="color:var(--gold-champagne);text-decoration:none">{PHONE}</a> &middot; <a href="mailto:{EMAIL}" style="color:var(--gold-champagne);text-decoration:none">{EMAIL}</a>',
        contact_form('contact'))),
    ('Details', contact_chapter(3, 'Atlas Glinn, LLC', f'Details {blue("Matter.")}', 'Executive Protection &middot; Training &middot; AI Surveillance &middot; Counter-Drone Solutions &middot; Risk Management',
        cta('mastsolutions.html', 'Book Training') + cta2('index.html', 'Home &rarr;'))),
], photos=[(HERO_EP, None), (PROTECTION, None), (AG3, None)],
      jsonld=jsonld_org())
