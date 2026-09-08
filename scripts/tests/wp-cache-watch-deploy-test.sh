#!/usr/bin/env bash
# Harness for scripts/wp-cache-watch-deploy.sh — stub sftp, curl, security, shasum and sleep on PATH, no host and no
# network. Run from anywhere:
#
#   bash scripts/tests/wp-cache-watch-deploy-test.sh
#
# It prints PASS/FAIL per case and exits non-zero if any case fails. What it is here to hold down, case by case: an
# sftp exit code is never ignored (a failed put must not go on to read a header a previous deploy left working); the
# version alone is not proof, the build fingerprint the plugin publishes has to match the file just sent; a missing
# header gets exactly one retry and then a non-zero exit; and --remove only says `removed` on a 2xx/3xx answer that
# lacks the header — curl failing or a 5xx is `unreachable`, not a removal.
#
# The stub Keychain password is a fixed string that must appear in no output, log or heartbeat this run; the last case
# greps every file the run produced for it.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
SCRIPT="$ROOT/scripts/wp-cache-watch-deploy.sh"
PLUGIN="$ROOT/wp-ops/atlas-cache-watch.php"
[ -f "$SCRIPT" ] || { echo "FAIL harness: no $SCRIPT"; exit 1; }
[ -f "$PLUGIN" ] || { echo "FAIL harness: no $PLUGIN"; exit 1; }

WORK="$(mktemp -d "${TMPDIR:-/tmp}/wp-watch-test.XXXXXX")"
trap 'rm -rf -- "$WORK"' EXIT
STUB="$WORK/bin"; mkdir -p "$STUB"
STUB_PW='atlas-test-stub-pw-do-not-log-4c7e'

