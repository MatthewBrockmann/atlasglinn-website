---
description: Propagate a nav or footer change across every page consistently
argument-hint: <describe the change, e.g. "add mastsolutions.html to nav as MAST Solutions">
---

Apply this shared-chrome change across the whole site: $ARGUMENTS

This site is static HTML with the nav and footer duplicated in every page — a change to either must be applied to ALL `*.html` files in the repo root, identically.

1. First read the nav (`<nav id="main-nav">` + `#mobile-nav` overlay) and footer (`<footer>`) in `training.html` as the reference markup.
2. Apply the requested change to the reference markup.
3. Propagate to every page: desktop nav links, mobile nav overlay links, footer columns (Atlas Glinn / MAST Solutions / Company / Connect), and social links. Watch for per-page drift — some pages may have slightly different attribute ordering or inline styles; preserve each page's indentation but make the link set identical.
4. Verify with a grep that every page now contains the change and that no page was missed, then list the files touched.
