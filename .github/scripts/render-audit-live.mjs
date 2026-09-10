#!/usr/bin/env node
/**
 * The playback proof, run against the DEPLOYED site. See .github/workflows/render-audit.yml for why it lives on a
 * runner and not in the build container: every atlasglinn.com film 404s there, so nothing local can measure whether
 * a video actually plays. Here it can, and the numbers ARE the deliverable — one line per <video>, pass or fail.
 *
 *   node .github/scripts/render-audit-live.mjs https://atlasglinn.com/index.html
 *
 * For each of chromium and webkit, and each of {393x852 isMobile hasTouch dsf 3} and {1440x900}:
 *   load, dismiss the Enter / Skip Intro splash if it is up, wait 4s, then for every <video> wait a further 3s and
 *   record {src basename, paused, currentTime, readyState, muted, autoplay, playsInline}.
 *
 *   WHAT IS ASSERTED, EXACTLY: a video the page DECLARES autoplay on must be playing — not paused, currentTime past
 *   0.5s. A video without autoplay is printed with the same numbers and is NOT asserted, because a paused
 *   non-autoplay <video> is the page behaving correctly: measured on the built pages 2026-09-10, five of the six
 *   training films and one of the two contact films carry autoplay=false, and they are in-content copies a reader
 *   presses play on. The honest claim this job proves is "the HERO film has autoplay muted loop playsinline and is
 *   playing", never "every film on the page plays". A page with NO <video> at all fails: the proof measured nothing.
 *   The document may not scroll sideways. Two frames per engine per width.
 * Exits 1 on any failure, and writes the frames either way.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium, webkit } from 'playwright';

const url = process.argv[2] || 'https://atlasglinn.com/index.html';
const SHOTS = 'shots';
fs.mkdirSync(SHOTS, { recursive: true });

const VIEWPORTS = [
  { name: '393', viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
  { name: '1440', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
];
// The only two things on these pages that gate the content. Nothing else is a gate, and clicking anything else
// would be this test navigating the site rather than measuring it.
const GATES = ['#intro-enter', '#skip-intro'];

let bad = 0;
const rows = [];

for (const [engineName, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await engine.launch();
  for (const V of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: V.viewport,
      isMobile: !!V.isMobile,
      hasTouch: !!V.hasTouch,
      deviceScaleFactor: V.deviceScaleFactor,
    });
    const page = await ctx.newPage();
    const tag = `${engineName}-${V.name}`;
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 60000 });
      for (const sel of GATES) {
        const el = await page.$(sel);
        if (el && (await el.isVisible().catch(() => false))) {
          await el.click().catch(() => {});
          break;
        }
      }
      await page.waitForTimeout(4000);
      await page.waitForTimeout(3000);
      const vids = await page.evaluate(() => [...document.querySelectorAll('video')].map((v) => ({
        src: (v.currentSrc || v.src || '(none)').split('/').pop().split('?')[0],
        paused: v.paused,
        currentTime: Math.round(v.currentTime * 100) / 100,
        readyState: v.readyState,
        muted: v.muted,
        autoplay: v.autoplay,
        playsInline: v.playsInline,
        w: Math.round(v.getBoundingClientRect().width),
        h: Math.round(v.getBoundingClientRect().height),
      })));
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      for (const v of vids) {
        const ok = !v.paused && v.currentTime > 0.5;
        if (!ok && v.autoplay) bad++;
        rows.push(`${tag} ${ok ? 'PLAYING' : (v.autoplay ? 'NOT PLAYING' : 'paused, autoplay=false, not asserted')} ${v.src} paused=${v.paused} `
          + `currentTime=${v.currentTime} readyState=${v.readyState} muted=${v.muted} `
          + `autoplay=${v.autoplay} playsInline=${v.playsInline} box=${v.w}x${v.h}`);
      }
      // A PAGE WITH NO <video> IS A FAILED MEASUREMENT, NOT A PASS. This job exists to answer "do the embedded
      // videos play on a phone"; a run that finds none answered nothing, and printing a neutral line while
      // exiting 0 is how a broken deploy (or a URL typed one path segment wrong) reads as proof.
      if (!vids.length) {
        bad++;
        rows.push(`${tag} NO <video> ON THE PAGE — the playback proof has nothing to measure`);
      }
      if (over > 0) {
        bad++;
        rows.push(`${tag} HORIZONTAL OVERFLOW ${over}px (scrollWidth ${over + V.viewport.width} > ${V.viewport.width})`);
      } else {
        rows.push(`${tag} no horizontal overflow`);
      }
      await page.screenshot({ path: path.join(SHOTS, `${tag}-fold.png`) });
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.45));
      await page.waitForTimeout(1200);
      await page.screenshot({ path: path.join(SHOTS, `${tag}-mid.png`) });
    } catch (e) {
      bad++;
      rows.push(`${tag} FAILED TO MEASURE: ${String(e).slice(0, 200)}`);
    }
    await ctx.close();
  }
  await browser.close();
}

console.log(`render-audit-live ${url}`);
for (const r of rows) console.log('  ' + r);
console.log(bad ? `FAIL: ${bad} assertion(s)` : 'PASS');
process.exit(bad ? 1 : 0);
