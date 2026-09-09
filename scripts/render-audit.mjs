#!/usr/bin/env node
/**
 * The browser pass on the twelve rebuilt Atlas Glinn pages. Everything CLAUDE.md states about how these pages RENDER
 * is measured here, so the numbers in that file are reproducible instead of being one session's terminal scrollback.
 *
 *   node scripts/render-audit.mjs --shots <dir> [--only <slug>[,<slug>]]
 *
 * It serves the repo with `python3 -m http.server` on 127.0.0.1 (a port at or above 8900) and kills it on the way
 * out, drives Chromium through Playwright, and prints one line per page per measurement plus a SUMMARY block. It
 * exits non-zero on any assertion below. No network: the live photographs and films are atlasglinn.com URLs and 404
 * in the build container, which is the sandbox and not a finding — every assertion here is about the page's own DOM.
 *
 * WHAT IT ASSERTS
 *
 * 1. RENDERED VISIBILITY (r4-6). compare-atlas.py proves every live text unit is PRESENT in the build's markup;
 *    presence is not visibility. Every live text unit must have a non-zero box at 1440x900 or at 390x844, with the
 *    bar dropdown and the mobile menu OPEN — the two widths together, because the dropdown is display:none at 390
 *    and the mobile menu is display:none at 1440, so neither width alone can carry the whole set. The units come
 *    from `compare-atlas.py --units`, the same extractor the parity sheet reads, so the two passes cannot drift.
 *    HIDDEN_ON_LIVE is the named list of units allowed to render nowhere. It is NOT empty: SIX keys covering the
 *    SEVEN units measured with no box on any of the twelve pages, and every one of them is form-success text that is
 *    display:none until the form is submitted — index #cap-success (1), contact #contact-success (3), ep-app
 *    #form-success (3, sharing the tick key with contact). In every case the live capture carries the same element
 *    with the same rule, byte for byte, so the live site hides it too. That is the bar for this list: the reason it
 *    is invisible AND the evidence the live page hides it. Nothing else on the twelve pages renders nowhere.
 *
 * 2. RAIL HOVER LABELS (r4-9). Every chapter-rail label, hovered, must fit its own box: `scrollWidth <= clientWidth`
 *    on the label span. Measured at 1440x900 and at 1800x1000. The page-set carries 79 rail links, 77 of them with a
 *    label and 2 label-less ticks (executive-protection ch2, ep-app ch2, whose chapters carry no heading); the ticks
 *    hold an EMPTY span, so they are skipped on the label TEXT and never on the element. Before the clamp was raised,
 *    14 of the 77 labels at 1440 were cut mid-word by `max-width:13rem` with `text-overflow:clip` — the widest is uas
 *    ch4's "No Pilot Required. No Gaps in Coverage ." at 327px. The clamp is the measured maximum (20.5rem = 328px)
 *    and `text-overflow:ellipsis` is the backstop, so a label longer than any of today's degrades to an ellipsis
 *    instead of a severed word.
 *
 * 3. THE REVEAL WALK, AND ITS CADENCE IS PART OF THE MEASUREMENT. Stepping a page too fast leaves blocks stranded at
 *    opacity 0 — measured on origin/main at 1440x900, stepping 55% of a viewport every 90 ms left 13 unique blocks
 *    at opacity 0 on index, 11 on training, 19 on ep-app, while the same distances at 300 ms left 0 on all three.
 *    A cadence is therefore not an implementation detail of this test, it is the condition the claim holds under.
 *    THE CADENCE THIS TEST USES: half a viewport (0.5 x innerHeight) every 320 ms, then 1400 ms for the last fade,
 *    then every `.agx-ch`, `.reveal`, `.fade-in` and `.rise` must be at opacity >= 0.99. Report it as "none is left
 *    stranded at this cadence", never as "no element sits at opacity 0" — below-fold chapters DO sit at opacity 0
 *    until they are scrolled in, and that is the entrance motion working.
 *    SCROLL-BEHAVIOR IS OVERRIDDEN FOR THE WALK: the shell sets `html.agx-motion { scroll-behavior:smooth }`, under
 *    which a `scrollTo` every 320 ms is still animating when the next one arrives, so the page never settles and the
 *    walk measures the smooth-scroll animation rather than the reveals. The walk sets `scroll-behavior:auto` on
 *    documentElement for its duration and restores the sheet's value afterwards. Without that override this test
 *    measures a different page than a visitor reads.
 *
 * 4. RAIL LANDINGS. Every rail link is followed and the chapter it lands is measured. `.agx-ch` carries
 *    `scroll-margin-top:72px` because the bar is fixed and 60px tall; before that rule index ch2/ch3/ch4 landed their
 *    headings 26/26/49px from the top, under the bar. NO landing may put a heading above 60px.
 *
 * 5. PAGE ERRORS. No uncaught page error, and no failed request for a page-authored (same-origin) URL. External
 *    atlasglinn.com / YouTube / Google / mast-booking-backend requests are expected to fail here and are counted,
 *    not asserted.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
// Playwright from wherever this machine keeps it: the repo, a normal global install, or the container's node22 tree.
// PLAYWRIGHT=<path> overrides. A hard-coded /opt path is how a tool ends up runnable on exactly one machine.
const { chromium } = (() => {
  const tried = [];
  for (const cand of [process.env.PLAYWRIGHT, 'playwright', '/opt/node22/lib/node_modules/playwright',
    '/usr/local/lib/node_modules/playwright', '/opt/homebrew/lib/node_modules/playwright']) {
    if (!cand) continue;
    try { return require(cand); } catch (e) { tried.push(cand); }
  }
  throw new Error('playwright not found; tried ' + tried.join(', ') + '. Set PLAYWRIGHT=<path to the module>.');
})();

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PAGES = ['index', 'executive-protection', 'residential-protection', 'disaster-recovery', 'training',
  'technology', 'cuas-aerodefense', 'uas', 'about', 'careers', 'contact', 'ep-app'];
const WIDE = { width: 1440, height: 900 };
const NARROW = { width: 390, height: 844 };
const WIDER = { width: 1800, height: 1000 };

// Live text units allowed to render no box at either width. One entry, and it carries the reason it is invisible and
// the evidence that it is invisible ON THE LIVE PAGE TOO — that is the whole bar for being on this list. Anything
// that renders nowhere and is not here fails the run.
const SUBMIT_ONLY = 'a form-success block, style="display:none" inline until the form is submitted — byte-identical '
  + 'in the live capture and in the build, so the live site hides it too; it is not something the shell dropped';
const HIDDEN_ON_LIVE = {
  "Request received. We'll be in touch shortly.": 'index #cap-success (inline display:none): ' + SUBMIT_ONLY,
  '\u2705': 'the tick in contact #contact-success (inline) and ep-app #form-success (a sheet rule): ' + SUBMIT_ONLY,
  'Thank you for your interest in Atlas Glinn.': 'contact #contact-success (inline display:none): ' + SUBMIT_ONLY,
  'We will respond as soon as possible.': 'contact #contact-success (inline display:none): ' + SUBMIT_ONLY,
  'ACCESS REQUEST RECEIVED': 'ep-app #form-success, display:none in the page\u2019s own sheet: ' + SUBMIT_ONLY,
  'The Atlas Glinn team will review your request and contact you within 24-48 hours. Welcome to the future of protection.':
    'ep-app #form-success, display:none in the page\u2019s own sheet: ' + SUBMIT_ONLY,
};

const args = process.argv.slice(2);
const argOf = (name, dflt) => { const i = args.indexOf(name); return i < 0 ? dflt : args[i + 1]; };
const SHOTS = argOf('--shots', '');
// --only <slug>[,<slug>] narrows the run. The full pass is 36 page loads and takes minutes; a smoke test after
// touching this file should not have to.
const ONLY = argOf('--only', '');

function norm(s) { return s.replace(/\s+/g, ' ').trim(); }

async function freePort(from) {
  for (let p = from; p < from + 200; p++) {
    const ok = await new Promise((res) => {
      const srv = net.createServer();
      srv.once('error', () => res(false));
      srv.once('listening', () => srv.close(() => res(true)));
      srv.listen(p, '127.0.0.1');
    });
    if (ok) return p;
  }
  throw new Error('no free port at or above ' + from);
}

/** Past the splash, with the bar dropdown and the mobile menu opened so their text is laid out. The splash is
 *  DISMISSED BY ITS OWN CONTROL, never by display:none — the splash prints "Enter" and "Skip Intro →", which are live
 *  units of index, and hiding the overlay took their boxes away and reported them as unrendered. */
