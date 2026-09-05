#!/usr/bin/env python3
"""Assemble mastsolutions.html (the production MAST page): the Tier 3 trailer visual system
(reference/desktop/mast_tier3_trailer.html + atlas_mast_landing_4d.html) carrying the real MAST site: catalog +
calendar + Stripe checkout, instructors, media, capability, contact. Booking CSS/JS/modals are lifted verbatim from
mastsolutions-tesla.html and recolored to the trailer palette, so the pages share one booking stack.

The visual shell (CSS, three.js scene, chrome) lives in scripts/cinematic_shell.py and is shared with the Atlas Glinn
pages (scripts/assemble-atlas.py). Edit the shell there; edit MAST content here.

Edit THIS FILE and re-run it; never hand-edit mastsolutions.html, the next run overwrites it."""
import re, sys
import os
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cinematic_shell as shell

tesla = open(f'{REPO}/mastsolutions-tesla.html', encoding='utf-8').read()

def between(s, a, b, inclusive=False):
    i = s.index(a); j = s.index(b, i + len(a))
    return s[i:j + (len(b) if inclusive else 0)]

# ── 1. Booking CSS from the Tesla page (catalog, video cards, modals, calendar, checkout, quals, banner) ──
css_src = between(tesla, '<style>', '</style>')
want = ('.catalog-panel', '.cat', '.course-row', '.cr-', '.video-card', '.yt', '.media-strip', '.modal', '.cal-', '.day',
        '.sheet', 'label', 'input', '.qty', '.total', '.secure', '.err', '.quals', '.banner', '.legend', '.reg-', '.policy', '.acct', '.gear')
# keep each lifted rule inside the media query it came from (the Tesla page nests its phone sheet rules in @media)
groups = {None: []}; media = None
for line in css_src.splitlines():
    t = line.strip()
    if t.startswith('@media'):
        media = t.rstrip('{').strip(); groups.setdefault(media, []); continue
    if t == '}' and media: media = None; continue
    if any(t.startswith(w) for w in want) and '{' in t:
        groups[media].append(t)
booking_css = '\n'.join(groups[None]) + ''.join('\n' + m + ' {\n' + '\n'.join(r) + '\n}' for m, r in groups.items() if m and r)
assert '@media (max-width: 768px) {' in booking_css, 'phone modal rules lost their media wrapper'
# recolor Atlas blue → trailer gold, Atlas surfaces → trailer surfaces, Inconsolata → Share Tech Mono
rep = {'#1A6BDE': '#C9A84C', 'rgba(26,107,222,': 'rgba(201,168,76,', '#0f1622': '#0B1221', '#080C14': '#050810',
       "'Inconsolata', monospace": "'Share Tech Mono', monospace", 'rgba(8,12,20,': 'rgba(5,8,16,'}
for k, v in rep.items(): booking_css = booking_css.replace(k, v)
assert '.modal-bd {' in booking_css and '.day.wk {' in booking_css and '.cat-btn {' in booking_css, 'booking css missing pieces'

# ── 2. Modal + banner markup from the Tesla page ──
banner = between(tesla, '<div id="banner"', '</div>', True)
modals = between(tesla, '<!-- CALENDAR -->', '</ol>\n</div>', True)
modals = modals.replace('style="color:#1A6BDE;text-decoration:none;"', 'style="color:#E8D27D;text-decoration:none;"')
modals = modals.replace('<i style="background:#1A6BDE"></i>Selected', '<i style="background:#E8D27D"></i>Selected')

# ── 3. Booking JS from the Tesla page: everything up to the hero loader, then MEDIA + the media strip renderer ──
js = between(tesla, '<script>', '</script>')[len('<script>'):]
a = js.index("(function(){\n  const box = $('hero-yt')")
b = js.index('const MEDIA = [')
c = js.index("(function(){\n  const io = new IntersectionObserver(en => en.forEach(x => { if (!x.isIntersecting) return;")
js = js[:a] + js[b:c]
# replace the MEDIA array with the curated set: the Training Reel first (owner, 2026-09-04: "put first then the others"), its
# closing "2023" card cut by the end mark until the file is local; then the local clips; then the other YouTube films.
media = """const MEDIA = [
  { yt: 'jwQ5OyKEKwg', end: 36, title: 'Training Reel', sub: 'The film behind the Training page' },
  { mp4: 'images/mast/mast-cqb.mp4', teaser: 'images/mast/mast-cqb-teaser.mp4', poster: 'images/mast/mast-cqb-poster.jpg', title: 'CQB', sub: 'Night-vision room clearing, then the range' },
  { mp4: 'images/mast/mast-vid-3.mp4', teaser: 'images/mast/mast-vid-3-teaser.mp4', poster: 'images/mast/mast-vid-3-poster.jpg', title: 'Behind the Scenes', sub: 'Filming the Modern Shooter TV feature' },
  { mp4: 'images/mast/mast-vid-web2.mp4', teaser: 'images/mast/mast-vid-web2-teaser.mp4', poster: 'images/mast/mast-vid-web2-poster.jpg', title: 'Vehicle Tactics', sub: 'Mounted movement through smoke' },
  { mp4: 'images/mast/mast-vid-1.mp4', teaser: 'images/mast/mast-vid-1-teaser.mp4', poster: 'images/mast/mast-vid-1-poster.jpg', title: 'MAST Solutions', sub: 'On the range' },
  { mp4: 'images/mast/mast-vid-2.mp4', teaser: 'images/mast/mast-vid-2-teaser.mp4', poster: 'images/mast/mast-vid-2-poster.jpg', title: 'MAST Solutions', sub: 'Training day' },
  { mp4: 'images/mast/mast-medical.mp4', teaser: 'images/mast/mast-medical-teaser.mp4', poster: 'images/mast/mast-medical-poster.jpg', title: 'Medical', sub: 'Tourniquet under pressure' },
  { mp4: 'images/mast/mast-shotgun.mp4', teaser: 'images/mast/mast-shotgun-teaser.mp4', poster: 'images/mast/mast-shotgun-poster.jpg', title: 'Shotgun', sub: 'Two takes on the flat range' },
  { mp4: 'images/mast/mast-shotgun-op.mp4', teaser: 'images/mast/mast-shotgun-op-teaser.mp4', poster: 'images/mast/mast-shotgun-op-poster.jpg', title: 'Shotgun Operator', sub: 'Class instruction' },
  { mp4: 'images/film/atlas-glinn-and-mast-solutions.mp4', teaser: 'images/film/atlas-glinn-and-mast-solutions-teaser.mp4', poster: 'images/film/atlas-glinn-and-mast-solutions-poster.jpg', title: 'Atlas Glinn & MAST Solutions', sub: 'The film from the Atlas Glinn home page' },
  { mp4: 'images/film/about-atlas-glinn.mp4', teaser: 'images/film/about-atlas-glinn-teaser.mp4', poster: 'images/film/about-atlas-glinn-poster.jpg', title: 'Leadership Course', sub: 'MAST Solutions and Atlas Glinn' },
  { yt: 'pSGWdaDglZE', title: 'Modern Shooter TV', sub: 'Lance M / Castro / Ray Cash — MAST Solutions, full episode' },
  { yt: 'OfXe_bdH6t4', title: 'Modern Shooter TV', sub: 'Tactical Training Feature' },
  { yt: 'mI7Ou5P-WHE', title: 'Disaster Recovery & Asset Protection', sub: 'Immediate deployment when the storm has passed' },
];
"""
js = re.sub(r"const MEDIA = \[[\s\S]*?\n\];\n", media, js, count=1)
# Video testimonials live in the Testimonials chapter (Brockmann, 2026-09-04), not in the media strip.
testimonials = """const TESTIMONIALS = [
  { mp4: 'images/mast/jason-castro-testimonial.mp4', teaser: 'images/mast/jason-castro-testimonial-teaser.mp4', poster: 'images/mast/jason-castro-testimonial-poster.jpg', title: 'Jason Castro', sub: 'Student testimonial' },
  { mp4: 'images/mast/testimonial-2.mp4', teaser: 'images/mast/testimonial-2-teaser.mp4', poster: 'images/mast/testimonial-2-poster.jpg', title: 'MUSAT Security Training Center', sub: 'Client film' },
];"""   # testimonial-2: his "Testimonial2.mov" (2026-09-05, "Attached MP4 = Testimonials"): a MUSAT training-center film; retitle on his word
assert js.count('const TESTIMONIALS = [];') == 1, 'tesla page lost its TESTIMONIALS hook'
js = js.replace('const TESTIMONIALS = [];', testimonials, 1)
# A Long Recovery: the documentary about instructor Torrey Kramer's return after his second deployment (link from Brockmann, 2026-09-04).
instructor_films = """const INSTRUCTOR_FILMS = [
  { yt: '0IkEMH0LPC8', title: 'A Long Recovery', sub: 'The documentary following Torrey Kramer\\u2019s return' },
];"""
assert js.count('const INSTRUCTOR_FILMS = [];') == 1, 'tesla page lost its INSTRUCTOR_FILMS hook'
js = js.replace('const INSTRUCTOR_FILMS = [];', instructor_films, 1)
assert 'function openCal' in js and 'function startCheckout' in js and "['testimonial-strip', TESTIMONIALS]" in js, 'booking js missing pieces'
assert 'hero-yt' not in js and 'REVIEWS' not in js, 'hero/reviews code leaked into booking js'

