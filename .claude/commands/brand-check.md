---
description: Verify a page (or all pages) matches the Atlas Glinn brand system
argument-hint: [page.html — omit for all pages]
---

Check brand consistency for: $ARGUMENTS (if empty, all `*.html` pages).

The Atlas Glinn / MAST Solutions brand system:
- **Colors** — background `#080C14`, panel `#0f1622`, blue `#1A6BDE` (hover `#155ac8`), gold `#C9A84C`, gold shimmer gradient `#BF953F → #FCF6BA → #B38728 → #FBF5B7 → #AA771C`, body text `#d0d0d0`/`#b0b0b0`
- **Fonts** — Orbitron (headings, nav, labels), Rajdhani (body), Inconsolata (mono/technical)
- **Signature patterns** — `.gold-shimmer` animated accent words in headings, `.section-divider` band between sections, `.service-card`/`.discipline-card` with gold borders `rgba(201,168,76,.3)` and hover lift, `.reveal` IntersectionObserver fade-ins, universal 3D tilt on cards, fixed nav with blur + mobile overlay nav
- **Voice** — confident, operational, no fluff; uppercase Orbitron labels with letter-spacing

Flag on each page: off-palette hex values, wrong font stacks, missing shared patterns, nav/footer markup drifting from the other pages, and inconsistent copyright/socials. Report as file:line findings with the expected value, then offer to fix.
