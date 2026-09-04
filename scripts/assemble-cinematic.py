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
  { mp4: 'images/mast/mast-shotgun.mp4', teaser: 'images/mast/mast-shotgun-teaser.mp4', poster: 'images/mast/mast-shotgun-poster.jpg', title: 'Shotgun', sub: 'Breaching and patterning' },
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
];"""
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
    credits=('A Houston Operation', 'Since 2005'), wordmark='MAST SOLUTIONS',
    photos=[('01', 'images/mast/hero-casualty-carry.jpg', 'center 40%'), ('02', 'images/mast/disc-firearms.jpg', None),
            ('03', 'images/mast/ship-deck-movement.jpg', None), ('04', 'images/mast/disc-cqb.jpg', None),
            ('05', 'images/mast/courses-low-light.jpg', None), ('06', 'images/mast/courses-low-light.jpg', 'center 60%'), ('07', 'images/mast/founder-ship.jpg', 'center 20%'),
            ('08', 'images/mast/vehicular.jpg', None), ('09', 'images/mast/instructing-le.jpg', 'center 30%'),
            ('10', 'images/mast/privacy-aircraft.jpg', None), ('11', 'images/mast/contact-zodiac.jpg', None)],
    hud_tl='&#9679; ATLAS GLINN &middot; MAST.SYS LIVE', hud_tl_href='/',   # root, so it resolves on WordPress and on Pages alike
    hud_bl='HOU &middot; 29.7604&deg;N &middot; 95.3698&deg;W', hud_br='DETAILS MATTER',
    chapters=[('s1', '01 &middot; Opening'), ('s2', '02 &middot; Standard'), ('s3', '03 &middot; Who'), ('s4', '04 &middot; Disciplines'),
              ('s5', '05 &middot; Courses'), ('s6', '06 &middot; Team Memberships'), ('s7', '07 &middot; Instructors'), ('s8', '08 &middot; In Action'),
              ('s9', '09 &middot; Testimonials'), ('s10', '10 &middot; Privacy'), ('s11', '11 &middot; Contact')])


# ── Membership: the four teams of the old site's Membership sheet (2014) plus Law Enforcement and Verified Teachers (owner,
#    2026-09-04: "Add the 4 Subscriptions"; fees Red 250, Blue 450, Gold 575, Black 600, LE 195, Teachers 195). Join opens a short
#    dialog (name, email) and hands off to Stripe Checkout in subscription mode through the Worker's POST /create-membership; the
#    Worker provisions each plan's Stripe Price on first use ("2- you can do").
import urllib.parse
def tier(name, key, plan, fee, includes, slots):   # key is t-<team>: a bare 'gold' class would take the page's gradient-text rule
    return (f'<div class="tier {key}"><div class="tier-name">{name}</div><div class="tier-fee">{fee}<small>per month</small></div>'
            f'<p class="tier-inc">{includes}</p><div class="tier-slots">{slots}</div>'
            f'<button class="cta-button" type="button" onclick="joinTeam(\'{plan}\', \'{name}\', \'{fee}\')">Join</button></div>')

MEMBERSHIP = f"""
  <section class="panel" id="s6" data-section="06">
    <div>
      <div class="eyebrow">Team Memberships &middot; Six Teams &middot; Limited Slots</div>
      <h2 class="section-h">Team <span class="gold">Memberships.</span></h2>
      <p class="sub">MAST offers membership in six teams: four open teams, plus Law Enforcement and Verified Teachers. Each team holds a set number of slots, so the benefits and the class seats are always there for the members who hold them. When a team is full there is a waiting list. New memberships are vetted by the established team.</p>
      <div class="teams rise">
        {tier('Red Team', 't-red', 'red_team', '$250', 'One class, plus 25% off any one class for you or one friend.', '10 memberships')}
        {tier('Blue Team', 't-blue', 'blue_team', '$450', 'Two classes, plus 35% off any two classes for you or two friends.', '5 memberships')}
        {tier('Gold Team', 't-gold', 'gold_team', '$575', 'Three classes, plus 45% off any three classes for you or three friends.', '5 memberships')}
        {tier('Black Team', 't-black', 'black_team', '$600', 'Unlimited classes, plus 50% off any class for you or four friends.', '5 memberships')}
        {tier('Law Enforcement', 't-le', 'le_team', '$195', 'Two classes, plus 35% off any two classes for you or two friends.', 'Verified status required')}
        {tier('Verified Teachers', 't-teachers', 'teachers_team', '$195', 'Two classes, plus 35% off any two classes for you or two friends.', 'Verified status required')}
      </div>
      <p class="teams-note">A slot is held while the monthly fee is paid; a lapsed slot goes to the waiting list. Membership is billed monthly by card; new memberships are vetted by the established team.</p>
    </div>
  </section>
