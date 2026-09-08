#!/usr/bin/env bash
# Harness for scripts/wp-cache-watch-deploy.sh — stub sftp, curl, security, shasum and sleep on PATH, no host and no
# network. Run from anywhere:
#
#   bash scripts/tests/wp-cache-watch-deploy-test.sh
#
# It prints PASS/FAIL per case and exits non-zero if any case fails, if the run produced fewer cases than the count
# pinned at the bottom (175, measured at round 5), or if it dies before printing its summary — a harness that stops
# early used to look green.
#
# What it holds down, case by case, after rounds 3-5:
#   · sftp's exit code and its text are ADVISORY. A batch on stdin does not abort on a failed put or rm (that needs -b,
#     which sets BatchMode and refuses the Keychain askpass), so a run whose sftp said "Permission denied" and whose
#     host serves an old build must still fail — on the fingerprint, not on the exit code — and a run whose sftp exited
#     non-zero while the host serves the exact bytes sent is a verified deploy.
#   · the tolerated `-mkdir` prints "Couldn't create directory: Failure" on every healthy run, so that line must NOT
#     raise an advisory.
#   · the version alone is not proof; the build fingerprint the plugin publishes has to equal the file just sent.
#   · a missing header gets exactly one retry and then a non-zero exit.
#   · --remove is decided by an sftp `ls` of the same path, never by the header: a plugin still on the host but disabled
#     by a wp-config constant sends no header either. And the words are not the answer — round 4: "removed" needs the
#     session to have REACHED the host (the `sftp> ls` echo OpenSSH writes for a command read off stdin), to have exited
#     0, and to have named THIS path as missing. A shell's `command not found`, a login banner or a subsystem failure
#     carrying the words "not found", a "not found" about some other path, or a non-zero exit are all rm-unknown, even
#     when the file is still there; a banner that says "not found" over a session that lists the file is rm-failed.
#   · `sftp` itself is a preflight check, so a machine without it aborts instead of reading its shell's error as a host
#     answer; and an argument the script does not know aborts before anything is sent (it used to mean "install").
#   · every abort before the verdict stamps `aborted-<reason>` over the heartbeat, so a previous run's `deployed` can
#     never be read as this run's.
#   · the probe follows redirects, and the header is read from the FINAL response block of the -D - chain: a header on
#     a 301 hop belongs to the hop, and crediting it would report a deploy from a response no reader ever sees.
#   · round 5, the probe: a chain that ABORTED is not read at all. curl exits 47 when --max-redirs is exhausted having
#     already printed its hops, and one of them can carry the exact fingerprint just uploaded — so curl's exit code is
#     captured and a non-zero one refuses the read before a single header is parsed. The status is taken ONLY from
#     curl's own tagged `ATLAS_HTTP_CODE:<3 digits>` write-out line (a bare `%{http_code}` tail let a header line's
#     digits stand in as the status when curl printed no write-out), and the FINAL block must be a 200: a 3xx there is
#     a truncated chain, and a header on any other status is not a page a reader was served. The rule that fired is
#     printed and asserted, so a case cannot pass on the right verdict for the wrong reason.
#   · round 5, --remove: a line LISTING the file wins over any "gone" text in the same session, the name is matched
#     EXACTLY (bounded by start/whitespace/quote/slash and quote/whitespace/end, so `.bak` and `old-` neighbours are
#     other files), the capture is stripped of carriage returns before it is classified, and "gone" must carry sftp's
#     own `Can't ls: `/`ls: ` prefix rather than merely containing the words.
#   · round 5, arguments: the COUNT is checked before the value, so `--remove --install` dies without sending anything
#     instead of silently acting on the first word.
#   · round 5, the gates are pinned by BEHAVIOUR. Five of the six `wire/*` checks were greps of the script's own source
#     — a gate can be present and dead and still pass a grep. Each is now a scenario only a working gate survives, and
#     each was proved by breaking that gate in a scratch copy of the script and watching the case fail.
#   · scripts/wp-flush.sh's cascade heredoc carries the plugin's redaction and its exact allowlist (it runs on the host,
#     where no scenario can reach it, so it is checked as text here).
#
# The stub Keychain password is a fixed string that must appear in no output, log or heartbeat this run; the last case
# greps every file the run produced for it.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
SCRIPT="$ROOT/scripts/wp-cache-watch-deploy.sh"
PLUGIN="$ROOT/wp-ops/atlas-cache-watch.php"
FLUSH="$ROOT/scripts/wp-flush.sh"
[ -f "$SCRIPT" ] || { echo "FAIL harness: no $SCRIPT"; exit 1; }
[ -f "$PLUGIN" ] || { echo "FAIL harness: no $PLUGIN"; exit 1; }
[ -f "$FLUSH" ]  || { echo "FAIL harness: no $FLUSH"; exit 1; }

WORK="$(mktemp -d "${TMPDIR:-/tmp}/wp-watch-test.XXXXXX")"
DONE=0
trap 'rc=$?; rm -rf -- "$WORK"; if [ "$DONE" != 1 ]; then printf "\nFAIL harness: died before its summary (exit %s) — the count below is not the whole run\n" "$rc"; exit 1; fi' EXIT
STUB="$WORK/bin"; mkdir -p "$STUB"
STUB_PW='atlas-test-stub-pw-do-not-log-4c7e'

