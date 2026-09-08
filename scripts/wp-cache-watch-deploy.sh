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
# The file sent is always wp-ops/atlas-cache-watch.php from the checkout this script runs in (ATLAS_WATCH_SRC overrides
# it). There is no download fallback: fetching the plugin from a branch over HTTP would put unpinned remote code into
# production, so a missing file is an error, not something to work around.
#
# The login is the Keychain item `mast-wp-sftp` (saved once by `bash scripts/wp-upload.sh --save-login`), handed to sftp
# through SSH_ASKPASS exactly as the upload does: never printed, never in a file, never in git.
#
# This run fails closed, three ways, because "the header looked right" is not proof that this deploy did anything:
#   1. sftp's exit code is tested. A failed put or a failed rm ends the run non-zero with `upload-failed` / `rm-failed`
#      in the heartbeat — it never goes on to read a header that a PREVIOUS deploy left working.
#   2. The version is not enough: a same-version copy already on the host answers identically. The plugin publishes
#      b=<first 8 of sha1 of its own file>, and this script compares that with the sha1 of the file it just sent, so
#      only the exact bytes uploaded count as deployed. Absent or mismatched (opcache holding the old file) → one retry
#      after 15 s, then non-zero with the SERVED value recorded in the heartbeat.
#   3. --remove reads the HTTP status too. "No header" on a 500 or a dead connection is not a removal, it is an unknown:
#      only a 2xx/3xx answer WITHOUT the header is `removed`; anything else exits non-zero as `unknown`.
# --remove deletes the file and stops the watcher, but LEAVES its two options and its cron event in the database (a
# must-use plugin gets no uninstall hook). To clear those, put define('ATLAS_CACHE_WATCH_UNINSTALL', true); in
# wp-config.php and load one page before removing the file — the plugin then deletes both options, drops the lock,
# unschedules the tick, and does nothing else.
#
# The check uses a cache-busting query string because GoDaddy's page cache can answer a plain URL at the edge, without
# WordPress and so without the header. Heartbeat: ~/.cache/wp-upload/last-watch-deploy =
# "<time> <version> <result> served=<header|none> http=<code>". The log path is printed either way and the log is
# emailed when ~/.claude/bin/atlas-email is present.
#
# Tests: bash scripts/tests/wp-cache-watch-deploy-test.sh (stub sftp/curl/security/shasum/sleep, no host touched).
set -u
HOST="${WP_SFTP_HOST:-1127220.us12.ssh.myftpupload.com}"
DOCROOT="${WP_DOCROOT:-html}"
WP_BASE="${WP_BASE:-https://www.atlasglinn.com}"
KC_SERVICE="${KC_SFTP:-mast-wp-sftp}"
REMOTE="$DOCROOT/wp-content/mu-plugins/atlas-cache-watch.php"
LOG="$HOME/.cache/wp-upload/wp-cache-watch-deploy.log"
STAMP="$HOME/.cache/wp-upload/last-watch-deploy"
mkdir -p "$(dirname "$LOG")"; : > "$LOG"
say() { printf '%s\n' "$*" | tee -a "$LOG"; }
TS="$(date -u +%FT%TZ)"
MODE=install; [ "${1:-}" = "--remove" ] && MODE=remove

SELF="${BASH_SOURCE[0]:-$0}"
ROOT="$(cd "$(dirname "$SELF")/.." 2>/dev/null && pwd || true)"
SRC="${ATLAS_WATCH_SRC:-${ROOT:-.}/wp-ops/atlas-cache-watch.php}"
B=""; A=""
VER="-"; FP=""

sha1_of() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 1 "$1" 2>/dev/null | awk '{print $1}'
  elif command -v sha1sum >/dev/null 2>&1; then sha1sum "$1" 2>/dev/null | awk '{print $1}'
  elif command -v openssl >/dev/null 2>&1; then openssl dgst -sha1 "$1" 2>/dev/null | awk '{print $NF}'
  else printf ''
  fi
}

stamp() { printf '%s %s %s served=%s http=%s\n' "$TS" "$VER" "$1" "${2:-none}" "${3:-none}" > "$STAMP"; }