async function openChrome(page, wide) {
  await page.evaluate(() => {
    const s = document.getElementById('skip-intro') || document.getElementById('intro-enter');
    if (s) s.click();
  });
  await page.waitForTimeout(400);
  if (wide) {
    const drop = await page.$('#main-nav .nav-dropdown, #main-nav .has-dropdown, #main-nav li:has(.nav-dropdown-menu)');
    if (drop) { await drop.hover().catch(() => {}); }
    await page.evaluate(() => {
      document.querySelectorAll('#main-nav .nav-dropdown-menu, #main-nav .dropdown-menu, #main-nav ul ul')
        .forEach((el) => { el.style.display = 'block'; el.style.opacity = '1'; el.style.visibility = 'visible'; });
    });
  } else {
    await page.evaluate(() => {
      const t = document.getElementById('nav-toggle');
      if (t) t.click();
      const m = document.getElementById('mobile-nav');
      if (m) { m.classList.add('open', 'active'); m.style.display = 'block'; m.style.opacity = '1'; m.style.visibility = 'visible'; m.style.transform = 'none'; }
    });
  }
  await page.waitForTimeout(250);
}

/** Every normalized text run in the document that has a non-zero box, as a Set.
 *
 *  An <option>'s own box is 0x0 in Chromium — the popup is laid out by the browser, not by the document — so an
 *  option is measured by the box of the <select> that carries it. That is the honest reading: the reader meets the
 *  option by opening a control that IS on the page at a real size. A <select> that were itself display:none would
 *  still report 0 and its options with it. */
