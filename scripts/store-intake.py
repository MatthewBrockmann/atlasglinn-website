#!/usr/bin/env python3
"""Store intake: IWA's own product pages become the copy of OUR product view (owner, 2026-09-09: "What we want is the
actual marketing and verbiage so that you can click on it and see"; and 2026-09-08: "the link to IWA sends them to their
store. We need them to buy from our store, not theirs").

IWA's pages are a CONTENT SOURCE, never a destination. This reads the captures on the handoff branch
(reference/desktop/live/<slug>.html, fetched by scripts/handoff-urls.txt), parses each product page and writes
scripts/store-products.json: the manufacturer's title, their description prose, the spec lines they publish, and their
photographs. Price and stock are NOT taken from IWA — the page carries our list price (GEAR_PRICE_TABLE) and our stock
constant (gearOut). scripts/assemble-cinematic.py splices this JSON into the page as a build-time constant.

  python3 scripts/store-intake.py             # write scripts/store-products.json
  python3 scripts/store-intake.py --dry-run   # report only, write nothing
  HANDOFF_REF=some-branch python3 …           # read another ref (tests)

Deterministic: the same captures produce the same JSON byte for byte, so a re-run is a no-op and the diff is the
capture's diff. A product with no capture yet is listed and left out — its card still opens, showing our name, our
price, our stock and the email control (assemble-cinematic.py falls back), because inventing IWA's copy is worse than
not having it."""
import html as _html
import json, os, re, subprocess, sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REF = os.environ.get('HANDOFF_REF', 'origin/claude/desktop-assets')
CAPTURES = 'reference/desktop/live'
OUT = os.path.join(REPO, 'scripts', 'store-products.json')
STORE_IMAGES = os.path.join(REPO, 'images', 'mast', 'store')
MAX_IMAGES = 4
# IWA's own order/shipping policy block repeats on every product page and describes checkout on THEIR site ("will not be
# authorized on the Site"). Our page is not their checkout, so the prose stops here; the hazmat terms that do apply to a
# MAST order are already in the Store chapter's own line.
POLICY_MARK = 'ORDER &amp; SHIPMENT POLICIES'
KEEP_TAGS = {'p', 'ul', 'ol', 'li', 'strong', 'b', 'em', 'i', 'br'}
SPEC_LINE = re.compile(r'^([A-Z][A-Za-z0-9 ()/.\']{1,44}?)\s*-\s*(.+)$')
IMG_URL = r'https://cdn11\.bigcommerce\.com/[^\s"\']+?1280x1280/[^\s"\']+?\.(?:jpg|jpeg|png)(?:\?c=\d+)?'


def git(*args):
    r = subprocess.run(['git', *args], cwd=REPO, capture_output=True)
    if r.returncode:
        return None
    return r.stdout


def source_map():
    """SKU -> IWA product URL, read from GEAR_PRODUCT_URL in mastsolutions-tesla.html so there is one source list."""
    src = open(os.path.join(REPO, 'mastsolutions-tesla.html'), encoding='utf-8').read()
    blk = src[src.index('const GEAR_PRODUCT_URL = {'):]
    blk = blk[:blk.index('};') + 2]
    return dict(re.findall(r"'([A-Z0-9-]+)':\s*'(https://[^']+)'", blk))


def slug_of(url):
    """The capture file name mac-handoff.sh / capture-live.yml write for a page URL (path, slashes to dashes)."""
    p = url.split('://', 1)[-1].split('/', 1)[-1].split('?')[0].rstrip('/')
    return (p.replace('/', '-') or 'index')


def capture(slug):
    b = git('show', f'{REF}:{CAPTURES}/{slug}.html')
    return b.decode('utf-8', 'replace') if b else None


def strip_tags(s):
    return _html.unescape(re.sub(r'<[^>]+>', '', s)).replace('\xa0', ' ').strip()


def sanitize(frag):
    """IWA's description, verbatim words, with everything but p/ul/ol/li/strong/em/br unwrapped and every attribute
    dropped (their inline colours and font sizes would fight this page's stylesheet)."""
    def tag(m):
        closing, name = m.group(1), m.group(2).lower()
        if name not in KEEP_TAGS:
            return ''
        return f'</{name}>' if closing else (f'<{name}>' if name != 'br' else '<br>')
    out = re.sub(r'<(/?)([a-zA-Z0-9]+)[^>]*>', tag, frag)
    out = re.sub(r'\s+', ' ', out).replace('&nbsp;', ' ')
    out = re.sub(r'<p>\s*(<br>\s*)*</p>', '', out)
    return out.strip()