VER="$(sed -n "s/.*ATLAS_CACHE_WATCH_VERSION', *'\([^']*\)'.*/\1/p" "$PLUGIN" | head -1)"
if command -v shasum >/dev/null 2>&1; then FP="$(shasum -a 1 "$PLUGIN" | awk '{print substr($1,1,8)}')"
else FP="$(sha1sum "$PLUGIN" | awk '{print substr($1,1,8)}')"; fi
GOOD="$VER;b=$FP;age=never;cdn=none;fp=1;tick=fresh"
OLDV="0.9.0;b=$FP;age=day;cdn=ok;fp=1;tick=hour"
OTHERB="$VER;b=00000000;age=day;cdn=ok;fp=1;tick=hour"
REMOTE_PATH="html/wp-content/mu-plugins/atlas-cache-watch.php"

# ── stubs ───────────────────────────────────────────────────────────────────────────────────────────────────────────
# sftp answers two kinds of batch. A `put`/`rm` batch returns STUB_SFTP_RC and whatever STUB_SFTP_OUT says (the point of
# the round-3 cases: rc and text are advisory). An `ls` batch answers per STUB_LS_MODE — and when it gets far enough it
# echoes the command after the "sftp> " prompt exactly as OpenSSH does when stdin is not a tty, so the path appears in
# the output of a successful ls AND of a failed one; the script has to read past the echo.
#
# The modes that print no echo are the round-4 point: `cmdnotfound` is what a shell says when the binary is missing,
# `banner` is a login banner that happens to contain the words, `subsystem` and `authfail` are sessions that reached
# sshd and stopped there. Every one of them carries "not found"/"no such file"/an error while the file is untouched on
# the host, and every one used to be read as a successful removal. `banner-present` connects, prints a banner with the
# words in it, and then LISTS the file. `gone-other` connects and says "not found" about a different path.
#
# Round 5 adds the shapes that pin each gate BEHAVIOURALLY, so a gate deleted from the script fails a case instead of a
# grep: `noecho` is a perfect "not found" with no `sftp> ls` echo (the command never ran on the host); `gone-noprefix`
# is a banner naming this file as not found WITHOUT sftp's own `Can't ls: ` prefix; `gone-and-present` says both, and
# the listing has to win; `gone-suffix` says "not found" about atlas-cache-watch.php.bak; `present-adjacent` says this
# file is gone and lists the .bak, which is a removal unless the name match is a substring one; `gone-crlf` is the same
# session with CRLF line endings.
cat > "$STUB/sftp" <<'EOS'
#!/usr/bin/env bash
n=$(( $(cat "$STUB_STATE/sftp.n" 2>/dev/null || echo 0) + 1 )); printf '%s\n' "$n" > "$STUB_STATE/sftp.n"
printf '%s\n' "$*" >> "$STUB_STATE/sftp.args"
batch="$(cat)"
printf '%s\n' "$batch" >> "$STUB_STATE/sftp.stdin"
case "$batch" in
  ls\ *)
    p="$(printf '%s\n' "$batch" | sed -n 's/^ls "\(.*\)"$/\1/p' | head -1)"
    case "${STUB_LS_MODE:-gone}" in
      cmdnotfound)
        printf 'bash: sftp: command not found\n'
        exit "${STUB_LS_RC:-127}";;
      banner)
        printf 'Notice: the legacy control panel is not found on this account.\n'
        printf 'This service allows sftp connections only.\n'
        printf 'Connection closed\n'
        exit "${STUB_LS_RC:-255}";;
      subsystem)
        printf 'subsystem request failed on channel 0\n'
        printf 'Connection closed\n'
        exit "${STUB_LS_RC:-255}";;
      authfail)
        printf 'Permission denied, please try again.\n'
        printf 'stub@host: Permission denied (publickey,password).\n'
        printf 'Connection closed\n'
        exit "${STUB_LS_RC:-255}";;
      banner-present)
        printf 'Notice: the legacy control panel is not found on this account.\n'
        printf 'Connected to stub.\n'
        printf 'sftp> ls "%s"\n' "$p"
        printf '%s\n' "$p"
        printf 'sftp> \n'
        exit "${STUB_LS_RC:-0}";;
      gone-other)
        printf 'Connected to stub.\n'
        printf 'sftp> ls "%s"\n' "$p"
        printf 'Can'"'"'t ls: "html/wp-content/mu-plugins/some-other-plugin.php" not found\n'
        printf 'sftp> \n'
        exit "${STUB_LS_RC:-0}";;
      present)
        printf 'Connected to stub.\n'
        printf 'sftp> ls "%s"\n' "$p"
        printf '%s\n' "$p"
        printf 'sftp> \n'
        exit "${STUB_LS_RC:-0}";;
      fail)
        printf 'Connected to stub.\n'
        printf 'sftp> ls "%s"\n' "$p"
        printf 'Connection closed\n'
        printf 'sftp> \n'
        exit "${STUB_LS_RC:-255}";;
      noecho)
        printf 'Connected to stub.\n'
        printf 'Can'"'"'t ls: "%s" not found\n' "$p"
        exit "${STUB_LS_RC:-0}";;
      gone-noprefix)
        printf 'Connected to stub.\n'
        printf 'sftp> ls "%s"\n' "$p"
        printf 'Notice: atlas-cache-watch.php not found in the legacy panel index.\n'
        printf 'sftp> \n'
        exit "${STUB_LS_RC:-0}";;
      gone-and-present)
        printf 'Connected to stub.\n'
        printf 'sftp> ls "%s"\n' "$p"
        printf 'Can'"'"'t ls: "%s" not found\n' "$p"
        printf '%s\n' "$p"
        printf 'sftp> \n'
        exit "${STUB_LS_RC:-0}";;
      gone-suffix)
        printf 'Connected to stub.\n'
        printf 'sftp> ls "%s"\n' "$p"
        printf 'Can'"'"'t ls: "%s.bak" not found\n' "$p"
        printf 'sftp> \n'
        exit "${STUB_LS_RC:-0}";;
      present-adjacent)
        printf 'Connected to stub.\n'
        printf 'sftp> ls "%s"\n' "$p"
        printf 'Can'"'"'t ls: "%s" not found\n' "$p"
        printf '%s.bak\n' "$p"
        printf 'sftp> \n'
        exit "${STUB_LS_RC:-0}";;
      gone-crlf)
        printf 'Connected to stub.\r\n'
        printf 'sftp> ls "%s"\r\n' "$p"
        printf 'Can'"'"'t ls: "%s" not found\r\n' "$p"
        printf 'sftp> \r\n'
        exit "${STUB_LS_RC:-0}";;
      *)
        printf 'Connected to stub.\n'
        printf 'sftp> ls "%s"\n' "$p"
        printf 'Can'"'"'t ls: "%s" not found\n' "$p"
        printf 'sftp> \n'
        exit "${STUB_LS_RC:-0}";;
    esac
    ;;
esac
printf 'Connected to stub.\n'
[ -n "${STUB_SFTP_OUT:-}" ] && printf '%s\n' "$STUB_SFTP_OUT"
printf 'sftp> \n'
exit "${STUB_SFTP_RC:-0}"
EOS
# curl -sI -L -D - prints EVERY response in the chain and -w reports the LAST one, so STUB_REDIRECT=1 emits a 301 hop
# (carrying whatever STUB_HDR_HOP says) followed by the real answer. Two round-5 shapes live here:
#   · STUB_CURL_RC != 0 is a chain that ABORTED — the hops it already followed are printed, then it exits, and it
#     writes NO final block and NO write-out line. That is what --max-redirs 3 exceeded (exit 47) looks like, and it
#     is the shape that let a header on a hop be credited as a deploy.
#   · STUB_NO_CODE=1 prints the whole dump and omits the tagged write-out line, which is the only place the script
#     will read a status from.
cat > "$STUB/curl" <<'EOS'
#!/usr/bin/env bash
n=$(( $(cat "$STUB_STATE/curl.n" 2>/dev/null || echo 0) + 1 )); printf '%s\n' "$n" > "$STUB_STATE/curl.n"
printf '%s\n' "$*" >> "$STUB_STATE/curl.args"
if [ "$n" = 1 ]; then code="${STUB_CODE:-200}"; hdr="${STUB_HDR:-}"; else code="${STUB_CODE2:-200}"; hdr="${STUB_HDR2:-}"; fi
if [ "${STUB_REDIRECT:-0}" = 1 ]; then
  printf 'HTTP/2 301\r\n'
  printf 'location: https://www.atlasglinn.com/\r\n'
  printf 'x-atlas-cache-watch: %s\r\n' "${STUB_HDR_HOP:-0.0.1;b=deadbeef;age=old;cdn=no;fp=0;tick=never}"
  printf '\r\n'