async function renderedUnits(page) {
  return new Set(await page.evaluate(() => {
    const out = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const t = (n.nodeValue || '').replace(/\s+/g, ' ').trim();
      if (!t) continue;
      const p = n.parentElement;
      if (!p || p.closest('script, style')) continue;
      let b;
      const opt = p.closest('option, optgroup');
      if (opt) {
        const sel = opt.closest('select');
        b = sel ? sel.getBoundingClientRect() : opt.getBoundingClientRect();
      } else {
        const r = document.createRange();
        r.selectNodeContents(n);
        b = r.getBoundingClientRect();
      }
      if (b.width > 0 && b.height > 0) out.push(t);
    }
    return out;
  }));
}

/** Hover every rail link and measure whether its label fits: scrollWidth (the label's own content width) against
 *  clientWidth (what the clamp leaves it) WHILE HOVERED. The wait matters — `.agx-rail-link:hover span` transitions
 *  max-width over .35s, and a 140 ms wait measured every label at clientWidth 0, which reads as "every label clipped"
 *  and is an artefact of the test, not of the page. It also counts the live text boxes the open label covers, which
 *  is the cost of a wider clamp and is stated rather than assumed. */
async function railLabels(page) {
  const links = await page.$$('a.agx-rail-link');
  const rows = [];
  let ticks = 0;
  for (const a of links) {
    // A heading-less chapter's tick carries an EMPTY <span> (executive-protection ch2, ep-app ch2) — the element is
    // there, the label is not — so the skip is on the text, never on the element. Skipping on `$('span')` counted
    // 79 labels where the pages carry 79 rail links and 77 labels.
    const text = await a.evaluate((el) => {
      const s = el.querySelector('span');
      return s ? (s.textContent || '').replace(/\s+/g, ' ').trim() : '';
    });
    if (!text) { ticks++; continue; }
    // TWO mouse moves, not elementHandle.hover(). Measured: after the pointer has hovered anything else on the page
    // (the bar dropdown, or the previous rail link), a single synthetic move leaves Chromium's hover state stale —
    // `a.agx-rail-link:hover` matched the right anchor while its span still computed max-width 0px, and every label
    // read as clipped. A second move one pixel across settles it. The wait is 500 ms because the label's max-width
    // transition is .35s; at 140 ms every label measured 0 and that was the test, not the page.
    const box = await a.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.move(box.x + box.width / 2 + 1, box.y + box.height / 2);
    }
    await page.waitForTimeout(500);
    const measure = async () => a.evaluate((el) => {
      const s = el.querySelector('span');
      const cs = getComputedStyle(s);
      const sr = s.getBoundingClientRect();
      let overlap = 0;
      if (sr.width > 0) {
        const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n = w.nextNode(); n; n = w.nextNode()) {
          if (!(n.nodeValue || '').trim()) continue;
          const pe = n.parentElement;
          if (!pe || pe.closest('script, style, .agx-rail')) continue;
          const rg = document.createRange();
          rg.selectNodeContents(n);
          const b = rg.getBoundingClientRect();
          if (b.width > 0 && b.height > 0 && b.right > sr.left && b.left < sr.right
              && b.bottom > sr.top && b.top < sr.bottom) overlap++;
        }
      }
      return { text: (s.textContent || '').replace(/\s+/g, ' ').trim(), scroll: s.scrollWidth, client: s.clientWidth,
        maxw: cs.maxWidth, ellipsis: cs.textOverflow, overlap,
        right: el.getBoundingClientRect().right, left: el.getBoundingClientRect().left };
    });
    let row = await measure();
    if (row.client === 0 && row.scroll > 0 && box) {
      // One retry. A label at clientWidth 0 is not a clipped label, it is an UNMEASURED one, and the two must not be
      // confused: reporting "303 > 0px" as clipping is how the first run of this test invented 79 clipped labels.
      // Anything still 0 after the retry is counted as unmeasured, named, and fails the run.
      await page.mouse.move(box.x + box.width / 2 - 2, box.y + box.height / 2);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 1);
      await page.waitForTimeout(600);
      row = await measure();
    }
    row.unmeasured = row.client === 0 && row.scroll > 0;
    rows.push(row);
  }
  rows.ticks = ticks;
  return rows;
}

