#!/usr/bin/env python3
"""The browser pass on the four stylesheets the twelve Atlas Glinn pages carry, and on the two fixed HUD corners.

  python3 scripts/validate-live.py [--only <slug>[,<slug>]] [--port <n>]

FOUR SHEETS, NOT THREE, SINCE 2026-09-10. The banner said AGX_SKIN_CSS was "the ONE sheet permitted to match
content" while AGX_HERO_CSS — declared, scoped to the opening chapter, and shipped on all twelve — was never
probed in the browser at all. It is the fourth probe now and its count prints on every page row.

--only narrows the page set for speed. Check 3b (every skin selector spent by some page) and the same measurement
on the chrome sheet's footer phone floor are measurements over ALL TWELVE pages, so under --only they are REPORTED
and do not fail — a selector only ep-app spends is not dead because this run did not load ep-app. A full run is
what asserts them.

THIS FILE IS NEW (2026-09-09) AND THAT IS THE FINDING THAT CREATED IT. `scripts/atlas_live.py` has named it since
the module was written — ":33 … validate-live.py asserts in a real browser that not one of them matches an element
outside the five chrome roots", and again at :437 and :486 — and CLAUDE.md published that assertion as a measurement
taken on 2026-09-08. Measured this turn: `git log --all --diff-filter=A -- '*validate-live*'` is EMPTY and
`git ls-files | grep -i valid` names four SEO-skill scripts and nothing else. The script was prose. Nothing in the
repo was making that assertion in a browser, so the sentence in CLAUDE.md was a claim with no measurement behind it.
It is struck there and replaced with this script's own output.

The selector lists are computed in Python, because that is where `atlas_live.chrome_css()`,
`atlas_shell.cinema_css()` and `atlas_shell.AGX_SKIN_CSS` live; the browser work runs in Node, because that is
where this repo's Playwright is (`scripts/render-audit.mjs` uses the same install). The two talk through one JSON
job file in the OS temp dir — never the repo, so an interrupted run leaves nothing untracked behind.

WHAT IT ASSERTS

  1. THE CHROME SHEET STILL MAY NOT REACH THE CONTENT. Every selector that survives `atlas_live.chrome_css()` is
     resolved against the rendered page: it may match only elements inside one of the five CHROME_ROOTS
     (#intro-overlay, #main-nav, #mobile-nav, footer.site-footer, #back-to-top) or those roots themselves.

  2. THE CINEMA SHEET REACHES ONLY THE CINEMA LAYER. The same shape for `atlas_shell.cinema_css()`. ONE selector is
     allowed to reach a content element and it is NAMED here rather than waved through: `.agx-ch > *` sets
     `width:100%` on each chapter's own top-level child, which is the live section, and that is the rule that keeps
     the live `max-width:1400px; margin:0 auto` centring intact instead of shrinking it to fit-content. Any OTHER
     cinema selector matching an element inside .agx-content fails.

  3. THE SKIN IS THE DECLARED EXCEPTION, ASSERTED BY NAME. `atlas_shell.AGX_SKIN_CSS` is the one sheet permitted to
     match a content element. (a) every element every skin selector matches must be inside `.agx-content` — a skin
     rule reaching the chrome fails; and (b) over the whole page set, every skin selector must match at least one
     element somewhere. A rule that matches nothing is a dead rule, and it is reported BY NAME and fails — the same
     discipline that killed the two unspent comparator excuses in R4-4.

  4. THE LIVE TYPE SCALE IS UNCHANGED (ledger K-3). The live capture is served alongside the build with the same
     theme sheet and with everything off 127.0.0.1 aborted on both sides, and (tag, font-size, font-family,
     line-height) is collected for every h1-h6 / p / li in document order outside the chrome. The two sequences must
     be EQUAL. This is the browser-side backstop to `assert_skin_scope()`'s static font-size / font-family ban.

  5. THE HUD SAYS WHAT IT SHOULD. `.agx-hud-br::before` must compute "SECTION 01 / NN" at scroll 0 and
     "SECTION 0k / NN" at chapter k; `.agx-hud-bl::before` must compute "ATLAS GLINN · HOUSTON". Both must compute
     display:none at 390. The HUD prints no text node — its text is CSS `content` — so this positive assert is what
     stands in place of a comparator excuse. An excuse nothing spends is a hole nothing guards; this one spends.

  6. NO FIXED-CHROME COLLISION. At 1440, 1280 and 1025 the boxes of .agx-hud-br, .agx-hud-bl, .agx-rail,
     #back-to-top and #sound-toggle must pairwise not intersect.
     READ WHAT THIS CHECK DOES NOT COVER, BECAUSE IT WAS READ AS COVERING IT ONCE. That name list is FIXED CHROME
     ONLY: the check compares fixed chrome against other fixed chrome and never against page content, so it
     printed "fixed-chrome hits 0" on all twelve pages while .agx-hud-bl and .agx-hud-br sat on 33 live text runs
     (measured r5, 2026-09-09, by pointing render-audit.mjs's scroll-walk at the HUD). The list is deliberately
     NOT widened to absorb that. A collision between the HUD and a paragraph is a different measurement — it needs
     a walk down the page rather than a box at scroll 0 — and it lives in render-audit.mjs check 7, where the walk
     already is. Likewise the card hover: nothing here reads a runtime INLINE style, which is where the live
     pages' tilt script was writing -4px/0.2s and an rgba(201,168,76) glow over this build's skin; that is
     render-audit.mjs check 8.

No network: the atlasglinn.com photographs and films 404 here. That is the sandbox and never a finding — every
assertion above is about the page's own DOM and its own stylesheets. Exits non-zero on any failure.
"""
import json
import os
import re
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import atlas_live as live
import atlas_shell as atlas

