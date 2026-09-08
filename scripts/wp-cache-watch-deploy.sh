#!/usr/bin/env bash
# Put the atlas-cache-watch must-use plugin on the GoDaddy WordPress host over SFTP and confirm from the outside that it
# is running.
#
# Why (measured 2026-09-08 18:46 UTC): the saved GoDaddy login `mast-wp-sftp` answers "This service allows sftp
# connections only." — no shell, so WP-CLI cannot run the dashboard's flush cascade from this Mac — and the WordPress
# application password is not in this Mac's Keychain either. SFTP is what still works, so the cascade travels as a file:
# wp-ops/atlas-cache-watch.php lands in html/wp-content/mu-plugins/ and runs the same WPaaS\Cache_V2 cascade from
# WP-Cron within 15 minutes of an upload, plus immediately when the private `cache-bust` page is saved.
#
#   bash scripts/wp-cache-watch-deploy.sh            # upload, then confirm the X-Atlas-Cache-Watch header
#   bash scripts/wp-cache-watch-deploy.sh --remove   # delete it from the host, then confirm the header is gone
#
# The login is the Keychain item `mast-wp-sftp` (saved once by `bash scripts/wp-upload.sh --save-login`), handed to sftp
# through SSH_ASKPASS exactly as the upload does: never printed, never in a file, never in git. The check uses a
# cache-busting query string because GoDaddy's page cache can answer a plain URL at the edge, without WordPress and so
# without the header; when the header is still absent the run says so plainly and retries once after 15 s.
# Heartbeat: ~/.cache/wp-upload/last-watch-deploy = "<time> <version> <result>". The log path is printed either way and
# the log is emailed when ~/.claude/bin/atlas-email is present. Exit is non-zero when the header never appears.
set -u
HOST="${WP_SFTP_HOST:-1127220.us12.ssh.myftpupload.com}"
DOCROOT="${WP_DOCROOT:-html}"
WP_BASE="${WP_BASE:-https://www.atlasglinn.com}"
KC_SERVICE="${KC_SFTP:-mast-wp-sftp}"
REMOTE="$DOCROOT/wp-content/mu-plugins/atlas-cache-watch.php"
RAW="https://raw.githubusercontent.com/MatthewBrockmann/atlasglinn-website/main/wp-ops/atlas-cache-watch.php"
LOG="$HOME/.cache/wp-upload/wp-cache-watch-deploy.log"
STAMP="$HOME/.cache/wp-upload/last-watch-deploy"
mkdir -p "$(dirname "$LOG")"; : > "$LOG"
say() { printf '%s\n' "$*" | tee -a "$LOG"; }
TS="$(date -u +%FT%TZ)"
MODE=install; [ "${1:-}" = "--remove" ] && MODE=remove

# The file to send: the one beside this script in the clone, or — when the script is run through `curl … | bash` — the
# copy on main. Never the working tree of another checkout.
SELF="${BASH_SOURCE[0]:-$0}"
ROOT="$(cd "$(dirname "$SELF")/.." 2>/dev/null && pwd || true)"
SRC="${ATLAS_WATCH_SRC:-${ROOT:-.}/wp-ops/atlas-cache-watch.php}"
TMPSRC=""; B=""; A=""
if [ "$MODE" = install ] && [ ! -f "$SRC" ]; then
  TMPSRC="$(mktemp /tmp/atlas-cache-watch.XXXXXX)"
  if curl -fsSL -m 30 "$RAW" -o "$TMPSRC"; then SRC="$TMPSRC"; say "source: $RAW (no wp-ops/atlas-cache-watch.php beside this script)"
  else say "no wp-ops/atlas-cache-watch.php beside this script and $RAW could not be fetched"; exit 1; fi
