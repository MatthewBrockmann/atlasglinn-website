#!/usr/bin/env bash
# Install Wordfence Security on atlasglinn.com from the Mac, over SFTP, and prove from the outside that it is active.
#
# Why not `wp plugin install wordfence`: the saved GoDaddy login `mast-wp-sftp` answers "This service allows sftp
# connections only." (measured 2026-09-08 18:46 UTC, scripts/wp-cache-watch-deploy.sh). There is no shell, so there is
# no WP-CLI, and a script built on SSH installs nothing — it reports a preflight failure and stops. What works is SFTP,
# and the same route the cache cascade already travels carries this: two must-use plugins land in
# html/wp-content/mu-plugins/, one request triggers them, and the answer comes back on a response header.
#
#   bash scripts/wp-wordfence-install.sh                     # upload, trigger, measure, report — the whole R2 step
#   bash scripts/wp-wordfence-install.sh --status            # measure only: no upload, no trigger, no sftp session
#   bash scripts/wp-wordfence-install.sh --remove            # delete BOTH mu-plugins (Wordfence itself keeps running)
#   bash scripts/wp-wordfence-install.sh --remove-status     # delete the reporter alone (after a run it is the file left)
#   bash scripts/wp-wordfence-install.sh --disable-wordfence # THE RECOVERY: rename the Wordfence plugin directory off
#
# Any other argument, or more than one, aborts before anything is sent — the same rule as the sibling deploy script,
# for the same reason: `--remove --install` reads as a removal to a human and must reach no host at all.
#
# THE RECOVERY, because the obvious one is wrong. --remove deletes the two mu-plugins THIS script installed and does
# not touch Wordfence, so if Wordfence is what took the site or the login page down, --remove cannot bring it back.
# With no shell and no WP-CLI the only route left is SFTP, and what SFTP can do is RENAME:
# --disable-wordfence renames html/wp-content/plugins/wordfence to wordfence.off. Nothing of Wordfence can load from a
# path that no longer exists, so it stops running on the very next request; WordPress drops the missing entry from
# active_plugins the next time an admin screen validates the plugin list. The run then re-measures the front page, the
# WordPress-rendered page and wp-login.php and prints what they answer. It REFUSES the rename on prep=1 (extended
# protection loads wordfence-waf.php from inside that directory on every request, so renaming it takes the site down
# hard rather than bringing it back), and it prints the reverse rename on every outcome, not only the happy one. Renaming BACK is a one-line sftp rename in the
# other direction, which is why this is the recovery rather than a delete.
#
# WHAT IS INSTALLED, AND WHAT IS NOT. wp-ops/atlas-wordfence-install.php installs and activates the `wordfence` slug
# from wordpress.org and does nothing else — no login-failure limit, no lockout window, no username blacklist, no
# forced 2FA, no alert-email write, no auto_prepend_file. Wordfence's own defaults are the throttle. That is deliberate
# and it is the difference between this and the SSH-based script on the wp-harden-login branch: every one of those
# settings is a way to lock the site's only admin out of wp-admin from a script he is not sitting in front of. R2 of
# the 2026-07-01 packet asks for the plugin; tightening it is a separate act with him at the keyboard.
#
# WHAT COUNTS AS PROOF HERE.
#   1. The status plugin's own header must carry the build fingerprint of the file this run just sent — the same rule
#      as scripts/wp-cache-watch-deploy.sh: a same-version copy already on the host answers identically, so only the
#      exact bytes uploaded count as deployed. Without that, nothing below is read at all. That fingerprint is also
#      what ASKS for the header: the reporter answers only a request carrying ?atlas-wordfence-status=<fingerprint>,
#      so a copy of another build on the host stays silent rather than answering with the wrong build.
#   2. `act=1` on that header is the verdict, and it is a LIVE read of the site's active_plugins option on the request
#      that answered — not the installer's memory of what it did. A recorded st=installed with act=0 is a failure.
#   3. The installer file must be GONE, proved by an sftp `ls` of its path classified exactly as the sibling script
#      classifies a removal (the session must carry OpenSSH's `sftp> ls` echo, exit 0, and either LIST the file — which
#      wins over any "gone" text in the same session — or answer with sftp's own `Can't ls: … not found`). A one-shot
#      that did not remove itself is live code left on a production site, so that is a non-zero exit even when
#      Wordfence installed perfectly. --status RUNS NO SFTP SESSION AT ALL, so it cannot prove this and does not say
#      it: it prints "self-removal: not measured in --status" and never prints FIRED-OBSERVED, whatever the header's
#      own self= limb claims. That limb is the installer's memory of what it did; only the `ls` is a measurement of
#      the host, and a mode that did not measure does not get to report the result.
#   4. The site must still answer, and THAT INCLUDES THE LOGIN PAGE, and the login page must have been MEASURABLE
#      BEFORE the run: an install whose before-read of wp-login.php is http 000 stops there, because a verdict with no
#      baseline is a comparison every after-code passes. The reader-facing front page
#      (https://atlasglinn.com/, served from index.html by wp-ops/atlas-static-root.php), the WordPress-rendered page
#      and https://atlasglinn.com/wp-login.php are all measured before and after. Any of the three answering something
#      different afterwards fails the run whatever the plugin says — a security plugin that breaks the only admin's way
#      in is the exact outcome this whole design exists to prevent, and it is worthless to measure it and then leave it
#      out of the verdict. The failure prints --disable-wordfence, which is the remedy that can actually undo it.
# What is NOT proof: the sftp exit code and its text (a batch on stdin does not abort on a failed put — that needs -b,
# which sets BatchMode and refuses the Keychain askpass), and the Wordfence markers grepped out of the page body.
# Wordfence Free adds nothing to a front-end response as a rule, so their absence says nothing; they are printed as an
# advisory and decide nothing.
#
# EVERY MEASUREMENT USES ?atlas-wordfence-status=<fingerprint> (the trigger fetch uses ?atlas-wordfence=<ts>). https://atlasglinn.com/ is answered by wp-ops/atlas-static-root.php
# from the uploaded index.html on `muplugins_loaded` — it exits before `init`, so the installer never runs there and
# the status header is never sent there. That plugin passes any URL carrying a non-tracking query straight through to
# WordPress, which is the door this uses (and the same one scripts/wp-cache-watch-deploy.sh uses with ?atlas-watch=).
#
# The login is the Keychain item `mast-wp-sftp` (saved once by `bash scripts/wp-upload.sh --save-login`), handed to
# sftp through SSH_ASKPASS: never printed, never in a file, never in git.
#
# Heartbeat: ~/.cache/wp-upload/last-wordfence-install = "<time> <result> st=<status> act=<0|1> wf=<version> self=<…>",
# and every abort before the verdict stamps `aborted-<reason>` there, so a previous run's result can never be read as
# this one's. The log is printed and emailed when ~/.claude/bin/atlas-email is present.
set -u
HOST="${WP_SFTP_HOST:-1127220.us12.ssh.myftpupload.com}"
DOCROOT="${WP_DOCROOT:-html}"
# Both of these are interpolated into the sftp batch below, and a newline in either one injects an sftp command of
# somebody else's choosing into a session pointed at a production docroot. Neither ever legitimately holds anything but
# a host name and a path, so anything else stops the run before a session opens.
case "$HOST$DOCROOT" in
  *[!A-Za-z0-9._/-]*) printf 'refusing to run: WP_SFTP_HOST/WP_DOCROOT carry a character outside [A-Za-z0-9._/-], and both are written into the sftp batch. Nothing was sent.\n' >&2; exit 1;;
