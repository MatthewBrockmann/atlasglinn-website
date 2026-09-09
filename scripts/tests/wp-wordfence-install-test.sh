#!/usr/bin/env bash
# Harness for scripts/wp-wordfence-install.sh — stub sftp, curl, security and sleep on PATH, no host and no network.
#
#   bash scripts/tests/wp-wordfence-install-test.sh
#
# It prints PASS/FAIL per case, exits non-zero if any case fails, if the run produced fewer cases than the count pinned
# at the bottom, or if it dies before printing its summary — a harness that stops early used to look green.
#
# What it holds down, and why each case exists:
#   · THE FALSE SUCCESS THAT ROUND 1 FOUND. --status ran no sftp session at all and still printed "The one-shot removed
#     itself (sftp ls says … is gone)" and "LOOP STATUS: … FIRED-OBSERVED", exit 0 — including when the header it had
#     just read said self=left, i.e. the one-shot was still live code on the production host. Two cases pin the cure:
#     --status never prints FIRED-OBSERVED and says "not measured in --status" instead, and a header saying self=left
#     is enough to REFUSE the claim even though --status cannot prove the opposite.
#   · THE LOGIN PAGE IS IN THE VERDICT. wp-login.php was measured before and after and then left out of the regression
#     test, so an install that broke the only admin's way in exited 0. A case changes the login code between the two
#     reads and requires the run to fail — and to print --disable-wordfence, because --remove cannot undo Wordfence.
#   · AND THE VERDICT NEEDS A BASELINE. Round 2 shipped that limb guarded by `[ "$LOGIN_BEFORE" != 000 ]`, so an
#     unmeasurable before-read dropped the login page out of the verdict and 000 → 503 printed FIRED-OBSERVED and
#     exited 0. No case here had ever given any page a 000 baseline, which is why the harness could not see it. Three
#     cases now do the round-2 verifier's own scenarios: before 000 (the install must stop before it uploads), before
#     200 after 500 (fails), and before 200 after 200 (passes, and prints both codes in the verdict).
#   · THE ls CLASSIFIER IS STRICT ON PURPOSE. "no such file" without sftp's own prefix, and sftp's prefix naming a
#     DIFFERENT path, are both `unknown` — a login banner and a shell's "command not found" contain those words too.
#     Both were surviving mutants: the classifier could be relaxed to a bare word-match and the harness stayed green.
#   · THE MAC IS NOT REQUIRED. WP_SFTP_USER/WP_SFTP_PASSWORD drive the same SSH_ASKPASS mechanism from Actions; a case
#     runs that path, requires the Keychain to be untouched, and greps both values through everything the run wrote.
#   · A LOGIN NAME IS NOT A COMMAND. `-oProxyCommand=…` as the username is read by sftp as an option, and KC_SFTP is
#     interpolated into the helper this script executes; both stop the run before a session opens.
#   · THE RECOVERY EXISTS AND IS AN SFTP RENAME. --disable-wordfence renames wp-content/plugins/wordfence to
#     wordfence.off, proves it with an ls of the file inside each directory, and re-measures the three pages.
#   · err=0 means NO error. "0" is a non-empty string, so ${ERRTXT:+…} used to print "Recorded error: 0" on a clean run.
#   · act= OUTRANKS the recorded status. installed-not-active with act=1 is a live WAF being reported as off, which
#     costs a second, unnecessary install run.
#   · THE ACCOUNT NAME IS NOT AN IDENTIFIER TO SPEND. The stub Keychain account is greped for in every file the run
#     produced, exactly as the sibling harness greps for the stub password.
#   · WHICH FILES GO TO PRODUCTION IS NOT A KNOB. The upload list is pinned in the script; a case sets the env vars that
#     used to choose it and requires the real paths to be what the sftp batch carries.
#   · AND THE ENV THAT IS STILL READ IS BOUNDED: a newline in WP_DOCROOT injects an sftp command into a batch pointed at
#     a production docroot, so anything outside [A-Za-z0-9._/-] stops the run before a session opens.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
SCRIPT="$ROOT/scripts/wp-wordfence-install.sh"
STATUS_PHP="$ROOT/wp-ops/atlas-wordfence-status.php"
INSTALL_PHP="$ROOT/wp-ops/atlas-wordfence-install.php"
for f in "$SCRIPT" "$STATUS_PHP" "$INSTALL_PHP"; do [ -f "$f" ] || { echo "FAIL harness: no $f"; exit 1; }; done

WORK="$(mktemp -d "${TMPDIR:-/tmp}/wp-wf-test.XXXXXX")"
DONE=0
trap 'rc=$?; rm -rf -- "$WORK"; if [ "$DONE" != 1 ]; then printf "\nFAIL harness: died before its summary (exit %s) — the count below is not the whole run\n" "$rc"; exit 1; fi' EXIT
STUB="$WORK/bin"; mkdir -p "$STUB"
STUB_ACCT='stub-sftp-acct-do-not-log-9f2a'
ENV_USER='stub-env-user-do-not-log-7c1d'
ENV_PASS='stub-env-pass-do-not-log-4b8e'

