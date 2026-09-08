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
#   bash scripts/wp-cache-watch-deploy.sh            # upload, then require the host to serve the fingerprint just sent
#   bash scripts/wp-cache-watch-deploy.sh --install  # the same run, said out loud
#   bash scripts/wp-cache-watch-deploy.sh --remove   # delete it, then require an sftp `ls` to say it is gone
#
# Any other argument is an error and nothing is sent: an unrecognised one used to fall through to MODE=install, so a
# typo'd `--remvoe` uploaded the plugin instead of deleting it.
#
# The file sent is always wp-ops/atlas-cache-watch.php from the checkout this script runs in (ATLAS_WATCH_SRC overrides
# it). There is no download fallback: fetching the plugin from a branch over HTTP would put unpinned remote code into
# production, so a missing file is an error, not something to work around.
#
# The login is the Keychain item `mast-wp-sftp` (saved once by `bash scripts/wp-upload.sh --save-login`), handed to sftp
# through SSH_ASKPASS exactly as the upload does: never printed, never in a file, never in git.
#
# WHAT IS PROOF HERE, AND WHAT IS NOT.
# sftp does not report per-command failure for a batch that arrives on stdin: OpenSSH aborts on a failed put or rm only
# under -b, and -b switches on BatchMode, which refuses the Keychain askpass this script depends on. The session's exit
# code is therefore NOT a signal, and neither is its text. Both are printed as an advisory line and neither decides
# anything. The only exit code this run reads is the `ls` session's in 2, and only in the safe direction: a non-zero
# exit there can REFUSE a claim, never make one. What decides:
#   1. install — the fingerprint the host SERVES is the proof. The plugin publishes b=<first 8 of sha1 of its own file>;
#      this run requires that to equal the sha1 of the file it just sent, so only the exact bytes uploaded count as
#      deployed (a same-version copy already on the host answers identically and used to pass). Absent, an older
#      version, a same-version copy with different bytes, or a site that will not answer → one retry after 15 s, then a
#      non-zero exit with the SERVED value in the heartbeat. Nothing else is treated as verified.
#   2. --remove — a second sftp session runs a bare `ls` on the remote path, and "removed" is claimed only when that
#      session proves it REACHED THE HOST and its answer NAMES THE PATH. OpenSSH echoes each stdin command after its
#      "sftp> " prompt, so the capture must carry that `sftp> ls` echo; the session must exit 0; and a non-prompt line
#      must read `Can't ls: "<path>" not found` (or `ls: … <file> … No such file`). A line that lists the path back is
#      rm-failed. Anything else is rm-unknown and exits non-zero — a session that never connected, a login banner or a
#      shell's own `command not found` that merely CONTAINS the words "not found", a subsystem or auth failure, a
#      non-zero exit, or a "not found" naming some other path. Grepping the whole session for /not found/ first is what
#      made a machine with no sftp binary read as a successful removal, which is why `sftp` is now a preflight check
#      beside the Keychain one. The header is not the test, because the plugin stops sending it whenever
#      ATLAS_CACHE_WATCH_DISABLED or ATLAS_CACHE_WATCH_UNINSTALL is defined — its absence would then say "removed"
#      about a file still sitting on the host. The header probe stays as an advisory line, and the line the verdict was
#      read off is printed beside it.
# --remove deletes the file and stops the watcher, but LEAVES its two options and its cron event in the database (a
# must-use plugin gets no uninstall hook). To clear those, put define('ATLAS_CACHE_WATCH_UNINSTALL', true); in
# wp-config.php and load one page before removing the file — the plugin then deletes both options, drops the lock,
# unschedules the tick, and does nothing else.
#
# The check uses a cache-busting query string because GoDaddy's page cache can answer a plain URL at the edge, without
# WordPress and so without the header; it follows redirects (-L --max-redirs 3) and reads the header out of the FINAL
# response block of the -D - chain, so a header sent by a 301 hop is never credited to the page a reader lands on.
# Heartbeat: ~/.cache/wp-upload/last-watch-deploy = "<time> <version> <result> served=<header|none> http=<code>",
# and every abort before the verdict stamps `aborted-<reason>` there, so a stale "deployed" from an earlier run can
# never be read as this one. The log path is printed either way and the log is emailed when ~/.claude/bin/atlas-email
# is present.
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
MODE=install

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

# The heartbeat is written exactly once, and STAMPED says whether that has happened: an abort BEFORE the verdict has to
# leave its own mark, or the last successful run's "deployed" line stays on disk and reads as if it were this run's.
STAMPED=0
ABORT="preflight"
stamp() { printf '%s %s %s served=%s http=%s\n' "$TS" "$VER" "$1" "${2:-none}" "${3:-none}" > "$STAMP"; STAMPED=1; }
on_exit() {
  rc=$?
  rm -f -- ${A:+"$A"} ${B:+"$B"}
  if [ "$rc" -ne 0 ] && [ "$STAMPED" = 0 ]; then
    printf '%s %s aborted-%s served=none http=none\n' "$TS" "$VER" "$ABORT" > "$STAMP" 2>/dev/null || true
  fi
}
trap on_exit EXIT
die() { ABORT="$1"; shift; say "$*"; exit 1; }