esac
WP_BASE="${WP_BASE:-https://www.atlasglinn.com}"
SITE_ROOT="${WP_SITE_ROOT:-https://atlasglinn.com}"
LOGIN_URL="${WP_LOGIN_URL:-https://atlasglinn.com/wp-login.php}"
KC_SERVICE="${KC_SFTP:-mast-wp-sftp}"
# KC_SFTP is written into the SSH_ASKPASS helper this run then executes, so a command substitution in it is a command
# run as this user — a strictly worse primitive than the sftp-batch injection the case above refuses, three lines away
# from it. A Keychain service name is a name; anything else stops the run before a session opens.
case "$KC_SERVICE" in
  *[!A-Za-z0-9._-]*) printf 'refusing to run: KC_SFTP carries a character outside [A-Za-z0-9._-], and it is written into the SSH_ASKPASS helper this run executes. Nothing was sent.\n' >&2; exit 1;;
esac
REMOTE_DIR="$DOCROOT/wp-content/mu-plugins"
REMOTE_INSTALL="$REMOTE_DIR/atlas-wordfence-install.php"
REMOTE_STATUS="$REMOTE_DIR/atlas-wordfence-status.php"
# --disable-wordfence renames the directory; the file inside it is what the `ls` classifier can answer about, because
# an `ls` of a directory lists its contents rather than its name.
REMOTE_WF_DIR="$DOCROOT/wp-content/plugins/wordfence"
REMOTE_WF_OFF="$DOCROOT/wp-content/plugins/wordfence.off"
REMOTE_WF_FILE="$REMOTE_WF_DIR/wordfence.php"
REMOTE_WF_OFF_FILE="$REMOTE_WF_OFF/wordfence.php"
LOG="$HOME/.cache/wp-upload/wp-wordfence-install.log"
STAMP="$HOME/.cache/wp-upload/last-wordfence-install"
TRIGGER_TRIES="${ATLAS_WF_TRIGGER_TRIES:-3}"
# One poll cycle is POLL_TRIES × POLL_SLEEP = 180 s, deliberately longer than the installer's 300 s lock is likely to
# matter: a request killed mid-install leaves that lock behind, and a second trigger sent inside it does nothing at all.
# Three cycles carry past 300 s, so the retry the installer is built for actually gets a request to run in. A run that
# succeeds never waits this long — the trigger fetch returns once the install is done and the first poll reads it.
POLL_TRIES="${ATLAS_WF_POLL_TRIES:-9}"
POLL_SLEEP="${ATLAS_WF_POLL_SLEEP:-20}"
mkdir -p "$(dirname "$LOG")"; : > "$LOG"
say() { printf '%s\n' "$*" | tee -a "$LOG"; }
TS="$(date -u +%FT%TZ)"
MODE=install

# The two files that get uploaded are PINNED to this checkout and no environment variable may choose them. They land
# in mu-plugins, where PHP runs them on every request with no activation step and no review — "which files go to
# production" is not a knob, and the only reason it ever was one is that a harness found it convenient.
SELF="${BASH_SOURCE[0]:-$0}"
ROOT="$(cd "$(dirname "$SELF")/.." 2>/dev/null && pwd || true)"
SRC_INSTALL="${ROOT:-.}/wp-ops/atlas-wordfence-install.php"
SRC_STATUS="${ROOT:-.}/wp-ops/atlas-wordfence-status.php"
B=""; A=""
FP_INSTALL=""; FP_STATUS=""
result="not-run"; ST="none"; ACT="0"; WF="none"; SELFSTATE="unknown"; ERRTXT=""

sha1_of() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 1 "$1" 2>/dev/null | awk '{print $1}'
  elif command -v sha1sum >/dev/null 2>&1; then sha1sum "$1" 2>/dev/null | awk '{print $1}'
  elif command -v openssl >/dev/null 2>&1; then openssl dgst -sha1 "$1" 2>/dev/null | awk '{print $NF}'
  else printf ''
  fi
}

# The heartbeat is written exactly once. An abort BEFORE the verdict has to leave its own mark, or the previous run's
# line stays on disk and reads as if it were this run's.
STAMPED=0
ABORT="preflight"
stamp() { printf '%s %s st=%s act=%s wf=%s self=%s\n' "$TS" "$1" "${ST:-none}" "${ACT:-0}" "${WF:-none}" "${SELFSTATE:-unknown}" > "$STAMP"; STAMPED=1; }
on_exit() {
  rc=$?
  rm -f -- ${A:+"$A"} ${B:+"$B"}
  if [ "$rc" -ne 0 ] && [ "$STAMPED" = 0 ]; then
    printf '%s aborted-%s st=none act=0 wf=none self=unknown\n' "$TS" "$ABORT" > "$STAMP" 2>/dev/null || true
  fi
}
trap on_exit EXIT
die() { ABORT="$1"; shift; say "$*"; exit 1; }

if [ "$#" -gt 1 ]; then
  die bad-arg "this script takes at most one argument and was given $# (\"$*\") — say --install, --status, --remove, --remove-status or --disable-wordfence, never two; nothing was sent"
fi
case "${1:-}" in
  ""|--install)        MODE=install;;
  --status)            MODE=status;;
  --remove)            MODE=remove;;
  --remove-status)     MODE=remove-status;;
  --disable-wordfence) MODE=disable;;
  *)                   die bad-arg "unknown argument \"$1\" — no argument (or --install) installs, --status measures only, --remove deletes both mu-plugins, --remove-status deletes the reporter alone, and --disable-wordfence renames the Wordfence plugin directory off (the recovery); nothing was sent";;
esac

