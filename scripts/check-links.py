#!/usr/bin/env python3
"""Every local reference on the generated pages has to resolve to a file on disk, and every local #anchor to an id.

Brockmann's pages are assembled, not hand-written, so a renamed image or a retired section id breaks silently on
twelve pages at once. This walks src=, href=, poster= and url(...) on each page, skips what leaves the site (http,
mailto:, tel:, data:), resolves the rest against the repo root, and checks the fragment against the target page's ids.

  python3 scripts/check-links.py              the twelve Atlas pages + mastsolutions.html
  python3 scripts/check-links.py a.html b.html  named pages
Exit 0 when nothing is dead; exit 1 and a list when something is.
"""
import os, re, sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGES = ['index.html', 'executive-protection.html', 'residential-protection.html', 'disaster-recovery.html',
         'training.html', 'technology.html', 'cuas-aerodefense.html', 'uas.html', 'about.html', 'careers.html',
         'contact.html', 'ep-app.html', 'mastsolutions.html']
REF = re.compile(r'''(?:src|href|poster)=["']([^"']+)["']|url\((['"]?)([^)'"]+)\2\)''')
ID = re.compile(r'''\bid=["']([^"']+)["']''')
EXTERNAL = ('http://', 'https://', '//', 'mailto:', 'tel:', 'data:', 'javascript:')
ROOT = 'index.html'   # a bare "/" is the site root, which this host serves from index.html
_ids = {}


def ids(page):
    if page not in _ids:
        path = os.path.join(REPO, page)
        _ids[page] = set(ID.findall(open(path, encoding='utf-8').read())) if os.path.isfile(path) else None
    return _ids[page]


def check(page):
    """Return (refs checked, [(reference, why it is dead)])."""
    html = open(os.path.join(REPO, page), encoding='utf-8').read()
    seen, dead = set(), []
    for m in REF.finditer(html):
        ref = m.group(1) or m.group(3)
        # `${...}` is a reference the page's own script builds at run time (the MAST catalog templates); there is no
        # file to look for, and reporting one would be crying wolf.
        if not ref or ref.startswith(EXTERNAL) or '${' in ref or ref in seen:
            continue
        if ref == '/':
            ref = ROOT
        seen.add(ref)
        target, _, frag = ref.partition('#')
        target = target.split('?')[0]
        if not target:                                          # a same-page anchor
            if frag and frag not in ids(page):
                dead.append((ref, 'no id="%s" on this page' % frag))
            continue
        rel = target.lstrip('./')
        if not os.path.isfile(os.path.join(REPO, rel)):
            dead.append((ref, 'no such file'))
        elif frag and rel.endswith('.html') and ids(rel) is not None and frag not in ids(rel):
            dead.append((ref, 'no id="%s" in %s' % (frag, rel)))
    return len(seen), dead


def main(pages):
    total, broken = 0, 0
    for page in pages:
        if not os.path.isfile(os.path.join(REPO, page)):
            print('MISSING PAGE %s' % page); broken += 1; continue
        n, dead = check(page)
        total += n; broken += len(dead)
        print('%-30s %3d refs  %s' % (page, n, 'OK' if not dead else '%d DEAD' % len(dead)))
        for ref, why in dead:
            print('    DEAD  %s  (%s)' % (ref, why))
    print('\n%d local references checked across %d pages, %d dead' % (total, len(pages), broken))
    return 1 if broken else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:] or PAGES))
