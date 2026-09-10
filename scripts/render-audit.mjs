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
 *
 * 6. ICON SWAPS (2026-09-09). compare-atlas.py withholds the swapped emoji units from the dump because the build
 *    deliberately does not print them; this is the other half of that measurement, in a real browser: one rendered
 *    <svg class="agx-icon"> with a non-zero box per declared swap, and no emoji code point left inside any
 *    icon-class element. ep-app's .success-icon lives inside #form-success, which is display:none until the form is
 *    submitted, so that block is force-shown for the box measurement and put back — otherwise the honest count
 *    would be 27 drawn of 28 for a reason that has nothing to do with the swap.
 *
 * 7. WHAT THE FIXED CHROME COVERS, WALKED DOWN THE PAGE — THE RAIL *AND* THE HUD. The live text boxes the
 *    unhovered rail covers are counted at 1025, 1280, 1440 and 1800 and asserted to be ZERO. That is the gate the
 *    band in CINEMA_CSS was set from, not a formality: shipping a label sitting on top of a reader's own sentence
 *    is not a trade this rail is allowed to make.
 *    THE HUD IS WALKED BY THE SAME MEASUREMENT SINCE r5, and that is a finding, not a feature. The walk was
 *    written for the rail, applied to the rail, and its number ("the tick alone at right:.45rem -> 0") was used to
 *    drop the standing sidebar — while the other fixed element the same commit added was never pointed at it.
 *    Walked: 30 live text runs covered on training and ep-app alone, .agx-hud-bl [26,213,966,982] printing through
 *    "Learn to identify, evaluate, and mitigate threat" on training at 1440 among them. The HUD now gives way
 *    (CINEMA_JS's lane gate, .agx-clear) and this check is what holds it to that. validate-live.py check 6 stayed
 *    green through all of it because it compares fixed chrome against fixed chrome and never against content; it
 *    is unchanged, and this is the check that covers the gap rather than that one's exception list being widened.
 *
 * 8. WHAT A CARD DOES UNDER THE POINTER (r5). One real hover per skinned card class per page: measured dy -6px,
 *    computed transition-duration 0.45s, and no rgb(201,168,76) in the computed box-shadow. See cardHovers() for
 *    why a source grep could not see any of it.
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

// Rail-overlap runs that ORIGIN/MAIN produces too, keyed `slug@width`, each with the measurement that proves it.
// The bar is the same as HIDDEN_ON_LIVE's: the reason AND the evidence it is not this branch's. Anything else is a
// delta. Unspent keys are printed, because an allowance nothing uses is a hole nothing guards.
const RAIL_OVERLAP_ON_MAIN = {
  'about@1280': 'about\u2019s team-card bio line box ends at x=1278 in a 1280px viewport, which is 2px from the '
    + 'edge, so the rail\u2019s TICK sits on it whatever the rail does. Measured 2026-09-09 by driving '
    + 'origin/main\u2019s own about.html through this exact walk and this branch\u2019s beside it: both cover the '
    + 'same single run, ["TICK","J. Renee Renobato serves as Office Manag",1278,X], with X=1249 on origin/main and '
    + 'X=1253 here \u2014 this branch\u2019s tick lane is 4px FURTHER from the copy than main\u2019s, and it still '
    + 'touches. Not introduced here, and not fixable from the rail side.',
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
          if (!pe || pe.closest('script, style, .agx-rail, [data-agx-invis]')) continue;
          const rg = document.createRange();
          rg.selectNodeContents(n);
          // Per line box, for the reason given at standingStop(): a union box spans the column, a line box does not.
          for (const b of rg.getClientRects()) {
            if (b.width > 0 && b.height > 0 && b.right > sr.left && b.left < sr.right
                && b.bottom > sr.top && b.top < sr.bottom) { overlap++; break; }
          }
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

/** Mark every element a reader cannot see, so an overlap count is about text a reader actually meets.
 *
 *  THIS IS A CORRECTION, not a refinement. The splash is dismissed by its own control and `#intro-overlay.hidden`
 *  is `opacity:0; visibility:hidden` — NOT display:none — so its "Enter" / "Skip Intro →" / wordmark still return
 *  non-zero boxes, and the rail-overlap walker counted them as live text the label covers. Measured 2026-09-09 at
 *  1025x1000 with every label standing at 11rem: 4 "covered" boxes, and the first one inspected was the string
 *  "Enter" at right 915 under a label whose left edge is 830 — the splash button, behind an invisible overlay.
 *  The 0-covered figure CLAUDE.md carries for 1440 was right by accident: the narrower hover label never reached
 *  the centred splash. Counting invisible text as covered would have set the rail's clamp from an artefact. */
async function markInvisible(page) {
  return page.evaluate(() => {
    let n = 0;
    for (const el of document.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) {
        el.setAttribute('data-agx-invis', '');
        n++;
      }
    }
    return n;
  });
}

/** The live text boxes the rail covers WITH NO HOVER, WALKED DOWN THE PAGE.
 *
 *  THE WALK IS THE MEASUREMENT, not a nicety. Taken at scroll 0 this returns 0 for every rail form that was tried,
 *  including one that puts a label straight across a card's body copy — the hero band is empty on the right and
 *  the grids below it are not. Walked at 0.75 viewport steps down all twelve pages at 1440x900 on 2026-09-09:
 *  every label standing at 20.5rem covered 49 live text runs, at 9rem 36, the active label alone 12, and the
 *  numbered tick with no label 0. That is why the rail ships the number and gives the label on hover. */
async function standingOverlap(page) {
  // Park the pointer first. railLabels() leaves it on the last link it hovered, and that one label stays open
  // through the whole walk — measured as "1 standing label" at 1800 on a build whose labels never stand.
  await page.mouse.move(4, 4);
  await page.waitForTimeout(420);
  const H = await page.evaluate(() => document.body.scrollHeight);
  const step = await page.evaluate(() => Math.round(innerHeight * 0.75));
  let standing = 0, covered = 0, first = null;
  let hudCovered = 0, hudFirst = null, hudStops = 0, hudShown = 0;
  await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; });
  for (let y = 0; y < H; y += step) {
    await page.evaluate((y) => { window.scrollTo(0, y); window.dispatchEvent(new Event('scroll')); }, y);
    await page.waitForTimeout(200);
    // The forced reveals put text on screen that the gate has not seen yet, so the scroll event is fired AGAIN
    // after them and the frame is allowed to land. Without this the walk measures the HUD against a lane the
    // page's own gate was never told about, which reads as a failure of the gate and is a failure of the test.
    await page.evaluate(() => {
      document.querySelectorAll('.reveal').forEach((e) => e.classList.add('active'));
      document.querySelectorAll('.fade-in').forEach((e) => e.classList.add('visible'));
      document.querySelectorAll('.agx-ch').forEach((e) => e.classList.add('agx-in'));
      window.dispatchEvent(new Event('scroll'));
    });
    await page.waitForTimeout(120);
    await markInvisible(page);
    const r = await standingStop(page);
    standing = Math.max(standing, r.standing);
    covered += r.covered;
    if (r.first && !first) first = r.first;
    hudCovered += r.hudCovered;
    hudStops++;
    hudShown += r.hudShown;
    if (r.hudFirst && !hudFirst) hudFirst = r.hudFirst;
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  return { standing, covered, first, hudCovered, hudFirst, hudStops, hudShown };
}

