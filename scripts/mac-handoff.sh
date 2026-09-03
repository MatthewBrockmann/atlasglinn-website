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
# Anything passed after `--` is handed off IN ADDITION to the default set — a
# file, a folder, or an http(s) URL (downloaded on the Mac, then handled like a
# file):
#
#   curl -fsSL https://raw.githubusercontent.com/MatthewBrockmann/atlasglinn-website/main/scripts/mac-handoff.sh | bash -s -- ~/Desktop/some-folder ~/Downloads/clip.mov
#
# What it does, in order: finds (or clones) the repo, fetches, checks out the
# handoff branch in a throw-away worktree (your working copy is never touched),
# copies each source into reference/desktop/ (folders keep their structure,
# HEIC becomes JPEG, Git LFS pointers are replaced by the real file via
# `git lfs pull`, videos over HANDOFF_MAX_MB are compressed with the Mac's
# built-in avconvert to 720p, then 480p, or listed if they still do not fit,
# because GitHub rejects files over 100 MB), commits, pushes, prints DONE.
# Re-running only adds what is new. Safe to run repeatedly.
#
# Knobs (environment variables, all optional):
#   HANDOFF_BRANCH  branch to push        (default claude/desktop-assets)
#   HANDOFF_DEST    folder inside the repo (default reference/desktop)
#   HANDOFF_MAX_MB  largest video to copy  (default 90)
#   HANDOFF_REPO    path to an existing clone (default: searched under $HOME)
#   HANDOFF_REMOTE  git remote name        (default origin)
#   HANDOFF_ONLY=1  hand off only the arguments, skip the default set
# ─────────────────────────────────────────────────────────────────────────────
set -u

REPO_URL="https://github.com/MatthewBrockmann/atlasglinn-website.git"
BRANCH="${HANDOFF_BRANCH:-claude/desktop-assets}"
DEST="${HANDOFF_DEST:-reference/desktop}"
MAX_MB="${HANDOFF_MAX_MB:-90}"
REMOTE="${HANDOFF_REMOTE:-origin}"
DESK="$HOME/Desktop"

