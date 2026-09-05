#!/usr/bin/env python3
"""Photo intake: what lands in the Desktop drop folders becomes tiles (owner, 2026-09-05: "anytime I drop new items into
the folder on my desktop, it should update in and add photos to the gallery").

The Mac side (scripts/mac-handoff.sh, run by hand or by the watcher scripts/mac-autopilot.sh installs) pushes
  ~/Desktop/MAST NEW WEB 2026/gallery/   ->  reference/desktop/gallery/            (or .../mast-new-web-2026/gallery/)
  ~/Desktop/MAST NEW WEB 2026/range/     ->  reference/desktop/range/              (or .../mast-new-web-2026/range/)
on branch claude/desktop-assets, already web-sized (JPEG, 2000 px, q82) with a -poster.png beside every clip.

This script, run in a cloud session (the hourly check-in) or anywhere with the repo:
  1. lists those folders on the handoff ref (never touches the working tree of that branch),
  2. copies every photograph or clip it has not seen before into images/mast/gallery/ or images/mast/range/ as the next
     gNN / aNN, with the clip's poster as gNN-poster.png,
  3. appends the new tile to images/mast/<kind>/tiles.txt, which scripts/assemble-cinematic.py reads,
  4. records the source path in images/mast/<kind>/intake.json so a re-run never imports the same file twice.
Then: python3 scripts/assemble-cinematic.py, commit, PR; the page re-upload is the Mac's (wp-upload.sh --if-changed).

  python3 scripts/photo-intake.py            # import and report
  python3 scripts/photo-intake.py --dry-run  # report only
  HANDOFF_REF=some-branch python3 …          # read another ref (tests)
Exit 0 always; prints NOTHING NEW when there is nothing to do."""
import json, os, re, subprocess, sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REF = os.environ.get('HANDOFF_REF', 'origin/claude/desktop-assets')
KINDS = {  # kind: (destination under the repo, tile prefix, folders to scan on the handoff ref)
    'gallery': ('images/mast/gallery', 'g', ['reference/desktop/gallery', 'reference/desktop/mast-new-web-2026/gallery']),
    'range':   ('images/mast/range',   'a', ['reference/desktop/range',   'reference/desktop/mast-new-web-2026/range']),
}
IMAGES = {'.jpg', '.jpeg', '.png', '.webp'}
CLIPS = {'.mp4', '.mov', '.webm', '.m4v'}


def git(*args, binary=False):
    r = subprocess.run(['git', *args], cwd=REPO, capture_output=True, check=True)
    return r.stdout if binary else r.stdout.decode('utf-8')


def listing(folder):
    try:
        return [l for l in git('ls-tree', '-r', '--name-only', REF, '--', folder).splitlines() if l]
    except subprocess.CalledProcessError:
        return []


def main(dry):
    added, notes = [], []
    for kind, (dest, prefix, folders) in KINDS.items():
        ddir = os.path.join(REPO, dest)
        os.makedirs(ddir, exist_ok=True)
        tiles_path, ledger_path = os.path.join(ddir, 'tiles.txt'), os.path.join(ddir, 'intake.json')
        head, tiles = [], []
        if os.path.exists(tiles_path):
            for line in open(tiles_path, encoding='utf-8'):
                (head if line.startswith('#') else tiles).append(line.rstrip('\n'))
            tiles = [t for t in tiles if t.strip()]
        seen = json.load(open(ledger_path, encoding='utf-8')) if os.path.exists(ledger_path) else {}
        n = max([int(m.group(1)) for f in os.listdir(ddir) for m in [re.match(re.escape(prefix) + r'(\d+)\.', f)] if m], default=0)
        for folder in folders:
            files = listing(folder)
            names = set(files)
            for path in sorted(files):
                base, ext = os.path.splitext(path)
                ext = ext.lower()
                if ext not in IMAGES | CLIPS or base.endswith('-poster') or path in seen:
                    continue
                n += 1
                name = f'{prefix}{n:02d}' + ('.jpg' if ext in ('.jpg', '.jpeg') else ext)
                poster_src = next((p for p in (base + '-poster.png', base + '-poster.jpg', path + '.png') if p in names), None)
                if ext in CLIPS and not poster_src:
                    notes.append(f'{kind}: {path} has no poster beside it; the tile shows a dark card until one lands')
                if not dry:
                    open(os.path.join(ddir, name), 'wb').write(git('show', f'{REF}:{path}', binary=True))
                    if poster_src:
                        pname = f'{prefix}{n:02d}-poster' + os.path.splitext(poster_src)[1].lower()
                        open(os.path.join(ddir, pname), 'wb').write(git('show', f'{REF}:{poster_src}', binary=True))
                        seen[poster_src] = pname
                    seen[path] = name
                    tiles.append(f'{os.path.basename(dest)}/{name}')
                added.append((kind, path, name))
        if not dry and any(a[0] == kind for a in added):
            if not head:
                head = [f'# {kind}: one tile per line in display order (paths relative to images/mast/); photo-intake.py appends, a person reorders or removes.']
            open(tiles_path, 'w', encoding='utf-8').write('\n'.join(head + tiles) + '\n')
            json.dump(seen, open(ledger_path, 'w', encoding='utf-8'), indent=1, sort_keys=True)
    if not added:
        print(f'NOTHING NEW on {REF} for ' + ', '.join(KINDS))
    else:
        for kind, path, name in added:
            print(f'{"would add" if dry else "added"} {kind}: {path} -> {name}')
        print(f'{len(added)} new tile(s){" (dry run)" if dry else ""}. Next: python3 scripts/assemble-cinematic.py, commit, PR; the page upload is the Mac\'s.')
    for note in notes:
        print('note:', note)
    return 0


if __name__ == '__main__':
    sys.exit(main('--dry-run' in sys.argv[1:]))
