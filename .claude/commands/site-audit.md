---
description: Full multi-agent audit of every page — links, SEO, brand, accessibility
argument-hint: [optional focus, e.g. "seo" or "links"]
---

Run a comprehensive audit of this static site using the Workflow tool (multi-agent orchestration is explicitly requested).

Scope: every `*.html` file in the repo root. Focus override from user: "$ARGUMENTS" (if empty, audit all dimensions).

Orchestrate one workflow with these dimensions, fanned out per page, then adversarially verify each finding before reporting:

1. **Links & assets** — every `href`/`src` resolves: internal files exist, anchors exist, images exist and are NOT Git LFS pointers (files ~130 bytes starting with `version https://git-lfs`), external URLs are well-formed.
2. **SEO** — title, meta description, canonical, og: tags, robots, keyword consistency, exactly one `<h1>` per page, schema.org markup where present.
3. **Brand consistency** — colors must come from the Atlas Glinn system (bg `#080C14`, blue `#1A6BDE`, gold `#C9A84C`, gold shimmer gradient `#BF953F→#FCF6BA→#B38728→#FBF5B7→#AA771C`), fonts Orbitron/Rajdhani/Inconsolata, shared nav + footer markup matches across pages.
4. **Accessibility** — img alt text, iframe titles, contrast on body text, focus/keyboard for mobile nav, form labels.
5. **Cross-page drift** — nav links, footer links, social URLs, phone/email/address must be identical on every page.

After verification, report confirmed findings grouped by severity with `file:line` references, and offer to fix them.
