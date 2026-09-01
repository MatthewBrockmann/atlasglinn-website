---
description: Pre-deploy validation for GitHub Pages (CNAME, LFS, links, meta)
---

Run the full pre-deploy checklist for this GitHub Pages site:

1. **CNAME** — file exists at repo root and contains exactly `atlasglinn.com`.
2. **Git LFS hazard** — list every file in `images/` that is an LFS pointer (~130 bytes starting `version https://git-lfs`). GitHub Pages does NOT serve LFS content — any page referencing these files ships broken media. Cross-reference against every `src`/`poster` in the HTML and report which pages are affected.
3. **Entry point** — `index.html` exists; check whether nav "Home" links point to `index.html` or `atlasglinn-final.html` and flag inconsistency.
4. **Links** — run the checks from /link-check across all pages.
5. **Case sensitivity** — GitHub Pages is case-sensitive: verify every local `href`/`src` matches the actual filename case exactly.
6. **Mixed content** — no `http://` asset URLs.
7. **404 fallback** — note whether a `404.html` exists.

Report as a go/no-go summary with blocking issues first, then offer to fix the blockers.
