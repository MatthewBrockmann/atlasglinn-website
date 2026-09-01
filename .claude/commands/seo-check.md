---
description: SEO and metadata review for a page (or the whole site)
argument-hint: [page.html — omit for all pages]
---

Run an SEO review of: $ARGUMENTS (if empty, all `*.html` pages in the repo root).

Check each page for:
- `<title>` present, unique across the site, under ~60 chars, keyword-bearing
- Meta description present, unique, 120–160 chars
- Canonical URL pointing at `https://www.atlasglinn.com/...` and consistent with the filename
- Open Graph tags (og:title, og:description, og:image, og:type) present and accurate
- `meta name="robots"` is `index, follow` (unless the page should be excluded — privacy/terms may differ)
- Exactly one `<h1>`; logical h2/h3 hierarchy
- Image `alt` attributes present and descriptive
- Keywords match the page's actual content (no stuffing, no drift)
- Structured data (schema.org JSON-LD) — flag pages that would benefit (LocalBusiness for contact, Service for service pages, Course for training)
- Internal linking — orphan pages (nothing links to them) and dead anchors

Report findings as a table per page with severity, then offer to apply fixes.