# Parsed here, below die(), because an unknown argument has to ABORT — and an abort has to be able to stamp the
# heartbeat. It used to fall through to MODE=install, so a typo'd `--remvoe` uploaded the plugin instead of removing it.
case "${1:-}" in
  ""|--install) MODE=install;;
  --remove)     MODE=remove;;
  *)            die bad-arg "unknown argument \"$1\" — this script takes no argument (or --install) to upload, and --remove to delete; nothing was sent";;
esac

if [ "$MODE" = install ]; then
  [ -f "$SRC" ] || die no-source "no plugin at $SRC — this script sends the file from its own checkout and never downloads one; run it from a clone of atlasglinn-website (or set ATLAS_WATCH_SRC)"
  VER="$(sed -n "s/.*ATLAS_CACHE_WATCH_VERSION', *'\([^']*\)'.*/\1/p" "$SRC" | head -1)"
  [ -n "$VER" ] || { VER="-"; die no-version "no ATLAS_CACHE_WATCH_VERSION in $SRC"; }
  if command -v php >/dev/null 2>&1; then
    php -l "$SRC" >/dev/null 2>&1 || die php-lint "php -l failed on $SRC; nothing was uploaded"
  fi
  FP="$(sha1_of "$SRC" | cut -c1-8)"
  [ -n "$FP" ] || die no-sha1 "no shasum/sha1sum/openssl on this Mac, so the build fingerprint the host publishes cannot be checked against the file being sent — that check is the only proof this run has. Nothing was uploaded."
  say "atlas-cache-watch v$VER build $FP → $HOST:$REMOTE ($(wc -c < "$SRC" | tr -d ' ') bytes)"
else
  [ -f "$SRC" ] && VER="$(sed -n "s/.*ATLAS_CACHE_WATCH_VERSION', *'\([^']*\)'.*/\1/p" "$SRC" | head -1)"
  [ -n "$VER" ] || VER="-"
  say "removing $HOST:$REMOTE"
fi

command -v sftp >/dev/null 2>&1 || die no-sftp "no sftp on this machine — both the upload and the removal travel over it, and a shell answering \"command not found\" is not a session that reached the host; this run refuses to read one as one"
command -v security >/dev/null 2>&1 || die no-keychain-tool "the Keychain is macOS-only; run this on the Mac"
U="$(security find-generic-password -s "$KC_SERVICE" 2>/dev/null | sed -n 's/^ *"acct"<blob>="\(.*\)"$/\1/p')"
[ -n "$U" ] || die no-keychain "no Keychain item '$KC_SERVICE' (the SFTP login); save it once: bash scripts/wp-upload.sh --save-login"
A="$(mktemp /tmp/wp-watch-askpass.XXXXXX)"
printf '#!/bin/sh\nexec security find-generic-password -s %s -w\n' "$KC_SERVICE" > "$A"; chmod 700 "$A"
export SSH_ASKPASS="$A" SSH_ASKPASS_REQUIRE=force DISPLAY="${DISPLAY:-:0}"

# stdin, not -b: -b switches on BatchMode, which refuses the Keychain password (scripts/wp-upload.sh, 2026-09-05). The
# leading dash on -mkdir is what keeps the batch going when the directory is already there — and that same tolerated
# command prints "Couldn't create directory: Failure" on every healthy run, which is why the advisory grep below drops
# it before looking for trouble.
B="$(mktemp /tmp/wp-watch-batch.XXXXXX)"
sftp_run() { sftp -o StrictHostKeyChecking=accept-new -o ConnectTimeout=40 -o ServerAliveInterval=15 "$U@$HOST" < "$B" 2>&1; }
flat() { printf '%s' "$1" | grep -v '^sftp> *$' | tr '\n' ' ' | cut -c1-300; }
sftp_trouble() {
  printf '%s\n' "$1" | grep -v 'create directory' \
    | grep -Ei "permission denied|no such file|couldn't|failure|not found" | head -2 | tr '\n' ' ' | cut -c1-160
}
advisory() {
  # Printed, never acted on: neither this exit code nor this text can distinguish a failed put from a clean one when the
  # batch came in on stdin. It is here so a human reading the log knows WHY the proof below failed, when it does.
  [ -n "$2" ] || [ "$1" -ne 0 ] || return 0
  say "sftp advisory (exit $1${2:+, \"$2\"}) — sftp does not report per-command failure for a batch on stdin, so this decides nothing; the proof is below."
}

if [ "$MODE" = install ]; then
  { printf -- '-mkdir "%s/wp-content/mu-plugins"\n' "$DOCROOT"
    printf -- 'put "%s" "%s"\n' "$SRC" "$REMOTE"; } > "$B"
else
  printf -- 'rm "%s"\n' "$REMOTE" > "$B"
fi
say "sftp batch:"; sed 's/^/   /' "$B" | tee -a "$LOG"
out="$(sftp_run)"; rc=$?
say "sftp $U@$HOST → exit $rc: $(flat "$out")"
WARN="$(sftp_trouble "$out")"
advisory "$rc" "$WARN"

# The check must reach WordPress, not the edge: a cached answer for a plain URL never runs a single line of PHP and so
# carries no header. The query string is the URL the CDN has not seen. -L follows the redirect GoDaddy answers for the
# apex and -D - dumps EVERY response in that chain, so the header is read from the LAST response block ALONE: blocks
# are separated by the blank line that ends each set of headers, and only the last one describes the page a reader
# lands on. Taking the last matching header line anywhere in the dump — which is what this did — credits a 301 hop's
# header to a final response that sent none. The HTTP status is captured with the header, because "no header" on a 502
# means the site is down, not that the plugin is gone.
PROBE_RC=1; PROBE_CODE=""; PROBE_HDR=""
probe() {
  local raw
  raw="$(curl -sI -L --max-redirs 3 -o /dev/null -D - -w '\n%{http_code}' -m 30 -A "wp-cache-watch-deploy" "$WP_BASE/?atlas-watch=$(date +%s)" 2>/dev/null)"
  PROBE_RC=$?
  raw="$(printf '%s\n' "$raw" | tr -d '\r')"
  PROBE_CODE="$(printf '%s\n' "$raw" | tail -1 | tr -dc '0-9')"
  # One block per response, closed by a blank line; `cur` is the header seen in the block being read and `last` the one
  # from the most recent block that actually was a response (curl's -w output trails the dump as a block of its own).
  PROBE_HDR="$(printf '%s\n' "$raw" | awk '
    /^[[:space:]]*$/                  { if (resp) last=cur; cur=""; resp=0; next }
    toupper(substr($0,1,5))=="HTTP/"  { resp=1; cur=""; next }
    tolower($1)=="x-atlas-cache-watch:" { v=$0; sub(/^[^:]*: */, "", v); cur=v; next }
    END                               { if (resp) last=cur; print last }')"
}
reachable() {
  [ "$PROBE_RC" = 0 ] || return 1
  case "$PROBE_CODE" in 2??) return 0;; *) return 1;; esac
}
served_build() {
  case "$PROBE_HDR" in
    *";b="*) local x="${PROBE_HDR#*;b=}"; printf '%s' "${x%%;*}";;
    *) printf '';;
  esac
}
# A header that is THERE proves the plugin ran, whatever status the page carried (send_headers fires on a 404 too), so
# reachability only decides what its ABSENCE means: on a 2xx the plugin is not loaded, on anything else nothing can be
# concluded and this run says so instead of guessing.
classify() {
  case "$PROBE_HDR" in
    "$VER;"*) if [ "$(served_build)" = "$FP" ]; then result="deployed"; else result="fingerprint-mismatch"; fi; return;;
  esac
  if [ -n "$PROBE_HDR" ]; then result="version-mismatch"
  elif reachable; then result="header-absent"
  else result="unreachable"; fi
}