# ── HTTP measurement ──────────────────────────────────────────────────────────────────────────────────────────────────
# One code, off curl's own tagged write-out line, from a chain that completed. A bare %{http_code} tail lets a header
# line's digits stand in as a status when curl prints no write-out at all, so the tag is required (the rule the sibling
# script's round-5 harness pinned).
http_code() {
  local raw rc code
  raw="$(curl -sI -L --max-redirs 3 -o /dev/null -m 30 -w '\nATLAS_HTTP_CODE:%{http_code}\n' -A "wp-wordfence-install" "$1" 2>/dev/null)"
  rc=$?
  [ "$rc" -eq 0 ] || { printf '000'; return 0; }
  code="$(printf '%s\n' "$raw" | tr -d '\r' | grep -Ex 'ATLAS_HTTP_CODE:[0-9]{3}' | tail -1 | cut -d: -f2)"
  printf '%s' "${code:-000}"
}
# Two URLs, and the difference matters. The TRIGGER only has to be a plain front-end GET that WordPress renders, so it
# carries a cache-busting timestamp. The PROBE has to ask the reporter for its header, which it sends only to a request
# carrying its own build fingerprint — the one this run computed from the file it is sending.
wp_url() { printf '%s/?atlas-wordfence=%s' "$WP_BASE" "$(date +%s)"; }
probe_url() { printf '%s/?atlas-wordfence-status=%s&atlas-wordfence=%s' "$WP_BASE" "$FP_STATUS" "$(date +%s)"; }

PROBE_RC=1; PROBE_CODE="000"; PROBE_FINAL=""; PROBE_HDR=""; PROBE_WHY=""; RULE=""
probe() {
  local raw parsed
  PROBE_RC=1; PROBE_CODE="000"; PROBE_FINAL=""; PROBE_HDR=""; PROBE_WHY=""
  raw="$(curl -sI -L --max-redirs 3 -o /dev/null -D - -w '\nATLAS_HTTP_CODE:%{http_code}\n' -m 45 -A "wp-wordfence-install" "$(probe_url)" 2>/dev/null)"
  PROBE_RC=$?
  # An ABORTED chain is not read AT ALL: curl has already printed every hop it followed, and a header on one of them is
  # not a header a reader was served.
  if [ "$PROBE_RC" -ne 0 ]; then
    PROBE_WHY="curl exited $PROBE_RC, so the chain never completed and nothing it printed is a response a reader was served"
    return 0
  fi
  raw="$(printf '%s\n' "$raw" | tr -d '\r')"
  PROBE_CODE="$(printf '%s\n' "$raw" | grep -Ex 'ATLAS_HTTP_CODE:[0-9]{3}' | tail -1 | cut -d: -f2)"
  if [ -z "$PROBE_CODE" ]; then
    PROBE_CODE="000"
    PROBE_WHY="curl printed no ATLAS_HTTP_CODE:<3 digits> line, so the status of that read is unknown"
    return 0
  fi
  # One block per response, closed by a blank line; only the LAST response block describes the page a reader lands on.
  parsed="$(printf '%s\n' "$raw" | awk '
    /^[[:space:]]*$/                { if (resp) { last=cur; lastst=st } cur=""; st=""; resp=0; next }
    toupper(substr($0,1,5))=="HTTP/"{ resp=1; cur=""; st=$2; next }
    tolower($1)=="x-atlas-wordfence:" { v=$0; sub(/^[^:]*: */, "", v); cur=v; next }
    END                             { if (resp) { last=cur; lastst=st } print lastst; print last }')"
  PROBE_FINAL="$(printf '%s\n' "$parsed" | sed -n 1p)"
  PROBE_HDR="$(printf '%s\n' "$parsed" | sed -n 2p)"
}
# <name>=<value> out of the header's ';'-separated limbs; '' when the limb is absent.
limb() {
  case "$PROBE_HDR" in
    *";$1="*) local x="${PROBE_HDR#*;$1=}"; printf '%s' "${x%%;*}";;
    *) printf '';;
  esac
}
read_limbs() {
  ST="$(limb st)"; ST="${ST:-none}"
  ACT="$(limb act)"; ACT="${ACT:-0}"
  WF="$(limb wf)"; WF="${WF:-none}"
  SELFSTATE="$(limb self)"; SELFSTATE="${SELFSTATE:-unknown}"
  ERRTXT="$(limb err)"
}
# err=0 is the reporter saying there was NO error, and "0" is a non-empty string — ${ERRTXT:+…} fired on it and told
# the operator "Recorded error: 0" on a clean run. The limb carries a short CODE now (the message stays in the option
# on the host, because a WP_Error message can carry an absolute path), so this prints the code or nothing at all.
err_note() {
  case "${ERRTXT:-}" in
    ""|0|none) printf '';;
    *) printf ' Recorded error code: %s — the full message is in the option atlas_wordfence_install on the host, deliberately not on the header.' "$ERRTXT";;
  esac
}
# The header is evidence only off a completed chain that ended in a 200 whose build is the file just sent. Each gate
# names itself in RULE, so the log says which one refused the claim.
STATUS_OK=0
classify_status_plugin() {
  STATUS_OK=0; RULE=""
  if [ "$PROBE_RC" -ne 0 ]; then RULE="rule aborted-chain: $PROBE_WHY"; return; fi
  if [ "$PROBE_CODE" = 000 ]; then RULE="rule no-status: $PROBE_WHY"; return; fi
  case "$PROBE_FINAL" in
    3??) RULE="rule truncated-chain: the FINAL response block is http $PROBE_FINAL — a redirect at the end of a -L chain is a hop, and its header is the hop's"; return;;
  esac
  if [ "$PROBE_CODE" != 200 ] || [ "$PROBE_FINAL" != 200 ]; then
    RULE="rule not-200: the final response block is http ${PROBE_FINAL:-none} and curl reported $PROBE_CODE — only a 200 is a page a reader was served"; return
  fi
  if [ -z "$PROBE_HDR" ]; then RULE="rule header-absent: the chain ended in http 200 and that response carried no X-Atlas-Wordfence — either the reporter is not on the host, or the copy that is running is not build $FP_STATUS and stayed silent because the fingerprint in the URL is not its own"; return; fi
  local b; b="$(limb b)"
  if [ -n "$FP_STATUS" ] && [ "$b" != "$FP_STATUS" ]; then
    RULE="rule served-fingerprint: the 200 answer carries build \"${b:-none}\", not the $FP_STATUS just sent — an older copy of the status plugin is loaded"; return
  fi
  STATUS_OK=1
  RULE="rule served-fingerprint: a completed chain ended in http 200 whose X-Atlas-Wordfence carries build ${b:-none}"
}