if command -v shasum >/dev/null 2>&1; then FP="$(shasum -a 1 "$STATUS_PHP" | awk '{print substr($1,1,8)}')"
else FP="$(sha1sum "$STATUS_PHP" | awk '{print substr($1,1,8)}')"; fi
HDR_ACTIVE="1.0.0;b=$FP;st=installed;wf=8.1.0;act=1;prep=0;self=gone;tries=1;age=fresh;err=0"
HDR_SELFLEFT="1.0.0;b=$FP;st=installed;wf=8.1.0;act=1;prep=0;self=left;tries=1;age=fresh;err=0"
HDR_NOTACTIVE="1.0.0;b=$FP;st=installed;wf=8.1.0;act=0;prep=0;self=gone;tries=1;age=fresh;err=0"
HDR_INA_ACT1="1.0.0;b=$FP;st=installed-not-active;wf=8.1.0;act=1;prep=0;self=gone;tries=1;age=fresh;err=activate_unexpected_output"
HDR_PREP1="1.0.0;b=$FP;st=installed;wf=8.1.0;act=1;prep=1;self=gone;tries=1;age=fresh;err=0"
HDR_ERR="1.0.0;b=$FP;st=error;wf=none;act=0;prep=0;self=pending;tries=2;age=fresh;err=install_download_failed"
R_INSTALL="html/wp-content/mu-plugins/atlas-wordfence-install.php"
R_STATUS="html/wp-content/mu-plugins/atlas-wordfence-status.php"
R_WF="html/wp-content/plugins/wordfence/wordfence.php"
R_WFOFF="html/wp-content/plugins/wordfence.off/wordfence.php"

# ── stubs ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
# sftp answers an `ls` batch per path: STUB_LS_PRESENT_RE names the paths that are THERE (an extended regex matched
# against the path asked for); everything else answers with sftp's own "Can't ls: … not found". STUB_LS_MODE=noecho
# drops the `sftp> ls` echo, which is a session that never reached the host and must classify as unknown. Any other
# batch (put/rm/rename) is echoed back with STUB_SFTP_RC — its exit code and text are advisory, as in the sibling.
cat > "$STUB/sftp" <<'EOS'
#!/usr/bin/env bash
n=$(( $(cat "$STUB_STATE/sftp.n" 2>/dev/null || echo 0) + 1 )); printf '%s\n' "$n" > "$STUB_STATE/sftp.n"
printf '%s\n' "$*" >> "$STUB_STATE/sftp.args"
batch="$(cat)"
printf '%s\n' "$batch" >> "$STUB_STATE/sftp.stdin"
case "$batch" in
  ls\ *)
    p="$(printf '%s\n' "$batch" | sed -n 's/^ls "\(.*\)"$/\1/p' | head -1)"
    if [ "${STUB_LS_MODE:-echo}" = noecho ]; then
      printf 'Connected to stub.\n'
      printf 'Can'"'"'t ls: "%s" not found\n' "$p"
      exit 0
    fi
    # A shell's own words, with no sftp prefix — the shape the classifier must NOT read as a removal.
    if [ "${STUB_LS_MODE:-echo}" = banner ]; then
      printf 'Connected to stub.\n'
      printf 'sftp> ls "%s"\n' "$p"
      printf 'bash: %s: no such file or directory\n' "$p"
      printf 'sftp> \n'
      exit 0
    fi
    # sftp's own prefix, but about some OTHER path: it says nothing about the one that was asked for.
    if [ "${STUB_LS_MODE:-echo}" = othername ]; then
      printf 'Connected to stub.\n'
      printf 'sftp> ls "%s"\n' "$p"
      printf 'Can'"'"'t ls: "html/wp-content/mu-plugins/some-other-file.php" not found\n'
      printf 'sftp> \n'
      exit 0
    fi
    printf 'Connected to stub.\n'
    printf 'sftp> ls "%s"\n' "$p"
    if [ -n "${STUB_LS_PRESENT_RE:-}" ] && printf '%s' "$p" | grep -Eq "$STUB_LS_PRESENT_RE"; then
      printf '%s\n' "$p"
    else
      printf 'Can'"'"'t ls: "%s" not found\n' "$p"
    fi
    printf 'sftp> \n'
    exit "${STUB_LS_RC:-0}";;
esac
printf 'Connected to stub.\n'
[ -n "${STUB_SFTP_OUT:-}" ] && printf '%s\n' "$STUB_SFTP_OUT"
printf 'sftp> \n'
exit "${STUB_SFTP_RC:-0}"
EOS
# curl answers four shapes the script sends, told apart by the flags it used:
#   -D -   the header probe. It emits X-Atlas-Wordfence ONLY when the URL carries atlas-wordfence-status=$STUB_FP —
#          which is how the reporter behaves, and how a case can prove the script asks with the fingerprint.
#   -sI    a status read. Which page it is comes off the URL, and the FIRST read of each page is the "before" one.
#   -w %{http_code} with -o /dev/null and no -I: the trigger fetch.
#   anything else: the page body the marker grep reads.
cat > "$STUB/curl" <<'EOS'
#!/usr/bin/env bash
args="$*"
url="${!#}"
printf '%s\n' "$args" >> "$STUB_STATE/curl.args"
kind=other
case "$args" in
  *"-D -"*) kind=probe;;
  *"-sI"*) kind=code;;
  *"%{http_code}"*) kind=trigger;;