if [ "$MODE" = remove ]; then
  # The verdict for a removal is an `ls` of the same path in a second session, never the header: a plugin that is still
  # on the host but disabled by a wp-config constant sends no header at all, so header-absence would report a removal
  # that never happened. And the ls is READ, not searched for /not found/: a shell with no sftp, a login banner, a
  # subsystem failure and a refused password all carry those words while the file sits untouched on the host. Two
  # things have to be true before "removed" is on the table — the session REACHED the host, and its answer NAMES the
  # path this run asked about.
  printf -- 'ls "%s"\n' "$REMOTE" > "$B"
  say "sftp proof batch:"; sed 's/^/   /' "$B" | tee -a "$LOG"
  lsout="$(sftp_run)"; lsrc=$?
  say "sftp ls → exit $lsrc: $(flat "$lsout")"
  BASE="$(basename "$REMOTE")"
  BASE_RE="$(printf '%s' "$BASE" | sed 's/[][\.*^$\/]/\\&/g')"
  # When stdin is not a tty OpenSSH echoes each command after its "sftp> " prompt. That echo is the only thing in the
  # capture that proves the command ran ON THE HOST — and it is also why the path appears in the output of a successful
  # `ls` AND of a failed one, so the echo and the banner are dropped before the answer itself is read.
  CONNECTED=0
  printf '%s\n' "$lsout" | grep -Eq '^sftp> *ls([[:space:]]|$)' && CONNECTED=1
  lsclean="$(printf '%s\n' "$lsout" | grep -v '^sftp>' | grep -v '^Connected to ')"
  EV_GONE="$(printf '%s\n' "$lsclean" | grep -Ei "^(can't ls|ls): .*${BASE_RE}.*(no such file|not found)" | head -1)"
  [ -n "$EV_GONE" ] || EV_GONE="$(printf '%s\n' "$lsclean" | grep -Fx "Can't ls: \"$REMOTE\" not found" | head -1)"
  EV_LISTED="$(printf '%s\n' "$lsclean" | grep -Evi "can't|cannot|no such file|not found|permission denied|connection closed|failure" | grep -F "$BASE" | head -1)"
  if [ "$lsrc" -ne 0 ]; then result="rm-unknown"; EV="the ls session exited $lsrc, so nothing it printed is an answer"
  elif [ "$CONNECTED" != 1 ]; then result="rm-unknown"; EV="no \"sftp> ls\" echo in that output — the command never ran on the host"
  elif [ -n "$EV_GONE" ]; then result="removed"; EV="$EV_GONE"
  elif [ -n "$EV_LISTED" ]; then result="rm-failed"; EV="$EV_LISTED"
  else result="rm-unknown"; EV="the session connected but no line in it names $BASE"
  fi
  say "   ls classified $result — evidence: $EV"
  probe
  case "$result" in
    removed)
      say "verify: the host answers \"not found\" for $REMOTE — the file is gone";;
    rm-failed)
      say "verify: $REMOTE is STILL LISTED on the host after the rm — it was not deleted";;
    rm-unknown)
      say "verify: UNKNOWN — the ls session did not both prove it reached the host and name $BASE as missing (sftp exit $lsrc), so this run claims nothing either way";;
  esac
  if [ -n "$PROBE_HDR" ]; then
    say "   advisory: X-Atlas-Cache-Watch: $PROBE_HDR is still being served (http ${PROBE_CODE:-none}) — an edge or opcache copy can answer after the file is gone; the ls above is the verdict"
  else
    say "   advisory: no X-Atlas-Cache-Watch header on the front end (http ${PROBE_CODE:-none}, curl exit $PROBE_RC) — on its own that proves nothing, a disabled plugin sends no header either"
  fi
  stamp "$result" "${PROBE_HDR:-none}" "${PROBE_CODE:-none}"
  case "$result" in
    removed) say "LOOP STATUS: atlas-cache-watch — removed from the host (sftp ls says the path is not there); heartbeat $STAMP ✓";;
    *)       say "LOOP STATUS: atlas-cache-watch — $result; the file is NOT confirmed gone. Heartbeat $STAMP.";;
  esac
