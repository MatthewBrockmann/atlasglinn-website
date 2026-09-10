"""
atlas_shell.py — the classic one-scroll layout for the Atlas Glinn pages.

Brockmann, 2026-09-08, on the chapter preview: "too many clicks to get to content and back is confusing — look at how
easy the current site is and rebuild" and "atlasglinn needs to mimic the current site with the new build". So the Atlas
pages keep the trailer's visual system and drop the trailer's navigation: the chapter rail, the SECTION counter, the
MENU overlay and the per-chapter letterbox cuts are gone, and in their place sit the live site's sticky top bar with its
dropdown, its intro overlay with Enter / Skip Intro, its full-bleed muted hero film with the sound toggle, its footer and
a back-to-top control. Everything is one continuous scroll; the `id="sN"` anchors stay, so existing links still land.

Nothing here duplicates the shell. The palette, the type, the buttons, the cards and the three.js emblem scene are read
out of cinematic_shell and reused verbatim:
  css(palette, extra)        the shell stylesheet with the chapter-rail rules removed, plus the classic chrome
  three(sections, palette)   the shell's gold ring + reticle + photo layer + emblem scene on a continuous camera path
  chrome(...)                intro overlay, canvas, photo layer, grain, vignette, progress, reticle
  nav(items, here, logo)     the sticky bar and the mobile overlay
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
  .agx-rail, .agx-hud, #agx-progress { --agx-blue:#1A6BDE; --agx-blue-l:#5B9BFF; --agx-ink:#F0F4FF; --agx-dim:rgba(240,244,255,.55); }
  /* ── The 3D scene, the backdrop and the film grain: four fixed layers under the content ── */
  #agx-canvas { position:fixed; inset:0; width:100vw; height:100vh; height:100svh; z-index:1; pointer-events:none; }
  #agx-photos { position:fixed; inset:0; z-index:2; pointer-events:none; }
  /* The outgoing photograph leaves faster than the incoming one arrives, so the two never stack to a brighter frame
     mid-switch (Brockmann, 2026-09-04: "the background pulled forward"). */
  .agx-ph { position:absolute; inset:0; background:center/cover no-repeat; opacity:0; transition:opacity .6s ease; filter:saturate(.72) contrast(1.06); }
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
  /* ── The read-position line, on the bar's top edge rather than behind it ── */
  #agx-progress { position:fixed; top:0; left:0; height:2px; width:0; background:linear-gradient(90deg, #D4AF37, #FCF6BA, #B87333); z-index:1001; box-shadow:0 0 14px rgba(201,168,76,.7); transition:width .1s linear; pointer-events:none; }
  /* ── Chapters: each live section, full-bleed over its own backdrop ──
     display:grid with one 100% column and width:100% on the child, NOT flex: the live sections centre themselves with
     `max-width:1400px; margin:0 auto`, and an auto cross-axis margin in a flex column shrinks the item to fit-content —
     which is the shape of the render P0 that pinned a hero column to the left of the viewport. A definite width keeps
     the auto margins splitting the remainder, so the live layout is exactly what it was. */
  .agx-content { position:relative; z-index:5; }
  /* The bar is fixed and 60px tall, so a rail link that lands a chapter at scroll-position 0 puts its heading
     under the bar. Measured before this rule: index ch2/ch3/ch4 headings landed 26/26/49px from the top,
     executive-protection ch3 and technology ch3 the same. The shell's `section.panel` scroll-margin never
     applied here — a live-content page has no section.panel; the chapter wrapper is `.agx-ch`. */
  .agx-ch { position:relative; min-height:100vh; min-height:100svh; display:grid; grid-template-columns:100%; align-content:center; scroll-margin-top:72px; }
  .agx-ch > * { width:100%; }
  .agx-ch::before { content:''; position:absolute; inset:0; z-index:-1; pointer-events:none; background:linear-gradient(180deg, rgba(8,12,20,.58) 0%, rgba(8,12,20,.3) 42%, rgba(8,12,20,.72) 100%); }
  .agx-ch.agx-hero::before { background:none; }
  /* Entrance motion. The opacity rule is gated on a class the script adds at boot, so a page whose JS never runs —
     or whose IntersectionObserver never fires — shows every chapter at full strength. Nothing on an Atlas page is
     allowed to be invisible because a script did not arrive. */
  html.agx-motion .agx-ch { opacity:0; transform:translateY(26px); transition:opacity 1s cubic-bezier(.25,.6,.25,1), transform 1s cubic-bezier(.25,.6,.25,1); }
  html.agx-motion .agx-ch.agx-in { opacity:1; transform:translateY(0); }
  html.agx-motion { scroll-behavior:smooth; }
  /* ── Chapter rail: MAST's, with its numbered labels standing. A <div>, never a <nav> — the live stylesheet styles
     a bare `nav` and would fix it to the top and slide it away.
     right:1.5rem is MAST's own value (cinematic_shell.py:72) AND the live bar's own right inset: measured
     2026-09-09, the bar's right-most control ends at 1416px at 1440 and 1256px at 1280, both exactly viewport-24px,
     so the rail's right edge lines up with the bar's at every width it shows.
     THE NUMBER IS A CSS COUNTER, NOT A TEXT NODE. `01 · ` printed as markup would be a text unit no live page
     carries, and it would break the rail-label excuse in compare-atlas.rail_anchors(), which matches
     clean(anchor text) == a heading of the chapter it points at. Generated content is not in the DOM text stream,
     so text parity stays where it was and render-audit's TreeWalker never sees it. decimal-leading-zero gives the
     same two-digit padding assemble-cinematic prints for MAST. */
  .agx-rail { position:fixed; right:.45rem; top:50%; transform:translateY(-50%); z-index:900; display:none; flex-direction:column; gap:.4rem; align-items:flex-end; font-family:'Share Tech Mono',monospace; font-size:.6rem; counter-reset:agx-ch; }
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
     (208px) FOURTEEN of the 77 were cut mid-word with no ellipsis, and `text-overflow` computed `clip` on all 77. */
  .agx-rail-link:hover span { max-width:20.5rem; opacity:1; }
  .agx-rail-link.agx-active { color:var(--agx-blue-l); }
  .agx-rail-link:hover::after, .agx-rail-link.agx-active::after { width:30px; background:var(--agx-blue); box-shadow:0 0 10px rgba(26,107,222,.6); }
  /* Hidden <=768 and ticks 769-1024: the same behaviour MAST has at those widths (cinematic_shell.py:220-223 /
     mastsolutions.html:618 — display:none at 390, 0 of 13 labelled at 900 and 1024). Unchanged. */
  @media (min-width:769px) { .agx-rail { display:flex; } }
  @media (min-width:769px) and (max-width:1024px) { .agx-rail { right:.8rem; gap:.35rem; } .agx-rail-link { padding:.3rem .4rem; gap:0; } .agx-rail-link::before { display:none; } .agx-rail-link::after { width:16px; } .agx-rail-link:hover::after, .agx-rail-link.agx-active::after { width:22px; } }
  /* BROCKMANN ASKED FOR MAST'S ALWAYS-VISIBLE SIDEBAR ON 2026-09-09 17:12 — "Menu should be like the
     mastsolutions menu side bar?" — which is the one-word reversal CLAUDE.md reserved to him of the 1025-1699
     tick-only behaviour this file used to record here as "THE ACCEPTED DEVIATION". IT WAS BUILT, MEASURED, AND
     NOT SHIPPED, and the measurement is the whole reason, so it is written out here rather than summarised.
     MAST cuts itself `section.panel { padding-right:16.5rem }`. An Atlas page's sections are the LIVE page's own
     centred 1400px blocks, and the live copy runs right out to the rail: index's "Evil twin WiFi detection…" has
     a line box ending at x=1378 in a 1440px viewport, technology's "Atlas Glinn, in partnership with AeroDef…"
     at 1403. Walked down all twelve pages at 1440x900 in 0.75-viewport steps, counting a line box at a time
     (never the range's union box, which spans the whole column) and only text a reader can see:
       every label standing at 20.5rem  ->  92 live text runs covered
       every label standing at 9rem     ->  74
       the numbered tick, no label      ->  12
       the tick alone at right:1.5rem   ->   3   (technology 2, cuas-aerodefense 1)
       the tick alone at right:.45rem   ->   0   <- what ships
     A SCROLL-0 MEASUREMENT SAYS 0 FOR ALL FIVE, and that is the trap this comment exists to stop: the hero band
     is empty on the right and the grids below it are not. It is also why the rail keeps its .45rem inset instead
     of taking the bar's own 1.5rem gutter — aligning with the bar costs three lines of his copy.
     So: the label AND its number come on hover, one link at a time, which is the only form that covers nothing,
     and the reading position is marked by colour and by the longer tick instead. THE ONLY WAY TO GIVE HIM THE
     STANDING SIDEBAR IS A RIGHT GUTTER ON .agx-content, which shifts the live layout — his call, not this
     build's. render-audit.mjs check 7 walks 1025 / 1280 / 1440 / 1800 the same way on every run. */
  /* 1025-1439: the ACTIVE tick keeps the idle 17px and marks itself with colour and glow instead of length, and
     the link's right padding drops to .2rem. Measured at 1025x1000 on uas: the line box "$4\u20137/hour" ends at
     x=993 and the rail's right edge is 1018, so a 30px active tick behind .4rem of padding puts the dash's
     left edge at 981.6 — eleven pixels of it over that number. 17px behind .2rem puts it at 997.6. */
  @media (min-width:1025px) and (max-width:1439px) { .agx-rail-link { padding-right:.2rem; } .agx-rail-link:hover::after, .agx-rail-link.agx-active::after { width:17px; } }
  /* >=1700 origin/main stood the ACTIVE chapter's label permanently. IT IS DROPPED, and the reason is the same
     measurement as everything else here: walked at 1800x1000, uas's "From launch to landing, The Bee
     operates…" has a line box ending at x=1525 and the standing label's left edge lands on 1525. It was never
     measured this way before — the only overlap figure this rail ever had was one hovered label at scroll 0.
     No label stands at any width now; the reading position is marked by colour and by the longer tick. */
  @media (min-width:1700px) { .agx-rail { right:1.4rem; } }
  @media (prefers-reduced-motion: reduce) { html.agx-motion .agx-ch { opacity:1; transform:none; transition:none; } html.agx-motion { scroll-behavior:auto; } }
  /* ── HUD: MAST's two bottom corners (cinematic_shell.py:78-83), carrying only the brand line and the chapter the
     reader is in. BOTH LINES ARE CSS `content`, NOT TEXT NODES — a printed "SECTION 02 / 08" is a build-only text
     unit, and the old unanchored `NN / NN` excuse was DROPPED from compare-atlas.py in R4-4 precisely because "an
     excuse nothing spends is a hole nothing guards". Generated content adds no unit, so text parity is unchanged
     and no excuse is needed at all; the HUD is asserted POSITIVELY instead, by computed ::before content in
     scripts/validate-live.py check 5.
     right:5.2rem, not 1.5rem: #back-to-top is a fixed 46px button at l:1378 r:1424 t:848 b:894 with z-index:900
     (measured 1440x900), and 1.5rem would put the counter under it. 5.2rem clears it by 21px. Hidden below 1025 —
     phones and tablets keep the bar and the ticks and nothing else.
     ── THE LANE GATE, AND THE MEASUREMENT THAT FORCED IT (r5, 2026-09-09) ──
     The rail was walked before it shipped and the HUD was not, and it is FIXED, so the reader's own copy scrolls
     underneath it. render-audit.mjs's walk, pointed at the two corners instead of the rail, measured 33 live text
     runs covered across the twelve pages — .agx-hud-bl [26,213,866,882] printing through
     "Dedicated personal protection officers providing" [86,288,866,883] on executive-protection at 1440 among them.
     A bottom padding on .agx-content cannot fix it: the element is fixed to the VIEWPORT, so padding at the end of
     the document only clears the last screenful and every screenful above it still passes under the corner.
     So the HUD gives way instead. CINEMA_JS measures, per frame the page scrolls, whether a visible line box is
     inside a corner's own box, and adds .agx-clear if one is. The hide is INSTANT and the return is a .3s fade
     after a .2s hold, which is also what stops it flickering on a fast scroll. The gate is the thing that makes
     the HUD legitimate, so `html.agx-hudgate` — a class the gate adds to itself — is what turns the HUD on:
     a page whose script never ran prints no HUD at all rather than printing one across a sentence. */
  .agx-hud { position:fixed; z-index:899; display:none; font-family:'Share Tech Mono',monospace; font-size:.62rem; letter-spacing:.3em; text-transform:uppercase; opacity:.62; pointer-events:none; text-shadow:0 1px 10px rgba(0,0,0,.9); transition:opacity .3s ease .2s; }
  .agx-hud.agx-clear { opacity:0; transition:opacity 0s; }
  .agx-hud-bl { bottom:calc(1.15rem + env(safe-area-inset-bottom,0px)); left:calc(1.6rem + env(safe-area-inset-left,0px)); color:var(--agx-dim); }
  .agx-hud-br { bottom:calc(1.15rem + env(safe-area-inset-bottom,0px)); right:calc(5.2rem + env(safe-area-inset-right,0px)); color:var(--agx-blue-l); }
  .agx-hud-bl::before { content:"ATLAS GLINN · HOUSTON"; }
  .agx-hud-br::before { content:"SECTION " attr(data-n) " / " attr(data-of); }
  @media (min-width:1025px) { html.agx-hudgate .agx-hud { display:block; } }
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


def cinema_css(mono_family='Inconsolata'):
    """The cinema sheet in the Atlas palette, with the chrome's small caps taken from the font the page already loads."""
    css = shell._recolor(CINEMA_CSS, shell.ATLAS)
    css = css.replace("'Share Tech Mono',monospace", "'%s',monospace" % mono_family)
    assert_cinema_scope(css)
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
     does not need overriding. #form-success .success-icon is 1,1,0 on the live page and needs the id to be beaten. */
  .agx-content .feature-icon, .agx-content .audience-icon, .agx-content .hw-card-icon,
  .agx-content .card-icon, .agx-content .pillar-icon, .agx-content .scenario-icon,
  .agx-content .disc-icon, .agx-content .threat-icon, .agx-content .icon-item,
  .agx-content .blog-icon, .agx-content #form-success .success-icon {
    width:48px; height:48px; display:inline-flex; align-items:center; justify-content:center;
    border-radius:14px; border:1px solid rgba(26,107,222,.32); color:#1A6BDE;
    background:radial-gradient(120% 120% at 30% 20%, rgba(26,107,222,.20) 0%, rgba(26,107,222,.045) 70%);
    box-shadow:inset 0 1px 0 rgba(255,255,255,.07);
    transition:color .45s, border-color .45s, box-shadow .45s, background .45s;
  }
  .agx-content .agx-icon { width:24px; height:24px; display:block; }
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
  /* ---- 6. Phones: the blur is the compositing cost, not the look. Drop it below 769. ---- */
  @media (max-width:768px) {
    .agx-content .service-card, .agx-content .pillar-card, .agx-content .scenario-card,
    .agx-content .discipline-card, .agx-content .capability-card, .agx-content .threat-card,
    .agx-content .blog-link-card, .agx-content .cap-card, .agx-content .team-card,
    .agx-content .testimonial, .agx-content .job-card, .agx-content .benefit-card,
    .agx-content .video-card, .agx-content .app-tier, .agx-content .feature-card,
    .agx-content .audience-card, .agx-content .pricing-card, .agx-content .hw-card,
    .agx-content .legal-card { backdrop-filter:none; -webkit-backdrop-filter:none; background:rgba(11,18,33,.78); }
  }
  @media (prefers-reduced-motion: reduce) {
    .agx-content .feature-card, .agx-content .service-card, .agx-content .pricing-card { transition:none; }
  }