/** One stop of the walk: the boxes the rail's and the HUD's own visible parts occupy against every visible text run.
 *
 *  THE HUD IS WALKED BY THE SAME MEASUREMENT AS THE RAIL, and that is the finding that put it here (r5, 2026-09-09).
 *  The walk was written for the rail, applied to the rail, and its number was used to drop the standing sidebar —
 *  and the other fixed element the same commit added was never pointed at. Walked here it measured 33 live text
 *  runs under the two HUD corners across the twelve pages. validate-live.py check 6 stayed green throughout
 *  because it compares fixed chrome against fixed chrome and never against content; it is unchanged and this is
 *  the check that covers the gap, rather than widening that one's exception list to absorb it. */
async function standingStop(page) {
  return page.evaluate(() => {
    // The label's max-width TRANSITIONS over .35s, so a viewport resize followed by a fixed wait measures the
    // animation rather than the band: at 360 ms after a 1800 -> 1280 resize, thirteen labels still read as
    // standing that the 1440 media query had just switched off. Killing the transition makes the measurement the
    // page's steady state, which is the thing being asserted.
    const kill = document.createElement('style');
    kill.textContent = '.agx-rail-link span, .agx-rail-link::before { transition:none !important; }';
    document.head.appendChild(kill);
    void document.body.offsetWidth;
    // The rail's own INK, not the link box: a link's box spans the whole rail column whether or not its label is
    // open, so measuring the box would report the tick lane as covering text it does not touch. What is measured
    // is the standing label span, plus the ::before number's lane, which is the link box minus the label and minus
    // the tick — read off the computed max-width the number is clamped to.
    const rail = document.querySelector('.agx-rail');
    const ink = [];
    let standing = 0;
    for (const a of document.querySelectorAll('a.agx-rail-link')) {
      const lb = a.getBoundingClientRect();
      const s = a.querySelector('span');
      if (s && (s.textContent || '').trim()) {
        const sr = s.getBoundingClientRect();
        if (sr.width > 0) { ink.push(sr); standing++; }
      }
      const num = parseFloat(getComputedStyle(a, '::before').maxWidth);
      if (num > 0) ink.push({ left: lb.left, right: lb.right, top: lb.top, bottom: lb.bottom });
      // The TICK is ink too, and leaving it out is how a gate passes a rail that touches copy with the one part
      // it always paints. It is the right-hand end of the link box, ::after's own width plus the link's padding.
      const tick = parseFloat(getComputedStyle(a, '::after').width) || 0;
      const pad = parseFloat(getComputedStyle(a).paddingRight) || 0;
      if (tick > 0) ink.push({ left: lb.right - tick - pad, right: lb.right, top: lb.top, bottom: lb.bottom });
    }
    // The HUD's ink is the whole element box — both corners print a single mono line through ::before and have no
    // padding to discount. A corner the page's own gate has taken to opacity 0 paints nothing, so it carries no
    // ink; display:none below 1025 likewise. `hudShown` counts the corners that ARE painting at this stop, so a
    // gate that simply never shows the HUD reads as 0 shown rather than as a pass.
    const hudInk = [];
    let hudShown = 0;
    for (const h of document.querySelectorAll('.agx-hud')) {
      const cs = getComputedStyle(h);
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.02) continue;
      const b = h.getBoundingClientRect();
      if (b.width > 0 && b.height > 0) { hudInk.push({ left: b.left, right: b.right, top: b.top, bottom: b.bottom, name: h.className }); hudShown++; }
    }
    let covered = 0, first = null, hudCovered = 0, hudFirst = null;
    if (ink.length || hudInk.length) {
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        if (!(n.nodeValue || '').trim()) continue;
        const pe = n.parentElement;
        if (!pe || pe.closest('script, style, .agx-rail, .agx-hud, [data-agx-invis]')) continue;
        // PER LINE BOX, not the range's union box. A wrapped paragraph's union box spans the whole column even
        // where its last line stops short, so a union-box test reported about's bio paragraph as covered at 1280
        // with a right edge of 1284 in a 1280px viewport — an artefact of the union, not a glyph under the rail.
        // getClientRects() returns one rect per line, which is as close to the glyphs as the DOM gets.
        const rg = document.createRange();
        rg.selectNodeContents(n);
        let hit = null, hudHit = null;
        for (const b of rg.getClientRects()) {
          if (!(b.width > 0 && b.height > 0)) continue;
          if (!hit) {
            for (const r of ink) {
              if (b.right > r.left && b.left < r.right && b.bottom > r.top && b.top < r.bottom) { hit = [b, r]; break; }
            }
          }
          if (!hudHit) {
            for (const r of hudInk) {
              if (b.right > r.left && b.left < r.right && b.bottom > r.top && b.top < r.bottom) { hudHit = [b, r]; break; }
            }
          }
          if (hit && hudHit) break;
        }
        if (hit) {
          covered++;
          if (!first) first = [(n.nodeValue || '').trim().slice(0, 40), Math.round(hit[0].right), Math.round(hit[1].left)];
        }
        if (hudHit) {
          hudCovered++;
          if (!hudFirst) {
            hudFirst = [hudHit[1].name, (n.nodeValue || '').trim().slice(0, 48),
              [hudHit[1].left, hudHit[1].right, hudHit[1].top, hudHit[1].bottom].map(Math.round),
              [hudHit[0].left, hudHit[0].right, hudHit[0].top, hudHit[0].bottom].map(Math.round)];
          }
        }
      }
    }
    kill.remove();
    return { standing, covered, first, hudCovered, hudFirst, hudShown };
  });
}

