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
# hand-authored pages reference  3) list the host's sizes and upload only what is missing, in batches of ten with retries
# (a dropped connection costs one batch; the next run resumes)  4) confirm the live page is the new one and say whether the
# host's cache still serves the previous one.
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
cleanup() { cd / ; git -C "$R" worktree remove --force "$W" >/dev/null 2>&1 || true; rm -f "${ASKPASS:-}" 2>/dev/null || true; [ -n "${TMPD:-}" ] && rm -rf "$TMPD" 2>/dev/null || true; }
trap cleanup EXIT
say "Fetching $REF"
# Into the remote-tracking ref, never FETCH_HEAD: the handoff agent shares this clone, and its fetch of the handoff branch
# overwrote FETCH_HEAD between this fetch and the read below (owner's Mac, 2026-09-06: "Worker deployed from 70170fc", a
# handoff-branch commit; the page worktree would have been that branch's old tree).
REFB="${REF#origin/}"
git -C "$R" fetch -q $FILTER origin "+refs/heads/$REFB:refs/remotes/origin/$REFB"
# --if-changed (the hourly LaunchAgent from scripts/mac-autopilot.sh): upload only when origin/main moved since the last
# successful upload; otherwise say so and stop. The stamp is written after the live check passes.
HEADSHA="$(git -C "$R" rev-parse "refs/remotes/origin/$REFB")"; STAMP="$HOME/.cache/wp-upload/last-uploaded"
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
git -C "$R" worktree add -q --detach "$W" "$HEADSHA"
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
# Resumable upload (2026-09-06, hotel Wi-Fi: "Connection closed by remote host … Broken pipe" at file 90 of 120, and the
# next hour started the whole batch from the first file again). The host's sizes are listed first; a file already there at
# its local size is not sent again (pages are always sent: a regenerated page can keep its size). What remains goes in
# batches of ten, each its own sftp session with three tries, so a dropped connection costs one batch and the next run
# resumes with only what is missing. Keepalives hold a session through the slow transfers. stdin, not -b: -b switches on
# BatchMode, which refuses the Keychain password.
SFTP_OPTS="-o StrictHostKeyChecking=accept-new -o ServerAliveInterval=15 -o ServerAliveCountMax=4 -o ConnectTimeout=40"
TMPD="$(mktemp -d /tmp/wp-upload-batches.XXXXXX)"
sftp_run() { sftp $SFTP_OPTS "$SFTP_USER@$HOST" < "$1"; }
remote_sizes() {   # "<size>TAB<path>" for every regular file in the directories the list touches (ls -ln: the client formats
                   # the line and prefixes the directory; the echoed command line names the directory as a fallback)
  { echo "cd $DOCROOT"; echo "-ls -ln"; printf '%s\n' "$LIST" | xargs -I{} dirname {} | sort -u | grep -v '^\.$' | sed 's/^/-ls -ln /' || true; } > "$TMPD/ls"
  sftp_run "$TMPD/ls" 2>/dev/null | awk '/^sftp> *-?ls -ln/ { cur = ($NF ~ /^-ln$/) ? "" : $NF; next }
    $1 ~ /^-/ && NF >= 9 { n = $9; for (i = 10; i <= NF; i++) n = n " " $i; if (cur != "" && index(n, "/") == 0) n = cur "/" n; print $5 "\t" n }' || true
}
compare() {   # $1 list  $2 remote sizes  $3 out: the files to send; prints the summary
python3 - "$1" "$2" "$3" "${4:-send}" <<'PY'
import os, sys
lst = [l.strip() for l in open(sys.argv[1]) if l.strip()]
remote = {}
for line in open(sys.argv[2]):
    if '\t' not in line: continue
    size, name = line.rstrip('\n').split('\t', 1)
    if size.isdigit(): remote[name.strip()] = int(size)
if sys.argv[4] == 'send':
    todo = [p for p in lst if p.endswith('.html') or remote.get(p) != os.path.getsize(p)]
    open(sys.argv[3], 'w').write(''.join(p + '\n' for p in todo))
    mb = sum(os.path.getsize(p) for p in todo) / 1048576
    note = '' if remote else ' (the host listed nothing, so everything goes)'
    print('   %d of %d files are already on the host at their size; sending %d (%.1f MB)%s' % (len(lst) - len(todo), len(lst), len(todo), mb, note))
else:
    if not remote: print('   could not list the host afterwards; the next run checks again'); sys.exit(0)
    missing = [p for p in lst if remote.get(p) != os.path.getsize(p)]
    open(sys.argv[3], 'w').write(''.join(p + '\n' for p in missing))
    if missing: print('   NOT on the host at their size after this run (%d): %s%s' % (len(missing), ', '.join(missing[:6]), ' …' if len(missing) > 6 else ''))
    else: print('   verified: all %d files are on the host at their size' % len(lst))
PY
}
say "Comparing with the host"
printf '%s\n' "$LIST" > "$TMPD/list"
remote_sizes > "$TMPD/remote"
compare "$TMPD/list" "$TMPD/remote" "$TMPD/todo"
NEED="$(grep -c . "$TMPD/todo" || true)"
echo "served by upload $(date -u +%FT%TZ)" > mast-ping.txt
if [ "$NEED" = 0 ]; then
  say "Nothing to send: every file is on the host already"