esac
case "$kind" in
  probe)
    n=$(( $(cat "$STUB_STATE/probe.n" 2>/dev/null || echo 0) + 1 )); printf '%s\n' "$n" > "$STUB_STATE/probe.n"
    [ "${STUB_PROBE_RC:-0}" != 0 ] && exit "${STUB_PROBE_RC:-0}"
    if [ "$n" = 1 ]; then hdr="${STUB_HDR:-}"; else hdr="${STUB_HDR2:-${STUB_HDR:-}}"; fi
    code="${STUB_PROBE_CODE:-200}"
    printf 'HTTP/2 %s\r\n' "$code"
    printf 'server: nginx\r\n'
    case "$url" in *"atlas-wordfence-status=${STUB_FP:-}"*) [ -n "$hdr" ] && printf 'x-atlas-wordfence: %s\r\n' "$hdr";; esac
    printf '\r\n'
    printf '\nATLAS_HTTP_CODE:%s\n' "$code"
    exit 0;;
  code)
    case "$url" in
      *wp-login.php) page=login;;
      *atlas-wordfence=*) page=wp;;
      *) page=home;;
    esac
    n=$(( $(cat "$STUB_STATE/code.$page.n" 2>/dev/null || echo 0) + 1 )); printf '%s\n' "$n" > "$STUB_STATE/code.$page.n"
    if [ "$n" = 1 ]; then
      case "$page" in login) code="${STUB_LOGIN_BEFORE:-200}";; wp) code="${STUB_WP_BEFORE:-200}";; *) code="${STUB_HOME_BEFORE:-200}";; esac
    else
      case "$page" in login) code="${STUB_LOGIN_AFTER:-200}";; wp) code="${STUB_WP_AFTER:-200}";; *) code="${STUB_HOME_AFTER:-200}";; esac
    fi
    printf 'HTTP/2 %s\r\n' "$code"
    printf '\r\n'
    printf '\nATLAS_HTTP_CODE:%s\n' "$code"
    exit 0;;
  trigger)
    n=$(( $(cat "$STUB_STATE/trigger.n" 2>/dev/null || echo 0) + 1 )); printf '%s\n' "$n" > "$STUB_STATE/trigger.n"
    printf '%s' "${STUB_TRIGGER_CODE:-200}"
    exit 0;;
  *)
    printf '%s' "${STUB_BODY:-<html>nothing here</html>}"
    exit 0;;
