"""
atlas_shell.py — the classic one-scroll layout for the Atlas Glinn pages.

THE PARAGRAPH THAT USED TO OPEN THIS FILE IS SUPERSEDED, AND EVERY CLAUSE OF IT IS NOW FALSE. It read: Brockmann,
2026-09-08, on the chapter preview: "too many clicks to get to content and back is confusing — look at how easy the
current site is and rebuild" and "atlasglinn needs to mimic the current site with the new build". So the Atlas pages
keep the trailer's visual system and drop the trailer's navigation: "the chapter rail, the SECTION counter, the MENU
overlay and the per-chapter letterbox cuts are gone, and in their place sit the live site's sticky top bar with its
dropdown …". The 2026-09-08 quote is real and stays on the record; the conclusion drawn from it was reversed by him
eleven days later and is struck.

Brockmann, 2026-09-09 17:12–18:12 UTC: "Menu should be like the mastsolutions menu side bar?" · "Add more of the
teslas style" · "floor" · "for mobile" · "SHould have embedded videos" · "Site should be same as most look mobile
first" · and, over two screenshots side by side — the live site with its sticky bar, and the cinematic build with its
four HUD corners, its MENU overlay, its numbered rail and its big Orbitron two-tone headline — "Look at the difference
- the frontend should be the same with the Tesla as a styled".

SO WHAT SHIPS IS THE TRAILER'S CHROME AROUND THE LIVE SITE'S WORDS: no sticky bar and no mobile menu, a four-corner
HUD (tl the brand line and a link home, tr "SECTION NN / NN", bl the Houston coordinates, br "DETAILS MATTER"), a
"MENU ☰" button opening a full-screen overlay that carries the live bar's list, the live mobile menu's list and a
third list of the pages this page's live nav never names, the numbered chapter rail STANDING with its gutter, the
intro overlay with Enter / Skip Intro, the footer and a back-to-top control. The `id="sN"` anchors stay, so existing
links still land. Body copy keeps the live words at the live sizes — ledger K-3 is reversed for the HERO and the
CHROME only, and for the <=768 readability floors, and nowhere else.

Nothing here duplicates the shell. The palette, the type, the buttons, the cards and the three.js emblem scene are read
out of cinematic_shell and reused verbatim:
  css(palette, extra)        the shell stylesheet with the chapter-rail rules removed, plus the classic chrome
  three(sections, palette)   the shell's gold ring + reticle + photo layer + emblem scene on a continuous camera path
  chrome(...)                intro overlay, canvas, photo layer, grain, vignette, progress, reticle
  nav(items, here, logo)     the sticky bar and the mobile overlay — the --authored path ONLY since 2026-09-09
  sitenav(main, index, ...)  the MENU button and the full-screen overlay that replaced them on the live pages
  hero_media(img, pos, film) the hero film, its scrim and the sound toggle
  footer(html)               the site footer element
  JS                         intro, nav, dropdown, sound toggle, back to top

mastsolutions.html does not import this module; the MAST build is untouched.
"""
import re

import cinematic_shell as shell

# ── The chapter rail, the trailer splash and the letterbox cut have no place in a one-scroll page, so their rules come
#    out of the shell stylesheet rather than being overridden — nothing referencing them survives in the output. Three
#    declarations ride along in the same source lines (the reticle's mobile hide and the mobile cursor) and come back in
#    CLASSIC_CSS below. `.intro-ring` stays: the gold sparkle ring is the one piece of the splash the classic intro keeps.
_TRAILER_ONLY = ('chap-link', 'chapter-nav', 'Chapter menu', '#intro-seq', '.intro-credit', '.letterbox', 'introFade')


# ── The sticky bar and its mobile menu come OUT of the live-content pages (r8, 2026-09-09). They stay in
#    CLASSIC_CSS because assemble-atlas.build() — the --authored path — still prints atlas.nav(); the cut is made
#    in atlas_live.chrome_css(), which is the live path's own sheet. Cut BY MARKER, not by token: the block carries
#    a three-line @media whose opening and closing braces name nothing, so a line filter would leave the sheet
#    unbalanced. Every selector in _BAR_ONLY must be inside the cut or the build stops.
_BAR_A = '  /* ── Sticky top bar ── */'
_BAR_B = '  /* ── Hero: the film full-bleed under the headline, with the live sound toggle ── */'
_BAR_ONLY = ('#main-nav', '.nav-container', '.nav-logo', '.nav-links', '.nav-toggle', '.nav-dropdown',
             '.nav-dropdown-menu', '.nav-dropdown-banner', '.ndb-icon', '.ndb-title', '.ndb-desc', '.nav-cta',
             '#mobile-nav', '.mobile-nav-close')


def _debar(css_text):
    a, b = css_text.index(_BAR_A), css_text.index(_BAR_B)
    cut = css_text[a:b]
    missing = [t for t in _BAR_ONLY if t not in cut]
    assert not missing, 'the sticky-bar block no longer carries %s — the cut would leave its sheet behind' % missing
    return css_text[:a] + css_text[b:]


def _derail(css_text):
    lines = css_text.split('\n')
    kept = [ln for ln in lines if not any(t in ln for t in _TRAILER_ONLY)]
    assert len(lines) - len(kept) >= len(_TRAILER_ONLY), 'the shell stylesheet no longer carries the trailer chrome'
    return '\n'.join(kept)


# ── Classic chrome: the live site's bar, intro, hero, footer and back-to-top in the shell's palette and type. Mobile
#    first — the bar is a logo and a hamburger until 1025px, where the full menu and its dropdown take over. Gold
#    literals here are recolored to the Atlas blue with the rest of the sheet; CLASSIC_RAW_CSS holds the few that stay
#    gold (the intro wordmark, which is gold on the live site).
CLASSIC_CSS = r"""
  /* ── Sticky top bar ── */
  #main-nav { position:fixed; top:0; left:0; right:0; z-index:1000; background:rgba(5,8,16,.94); backdrop-filter:blur(12px); border-bottom:1px solid rgba(201,168,76,.25); padding:.6rem 1rem; transform:translateY(-100%); transition:transform .5s ease; }
  #main-nav.visible { transform:translateY(0); }
  .nav-container { max-width:1400px; margin:0 auto; display:flex; align-items:center; justify-content:space-between; gap:1rem; }
  .nav-logo { display:flex; align-items:center; gap:.6rem; text-decoration:none; cursor:none; }
  .nav-logo img { height:32px; width:auto; filter:drop-shadow(0 0 12px rgba(201,168,76,.55)); }
  .nav-logo-text { font-family:'Orbitron',sans-serif; font-weight:700; font-size:.95rem; letter-spacing:.09em; color:var(--gold); }
  .nav-links { display:none; }
  .nav-toggle { display:block; background:rgba(5,8,16,.5); border:1px solid rgba(201,168,76,.35); color:var(--text); font-family:'Share Tech Mono',monospace; font-size:1.3rem; line-height:1; padding:.35rem .65rem; cursor:pointer; }
  @media (min-width:1025px) {
    #main-nav { padding:.85rem 1.5rem; }
    .nav-container { flex-wrap:nowrap; }
    .nav-toggle { display:none; }
    .nav-links { display:flex; flex:1 1 auto; align-items:center; justify-content:flex-end; gap:1rem; list-style:none; margin:0; padding:0; }
    .nav-links > li { position:relative; }
    .nav-links a { font-family:'Rajdhani',sans-serif; font-weight:600; font-size:.78rem; letter-spacing:.07em; text-transform:uppercase; color:var(--text); text-decoration:none; white-space:nowrap; cursor:none; transition:color .3s; }
    .nav-links a:hover, .nav-links > li > a.here { color:var(--gold); }
    .nav-dropdown > a::after { content:' \25BE'; font-size:.7em; }
    .nav-dropdown-menu { position:absolute; top:100%; left:50%; margin-top:1rem; transform:translateX(-50%) translateY(6px); min-width:330px; background:rgba(5,8,16,.97); border:1px solid rgba(201,168,76,.3); backdrop-filter:blur(14px); padding:.45rem; opacity:0; visibility:hidden; transition:opacity .25s, visibility .25s, transform .25s; }
    .nav-dropdown-menu::before { content:''; position:absolute; left:0; right:0; top:-1rem; height:1rem; }
    .nav-dropdown:hover .nav-dropdown-menu, .nav-dropdown:focus-within .nav-dropdown-menu { opacity:1; visibility:visible; transform:translateX(-50%) translateY(0); }
  }
  .nav-dropdown-banner { display:flex; align-items:flex-start; gap:.7rem; padding:.7rem .8rem; text-decoration:none; transition:background .25s; }
  .nav-dropdown-banner:hover { background:rgba(201,168,76,.1); }
  .ndb-icon { font-size:1.15rem; line-height:1.15; }
  .ndb-title { display:block; font-family:'Orbitron',sans-serif; font-weight:700; font-size:.76rem; letter-spacing:.06em; text-transform:uppercase; color:var(--gold-champagne); }
  .ndb-desc { display:block; font-family:'Share Tech Mono',monospace; font-size:.58rem; letter-spacing:.16em; text-transform:uppercase; color:var(--text-dim); margin-top:.25rem; }
  @media (min-width:1025px) and (max-width:1180px) { .nav-links { gap:.8rem; } .nav-links a { font-size:.72rem; } .nav-logo img { height:28px; } .nav-logo-text { font-size:.85rem; } }
  @media (min-width:1441px) { #main-nav { padding:.85rem 2rem; } .nav-links { gap:1.5rem; } .nav-links a { font-size:.85rem; } }
  .nav-cta { font-family:'Orbitron',sans-serif !important; font-weight:700 !important; font-size:.7rem !important; letter-spacing:.14em !important; color:#fff !important; background:linear-gradient(135deg, #BF953F 0%, #FCF6BA 50%, #B38728 100%); border:1px solid var(--gold-champagne); padding:.55rem 1.2rem; text-shadow:0 1px 2px rgba(0,0,0,.35); transition:box-shadow .3s, transform .3s; }
  .nav-cta:hover { color:#fff !important; transform:translateY(-2px); box-shadow:0 8px 24px rgba(201,168,76,.45); }
  /* ── Mobile menu: the live site's full-screen list, one large target per line ── */
  #mobile-nav { position:fixed; inset:0; z-index:2000; background:rgba(5,8,16,.97); backdrop-filter:blur(18px); display:flex; flex-direction:column; align-items:center; justify-content:flex-start; gap:1rem; padding:4.8rem 1.2rem 2.5rem; overflow-y:auto; opacity:0; visibility:hidden; transition:opacity .3s, visibility .3s; }
  #mobile-nav.open { opacity:1; visibility:visible; }
  #mobile-nav a { font-family:'Orbitron',sans-serif; font-weight:700; font-size:1.05rem; letter-spacing:.12em; text-transform:uppercase; color:var(--text); text-decoration:none; text-align:center; }
  #mobile-nav a.subitem { font-family:'Share Tech Mono',monospace; font-weight:400; font-size:.68rem; letter-spacing:.2em; color:var(--gold-champagne); opacity:1; transform:none; margin:0; }
  #mobile-nav a.here { color:var(--gold); }
  .mobile-nav-close { position:absolute; top:1rem; right:1rem; background:none; border:1px solid rgba(201,168,76,.35); color:var(--text); font-size:1.5rem; line-height:1; padding:.1rem .55rem; cursor:pointer; }
  /* ── Hero: the film full-bleed under the headline, with the live sound toggle ── */
  section.hero { overflow:hidden; padding:7rem 1rem 5rem; }
  .hero-media { position:absolute; inset:0; z-index:0; margin:0; overflow:hidden; }
  .hero-media video, .hero-media .still { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
  .hero-media .still { background:center/cover no-repeat; }
  .hero-media iframe { position:absolute; top:50%; left:50%; width:100vw; height:56.25vw; min-height:100%; min-width:177.78vh; transform:translate(-50%,-50%); border:0; pointer-events:none; }
  .hero-scrim { display:block; position:absolute; inset:0; z-index:1; background:linear-gradient(135deg, rgba(5,8,16,.66) 0%, rgba(5,8,16,.36) 50%, rgba(5,8,16,.7) 100%); }
  section.hero > div { position:relative; z-index:2; }
  #sound-toggle { position:absolute; right:1rem; bottom:1rem; z-index:3; width:48px; height:48px; border-radius:50%; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,.6); border:1px solid rgba(201,168,76,.5); color:var(--text); font-size:1.2rem; cursor:pointer; backdrop-filter:blur(10px); transition:border-color .3s, box-shadow .3s, background .3s; }
  #sound-toggle:hover { background:rgba(201,168,76,.18); }
  #sound-toggle.on { border-color:rgba(201,168,76,.9); box-shadow:0 0 15px rgba(201,168,76,.35); }
  @media (min-width:769px) { #sound-toggle { right:2rem; bottom:2rem; } }
  /* ── One continuous scroll: the rail's lane is gone, so the panels take the full width again ── */
  section.panel { scroll-margin-top:72px; }
  .progress { z-index:1001; }   /* the read-position line draws on the bar's top edge, not behind it */
  @media (min-width:769px) { section.panel { padding-left:2rem; padding-right:2rem; } }
  /* ── Back to top ── */
  #back-to-top { position:fixed; right:1rem; bottom:1rem; z-index:900; width:46px; height:46px; border-radius:50%; display:flex; align-items:center; justify-content:center; background:rgba(5,8,16,.72); border:1px solid rgba(201,168,76,.45); color:var(--gold-champagne); font-size:1.05rem; cursor:pointer; backdrop-filter:blur(8px); opacity:0; visibility:hidden; transform:translateY(10px); transition:opacity .3s, visibility .3s, transform .3s, background .3s; }
  #back-to-top.show { opacity:1; visibility:visible; transform:translateY(0); }
  #back-to-top:hover { border-color:var(--gold); background:rgba(201,168,76,.2); }
  /* ── Intro overlay: the live Enter / Skip Intro splash ── */
  #intro-overlay { position:fixed; inset:0; z-index:9999; background:#000; display:flex; align-items:center; justify-content:center; transition:opacity 1s ease, visibility 1s ease; }
  #intro-overlay.hidden { opacity:0; visibility:hidden; pointer-events:none; }
  #intro-content { position:relative; z-index:10; text-align:center; padding:0 1.2rem; opacity:0; transform:translateY(30px); transition:opacity 1s ease .4s, transform 1s ease .4s; }
  #intro-overlay.ready #intro-content { opacity:1; transform:translateY(0); }
  #intro-eyebrow, #intro-tagline { font-family:'Share Tech Mono',monospace; font-size:.68rem; letter-spacing:.45em; text-transform:uppercase; color:var(--text-mute); }
  #intro-tagline { margin-top:1.1rem; }
  #intro-enter { position:absolute; left:50%; bottom:22%; transform:translateX(-50%); z-index:20; padding:.9rem 3rem; font-family:'Orbitron',sans-serif; font-weight:700; font-size:.76rem; letter-spacing:.2em; text-transform:uppercase; border:2px solid var(--gold); color:var(--gold-champagne); background:transparent; border-radius:4px; cursor:pointer; opacity:0; transition:opacity .6s ease, background .35s, color .35s; }
  #intro-overlay.ready #intro-enter { opacity:1; transition-delay:1.2s; }
  #intro-enter:hover { background:var(--gold); color:#000; }
  #skip-intro { position:absolute; right:1.2rem; bottom:1.6rem; z-index:20; padding:.6rem 1.4rem; font-family:'Rajdhani',sans-serif; font-size:.78rem; letter-spacing:.15em; text-transform:uppercase; color:var(--text-mute); background:transparent; border:1px solid rgba(255,255,255,.12); border-radius:4px; cursor:pointer; transition:color .3s, border-color .3s; }
  #skip-intro:hover { color:var(--text); border-color:var(--gold); }
  @media (min-width:1025px) { #intro-enter { left:auto; right:60px; bottom:auto; top:50%; transform:translateY(-50%); } #skip-intro { right:40px; bottom:40px; } }
  body.intro-open { overflow:hidden; }
  /* ── Site footer: the live footer's badge row, four link groups and rights line ── */
  .site-footer { position:relative; z-index:5; background:linear-gradient(180deg, rgba(5,8,16,.72) 0%, rgba(5,8,16,.96) 100%); border-top:1px solid rgba(201,168,76,.2); backdrop-filter:blur(10px); padding:3rem 1.2rem 2rem; }
  /* The chapter rail is fixed to the middle of the viewport and the footer is the one full-width band outside
     .agx-content, so it takes the rail's own gutter above 1025 — the same 17.5rem CINEMA_CSS cuts on the live
     sections, and atlas_shell.assert_rail_gutter() fails the build if the two numbers stop being equal. Below
     1025 the rail is ticks or hidden and this does not apply. */
  @media (min-width:1025px) { .site-footer { padding-right:17.5rem; } }
  .footer-container { max-width:1400px; margin:0 auto; }
  .footer-awards { display:flex; align-items:center; justify-content:center; gap:2.5rem; flex-wrap:wrap; padding-bottom:2.2rem; border-bottom:1px solid rgba(201,168,76,.15); margin-bottom:2.4rem; }
  .footer-awards .badge-item { text-align:center; }
  .footer-awards img { height:96px; width:auto; border:0; filter:drop-shadow(0 0 15px rgba(201,168,76,.3)); }
  .footer-awards .badge-item p { margin-top:.8rem; font-family:'Orbitron',sans-serif; font-size:.7rem; font-weight:700; letter-spacing:.12em; text-transform:uppercase; color:var(--gold-champagne); }
  .footer-grid { display:grid; grid-template-columns:1fr; gap:1.9rem; margin-bottom:2.2rem; text-align:left; }
  @media (min-width:700px) { .footer-grid { grid-template-columns:repeat(auto-fit, minmax(220px,1fr)); gap:2rem; } }
  .footer-section h4 { font-family:'Orbitron',sans-serif; font-weight:700; font-size:.82rem; letter-spacing:.09em; text-transform:uppercase; color:var(--gold-champagne); margin-bottom:.9rem; }
  .footer-section ul { list-style:none; margin:0; padding:0; }
  .footer-section li { margin-bottom:.45rem; }
  .footer-section a, .footer-section p { font-family:'Rajdhani',sans-serif; font-size:.94rem; font-weight:300; color:var(--text-dim); text-decoration:none; line-height:1.75; }
  .footer-section a:hover { color:var(--gold); }
  .footer-social { display:flex; gap:1.1rem; flex-wrap:wrap; margin-top:1rem; }
  .footer-social a { color:var(--gold); }
  .footer-bottom { border-top:1px solid rgba(201,168,76,.12); padding-top:1.7rem; text-align:center; font-family:'Share Tech Mono',monospace; font-size:.62rem; letter-spacing:.22em; line-height:2.2; text-transform:uppercase; color:var(--text-mute); }
  .footer-bottom a { color:var(--text-mute); text-decoration:none; margin:0 .5rem; }
  .footer-bottom a:hover { color:var(--gold-champagne); }
  /* ── The three lines the de-railed sheet took with it ── */
  @media (max-width:768px) {
    html, body { cursor:auto; }
    .cta, .cta-button, .secondary-cta, .qty button, .nav-logo, .nav-links a { cursor:pointer; }
    .reticle { display:none; }
    section.hero { padding:5.5rem 1rem 4rem; }
    .scroll-cue { bottom:1.2rem; }
    .footer-awards { gap:1.6rem; } .footer-awards img { height:72px; }
/* AGX-FOOTER-FLOOR */
  }
"""

# Appended after the palette recolor, so these stay gold: the intro wordmark is gold on the live site.
CLASSIC_RAW_CSS = r"""
  #intro-title { font-family:'Orbitron',sans-serif; font-weight:900; font-size:clamp(1.9rem,6.2vw,3.6rem); letter-spacing:.14em; line-height:1.1; text-transform:uppercase; background:linear-gradient(90deg, #BF953F 0%, #FCF6BA 25%, #B38728 50%, #FBF5B7 75%, #AA771C 100%); background-size:1000px 100%; -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; color:transparent; text-shadow:0 0 60px rgba(201,168,76,.35); animation:shimmer 3s linear infinite; }
  @media (prefers-reduced-motion: reduce) { #intro-title { animation:none; } }
"""


def css(palette=shell.ATLAS, extra=''):
    """The shell stylesheet minus the chapter rail, plus the classic chrome. `extra` is recolored with the rest."""
    sheet = _derail(shell.CSS_A + shell.CSS_B)
    return shell._recolor(sheet + CLASSIC_CSS + extra, palette) + CLASSIC_RAW_CSS


# ── The three.js layer: the shell's own gold ring, reticle, photo layer and emblem scene, on a camera path that reads
#    one number — how far down the page you are. No chapter index drives the camera, nothing locks, nothing counts.
_FADE_OLD = "const fade = t => t < .9 ? 0 : t < 1.9 ? t - .9 : t < 3.6 ? 1 : t < 4.6 ? 1 - (t - 3.6) : 0;"
_FADE_NEW = "const fade = t => t < .9 ? 0 : t < 1.9 ? t - .9 : 1;"   # the splash waits for Enter, so the ring holds
_STOP_OLD = "    if (t > 4.6) return;\n"

PREAMBLE = """import * as THREE from './vendor/three.module.js';

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const mobile = matchMedia('(max-width: 768px)').matches;

"""