"""

SECTIONS = f"""
  <section class="panel" id="s1" data-section="01">
    <div>
      <div class="eyebrow">Over Two Decades &middot; Quiet &middot; Deliberate</div>
      <h1 class="mega"><span class="gold">Details</span> <span class="white">Matter.</span></h1>
      <p class="sub">Trusted by DEA, Houston SWAT, US Military, and Homeland Security. No fluff. No shortcuts. No compromise.</p>
      <div class="ctas rise"><a href="#s5" class="cta">Enter The Range</a><a href="#s7" class="secondary-cta">The Instructors</a></div>
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
        <div class="stat"><div class="stat-num" data-count="21">0</div><div class="stat-label">Courses</div></div>
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

  <section class="panel" id="s5" data-section="05">
    <div>
      <div class="eyebrow">Course Catalog</div>
      <h2 class="section-h">Twenty-One <span class="gold">Courses.</span></h2>
      <p class="sub">Open a discipline, pick a course, pick your weekend. <b style="color:#F0F4FF;">Fundamentals first, unless you have taken it before. Each discipline&rsquo;s Fundamentals course opens its other courses, and Select Date asks before the calendar opens.</b> P2 follows P1. Private instruction by arrangement. Ammunition, rentals and UTM rounds are added later.</p>
      <div class="catalog-wrap rise"><div class="glass"><div class="catalog-panel" id="catalog"></div></div>
      <p class="catalog-note">Team blocks and agency instruction: <a href="tel:+12816548100">(281) 654-8100</a> &middot; <a href="mailto:atlasglinn.hq@atlasglinn.com">atlasglinn.hq@atlasglinn.com</a></p></div>
    </div>
  </section>

{MEMBERSHIP}
  <section class="panel" id="s7" data-section="07">
    <div>
      <div class="eyebrow">Instructors</div>
      <h2 class="section-h">Meet The <span class="gold">Team.</span></h2>
      <div class="founder rise">
        <div class="portrait" style="background-image:url('images/mast/brockmann-instructor.jpg');background-position:center 22%"><div class="cap">Founder &amp; Lead Instructor</div></div>
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
          <div class="ctas"><button class="cta-button ghost-button" type="button" onclick="openQuals()">Qualifications &amp; Certifications</button><a href="#s5" class="cta-button">Train With Him</a></div>
        </div>
      </div>
      <!-- Team blocks in the Atlas Glinn "Meet the Team" format (owner, 2026-09-04: "add Mike Cline - Look at how ATLASGLINN list and emulate").
           Cline's portrait and bio are the ones on atlasglinn.com/about; his MAST title is the owner's to set. Torrey Kramer's bio is a
           one-line draft until the owner supplies the text (not in the old-site export). -->
      <div class="team rise">
        <div class="portrait" style="background-image:url('https://atlasglinn.com/wp-content/uploads/2025/03/Cline-Bio-Pic-1024x819.jpg');background-position:center 15%"><div class="cap">Chief Operating Officer</div></div>
        <div class="bio"><h3>Michael Cline</h3><div class="role">Chief Operating Officer &middot; Atlas Glinn</div>
          <p>As the Chief Operating Officer at Atlas Glinn, Michael Cline brings a wealth of experience and a strategic vision to the company. With a distinguished 12-year career as a Navy SEAL, Michael has honed exceptional leadership, discipline, and problem-solving skills that are now pivotal in driving Atlas Glinn&rsquo;s operational excellence.</p>
        </div>
      </div>
      <div class="team rise">
        <div class="portrait" style="background-image:url('images/mast/torrey-kramer.jpg');background-position:center 20%"><div class="cap">Instructor</div></div>
        <div class="bio"><h3>Torrey Kramer</h3><div class="role">Instructor</div>
          <p>Combat veteran. Injured by an IED on his second deployment; his return is the subject of the documentary <i>A Long Recovery</i>, below.</p>
        </div>
      </div>
      <div class="media-strip rise" id="instructor-strip"></div>
      <div class="cert rise">
        <img src="images/mast/capitol-flag-certificate.jpg" alt="Certificate: a flag flown over the United States Capitol in honor of Matthew Brockmann, at the request of Senator Ted Cruz, December 1, 2021" loading="lazy">
        <p>A flag flown over the United States Capitol at the request of Senator Ted Cruz, December 1, 2021, &ldquo;with gratitude for your steadfast vigilance, unwavering dedication, and heart of service.&rdquo; The task force is not named here. Details matter. Privacy matters.</p>
      </div>
    </div>
  </section>

  <section class="panel" id="s8" data-section="08">
    <div>
      <div class="eyebrow">MAST Solutions In Action</div>
      <h2 class="section-h">In <span class="gold">Action.</span></h2>
      <p class="sub">Training, operations, and the people behind the mission. Tap to play. Nothing loads until you do.</p>
      <div class="media-strip rise" id="media-strip"></div>
      <a href="https://www.washingtonpost.com/graphics/2018/national/amp-stories/arming-american-teachers/" target="_blank" rel="noopener" class="post"><small>As featured in</small>The Washington Post &middot; Arming American Teachers &rarr;</a>
    </div>
  </section>

  <section class="panel" id="s9" data-section="09">
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

  <section class="panel" id="s10" data-section="10">
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

  <section class="panel" id="s11" data-section="11">
    <div>
      <div class="eyebrow">Book a Course</div>
      <h2 class="section-h"><span class="gold">Train</span> with MAST.</h2>
      <p class="sub">Individual seats, team blocks, and agency instruction.</p>
      <div class="contact-lines rise">2450 Fondren Rd, Suite 255 &middot; Houston, TX 77063<br><a href="tel:+12816548100">(281) 654-8100</a> &middot; <a href="mailto:atlasglinn.hq@atlasglinn.com">atlasglinn.hq@atlasglinn.com</a></div>
      <div class="ctas rise"><a href="#s5" class="cta">Book a Course</a><a href="/" class="secondary-cta">Atlas Glinn &rarr;</a></div>
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
    <label class="join-field">Name<input id="join-name" type="text" autocomplete="name"></label>
    <label class="join-field">Email<input id="join-email" type="email" autocomplete="email" required></label>
    <div class="gate-actions"><button class="cta-button" id="join-go" type="button" onclick="joinGo()">Continue to Stripe</button></div>
    <p class="gate-fine">Billed monthly by card through Stripe. New memberships are vetted by the established team.</p>
    <p class="join-err" id="join-err" role="alert"></p>
