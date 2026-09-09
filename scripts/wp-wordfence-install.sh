#!/usr/bin/env bash
# Install Wordfence Security on atlasglinn.com from the Mac, over SFTP, and prove from the outside that it is active.
#
# Why not `wp plugin install wordfence`: the saved GoDaddy login `mast-wp-sftp` answers "This service allows sftp
# connections only." (measured 2026-09-08 18:46 UTC, scripts/wp-cache-watch-deploy.sh). There is no shell, so there is
# no WP-CLI, and a script built on SSH installs nothing — it reports a preflight failure and stops. What works is SFTP,
# and the same route the cache cascade already travels carries this: two must-use plugins land in
# html/wp-content/mu-plugins/, one request triggers them, and the answer comes back on a response header.
#
#   bash scripts/wp-wordfence-install.sh            # upload, trigger, measure, report — the whole R2 step in one run
#   bash scripts/wp-wordfence-install.sh --status   # measure only: nothing is uploaded and nothing is triggered
#   bash scripts/wp-wordfence-install.sh --remove   # delete BOTH mu-plugins (Wordfence itself is left running)
#
# Any other argument, or more than one, aborts before anything is sent — the same rule as the sibling deploy script,
# for the same reason: `--remove --install` reads as a removal to a human and must reach no host at all.
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
#      exact bytes uploaded count as deployed. Without that, nothing below is read at all.
#   2. `act=1` on that header is the verdict, and it is a LIVE read of the site's active_plugins option on the request
#      that answered — not the installer's memory of what it did. A recorded st=installed with act=0 is a failure.
#   3. The installer file must be GONE, proved by an sftp `ls` of its path classified exactly as the sibling script
#      classifies a removal (the session must carry OpenSSH's `sftp> ls` echo, exit 0, and either LIST the file — which
#      wins over any "gone" text in the same session — or answer with sftp's own `Can't ls: … not found`). A one-shot
#      that did not remove itself is live code left on a production site, so that is a non-zero exit even when
#      Wordfence installed perfectly.
#   4. The site must still answer. The reader-facing front page (https://atlasglinn.com/, served from index.html by
#      wp-ops/atlas-static-root.php) and the WordPress-rendered page are both measured before and after; a 200 that
#      stops being a 200 fails the run whatever the plugin says.
# What is NOT proof: the sftp exit code and its text (a batch on stdin does not abort on a failed put — that needs -b,
# which sets BatchMode and refuses the Keychain askpass), and the Wordfence markers grepped out of the page body.
# Wordfence Free adds nothing to a front-end response as a rule, so their absence says nothing; they are printed as an
# advisory and decide nothing.
#
# EVERY MEASUREMENT USES ?atlas-wordfence=<ts>. https://atlasglinn.com/ is answered by wp-ops/atlas-static-root.php
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
WP_BASE="${WP_BASE:-https://www.atlasglinn.com}"
SITE_ROOT="${WP_SITE_ROOT:-https://atlasglinn.com}"
LOGIN_URL="${WP_LOGIN_URL:-https://atlasglinn.com/wp-login.php}"
KC_SERVICE="${KC_SFTP:-mast-wp-sftp}"
REMOTE_DIR="$DOCROOT/wp-content/mu-plugins"
REMOTE_INSTALL="$REMOTE_DIR/atlas-wordfence-install.php"
REMOTE_STATUS="$REMOTE_DIR/atlas-wordfence-status.php"
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

SELF="${BASH_SOURCE[0]:-$0}"
ROOT="$(cd "$(dirname "$SELF")/.." 2>/dev/null && pwd || true)"
SRC_INSTALL="${ATLAS_WF_INSTALL_SRC:-${ROOT:-.}/wp-ops/atlas-wordfence-install.php}"
SRC_STATUS="${ATLAS_WF_STATUS_SRC:-${ROOT:-.}/wp-ops/atlas-wordfence-status.php}"
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
  die bad-arg "this script takes at most one argument and was given $# (\"$*\") — say --install, --status or --remove, never two; nothing was sent"
fi
case "${1:-}" in
  ""|--install) MODE=install;;
  --status)     MODE=status;;
  --remove)     MODE=remove;;
  *)            die bad-arg "unknown argument \"$1\" — this script takes no argument (or --install) to install, --status to measure only, and --remove to delete both mu-plugins; nothing was sent";;
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
wp_url() { printf '%s/?atlas-wordfence=%s' "$WP_BASE" "$(date +%s)"; }