REPO = live.REPO
COLLISION_WIDTHS = (1440, 1280, 1025)
CHROME_ROOTS = ', '.join(live.CHROME_ROOTS)
# What the cinema layer owns. `_SELF` is "the element IS one of these"; `_ANC` is "the element sits inside one".
# .agx-ch and .agx-content are in _SELF and not in _ANC on purpose: the wrapper itself is the cinema layer's, the
# live markup inside it is not, so a cinema rule reaching a card would still fail.
CINEMA_SELF = ('#agx-canvas, #agx-photos, #agx-progress, .agx-grain, .agx-vignette, .agx-rail, .agx-hud, '
               '.agx-sitenav, .agx-menu-btn, .agx-ch, .agx-content, html')
CINEMA_ANC = '#agx-canvas, #agx-photos, #agx-progress, .agx-rail, .agx-hud, .agx-sitenav'
CINEMA_CONTENT_OK = ('.agx-ch > *',)

# A pseudo-class or pseudo-element is a STATE, not a target: querySelectorAll('a::after') throws and
# querySelectorAll('a:hover') matches only what the pointer happens to be over. Both are stripped so the probe
# measures WHICH ELEMENTS a rule can reach, which is the question these three sheets are asserted on.
_PSEUDO_EL = re.compile(r'::[a-zA-Z-]+')
_PSEUDO_STATE = re.compile(r':(?:hover|focus-within|focus-visible|focus|active|visited|disabled|checked|target)\b')


def targets(sel):
    return _PSEUDO_STATE.sub('', _PSEUDO_EL.sub('', sel)).strip()


