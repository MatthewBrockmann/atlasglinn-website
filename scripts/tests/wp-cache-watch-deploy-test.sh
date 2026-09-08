#!/usr/bin/env bash
# Harness for scripts/wp-cache-watch-deploy.sh — stub sftp, curl, security, shasum and sleep on PATH, no host and no
# network. Run from anywhere:
#
#   bash scripts/tests/wp-cache-watch-deploy-test.sh
#
# It prints PASS/FAIL per case and exits non-zero if any case fails, if the run produced fewer cases than the count
# pinned at the bottom, or if it dies before printing its summary — a harness that stops early used to look green.
#
# What it holds down, case by case, after round 3:
#   · sftp's exit code and its text are ADVISORY. A batch on stdin does not abort on a failed put or rm (that needs -b,
#     which sets BatchMode and refuses the Keychain askpass), so a run whose sftp said "Permission denied" and whose
#     host serves an old build must still fail — on the fingerprint, not on the exit code — and a run whose sftp exited
#     non-zero while the host serves the exact bytes sent is a verified deploy.
#   · the tolerated `-mkdir` prints "Couldn't create directory: Failure" on every healthy run, so that line must NOT
#     raise an advisory.
#   · the version alone is not proof; the build fingerprint the plugin publishes has to equal the file just sent.
#   · a missing header gets exactly one retry and then a non-zero exit.
#   · --remove is decided by an sftp `ls` of the same path, never by the header: a plugin still on the host but disabled
#     by a wp-config constant sends no header either. Listed = rm-failed, "not found" = removed, anything else unknown.
#   · every abort before the verdict stamps `aborted-<reason>` over the heartbeat, so a previous run's `deployed` can
#     never be read as this run's.
#   · the probe follows redirects, and it is the FINAL response that is classified.
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
# the round-3 cases: rc and text are advisory). An `ls` batch answers per STUB_LS_MODE — and it echoes the command after
# the "sftp> " prompt exactly as OpenSSH does when stdin is not a tty, so the path appears in the output of a successful
# ls AND of a failed one; the script has to read past the echo.
cat > "$STUB/sftp" <<'EOS'
#!/usr/bin/env bash
n=$(( $(cat "$STUB_STATE/sftp.n" 2>/dev/null || echo 0) + 1 )); printf '%s\n' "$n" > "$STUB_STATE/sftp.n"
printf '%s\n' "$*" >> "$STUB_STATE/sftp.args"
batch="$(cat)"
printf '%s\n' "$batch" >> "$STUB_STATE/sftp.stdin"
printf 'Connected to stub.\n'
case "$batch" in
  ls\ *)
    p="$(printf '%s\n' "$batch" | sed -n 's/^ls "\(.*\)"$/\1/p' | head -1)"
    printf 'sftp> ls "%s"\n' "$p"
    case "${STUB_LS_MODE:-gone}" in
      present) printf '%s\n' "$p";;
      fail)    printf 'Connection closed\n'; printf 'sftp> \n'; exit "${STUB_LS_RC:-255}";;
      *)       printf 'Can'"'"'t ls: "%s" not found\n' "$p";;
    esac
    printf 'sftp> \n'
    exit "${STUB_LS_RC:-0}"
    ;;
esac
[ -n "${STUB_SFTP_OUT:-}" ] && printf '%s\n' "$STUB_SFTP_OUT"
printf 'sftp> \n'
exit "${STUB_SFTP_RC:-0}"
EOS
# curl -sI -L -D - prints EVERY response in the chain and -w '%{http_code}' reports the LAST one, so STUB_REDIRECT=1
# emits a 301 hop (carrying a deliberately wrong header) followed by the real answer.
cat > "$STUB/curl" <<'EOS'
#!/usr/bin/env bash
n=$(( $(cat "$STUB_STATE/curl.n" 2>/dev/null || echo 0) + 1 )); printf '%s\n' "$n" > "$STUB_STATE/curl.n"
printf '%s\n' "$*" >> "$STUB_STATE/curl.args"
[ "${STUB_CURL_RC:-0}" != 0 ] && exit "${STUB_CURL_RC:-0}"
if [ "$n" = 1 ]; then code="${STUB_CODE:-200}"; hdr="${STUB_HDR:-}"; else code="${STUB_CODE2:-200}"; hdr="${STUB_HDR2:-}"; fi
if [ "${STUB_REDIRECT:-0}" = 1 ]; then
  printf 'HTTP/2 301\r\n'
  printf 'location: https://www.atlasglinn.com/\r\n'
  printf 'x-atlas-cache-watch: %s\r\n' "${STUB_HDR_HOP:-0.0.1;b=deadbeef;age=old;cdn=no;fp=0;tick=never}"
  printf '\r\n'
fi
printf 'HTTP/2 %s\r\n' "$code"
printf 'server: nginx\r\n'
printf 'content-type: text/html; charset=UTF-8\r\n'
[ -n "$hdr" ] && printf 'x-atlas-cache-watch: %s\r\n' "$hdr"
printf '\r\n'
printf '\n%s' "$code"
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

