#!/usr/bin/env bash
# Put the static MAST Solutions page and everything it references onto the GoDaddy WordPress host by SFTP, so it is
# served at https://atlasglinn.com/mastsolutions.html while the domain still points at WordPress.
#
# Brockmann runs this from Terminal on the Mac:
#   curl -fsSL https://raw.githubusercontent.com/MatthewBrockmann/atlasglinn-website/main/scripts/wp-upload.sh | bash
# It asks for the SFTP username (GoDaddy → My Products → Managed WordPress → Settings → SFTP/SSH) and sftp itself asks
# for the password. Nothing is stored. Files come from a throwaway checkout of origin/main (override with REF=...),
# never from the working tree. A cloud session cannot run this: the container has no route to the host.
#
# Steps: 1) fetch REF into a detached worktree  2) list mastsolutions.html + every local file it and its linked
# hand-authored pages reference  3) upload  4) confirm the live page is the new one (registration flow present).
set -euo pipefail
HOST="${WP_SFTP_HOST:-1127220.us12.ssh.myftpupload.com}"   # GoDaddy moved the site 2026-09-03; hp6.9a2 is the old host
REF="${REF:-origin/main}"
PAGES="${PAGES:-mastsolutions.html privacy.html terms.html mast-capability-statement.html}"
say() { printf '\033[1;36m%s\033[0m\n' "$*"; }

R="$(git rev-parse --show-toplevel 2>/dev/null || true)"
case "$(git -C "${R:-.}" remote get-url origin 2>/dev/null || true)" in *atlasglinn-website*) ;; *)
  R="$(find "$HOME" -maxdepth 6 -type d -name .git -path '*/atlasglinn-website/.git' -not -path '*/Library/*' 2>/dev/null | head -1)"; R="${R%/.git}";; esac
[ -n "$R" ] || { echo "no atlasglinn-website clone found under $HOME"; exit 1; }

W="$(mktemp -d /tmp/wp-upload.XXXXXX)/wt"
cleanup() { cd / ; git -C "$R" worktree remove --force "$W" >/dev/null 2>&1 || true; }
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

read -r -p "SFTP username for $HOST (GoDaddy → Managed WordPress → Settings → SFTP/SSH): " USER
[ -n "$USER" ] || { echo "no username"; exit 1; }
BATCH="$(mktemp /tmp/wp-upload-batch.XXXXXX)"
{
  printf '%s\n' "$LIST" | xargs -I{} dirname {} | sort -u | grep -v '^\.$' | awk '{ n=split($0,a,"/"); p=""; for(i=1;i<=n;i++){ p=(p==""?a[i]:p"/"a[i]); print "-mkdir " p } }' | sort -u
  printf '%s\n' "$LIST" | awk '{ print "put " $0 " " $0 }'
  echo "put -P mast-ping.txt mast-ping.txt"
} > "$BATCH"
echo "served by upload $(date -u +%FT%TZ)" > mast-ping.txt
say "Uploading $COUNT files to $USER@$HOST (password prompt comes from sftp; typing is hidden)"
sftp -o StrictHostKeyChecking=accept-new "$USER@$HOST" < "$BATCH"
rm -f "$BATCH"

say "Checking the live site"
sleep 2
if curl -sf "https://atlasglinn.com/mast-ping.txt" | grep -q "served by upload"; then
  echo "   static files are served from the WordPress root"
else
  echo "   atlasglinn.com/mast-ping.txt is NOT served: the host does not serve static files from the root. Stop here and tell Claude."; exit 2
fi
if curl -sf "https://atlasglinn.com/mastsolutions.html" | grep -q 'reg-steps'; then
  echo "   https://atlasglinn.com/mastsolutions.html is the new page (registration flow present)"
else
  echo "   mastsolutions.html is reachable but is NOT the new page (no registration flow in it). Tell Claude."; exit 3
fi
for a in images/mast/mast-cqb-poster.jpg vendor/three.module.js; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "https://atlasglinn.com/$a"); echo "   $a → $code"
done
say "Done. Open https://atlasglinn.com/mastsolutions.html on your phone."
