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
        '.sheet', 'label', 'input', '.qty', '.total', '.secure', '.err', '.quals', '.banner', '.legend', '.reg-', '.policy')
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
# replace the MEDIA array with the curated set (local clips first, then the two YouTube films that are verifiably MAST)
media = """const MEDIA = [
  { mp4: 'images/mast/jason-castro-testimonial.mp4', poster: 'images/mast/jason-castro-testimonial-poster.jpg', title: 'Jason Castro', sub: 'Student testimonial' },
  { mp4: 'images/mast/mast-vid-1.mp4', poster: 'images/mast/mast-vid-1-poster.jpg', title: 'MAST Solutions', sub: 'On the range' },
  { mp4: 'images/mast/mast-vid-2.mp4', poster: 'images/mast/mast-vid-2-poster.jpg', title: 'MAST Solutions', sub: 'Training day' },
  { mp4: 'images/mast/mast-medical.mp4', poster: 'images/mast/mast-medical-poster.jpg', title: 'Medical', sub: 'Tourniquet under pressure' },
  { mp4: 'images/mast/mast-shotgun.mp4', poster: 'images/mast/mast-shotgun-poster.jpg', title: 'Shotgun', sub: 'Breaching and patterning' },
  { mp4: 'images/mast/forge-ignition-orlando.mp4', poster: 'images/mast/forge-ignition-orlando-poster.jpg', title: 'Forge Ignition', sub: 'Orlando' },
  { yt: 'pSGWdaDglZE', title: 'Modern Shooter TV', sub: 'Lance M / Castro / Ray Cash — MAST Solutions' },
  { yt: 'jwQ5OyKEKwg', title: 'Training Reel', sub: 'The film behind the Training page' },
];
"""
js = re.sub(r"const MEDIA = \[[\s\S]*?\n\];\n", media, js, count=1)
assert 'function openCal' in js and 'function startCheckout' in js and "const host = $('media-strip')" in js, 'booking js missing pieces'
assert 'hero-yt' not in js and 'REVIEWS' not in js, 'hero/reviews code leaked into booking js'

# ── 4. Page ──
def tile(num, title, body, img, pos='center'):
    return shell.tile(num, title, body, 'images/mast/' + img, pos)

CHROME = shell.chrome(
    credits=('A Houston Operation', 'Since 2005'), wordmark='MAST SOLUTIONS',
    photos=[('01', 'images/mast/hero-casualty-carry.jpg', 'center 40%'), ('02', 'images/mast/disc-firearms.jpg', None),
            ('03', 'images/mast/ship-deck-movement.jpg', None), ('04', 'images/mast/disc-cqb.jpg', None),
            ('05', 'images/mast/courses-low-light.jpg', None), ('06', 'images/mast/founder-ship.jpg', 'center 20%'),
            ('07', 'images/mast/vehicular.jpg', None), ('08', 'images/mast/privacy-aircraft.jpg', None),
            ('09', 'images/mast/contact-zodiac.jpg', None)],
    hud_tl='&#9679; ATLAS GLINN &middot; MAST.SYS LIVE', hud_tl_href='index.html',
    hud_bl='HOU &middot; 29.7604&deg;N &middot; 95.3698&deg;W', hud_br='DETAILS MATTER',
    chapters=[('s1', '01 &middot; Opening'), ('s2', '02 &middot; Standard'), ('s3', '03 &middot; Who'), ('s4', '04 &middot; Disciplines'),
              ('s5', '05 &middot; Courses'), ('s6', '06 &middot; Instructors'), ('s7', '07 &middot; In Action'),
              ('s8', '08 &middot; Privacy'), ('s9', '09 &middot; Contact')])