else
  say "verify: curl -sI -L \"$WP_BASE/?atlas-watch=\$(date +%s)\" | grep X-Atlas-Cache-Watch"
  probe; classify
  if [ "$result" != deployed ]; then
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
  esac
  case "$PROBE_HDR" in
    *";age="*)
      a="${PROBE_HDR#*;age=}"; a="${a%%;*}"
      c="${PROBE_HDR#*;cdn=}"; c="${c%%;*}"
      k="${PROBE_HDR#*;tick=}"; k="${k%%;*}"
      say "   last purge $a · last cron tick $k · cdn=$c   (tick=never means WP-Cron is not running the watcher; age=never just means nothing has changed yet)";;
  esac
  [ "$result" = deployed ] || [ -z "$WARN" ] || say "   the sftp advisory above (\"$WARN\") is the likely reason the bytes sent are not the bytes running"
  stamp "$result" "${PROBE_HDR:-none}" "${PROBE_CODE:-none}"
  case "$result" in
    deployed) say "LOOP STATUS: atlas-cache-watch — DEPLOYED-OBSERVED (v$VER build $FP answered by the host); heartbeat $STAMP ✓";;
    *)        say "LOOP STATUS: atlas-cache-watch — $result; NOT verified as deployed. Heartbeat $STAMP.";;
  esac
fi

EMAIL="$HOME/.claude/bin/atlas-email"
if [ -x "$EMAIL" ]; then
  if "$EMAIL" "wp-cache-watch-deploy $TS — $result" < "$LOG" >/dev/null 2>&1; then say "emailed to matthew@atlasglinn.com"
  else say "the email helper $EMAIL refused the send (it is called with the subject as the first argument and the log on stdin); read the log instead"; fi
else
  say "no ~/.claude/bin/atlas-email on this Mac; nothing emailed"
fi
say "log: $LOG"
case "$result" in deployed|removed) exit 0;; *) exit 1;; esac
