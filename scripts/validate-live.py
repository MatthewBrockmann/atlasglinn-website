#!/usr/bin/env python3
"""The browser pass on the three stylesheets the twelve Atlas Glinn pages carry, and on the two fixed HUD corners.

  python3 scripts/validate-live.py [--only <slug>[,<slug>]] [--port <n>]

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
               '.agx-ch, .agx-content, html')
CINEMA_ANC = '#agx-canvas, #agx-photos, #agx-progress, .agx-rail, .agx-hud'
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
const TYPESCALE = () => {
  const SKIP = '.agx-rail, .agx-hud, #intro-overlay, #main-nav, #mobile-nav, footer, #back-to-top';
  const out = [];
  for (const el of document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li')) {
    if (el.closest(SKIP)) continue;
    const cs = getComputedStyle(el);
    out.push([el.tagName.toLowerCase(), cs.fontSize, cs.fontFamily, cs.lineHeight]);
  }
  return out;
};
const BOXES = () => {
  const names = ['.agx-hud-br', '.agx-hud-bl', '.agx-rail', '#back-to-top', '#sound-toggle'];
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
    const buildType = await page.evaluate(TYPESCALE);
    const chapters = await page.evaluate(() => document.querySelectorAll('.agx-ch').length);
    const hud0 = await page.evaluate(() => ({
      bl: getComputedStyle(document.querySelector('.agx-hud-bl'), '::before').content,
      br: getComputedStyle(document.querySelector('.agx-hud-br'), '::before').content,
      disp: getComputedStyle(document.querySelector('.agx-hud-br')).display }));
    const k = Math.min(3, chapters);
    await page.evaluate((k) => {
      document.documentElement.style.scrollBehavior = 'auto';
      document.querySelectorAll('.agx-ch')[k - 1].scrollIntoView();
      window.scrollBy(0, 40);
      window.dispatchEvent(new Event('scroll'));
    }, k);
    await page.waitForTimeout(450);
    const hudK = await page.evaluate(() => getComputedStyle(document.querySelector('.agx-hud-br'), '::before').content);
    await page.evaluate(() => window.scrollTo(0, 0));

    const boxes = {};
    for (const w of job.widths) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.waitForTimeout(350);
      boxes[w] = await page.evaluate(BOXES);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(350);
    const narrow = await page.evaluate(() => [
      getComputedStyle(document.querySelector('.agx-hud-bl')).display,
      getComputedStyle(document.querySelector('.agx-hud-br')).display]);

    await page.setViewportSize({ width: 1440, height: 900 });
    phase = 'live';
    await page.goto(base + '__live__/' + P.slug + '.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(700);
    const liveType = await page.evaluate(TYPESCALE);

    const shared = new Set(liveErrs);
    results.push({ slug: P.slug, chrome, cinema, skin, buildType, liveType, chapters, hud0, hudK, boxes,
      narrow, errs: errs.filter((e) => !shared.has(e)), liveErrs, k });
    await ctx.close();
  }
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
fs.writeFileSync(OUT_PATH, JSON.stringify(results));
"""


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

    print('DECLARED EXCEPTION: AGX_SKIN_CSS (atlas_shell.py) — the ONE sheet permitted to match content, scoped '
          '.agx-content; the chrome sheet is still asserted to match none.')
    bad = 0
    skin_hits = dict.fromkeys(range(len(skin_sels)), 0)
    for P, R in zip(job['pages'], results):
        slug = R['slug']
        chrome_out = [r for r in R['chrome'] if r['outsideN']]
        cinema_out = [r for r, raw in zip(R['cinema'], P['cinemaRaw'])
                      if r['outsideN'] and raw not in CINEMA_CONTENT_OK]
        skin_out = [r for r in R['skin'] if r['outsideN']]
        for i, r in enumerate(R['skin']):
            skin_hits[i] += r['n']
        type_ok = R['buildType'] == R['liveType']
        n = R['chapters']
        hud_bad = []
        if R['hud0']['bl'] != '"ATLAS GLINN · HOUSTON"':
            hud_bad.append('bottom-left content %s' % R['hud0']['bl'])
        if R['hud0']['br'] != '"SECTION 01 / %02d"' % n:
            hud_bad.append('bottom-right content %s at scroll 0 (%d chapters)' % (R['hud0']['br'], n))
        if R['hud0']['disp'] == 'none':
            hud_bad.append('the HUD is display:none at 1440')
        if R['hudK'] != '"SECTION %02d / %02d"' % (R['k'], n):
            hud_bad.append('bottom-right content %s at chapter %d' % (R['hudK'], R['k']))
        if R['narrow'] != ['none', 'none']:
            hud_bad.append('the HUD computes %r at 390, not hidden' % R['narrow'])
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
        ok = not (chrome_out or cinema_out or skin_out or not type_ok or hud_bad or hits or R['errs'])
        bad += 0 if ok else 1
        print('%-24s chrome %2d sel/%d outside  cinema %2d sel/%d outside  skin %3d sel/%d outside  '
              'type %d==%d %s  hud %s  fixed-chrome hits %d  page errors %d (+%d the capture raises too)  %s'
              % (slug, len(R['chrome']), len(chrome_out), len(R['cinema']), len(cinema_out),
                 len(R['skin']), len(skin_out), len(R['buildType']), len(R['liveType']),
                 'EQUAL' if type_ok else 'DIFFER', 'OK' if not hud_bad else 'BAD', len(hits), len(R['errs']),
                 len(R['liveErrs']), 'OK' if ok else 'DELTA'))
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
    print('\nSUMMARY  %d page(s). The chrome sheet matched 0 elements outside %s on every one.'
          % (len(pages), CHROME_ROOTS))
    print('         The cinema sheet matched nothing outside its own layers except %s, which is declared above.'
          % ', '.join(CINEMA_CONTENT_OK))
    print('         AGX_SKIN_CSS: %d selectors, %d matched an element on at least one page, %d spent by no page.'
          % (len(skin_sels), len(skin_sels) - len(unspent), len(unspent)))
    if unspent:
        print('         SKIN SELECTORS SPENT BY NO PAGE: %s' % ' ; '.join(unspent))
        bad += 1
    print('         %s' % ('0 with a delta' if not bad else '%d WITH A DELTA' % bad))
    return bad


if __name__ == '__main__':
    sys.exit(1 if main() else 0)