SECTIONS = f"""
  <section class="panel" id="s1" data-section="01">
    <div>
      <div class="eyebrow">34 Years &middot; Quiet &middot; Deliberate</div>
      <h1 class="mega"><span class="gold">Details</span> <span class="white">Matter.</span></h1>
      <p class="sub">Trusted by DEA, Houston SWAT, US Military, and Homeland Security. No fluff. No shortcuts. No compromise.</p>
      <div class="ctas rise"><a href="#s5" class="cta">Enter The Range</a><a href="#s6" class="secondary-cta">The Instructors</a></div>
    </div>
    <div class="scroll-cue">SCROLL &darr;</div>
  </section>

  <section class="panel" id="s2" data-section="02">
    <div>
      <div class="eyebrow">Est. 2005 &middot; Houston, TX</div>
      <h2 class="section-h">Trained to <span class="gold">Standard.</span></h2>
      <p class="sub">No paint-ball courses dressed up as tactics. No cinema instructors. We teach what works when the silence is broken.</p>
      <div class="stats rise">
        <div class="stat"><div class="stat-num" data-count="1701" data-suffix="+">0</div><div class="stat-label">Students Trained</div></div>
        <div class="stat"><div class="stat-num" data-count="21">0</div><div class="stat-label">Courses</div></div>
        <div class="stat"><div class="stat-num" data-count="0">0</div><div class="stat-label">Shortcuts</div></div>
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
        {tile('04', 'CQB.', 'Close Quarters Battle.', 'disc-cqb.jpg', 'center 30%')}
        {tile('05', 'Fitness.', 'Conditioning for duty.', 'disc-fitness.jpg')}
        {tile('06', 'Medical.', 'Emergency and trauma care.', 'disc-medical.jpg')}
        {tile('07', 'Leadership.', 'Command and decision-making.', 'disc-leadership.jpg', 'center 25%')}
      </div>
    </div>
  </section>

  <section class="panel" id="s5" data-section="05">
    <div>
      <div class="eyebrow">Course Catalog</div>
      <h2 class="section-h">Twenty-One <span class="gold">Courses.</span></h2>
      <p class="sub">Open a discipline, pick a course, pick your weekend. <b style="color:#F0F4FF;">First time with MAST? Start with a Fundamentals course.</b> Operator and P1 courses build on it; P2 follows P1. Private instruction by arrangement. Ammunition, rentals and UTM rounds are added later.</p>
      <div class="catalog-wrap rise"><div class="glass"><div class="catalog-panel" id="catalog"></div></div>
      <p class="catalog-note">Team blocks and agency instruction: <a href="tel:+12816548100">(281) 654-8100</a> &middot; <a href="mailto:atlasglinn.hq@atlasglinn.com">atlasglinn.hq@atlasglinn.com</a></p></div>
    </div>
  </section>

  <section class="panel" id="s6" data-section="06">
    <div>
      <div class="eyebrow">Founder &amp; Lead Instructor</div>
      <h2 class="section-h">Matthew <span class="gold">Brockmann.</span></h2>
      <div class="founder rise">
        <div class="portrait" style="background-image:url('images/mast/instructing-le.jpg')"><div class="cap">Instructing a federal team on the line</div></div>
        <div class="bio">
          <p>Founded MAST Solutions in 2005 and later Atlas Glinn, LLC. Former Head of Security for Senator Ted Cruz; security for U.S. Senators Josh Hawley and Eric &ldquo;Bulldog&rdquo; Schmitt, a former Vice President, and Ivanka Trump, named only where media coverage exists. Other high-profile and high-net-worth individuals follow our privacy standards. We do not do media; a name appears only where media captured it without our consent. Teaches on the range. Has trained Houston, Baytown, Galveston, and other SWAT teams, including TTPOA (TX Tactical Police Officers Association), VBSS (Visit, Board, Search, Seize), NASA SRT, Dept of Homeland Security, and other federal, state, and Military Units.</p>
          <ul class="creds">
            <li>Trained by <b>Paul Howe</b> (1st SFOD-D), <b>Bill Jeans</b> and <b>John Perretti</b></li>
            <li><b>DPS Level III Firearms Instructor</b> &middot; <b>TTPOA Maritime VBSS</b> instructor</li>
            <li>Featured on <b>Modern Shooter TV</b> and in <b>The Washington Post</b></li>
          </ul>
          <p class="cadre">Courses run with a lead instructor, assistant instructors, and RSOs (Range Safety Officers) on the line. Your instructors are named on the course confirmation.</p>
          <div class="ctas"><button class="cta-button ghost-button" type="button" onclick="openQuals()">Qualifications &amp; Certifications</button><a href="#s5" class="cta-button">Train With Him</a></div>
        </div>
      </div>
      <div class="cert rise">
        <img src="images/mast/capitol-flag-certificate.jpg" alt="Certificate: a flag flown over the United States Capitol in honor of Matthew Brockmann, at the request of Senator Ted Cruz, December 1, 2021" loading="lazy">
        <p>A flag flown over the United States Capitol at the request of Senator Ted Cruz, December 1, 2021, &ldquo;with gratitude for your steadfast vigilance, unwavering dedication, and heart of service.&rdquo; The task force is not named here. Details matter. Privacy matters.</p>
      </div>
    </div>
  </section>

  <section class="panel" id="s7" data-section="07">
    <div>
      <div class="eyebrow">MAST Solutions In Action</div>
      <h2 class="section-h">In <span class="gold">Action.</span></h2>
      <p class="sub">Training, operations, and the people behind the mission. Tap to play. Nothing loads until you do.</p>
      <div class="media-strip rise" id="media-strip"></div>
      <a href="https://www.washingtonpost.com/graphics/2018/national/amp-stories/arming-american-teachers/" target="_blank" rel="noopener" class="post"><small>As featured in</small>The Washington Post &middot; Arming American Teachers &rarr;</a>
    </div>
  </section>

  <section class="panel" id="s8" data-section="08">
    <div>
      <div class="badge">Privacy Matters</div>
      <p class="sub quote lead">&ldquo;Details matter. Privacy matters. Unless publicly reported, we don&rsquo;t disclose.&rdquo;</p>
      <p class="sub" style="font-size:.98rem;">Former Head of Security for Senator Ted Cruz; security for U.S. Senators Josh Hawley and Eric &ldquo;Bulldog&rdquo; Schmitt, a former Vice President, and Ivanka Trump, named only where media coverage exists. Other high-profile and high-net-worth individuals follow our privacy standards. We do not do media; a name appears only where media captured it without our consent. Pictured: Senators Hawley and Schmitt.</p>
      <div class="eyebrow" style="margin-top:2.5rem;">For agencies, units and procurement officers</div>
      <div class="ctas rise"><a href="mailto:atlasglinn.hq@atlasglinn.com?subject=MAST%20Solutions%20Capability%20Statement%20Request" class="cta">Email for the Capability Statement</a><a href="mast-capability-statement.html" class="secondary-cta">View One-Pager</a></div>
    </div>
  </section>

  <section class="panel" id="s9" data-section="09">
    <div>
      <div class="eyebrow">Book a Course</div>
      <h2 class="section-h"><span class="gold">Train</span> with MAST.</h2>
      <p class="sub">Individual seats, team blocks, and agency instruction.</p>
      <div class="contact-lines rise">2450 Fondren Rd, Suite 255 &middot; Houston, TX 77063<br><a href="tel:+12816548100">(281) 654-8100</a> &middot; <a href="mailto:atlasglinn.hq@atlasglinn.com">atlasglinn.hq@atlasglinn.com</a></div>
      <div class="ctas rise"><a href="#s5" class="cta">Book a Course</a><a href="index.html" class="secondary-cta">Atlas Glinn &rarr;</a></div>
      <div class="foot">&copy; 2026 Atlas Glinn, LLC &middot; MAST Solutions <br><a href="privacy.html">Privacy Policy</a>&middot;<a href="terms.html">Terms of Service</a>&middot;<a href="https://www.instagram.com/atlasglinn_mastsolutions/" target="_blank" rel="noopener">Instagram</a>&middot;<a href="https://www.youtube.com/@mastsolutions" target="_blank" rel="noopener">YouTube</a></div>
    </div>
  </section>

"""

BODY = '\n' + CHROME + '\n' + banner + '\n\n<div class="content">\n' + SECTIONS + '</div>\n\n' + modals + '\n'

META = """<title>MAST Solutions | Details Matter | Tactical Training, Houston TX</title>
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

html = shell.head(META, shell.css(shell.MAST, booking_css)) + BODY + shell.tail(shell.three(9, shell.MAST), js)
# Brockmann picked this design as the page that ships (2026-09-03), so the assembler writes the production
# mastsolutions.html. The Atlas-frame build lives on as mastsolutions-atlas.html; the old cinematic URL is a stub redirect.
out = f'{REPO}/mastsolutions.html'
open(out, 'w', encoding='utf-8').write(html)
print('wrote', out, len(html.encode('utf-8')), 'bytes')