# ── sftp ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
sftp_run() { sftp -o StrictHostKeyChecking=accept-new -o ConnectTimeout=40 -o ServerAliveInterval=15 "$U@$HOST" < "$B" 2>&1; }
flat() { printf '%s' "$1" | grep -v '^sftp> *$' | tr '\n' ' ' | cut -c1-300; }
sftp_trouble() {
  printf '%s\n' "$1" | grep -v 'create directory' \
    | grep -Ei "permission denied|no such file|couldn't|failure|not found" | head -2 | tr '\n' ' ' | cut -c1-160
}
advisory() {
  # Printed, never acted on: neither this exit code nor this text can distinguish a failed put from a clean one when the
  # batch came in on stdin.
  [ -n "$2" ] || [ "$1" -ne 0 ] || return 0
  say "sftp advisory (exit $1${2:+, \"$2\"}) — sftp does not report per-command failure for a batch on stdin, so this decides nothing; the proof is below."
}
# An `ls` of one path, classified the way scripts/wp-cache-watch-deploy.sh classifies a removal: the session must have
# REACHED the host (OpenSSH's `sftp> ls` echo), exited 0, and NAMED this path — a line that LISTS the file wins over any
# "gone" text in the same session, and "gone" must carry sftp's own `Can't ls: `/`ls: ` prefix rather than merely
# containing the words (a login banner, a shell's `command not found` and a refused password all contain them).
LS_RESULT=""; LS_EV=""
ls_proof() {
  local remote base base_re name_re out rc connected clean listed gone
  remote="$1"; base="$(basename "$remote")"
  printf -- 'ls "%s"\n' "$remote" > "$B"
  say "sftp proof batch:"; sed 's/^/   /' "$B" | tee -a "$LOG"
  out="$(sftp_run)"; rc=$?
  out="$(printf '%s\n' "$out" | tr -d '\r')"
  say "sftp ls $base → exit $rc: $(flat "$out")"
  base_re="$(printf '%s' "$base" | sed 's#[][\\.*^$+?(){}|/]#\\&#g')"
  name_re="(^|[[:space:]\"'/])${base_re}([\"'[:space:]]|\$)"
  connected=0
  printf '%s\n' "$out" | grep -Eq '^sftp> *ls([[:space:]]|$)' && connected=1
  clean="$(printf '%s\n' "$out" | grep -v '^sftp>' | grep -v '^Connected to ')"
  listed="$(printf '%s\n' "$clean" | grep -Evi "can't|cannot|no such file|not found|permission denied|connection closed|failure" | grep -E "$name_re" | head -1)"
  gone="$(printf '%s\n' "$clean" | grep -Ei "^(can't ls|ls): " | grep -E "$name_re" | grep -Ei "no such file|not found" | head -1)"
  if [ "$rc" -ne 0 ]; then LS_RESULT="unknown"; LS_EV="the ls session exited $rc, so nothing it printed is an answer"
  elif [ "$connected" != 1 ]; then LS_RESULT="unknown"; LS_EV="no \"sftp> ls\" echo in that output — the command never ran on the host"
  elif [ -n "$listed" ]; then LS_RESULT="present"; LS_EV="$listed"
  elif [ -n "$gone" ]; then LS_RESULT="absent"; LS_EV="$gone"
  else LS_RESULT="unknown"; LS_EV="the session connected but no line in it names $base — neither listed, nor as sftp's own \"Can't ls: … not found\""
  fi
  say "   ls classified $LS_RESULT — evidence: $LS_EV"
}

# ── preflight ─────────────────────────────────────────────────────────────────────────────────────────────────────────
say "wp-wordfence-install $TS — $HOST:$DOCROOT · mode $MODE"
# EVERY mode needs the reporter's build fingerprint, not just --install: it is what the probe URL carries, and the
# reporter answers nothing without it. A run that cannot compute it cannot read a header in any mode, so it stops here
# rather than later, mistaking its own missing key for "Wordfence is not installed".
[ -f "$SRC_STATUS" ] || die no-source "no reporter at $SRC_STATUS — this script sends and reads the files from its own checkout; run it from a clone of atlasglinn-website"
FP_STATUS="$(sha1_of "$SRC_STATUS" | cut -c1-8)"
[ -n "$FP_STATUS" ] || die no-sha1 "no shasum/sha1sum/openssl on this machine, so the build fingerprint cannot be computed — it is both the key the reporter answers to and the proof the bytes running are the bytes sent. Nothing was sent."
if [ "$MODE" = install ]; then
  for f in "$SRC_INSTALL" "$SRC_STATUS"; do
    [ -f "$f" ] || die no-source "no plugin at $f — this script sends the files from its own checkout and never downloads one; run it from a clone of atlasglinn-website"
  done
  if command -v php >/dev/null 2>&1; then
    for f in "$SRC_INSTALL" "$SRC_STATUS"; do
      php -l "$f" >/dev/null 2>&1 || die php-lint "php -l failed on $f; nothing was uploaded"
    done
    say "php -l: both plugins parse on this Mac"
  else
    say "no php on this Mac — the two plugin files were NOT syntax-checked before upload (CI checks them on every push; .github/workflows/wp-ops-tests.yml)"
  fi
  FP_INSTALL="$(sha1_of "$SRC_INSTALL" | cut -c1-8)"
  [ -n "$FP_INSTALL" ] || die no-sha1 "no shasum/sha1sum/openssl on this Mac, so the build fingerprint the host publishes cannot be checked against the file being sent — that check is the only proof this run has. Nothing was uploaded."
  say "atlas-wordfence-install build $FP_INSTALL ($(wc -c < "$SRC_INSTALL" | tr -d ' ') bytes) + atlas-wordfence-status build $FP_STATUS ($(wc -c < "$SRC_STATUS" | tr -d ' ') bytes) → $HOST:$REMOTE_DIR/"
fi

# ── the login: the Keychain on the Mac, WP_SFTP_USER/WP_SFTP_PASSWORD on a runner ────────────────────────────────────
# The Mac is not required for this to run — .github/workflows/wordfence-deploy.yml dispatches it with the same two
# repository secrets the page upload already uses (measured 2026-09-09 14:21 UTC: that workflow pushed 120 files over
# SFTP from Actions). The MECHANISM is identical either way: the password reaches ssh through SSH_ASKPASS and never
# appears in argv, in a file or in the log. The Mac's helper shells out to the Keychain; the runner's helper prints an
# exported environment value, so on neither path does the secret land on disk. The username is used for exactly one
# thing — the connection argument — and is printed nowhere: a log or a step summary names the host, never the account.
CRED_SRC=""
if [ "$MODE" != status ]; then
  command -v sftp >/dev/null 2>&1 || die no-sftp "no sftp on this machine — the upload and the removal both travel over it, and a shell answering \"command not found\" is not a session that reached the host"
  # A browser paste puts whitespace around a secret: every run of the sibling upload workflow failed "Permission
  # denied" for a fortnight over one leading space (.github/workflows/deploy-page.yml, 2026-09-08), so both values are
  # trimmed before they are tested or used. printf is a bash builtin and the pipe is stdin, so neither reaches argv.
  ENV_USER="$(printf '%s' "${WP_SFTP_USER:-}" | tr -d '\r\n' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
  ENV_PASS="$(printf '%s' "${WP_SFTP_PASSWORD:-}" | tr -d '\r\n' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
  A="$(mktemp /tmp/wp-wf-askpass.XXXXXX)"
  if [ -n "$ENV_USER" ] && [ -n "$ENV_PASS" ]; then
    CRED_SRC="the WP_SFTP_USER/WP_SFTP_PASSWORD environment pair"
    U="$ENV_USER"
    WP_SFTP_PASSWORD="$ENV_PASS"; export WP_SFTP_PASSWORD
    printf '#!/bin/sh\nprintf %%s "$WP_SFTP_PASSWORD"\n' > "$A"
  else
    CRED_SRC="the Keychain item '$KC_SERVICE'"
    command -v security >/dev/null 2>&1 || die no-keychain-tool "no Keychain on this machine and no WP_SFTP_USER/WP_SFTP_PASSWORD in the environment — run this on the Mac, or set both variables (which is what .github/workflows/wordfence-deploy.yml does)"
    U="$(security find-generic-password -s "$KC_SERVICE" 2>/dev/null | sed -n 's/^ *"acct"<blob>="\(.*\)"$/\1/p')"
    [ -n "$U" ] || die no-keychain "no Keychain item '$KC_SERVICE' (the SFTP login); save it once: bash scripts/wp-upload.sh --save-login"
    printf '#!/bin/sh\nexec security find-generic-password -s %s -w\n' "$KC_SERVICE" > "$A"
  fi
  chmod 700 "$A"
  # $U is the last argument to sftp, and an argument starting with '-' is read as an OPTION rather than a user:
  # `-oProxyCommand=…` in a login name is arbitrary command execution. The name itself is never printed, here either.
  case "$U" in
    -*|*[!A-Za-z0-9._@-]*) die bad-login "the SFTP login name starts with '-' (which sftp reads as an option, not a user) or carries a character outside [A-Za-z0-9._@-]. It came from $CRED_SRC. Nothing was sent, and the name is not printed.";;
  esac
  export SSH_ASKPASS="$A" SSH_ASKPASS_REQUIRE=force DISPLAY="${DISPLAY:-:0}"
  say "login: $CRED_SRC → $HOST (the account name is not printed)"
  B="$(mktemp /tmp/wp-wf-batch.XXXXXX)"