esac
EOS
cat > "$STUB/security" <<'EOS'
#!/usr/bin/env bash
n=$(( $(cat "$STUB_STATE/security.n" 2>/dev/null || echo 0) + 1 )); printf '%s\n' "$n" > "$STUB_STATE/security.n"
for a in "$@"; do [ "$a" = "-w" ] && { printf 'stub-password-not-logged\n'; exit 0; }; done
printf 'keychain: "/Users/stub/Library/Keychains/login.keychain-db"\n'
printf '    "acct"<blob>="%s"\n' "${STUB_ACCT:-stub}"
printf '    "svce"<blob>="mast-wp-sftp"\n'
EOS
cat > "$STUB/sleep" <<'EOS'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$STUB_STATE/sleep.args"
exit 0
EOS
chmod 755 "$STUB"/*

# ── runner ────────────────────────────────────────────────────────────────────────────────────────────────────────────
PASSN=0; FAILN=0
t() { if [ "${2:-0}" = 1 ]; then PASSN=$((PASSN+1)); printf 'PASS %s\n' "$1"; else FAILN=$((FAILN+1)); printf 'FAIL %s%s\n' "$1" "${3:+ — $3}"; fi; }
b() { if "$@" >/dev/null 2>&1; then printf 1; else printf 0; fi; }
nb() { if "$@" >/dev/null 2>&1; then printf 0; else printf 1; fi; }
eq() { if [ "$1" = "$2" ]; then printf 1; else printf 0; fi; }
reset_case() {
  C_HDR=""; C_HDR2=""; C_PROBE_CODE=200; C_PROBE_RC=0; C_FP="$FP"
  C_HOME_B=200; C_HOME_A=200; C_WP_B=200; C_WP_A=200; C_LOGIN_B=200; C_LOGIN_A=200
  C_LS_PRESENT_RE=""; C_LS_MODE=echo; C_LS_RC=0; C_SFTP_RC=0; C_SFTP_OUT=""
  C_DOCROOT="html"; C_ENV_SRC=0
  # Passed on EVERY case, empty by default: an ambient WP_SFTP_USER in the runner's environment would otherwise
  # switch the credential path under cases that mean to exercise the Keychain one.
  C_ENV_USER=""; C_ENV_PASS=""; C_KC="mast-wp-sftp"
}
calls() { cat "$STATE/$1.n" 2>/dev/null || printf 0; }
run_case() {
  CASE="$1"; shift
  STATE="$WORK/$CASE/state"; CHOME="$WORK/$CASE/home"; OUT="$WORK/$CASE/out"
  mkdir -p "$STATE" "$CHOME"
  # Through `env`, because an assignment that arrives as an expanded word is a COMMAND to bash, not an assignment.
  ENVSRC=(env)
  [ "$C_ENV_SRC" = 1 ] && ENVSRC=(env ATLAS_WF_INSTALL_SRC="$WORK/evil-install.php" ATLAS_WF_STATUS_SRC="$WORK/evil-status.php")
  PATH="$STUB:$PATH" HOME="$CHOME" STUB_STATE="$STATE" STUB_ACCT="$STUB_ACCT" \
    STUB_HDR="$C_HDR" STUB_HDR2="$C_HDR2" STUB_PROBE_CODE="$C_PROBE_CODE" STUB_PROBE_RC="$C_PROBE_RC" STUB_FP="$C_FP" \
    STUB_HOME_BEFORE="$C_HOME_B" STUB_HOME_AFTER="$C_HOME_A" STUB_WP_BEFORE="$C_WP_B" STUB_WP_AFTER="$C_WP_A" \
    STUB_LOGIN_BEFORE="$C_LOGIN_B" STUB_LOGIN_AFTER="$C_LOGIN_A" \
    STUB_LS_PRESENT_RE="$C_LS_PRESENT_RE" STUB_LS_MODE="$C_LS_MODE" STUB_LS_RC="$C_LS_RC" \
    STUB_SFTP_RC="$C_SFTP_RC" STUB_SFTP_OUT="$C_SFTP_OUT" \
    WP_SFTP_USER="$C_ENV_USER" WP_SFTP_PASSWORD="$C_ENV_PASS" KC_SFTP="$C_KC" \
    WP_DOCROOT="$C_DOCROOT" ATLAS_WF_POLL_SLEEP=0 ATLAS_WF_POLL_TRIES=2 ATLAS_WF_TRIGGER_TRIES=1 \
    "${ENVSRC[@]}" "$BASH" "$SCRIPT" "$@" > "$OUT" 2>&1
  RC=$?
  STAMPF="$CHOME/.cache/wp-upload/last-wordfence-install"
  LOGF="$CHOME/.cache/wp-upload/wp-wordfence-install.log"
  STAMPV="$(cat "$STAMPF" 2>/dev/null || printf '')"
}

printf 'wp-wordfence-install harness — status plugin build %s\n\n' "$FP"

# ── 1. --status with act=1 and self=gone: the P1. No sftp ran, so no self-removal claim and no FIRED-OBSERVED ────────
reset_case; C_HDR="$HDR_ACTIVE"; run_case status-active --status
t "status-active/exit-0"                 "$(eq "$RC" 0)" "exit $RC"
t "status-active/reports-active"         "$(b grep -q 'is INSTALLED and ACTIVE' "$OUT")"
t "status-active/no-FIRED-OBSERVED"      "$(nb grep -q 'FIRED-OBSERVED' "$OUT")" "$(grep -n 'FIRED-OBSERVED' "$OUT" | head -1)"
t "status-active/says-not-measured"      "$(b grep -q 'self-removal: not measured in --status' "$OUT")"
t "status-active/no-self-removed-claim"  "$(nb grep -q 'removed itself (sftp' "$OUT")" "$(grep -n 'removed itself' "$OUT" | head -1)"
t "status-active/ran-no-sftp-at-all"     "$(eq "$(calls sftp)" 0)" "sftp calls $(calls sftp)"
t "status-active/heartbeat-status-only"  "$(b grep -q 'active-status-only' "$STAMPF")" "$STAMPV"

# ── 2. --status where the header itself says the one-shot is still there ────────────────────────────────────────────
reset_case; C_HDR="$HDR_SELFLEFT"; run_case status-self-left --status
t "status-self-left/exit-non-zero"       "$(b test "$RC" -ne 0)" "exit $RC"
t "status-self-left/names-it"            "$(b grep -q 'STILL ON THE HOST' "$OUT")"
t "status-self-left/no-FIRED-OBSERVED"   "$(nb grep -q 'FIRED-OBSERVED' "$OUT")"
t "status-self-left/heartbeat-self-left" "$(b grep -q 'self-left' "$STAMPF")" "$STAMPV"

# ── 3. --install, everything true: header carries the build, act=1, ls says the one-shot is gone, pages unchanged ────
reset_case; C_HDR="$HDR_ACTIVE"; run_case install-happy
t "install-happy/exit-0"                 "$(eq "$RC" 0)" "exit $RC"
t "install-happy/FIRED-OBSERVED"         "$(b grep -q 'FIRED-OBSERVED' "$OUT")"
t "install-happy/self-removal-proved"    "$(b grep -q 'The one-shot removed itself — sftp ls classified absent' "$OUT")" "$(grep -n 'one-shot removed' "$OUT" | head -1)"
t "install-happy/batch-put-both"         "$(b grep -q 'put .*atlas-wordfence-install.php' "$STATE/sftp.stdin")" "$(tr '\n' ' ' < "$STATE/sftp.stdin")"
t "install-happy/probe-carries-build"    "$(b grep -q "atlas-wordfence-status=$FP" "$STATE/curl.args")"
t "install-happy/heartbeat-active"       "$(b grep -q ' active st=installed act=1' "$STAMPF")" "$STAMPV"

# ── 4. --install where the ls lists the installer: live code left on a production host is not a success ──────────────
reset_case; C_HDR="$HDR_ACTIVE"; C_LS_PRESENT_RE='atlas-wordfence-install\.php'; run_case install-self-left
t "install-self-left/exit-non-zero"      "$(b test "$RC" -ne 0)" "exit $RC"
t "install-self-left/no-FIRED-OBSERVED"  "$(nb grep -q 'FIRED-OBSERVED' "$OUT")"
t "install-self-left/says-remove"        "$(b grep -q -- '--remove' "$OUT")"

# ── 5. the login page changed between the two reads: the run fails and prints the remedy that can undo it ───────────
reset_case; C_HDR="$HDR_ACTIVE"; C_LOGIN_B=200; C_LOGIN_A=503; run_case login-regressed
t "login-regressed/exit-non-zero"        "$(b test "$RC" -ne 0)" "exit $RC"
t "login-regressed/site-changed"         "$(b grep -q 'FAILED on the site itself' "$OUT")"
t "login-regressed/names-wp-login"       "$(b grep -q 'wp-login.php went from http 200 to http 503' "$OUT")" "$(grep -n 'went from' "$OUT" | head -2 | tr '\n' ' ')"
t "login-regressed/remedy-is-disable"    "$(b grep -q -- '--disable-wordfence' "$OUT")"
t "login-regressed/remedy-not-just-remove" "$(b grep -q 'remove CANNOT do that' "$OUT")"
t "login-regressed/no-FIRED-OBSERVED"    "$(nb grep -q 'FIRED-OBSERVED' "$OUT")"
t "login-regressed/heartbeat-site-changed" "$(b grep -q 'site-changed' "$STAMPF")" "$STAMPV"

# ── 5b. the login page unchanged at a non-200 is NOT a regression: it is what it was before the run ─────────────────
reset_case; C_HDR="$HDR_ACTIVE"; C_LOGIN_B=403; C_LOGIN_A=403; run_case login-steady
t "login-steady/exit-0"                  "$(eq "$RC" 0)" "exit $RC"
t "login-steady/no-site-changed"         "$(nb grep -q 'FAILED on the site itself' "$OUT")"

# ── 6. err=0 means there was no error, and "0" is not an error to report ────────────────────────────────────────────
reset_case; C_HDR="$HDR_NOTACTIVE"; run_case err-zero
t "err-zero/not-active"                  "$(b grep -q 'is NOT active right now' "$OUT")"
t "err-zero/no-recorded-error-line"      "$(nb grep -q 'Recorded error' "$OUT")" "$(grep -n 'Recorded error' "$OUT" | head -1)"
# ── 6b. a real error prints its CODE, and the header never carried the message ─────────────────────────────────────
reset_case; C_HDR="$HDR_ERR"; run_case err-code
t "err-code/install-error"               "$(b grep -q 'the install FAILED' "$OUT")"
t "err-code/prints-the-code"             "$(b grep -q 'Recorded error code: install_download_failed' "$OUT")" "$(grep -n 'Recorded error' "$OUT" | head -1)"

# ── 7. installed-not-active with act=1: the LIVE read wins, or a running WAF gets reported as off ───────────────────
reset_case; C_HDR="$HDR_INA_ACT1"; run_case installed-not-active-act1
t "ina-act1/exit-0"                      "$(eq "$RC" 0)" "exit $RC"
t "ina-act1/reported-active"             "$(b grep -q 'is INSTALLED and ACTIVE' "$OUT")" "$(grep -n '^verify' "$OUT" | head -1)"
t "ina-act1/not-reported-off"            "$(nb grep -q 'is NOT active right now' "$OUT")"

# ── 8. the reporter answers only its own build: a probe asking for another one reads nothing, and nothing is claimed ─
reset_case; C_HDR="$HDR_ACTIVE"; C_FP="deadbeef"; run_case wrong-fingerprint
t "wrong-fp/exit-non-zero"               "$(b test "$RC" -ne 0)" "exit $RC"
t "wrong-fp/status-absent"               "$(b grep -q 'status-absent' "$STAMPF")" "$STAMPV"
t "wrong-fp/claims-nothing"              "$(nb grep -q 'FIRED-OBSERVED' "$OUT")"

# ── 9. the SFTP account name reaches no output, no log and no heartbeat ─────────────────────────────────────────────
reset_case; C_HDR="$HDR_ACTIVE"; run_case no-acct-in-log
t "no-acct/keychain-was-read"            "$(b grep -q 'put ' "$STATE/sftp.stdin")"
t "no-acct/not-in-output"                "$(nb grep -q "$STUB_ACCT" "$OUT")" "$(grep -n "$STUB_ACCT" "$OUT" | head -1)"
t "no-acct/not-in-log"                   "$(nb grep -q "$STUB_ACCT" "$LOGF")"
t "no-acct/not-in-heartbeat"             "$(nb grep -q "$STUB_ACCT" "$STAMPF")"
# Everything the RUN produced — output, log, heartbeat. The stub's own argv ledger is excluded on purpose: the account
# name is in the sftp command line by necessity (it is the login), and what this pins is that it reaches no artefact.
t "no-acct/not-anywhere-in-the-run"      "$(nb grep -rq "$STUB_ACCT" "$OUT" "$CHOME")" "$(grep -rln "$STUB_ACCT" "$OUT" "$CHOME" | head -2 | tr '\n' ' ')"

# ── 10. --disable-wordfence: the recovery. A rename, proved by an ls of the file inside each directory ──────────────
reset_case; C_HDR="$HDR_ACTIVE"; C_LS_PRESENT_RE='wordfence\.off'; C_LOGIN_B=503; C_LOGIN_A=200; C_WP_B=503; C_WP_A=200
run_case disable-happy --disable-wordfence
t "disable/exit-0"                       "$(eq "$RC" 0)" "exit $RC"
t "disable/sent-a-rename"                "$(b grep -q "^rename \"$(printf '%s' 'html/wp-content/plugins/wordfence')\" \"html/wp-content/plugins/wordfence.off\"$" "$STATE/sftp.stdin")" "$(tr '\n' ' ' < "$STATE/sftp.stdin")"
t "disable/proved-by-ls"                 "$(b grep -q 'wordfence/wordfence.php absent · wordfence.off/wordfence.php present' "$OUT")" "$(grep -n '^verify' "$OUT" | head -1)"
t "disable/remeasured-login"             "$(b grep -q 'wp-login.php http 200 (was 503)' "$OUT")" "$(grep -n '^after' "$OUT" | head -1)"
t "disable/says-how-to-put-it-back"      "$(b grep -q 'rename \"html/wp-content/plugins/wordfence.off\" \"html/wp-content/plugins/wordfence\"' "$OUT")"
t "disable/heartbeat"                    "$(b grep -q 'wordfence-disabled' "$STAMPF")" "$STAMPV"
t "disable/no-acct-in-output"            "$(nb grep -q "$STUB_ACCT" "$OUT")" "$(grep -n "$STUB_ACCT" "$OUT" | head -1)"
# ── 10b. the rename did not take: Wordfence is still there, and the run says so instead of claiming a recovery ──────
reset_case; C_HDR="$HDR_ACTIVE"; C_LS_PRESENT_RE='plugins/wordfence/'; run_case disable-failed --disable-wordfence
t "disable-failed/exit-non-zero"         "$(b test "$RC" -ne 0)" "exit $RC"
t "disable-failed/says-still-running"    "$(b grep -q 'did NOT take' "$OUT")"

# ── 11. --remove-status takes the reporter off and leaves the installer alone ───────────────────────────────────────
reset_case; C_HDR="$HDR_ACTIVE"; run_case remove-status --remove-status
t "remove-status/exit-0"                 "$(eq "$RC" 0)" "exit $RC"
t "remove-status/one-rm-only"            "$(eq "$(grep -c '^rm ' "$STATE/sftp.stdin")" 1)" "$(tr '\n' ' ' < "$STATE/sftp.stdin")"
t "remove-status/rm-is-the-reporter"     "$(b grep -q "^rm \"$R_STATUS\"$" "$STATE/sftp.stdin")"
t "remove-status/installer-not-measured" "$(b grep -q 'installer not-measured' "$OUT")" "$(grep -n '^verify' "$OUT" | head -1)"
# ── 11b. --remove takes both, and still touches nothing of Wordfence's ─────────────────────────────────────────────
reset_case; C_HDR="$HDR_ACTIVE"; run_case remove-both --remove
t "remove/exit-0"                        "$(eq "$RC" 0)" "exit $RC"
t "remove/two-rms"                       "$(eq "$(grep -c '^rm ' "$STATE/sftp.stdin")" 2)"
t "remove/wordfence-untouched"           "$(nb grep -q "rm \"html/wp-content/plugins" "$STATE/sftp.stdin")"
t "remove/points-at-disable-for-off"     "$(b grep -q -- 'Turning Wordfence OFF is --disable-wordfence' "$OUT")"
t "remove/no-acct-in-output"             "$(nb grep -q "$STUB_ACCT" "$OUT")" "$(grep -n "$STUB_ACCT" "$OUT" | head -1)"

# ── 12. which files go to production is pinned in the script, not chosen by the environment ────────────────────────
printf '<?php // not the file this script sends\n' > "$WORK/evil-install.php"
printf '<?php // not the file this script sends\n' > "$WORK/evil-status.php"
reset_case; C_HDR="$HDR_ACTIVE"; C_ENV_SRC=1; run_case env-src
t "env-src/uploaded-the-repo-files"      "$(b grep -q "put \"$ROOT/wp-ops/atlas-wordfence-install.php\"" "$STATE/sftp.stdin")" "$(tr '\n' ' ' < "$STATE/sftp.stdin")"
t "env-src/ignored-the-env"              "$(nb grep -q 'evil-' "$STATE/sftp.stdin")"

# ── 13. a newline in WP_DOCROOT is an sftp command injected into a batch aimed at a production docroot ─────────────
reset_case; C_HDR="$HDR_ACTIVE"; C_DOCROOT='html"
rm "html/wp-config.php'; run_case bad-docroot
t "bad-docroot/exit-non-zero"            "$(b test "$RC" -ne 0)" "exit $RC"
t "bad-docroot/refused"                  "$(b grep -q 'refusing to run' "$OUT")" "$(head -1 "$OUT")"
t "bad-docroot/nothing-sent"             "$(eq "$(calls sftp)" 0)" "sftp calls $(calls sftp)"
t "bad-docroot/no-curl-either"           "$(b test ! -s "$STATE/curl.args")"

# ── 14. two arguments read as a removal to a human and must reach no host at all ────────────────────────────────────
reset_case; run_case two-args --remove --install
t "two-args/exit-non-zero"               "$(b test "$RC" -ne 0)" "exit $RC"
t "two-args/nothing-sent"                "$(eq "$(calls sftp)" 0)"
t "two-args/aborted-stamp"               "$(b grep -q 'aborted-bad-arg' "$STAMPF")" "$STAMPV"
reset_case; run_case unknown-arg --nuke
t "unknown-arg/exit-non-zero"            "$(b test "$RC" -ne 0)" "exit $RC"
t "unknown-arg/lists-the-modes"          "$(b grep -q -- '--disable-wordfence renames' "$OUT")"

# ── 15. an ls session that never reached the host answers nothing, and nothing is claimed off it ───────────────────
reset_case; C_HDR="$HDR_ACTIVE"; C_LS_MODE=noecho; run_case ls-unknown
t "ls-unknown/exit-non-zero"             "$(b test "$RC" -ne 0)" "exit $RC"
t "ls-unknown/no-FIRED-OBSERVED"         "$(nb grep -q 'FIRED-OBSERVED' "$OUT")"
t "ls-unknown/classified-unknown"        "$(b grep -q 'ls classified unknown' "$OUT")"

# ── 16. THE ROUND-2 BLOCKER. The verifier's three stub-curl scenarios, in its own order ─────────────────────────────
# (a) before 000: there is no baseline, so the install stops before it uploads rather than run a verdict every
# after-code passes. This is the case that used to end in FIRED-OBSERVED with wp-login.php left at http 503.
reset_case; C_HDR="$HDR_ACTIVE"; C_LOGIN_B=000; C_LOGIN_A=503; run_case login-before-000
t "login-000/exit-non-zero"              "$(b test "$RC" -ne 0)" "exit $RC"
t "login-000/says-not-measurable"        "$(b grep -q 'login page not measurable before install — stopping' "$OUT")" "$(tail -1 "$OUT")"
t "login-000/nothing-uploaded"           "$(eq "$(calls sftp)" 0)" "sftp calls $(calls sftp)"
t "login-000/no-FIRED-OBSERVED"          "$(nb grep -q 'FIRED-OBSERVED' "$OUT")" "$(grep -n 'FIRED-OBSERVED' "$OUT" | head -1)"
t "login-000/aborted-stamp"              "$(b grep -q 'aborted-login-not-measurable' "$STAMPF")" "$STAMPV"
# (b) before 200, after 500: a difference, and a difference fails.
reset_case; C_HDR="$HDR_ACTIVE"; C_LOGIN_B=200; C_LOGIN_A=500; run_case login-200-500
t "login-200-500/exit-non-zero"          "$(b test "$RC" -ne 0)" "exit $RC"
t "login-200-500/site-changed"           "$(b grep -q 'FAILED on the site itself' "$OUT")"
t "login-200-500/names-both-codes"       "$(b grep -q 'wp-login.php went from http 200 to http 500' "$OUT")" "$(grep -n 'went from' "$OUT" | head -1)"
t "login-200-500/no-FIRED-OBSERVED"      "$(nb grep -q 'FIRED-OBSERVED' "$OUT")"
# (c) before 200, after 200: the run passes, and the verdict carries BOTH codes so the reader can check the rule.
reset_case; C_HDR="$HDR_ACTIVE"; C_LOGIN_B=200; C_LOGIN_A=200; run_case login-200-200
t "login-200-200/exit-0"                 "$(eq "$RC" 0)" "exit $RC"
t "login-200-200/FIRED-OBSERVED"         "$(b grep -q 'FIRED-OBSERVED' "$OUT")"
t "login-200-200/verdict-has-both-codes" "$(b grep -q 'verdict inputs: .*wp-login.php before http 200 · after http 200' "$OUT")" "$(grep -n 'verdict inputs' "$OUT" | head -1)"

# (d) and the SAME baseline in --status, where the die above does not apply because --status changes nothing. This is
# what pins the removal of the `[ "$LOGIN_BEFORE" != 000 ]` exemption itself: with the exemption back in place the
# install cases still stop at the die, so only a mode that runs the verdict on a 000 baseline can see it.
reset_case; C_HDR="$HDR_ACTIVE"; C_LOGIN_B=000; C_LOGIN_A=503; run_case login-000-status --status
t "login-000-status/exit-non-zero"       "$(b test "$RC" -ne 0)" "exit $RC"
t "login-000-status/site-changed"        "$(b grep -q 'FAILED on the site itself' "$OUT")" "$(grep -n '^verify' "$OUT" | head -1)"
t "login-000-status/names-both-codes"    "$(b grep -q 'wp-login.php went from http 000 to http 503' "$OUT")" "$(grep -n 'went from' "$OUT" | head -1)"

# ── 17. the ls classifier: the words alone are not sftp saying a file is gone ───────────────────────────────────────
reset_case; C_HDR="$HDR_ACTIVE"; C_LS_MODE=banner; run_case ls-banner --remove-status
t "ls-banner/classified-unknown"         "$(b grep -q 'ls classified unknown' "$OUT")" "$(grep -n 'ls classified' "$OUT" | head -1)"
t "ls-banner/exit-non-zero"              "$(b test "$RC" -ne 0)" "exit $RC"
reset_case; C_HDR="$HDR_ACTIVE"; C_LS_MODE=othername; run_case ls-othername --remove-status
t "ls-othername/classified-unknown"      "$(b grep -q 'ls classified unknown' "$OUT")" "$(grep -n 'ls classified' "$OUT" | head -1)"
t "ls-othername/exit-non-zero"           "$(b test "$RC" -ne 0)" "exit $RC"

# ── 18. --disable-wordfence: the failure branch of the remedy still prints the remedy ───────────────────────────────
reset_case; C_HDR="$HDR_ACTIVE"; C_LS_MODE=noecho; run_case disable-unknown --disable-wordfence
t "disable-unknown/exit-non-zero"        "$(b test "$RC" -ne 0)" "exit $RC"
t "disable-unknown/claims-nothing"       "$(b grep -q 'disable-unknown' "$OUT")" "$(grep -n 'LOOP STATUS' "$OUT" | head -1)"
t "disable-unknown/says-how-to-undo-it"  "$(b grep -q 'rename \"html/wp-content/plugins/wordfence.off\" \"html/wp-content/plugins/wordfence\"' "$OUT")" "$(grep -n 'put it back' "$OUT" | head -1)"
# ── 18b. prep=1 is extended protection: renaming that directory away takes the site down HARDER. Refuse, send nothing ─
reset_case; C_HDR="$HDR_PREP1"; run_case disable-prep1 --disable-wordfence
t "disable-prep1/exit-non-zero"          "$(b test "$RC" -ne 0)" "exit $RC"
t "disable-prep1/refused"                "$(b grep -q 'REFUSED, and nothing was sent' "$OUT")" "$(tail -1 "$OUT")"
t "disable-prep1/no-rename-sent"         "$(eq "$(calls sftp)" 0)" "sftp calls $(calls sftp)"
t "disable-prep1/aborted-stamp"          "$(b grep -q 'aborted-disable-refused-prep' "$STAMPF")" "$STAMPV"

# ── 19. the Mac is not required: WP_SFTP_USER/WP_SFTP_PASSWORD drive the same SSH_ASKPASS mechanism ─────────────────
reset_case; C_HDR="$HDR_ACTIVE"; C_ENV_USER="$ENV_USER"; C_ENV_PASS="$ENV_PASS"; run_case env-creds
t "env-creds/exit-0"                     "$(eq "$RC" 0)" "exit $RC"
t "env-creds/uploaded"                   "$(b grep -q 'put ' "$STATE/sftp.stdin")" "$(tr '\n' ' ' < "$STATE/sftp.stdin")"
t "env-creds/keychain-untouched"         "$(eq "$(calls security)" 0)" "security calls $(calls security)"
t "env-creds/names-the-source-only"      "$(b grep -q 'login: the WP_SFTP_USER/WP_SFTP_PASSWORD environment pair' "$OUT")" "$(grep -n '^login:' "$OUT" | head -1)"
t "env-creds/username-nowhere"           "$(nb grep -rq "$ENV_USER" "$OUT" "$CHOME")" "$(grep -rln "$ENV_USER" "$OUT" "$CHOME" | head -2 | tr '\n' ' ')"
t "env-creds/password-nowhere"           "$(nb grep -rq "$ENV_PASS" "$OUT" "$CHOME")" "$(grep -rln "$ENV_PASS" "$OUT" "$CHOME" | head -2 | tr '\n' ' ')"
# ── 19b. a login name starting with a dash is an sftp OPTION, and -oProxyCommand= is arbitrary command execution ────────
reset_case; C_HDR="$HDR_ACTIVE"; C_ENV_USER='-oProxyCommand=touch /tmp/wf-proxy-proof'; C_ENV_PASS="$ENV_PASS"; run_case bad-login
t "bad-login/exit-non-zero"              "$(b test "$RC" -ne 0)" "exit $RC"
t "bad-login/refused"                    "$(b grep -q 'reads as an option, not a user' "$OUT")" "$(tail -1 "$OUT")"
t "bad-login/nothing-sent"               "$(eq "$(calls sftp)" 0)" "sftp calls $(calls sftp)"
t "bad-login/name-not-echoed"            "$(nb grep -q 'ProxyCommand' "$OUT")" "$(grep -n 'ProxyCommand' "$OUT" | head -1)"
# ── 19c. KC_SFTP is interpolated into the helper this script EXECUTES: a command substitution in it runs as this user ─
reset_case; C_HDR="$HDR_ACTIVE"; C_KC='$(touch /tmp/wf-kc-proof)mast-wp-sftp'; run_case kc-injection
t "kc-injection/exit-non-zero"           "$(b test "$RC" -ne 0)" "exit $RC"
t "kc-injection/refused"                 "$(b grep -q 'refusing to run: KC_SFTP' "$OUT")" "$(head -1 "$OUT")"
t "kc-injection/nothing-sent"            "$(eq "$(calls sftp)" 0)" "sftp calls $(calls sftp)"
t "kc-injection/no-curl-either"          "$(b test ! -s "$STATE/curl.args")"

# ── summary ───────────────────────────────────────────────────────────────────────────────────────────────────────────
TOTAL=$((PASSN + FAILN))
PIN=116
printf '\n%s: %s assertions, %s failed\n' "$([ "$FAILN" = 0 ] && [ "$TOTAL" = "$PIN" ] && printf OK || printf FAILED)" "$TOTAL" "$FAILN"
if [ "$TOTAL" != "$PIN" ]; then
  printf 'FAIL harness: %s assertions ran, pinned at %s — a run that stops early used to look green\n' "$TOTAL" "$PIN"
  FAILN=$((FAILN + 1))
fi
DONE=1
[ "$FAILN" = 0 ]
