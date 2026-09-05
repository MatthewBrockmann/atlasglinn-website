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
PAGES="${PAGES:-mastsolutions.html privacy.html terms.html mast-capability-statement.html}"
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

R="$(git rev-parse --show-toplevel 2>/dev/null || true)"
case "$(git -C "${R:-.}" remote get-url origin 2>/dev/null || true)" in *atlasglinn-website*) ;; *)
  R="$(find "$HOME" -maxdepth 6 -type d -name .git -path '*/atlasglinn-website/.git' -not -path '*/Library/*' 2>/dev/null | head -1)"; R="${R%/.git}";; esac
[ -n "$R" ] || { echo "no atlasglinn-website clone found under $HOME"; exit 1; }

W="$(mktemp -d /tmp/wp-upload.XXXXXX)/wt"
cleanup() { cd / ; git -C "$R" worktree remove --force "$W" >/dev/null 2>&1 || true; rm -f "${ASKPASS:-}" 2>/dev/null || true; }
trap cleanup EXIT
say "Fetching $REF"
git -C "$R" fetch -q origin "${REF#origin/}"
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
say "Done. Open https://atlasglinn.com/mastsolutions.html on your phone."