DRIVER = r"""
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import net from 'node:net';
const require = createRequire(import.meta.url);
const { chromium } = (() => {
  for (const c of [process.env.PLAYWRIGHT, 'playwright', '/opt/node22/lib/node_modules/playwright',
    '/usr/local/lib/node_modules/playwright', '/opt/homebrew/lib/node_modules/playwright']) {
    if (!c) continue;
    try { return require(c); } catch (e) { /* next */ }
  }
  throw new Error('playwright not found; set PLAYWRIGHT=<path to the module>');
})();
// `node --input-type=module -e <code> -- a b` does not put the script path in argv[1], so the two file
// names are read off the END rather than by index.
const [JOB_PATH, OUT_PATH] = process.argv.slice(-2);
const job = JSON.parse(fs.readFileSync(JOB_PATH, 'utf8'));

const PROBE = ([sels, self, anc]) => {
  const out = [];
  for (const raw of sels) {
    let els;
    try { els = [...document.querySelectorAll(raw)]; }
    catch (e) { out.push({ sel: raw, error: String(e.message || e), n: 0, outside: [], outsideN: 1 }); continue; }
    const outside = [];
    for (const el of els) {
      if ((self && el.matches(self)) || (anc && el.closest(anc))) continue;
      outside.push(el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + '.'
        + String(el.className || '').split(/\s+/).filter(Boolean).slice(0, 2).join('.'));
    }
    out.push({ sel: raw, n: els.length, outside: outside.slice(0, 4), outsideN: outside.length });
  }
  return out;
};
// CHECK 4 IS SPLIT SINCE r8 AND THE SPLIT IS WHAT KEEPS THE HERO EXCEPTION HONEST. `mode` is 'body' (everything
// OUTSIDE the opening hero — this must stay EQUAL to the live capture, ledger K-3, unchanged) or 'hero' (the one
// chapter Brockmann's 2026-09-09 call re-styles — collected on both sides and PRINTED, never skipped). `.hero` is
// the scope on BOTH sides: the build wraps the live `<section class="hero">` in `.agx-ch.agx-hero` and the capture
// does not, so keying on the LIVE class is what makes the two sides comparable.
// #main-nav / #mobile-nav STAY IN THE SKIP LIST even though the build no longer has a bar: the LIVE CAPTURE still
// does, and dropping them would collect the capture's own bar and report a length delta that is really about the
// chrome. .agx-sitenav / .agx-menu-btn are the build-side equivalents.
const TYPESCALE = (mode) => {
  const SKIP = '.agx-rail, .agx-hud, .agx-sitenav, .agx-menu-btn, #intro-overlay, #main-nav, #mobile-nav, '
    + 'footer, #back-to-top';
  const out = [];
  for (const el of document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li')) {
    if (el.closest(SKIP)) continue;
    const inHero = !!el.closest('.hero');
    if (mode === 'hero' ? !inHero : inHero) continue;
    const cs = getComputedStyle(el);
    out.push([el.tagName.toLowerCase(), cs.fontSize, cs.fontFamily, cs.lineHeight]);
  }
  return out;
};
const BOXES = () => {
  const names = ['.agx-hud-tl', '.agx-hud-tr', '.agx-hud-bl', '.agx-hud-br', '.agx-menu-btn', '.agx-rail',
    '#back-to-top', '#sound-toggle'];
  const out = {};
  for (const n of names) {
    const el = document.querySelector(n);
    if (!el) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const b = el.getBoundingClientRect();
    if (b.width > 0 && b.height > 0) out[n] = [b.left, b.right, b.top, b.bottom].map(Math.round);
  }
  return out;
};

async function freePort(from) {
  for (let p = from; p < from + 200; p++) {
    const ok = await new Promise((res) => {
      const s = net.createServer();
      s.once('error', () => res(false));
      s.once('listening', () => s.close(() => res(true)));
      s.listen(p, '127.0.0.1');
    });
    if (ok) return p;
  }
  throw new Error('no free port at or above ' + from);
}

const port = job.port || await freePort(8950);
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'],
  { cwd: job.repo, stdio: 'ignore' });
const base = 'http://127.0.0.1:' + port + '/';
await new Promise((r) => setTimeout(r, 900));
const results = [];
let browser = null;
try {
  const exe = process.env.CHROMIUM || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  browser = await chromium.launch({ ...(exe ? { executablePath: exe } : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader'] });
  for (const P of job.pages) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    // Page errors are bucketed by WHICH DOCUMENT was loading. The live capture is driven through the same browser,
    // the same routes and the same offline sandbox, so an error it raises too is the capture's own script meeting a
    // 404 — measured on index: the live page loads three.js from a CDN that does not resolve here, and both sides
    // raise "THREE is not defined". Only an error the BUILD raises and the capture does not is this build's.
    let errs = [], liveErrs = [], phase = 'build';
    page.on('pageerror', (e) => (phase === 'build' ? errs : liveErrs).push(String(e).slice(0, 200)));
    // TWO NARROW ROUTES, never a catch-all. Fonts are aborted on both sides so a face that arrives on one side and
    // times out on the other cannot show up as a type-scale delta that is really about the network. Everything else
    // — including the live index's own CDN three.js, which 404s in this sandbox — is left on the default path:
    // measured, intercepting it with route+continue turns that silent failure into an uncaught
    // "THREE is not defined" page error that the build did not cause and origin/main does not report.
    await page.route('**/__live__/*.html', (r) =>
      r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: P.capture }));
    await page.route(/fonts\.(googleapis|gstatic)\.com|\.(woff2?|ttf|otf|eot)(\?|$)/, (r) => r.abort());
    await page.goto(base + P.file, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(800);
    await page.evaluate(() => { const s = document.getElementById('skip-intro'); if (s) s.click(); });
    await page.waitForTimeout(300);

    const chrome = await page.evaluate(PROBE, [P.chromeSels, P.chromeRoots, P.chromeRoots]);
    const cinema = await page.evaluate(PROBE, [P.cinemaSels, P.cinemaSelf, P.cinemaAnc]);
    const skin = await page.evaluate(PROBE, [P.skinSels, '', '.agx-content']);
    // THE FOURTH SHEET. AGX_HERO_CSS is the second sheet declared to reach content and until 2026-09-10 nothing
    // probed it in a browser — assert_hero_scope() reads its selector text at build time, which is not the same
    // question as "which elements can it reach on the rendered page". Its root is the opening chapter.
    const hero = await page.evaluate(PROBE, [P.heroSels, '', '.agx-ch.agx-hero']);
    const buildType = await page.evaluate(TYPESCALE, 'body');
    const buildHero = await page.evaluate(TYPESCALE, 'hero');
    const chapters = await page.evaluate(() => document.querySelectorAll('.agx-ch').length);
    // CHECK 5 — the generated content, read back off the rendered page. Nothing here prints a text node, so this
    // positive assert is what stands in place of a comparator excuse for the whole HUD, the scroll cue, the chapter
    // eyebrow and the overlay's two list headings.
    const hud0 = await page.evaluate(() => {
      const c = (sel, pseudo) => { const el = document.querySelector(sel); return el ? getComputedStyle(el, pseudo).content : '(no element)'; };
      const ch2 = document.querySelectorAll('.agx-ch')[1];
      return {
        tl: c('.agx-hud-tl', '::before'), tr: c('.agx-hud-tr', '::before'),
        bl: c('.agx-hud-bl', '::before'), br: c('.agx-hud-br', '::before'),
        cue: c('.agx-scroll-cue', '::after'),
        qi: c('.agx-sitenav-index', '::before'), ap: c('.agx-sitenav-extra', '::before'),
        ch2: ch2 ? getComputedStyle(ch2, '::after').content : '(no chapter 2)',
        ch2label: ch2 ? (ch2.getAttribute('data-agxlabel') || '') : '',
        disp: getComputedStyle(document.querySelector('.agx-hud-tr')).display };
    });
    const k = Math.min(3, chapters);
    await page.evaluate((k) => {
      document.documentElement.style.scrollBehavior = 'auto';
      document.querySelectorAll('.agx-ch')[k - 1].scrollIntoView();
      window.scrollBy(0, 40);
      window.dispatchEvent(new Event('scroll'));
    }, k);
    await page.waitForTimeout(450);
    const hudK = await page.evaluate(() => getComputedStyle(document.querySelector('.agx-hud-tr'), '::before').content);
    await page.evaluate(() => window.scrollTo(0, 0));

    // The rail box was not reproducible run to run, and the cause is HERE, in the probe, not on the page: the rail
    // link's ::before and ::after both carry .3-.35s transitions, so a box read 350ms after a viewport change can
    // catch a tick mid-animation. Transitions and animations are killed for the duration of the read and restored
    // after it, and the settle is 600ms, so the printed coordinates can be quoted without a run number.
    const FREEZE = () => {
      const st = document.createElement('style');
      st.id = 'agx-probe-freeze';
      st.textContent = '*, *::before, *::after { transition:none !important; animation:none !important; }';
      document.head.appendChild(st);
    };
    const THAW = () => { const st = document.getElementById('agx-probe-freeze'); if (st) st.remove(); };

    const boxes = {};
    for (const w of job.widths) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.evaluate(FREEZE);
      await page.waitForTimeout(600);
      boxes[w] = await page.evaluate(BOXES);
      await page.evaluate(THAW);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(600);
    // The top-left brand line is the one corner that shows on a phone (MAST does the same); the other three are
    // >=1025 only. tl is asserted VISIBLE and the other three HIDDEN, so "the HUD is hidden on phones" cannot be
    // bought by hiding the piece that is meant to stay.
    const narrow = await page.evaluate(() => ['.agx-hud-tl', '.agx-hud-tr', '.agx-hud-bl', '.agx-hud-br']
      .map((n) => getComputedStyle(document.querySelector(n)).display));
    const buildType390 = await page.evaluate(TYPESCALE, 'body');

    await page.setViewportSize({ width: 1440, height: 900 });
    phase = 'live';
    await page.goto(base + '__live__/' + P.slug + '.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(700);
    const liveType = await page.evaluate(TYPESCALE, 'body');
    const liveHero = await page.evaluate(TYPESCALE, 'hero');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(600);
    const liveType390 = await page.evaluate(TYPESCALE, 'body');

    const shared = new Set(liveErrs);
    results.push({ slug: P.slug, chrome, cinema, skin, hero, buildType, liveType, buildHero, liveHero,
      buildType390, liveType390, chapters, hud0, hudK, boxes,
      narrow, errs: errs.filter((e) => !shared.has(e)), liveErrs, k });
    await ctx.close();
  }
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
fs.writeFileSync(OUT_PATH, JSON.stringify(results));
"""