if [ "$MODE" = install ]; then
  [ -f "$SRC" ] || { say "no plugin at $SRC — this script sends the file from its own checkout and never downloads one; run it from a clone of atlasglinn-website (or set ATLAS_WATCH_SRC)"; exit 1; }
  VER="$(sed -n "s/.*ATLAS_CACHE_WATCH_VERSION', *'\([^']*\)'.*/\1/p" "$SRC" | head -1)"
  [ -n "$VER" ] || { say "no ATLAS_CACHE_WATCH_VERSION in $SRC"; exit 1; }
  if command -v php >/dev/null 2>&1; then
    php -l "$SRC" >/dev/null 2>&1 || { say "php -l failed on $SRC; nothing was uploaded"; exit 1; }
  fi
  FP="$(sha1_of "$SRC" | cut -c1-8)"
  [ -n "$FP" ] || { say "no shasum/sha1sum/openssl on this Mac, so the build fingerprint the host publishes cannot be checked against the file being sent — that check is the only thing that distinguishes this deploy from a same-version copy already on the host. Nothing was uploaded."; exit 1; }
  say "atlas-cache-watch v$VER build $FP → $HOST:$REMOTE ($(wc -c < "$SRC" | tr -d ' ') bytes)"
else
  [ -f "$SRC" ] && VER="$(sed -n "s/.*ATLAS_CACHE_WATCH_VERSION', *'\([^']*\)'.*/\1/p" "$SRC" | head -1)"
  say "removing $HOST:$REMOTE"
fi

command -v security >/dev/null 2>&1 || { say "the Keychain is macOS-only; run this on the Mac"; exit 1; }
U="$(security find-generic-password -s "$KC_SERVICE" 2>/dev/null | sed -n 's/^ *"acct"<blob>="\(.*\)"$/\1/p')"
[ -n "$U" ] || { say "no Keychain item '$KC_SERVICE' (the SFTP login); save it once: bash scripts/wp-upload.sh --save-login"; exit 1; }
A="$(mktemp /tmp/wp-watch-askpass.XXXXXX)"
printf '#!/bin/sh\nexec security find-generic-password -s %s -w\n' "$KC_SERVICE" > "$A"; chmod 700 "$A"
export SSH_ASKPASS="$A" SSH_ASKPASS_REQUIRE=force DISPLAY="${DISPLAY:-:0}"
trap 'rm -f -- "$A" ${B:+"$B"}' EXIT

# stdin, not -b: -b switches on BatchMode, which refuses the Keychain password (scripts/wp-upload.sh, 2026-09-05). The
# leading dash on -mkdir keeps the batch going when the directory is already there; `put` and `rm` carry NO dash, so a
# failed transfer or a failed delete is an sftp exit code this script can test.
B="$(mktemp /tmp/wp-watch-batch.XXXXXX)"
if [ "$MODE" = install ]; then
  { printf -- '-mkdir "%s/wp-content/mu-plugins"\n' "$DOCROOT"
    printf -- 'put "%s" "%s"\n' "$SRC" "$REMOTE"; } > "$B"
else
  printf -- 'rm "%s"\n' "$REMOTE" > "$B"
fi
say "sftp batch:"; sed 's/^/   /' "$B" | tee -a "$LOG"
out="$(sftp -o StrictHostKeyChecking=accept-new -o ConnectTimeout=40 -o ServerAliveInterval=15 "$U@$HOST" < "$B" 2>&1)"; rc=$?
say "sftp $U@$HOST → exit $rc: $(printf '%s' "$out" | grep -v '^sftp> *$' | tr '\n' ' ' | cut -c1-300)"
if [ "$rc" -ne 0 ]; then
  if [ "$MODE" = install ]; then
    stamp "upload-failed"
    say "the transfer failed (sftp exit $rc) — the file on the host is whatever was there before, so the header below would say nothing about this run. Nothing was verified."
    say "LOOP STATUS: atlas-cache-watch — upload-failed (sftp exit $rc); NOT deployed. Heartbeat $STAMP."
  else
    stamp "rm-failed"
    say "the delete failed (sftp exit $rc) — the plugin may still be on the host. Nothing was verified."
    say "LOOP STATUS: atlas-cache-watch — rm-failed (sftp exit $rc); NOT removed. Heartbeat $STAMP."
  fi
  say "log: $LOG"
  exit 1
fi

# The check must reach WordPress, not the edge: a cached answer for a plain URL never runs a single line of PHP and so
# carries no header. The query string is the URL the CDN has not seen. The HTTP status is captured with it, because
# "no header" on a 502 means the site is down, not that the plugin is gone.
PROBE_RC=1; PROBE_CODE=""; PROBE_HDR=""
probe() {
  local raw
  raw="$(curl -sI -o /dev/null -D - -w '\n%{http_code}' -m 30 -A "wp-cache-watch-deploy" "$WP_BASE/?atlas-watch=$(date +%s)" 2>/dev/null)"
  PROBE_RC=$?
  raw="$(printf '%s\n' "$raw" | tr -d '\r')"
  PROBE_CODE="$(printf '%s\n' "$raw" | tail -1 | tr -dc '0-9')"
  PROBE_HDR="$(printf '%s\n' "$raw" | awk 'tolower($1)=="x-atlas-cache-watch:" {sub(/^[^:]*: */, ""); v=$0} END{print v}')"
}
reachable() {
  [ "$PROBE_RC" = 0 ] || return 1
  case "$PROBE_CODE" in 2??|3??) return 0;; *) return 1;; esac
}
served_build() {
  case "$PROBE_HDR" in
    *";b="*) local x="${PROBE_HDR#*;b=}"; printf '%s' "${x%%;*}";;
    *) printf '';;
  esac
}
# A header that is THERE proves the plugin ran, whatever status the page carried (send_headers fires on a 404 too), so
# reachability only decides what its ABSENCE means: on a 2xx/3xx the plugin is not loaded, on anything else nothing can
# be concluded and this run says so instead of guessing.
classify() {
  if [ "$MODE" = remove ]; then
    if [ -n "$PROBE_HDR" ]; then result="still-present"
    elif reachable; then result="removed"
    else result="unreachable"; fi
    return
  fi
  case "$PROBE_HDR" in
    "$VER;"*) if [ "$(served_build)" = "$FP" ]; then result="deployed"; else result="fingerprint-mismatch"; fi; return;;
  esac
  if [ -n "$PROBE_HDR" ]; then result="version-mismatch"
  elif reachable; then result="header-absent"
  else result="unreachable"; fi
}