</div>
"""
JOIN_JS = """
/* Membership join (owner, 2026-09-04): Join opens a short dialog for name and email, then Stripe Checkout in subscription mode via
   POST /create-membership; the Worker provisions the plan's Stripe Price on first use. A failure offers the email route. */
let joinPlan = null;
function joinTeam(key, name, fee){ joinPlan = key; $('join-title').textContent = name; $('join-meta').textContent = fee + ' per month'; $('join-err').textContent = ''; const b = $('join-go'); b.disabled = false; b.textContent = 'Continue to Stripe'; $('join-bd').classList.add('open'); $('join').classList.add('open'); document.body.style.overflow = 'hidden'; setTimeout(() => $('join-email').focus(), 150); }
function closeJoin(){ $('join-bd').classList.remove('open'); $('join').classList.remove('open'); document.body.style.overflow = ''; }
async function joinGo(){
  const email = $('join-email').value.trim(), name = $('join-name').value.trim();
  if (!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(email)) { $('join-err').textContent = 'Enter the email address for your membership.'; $('join-email').focus(); return; }
  const btn = $('join-go'); btn.disabled = true; btn.textContent = 'One moment\u2026'; const base = location.origin + location.pathname;
  try {
    const res = await fetch(API + '/create-membership', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, plan: joinPlan, customer_name: name, successUrl: base + '?membership=success', cancelUrl: base + '?membership=cancelled' }) });
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