LOOP = """// ── One continuous camera path ──
// The camera reads the page's scroll fraction and nothing else: no chapter index, no lock, no counter. The section
// index is used for one thing only — which backdrop photograph is showing.
const secs = [...document.querySelectorAll('section.panel')];
const progressEl = document.getElementById('progress');
const lerp = (a, b, t) => a + (b - a) * t;
const kf = [
%(kf)s
];
function sectionIndex() {
  const mid = innerHeight * .45; let idx = 0;
  secs.forEach((s, i) => { if (s.getBoundingClientRect().top <= mid) idx = i; });
  return idx;
}
function update() {
  const total = document.documentElement.scrollHeight - innerHeight;
  const t = Math.max(0, Math.min(1, scrollY / Math.max(1, total)));
  const sc = t * (kf.length - 1), i = Math.floor(sc), f = sc - i;
  const a = kf[i], b = kf[Math.min(i + 1, kf.length - 1)];
  camera.position.set(lerp(a.x, b.x, f), lerp(a.y, b.y, f), lerp(a.z, b.z, f));
  camera.lookAt(lerp(a.lx, b.lx, f), lerp(a.ly, b.ly, f), lerp(a.lz, b.lz, f));
  const now = performance.now();
  emblem.rotation.y += 0.004; emblem.rotation.x = Math.sin(now * .0004) * .14;
  shards.forEach(s => { const ang = s.userData.a + now * .0002 * s.userData.sp; s.position.set(Math.cos(ang) * s.userData.r, Math.sin(ang * 1.3) * .6, Math.sin(ang) * s.userData.r); s.rotation.x += .02; s.rotation.y += .015; });
  rays.rotation.z += .001;
  emblem.position.y = -t * 2; emblem.scale.setScalar(1 - t * .25);
  [gd, ch].forEach(p => { const pos = p.geometry.attributes.position.array, v = p.userData.v; for (let k = 0; k < pos.length; k++) pos[k] += v[k]; p.geometry.attributes.position.needsUpdate = true; });
  gd.rotation.y = t * .3; ch.rotation.y = -t * .2; stars.rotation.y += .0002;
  scene.fog.density = 0.03 + t * .025;
  if (progressEl) progressEl.style.width = (t * 100) + '%%';
  setPhoto(sectionIndex());
}
addEventListener('scroll', update, { passive: true });
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
let mx = 0;
addEventListener('mousemove', e => { mx = (e.clientX / innerWidth - .5) * 2; });
let paused = false;
document.addEventListener('visibilitychange', () => { paused = document.hidden; if (!paused) animate(); });
function animate() {
  if (paused) return;
  requestAnimationFrame(animate);
  emblem.position.x += (mx * .4 - emblem.position.x) * .04;
  rx = lerp(rx, cx, .22); ry = lerp(ry, cy, .22);
  reticle.style.transform = `translate(${rx}px,${ry}px) translate(-50%%,-50%%)`;
  update(); renderer.render(scene, camera);
}
animate();

// ── Reveals ── every block turns on as it arrives. Nothing cuts to black between sections: the page is one scroll now.
const io = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (!e.isIntersecting) return;
    e.target.querySelectorAll('.eyebrow, h2.section-h, .sub, h1.mega, .rise').forEach(el => el.classList.add('in'));
    e.target.querySelectorAll('.stat-num[data-count]').forEach(el => {
      if (el.dataset.done) return; el.dataset.done = '1';
      const target = +el.dataset.count, duration = 1600, start = performance.now(), suffix = el.dataset.suffix || '';
      const tick = now => { const p = Math.min(1, (now - start) / duration); const eased = 1 - Math.pow(1 - p, 3); el.textContent = Math.floor(target * eased).toLocaleString('en-US') + suffix; if (p < 1) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
  });
}, { threshold: .25 });
secs.filter(s => !s.classList.contains('hero')).forEach(s => io.observe(s));
// A tall section in a short window never reaches 25%% visible, so every reveal element is observed on its own too.
const ioEl = new IntersectionObserver(entries => {
  entries.forEach(e => { if (!e.isIntersecting) return; e.target.classList.add('in'); ioEl.unobserve(e.target); });
}, { threshold: 0, rootMargin: '0px 0px -12%% 0px' });
document.querySelectorAll('section.panel:not(.hero) .rise, section.panel:not(.hero) .eyebrow, section.panel:not(.hero) h2.section-h, section.panel:not(.hero) .sub').forEach(el => ioEl.observe(el));
"""


def three(sections=7, palette=shell.ATLAS):
    """The shell's ring + reticle + photo layer + emblem scene, then the continuous camera path and the reveals."""
    src = shell.THREE_JS
    ring = src[src.index('// Gold ring'):src.index('// ── Reticle ──')]
    assert _FADE_OLD in ring and _STOP_OLD in ring, 'the gold ring no longer fades on the trailer schedule'
    ring = ring.replace(_FADE_OLD, _FADE_NEW).replace(_STOP_OLD, '')
    mid = src[src.index('// ── Reticle ──'):src.index('// ── Three: the Tier 3 emblem scene ──')]
    scene = src[src.index('// ── Three: the Tier 3 emblem scene ──'):src.index('// Scroll-driven camera')]
    js = PREAMBLE + ring + mid + scene + (LOOP % {'kf': shell._keyframes(max(2, sections))})
    for banned in ('chap-link', 'hud-section', 'SECTION 0', 'intro-seq', 'letterbox', 'cinema'):
        assert banned not in js, 'the classic module still carries the trailer chrome: ' + banned
    return shell._recolor(js, palette)


# ── Page chrome ──
def chrome(intro_eyebrow, wordmark, intro_tagline, photos):
    """photos: [(image, position or None)] one per section — the backdrop that crossfades behind the emblem scene."""
    ph = '\n'.join(
        '  <div class="ph" data-for="%02d" style="background-image:url(\'%s\')%s"></div>'
        % (k, img, (';background-position:' + pos) if pos else '')
        for k, (img, pos) in enumerate(photos, 1))
    return ('<div id="intro-overlay">\n  <canvas class="intro-ring" id="intro-ring" aria-hidden="true"></canvas>\n'
            '  <div id="intro-content">\n    <div id="intro-eyebrow">%s</div>\n    <h1 id="intro-title">%s</h1>\n'
            '    <div id="intro-tagline">%s</div>\n  </div>\n'
            '  <button id="intro-enter" type="button">Enter</button>\n'
            '  <button id="skip-intro" type="button">Skip Intro &rarr;</button>\n</div>\n\n'
            '<canvas id="three-canvas"></canvas>\n<div id="photos">\n%s\n</div>\n'
            '<div class="grain"></div>\n<div class="vignette"></div>\n<div class="progress" id="progress"></div>\n'
            '<div class="reticle"><div class="reticle-ring"></div><div class="reticle-dot"></div></div>\n'
            % (intro_eyebrow, wordmark, intro_tagline, ph))


def nav(bar_items, mobile_items, here, logo, brand='ATLAS GLINN', home='index.html', logo_alt=None):
    """The sticky bar and the full-screen menu, both filled from the live page's own two menus.

    bar_items:    [(href, label, kind, dropdown)] — kind None or 'cta', dropdown [(href, icon, title, desc)] or None
    mobile_items: [(href, label, sub)] — sub True for the entries the live menu prints indented
    logo_alt:     the alt the live bar's logo carries, passed in from the capture; the brand constant is only the
                  fallback for the deprecated --authored path, which has no capture to read.

    The descriptor line under a bar item is gone: the live bar prints none, and the eleven the shell invented for it
    ("Dignitary and close protection", "Book a course", "Mission and team", …) were copy no page has ever carried.
    The three descriptors that stay are the live Training menu's own, read off the capture (reference/live/index.html
    <span class="ndb-desc">), and they are printed only where the live banner carries one.
    """
    bar, mob = [], []
    for href, label, kind, drop in bar_items:
        cur = ' class="here"' if href == here else ''
        if drop:
            menu = ''.join('<a href="%s" class="nav-dropdown-banner"><span class="ndb-icon" aria-hidden="true">%s</span>'
                           '<span class="ndb-text"><span class="ndb-title">%s</span>%s</span></a>'
                           % (h, ic, t, '<span class="ndb-desc">%s</span>' % d if d else '')
                           for h, ic, t, d in drop)
            bar.append('        <li class="nav-dropdown"><a href="%s"%s>%s</a>\n          <div class="nav-dropdown-menu">%s</div>\n        </li>' % (href, cur, label, menu))
        else:
            cls = ' class="nav-cta"' if kind == 'cta' else cur
            bar.append('        <li><a href="%s"%s>%s</a></li>' % (href, cls, label))
    for href, label, sub in mobile_items:
        cls = ' class="subitem%s"' % (' here' if href == here else '') if sub else (' class="here"' if href == here else '')
        mob.append('  <a href="%s"%s>%s</a>' % (href, cls, label))
    return ('<nav id="main-nav" aria-label="Main">\n  <div class="nav-container">\n'
            '    <a href="%s" class="nav-logo"><img src="%s" alt="%s" width="40" height="40"><span class="nav-logo-text">%s</span></a>\n'
            '      <ul class="nav-links">\n%s\n      </ul>\n'
            '    <button class="nav-toggle" id="nav-toggle" type="button" aria-controls="mobile-nav" aria-expanded="false" aria-label="Menu">&#9776;</button>\n'
            '  </div>\n</nav>\n\n'
            '<div id="mobile-nav" role="dialog" aria-label="Site menu">\n'
            '  <button class="mobile-nav-close" id="mobile-nav-close" type="button" aria-label="Close menu">&times;</button>\n%s\n</div>\n'
            % (home, logo, logo_alt or brand, brand, '\n'.join(bar), '\n'.join(mob)))


# ── THE MENU BUTTON AND THE FULL-SCREEN OVERLAY ───────────────────────────────────────────────────────────────────
# Brockmann, 2026-09-09: "Menu should be like the mastsolutions menu side bar?" and, over two screenshots, "the
# frontend should be the same with the Tesla as a styled". So the live sticky bar comes off the twelve Atlas pages
# and MAST's MENU overlay takes its place — namespaced agx-, never MAST's own `.menu-btn`/`.sitenav`, because the
# live pages style a bare <nav> and assert_cinema_scope() fails an unanchored selector.
#
# AND THE WORD "MENU" CARRIES ITS OWN id FOR THE SAME REASON. compare-atlas cuts a build-only CHROME CONTROL out
# of the body pool by ELEMENT SPAN, so binding the excuse to the button would have taken the button's whole span —
# including the live "☰" — out of the pool, and the live hamburger would have read as MISSING FROM BUILD on all
# twelve. Measured exactly that way before the id moved: text 182/183, order 1, NOT ON THE LIVE PAGE '☰'. The
# excuse is bound to `#agx-menu-word`, which contains one build-only word and nothing else.
#
# THE SOURCE ORDER OF THE TWO GLYPHS IS LOAD-BEARING AND IT IS THE ONLY ODD THING HERE. The live page prints, in
# this order: the brand "ATLAS GLINN", the bar's links, the bar's hamburger "☰", the mobile menu's close "×", the
# mobile menu's links. compare-atlas.out_of_order() requires the live sequence to be a SUBSEQUENCE of the build's,
# so the overlay prints the same five things in the same five places: brand, main list, MENU button, close button,
# index list. The two buttons are position:fixed and position:absolute, so where they sit in the source has no
# bearing on where they sit on the screen — and putting them anywhere else costs two live text units.
#
# WHICH IS ALSO WHY `.agx-sitenav` FADES ON ITS CHILDREN AND NOT ON ITSELF. The MENU button has to stay visible
# while the overlay is shut, and an ancestor `opacity:0` makes every descendant transparent with no way out;
# `visibility` is the one property a child can take back. So the closed state is `visibility:hidden` on the
# container plus `opacity:0` on the scrim and the two panels, and the button re-declares `visibility:visible`.
def sitenav(main, index, extra, here, logo, logo_alt, brand='ATLAS GLINN', home='index.html'):
    """main:  [(href, label, kind, dropdown)] — the live BAR, kind None or 'cta', dropdown [(href, icon, title, desc)]
       index: [(href, label, sub)]            — the live MOBILE menu
       extra: [(href, label)]                 — the build-only third list, compare-atlas.sitenav_anchors()'s budget
    """
    def cls_of(href, kind):
        parts = (['agx-cta'] if kind == 'cta' else []) + (['agx-here'] if href == here else [])
        return ' class="%s"' % ' '.join(parts) if parts else ''

    rows = []
    for href, label, kind, drop in main:
        item = '<a href="%s"%s>%s</a>' % (href, cls_of(href, kind), label)
        if drop:
            item += ('\n        <ul class="agx-sitenav-drop">%s</ul>'
                     % ''.join('<li><a href="%s"><span class="agx-sitenav-i" aria-hidden="true">%s</span>%s%s</a></li>'
                               % (h, ic, t, '<small>%s</small>' % d if d else '')
                               for h, ic, t, d in drop))
        rows.append('      <li>%s</li>' % item)
    idx = ''.join('<li><a href="%s"%s>%s</a></li>' % (h, ' class="agx-here"' if h == here else '', l)
                  for h, l, _sub in index)
    xtra = ''.join('<li><a class="agx-sitenav-x" href="%s">%s</a></li>' % (h, l) for h, l in extra)
    return ('<div class="agx-sitenav" id="agx-sitenav" role="dialog" aria-modal="true" aria-label="Site menu">\n'
            '  <div class="agx-sitenav-scrim" aria-hidden="true"></div>\n'
            '  <div class="agx-sitenav-in">\n'
            '    <a href="%s" class="agx-sitenav-logo"><img src="%s" alt="%s" width="40" height="40">'
            '<span class="agx-sitenav-brand">%s</span></a>\n'
            '    <ul class="agx-sitenav-main">\n%s\n    </ul>\n'
            '  </div>\n'
            '  <button id="agx-menu-btn" class="agx-menu-btn" type="button" aria-controls="agx-sitenav" '
            'aria-expanded="false" aria-label="Menu"><span id="agx-menu-word" class="agx-menu-word">MENU</span> '
            '<span class="agx-menu-glyph" aria-hidden="true">&#9776;</span></button>\n'
            '  <div class="agx-sitenav-in agx-sitenav-tail">\n'
            '    <button id="agx-sitenav-close" class="agx-sitenav-close" type="button" aria-label="Close menu">'
            '&times;</button>\n'
            '    <ul class="agx-sitenav-index">%s</ul>\n'
            '    <ul class="agx-sitenav-extra">%s</ul>\n'
            '  </div>\n</div>\n'
            % (home, logo, logo_alt or brand, brand, '\n'.join(rows), idx, xtra))


def hero_media(img, pos=None, film=None):
    """The opening frame: the film autoplaying muted full-bleed with the live sound toggle, or the page's still.
    A `yt:<id>` film is the YouTube player the live page embeds, with the JS API on so the toggle can unmute it."""
    still = '<span class="still" style="background-image:url(\'%s\')%s"></span>' % (img, (';background-position:' + pos) if pos else '')
    toggle = ('<button id="sound-toggle" type="button" title="Toggle Sound" aria-label="Toggle sound">&#128263;</button>')
    if not film:
        return '<figure class="hero-media">%s</figure><span class="hero-scrim"></span>' % still
    if film.startswith('yt:'):
        vid = film[3:]
        frame = ('<iframe id="hero-video" data-yt="1" src="https://www.youtube.com/embed/%s?autoplay=1&amp;mute=1&amp;loop=1&amp;playlist=%s&amp;controls=0&amp;showinfo=0&amp;modestbranding=1&amp;rel=0&amp;playsinline=1&amp;iv_load_policy=3&amp;disablekb=1&amp;enablejsapi=1" '
                 'title="" tabindex="-1" aria-hidden="true" allow="autoplay; encrypted-media" referrerpolicy="strict-origin-when-cross-origin"></iframe>' % (vid, vid))
        return '<figure class="hero-media">%s%s</figure><span class="hero-scrim"></span>%s' % (still, frame, toggle)
    video = ('<video id="hero-video" autoplay muted loop playsinline preload="metadata" poster="%s" aria-hidden="true">'
             '<source src="%s" type="video/mp4"></video>' % (img, film))
    return '<figure class="hero-media">%s%s</figure><span class="hero-scrim"></span>%s' % (still, video, toggle)


def footer(inner, container=True):
    """The site footer. A live page brings its own `.footer-container` (ep-app brings `.footer-inner` instead), so the
    live build passes container=False and the shell contributes the element and the stylesheet, nothing else."""
    body = '\n  <div class="footer-container">%s</div>\n' % inner if container else '\n%s\n' % inner
    return '<footer class="site-footer">%s</footer>\n' % body


BACK_TO_TOP = '<button id="back-to-top" type="button" title="Back to top" aria-label="Back to top">&#8593;</button>\n'


# ── Classic chrome behaviour: intro, bar, mobile menu, dropdown on touch, sound toggle, back to top. ──
CLASSIC_JS = r"""
(function () {
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var nav = document.getElementById('main-nav');
  var intro = document.getElementById('intro-overlay');
  var mob = document.getElementById('mobile-nav');

  // ── Intro: Enter / Skip Intro, and never twice in one visit (the live site's sessionStorage key) ──
  function openHero() {
    var hero = document.querySelector('section.hero');
    if (!hero) return;
    var stage = function (sel, ms) { var el = hero.querySelector(sel); if (el) setTimeout(function () { el.classList.add('in'); }, ms); };
    stage('.eyebrow', 0); stage('h1.mega', 300); stage('.sub', 900); stage('.rise', 1200);
  }
  function enterSite() {
    if (nav) nav.classList.add('visible');
    document.body.classList.remove('intro-open');
    try { sessionStorage.setItem('atlasglinn_entered', 'true'); } catch (e) {}
    if (intro) { intro.classList.add('hidden'); setTimeout(function () { if (intro.parentNode) intro.parentNode.removeChild(intro); }, 1200); }
    openHero();
  }
  var seen = false; try { seen = !!sessionStorage.getItem('atlasglinn_entered'); } catch (e) {}
  if (!intro || seen || reduce) { enterSite(); }
  else {
    document.body.classList.add('intro-open');
    setTimeout(function () { intro.classList.add('ready'); }, 400);
    document.getElementById('intro-enter').addEventListener('click', enterSite);
    document.getElementById('skip-intro').addEventListener('click', enterSite);
    document.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === 'Escape') enterSite(); });
  }

  // ── Mobile menu ──
  var btn = document.getElementById('nav-toggle'), close = document.getElementById('mobile-nav-close');
  function setMenu(open) {
    if (!mob) return;
    mob.classList.toggle('open', open);
    if (btn) btn.setAttribute('aria-expanded', open);
    document.body.style.overflow = open ? 'hidden' : '';
  }
  if (btn) btn.addEventListener('click', function () { setMenu(!mob.classList.contains('open')); });
  if (close) close.addEventListener('click', function () { setMenu(false); });
  if (mob) mob.addEventListener('click', function (e) { if (e.target.closest('a')) setMenu(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setMenu(false); });

  // A dropdown parent on a touch screen opens its menu on the first tap and follows the link on the second.
  document.querySelectorAll('.nav-dropdown > a').forEach(function (a) {
    a.addEventListener('click', function (e) {
      if (!matchMedia('(hover: none)').matches) return;
      var li = a.parentElement;
      if (!li.classList.contains('open')) { e.preventDefault(); li.classList.add('open'); li.querySelector('.nav-dropdown-menu').style.cssText = 'opacity:1;visibility:visible;transform:translateX(-50%) translateY(0)'; }
    });
  });

  // ── Hero sound toggle — the live #sound-toggle, for a file or for the YouTube player ──
  var vid = document.getElementById('hero-video'), snd = document.getElementById('sound-toggle');
  if (vid && snd) {
    var muted = true;
    var yt = function (fn) { try { vid.contentWindow.postMessage(JSON.stringify({ event: 'command', func: fn, args: [] }), '*'); } catch (e) {} };
    snd.addEventListener('click', function (e) {
      e.stopPropagation();
      muted = !muted;
      if (vid.tagName === 'IFRAME') yt(muted ? 'mute' : 'unMute'); else { vid.muted = muted; if (!muted) vid.play().catch(function () {}); }
      snd.innerHTML = muted ? '&#128263;' : '&#128266;';
      snd.classList.toggle('on', !muted);
      snd.setAttribute('aria-pressed', !muted);
    });
  }

  // ── Back to top ──
  var top = document.getElementById('back-to-top');
  if (top) {
    top.addEventListener('click', function () { scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' }); });
    addEventListener('scroll', function () { top.classList.toggle('show', scrollY > innerHeight * .8); }, { passive: true });
  }
})();
"""


# ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
# The cinematic layer — MAST's front end over the live Atlas pages
#
# Brockmann, 2026-09-08 22:57:31: "These are not same as mastsolutions- or currewnt site = BLAND NO EXCIOTMENT NO 3D",
# and 23:04:11Z: "the actual format. with the front end looks good, but content and everything else doesn't match mass
# solutions or what Atlas Lin had in it." The content half landed (PR #97, the live pages verbatim). This is the other
# half: the trailer's three.js scene, a chapter's own photograph or film full-bleed behind it, entrance motion, the
# progress line and the chapter rail — over live copy that is not touched.
#
# EVERYTHING HERE IS NAMESPACED `agx-`. mastsolutions.html draws its layers on `#three-canvas`, `#photos .ph`,
# `.grain`, `.vignette`, `.progress` and `.chap-link`; on an Atlas page those names are not safe. The live index ships
# its own `#three-canvas { position:absolute }` rule inside the <style> block this build carries verbatim, the live
# stylesheet styles a BARE `nav` selector (26 rules, `transform:translateY(-100%)`), and contact.html already has an
# `ag-contact-form`. `agx-` collides with none of it — measured 0 hits of `\.agx` across shared-styles.css and all
# twelve pages' <style> blocks — so the cinema sheet cannot reach a live element it was not pointed at, and
# assert_cinema_scope() below is the receipt.
CINEMA_CSS = r"""
  /* ── The agx palette, declared ON the agx roots. NOT on :root and NOT via var(--gold).
     Measured 2026-09-09 at 1440x900: `--gold`, `--gold-champagne` and `--text` are UNDECLARED on eleven of the
     twelve pages (they live on the five chrome roots, chrome_css() declares the palette there, and .agx-rail is not
     one of them), so `.agx-rail-link:hover { color:var(--gold-champagne) }` was invalid-at-computed-value-time and
     the active tick computed rgba(0,0,0,0) on executive-protection — invisible. On ep-app, the ONLY page whose own
     :root declares --gold, the same declaration resolved to rgb(201,168,76) — MAST gold on an Atlas page.
     shell._recolor is a literal str.replace over hex tokens and CANNOT rewrite a var() NAME, which is why
     recoloring never caught it. `--agx-` measures 0 hits across all twelve <style> blocks and shared-styles.css. */
  .agx-rail, .agx-hud, #agx-progress, .agx-menu-btn, .agx-sitenav { --agx-blue:#1A6BDE; --agx-blue-l:#5B9BFF; --agx-ink:#F0F4FF; --agx-dim:rgba(240,244,255,.55); }
  /* ── The 3D scene, the backdrop and the film grain: four fixed layers under the content ── */
  #agx-canvas { position:fixed; inset:0; width:100vw; height:100vh; height:100svh; z-index:1; pointer-events:none; }
  #agx-photos { position:fixed; inset:0; z-index:2; pointer-events:none; }
  /* The outgoing photograph leaves faster than the incoming one arrives, so the two never stack to a brighter frame
     mid-switch (Brockmann, 2026-09-04: "the background pulled forward"). */
  /* overflow:hidden because the YouTube backdrop is a 100vw/56.25vw COVER box — 1515px wide in a 393px viewport,
     measured at 393x852 on cuas-aerodefense. The layer that puts it there clips it; the content is not asked to shrink. */
  .agx-ph { position:absolute; inset:0; overflow:hidden; background:center/cover no-repeat; opacity:0; transition:opacity .6s ease; filter:saturate(.72) contrast(1.06); }
  .agx-ph.agx-on { opacity:.42; transition:opacity 1.6s ease .3s; }
  .agx-ph::after { content:''; position:absolute; inset:0; background:linear-gradient(180deg, rgba(5,8,16,.42) 0%, rgba(5,8,16,.08) 45%, rgba(5,8,16,.72) 100%); }
  /* A chapter's backdrop can be the page's own film instead of a still, on the four pages that carry no photograph at
     all (Brockmann, 2026-09-05: "the video should be in the background, just a snippet playing"). Same file, same URL,
     already loaded by the hero — it plays only while its chapter is on screen. */
  .agx-ph video { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; opacity:0; transition:opacity 1.2s ease; }
  .agx-ph video.agx-playing { opacity:1; }
  .agx-ph.agx-film.agx-on { opacity:.58; }
  .agx-ph.agx-yt iframe { position:absolute; top:50%; left:50%; width:100vw; height:56.25vw; min-height:100%; min-width:177.78vh; transform:translate(-50%,-50%); border:0; pointer-events:none; opacity:0; transition:opacity 1.2s ease; }
  .agx-ph.agx-yt iframe.agx-playing { opacity:1; }
  .agx-grain { position:fixed; inset:0; z-index:3; pointer-events:none; opacity:.035; background-image:repeating-linear-gradient(0deg, transparent 0, transparent 2px, rgba(255,255,255,.3) 2px, rgba(255,255,255,.3) 3px); mix-blend-mode:overlay; }
  .agx-vignette { position:fixed; inset:0; z-index:4; pointer-events:none; background:radial-gradient(ellipse at center, transparent 0%, transparent 55%, rgba(5,8,16,.75) 100%); }
  /* ── The read-position line, pinned to the viewport top (it drew on the sticky bar's top edge before r8) ── */
  #agx-progress { position:fixed; top:0; left:0; height:2px; width:0; background:linear-gradient(90deg, #D4AF37, #FCF6BA, #B87333); z-index:1001; box-shadow:0 0 14px rgba(201,168,76,.7); transition:width .1s linear; pointer-events:none; }
  /* ── Chapters: each live section, full-bleed over its own backdrop ──
     display:grid with one 100% column and width:100% on the child, NOT flex: the live sections centre themselves with
     `max-width:1400px; margin:0 auto`, and an auto cross-axis margin in a flex column shrinks the item to fit-content —
     which is the shape of the render P0 that pinned a hero column to the left of the viewport. A definite width keeps
     the auto margins splitting the remainder, so the live layout is exactly what it was. */
  .agx-content { position:relative; z-index:5; counter-reset:agx-chapter; }
  /* scroll-margin-top WAS 72px — the 60px sticky bar plus twelve. THE BAR IS GONE (r8, 2026-09-09), so the only
     fixed thing over a landed heading is the TOP HUD ROW, whose box measures [29,217,19,35] at 1440 (validate-live
     check 6 prints it). 48px is that 35px bottom edge plus thirteen. It was set to 24 first and render-audit check
     4 caught it on the one chapter where the heading sits at the very top of its section: executive-protection
     agx-c5 landed its heading at 30px, four pixels inside the HUD row. One page in twelve, found by the walk and
     not by a screenshot. The shell's `section.panel` scroll-margin never applied here — a live-content page has no
     section.panel; the chapter wrapper is `.agx-ch`. */
  .agx-ch { position:relative; min-height:100vh; min-height:100svh; display:grid; grid-template-columns:100%; align-content:center; counter-increment:agx-chapter; scroll-margin-top:48px; }
  .agx-ch > * { width:100%; }
  .agx-ch::before { content:''; position:absolute; inset:0; z-index:-1; pointer-events:none; background:linear-gradient(180deg, rgba(8,12,20,.58) 0%, rgba(8,12,20,.3) 42%, rgba(8,12,20,.72) 100%); }
  .agx-ch.agx-hero::before { background:none; }
  /* ── The chapter eyebrow: "02 · <the chapter's own heading>", and NOT ONE TEXT NODE ──
     `.agx-ch::before` is taken (the reading scrim above), so this is ::after. The number is a CSS counter and the
     label is `attr(data-agxlabel)`, which means: generated content is not in the DOM text stream, so
     compare-atlas.text_spans() and render-audit's TreeWalker never see it.
     THE ATTRIBUTE IS `data-agxlabel` AND THE MISSING HYPHEN IS THE WHOLE REASON. compare-atlas.attr_spans() reads
     `\b(?:alt|placeholder|value|title|aria-label|label)\s*=` — and `\b` matches between a HYPHEN and a letter, so
     `data-agx-label="Our Services"` is read by that pass as a `label` attribute and lands as a build-only
     attribute unit on every chapter of every page. Measured this turn against the live regex, not assumed:
     `_ATTR.finditer('<div data-agx-label="Our Services">')` returns ['Our Services']. Written without the hyphen
     the preceding character is a word character, there is no boundary, and the pass does not see it. Zero units, zero excuses —
     the same reasoning the HUD already banked, asserted positively by validate-live.py check 5 instead.
     Hidden on the hero, where the hero's own eyebrow is; hidden <=768, where it would sit under the top HUD row.
     A chapter with no heading carries NO attribute at all (_chapters_html omits it) — `[data-agxlabel]` matches
     an EMPTY attribute, so an empty label would print a bare "02 · ". */
  .agx-ch[data-agxlabel]:not(.agx-hero)::after { content:counter(agx-chapter, decimal-leading-zero) " · " attr(data-agxlabel); position:absolute; top:calc(1.2rem + env(safe-area-inset-top,0px)); left:calc(1.8rem + env(safe-area-inset-left,0px)); font-family:'Share Tech Mono',monospace; font-size:.6rem; letter-spacing:.35em; text-transform:uppercase; color:rgba(240,244,255,.45); text-shadow:0 1px 10px rgba(0,0,0,.9); pointer-events:none; z-index:6; }
  @media (max-width:768px) { .agx-ch[data-agxlabel]:not(.agx-hero)::after { display:none; } }
  /* Entrance motion. The opacity rule is gated on a class the script adds at boot, so a page whose JS never runs —
     or whose IntersectionObserver never fires — shows every chapter at full strength. Nothing on an Atlas page is
     allowed to be invisible because a script did not arrive. */
  html.agx-motion .agx-ch { opacity:0; transform:translateY(26px); transition:opacity 1s cubic-bezier(.25,.6,.25,1), transform 1s cubic-bezier(.25,.6,.25,1); }
  html.agx-motion .agx-ch.agx-in { opacity:1; transform:translateY(0); }
  html.agx-motion { scroll-behavior:smooth; }
  /* ── Chapter rail: MAST's, WITH ITS NUMBERED LABELS STANDING, and the right gutter that buys them ──
     Brockmann, 2026-09-09 17:12: "Menu should be like the mastsolutions menu side bar?" MAST paints
     "01 · OPENING" … "13 · CONTACT" at rest, and it pays for them with `section.panel { padding-right:16.5rem }`
     (cinematic_shell.py:229, read this turn). r4-r6 built the labels, measured what they cost over live copy, and shipped them
     hover-only rather than take the gutter — three rounds of "his call, not this build's" on a question nobody
     asked him. THE GUTTER IS TAKEN NOW, on ATLAS's decision 2026-09-10, because "like the MAST sidebar" already
     contains it: a standing rail and an untouched full-width column cannot both exist, and he asked for the rail.
     A <div>, never a <nav> — the live stylesheet styles a bare `nav` and would fix it to the top and slide it away.
     right:1.5rem is MAST's own value (cinematic_shell.py:72) AND the live bar's own right inset: measured
     2026-09-09, the bar's right-most control ends at 1416px at 1440 and 1256px at 1280, both exactly viewport-24px,
     so the rail's right edge lines up with the bar's at every width it shows. r4-r6 kept it at .45rem to steal
     3px of clearance from his copy; with the gutter there is nothing to steal it from.
     THE NUMBER IS A CSS COUNTER, NOT A TEXT NODE. `01 · ` printed as markup would be a text unit no live page
     carries, and it would break the rail-label excuse in compare-atlas.rail_anchors(), which matches
     clean(anchor text) == a heading of the chapter it points at. Generated content is not in the DOM text stream,
     so text parity stays where it was and render-audit's TreeWalker never sees it. decimal-leading-zero gives the
     same two-digit padding assemble-cinematic prints for MAST. */
  .agx-rail { position:fixed; right:1.5rem; top:50%; transform:translateY(-50%); z-index:900; display:none; flex-direction:column; gap:.4rem; align-items:flex-end; font-family:'Share Tech Mono',monospace; font-size:.6rem; counter-reset:agx-ch; }
  .agx-rail-link { counter-increment:agx-ch; display:flex; align-items:center; justify-content:flex-end; gap:.5rem; padding:.32rem .4rem; color:var(--agx-ink); font-weight:700; letter-spacing:.25em; text-transform:uppercase; text-decoration:none; text-shadow:0 1px 10px rgba(0,0,0,.9); border:1px solid transparent; transition:color .3s, border-color .3s, background .3s; }
  .agx-rail-link::before { content:counter(agx-ch, decimal-leading-zero) " ·"; color:var(--agx-dim); flex:none; max-width:0; overflow:hidden; opacity:0; white-space:nowrap; transition:max-width .35s ease, opacity .35s ease; }
  .agx-rail-link span { max-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; opacity:0; transition:max-width .35s ease, opacity .35s ease; }
  /* The tick stays in ::after, on the anchored right edge, where MAST puts it on its own anchored edge
     (cinematic_shell.py:75 uses ::before because .chapter-nav reads left-to-right off the same side). Deliberate:
     render-audit.mjs and the label-clamp measurement both key off ::after. */
  .agx-rail-link::after { content:''; width:17px; height:2px; flex:none; background:rgba(240,244,255,.5); box-shadow:0 1px 6px rgba(0,0,0,.9); transition:width .3s, background .3s; }
  .agx-rail-link:hover { color:var(--agx-blue-l); border-color:rgba(26,107,222,.35); background:rgba(5,8,16,.7); }
  .agx-rail-link:hover::before { max-width:3.6rem; opacity:1; }
  /* 20.5rem = 328px, the MEASURED maximum + 1px: the widest of the 77 labels of the 79 rail links (2 are label-less
     ticks) is uas ch4's "No Pilot Required. No Gaps in Coverage ." at 327px in Chromium at 1440x900. At 13rem
     (208px) FOURTEEN of the 77 were cut mid-word with no ellipsis, and `text-overflow` computed `clip` on all 77.
     IT IS THE HOVER CLAMP, not the standing one: the standing label is cut to 9.5rem below so the whole
     rail fits the gutter, and hovering one link opens it to its full width the way MAST's never has to. */
  .agx-rail-link:hover span { max-width:20.5rem; opacity:1; }
  .agx-rail-link.agx-active { color:var(--agx-blue-l); }
  .agx-rail-link:hover::after, .agx-rail-link.agx-active::after { width:30px; background:var(--agx-blue); box-shadow:0 0 10px rgba(26,107,222,.6); }
  /* Hidden <=768 and ticks 769-1024: the same behaviour MAST has at those widths (cinematic_shell.py:220-223 /
     mastsolutions.html:618 — display:none at 390, 0 of 13 labelled at 900 and 1024). Unchanged, AND THE GUTTER
     DOES NOT REACH THEM: the phone keeps the live layout at its own full width and the 15px body floor with it. */
  @media (min-width:769px) { .agx-rail { display:flex; } }
  @media (min-width:769px) and (max-width:1024px) { .agx-rail { right:.8rem; gap:.35rem; } .agx-rail-link { padding:.3rem .4rem; gap:0; } .agx-rail-link::before { display:none; } .agx-rail-link::after { width:16px; } .agx-rail-link:hover::after, .agx-rail-link.agx-active::after { width:22px; } }
  /* ── >=1025: THE STANDING SIDEBAR AND ITS GUTTER, one media block so the two can never be shipped apart ──
     THE GUTTER IS ON `.agx-ch > *`, WHICH IS WHERE MAST PUTS ITS OWN (`section.panel`, cinematic_shell.py:229) and
     it is the one cinema selector already declared as reaching a live element (validate-live.py check 2's
     CINEMA_CONTENT_OK, the rule that sets width:100% so the live `margin:0 auto` centring survives). It was built
     on `.agx-content` first — the wrapper — and the screenshot killed it: the live sections carry their OWN opaque
     backgrounds, so padding the wrapper stopped every section's background at x=1160 in a 1440 viewport and left a
     lit vertical seam down the rail lane where the backdrop photograph showed through (measured on ep-app ch4 at
     1440, scrollY 3159). Padding the SECTION moves its copy and keeps its background full-bleed, so the rail sits
     over the page's own surface exactly as MAST's does. `box-sizing:border-box` is the live pages' own first rule
     (index.html:22 `* { margin:0; padding:0; box-sizing:border-box }`), so `width:100%` plus this padding is still
     100% and there is no horizontal overflow at any width — asserted, not assumed, by render-audit check 7's
     gutter row.
     `!important` IS TAKEN HERE AND THE REASON IS AN INLINE STYLE, WHICH IS THE ONLY THING IT IS EVER TAKEN FOR IN
     THIS BUILD (the skin takes it on the same grounds against the live tilt script). Two of the twelve pages carry
     a `padding-right` inside a live section's own `style=` attribute — index.html:901 `<section class="section"
     id="app" style="…padding-right: 2rem">` and technology.html's `id="cuas"` — and an inline declaration beats
     any stylesheet rule at any specificity. Measured without it: those two sections computed padding-right 32px
     while the other eight on the page computed 280px, and render-audit's own gutter row failed the run with
     `rail 238px wide inside a 32px section gutter` on index at all four widths. Grepped across the twelve pages,
     `<section … style="… padding-right|padding:">` returns exactly those two.
     THE FOOTER TAKES THE SAME GUTTER, IN CLASSIC_CSS, AND assert_rail_gutter() ASSERTS THE TWO NUMBERS ARE EQUAL.
     `footer.site-footer` is chrome, not content — it sits outside .agx-content, so this rule cannot reach it, and
     the rail is fixed to the middle of the VIEWPORT, so at the foot of every page its labels stood across the
     footer's own columns: "2450 Fondren Rd, Suite 255" on executive-protection at 1440 and the "Connect" heading
     at 1025 among them, 1-2 runs a page over the walk. MAST never had this to solve — it has no footer, its last
     panel IS the contact panel and the gutter is already on it.
     THE THREE NUMBERS ARE ARITHMETIC, NOT TASTE, and assert_rail_gutter() below fails the build if they stop
     adding up: gutter >= 1.5rem offset + .4rem padding + 3.6rem number-clamp + .5rem gap + LABEL + .5rem gap +
     17px tick + .4rem padding. At LABEL=9.5rem that is 279.4px of rail, so the gutter is 17.5rem (280px) and not
     MAST's 16.5rem: MAST's labels are the word OPENING and Atlas's are the live page's own headings, so its
     figure is the reference and one extra rem is what this rail needs. Written the other way round — clamping
     the label to 8.5rem to land on 16.5rem exactly — buys back 16px of column for two fewer characters of label,
     and the guard would pass either. Measured after it shipped (render-audit check 7, 0.75-viewport walk, twelve
     pages): live text runs under the standing rail 0 at 1025, 0 at 1280, 0 at 1440, 0 at 1800 — against 92 for
     the same labels standing with no gutter. The label that no longer fits is cut by `text-overflow:ellipsis`
     and opens to its full 20.5rem under the pointer. */
  @media (min-width:1025px) {
    .agx-ch > * { padding-right:17.5rem !important; }
    .agx-rail-link::before { max-width:3.6rem; opacity:1; }
    .agx-rail-link span { max-width:9.5rem; opacity:1; }
  }
  @media (prefers-reduced-motion: reduce) { html.agx-motion .agx-ch { opacity:1; transform:none; transition:none; } html.agx-motion { scroll-behavior:auto; } }
  /* ── HUD: MAST's FOUR corners (cinematic_shell.py:78-83 and :615-616, read this turn) — tl the brand line and a
     link home, tr the chapter the reader is in, bl the Houston coordinates, br "DETAILS MATTER", which is also the
     live <h1> on eleven of the twelve. The two bottom literals are MAST's own strings, carried under the
     site-consistency rule. ALL FOUR LINES ARE CSS `content`, NOT TEXT NODES — a printed "SECTION 02 / 08" is a build-only text
     unit, and the old unanchored `NN / NN` excuse was DROPPED from compare-atlas.py in R4-4 precisely because "an
     excuse nothing spends is a hole nothing guards". Generated content adds no unit, so text parity is unchanged
     and no excuse is needed at all; the HUD is asserted POSITIVELY instead, by computed ::before content in
     scripts/validate-live.py check 5.
     right:8.5rem on .agx-hud-tr is MAST's own value under its own sitenav (cinematic_shell.py:706, `.hud.tr {
     right:8.5rem }`) and it is what clears the MENU button; validate-live check 6 measures that pair.
     right:5.2rem on the bottom corners, not 1.5rem: #back-to-top is a fixed 46px button at l:1378 r:1424 t:848 b:894 with z-index:900
     (measured 1440x900), and 1.5rem would put the counter under it. 5.2rem clears it by 21px. Hidden below 1025 —
     phones and tablets carry the MENU overlay and the ticks and nothing else (the bar is gone, r8 2026-09-09).
     ── THE LANE GATE, AND THE MEASUREMENT THAT FORCED IT (r5, 2026-09-09) ──
     The rail was walked before it shipped and the HUD was not, and it is FIXED, so the reader's own copy scrolls
     underneath it. render-audit.mjs's walk, pointed at the two corners instead of the rail, measured 33 live text
     runs covered across the twelve pages — .agx-hud-bl [26,213,866,882] printing through
     "Dedicated personal protection officers providing" [86,288,866,883] on executive-protection at 1440 among them.
     A bottom padding on .agx-content cannot fix it: the element is fixed to the VIEWPORT, so padding at the end of
     the document only clears the last screenful and every screenful above it still passes under the corner.
     So the HUD gives way instead. CINEMA_JS measures, per frame the page scrolls, whether a visible line box OR a
     painted surface that is not a full-bleed band is inside a corner's own box, and adds .agx-clear if one is.
     The painted-surface pass is r6's: the line-box pass alone printed the brand line across a solid blue PARTNER
     PAGE button on technology at 1280 (scrollY 1645, button [32,238,730,781], corner [26,213,766,782], agx-clear
     FALSE) and put both corners inside .feature-card and .discipline-card boxes on ep-app and training. The hide is INSTANT and the return is a .3s fade
     after a .2s hold, which is also what stops it flickering on a fast scroll. The gate is the thing that makes
     the HUD legitimate, so `html.agx-hudgate` — a class the gate adds to itself — is what turns the HUD on:
     a page whose script never ran prints no HUD at all rather than printing one across a sentence. */
  .agx-hud { position:fixed; z-index:899; display:none; font-family:'Share Tech Mono',monospace; font-size:.62rem; letter-spacing:.3em; text-transform:uppercase; opacity:.62; pointer-events:none; text-shadow:0 1px 10px rgba(0,0,0,.9); transition:opacity .3s ease .2s; }
  .agx-hud.agx-clear { opacity:0; transition:opacity 0s; }
  .agx-hud-tl { top:calc(1.2rem + env(safe-area-inset-top,0px)); left:calc(1.8rem + env(safe-area-inset-left,0px)); color:var(--agx-blue-l); pointer-events:auto; text-decoration:none; }
  .agx-hud-tr { top:calc(1.2rem + env(safe-area-inset-top,0px)); right:calc(8.5rem + env(safe-area-inset-right,0px)); color:var(--agx-dim); }
  .agx-hud-bl { bottom:calc(1.15rem + env(safe-area-inset-bottom,0px)); left:calc(1.6rem + env(safe-area-inset-left,0px)); color:var(--agx-dim); }
  .agx-hud-br { bottom:calc(1.15rem + env(safe-area-inset-bottom,0px)); right:calc(5.2rem + env(safe-area-inset-right,0px)); color:var(--agx-blue-l); }
  .agx-hud-tl::before { content:"ATLAS GLINN · HOUSTON"; }
  .agx-hud-tr::before { content:"SECTION " attr(data-n) " / " attr(data-of); }
  .agx-hud-bl::before { content:"HOU · 29.7604°N · 95.3698°W"; }
  .agx-hud-br::before { content:"DETAILS MATTER"; }
  @media (min-width:1025px) { html.agx-hudgate .agx-hud { display:block; } }
  /* The top-left brand line is the only navigation-adjacent affordance below 1025 besides MENU, so it shows from 0
     while the other three stay >=1025 — exactly MAST (cinematic_shell.py:234 hides .hud.tr/.bl/.br at <=768 and
     keeps .tl). Same specificity as the rule above and later in source, so it wins at every width. */
  html.agx-hudgate .agx-hud-tl { display:block; }
  /* ── THE MENU BUTTON AND THE FULL-SCREEN OVERLAY ──
     Every selector is anchored to .agx-, matches nothing inside .agx-content, and is therefore covered by
     assert_cinema_scope() and validate-live check 2 without adding a name to CINEMA_CONTENT_OK.
     THE CLOSED STATE IS `visibility`, NOT `opacity`, ON THE CONTAINER: the MENU button lives INSIDE the overlay
     (see atlas_shell.sitenav() for why — the live "☰" unit sits between the bar's links and the mobile menu's "×"
     and text parity is order-sensitive), and an ancestor opacity:0 makes every descendant transparent with no way
     out. visibility is the one property a child can take back, so the fade is on the scrim and the two panels and
     the button re-declares visibility:visible. */
  .agx-menu-btn { position:fixed; visibility:visible; top:calc(.95rem + env(safe-area-inset-top,0px)); right:calc(1.5rem + env(safe-area-inset-right,0px)); z-index:9500; font-family:'Share Tech Mono',monospace; font-size:.65rem; letter-spacing:.35em; text-transform:uppercase; color:var(--agx-blue-l); background:rgba(5,8,16,.55); border:1px solid rgba(26,107,222,.4); padding:.5rem .9rem .5rem 1.1rem; cursor:pointer; backdrop-filter:blur(8px); }
  .agx-menu-btn:hover { background:rgba(26,107,222,.12); border-color:var(--agx-blue); }
  .agx-sitenav { position:fixed; inset:0; z-index:9400; visibility:hidden; overflow-y:auto; }
  .agx-sitenav.agx-open { visibility:visible; }
  .agx-sitenav-scrim { position:fixed; inset:0; background:rgba(5,8,16,.94); backdrop-filter:blur(14px); opacity:0; transition:opacity .35s; }
  .agx-sitenav.agx-open .agx-sitenav-scrim { opacity:1; }
  .agx-sitenav-in { position:relative; z-index:1; width:min(980px,100%); margin:0 auto; padding:5rem 1.5rem 0; opacity:0; transition:opacity .35s; }
  .agx-sitenav-tail { padding:0 1.5rem 4rem; }
  .agx-sitenav.agx-open .agx-sitenav-in { opacity:1; }
  .agx-sitenav ul { list-style:none; margin:0; padding:0; }
  .agx-sitenav-logo { display:flex; align-items:center; gap:.7rem; text-decoration:none; margin-bottom:1.6rem; }
  .agx-sitenav-logo img { height:40px; width:auto; }
  .agx-sitenav-brand { font-family:'Orbitron',sans-serif; font-weight:700; font-size:.95rem; letter-spacing:.14em; color:var(--agx-blue-l); }
  .agx-sitenav-close { position:fixed; top:calc(.95rem + env(safe-area-inset-top,0px)); left:calc(1.5rem + env(safe-area-inset-left,0px)); z-index:9500; background:none; border:1px solid rgba(26,107,222,.4); color:var(--agx-ink); font-size:1.4rem; line-height:1; padding:.05rem .55rem .2rem; cursor:pointer; }
  .agx-sitenav-main { display:grid; grid-template-columns:1fr 1fr; gap:.2rem 2rem; }
  .agx-sitenav-main > li > a { display:block; padding:.75rem 0; font-family:'Orbitron',sans-serif; font-weight:700; font-size:clamp(1rem,1.6vw,1.25rem); letter-spacing:.06em; color:#F0F4FF; text-decoration:none; border-bottom:1px solid rgba(26,107,222,.18); transition:color .25s, padding-left .25s; }
  .agx-sitenav-main > li > a:hover, .agx-sitenav a.agx-here { color:var(--agx-blue-l); padding-left:.4rem; }
  .agx-sitenav-main a.agx-cta { background:linear-gradient(135deg,#1A6BDE 0%,#0F4AA8 100%); border:1px solid rgba(91,155,255,.55); color:#fff; padding:.75rem 1.1rem; }
  .agx-sitenav-drop { padding-left:1.1rem; }
  .agx-sitenav-drop a { display:block; padding:.35rem 0; font-family:'Share Tech Mono',monospace; font-size:.68rem; letter-spacing:.2em; text-transform:uppercase; color:#8FBBFF; text-decoration:none; }
  .agx-sitenav-drop small { display:block; font-size:.58rem; letter-spacing:.16em; color:rgba(240,244,255,.5); }
  .agx-sitenav-i { margin-right:.5rem; }
  .agx-sitenav-index, .agx-sitenav-extra { display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:.15rem 1.6rem; margin-top:1.6rem; }
  .agx-sitenav-index a, .agx-sitenav-extra a { display:block; padding:.42rem 0; font-family:'Share Tech Mono',monospace; font-size:.66rem; letter-spacing:.22em; text-transform:uppercase; color:rgba(240,244,255,.72); text-decoration:none; }
  .agx-sitenav-index a:hover, .agx-sitenav-extra a:hover { color:var(--agx-blue-l); }
  /* The two list headings are generated content: zero text units, nothing to excuse, and validate-live check 5
     asserts them POSITIVELY — the same discipline the HUD corners already bank. */
  .agx-sitenav-index::before { content:"QUICK INDEX"; grid-column:1/-1; font-family:'Share Tech Mono',monospace; font-size:.58rem; letter-spacing:.4em; color:rgba(240,244,255,.4); padding-bottom:.4rem; }
  .agx-sitenav-extra::before { content:"ALL PAGES"; grid-column:1/-1; font-family:'Share Tech Mono',monospace; font-size:.58rem; letter-spacing:.4em; color:rgba(240,244,255,.4); padding-bottom:.4rem; }
  @media (max-width:768px) { .agx-sitenav-main { grid-template-columns:1fr; } .agx-sitenav-in { padding:4.5rem 1.2rem 0; } .agx-sitenav-tail { padding:0 1.2rem 3rem; } .agx-menu-btn { right:1rem; top:.8rem; } .agx-sitenav-close { left:1rem; top:.8rem; } }
  @media (max-width:768px) { .agx-ph.agx-on { opacity:.35; } .agx-ph.agx-film.agx-on { opacity:.5; } .agx-ch { min-height:auto; } }
"""