fi
[ "${STUB_CURL_RC:-0}" != 0 ] && exit "${STUB_CURL_RC:-0}"
printf 'HTTP/2 %s\r\n' "$code"
printf 'server: nginx\r\n'
printf 'content-type: text/html; charset=UTF-8\r\n'
[ -n "$hdr" ] && printf 'x-atlas-cache-watch: %s\r\n' "$hdr"
printf '\r\n'
[ "${STUB_NO_CODE:-0}" = 1 ] || printf '\nATLAS_HTTP_CODE:%s\n' "$code"
exit 0
EOS
cat > "$STUB/security" <<'EOS'
#!/usr/bin/env bash
[ "${STUB_NO_KEYCHAIN:-0}" = 1 ] && exit 44
for a in "$@"; do [ "$a" = "-w" ] && { printf '%s\n' "${STUB_PW:-}"; exit 0; }; done
printf 'keychain: "/Users/stub/Library/Keychains/login.keychain-db"\n'
printf '    "acct"<blob>="stub-sftp-user"\n'
printf '    "svce"<blob>="mast-wp-sftp"\n'
EOS
cat > "$STUB/shasum" <<'EOS'
#!/usr/bin/env bash
f=""; for a in "$@"; do case "$a" in -*|1|256) ;; *) f="$a";; esac; done
if command -v sha1sum >/dev/null 2>&1; then sha1sum "$f" | awk -v f="$f" '{print $1"  "f}'
else openssl dgst -sha1 "$f" | awk -v f="$f" '{print $NF"  "f}'; fi
EOS
cat > "$STUB/sleep" <<'EOS'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$STUB_STATE/sleep.args"
exit 0
EOS
chmod 755 "$STUB"/*

# For the preflight case: a PATH carrying every tool the script needs EXCEPT sftp. It is built by symlinking the real
# PATH rather than by unsetting one entry, because leaving the system dirs on PATH would let a run that skipped the
# check find the REAL sftp and open a session to the real host. Nothing here can: there is no sftp binary to find.
NOSFTP="$WORK/bin-nosftp"; mkdir -p "$NOSFTP"
_ifs="$IFS"; IFS=:
for d in $PATH; do
  IFS="$_ifs"
  [ -d "$d" ] || { IFS=:; continue; }
  for f in "$d"/*; do
    bn="${f##*/}"
    case "$bn" in sftp|ssh|scp|curl|security|shasum|sleep) continue;; esac
    [ -x "$f" ] || continue
    [ -e "$NOSFTP/$bn" ] || ln -s "$f" "$NOSFTP/$bn" 2>/dev/null || true
  done
  IFS=:
done
IFS="$_ifs"
for stub in curl security shasum sleep; do rm -f "$NOSFTP/$stub"; cp "$STUB/$stub" "$NOSFTP/$stub"; done
chmod 755 "$NOSFTP"/curl "$NOSFTP"/security "$NOSFTP"/shasum "$NOSFTP"/sleep
[ -e "$NOSFTP/sftp" ] && { echo "FAIL harness: the no-sftp PATH has an sftp on it"; exit 1; }

# ── runner ──────────────────────────────────────────────────────────────────────────────────────────────────────────
PASSN=0; FAILN=0
t() { if [ "${2:-0}" = 1 ]; then PASSN=$((PASSN+1)); printf 'PASS %s\n' "$1"; else FAILN=$((FAILN+1)); printf 'FAIL %s%s\n' "$1" "${3:+ — $3}"; fi; }
b() { if "$@" >/dev/null 2>&1; then printf 1; else printf 0; fi; }
eq() { if [ "$1" = "$2" ]; then printf 1; else printf 0; fi; }
reset_case() {
  C_SFTP_RC=0; C_SFTP_OUT=""; C_LS_MODE=gone; C_LS_RC=0
  C_CURL_RC=0; C_CODE=200; C_CODE2=200; C_HDR=""; C_HDR2=""; C_REDIRECT=0; C_HOP=""; C_NO_CODE=0
  C_NO_KC=0; C_SRC="$PLUGIN"; C_HOME=""; C_NO_SFTP=0
}
calls() { cat "$STATE/$1.n" 2>/dev/null || printf 0; }
run_case() {
  CASE="$1"; shift
  STATE="$WORK/$CASE/state"; CHOME="$WORK/${C_HOME:-$CASE}/home"; OUT="$WORK/$CASE/out"
  mkdir -p "$STATE" "$CHOME"
  CASE_PATH="$STUB:$PATH"; [ "$C_NO_SFTP" = 1 ] && CASE_PATH="$NOSFTP"
  # "$BASH", not `bash`: the case that runs on the sftp-less PATH must not depend on that PATH to find its shell.
  PATH="$CASE_PATH" HOME="$CHOME" STUB_STATE="$STATE" STUB_PW="$STUB_PW" \
    STUB_SFTP_RC="$C_SFTP_RC" STUB_SFTP_OUT="$C_SFTP_OUT" STUB_LS_MODE="$C_LS_MODE" STUB_LS_RC="$C_LS_RC" \
    STUB_CURL_RC="$C_CURL_RC" STUB_CODE="$C_CODE" STUB_CODE2="$C_CODE2" STUB_REDIRECT="$C_REDIRECT" \
    STUB_HDR_HOP="$C_HOP" STUB_NO_CODE="$C_NO_CODE" \
    STUB_HDR="$C_HDR" STUB_HDR2="$C_HDR2" STUB_NO_KEYCHAIN="$C_NO_KC" ATLAS_WATCH_SRC="$C_SRC" \
    "$BASH" "$SCRIPT" "$@" > "$OUT" 2>&1
  RC=$?
  STAMPF="$CHOME/.cache/wp-upload/last-watch-deploy"
  STAMPV="$(cat "$STAMPF" 2>/dev/null || printf '')"
}

