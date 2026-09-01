---
description: Add a client testimonial to a page in the site's testimonial card style
argument-hint: <quote> — <name, title> [category label] [target page]
---

Add this testimonial to the site: $ARGUMENTS

1. If no target page is given, default to the reviews section of `training.html` (and mirror to `mastsolutions.html` if it exists).
2. Use the existing `.testimonial` card markup: category label in uppercase blue (`#1A6BDE`), italic quote in `rgba(255,255,255,0.7)`, attribution line in gold (`#C9A84C`) bold.
3. Keep the quote verbatim — do not rewrite the client's words. If it is too long for a card (over ~40 words), ask the user which excerpt to use rather than trimming silently.
4. Preserve the grid layout (the reviews grid is `repeat(3,1fr)` on desktop) — if adding the card makes an uneven row, note it and show how it renders.
5. Verify the page still renders by screenshotting the reviews section.