def balanced(frag, pos, tag):
    """The inner HTML of the element whose open tag ends at pos, and the index past its close tag."""
    op = re.compile(r'<%s\b[^>]*>' % tag, re.I)
    cl = re.compile(r'</%s\s*>' % tag, re.I)
    depth, i, close_start = 1, pos, len(frag)
    while depth:
        o, c = op.search(frag, i), cl.search(frag, i)
        if not c:
            return frag[pos:], len(frag)
        if o and o.start() < c.start():
            depth += 1
            i = o.end()
        else:
            depth -= 1
            close_start, i = c.start(), c.end()
    return frag[pos:close_start], i


BLOCK = re.compile(r'<(p|div|ul|ol)\b[^>]*>', re.I)


def blocks(frag):
    """IWA's copy as leaf blocks in source order. Their pages mix <p> and bare <div> for the same kind of line (the M15
    page keeps three paragraphs and every spec line inside nested divs), so both count; lists are kept whole."""
    out, i = [], 0
    while True:
        m = BLOCK.search(frag, i)
        if not m:
            return out
        tag = m.group(1).lower()
        inner, end = balanced(frag, m.end(), tag)
        if tag in ('ul', 'ol'):
            out.append(('list', frag[m.start():end]))
        elif BLOCK.search(inner):
            out.extend(blocks(inner))
        else:
            out.append(('p', inner))
        i = end


def parse(page, url):
    title = re.search(r'<meta property="og:title" content="([^"]*)"', page)
    m = re.search(r'<div class="tab-content is-active" id="tab-description"[^>]*>', page)
    if not m:
        return None
    frag = balanced(page, m.end(), 'div')[0]
    cut = frag.find(POLICY_MARK)
    policies_omitted = cut != -1
    if policies_omitted:
        frag = frag[:cut]
    prose, specs = [], []
    for kind, inner in blocks(frag):
        h = sanitize(('<p>' + inner + '</p>') if kind == 'p' else inner)
        t = strip_tags(inner)
        if not t:
            continue
        sm = SPEC_LINE.match(t)
        if sm and kind == 'p' and len(t) < 200:
            specs.append([sm.group(1).strip(), sm.group(2).strip()])
        elif h:
            prose.append(h)
    gal = page[page.find('productView-images'):]
    gal = gal[:gal.find('</section>')]
    urls = list(dict.fromkeys(re.findall(IMG_URL, gal)))
    return {
        'name': _html.unescape(title.group(1)) if title else '',
        'source': url,
        'capture': f'{CAPTURES}/{slug_of(url)}.html',
        'html': ''.join(prose),
        'specs': specs,
        'images': urls[:MAX_IMAGES],
        'policies_omitted': policies_omitted,
    }


def localise(sku, urls, dry):
    """A photograph the Mac has already fetched (scripts/handoff-urls.txt lists them) is served from images/mast/store/;
    until then the card shows IWA's CDN URL. Same JSON either way, so the page does not change shape when they land."""
    out, notes = [], []
    os.makedirs(STORE_IMAGES, exist_ok=True)
    for i, u in enumerate(urls, 1):
        base = u.split('?')[0].rsplit('/', 1)[-1]
        local = f'{sku.lower()}-{i}' + os.path.splitext(base)[1].lower()
        rel = f'images/mast/store/{local}'
        if os.path.exists(os.path.join(REPO, rel)):
            out.append(rel); continue
        blob = git('show', f'{REF}:{CAPTURES}/{base}')
        if blob:
            if not dry:
                open(os.path.join(STORE_IMAGES, local), 'wb').write(blob)
            out.append(rel); notes.append(f'{sku}: imported {base} -> {rel}')
        else:
            out.append(u); notes.append(f'{sku}: no captured file for {base}; the view uses IWA\'s CDN URL')
    return out, notes


def main(dry):
    products, missing, notes = {}, [], []
    for sku, url in sorted(source_map().items()):
        page = capture(slug_of(url))
        if not page:
            missing.append((sku, url)); continue
        p = parse(page, url)
        if not p or not p['html']:
            missing.append((sku, url)); continue
        p['images'], n = localise(sku, p['images'], dry)
        notes += n
        products[sku] = p
    payload = {'_source': 'IWA International product pages, captured on ' + REF + ' (content source only; no outbound link)',
               'products': products}
    text = json.dumps(payload, indent=1, sort_keys=True, ensure_ascii=False) + '\n'
    if not dry:
        open(OUT, 'w', encoding='utf-8').write(text)
    for sku, p in products.items():
        print(f'{sku}: {p["name"]} — {len(p["html"])} chars of copy, {len(p["specs"])} spec lines, {len(p["images"])} image(s)')
    for sku, url in missing:
        print(f'no capture yet: {sku} ({url}) — its card opens with our name, price, stock and the email control')
    for n in notes:
        print('note:', n)
    print(('would write ' if dry else 'wrote ') + OUT, len(text), 'bytes,', len(products), 'products')
    return 0


if __name__ == '__main__':
    sys.exit(main('--dry-run' in sys.argv[1:]))