# ── runner ──────────────────────────────────────────────────────────────────────────────────────────────────────────
PASSN=0; FAILN=0
t() { if [ "${2:-0}" = 1 ]; then PASSN=$((PASSN+1)); printf 'PASS %s\n' "$1"; else FAILN=$((FAILN+1)); printf 'FAIL %s%s\n' "$1" "${3:+ — $3}"; fi; }
b() { if "$@" >/dev/null 2>&1; then printf 1; else printf 0; fi; }
eq() { if [ "$1" = "$2" ]; then printf 1; else printf 0; fi; }
reset_case() {
  C_SFTP_RC=0; C_SFTP_OUT=""; C_LS_MODE=gone; C_LS_RC=0
  C_CURL_RC=0; C_CODE=200; C_CODE2=200; C_HDR=""; C_HDR2=""; C_REDIRECT=0
  C_NO_KC=0; C_SRC="$PLUGIN"; C_HOME=""
}
calls() { cat "$STATE/$1.n" 2>/dev/null || printf 0; }
run_case() {
  CASE="$1"; shift
  STATE="$WORK/$CASE/state"; CHOME="$WORK/${C_HOME:-$CASE}/home"; OUT="$WORK/$CASE/out"
  mkdir -p "$STATE" "$CHOME"
  PATH="$STUB:$PATH" HOME="$CHOME" STUB_STATE="$STATE" STUB_PW="$STUB_PW" \
    STUB_SFTP_RC="$C_SFTP_RC" STUB_SFTP_OUT="$C_SFTP_OUT" STUB_LS_MODE="$C_LS_MODE" STUB_LS_RC="$C_LS_RC" \
    STUB_CURL_RC="$C_CURL_RC" STUB_CODE="$C_CODE" STUB_CODE2="$C_CODE2" STUB_REDIRECT="$C_REDIRECT" \
    STUB_HDR="$C_HDR" STUB_HDR2="$C_HDR2" STUB_NO_KEYCHAIN="$C_NO_KC" ATLAS_WATCH_SRC="$C_SRC" \
    bash "$SCRIPT" "$@" > "$OUT" 2>&1
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

# ── 8. the header is proof even when the page itself is a 404, and its absence proves nothing when curl fails ───────
reset_case; C_CODE=404; C_CODE2=404; C_HDR="$GOOD"; C_HDR2="$GOOD"; run_case deployed-on-404
t "deployed-on-404/exit-0"      "$(eq "$RC" 0)" "exit $RC"
t "deployed-on-404/deployed"    "$(b grep -q 'DEPLOYED-OBSERVED' "$OUT")"
reset_case; C_CURL_RC=7; run_case install-curl-fails
t "install-curl-fails/exit-non-zero" "$(b test "$RC" -ne 0)" "exit $RC"
t "install-curl-fails/says-unknown"  "$(b grep -q 'UNKNOWN' "$OUT")"
t "install-curl-fails/heartbeat"     "$(b grep -q 'unreachable' "$STAMPF")" "$STAMPV"
t "install-curl-fails/no-absent-claim" "$(b bash -c '! grep -q "plugin is not loading" "$1"' _ "$OUT")"

# ── 9. a redirect chain: the FINAL response is the one classified, not the hop ──────────────────────────────────────
reset_case; C_REDIRECT=1; C_HDR="$GOOD"; C_HDR2="$GOOD"; run_case redirect-final-response
t "redirect/exit-0"             "$(eq "$RC" 0)" "exit $RC"
t "redirect/deployed-from-final" "$(b grep -q 'DEPLOYED-OBSERVED' "$OUT")"
t "redirect/one-probe"          "$(eq "$(calls curl)" 1)" "curl calls $(calls curl)"
t "redirect/hop-header-ignored" "$(b bash -c '! grep -q "deadbeef" "$1"' _ "$OUT")" "the 301 hop's header was classified"
t "redirect/heartbeat-final"    "$(b grep -q "deployed served=$GOOD http=200" "$STAMPF")" "$STAMPV"

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

# ── 18. the script's own header must not claim the exit code is the test ────────────────────────────────────────────
t "doc/says-rc-is-not-a-signal" "$(b grep -q 'does not report per-command failure' "$SCRIPT")"
t "doc/no-exit-code-enforced-claim" "$(b bash -c '! grep -q "exit code is tested" "$1"' _ "$SCRIPT")"

# ── 19. the stub password never appears anywhere this run wrote ─────────────────────────────────────────────────────
LEAK="$(grep -rl "$STUB_PW" "$WORK" 2>/dev/null | grep -v "^$STUB/" | head -3 | tr '\n' ' ')"
t "no-secret-in-any-output" "$(b test -z "$LEAK")" "found in: $LEAK"

# ── the harness guards itself: a run that stops early prints fewer cases than this ──────────────────────────────────
EXPECTED_CASES=95
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
