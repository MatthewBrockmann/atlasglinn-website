---
description: Verify every link and asset reference across the site
argument-hint: [page.html — omit for all pages]
---

Check every link and asset in: $ARGUMENTS (if empty, all `*.html` files in the repo root).

1. **Internal links** — every `href` to a local `.html` file must point at a file that exists in the repo. Flag links to `index.html` vs `atlasglinn-final.html` inconsistencies.
2. **Fragment anchors** — `href="#id"` and `page.html#id` targets must exist.
3. **Local assets** — every `src`/`poster`/`background` image or video path must exist. Critically: flag any referenced file that is a Git LFS pointer (~130 bytes, starts with `version https://git-lfs`) — GitHub Pages serves the pointer text, not the media, so these are broken in production.
4. **External URLs** — check they are well-formed HTTPS; spot-check reachability of key ones (social profiles, atlasglinn.com uploads, YouTube embeds) with WebFetch or curl where network allows.
5. **mailto:/tel:** — syntactically valid and consistent across pages ((281) 654-8100, atlasglinn.hq@atlasglinn.com).

Output a table: file, line, link, problem, suggested fix. Then offer to fix.