# ── 1. happy path ───────────────────────────────────────────────────────────────────────────────────────────────────
reset_case; C_HDR="$GOOD"; C_HDR2="$GOOD"; run_case happy
t "happy/exit-0"                "$(eq "$RC" 0)" "exit $RC"
t "happy/says-deployed-observed" "$(b grep -q 'DEPLOYED-OBSERVED' "$OUT")"
t "happy/heartbeat-deployed"    "$(b grep -q " $VER deployed served=" "$STAMPF")" "$STAMPV"
t "happy/one-probe-no-retry"    "$(eq "$(calls curl)" 1)" "curl calls $(calls curl)"
t "happy/one-sftp"              "$(eq "$(calls sftp)" 1)" "sftp calls $(calls sftp)"
t "happy/batch-uses-put"        "$(b grep -q "^put " "$STATE/sftp.stdin")" "$(cat "$STATE/sftp.stdin" 2>/dev/null | tr '\n' ' ')"
t "happy/batch-mkdir-tolerant"  "$(b grep -q '^-mkdir ' "$STATE/sftp.stdin")"
t "happy/reports-build"         "$(b grep -q "build $FP" "$OUT")"
t "happy/probe-follows-redirects" "$(b grep -q -- '--max-redirs 3' "$STATE/curl.args")" "$(cat "$STATE/curl.args" 2>/dev/null)"
t "happy/no-advisory-when-clean" "$(b bash -c '! grep -q "sftp advisory" "$1"' _ "$OUT")"

# ── 2. the tolerated -mkdir failure is not trouble: it prints on every healthy run ───────────────────────────────────
reset_case; C_SFTP_OUT="Couldn't create directory: Failure"; C_HDR="$GOOD"; C_HDR2="$GOOD"; run_case mkdir-noise
t "mkdir-noise/exit-0"          "$(eq "$RC" 0)" "exit $RC"
t "mkdir-noise/no-advisory"     "$(b bash -c '! grep -q "sftp advisory" "$1"' _ "$OUT")" "$(grep 'advisory' "$OUT" | head -1)"

# ── 3. sftp's exit code is not a signal: rc 1, but the host serves the exact bytes sent ──────────────────────────────
reset_case; C_SFTP_RC=1; C_HDR="$GOOD"; C_HDR2="$GOOD"; run_case sftp-rc-not-a-signal
t "sftp-rc/exit-0"              "$(eq "$RC" 0)" "exit $RC"
t "sftp-rc/deployed"            "$(b grep -q 'DEPLOYED-OBSERVED' "$OUT")"
t "sftp-rc/advisory-printed"    "$(b grep -q 'sftp advisory (exit 1' "$OUT")"
t "sftp-rc/advisory-says-it-decides-nothing" "$(b grep -q 'decides nothing' "$OUT")"

# ── 3b. rc 0 and a clean-looking session, but the text says Permission denied and the served build is another one ────
reset_case; C_SFTP_RC=0; C_SFTP_OUT="atlas-cache-watch.php: Permission denied"; C_HDR="$OTHERB"; C_HDR2="$OTHERB"
run_case sftp-rc0-permission-denied
t "rc0-denied/exit-non-zero"    "$(b test "$RC" -ne 0)" "exit $RC"
t "rc0-denied/no-deployed-claim" "$(b bash -c '! grep -q DEPLOYED-OBSERVED "$1"' _ "$OUT")"
t "rc0-denied/advisory-names-it" "$(b grep -qi 'sftp advisory (exit 0, ".*permission denied' "$OUT")" "$(grep -i advisory "$OUT" | head -1)"
t "rc0-denied/heartbeat-fingerprint-mismatch" "$(b grep -q "fingerprint-mismatch served=$OTHERB" "$STAMPF")" "$STAMPV"
t "rc0-denied/blames-the-advisory" "$(b grep -q 'likely reason the bytes sent are not the bytes running' "$OUT")"
t "rc0-denied/not-verified"     "$(b grep -q 'NOT verified as deployed' "$OUT")"

# ── 4. header absent → one retry → non-zero ─────────────────────────────────────────────────────────────────────────
reset_case; run_case header-absent
t "header-absent/exit-non-zero" "$(b test "$RC" -ne 0)" "exit $RC"
t "header-absent/retried-once"  "$(eq "$(calls curl)" 2)" "curl calls $(calls curl)"
t "header-absent/slept-once"    "$(eq "$(wc -l < "$STATE/sleep.args" 2>/dev/null || echo 0)" 1)"
t "header-absent/heartbeat"     "$(b grep -q 'header-absent served=none http=200' "$STAMPF")" "$STAMPV"
t "header-absent/not-confirmed" "$(b grep -q 'NOT verified as deployed' "$OUT")"

# ── 5. version mismatch → retry → non-zero, served value recorded ───────────────────────────────────────────────────
reset_case; C_HDR="$OLDV"; C_HDR2="$OLDV"; run_case version-mismatch
t "version-mismatch/exit-non-zero" "$(b test "$RC" -ne 0)" "exit $RC"
t "version-mismatch/retried-once"  "$(eq "$(calls curl)" 2)" "curl calls $(calls curl)"
t "version-mismatch/heartbeat-served" "$(b grep -q "version-mismatch served=$OLDV" "$STAMPF")" "$STAMPV"
t "version-mismatch/names-both"    "$(b grep -q "older copy is still loaded" "$OUT")"

# ── 6. same version, different bytes (the pre-existing copy the version check used to accept) ───────────────────────
reset_case; C_HDR="$OTHERB"; C_HDR2="$OTHERB"; run_case fingerprint-mismatch
t "fingerprint-mismatch/exit-non-zero" "$(b test "$RC" -ne 0)" "exit $RC"
t "fingerprint-mismatch/retried-once"  "$(eq "$(calls curl)" 2)" "curl calls $(calls curl)"
t "fingerprint-mismatch/heartbeat"     "$(b grep -q "fingerprint-mismatch served=$OTHERB" "$STAMPF")" "$STAMPV"
t "fingerprint-mismatch/no-deployed-claim" "$(b bash -c '! grep -q DEPLOYED-OBSERVED "$1"' _ "$OUT")"

# ── 7. opcache: stale on the first read, correct on the retry ───────────────────────────────────────────────────────
reset_case; C_HDR="$OTHERB"; C_HDR2="$GOOD"; run_case retry-succeeds
t "retry-succeeds/exit-0"       "$(eq "$RC" 0)" "exit $RC"
t "retry-succeeds/two-probes"   "$(eq "$(calls curl)" 2)" "curl calls $(calls curl)"
t "retry-succeeds/deployed"     "$(b grep -q 'DEPLOYED-OBSERVED' "$OUT")"

# ── 8. round 5: the final block has to be a 200. A perfect header on a 404 is not a page a reader was served, and ──
# ── the absence of one proves nothing when curl never finished ──────────────────────────────────────────────────────
reset_case; C_CODE=404; C_CODE2=404; C_HDR="$GOOD"; C_HDR2="$GOOD"; run_case header-on-404
t "header-on-404/exit-non-zero"  "$(b test "$RC" -ne 0)" "exit $RC"
t "header-on-404/no-deployed-claim" "$(b bash -c '! grep -q DEPLOYED-OBSERVED "$1"' _ "$OUT")" "$(grep -m1 'verify:' "$OUT")"
t "header-on-404/names-the-rule" "$(b grep -q 'rule not-200' "$OUT")" "$(grep -m1 'rule ' "$OUT")"
t "header-on-404/heartbeat"      "$(b grep -q 'probe-failed served=' "$STAMPF")" "$STAMPV"
reset_case; C_CURL_RC=7; run_case install-curl-fails
t "install-curl-fails/exit-non-zero" "$(b test "$RC" -ne 0)" "exit $RC"
t "install-curl-fails/says-unknown"  "$(b grep -q 'UNKNOWN' "$OUT")"
t "install-curl-fails/heartbeat"     "$(b grep -q 'probe-failed served=none http=000' "$STAMPF")" "$STAMPV"
t "install-curl-fails/names-the-rule" "$(b grep -q 'rule aborted-chain' "$OUT")" "$(grep -m1 'rule ' "$OUT")"
t "install-curl-fails/no-absent-claim" "$(b bash -c '! grep -q "plugin is not loading" "$1"' _ "$OUT")"