/** Where each rail link LANDS its chapter: the chapter box's top and its first heading's top, after the browser's
 *  own scroll-to-fragment (which honours `.agx-ch { scroll-margin-top:72px }`). The bar is fixed and 60px tall, so a
 *  heading landing above 60px is under the bar and unreadable — that is the assertion. `scroll-behavior` is forced to
 *  auto for the same reason the reveal walk forces it: under the shell's smooth scrolling the box is measured
 *  mid-animation. */
async function railLandings(page) {
  return page.evaluate(async () => {
    const root = document.documentElement;
    const prev = root.style.scrollBehavior;
    root.style.scrollBehavior = 'auto';
    const out = [];
    const links = [...document.querySelectorAll('a.agx-rail-link')];
    for (let k = 0; k < links.length; k++) {
      const id = (links[k].getAttribute('href') || '').slice(1);
      const ch = document.getElementById(id);
      if (!ch) continue;
      window.location.hash = '#' + id;
      await new Promise((r) => setTimeout(r, 240));
      const h = ch.querySelector('h1, h2, h3, h4, h5, h6');
      out.push({ id, first: k === 0, box: ch.getBoundingClientRect().top,
        head: h ? h.getBoundingClientRect().top : null });
    }
    root.style.scrollBehavior = prev;
    window.scrollTo(0, 0);
    return out;
  });
}