# The five roots the cinema layer owns. Every selector in CINEMA_CSS has to name one of them, so the sheet cannot
# reach a live element: the only content it touches is the wrapper this build put there itself.
CINEMA_TOKENS = ('#agx-', '.agx-', 'html.agx-motion')


def assert_cinema_scope(css):
    """Raise on any selector that is not anchored to the cinema layer. Returns the selectors checked."""
    import atlas_live as live
    sels = live.audit_chrome_css(live._COMMENT.sub('', css))
    loose = [s for s in sels if not any(tok in re.split(r'[\s>+~]', s.strip())[0] for tok in CINEMA_TOKENS)]
    assert not loose, 'cinema CSS reaches outside the cinema layer: %s' % loose[:6]
    return sels


# The rail lane, read OFF THE SHEET and added up. A standing sidebar and the gutter that clears it are one
# decision, and r4-r6 proved a comment cannot hold two numbers in agreement: the gutter is what keeps the labels
# off his copy, so a label clamp raised past the gutter — or a gutter deleted while the labels stay standing — has
# to fail the build rather than fail a screenshot. Everything here is parsed from CINEMA_CSS's own >=1025 block and
# from the rail rules above it; nothing is a constant restated in Python, which is the drift this repo keeps paying
# for. Returns (gutter_px, rail_px) so the build prints the clearance instead of asserting it silently.
_REM = 16.0
_LEN = re.compile(r'(-?[\d.]+)(rem|px)')
_COMMENTS = re.compile(r'/\*.*?\*/', re.S)


def _px(v):
    m = _LEN.fullmatch(v.replace('!important', '').strip())
    assert m, 'not a length this guard can read: %r' % v
    return float(m.group(1)) * (_REM if m.group(2) == 'rem' else 1.0)


def _decl(block, sel, prop):
    m = re.search(re.escape(sel) + r'\s*\{([^}]*)\}', block)
    assert m, 'no rule %r in the >=1025 block' % sel
    d = re.search(re.escape(prop) + r'\s*:\s*([^;}]+)', m.group(1))
    assert d, 'no %s on %r' % (prop, sel)
    return d.group(1).strip()


def assert_rail_gutter(css):
    """The gutter clears the rail it was cut for, in px, off the sheet itself. Raises if it does not."""
    css = re.sub(r'/\*.*?\*/', '', css, flags=re.S)
    m = re.search(r'@media \(min-width:1025px\) \{(.*?)\n  \}', css, re.S)
    assert m, 'the >=1025 standing-rail block is gone: the labels cannot stand without it'
    block = m.group(1)
    gutter = _px(_decl(block, '.agx-ch > *', 'padding-right'))
    label = _px(_decl(block, '.agx-rail-link span', 'max-width'))
    assert _decl(block, '.agx-rail-link span', 'opacity') == '1', 'the standing label is not opaque at rest'
    assert _decl(block, '.agx-rail-link::before', 'opacity') == '1', 'the standing chapter number is not opaque at rest'
    assert _px(_decl(block, '.agx-rail-link::before', 'max-width')) > 0, 'the standing chapter number has no width'
    base = css[:m.start()]
    offset = _px(_decl(base, '.agx-rail', 'right'))
    pad = _decl(base, '.agx-rail-link', 'padding').split()
    gap = _px(_decl(base, '.agx-rail-link', 'gap'))
    num = _px(_decl(base, '.agx-rail-link:hover::before', 'max-width'))
    tick = _px(_decl(base, '.agx-rail-link::after', 'width'))
    rail = 2 * _px(pad[1]) + num + gap + label + gap + tick
    assert offset == 1.5 * _REM, 'the rail is at %gpx, not the 1.5rem MAST and the bar both use' % offset
    # The footer is chrome and its gutter lives in CLASSIC_CSS, so the two numbers are in two sheets and would
    # drift the first time one of them was tuned. They are compared here instead of being described as equal.
    foot = re.search(r'@media \(min-width:1025px\) \{ \.site-footer \{([^}]*)\}', _COMMENTS.sub('', CLASSIC_CSS))
    assert foot, 'the footer no longer takes the rail gutter above 1025 — the rail stands over the footer columns'
    fpx = _px(re.search(r'padding-right\s*:\s*([^;}]+)', foot.group(1)).group(1))
    assert fpx == gutter, ('the footer gutter is %gpx and the section gutter is %gpx; the rail needs the same lane '
                           'clear on both' % (fpx, gutter))
    assert gutter >= rail + offset, ('the %grem gutter does not clear the rail: %gpx of rail + %gpx offset = %gpx'
                                     % (gutter / _REM, rail, offset, rail + offset))
    return gutter, rail + offset


def cinema_css(mono_family='Inconsolata'):
    """The cinema sheet in the Atlas palette, with the chrome's small caps taken from the font the page already loads."""
    css = shell._recolor(CINEMA_CSS, shell.ATLAS)
    css = css.replace("'Share Tech Mono',monospace", "'%s',monospace" % mono_family)
    assert_cinema_scope(css)
    assert_rail_gutter(css)
    return css


# ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
# THE CONTENT SKIN — the ONE declared exception to "the shell's CSS never reaches the content"
#
# atlas_live.py's header states the rule and names its receipt: chrome_css() drops every content rule by name so the
# live body rule, the live type scale and the live components win. That rule is unchanged and the chrome sheet still
# may not reach a content element. This sheet MAY, and it is the only one that may — that is why it is a SEPARATE
# block with its own assert instead of extra lines in CINEMA_CSS, and why validate-live.py asserts the two sheets by
# name and to opposite conclusions.
#
# THE BOUNDS, MECHANICALLY ENFORCED BY assert_skin_scope() BELOW, NOT BY PROMISE:
#   1. Every selector begins `.agx-content ` — the wrapper _chapters_html() puts there itself.
#   2. NO font-size and NO font-family anywhere, on anything. That is ledger K-3 / F-1 ("same font and sizes … no
#      changes to anything", seven heading sizes that stay) turned into a build failure rather than a review note.
#      The .agx- elements this sheet draws itself (.agx-icon) are exempt by name, and nothing else is.
#   3. NO gold literal and no --gold reference. Gold is MAST's brand colour. The inverse is NOT true and must not be
#      "fixed": eleven live pages border their own cards in rgba(201,168,76,.6) and ep-app's own :root declares
#      --gold — that is the LIVE page's design, it is carried byte for byte, and repainting it would be a content
#      change nobody asked for. This sheet INTRODUCES no gold; it does not remove the page's own.
#   4. The card hover is COPIED from cinematic_shell, not invented (the site-consistency rule). cinematic_shell.py
#      must stay byte-identical and Atlas pages must not use MAST's class names, so the two declarations are copied
#      verbatim and assert_shared_hover() fails the Atlas build if MAST's ever change out from under them.
AGX_SKIN_MARK = '/* AGX-SKIN v1 */'
SHARED_HOVER_TRANSITION = 'transition:transform .45s, border-color .45s, box-shadow .45s;'
SHARED_HOVER_LIFT = 'transform:translateY(-6px);'
_SHARED_HOVER_SRC = ('.tile, .tier, .gear-card { %s }' % SHARED_HOVER_TRANSITION,
                     '.tile:hover, .tier:hover, .gear-card:hover { %s }' % SHARED_HOVER_LIFT)


def assert_shared_hover():
    """The skin's hover is MAST's hover. Read it out of cinematic_shell at build time so a change there fails HERE
    instead of silently forking the two sites' card behaviour.

    IT PROVES THE TWO SHEETS AGREE AND NOTHING MORE, and saying otherwise is what let the first pass ship
    "the hover lifts 6px over .45s" while four pages rendered -4px over 0.2s with a gold glow. What the page
    actually does on hover is measured in a browser — render-audit.mjs check 8 — never grepped out of a source
    string. See assert_tilt_override() below for the inline-style defect this comment used to hide."""
    src = shell.CSS_A + shell.CSS_B
    for line in _SHARED_HOVER_SRC:
        assert line in src, 'the shared card hover moved in cinematic_shell.py: ' + line
    return _SHARED_HOVER_SRC


# The classes the live tail script writes inline transform/transition/box-shadow onto. Read out of the page's own
# script by assert_tilt_override() rather than typed here, so a capture that grows a class fails the build instead
# of quietly rendering MAST gold on a surface this sheet paints blue.
_TILT_MARK = 'UNIVERSAL 3D TILT'
_TILT_SEL = re.compile(r"querySelectorAll\('([^']+)'\)\.forEach\(\s*card")
SKIN_TILT_CLASSES = ('service-card', 'testimonial', 'app-tier', 'pillar-card', 'scenario-card', 'discipline-card',
                     'capability-card', 'threat-card', 'blog-link-card', 'cap-card', 'team-card', 'benefit-card',
                     'job-card')
TILT_TRANSITION = 'transform .45s, border-color .45s, box-shadow .45s !important'
TILT_LIFT = 'transform:translateY(-6px) !important'


def tilt_classes(scripts):
    """Every class the live 3D-tilt script reaches for, as the page writes it. () when the page carries no tilt."""
    for body in scripts:
        if _TILT_MARK not in body:
            continue
        m = _TILT_SEL.search(body, body.index(_TILT_MARK))
        assert m, 'the tilt script no longer takes its cards through querySelectorAll(...).forEach(card'
        return tuple(s.strip().lstrip('.') for s in m.group(1).split(','))
    return ()


def assert_tilt_override(slug, scripts, content_html):
    """Every tilt class that MATCHES AN ELEMENT on this page must be one the skin overrides with !important.

    Returns (classes the script names, classes that match an element here). A class the script names but that
    matches nothing is reported and not required — `.tech-partner` and `.position-card` measure 0 on all twelve
    captures, and a skin rule for them would be a rule validate-live.py check 3b fails as unspent."""
    named = tilt_classes(scripts)
    live_here = tuple(c for c in named if re.search(r'class="[^"]*\b%s\b' % re.escape(c), content_html))
    missed = [c for c in live_here if c not in SKIN_TILT_CLASSES]
    assert not missed, ('%s: the tilt script writes an inline transform on %s and the skin does not override it — '
                        'that card renders the script\'s -4px/0.2s hover and its rgba(201,168,76) glow, not this '
                        'sheet\'s' % (slug, missed))
    for c in live_here:
        assert '.agx-content .%s:hover' % c in AGX_SKIN_CSS, '%s: no skin hover rule for .%s' % (slug, c)
    return named, live_here


# Every class below was enumerated from the twelve captures' own <style> blocks and markup, never guessed. Two names
# the first enumeration carried are NOT here and the reason is measured: `.cred-tag` (3 spans) and `.cta-nav-btn`
# (1 anchor) sit in ep-app's FOOTER and NAV — the chrome, outside .agx-content — so a `.agx-content .cred-tag` rule
# would match nothing on any page, and validate-live.py check 3b fails a skin selector no page spends.
AGX_SKIN_CSS = r"""
/* AGX-SKIN v1 */
  /* ---- 1. GLASS SURFACE on every card class the twelve live pages actually declare ---- */
  .agx-content .service-card, .agx-content .pillar-card, .agx-content .scenario-card,
  .agx-content .discipline-card, .agx-content .capability-card, .agx-content .threat-card,
  .agx-content .blog-link-card, .agx-content .cap-card, .agx-content .how-step,
  .agx-content .team-card, .agx-content .testimonial, .agx-content .job-card,
  .agx-content .benefit-card, .agx-content .video-card, .agx-content .app-tier,
  .agx-content .feature-card, .agx-content .audience-card, .agx-content .pricing-card,
  .agx-content .hw-card, .agx-content .legal-card {
    background:rgba(11,18,33,.55); backdrop-filter:blur(10px); -webkit-backdrop-filter:blur(10px);
    border-color:rgba(26,107,222,.28); position:relative; isolation:isolate;
    transition:transform .45s, border-color .45s, box-shadow .45s;
  }
  /* The 1px inner top highlight and the lifted edge. ::before is used on nine of these classes by the live pages
     themselves (the scaleX(0) top bar), so the skin's edge is drawn with box-shadow and owns no pseudo-element. */
  .agx-content .service-card, .agx-content .pillar-card, .agx-content .scenario-card,
  .agx-content .discipline-card, .agx-content .capability-card, .agx-content .threat-card,
  .agx-content .blog-link-card, .agx-content .cap-card, .agx-content .team-card,
  .agx-content .testimonial, .agx-content .job-card, .agx-content .benefit-card,
  .agx-content .video-card, .agx-content .app-tier, .agx-content .feature-card,
  .agx-content .audience-card, .agx-content .pricing-card, .agx-content .hw-card,
  .agx-content .legal-card {
    box-shadow:inset 0 1px 0 rgba(255,255,255,.08), 0 4px 24px rgba(0,0,0,.34);
  }
  /* ---- 2. THE SHARED HOVER (cinematic_shell.py:133, verbatim) + the radial blue glow ----
     0,3,0 beats every live `.x:hover` at 0,2,0. .featured is restored at 0,4,0 below so the ep-app pricing
     highlight keeps its own deeper lift. */
  .agx-content .service-card:hover, .agx-content .pillar-card:hover, .agx-content .scenario-card:hover,
  .agx-content .discipline-card:hover, .agx-content .capability-card:hover, .agx-content .threat-card:hover,
  .agx-content .blog-link-card:hover, .agx-content .cap-card:hover, .agx-content .how-step:hover,
  .agx-content .team-card:hover, .agx-content .testimonial:hover, .agx-content .job-card:hover,
  .agx-content .benefit-card:hover, .agx-content .video-card:hover, .agx-content .app-tier:hover,
  .agx-content .feature-card:hover, .agx-content .audience-card:hover, .agx-content .pricing-card:hover,
  .agx-content .hw-card:hover, .agx-content .legal-card:hover {
    transform:translateY(-6px);
    border-color:rgba(26,107,222,.62);
    background:radial-gradient(120% 130% at 50% 0%, rgba(26,107,222,.16) 0%, rgba(26,107,222,.04) 45%, rgba(11,18,33,.62) 100%);
    box-shadow:inset 0 1px 0 rgba(255,255,255,.12), 0 18px 52px rgba(0,0,0,.5), 0 0 44px rgba(26,107,222,.24);
  }
  .agx-content .pricing-card.featured:hover { transform:translateY(-14px); }
  /* ---- 2b. THE TILT OVERRIDE — the one place this sheet is allowed !important, and the measurement that earned it.
     Eleven of the twelve live pages carry a tail script the build keeps byte for byte:

       // ── UNIVERSAL 3D TILT ON ALL CARDS ──
       document.querySelectorAll('.service-card, .testimonial, .benefit-card, .tech-partner, .discipline-card,
         .app-tier, .position-card').forEach(card => {
           card.style.transition = 'transform 0.2s ease-out, box-shadow 0.3s ease';
           ... on mousemove: card.style.transform = `perspective(800px) rotateY(..) rotateX(..) translateY(-4px) scale(1.02)`;
                             card.style.boxShadow = '0 25px 60px rgba(0,0,0,0.6), 0 0 40px rgba(201,168,76,0.25), ...';

     Those are INLINE styles, and an inline style beats a stylesheet rule at any specificity. So on every page but
     ep-app the shipped hover was the script's -4px over 0.2s with a 1.02 scale, and the shipped hover GLOW was
     rgb(201,168,76) — MAST gold — inside this sheet's blue border. Measured in the browser, not read off the CSS:
     index/.app-tier, executive-protection/.service-card, technology/.service-card and training/.service-card all
     computed `rgba(201,168,76,0.25) 0 0 40px` after a real hover. The gold is the LIVE page's own and is carried
     deliberately (bound 3 above); what could not stand is a card this sheet paints blue lighting up gold.
     THE THIRTEEN CLASSES BELOW ARE THE MEASURED INTERSECTION, and the count is measured because a first pass at
     this override typed FIVE of them from one page's script and assert_tilt_override() stopped the build on page
     three with residential-protection's .pillar-card. The selector list is NOT the same on every capture: index,
     training and contact name seven classes, eight pages name twenty, and ep-app carries no tilt script at all —
     which is exactly why ep-app/.feature-card was the ONE surface already rendering -6px over .45s. The assert
     reads each page's own list and requires an override for every class that matches an element there; the hits
     are index 3, executive-protection 2, residential-protection 3, disaster-recovery 3, training 3, technology 2,
     cuas-aerodefense 4, uas 2, about 2, careers 3, contact 0, ep-app 0. Seven further classes are NAMED by some
     script and match nothing on any of the twelve (.feature-card, .position-card, .price-card, .problem-card,
     .tech-partner, .thermal-card, .video-card), so they need no override, and a rule for them would be one
     validate-live.py check 3b fails as spent by no page.
     render-audit.mjs check 8 hovers one card of each class on each page and fails on a measured dy that is not -6,
     a transition-duration that is not 0.45s, or rgb(201,168,76) anywhere in the computed box-shadow. A grep of
     this file cannot see any of that — which is exactly how the first pass shipped the claim. ---- */
  .agx-content .service-card, .agx-content .testimonial, .agx-content .app-tier,
  .agx-content .pillar-card, .agx-content .scenario-card, .agx-content .discipline-card,
  .agx-content .capability-card, .agx-content .threat-card, .agx-content .blog-link-card,
  .agx-content .cap-card, .agx-content .team-card, .agx-content .benefit-card, .agx-content .job-card {
    transition:transform .45s, border-color .45s, box-shadow .45s !important;
  }
  .agx-content .service-card:hover, .agx-content .testimonial:hover, .agx-content .app-tier:hover,
  .agx-content .pillar-card:hover, .agx-content .scenario-card:hover, .agx-content .discipline-card:hover,
  .agx-content .capability-card:hover, .agx-content .threat-card:hover, .agx-content .blog-link-card:hover,
  .agx-content .cap-card:hover, .agx-content .team-card:hover, .agx-content .benefit-card:hover,
  .agx-content .job-card:hover {
    transform:translateY(-6px) !important;
    box-shadow:inset 0 1px 0 rgba(255,255,255,.12), 0 18px 52px rgba(0,0,0,.5), 0 0 44px rgba(26,107,222,.24) !important;
  }
  /* ---- 3. ICON RING — the 48px ring the swapped SVGs sit in (see ICON_SWAPS) ----
     No font-size here: the SVG carries width/height, so the live rules' font-size on these elements is inert and
     does not need overriding. #form-success .success-icon is 1,1,0 on the live page and needs the id to be beaten.
     .agx-icon-ring is the ONE class this build adds inside the content, and it is here because the twelve tiles it
     wraps carry NO class of their own — six on ep-app, five on executive-protection, one on contact — so there is
     nothing else to hang the ring on. It also sets `color`, which is how executive-protection's five tiles stop
     painting their inline `color:#C9A84C` into the drawing: gold is MAST's, not Atlas content's. */
  .agx-content .feature-icon, .agx-content .audience-icon, .agx-content .hw-card-icon,
  .agx-content .card-icon, .agx-content .pillar-icon, .agx-content .scenario-icon,
  .agx-content .disc-icon, .agx-content .threat-icon, .agx-content .icon-item,
  .agx-content .blog-icon, .agx-content #form-success .success-icon, .agx-content .agx-icon-ring {
    width:48px; height:48px; display:inline-flex; align-items:center; justify-content:center;
    border-radius:14px; border:1px solid rgba(26,107,222,.32); color:#1A6BDE;
    background:radial-gradient(120% 120% at 30% 20%, rgba(26,107,222,.20) 0%, rgba(26,107,222,.045) 70%);
    box-shadow:inset 0 1px 0 rgba(255,255,255,.07);
    transition:color .45s, border-color .45s, box-shadow .45s, background .45s;
  }
  .agx-content .agx-icon { width:24px; height:24px; display:block; }
  .agx-content .service-card:hover .agx-icon-ring,
  .agx-content .service-card:hover .card-icon, .agx-content .pillar-card:hover .pillar-icon,
  .agx-content .scenario-card:hover .scenario-icon, .agx-content .discipline-card:hover .disc-icon,
  .agx-content .threat-card:hover .threat-icon, .agx-content .blog-link-card:hover .blog-icon,
  .agx-content .feature-card:hover .feature-icon, .agx-content .audience-card:hover .audience-icon,
  .agx-content .hw-card:hover .hw-card-icon {
    color:#5B9BFF; border-color:rgba(26,107,222,.62); box-shadow:inset 0 1px 0 rgba(255,255,255,.14), 0 0 26px rgba(26,107,222,.32);
  }
  /* ---- 4. MONO CHIPS. .feature-tags span is ALREADY 'Share Tech Mono' on the live page (measured), so this sets
     no font-family and no font-size — only spacing, border and fill. ---- */
  .agx-content .feature-tags span {
    letter-spacing:.25em; text-transform:uppercase;
    border:1px solid rgba(26,107,222,.45); background:rgba(26,107,222,.14);
    color:#8FBBFF; border-radius:4px;
  }
  /* ---- 5. HERO / CTA BUTTONS: gradient primary, ghost secondary, the same .45s transition ---- */
  .agx-content .cta-button, .agx-content .btn-primary, .agx-content .primary-cta,
  .agx-content .pricing-cta.primary-cta, .agx-content .gold-cta, .agx-content .form-submit {
    background:linear-gradient(135deg, #1A6BDE 0%, #0F4AA8 100%);
    border:1px solid rgba(91,155,255,.55); color:#fff;
    transition:transform .45s, border-color .45s, box-shadow .45s, background .45s;
  }
  .agx-content .cta-button:hover, .agx-content .btn-primary:hover, .agx-content .primary-cta:hover,
  .agx-content .pricing-cta.primary-cta:hover, .agx-content .gold-cta:hover, .agx-content .form-submit:hover {
    transform:translateY(-3px); background:linear-gradient(135deg, #2F7BEF 0%, #1558B8 100%);
    box-shadow:0 12px 34px rgba(26,107,222,.42);
  }
  /* .btn-gold is ep-app's HERO SECONDARY CTA and the first enumeration missed it — on the one page Brockmann was
     looking at. It is here because assemble-atlas.py now LISTS every unmatched control class at build time instead
     of leaving a miss to be found in a screenshot. The class name is the live page's; the paint is this sheet's. */
  .agx-content .secondary-button, .agx-content .outline-cta, .agx-content .pricing-cta.outline-cta,
  .agx-content .card-link, .agx-content .hw-link, .agx-content .btn-gold {
    background:transparent; border-color:rgba(26,107,222,.55); color:#8FBBFF;
    transition:transform .45s, border-color .45s, box-shadow .45s, color .45s, background .45s;
  }
  .agx-content .secondary-button:hover, .agx-content .outline-cta:hover, .agx-content .btn-gold:hover,
  .agx-content .pricing-cta.outline-cta:hover, .agx-content .card-link:hover, .agx-content .hw-link:hover {
    background:rgba(26,107,222,.12); border-color:#5B9BFF; color:#DCEBFF;
  }
  /* ---- 6. THE ONE LIVE GRID THE >=1025 GUTTER BREAKS, REFLOWED — and only it, because it was enumerated ----
     The rail's gutter (CINEMA_CSS, `.agx-ch > * { padding-right:17.5rem }`) narrows every live section by 280px,
     and every grid on the twelve pages absorbs it by shrinking its columns EXCEPT about's team grid: the live
     rule is `repeat(4, 1fr)` (about.html:108) and a `1fr` track cannot go below its min-content, which here is
     the live `.team-card img { width:240px }` plus the card's 1.5rem side padding = 288px. Four of those plus
     three 2.5rem gaps need 1272px and the gutter leaves 1088, so the fourth card hung 192px into the rail lane
     and render-audit check 7 counted 3 covered runs at 1440, 5 at 1280 and 5 at 1025 — the honest reading being
     that the page overflowed, not that the rail misbehaved. Walked all twelve pages at 1440 / 1280 / 1025 for
     content crossing its own section's content edge: this grid is the only one, and the live #sound-toggle,
     which is position:absolute in the hero and never in the rail's vertical band. auto-fit with the SAME 288px
     floor drops the row to three cards at 1440 and 1280 and two at 1025 instead of overflowing; the column count
     is the only thing that changes, and no copy, no type and no card size moves with it. Below 1025 there is no
     gutter, so this rule is not there either and the live `repeat(4, 1fr)` / phone `1fr` stand untouched. */
  @media (min-width:1025px) {
    .agx-content .team-grid { grid-template-columns:repeat(auto-fit, minmax(288px, 1fr)); }
  }
  /* ---- 7. Phones: the blur is the compositing cost, not the look. Drop it below 769. ---- */
  @media (max-width:768px) {
    .agx-content .service-card, .agx-content .pillar-card, .agx-content .scenario-card,
    .agx-content .discipline-card, .agx-content .capability-card, .agx-content .threat-card,
    .agx-content .blog-link-card, .agx-content .cap-card, .agx-content .team-card,
    .agx-content .testimonial, .agx-content .job-card, .agx-content .benefit-card,
    .agx-content .video-card, .agx-content .app-tier, .agx-content .feature-card,
    .agx-content .audience-card, .agx-content .pricing-card, .agx-content .hw-card,
    .agx-content .legal-card { backdrop-filter:none; -webkit-backdrop-filter:none; background:rgba(11,18,33,.78); }
    /* And the ring for the class-less tiles comes down with it. Measured at 393x852 on ep-app: the live
       "6-Layer Comms Stack" row is a six-column grid inside a 353px box and ITS OWN CONTENT ALREADY OVERFLOWS ON
       THE LIVE SITE — row scrollWidth 491 against a 353px box on reference/live/ep-app.html, whose document
       overflows the viewport by 118px there. With a 48px ring the row read 510; at 40px it reads 496. The
       document itself overflows by 0 on the built page at every width measured, because the shell clips it, and
       the row's 5px is inside a cut the live page already makes. */
    .agx-content .agx-icon-ring { width:40px; height:40px; border-radius:12px; }
    /* ---- 7b. THE TWO BOXES THAT STILL STOOD PAST THE RIGHT EDGE AT 393, FOUND ONLY AFTER render-audit's check 9
       WAS REPAIRED (2026-09-10). Its clipped() walked EVERY ancestor, the document body included, and every
       generated page carries the live sheet's `body { overflow-x:hidden }`, so the check could never report a
       single element. With the walk bounded at the body, twelve pages at 393x852 report exactly these two:

       (a) cuas-aerodefense .integration-grid. The live sheet already stacks it to one column at <=768
           (cuas-aerodefense.html:228), and the track STILL measured 398.031px inside a 369px grid box, putting the
           h3, both paragraphs and the "Learn About UAS Drones" anchor at x=410. The cause is the live theme's
           own phone rule `.cta-button { width:100% !important }`: a percentage width inside a
           `1fr` track resolves through the item's automatic minimum size, and the track grows to it. min-width:0
           on the two grid items is the one declaration that lets the track be the 369px it is told to be — the
           column count, the copy and the type are untouched. Re-measured: [12,381], width 369.

       (b) index #app's glow. `<div style="…width:600px;height:600px;border-radius:50%;background:radial-gradient(
           …);pointer-events:none">`, absolutely centred in the section, so it stands 103px past both edges of a
           393px viewport. max-width beats an inline `width` because they are different properties, so no
           !important is needed; the circle becomes an ellipse of the same gradient. Re-measured: [0,393]. Above
           768 it is inside the viewport and this rule is not there. */
    .agx-content .integration-text, .agx-content .integration-visual { min-width:0; }
    .agx-content div[style*="width:600px"] { max-width:100%; }
/* AGX-PHONE-BLOCK */
  }
  @media (prefers-reduced-motion: reduce) {
    .agx-content .feature-card, .agx-content .service-card, .agx-content .pricing-card { transition:none; }
  }
"""

# ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
# THE PHONE BLOCK — Brockmann, 2026-09-09: "floor" · "for mobile" · "Site should be same as most look mobile first".
#
# TWO MEASUREMENTS DECIDE THE SHAPE OF EVERY RULE BELOW AND NEITHER IS NEGOTIABLE BY TASTE.
#
#   1. AN INLINE DECLARATION BEATS ANY STYLESHEET RULE AT ANY SPECIFICITY. The rows that do not collapse at 393 are
#      class-less `<div style="display:grid; grid-template-columns:repeat(N,1fr)">` — twelve repeat(3,1fr), one
#      repeat(4,1fr), four repeat(5,1fr), one repeat(6,1fr) across the twelve captures, counted this turn. Same for
#      the type: 61 `<p style="font-size:0.9rem">`, 60 `<div style="font-size:0.65rem">` and so on. Those two
#      classes of rule are the second and third bounded `!important` this sheet takes, each with its own enumerated
#      value list in assert_skin_scope(), never a widened "allow !important on these properties".
#
#   2. THERE IS NO CSS PRIMITIVE FOR "FLOOR MY OWN COMPUTED SIZE". `max(15px, 1em)` and `max(15px, 100%)` both
#      resolve against the PARENT and RAISE `.section-divider p` from 13.6px to 16px instead of flooring it to 15.
#      So the floor is enumerated, selector by selector, with the LIVE value written into the max() — which is why
#      a rule here can never lower anything, and why a selector whose elements do not all share one live value is
#      split rather than averaged. `.service-card p` measures 12.8 / 13.6 / 15.2 / 16.0px across the page set: its
#      sub-floor members are all inline-styled, so they are floored by the value-keyed rules and the class carries
#      NO rule of its own — a `.service-card p` rule would have dragged 27 compliant paragraphs down to 15px.
#      `.pillar-card p` measures 13.6px on residential-protection and 15.2px on disaster-recovery, so its max() is
#      written 15.2px: the small ones rise, the compliant ones do not move.
#
# THE TABLE IS NOT THE ASSERT. validate-live.py check 4c collects (tag, font-size) at 390 on the BUILD and on the
# LIVE CAPTURE and fails unless build >= live everywhere, build == live wherever live already cleared the floor,
# and nothing computes under the floor. An entry no page spends fails validate-live check 3b as a dead selector.
P_FLOOR_PX = 15
LABEL_FLOOR_PX = 11
# Every inline grid-template-columns value the twelve captures carry. The four below reflow; the other two already
# measure one column at 393 under the live page's own media queries and are left alone. build_live() asserts the
# page's inline values are a subset of PHONE_GRID_OK, so a capture that grows a repeat(7,1fr) fails the build.
PHONE_GRID_VALUES = ('repeat(3,1fr)', 'repeat(4,1fr)', 'repeat(5,1fr)', 'repeat(6,1fr)')
PHONE_GRID_OK = PHONE_GRID_VALUES + ('1fr 1fr', 'repeat(auto-fit,minmax(280px,1fr))')
# 5 and 6 go to TWO columns, not one: those are the five one-word leadership traits on executive-protection and the
# six comms-stack tiles on ep-app. One column would make eleven screenfuls of a five-word list.
PHONE_GRID_TRACKS = {'repeat(3,1fr)': '1fr', 'repeat(4,1fr)': '1fr',
                     'repeat(5,1fr)': 'repeat(2,1fr)', 'repeat(6,1fr)': 'repeat(2,1fr)'}
# (selector, smallest live px, the px written into the max()). Measured at 393x852 in Chromium on 1f26ae5.
PHONE_P_FLOOR = (
    ('.section-divider p', 13.6, 13.6), ('.testimonial p', 14.4, 14.4),
    ('.benefit-card p', 13.6, 13.6), ('.blog-text p', 13.6, 13.6),
    ('.cap-card p', 14.4, 14.4), ('.discipline-card p', 13.6, 13.6),
    ('.how-step .how-desc', 14.4, 14.4), ('.hw-card p', 14, 14),
    ('.integration-visual p', 12, 14.4), ('.legal-card p', 14, 14),
    ('.legal-disclaimer p', 14, 14), ('.pillar-card p', 13.6, 15.2),
    ('.pricing-desc', 14, 14), ('.pricing-note-bar p', 14, 14),
    ('.scenario-body p', 14.4, 14.4), ('.team-card p', 14.4, 14.4),
    ('.threat-card p', 13.6, 13.6), ('.video-card-info p', 13.6, 13.6),
    ('.form-disclaimer', 12, 12),
    ('p[style*="font-size:0.9rem"]', 14.4, 14.4), ('p[style*="font-size:0.85rem"]', 13.6, 13.6),
    ('p[style*="font-size:.85rem"]', 13.6, 13.6), ('p[style*="font-size:.8rem"]', 12.8, 12.8),
    ('p[style*="font-size:0.75rem"]', 12, 12), ('p[style*="font-size:14px"]', 14, 14),
)
PHONE_LABEL_FLOOR = (
    ('.app-tier-name', 10, 10), ('.feature-tags span', 9, 9), ('.hero-stat .lbl', 10, 10),
    ('.pricing-badge', 9, 9), ('.pricing-tier', 10, 10), ('.signup-form label', 10, 10),
    ('div[style*="font-size:0.65rem"]', 10.4, 10.4),
)
# THE FLOOR RULES ALL TAKE !important, AND THE REASON IS MEASURED, NOT DEFENSIVE. Two live mechanisms cannot be
# beaten any other way and both are in this page set: an inline `style="font-size:0.9rem"` (61 paragraphs), and the
# theme sheet's OWN !important — `reference/live/shared-styles.css:186`, inside its <=768 block, sets
# `.section-divider p { font-size:0.85rem !important }` on 33 paragraphs across ten pages. Shipped without it, that
# one selector was the single row still measuring 13.6px after the first phone pass. Taking !important per-entry
# where it happened to be needed would encode today's captures; taking it on every floor entry and BOUNDING it to
# the two tables is the same guarantee with nothing left to drift. assert_skin_scope() enforces the bound.
_INLINE_FLOOR = re.compile(r'^(\w+)\[style\*="font-size:')


def _grid_sel(value):
    """The attribute selector for one inline grid value, WITHOUT ITS COMMA. atlas_live.audit_chrome_css() flattens a
    selector list by splitting on ',' — a comma inside an attribute value would be split into two broken selectors
    and validate-live.py's probe would throw on both. `columns:repeat(3` is the same match with no comma in it."""
    return '.agx-content div[style*="columns:%s"]' % value.split(',')[0]


def _floor_rule(sel, low, high, floor, root='.agx-content'):
    return '    %s %s { font-size:max(%dpx,%gpx) !important; }' % (root, sel, floor, high)


def phone_block():
    """The rules that go inside AGX_SKIN_CSS's one @media (max-width:768px) block, generated from the tables above
    so the CSS and the numbers assert_phone_floor() checks can never be two different things."""
    out = ['    /* ---- 8. THE PHONE BLOCK: the rows that do not collapse, and the body-copy floor ---- */']
    for tracks in ('1fr', 'repeat(2,1fr)'):
        sels = [_grid_sel(v) for v in PHONE_GRID_VALUES if PHONE_GRID_TRACKS[v] == tracks]
        out.append('    %s { grid-template-columns:%s !important; }' % (', '.join(sels), tracks))
    for sel, low, high in PHONE_P_FLOOR:
        out.append(_floor_rule(sel, low, high, P_FLOOR_PX))
    for sel, low, high in PHONE_LABEL_FLOOR:
        out.append(_floor_rule(sel, low, high, LABEL_FLOOR_PX))
    return '\n'.join(out)


# The generated block lands in the sheet HERE, at import, so `AGX_SKIN_CSS` is the whole sheet on every surface
# that reads it — validate-live.py asserts the constant by name and would otherwise probe a sheet the pages do not
# ship. The marker is a comment inside the one @media (max-width:768px) block, so the block count stays 1.
AGX_SKIN_CSS = AGX_SKIN_CSS.replace('/* AGX-PHONE-BLOCK */', phone_block())
assert AGX_SKIN_CSS.count('@media (max-width:768px)') == 1, 'the skin grew a second phone block'

# ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
# THE FOOTER'S PHONE FLOOR — the half of "floor" that was measured inside .agx-content and reported as the page.
#
# THE FIRST PASS'S FLOOR WAS TRUE AND ITS CLAIM WAS NOT. Both guards walked '.agx-content *' and the phone floor was
# reported as "no text under 11px, no p under 15px" full stop. Walked over `body *` at 393x852 on 2026-09-10, the
# live footer — which sits OUTSIDE .agx-content — still printed <p> at 9.92px on eleven pages ("© 2026 Atlas Glinn,
# LLC | MAST Solutions.", "Executive Protection • Training • AI Surveillance"), <p> at 11.2px on eleven ("Best of
# Business 2025", "Chamber of Commerce"), and on ep-app <p> at 14px and 13px, span.cred-tag at 10px and
# span.footer-badge at 9px. render-audit check 9 walks the whole body minus the chrome now, so the claim and the
# guard cannot be two different populations again.
#
# THESE RULES ARE IN THE CHROME SHEET AND NOT IN THE SKIN, AND THAT IS NOT A CONVENIENCE. `footer.site-footer` is
# already one of atlas_live.CHROME_ROOTS — CLASSIC_CSS is the sheet that paints the footer (`.footer-bottom {
# font-size:.62rem }` above IS the 9.92px), and the skin is scoped `.agx-content`, which cannot reach it. Putting a
# footer rule in the skin would have meant widening the skin's one declared root; putting it here spends a root the
# build already declares and validate-live already probes.
#
# !important on every entry, for the reason the skin takes it: `.footer-awards .badge-item p` carries an INLINE
# `style="…font-size:0.7rem…"` on all eleven pages, and `.footer-bottom p` is beaten by ep-app's own
# `.footer-bottom p { font-size:13px }`. assert_footer_floor() bounds it to this table.
FOOTER_ROOT = '.site-footer'
# (selector, smallest live px, the px written into the max()). Measured at 393x852 in Chromium on c713dd9.
FOOTER_P_FLOOR = (
    ('.footer-bottom p', 9.92, 13),                 # 9.92 on eleven pages, 13 on ep-app's own footer
    # The two award captions. Keyed by the INLINE style, not by .footer-awards .badge-item: the chrome sheet
    # carries those classes but the live footer markup is class-less inline-styled <div>s, so the class rule
    # matched nothing and the caption still measured 11.2px after the first attempt.
    ('p[style*="font-size:0.7rem"]', 11.2, 11.2),
    ('.footer-brand p', 14, 14),                    # ep-app only
)
FOOTER_LABEL_FLOOR = (
    ('.footer-bottom a[style*="font-size:10px"]', 10, 10),   # the "✍" link on index and contact
    ('.footer-badge', 9, 9), ('.cred-tag', 10, 10),          # ep-app only
)


def footer_block():
    """The rules that go inside CLASSIC_CSS's one @media (max-width:768px) block, generated from the two tables
    above so the CSS and the numbers assert_footer_floor() checks can never be two different things."""
    out = ["    /* ---- The footer's body-copy floor: the same 15px / 11px as the skin, on the one live band "
           "that sits outside .agx-content ---- */"]
    for table, floor in ((FOOTER_P_FLOOR, P_FLOOR_PX), (FOOTER_LABEL_FLOOR, LABEL_FLOOR_PX)):
        for sel, low, high in table:
            out.append(_floor_rule(sel, low, high, floor, FOOTER_ROOT))
    return '\n'.join(out)


CLASSIC_CSS = CLASSIC_CSS.replace('/* AGX-FOOTER-FLOOR */', footer_block())
assert CLASSIC_CSS.count('@media (max-width:768px)') == 1, 'the chrome sheet grew a second phone block'


def assert_footer_floor(css):
    """The footer floor's bounds, as a build failure: every entry does work, every rule is the one footer_block()
    generates, every rule sits inside the phone block, and the sheet takes !important NOWHERE ELSE. Returns the
    number of rules counted. Called from atlas_live.chrome_css() so it fires on the built sheet, not on a constant.
    """
    import atlas_live as live
    body = live._COMMENT.sub('', css)
    # NORMALISED, because this runs on the BUILT sheet and not on the constant: chrome_css() re-emits every rule
    # through _filter(), which rebuilds it as `sel {decl}` and loses the source indent. Asserting the constant
    # instead would assert a sheet the pages do not ship.
    block = ' '.join(live._block(body, '@media (max-width:768px) {').split())
    n = 0
    for table, floor, name in ((FOOTER_P_FLOOR, P_FLOOR_PX, 'FOOTER_P_FLOOR'),
                               (FOOTER_LABEL_FLOOR, LABEL_FLOOR_PX, 'FOOTER_LABEL_FLOOR')):
        for sel, low, high in table:
            assert low < floor, '%s carries %s at %gpx, which already clears the %dpx floor — a rule nothing ' \
                                'spends is a hole nothing guards' % (name, sel, low, floor)
            assert high >= low, '%s: %s writes %gpx into a max() over live copy measured at %gpx' % (name, sel, high, low)
            rule = ' '.join(_floor_rule(sel, low, high, floor, FOOTER_ROOT).split())
            assert rule in block, 'the chrome sheet no longer carries: ' + rule
            n += 1
    floor_sels = set('%s %s' % (FOOTER_ROOT, sel) for table in (FOOTER_P_FLOOR, FOOTER_LABEL_FLOOR)
                     for sel, _lo, _hi in table)
    for m in re.finditer(r'([^{}]+)\{([^{}]*)\}', body):
        if '!important' not in m.group(2):
            continue
        parts = set(' '.join(x.split()) for x in m.group(1).split(','))
        assert parts <= floor_sels and ' '.join(m.group(0).split()) in block, \
            'the chrome sheet takes !important outside the enumerated footer floor: %s' % m.group(1).strip()[:70]
    return n


def assert_phone_floor(css):
    """The phone block's own bounds: every floor entry does work, every rule is the one phone_block() generates,
    and no floor rule sits outside the @media (max-width:768px) block. Returns (p rules, label rules) counted."""
    import atlas_live as live
    body = live._COMMENT.sub('', css)
    block = live._block(body, '@media (max-width:768px) {')
    for table, floor, name in ((PHONE_P_FLOOR, P_FLOOR_PX, 'PHONE_P_FLOOR'),
                               (PHONE_LABEL_FLOOR, LABEL_FLOOR_PX, 'PHONE_LABEL_FLOOR')):
        for sel, low, high in table:
            assert low < floor, '%s carries %s at %gpx, which already clears the %dpx floor — a rule nothing ' \
                                'spends is a hole nothing guards' % (name, sel, low, floor)
            assert high >= low, '%s: %s writes %gpx into a max() over live copy measured at %gpx' % (name, sel, high, low)
            rule = _floor_rule(sel, low, high, floor).strip()
            assert rule in block, 'the phone block no longer carries: ' + rule
    outside = body.replace(block, '')
    assert 'font-size:max(' not in outside, 'a floor rule sits outside the @media (max-width:768px) block'
    return len(PHONE_P_FLOOR), len(PHONE_LABEL_FLOOR)