# ── 4. Page ──
def tile(num, title, body, img, pos='center'):
    return shell.tile(num, title, body, 'images/mast/' + img, pos)

CHROME = shell.chrome(
    credits=('A Houston Operation', 'Since 2005'), wordmark='MAST Solutions',
    photos=[('01', 'images/mast/hero-casualty-carry.jpg', 'center 40%'), ('02', 'images/mast/disc-firearms.jpg', 'center top'),   # the picture is near-square: from the top so the two faces show (owner, 2026-09-05: "bring this pic down so we can see the people")
            ('03', 'images/mast/ship-deck-operators.jpg', 'center top'),   # the deck photograph cut to its lower half, so the four operators sit in the upper band behind the heading, not behind the tiles (owner, 2026-09-05: "Bring the ship up and the operators visible", then "SHOW THE OPERATORS on deck in background")
            ('04', 'images/mast/disc-cqb.jpg', None),
            ('05', 'images/mast/range/a08.jpg', 'center 45%'),   # the aerial (r01.jpg never existed: the old-site set is r001–r024)
            ('06', 'images/mast/courses-low-light.jpg', None), ('07', 'images/mast/courses-low-light.jpg', 'center 60%'),
            ('08', 'images/mast/gallery/g06.jpg', 'center 45%'),   # the carbine from behind the car (owner, 2026-09-05: "Replace this background with the attached JPG", on the Instructors chapter)
            ('09', 'images/mast/vehicular.jpg', None), ('10', 'images/mast/instructing-le.jpg', 'center 30%'),
            ('11', 'images/mast/privacy-aircraft.jpg', None), ('12', 'images/mast/disc-firearms.jpg', 'center 30%'), ('13', 'images/mast/contact-zodiac.jpg', None)],
    hud_tl='&#9679; ATLAS GLINN &middot; MAST.SYS LIVE', hud_tl_href='/',   # root, so it resolves on WordPress and on Pages alike
    hud_bl='HOU &middot; 29.7604&deg;N &middot; 95.3698&deg;W', hud_br='DETAILS MATTER',
    chapters=[('s1', '01 &middot; Opening'), ('s2', '02 &middot; Standard'), ('s3', '03 &middot; Who'), ('s4', '04 &middot; Disciplines'), ('s5', '05 &middot; The Range'),
              ('s6', '06 &middot; Classes'), ('s7', '07 &middot; Team Memberships'), ('s8', '08 &middot; Instructors'), ('s9', '09 &middot; In Action'),
              ('s10', '10 &middot; Testimonials'), ('s11', '11 &middot; Privacy'), ('s12', '12 &middot; Gear'), ('s13', '13 &middot; Contact')])


# ── Membership: the four teams of the old site's Membership sheet (2014) plus Law Enforcement and Verified Teachers (owner,
#    2026-09-04: "Add the 4 Subscriptions"; fees Red 250, Blue 450, Gold 575, Black 600, LE 195, Teachers 195). Join opens a short
#    dialog (name, email) and hands off to Stripe Checkout in subscription mode through the Worker's POST /create-membership; the
#    Worker provisions each plan's Stripe Price on first use ("2- you can do").
import urllib.parse
def tier(name, key, plan, fee, includes, slots):
    """A membership as the same tile as the seven skills (owner, 2026-09-04): number line = fee and slots, title = the team, the
    benefit line shows on hover / focus, and a click opens the join dialog (which carries the benefit line) → Stripe."""
    args = f"'{plan}', '{name}', '{fee}', '{includes}'"
    return (f'<div class="tile team-tile {key}" role="button" tabindex="0" onclick="joinTeam({args})" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){{event.preventDefault();joinTeam({args});}}">'
            f'<div class="bg"></div><div class="txt"><div class="num">{fee} &middot; per month &middot; {slots}</div><h3>{name}.</h3><p>{includes}</p></div></div>')

MEMBERSHIP = f"""
  <section class="panel" id="s7" data-section="07">
    <div>
      <div class="eyebrow">Team Memberships &middot; Six Teams &middot; Limited Slots</div>
      <h2 class="section-h">Team <span class="gold">Memberships.</span></h2>
      <p class="sub">MAST offers membership in six teams: four open teams, plus Law Enforcement and Verified Teachers. Each team holds a set number of slots, so the benefits and the class seats are always there for the members who hold them. When a team is full there is a waiting list. New memberships are vetted by the established team.</p>
      <div class="tiles four rise">
        {tier('Red Team', 't-red', 'red_team', '$250', 'One class, plus 25% off any one class for you or one friend.', '10 memberships')}
        {tier('Blue Team', 't-blue', 'blue_team', '$450', 'Two classes, plus 35% off any two classes for you or two friends.', '5 memberships')}
        {tier('Gold Team', 't-gold', 'gold_team', '$575', 'Three classes, plus 45% off any three classes for you or three friends.', '5 memberships')}
        {tier('Black Team', 't-black', 'black_team', '$600', 'Unlimited classes, plus 50% off any class for you or four friends.', '5 memberships')}
        {tier('Law Enforcement', 't-le', 'le_team', '$195', 'Two classes, plus 35% off any two classes for you or two friends. Verified status required.', '10 memberships')}
        {tier('Verified Teachers', 't-teachers', 'teachers_team', '$195', 'Two classes, plus 35% off any two classes for you or two friends. Verified status required.', '10 memberships')}
      </div>
      <p class="teams-note">Hover a team for what it includes; tap it to join. A slot is held while the monthly fee is paid; a lapsed slot goes to the waiting list. Membership is billed monthly by card; new memberships are vetted by the established team.</p>
    </div>
  </section>
"""

