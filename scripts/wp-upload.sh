#!/usr/bin/env bash
# Put the static MAST Solutions page and everything it references onto the GoDaddy WordPress host by SFTP, so it is
# served at https://atlasglinn.com/mastsolutions.html while the domain still points at WordPress.
#
# Brockmann runs this from Terminal on the Mac:
#   curl -fsSL https://raw.githubusercontent.com/MatthewBrockmann/atlasglinn-website/main/scripts/wp-upload.sh | bash
# It asks for the SFTP username (GoDaddy → My Products → Managed WordPress → Settings → SFTP/SSH) and sftp itself asks
# for the password. Save them once in the macOS Keychain instead (owner, 2026-09-05: "prompt to load in secret"):
#   bash scripts/wp-upload.sh --save-login      # asks for the username, then the password (hidden); Keychain item "mast-wp-sftp"
# After that every upload reads both from the Keychain and never asks. The password is handed to sftp through
# SSH_ASKPASS at connect time; it is never printed, never in a file, never in git. Files come from a throwaway checkout
# of origin/main (override with REF=...), never from the working tree. A cloud session cannot run this: the container
# has no route to the host.
#
# Steps: 1) fetch REF into a detached worktree  2) list mastsolutions.html + every local file it and its linked
# hand-authored pages reference  3) upload  4) confirm the live page is the new one (registration flow present).
set -euo pipefail
HOST="${WP_SFTP_HOST:-1127220.us12.ssh.myftpupload.com}"   # GoDaddy moved the site 2026-09-03; hp6.9a2 is the old host
DOCROOT="${WP_DOCROOT:-html}"   # the SFTP login lands in the account home; WordPress (the web root) is its html/ folder.
                                # 2026-09-05: the first upload put 113 files into the home directory and nothing was served.
REF="${REF:-origin/main}"
# The MAST page and, since the Atlas Glinn publish (owner, 2026-09-05: "Publish AG preview"), the eleven rebuilt Atlas pages
# with the hand-authored pages they link to. The lister follows the links between these and gathers every asset.
PAGES="${PAGES:-mastsolutions.html privacy.html terms.html mast-capability-statement.html index.html executive-protection.html residential-protection.html disaster-recovery.html training.html technology.html cuas-aerodefense.html uas.html about.html careers.html contact.html ep-app.html signup.html}"
say() { printf '\033[1;36m%s\033[0m\n' "$*"; }
KC_SERVICE="mast-wp-sftp"   # macOS Keychain item: account = SFTP username, password = SFTP password
kc_user() { security find-generic-password -s "$KC_SERVICE" 2>/dev/null | sed -n 's/^ *"acct"<blob>="\(.*\)"$/\1/p'; }

if [ "${1:-}" = "--save-login" ]; then
  command -v security >/dev/null || { echo "the Keychain is macOS-only; run this on the Mac"; exit 1; }
  u=""; read -r -p "SFTP username for $HOST (GoDaddy → Managed WordPress → Settings → Production Site → SFTP/SSH): " u < /dev/tty
  [ -n "$u" ] || { echo "no username"; exit 1; }
  security delete-generic-password -s "$KC_SERVICE" >/dev/null 2>&1 || true
  say "Now the password (typed hidden, asked twice; stored only in your Keychain)"
  security add-generic-password -a "$u" -s "$KC_SERVICE" -l "GoDaddy Managed WordPress SFTP (atlasglinn.com)" -w
  say "Saved in the macOS Keychain as '$KC_SERVICE' for $u. Run the upload again without --save-login."
  exit 0
fi

