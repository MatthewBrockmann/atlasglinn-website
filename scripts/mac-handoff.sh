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
# file; a YouTube, Instagram, Vimeo, TikTok or Facebook video page is fetched as
# an MP4 with yt-dlp, installed into ~/.cache/mac-handoff on first use; any other
# web page — a URL ending in / or without a file extension — is saved as
# reference/desktop/live/<slug>.html so a cloud session can read the live site):
#
#   curl -fsSL https://raw.githubusercontent.com/MatthewBrockmann/atlasglinn-website/main/scripts/mac-handoff.sh | bash -s -- ~/Desktop/some-folder ~/Downloads/clip.mov
#
# Built for a poor connection (2026-09-06): the handoff branch is fetched without
# its media (commits and trees only, one commit deep, about 3 MB) into a worktree
# that materialises nothing; a run downloads and pushes only what it adds.
#
# What it does, in order: finds (or clones) the repo, fetches, opens a throw-away
# detached worktree on the handoff branch's tip (your working copy, your checkout
# and your local branches are never touched), copies each source into reference/desktop/ (folders keep their structure,
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
# One handoff at a time: the watcher and the hourly retry pass share the private clone (2026-09-06). mkdir is atomic on
# macOS without flock; a lock older than two hours is a crashed run and is taken over.
LOCK="${TMPDIR:-/tmp}/atlasglinn-handoff.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +120 2>/dev/null)" ]; then rmdir "$LOCK" 2>/dev/null; mkdir "$LOCK" 2>/dev/null || { say "another handoff is running; this pass is skipped"; exit 0; }
  else say "another handoff is running; this pass is skipped"; exit 0; fi
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT
die() { say "FAILED: $*"; exit 1; }
fsize() { stat -f%z "$1" 2>/dev/null || stat -c%s "$1"; }
is_url() { case "$1" in http://*|https://*) return 0 ;; *) return 1 ;; esac; }
# Video pages are not files: yt-dlp fetches the MP4 (added 2026-09-04 for the Training Reel, the Disaster Recovery film
# and the Instagram clips the owner wants embedded on the site). yt-dlp goes into a private venv on first use — macOS
# ships python3 with the Xcode command-line tools that git already needs — and nothing else on the Mac changes.
is_media_url() { case "$1" in *youtube.com/*|*youtu.be/*|*instagram.com/*|*vimeo.com/*|*tiktok.com/*|*facebook.com/*|*fb.watch/*) return 0 ;; *) return 1 ;; esac; }
# A web page (the path ends in / or its last segment has no extension) is saved as live/<slug>.html, not by basename
# (added 2026-09-05: the owner asked why the rebuilt Atlas pages and the live atlasglinn.com pages do not match; a cloud
# session cannot open the site, so the Mac brings the live pages' HTML over and the words are compared there).
_url_path() { local p="${1#*://}"; p="${p#*/}"; p="${p%%\?*}"; printf '%s' "${p%%#*}"; }
is_page_url() { local p; p="$(_url_path "$1")"; case "$p" in ""|*/) return 0 ;; esac; case "${p##*/}" in *.*) return 1 ;; *) return 0 ;; esac; }
page_slug() { local p; p="$(_url_path "$1")"; p="${p%/}"; p="$(printf '%s' "$p" | tr '/' '-')"; printf '%s' "${p:-index}"; }
media_id() { printf '%s' "$1" | sed -E 's#.*(v=|youtu\.be/|/reel/|/reels/|/p/|/shorts/|/video/|/videos/)([A-Za-z0-9_-]+).*#\2#'; }
YTDLP=""
ensure_ytdlp() {
  [ -n "$YTDLP" ] && return 0
  if command -v yt-dlp >/dev/null 2>&1; then YTDLP="$(command -v yt-dlp)"; return 0; fi
  local v="$HOME/.cache/mac-handoff/venv"
  if [ ! -x "$v/bin/yt-dlp" ]; then
    say "installing yt-dlp (one time, into $v)"
    { python3 -m venv "$v" && "$v/bin/pip" -q install --upgrade yt-dlp; } >/dev/null 2>&1 || return 1
  fi
  YTDLP="$v/bin/yt-dlp"
}
fetch_media() {   # $1 = url, $2 = empty directory to download into; prints the file name
  ensure_ytdlp || return 1
  local fmt='b[ext=mp4]/b'
  command -v ffmpeg >/dev/null 2>&1 && fmt='bv*[ext=mp4][height<=1080]+ba[ext=m4a]/b[ext=mp4]/b'
  "$YTDLP" -q --no-warnings --no-playlist -f "$fmt" --merge-output-format mp4 -o "$2/%(title).80s [%(id)s].%(ext)s" "$1" >/dev/null 2>&1 || return 1
  ls -1 "$2" | head -1
}
is_lfs_pointer() { [ -f "$1" ] && [ "$(fsize "$1")" -lt 400 ] && head -c 40 "$1" 2>/dev/null | grep -q '^version https://git-lfs'; }