# ── Blogs in the chapter menu, under In Action, preview-only (owner, 2026-09-05: "Link the blogs in the menu under In Action, but do
#    not publish to view yet (I can see) and can change up when due to SEO"). The link renders only when the URL carries `preview`
#    (…mastsolutions.html?v=<sha>&preview), so visitors never see it until he says publish. Not a .chap-link: the shell maps those to
#    chapters by index.
_in_action = '  <a href="#s9" class="chap-link">09 &middot; In Action</a>'
assert CHROME.count(_in_action) == 1, 'In Action nav entry not found'
CHROME = CHROME.replace(_in_action, _in_action + '\n  <a href="articles/index.html" class="chap-extra preview-only">&middot; Blogs</a>')

# ── Account (owner, 2026-09-05: "ADD ACCOUNT"): a Sign in link in the HUD's top-right corner and an entry at the foot of the chapter
#    menu; both open the account dialog lifted from the booking page. The label becomes the student's first name once signed in.
_contact_nav = '  <a href="#s13" class="chap-link">13 &middot; Contact</a>'   # Contact moved to 13 when Gear became chapter 12 (2026-09-05)
assert CHROME.count(_contact_nav) == 1, 'Contact nav entry not found'
CHROME = CHROME.replace(_contact_nav, _contact_nav + '\n  <a href="#" class="chap-extra chap-always acct-link" onclick="openAcct();return false;">&middot; Sign in</a>')
_hud_tr = '<div class="hud tr" id="hud-section">'
assert CHROME.count(_hud_tr) == 1, 'HUD section marker not found'
CHROME = CHROME.replace(_hud_tr, '<a class="hud acct acct-link" href="#" onclick="openAcct();return false;" aria-haspopup="dialog">Sign in</a>\n' + _hud_tr)

# ── The Range: the owner's photographs first (2026-09-05: a08 and a13 the aerials, a01–a04 the berm, the berm at dusk, the
#    canopies and the classroom, a05 the briefing, a09 the pistol line, a10 the range at night under lights, a11 the low-light
#    class, a12 the doorway entry), then the old site's views he kept. 2026-09-05, on the 27-tile build (b2d0e99: a05–a07 then r001–r024):
#    "Delete 2, 3, 4, 6, 8, 9, 10, 11, 12, 13, 14, 15, 19, 21, 22, 23 and add what I just uploaded to the rest … want to trim down
#    Range Photos". The sixteen he cut (a06, a07, r001, r003, r005–r012, r016, r018–r020) stay in images/mast/range/ out of the
#    chapter ("can add some to gallery"). Same tile as the skills; tap opens the photograph in a lightbox. Edit the list and re-run.
#    2026-09-05 ("anytime I drop new items into the folder on my desktop, it should update in and add photos to the gallery"):
#    both lists now live in images/mast/<kind>/tiles.txt. scripts/photo-intake.py appends what lands in the Desktop drop
#    folders (via the handoff branch); a person reorders or removes by editing the file. The order below is unchanged.
def read_tiles(kind):
    p = f'{REPO}/images/mast/{kind}/tiles.txt'
    return ['images/mast/' + l.strip() for l in open(p, encoding='utf-8') if l.strip() and not l.lstrip().startswith('#')]
RANGE_PHOTOS = read_tiles('range')   # was: a08, a13, a01–a05, a09–a12, r002
# 2026-09-05, 01:40: "The Range = 'SHOW ALL' delete … just what we have for the range is good": the twelve that showed stay, no
# button; the other old-site views (r004, r013–r015, r017, r021–r024) leave the chapter and stay in the folder.
# The gallery under the films in In Action ("can add some to gallery", 2026-09-05): the action photographs he sent without a
# caption that evening (g01 the police line on the covered range, g03 the vehicle drill in smoke, g07 through the smoke with the
# carbine, g06 the carbine from behind the car, g04 the boat drill, g05 room clearing, g08 the team in the truck bed, g09 coffee in
# kit with an MP, g02 the night muzzle flash) and his two range shots that are not of the range itself (a06 the firing line, a07
# the prone shot; "photos that I will assign"). Anything he assigns to a chapter moves out of here.
GALLERY_PHOTOS = read_tiles('gallery')   # was: g12, g01, g03, g07, g06, g04, g05, g13, g11, g10, g08, g09, g02, a06, a07 — g10 the log carry, g11 the tire jump, g12 the class with the tire (01:29); g13 the combatives pad drill (02:01, a video-analysis frame with the app chrome cropped away)
for _p in RANGE_PHOTOS + GALLERY_PHOTOS:
    assert os.path.exists(f'{REPO}/{_p}'), f'Photograph missing: {_p}'
CLIP_EXT = ('.mp4', '.mov', '.webm', '.m4v')
def photo_tile(i, src, shown):
    """One tile. A clip (Instagram or a phone video dropped into the gallery folder) shows its -poster frame and a play mark;
    the lightbox plays the file (openLb handles .mp4/.webm/.mov)."""
    more = ' more' if i > shown else ''
    clip = src.lower().endswith(CLIP_EXT)
    bg = src
    if clip:
        stem = os.path.splitext(src)[0]
        bg = next((c for c in (stem + '-poster.jpg', stem + '-poster.png', stem + '.jpg', stem + '.png') if os.path.exists(f'{REPO}/{c}')), '')
    style = " style=\"background-image:url('" + bg + "')\"" if bg else ''
    kind = 'clip' if clip else 'photograph'
    return ('<div class="tile photo' + more + (' clip' if clip else '') + '" role="button" tabindex="0" aria-label="Open ' + kind + f' {i:02d}" '
            "onclick=\"openLb('" + src + "')\" onkeydown=\"if(event.key==='Enter'||event.key===' '){event.preventDefault();openLb('" + src + "');}\">"
            '<div class="bg"' + style + '></div><div class="txt"><div class="num">' + f'{i:02d}' + (' &#9654;' if clip else '') + '</div></div></div>')
def fold_button(fold_id, open_text, close_text):
    """The open/close button for a folded photo grid (owner, 2026-09-05: "collapse all the photos … with a close open button. I'm trying
    to limit how much scrolling there is"). The grid starts closed; the button toggles it and swaps its own label."""
    return (f'<div class="ctas rise"><button class="secondary-cta" type="button" id="{fold_id}-btn" aria-expanded="false" aria-controls="{fold_id}" '
            f'onclick="toggleFold(\'{fold_id}\', \'{open_text}\', \'{close_text}\')">{open_text}</button></div>')
def photo_grid(gid, photos):
    """Skills-tile grid of photographs. Up to four rows show outright; a longer set shows twelve and puts the rest behind "Show all"."""
    shown = len(photos) if len(photos) <= 16 else 12
    tiles = ''.join(photo_tile(i, src, shown) for i, src in enumerate(photos, 1))
    more = '' if len(photos) <= shown else f'<div class="ctas rise"><button class="secondary-cta" type="button" id="{gid}-more" onclick="showAll(\'{gid}\')">Show all {len(photos)} photographs</button></div>'
    return f'<div class="tiles four rise photo-tiles" id="{gid}">{tiles}</div>\n      {more}'