P_FLOOR = 15.0


def _px(v):
    try:
        return float(str(v).replace('px', ''))
    except ValueError:
        return 0.0


def hero_delta(R):
    """CHECK 4b — the hero is the one place the type MOVES, so it is measured rather than skipped: the same number
    of elements on both sides, the headline in Orbitron, and its size at or above the live one. Everything else in
    the hero is compared for element COUNT only, because the sheet re-styles it on Brockmann's 2026-09-09 call."""
    out = []
    if len(R['buildHero']) != len(R['liveHero']):
        out.append('the hero carries %d sized elements and the live hero carries %d'
                   % (len(R['buildHero']), len(R['liveHero'])))
        return out
    for i, (b, l) in enumerate(zip(R['buildHero'], R['liveHero'])):
        if b[0] != l[0]:
            out.append('element %d is a <%s> in the build and a <%s> live' % (i, b[0], l[0]))
            continue
        # THE RE-SET MAY ENLARGE AND MAY NOT SHRINK, on every hero element and not only the headline. The first
        # clamp on the lede made ep-app's live 22px .hero-sub compute 18.72px at 1440 and the h1-only version of
        # this check passed it — a readability regression inside the one exception this sheet is allowed.
        if _px(b[1]) < _px(l[1]):
            out.append('element %d <%s> is %s in the build and %s live — the hero re-set may not shrink live copy'
                       % (i, b[0], b[1], l[1]))
        if b[0] == 'h1' and 'Orbitron' not in b[2]:
            out.append('the hero h1 computes %s, not Orbitron' % b[2])
    return out