# 1. Locate or clone the repo. The private clone under ~/Library/Caches comes first (2026-09-06): the Desktop clone is
# iCloud-synced and iCloud evicts its git objects ("mmap failed: Resource deadlock avoided"), so it cannot fetch.
R="${HANDOFF_REPO:-}"
if [ -z "$R" ] && [ -d "$HOME/Library/Caches/atlasglinn/atlasglinn-website/.git" ]; then R="$HOME/Library/Caches/atlasglinn/atlasglinn-website"; fi
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
# A cloud session can queue more URLs for the Mac to fetch by adding them to scripts/handoff-urls.txt on main
# (one per line, # comments allowed). The Mac has open internet; the cloud container does not.
URL_LIST="$(curl -fsSL "https://raw.githubusercontent.com/MatthewBrockmann/atlasglinn-website/main/scripts/handoff-urls.txt" 2>/dev/null | grep -E '^https?://' || true)"
if [ -n "$URL_LIST" ]; then while IFS= read -r u; do [ -n "$u" ] && DEFAULT_SOURCES+=("$u"); done <<< "$URL_LIST"; fi
if [ "${HANDOFF_ONLY:-0}" = "1" ]; then SOURCES=("$@"); else SOURCES=("${DEFAULT_SOURCES[@]}" "$@"); fi

# 2. Fetch — blobless and one commit deep (2026-09-06). The handoff branch's tip tree is over 1 GB of media; on a poor
# connection the old full fetch never finished. Commits and trees only, about 3 MB; the worktree below materialises
# nothing, so a run downloads only what it must. A second try goes over HTTP/1.1 with a slow-link timeout.
pfetch() {   # into refs/handoff/<branch>, never FETCH_HEAD: the hourly upload shares this clone and its fetch of main landed
             # between this fetch and the read (owner's Mac, 2026-09-06: every kick ended "! [rejected] non-fast-forward"
             # because the hand-off had been built on main's tip instead of the branch's)
  git fetch -q --filter=blob:none --depth 1 "$REMOTE" "+refs/heads/$1:refs/handoff/$1" 2>/dev/null && return 0
  git -c http.version=HTTP/1.1 -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=180 fetch -q --filter=blob:none --depth 1 "$REMOTE" "+refs/heads/$1:refs/handoff/$1"
}
if pfetch "$BRANCH"; then BASE="$(git rev-parse "refs/handoff/$BRANCH")"
else pfetch main || die "fetch (network or GitHub login)"; BASE="$(git rev-parse refs/handoff/main)"; fi   # first run ever: start the branch from main

# 3. Throw-away worktree on a detached HEAD: the working copy, its checkout and every local branch stay untouched.
# Only worktrees this script (or the 2026-09-03 inline paste) created are cleaned up. Paths are read whole, never
# word-split, and nothing outside those known locations is ever removed.
git worktree list --porcelain | while IFS= read -r line; do
  case "$line" in "worktree "*) old="${line#worktree }" ;; *) continue ;; esac
  case "$old" in
    */handoff-??????/wt|/tmp/wt-desktop-assets|/private/tmp/wt-desktop-assets)
      [ "$old" != "$R" ] && { say "removing leftover handoff worktree $old"; git worktree remove --force "$old" >/dev/null 2>&1 || true; } ;;
  esac
