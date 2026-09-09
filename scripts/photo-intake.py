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
  python3 scripts/photo-intake.py --check    # guard: exit 1 if a dump file is offered as a drop, or if it cannot tell
  HANDOFF_REF=some-branch python3 …          # read another ref (tests)
--check and an import exit 1 when a dump file is offered OR when the handoff ref or the dump baseline cannot be read;
each stamps its result under "_check" in images/mast/gallery/intake.json. An import prints NOTHING NEW when there is
nothing to do."""
import json, os, re, subprocess, sys, time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REF = os.environ.get('HANDOFF_REF', 'origin/claude/desktop-assets')
# Two Desktop drop folders (owner, 2026-09-09, saying the folder's name aloud: "MAST Solutions Web 2026" beside the
# "MAST NEW WEB 2026" the watcher was installed on). mac-handoff.sh lower-cases a folder name and turns its spaces into
# dashes, so the two land here as mast-new-web-2026/ and mast-solutions-web-2026/; both are read, and a new one is one
# line in DROP_ROOTS.
DROP_ROOTS = ['reference/desktop/mast-new-web-2026', 'reference/desktop/mast-solutions-web-2026']
KINDS = {  # kind: (destination under the repo, tile prefix, folders to scan on the handoff ref)
    'gallery': ('images/mast/gallery', 'g', ['reference/desktop/gallery'] + [r + '/gallery' for r in DROP_ROOTS]),
    'range':   ('images/mast/range',   'a', ['reference/desktop/range']   + [r + '/range'   for r in DROP_ROOTS]),
}
IMAGES = {'.jpg', '.jpeg', '.png', '.webp'}
CLIPS = {'.mp4', '.mov', '.webm', '.m4v'}
# The Desktop folder itself (owner, 2026-09-06: "MAST WEB 2026 = JUST JPGS update to gallery but they do not" — his files sit
# at its top level, not in gallery/ or range/). Only what the MAC ADDED counts as a drop, and WordPress derivative sizes
# (-300x200, @2x) never do.
#
# A drop is a file ADDED to a drop folder in a commit AFTER the baseline below. Nothing else is:
#   * a date floor separates nothing — every commit on the handoff ref is after 2026-09-05, so the floor this line used
#     to carry left 4,433 top-level candidates, 4,424 of them WordPress dump files (measured 2026-09-09 on a729d42);
#   * neither does the "Hand off from Mac:" subject, on its own or with the date: the branch was rebuilt as an orphan
#     and its history has been re-pointed once already, so what commit a file arrived by is not a stable fact. Pinning
#     the oracle to a filter is what let the guard self-disable — empty the constant and it reported OK on the same
#     4,433 files (round-1 guardrails review, 2026-09-09).
# The baseline is a SHA, so nothing about it moves when a filter is edited. MEASURED this turn, not recalled:
#   git log -1 --format='%H %cI %s %P' e5b4c0c92b262ce356d2ced7e4fcd34f81b13e3b
#     -> 2026-09-08T04:16:31+00:00  "Worker smoke test (2026-09-08 04:16 UTC)"  parents: NONE (it is the root commit)
#   git ls-tree -r --name-only <baseline> -- reference/desktop/mast-new-web-2026 | wc -l  -> 16386  (of 16819 in the tree)
#   git log --diff-filter=A --name-only --format= <baseline>..origin/claude/desktop-assets -- <root>  -> 9 files
# So: 4,433 candidates without it, 9 with it, 0 of them from the dump. It is deliberately ONE baseline for BOTH roots —
# reference/desktop/mast-solutions-web-2026 does not exist at the baseline, so on that root every file is by definition
# post-baseline. A WordPress dump copied into THAT folder would import; that cap is not built and is not claimed here.
DUMP_BASELINE = 'e5b4c0c92b262ce356d2ced7e4fcd34f81b13e3b'
DERIVATIVE = re.compile(r'-\d+x\d+(@2x)?\.[a-z]+$', re.I)
LEDGER = os.path.join('images', 'mast', 'gallery', 'intake.json')


def git(*args, binary=False):
    r = subprocess.run(['git', *args], cwd=REPO, capture_output=True, check=True)
    return r.stdout if binary else r.stdout.decode('utf-8')


def listing(folder):
    try:
        return [l for l in git('ls-tree', '-r', '--name-only', REF, '--', folder).splitlines() if l]
    except subprocess.CalledProcessError:
        return []


def rev(ref):
    """The commit a ref names, or '' if this clone cannot resolve it. Never an exception: the callers fail closed."""
    r = subprocess.run(['git', 'rev-parse', '--verify', '--quiet', ref + '^{commit}'], cwd=REPO, capture_output=True)
    return r.stdout.decode().strip() if r.returncode == 0 else ''


def is_ancestor(a, b):
    return subprocess.run(['git', 'merge-base', '--is-ancestor', a, b], cwd=REPO, capture_output=True).returncode == 0


def recent_drops(root):
    """Top-level media ADDED to a Desktop drop folder after the dump baseline."""
    try:
        out = git('log', '--diff-filter=A', '--name-only', '--format=', f'{DUMP_BASELINE}..{REF}', '--', root)
    except subprocess.CalledProcessError:
        return []
    depth = root.count('/') + 1
    return sorted({l for l in out.splitlines() if l and l.count('/') == depth and not DERIVATIVE.search(l)})


def dump_paths(root):
    """What the drop folder already held at the baseline — the WordPress dump, never a drop. Read from the baseline
    commit's own tree, so this oracle does not move when the filter above is edited."""
    try:
        return {l for l in git('ls-tree', '-r', '--name-only', DUMP_BASELINE, '--', root).splitlines() if l}
    except subprocess.CalledProcessError:
        return set()