def phone_delta(R):
    """CHECK 4c — the phone floor, measured in a browser at 390 on BOTH sides. build >= live everywhere; build ==
    live wherever the live value already cleared the floor (so a floor rule may raise a small paragraph and may not
    touch a compliant one); and no <p> under the floor in the build. The 11px LABEL floor is on div/span/label
    elements this collector does not see — that one is render-audit.mjs check 9, which walks every rendered leaf."""
    out, b390, l390 = [], R['buildType390'], R['liveType390']
    if len(b390) != len(l390):
        return ['the 390 pass collected %d elements on the build and %d live' % (len(b390), len(l390))]
    for i, (b, l) in enumerate(zip(b390, l390)):
        bp, lp = _px(b[1]), _px(l[1])
        if bp < lp - 0.01:
            out.append('element %d <%s> is %s in the build and %s live — a floor may not lower' % (i, b[0], b[1], l[1]))
        elif lp >= P_FLOOR and abs(bp - lp) > 0.01:
            out.append('element %d <%s> was already %s live and the build makes it %s' % (i, b[0], l[1], b[1]))
        if b[0] == 'p' and bp < P_FLOOR - 0.01:
            out.append('element %d <p> computes %s at 390, under the %gpx floor' % (i, b[1], P_FLOOR))
    return out[:8]