VER="$(sed -n "s/.*ATLAS_CACHE_WATCH_VERSION', *'\([^']*\)'.*/\1/p" "$PLUGIN" | head -1)"
if command -v shasum >/dev/null 2>&1; then FP="$(shasum -a 1 "$PLUGIN" | awk '{print substr($1,1,8)}')"
else FP="$(sha1sum "$PLUGIN" | awk '{print substr($1,1,8)}')"; fi
GOOD="$VER;b=$FP;age=never;cdn=none;fp=1;tick=fresh"
OLDV="0.9.0;b=$FP;age=day;cdn=ok;fp=1;tick=hour"
OTHERB="$VER;b=00000000;age=day;cdn=ok;fp=1;tick=hour"

# ── stubs ───────────────────────────────────────────────────────────────────────────────────────────────────────────
cat > "$STUB/sftp" <<'EOS'
#!/usr/bin/env bash
n=$(( $(cat "$STUB_STATE/sftp.n" 2>/dev/null || echo 0) + 1 )); printf '%s\n' "$n" > "$STUB_STATE/sftp.n"
printf '%s\n' "$*" >> "$STUB_STATE/sftp.args"
cat >> "$STUB_STATE/sftp.stdin"
printf 'Connected to stub.\nsftp> \n'
exit "${STUB_SFTP_RC:-0}"
EOS
cat > "$STUB/curl" <<'EOS'
#!/usr/bin/env bash
n=$(( $(cat "$STUB_STATE/curl.n" 2>/dev/null || echo 0) + 1 )); printf '%s\n' "$n" > "$STUB_STATE/curl.n"
printf '%s\n' "$*" >> "$STUB_STATE/curl.args"
[ "${STUB_CURL_RC:-0}" != 0 ] && exit "${STUB_CURL_RC:-0}"
if [ "$n" = 1 ]; then code="${STUB_CODE:-200}"; hdr="${STUB_HDR:-}"; else code="${STUB_CODE2:-200}"; hdr="${STUB_HDR2:-}"; fi
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
reset_case() { C_SFTP_RC=0; C_CURL_RC=0; C_CODE=200; C_CODE2=200; C_HDR=""; C_HDR2=""; C_NO_KC=0; C_SRC="$PLUGIN"; }
calls() { cat "$STATE/$1.n" 2>/dev/null || printf 0; }
run_case() {
  CASE="$1"; shift
  STATE="$WORK/$CASE/state"; CHOME="$WORK/$CASE/home"; OUT="$WORK/$CASE/out"
  mkdir -p "$STATE" "$CHOME"
  PATH="$STUB:$PATH" HOME="$CHOME" STUB_STATE="$STATE" STUB_PW="$STUB_PW" \
    STUB_SFTP_RC="$C_SFTP_RC" STUB_CURL_RC="$C_CURL_RC" STUB_CODE="$C_CODE" STUB_CODE2="$C_CODE2" \
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

# ── 2. sftp failed, but the host still serves a perfect header ──────────────────────────────────────────────────────
reset_case; C_SFTP_RC=1; C_HDR="$GOOD"; C_HDR2="$GOOD"; run_case sftp-fail-good-header
t "sftp-fail/exit-non-zero"     "$(b test "$RC" -ne 0)" "exit $RC"
t "sftp-fail/heartbeat-upload-failed" "$(b grep -q 'upload-failed' "$STAMPF")" "$STAMPV"
t "sftp-fail/never-probed"      "$(eq "$(calls curl)" 0)" "curl calls $(calls curl)"
t "sftp-fail/no-deployed-claim" "$(b bash -c '! grep -q DEPLOYED-OBSERVED "$1"' _ "$OUT")"
t "sftp-fail/says-exit-code"    "$(b grep -q 'sftp exit 1' "$OUT")"

# ── 3. header absent → one retry → non-zero ─────────────────────────────────────────────────────────────────────────
reset_case; run_case header-absent
t "header-absent/exit-non-zero" "$(b test "$RC" -ne 0)" "exit $RC"
t "header-absent/retried-once"  "$(eq "$(calls curl)" 2)" "curl calls $(calls curl)"
t "header-absent/slept-once"    "$(eq "$(wc -l < "$STATE/sleep.args" 2>/dev/null || echo 0)" 1)"
t "header-absent/heartbeat"     "$(b grep -q 'header-absent served=none http=200' "$STAMPF")" "$STAMPV"
t "header-absent/not-confirmed" "$(b grep -q 'NOT confirmed running' "$OUT")"

# ── 4. version mismatch → retry → non-zero, served value recorded ───────────────────────────────────────────────────
reset_case; C_HDR="$OLDV"; C_HDR2="$OLDV"; run_case version-mismatch
t "version-mismatch/exit-non-zero" "$(b test "$RC" -ne 0)" "exit $RC"
t "version-mismatch/retried-once"  "$(eq "$(calls curl)" 2)" "curl calls $(calls curl)"
t "version-mismatch/heartbeat-served" "$(b grep -q "version-mismatch served=$OLDV" "$STAMPF")" "$STAMPV"
t "version-mismatch/names-both"    "$(b grep -q "older copy is still loaded" "$OUT")"

# ── 5. same version, different bytes (the pre-existing copy the version check used to accept) ───────────────────────
reset_case; C_HDR="$OTHERB"; C_HDR2="$OTHERB"; run_case fingerprint-mismatch
t "fingerprint-mismatch/exit-non-zero" "$(b test "$RC" -ne 0)" "exit $RC"
t "fingerprint-mismatch/retried-once"  "$(eq "$(calls curl)" 2)" "curl calls $(calls curl)"
t "fingerprint-mismatch/heartbeat"     "$(b grep -q "fingerprint-mismatch served=$OTHERB" "$STAMPF")" "$STAMPV"
t "fingerprint-mismatch/no-deployed-claim" "$(b bash -c '! grep -q DEPLOYED-OBSERVED "$1"' _ "$OUT")"

# ── 6. opcache: stale on the first read, correct on the retry ───────────────────────────────────────────────────────
reset_case; C_HDR="$OTHERB"; C_HDR2="$GOOD"; run_case retry-succeeds
t "retry-succeeds/exit-0"       "$(eq "$RC" 0)" "exit $RC"
t "retry-succeeds/two-probes"   "$(eq "$(calls curl)" 2)" "curl calls $(calls curl)"
t "retry-succeeds/deployed"     "$(b grep -q 'DEPLOYED-OBSERVED' "$OUT")"

# ── 6b. the header is proof even when the page itself is a 404, and its absence proves nothing when the site is down ─
reset_case; C_CODE=404; C_CODE2=404; C_HDR="$GOOD"; C_HDR2="$GOOD"; run_case deployed-on-404
t "deployed-on-404/exit-0"      "$(eq "$RC" 0)" "exit $RC"
t "deployed-on-404/deployed"    "$(b grep -q 'DEPLOYED-OBSERVED' "$OUT")"
reset_case; C_CURL_RC=7; run_case install-curl-fails
t "install-curl-fails/exit-non-zero" "$(b test "$RC" -ne 0)" "exit $RC"
t "install-curl-fails/says-unknown"  "$(b grep -q 'UNKNOWN' "$OUT")"
t "install-curl-fails/heartbeat"     "$(b grep -q 'unreachable' "$STAMPF")" "$STAMPV"
t "install-curl-fails/no-absent-claim" "$(b bash -c '! grep -q "plugin is not loading" "$1"' _ "$OUT")"

# ── 7. --remove, curl cannot reach the site ─────────────────────────────────────────────────────────────────────────
reset_case; C_CURL_RC=7; run_case remove-curl-fails --remove
t "remove-curl-fails/exit-non-zero" "$(b test "$RC" -ne 0)" "exit $RC"
t "remove-curl-fails/says-unknown"  "$(b grep -q 'UNKNOWN' "$OUT")"
t "remove-curl-fails/heartbeat"     "$(b grep -q 'unreachable' "$STAMPF")" "$STAMPV"
t "remove-curl-fails/no-removed-claim" "$(b bash -c '! grep -q "plugin is gone" "$1"' _ "$OUT")"
t "remove-curl-fails/batch-uses-rm"    "$(b grep -q '^rm "' "$STATE/sftp.stdin")" "$(cat "$STATE/sftp.stdin" 2>/dev/null | tr '\n' ' ')"
t "remove-curl-fails/rm-has-no-dash"   "$(b bash -c '! grep -q "^-rm " "$1"' _ "$STATE/sftp.stdin")"

# ── 8. --remove, the site answers 502 with no header ────────────────────────────────────────────────────────────────
reset_case; C_CODE=502; C_CODE2=502; run_case remove-http-502 --remove
t "remove-502/exit-non-zero"    "$(b test "$RC" -ne 0)" "exit $RC"
t "remove-502/not-removed"      "$(b grep -q 'unreachable' "$STAMPF")" "$STAMPV"

# ── 9. --remove, success ────────────────────────────────────────────────────────────────────────────────────────────
reset_case; run_case remove-ok --remove
t "remove-ok/exit-0"            "$(eq "$RC" 0)" "exit $RC"
t "remove-ok/heartbeat-removed" "$(b grep -q 'removed served=none http=200' "$STAMPF")" "$STAMPV"
t "remove-ok/loop-status"       "$(b grep -q 'removed from the host' "$OUT")"

# ── 10. --remove, the delete itself failed ──────────────────────────────────────────────────────────────────────────
reset_case; C_SFTP_RC=1; run_case remove-rm-fails --remove
t "remove-rm-fails/exit-non-zero" "$(b test "$RC" -ne 0)" "exit $RC"
t "remove-rm-fails/heartbeat"     "$(b grep -q 'rm-failed' "$STAMPF")" "$STAMPV"
t "remove-rm-fails/never-probed"  "$(eq "$(calls curl)" 0)" "curl calls $(calls curl)"

# ── 11. --remove, the header is still served ────────────────────────────────────────────────────────────────────────
reset_case; C_HDR="$GOOD"; C_HDR2="$GOOD"; run_case remove-still-present --remove
t "remove-still-present/exit-non-zero" "$(b test "$RC" -ne 0)" "exit $RC"
t "remove-still-present/retried"       "$(eq "$(calls curl)" 2)" "curl calls $(calls curl)"
t "remove-still-present/heartbeat"     "$(b grep -q 'still-present' "$STAMPF")" "$STAMPV"

# ── 12. preconditions: no Keychain item, and no source file ─────────────────────────────────────────────────────────
reset_case; C_NO_KC=1; run_case no-keychain
t "no-keychain/exit-non-zero"   "$(b test "$RC" -ne 0)" "exit $RC"
t "no-keychain/nothing-sent"    "$(eq "$(calls sftp)" 0)" "sftp calls $(calls sftp)"
reset_case; C_SRC="$WORK/does-not-exist.php"; run_case missing-source
t "missing-source/exit-non-zero" "$(b test "$RC" -ne 0)" "exit $RC"
t "missing-source/nothing-sent"  "$(eq "$(calls sftp)" 0)" "sftp calls $(calls sftp)"
t "missing-source/no-download"   "$(b grep -q 'never downloads one' "$OUT")"
t "missing-source/no-raw-url"    "$(b bash -c '! grep -q raw.githubusercontent "$1"' _ "$SCRIPT")"

# ── 13. the stub password never appears anywhere this run wrote ─────────────────────────────────────────────────────
LEAK="$(grep -rl "$STUB_PW" "$WORK" 2>/dev/null | grep -v "^$STUB/" | head -3 | tr '\n' ' ')"
t "no-secret-in-any-output" "$(b test -z "$LEAK")" "found in: $LEAK"

printf '\nwp-cache-watch-deploy: %s passed, %s failed\n' "$PASSN" "$FAILN"
[ "$FAILN" = 0 ]
