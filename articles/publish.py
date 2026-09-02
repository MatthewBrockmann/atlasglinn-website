#!/usr/bin/env python3
"""
MAST Solutions article publisher.

Reads articles/manifest.json and makes the site agree with it:

  * each article page  -> <meta name="robots"> is "noindex, nofollow" for drafts,
                          "index, follow" when published; a DRAFT banner is added
                          to drafts and removed on publish; JSON-LD datePublished
                          is set to published_on when publishing.
  * articles/index.html -> the hub lists published articles only (noindex while
                          nothing is published).
  * sitemap.xml         -> every /articles/ entry is rewritten from the manifest;
                          drafts never appear.

Usage (from the repo root):
    python3 articles/publish.py            # apply the manifest
    python3 articles/publish.py --check    # report only, change nothing

To publish an article: set "status": "published" and "published_on": "YYYY-MM-DD"
in manifest.json, run this script, commit, push.
"""
import json, re, sys, os, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART = os.path.join(ROOT, 'articles')
SITEMAP = os.path.join(ROOT, 'sitemap.xml')
CHECK = '--check' in sys.argv

BANNER = ('<div class="draft-banner" style="position:fixed;bottom:0;left:0;right:0;z-index:5000;'
          'background:#C9A84C;color:#080C14;font:700 12px/1.4 Rajdhani,sans-serif;letter-spacing:.14em;'
          'text-transform:uppercase;text-align:center;padding:6px 12px;">'
          'Draft &middot; not published &middot; not indexed &middot; for review only</div>\n')

def read(p):  return open(p, encoding='utf-8').read()
def write(p, s):
    if CHECK: return
    open(p, 'w', encoding='utf-8').write(s)

def set_robots(html, published):
    val = 'index, follow' if published else 'noindex, nofollow'
    return re.sub(r'<meta name="robots" content="[^"]*">', f'<meta name="robots" content="{val}">', html, count=1)

def set_banner(html, published):
    html = html.replace(BANNER, '')
    html = re.sub(r'<div class="draft-banner".*?</div>\n?', '', html, count=1, flags=re.S)
    if not published:
        html = html.replace('<body>\n', '<body>\n' + BANNER, 1)
    return html

def set_date(html, published_on):
    if not published_on: return html
    return re.sub(r'"datePublished":\s*"[^"]*"', f'"datePublished": "{published_on}"', html)

def card(a):
    return (f'        <a class="hub-card reveal" href="{a["file"]}">\n'
            f'            <span class="readtime">{a["read"]}</span>\n'
            f'            <h2>{a["title"]}</h2>\n'
            f'            <p>{a["description"]}</p>\n'
            f'        </a>\n')

def rebuild_hub(published):
    p = os.path.join(ART, 'index.html'); html = read(p)
    if published:
        grid = '    <div class="hub-grid">\n' + ''.join(card(a) for a in published) + '    </div>'
        byline = f'{len(published)} article{"s" if len(published) != 1 else ""} &middot; Houston, Texas'
    else:
        grid = ('    <div class="hub-grid">\n        <div class="hub-card" style="grid-column:1/-1;text-align:center;">'
                '<h2>Articles are on the way.</h2><p>Course notes and methodology from the range are being prepared. '
                'Check back soon, or <a href="../mastsolutions.html#courses" style="color:#1A6BDE;text-decoration:none;">pick a course</a> in the meantime.</p></div>\n    </div>')
        byline = 'Houston, Texas'
    html = re.sub(r'    <div class="hub-grid">.*?\n    </div>', grid, html, count=1, flags=re.S)
    html = re.sub(r'<div class="byline">[^<]*</div>', f'<div class="byline">{byline}</div>', html, count=1)
    html = set_robots(html, bool(published))
    write(p, html)

def rebuild_sitemap(published):
    s = read(SITEMAP)
    s = re.sub(r'\s*<url>\s*<loc>https://atlasglinn\.com/articles/[^<]*</loc>.*?</url>', '', s, flags=re.S)
    entries = ''
    if published:
        newest = max(a['published_on'] or '' for a in published) or datetime.date.today().isoformat()
        entries += (f'\n  <url>\n    <loc>https://atlasglinn.com/articles/</loc>\n    <lastmod>{newest}</lastmod>\n'
                    f'    <changefreq>weekly</changefreq>\n    <priority>0.6</priority>\n  </url>')
        for a in published:
            entries += (f'\n  <url>\n    <loc>https://atlasglinn.com/articles/{a["file"]}</loc>\n'
                        f'    <lastmod>{a["published_on"] or newest}</lastmod>\n'
                        f'    <changefreq>monthly</changefreq>\n    <priority>0.5</priority>\n  </url>')
    s = s.replace('\n</urlset>', entries + '\n</urlset>', 1)
    write(SITEMAP, s)

def main():
    m = json.load(open(os.path.join(ART, 'manifest.json'), encoding='utf-8'))
    rows = []
    for a in m['articles']:
        p = os.path.join(ART, a['file'])
        if not os.path.exists(p):
            rows.append((a['file'], a['status'], 'MISSING FILE')); continue
        pub = a['status'] == 'published'
        if pub and not a.get('published_on'):
            a['published_on'] = datetime.date.today().isoformat()
        html = read(p)
        html = set_robots(html, pub); html = set_banner(html, pub); html = set_date(html, a.get('published_on'))
        write(p, html)
        rows.append((a['file'], a['status'], a.get('published_on') or ''))
    published = [a for a in m['articles'] if a['status'] == 'published' and os.path.exists(os.path.join(ART, a['file']))]
    rebuild_hub(published); rebuild_sitemap(published)
    if not CHECK:
        json.dump(m, open(os.path.join(ART, 'manifest.json'), 'w', encoding='utf-8'), indent=2, ensure_ascii=False)
        open(os.path.join(ART, 'manifest.json'), 'a', encoding='utf-8').write('\n')
    print(('CHECK ONLY — ' if CHECK else '') + f'{len(published)} published, {len(m["articles"]) - len(published)} draft')
    for f, st, d in rows: print(f'  {st:>9}  {d:<10}  {f}')

if __name__ == '__main__':
    main()