RANGE_SECTION = f"""
  <section class="panel" id="s5" data-section="05">
    <div>
      <div class="eyebrow">Enter the Range</div>
      <h2 class="section-h">The <span class="gold">Range.</span></h2>
      <p class="sub">A private range. Flat range and berms, vehicle lanes, low light, and the shoothouse &mdash; the ground every class is run on.</p>
      {fold_button('range-fold', 'Click to View', 'Click to Close')}
      <div class="fold" id="range-fold">{photo_grid('range-tiles', RANGE_PHOTOS)}</div>
    </div>
  </section>
"""
LIGHTBOX = """
<!-- LIGHTBOX for the Range photographs -->
<div id="lb-bd" class="modal-bd" onclick="closeLb()"></div>
<div id="lb" class="modal wide lightbox" role="dialog" aria-modal="true" aria-label="Photograph"><button class="modal-x" aria-label="Close" onclick="closeLb()">&times;</button><img id="lb-img" alt=""><video id="lb-vid" controls playsinline preload="none" hidden></video></div>
"""
LIGHTBOX_JS = """
function showAll(id){ document.getElementById(id).classList.add('all'); const b = document.getElementById(id + '-more'); if (b) b.remove(); }
if (/[?&#]preview(?=[=&#]|$)/.test(location.search + location.hash)) document.body.classList.add('preview');   // owner's preview of unpublished pieces (the Blogs link)
function toggleFold(id, openText, closeText){ const f = $(id), b = $(id + '-btn'); const open = !f.classList.contains('open'); f.classList.toggle('open', open); b.textContent = open ? closeText : openText; b.setAttribute('aria-expanded', open ? 'true' : 'false'); if (!open) b.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
function openLb(src){ const vid = /\.(mp4|webm|mov)(\?|$)/i.test(src); const img = $('lb-img'), v = $('lb-vid'); img.hidden = vid; v.hidden = !vid; if (vid) { img.removeAttribute('src'); v.src = src; v.play().catch(() => {}); } else { v.pause(); v.removeAttribute('src'); img.src = src; } $('lb-bd').classList.add('open'); $('lb').classList.add('open'); document.body.style.overflow = 'hidden'; }
function closeLb(){ const v = $('lb-vid'); v.pause(); v.removeAttribute('src'); $('lb-bd').classList.remove('open'); $('lb').classList.remove('open'); document.body.style.overflow = ''; }
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('lb').classList.contains('open')) closeLb(); });
"""