fi

# ── before: what the site answers with nothing changed ────────────────────────────────────────────────────────────────
HOME_BEFORE="$(http_code "$SITE_ROOT/")"
WP_BEFORE="$(http_code "$(wp_url)")"
LOGIN_BEFORE="$(http_code "$LOGIN_URL")"
say "before: front page $SITE_ROOT/ http $HOME_BEFORE · WordPress-rendered /?atlas-wordfence=… http $WP_BEFORE · $LOGIN_URL http $LOGIN_BEFORE"
say "        (the front page is the static index.html served by wp-ops/atlas-static-root.php; the plugins below only ever run on the WordPress-rendered URL)"

if [ "$MODE" = install ] && [ "$WP_BEFORE" != 200 ] && [ "${ATLAS_WF_FORCE:-0}" != 1 ]; then
  die site-not-answering "the WordPress-rendered page answers http $WP_BEFORE BEFORE anything was uploaded — this run stops rather than add two plugins to a site that is already not answering. Fix that first, or re-run with ATLAS_WF_FORCE=1 if the code is expected."
fi

# A verdict on the login page needs a BASELINE. When the before-read is 000 — curl's chain never completed, or it
# printed no tagged status line — there is nothing for the after-code to differ from, and round 2's verifier proved
# what that costs: with the before-read at 000 a run that left wp-login.php answering http 503 still printed
# FIRED-OBSERVED and exited 0, because the regression limb exempted 000 rather than refusing to run without it. An
# install that cannot measure the only admin's way in BEFORE it starts does not start, and no environment variable
# waives this one. --disable-wordfence is exempt on purpose: it is the recovery, run precisely when the site answers
# nothing, and a recovery that refuses to run on a down site is not a recovery.
if [ "$MODE" = install ] && [ "$LOGIN_BEFORE" = 000 ]; then
  die login-not-measurable "login page not measurable before install — stopping. $LOGIN_URL answered http 000, which is curl reporting that the chain never completed rather than a status the page returned. Without that baseline this run could not tell a login page it broke from one that was already down, so nothing was uploaded. Re-run when $LOGIN_URL answers a status of any kind — 200, 403 and 503 are all measurable; 000 is not."
fi

# ── remove · remove-status ────────────────────────────────────────────────────────────────────────────────────────────
if [ "$MODE" = remove ] || [ "$MODE" = remove-status ]; then
  # act= is read BEFORE the reporter is deleted: after the rm there is no header to read, and reporting act=0 off a
  # plugin this run just removed would say Wordfence is off when it is running.
  probe; classify_status_plugin
  if [ "$STATUS_OK" = 1 ]; then read_limbs; say "before the removal: X-Atlas-Wordfence: $PROBE_HDR"
  else ST="none"; ACT="unread"; WF="none"; SELFSTATE="unknown"; say "before the removal: no usable X-Atlas-Wordfence header — $RULE"; fi
  if [ "$MODE" = remove ]; then { printf -- 'rm "%s"\n' "$REMOTE_INSTALL"; printf -- 'rm "%s"\n' "$REMOTE_STATUS"; } > "$B"
  else printf -- 'rm "%s"\n' "$REMOTE_STATUS" > "$B"; fi
  say "sftp batch:"; sed 's/^/   /' "$B" | tee -a "$LOG"
  out="$(sftp_run)"; rc=$?
  out="$(printf '%s\n' "$out" | tr -d '\r')"
  say "sftp → $HOST exit $rc: $(flat "$out")"
  advisory "$rc" "$(sftp_trouble "$out")"
  # Only the paths this run actually asked to delete are classified: an `ls` that was never sent proves nothing, and
  # --remove-status deliberately leaves the installer alone.
  r_install="not-measured"
  if [ "$MODE" = remove ]; then ls_proof "$REMOTE_INSTALL"; r_install="$LS_RESULT"; fi
  ls_proof "$REMOTE_STATUS"; r_status="$LS_RESULT"
  if [ "$MODE" = remove ]; then
    if [ "$r_install" = absent ] && [ "$r_status" = absent ]; then result="removed"
    elif [ "$r_install" = present ] || [ "$r_status" = present ]; then result="rm-failed"
    else result="rm-unknown"; fi
  else
    case "$r_status" in absent) result="removed";; present) result="rm-failed";; *) result="rm-unknown";; esac
  fi
  say "verify: installer $r_install · status plugin $r_status → $result"
  say "   Wordfence itself is NOT touched by $MODE: it stays exactly as it was (act=${ACT}, measured before the removal). Turning Wordfence OFF is --disable-wordfence, which renames its plugin directory; uninstalling it is a wp-admin act, not this script's."
  stamp "$result"
  WHAT="both mu-plugins"; [ "$MODE" = remove-status ] && WHAT="the reporter"
  case "$result" in
    removed)   say "LOOP STATUS: atlas-wordfence $WHAT — removed from the host (sftp ls says the path is gone); heartbeat $STAMP ✓";;
    rm-failed) say "LOOP STATUS: atlas-wordfence $WHAT — STILL LISTED after the rm; not deleted. Heartbeat $STAMP.";;
    *)         say "LOOP STATUS: atlas-wordfence $WHAT — $result; nothing is claimed either way. Heartbeat $STAMP.";;
  esac
  [ "$result" = removed ]
  exit
