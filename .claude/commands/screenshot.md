---
description: Render pages in headless Chromium and send desktop + mobile screenshots
argument-hint: [page.html — omit for key pages]
---

Screenshot: $ARGUMENTS (if empty: index.html, training.html, mastsolutions.html, ep-app.html).

1. Serve the repo root with `python3 -m http.server` on a free port (file:// blocks some embeds).
2. Use the pre-installed Chromium via Playwright (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`; launch with `executablePath: '/opt/pw-browsers/chromium'` if the API version mismatches). Do NOT run `playwright install`.
3. Capture each page at 1440×900 (desktop) and 390×844 (mobile), full-page, after waiting for network idle + a scroll pass so `.reveal` animations trigger.
4. Save PNGs to the scratchpad directory and send them to the user with SendUserFile, one caption per page noting anything that looks broken (missing images, layout overflow, unstyled sections).
5. Kill the server when done.