# ── 9. a redirect chain: the FINAL response is the one classified, not the hop ──────────────────────────────────────
reset_case; C_REDIRECT=1; C_HDR="$GOOD"; C_HDR2="$GOOD"; run_case redirect-final-response
t "redirect/exit-0"             "$(eq "$RC" 0)" "exit $RC"
t "redirect/deployed-from-final" "$(b grep -q 'DEPLOYED-OBSERVED' "$OUT")"
t "redirect/one-probe"          "$(eq "$(calls curl)" 1)" "curl calls $(calls curl)"
t "redirect/hop-header-ignored" "$(b bash -c '! grep -q "deadbeef" "$1"' _ "$OUT")" "the 301 hop's header was classified"
t "redirect/heartbeat-final"    "$(b grep -q "deployed served=$GOOD http=200" "$STAMPF")" "$STAMPV"

# ── 9b. the hop carries a PERFECT header and the final response carries none — last-header-wins used to call this a ──
# ── deploy, and the page a reader lands on has no plugin on it at all ───────────────────────────────────────────────
reset_case; C_REDIRECT=1; C_HOP="$GOOD"; C_HDR=""; C_HDR2=""; run_case redirect-hop-only
t "redirect-hop-only/exit-non-zero" "$(b test "$RC" -ne 0)" "exit $RC"
t "redirect-hop-only/no-deployed-claim" "$(b bash -c '! grep -q DEPLOYED-OBSERVED "$1"' _ "$OUT")" "$(grep -m1 'verify:' "$OUT")"
t "redirect-hop-only/header-absent"  "$(b grep -q 'header-absent served=none http=200' "$STAMPF")" "$STAMPV"
t "redirect-hop-only/retried-once"   "$(eq "$(calls curl)" 2)" "curl calls $(calls curl)"

# ── 10. --remove: the ls says the path is not there ─────────────────────────────────────────────────────────────────
reset_case; C_LS_MODE=gone; run_case remove-ok --remove
t "remove-ok/exit-0"            "$(eq "$RC" 0)" "exit $RC"
t "remove-ok/two-sftp-sessions" "$(eq "$(calls sftp)" 2)" "sftp calls $(calls sftp)"
t "remove-ok/batch-uses-rm"     "$(b grep -q '^rm "' "$STATE/sftp.stdin")" "$(cat "$STATE/sftp.stdin" 2>/dev/null | tr '\n' ' ')"
t "remove-ok/rm-has-no-dash"    "$(b bash -c '! grep -q "^-rm " "$1"' _ "$STATE/sftp.stdin")"
t "remove-ok/proof-batch-is-ls" "$(b grep -q "^ls \"$REMOTE_PATH\"$" "$STATE/sftp.stdin")" "$(cat "$STATE/sftp.stdin" 2>/dev/null | tr '\n' ' ')"
t "remove-ok/heartbeat-removed" "$(b grep -q 'removed served=' "$STAMPF")" "$STAMPV"
t "remove-ok/loop-status"       "$(b grep -q 'removed from the host' "$OUT")"
t "remove-ok/verdict-is-the-ls" "$(b grep -q 'sftp ls says the path is not there' "$OUT")"

# ── 11. --remove: the ls lists the file — the rm did not happen, whatever the header says ───────────────────────────
# This is the case header-absence used to call `removed`: the plugin sends no header when a wp-config constant disables
# it, so "no header" and "file deleted" are different facts.
reset_case; C_LS_MODE=present; run_case remove-still-there --remove
t "remove-still-there/exit-non-zero" "$(b test "$RC" -ne 0)" "exit $RC"
t "remove-still-there/heartbeat-rm-failed" "$(b grep -q 'rm-failed' "$STAMPF")" "$STAMPV"
t "remove-still-there/says-still-listed" "$(b grep -q 'STILL LISTED' "$OUT")"
t "remove-still-there/no-removed-claim"  "$(b bash -c '! grep -q "the file is gone" "$1"' _ "$OUT")"
t "remove-still-there/not-confirmed"     "$(b grep -q 'NOT confirmed gone' "$OUT")"

# ── 12. --remove: the proof session itself failed → unknown, never a removal ────────────────────────────────────────
reset_case; C_LS_MODE=fail; C_LS_RC=255; run_case remove-ls-fails --remove
t "remove-ls-fails/exit-non-zero" "$(b test "$RC" -ne 0)" "exit $RC"
t "remove-ls-fails/heartbeat-unknown" "$(b grep -q 'rm-unknown' "$STAMPF")" "$STAMPV"
t "remove-ls-fails/says-unknown"  "$(b grep -q 'UNKNOWN' "$OUT")"
t "remove-ls-fails/no-removed-claim" "$(b bash -c '! grep -q "the file is gone" "$1"' _ "$OUT")"

# ── 12b. --remove: the words "not found" without a session — every shape that used to read as a removal ─────────────
# Each of these carries /not found|no such file|error/ text while the file is untouched on the host. The old classifier
# grepped the whole session for those words FIRST, so each one of them reported "removed" and exited 0.
reset_case; C_LS_MODE=cmdnotfound; C_LS_RC=0; run_case remove-cmd-not-found --remove
t "remove-cmdnotfound/exit-non-zero"  "$(b test "$RC" -ne 0)" "exit $RC"
t "remove-cmdnotfound/rm-unknown"     "$(b grep -q 'rm-unknown' "$STAMPF")" "$STAMPV"
t "remove-cmdnotfound/no-removed-claim" "$(b bash -c '! grep -q "the file is gone" "$1"' _ "$OUT")" "$(grep -m1 'verify:' "$OUT")"
t "remove-cmdnotfound/names-the-missing-echo" "$(b grep -q 'never ran on the host' "$OUT")" "$(grep -m1 'classified' "$OUT")"

reset_case; C_LS_MODE=banner; C_LS_RC=255; run_case remove-banner --remove
t "remove-banner/exit-non-zero"       "$(b test "$RC" -ne 0)" "exit $RC"
t "remove-banner/rm-unknown"          "$(b grep -q 'rm-unknown' "$STAMPF")" "$STAMPV"
t "remove-banner/no-removed-claim"    "$(b bash -c '! grep -q "the file is gone" "$1"' _ "$OUT")"