fi

# ── disable-wordfence: the recovery ───────────────────────────────────────────────────────────────────────────────────
# This is the mode --remove cannot be. --remove deletes what this script installed; if WORDFENCE is what took the site
# or the login page down, the only thing that helps is Wordfence not loading, and over SFTP that means renaming the
# directory out from under it. The proof is an `ls` of wordfence/wordfence.php (gone) and of wordfence.off/wordfence.php
# (there) — an `ls` of a directory lists its contents, so the file inside is what can be classified — and then the three
# pages are measured again and printed. Renaming back is the same command with the arguments swapped.
if [ "$MODE" = disable ]; then
  probe; classify_status_plugin
  if [ "$STATUS_OK" = 1 ]; then read_limbs; say "before the rename: X-Atlas-Wordfence: $PROBE_HDR"
  else ST="none"; ACT="unread"; WF="none"; SELFSTATE="unknown"; say "before the rename: no usable X-Atlas-Wordfence header — $RULE (a site that is down answers no header either, which is why this mode does not need one)"; fi
  # prep= is Wordfence's extended protection, and it is the one state in which this rename makes things WORSE. Under
  # auto_prepend_file, PHP loads wordfence-waf.php from inside the directory about to be renamed on every single
  # request — so a degraded site becomes a hard-down one, wp-login.php included. The run reads that limb already; it
  # costs one `case` to consult it. Whether a missing prepended file fatals is Wordfence's own behaviour and is
  # UNVERIFIABLE FROM HERE, which is why an unreadable prep= is a warning and not a refusal.
  PREP="unknown"; [ "$STATUS_OK" = 1 ] && PREP="$(limb prep)"
  case "$PREP" in
    1) die disable-refused-prep "REFUSED, and nothing was sent. The header says prep=1 — Wordfence's extended protection is on, so PHP loads wordfence-waf.php from inside html/wp-content/plugins/wordfence on every request via auto_prepend_file. Renaming that directory away would turn a degraded site into a hard-down one, wp-login.php included. wordfence-waf.php and the auto_prepend_file line (php.ini or .user.ini) have to be dealt with first, and that needs a route this script does not have.";;
    0) ;;
    *) say "   prep= could not be read, so whether Wordfence's extended protection is on is UNVERIFIABLE FROM HERE (a site that is down answers no header, which is exactly when this mode runs). If it IS on, wordfence-waf.php is loaded by auto_prepend_file from inside the directory about to be renamed and has to be dealt with as well — this rename alone would not bring the site back.";;
  esac
  printf -- 'rename "%s" "%s"\n' "$REMOTE_WF_DIR" "$REMOTE_WF_OFF" > "$B"
  say "sftp batch:"; sed 's/^/   /' "$B" | tee -a "$LOG"
  out="$(sftp_run)"; rc=$?
  out="$(printf '%s\n' "$out" | tr -d '\r')"
  say "sftp → $HOST exit $rc: $(flat "$out")"
  advisory "$rc" "$(sftp_trouble "$out")"
  ls_proof "$REMOTE_WF_FILE";     r_live="$LS_RESULT"; ev_live="$LS_EV"
  ls_proof "$REMOTE_WF_OFF_FILE"; r_off="$LS_RESULT";  ev_off="$LS_EV"
  if [ "$r_live" = absent ] && [ "$r_off" = present ]; then result="wordfence-disabled"
  elif [ "$r_live" = present ]; then result="disable-failed"
  else result="disable-unknown"; fi
  HOME_AFTER="$(http_code "$SITE_ROOT/")"
  WP_AFTER="$(http_code "$(wp_url)")"
  LOGIN_AFTER="$(http_code "$LOGIN_URL")"
  say "after:  front page http $HOME_AFTER (was $HOME_BEFORE) · WordPress-rendered http $WP_AFTER (was $WP_BEFORE) · $LOGIN_URL http $LOGIN_AFTER (was $LOGIN_BEFORE)"
  say "verify: wordfence/wordfence.php $r_live · wordfence.off/wordfence.php $r_off → $result"
  stamp "$result"
  # The way back is printed on EVERY outcome of this mode, including the ones where the ls could not say what
  # happened. The rename has already been sent by this line; an operator told "nothing is claimed either way" and not
  # told how to undo it is being handed the failure branch of the remedy with no remedy on it.
  say "   To put it back: one sftp rename in the other direction — rename \"$REMOTE_WF_OFF\" \"$REMOTE_WF_DIR\"."
  case "$result" in
    wordfence-disabled)
      say "   Wordfence cannot load from a path that is not there, so it stopped running on the request after the rename; WordPress drops the missing entry from active_plugins the next time an admin screen validates the plugin list."
      if [ "$WP_AFTER" = 200 ] && [ "$LOGIN_AFTER" = 200 ]; then
        say "   The WordPress-rendered page and $LOGIN_URL both answer http 200 now."
      else
        say "   The WordPress-rendered page answers http $WP_AFTER and $LOGIN_URL answers http $LOGIN_AFTER — still not both 200, so Wordfence was NOT the whole cause. Nothing else has been changed."
      fi
      say "LOOP STATUS: atlas-wordfence — Wordfence DISABLED by rename (sftp ls says $REMOTE_WF_FILE is gone and $REMOTE_WF_OFF_FILE is there); heartbeat $STAMP ✓";;
    disable-failed)
      say "LOOP STATUS: atlas-wordfence — the rename did NOT take: $REMOTE_WF_FILE is still listed. Wordfence is still running. Heartbeat $STAMP.";;
    *)
      say "LOOP STATUS: atlas-wordfence — $result; the ls could not answer (wordfence/wordfence.php: $ev_live · wordfence.off/wordfence.php: $ev_off), so nothing is claimed either way. Heartbeat $STAMP.";;
  esac
  [ "$result" = wordfence-disabled ]
  exit
fi