SECTIONS = f"""
  <section class="panel" id="s1" data-section="01">
    <div>
      <div class="eyebrow">Over Two Decades &middot; Quiet &middot; Deliberate</div>
      <h1 class="mega"><span class="gold">Details</span> <span class="white">Matter</span></h1>
      <p class="sub">Trusted by DEA, Houston SWAT, US Military, and Homeland Security. No fluff. No shortcuts. No compromise.</p>
      <div class="ctas rise"><a href="#s6" class="cta" onclick="openDCal();return false;">Book a Class</a><a href="#s5" class="secondary-cta">Enter The Range</a></div>   <!-- owner, 2026-09-05: "Swap Enter the Range to Book a Class; click = calendar open" -->
    </div>
    <div class="scroll-cue">SCROLL &darr;</div>
  </section>

  <section class="panel" id="s2" data-section="02">
    <div>
      <div class="eyebrow">Est. 2005 &middot; Houston, TX</div>
      <h2 class="section-h">Trained to <span class="gold">Standard.</span></h2>
      <p class="sub">No paint-ball courses dressed up as tactics. No cinema instructors. Real-world doctrine, changing TTPs, evolving tactics proven in real-world environments.</p>
      <div class="stats rise">
        <div class="stat"><div class="stat-num" data-count="1701" data-suffix="+">0</div><div class="stat-label">Students Trained</div></div>
        <div class="stat"><div class="stat-num" data-count="22">0</div><div class="stat-label">Classes</div></div>
        <div class="stat"><div class="stat-num" data-count="20" data-suffix="+">0</div><div class="stat-label">Years &middot; Over Two Decades</div></div>
      </div>
    </div>
  </section>

  <section class="panel" id="s3" data-section="03">
    <div>
      <div class="eyebrow">Who Trains Here</div>
      <h2 class="section-h">Federal. <span class="gold">SWAT.</span> Military.</h2>
      <p class="sub">We train the operators who cannot be wrong. Federal agents, tier-1 law enforcement, military units, and private citizens who understand the difference between security and a show.</p>
      <div class="chips rise">
        <span class="chip">U.S. Military</span><span class="chip">DEA</span><span class="chip">Houston SWAT</span><span class="chip">Homeland Security</span>
        <span class="chip">Border Patrol</span><span class="chip">NASA SRT</span><span class="chip">Harris County DPU</span><span class="chip">Federal Agencies</span>
      </div>
      <div class="tiles">
        {tile('01', 'Military.', 'Special operations and conventional units. Live OpFor, UTM and Simunition, maritime VBSS.', 'who-military.jpg', 'center 30%')}
        {tile('02', 'Law Enforcement.', 'SWAT, warrant teams and federal agencies. Small-unit tactics under time pressure.', 'who-law-enforcement.jpg')}
        {tile('03', 'Civilian.', 'Private citizens who take the preservation of life seriously. Same standard, scaled.', 'who-civilian.jpg', 'left 40%')}
      </div>
    </div>
  </section>

  <section class="panel" id="s4" data-section="04">
    <div>
      <div class="eyebrow">The Curriculum</div>
      <h2 class="section-h">Seven Core <span class="gold">Disciplines.</span></h2>
      <p class="sub">Every course sits inside one of seven disciplines. Master the fundamentals of each, then bring them together under pressure.</p>
      <div class="tiles four">
        {tile('01', 'Firearms.', 'Marksmanship and weapon handling.', 'disc-firearms.jpg')}
        {tile('02', 'Hand Combat.', 'Close-quarters fighting.', 'disc-hand-combat.jpg')}
        {tile('03', 'Knife Combat.', 'Defensive and tactical knife.', 'disc-knife-combat.jpg')}
        {tile('04', 'CQB.', 'Close Quarters Battle.', 'disc-cqb.jpg')}
        {tile('05', 'Fitness.', 'Conditioning for duty.', 'disc-fitness.jpg', 'center 60%')}
        {tile('06', 'Medical.', 'Emergency and trauma care.', 'disc-medical.jpg')}
        {tile('07', 'Leadership.', 'Command and decision-making.', 'disc-leadership.jpg', 'center 40%')}
      </div>
    </div>
  </section>

{RANGE_SECTION}
  <section class="panel" id="s6" data-section="06">
    <div>
      <div class="eyebrow">Course Catalog</div>
      <h2 class="section-h">The <span class="gold">Classes.</span></h2>
      <p class="sub">Open a discipline, pick a course, pick your weekend. <b style="color:#F0F4FF;">Fundamentals first, unless you have taken it before. Each discipline&rsquo;s Fundamentals course opens its other courses, and Select Date asks before the calendar opens.</b> P2 follows P1. Private instruction by arrangement. Ammunition, rentals and UTM rounds are added later.</p>
      <div class="catalog-wrap rise"><div class="glass"><div class="catalog-panel" id="catalog"></div></div>
      <p class="catalog-note">Team blocks and agency instruction: <a href="tel:+12816548100">(281) 654-8100</a> &middot; <a href="mailto:atlasglinn.hq@atlasglinn.com">atlasglinn.hq@atlasglinn.com</a></p></div>
    </div>
  </section>

{MEMBERSHIP}
  <section class="panel" id="s8" data-section="08">
    <div>
      <div class="eyebrow">Instructors</div>
      <h2 class="section-h">Meet The <span class="gold">Team.</span></h2>
      <div class="founder rise">
        <div class="portrait" style="background-image:url('images/mast/brockmann-instructor.jpg');background-size:auto 118%;background-position:64% 22%"><div class="cap">Founder &amp; Lead Instructor</div></div><!-- the photographer's mark sits in the bottom-right corner of the file; the crop keeps it out of frame -->
        <div class="bio">
          <h3>Matthew Brockmann</h3><div class="role">Founder &amp; Lead Instructor</div>
          <p>Founded MAST Solutions in 2005 and later Atlas Glinn, LLC. Former Head of Security, Sen. Ted Cruz; security for U.S. Senators Josh Hawley and Eric &ldquo;Bulldog&rdquo; Schmitt, a former Vice President, and Ivanka Trump, named as media exist. Other high-profile and high-net-worth individuals follow our privacy standards. We don&rsquo;t do media. Names appear only where the media captured them. Teaches on the range. Has trained Houston, Baytown, Galveston, and other SWAT teams, including TTPOA (TX Tactical Police Officers Association), VBSS (Visit, Board, Search, Seize), NASA SRT, Dept of Homeland Security, and other federal, state, and Military Units.</p>
          <ul class="creds">
            <li>Trained by <b>Paul Howe</b> (1st SFOD-D), <b>Bill Jeans</b> and <b>John Perretti</b></li>
            <li><b>DPS Level III Firearms Instructor</b> &middot; <b>12+ certified instructor programs</b> &middot; <b>TTPOA Maritime VBSS</b> instructor</li>
            <li>Law Enforcement Instructor, <b>Harris County Diplomatic Protection Unit</b></li>
            <li><b>Chief Training Officer</b> certification co-signed by the Chief of the <b>Texas Rangers</b> (Ret.)</li>
            <li>Featured on <b>Modern Shooter TV</b>, in <b>The Washington Post</b> and <b>The Houstonian</b></li>
          </ul>
          <p class="cadre">Courses run with a lead instructor, assistant instructors, and RSOs (Range Safety Officers) on the line. Your instructors are named on the course confirmation.</p>
          <div class="ctas"><button class="cta-button ghost-button" type="button" onclick="openQuals()">Qualifications &amp; Certifications</button><a href="#s6" class="cta-button">Classes</a></div>
        </div>
      </div>
      <!-- Instructors = the founder only (owner, 2026-09-05: "Just me right now = instructor + correct pic"). The Michael Cline and
           Torrey Kramer team blocks that stood here (2026-09-04 format "Look at how ATLASGLINN list and emulate") are out until he
           names the cadre again; Kramer's documentary stays on the In Action strip. -->
      <div class="media-strip rise" id="instructor-strip"></div>
      <div class="cert rise">
        <img src="images/mast/capitol-flag-certificate.jpg" alt="Certificate: a flag flown over the United States Capitol in honor of Matthew Brockmann, at the request of Senator Ted Cruz, December 1, 2021" loading="lazy">
        <p>A flag flown over the United States Capitol at the request of Senator Ted Cruz, December 1, 2021, &ldquo;with gratitude for your steadfast vigilance, unwavering dedication, and heart of service.&rdquo; The task force is not named here. Details matter. Privacy matters.</p>
      </div>
    </div>
  </section>

  <section class="panel" id="s9" data-section="09">
    <div>
      <div class="eyebrow">MAST Solutions In Action</div>
      <h2 class="section-h">In <span class="gold">Action.</span></h2>
      <p class="sub">Training, operations, and the people behind the mission. Tap to play. Nothing loads until you do.</p>
      <a href="https://www.washingtonpost.com/graphics/2018/national/amp-stories/arming-american-teachers/" target="_blank" rel="noopener" class="post rise"><small>As featured in</small>The Washington Post &middot; Arming American Teachers &rarr;</a>
      <!-- The Washington Post feature sits above the films (owner, 2026-09-05: "the videos will draw attention, so put it right above the videos") -->
      <div class="media-strip rise" id="media-strip"></div>
      <div class="eyebrow gallery-eyebrow rise">Photographs</div>
      {fold_button('gallery-fold', 'Click to View', 'Click to Close')}
      <div class="fold" id="gallery-fold">{photo_grid('gallery-tiles', GALLERY_PHOTOS)}</div>
    </div>
  </section>

  <section class="panel" id="s10" data-section="10">
    <div>
      <div class="eyebrow">Testimonials</div>
      <h2 class="section-h">In Their <span class="gold">Words.</span></h2>
      <div class="media-strip rise" id="testimonial-strip"></div>
      <div class="quotes rise">
        <div class="q"><p>&ldquo;Matthew is an expert in his field. He is highly motivated, knowledgeable and I highly recommend him for top-tier performance.&rdquo;</p><div class="by">Kenny Upton &middot; Deputy, Harris County Sheriff</div></div>
        <div class="q"><p>&ldquo;His leadership, dedication, drive, and passion is second to none. A master at teamwork, problem-solving, leadership, and communication.&rdquo;</p><div class="by">Ray Cash Care &middot; Navy SEAL / Former CIA</div></div>
        <div class="q"><p>&ldquo;As a former Reconnaissance Marine, Matthew&rsquo;s teaching has not only made me a better shooter, he has made me a better team player.&rdquo;</p><div class="by">Arthur Metcalfe &middot; Recon Marine</div></div>
        <div class="q"><p>&ldquo;Brockmann had hosted and taught some of the best classes I have been a part of. I can&rsquo;t recommend him enough.&rdquo;</p><div class="by">William H. Miller &middot; Flight Paramedic</div></div>
        <div class="q"><p>&ldquo;Extremely professional. In an extremely competitive industry Matt has never failed to provide exceptional guidance. I recommend him without hesitation.&rdquo;</p><div class="by">Craig Etkin &middot; President &amp; CEO, intelligence360</div></div>
        <div class="q"><p>&ldquo;I&rsquo;ve trained with some big-name national and global self-defense trainers. I&rsquo;ve always felt safe training with Matt, the #1 criterion for choosing a trainer.&rdquo;</p><div class="by">Wayne Sadin &middot; CxO / Investor</div></div>
      </div>
    </div>
  </section>

  <section class="panel" id="s11" data-section="11">
    <div>
      <div class="badge">Privacy Matters</div>
      <p class="sub quote lead">&ldquo;Details matter. Privacy matters. We don&rsquo;t disclose.&rdquo;</p>
      <p class="sub" style="font-size:.98rem;">Former Head of Security, Sen. Ted Cruz; security for U.S. Senators Josh Hawley and Eric &ldquo;Bulldog&rdquo; Schmitt, a former Vice President, and Ivanka Trump, named as media exist. Other high-profile and high-net-worth individuals follow our privacy standards. We don&rsquo;t do media. Names appear only where the media captured them.</p>
      <div class="cert rise">
        <img src="images/mast/privacy-aircraft.jpg" alt="U.S. Senators Josh Hawley and Eric Schmitt aboard an aircraft, seen through the cabin windows" loading="lazy">
        <p>Pictured: Senators Hawley and Schmitt.</p>
      </div>
      <div class="eyebrow" style="margin-top:2.5rem;">For agencies, units and procurement officers</div>
      <div class="ctas rise"><a href="mailto:matthew@atlasglinn.com?subject=MAST%20Solutions%20Capability%20Statement%20Request" class="cta">Email for the Capability Statement</a><a href="mast-capability-statement.html" class="secondary-cta">View One-Pager</a></div>
    </div>
  </section>

  <section class="panel" id="s12" data-section="12">
    <div>
      <div class="eyebrow">Gear &middot; Aimpoint and IWA</div>
      <h2 class="section-h">Equipment. <span class="gold">By Quote.</span></h2>
      <p class="sub">Atlas Glinn is an authorized dealer for Aimpoint optics and IWA International devices. Every item below is quoted, not sold from a cart: Aimpoint optics ship to verified customers at dealer pricing on request; IWA devices go to law enforcement, military and licensed agencies only, and agency verification comes before any quote. Nothing is charged online.</p>
      <div class="gear-panel rise" id="gear-panel"></div>
      <p class="gate-fine" style="max-width:820px;margin:1.6rem auto 0;">Special order. Tell us the item and quantity; we confirm availability, price, hazmat and shipping by email within one business day.</p>
    </div>
  </section>

  <section class="panel" id="s13" data-section="13">
    <div>
      <div class="eyebrow">Book a Course</div>
      <h2 class="section-h"><span class="gold">Train</span> with MAST.</h2>
      <p class="sub">Individual seats, team blocks, and agency instruction.</p>
      <div class="contact-lines rise">2450 Fondren Rd, Suite 255 &middot; Houston, TX 77063<br><a href="tel:+12816548100">(281) 654-8100</a> &middot; <a href="mailto:atlasglinn.hq@atlasglinn.com">atlasglinn.hq@atlasglinn.com</a></div>
      <div class="ctas rise"><a href="#s6" class="cta" onclick="openDCal();return false;">Book a Class</a><a href="/" class="secondary-cta">Atlas Glinn &rarr;</a></div>
      <div class="foot">&copy; 2026 Atlas Glinn, LLC &middot; MAST Solutions <br><a href="privacy.html">Privacy Policy</a>&middot;<a href="terms.html">Terms of Service</a>&middot;<a href="https://www.instagram.com/atlasglinn_mastsolutions/" target="_blank" rel="noopener">Instagram</a>&middot;<a href="https://www.youtube.com/@mastsolutions" target="_blank" rel="noopener">YouTube</a></div>
    </div>
  </section>

"""