if [ "${1:-}" = "--probe" ]; then
  # Diagnosis when the live check fails after a clean upload (2026-09-05: 113 files in html/, still HTTP 404): what the
  # site answers from this Mac, with and without a cache-busting query, and what the host's directory layout really is.
  say "HTTP checks from this Mac"
  for u in "https://atlasglinn.com/mast-ping.txt" "https://atlasglinn.com/mast-ping.txt?x=$(date +%s)" "https://www.atlasglinn.com/mast-ping.txt" \
           "https://atlasglinn.com/mastsolutions.html" "https://atlasglinn.com/mastsolutions.html?x=$(date +%s)" \
           "https://atlasglinn.com/images/mast/mast-cqb-poster.jpg" "https://atlasglinn.com/wp-content/uploads/atlas-glinn-logo.png"; do
    printf '   %s -> %s\n' "$u" "$(curl -sL -o /dev/null -m 20 -w '%{http_code}' "$u")"
  done
  say "Directory layout on the host (saved Keychain login)"
  u="$(kc_user || true)"; [ -n "$u" ] || { echo "no saved login; run --save-login first"; exit 1; }
  A="$(mktemp /tmp/wp-upload-askpass.XXXXXX)"; printf '#!/bin/sh\nexec security find-generic-password -s %s -w\n' "$KC_SERVICE" > "$A"; chmod 700 "$A"
  printf 'pwd\nls -la\ncd %s\npwd\nls -la\nls -la wp-content\n' "$DOCROOT" | SSH_ASKPASS="$A" SSH_ASKPASS_REQUIRE=force DISPLAY="${DISPLAY:-:0}" sftp -o StrictHostKeyChecking=accept-new "$u@$HOST" 2>&1 | sed 's/^/   /'
  rm -f "$A"; exit 0
fi

# Which clone: ATLAS_REPO if the caller says (the LaunchAgent), else the clone this runs from, else any clone under $HOME.
# Then a health check: the clone on the iCloud-synced Desktop broke git on 2026-09-05 ("mmap failed: Resource deadlock
# avoided", "bad object refs/remotes/…"), so the hourly job never uploaded. A clone that cannot fetch is replaced by a private
# one under ~/Library/Caches, which iCloud never touches; it is created on first use.
CACHE_REPO="$HOME/Library/Caches/atlasglinn/atlasglinn-website"
export GIT_LFS_SKIP_SMUDGE=1   # the page's clips are plain blobs; the few LFS pointers in the tree stay pointers (no LFS bandwidth)
if [ -n "${ATLAS_REPO:-}" ] && [ -d "$ATLAS_REPO/.git" ]; then R="$ATLAS_REPO"
else
  R="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  case "$(git -C "${R:-.}" remote get-url origin 2>/dev/null || true)" in *atlasglinn-website*) ;; *)
    R="$(find "$HOME" -maxdepth 6 -type d -name .git -path '*/atlasglinn-website/.git' -not -path '*/Library/*' 2>/dev/null | head -1)"; R="${R%/.git}";; esac
fi
# Partial pulls (2026-09-06): blobs over 10 MB are left on GitHub until a checkout needs one. A 44 MB film on main stalled
# the pull on a poor connection ("curl 56 Recv failure", "early EOF") and nothing uploaded; the first pull with the filter
# turns the clone into a partial clone, later pulls keep the setting.
FILTER='--filter=blob:limit=10m'
if [ -z "$R" ] || ! git -C "$R" fetch -q $FILTER origin "${REF#origin/}" 2>/dev/null; then
  say "the clone at ${R:-<none>} cannot fetch; using the private clone at $CACHE_REPO"
  if [ ! -d "$CACHE_REPO/.git" ]; then mkdir -p "$(dirname "$CACHE_REPO")"; git clone -q $FILTER --single-branch -b main https://github.com/MatthewBrockmann/atlasglinn-website.git "$CACHE_REPO"; fi
  R="$CACHE_REPO"; git -C "$R" fetch -q $FILTER origin "${REF#origin/}" || git -C "$R" -c http.version=HTTP/1.1 -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=180 fetch -q $FILTER origin "${REF#origin/}"
