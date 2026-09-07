#!/usr/bin/env python3
"""Per-page build stamps and the manifest the live pages check themselves against.

Why (Brockmann, 2026-09-07, from his phone: "Can't find flush in app"): atlasglinn.com sits behind GoDaddy's CDN, which
caches the static pages for 31 days at their plain URL, so every upload stayed invisible until he pressed Flush Cache in
the GoDaddy dashboard — a button his phone app does not have. Instead of depending on that button, every generated page
carries its own content hash (`<meta name="build" content="…">`) and, on load, fetches `build-manifest.json` with a
one-off query string (never cached) that lists the hash of every page as uploaded. If the page's hash is not the one
the host has, the page reloads itself once at `?v=<current hash>` — a URL the CDN has not seen, so the origin serves the
fresh copy. A page that is current does nothing. A visitor is never more than one reload behind an upload, and nobody
flushes anything.

    python3 scripts/build_manifest.py            # stamp every generated page on disk and rewrite build-manifest.json
    from build_manifest import stamp_and_write   # what the assemblers call after writing a page

The hash is taken over the page with the meta's content blanked, so stamping is idempotent and the manifest matches
what the assemblers wrote. `scripts/wp-upload.sh` and `deploy-page.yml` put `build-manifest.json` on the host last, after
every page and asset, so a visitor is only ever redirected to a page that is fully there.
"""
import hashlib
import json
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = 'build-manifest.json'
# The generated pages (assemble-cinematic.py writes the first; assemble-atlas.py --publish writes the rest). Hand-authored
# pages (privacy, terms, signup, the capability statement) carry no stamp and are left alone.
GENERATED = ['mastsolutions.html', 'index.html', 'executive-protection.html', 'residential-protection.html',
             'disaster-recovery.html', 'training.html', 'technology.html', 'cuas-aerodefense.html', 'uas.html',
             'about.html', 'careers.html', 'contact.html', 'ep-app.html']
PLACEHOLDER = '<meta name="build" content="">'
META_RE = re.compile(r'<meta name="build" content="[0-9a-f]*">')


def digest(html):
    """Twelve hex chars of SHA-1 over the page with the build meta blanked."""
    return hashlib.sha1(META_RE.sub(PLACEHOLDER, html).encode('utf-8')).hexdigest()[:12]


def stamp(path):
    """Write the page's own hash into its build meta; returns the hash (None when the page carries no meta)."""
    html = open(path, encoding='utf-8').read()
    if not META_RE.search(html):
        return None
    h = digest(html)
    open(path, 'w', encoding='utf-8').write(META_RE.sub('<meta name="build" content="%s">' % h, html, 1))
    return h


def write_manifest():
    """build-manifest.json: {page file name: hash} for every generated page present on disk."""
    manifest = {}
    for name in GENERATED:
        p = os.path.join(REPO, name)
        if os.path.exists(p):
            html = open(p, encoding='utf-8').read()
            if META_RE.search(html):
                manifest[name] = digest(html)
    open(os.path.join(REPO, MANIFEST), 'w', encoding='utf-8').write(json.dumps(manifest, indent=0, sort_keys=True) + '\n')
    return manifest


def stamp_and_write(paths):
    """Stamp the pages just written, then rewrite the manifest for the whole set."""
    for p in paths:
        stamp(p)
    return write_manifest()


if __name__ == '__main__':
    stamped = [(n, stamp(os.path.join(REPO, n))) for n in GENERATED if os.path.exists(os.path.join(REPO, n))]
    m = write_manifest()
    for n, h in stamped:
        print('%-28s %s' % (n, h or '(no build meta)'))
    print('wrote %s with %d pages' % (MANIFEST, len(m)))
    sys.exit(0)
