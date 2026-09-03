#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# mac-handoff.sh — the ONE Terminal command for getting files from this Mac to a
# cloud Claude session.
#
# Cloud sessions (Claude Code on the web) run in a container and cannot see this
# Mac. Cowork and a Terminal `claude` session CAN. This script bridges the gap:
# it copies files/folders from the Mac into the atlasglinn-website repo on a
# branch and pushes it, so any session can read them from GitHub. No OneDrive.
#
# Always the same paste, run from anywhere on the Mac:
#
#   curl -fsSL https://raw.githubusercontent.com/MatthewBrockmann/atlasglinn-website/main/scripts/mac-handoff.sh | bash
#
# With no arguments it hands off the default set (see DEFAULT_SOURCES below).
# To hand off something else, pass paths after `--`:
#
#   curl -fsSL https://raw.githubusercontent.com/MatthewBrockmann/atlasglinn-website/main/scripts/mac-handoff.sh | bash -s -- ~/Desktop/some-folder ~/Downloads/clip.mov
#
# What it does, in order: finds (or clones) the repo, fetches, checks out the
# handoff branch in a throw-away worktree (your working copy is never touched),
# copies each source into reference/desktop/ (folders keep their structure,
# HEIC becomes JPEG, videos over HANDOFF_MAX_MB are listed instead of copied
# because GitHub rejects files over 100 MB), commits, pushes, prints DONE.
# Re-running only adds what is new. Safe to run repeatedly.
#
# Knobs (environment variables, all optional):
#   HANDOFF_BRANCH  branch to push        (default claude/desktop-assets)
#   HANDOFF_DEST    folder inside the repo (default reference/desktop)
#   HANDOFF_MAX_MB  largest video to copy  (default 90)
#   HANDOFF_REPO    path to an existing clone (default: searched under $HOME)
#   HANDOFF_REMOTE  git remote name        (default origin)
# ─────────────────────────────────────────────────────────────────────────────
set -u

REPO_URL="https://github.com/MatthewBrockmann/atlasglinn-website.git"
BRANCH="${HANDOFF_BRANCH:-claude/desktop-assets}"
DEST="${HANDOFF_DEST:-reference/desktop}"
MAX_MB="${HANDOFF_MAX_MB:-90}"
REMOTE="${HANDOFF_REMOTE:-origin}"
DESK="$HOME/Desktop"
DEFAULT_SOURCES=(
  "$DESK/MAST NEW WEB 2026"
  "$DESK/mast_tier3_trailer.html"
  "$DESK/atlas_mast_landing_4d.html"
  "$DESK/atlas_demo_hero.html"
  "$DESK/mastsolutions-atlas-rebuilt.html"
  "$DESK/atlas_ep_hero_v3.html"
)

say() { printf '%s\n' "$*"; }
die() { say "FAILED: $*"; exit 1; }
fsize() { stat -f%z "$1" 2>/dev/null || stat -c%s "$1"; }

if [ "$#" -gt 0 ]; then SOURCES=("$@"); else SOURCES=("${DEFAULT_SOURCES[@]}"); fi

# 1. Locate or clone the repo.
R="${HANDOFF_REPO:-}"
if [ -z "$R" ]; then
  R="$(find "$HOME" -maxdepth 4 -type d -name atlasglinn-website -not -path '*/Library/*' -not -path '*/.Trash/*' 2>/dev/null | head -1)"
fi
if [ -z "$R" ]; then
  R="$HOME/atlasglinn-website"
  say "No clone found, cloning to $R"
  git clone -q "$REPO_URL" "$R" || die "clone (network or GitHub login)"
fi
cd "$R" || die "cannot enter $R"

# 2. Fetch. If the handoff branch already exists remotely, build on it.
git fetch -q "$REMOTE" main || die "fetch (network or GitHub login)"
git fetch -q "$REMOTE" "$BRANCH" 2>/dev/null && BASE="$REMOTE/$BRANCH" || BASE="$REMOTE/main"

# 3. Throw-away worktree so the working copy is never touched.
[ "$(git branch --show-current 2>/dev/null)" = "$BRANCH" ] && git checkout -q --detach
git worktree prune
W="$(mktemp -d "${TMPDIR:-/tmp}/handoff-XXXXXX")/wt"
git branch -D "$BRANCH" >/dev/null 2>&1
git worktree add -q -B "$BRANCH" "$W" "$BASE" || die "worktree"

# 4. Copy.
OUT="$W/$DEST"
mkdir -p "$OUT"
printf '# Handed off from the Mac. Stored as plain files, not LFS, so GitHub Pages and cloud sessions can read them.\n* -filter -diff -merge\n' > "$OUT/.gitattributes"
rm -f "$OUT/SKIPPED.txt"
copied=0; skipped=0; missing=0

copy_file() { # copy_file <source file> <destination directory>
  local f="$1" d="$2" b e s
  b="$(basename "$f")"
  e="$(printf '%s' "${b##*.}" | tr '[:upper:]' '[:lower:]')"
  s="$(fsize "$f")"
  mkdir -p "$d"
  case "$e" in
    heic|heif)
      if command -v sips >/dev/null 2>&1 && sips -s format jpeg "$f" --out "$d/${b%.*}.jpg" >/dev/null 2>&1; then :; else cp "$f" "$d/$b"; fi ;;
    mov|mp4|m4v|avi|mkv)
      if [ "$s" -le $((MAX_MB * 1000000)) ]; then cp "$f" "$d/$b"; else
        say "  too big for GitHub, listed instead: $b ($((s / 1000000)) MB)"
        printf '%s (%s bytes)\n' "$f" "$s" >> "$OUT/SKIPPED.txt"; return 2; fi ;;
    *) cp "$f" "$d/$b" ;;
  esac
}

for src in "${SOURCES[@]}"; do
  if [ -d "$src" ]; then
    name="$(basename "$src" | tr '[:upper:] ' '[:lower:]-')"
    say "folder: $src -> $DEST/$name/"
    while IFS= read -r -d '' f; do
      rel="${f#"$src"/}"
      if copy_file "$f" "$OUT/$name/$(dirname "$rel")"; then copied=$((copied + 1)); else skipped=$((skipped + 1)); fi
    done < <(find "$src" -type f -not -name '.*' -print0)
  elif [ -f "$src" ]; then
    say "file:   $src"
    if copy_file "$src" "$OUT"; then copied=$((copied + 1)); else skipped=$((skipped + 1)); fi
  else
    say "not found, skipping: $src"; missing=$((missing + 1))
  fi
done

# 5. Commit and push.
cd "$W" || die "cannot enter worktree"
git add -A "$DEST"
if git diff --cached --quiet; then
  say "NOTHING NEW: everything is already on $BRANCH"
else
  git -c user.name="Matthew Brockmann" -c user.email="matthew@atlasglinn.com" \
    commit -q -m "Hand off from Mac: $copied file(s) on $(date '+%Y-%m-%d %H:%M')" || die "commit"
  git push -q -u "$REMOTE" "$BRANCH" || die "push (network or GitHub login)"
fi
total="$(git ls-files "$DEST" | wc -l | tr -d ' ')"
say "DONE: $copied copied, $skipped too big, $missing not found. $total files now on branch $BRANCH."
[ -f "$OUT/SKIPPED.txt" ] && { say "Over ${MAX_MB} MB, send these another way:"; cat "$OUT/SKIPPED.txt"; }

# 6. Clean up the worktree; the branch stays.
cd / && git -C "$R" worktree remove --force "$W" >/dev/null 2>&1
exit 0