"""

_GOLD_TOKENS = ('#C9A84C', '#D4AF37', '#BF953F', '#FCF6BA', '#B38728', '#AA771C', '#E8D27D',
                '#B87333', 'rgba(201,168,76', 'rgba(201, 168, 76', '--gold')
_SKIN_TYPE_EXEMPT = ('.agx-icon',)   # the only selector this sheet may size, because it draws the element itself


def assert_skin_scope(css):
    """The skin's four bounds, as a build failure. Returns the selectors checked."""
    import atlas_live as live
    body = live._COMMENT.sub('', css)
    sels = live.audit_chrome_css(body)
    loose = [s for s in sels if not s.strip().startswith('.agx-content ')]
    assert not loose, 'skin CSS is not anchored to .agx-content: %s' % loose[:6]
    for prop in ('font-size', 'font-family'):
        for m in re.finditer(r'([^{}]+)\{([^{}]*)\}', body):
            if re.search(r'(?<![\w-])%s\s*:' % prop, m.group(2)) and \
               not any(x in m.group(1) for x in _SKIN_TYPE_EXEMPT):
                raise AssertionError('the skin sets %s on live content (ledger K-3): %s'
                                     % (prop, ' '.join(m.group(1).split())[:90]))
    for g in _GOLD_TOKENS:
        assert g not in body, 'gold in the Atlas content skin (gold is MAST): ' + g
    assert SHARED_HOVER_LIFT in body and SHARED_HOVER_TRANSITION in body, \
        'the skin no longer carries the shared card hover copied from cinematic_shell.py:132-133'
    # 5. THE TILT OVERRIDE IS PRESENT FOR EVERY CLASS THAT NEEDS IT. !important is the ONE exception this sheet
    #    takes and it is bounded here: only these five classes, only transform / transition / box-shadow, and only
    #    because an inline style cannot be beaten any other way. An !important on any OTHER declaration fails.
    rules = [(' '.join(m.group(1).split()), m.group(2)) for m in re.finditer(r'([^{}]+)\{([^{}]*)\}', body)]
    for c in SKIN_TILT_CLASSES:
        base = [d for s, d in rules if '.agx-content .%s,' % c in s + ',' and '!important' in d and ':hover' not in s]
        hov = [d for s, d in rules if '.agx-content .%s:hover' % c in s and '!important' in d]
        assert base and 'transition:%s' % TILT_TRANSITION in base[0], \
            'the skin no longer forces the .45s transition over the tilt script on .%s' % c
        assert hov and TILT_LIFT in hov[0] and 'box-shadow:' in hov[0], \
            'the skin no longer forces the -6px lift and the blue glow over the tilt script on .%s' % c
    for sel, decl in rules:
        for d in decl.split(';'):
            if '!important' not in d:
                continue
            prop = d.split(':')[0].strip()
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
}
ICON_CLASSES = ('feature-icon', 'audience-icon', 'hw-card-icon', 'success-icon', 'card-icon',
                'pillar-icon', 'scenario-icon', 'disc-icon', 'threat-icon', 'icon-item', 'blog-icon')
