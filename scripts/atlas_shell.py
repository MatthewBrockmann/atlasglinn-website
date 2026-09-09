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
  /* ── Chapter rail: MAST's, in its tick form, so it sits in the live section's own right padding and moves nothing.
     A <div>, never a <nav> — the live stylesheet styles a bare `nav` and would fix it to the top and slide it away. ── */
  .agx-rail { position:fixed; right:.45rem; top:50%; transform:translateY(-50%); z-index:900; display:none; flex-direction:column; gap:.4rem; align-items:flex-end; font-family:'Share Tech Mono',monospace; font-size:.6rem; }
  .agx-rail-link { display:flex; align-items:center; justify-content:flex-end; gap:.5rem; padding:.32rem .4rem; color:var(--text); font-weight:700; letter-spacing:.25em; text-transform:uppercase; text-decoration:none; text-shadow:0 1px 10px rgba(0,0,0,.9); border:1px solid transparent; transition:color .3s, border-color .3s, background .3s; }
  .agx-rail-link span { max-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; opacity:0; transition:max-width .35s ease, opacity .35s ease; }
  .agx-rail-link::after { content:''; width:17px; height:2px; flex:none; background:rgba(240,244,255,.5); box-shadow:0 1px 6px rgba(0,0,0,.9); transition:width .3s, background .3s; }
  .agx-rail-link:hover { color:var(--gold-champagne); border-color:rgba(201,168,76,.35); background:rgba(5,8,16,.7); }
  /* 20.5rem = 328px, the MEASURED maximum + 1px: the widest of the 79 rail labels is uas ch4's "No Pilot Required.
     No Gaps in Coverage ." at 327px in Chromium at 1440x900. At 13rem (208px) FOURTEEN of the 79 were cut mid-word
     with no ellipsis — "Atlas Glinn SOP for Protective Detail" at 303, "Your Assets Don't Wait. Neither Do We." at
     311 — and `text-overflow` computed `clip` on all 79, so the cut had no visual signal at all. Both are fixed
     together on purpose: the clamp is the fix for today's labels, the ellipsis is the backstop for a label longer
     than any of today's, and either alone leaves one of the two failures standing. */
  .agx-rail-link:hover span { max-width:20.5rem; opacity:1; }
  .agx-rail-link.agx-active { color:var(--gold-champagne); }
  .agx-rail-link:hover::after, .agx-rail-link.agx-active::after { width:30px; background:var(--gold); box-shadow:0 0 10px rgba(201,168,76,.6); }
  /* MAST shows its rail from 769px up (cinematic_shell.py:220-223: hidden at <=768px, ticks only 769-1024px,
     labels from 1025px with `section.panel { padding-right:16.5rem }` making the room). The Atlas rail now
     appears at the same 769px and in the same tick form; from 1025px MAST's always-on label needs a right
     gutter this build cannot cut, because the live sections are the live page's own 1400px centred blocks
     and widening their padding is a content change. So above 1025px the label comes on hover, and on the
     reading position from 1700px, where the centred column finally leaves the margin for it.
     THE 1025-1699px DIVERGENCE FROM MAST IS ACCEPTED, not an oversight: MAST prints 13 labels always at those
     widths, Atlas prints ticks and gives the label on hover. It is the direct consequence of the sentence above —
     MAST owns its own right gutter, an Atlas page's sections are the live page's, and taking a gutter out of them
     would be a content change. CLAUDE.md states it as the accepted deviation. */
  @media (min-width:769px) { .agx-rail { display:flex; } }
  @media (min-width:769px) and (max-width:1024px) { .agx-rail { right:.8rem; gap:.35rem; } .agx-rail-link { padding:.3rem .4rem; gap:0; } .agx-rail-link::after { width:16px; } .agx-rail-link:hover::after, .agx-rail-link.agx-active::after { width:22px; } }
  /* The live sections are 1400px wide and centred, so below 1700px there is no margin to print a chapter's line in
     without covering its own text: the rail stays a column of ticks and gives the line on hover. Above it, the
     reading position carries its label the way the trailer's rail does. */
  @media (min-width:1700px) { .agx-rail { right:1.4rem; } .agx-rail-link.agx-active span { max-width:20.5rem; opacity:1; } }
  @media (prefers-reduced-motion: reduce) { html.agx-motion .agx-ch { opacity:1; transform:none; transition:none; } html.agx-motion { scroll-behavior:auto; } }
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
    return ('<canvas id="agx-canvas" aria-hidden="true"></canvas>\n'
            '<div id="agx-photos" aria-hidden="true">\n%s\n</div>\n'
            '<div class="agx-grain" aria-hidden="true"></div>\n<div class="agx-vignette" aria-hidden="true"></div>\n'
            '<div id="agx-progress" aria-hidden="true"></div>\n'
            '<div class="agx-rail" role="navigation" aria-label="Chapters">\n%s</div>\n'
            % ('\n'.join(layers), rail))


# ── The cinema layer's behaviour, in a plain script so it runs whether or not the three.js module loads. The entrance
#    motion, the backdrop crossfade, the rail and the progress line are all here; the module below only draws. ──
CINEMA_JS = r"""
(function () {
  var doc = document.documentElement;
  var chs = [].slice.call(document.querySelectorAll('.agx-ch'));
  var phs = [].slice.call(document.querySelectorAll('#agx-photos .agx-ph'));
  var links = [].slice.call(document.querySelectorAll('.agx-rail-link'));
  var bar = document.getElementById('agx-progress');
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

  // ── Read position and the rail ──
  var active = -1;
  function here() { var mid = innerHeight * .45, idx = 0; chs.forEach(function (s, i) { if (s.getBoundingClientRect().top <= mid) idx = i; }); return idx; }
  function onScroll() {
    var total = document.documentElement.scrollHeight - innerHeight;
    if (bar) bar.style.width = (Math.max(0, Math.min(1, scrollY / Math.max(1, total))) * 100) + '%';
    var idx = here();
    if (idx === active) return;
    active = idx;
    links.forEach(function (l, k) { l.classList.toggle('agx-active', k === idx); });
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
