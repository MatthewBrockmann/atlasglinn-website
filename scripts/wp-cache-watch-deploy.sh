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
# typo'd `--remvoe` uploaded the plugin instead of deleting it. The COUNT is checked first and at most one is allowed,
# because `--remove --install` reads as a removal to a human and used to be taken as a removal-then-ignored-word by
# this script: a command that means two things must reach no host at all.
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
# anything. TWO exit codes are read — the `ls` session's in 2 and curl's in the probe — and both only in the safe
# direction: a non-zero exit there can REFUSE a claim, never make one. What decides:
#   1. install — the fingerprint the host SERVES is the proof, and it is only READ off a completed chain that ended in
#      a 200. The plugin publishes b=<first 8 of sha1 of its own file>; this run requires that to equal the sha1 of the
#      file it just sent, so only the exact bytes uploaded count as deployed (a same-version copy already on the host
#      answers identically and used to pass). Absent, an older version, a same-version copy with different bytes, or a
#      site that will not answer → one retry after 15 s, then a non-zero exit with the SERVED value in the heartbeat.
#      Nothing else is treated as verified.
#   2. --remove — a second sftp session runs a bare `ls` on the remote path, and "removed" is claimed only when that
#      session proves it REACHED THE HOST and its answer NAMES THE PATH. OpenSSH echoes each stdin command after its
#      "sftp> " prompt, so the capture must carry that `sftp> ls` echo; the session must exit 0; and a non-prompt line
#      must be sftp's OWN answer — anchored on its `Can't ls: `/`ls: ` prefix — naming this file as not found. The
#      capture is stripped of carriage returns before any of that is read, because a stray \r is not whitespace to
#      every locale and the word boundaries below would miss a listing that carried one.
#      A line that LISTS the file WINS, and is read BEFORE any "gone" text: one session can carry both a banner saying
#      "not found" and the listing itself, and the listing is the fact — so that shape is rm-failed, not removed. The
#      name is matched EXACTLY, bounded by start/whitespace/quote/slash on the left and quote/whitespace/end on the
#      right, so atlas-cache-watch.php.bak and old-atlas-cache-watch.php are other files; a substring match read
#      either of them as this one. Anything else is rm-unknown and exits non-zero — a session that never connected, a
#      login banner or a shell's own `command not found` that merely CONTAINS the words "not found", a subsystem or
#      auth failure, a non-zero exit, or a "not found" naming some other path. Grepping the whole session for
#      /not found/ first is what made a machine with no sftp binary read as a successful removal, which is why `sftp`
#      is now a preflight check beside the Keychain one. The header is not the test, because the plugin stops sending
#      it whenever ATLAS_CACHE_WATCH_DISABLED or ATLAS_CACHE_WATCH_UNINSTALL is defined — its absence would then say
#      "removed"
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
# THREE rules decide whether that dump may be read at all, and the one that fired is printed: curl's own exit code must
# be 0 (a chain that ABORTED — --max-redirs exhausted, a timeout, a reset mid-chain — has already printed its hops, and
# crediting a header off one of them is exactly the false success this closed); the status must arrive on curl's own
# tagged `ATLAS_HTTP_CODE:<3 digits>` write-out line, or the code is 000 and the read is refused (a bare `%{http_code}`
# tail used to let a header line's digits stand in as the status when curl printed no write-out at all); and the FINAL
# block's status must be 200 — a 3xx there is a truncated chain, and any other status is not a page a reader was
# served, so no header on it credits a deploy.
# Heartbeat: ~/.cache/wp-upload/last-watch-deploy = "<time> <version> <result> served=<header|none> http=<code>",
# and every abort before the verdict stamps `aborted-<reason>` there, so a stale "deployed" from an earlier run can
# never be read as this one. The log path is printed either way and the log is emailed when ~/.claude/bin/atlas-email
# is present.
#
# Tests: bash scripts/tests/wp-cache-watch-deploy-test.sh (stub sftp/curl/security/shasum/sleep, no host touched; 175
# cases as of round 5, each gate above pinned by a scenario rather than by a grep of this file).
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
# The count is read before the value: with two arguments this script used to act on the first and drop the rest in
# silence, so `--remove --install` deleted the file while its author had written the word install.
if [ "$#" -gt 1 ]; then
  die bad-arg "this script takes at most one argument and was given $# (\"$*\") — say --install or --remove, never both; nothing was sent"