_GOLD_TOKENS = ('#C9A84C', '#D4AF37', '#BF953F', '#FCF6BA', '#B38728', '#AA771C', '#E8D27D',
                '#B87333', 'rgba(201,168,76', 'rgba(201, 168, 76', '--gold')
_SKIN_TYPE_EXEMPT = ('.agx-icon',)   # the only selector this sheet may size, because it draws the element itself


_HEADING_SEL = re.compile(r'h[1-6]\s*$', re.I)


def assert_skin_scope(css):
    """The skin's bounds, as a build failure. Returns the selectors checked.

    BOUND 2 IS SPLIT SINCE THE PHONE BLOCK, AND THE SPLIT IS THE POINT. Outside @media (max-width:768px) the ban on
    font-size and font-family is exactly what it was — ledger K-3, seven heading sizes that stay. INSIDE it, and only
    inside it, a font-size is legal where it is one of the rules phone_block() generates from PHONE_P_FLOOR /
    PHONE_LABEL_FLOOR, verbatim. "The phone has a floor" must never quietly become "the skin may set type"."""
    import atlas_live as live
    body = live._COMMENT.sub('', css)
    sels = live.audit_chrome_css(body)
    loose = [s for s in sels if not s.strip().startswith('.agx-content ')]
    assert not loose, 'skin CSS is not anchored to .agx-content: %s' % loose[:6]
    # THE LITERAL "<body" MAY NOT APPEAR IN THIS SHEET, INCLUDING IN A COMMENT. compare-atlas.py:263 and :363
    # and atlas_live.py:444 all slice a page at `index('<body')`, and this sheet ships inside <head> — a comment
    # that spelled the tag moved the body boundary into the CSS and printed three stylesheet fragments as
    # build-only text units on all twelve pages (measured 2026-09-10, the run that produced this line).
    assert '<body' not in css, 'the skin spells the literal "<body"; every page slicer keys on the first one'
    assert_phone_floor(css)
    phone = live._block(body, '@media (max-width:768px) {')
    floor_rules = set(_floor_rule(sel, low, high, floor).strip()
                      for table, floor in ((PHONE_P_FLOOR, P_FLOOR_PX), (PHONE_LABEL_FLOOR, LABEL_FLOOR_PX))
                      for sel, low, high in table)
    for prop in ('font-size', 'font-family'):
        for m in re.finditer(r'([^{}]+)\{([^{}]*)\}', body):
            if not re.search(r'(?<![\w-])%s\s*:' % prop, m.group(2)):
                continue
            sel = ' '.join(m.group(1).split())
            if any(x in m.group(1) for x in _SKIN_TYPE_EXEMPT):
                continue
            if prop == 'font-size' and m.group(0).strip() in phone \
                    and ' '.join(m.group(0).split()) in set(' '.join(r.split()) for r in floor_rules):
                # G — and it stays true by measurement, not by the table being read carefully: a floor rule may
                # never name a live heading, because the heading scale is the one thing K-3 froze outright.
                assert not any(_HEADING_SEL.search(part.strip()) for part in sel.split(',')), \
                    'a phone floor rule targets a live heading: ' + sel[:90]
                continue
            raise AssertionError('the skin sets %s on live content (ledger K-3): %s' % (prop, sel[:90]))
    for g in _GOLD_TOKENS:
        assert g not in body, 'gold in the Atlas content skin (gold is MAST): ' + g
    assert SHARED_HOVER_LIFT in body and SHARED_HOVER_TRANSITION in body, \
        'the skin no longer carries the shared card hover copied from cinematic_shell.py:132-133'
    # 5. THE TILT OVERRIDE IS PRESENT FOR EVERY CLASS THAT NEEDS IT. !important is the ONE exception this sheet
    #    takes and it is bounded here: only the classes in SKIN_TILT_CLASSES, only transform / transition /
    #    box-shadow, and only because an inline style cannot be beaten any other way. An !important on any
    #    OTHER declaration fails.
    rules = [(' '.join(m.group(1).split()), m.group(2)) for m in re.finditer(r'([^{}]+)\{([^{}]*)\}', body)]
    for c in SKIN_TILT_CLASSES:
        base = [d for s, d in rules if '.agx-content .%s,' % c in s + ',' and '!important' in d and ':hover' not in s]
        hov = [d for s, d in rules if '.agx-content .%s:hover' % c in s and '!important' in d]
        assert base and 'transition:%s' % TILT_TRANSITION in base[0], \
            'the skin no longer forces the .45s transition over the tilt script on .%s' % c
        assert hov and TILT_LIFT in hov[0] and 'box-shadow:' in hov[0], \
            'the skin no longer forces the -6px lift and the blue glow over the tilt script on .%s' % c
    # !IMPORTANT IS THREE BOUNDED EXCEPTIONS NOW, NEVER ONE WIDENED RULE. Each has its own enumerated list and each
    # exists for the SAME measured reason — an inline declaration cannot be beaten any other way:
    #   (a) transform / transition / box-shadow over the live tilt script, on SKIN_TILT_CLASSES;
    #   (b) grid-template-columns over an inline `display:grid`, in the phone block, on a _grid_sel() selector;
    #   (c) font-size over an inline font-size OR over the theme sheet's own !important (shared-styles.css:186),
    #       in the phone block, on a PHONE_P_FLOOR / PHONE_LABEL_FLOOR selector.
    # A single "allow !important on these properties" check would let the next session put it anywhere, which is
    # how the tilt-override defect shipped in the first place.
    grid_sels = set(_grid_sel(v) for v in PHONE_GRID_VALUES)
    floor_sels = set('.agx-content ' + sel for table in (PHONE_P_FLOOR, PHONE_LABEL_FLOOR)
                     for sel, _lo, _hi in table)
    for sel, decl in rules:
        parts = set(x.strip() for x in sel.split(','))
        in_phone = sel in ' '.join(phone.split()) or all(p in phone for p in parts)
        for d in decl.split(';'):
            if '!important' not in d:
                continue
            prop = d.split(':')[0].strip()
            if prop == 'grid-template-columns':
                assert in_phone and parts <= grid_sels, \
                    'the skin takes !important on grid-template-columns outside the enumerated phone rows: %s' % sel[:70]
                continue
            if prop == 'font-size':
                assert in_phone and parts <= floor_sels, \
                    'the skin takes !important on font-size outside the enumerated phone floor: %s' % sel[:70]
                continue
            assert prop in ('transform', 'transition', 'box-shadow'), \
                'the skin takes !important on %s in %s — the exception is bounded to the tilt override' % (prop, sel[:70])
            assert any('.%s' % c in sel for c in SKIN_TILT_CLASSES), \
                'the skin takes !important outside the tilt override: %s' % sel[:70]
    return sels


def skin_css():
    """The content skin. NOT run through shell._recolor — it is authored in Atlas blue directly, and the no-gold
    assert above is only meaningful on the sheet as written."""
    assert_shared_hover()
    assert_skin_scope(AGX_SKIN_CSS)
    return AGX_SKIN_CSS


# ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
# THE HERO TYPE SHEET — the SECOND declared exception, and it is a separate sheet on purpose
#
# assert_skin_scope() bans font-size and font-family outright and exempts one selector by name (.agx-icon, which the
# skin draws itself). THAT BAN IS NOT WIDENED. Brockmann's 2026-09-09 call reverses ledger K-3 for the HERO and the
# CHROME only — body copy keeps the live words at the live sizes — so the hero's type lives in its own block, with
# its own mark, its own assert and its own name in validate-live.py. "The hero is exempt" must never quietly become
# "h1 is exempt", and the way that is prevented is bound 2 below: the sheet may size FIVE elements and no others,
# each named, and every one of them is inside the opening chapter.
#
# THE GOLD IS THE LIVE PAGE'S OWN. `.gold-text` / `.gold-shimmer` are the classes the live <h1> already carries on
# all twelve; this sheet keeps them gold, gives them the shimmer index already serves live, and paints the trailing
# word Atlas blue — the same two-tone assemble-atlas.shimmer()/blue() print for the authored hero. It is NOT a breach
# of the skin's no-gold bound: that bound stops this build INTRODUCING gold into Atlas content, and it says in terms
# that the live page's own gold is carried. Bound 3 holds the line mechanically — the five shimmer stops and one
# gold text-shadow, only inside a rule naming one of those two live classes, and `--gold` nowhere.
AGX_HERO_MARK = '/* AGX-HERO v1 */'
HERO_ROOT = '.agx-content .agx-ch.agx-hero '
# The five elements this sheet OWNS the type of. Everything else it touches (the hero container, the CTA rows) it
# lays out and never sizes.
HERO_TYPE_OWNED = ('h1', '.hero-badge', '.hero-tagline', '.hero-sub', '.agx-scroll-cue')
HERO_SHIMMER_STOPS = ('#BF953F', '#FCF6BA', '#B38728', '#FBF5B7', '#AA771C', 'rgba(201,168,76,.3)')
HERO_LIVE_GOLD_CLASSES = ('.gold-text', '.gold-shimmer')

AGX_HERO_CSS = r"""
/* AGX-HERO v1 */
  /* THE TWO LAYOUT NUMBERS THE BAR'S REMOVAL LEFT BEHIND, AND THE SCREENSHOT THAT FOUND THEM. Eleven live heroes
     are `display:flex; align-items:flex-end` with `margin-top:70px` on two of them — bottom-anchored under a 70px
     sticky bar, which is exactly right on the live site and wrong here. Shot at 1440 on executive-protection with
     the re-set headline: the h1 sat at y=773 and "REQUEST A 30-MINUTE POSTURE ASSESSMENT" was cut off by the fold.
     `align-items:center` and `margin-top:0` are layout on the hero container only; ep-app's `.hero` is a block
     with its own padding and `align-items` is inert on it, so this reaches the eleven and not the twelfth. */
  .agx-content .agx-ch.agx-hero .hero { position:relative; text-align:center; align-items:center; margin-top:0; }
  .agx-content .agx-ch.agx-hero .hero-content { text-align:center; }
  .agx-content .agx-ch.agx-hero .hero-badge { font-family:'Share Tech Mono',monospace; font-size:.75rem; letter-spacing:.45em; text-transform:uppercase; color:#8FBBFF; margin-bottom:1.6rem; text-shadow:0 1px 2px rgba(5,8,16,.7); }
  .agx-content .agx-ch.agx-hero h1 { font-family:'Orbitron',sans-serif; font-weight:900; font-size:clamp(2.6rem,7.2vw,6.6rem); letter-spacing:.02em; line-height:.95; margin-bottom:2rem; }
  .agx-content .agx-ch.agx-hero h1 .gold-text, .agx-content .agx-ch.agx-hero h1 .gold-shimmer { background:linear-gradient(90deg,#BF953F 0%,#FCF6BA 25%,#B38728 50%,#FBF5B7 75%,#AA771C 100%); background-size:1000px 100%; animation:agxShimmer 6s linear infinite; -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; text-shadow:0 0 80px rgba(201,168,76,.3); }
  .agx-content .agx-ch.agx-hero h1 .agx-hero-blue { color:#1A6BDE; -webkit-text-fill-color:#1A6BDE; }
  /* clamp MAX 1.4rem = 22.4px, and that number is measured, not chosen: ep-app's live .hero-sub computes 22px at
     1440 and the first clamp (1.3vw, max 1.25rem) shipped it at 18.72px — the re-set SHRINKING the one live lede
     in the page set. validate-live check 4b prints the hero on both sides and now fails on any element the build
     makes smaller than the live one, so this cannot come back silently. */
  .agx-content .agx-ch.agx-hero .hero-tagline, .agx-content .agx-ch.agx-hero .hero-sub { font-size:clamp(1.05rem,1.6vw,1.4rem); line-height:1.55; font-weight:300; max-width:720px; margin:0 auto 2.5rem; color:rgba(240,244,255,.8); text-shadow:0 1px 2px rgba(5,8,16,.7); }
  .agx-content .agx-ch.agx-hero .hero-ctas, .agx-content .agx-ch.agx-hero .hero-btns { display:flex; gap:1rem; justify-content:center; flex-wrap:wrap; }
  .agx-content .agx-ch.agx-hero .agx-scroll-cue { position:absolute; left:50%; bottom:2.2rem; z-index:4; transform:translateX(-50%); font-family:'Share Tech Mono',monospace; font-size:.6rem; letter-spacing:.4em; color:rgba(240,244,255,.55); pointer-events:none; }
  .agx-content .agx-ch.agx-hero .agx-scroll-cue::after { content:"SCROLL \2193"; }
  @keyframes agxShimmer { 0% { background-position:-1000px 0; } 100% { background-position:1000px 0; } }
  @media (prefers-reduced-motion: reduce) {
    .agx-content .agx-ch.agx-hero h1 .gold-text, .agx-content .agx-ch.agx-hero h1 .gold-shimmer { animation:none; }
  }
  /* THE CUE SHOWS ON A PHONE TOO (2026-09-10). It was display:none below 769 and the reason it came back is
     Brockmann's own line — "Site should be same as most look mobile first" — plus a measurement: with the cue
     shown at 393x852 its box is [158,235,674,689] on eleven pages and [158,235,790,806] on ep-app, and a
     line-box walk of every text run in the opening chapter returns ZERO intersections on all twelve. It takes
     11px here rather than the .6rem it takes above 768, so the one piece of hero chrome a phone reader meets
     clears the same 11px label floor the rest of the page does. */
  @media (max-width:768px) {
    .agx-content .agx-ch.agx-hero .agx-scroll-cue { font-size:11px; bottom:1.6rem; }
  }
"""


def assert_hero_scope(css):
    """The hero sheet's four bounds, as a build failure. Returns the selectors checked."""
    import atlas_live as live
    body = live._COMMENT.sub('', css)
    sels = live.audit_chrome_css(body)
    loose = [s for s in sels if not s.strip().startswith(HERO_ROOT)]
    assert not loose, 'hero CSS reaches outside the opening chapter: %s' % loose[:6]
    rules = [(' '.join(m.group(1).split()), m.group(2)) for m in re.finditer(r'([^{}]+)\{([^{}]*)\}', body)]
    for sel, decl in rules:
        for prop in ('font-size', 'font-family'):
            if not re.search(r'(?<![\w-])%s\s*:' % prop, decl):
                continue
            for part in sel.split(','):
                tail = part.strip().split()[-1] if part.strip() else ''
                assert tail in HERO_TYPE_OWNED, \
                    'the hero sheet sets %s on %r, which is not one of the five elements it owns %s' \
                    % (prop, tail, list(HERO_TYPE_OWNED))
        assert '!important' not in decl, 'the hero sheet takes !important on %s' % sel[:70]
        gold = [g for g in _GOLD_TOKENS if g in decl]
        if gold:
            assert any(c in sel for c in HERO_LIVE_GOLD_CLASSES), \
                'gold outside the live headline classes %s: %s' % (list(HERO_LIVE_GOLD_CLASSES), sel[:70])
            for token in re.findall(r'#[0-9A-Fa-f]{6}|rgba\([\d.,\s]*\)', decl):
                if any(g in token for g in _GOLD_TOKENS):
                    assert token.replace(' ', '') in HERO_SHIMMER_STOPS, \
                        'a gold literal the hero sheet does not declare: %s' % token
    assert '--gold' not in body, 'the hero sheet reads --gold; the palette is declared, not borrowed'
    return sels


def hero_css(mono_family='Inconsolata'):
    """The hero type sheet, with the small caps taken from the mono the page already loads — the same substitution
    chrome_css() and cinema_css() make, and for the same reason: adding a face the live site does not request is the
    'same font' line he drew."""
    css = AGX_HERO_CSS.replace("'Share Tech Mono',monospace", "'%s',monospace" % mono_family)
    assert_hero_scope(css)
    return css


# ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
# THE ICON SWAP — the live pages' emoji-as-icons, redrawn as inline monoline SVG
#
# Brockmann, 2026-09-09, looking at the ep-app feature grid: "This is supposed to be a high end and very specific
# website … needs to be clean and vibrant." Emoji render as the reader's own OS font — Apple's colour glyphs on a
# Mac, Noto on Android, a tofu box where neither is installed — and that is the one thing on these pages the build
# cannot control. Redrawing them as 24px currentColor paths puts them in the page's own palette on every machine.
#
# ICON_SVG is the DRAWING table: glyph string -> path data. ICON_SWAPS is the POSITION table: 70 rows, (class,
# glyph, the card's title for a reviewer), in document order per page. Both are literal and hand-maintained, and
# skin_icons() raises if the capture and the table ever disagree — the table is the contract, not a hint.
#
# The emoji text unit is the ONLY text these pages lose. compare-atlas.py withholds exactly these 70 units from the
# live side BY POSITION and asserts an <svg class="agx-icon"> stands in each place; render-audit.mjs measures the
# rendered boxes. Nothing else about the comparison is weakened.
_SVG_OPEN = ('<svg class="agx-icon" viewBox="0 0 24 24" width="24" height="24" fill="none" '
             'stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" '
             'aria-hidden="true" focusable="false" data-agx-glyph="%s">')


# The glyph's codepoints in hex, never the glyph itself: the receipt that this drawing stands where that glyph
# stood, in an attribute no pass reads as content. NOT a `data-src`-like name — compare-atlas counts
# `\bdata-src\s*=` and a near-miss would land in the media pass; and never the glyph itself, which would fail the
# "no emoji survives" assert the attribute exists to prove.
def _glyph_key(g):
    return '-'.join('%04X' % ord(c) for c in g)