/** Check 8: WHAT THE CARD ACTUALLY DOES WHEN A POINTER IS ON IT.
 *
 *  atlas_shell.assert_shared_hover() reads a string out of cinematic_shell.py. That proves the two sites' SHEETS
 *  agree and nothing more, and on the strength of it a claim shipped that "the hover lifts 6px over .45s" while
 *  four pages rendered -4px over 0.2s with a 1.02 scale and an rgba(201,168,76) glow — MAST gold — because the
 *  live pages' own tail script writes transform, transition and box-shadow as INLINE styles, which beat any
 *  stylesheet rule at any specificity. Nothing that reads CSS source can see that. This does: it puts the pointer
 *  on one real card of each class the skin's tilt override names, then asserts on the COMPUTED values.
 *    dy   — the card's own box, at rest and hovered. Must be -6px (the shared lift), +-0.75px for subpixel.
 *    dur  — computed transition-duration must contain 0.45s.
 *    gold — computed box-shadow must not contain rgb(201, 168, 76). This is hard constraint C in the brief
 *           ("no gold on Atlas content"), and it was passing as a regex over the CSS source while the gold lived
 *           in an inline style. */
/** Read an element's box top, its computed transition-duration and its computed box-shadow once they stop moving.
 *  Runs in the page: 120 ms apart, up to 2.4 s, returning once two consecutive reads agree.
 *
 *  THE FLOOR OF SIX READS IS NOT PADDING. "Two consecutive reads agree" is trivially true in the first 120 ms
 *  after a hover, before the transition has moved anything — measured: index/.service-card and
 *  training/.service-card both returned `settled after 1 reads` carrying the REST box-shadow and dy 0, which
 *  reads as "the hover never applied" on a page where it applies perfectly. The floor is 720 ms, longer than the
 *  .45s transition, and the stability test then decides when to stop after that. */