# The element whose ENTIRE content is one glyph and whose class is one of the eleven above. `[^<]*` is deliberate:
# an icon element with a child element is not an icon element and must not be swapped.
ICON_EL = re.compile(r'<(span|div)([^>]*\bclass="(?:[^"]*\s)?(%s)(?:\s[^"]*)?"[^>]*)>([^<]*)</\1>'
                     % '|'.join(ICON_CLASSES))
assert all(g in ICON_SVG for rows in ICON_SWAPS.values() for _c, g, _t in rows), \
    'ICON_SWAPS names a glyph ICON_SVG does not draw'


def skin_icons(slug, body):
    """Every declared emoji-as-icon glyph replaced by its inline monoline SVG, in document order. Raises if the
    capture and ICON_SWAPS disagree — the table is the contract, not a hint."""
    import html as H
    want = list(ICON_SWAPS.get(slug, ()))
    if not want:
        assert not [m for m in ICON_EL.finditer(body) if H.unescape(m.group(4)).strip()], \
            '%s: an icon-class glyph appeared that ICON_SWAPS does not declare' % slug
        return body
    out, pos, k = [], 0, 0
    for m in ICON_EL.finditer(body):
        glyph = H.unescape(m.group(4)).strip()
        if not glyph:
            continue
        assert k < len(want), '%s: more icon glyphs in the capture than ICON_SWAPS declares' % slug
        cls, g, _title = want[k]
        assert (cls, glyph) == (m.group(3), g), \
            '%s: swap %d is (%s, %r) in ICON_SWAPS and (%s, %r) in the capture' \
            % (slug, k, cls, g, m.group(3), glyph)
        # m.start(4)/m.end(4): only the text BETWEEN the tags is replaced, so the icon element's own tag, class and
        # any inline style survive byte for byte.
        out.append(body[pos:m.start(4)])
        out.append((_SVG_OPEN % _glyph_key(g)) + '<path d="' + ICON_SVG[g] + '"/></svg>')
        pos, k = m.end(4), k + 1
    assert k == len(want), '%s: ICON_SWAPS declares %d swaps, the capture carries %d' % (slug, len(want), k)
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
    # The two HUD corners. aria-hidden on both: they carry no information a reader needs that the rail does not
    # already expose to assistive tech, and their text is CSS `content` — no text node, no unit, no excuse.
    hud = ('<div class="agx-hud agx-hud-bl" aria-hidden="true"></div>\n'
           '<div class="agx-hud agx-hud-br" id="agx-section-hud" data-n="01" data-of="%02d" aria-hidden="true"></div>\n'
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
  var lines = [];
  function collectLines() {
    lines = [].slice.call(document.querySelectorAll('body *')).filter(function (el) {
      if (el.closest('.agx-hud, .agx-rail, script, style')) return false;
      for (var i = 0; i < el.childNodes.length; i++) {
        var n = el.childNodes[i];
        if (n.nodeType === 3 && n.nodeValue.trim()) return true;
      }
      return false;
    });
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