/** The reveal walk. Cadence and the scroll-behavior override are documented at the head of this file. */
async function revealWalk(page) {
  return page.evaluate(async () => {
    const root = document.documentElement;
    const prev = root.style.scrollBehavior;
    root.style.scrollBehavior = 'auto';           // the shell's html.agx-motion sets smooth; a 320 ms cadence under
    const step = Math.round(innerHeight * 0.5);   // smooth never settles and measures the animation, not the reveals
    for (let y = 0; y <= document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 320));
    }
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise((r) => setTimeout(r, 1400));
    const sel = '.agx-ch, .reveal, .fade-in, .rise';
    const els = [...document.querySelectorAll(sel)];
    const dim = els.filter((e) => parseFloat(getComputedStyle(e).opacity) < 0.99);
    root.style.scrollBehavior = prev;
    window.scrollTo(0, 0);
    return { total: els.length, stranded: dim.length,
      names: dim.slice(0, 6).map((e) => e.tagName + '.' + (e.className || '').toString().slice(0, 40)) };
  });
}

async function main() {
  // In the OS temp dir, never the repo: a run interrupted mid-way would otherwise leave an untracked file behind.
  const unitsFile = path.join(os.tmpdir(), 'render-audit-units-' + process.pid + '.json');
  await new Promise((res, rej) => {
    const p = spawn('python3', [path.join(REPO, 'scripts', 'compare-atlas.py'), '--units', unitsFile],
      { cwd: REPO, stdio: 'inherit' });
    p.on('exit', (c) => (c === 0 ? res() : rej(new Error('compare-atlas.py --units exit ' + c))));
  });
  const liveUnits = JSON.parse(fs.readFileSync(unitsFile, 'utf8'));

  const port = await freePort(8900);
  const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'],
    { cwd: REPO, stdio: 'ignore' });
  const base = 'http://127.0.0.1:' + port + '/';
  await new Promise((r) => setTimeout(r, 900));
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

  // The browser is launched INSIDE the try below: a launch that throws outside it leaves the http.server orphaned,
  // which is what happened the first time this ran (a stale listener held 8900 for the next run).
  let browser = null;
  let bad = 0;
  const sum = { units: 0, unseen: 0, labels: 0, clipped1440: 0, clipped1800: 0, stranded: 0, chapters: 0, pageErrors: 0, localFails: 0, unmeasured: 0, ticks: 0,
    landings: 0, landingsAt72: 0, landingsFirst: 0, landingsHead: 0, headUnderBar: 0 };
  let maxScroll = 0, maxScrollText = '', minGap = 1e9, noEllipsis = 0, overlap1440 = 0, maxOverlap = 0;
  let headMin = 1e9, headMax = -1e9;

  const pages = ONLY ? PAGES.filter((p) => ONLY.split(',').includes(p)) : PAGES;
  if (!pages.length) throw new Error('--only matched no page of: ' + PAGES.join(', '));
  try {
    // CHROMIUM=<path> wins; then the container's symlink if it is there; otherwise Playwright's own download.
    const exe = process.env.CHROMIUM
      || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
    browser = await chromium.launch({ ...(exe ? { executablePath: exe } : {}),
      args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    for (const slug of pages) {
      const file = slug === 'index' ? 'index.html' : slug + '.html';
      const want = liveUnits[slug];
      const seen = new Set();
      let pageErrors = 0, localFails = [];

      for (const [vp, wide] of [[WIDE, true], [NARROW, false]]) {
        const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
        const page = await ctx.newPage();
        page.on('pageerror', () => { pageErrors++; });
        page.on('requestfailed', (r) => {
          const u = r.url();
          if (u.startsWith(base)) localFails.push(u.slice(base.length));
        });
        await page.goto(base + file, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForTimeout(900);
        for (const u of await renderedUnits(page)) seen.add(u);   // the splash is up: "Enter", "Skip Intro →"
        await openChrome(page, wide);
        for (const u of await renderedUnits(page)) seen.add(u);   // and the page behind it, menus open
        if (SHOTS) {
          await page.screenshot({ path: path.join(SHOTS, `${slug}-${vp.width}x${vp.height}.png`) });
        }
        if (wide) {
          const rows = await railLabels(page);
          sum.labels += rows.length;
          sum.ticks += rows.ticks;
          const clipped = rows.filter((r) => !r.unmeasured && r.scroll > r.client);
          const unmeasured = rows.filter((r) => r.unmeasured);
          sum.clipped1440 += clipped.length;
          sum.unmeasured += unmeasured.length;
          if (unmeasured.length) {
            console.log(`    UNMEASURED at 1440 on ${slug} (the label never opened): ` +
              unmeasured.map((r) => JSON.stringify(r.text)).join(', '));
          }
          for (const r of rows) {
            if (r.scroll > maxScroll) { maxScroll = r.scroll; maxScrollText = r.text; }
            if (r.left < minGap) minGap = r.left;
            if (r.ellipsis !== 'ellipsis') noEllipsis++;
            overlap1440 += r.overlap;
            if (r.overlap > maxOverlap) maxOverlap = r.overlap;
          }
          if (clipped.length) {
            console.log(`    CLIPPED at 1440 on ${slug}: ` +
              clipped.map((r) => `${JSON.stringify(r.text)} ${r.scroll}>${r.client}px`).join(', '));
          }
          for (const L of await railLandings(page)) {
            sum.landings++;
            if (L.first) sum.landingsFirst++;
            else if (L.box >= 71.5 && L.box <= 72.5) sum.landingsAt72++;
            if (L.head !== null) {
              sum.landingsHead++;
              if (L.head < headMin) headMin = L.head;
              if (L.head > headMax) headMax = L.head;
              if (L.head < 60) { sum.headUnderBar++; console.log(`    HEADING UNDER THE 60px BAR on ${slug} ${L.id}: ${Math.round(L.head)}px`); }
            }
          }
          const walk = await revealWalk(page);
          sum.stranded += walk.stranded;
          sum.chapters += walk.total;
          if (walk.stranded) {
            console.log(`    STRANDED on ${slug} at 1440: ${walk.stranded}/${walk.total} ${JSON.stringify(walk.names)}`);
            bad++;
          }
        }
        await ctx.close();
      }

      // The wider width, for the rail only: MAST prints its label on the reading position from 1700.
      {
        const ctx = await browser.newContext({ viewport: WIDER, deviceScaleFactor: 1 });
        const page = await ctx.newPage();
        await page.goto(base + file, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForTimeout(700);
        await openChrome(page, true);
        for (const L of await railLandings(page)) {
          sum.landings++;
          if (L.first) sum.landingsFirst++;
          else if (L.box >= 71.5 && L.box <= 72.5) sum.landingsAt72++;
          if (L.head !== null) {
            sum.landingsHead++;
            if (L.head < headMin) headMin = L.head;
            if (L.head > headMax) headMax = L.head;
            if (L.head < 60) { sum.headUnderBar++; console.log(`    HEADING UNDER THE 60px BAR on ${slug} ${L.id} at 1800: ${Math.round(L.head)}px`); }
          }
        }
        const rows = await railLabels(page);
        const clipped = rows.filter((r) => !r.unmeasured && r.scroll > r.client);
        const unmeasured = rows.filter((r) => r.unmeasured);
        sum.clipped1800 += clipped.length;
        sum.unmeasured += unmeasured.length;
        if (unmeasured.length) {
          console.log(`    UNMEASURED at 1800 on ${slug} (the label never opened): ` +
            unmeasured.map((r) => JSON.stringify(r.text)).join(', '));
        }
        if (clipped.length) {
          console.log(`    CLIPPED at 1800 on ${slug}: ` +
            clipped.map((r) => `${JSON.stringify(r.text)} ${r.scroll}>${r.client}px`).join(', '));
        }
        await ctx.close();
      }

      const unseen = want.filter((u) => !seen.has(norm(u)) && !(u in HIDDEN_ON_LIVE));
      sum.units += want.length;
      sum.unseen += unseen.length;
      sum.pageErrors += pageErrors;
      sum.localFails += localFails.length;
      const ok = unseen.length === 0 && pageErrors === 0 && localFails.length === 0;
      if (!ok) bad++;
      console.log(`${slug.padEnd(24)} live units ${String(want.length).padStart(4)}  rendered ` +
        `${String(want.length - unseen.length).padStart(4)}  no box ${String(unseen.length).padStart(3)}  ` +
        `page errors ${pageErrors}  local request failures ${localFails.length}  ${ok ? 'OK' : 'DELTA'}`);
      for (const u of unseen.slice(0, 8)) console.log(`    NO RENDERED BOX AT EITHER WIDTH: ${JSON.stringify(u.slice(0, 110))}`);
      for (const u of localFails.slice(0, 6)) console.log(`    LOCAL REQUEST FAILED: ${u}`);
    }
  } finally {
    if (browser) await browser.close();
    server.kill('SIGTERM');
    fs.rmSync(unitsFile, { force: true });
  }

  console.log(`\nSUMMARY  live text units ${sum.units}, rendered ${sum.units - sum.unseen}, no box at either width ${sum.unseen}`);
  console.log(`         rail links ${sum.labels + sum.ticks} a page-set, ${sum.labels} carrying a label and ${sum.ticks} label-less ticks; hovered at 1440 and at 1800: clipped ${sum.clipped1440} at 1440, ${sum.clipped1800} at 1800`);
  console.log(`         rail landings ${sum.landings} across 1440 and 1800: ${sum.landingsAt72} put the chapter box at 71.5-72.5px, ${sum.landingsFirst} are each page's FIRST link (document top), ${sum.headUnderBar} put a heading under the 60px bar`);
  console.log(`         of those, ${sum.landingsHead} land a chapter that carries a heading: ${headMin === 1e9 ? 'n/a' : Math.round(headMin * 10) / 10}px to ${headMax === -1e9 ? 'n/a' : Math.round(headMax * 10) / 10}px from the top`);
  console.log(`         rail labels whose hover state never settled, excluded from the clipped counts: ${sum.unmeasured}`);
  console.log(`         reveal walk at 0.5 viewport / 320 ms + 1400 ms settle: ${sum.stranded} of ${sum.chapters} blocks below opacity 0.99`);
  console.log(`         widest label at 1440: ${maxScroll}px ${JSON.stringify(maxScrollText)}; leftmost rail-link edge ${Math.round(minGap)}px; labels without text-overflow:ellipsis ${noEllipsis}`);
  console.log(`         live text boxes an OPEN hover label covers at 1440: ${overlap1440} over ${sum.labels} labels, worst single label ${maxOverlap}`);
  console.log(`         page errors ${sum.pageErrors}, failed same-origin requests ${sum.localFails}`);
  if (sum.unmeasured) bad++;
  if (sum.headUnderBar) bad++;
  console.log(`         ${pages.length} page(s) x 1440x900 + 390x844 (+1800x1000 for the rail) = ${pages.length * 3} runs, ${bad ? bad + ' WITH A DELTA' : '0 with a delta'}`);
  return bad;
}

main().then((bad) => {
  process.exit(bad ? 1 : 0);
}).catch((e) => { console.error(e); process.exit(2); });