const settle = async (e) => {
  const read = () => {
    const cs = getComputedStyle(e);
    return { top: e.getBoundingClientRect().top, dur: cs.transitionDuration, shadow: cs.boxShadow,
      inline: e.style.transform || '' };
  };
  let prev = read();
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 120));
    const now = read();
    const stable = Math.abs(now.top - prev.top) < 0.02 && now.shadow === prev.shadow;
    prev = now;
    if (stable && i >= 5) return { ...now, settled: i + 1 };
  }
  return { ...prev, settled: 0 };
};

async function cardHovers(page, classes) {
  const out = [];
  // The entrance motion moves the chapter's own box, so a card measured mid-reveal reports a dy that is the
  // chapter arriving rather than the card lifting. Everything is turned on first and given time to settle.
  await page.evaluate(() => {
    document.querySelectorAll('.reveal').forEach((e) => e.classList.add('active'));
    document.querySelectorAll('.fade-in').forEach((e) => e.classList.add('visible'));
    document.querySelectorAll('.agx-ch').forEach((e) => e.classList.add('agx-in'));
  });
  await page.waitForTimeout(900);
  for (const cls of classes) {
    const el = await page.$(`.agx-content .${cls}`);
    if (!el) { out.push({ cls, missing: true }); continue; }
    await page.mouse.move(4, 4);
    await page.waitForTimeout(220);
    await el.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(260);
    const rest = await el.evaluate(settle);
    await el.hover({ force: true }).catch(() => {});
    // SETTLED, NOT TIMED. A fixed wait after the hover measured training/.service-card at dy -5.11px with a
    // box-shadow 85.2% of the way from the rest value to the hover value — one consistent interpolation factor
    // across all four numbers, i.e. the test caught the .45s transition in flight and would have reported a
    // correct page as a delta. The value is read until it stops changing instead.
    const hov = await el.evaluate(settle);
    await page.mouse.move(4, 4);
    await page.waitForTimeout(200);
    out.push({ cls, dy: Math.round((hov.top - rest.top) * 100) / 100, dur: hov.dur, restDur: rest.dur,
      shadow: hov.shadow, gold: /rgba?\(\s*201,\s*168,\s*76/.test(hov.shadow), inline: hov.inline,
      settled: hov.settled });
  }
  return out;
}

/** Check 6: one drawn <svg class="agx-icon"> per declared swap, and no emoji left in an icon-class element. */
async function iconSwaps(page) {
  return page.evaluate(() => {
    const EM = /[\u{1F300}-\u{1FAFF}☀-➿⬀-⯿⌀-⏿]/u;
    const CL = ['feature-icon', 'audience-icon', 'hw-card-icon', 'success-icon', 'card-icon',
      'pillar-icon', 'scenario-icon', 'disc-icon', 'threat-icon', 'icon-item', 'blog-icon'];
    // #form-success is display:none until the form is submitted; shown for the measurement and put back.
    const fs = document.getElementById('form-success');
    const prev = fs ? fs.style.display : null;
    if (fs) fs.style.display = 'block';
    const svgs = [...document.querySelectorAll('.agx-content svg.agx-icon')];
    const drawn = svgs.filter((s) => s.getBoundingClientRect().width > 0).length;
    const left = [...document.querySelectorAll('.' + CL.join(', .'))]
      .filter((e) => EM.test(e.textContent || '')).length;
    if (fs) fs.style.display = prev;
    return { total: svgs.length, drawn, left };
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
  const dumped = JSON.parse(fs.readFileSync(unitsFile, 'utf8'));
  const liveUnits = dumped.units, iconCounts = dumped.icons, hoverClasses = dumped.hover;

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
  const STANDING_WIDTHS = [1800, 1440, 1280, 1025];
  const standing = Object.fromEntries(STANDING_WIDTHS.map((w) =>
    [w, { standing: 0, covered: 0, hudCovered: 0, hudStops: 0, hudShown: 0 }]));
  let iconTotal = 0, iconDrawn = 0, iconLeft = 0, iconBad = 0;
  let hoverRows = 0, hoverOK = 0, hoverBad = 0, hoverSample = '';
  const railSpends = [];
  let headMin = 1e9, headMax = -1e9;
  // Every HIDDEN_ON_LIVE spend, keyed by (slug, unit), so the summary shows exactly which page spent which key.
  const hiddenSpends = [];

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
          await markInvisible(page);
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
          const icons = await iconSwaps(page);
          const wantIcons = iconCounts[slug];
          iconTotal += icons.total; iconDrawn += icons.drawn; iconLeft += icons.left;
          if (icons.total !== wantIcons || icons.drawn !== wantIcons || icons.left !== 0) {
            iconBad++; bad++;
            console.log(`    ICON SWAPS on ${slug}: ${icons.total} svg / ${icons.drawn} drawn / ${icons.left} emoji left, `
              + `${wantIcons} declared by compare-atlas.py --units`);
          }
          // Check 8 — the hover a reader actually gets, per skinned card class on this page.
          for (const h of await cardHovers(page, hoverClasses[slug] || [])) {
            hoverRows++;
            if (h.missing) {
              bad++; hoverBad++;
              console.log(`    CARD CLASS DECLARED BUT NOT IN .agx-content on ${slug}: .${h.cls}`);
              continue;
            }
            const dyOK = Math.abs(h.dy + 6) <= 0.75;
            // EVERY component 0.45s, not "0.45s appears somewhere": the defect this check exists for shipped a
            // computed `transform 0.2s ease-out, box-shadow 0.3s ease`, and a substring test would pass a card
            // that lifts over .45s while its shadow still runs the script's 0.3s.
            const durOK = h.dur.split(',').every((d) => d.trim() === '0.45s');
            if (!dyOK || !durOK || h.gold || !h.settled) {
              bad++; hoverBad++;
              console.log(`    HOVER on ${slug} .${h.cls}: dy ${h.dy}px (want -6), transition-duration `
                + `${JSON.stringify(h.dur)} (want every component 0.45s), gold ${h.gold}, `
                + `settled after ${h.settled} reads (0 = never settled); box-shadow ${h.shadow}`
                + (h.inline ? `; inline transform ${JSON.stringify(h.inline)}` : ''));
            } else {
              hoverOK++;
              if (!hoverSample) hoverSample = `${slug} .${h.cls} dy ${h.dy}px, ${h.dur}, ${h.shadow}`;
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
        await markInvisible(page);
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
        // Check 7 — the STANDING label's cost, at the four widths the band was set from. No reload: the viewport is
        // resized on the page already loaded, which is what makes four extra widths affordable.
        for (const w of STANDING_WIDTHS) {
          await page.setViewportSize({ width: w, height: 1000 });
          await page.waitForTimeout(360);
          const st = await standingOverlap(page);
          standing[w].standing += st.standing;
          standing[w].covered += st.covered;
          standing[w].hudCovered += st.hudCovered;
          standing[w].hudStops += st.hudStops;
          standing[w].hudShown += st.hudShown;
          if (st.hudCovered) {
            bad++;
            console.log(`    THE HUD COVERS LIVE TEXT on ${slug} at ${w}: ${st.hudCovered} run(s) over the walk; `
              + `first ${JSON.stringify(st.hudFirst)}`);
          }
          if (st.covered) {
            const key = `${slug}@${w}`;
            if (Object.hasOwn(RAIL_OVERLAP_ON_MAIN, key)) {
              railSpends.push(key);
              console.log(`    rail overlap ON ORIGIN/MAIN TOO, allowed by name (${key}): ${st.covered} run(s); `
                + `${RAIL_OVERLAP_ON_MAIN[key]}`);
            } else {
              bad++;
              console.log(`    THE RAIL COVERS LIVE TEXT on ${slug} at ${w}: ${st.covered} run(s) over the walk, `
                + `${st.standing} standing label(s); first ${JSON.stringify(st.first)}`);
            }
          }
        }
        await ctx.close();
      }

      // Object.hasOwn, not `in`: `in` walks Object.prototype, so a live unit reading 'constructor' or 'toString' would
      // count as allowed-invisible (r5 verifier; 0 such units today, measured over all 2019 live units).
      const unseen = want.filter((u) => !seen.has(norm(u)) && !Object.hasOwn(HIDDEN_ON_LIVE, u));
      for (const u of want.filter((u) => !seen.has(norm(u)) && Object.hasOwn(HIDDEN_ON_LIVE, u))) hiddenSpends.push([slug, u]);
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

  const iconWant = pages.reduce((a, s) => a + iconCounts[s], 0);
  console.log(`\nSUMMARY  live text units ${sum.units} compared + ${iconWant} swapped to icons = ${sum.units + iconWant} accounted; `
    + `rendered ${sum.units - sum.unseen}, no box at either width ${sum.unseen}`);
  console.log(`         icon swaps ${iconDrawn}/${iconWant} drawn at 1440 (#form-success force-shown), ${iconLeft} emoji code points left inside an icon class, ${iconBad} page(s) with a delta`);
  console.log(`         rail links ${sum.labels + sum.ticks} a page-set, ${sum.labels} carrying a label and ${sum.ticks} label-less ticks; the chapter number and the label both come on hover as NN \u00b7 LABEL (measured: anything standing covers live copy \u2014 see check 7); hovered at 1440 and at 1800: clipped ${sum.clipped1440} at 1440, ${sum.clipped1800} at 1800`);
  console.log(`         live text runs the UNHOVERED rail covers, walked at 0.75 viewport steps: `
    + STANDING_WIDTHS.map((w) => `${w}px ${standing[w].covered} (${standing[w].standing} standing label(s))`).join(', '));
  console.log(`         card hovers driven at 1440: ${hoverRows} (one per skinned class per page), ${hoverOK} `
    + `measuring dy -6px +-0.75 and a 0.45s transition with no rgb(201,168,76) in the computed box-shadow, `
    + `${hoverBad} with a delta${hoverSample ? '; e.g. ' + hoverSample : ''}`);
  console.log(`         live text runs the HUD covers, the SAME walk pointed at .agx-hud-bl / .agx-hud-br: `
    + STANDING_WIDTHS.map((w) => `${w}px ${standing[w].hudCovered}`).join(', '));
  console.log(`         the HUD is painting (opacity >= 0.02, display not none) at `
    + STANDING_WIDTHS.map((w) => `${w}px ${standing[w].hudShown}/${standing[w].hudStops * 2} corner-stops`).join(', ')
    + ' — the lane gate takes a corner to opacity 0 for the stops where a line box is under it');
  const railUnspent = Object.keys(RAIL_OVERLAP_ON_MAIN).filter((k) => !railSpends.includes(k));
  console.log(`         of those, ${railSpends.length} allowed by name as present on origin/main too: ${railSpends.join(', ') || 'none'}`);
  if (railUnspent.length && !ONLY) console.log(`         RAIL_OVERLAP_ON_MAIN keys spent by no page this run (an allowance nothing uses): ${railUnspent.join(', ')}`);
  console.log(`         rail landings ${sum.landings} across 1440 and 1800: ${sum.landingsAt72} put the chapter box at 71.5-72.5px, ${sum.landingsFirst} are each page's FIRST link (document top), ${sum.headUnderBar} put a heading under the 60px bar`);
  console.log(`         of those, ${sum.landingsHead} land a chapter that carries a heading: ${headMin === 1e9 ? 'n/a' : Math.round(headMin * 10) / 10}px to ${headMax === -1e9 ? 'n/a' : Math.round(headMax * 10) / 10}px from the top`);
  console.log(`         rail labels whose hover state never settled, excluded from the clipped counts: ${sum.unmeasured}`);
  console.log(`         reveal walk at 0.5 viewport / 320 ms + 1400 ms settle: ${sum.stranded} of ${sum.chapters} blocks below opacity 0.99`);
  console.log(`         widest label at 1440: ${maxScroll}px ${JSON.stringify(maxScrollText)}; leftmost rail-link edge ${Math.round(minGap)}px; labels without text-overflow:ellipsis ${noEllipsis}`);
  console.log(`         live text boxes an OPEN hover label covers at 1440: ${overlap1440} over ${sum.labels} labels, worst single label ${maxOverlap}`);
  console.log(`         page errors ${sum.pageErrors}, failed same-origin requests ${sum.localFails}`);
  const spentKeys = new Set(hiddenSpends.map(([, u]) => u));
  console.log(`         HIDDEN_ON_LIVE spends ${hiddenSpends.length}, keyed (slug, unit):`);
  for (const [slug, u] of hiddenSpends) console.log(`           ${slug}: ${JSON.stringify(u.slice(0, 80))}`);
  const unspent = Object.keys(HIDDEN_ON_LIVE).filter((k) => !spentKeys.has(k));
  if (unspent.length) console.log(`         HIDDEN_ON_LIVE keys spent by no page this run (an excuse nothing uses): ${unspent.map((k) => JSON.stringify(k.slice(0, 60))).join(', ')}`);
  if (sum.unmeasured) bad++;
  if (sum.headUnderBar) bad++;
  // A clipped hover label is a severed word a reader meets; a label without ellipsis is a cut with no visual signal.
  // Both are counted above and both are deltas — the counts were printed and never asserted before r4 (2026-09-09).
  if (sum.clipped1440 || sum.clipped1800) bad++;
  if (noEllipsis) bad++;
  console.log(`         ${pages.length} page(s) x 1440x900 + 390x844 (+1800x1000 for the rail) = ${pages.length * 3} runs, ${bad ? bad + ' WITH A DELTA' : '0 with a delta'}`);
  return bad;
}

main().then((bad) => {
  process.exit(bad ? 1 : 0);
}).catch((e) => { console.error(e); process.exit(2); });