else
  if [ -n "$ASKPASS" ]; then say "Uploading $NEED files to $SFTP_USER@$HOST:$DOCROOT/ in batches of 10 (password from the Keychain)"
  else say "Uploading $NEED files to $SFTP_USER@$HOST:$DOCROOT/ in batches of 10 (password prompt comes from sftp; typing is hidden)"; fi
  { echo "cd $DOCROOT"   # no leading dash: if the web root is not there the batch stops instead of filling the home directory
    xargs -I{} dirname {} < "$TMPD/todo" | sort -u | grep -v '^\.$' | awk '{ n=split($0,a,"/"); p=""; for(i=1;i<=n;i++){ p=(p==""?a[i]:p"/"a[i]); print "-mkdir " p } }' | sort -u || true
  } > "$TMPD/mk"
  sftp_run "$TMPD/mk" >/dev/null 2>&1 || true
  split -l 10 "$TMPD/todo" "$TMPD/part."
  sent=0; failed=0
  for part in "$TMPD"/part.*; do
    n="$(grep -c . "$part" || true)"
    { echo "cd $DOCROOT"; awk '{ print "put " $0 " " $0 }' "$part"; } > "$BATCH"
    ok=0
    for try in 1 2 3; do
      if sftp_run "$BATCH" > "$TMPD/log" 2>&1; then ok=1; break; fi
      echo "   batch of $n: connection lost on try $try ($(grep -v '^sftp>' "$TMPD/log" | tail -1 | cut -c1-80)); retrying in 8 s"; sleep 8
    done
    if [ "$ok" = 1 ]; then sent=$((sent + n)); echo "   $sent of $NEED sent (through $(tail -n 1 "$part"))"
    else failed=$((failed + n)); echo "   batch of $n gave up after 3 tries; the next run resends what is missing"; fi
  done
  { echo "cd $DOCROOT"; echo "put -P mast-ping.txt mast-ping.txt"; } > "$BATCH"; sftp_run "$BATCH" >/dev/null 2>&1 || true
  remote_sizes > "$TMPD/remote2"
  compare "$TMPD/list" "$TMPD/remote2" "$TMPD/missing" verify
  [ "$failed" = 0 ] || say "$failed files did not go up this run. Run the upload again (or let the hourly job): it resumes with only the missing files."
fi
rm -f "$BATCH"

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
# The host answers through Cloudflare and marks the static pages "cache-control: public, max-age=2678400" (31 days); the
# plain address keeps serving whatever copy an edge cached first, long after an upload (probe 2026-09-06: the plain
# /mastsolutions.html was a day-old build, age 77357 s, HIT, while ?x= fetched the new one). Say so, with the way out.
hdrs() { curl -sL -A "wp-upload-check" -o /dev/null -D - "$1" 2>/dev/null | tr -d '\r' | awk -v k="$2" 'tolower($1)==k":" {sub(/^[^:]*: */,""); v=$0} END{print v}' || true; }   # last block: the final answer after any redirect; never fails under set -e
NEW_LM="$(hdrs "https://atlasglinn.com/mastsolutions.html?x=$TS" last-modified)"
PLAIN_LM="$(hdrs "https://atlasglinn.com/mastsolutions.html" last-modified)"
PLAIN_CF="$(hdrs "https://atlasglinn.com/mastsolutions.html" cf-cache-status)"
PLAIN_AGE="$(hdrs "https://atlasglinn.com/mastsolutions.html" age)"
if [ -n "$NEW_LM" ] && [ -n "$PLAIN_LM" ] && [ "$NEW_LM" != "$PLAIN_LM" ]; then
  echo "   CACHE: the plain address https://atlasglinn.com/mastsolutions.html still serves the page uploaded $PLAIN_LM (Cloudflare ${PLAIN_CF:-?}, age ${PLAIN_AGE:-?} s); this upload is $NEW_LM."
  echo "   Visitors see the old page until the host's cache is flushed: GoDaddy → My Products → Managed WordPress → atlasglinn.com → Manage → Flush Cache. Same for /index.html and the other pages."
elif [ -n "$PLAIN_LM" ]; then
  echo "   the plain address serves this upload ($PLAIN_LM, Cloudflare ${PLAIN_CF:-?})"
fi
for a in images/mast/mast-cqb-poster.jpg vendor/three.module.js; do
  code=$(curl -sL -o /dev/null -w '%{http_code}' "https://atlasglinn.com/$a"); echo "   $a → $code"
done
mkdir -p "$(dirname "$STAMP")" && printf '%s\n' "$HEADSHA" > "$STAMP"
say "Done. Open https://atlasglinn.com/mastsolutions.html on your phone."