# ── install: upload both files ────────────────────────────────────────────────────────────────────────────────────────
if [ "$MODE" = install ]; then
  # The status plugin goes first in the batch so it is already on the host whenever the installer first fires — a run
  # whose installer completed before its reporter landed has no way to say what it did.
  { printf -- '-mkdir "%s"\n' "$REMOTE_DIR"
    printf -- 'put "%s" "%s"\n' "$SRC_STATUS" "$REMOTE_STATUS"
    printf -- 'put "%s" "%s"\n' "$SRC_INSTALL" "$REMOTE_INSTALL"; } > "$B"
  say "sftp batch:"; sed 's/^/   /' "$B" | tee -a "$LOG"
  out="$(sftp_run)"; rc=$?
  out="$(printf '%s\n' "$out" | tr -d '\r')"
  say "sftp → $HOST exit $rc: $(flat "$out")"
  WARN="$(sftp_trouble "$out")"
  advisory "$rc" "$WARN"

  # Nothing below is readable until the reporter is proved to be the bytes just sent.
  probe; classify_status_plugin
  if [ "$STATUS_OK" != 1 ]; then
    say "verify: the status plugin is not answering yet — $RULE; retrying once in 15 s (the host can still be serving from its page cache or opcache)"
    sleep 15
    probe; classify_status_plugin
  fi
  if [ "$STATUS_OK" != 1 ]; then
    ST="none"; ACT=0; WF="none"; SELFSTATE="unknown"; result="status-absent"
    say "verify: UNKNOWN — no usable X-Atlas-Wordfence header (http ${PROBE_CODE:-none}, header \"${PROBE_HDR:-none}\"). $RULE."
    say "   The installer may still be on the host and may still run; this run cannot read the result, so it claims nothing.${WARN:+ The sftp advisory above (\"$WARN\") is the likely reason the bytes sent are not the bytes running.}"
    stamp "$result"
    say "LOOP STATUS: atlas-wordfence — $result; NOT verified. Heartbeat $STAMP."
    exit 1
  fi
  say "verify: X-Atlas-Wordfence: $PROBE_HDR — $RULE"
  read_limbs

  # ── trigger + poll ──────────────────────────────────────────────────────────────────────────────────────────────────
  # The installer runs on `init` of a plain front-end GET. This is that GET. It is given a long timeout on purpose: a
  # disconnect mid-download is a request PHP may abort, which costs one of the installer's three attempts.
  attempt=0
  while [ "$attempt" -lt "$TRIGGER_TRIES" ]; do
    attempt=$((attempt + 1))
    t_url="$(wp_url)"
    t_code="$(curl -s -o /dev/null -m 240 -w '%{http_code}' -A "wp-wordfence-install" "$t_url" 2>/dev/null || echo 000)"
    say "trigger $attempt/$TRIGGER_TRIES: GET /?atlas-wordfence=… → http $t_code"
    poll=0
    while [ "$poll" -lt "$POLL_TRIES" ]; do
      poll=$((poll + 1))
      probe; classify_status_plugin
      if [ "$STATUS_OK" = 1 ]; then
        read_limbs
        say "   poll $poll/$POLL_TRIES: st=$ST act=$ACT wf=$WF self=$SELFSTATE tries=$(limb tries)"
        case "$ST" in
          installed|activated|already-active|installed-not-active|gave-up|no-filesystem) break 2;;
          error) break;;   # retryable while the installer still has attempts left — trigger again
        esac
      else
        say "   poll $poll/$POLL_TRIES: no usable header — $RULE"
      fi
      sleep "$POLL_SLEEP"
    done
  done
  probe; classify_status_plugin
  [ "$STATUS_OK" = 1 ] && read_limbs
fi

if [ "$MODE" = status ]; then
  probe; classify_status_plugin
  if [ "$STATUS_OK" = 1 ]; then read_limbs; say "X-Atlas-Wordfence: $PROBE_HDR"
  else say "no usable X-Atlas-Wordfence header — $RULE"; fi
fi

# ── after: the site, the login form, the markers ──────────────────────────────────────────────────────────────────────
HOME_AFTER="$(http_code "$SITE_ROOT/")"
WP_AFTER="$(http_code "$(wp_url)")"
LOGIN_AFTER="$(http_code "$LOGIN_URL")"
say "after:  front page http $HOME_AFTER (was $HOME_BEFORE) · WordPress-rendered http $WP_AFTER (was $WP_BEFORE) · $LOGIN_URL http $LOGIN_AFTER (was $LOGIN_BEFORE)"
say "        wp-login.php answering what it answered BEFORE is expected — the form is meant to load. What is not expected is a change, and a change fails this run (below)."
say "        No lockout setting was written by this run, and that is not the same as no lockout: once Wordfence is active ITS OWN shipped defaults govern login throttling, and what those defaults are is UNVERIFIABLE FROM HERE — the vendor's code is not in this repository. If a lockout does happen, the way out with no shell is bash scripts/wp-wordfence-install.sh --disable-wordfence."

# Advisory only, and deliberately so: Wordfence Free adds nothing to a front-end response as a rule, so a count of 0
# here says nothing about whether it is running. act= above is the verdict.
BODY="$(curl -s -m 45 -A "wp-wordfence-install" "$(wp_url)" 2>/dev/null | head -c 400000)"
MARKS="$(printf '%s' "$BODY" | grep -o -i -E 'wp-content/plugins/wordfence|wordfence|wfls' | sort | uniq -c | tr '\n' ' ' | cut -c1-160)"
say "markers on the WordPress-rendered page: ${MARKS:-none} (advisory — Wordfence Free normally prints nothing on a public page, so an empty count is not a failure and a count is not a proof)"

# ── the installer must be gone ────────────────────────────────────────────────────────────────────────────────────────
# --status opens no sftp session at all, so it cannot answer this. It says so, in those words, and the verdict below
# refuses to print FIRED-OBSERVED in that mode: a claim of self-removal off a mode that measured nothing is exactly the
# false success this script exists to make impossible.
SELF_LS="not-measured"
SELF_WHY="self-removal: not measured in --status (this mode runs no sftp session); the header's own self=$SELFSTATE limb is the installer's record of what it did, not a measurement of the host by this run"
if [ "$MODE" = install ]; then
  ls_proof "$REMOTE_INSTALL"
  SELF_LS="$LS_RESULT"
  SELF_WHY="sftp ls classified $SELF_LS ($LS_EV)"
fi

# ── verdict ───────────────────────────────────────────────────────────────────────────────────────────────────────────
# The login page is IN the regression test, not merely printed beside it. It is measured before and after for one
# reason — to catch a security plugin that locks the only admin out — and a measurement that cannot fail the run is
# decoration. Any CHANGE fails, not just a 200 that stops being one: 200 → 503 and 200 → 302-to-somewhere-else are both
# the login page behaving differently than it did ten seconds earlier, and neither is something this run may pass over.
# There is NO exemption in this limb, and that is the round-2 fix. The version below it read
# `[ "$LOGIN_BEFORE" != 000 ] && …`, so an unmeasurable baseline silently dropped the login page out of the verdict and
# 000 → 503 passed. A baseline is now a precondition of the run (the die above), not a condition on the comparison —
# the difference between "we could not measure it, so it cannot fail" and "we could not measure it, so we stop".
regressed=""
[ "$HOME_BEFORE" = 200 ] && [ "$HOME_AFTER" != 200 ] && regressed="the front page went from http 200 to http $HOME_AFTER"
[ "$WP_BEFORE" = 200 ] && [ "$WP_AFTER" != 200 ] && regressed="${regressed:+$regressed; }the WordPress-rendered page went from http 200 to http $WP_AFTER"
[ "$LOGIN_AFTER" != "$LOGIN_BEFORE" ] && regressed="${regressed:+$regressed; }$LOGIN_URL went from http $LOGIN_BEFORE to http $LOGIN_AFTER"