say "verify: curl -sI \"$WP_BASE/?atlas-watch=\$(date +%s)\" | grep X-Atlas-Cache-Watch"
probe; classify
if [ "$result" != deployed ] && [ "$result" != removed ]; then
  say "verify: $result on the first read (http ${PROBE_CODE:-none}, header \"${PROBE_HDR:-none}\") — the host may still be answering from its page cache or from opcache; retrying once in 15 s"
  sleep 15
  probe; classify
fi

case "$result" in
  deployed)
    say "verify: X-Atlas-Cache-Watch: $PROBE_HDR — v$VER build $FP is loaded on the host (the bytes just sent)";;
  fingerprint-mismatch)
    say "verify: the host answers v$VER but build \"$(served_build)\", and the file just sent is build $FP — a different copy of the same version is still loaded (opcache, or the upload landed in another docroot). Header: $PROBE_HDR";;
  version-mismatch)
    say "verify: the host answers X-Atlas-Cache-Watch: $PROBE_HDR, but the file just sent is v$VER — an older copy is still loaded";;
  header-absent)
    say "verify: still no X-Atlas-Cache-Watch header after the retry, and the site answered http $PROBE_CODE — the plugin is not loading (wrong docroot, mu-plugins not read, or every answer came from the edge). Nothing else on the host was changed.";;
  unreachable)
    say "verify: UNKNOWN — the site did not answer (curl exit $PROBE_RC, http ${PROBE_CODE:-none}). Whether the plugin is loaded cannot be read from here, so this run claims nothing either way.";;
  removed)
    say "verify: http $PROBE_CODE with no X-Atlas-Cache-Watch header — the plugin is gone from the host";;
  still-present)
    say "verify: X-Atlas-Cache-Watch: $PROBE_HDR is still served (http $PROBE_CODE); the file was not removed";;
esac
case "$PROBE_HDR" in
  *";age="*)
    a="${PROBE_HDR#*;age=}"; a="${a%%;*}"
    c="${PROBE_HDR#*;cdn=}"; c="${c%%;*}"
    k="${PROBE_HDR#*;tick=}"; k="${k%%;*}"
    say "   last purge $a · last cron tick $k · cdn=$c   (tick=never means WP-Cron is not running the watcher; age=never just means nothing has changed yet)";;
esac

stamp "$result" "${PROBE_HDR:-none}" "${PROBE_CODE:-none}"
case "$result" in
  deployed) say "LOOP STATUS: atlas-cache-watch — DEPLOYED-OBSERVED (v$VER build $FP answered by the host); heartbeat $STAMP ✓";;
  removed)  say "LOOP STATUS: atlas-cache-watch — removed from the host (http $PROBE_CODE, header gone); heartbeat $STAMP ✓";;
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