reset_case; C_LS_MODE=subsystem; C_LS_RC=255; run_case remove-subsystem --remove
t "remove-subsystem/exit-non-zero"    "$(b test "$RC" -ne 0)" "exit $RC"
t "remove-subsystem/rm-unknown"       "$(b grep -q 'rm-unknown' "$STAMPF")" "$STAMPV"

reset_case; C_LS_MODE=authfail; C_LS_RC=255; run_case remove-authfail --remove
t "remove-authfail/exit-non-zero"     "$(b test "$RC" -ne 0)" "exit $RC"
t "remove-authfail/rm-unknown"        "$(b grep -q 'rm-unknown' "$STAMPF")" "$STAMPV"

# connected, exit 0, banner says "not found" — and the ls lists the file: still there, and the run has to say so
reset_case; C_LS_MODE=banner-present; C_LS_RC=0; run_case remove-banner-present --remove
t "remove-banner-present/exit-non-zero" "$(b test "$RC" -ne 0)" "exit $RC"
t "remove-banner-present/rm-failed"     "$(b grep -q 'rm-failed' "$STAMPF")" "$STAMPV"
t "remove-banner-present/says-still-listed" "$(b grep -q 'STILL LISTED' "$OUT")"
t "remove-banner-present/evidence-is-the-listing" "$(b grep -q "evidence: $REMOTE_PATH" "$OUT")" "$(grep -m1 'classified' "$OUT")"

# connected and exit 0, but the "not found" is about a different file
reset_case; C_LS_MODE=gone-other; C_LS_RC=0; run_case remove-other-path --remove
t "remove-other-path/exit-non-zero"   "$(b test "$RC" -ne 0)" "exit $RC"
t "remove-other-path/rm-unknown"      "$(b grep -q 'rm-unknown' "$STAMPF")" "$STAMPV"
t "remove-other-path/no-removed-claim" "$(b bash -c '! grep -q "the file is gone" "$1"' _ "$OUT")"

# the ls listed the file but the session also exited non-zero: unknown, never a removal and never a bare rm-failed
reset_case; C_LS_MODE=present; C_LS_RC=255; run_case remove-present-rc255 --remove
t "remove-present-rc255/exit-non-zero" "$(b test "$RC" -ne 0)" "exit $RC"
t "remove-present-rc255/rm-unknown"    "$(b grep -q 'rm-unknown' "$STAMPF")" "$STAMPV"
t "remove-present-rc255/evidence-names-the-exit" "$(b grep -q 'ls session exited 255' "$OUT")" "$(grep -m1 'classified' "$OUT")"

# ── 13. --remove: the header is still served, but the ls says gone — the header is advisory ─────────────────────────
reset_case; C_LS_MODE=gone; C_HDR="$GOOD"; C_HDR2="$GOOD"; run_case remove-header-lags --remove
t "remove-header-lags/exit-0"    "$(eq "$RC" 0)" "exit $RC"
t "remove-header-lags/advisory"  "$(b grep -q 'advisory: X-Atlas-Cache-Watch' "$OUT")"
t "remove-header-lags/one-probe" "$(eq "$(calls curl)" 1)" "curl calls $(calls curl)"
t "remove-header-lags/heartbeat" "$(b grep -q 'removed served=' "$STAMPF")" "$STAMPV"

# ── 14. --remove: curl cannot reach the site at all — the ls still decides ──────────────────────────────────────────
reset_case; C_CURL_RC=7; C_LS_MODE=gone; run_case remove-curl-fails --remove
t "remove-curl-fails/exit-0"     "$(eq "$RC" 0)" "exit $RC"
t "remove-curl-fails/heartbeat-removed" "$(b grep -q 'removed served=none' "$STAMPF")" "$STAMPV"
t "remove-curl-fails/header-proves-nothing" "$(b grep -q 'on its own that proves nothing' "$OUT")"

# ── 15. preconditions: no Keychain item, and no source file ─────────────────────────────────────────────────────────
reset_case; C_NO_KC=1; run_case no-keychain
t "no-keychain/exit-non-zero"   "$(b test "$RC" -ne 0)" "exit $RC"
t "no-keychain/nothing-sent"    "$(eq "$(calls sftp)" 0)" "sftp calls $(calls sftp)"
reset_case; C_SRC="$WORK/does-not-exist.php"; run_case missing-source
t "missing-source/exit-non-zero" "$(b test "$RC" -ne 0)" "exit $RC"
t "missing-source/nothing-sent"  "$(eq "$(calls sftp)" 0)" "sftp calls $(calls sftp)"
t "missing-source/no-download"   "$(b grep -q 'never downloads one' "$OUT")"
t "missing-source/no-raw-url"    "$(b bash -c '! grep -q raw.githubusercontent "$1"' _ "$SCRIPT")"
t "missing-source/heartbeat-aborted" "$(b grep -q 'aborted-no-source' "$STAMPF")" "$STAMPV"

# ── 15b. no sftp on this machine at all: the removal cannot be attempted, so nothing may be claimed about it ────────
# The case runs on a PATH with no sftp binary anywhere, so even a run that skipped the check could not reach a host.
reset_case; C_NO_SFTP=1; run_case no-sftp --remove
t "no-sftp/exit-non-zero"       "$(b test "$RC" -ne 0)" "exit $RC"
t "no-sftp/nothing-attempted"   "$(eq "$(calls sftp)" 0)" "sftp calls $(calls sftp)"
t "no-sftp/heartbeat-aborted"   "$(b grep -q 'aborted-no-sftp' "$STAMPF")" "$STAMPV"
t "no-sftp/no-removed-claim"    "$(b bash -c '! grep -q "the file is gone" "$1"' _ "$OUT")" "$(tail -3 "$OUT" | tr '\n' ' ')"

# ── 15c. an argument the script does not know must not mean "install" ───────────────────────────────────────────────
reset_case; run_case bad-arg --remvoe
t "bad-arg/exit-non-zero"       "$(b test "$RC" -ne 0)" "exit $RC"
t "bad-arg/nothing-sent"        "$(eq "$(calls sftp)" 0)" "sftp calls $(calls sftp)"
t "bad-arg/nothing-probed"      "$(eq "$(calls curl)" 0)" "curl calls $(calls curl)"
t "bad-arg/names-the-argument"  "$(b grep -q -- '--remvoe' "$OUT")" "$(head -2 "$OUT" | tr '\n' ' ')"
t "bad-arg/heartbeat-aborted"   "$(b grep -q 'aborted-bad-arg' "$STAMPF")" "$STAMPV"
reset_case; C_HDR="$GOOD"; C_HDR2="$GOOD"; run_case install-word --install
t "install-word/exit-0"         "$(eq "$RC" 0)" "exit $RC"
t "install-word/uploaded"       "$(b grep -q '^put ' "$STATE/sftp.stdin")" "$(cat "$STATE/sftp.stdin" 2>/dev/null | tr '\n' ' ')"