# --status never returns the install verdict, because it never ran the sftp ls that the install verdict includes.
ACTIVE_RESULT=active
[ "$MODE" = status ] && ACTIVE_RESULT=active-status-only

if [ -n "$regressed" ]; then
  result="site-changed"
elif [ "$STATUS_OK" != 1 ]; then
  result="status-absent"
elif [ "$ACT" = 1 ]; then
  # act= is a LIVE read of active_plugins on the request that answered, and it outranks every recorded status —
  # including installed-not-active, which activate_plugin() can return AFTER it has already written active_plugins.
  # Reporting a running WAF as off is the error direction that costs a second, unnecessary install run.
  result="$ACTIVE_RESULT"
else
  case "$ST" in
    installed|activated|already-active|installed-not-active) result="not-active";;
    error|gave-up|no-filesystem) result="install-error";;
    running) result="timed-out";;
    *) result="unknown-status";;
  esac
fi
# The one-shot's own record is not a measurement of the host. In --install the sftp ls decides; in --status the header's
# self=left is still enough to REFUSE the claim (the installer itself says it is still there), but self=gone is never
# enough to MAKE one.
if [ "$result" = "$ACTIVE_RESULT" ]; then
  if [ "$MODE" = install ] && [ "$SELF_LS" != absent ]; then result="self-left"
  elif [ "$MODE" = status ] && [ "$SELFSTATE" = left ]; then result="self-left"; fi
fi

# Both login codes, in the verdict, on every run that reaches it — pass or fail. A verdict that prints only the
# after-code cannot be checked by the person reading it, and the before-code is half of the rule being applied.
say "verdict inputs: $LOGIN_URL before http $LOGIN_BEFORE · after http $LOGIN_AFTER — any difference between those two fails this run (front page $HOME_BEFORE→$HOME_AFTER · WordPress-rendered $WP_BEFORE→$WP_AFTER)"

case "$result" in
  active)
    say "verify: Wordfence $WF is INSTALLED and ACTIVE on atlasglinn.com — st=$ST, and act=1 is a live read of the site's active_plugins on the request that answered, not the installer's memory of what it did."
    say "        The one-shot removed itself — $SELF_WHY. No Wordfence setting was written by this run: no login-failure limit, no lockout window, no blacklist, no 2FA, no auto_prepend_file (prep=$(limb prep)); Wordfence's own defaults govern from here."
    say "        wp-ops/atlas-wordfence-status.php stays on the host as the read-only reporter — it answers only a request carrying its build fingerprint, and bash scripts/wp-wordfence-install.sh --remove-status takes it off.";;
  active-status-only)
    say "verify: Wordfence $WF is INSTALLED and ACTIVE on atlasglinn.com — st=$ST, and act=1 is a live read of the site's active_plugins on the request that answered, not the installer's memory of what it did."
    say "        $SELF_WHY. Run bash scripts/wp-wordfence-install.sh --install to have that ls done, or --remove to take both files off."
    say "        No Wordfence setting was written by any run of this script; Wordfence's own defaults govern login throttling.";;
  not-active)
    say "verify: the installer recorded st=$ST but act=$ACT — Wordfence is NOT active right now.$(err_note)"
    say "        GoDaddy Managed WordPress keeps a blocklist of disallowed plugins and whether wordfence is on it is UNVERIFIABLE FROM HERE. Nothing else on the host was changed.";;
  install-error)
    say "verify: the install FAILED — st=$ST.$(err_note)"
    say "        Nothing was activated and no setting was written. The installer stopped after ${TRIGGER_TRIES} triggers; the option atlas_wordfence_install holds WordPress's own message, which is deliberately not on the header.";;
  timed-out)
    say "verify: the installer is still st=running after $TRIGGER_TRIES triggers — the download did not finish inside a request. It has $(limb tries) of 3 attempts used; the next front-end request retries by itself, so re-run --status in a few minutes before re-installing.";;
  self-left)
    say "verify: Wordfence $WF is active (st=$ST, act=1) BUT the one-shot installer is STILL ON THE HOST — $SELF_WHY."
    say "        That is live code on a production site that has already done its job. Remove it: bash scripts/wp-wordfence-install.sh --remove";;
  site-changed)
    say "verify: FAILED on the site itself — $regressed. That outranks whatever the plugin reports (st=$ST act=$ACT)."
    say "        RECOVERY, in this order. If Wordfence is what changed it, the fix is Wordfence not loading, and --remove CANNOT do that — it deletes this script's two mu-plugins and leaves Wordfence exactly where it is:"
    say "            bash scripts/wp-wordfence-install.sh --disable-wordfence   # renames wp-content/plugins/wordfence to wordfence.off over sftp, then re-measures the front page and $LOGIN_URL"
    say "        Then, once the site answers again, take this script's own files off with: bash scripts/wp-wordfence-install.sh --remove";;
  status-absent)
    say "verify: UNKNOWN — no usable X-Atlas-Wordfence header on the final read. $RULE. This run claims nothing.";;
  *)
    say "verify: UNKNOWN — the header carried st=\"$ST\", which this script does not know. Header: ${PROBE_HDR:-none}";;
esac

stamp "$result"
case "$result" in
  active) say "LOOP STATUS: R2 Wordfence install — FIRED-OBSERVED (Wordfence $WF active on atlasglinn.com, act=1 off the wire, installer self-removal proved by sftp ls); heartbeat $STAMP ✓";;
  active-status-only)
    # The words FIRED-OBSERVED do not appear on this line at all, not even to deny them: an operator greps for that
    # token, and a line that carries it inside a negation reads as a success in every log search that matters.
    say "LOOP STATUS: R2 Wordfence install — Wordfence $WF is active (act=1, measured on the wire); self-removal NOT measured in --status, so this run does not close the loop. Heartbeat $STAMP.";;
  *)      say "LOOP STATUS: R2 Wordfence install — $result; NOT verified as active. Heartbeat $STAMP.";;
esac

EMAIL="$HOME/.claude/bin/atlas-email"
if [ -x "$EMAIL" ]; then
  if "$EMAIL" "wp-wordfence-install $TS — $result" < "$LOG" >/dev/null 2>&1; then say "emailed to matthew@atlasglinn.com"
  else say "the email helper $EMAIL refused the send (subject as the first argument, log on stdin); read the log instead"; fi
else
  say "no ~/.claude/bin/atlas-email on this Mac; nothing emailed"
fi
say "log: $LOG"
# --status exits 0 on what --status can actually prove: act=1 measured on the wire. It never exits 0 on a claim it did
# not measure, and it never prints the install verdict.
case "$result" in
  active)             exit 0;;
  active-status-only) [ "$MODE" = status ] && exit 0; exit 1;;
  *)                  exit 1;;
esac