fi
VER="-"
[ -f "$SRC" ] && VER="$(sed -n "s/.*ATLAS_CACHE_WATCH_VERSION', *'\([^']*\)'.*/\1/p" "$SRC" | head -1)"
if [ "$MODE" = install ]; then
  [ -n "$VER" ] || { say "no ATLAS_CACHE_WATCH_VERSION in $SRC"; exit 1; }
  if command -v php >/dev/null 2>&1; then
    php -l "$SRC" >/dev/null 2>&1 || { say "php -l failed on $SRC; nothing was uploaded"; exit 1; }
  fi
  say "atlas-cache-watch v$VER → $HOST:$REMOTE ($(wc -c < "$SRC" | tr -d ' ') bytes)"
else
  say "removing $HOST:$REMOTE"
fi

command -v security >/dev/null 2>&1 || { say "the Keychain is macOS-only; run this on the Mac"; exit 1; }
U="$(security find-generic-password -s "$KC_SERVICE" 2>/dev/null | sed -n 's/^ *"acct"<blob>="\(.*\)"$/\1/p')"
[ -n "$U" ] || { say "no Keychain item '$KC_SERVICE' (the SFTP login); save it once: bash scripts/wp-upload.sh --save-login"; exit 1; }
A="$(mktemp /tmp/wp-watch-askpass.XXXXXX)"
printf '#!/bin/sh\nexec security find-generic-password -s %s -w\n' "$KC_SERVICE" > "$A"; chmod 700 "$A"
export SSH_ASKPASS="$A" SSH_ASKPASS_REQUIRE=force DISPLAY="${DISPLAY:-:0}"
trap 'rm -f -- "$A" ${TMPSRC:+"$TMPSRC"} ${B:+"$B"}' EXIT

# stdin, not -b: -b switches on BatchMode, which refuses the Keychain password (scripts/wp-upload.sh, 2026-09-05). The
# leading dash on -mkdir/-rm keeps the batch going when the directory is already there or the file is already gone.
B="$(mktemp /tmp/wp-watch-batch.XXXXXX)"
if [ "$MODE" = install ]; then
  { printf -- '-mkdir "%s/wp-content/mu-plugins"\n' "$DOCROOT"
    printf -- 'put "%s" "%s"\n' "$SRC" "$REMOTE"; } > "$B"
else
  printf -- '-rm "%s"\n' "$REMOTE" > "$B"
fi
say "sftp batch:"; sed 's/^/   /' "$B" | tee -a "$LOG"
out="$(sftp -o StrictHostKeyChecking=accept-new -o ConnectTimeout=40 -o ServerAliveInterval=15 "$U@$HOST" < "$B" 2>&1)"; rc=$?
say "sftp $U@$HOST → exit $rc: $(printf '%s' "$out" | grep -v '^sftp> *$' | tr '\n' ' ' | cut -c1-300)"

# The check must reach WordPress, not the edge: a cached answer for a plain URL never runs a single line of PHP and so
# carries no header. The query string is the URL the CDN has not seen.
watch_header() {
  curl -sI -m 30 -A "wp-cache-watch-deploy" "$WP_BASE/?atlas-watch=$(date +%s)" 2>/dev/null \
    | tr -d '\r' | awk 'tolower($1)=="x-atlas-cache-watch:" {sub(/^[^:]*: */, ""); v=$0} END{print v}'
}
say "verify: curl -sI \"$WP_BASE/?atlas-watch=\$(date +%s)\" | grep X-Atlas-Cache-Watch"
hv="$(watch_header)"
result="failed"
if [ "$MODE" = install ]; then
  if [ -z "$hv" ]; then
    say "verify: no X-Atlas-Cache-Watch header yet (the host may have answered from its page cache); retrying once in 15 s"
    sleep 15; hv="$(watch_header)"
  fi
  case "$hv" in
    "$VER;"*) result="deployed"; say "verify: X-Atlas-Cache-Watch: $hv — v$VER is loaded on the host";;
    "")       result="header-absent"; say "verify: still no X-Atlas-Cache-Watch header after the retry — the plugin is not loading (wrong docroot, mu-plugins not read, or every answer came from the edge). Nothing else on the host was changed.";;
    *)        result="version-mismatch"; say "verify: the host answers X-Atlas-Cache-Watch: $hv, but the file just sent is v$VER — an older copy is still loaded";;
  esac
  case "$hv" in
    *last=*) u="${hv#*last=}"; u="${u%%;*}"; c="${hv#*cdn=}"
      if [ "${u:-0}" -gt 0 ] 2>/dev/null; then
        say "   last purge $(date -r "$u" -u +%FT%TZ 2>/dev/null || date -u -d "@$u" +%FT%TZ 2>/dev/null || printf '%s' "$u") (cdn=$c)"
      else
        say "   no purge recorded yet: the first tick only records the fingerprint, the next change purges (within 15 min of an upload)"
      fi;;
  esac
else
  if [ -n "$hv" ]; then say "verify: the header is still there ($hv); retrying once in 15 s"; sleep 15; hv="$(watch_header)"; fi
  if [ -z "$hv" ]; then result="removed"; say "verify: no X-Atlas-Cache-Watch header — the plugin is gone from the host"
  else result="still-present"; say "verify: X-Atlas-Cache-Watch: $hv is still served; the file was not removed"; fi
fi

printf '%s %s %s\n' "$TS" "$VER" "$result" > "$STAMP"
case "$result" in
  deployed) say "LOOP STATUS: atlas-cache-watch — DEPLOYED-OBSERVED (X-Atlas-Cache-Watch v$VER answered by the host); heartbeat $STAMP ✓";;
  removed)  say "LOOP STATUS: atlas-cache-watch — removed from the host (header gone); heartbeat $STAMP ✓";;
  *)        say "LOOP STATUS: atlas-cache-watch — $result; the watcher is NOT confirmed running. Heartbeat $STAMP.";;
esac
EMAIL="$HOME/.claude/bin/atlas-email"
if [ -x "$EMAIL" ]; then
  if "$EMAIL" "wp-cache-watch-deploy $TS — $result" < "$LOG" >/dev/null 2>&1; then say "emailed to matthew@atlasglinn.com"
  else say "the email helper $EMAIL refused the send (it is called with the subject as the first argument and the log on stdin); read the log instead"; fi
else
  say "no ~/.claude/bin/atlas-email on this Mac; nothing emailed"
fi
say "log: $LOG"
case "$result" in deployed|removed) exit 0;; *) exit 1;; esac