done
git worktree prune
W="$(mktemp -d "${TMPDIR:-/tmp}/handoff-XXXXXX")/wt"
git worktree add -q --detach --no-checkout "$W" "$BASE" || die "worktree"
# Sparse with an empty pattern: the index holds the whole branch, the folder holds nothing until this run writes into it.
git -C "$W" sparse-checkout init --no-cone >/dev/null 2>&1 && git -C "$W" sparse-checkout set --no-cone '/__none__' >/dev/null 2>&1 || die "sparse checkout (needs git 2.36 or newer)"
git -C "$W" reset -q --hard || die "worktree index"
# What the branch already holds under $DEST, read from its trees (no blob is ever fetched for these checks).
BRANCH_LIST="$(git -C "$W" ls-tree -r --name-only "$BASE" -- "$DEST" 2>/dev/null || true)"
on_branch() { local p="${1#./}"; p="${p//\/.\///}"; printf '%s\n' "$BRANCH_LIST" | grep -qxF -- "$p"; }   # on_branch <path from the repo root>
branch_has() { printf '%s\n' "$BRANCH_LIST" | grep -qF -- "$1"; }                                       # branch_has <substring of a path>

# 4. Copy.
OUT="$W/$DEST"
mkdir -p "$OUT"
printf '# Handed off from the Mac. Stored as plain files, not LFS, so GitHub Pages and cloud sessions can read them.\n* -filter -diff -merge\n' > "$OUT/.gitattributes"
rm -f "$OUT/SKIPPED.txt"; git -C "$W" rm --sparse -q --cached "$DEST/SKIPPED.txt" >/dev/null 2>&1 || true   # rewritten below when something is skipped
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

COMPRESS_ERR=""
compress_video() { # compress_video <source> <output.mp4> — 720p, then 480p, then the low preset; 0 if the result fits the limit
  local f="$1" o="$2" p err=""
  COMPRESS_ERR=""
  command -v avconvert >/dev/null 2>&1 || { COMPRESS_ERR="avconvert not found"; return 1; }
  for p in Preset1280x720 Preset640x480 PresetLowQuality; do
    rm -f "$o"
    if err="$(avconvert --preset "$p" --source "$f" --output "$o" --replace 2>&1 >/dev/null)" && [ "$(fsize "$o")" -le $((MAX_MB * 1000000)) ]; then
      say "  compressed with $p to fit GitHub: $(basename "$f") -> $(basename "$o")"; return 0
    fi
  done
  # The reason goes into SKIPPED.txt (2026-09-06: CQB-P3.MOV, 370 MB, was listed with its size and nothing else).
  COMPRESS_ERR="$(printf '%s' "$err" | tail -n 1 | cut -c1-160)"; [ -n "$COMPRESS_ERR" ] || COMPRESS_ERR="still over ${MAX_MB} MB after $p"
  rm -f "$o"; return 1
}