PROBE_RC=1; PROBE_CODE="000"; PROBE_FINAL=""; PROBE_HDR=""; PROBE_WHY=""; RULE=""
probe() {
  local raw parsed
  PROBE_RC=1; PROBE_CODE="000"; PROBE_FINAL=""; PROBE_HDR=""; PROBE_WHY=""
  raw="$(curl -sI -L --max-redirs 3 -o /dev/null -D - -w '\nATLAS_HTTP_CODE:%{http_code}\n' -m 45 -A "wp-wordfence-install" "$(wp_url)" 2>/dev/null)"
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
  if [ -z "$PROBE_HDR" ]; then RULE="rule header-absent: the chain ended in http 200 and that response carried no X-Atlas-Wordfence"; return; fi
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
  FP_STATUS="$(sha1_of "$SRC_STATUS" | cut -c1-8)"
  { [ -n "$FP_INSTALL" ] && [ -n "$FP_STATUS" ]; } || die no-sha1 "no shasum/sha1sum/openssl on this Mac, so the build fingerprint the host publishes cannot be checked against the file being sent — that check is the only proof this run has. Nothing was uploaded."
  say "atlas-wordfence-install build $FP_INSTALL ($(wc -c < "$SRC_INSTALL" | tr -d ' ') bytes) + atlas-wordfence-status build $FP_STATUS ($(wc -c < "$SRC_STATUS" | tr -d ' ') bytes) → $HOST:$REMOTE_DIR/"
elif [ "$MODE" = status ] && [ -f "$SRC_STATUS" ]; then
  FP_STATUS="$(sha1_of "$SRC_STATUS" | cut -c1-8)"
fi

if [ "$MODE" != status ]; then
  command -v sftp >/dev/null 2>&1 || die no-sftp "no sftp on this machine — the upload and the removal both travel over it, and a shell answering \"command not found\" is not a session that reached the host"
  command -v security >/dev/null 2>&1 || die no-keychain-tool "the Keychain is macOS-only; run this on the Mac"
  U="$(security find-generic-password -s "$KC_SERVICE" 2>/dev/null | sed -n 's/^ *"acct"<blob>="\(.*\)"$/\1/p')"
  [ -n "$U" ] || die no-keychain "no Keychain item '$KC_SERVICE' (the SFTP login); save it once: bash scripts/wp-upload.sh --save-login"
  A="$(mktemp /tmp/wp-wf-askpass.XXXXXX)"
  printf '#!/bin/sh\nexec security find-generic-password -s %s -w\n' "$KC_SERVICE" > "$A"; chmod 700 "$A"
  export SSH_ASKPASS="$A" SSH_ASKPASS_REQUIRE=force DISPLAY="${DISPLAY:-:0}"
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

# ── remove ────────────────────────────────────────────────────────────────────────────────────────────────────────────
if [ "$MODE" = remove ]; then
  # act= is read BEFORE the reporter is deleted: after the rm there is no header to read, and reporting act=0 off a
  # plugin this run just removed would say Wordfence is off when it is running.
  probe; classify_status_plugin
  if [ "$STATUS_OK" = 1 ]; then read_limbs; say "before the removal: X-Atlas-Wordfence: $PROBE_HDR"
  else ST="none"; ACT="unread"; WF="none"; SELFSTATE="unknown"; say "before the removal: no usable X-Atlas-Wordfence header — $RULE"; fi
  { printf -- 'rm "%s"\n' "$REMOTE_INSTALL"; printf -- 'rm "%s"\n' "$REMOTE_STATUS"; } > "$B"
  say "sftp batch:"; sed 's/^/   /' "$B" | tee -a "$LOG"
  out="$(sftp_run)"; rc=$?
  out="$(printf '%s\n' "$out" | tr -d '\r')"
  say "sftp $U@$HOST → exit $rc: $(flat "$out")"
  advisory "$rc" "$(sftp_trouble "$out")"
  ls_proof "$REMOTE_INSTALL"; r_install="$LS_RESULT"
  ls_proof "$REMOTE_STATUS";  r_status="$LS_RESULT"
  if [ "$r_install" = absent ] && [ "$r_status" = absent ]; then result="removed"
  elif [ "$r_install" = present ] || [ "$r_status" = present ]; then result="rm-failed"
  else result="rm-unknown"; fi
  say "verify: installer $r_install · status plugin $r_status → $result"
  say "   Wordfence itself is NOT touched by --remove: it stays exactly as it was (act=${ACT}, measured before the removal). Deactivating or uninstalling it is a wp-admin act, not this script's."
  stamp "$result"
  case "$result" in
    removed)   say "LOOP STATUS: atlas-wordfence mu-plugins — removed from the host (sftp ls says both paths are gone); heartbeat $STAMP ✓";;
    rm-failed) say "LOOP STATUS: atlas-wordfence mu-plugins — STILL LISTED after the rm; they were not deleted. Heartbeat $STAMP.";;
    *)         say "LOOP STATUS: atlas-wordfence mu-plugins — $result; nothing is claimed either way. Heartbeat $STAMP.";;
  esac
  [ "$result" = removed ]
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
  say "sftp $U@$HOST → exit $rc: $(flat "$out")"
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
say "        wp-login.php answering 200 is EXPECTED and is not a failure — the form is meant to load; Wordfence throttles failed POSTs, and no lockout setting was written by this run."