JOIN_MODAL = """
<!-- MEMBERSHIP JOIN: name + email, then Stripe Checkout in subscription mode through the Worker (POST /create-membership) -->
<div id="join-bd" class="modal-bd" onclick="closeJoin()"></div>
<div id="join" class="modal gate join" role="dialog" aria-modal="true" aria-labelledby="join-title">
    <button class="modal-x" aria-label="Close" onclick="closeJoin()">&times;</button>
    <div class="eyebrow">Membership</div>
    <h3 id="join-title"></h3>
    <div class="modal-meta" id="join-meta"></div>
    <p class="join-inc" id="join-inc"></p>
    <label class="join-field">Name<input id="join-name" type="text" autocomplete="name"></label>
    <label class="join-field">Email<input id="join-email" type="email" autocomplete="email" required></label>
    <label class="join-field join-cred" id="join-cred-wrap" hidden>Photo of your credentials<input id="join-cred" type="file" accept="image/*,.pdf,.heic"><span class="join-cred-note">Badge and ID, or school ID. Up to 8 MB. It goes to the team by email for verification and nowhere else.</span></label>
    <div class="gate-actions"><button class="cta-button" id="join-go" type="button" onclick="joinGo()">Continue to Stripe</button></div>
    <p class="gate-fine" id="join-fine">Billed monthly by card through Stripe. New memberships are vetted by the established team; a membership the team declines is refunded.</p>
    <p class="join-err" id="join-err" role="alert"></p>
</div>
"""
JOIN_JS = """
/* Membership join (owner, 2026-09-04): Join opens a short dialog for name and email, then Stripe Checkout in subscription mode via
   POST /create-membership; the Worker provisions the plan's Stripe Price on first use. A failure offers the email route. */
let joinPlan = null;
const CRED_PLANS = { le_team: 'Law Enforcement', teachers_team: 'Verified Teachers' };   // plans that need a credential photograph at Join
function joinTeam(key, name, fee, includes){ joinPlan = key; const cred = !!CRED_PLANS[key]; $('join-cred-wrap').hidden = !cred; if (cred) $('join-cred').value = ''; $('join-title').textContent = name; $('join-meta').textContent = fee + ' per month'; $('join-inc').textContent = includes || ''; $('join-err').textContent = ''; const b = $('join-go'); b.disabled = false; b.textContent = 'Continue to Stripe'; $('join-bd').classList.add('open'); $('join').classList.add('open'); document.body.style.overflow = 'hidden'; setTimeout(() => $('join-email').focus(), 150); }
function closeJoin(){ $('join-bd').classList.remove('open'); $('join').classList.remove('open'); document.body.style.overflow = ''; }
async function joinGo(){
  const email = $('join-email').value.trim(), name = $('join-name').value.trim();
  if (!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(email)) { $('join-err').textContent = 'Enter the email address for your membership.'; $('join-email').focus(); return; }
  let credential = null;
  if (CRED_PLANS[joinPlan]) {
    const f = $('join-cred').files && $('join-cred').files[0];
    if (!f) { $('join-err').textContent = CRED_PLANS[joinPlan] + ' membership needs a photo of your credentials before checkout.'; $('join-cred').focus(); return; }
    if (f.size > 8 * 1024 * 1024) { $('join-err').textContent = 'That file is over 8 MB. A phone photo of the credential is enough.'; return; }
    const data = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = () => no(new Error('read')); r.readAsDataURL(f); }).catch(() => '');
    if (!data) { $('join-err').textContent = 'Could not read that file. Try a photo or a PDF.'; return; }
    credential = { filename: f.name || 'credential', content_type: f.type || 'application/octet-stream', data };
  }
  const btn = $('join-go'); btn.disabled = true; btn.textContent = 'One moment\u2026'; const base = location.origin + location.pathname;
  try {
    const res = await fetch(API + '/create-membership', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, plan: joinPlan, customer_name: name, credential, successUrl: base + '?membership=success', cancelUrl: base + '?membership=cancelled' }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.checkoutUrl) throw new Error(data.error || 'Could not start checkout.');
    location.href = data.checkoutUrl;
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Continue to Stripe';
    $('join-err').innerHTML = esc(e.message) + ' Or apply by email: <a href="mailto:matthew@atlasglinn.com?subject=' + encodeURIComponent('MAST Membership \u2014 ' + $('join-title').textContent) + '">matthew@atlasglinn.com</a>';
  }
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('join').classList.contains('open')) closeJoin(); });
(function(){ const p = new URLSearchParams(location.search); const s = p.get('membership'); if (!s) return; const b = $('banner'); b.textContent = s === 'success' ? 'Welcome to the team \u2014 your membership is set up. The team will be in touch.' : 'Membership checkout cancelled \u2014 your card was not charged.'; b.classList.add('show'); setTimeout(() => b.classList.remove('show'), 9000); history.replaceState(null, '', location.pathname); })();
"""

BODY = '\n' + CHROME + '\n' + banner + '\n\n<div class="content">\n' + SECTIONS + '</div>\n\n' + modals + JOIN_MODAL + LIGHTBOX + '\n'
js = js + JOIN_JS + LIGHTBOX_JS