# ── 16. an abort must not leave the PREVIOUS run's verdict standing in the heartbeat ────────────────────────────────
reset_case; C_HOME=abort-stamp; C_HDR="$GOOD"; C_HDR2="$GOOD"; run_case abort-stamp-deploy
t "abort-stamp/first-run-deployed" "$(b grep -q " $VER deployed served=" "$STAMPF")" "$STAMPV"
reset_case; C_HOME=abort-stamp; C_NO_KC=1; run_case abort-stamp-abort
t "abort-stamp/second-run-exit-non-zero" "$(b test "$RC" -ne 0)" "exit $RC"
t "abort-stamp/stamp-says-aborted" "$(b grep -q 'aborted-no-keychain' "$STAMPF")" "$STAMPV"
t "abort-stamp/stale-deployed-gone" "$(b bash -c '! grep -q " deployed served=" "$1"' _ "$STAMPF")" "$STAMPV"

# ── 17. scripts/wp-flush.sh's cascade heredoc — it runs on the host, so it is checked here as text ──────────────────
CASC="$WORK/cascade.php"
awk 'index($0, "cat > \"$P\" <<") { f = 1; next } f && $0 == "PHP" { exit } f' "$FLUSH" > "$CASC"
t "flush-heredoc/extracted"      "$(b test -s "$CASC")" "nothing between the heredoc markers"
if command -v php >/dev/null 2>&1; then
  t "flush-heredoc/php-lints"    "$(b php -l "$CASC")" "$(php -l "$CASC" 2>&1 | head -2)"
else
  t "flush-heredoc/php-lints"    1 "php absent; lint skipped"
fi
t "flush-heredoc/redacts-exception" \
  "$(b grep -Fq "':error:' . get_class(\$e) . ':' . substr(sha1(\$e->getMessage()), 0, 8)" "$CASC")" \
  "$(grep -n 'Throwable \$e' "$CASC" | head -2)"
t "flush-heredoc/one-getmessage-and-it-is-hashed" \
  "$(eq "$(grep -c 'getMessage' "$CASC")" 1)" "getMessage mentions $(grep -c 'getMessage' "$CASC")"
t "flush-heredoc/allowlist-is-exact" \
  "$(b grep -Fq "array('WPaaS\\\\Cache_V2', 'WPaaS\\\\Cache')" "$CASC")" "$(grep -n 'is_string(\$c)' "$CASC" | head -1)"