# Advisory only, and deliberately so: Wordfence Free adds nothing to a front-end response as a rule, so a count of 0
# here says nothing about whether it is running. act= above is the verdict.
BODY="$(curl -s -m 45 -A "wp-wordfence-install" "$(wp_url)" 2>/dev/null | head -c 400000)"
MARKS="$(printf '%s' "$BODY" | grep -o -i -E 'wp-content/plugins/wordfence|wordfence|wfls' | sort | uniq -c | tr '\n' ' ' | cut -c1-160)"
say "markers on the WordPress-rendered page: ${MARKS:-none} (advisory — Wordfence Free normally prints nothing on a public page, so an empty count is not a failure and a count is not a proof)"

# ── the installer must be gone ────────────────────────────────────────────────────────────────────────────────────────
SELF_LS="skipped"
if [ "$MODE" = install ]; then
  ls_proof "$REMOTE_INSTALL"
  SELF_LS="$LS_RESULT"
fi

# ── verdict ───────────────────────────────────────────────────────────────────────────────────────────────────────────
regressed=""
[ "$HOME_BEFORE" = 200 ] && [ "$HOME_AFTER" != 200 ] && regressed="the front page went from http 200 to http $HOME_AFTER"
[ "$WP_BEFORE" = 200 ] && [ "$WP_AFTER" != 200 ] && regressed="${regressed:+$regressed; }the WordPress-rendered page went from http 200 to http $WP_AFTER"

if [ -n "$regressed" ]; then
  result="site-changed"
elif [ "$STATUS_OK" != 1 ]; then
  result="status-absent"
else
  case "$ST" in
    installed|activated|already-active)
      if [ "$ACT" = 1 ]; then result="active"; else result="not-active"; fi;;
    installed-not-active) result="not-active";;
    error|gave-up|no-filesystem) result="install-error";;
    running) result="timed-out";;
    *) result="unknown-status";;
  esac
  if [ "$result" = active ] && [ "$MODE" = install ] && [ "$SELF_LS" != absent ]; then
    result="self-left"
  fi
fi

case "$result" in
  active)
    say "verify: Wordfence $WF is INSTALLED and ACTIVE on atlasglinn.com — st=$ST, and act=1 is a live read of the site's active_plugins on the request that answered, not the installer's memory of what it did."
    say "        The one-shot removed itself (sftp ls says $REMOTE_INSTALL is gone). No Wordfence setting was written: no login-failure limit, no lockout, no blacklist, no 2FA, no auto_prepend_file (prep=$(limb prep))."
    say "        wp-ops/atlas-wordfence-status.php stays on the host as the read-only reporter; bash scripts/wp-wordfence-install.sh --remove deletes it.";;
  not-active)
    say "verify: the installer recorded st=$ST but act=$ACT — Wordfence is NOT active right now.${ERRTXT:+ Recorded error: $(printf '%b' "${ERRTXT//%/\\x}")}"
    say "        GoDaddy Managed WordPress keeps a blocklist of disallowed plugins and whether wordfence is on it is UNVERIFIABLE FROM HERE. Nothing else on the host was changed.";;
  install-error)
    say "verify: the install FAILED — st=$ST.${ERRTXT:+ Error: $(printf '%b' "${ERRTXT//%/\\x}")}"
    say "        Nothing was activated and no setting was written. The installer stopped after ${TRIGGER_TRIES} triggers; the option atlas_wordfence_install holds the full message.";;
  timed-out)
    say "verify: the installer is still st=running after $TRIGGER_TRIES triggers — the download did not finish inside a request. It has $(limb tries) of 3 attempts used; the next front-end request retries by itself, so re-run --status in a few minutes before re-installing.";;
  self-left)
    say "verify: Wordfence $WF is active (st=$ST, act=1) BUT the one-shot installer is STILL ON THE HOST — sftp ls classified $SELF_LS ($LS_EV)."
    say "        That is live code on a production site that has already done its job. Remove it: bash scripts/wp-wordfence-install.sh --remove";;
  site-changed)
    say "verify: FAILED on the site itself — $regressed. That outranks whatever the plugin reports (st=$ST act=$ACT)."
    say "        Remove both mu-plugins now and re-measure: bash scripts/wp-wordfence-install.sh --remove";;
  status-absent)
    say "verify: UNKNOWN — no usable X-Atlas-Wordfence header on the final read. $RULE. This run claims nothing.";;
  *)
    say "verify: UNKNOWN — the header carried st=\"$ST\", which this script does not know. Header: ${PROBE_HDR:-none}";;
esac

stamp "$result"
case "$result" in
  active) say "LOOP STATUS: R2 Wordfence install — FIRED-OBSERVED (Wordfence $WF active on atlasglinn.com, act=1 off the wire, installer self-removed); heartbeat $STAMP ✓";;
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
[ "$result" = active ]