wait_stable() { # wait_stable <file>: 0 once the size has stopped changing (a clip still being copied, or an iCloud placeholder filling in)
  local f="$1" a b waited=0
  a="$(fsize "$f")"
  while :; do
    sleep 5; waited=$((waited + 5)); b="$(fsize "$f")"
    [ "$b" = "$a" ] && return 0
    a="$b"; [ "$waited" -ge 90 ] && return 1
  done
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
  # Drop folders (owner, 2026-09-05: "anytime I drop new items into the folder on my desktop, it should … add photos to the
  # gallery"): photographs bound for a gallery/ or range/ folder are web-sized here on the Mac — JPEG, longest side 2000 px,
  # quality 82 — because the cloud container has no image tools; clips get a poster frame beside them (qlmanage ships with
  # macOS) so the tile has a picture. scripts/photo-intake.py turns them into tiles.
  local drop=0; case "$d" in */gallery|*/gallery/*|*/range|*/range/*) drop=1 ;; esac
  case "$e" in
    heic|heif)
      if command -v sips >/dev/null 2>&1 && sips -s format jpeg -s formatOptions 82 $([ "$drop" = 1 ] && echo -Z 2000) "$f" --out "$d/${b%.*}.jpg" >/dev/null 2>&1; then :; else cp "$f" "$d/$b"; fi ;;
    jpg|jpeg|png|webp|tif|tiff)
      if [ "$drop" = 1 ] && command -v sips >/dev/null 2>&1 && sips -s format jpeg -s formatOptions 82 -Z 2000 "$f" --out "$d/${b%.*}.jpg" >/dev/null 2>&1; then :; else cp "$f" "$d/$b"; fi ;;
    mov|mp4|m4v|avi|mkv)
      # The watcher fires the moment a clip appears, often while it is still being written; a clip read too early fails in
      # avconvert and used to be listed for good. Wait for a stable size first; a clip still growing after 90 s is left for
      # the next pass (the hourly job retries the drop folders).
      if ! wait_stable "$f"; then say "  still being written, left for the next pass: $b"; list_skipped "$f" "still copying"; return 2; fi
      s="$(fsize "$f")"
      if [ "$s" -le $((MAX_MB * 1000000)) ]; then cp "$f" "$d/$b"; else
        web="$d/${b%.*}-web.mp4"
        # The sidecar records the source size, so an unchanged source is not recompressed and a changed one is (read from the branch).
        if on_branch "${web#"$W"/}" && [ "$(git -C "$W" show "$BASE:${web#"$W"/}.srcsize" 2>/dev/null)" = "$s" ]; then :
        elif compress_video "$f" "$web"; then printf '%s\n' "$s" > "$web.srcsize"
        else
          say "  too big for GitHub even after compression, listed instead: $b ($((s / 1000000)) MB) — $COMPRESS_ERR"
          list_skipped "$f" "$s bytes; $COMPRESS_ERR"; return 2
        fi
      fi
      if [ "$drop" = 1 ] && ! on_branch "${d#"$W"/}/${b%.*}-poster.png" && [ ! -f "$d/${b%.*}-poster.png" ] && command -v qlmanage >/dev/null 2>&1; then
        qlmanage -t -s 1600 -o "$d" "$f" >/dev/null 2>&1 && [ -f "$d/$b.png" ] && mv "$d/$b.png" "$d/${b%.*}-poster.png"
      fi ;;
    *) cp "$f" "$d/$b" ;;
  esac
}

for src in "${SOURCES[@]}"; do
  if is_url "$src" && is_media_url "$src"; then
    id="$(media_id "$src")"
    # Already on the branch (the file, or its compressed copy) — the id sits in square brackets in the name.
    if [ -n "$id" ] && [ "$id" != "$src" ] && branch_has "[$id]"; then copied=$((copied + 1)); continue; fi
    say "video:  $src"
    d="$(mktemp -d "${TMPDIR:-/tmp}/handoff-dl-XXXXXX")"
    if f="$(fetch_media "$src" "$d")" && [ -n "$f" ] && [ -f "$d/$f" ]; then
      if copy_file "$d/$f" "$OUT"; then copied=$((copied + 1)); else skipped=$((skipped + 1)); fi
    else
      say "video download failed, skipping (save the file into 'MAST NEW WEB 2026' instead): $src"; missing=$((missing + 1))
    fi
    rm -rf "$d"
  elif is_url "$src" && is_page_url "$src"; then
    slug="$(page_slug "$src")"
    say "page:   $src -> $DEST/live/$slug.html"
    dl="$(mktemp -d "${TMPDIR:-/tmp}/handoff-dl-XXXXXX")/$slug.html"
    if curl -fsSL -A "Mozilla/5.0 (Macintosh) mac-handoff" -o "$dl" "$src"; then
      if copy_file "$dl" "$OUT/live"; then copied=$((copied + 1)); else skipped=$((skipped + 1)); fi
      rm -rf "$(dirname "$dl")"
    else
      say "page download failed, skipping: $src"; missing=$((missing + 1))
    fi
  elif is_url "$src"; then
    name="$(basename "$src")"
    # Already on the branch by name (the file, or its compressed copy) → not downloaded again; the branch is read without
    # its blobs, so sizes cannot be compared here. HANDOFF_REFRESH=1 forces a new download; the live site's own files are
    # refreshed daily by .github/workflows/capture-live.yml anyway.
    if [ "${HANDOFF_REFRESH:-0}" != "1" ] && { on_branch "$DEST/$name" || on_branch "$DEST/${name%.*}-web.mp4"; }; then copied=$((copied + 1)); continue; fi
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
      rel="${f#"$src"/}"; sub="$(dirname "$rel")"; sub="${sub#.}"; sub="${sub#/}"; bn="$(basename "$f")"
      # A file the branch already holds under this name (as itself, web-sized, or compressed) is not copied again — the
      # branch is read without its blobs. To send a changed photograph again, give it a new name.
      dd="$DEST/$name${sub:+/$sub}"
      if on_branch "$dd/$bn" || on_branch "$dd/${bn%.*}.jpg" || on_branch "$dd/${bn%.*}-web.mp4"; then copied=$((copied + 1)); continue; fi
      if copy_file "$f" "$OUT/$name${sub:+/$sub}"; then copied=$((copied + 1)); else skipped=$((skipped + 1)); fi
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
git add --sparse -A "$DEST"   # --sparse: the paths sit outside the (empty) sparse cone on purpose
new="$(git diff --cached --name-only | wc -l | tr -d ' ')"
if [ "$new" = "0" ]; then
  say "NOTHING NEW: everything is already on $BRANCH"
else
  git -c user.name="Matthew Brockmann" -c user.email="matthew@atlasglinn.com" \
    commit -q -m "Hand off from Mac: $new file(s) on $(date '+%Y-%m-%d %H:%M')" || die "commit"
  # The capture-live job (GitHub) and other runs commit to this branch too; when one of them lands between step 2 and
  # here the push comes back "non-fast-forward" (owner's Mac, 2026-09-06). Take the new tip, stage the same files on it
  # and push again, up to three times, instead of failing and waiting for a re-run.
  push_ok=0
  for attempt in 1 2 3; do
    git push -q "$REMOTE" "HEAD:refs/heads/$BRANCH" && { push_ok=1; break; }
    say "push rejected (try $attempt of 3): $BRANCH moved meanwhile; putting this hand-off on its new tip"
    (cd "$R" && pfetch "$BRANCH") || break
    tip="$(git -C "$R" rev-parse "refs/handoff/$BRANCH")"
    git reset -q --mixed "$tip" || break        # index = the new tip; the files this run wrote stay on disk
    git add --sparse -A "$DEST"
    new="$(git diff --cached --name-only | wc -l | tr -d ' ')"
    if [ "$new" = "0" ]; then say "NOTHING NEW after all: the new tip already carries these files"; push_ok=1; break; fi
    git -c user.name="Matthew Brockmann" -c user.email="matthew@atlasglinn.com" \
      commit -q -m "Hand off from Mac: $new file(s) on $(date '+%Y-%m-%d %H:%M')" || break
  done
  [ "$push_ok" = 1 ] || die "push (network or GitHub login; if it keeps failing, run it again in a minute)"
fi
total="$(git ls-files "$DEST" | wc -l | tr -d ' ')"
say "DONE: $new new or changed, $copied handled, $skipped listed instead, $missing not found. $total files now on branch $BRANCH."
[ -f "$OUT/SKIPPED.txt" ] && { say "Could not be copied (see the reason after each name):"; cat "$OUT/SKIPPED.txt"; }

# 6. Clean up the worktree; the branch stays.
cd / && git -C "$R" worktree remove --force "$W" >/dev/null 2>&1
exit 0