fi
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
out="$(printf '%s\n' "$out" | tr -d '\r')"
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
PROBE_RC=1; PROBE_CODE="000"; PROBE_FINAL=""; PROBE_HDR=""; PROBE_WHY=""; RULE=""
probe() {
  local raw parsed
  PROBE_RC=1; PROBE_CODE="000"; PROBE_FINAL=""; PROBE_HDR=""; PROBE_WHY=""
  raw="$(curl -sI -L --max-redirs 3 -o /dev/null -D - -w '\nATLAS_HTTP_CODE:%{http_code}\n' -m 30 -A "wp-cache-watch-deploy" "$WP_BASE/?atlas-watch=$(date +%s)" 2>/dev/null)"
  PROBE_RC=$?
  # An ABORTED chain is not read AT ALL. curl has already written every hop it followed by the time --max-redirs is
  # exhausted (or a timeout or a reset ends it), and those hops carry headers — a 301 from the plugin's own host among
  # them. Parsing that dump credited a header no reader was ever served, which is the whole false-success class here.
  if [ "$PROBE_RC" -ne 0 ]; then
    PROBE_WHY="curl exited $PROBE_RC, so the chain never completed and nothing it printed is a response a reader was served"
    return 0
  fi
  raw="$(printf '%s\n' "$raw" | tr -d '\r')"
  # The status comes off curl's OWN tagged write-out line and nothing else. A bare `%{http_code}` tail meant that a
  # curl which printed no write-out left `tail -1 | tr -dc 0-9` reading the digits out of whatever header line came
  # last — a content-length could be read as an HTTP status. No tagged line of the right shape = code 000 = refused.
  PROBE_CODE="$(printf '%s\n' "$raw" | grep -Ex 'ATLAS_HTTP_CODE:[0-9]{3}' | tail -1 | cut -d: -f2)"
  if [ -z "$PROBE_CODE" ]; then
    PROBE_CODE="000"
    PROBE_WHY="curl printed no ATLAS_HTTP_CODE:<3 digits> line, so the status of that read is unknown"
    return 0
  fi
  # One block per response, closed by a blank line; `cur`/`st` are the header and status of the block being read and
  # `last`/`lastst` those of the most recent block that actually was a response (the tagged write-out line trails the
  # dump and is not one). The LAST response block is the page a reader lands on, and its status is read here so a
  # truncated chain that ends on a 3xx can be refused from the dump side as well as from curl's exit code.
  parsed="$(printf '%s\n' "$raw" | awk '
    /^[[:space:]]*$/                  { if (resp) { last=cur; lastst=st } cur=""; st=""; resp=0; next }
    toupper(substr($0,1,5))=="HTTP/"  { resp=1; cur=""; st=$2; next }
    tolower($1)=="x-atlas-cache-watch:" { v=$0; sub(/^[^:]*: */, "", v); cur=v; next }
    END                               { if (resp) { last=cur; lastst=st } print lastst; print last }')"
  PROBE_FINAL="$(printf '%s\n' "$parsed" | sed -n 1p)"
  PROBE_HDR="$(printf '%s\n' "$parsed" | sed -n 2p)"
}
served_build() {
  case "$PROBE_HDR" in
    *";b="*) local x="${PROBE_HDR#*;b=}"; printf '%s' "${x%%;*}";;
    *) printf '';;
  esac
}
# A header is only evidence when the read that carried it was a whole answer: a completed chain (curl exit 0), a status
# that arrived on curl's own tagged line, and a FINAL block of 200. Each gate names itself in RULE, so the log says
# which one refused the claim rather than leaving "not deployed" to be guessed at.
classify() {
  RULE=""
  if [ "$PROBE_RC" -ne 0 ]; then
    result="probe-failed"; RULE="rule aborted-chain: $PROBE_WHY — no header from that read was parsed"; return
  fi
  if [ "$PROBE_CODE" = 000 ]; then
    result="probe-failed"; RULE="rule no-status: $PROBE_WHY — no header from that read was parsed"; return
  fi
  case "$PROBE_FINAL" in
    3??) result="probe-failed"; RULE="rule truncated-chain: the FINAL response block is http $PROBE_FINAL — a redirect at the end of a -L chain means the chain did not finish, so that block is a hop and its header is the hop's"; return;;
  esac
  if [ "$PROBE_CODE" != 200 ] || [ "$PROBE_FINAL" != 200 ]; then
    result="probe-failed"; RULE="rule not-200: the final response block is http ${PROBE_FINAL:-none} and curl reported $PROBE_CODE — only a 200 is a page a reader was served, so no header on it credits a deploy"; return
  fi
  case "$PROBE_HDR" in
    "$VER;"*)
      if [ "$(served_build)" = "$FP" ]; then
        result="deployed"; RULE="rule served-fingerprint: a completed chain ended in http 200 whose header carries v$VER build $FP"
      else
        result="fingerprint-mismatch"; RULE="rule served-fingerprint: the 200 answer carries build \"$(served_build)\", not the $FP just sent"
      fi
      return;;
  esac
  if [ -n "$PROBE_HDR" ]; then result="version-mismatch"; RULE="rule served-fingerprint: the 200 answer carries \"$PROBE_HDR\", not v$VER"
  else result="header-absent"; RULE="rule header-absent: the chain ended in http 200 and that response carried no X-Atlas-Cache-Watch"; fi
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
  # Carriage returns come off BEFORE anything is classified: a stray \r sits between the name and the end of its line,
  # and it is not [[:space:]] to every locale, so a listing that carried one could slip past the boundaries below.
  lsout="$(printf '%s\n' "$lsout" | tr -d '\r')"
  say "sftp ls → exit $lsrc: $(flat "$lsout")"
  BASE="$(basename "$REMOTE")"
  BASE_RE="$(printf '%s' "$BASE" | sed 's#[][\\.*^$+?(){}|/]#\\&#g')"
  # The name must be THE name: bounded left by start, whitespace, a quote or a slash, and right by a quote, whitespace
  # or end of line. A substring match read `atlas-cache-watch.php.bak` and `old-atlas-cache-watch.php` as this file —
  # in the "gone" direction that is a removal claimed off another file's absence.
  Q="\"'"
  NAME_RE="(^|[[:space:]${Q}/])${BASE_RE}([${Q}[:space:]]|\$)"
  # When stdin is not a tty OpenSSH echoes each command after its "sftp> " prompt. That echo is the only thing in the
  # capture that proves the command ran ON THE HOST — and it is also why the path appears in the output of a successful
  # `ls` AND of a failed one, so the echo and the banner are dropped before the answer itself is read.
  CONNECTED=0
  printf '%s\n' "$lsout" | grep -Eq '^sftp> *ls([[:space:]]|$)' && CONNECTED=1
  lsclean="$(printf '%s\n' "$lsout" | grep -v '^sftp>' | grep -v '^Connected to ')"
  # A line that LISTS the file is the fact, and it is read FIRST. One session can carry both a banner saying "not
  # found" and the listing itself; testing "gone" first called that a removal. EV_GONE is anchored on sftp's own
  # `Can't ls: `/`ls: ` prefix, so a banner or a shell error that merely contains the words is not an answer.
  EV_LISTED="$(printf '%s\n' "$lsclean" | grep -Evi "can't|cannot|no such file|not found|permission denied|connection closed|failure" | grep -E "$NAME_RE" | head -1)"
  EV_GONE="$(printf '%s\n' "$lsclean" | grep -Ei "^(can't ls|ls): " | grep -E "$NAME_RE" | grep -Ei "no such file|not found" | head -1)"
  if [ "$lsrc" -ne 0 ]; then result="rm-unknown"; EV="the ls session exited $lsrc, so nothing it printed is an answer"
  elif [ "$CONNECTED" != 1 ]; then result="rm-unknown"; EV="no \"sftp> ls\" echo in that output — the command never ran on the host"
  elif [ -n "$EV_LISTED" ]; then result="rm-failed"; EV="$EV_LISTED"
  elif [ -n "$EV_GONE" ]; then result="removed"; EV="$EV_GONE"
  else result="rm-unknown"; EV="the session connected but no line in it names $BASE — neither listed, nor as sftp's own \"Can't ls: … not found\""
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
    say "   advisory: no X-Atlas-Cache-Watch header on the front end (http ${PROBE_CODE:-none}, curl exit $PROBE_RC${PROBE_WHY:+ — $PROBE_WHY}) — on its own that proves nothing, a disabled plugin sends no header either"
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
    say "verify: $result on the first read (http ${PROBE_CODE:-none}, header \"${PROBE_HDR:-none}\") — $RULE; the host may still be answering from its page cache or from opcache, so retrying once in 15 s"
    sleep 15
    probe; classify
  fi
  case "$result" in
    deployed)
      say "verify: X-Atlas-Cache-Watch: $PROBE_HDR — v$VER build $FP is loaded on the host (the bytes just sent). $RULE";;
    fingerprint-mismatch)
      say "verify: the host answers v$VER but build \"$(served_build)\", and the file just sent is build $FP — a different copy of the same version is still loaded (opcache, or the upload landed in another docroot). Header: $PROBE_HDR";;
    version-mismatch)
      say "verify: the host answers X-Atlas-Cache-Watch: $PROBE_HDR, but the file just sent is v$VER — an older copy is still loaded";;
    header-absent)
      say "verify: still no X-Atlas-Cache-Watch header after the retry, and the site answered http $PROBE_CODE — the plugin is not loading (wrong docroot, mu-plugins not read, or every answer came from the edge). Nothing else on the host was changed.";;
    probe-failed)
      say "verify: UNKNOWN — this run has no readable answer from the site (curl exit $PROBE_RC, http $PROBE_CODE, final block ${PROBE_FINAL:-none}). $RULE. Whether the plugin is loaded cannot be read from here, so this run claims nothing either way.";;
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