# 24x24 viewBox, 1.5px stroke, no fill, no href, no <use>, no url() and no external asset: check-links.py reads
# src|href|poster|url() on every generated page and none of these carries one.
ICON_SVG = {
 '\U0001F6E1': 'M12 3l7 2.5v5.2c0 4.3-2.9 8.2-7 9.3-4.1-1.1-7-5-7-9.3V5.5z',                          # shield
 '\U0001F50D': 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM16.2 16.2L21 21',                                 # magnifier
 '\U0001F697': 'M4 16v-3.2l1.9-4.4A2 2 0 0 1 7.7 7h8.6a2 2 0 0 1 1.8 1.4L20 12.8V16zM4 16h16M7.5 16v2.6M16.5 16v2.6M7 12.4h10',   # car
 '\U0001F935': 'M12 4a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4zM5 20.4v-1.6A5.8 5.8 0 0 1 10.8 13h2.4A5.8 5.8 0 0 1 19 18.8v1.6M10.4 13L12 16.2 13.6 13',   # person in a suit
 '\U000026A0': 'M12 4L2.6 20h18.8zM12 10v4.6M12 17.5h.01',                                             # warning triangle
 '\U0001F3E5': 'M4 20.4V8h16v12.4zM2.2 20.4h19.6M12 10.6v5.2M9.4 13.2h5.2M8.4 4.6h7.2V8H8.4z',         # hospital
 '\U0001F441': 'M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6zM12 9.4a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2z',   # eye
 '\U0001F512': 'M6 10.4h12v9.8H6zM8.6 10.4V7.6a3.4 3.4 0 0 1 6.8 0v2.8M12 14v2.6',                     # padlock
 '\U0001F3E0': 'M3.4 10.6L12 3.6l8.6 7M5.6 12.2V20.4h12.8V12.2M9.8 20.4v-4.8h4.4v4.8',                 # house
 '\U0001F4F9': 'M3 8.4h11v7.2H3zM14 11l5.6-2.8v7.6L14 13zM5 18.6h5.6',                                 # video camera
 '\U0001F6A8': 'M7 17.6a5 5 0 0 1 10 0zM4.6 20.4h14.8M12 3.6V6M6.6 5.8l1.6 1.8M17.4 5.8l-1.6 1.8',     # siren
 '\U0001F511': 'M8 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8zM11.4 12H21M18.4 12v3M15.6 12v2.2',     # key
 '\U0001F436': 'M6.2 8.6L5.2 4l3.9 2.2M17.8 8.6L18.8 4l-3.9 2.2M12 6.2a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM10 11.6h.01M14 11.6h.01M12 14.4h.01',   # dog head (K-9)
 '\U0001F4CB': 'M9.4 4.6H7A1.4 1.4 0 0 0 5.6 6v13a1.4 1.4 0 0 0 1.4 1.4h10A1.4 1.4 0 0 0 18.4 19V6A1.4 1.4 0 0 0 17 4.6h-2.4M9.4 3.2h5.2v3H9.4zM8.8 11.4h6.4M8.8 15h4.4',   # clipboard
 '\U0001F300': 'M12 12a4.4 4.4 0 0 1 4.4-4.4c2.9 0 5.1 2.3 5.1 5.2 0 4.4-4.1 8.2-9.5 8.2M12 12a4.4 4.4 0 0 0-4.4 4.4c-2.9 0-5.1-2.3-5.1-5.2C2.5 6.8 6.6 3 12 3',   # cyclone
 '\U0001F30A': 'M2.4 9.4c2.4-2 4.4-2 6.8 0s4.4 2 6.8 0 4.2-1.9 5.6-1M2.4 14c2.4-2 4.4-2 6.8 0s4.4 2 6.8 0 4.2-1.9 5.6-1M2.4 18.6c2.4-2 4.4-2 6.8 0s4.4 2 6.8 0 4.2-1.9 5.6-1',   # waves
 '\U0001F525': 'M12 21c3.6 0 6.2-2.5 6.2-5.9 0-4.3-3.7-6-4.6-10.6-2 1.3-3.5 3.4-3.5 5.6 0 1.4-.9 2.1-1.7 1.5-.8-.6-1-1.7-.9-2.6-1.3 1.6-2 3.6-2 5.7C5.5 18.3 8.2 21 12 21z',   # flame
 '\U0001F3D7': 'M4.4 20.6V4h1.8l12 3.4M6.2 7.4h8v3.2M10.2 10.6v3.2M8.6 13.8h3.2M2.4 20.6h19.2',        # crane
 '\U000026A1': 'M13.6 2.6L5.6 13.4h5.1L10 21.4l8.4-11h-5.4z',                                          # bolt
 '\U0001F3E2': 'M5 20.6V4.6h9v16M14 20.6V9.6h5v11M3 20.6h18M7.6 8h1.2M11 8h1.2M7.6 11.4h1.2M11 11.4h1.2M7.6 14.8h1.2M11 14.8h1.2M16.2 12.8h1.2M16.2 16.2h1.2',   # office block
 '\U0001F3AF': 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7.6a4.4 4.4 0 1 0 0 8.8 4.4 4.4 0 0 0 0-8.8zM12 11.2a.8.8 0 1 0 0 1.6.8.8 0 0 0 0-1.6z',   # target
 '\U0001F94A': 'M6.6 14.6V9.6A4.6 4.6 0 0 1 11.2 5h3.4a3.4 3.4 0 0 1 3.4 3.4v3.2a3 3 0 0 1-3 3zM6.6 14.6h11.4v3.6a2 2 0 0 1-2 2H8.6a2 2 0 0 1-2-2zM14.6 5v4.6',   # boxing glove
 '\U0001F5E1': 'M3.6 20.4l7.4-7.4M11.4 12.6l7.4-7.4a1.4 1.4 0 0 1 2 2l-7.4 7.4zM9.2 10.4l4.4 4.4',     # dagger
 '\U00002694': 'M3.6 4h2.8l9.6 9.6-2.8 2.8zM20.4 4h-2.8L8 13.6l2.8 2.8zM4.8 20.4l3-3M19.2 20.4l-3-3',  # crossed swords
 '\U0001F4AA': 'M3.6 15.6c0-3 1.7-5 4.5-5 1.8 0 2.8.8 3.8.8 1.2 0 1.5-1.4 3.1-1.4 2.6 0 5 2.2 5 5.4 0 2.6-1.8 4.2-4.4 4.2H8.1c-2.9 0-4.5-1.6-4.5-4zM7.7 10.6V6.4h4.6v3.4',   # flexed bicep
 '\U00002695': 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7.6v8.8M7.6 12h8.8',                           # medical cross in a circle
 '\U00002B50': 'M12 3.2l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z',            # star
 '\U0001F575': 'M4.4 10.6h15.2M7.4 10.6c0-3.5 1.6-5.5 4.6-5.5s4.6 2 4.6 5.5M6.5 14.4a2.2 2.2 0 1 0 4.4 0 2.2 2.2 0 0 0-4.4 0zM13.1 14.4a2.2 2.2 0 1 0 4.4 0 2.2 2.2 0 0 0-4.4 0zM10.9 14.4h2.2',   # detective
 '\U0001F4E6': 'M3.4 7.6L12 3.6l8.6 4v8.8L12 20.4l-8.6-4zM3.4 7.6L12 11.6l8.6-4M12 11.6v8.8M7.7 5.6l8.6 4',   # package
 '\U0001F3ED': 'M3 20.6V10.6l5 3v-3l5 3v-3l5 3V5.4h3.4v15.2zM2 20.6h20M7 16.6h1.2M12 16.6h1.2M17 16.6h1.2',   # factory
 '\U0001F4E1': 'M3.6 20.4l6.4-6.4M4.6 13.4l6 6a4.3 4.3 0 0 1-6-6zM12.6 4.2a8 8 0 0 1 7.2 7.2M12.4 8.4a4 4 0 0 1 3.2 3.2',   # satellite dish
 '\U0001F6A9': 'M6 21V3.4M6 4.6h11.6l-2.6 3.6 2.6 3.6H6z',                                             # flag
 '\U0001F680': 'M12 3c3.2 2.4 4.8 6 4.8 9.4l-2 4.6H9.2l-2-4.6C7.2 9 8.8 5.4 12 3zM12 9.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2zM9.2 17l-1.4 3.9 3-1.5M14.8 17l1.4 3.9-3-1.5',   # rocket
 '\U0001F4C4': 'M6.6 3.6h7.2L18 7.8v12.6H6.6zM13.6 3.6v4.4H18M9.4 12.6h5.2M9.4 16h4',                  # document
 '\U0001F9E0': 'M9.6 4.4A3 3 0 0 0 6.4 7a2.8 2.8 0 0 0-2.2 4.6A3 3 0 0 0 5.4 16a3 3 0 0 0 4.2 3.4zM14.4 4.4A3 3 0 0 1 17.6 7a2.8 2.8 0 0 1 2.2 4.6A3 3 0 0 1 18.6 16a3 3 0 0 1-4.2 3.4zM12 4.2v15.6',   # brain
 '\U0001F5FA': 'M3 6.4l6-2.4 6 2.4 6-2.4v13.6l-6 2.4-6-2.4-6 2.4zM9 4v13.6M15 6.4V20',                 # folded map
 '\U0001F30E': 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3.2 9.6h17.6M3.2 14.4h17.6M12 3c2.4 2.4 3.6 5.5 3.6 9s-1.2 6.6-3.6 9c-2.4-2.4-3.6-5.5-3.6-9S9.6 5.4 12 3z',   # globe
 '\U0001F6F0': 'M8.4 8.4l3.2-3.2 4 4-3.2 3.2zM4.2 8.2l2.8-2.8 2.4 2.4-2.8 2.8zM14.6 14.6l2.8-2.8 2.4 2.4-2.8 2.8zM12.4 12.4l-3.2 3.2M9.6 21a5.6 5.6 0 0 0-5.6-5.6',   # satellite
 '\U0001F3D9': 'M2 20.6V12h4v8.6M6 20.6v-6.2h4.6v6.2M10.6 20.6V6.6h4.8v14M15.4 20.6v-8.4H22v8.4M2 20.6h20M8 16.4h1M12.6 10h1M12.6 14h1M18 15h1',   # city skyline
 '\U0001F3D4': 'M2 19.6l7-10.6 4.2 6.2 2.4-3.4 6.4 7.8zM6.4 13.2l2.6-1.5 2.2 1.7M15.2 15l1-1.4 1.2 1.2',   # snow-capped mountain
 '\U0001F3DB': 'M2.6 9.6L12 4l9.4 5.6zM4.8 9.6V18M9.2 9.6V18M14.8 9.6V18M19.2 9.6V18M2.6 18h18.8M2.6 20.6h18.8',   # classical / government building
 '\U0001F46A': 'M7 5.4a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM3.6 20.4v-3.2A3.4 3.4 0 0 1 7 13.8a3.4 3.4 0 0 1 3.4 3.4M17 5.4a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13.6 17.2a3.4 3.4 0 0 1 3.4-3.4 3.4 3.4 0 0 1 3.4 3.4v3.2M12 12.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2zM9.4 20.4v-1.6A2.6 2.6 0 0 1 12 16.2a2.6 2.6 0 0 1 2.6 2.6v1.6',   # family
 '\U0001F393': 'M2.4 9.2L12 5l9.6 4.2L12 13.4zM6.4 11v4.6c0 1.6 2.5 2.8 5.6 2.8s5.6-1.2 5.6-2.8V11M21.6 9.2v5.2',   # graduation cap
 '\U0001F9D3': 'M11 4a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM8.6 20.4v-5.6A2.8 2.8 0 0 1 11.4 12h.2a2.8 2.8 0 0 1 2.8 2.8v5.6M17.6 12.4c1.3 0 2 .9 2 2v6M4.4 20.4h15.6',   # elderly with a cane
 '\U0001F504': 'M20.4 12a8.4 8.4 0 0 1-14.3 6M3.6 12a8.4 8.4 0 0 1 14.3-6M17.9 2.4V6h-3.6M6.1 21.6V18h3.6',   # rotate / refresh
 '\U000023F1': 'M12 7.4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM12 11v3.4l2.4 1.6M9.6 2.6h4.8M12 2.6v4.8M18.6 6.2l1.8-1.8',   # stopwatch
 '\U0001F4F7': 'M3.6 8.4h3.6l1.4-2.2h6.8l1.4 2.2h3.6v10.2H3.6zM12 10.4a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8z',   # camera
 '\U0001F321': 'M14 14.6V5.4a2 2 0 1 0-4 0v9.2a4 4 0 1 0 4 0zM12 8.6v7.4M16.4 6.6h2.6M16.4 10h2.6',    # thermometer
 '\U0001F4F6': 'M4.4 20.4v-3.6M9.4 20.4v-7.2M14.4 20.4v-10.8M19.4 20.4V6',                             # signal bars
 '\U0001F3A7': 'M4.4 16.4v-3.8a7.6 7.6 0 0 1 15.2 0v3.8M4.4 14.4h1.9a1.6 1.6 0 0 1 1.6 1.6v3a1.6 1.6 0 0 1-1.6 1.6H4.4zM19.6 14.4h-1.9a1.6 1.6 0 0 0-1.6 1.6v3a1.6 1.6 0 0 0 1.6 1.6h1.9z',   # headphones
 '\U00002705': 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM7.8 12.2l2.9 2.9 5.5-5.5',                        # check in a circle
 '\U0001F517': 'M9.6 14.4l4.8-4.8M10.8 6.9l1.5-1.5a3.9 3.9 0 0 1 5.5 5.5l-1.5 1.5M13.2 17.1l-1.5 1.5a3.9 3.9 0 0 1-5.5-5.5l1.5-1.5',   # chain link
 '\U00002728': 'M12 3l1.7 4.6L18.3 9.3 13.7 11 12 15.6 10.3 11 5.7 9.3 10.3 7.6zM18.4 15.2l.8 2.1 2.1.8-2.1.8-.8 2.1-.8-2.1-2.1-.8 2.1-.8zM5.6 14.6l.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6z',   # sparkles
 '\U0001F4F1': 'M7.6 2.8h8.8a1.6 1.6 0 0 1 1.6 1.6v15.2a1.6 1.6 0 0 1-1.6 1.6H7.6A1.6 1.6 0 0 1 6 19.6V4.4a1.6 1.6 0 0 1 1.6-1.6zM10.6 18.4h2.8',   # mobile handset
 '\U00002601': 'M7.4 19a4.4 4.4 0 0 1-.5-8.8 5.6 5.6 0 0 1 10.7 1.3A3.8 3.8 0 0 1 16.8 19z',           # cloud
 '\U0001F4CD': 'M12 21.4s6.4-6.1 6.4-10.4a6.4 6.4 0 1 0-12.8 0C5.6 15.3 12 21.4 12 21.4zM12 8.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8z',   # round pushpin
 '\U0001F4C5': 'M4.6 6.4h14.8v14H4.6zM4.6 10.6h14.8M8.6 3.6v4M15.4 3.6v4M8.4 14h1.2M13.4 14h1.2M8.4 17.2h1.2M13.4 17.2h1.2',   # calendar
}
# The presentation-selector variants draw the same icon. Keys are the exact live strings, so U+FE0F is its own key.
for _base, _var in (('\U0001F6E1', '\U0001F6E1\U0000FE0F'), ('\U0001F6F0', '\U0001F6F0\U0000FE0F'),
                    ('\U0001F3D9', '\U0001F3D9\U0000FE0F'), ('\U0001F3D4', '\U0001F3D4\U0000FE0F'),
                    ('\U0001F3DB', '\U0001F3DB\U0000FE0F'), ('\U0001F321', '\U0001F321\U0000FE0F')):
    ICON_SVG[_var] = ICON_SVG[_base]
ICON_SVG['\U0001F50E'] = ICON_SVG['\U0001F50D']   # the tilted lens is the same lens
ICON_SVG['\U0001F30D'] = ICON_SVG['\U0001F30E']   # and the two globes are the same globe

# 70 rows, read out of reference/live/ this turn and verified against the markup. The third element is the card's
# own title, for a reviewer; the swap keys on (class, glyph) in document order and never on the title.
ICON_SWAPS = {
  'executive-protection': [                      # 6, all .card-icon inside .service-card
    ('card-icon', '\U0001F6E1', 'Close Protection'),
    ('card-icon', '\U0001F50D', 'Advance Operations'),
    ('card-icon', '\U0001F697', 'Motorcade Planning'),
    ('card-icon', '\U0001F935', 'Body Man Duties'),
    ('card-icon', '\U000026A0', 'Crisis Management'),
    ('card-icon', '\U0001F3E5', 'Emergency Response'),
    # Location Baseline: five <div style="color:#C9A84C; font-size:1.8rem"> tiles with NO class at all, which is
    # why the class-keyed enumeration missed them for two rounds. They render inside .service-card.
    ('', '\U0001F30E', 'Terrain'),
    ('', '\U00002601', 'Weather'),
    ('', '\U0001F4CD', 'Range of Ops'),
    ('', '\U0001F50D', 'Advance Recon'),
    ('', '\U0001F4C5', 'Schedule Tempo'),
  ],
  'residential-protection': [                    # 10
    ('pillar-icon', '\U0001F6E1', '24/7 Guard Force'),
    ('pillar-icon', '\U0001F441', 'AI Surveillance'),
    ('pillar-icon', '\U0001F512', 'Access Control'),
    ('pillar-icon', '\U000026A0', 'Emergency Response'),
    ('card-icon', '\U0001F3E0', 'Estate Security'),
    ('card-icon', '\U0001F4F9', 'Remote Monitoring'),
    ('card-icon', '\U0001F6A8', 'Alarm Integration'),
    ('card-icon', '\U0001F511', 'Safe Room Planning'),
    ('card-icon', '\U0001F436', 'K-9 Security'),
    ('card-icon', '\U0001F4CB', 'Vulnerability Assessment'),
  ],
  'disaster-recovery': [                         # 6, all .scenario-icon
    ('scenario-icon', '\U0001F300', 'Hurricanes & Storms'),
    ('scenario-icon', '\U0001F30A', 'Flooding'),
    ('scenario-icon', '\U0001F525', 'Fire & Structural'),
    ('scenario-icon', '\U0001F3D7', 'Industrial Incidents'),
    ('scenario-icon', '\U000026A1', 'Power Grid Failures'),
    ('scenario-icon', '\U0001F3E2', 'Commercial Properties'),
  ],
  'training': [                                  # 12
    ('card-icon', '\U0001F50E', 'Advanced Threat Assessment & Risk Management'),
    ('card-icon', '\U0001F697', 'Tactical Driving & Motorcade Operations'),
    ('card-icon', '\U0001F4CB', 'Strategic Mission Planning & Execution'),
    ('card-icon', '\U0001F6E1', 'Close Protection Techniques & Body Man Duties'),
    ('card-icon', '\U000026A0', 'Crisis Management & Emergency Response'),
    ('disc-icon', '\U0001F3AF', 'Firearms'),
    ('disc-icon', '\U0001F94A', 'Hand Combat'),
    ('disc-icon', '\U0001F5E1', 'Knife Combat'),
    ('disc-icon', '\U00002694', 'CQB'),
    ('disc-icon', '\U0001F4AA', 'Fitness'),
    ('disc-icon', '\U00002695', 'Medical'),
    ('disc-icon', '\U00002B50', 'Leadership'),
  ],
  'cuas-aerodefense': [                          # 8
    ('threat-icon', '\U0001F575', 'Espionage'),
    ('threat-icon', '\U0001F4E6', 'Contraband Delivery'),
    ('threat-icon', '\U000026A0', 'Criminal Warning'),
    ('threat-icon', '\U0001F3ED', 'Infrastructure Attacks'),
    ('icon-item', '\U0001F4E1', 'Detection'),
    ('icon-item', '\U0001F6A9', 'Alert'),
    ('icon-item', '\U0001F680', 'Autonomous Response'),
    ('blog-icon', '\U0001F4C4', 'How cUAS Aerodefense Stops Drone Threats'),
  ],
  'ep-app': [                                    # 28
    ('feature-icon', '\U0001F9E0', 'PROACTIVE BIOMETRIC MONITORING'),
    ('feature-icon', '\U0001F5FA', 'BLUE FORCE TRACKING'),
    ('feature-icon', '\U0001F512', 'ENCRYPTED COMMS'),
    ('feature-icon', '\U0001F6A8', 'SMART EMERGENCY CHAIN'),
    ('feature-icon', '\U0001F30E', 'WORLD INTELLIGENCE'),
    ('feature-icon', '\U0001F6F0', '6-LAYER COMMS STACK'),
    ('feature-icon', '\U0001F6E1\U0000FE0F', 'COUNTER-UAS DETECTION'),
    ('feature-icon', '\U0001F4AA', 'CYBER DEFENSE & AUTO-DISCONNECT'),
    # 6-Layer Comms Stack: six <div style="font-size:28px"> tiles with NO class. These are the six Brockmann was
    # looking at on 2026-09-09 when he asked for the page to be "clean and vibrant", and they survived the first
    # icon pass because that pass enumerated by class name.
    ('', '\U0001F4F6', 'CELLULAR'),
    ('', '\U0001F4E1', 'WiFi'),
    ('', '\U0001F517', 'MESH'),
    ('', '\U0001F6F0\U0000FE0F', 'IRIDIUM'),
    ('', '\U00002728', 'STARLINK'),
    ('', '\U0001F4F1', 'SAT PHONE'),
    ('feature-icon', '\U0001F3D9\U0000FE0F', 'STANDARD EP DETAIL'),
    ('feature-icon', '\U0001F3D4\U0000FE0F', 'RURAL / LOW COVERAGE'),
    ('feature-icon', '\U0001F30D', 'INTERNATIONAL / DENIED'),
    ('feature-icon', '\U0001F3DB\U0000FE0F', 'GOVERNMENT / ENTERPRISE'),
    ('audience-icon', '\U0001F6E1\U0000FE0F', 'EXECUTIVE PROTECTION TEAMS'),
    ('audience-icon', '\U0001F46A', 'FAMILIES & PARENTS'),
    ('audience-icon', '\U0001F393', 'COLLEGE STUDENTS'),
    ('audience-icon', '\U0001F3E5', 'HEALTHCARE WORKERS'),
    ('audience-icon', '\U0001F9D3', 'ELDERLY / FALL DETECTION'),
    ('audience-icon', '\U0001F3E2', 'CORPORATE SECURITY'),
    ('hw-card-icon', '\U0001F504', 'ATLAS EP RADAR COMPANION'),
    ('hw-card-icon', '\U0001F4E1', 'GARMIN INREACH MINI 2'),
    ('hw-card-icon', '\U000023F1', 'APPLE WATCH ULTRA 2'),
    ('hw-card-icon', '\U0001F4F7', 'HYTERA HP682 DMR RADIO'),
    ('hw-card-icon', '\U0001F321\U0000FE0F', 'INFIRAY P2 PRO'),
    ('hw-card-icon', '\U0001F525', 'FLIR ONE PRO'),
    ('hw-card-icon', '\U0001F441', 'SEEK THERMAL COMPACTPRO'),
    ('hw-card-icon', '\U0001F4F6', 'MOTOROLA CLP1010'),
    ('hw-card-icon', '\U0001F3A7', 'OTTO COVERT EARPIECE'),
    ('success-icon', '\U00002705', 'ACCESS REQUEST RECEIVED'),
  ],
  'contact': [                                   # 1, class-less, inside #contact-success (display:none until send)
    ('', '\U00002705', 'Thank you for your interest in Atlas Glinn.'),
  ],
}
ICON_CLASSES = ('feature-icon', 'audience-icon', 'hw-card-icon', 'success-icon', 'card-icon',
                'pillar-icon', 'scenario-icon', 'disc-icon', 'threat-icon', 'icon-item', 'blog-icon')
# ── THE ENUMERATION IS BY POSITION, NOT BY CLASS, AND THAT IS THE R6 CORRECTION ──
# ICON_EL below matched only an element carrying one of the eleven classes above. Eleven emoji tiles on the twelve
# pages carry NO class at all — six on ep-app ("6-Layer Comms Stack", `<div style="font-size:28px">📶</div>`) and
# five on executive-protection ("Location Baseline", `<div style="color:#C9A84C; font-size:1.8rem">🌎</div>`) —
# so the table never declared them, the swap never reached them, and the assert that said "no emoji survives"
# iterated a set they were not in. Six full-colour OS emoji stood directly above six blue monoline cards on the
# exact page Brockmann was looking at.
# ICON_ANY_EL is the fix: EVERY leaf <span>/<div> inside the content whose entire text is emoji is a candidate,
# class or no class, and every candidate must be declared either in ICON_SWAPS (drawn) or in ICON_KEEP (left as
# live text, with the reason). A tile nothing declares is a build failure now instead of a screenshot finding.
ICON_EL = re.compile(r'<(span|div)([^>]*\bclass="(?:[^"]*\s)?(%s)(?:\s[^"]*)?"[^>]*)>([^<]*)</\1>'
                     % '|'.join(ICON_CLASSES))
# EVERY leaf element, not just span/div: the live pages print an emoji inside a <button> too (the hero's
# #sound-toggle mute control on five pages). render-audit check 6 walks `.agx-content *` in the browser and would
# otherwise see a leaf this walk cannot, which is how two passes measuring the same thing drift apart.
ICON_ANY_EL = re.compile(r'<(span|div|button|a|p|li|td|th|h[1-6]|strong|em|b|i|small|figcaption|label)'
                         r'([^>]*)>([^<]*)</\1>')
_CLASS_IN_TAG = re.compile(r'\bclass="([^"]*)"')
# The same code-point ranges assemble-atlas.py and compare-atlas.py compile, plus the two joiners a live glyph may
# carry: U+FE0F/U+FE0E select a presentation and U+200D joins, and neither is content.
_EMOJI_ONLY = re.compile('(?:[\U0001F300-\U0001FAFF\u2600-\u27BF\u2B00-\u2BFF\u2300-\u23FF]'
                         '[\uFE0F\uFE0E]?\u200D?)+$')

# Glyphs the pages keep as live text, by page, in document order, with the reason. #sound-toggle is the live hero's
# mute control on five pages and its OWN script rewrites `btn.innerHTML` between 🔇 and 🔊 on every click
# (reference/live/index.html:407-408) — an <svg> put there would be overwritten by the page's handler the first
# time a reader clicks it, so it is not a drawing this build gets to own. An entry here is a DEPARTURE
# FROM THE SWAP, not from the comparison: the text unit stays on both sides and compare-atlas still asserts it.
ICON_KEEP = {
  'index':                  [('', '\U0001F507', 'the hero mute control; the live script rewrites its innerHTML'),
                             ('', '\u2605' * 5, 'a five-star rating, not an icon')],
  'executive-protection':   [('', '\u2605' * 5, 'a five-star rating, not an icon')],
  'residential-protection': [('', '\U0001F507', 'the hero mute control; the live script rewrites its innerHTML'),
                             ('', '\u2605' * 5, 'a five-star rating, not an icon')],
  'disaster-recovery':      [('', '\U0001F507', 'the hero mute control; the live script rewrites its innerHTML'),
                             ('', '\u2605' * 5, 'a five-star rating, not an icon')],
  'training':               [('', '\U0001F507', 'the hero mute control; the live script rewrites its innerHTML'),
                             ('', '\u2605' * 5, 'a five-star rating, not an icon')],
  'technology':             [('', '\u2605' * 5, 'a five-star rating, not an icon')],
  'cuas-aerodefense':       [('', '\U0001F507', 'the hero mute control; the live script rewrites its innerHTML'),
                             ('', '\u2605' * 5, 'a five-star rating, not an icon')],
  'uas':                    [('', '\u2605' * 5, 'a five-star rating, not an icon')],
  'careers':                [('', '\u2605' * 5, 'a five-star rating, not an icon')],
  'about': [
    # Not a card icon: it is the stand-in for a portrait the site does not have, inside the same 240x300 framed
    # box the other three team photographs fill, at 3rem and opacity .3. A 24px ringed SVG in a 300px-tall frame
    # would read as an icon tile rather than a missing headshot, so it is left and named instead of swapped.
    ('', '\U0001F6E1', 'J. Reneé Renobato portrait placeholder, a 240x300 frame with no photograph'),
    ('', '\u2605' * 5, 'a five-star rating, not an icon'),
  ],
}
assert all(g in ICON_SVG for rows in ICON_SWAPS.values() for _c, g, _t in rows), \
    'ICON_SWAPS names a glyph ICON_SVG does not draw'