say() { printf '%s\n' "$*"; }
die() { say "FAILED: $*"; exit 1; }
fsize() { stat -f%z "$1" 2>/dev/null || stat -c%s "$1"; }
is_url() { case "$1" in http://*|https://*) return 0 ;; *) return 1 ;; esac; }
is_lfs_pointer() { [ -f "$1" ] && [ "$(fsize "$1")" -lt 400 ] && head -c 40 "$1" 2>/dev/null | grep -q '^version https://git-lfs'; }

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

# The default set. Everything a cloud session has asked for so far lives here;
# add to this list rather than inventing a second paste.
DEFAULT_SOURCES=(
  "$DESK/MAST NEW WEB 2026"
  "$DESK/mast_tier3_trailer.html"
  "$DESK/atlas_mast_landing_4d.html"
  "$DESK/atlas_demo_hero.html"
  "$DESK/mastsolutions-atlas-rebuilt.html"
  "$DESK/atlas_ep_hero_v3.html"
  "$R/images/about-hero-new.mp4"
  "https://atlasglinn.com/wp-content/uploads/2025/04/Atlas-Glinn-and-MAST-Solutions.mp4"
)
if [ "${HANDOFF_ONLY:-0}" = "1" ]; then SOURCES=("$@"); else SOURCES=("${DEFAULT_SOURCES[@]}" "$@"); fi

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

list_skipped() { printf '%s (%s)\n' "$1" "$2" >> "$OUT/SKIPPED.txt"; }

fetch_lfs() { # fetch_lfs <pointer file inside a git clone> — replaces it with the real file; 0 on success
  local f="$1" top rel
  top="$(git -C "$(dirname "$f")" rev-parse --show-toplevel 2>/dev/null)" || return 1
  rel="${f#"$top"/}"
  git lfs version >/dev/null 2>&1 || return 1
  git -C "$top" lfs pull --include="$rel" --exclude="" >/dev/null 2>&1
  ! is_lfs_pointer "$f"
}

compress_video() { # compress_video <source> <output.mp4> — 720p, then 480p; 0 if the result fits the limit
  local f="$1" o="$2" p
  command -v avconvert >/dev/null 2>&1 || return 1
  for p in Preset1280x720 Preset640x480; do
    rm -f "$o"
    if avconvert --preset "$p" --source "$f" --output "$o" --replace >/dev/null 2>&1 && [ "$(fsize "$o")" -le $((MAX_MB * 1000000)) ]; then
      say "  compressed with $p to fit GitHub: $(basename "$f") -> $(basename "$o")"; return 0
    fi
  done
  rm -f "$o"; return 1
}

copy_file() { # copy_file <source file> <destination directory>; returns 2 when the file was listed instead of copied
  local f="$1" d="$2" b e s web
  b="$(basename "$f")"
  e="$(printf '%s' "${b##*.}" | tr '[:upper:]' '[:lower:]')"
  if is_lfs_pointer "$f" && ! fetch_lfs "$f"; then
    say "  Git LFS pointer, real file not available (git lfs pull failed), listed instead: $f"
    list_skipped "$f" "LFS pointer"; return 2
  fi
  s="$(fsize "$f")"
  mkdir -p "$d"
  case "$e" in
    heic|heif)
      if command -v sips >/dev/null 2>&1 && sips -s format jpeg "$f" --out "$d/${b%.*}.jpg" >/dev/null 2>&1; then :; else cp "$f" "$d/$b"; fi ;;
    mov|mp4|m4v|avi|mkv)
      if [ "$s" -le $((MAX_MB * 1000000)) ]; then cp "$f" "$d/$b"; else
        web="$d/${b%.*}-web.mp4"
        if [ -f "$web" ]; then :; # compressed on an earlier run, already on the branch
        elif ! compress_video "$f" "$web"; then
          say "  too big for GitHub even after compression, listed instead: $b ($((s / 1000000)) MB)"
          list_skipped "$f" "$s bytes"; return 2
        fi
      fi ;;
    *) cp "$f" "$d/$b" ;;
  esac
}

for src in "${SOURCES[@]}"; do
  if is_url "$src"; then
    name="$(basename "$src")"
    if [ -f "$OUT/$name" ] || [ -f "$OUT/${name%.*}-web.mp4" ]; then copied=$((copied + 1)); continue; fi
    say "url:    $src"
    dl="$(mktemp -d "${TMPDIR:-/tmp}/handoff-dl-XXXXXX")/$name"
    if curl -fsSL -o "$dl" "$src"; then
      if copy_file "$dl" "$OUT"; then copied=$((copied + 1)); else skipped=$((skipped + 1)); fi
      rm -rf "$(dirname "$dl")"
    else
      say "download failed, skipping: $src"; missing=$((missing + 1))
    fi
  elif [ -d "$src" ]; then
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
new="$(git diff --cached --name-only | wc -l | tr -d ' ')"
if [ "$new" = "0" ]; then
  say "NOTHING NEW: everything is already on $BRANCH"
else
  git -c user.name="Matthew Brockmann" -c user.email="matthew@atlasglinn.com" \
    commit -q -m "Hand off from Mac: $new file(s) on $(date '+%Y-%m-%d %H:%M')" || die "commit"
  git push -q -u "$REMOTE" "$BRANCH" || die "push (network or GitHub login)"
fi
total="$(git ls-files "$DEST" | wc -l | tr -d ' ')"
say "DONE: $new new or changed, $copied handled, $skipped listed instead, $missing not found. $total files now on branch $BRANCH."
[ -f "$OUT/SKIPPED.txt" ] && { say "Could not be copied (see the reason after each name):"; cat "$OUT/SKIPPED.txt"; }

# 6. Clean up the worktree; the branch stays.
cd / && git -C "$R" worktree remove --force "$W" >/dev/null 2>&1
exit 0