META = """<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,600;0,700;1,500&display=swap">
<title>MAST Solutions | Details Matter | Tactical Training, Houston TX</title>
<meta name="description" content="MAST Solutions, the training division of Atlas Glinn. Firearms, CQB, combatives, medical and leadership training in Houston since 2005. Twenty-one courses, training weekends on the calendar, book online.">
<meta name="keywords" content="MAST Solutions, tactical training Houston, firearms training Houston TX, carbine course, select-fire training, NVG course, CQB course, team tactics, Atlas Glinn training, Matthew Brockmann">
<link rel="canonical" href="https://atlasglinn.com/mastsolutions.html">
<meta property="og:title" content="MAST Solutions | Details Matter | Tactical Training, Houston TX">
<meta property="og:description" content="Twenty-one courses, one standard. Firearms through select-fire and night vision, CQB, combatives, medical, leadership. Houston, Texas since 2005. Book a weekend online.">
<meta property="og:image" content="https://atlasglinn.com/images/mast/hero-casualty-carry.jpg">
<meta property="og:type" content="website">
<meta property="og:url" content="https://atlasglinn.com/mastsolutions.html">
<meta name="twitter:card" content="summary_large_image">
<meta name="robots" content="index, follow">
<meta name="author" content="Atlas Glinn, LLC">
<meta name="theme-color" content="#050810">
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  "name": "MAST Solutions",
  "description": "Tactical training division of Atlas Glinn, LLC. Firearms, CQB, combatives, medical, leadership, low-light and protective courses for military, law enforcement and private citizens. Houston, Texas since 2005.",
  "parentOrganization": { "@type": "Organization", "name": "Atlas Glinn, LLC", "url": "https://atlasglinn.com/" },
  "founder": { "@type": "Person", "name": "Matthew Brockmann", "jobTitle": "Founder", "url": "https://atlasglinn.com/about.html" },
  "foundingDate": "2005",
  "image": "https://atlasglinn.com/images/mast/hero-casualty-carry.jpg",
  "address": { "@type": "PostalAddress", "streetAddress": "2450 Fondren Rd, Suite 255", "addressLocality": "Houston", "addressRegion": "TX", "postalCode": "77063", "addressCountry": "US" },
  "telephone": "+1-281-654-8100",
  "url": "https://atlasglinn.com/mastsolutions.html",
  "sameAs": [
    "https://www.instagram.com/atlasglinn_mastsolutions/",
    "https://www.linkedin.com/in/mastsolutions1/",
    "https://www.facebook.com/mastsolutions",
    "https://www.youtube.com/@mastsolutions"
  ]
}
</script>
"""