def heartbeat(payload):
    """A last-run line in images/mast/gallery/intake.json under "_check", so a check that never ran is distinguishable
    from one that found nothing. main() carries every "_" key through when it rewrites the ledger."""
    path = os.path.join(REPO, LEDGER)
    d = json.load(open(path, encoding='utf-8')) if os.path.exists(path) else {}
    d['_check'] = payload
    os.makedirs(os.path.dirname(path), exist_ok=True)
    json.dump(d, open(path, 'w', encoding='utf-8'), indent=1, sort_keys=True)


def check_drops(write=True):
    """--check: the intake must offer nothing the drop folder already held at the baseline. Exit 1 if it does — and
    exit 1, not 0, when the question cannot be answered at all: an unresolvable handoff ref used to print the same
    "OK ... 0 candidates" as a genuinely quiet day. The counts are printed and stamped either way."""
    stamp = {'at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'ref': REF, 'baseline': DUMP_BASELINE}

    def fail(reason):
        print('FAIL: ' + reason)
        if write:
            heartbeat({**stamp, 'result': 'fail', 'reason': reason})
        return 1

    head = rev(REF)
    if not head:
        return fail(f'the handoff ref {REF} does not resolve in this clone, so nothing can be told apart from a dump '
                    f'file; fetch it first: git fetch origin claude/desktop-assets')
    stamp['head'] = head
    if not rev(DUMP_BASELINE):
        return fail(f'the dump baseline {DUMP_BASELINE[:7]} is not in this clone; the intake has no oracle to check against')
    if not is_ancestor(DUMP_BASELINE, head):
        return fail(f'the dump baseline {DUMP_BASELINE[:7]} is not an ancestor of {REF} ({head[:7]}) — the handoff '
                    f'branch was rebuilt or re-pointed; re-measure the dump commit before importing anything')
    bad, total = [], 0
    for root in DROP_ROOTS:
        drops = recent_drops(root)
        total += len(drops)
        bad += sorted(set(drops) & dump_paths(root))
    print(f'drop candidates: {total} across ' + ', '.join(DROP_ROOTS))
    if bad:
        print(f'FAIL: {len(bad)} of them are files from the original dump, not drops. First five:')
        for b in bad[:5]:
            print('  ' + b)
        if write:
            heartbeat({**stamp, 'result': 'fail', 'candidates': total, 'dump_matches': len(bad)})
        return 1
    print('OK: no dump file is offered as a drop')
    if write:
        heartbeat({**stamp, 'result': 'ok', 'candidates': total, 'dump_matches': 0})
    return 0


def main(dry):
    # The guard runs on every import, not only when someone remembers to pass --check: this is the path that would put
    # 4,424 WordPress dump files into the gallery, so it fails closed before a single file is copied.
    if check_drops(write=not dry):
        print('refusing to import: the drop check did not pass (see FAIL above)')
        return 1
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
        _ledger = json.load(open(ledger_path, encoding='utf-8')) if os.path.exists(ledger_path) else {}
        meta = {k: v for k, v in _ledger.items() if k.startswith('_')}   # the --check heartbeat, kept across a rewrite
        seen = {k: v for k, v in _ledger.items() if not k.startswith('_')}
        n = max([int(m.group(1)) for f in os.listdir(ddir) for m in [re.match(re.escape(prefix) + r'(\d+)\.', f)] if m], default=0)
        sources = [(listing(f), None) for f in folders]
        if kind == 'gallery':
            sources += [(recent_drops(r), set(listing(r))) for r in DROP_ROOTS]
        known = set()
        for files, all_names in sources:
            names = all_names if all_names is not None else set(files)
            known |= names
            for path in sorted(files):
                base, ext = os.path.splitext(path)
                ext = ext.lower()
                if kind == 'gallery' and ext in CLIPS:
                    # In Action is photographs only (owner, 2026-09-08/09: "This is a video and does not belong" / "NOT VIDEOS");
                    # a clip in the drop folder is listed here and left where it is, never a tile.
                    print('skip clip (In Action is photographs only): ' + path); continue
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
        # A poster that lands after its clip was imported (the Mac made none for top-level drops before 2026-09-06, and
        # a compressed clip's poster carried the wrong stem): pair it with the tile that already exists.
        for path, name in list(seen.items()):
            base, ext = os.path.splitext(path)
            if ext.lower() not in CLIPS or base.endswith('-poster'):
                continue
            stem = os.path.splitext(name)[0]
            if any(os.path.exists(os.path.join(ddir, stem + '-poster' + e)) for e in ('.png', '.jpg')):
                continue
            poster_src = next((p for p in (base + '-poster.png', base + '-poster.jpg', path + '.png') if p in known), None)
            if not poster_src:
                continue
            pname = stem + '-poster' + os.path.splitext(poster_src)[1].lower()
            if not dry:
                open(os.path.join(ddir, pname), 'wb').write(git('show', f'{REF}:{poster_src}', binary=True))
                seen[poster_src] = pname
            added.append((kind, poster_src, pname))
        if not dry and any(a[0] == kind for a in added):
            if not head:
                head = [f'# {kind}: one tile per line in display order (paths relative to images/mast/); photo-intake.py appends, a person reorders or removes.']
            open(tiles_path, 'w', encoding='utf-8').write('\n'.join(head + tiles) + '\n')
            json.dump({**meta, **seen}, open(ledger_path, 'w', encoding='utf-8'), indent=1, sort_keys=True)
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
    sys.exit(check_drops() if '--check' in sys.argv[1:] else main('--dry-run' in sys.argv[1:]))
