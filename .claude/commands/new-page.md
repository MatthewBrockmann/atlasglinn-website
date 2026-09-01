---
description: Scaffold a new site page in the Atlas Glinn brand system
argument-hint: <page-name> <one-line purpose>
---

Create a new page for this site: $ARGUMENTS

Requirements:
1. Read `training.html` and `executive-protection.html` first — the new page must reuse their exact conventions: fixed nav + mobile nav overlay, `.section-divider` headers with `.gold-shimmer` accent words, `.service-card`/`.discipline-card` grids, `.reveal` scroll animations, universal 3D tilt script, and the shared footer (awards badges, four footer columns, social links, copyright).
2. Brand system: background `#080C14`, blue `#1A6BDE`, gold `#C9A84C`, fonts Orbitron (headings) / Rajdhani (body) / Inconsolata (mono). Single self-contained HTML file with inline `<style>` and `<script>`, matching the existing pages.
3. Full SEO head: title, meta description, keywords, canonical (`https://www.atlasglinn.com/...`), og: tags, robots, author.
4. Use only image assets that exist in `images/` and are real files (not Git LFS pointers — check with `ls -la`; pointers are ~130 bytes). Videos must be YouTube embeds, never local `.mp4` (LFS pointers don't serve on GitHub Pages).
5. Add the page to the nav and footer of ALL existing pages only if the user asks; otherwise link it from the most relevant existing page and say where.
6. Verify by rendering with the pre-installed Chromium/Playwright and screenshotting desktop (1440px) and mobile (390px) widths.