# The mechanical bound between the tables and the emoji ranges. Without it two hand-edits could name any leaf
# element by (class, text) and withhold arbitrary live copy from the comparison by declaring it an "icon".
for _tbl, _name in ((ICON_SWAPS, 'ICON_SWAPS'), (ICON_KEEP, 'ICON_KEEP')):
    for _slug, _rows in _tbl.items():
        for _c, _g, _t in _rows:
            assert _EMOJI_ONLY.fullmatch(_g), '%s[%s] declares %r, which is not emoji' % (_name, _slug, _g)
for _slug in set(ICON_SWAPS) | set(ICON_KEEP):
    _clash = {(c, g) for c, g, _t in ICON_SWAPS.get(_slug, ())} & {(c, g) for c, g, _t in ICON_KEEP.get(_slug, ())}
    assert not _clash, '%s: %r is both drawn and kept — the walk could not tell them apart' % (_slug, _clash)


def icon_leaves(markup, pos=0, endpos=None):
    """(class, glyph) of every leaf <span>/<div> whose ENTIRE text content is emoji, in document order, class or
    no class. `[^<]*` is deliberate: an element with a child element is not a leaf and is not a candidate.
    pos/endpos bound the walk to the content region; offsets stay absolute."""
    import html as H
    out = []
    for m in ICON_ANY_EL.finditer(markup, pos, len(markup) if endpos is None else endpos):
        t = H.unescape(m.group(3)).strip()
        if t and _EMOJI_ONLY.fullmatch(t):
            c = _CLASS_IN_TAG.search(m.group(2))
            out.append((c.group(1).strip() if c else '', t))
    return out


def icon_walk(slug, markup, pos=0, endpos=None):
    """Every emoji leaf resolved against the two tables, in document order: [(match, 'svg'|'keep', class, glyph)].
    Raises on a leaf neither table declares, on one declared out of order, and on a declared row the page no longer
    carries — the tables are the contract, not a hint. pos/endpos bound the walk to the content region."""
    import html as H
    want, keep = list(ICON_SWAPS.get(slug, ())), list(ICON_KEEP.get(slug, ()))
    out, k, j = [], 0, 0
    for m in ICON_ANY_EL.finditer(markup, pos, len(markup) if endpos is None else endpos):
        glyph = H.unescape(m.group(3)).strip()
        if not glyph or not _EMOJI_ONLY.fullmatch(glyph):
            continue
        c = _CLASS_IN_TAG.search(m.group(2))
        cls = c.group(1).strip() if c else ''
        if k < len(want) and (cls, glyph) == want[k][:2]:
            out.append((m, 'svg', cls, glyph)); k += 1
        elif j < len(keep) and (cls, glyph) == keep[j][:2]:
            out.append((m, 'keep', cls, glyph)); j += 1
        else:
            raise AssertionError(
                '%s: emoji leaf %d is (%r, %r); ICON_SWAPS expects %r and ICON_KEEP expects %r'
                % (slug, len(out), cls, glyph, want[k][:2] if k < len(want) else None,
                   keep[j][:2] if j < len(keep) else None))
    assert (k, j) == (len(want), len(keep)), \
        '%s: the capture spends %d of %d ICON_SWAPS rows and %d of %d ICON_KEEP rows' \
        % (slug, k, len(want), j, len(keep))
    return out


def skin_icons(slug, body):
    """Every declared emoji-as-icon glyph replaced by its inline monoline SVG, in document order. A class-less tile
    gets the 48px ring as a wrapper span, because the ring rule can only be written against a class and these
    elements have none — the tile's own tag, class and inline style still survive byte for byte."""
    out, pos = [], 0
    for m, act, cls, glyph in icon_walk(slug, body):
        if act != 'svg':
            continue
        svg = (_SVG_OPEN % _glyph_key(glyph)) + '<path d="' + ICON_SVG[glyph] + '"/></svg>'
        if not cls:
            svg = '<span class="agx-icon-ring">' + svg + '</span>'
        # m.start(3)/m.end(3): only the text BETWEEN the tags is replaced.
        out.append(body[pos:m.start(3)])
        out.append(svg)
        pos = m.end(3)
    out.append(body[pos:])
    return ''.join(out)


# ── The cinema layer's markup: four fixed layers and the rail, printed BEFORE the sticky bar so the compare sheet's
#    content span (mobile menu → <footer>) never sees them and the parity yardstick stays exactly where it was. ──
def cinema_chrome(chapters):
    """chapters: [(anchor id, rail label, backdrop)] in order. A backdrop is an image URL, an .mp4 the page already
    serves, a `yt:<id>` the live page already embeds, or None where the live page carries no imagery at all."""
    layers = []
    for k, (anchor, _label, back) in enumerate(chapters, 1):
        if not back:
            layers.append('  <div class="agx-ph" data-for="%02d"></div>' % k)
        elif back.startswith('yt:'):
            vid = back[3:]
            layers.append('  <div class="agx-ph agx-yt" data-for="%02d"><iframe data-src="https://www.youtube.com/embed/%s'
                          '?autoplay=1&amp;mute=1&amp;loop=1&amp;playlist=%s&amp;controls=0&amp;showinfo=0&amp;modestbranding=1'
                          '&amp;rel=0&amp;playsinline=1&amp;iv_load_policy=3&amp;disablekb=1" title="" tabindex="-1" aria-hidden="true"'
                          ' allow="autoplay; encrypted-media" referrerpolicy="strict-origin-when-cross-origin"></iframe></div>'
                          % (k, vid, vid))
        elif re.search(r'\.(?:mp4|webm|mov)(?:$|[?#])', back, re.I):
            layers.append('  <div class="agx-ph agx-film" data-for="%02d"><video muted loop playsinline preload="none" '
                          'aria-hidden="true"><source src="%s" type="video/mp4"></video></div>' % (k, back))
        else:
            layers.append('  <div class="agx-ph" data-for="%02d" style="background-image:url(\'%s\')"></div>' % (k, back))
    # A chapter that opens on a lede paragraph has no heading of its own. Its tick used to carry the chapter number as
    # its hover label, and that printed a text unit — "02" — that no live page carries. The tick itself is drawn by the
    # link's ::after rule and needs no text, so a heading-less chapter gets an empty label and an aria-label: the reader
    # sees the tick, a screen reader hears the chapter number, and the page prints no label at all.
    rail = ''.join('  <a class="agx-rail-link" href="#%s"%s><span>%s</span></a>\n'
                   % (anchor, '' if label else ' aria-label="Chapter %02d"' % k, label or '')
                   for k, (anchor, label, _) in enumerate(chapters, 1))
    # The four HUD corners. Their text is CSS `content` — no text node, no unit, no excuse — and three of them are
    # aria-hidden because they carry nothing a reader needs that the rail does not already expose. The top-left is
    # the exception and it is a real <a> home: its visible line is generated content, so the aria-label is the ONE
    # unit it adds, and compare-atlas.A11Y carries it as a spent-once attribute excuse.
    hud = ('<a href="index.html" class="agx-hud agx-hud-tl" aria-label="Atlas Glinn, Houston"></a>\n'
           '<div class="agx-hud agx-hud-tr" id="agx-section-hud" data-n="01" data-of="%02d" aria-hidden="true"></div>\n'
           '<div class="agx-hud agx-hud-bl" aria-hidden="true"></div>\n'
           '<div class="agx-hud agx-hud-br" aria-hidden="true"></div>\n'
           % len(chapters))
    return ('<canvas id="agx-canvas" aria-hidden="true"></canvas>\n'
            '<div id="agx-photos" aria-hidden="true">\n%s\n</div>\n'
            '<div class="agx-grain" aria-hidden="true"></div>\n<div class="agx-vignette" aria-hidden="true"></div>\n'
            '<div id="agx-progress" aria-hidden="true"></div>\n'
            '%s'
            '<div class="agx-rail" role="navigation" aria-label="Chapters">\n%s</div>\n'
            % ('\n'.join(layers), hud, rail))


# ── The cinema layer's behaviour, in a plain script so it runs whether or not the three.js module loads. The entrance
#    motion, the backdrop crossfade, the rail and the progress line are all here; the module below only draws. ──
CINEMA_JS = r"""
(function () {
  var doc = document.documentElement;
  var chs = [].slice.call(document.querySelectorAll('.agx-ch'));
  var phs = [].slice.call(document.querySelectorAll('#agx-photos .agx-ph'));
  var links = [].slice.call(document.querySelectorAll('.agx-rail-link'));
  var bar = document.getElementById('agx-progress');
  var hud = document.getElementById('agx-section-hud');
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!chs.length) return;

  // ── Backdrops ── one chapter's photograph or film at a time; a film plays only while its chapter is on screen.
  var photoIdx = -1;
  function setPhoto(i) {
    if (i === photoIdx) return; photoIdx = i;
    phs.forEach(function (p, k) {
      var on = k === i;
      p.classList.toggle('agx-on', on);
      var v = p.querySelector('video');
      if (v) { if (on && !reduce) { var q = v.play(); if (q && q.catch) q.catch(function () {}); } else v.pause(); }
      var f = p.querySelector('iframe[data-src]');
      if (f) {
        if (on && !reduce) { if (!f.getAttribute('src')) { f.addEventListener('load', function () { f.classList.add('agx-playing'); }, { once: true }); f.src = f.dataset.src; } }
        else if (f.getAttribute('src')) { f.classList.remove('agx-playing'); f.removeAttribute('src'); }
      }
    });
  }
  document.querySelectorAll('#agx-photos video').forEach(function (v) {
    v.addEventListener('playing', function () { v.classList.add('agx-playing'); });
  });
  window.agxSetPhoto = setPhoto;

  // ── Entrance motion ── the class that arms it is added here, so a page whose script never ran shows everything.
  function reveal(el) { el.classList.add('agx-in'); }
  if (reduce || !('IntersectionObserver' in window)) { chs.forEach(reveal); }
  else {
    doc.classList.add('agx-motion');
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        reveal(e.target); io.unobserve(e.target);
        setTimeout(function () { unhide(e.target); }, 700);
      });
    }, { threshold: 0, rootMargin: '0px 0px -8% 0px' });
    chs.forEach(function (c) { io.observe(c); });
    // Belt and braces: anything within a screen and a bit of the top turns on after three seconds whatever the
    // observer did, so a chapter can never be left at opacity 0 in front of a reader.
    setTimeout(function () { chs.forEach(function (c) { if (c.getBoundingClientRect().top < innerHeight * 1.25) { reveal(c); unhide(c); } }); }, 3000);
  }

  // ── The live page's own reveals ──
  // Eleven of the twelve pages reveal their blocks on scroll with `.reveal` → `.active`; ep-app uses `.fade-in` →
  // `.visible`. Measured on main at 1440x900: after a full scroll pass, 11 blocks on index, 11 on training and 15 on
  // ep-app were still at opacity 0 — service cards, testimonials, discipline cards, hardware cards. A block a reader
  // has scrolled to is not allowed to stay invisible, so when a chapter arrives its own blocks are turned on with the
  // page's own class. The live observer usually gets there first; this only ever closes a gap.
  var LIVE_REVEALS = [['.reveal', 'active'], ['.fade-in', 'visible']];
  function unhide(root) {
    if (!root) return;
    LIVE_REVEALS.forEach(function (pair) {
      [].slice.call(root.querySelectorAll(pair[0])).forEach(function (el) { el.classList.add(pair[1]); });
    });
  }

  // ── The HUD lane ──
  // The two bottom corners are position:fixed, so every screenful of the page passes underneath them. Walked with
  // render-audit.mjs's own scroll-walk (check 7) the two corners covered 33 live text runs across the twelve pages
  // before this gate existed. A corner therefore goes to opacity 0 the moment a visible line box is inside its box
  // and fades back when the lane clears. The class below is what turns the HUD on at all, so a page whose script
  // never ran shows no HUD rather than a HUD across a sentence.
  var huds = [].slice.call(document.querySelectorAll('.agx-hud'));
  var lines = [], paints = [];
  function collectLines() {
    var all = [].slice.call(document.querySelectorAll('body *'));
    lines = all.filter(function (el) {
      if (el.closest('.agx-hud, .agx-rail, .agx-sitenav, .agx-menu-btn, script, style')) return false;
      for (var i = 0; i < el.childNodes.length; i++) {
        var n = el.childNodes[i];
        if (n.nodeType === 3 && n.nodeValue.trim()) return true;
      }
      return false;
    });
    // ── THE SECOND PASS, AND THE SCREENSHOT THAT FORCED IT (r6, 2026-09-10) ──
    // The first gate intersected TEXT LINE BOXES only, so an opaque painted surface whose label sits a few pixels
    // higher never tripped it. Deterministic repro: technology.html at 1280x800, scrollY 1645 — the PARTNER PAGE
    // button box [32,238,730,781] with a linear-gradient(135deg,#1A6BDE,#0F4AA8) fill, .agx-hud-bl at
    // [26,213,766,782], overlap true, agx-clear FALSE, and "ATLAS GLINN · HOUSTON" printed straight across the
    // lower third of a solid blue button. The same shape put both corners inside .feature-card and
    // .discipline-card boxes at 1280 on ep-app and training.
    // So a PAINTED SURFACE is a lane hit too: any non-fixed element with a background-image or a background-colour
    // that is not fully transparent. A surface spanning the viewport is NOT one — a full-bleed section band is the
    // page's backdrop, which is exactly what a HUD corner is meant to sit on, and counting it would leave the HUD
    // permanently cleared, i.e. hidden. Measured over 234 corner samples at 1440 across the twelve pages:
    // text-only 42 hits (192 paints), painted-surface incl. bands 146 hits (88 paints), painted-surface excluding
    // bands 80 hits (154 paints). The middle number is what ships.
    paints = all.filter(function (el) {
      if (el.closest('.agx-hud, .agx-rail, .agx-sitenav, .agx-menu-btn, #agx-photos, #agx-canvas, script, style')) return false;
      var cs = getComputedStyle(el);
      if (cs.position === 'fixed') return false;
      return (cs.backgroundImage && cs.backgroundImage !== 'none') || bgAlpha(cs.backgroundColor) > 0;
    });
  }
  function bgAlpha(c) {
    var m = /rgba?\(([^)]+)\)/.exec(c || '');
    if (!m) return 0;
    var p = m[1].split(',');
    return p.length > 3 ? parseFloat(p[3]) : 1;
  }
  // Cheap first, exact second: one getBoundingClientRect rejects an element whose whole box misses the corner, and
  // only what survives is measured PER LINE BOX with a Range — the same reading render-audit.mjs asserts against,
  // because a wrapped paragraph's union box spans the column even where its last line stops short.
  function laneHit(box) {
    for (var i = 0; i < lines.length; i++) {
      var el = lines[i], r = el.getBoundingClientRect();
      if (!(r.width > 0) || r.bottom <= box.top || r.top >= box.bottom || r.right <= box.left || r.left >= box.right) continue;
      var cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;
      for (var k = 0; k < el.childNodes.length; k++) {
        var n = el.childNodes[k];
        if (n.nodeType !== 3 || !n.nodeValue.trim()) continue;
        var rg = document.createRange();
        rg.selectNodeContents(n);
        var rects = rg.getClientRects();
        for (var j = 0; j < rects.length; j++) {
          var b = rects[j];
          if (b.width > 0 && b.height > 0 && b.right > box.left && b.left < box.right
              && b.bottom > box.top && b.top < box.bottom) return true;
        }
      }
    }
    for (var q = 0; q < paints.length; q++) {
      var pe = paints[q], pr = pe.getBoundingClientRect();
      if (!(pr.width > 0 && pr.height > 0)) continue;
      if (pr.width >= innerWidth - 2) continue;
      if (pr.bottom <= box.top || pr.top >= box.bottom || pr.right <= box.left || pr.left >= box.right) continue;
      var pcs = getComputedStyle(pe);
      if (pcs.visibility === 'hidden' || parseFloat(pcs.opacity) === 0) continue;
      return true;
    }
    return false;
  }
  var gateQueued = false;
  function gateHud() {
    gateQueued = false;
    if (!huds.length) return;
    if (!lines.length) collectLines();
    huds.forEach(function (el) {
      if (getComputedStyle(el).display === 'none') { el.classList.remove('agx-clear'); return; }
      // .agx-clear changes opacity and nothing else, so the box is the same whether or not it is set and the
      // measurement cannot oscillate with its own result.
      el.classList.toggle('agx-clear', laneHit(el.getBoundingClientRect()));
    });
  }
  function queueGate() { if (gateQueued) return; gateQueued = true; requestAnimationFrame(gateHud); }
  if (huds.length) {
    doc.classList.add('agx-hudgate');
    addEventListener('resize', function () { collectLines(); queueGate(); }, { passive: true });
    addEventListener('load', function () { collectLines(); queueGate(); });
    queueGate();
  }

  // ── The MENU overlay ──
  // sbtn.textContent on the WORD SPAN only, never on the button: the button also prints the live page's own "☰"
  // hamburger glyph, which is a live text unit compare-atlas matches, and rewriting the whole button would delete
  // it. Escape closes, a click on the scrim closes, a click on any link closes.
  var snav = document.getElementById('agx-sitenav'), sbtn = document.getElementById('agx-menu-btn');
  var sword = document.getElementById('agx-menu-word');
  var sclose = document.getElementById('agx-sitenav-close');
  if (snav && sbtn) {
    var setNav = function (open) {
      snav.classList.toggle('agx-open', open);
      if (sword) sword.textContent = open ? 'CLOSE' : 'MENU';
      sbtn.setAttribute('aria-expanded', open);
      document.body.style.overflow = open ? 'hidden' : '';
    };
    sbtn.addEventListener('click', function (e) { e.stopPropagation(); setNav(!snav.classList.contains('agx-open')); });
    if (sclose) sclose.addEventListener('click', function (e) { e.stopPropagation(); setNav(false); });
    snav.addEventListener('click', function (e) {
      if (e.target === snav || e.target.classList.contains('agx-sitenav-scrim') || e.target.closest('a')) setNav(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && snav.classList.contains('agx-open')) setNav(false);
    });
  }

  // ── Read position and the rail ──
  var active = -1;
  function here() { var mid = innerHeight * .45, idx = 0; chs.forEach(function (s, i) { if (s.getBoundingClientRect().top <= mid) idx = i; }); return idx; }
  function onScroll() {
    var total = document.documentElement.scrollHeight - innerHeight;
    if (bar) bar.style.width = (Math.max(0, Math.min(1, scrollY / Math.max(1, total))) * 100) + '%';
    queueGate();
    var idx = here();
    if (idx === active) return;
    active = idx;
    links.forEach(function (l, k) { l.classList.toggle('agx-active', k === idx); });
    if (hud) hud.setAttribute('data-n', ('0' + (idx + 1)).slice(-2));
    setPhoto(idx);
    // The chapter being read, the one behind it and the one arriving from the bottom of the window.
    [idx - 1, idx, idx + 1].forEach(function (k) { if (chs[k]) { reveal(chs[k]); unhide(chs[k]); } });
  }
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll, { passive: true });
  onScroll();
  setPhoto(0);
})();
"""

# ── The three.js layer: MAST's emblem scene, lifted whole out of cinematic_shell, on a camera path that reads one
#    number — how far down the page you are. The rail, the backdrops and the reveals are the plain script's; this
#    module draws and nothing else, so a machine without WebGL loses the scene and keeps the page.
CINEMA_LOOP = """
// ── One continuous camera path ──
// The camera reads the page's scroll fraction and nothing else. The chapter index drives the backdrop, and that lives
// in the plain script, so this module can fail on a machine without WebGL and the page still reads and still moves.
const chs = [...document.querySelectorAll('.agx-ch')];
const lerp = (a, b, t) => a + (b - a) * t;
const kf = [
%(kf)s
];
function update() {
  const total = document.documentElement.scrollHeight - innerHeight;
  const t = Math.max(0, Math.min(1, scrollY / Math.max(1, total)));
  const sc = t * (kf.length - 1), i = Math.floor(sc), f = sc - i;
  const a = kf[i], b = kf[Math.min(i + 1, kf.length - 1)];
  camera.position.set(lerp(a.x, b.x, f), lerp(a.y, b.y, f), lerp(a.z, b.z, f));
  camera.lookAt(lerp(a.lx, b.lx, f), lerp(a.ly, b.ly, f), lerp(a.lz, b.lz, f));
  const now = performance.now();
  emblem.rotation.y += 0.004; emblem.rotation.x = Math.sin(now * .0004) * .14;
  shards.forEach(s => { const ang = s.userData.a + now * .0002 * s.userData.sp; s.position.set(Math.cos(ang) * s.userData.r, Math.sin(ang * 1.3) * .6, Math.sin(ang) * s.userData.r); s.rotation.x += .02; s.rotation.y += .015; });
  rays.rotation.z += .001;
  emblem.position.y = -t * 2; emblem.scale.setScalar(1 - t * .25);
  [gd, ch].forEach(p => { const pos = p.geometry.attributes.position.array, v = p.userData.v; for (let k = 0; k < pos.length; k++) pos[k] += v[k]; p.geometry.attributes.position.needsUpdate = true; });
  gd.rotation.y = t * .3; ch.rotation.y = -t * .2; stars.rotation.y += .0002;
  scene.fog.density = 0.03 + t * .025;
}
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
let mx = 0;
addEventListener('mousemove', e => { mx = (e.clientX / innerWidth - .5) * 2; });
let paused = false;
document.addEventListener('visibilitychange', () => { paused = document.hidden; if (!paused) animate(); });
// The frame counter is the proof the scene is running: a render check reads it twice and compares.
window.__agxFrames = 0;
function animate() {
  if (paused) return;
  requestAnimationFrame(animate);
  window.__agxFrames++;
  emblem.position.x += (mx * .4 - emblem.position.x) * .04;
  update(); renderer.render(scene, camera);
}
animate();
"""

_CANVAS_OLD = "document.getElementById('three-canvas')"
_CANVAS_NEW = "document.getElementById('agx-canvas')"


def cinema_three(chapters=6, palette=shell.ATLAS):
    """MAST's emblem scene verbatim — shield, rings, shards, god rays, gold dust, stars — on an Atlas camera path with
    one keyframe per chapter. Nothing but the canvas id is changed on the way across."""
    src = shell.THREE_JS
    scene = src[src.index('// ── Three: the Tier 3 emblem scene ──'):src.index('// Scroll-driven camera')]
    assert _CANVAS_OLD in scene, 'the emblem scene no longer takes its canvas by id'
    scene = scene.replace(_CANVAS_OLD, _CANVAS_NEW)
    js = PREAMBLE + scene + (CINEMA_LOOP % {'kf': shell._keyframes(max(2, chapters))})
    for banned in ('chap-link', 'hud-section', 'SECTION 0', 'intro-seq', 'letterbox', 'three-canvas', '#photos'):
        assert banned not in js, 'the cinema module still carries the trailer chrome: ' + banned
    return shell._recolor(js, palette)