fi
# node for the Worker deploy: LaunchAgents do not read the shell profile, so look where nvm, Volta and Homebrew put it.
for d in /opt/homebrew/bin /usr/local/bin "$HOME/.volta/bin" "$HOME"/.nvm/versions/node/*/bin; do [ -x "$d/npx" ] && PATH="$d:$PATH" && break; done; export PATH

W="$(mktemp -d /tmp/wp-upload.XXXXXX)/wt"
cleanup() { cd / ; git -C "$R" worktree remove --force "$W" >/dev/null 2>&1 || true; rm -f "${ASKPASS:-}" 2>/dev/null || true; }
trap cleanup EXIT
say "Fetching $REF"
git -C "$R" fetch -q $FILTER origin "${REF#origin/}"
# --if-changed (the hourly LaunchAgent from scripts/mac-autopilot.sh): upload only when origin/main moved since the last
# successful upload; otherwise say so and stop. The stamp is written after the live check passes.
HEADSHA="$(git -C "$R" rev-parse FETCH_HEAD)"; STAMP="$HOME/.cache/wp-upload/last-uploaded"
# The Worker rides along (owner, 2026-09-05, leaving without a Terminal: "Do it yourself or figure out an easier way"): when
# mast-backend/ moved since the last deploy this Mac made, `wrangler deploy` runs from the clone (it holds node_modules and
# the wrangler login) before the page logic, so the hourly LaunchAgent turns a merge into a running Worker with no paste.
# Secrets and D1 migrations are untouched. WORKER_DEPLOY=0 skips it. Stamp: ~/.cache/wp-upload/last-worker-deploy.
WSTAMP="$HOME/.cache/wp-upload/last-worker-deploy"; mkdir -p "$HOME/.cache/wp-upload"
if [ "${WORKER_DEPLOY:-1}" = 1 ] && [ -d "$R/mast-backend" ]; then
  LASTW="$(cat "$WSTAMP" 2>/dev/null || true)"
  if [ -z "$LASTW" ] || ! git -C "$R" diff --quiet "$LASTW" "$HEADSHA" -- mast-backend/ 2>/dev/null; then
    say "Worker: mast-backend/ moved since ${LASTW:0:7}; deploying ${HEADSHA:0:7}"
    if (cd "$R/mast-backend" && { [ -d node_modules ] || npm install --no-audit --no-fund >/dev/null 2>&1; } && CI=1 npx wrangler deploy); then
      echo "$HEADSHA" > "$WSTAMP"; say "Worker deployed from ${HEADSHA:0:7}"
    else
      echo "   Worker deploy failed (is wrangler logged in on this Mac? run: cd \"$R/mast-backend\" && npx wrangler whoami). The page upload continues."
    fi
  else
    say "Worker: up to date (${LASTW:0:7})"
  fi
fi
if [ "${1:-}" = "--if-changed" ] && [ -f "$STAMP" ] && [ "$(cat "$STAMP")" = "$HEADSHA" ]; then
  say "up to date: ${HEADSHA:0:7} is already the uploaded page"; exit 0
fi
git -C "$R" worktree add -q --detach "$W" FETCH_HEAD
cd "$W"

say "Listing files"
# The lister is written to a file first: macOS ships bash 3.2, whose $(...) parser trips over the parentheses of a regex
# inside a heredoc ("syntax error near unexpected token `('", owner's terminal 2026-09-05).
PYLIST="$(mktemp /tmp/wp-upload-list.XXXXXX)"
cat > "$PYLIST" <<'PY'
import os, re, sys
pages = sys.argv[1].split(); seen = []; queue = list(pages)
# attributes, CSS url(), the three.js module import, and JS string literals such as the media strip's clip paths
attr = re.compile(r'''(?:src|href|poster)=["']([^"'#?]+)|url\(['"]?([^)'"?#]+)|from\s+['"]\.?/?([^'"]+\.js)['"]|['"]((?:images|vendor)/[^'"?#\s]+)['"]''')
while queue:
    p = queue.pop(0)
    if p in seen or not os.path.isfile(p): continue
    seen.append(p)
    if not p.endswith('.html'): continue
    for m in attr.finditer(open(p, encoding='utf-8', errors='ignore').read()):
        u = (m.group(1) or m.group(2) or m.group(3) or m.group(4) or '').strip()
        if not u or u.startswith(('http', '//', 'mailto:', 'tel:', 'data:', 'javascript:')): continue
        u = os.path.normpath(os.path.join(os.path.dirname(p), u))
        if u.startswith('..'): continue
        if u.endswith('.html') and os.path.basename(u) not in pages and u not in pages: continue   # links to the wider site stay on WordPress
        queue.append(u)
print('\n'.join(seen))
PY
LIST="$(python3 "$PYLIST" "$PAGES")"
rm -f "$PYLIST"
COUNT=$(printf '%s\n' "$LIST" | grep -c .)
SIZE=$(printf '%s\n' "$LIST" | python3 -c 'import os, sys; s = sum(os.path.getsize(l.strip()) for l in sys.stdin if l.strip()); print("%.1f MB" % (s / 1048576))')
printf '%s\n' "$LIST" | sed 's/^/   /'
say "$COUNT files, $SIZE"
[ "${DRY_RUN:-0}" = 1 ] && exit 0

# Read from the terminal, not stdin: under `curl … | bash` stdin IS the script, and a plain `read` swallowed the next
# script line as the username ("remote username contains invalid characters", owner's terminal 2026-09-05).
SFTP_USER="$(kc_user || true)"; ASKPASS=""
if [ -n "$SFTP_USER" ]; then
  # Saved login: sftp gets the password from the Keychain through SSH_ASKPASS (OpenSSH 8.4+ honours SSH_ASKPASS_REQUIRE=force
  # even on a terminal; an older ssh simply asks on the terminal instead). The helper only ever runs `security … -w`.
  say "Using the SFTP login saved in the Keychain ($SFTP_USER)"
  ASKPASS="$(mktemp /tmp/wp-upload-askpass.XXXXXX)"
  printf '#!/bin/sh\nexec security find-generic-password -s %s -w\n' "$KC_SERVICE" > "$ASKPASS"; chmod 700 "$ASKPASS"
  export SSH_ASKPASS="$ASKPASS" SSH_ASKPASS_REQUIRE=force DISPLAY="${DISPLAY:-:0}"
else
  read -r -p "SFTP username for $HOST (GoDaddy → Managed WordPress → Settings → SFTP/SSH; or save it once with --save-login): " SFTP_USER < /dev/tty || { echo "needs a terminal to ask for the username"; exit 1; }
  [ -n "$SFTP_USER" ] || { echo "no username"; exit 1; }
fi
BATCH="$(mktemp /tmp/wp-upload-batch.XXXXXX)"
{
  echo "cd $DOCROOT"   # no leading dash: if the web root is not there the batch stops instead of filling the home directory
  printf '%s\n' "$LIST" | xargs -I{} dirname {} | sort -u | grep -v '^\.$' | awk '{ n=split($0,a,"/"); p=""; for(i=1;i<=n;i++){ p=(p==""?a[i]:p"/"a[i]); print "-mkdir " p } }' | sort -u
  printf '%s\n' "$LIST" | awk '{ print "put " $0 " " $0 }'
  echo "put -P mast-ping.txt mast-ping.txt"
} > "$BATCH"
echo "served by upload $(date -u +%FT%TZ)" > mast-ping.txt
if [ -n "$ASKPASS" ]; then say "Uploading $COUNT files to $SFTP_USER@$HOST:$DOCROOT/ (password from the Keychain)"
else say "Uploading $COUNT files to $SFTP_USER@$HOST:$DOCROOT/ (password prompt comes from sftp; typing is hidden)"; fi
sftp -o StrictHostKeyChecking=accept-new "$SFTP_USER@$HOST" < "$BATCH"
rm -f "$BATCH"; [ -n "$ASKPASS" ] && rm -f "$ASKPASS"

say "Checking the live site"
sleep 2
# -L: the site answers on www.atlasglinn.com and redirects the bare domain; the checks follow that. The page itself is the
# check that matters; a cache-busting query gets past the host's page cache (2026-09-05: the page was live in the browser
# while a stale 404 for the ping file made this step report failure).
TS="$(date +%s)"
if curl -sfL "https://atlasglinn.com/mastsolutions.html?x=$TS" | grep -q 'reg-steps'; then
  echo "   https://atlasglinn.com/mastsolutions.html is the new page (registration flow present)"
else
  echo "   mastsolutions.html is NOT the new page yet (HTTP $(curl -sL -o /dev/null -w '%{http_code}' "https://atlasglinn.com/mastsolutions.html?x=$TS")). The files went to $DOCROOT/ under the SFTP home; if that is not the web root, re-run with WP_DOCROOT=<folder>. Tell Claude."; exit 3
fi
if curl -sfL "https://atlasglinn.com/mast-ping.txt?x=$TS" | grep -q "served by upload"; then
  echo "   the ping file from this upload is served (no stale cache in the way)"
else
  echo "   note: mast-ping.txt still shows an older copy or a 404; the host's cache is holding it. The page above is what counts."
fi
for a in images/mast/mast-cqb-poster.jpg vendor/three.module.js; do
  code=$(curl -sL -o /dev/null -w '%{http_code}' "https://atlasglinn.com/$a"); echo "   $a → $code"
done
mkdir -p "$(dirname "$STAMP")" && printf '%s\n' "$HEADSHA" > "$STAMP"
say "Done. Open https://atlasglinn.com/mastsolutions.html on your phone."