t "flush-heredoc/no-prefix-allowlist" "$(b bash -c '! grep -Fq "strpos(ltrim(" "$1"' _ "$CASC")"
t "plugin/allowlist-is-exact" \
  "$(b grep -Fq "array('WPaaS\\\\Cache_V2', 'WPaaS\\\\Cache')" "$PLUGIN")"
t "plugin/no-prefix-allowlist"  "$(b bash -c '! grep -Fq "strpos(ltrim(" "$1"' _ "$PLUGIN")"

# ── 18. round 5: every gate is pinned by BEHAVIOUR, not by a grep of the script ─────────────────────────────────────
# Five of the six checks here used to read the script's own source for the line that implements a gate. A gate can be
# present and dead — commented out downstream, or overwritten by a later branch — and the grep still passes. Each one
# is now a scenario that only a WORKING gate can survive: delete the gate from a copy of the script and the case
# below fails. (Round 5 negative controls were run against a scratch copy for exactly that, one gate at a time.)

# the `sftp> ls` echo is what proves the command ran ON the host: a perfect "not found" without it is not an answer
reset_case; C_LS_MODE=noecho; C_LS_RC=0; run_case wire-echo-required --remove
t "wire/echo-required-rm-unknown" "$(b grep -q 'rm-unknown' "$STAMPF")" "$STAMPV"
t "wire/echo-required-exit-non-zero" "$(b test "$RC" -ne 0)" "exit $RC"
t "wire/echo-required-no-removed-claim" "$(b bash -c '! grep -q "the file is gone" "$1"' _ "$OUT")" "$(grep -m1 'classified' "$OUT")"

# "not found" naming THIS file, from a banner rather than from sftp — the `Can't ls: `/`ls: ` anchor is the difference
reset_case; C_LS_MODE=gone-noprefix; C_LS_RC=0; run_case wire-anchor-required --remove
t "wire/anchor-required-rm-unknown" "$(b grep -q 'rm-unknown' "$STAMPF")" "$STAMPV"
t "wire/anchor-required-no-removed-claim" "$(b bash -c '! grep -q "the file is gone" "$1"' _ "$OUT")" "$(grep -m1 'classified' "$OUT")"

# a session that says BOTH — the listing is the fact, and it has to be read before the "gone" text
reset_case; C_LS_MODE=gone-and-present; C_LS_RC=0; run_case wire-listed-wins --remove
t "wire/listed-wins-rm-failed"   "$(b grep -q 'rm-failed' "$STAMPF")" "$STAMPV"
t "wire/listed-wins-says-still-listed" "$(b grep -q 'STILL LISTED' "$OUT")" "$(grep -m1 'classified' "$OUT")"
t "wire/listed-wins-exit-non-zero" "$(b test "$RC" -ne 0)" "exit $RC"

# the "not found" is about atlas-cache-watch.php.bak — a substring match reads it as this file and claims a removal
reset_case; C_LS_MODE=gone-suffix; C_LS_RC=0; run_case wire-exact-name-gone --remove
t "wire/exact-name-gone-rm-unknown" "$(b grep -q 'rm-unknown' "$STAMPF")" "$STAMPV"
t "wire/exact-name-gone-no-removed-claim" "$(b bash -c '! grep -q "the file is gone" "$1"' _ "$OUT")" "$(grep -m1 'classified' "$OUT")"

# this file IS gone and a .bak of it is listed: a substring match calls that rm-failed, an exact one calls it removed
reset_case; C_LS_MODE=present-adjacent; C_LS_RC=0; run_case wire-exact-name-listed --remove
t "wire/exact-name-listed-removed" "$(b grep -q 'removed served=' "$STAMPF")" "$STAMPV"
t "wire/exact-name-listed-exit-0"  "$(eq "$RC" 0)" "exit $RC"

# a CRLF session: same verdict, and no carriage return may survive into the log or the emailed evidence line
reset_case; C_LS_MODE=gone-crlf; C_LS_RC=0; run_case wire-crlf --remove
t "wire/crlf-removed"            "$(b grep -q 'removed served=' "$STAMPF")" "$STAMPV"
t "wire/crlf-exit-0"             "$(eq "$RC" 0)" "exit $RC"
t "wire/crlf-no-cr-in-output"    "$(b bash -c '! grep -q "$(printf "\r")" "$1"' _ "$OUT")" "a carriage return reached the log"

# a perfect "gone" answer over a session that exited non-zero is still not an answer
reset_case; C_LS_MODE=gone; C_LS_RC=1; run_case wire-lsrc-gone --remove
t "wire/lsrc-gone-rm-unknown"    "$(b grep -q 'rm-unknown' "$STAMPF")" "$STAMPV"
t "wire/lsrc-gone-names-the-exit" "$(b grep -q 'ls session exited 1' "$OUT")" "$(grep -m1 'classified' "$OUT")"

# no sftp on the machine: the install path must die before it reaches for the host, exactly as --remove does
reset_case; C_NO_SFTP=1; run_case wire-no-sftp-install
t "wire/no-sftp-install-nothing-sent" "$(eq "$(calls sftp)" 0)" "sftp calls $(calls sftp)"
t "wire/no-sftp-install-nothing-probed" "$(eq "$(calls curl)" 0)" "curl calls $(calls curl)"
t "wire/no-sftp-install-heartbeat" "$(b grep -q 'aborted-no-sftp' "$STAMPF")" "$STAMPV"
t "wire/no-sftp-install-no-deployed-claim" "$(b bash -c '! grep -q DEPLOYED-OBSERVED "$1"' _ "$OUT")"

# ── 18b. round 5: the probe. An ABORTED chain is not evidence, whatever its hops carried ────────────────────────────
# curl exits 47 when --max-redirs is exhausted, having already printed the hops it followed — and one of them carries
# the exact fingerprint this run just uploaded. Reading headers out of that dump is a deploy claimed off a response no
# reader was ever served, which is the last false-success path in this script.
reset_case; C_REDIRECT=1; C_HOP="$GOOD"; C_CURL_RC=47; run_case probe-aborted-chain
t "probe-aborted/exit-non-zero"  "$(b test "$RC" -ne 0)" "exit $RC"
t "probe-aborted/no-deployed-claim" "$(b bash -c '! grep -q DEPLOYED-OBSERVED "$1"' _ "$OUT")" "$(grep -m1 'verify:' "$OUT")"
t "probe-aborted/hop-header-not-parsed" "$(b bash -c '! grep -q "$2" "$1"' _ "$OUT" "$GOOD")" "the aborted chain's hop header was read"
t "probe-aborted/names-the-rule" "$(b grep -q 'rule aborted-chain' "$OUT")" "$(grep -m1 'rule ' "$OUT")"
t "probe-aborted/heartbeat"      "$(b grep -q 'probe-failed served=none http=000' "$STAMPF")" "$STAMPV"

# a chain that COMPLETED but whose final block is itself a 3xx: truncated, so its header belongs to a hop
reset_case; C_REDIRECT=1; C_CODE=301; C_CODE2=301; C_HDR="$GOOD"; C_HDR2="$GOOD"; run_case probe-final-3xx
t "probe-final-3xx/exit-non-zero" "$(b test "$RC" -ne 0)" "exit $RC"
t "probe-final-3xx/no-deployed-claim" "$(b bash -c '! grep -q DEPLOYED-OBSERVED "$1"' _ "$OUT")" "$(grep -m1 'verify:' "$OUT")"
t "probe-final-3xx/names-the-rule" "$(b grep -q 'rule truncated-chain' "$OUT")" "$(grep -m1 'rule ' "$OUT")"
t "probe-final-3xx/heartbeat"    "$(b grep -q 'probe-failed served=' "$STAMPF")" "$STAMPV"

# the status is READ, never inferred: no tagged write-out line = code 000 = the read is refused, header or no header
reset_case; C_NO_CODE=1; C_HDR="$GOOD"; C_HDR2="$GOOD"; run_case probe-no-code-line
t "probe-no-code/exit-non-zero"  "$(b test "$RC" -ne 0)" "exit $RC"
t "probe-no-code/no-deployed-claim" "$(b bash -c '! grep -q DEPLOYED-OBSERVED "$1"' _ "$OUT")" "$(grep -m1 'verify:' "$OUT")"
t "probe-no-code/names-the-rule" "$(b grep -q 'rule no-status' "$OUT")" "$(grep -m1 'rule ' "$OUT")"
t "probe-no-code/heartbeat-000"  "$(b grep -q 'probe-failed served=none http=000' "$STAMPF")" "$STAMPV"

# ── 18c. round 5: the argument COUNT, checked before the value and before anything is sent ──────────────────────────
reset_case; run_case bad-argc --remove --install
t "bad-argc/exit-non-zero"       "$(b test "$RC" -ne 0)" "exit $RC"
t "bad-argc/nothing-sent"        "$(eq "$(calls sftp)" 0)" "sftp calls $(calls sftp)"
t "bad-argc/nothing-probed"      "$(eq "$(calls curl)" 0)" "curl calls $(calls curl)"
t "bad-argc/names-the-count"     "$(b grep -q 'given 2' "$OUT")" "$(head -2 "$OUT" | tr '\n' ' ')"
t "bad-argc/heartbeat-aborted"   "$(b grep -q 'aborted-bad-arg' "$STAMPF")" "$STAMPV"

# ── 18d. the script's own header must not claim the exit code is the test, and must say what the gates now are ──────
t "doc/says-rc-is-not-a-signal" "$(b grep -q 'does not report per-command failure' "$SCRIPT")"
t "doc/no-exit-code-enforced-claim" "$(b bash -c '! grep -q "exit code is tested" "$1"' _ "$SCRIPT")"
t "doc/header-says-names-the-path" "$(b grep -q 'NAMES THE PATH' "$SCRIPT")"
t "doc/header-says-final-block"  "$(b grep -q 'LAST response block' "$SCRIPT")"

# ── 19. the stub password never appears anywhere this run wrote ─────────────────────────────────────────────────────
LEAK="$(grep -rl "$STUB_PW" "$WORK" 2>/dev/null | grep -v "^$STUB/" | head -3 | tr '\n' ' ')"
t "no-secret-in-any-output" "$(b test -z "$LEAK")" "found in: $LEAK"

# ── the harness guards itself: a run that stops early prints fewer cases than this ──────────────────────────────────
EXPECTED_CASES=175
TOTAL=$((PASSN + FAILN))
if [ "$TOTAL" -lt "$EXPECTED_CASES" ]; then
  FAILN=$((FAILN+1))
  printf 'FAIL harness/cases-shrank — ran %s of the %s pinned in this file\n' "$TOTAL" "$EXPECTED_CASES"
elif [ "$TOTAL" -gt "$EXPECTED_CASES" ]; then
  printf '| %s cases, %s pinned — raise EXPECTED_CASES in this file\n' "$TOTAL" "$EXPECTED_CASES"
fi
printf '\nwp-cache-watch-deploy: %s passed, %s failed (%s cases, %s pinned)\n' "$PASSN" "$FAILN" "$TOTAL" "$EXPECTED_CASES"
DONE=1
[ "$FAILN" = 0 ]