def main():
    argv = sys.argv[1:]
    only = argv[argv.index('--only') + 1].split(',') if '--only' in argv else None
    port = int(argv[argv.index('--port') + 1]) if '--port' in argv else 0
    pages = [s for s in live.PAGES if not only or s in only]
    if not pages:
        raise SystemExit('--only matched no page of: ' + ', '.join(live.PAGES))

    skin_sels = atlas.assert_skin_scope(atlas.AGX_SKIN_CSS)
    job = {'repo': REPO, 'port': port, 'widths': list(COLLISION_WIDTHS), 'pages': []}
    for slug in pages:
        capture = live._SHARED_LINK.sub('<link rel="stylesheet" href="/%s">' % live.SHARED_CSS, live._read(slug), 1)
        job['pages'].append({
            'slug': slug,
            'file': 'index.html' if slug == 'index' else slug + '.html',
            'capture': capture,
            'chromeSels': [targets(s) for s in live.audit_chrome_css(live.chrome_css(live.mono(slug)))],
            'cinemaSels': [targets(s) for s in atlas.assert_cinema_scope(atlas.cinema_css(live.mono(slug)))],
            'cinemaRaw': [s.strip() for s in atlas.assert_cinema_scope(atlas.cinema_css(live.mono(slug)))],
            'skinSels': [targets(s) for s in skin_sels],
            'heroSels': [targets(s) for s in atlas.assert_hero_scope(atlas.hero_css(live.mono(slug)))],
            'chromeRoots': CHROME_ROOTS,
            'cinemaSelf': CINEMA_SELF,
            'cinemaAnc': CINEMA_ANC,
        })

    jf = tempfile.NamedTemporaryFile('w', suffix='.json', delete=False, encoding='utf-8')
    json.dump(job, jf)
    jf.close()
    of = tempfile.NamedTemporaryFile('w', suffix='.json', delete=False, encoding='utf-8')
    of.close()
    try:
        rc = subprocess.call(['node', '--input-type=module', '-e', DRIVER, '--', jf.name, of.name], cwd=REPO)
        if rc:
            raise SystemExit('the browser driver exited %d' % rc)
        results = json.load(open(of.name, encoding='utf-8'))
    finally:
        os.unlink(jf.name)
        os.unlink(of.name)

    print('DECLARED EXCEPTIONS: TWO sheets are permitted to match content and BOTH are probed here — '
          'AGX_SKIN_CSS (atlas_shell.py), scoped .agx-content, and AGX_HERO_CSS, scoped '
          '.agx-content .agx-ch.agx-hero. The chrome sheet is still asserted to match none, and its footer phone '
          'floor is asserted to be spent.')
    bad = 0
    n_chrome_out = n_cinema_out = 0
    skin_hits = dict.fromkeys(range(len(skin_sels)), 0)
    # The footer's phone floor lives in the CHROME sheet (the footer is one of its five declared roots), so the
    # chrome probe already measures it — what was missing is the other half of the skin's 3b: a floor entry no page
    # spends is a hole nothing guards. Counted off the same probe, failed the same way.
    foot_hits = dict.fromkeys('%s %s' % (atlas.FOOTER_ROOT, sel)
                              for table in (atlas.FOOTER_P_FLOOR, atlas.FOOTER_LABEL_FLOOR)
                              for sel, _lo, _hi in table)
    foot_hits = {k: 0 for k in foot_hits}
    for P, R in zip(job['pages'], results):
        slug = R['slug']
        chrome_out = [r for r in R['chrome'] if r['outsideN']]
        cinema_out = [r for r, raw in zip(R['cinema'], P['cinemaRaw'])
                      if r['outsideN'] and raw not in CINEMA_CONTENT_OK]
        skin_out = [r for r in R['skin'] if r['outsideN']]
        hero_out = [r for r in R['hero'] if r['outsideN']]
        for r in R['chrome']:
            if r['sel'] in foot_hits:
                foot_hits[r['sel']] += r['n']
        n_chrome_out += sum(r['outsideN'] for r in chrome_out)
        n_cinema_out += sum(r['outsideN'] for r in cinema_out)
        for i, r in enumerate(R['skin']):
            skin_hits[i] += r['n']
        type_ok = R['buildType'] == R['liveType']
        hero_bad = hero_delta(R)
        phone_bad = phone_delta(R)
        n = R['chapters']
        hud_bad = []
        H = R['hud0']
        for key, want in (('tl', '"ATLAS GLINN · HOUSTON"'), ('bl', '"HOU · 29.7604°N · 95.3698°W"'),
                          ('br', '"DETAILS MATTER"'), ('cue', '"SCROLL ↓"'),
                          ('qi', '"QUICK INDEX"'), ('ap', '"ALL PAGES"')):
            if H[key] != want:
                hud_bad.append('%s computes %s, not %s' % (key, H[key], want))
        if H['tr'] != '"SECTION 01 / %02d"' % n:
            hud_bad.append('top-right content %s at scroll 0 (%d chapters)' % (H['tr'], n))
        if H['disp'] == 'none':
            hud_bad.append('the HUD is display:none at 1440')
        if R['hudK'] != '"SECTION %02d / %02d"' % (R['k'], n):
            hud_bad.append('top-right content %s at chapter %d' % (R['hudK'], R['k']))
        # getComputedStyle resolves attr() and does NOT resolve counter(), so the chapter eyebrow reads back with
        # its counter expression intact and its label substituted. That is the string asserted — it proves the
        # attribute reached the sheet and the number is still a counter and not a printed text node.
        want_ch2 = ('counter(agx-chapter, decimal-leading-zero) " · %s"' % H['ch2label']) if H['ch2label'] else 'none'
        if H['ch2'] != want_ch2:
            hud_bad.append('the chapter-2 eyebrow computes %s, not %s' % (H['ch2'], want_ch2))
        if R['narrow'][0] == 'none' or R['narrow'][1:] != ['none', 'none', 'none']:
            hud_bad.append('the HUD computes %r at 390 (tl must show, tr/bl/br must not)' % R['narrow'])
        # A pair is a FAILURE only where one side is an agx- element — the rail and the two HUD corners are what
        # this layer puts on the page. #back-to-top x #sound-toggle intersects on ORIGIN/MAIN too (measured
        # 2026-09-09 at 1440: back-to-top [1378,1424,848,894], sound-toggle [1360,1408,820,868], on the five live
        # pages that ship a toggle), so it is pre-existing, it is not this change's, and it is REPORTED rather than
        # silently folded into a pass or blamed on this branch.
        hits, pre = [], []
        for w, bx in sorted(R['boxes'].items(), key=lambda kv: -int(kv[0])):
            ks = sorted(bx)
            for i in range(len(ks)):
                for j in range(i + 1, len(ks)):
                    a, b = bx[ks[i]], bx[ks[j]]
                    if a[0] < b[1] and b[0] < a[1] and a[2] < b[3] and b[2] < a[3]:
                        line = '%spx %s %s intersects %s %s' % (w, ks[i], a, ks[j], b)
                        (hits if ('agx' in ks[i] or 'agx' in ks[j]) else pre).append(line)
        ok = not (chrome_out or cinema_out or skin_out or hero_out or not type_ok or hero_bad or phone_bad
                  or hud_bad or hits or R['errs'])
        bad += 0 if ok else 1
        print('%-24s chrome %2d sel/%d outside  cinema %2d sel/%d outside  skin %3d sel/%d outside  '
              'hero %2d sel/%d outside  4a %d==%d %s  4b hero %d/%d %s  4c 390 %s  hud %s  fixed-chrome hits %d  '
              'page errors %d (+%d the capture raises too)  %s'
              % (slug, len(R['chrome']), len(chrome_out), len(R['cinema']), len(cinema_out),
                 len(R['skin']), len(skin_out), len(R['hero']), len(hero_out),
                 len(R['buildType']), len(R['liveType']),
                 'EQUAL' if type_ok else 'DIFFER', len(R['buildHero']), len(R['liveHero']),
                 'OK' if not hero_bad else 'BAD', 'OK' if not phone_bad else 'BAD',
                 'OK' if not hud_bad else 'BAD', len(hits), len(R['errs']),
                 len(R['liveErrs']), 'OK' if ok else 'DELTA'))
        # 4b PRINTS THE HERO ON BOTH SIDES, ALWAYS. A skip that prints nothing is how "the hero is exempt" becomes
        # "h1 is exempt"; this is the line that makes the exception readable in the run rather than in a comment.
        for i in range(max(len(R['buildHero']), len(R['liveHero']))):
            b = R['buildHero'][i] if i < len(R['buildHero']) else None
            l = R['liveHero'][i] if i < len(R['liveHero']) else None
            print('    hero type %d: build %s / live %s' % (i, b, l))
        for h in hero_bad:
            print('    HERO TYPE: %s' % h)
        for h in phone_bad:
            print('    PHONE TYPE AT 390: %s' % h)
        for r in chrome_out:
            print('    CHROME RULE REACHES CONTENT: %s -> %d outside the five roots %s'
                  % (r['sel'], r['outsideN'], r['outside']))
        for r in cinema_out:
            print('    CINEMA RULE REACHES OUTSIDE THE LAYER: %s -> %d %s' % (r['sel'], r['outsideN'], r['outside']))
        for r in skin_out:
            print('    SKIN RULE REACHES CHROME: %s -> %d outside .agx-content %s'
                  % (r['sel'], r['outsideN'], r['outside']))
        if not type_ok:
            print('    TYPE SCALE DIFFERS: build %d elements, live %d' % (len(R['buildType']), len(R['liveType'])))
            for i, (a, b) in enumerate(zip(R['buildType'], R['liveType'])):
                if a != b:
                    print('      first difference at element %d: build %s / live %s' % (i, a, b))
                    break
        for h in hud_bad:
            print('    HUD: %s' % h)
        for h in hits:
            print('    FIXED CHROME INTERSECTION: %s' % h)
        for h in pre:
            print('    PRE-EXISTING ON ORIGIN/MAIN, not this change: %s' % h)
        for e in R['errs'][:3]:
            print('    PAGE ERROR THE LIVE CAPTURE DOES NOT RAISE: %s' % e)
        for e in R['liveErrs'][:3]:
            print('    page error on BOTH sides (the capture\'s own script, offline sandbox): %s' % e)
        if slug == pages[0]:
            for w in sorted(R['boxes'], key=lambda x: -int(x)):
                print('    fixed-chrome boxes at %spx: %s' % (w, json.dumps(R['boxes'][w], sort_keys=True)))

    unspent = [skin_sels[i] for i in skin_hits if not skin_hits[i]]
    foot_unspent = [k for k, v in foot_hits.items() if not v]
    # The first two sentences used to print their clean form unconditionally, so a FAILING run said "matched 0
    # elements outside the five roots on every one" three lines under the rule that had just been reported reaching
    # content. They are measured now, the way the skin's line already was.
    print('\nSUMMARY  %d page(s). The chrome sheet matched %d element(s) outside %s.'
          % (len(pages), n_chrome_out, CHROME_ROOTS))
    print('         The cinema sheet matched %d element(s) outside its own layers beyond %s, which is declared above.'
          % (n_cinema_out, ', '.join(CINEMA_CONTENT_OK)))
    print('         AGX_SKIN_CSS: %d selectors, %d matched an element on at least one page, %d spent by no page.'
          % (len(skin_sels), len(skin_sels) - len(unspent), len(unspent)))
    if unspent and only:
        # 3b is a WHOLE-PAGE-SET measurement: a selector that only ep-app spends is unspent on any run that does not
        # load ep-app. Under --only it is reported and does not fail, the way render-audit.mjs already downgrades
        # RAIL_OVERLAP_ON_MAIN under --only. The usage line says so.
        print('         SKIN SELECTORS NO PAGE IN THIS --only SUBSET SPENDS (not a failure; 3b needs all twelve): '
              '%s' % ' ; '.join(unspent))
    elif unspent:
        print('         SKIN SELECTORS SPENT BY NO PAGE: %s' % ' ; '.join(unspent))
        bad += 1
    print('         The chrome sheet\'s footer phone floor: %d rule(s), %d spent on at least one page.'
          % (len(foot_hits), len(foot_hits) - len(foot_unspent)))
    if foot_unspent and only:
        print('         FOOTER FLOOR RULES NO PAGE IN THIS --only SUBSET SPENDS (not a failure; the check needs '
              'all twelve): %s' % ' ; '.join(foot_unspent))
    elif foot_unspent:
        print('         FOOTER FLOOR RULES SPENT BY NO PAGE: %s' % ' ; '.join(foot_unspent))
        bad += 1
    print('         %s' % ('0 with a delta' if not bad else '%d WITH A DELTA' % bad))
    return bad


if __name__ == '__main__':
    sys.exit(1 if main() else 0)