# Six client testimonials (chapter 08) carried over from the earlier builds; they were dropped in the cinematic cut without an instruction.
QUOTES_CSS = """
  .tile.photo .txt { padding:1rem 1.1rem; }
  .tile.photo.clip .bg { background-color:#0B1221; }   /* a clip without a poster still reads as a tile; the play mark sits in the number */
  .photo-tiles .tile.more { display:none; }
  .photo-tiles.all .tile.more { display:flex; }
  .gallery-eyebrow { margin-top:2.6rem; }
  #s9 .post { margin-top:.2rem; margin-bottom:1.8rem; }
  .modal.lightbox video { display:block; max-width:100%; max-height:82vh; margin:0 auto; background:#000; }   /* above the films (owner, 2026-09-05) */
  /* Preview-only menu entries (the Blogs link under In Action): hidden until the URL carries `preview`. Styled as the chapter menu, indented. */
  .chap-extra { display:none; color:var(--text); font-weight:700; text-shadow:0 1px 10px rgba(0,0,0,.9); text-decoration:none; letter-spacing:.25em; padding:.2rem .8rem .2rem 2.6rem; font-size:.58rem; text-transform:uppercase; align-items:center; gap:.6rem; cursor:none; }
  .chap-extra:hover { color:var(--gold-champagne); }
  body.preview .chap-extra { display:flex; }
  .chap-extra.chap-always { display:flex; margin-top:.5rem; padding-left:.8rem; color:var(--gold-champagne); }
  /* The account link in the HUD's top-right corner (the section counter sits left of the chapter menu). */
  .hud.acct { top:1.2rem; right:1.8rem; color:var(--gold-champagne); opacity:.9; pointer-events:auto; cursor:pointer; text-decoration:none; padding:.3rem .6rem; border:1px solid rgba(201,168,76,.35); }
  .hud.acct:hover { opacity:1; background:rgba(201,168,76,.06); }
  @media (max-width:768px) { .hud.acct { display:block; top:.9rem; right:1rem; font-size:.55rem; } }
  /* Folded photo grids: closed until the button opens them, then they unfold downward. The padding keeps the tiles' hover lift clear of the clip. */
  .fold { max-height:0; overflow:hidden; opacity:0; padding:10px 10px 0; margin:-10px -10px 0; transition:max-height .8s cubic-bezier(.2,.7,.2,1), opacity .45s; }
  .fold.open { max-height:6000px; opacity:1; padding-bottom:12px; transition:max-height 1.2s cubic-bezier(.2,.7,.2,1), opacity .5s .1s; }
  /* The contact chapter's line over the water backdrop (owner, 2026-09-05: "Fix the visibility of the contact"); the contact lines themselves are handled in the shell for both sites. */
  #s13 .sub { text-shadow:0 1px 6px rgba(0,0,0,.9), 0 0 18px rgba(0,0,0,.6); }   /* the Contact chapter (13 since the Gear chapter, 2026-09-05) */
  .modal.lightbox { width:min(1200px, calc(100vw - 32px)); padding:.6rem; background:#050810; }
  .modal.lightbox img { display:block; max-width:100%; max-height:84vh; margin:0 auto; }

  .quotes { display:grid; grid-template-columns:repeat(3,1fr); gap:1.1rem; max-width:1200px; margin:0 auto; text-align:left; }
  .quotes .q { border:1px solid rgba(201,168,76,.22); background:linear-gradient(180deg, rgba(30,42,58,.5) 0%, rgba(11,18,33,.7) 100%); padding:1.4rem 1.5rem; }
  .quotes .q p { font-style:italic; color:var(--text); line-height:1.55; font-size:1rem; font-weight:300; }
  .quotes .q .by { margin-top:.8rem; font-family:'Share Tech Mono',monospace; font-size:.65rem; letter-spacing:.25em; color:var(--gold-champagne); text-transform:uppercase; }
  @media (max-width:900px) { .quotes { grid-template-columns:1fr 1fr; } }
  @media (max-width:768px) { .quotes { grid-template-columns:1fr; } }
"""
# Palette: Atlas blue for MAST as well (Brockmann, 2026-09-04: "Use the blue like the Atlas Glinn intro. I think it looks
# better than MAST Solutions gold"). The shell, the lifted booking styles, the scene and any gold literal left in the
# markup or booking JS all go through the same token map.
# Palette (Brockmann, 2026-09-04): the page is Atlas blue ("blue is a color that is more trusted ... consistent where it
# matters"), and the MAST gold stays where he named it: the hero wordmark ("This stays gold. shimmer as it was."), the class
# selections ("keep the class selections in gold": the catalog chapter, the calendar and the registration sheet) and the
# chapter menu ("gold ... bold + should be accented"). The intro splash keeps the blue wordmark "as it was"; the gold that
# comes in there is the shell's sparkle ring from the Atlas Glinn intro, fading in and out. The booking CSS is spliced in
# after the recolor so its gold literals survive, and the gold containers re-declare the gold tokens; everything else on
# the page recolors to blue.
PALETTE = shell.ATLAS
GOLD_KEEP = """
  #s6, #s7, .sheet, .sheet-bd, .modal, .modal-bd { --gold:#C9A84C; --gold-antique:#D4AF37; --gold-champagne:#E8D27D; --gold-bright:#FCF6BA; --copper:#B87333; }
  #s6 .gold, #s7 .gold { background:linear-gradient(135deg, #BF953F 0%, #FCF6BA 50%, #B38728 100%); -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; }
  /* The live atlasglinn.com hero, verbatim (owner, 2026-09-04: "Grab the code from Atlas Glinn. Apply same font size and same code"):
     .hero-headline metrics, the .gold-shimmer rule on "Details", flat #1A6BDE on "Matter", no entrance effect. */
  h1.mega { font-family:'Orbitron',sans-serif; font-size:3.2rem; font-weight:900; margin-bottom:1rem; letter-spacing:.02em; line-height:1.1; opacity:1; filter:none; transform:none; transition:none; }
  h1.mega .gold { background:linear-gradient(90deg, #BF953F 0%, #FCF6BA 25%, #B38728 50%, #FBF5B7 75%, #AA771C 100%); background-size:1000px 100%; animation:shimmer 6s linear infinite; -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text; text-shadow:none; }
  h1.mega .white { color:#1A6BDE; }
  h2.section-h { font-size:3.2rem; }   /* every chapter heading at the hero's size (owner: "same font size for every section below") */
  @media (max-width:768px) { h1.mega, h2.section-h { font-size:2rem; } }
  @media (max-width:480px) { h1.mega, h2.section-h { font-size:1.8rem; } }
  @media (prefers-reduced-motion: reduce) { h1.mega .gold { animation:none; } }
  #s6 .cta-button, #s6 .cta, #s7 .cta-button, .sheet .cta-button, .modal .cta-button { background:linear-gradient(135deg, #BF953F 0%, #FCF6BA 50%, #B38728 100%); border-color:#E8D27D; }
  #s6 .cta-button:hover, #s6 .cta:hover, #s7 .cta-button:hover, .sheet .cta-button:hover, .modal .cta-button:hover { box-shadow:0 14px 44px rgba(201,168,76,.5); }
  #s5 .cta-button.ghost-button, .sheet .cta-button.ghost-button, .modal .cta-button.ghost-button { background:transparent; }
  /* Splash wordmark (owner, 2026-09-04: "Use this font for the splash intro. But space correctly." — the HUD's monospace — then
     "MAST Solutions", "Strong Font"): Share Tech Mono in a strong weight, mixed case, tracked and optically centred (the leading
     padding balances the tracking after the last letter). The blue shimmer stays. */
  .intro-credit.wordmark { font-family:'Orbitron',sans-serif; font-weight:900; text-transform:none; letter-spacing:.16em; padding-left:.16em; word-spacing:0; font-size:clamp(2rem, 6.5vw, 4.6rem); text-shadow:0 0 30px rgba(26,107,222,.35); }   /* 2026-09-05: "Keep this font for the splash opener - need the consistency" — the hero's Orbitron, as Details Matter */
  .chap-link { color:#E8D27D; }
  .chap-link::before { background:#C9A84C; }
  .chap-link:hover, .chap-link.active { color:#FCF6BA; border-color:rgba(201,168,76,.5); background:rgba(201,168,76,.06); }
  .chap-link.active::before, .chap-link:hover::before { background:#FCF6BA; }
  /* Membership tiles: the seven-skills tile (shell .tile / .tiles.four, shared hover) in the team colour — border, top rule and a wash
     behind the text (owner, 2026-09-04: "the cards should match the seven skills ... not only in function, but in size"). The benefit line
     shows on hover / focus; a tap opens the join dialog. */
  .team-tile { --tc:#C9A84C; border-color:color-mix(in srgb, var(--tc) 72%, transparent); cursor:pointer; }
  .team-tile:hover, .team-tile:focus-visible { border-color:var(--tc); box-shadow:0 22px 60px rgba(0,0,0,.5), 0 0 0 1px var(--tc); outline:none; }
  .team-tile .bg { background:radial-gradient(120% 90% at 22% 18%, color-mix(in srgb, var(--tc) 38%, #050810) 0%, #050810 72%); }
  .team-tile::before { content:''; position:absolute; top:0; left:1.3rem; right:1.3rem; height:2px; background:var(--tc); z-index:2; }
  .team-tile .num { color:var(--gold-champagne); }
  .team-tile h3 { font-family:'Cormorant Garamond',Georgia,serif; font-weight:600; font-size:1.55rem; letter-spacing:.06em; }
  .team-tile p { font-family:'Cormorant Garamond',Georgia,serif; font-size:1.08rem; line-height:1.4; color:var(--text); max-height:0; opacity:0; overflow:hidden; transition:max-height .45s, opacity .45s, margin .45s; margin-top:0; }
  .team-tile:hover p, .team-tile:focus-visible p, .team-tile:focus-within p { max-height:6rem; opacity:1; margin-top:.35rem; }
  .team-tile.t-red { --tc:#7A0F14; } .team-tile.t-blue { --tc:#1A6BDE; } .team-tile.t-gold { --tc:#C9A84C; } .team-tile.t-black { --tc:#F0F4FF; } .team-tile.t-le { --tc:#3A4A5C; } .team-tile.t-teachers { --tc:#CFE2FF; }
  .teams-note { font-family:'Cormorant Garamond',Georgia,serif; font-style:italic; font-size:1.05rem; color:#8B95A8; max-width:760px; margin:1.2rem auto 0; text-align:center; }
  .modal.join .join-inc { font-family:'Cormorant Garamond',Georgia,serif; font-size:1.1rem; line-height:1.45; color:#F0F4FF; margin:.6rem 0 0; }
  .modal.join .join-field { display:block; font-family:'Share Tech Mono',monospace; font-size:.66rem; letter-spacing:.25em; text-transform:uppercase; color:#8B95A8; margin:.9rem 0 0; }
  .modal.join input { display:block; width:100%; margin-top:.35rem; padding:.8rem .9rem; background:#0B1221; border:1px solid rgba(201,168,76,.35); color:#F0F4FF; font:1rem 'Rajdhani',sans-serif; letter-spacing:.02em; }
  .modal.join input:focus { outline:none; border-color:#C9A84C; }
  .modal.join input[type=file] { padding:.6rem .7rem; font-size:.9rem; color:#8B95A8; }
  .modal.join .join-cred-note { display:block; margin-top:.4rem; font-family:'Rajdhani',sans-serif; font-size:.85rem; letter-spacing:.02em; text-transform:none; color:#8B95A8; line-height:1.4; }
  .modal.join .gate-actions { margin-top:1.3rem; }
  .modal.join .join-err { color:#ff8a80; font-size:.9rem; line-height:1.45; margin-top:.8rem; min-height:1.2em; }
  .modal.join .join-err a { color:#E8D27D; }
  @media (max-width:900px) { .teams { grid-template-columns:1fr 1fr; } }
  @media (max-width:600px) { .teams { grid-template-columns:1fr; } .tier-fee { font-size:2.2rem; } }
"""
html = shell.head(META, shell.css(PALETTE, '/*__BOOKING_CSS__*/' + QUOTES_CSS)) + BODY + shell.tail(shell.three(12, PALETTE), js)
# The video cards and the media strip are shared UI in the blue chapters, so those lifted rules recolor with the page.
booking_css_kept = '\n'.join(shell._recolor(l, PALETTE) if l.lstrip().startswith(('.video-card', '.yt', '.media-strip')) else l for l in booking_css.splitlines())
html = shell._recolor(html, PALETTE).replace('/*__BOOKING_CSS__*/', booking_css_kept + GOLD_KEEP, 1)
assert html.count('__BOOKING_CSS__') == 0 and '.cat-btn {' in html and 'h1.mega .gold { text-shadow' in html, 'booking css / gold keep not spliced'

# Brockmann picked this design as the page that ships (2026-09-03), so the assembler writes the production
# mastsolutions.html. The Atlas-frame build lives on as mastsolutions-atlas.html; the old cinematic URL is a stub redirect.
out = f'{REPO}/mastsolutions.html'
open(out, 'w', encoding='utf-8').write(html)
print('wrote', out, len(html.encode('utf-8')), 'bytes')