BODY = '\n' + CHROME + '\n' + banner + '\n\n<div class="content">\n' + SECTIONS + '</div>\n\n' + modals + JOIN_MODAL + '\n'
js = js + JOIN_JS

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
  #s5, #s6, .sheet, .sheet-bd, .modal, .modal-bd { --gold:#C9A84C; --gold-antique:#D4AF37; --gold-champagne:#E8D27D; --gold-bright:#FCF6BA; --copper:#B87333; }
  #s5 .gold, #s6 .gold, h1.mega .gold { background:linear-gradient(135deg, #BF953F 0%, #FCF6BA 50%, #B38728 100%); -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; }
  h1.mega .gold { text-shadow:0 0 80px rgba(201,168,76,.3); }
  #s5 .cta-button, #s5 .cta, #s6 .cta-button, .sheet .cta-button, .modal .cta-button { background:linear-gradient(135deg, #BF953F 0%, #FCF6BA 50%, #B38728 100%); border-color:#E8D27D; }
  #s5 .cta-button:hover, #s5 .cta:hover, #s6 .cta-button:hover, .sheet .cta-button:hover, .modal .cta-button:hover { box-shadow:0 14px 44px rgba(201,168,76,.5); }
  #s5 .cta-button.ghost-button, .sheet .cta-button.ghost-button, .modal .cta-button.ghost-button { background:transparent; }
  .chap-link { color:#E8D27D; }
  .chap-link::before { background:#C9A84C; }
  .chap-link:hover, .chap-link.active { color:#FCF6BA; border-color:rgba(201,168,76,.5); background:rgba(201,168,76,.06); }
  .chap-link.active::before, .chap-link:hover::before { background:#FCF6BA; }
  /* Membership chapter (owner, 2026-09-04: "elegance + exclusivity" — the silent-auction certificate's register: Cormorant serif,
     letter-spaced small caps, thin gold rules on black). */
  .teams { display:grid; grid-template-columns:repeat(3, 1fr); gap:1.1rem; max-width:1200px; margin:0 auto 1.2rem; text-align:left; }
  .tier { position:relative; padding:2rem 1.6rem 1.7rem; background:linear-gradient(180deg, rgba(0,0,0,.55) 0%, rgba(5,8,16,.85) 100%); border:1px solid rgba(201,168,76,.35); backdrop-filter:blur(10px); display:flex; flex-direction:column; }
  .tier::before { content:''; position:absolute; top:0; left:1.6rem; right:1.6rem; height:2px; }
  .tier.t-red::before { background:#9B1C1C; } .tier.t-blue::before { background:#1A6BDE; } .tier.t-gold::before { background:#C9A84C; } .tier.t-black::before { background:#F0F4FF; } .tier.t-le::before { background:#3A4A5C; } .tier.t-teachers::before { background:#CFE2FF; }
  .tier-name { font-family:'Cormorant Garamond',Georgia,serif; font-weight:600; font-size:1.7rem; letter-spacing:.08em; color:#E8D27D; margin-bottom:.9rem; }
  .tier-fee { font-family:'Cormorant Garamond',Georgia,serif; font-weight:700; font-size:2.6rem; line-height:1; color:#F0F4FF; }
  .tier-fee small { display:block; font-family:'Share Tech Mono',monospace; font-size:.62rem; letter-spacing:.3em; text-transform:uppercase; color:#8B95A8; margin-top:.5rem; }
  .tier-inc { font-family:'Cormorant Garamond',Georgia,serif; font-size:1.2rem; line-height:1.45; color:#F0F4FF; margin:1.2rem 0 1rem; flex:1; }
  .tier-slots { font-family:'Share Tech Mono',monospace; font-size:.66rem; letter-spacing:.3em; text-transform:uppercase; color:#E8D27D; border-top:1px solid rgba(201,168,76,.25); padding-top:.9rem; margin-bottom:1.1rem; }
  .tier .cta-button { align-self:flex-start; padding:.85rem 1.8rem; font-size:.75rem; }
  .tier.t-black { border-color:rgba(232,210,125,.6); box-shadow:0 0 60px rgba(201,168,76,.12); }
  .teams-note { font-family:'Cormorant Garamond',Georgia,serif; font-style:italic; font-size:1.1rem; color:#8B95A8; max-width:760px; margin:0 auto; text-align:center; }
  .modal.join .join-field { display:block; font-family:'Share Tech Mono',monospace; font-size:.66rem; letter-spacing:.25em; text-transform:uppercase; color:#8B95A8; margin:.9rem 0 0; }
  .modal.join input { display:block; width:100%; margin-top:.35rem; padding:.8rem .9rem; background:#0B1221; border:1px solid rgba(201,168,76,.35); color:#F0F4FF; font:1rem 'Rajdhani',sans-serif; letter-spacing:.02em; }
  .modal.join input:focus { outline:none; border-color:#C9A84C; }
  .modal.join .gate-actions { margin-top:1.3rem; }
  .modal.join .join-err { color:#ff8a80; font-size:.9rem; line-height:1.45; margin-top:.8rem; min-height:1.2em; }
  .modal.join .join-err a { color:#E8D27D; }
  @media (max-width:1100px) { .teams { grid-template-columns:1fr 1fr; } }
  @media (max-width:600px) { .teams { grid-template-columns:1fr; } .tier-fee { font-size:2.2rem; } }
"""
html = shell.head(META, shell.css(PALETTE, '/*__BOOKING_CSS__*/' + QUOTES_CSS)) + BODY + shell.tail(shell.three(11, PALETTE), js)
# The video cards and the media strip are shared UI in the blue chapters, so those lifted rules recolor with the page.
booking_css_kept = '\n'.join(shell._recolor(l, PALETTE) if l.lstrip().startswith(('.video-card', '.yt', '.media-strip')) else l for l in booking_css.splitlines())
html = shell._recolor(html, PALETTE).replace('/*__BOOKING_CSS__*/', booking_css_kept + GOLD_KEEP, 1)
assert html.count('__BOOKING_CSS__') == 0 and '.cat-btn {' in html and 'h1.mega .gold { text-shadow' in html, 'booking css / gold keep not spliced'

# Brockmann picked this design as the page that ships (2026-09-03), so the assembler writes the production
# mastsolutions.html. The Atlas-frame build lives on as mastsolutions-atlas.html; the old cinematic URL is a stub redirect.
out = f'{REPO}/mastsolutions.html'
open(out, 'w', encoding='utf-8').write(html)
print('wrote', out, len(html.encode('utf-8')), 'bytes')
