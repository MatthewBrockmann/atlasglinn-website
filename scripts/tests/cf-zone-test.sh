#!/usr/bin/env bash
# Harness for .github/workflows/cf-zone-atlasglinn.yml. It does not read the workflow and reason about it — it EXTRACTS
# the seven `run:` blocks with PyYAML and executes those exact bytes against scripts/tests/cf-zone-emu.py, a canned
# Cloudflare, with $CF_API_BASE pointed at it. Run from anywhere:
#
#   bash scripts/tests/cf-zone-test.sh
#
# It prints PASS/FAIL per case and exits non-zero if any case fails, if the run produced fewer cases than the count
# pinned at the bottom, or if it dies before printing its summary — a harness that stops early used to look green.
#
# WHY IT EXISTS. The first draft of that workflow had two false-success paths that read as correct: an import still
# growing at the 90 s deadline, and a missing `www`, each printed a caution and then printed "Import verified" and the
# two nameservers to paste at GoDaddy. Nothing catches that by reading — the caution is right there in the log looking
# like it did something. Both are cases below, and both must FAIL.
#
# It also holds down the privacy rule that decides whether this workflow is safe to run at all: the repository is
# PUBLIC (measured 2026-09-09: the GitHub API answers "private": false) and an Actions log on a public repo is
# world-readable, so a DNS record's content must never be printed. Every record the emulator serves carries a canary
# value; the last case greps every byte the whole run produced — logs, step summaries AND step outputs — for all of
# them, across every case, failing ones included, and it fails if a case ran that the sweep did not reach.
#
# THE SWEEP USED TO BE BLIND TO ONE CHANNEL. It only ever saw values the emulator served as record CONTENT, and every
# error body it returned carried fixed text — so it could not tell an enforced "no value in an error" rule from an
# unenforced one, and the workflow echoed Cloudflare's errors[].message verbatim at three places. The emulator now
# serves a canary INSIDE errors[].message in err_leak_token / err_leak_create / err_leak_tak, each of which drives one
# of those three points on a FAILING path, so the sweep covers the error limb of the claim and not only the table.
#
# The step gating is emulated, not guessed: the harness reads each step's `if:` out of the YAML and refuses to run if
# it meets a condition it does not know how to evaluate, so re-wiring a gate in the workflow cannot silently leave a
# step running here that Actions would skip.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
WF="$ROOT/.github/workflows/cf-zone-atlasglinn.yml"
EMU="$HERE/cf-zone-emu.py"
[ -f "$WF" ]  || { echo "FAIL harness: no $WF"; exit 1; }
[ -f "$EMU" ] || { echo "FAIL harness: no $EMU"; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "FAIL harness: curl is not on PATH — the workflow's own steps need it"; exit 1; }
python3 -c 'import yaml' 2>/dev/null || { echo "FAIL harness: PyYAML is not installed (pip install pyyaml)"; exit 1; }

WORK="$(mktemp -d "${TMPDIR:-/tmp}/cf-zone-test.XXXXXX")"
EMU_PID=""
DONE=0
trap 'rc=$?; [ -n "$EMU_PID" ] && kill "$EMU_PID" 2>/dev/null; rm -rf -- "$WORK"; if [ "$DONE" != 1 ]; then printf "\nFAIL harness: died before its summary (exit %s) — the count below is not the whole run\n" "$rc"; exit 1; fi' EXIT

PASS=0; FAIL=0; CASES=0
ok()   { PASS=$((PASS+1)); CASES=$((CASES+1)); echo "PASS $*"; }
bad()  { FAIL=$((FAIL+1)); CASES=$((CASES+1)); echo "FAIL $*"; }

# ── extract the run blocks ──────────────────────────────────────────────────────────────────────────────────────────
STEPS="$WORK/steps"; mkdir -p "$STEPS"
python3 - "$WF" "$STEPS" <<'PY'
import sys, yaml, os
wf, out = sys.argv[1], sys.argv[2]
d = yaml.safe_load(open(wf, encoding='utf-8'))
steps = d['jobs']['zone']['steps']
man = []
for i, st in enumerate(steps):
    open(os.path.join(out, 'step%d.sh' % i), 'w', encoding='utf-8').write(st['run'])
    man.append('%d\t%s\t%s' % (i, st.get('id', ''), st.get('if', '')))
open(os.path.join(out, 'manifest.tsv'), 'w', encoding='utf-8').write('\n'.join(man) + '\n')
print('extracted %d run blocks' % len(steps))
PY
[ -f "$STEPS/manifest.tsv" ] || { echo "FAIL harness: extraction produced no manifest"; exit 1; }
NSTEPS=$(wc -l < "$STEPS/manifest.tsv" | tr -d ' ')

# every extracted block must be syntactically valid bash, checked here as well as in CI
for i in $(seq 0 $((NSTEPS-1))); do
  if bash -n "$STEPS/step$i.sh" 2>"$WORK/syn.$i"; then ok "bash -n step$i"; else bad "bash -n step$i: $(cat "$WORK/syn.$i")"; fi
done

# ── source-level invariants ─────────────────────────────────────────────────────────────────────────────────────────
if grep -q '::warning::' "$WF"; then
  bad "source/no-warnings: a ::warning:: is back in the workflow — every risk in this file is fatal by design"
else
  ok "source/no-warnings: no ::warning:: anywhere (each risk exits 1 instead)"
fi
# every live use must come through the CF_API_BASE default; a bare hardcoded URL is untestable. This assertion used to
# sit INSIDE an `if` that only two prose comment lines satisfied — reword those comments and it emitted no verdict at
# all and vanished. It is unconditional now: it always says PASS or FAIL.
if grep -q 'API="\${CF_API_BASE:-https://api.cloudflare.com/client/v4}"' "$WF"; then
  HARD=$(grep -c 'curl .*https://api\.cloudflare\.com' "$WF" || true)
  if [ "$HARD" = "0" ]; then ok "source/api-base: every call goes through \$CF_API_BASE"; else bad "source/api-base: $HARD curl(s) still hardcode api.cloudflare.com"; fi
else
  bad "source/api-base: no CF_API_BASE default found"
fi
# the vendor's own error TEXT is never echoed — only its numeric codes. A `.get('message'` back in this file is the
# regression that would put "an identical record already exists: A tak.<dom> -> <address>" into a public log.
VMSG=$(grep -c "get('message'" "$WF" || true)
if [ "$VMSG" = "0" ]; then
  ok "source/no-vendor-text: no Cloudflare errors[].message string is echoed anywhere in the workflow"
else
  bad "source/no-vendor-text: $VMSG place(s) read errors[].message — vendor text can quote a record and this log is public"
fi
# the tak classifier speaks in codes that a crash cannot forge: an uncaught exception exits 1, and 1 must not mean
# "already the expected address". Non-default codes plus a catch-all fatal are what make that true.
if grep -q 'sys.exit(10 if not a else (11 if len(ok) == len(a) else 12))' "$WF" && grep -q 'takstate" != "10"' "$WF"; then
  ok "source/tak-codes: the tak classifier uses non-default exit codes and anything unexpected is fatal"
else
  bad "source/tak-codes: the tak classifier is back on 0/1/2, or lost its catch-all — a crash would read as 'already correct'"
fi
# both website names are typed. `www` matching on name alone is the round-2 P1: a TXT satisfied it.
if grep -q "www_any = \[r for r in recs if r.get('name') == 'www.' + dom\]" "$WF" && \
   grep -q "www = \[r for r in www_any if r.get('type') in WEB_TYPES\]" "$WF"; then
  ok "source/www-typed: the www gate filters on A/AAAA/CNAME, not on the name alone"
else
  bad "source/www-typed: the www gate no longer filters by record type — a TXT-only www would pass it"
fi
if grep -qE '^\s*\[ -[nz] .*\] &&' "$WF"; then
  bad "source/no-and-lists: a '[ -n x ] && ...' AND-list is back — set -e does not fail on the left of &&"
else
  ok "source/no-and-lists: no bare test-AND-list under set -e"
fi

# ── the emulator ────────────────────────────────────────────────────────────────────────────────────────────────────
python3 "$EMU" 0 > "$WORK/emu.out" 2>"$WORK/emu.err" &
EMU_PID=$!
PORT=""
for _ in $(seq 1 50); do
  PORT="$(sed -n 's/^listening \([0-9]*\)$/\1/p' "$WORK/emu.out" | head -1)"
  [ -n "$PORT" ] && break
  sleep 0.1
done
[ -n "$PORT" ] || { echo "FAIL harness: the emulator never printed a port: $(cat "$WORK/emu.err")"; exit 1; }
ok "emulator listening on 127.0.0.1:$PORT"

# ── the job runner: step order, step gating, first-failure stop ──────────────────────────────────────────────────────
cond_ok() {   # $1 = the step's `if:` expression, verbatim out of the YAML
  case "$1" in
    "") return 0 ;;
    "steps.zone.outputs.proceed == 'true'")
        [ "$(last_out proceed)" = "true" ] ;;
    "steps.zone.outputs.proceed == 'true' && inputs.mode == 'create' && inputs.add_missing")
        [ "$(last_out proceed)" = "true" ] && [ "$MODE" = "create" ] && [ "$ADD_MISSING" = "true" ] ;;
    "steps.assert.outputs.verified == 'true'")
        [ "$(last_out verified)" = "true" ] ;;
    *)  echo "FAIL harness: unknown step condition in the workflow: [$1] — teach cond_ok about it before trusting this run"; exit 1 ;;
  esac
}
last_out() { sed -n "s/^$1=//p" "$CASE/gh_output" 2>/dev/null | tail -1; }

RUNS=""      # every case name run_job has driven; the privacy sweep asserts it reached all of them
run_job() {   # $1 = case name, $2 = emulator scenario. Reads MODE/ADD_MISSING/ALLOW_OTHER_MX/DOMAIN/TOKENS from env.
  CASE="$WORK/$1"; SCN="$2"
  RUNS="$RUNS $1"
  mkdir -p "$CASE/state"
  : > "$CASE/out"; : > "$CASE/gh_output"; : > "$CASE/summary"
  JOB_RC=0; TRACE=""
  local i cond rc
  for i in $(seq 0 $((NSTEPS-1))); do
    cond="$(awk -F'\t' -v n="$i" '$1==n{print $3}' "$STEPS/manifest.tsv")"
    if ! cond_ok "$cond"; then TRACE="$TRACE ${i}:skip"; continue; fi
    env -i PATH="$PATH" HOME="$HOME" LANG=C \
      CF_API_BASE="http://127.0.0.1:$PORT/$SCN/client/v4" \
      CF_STATE_DIR="$CASE/state" \
      CF_IMPORT_DEADLINE_S=3 CF_POLL_SLEEP_S=1 \
      GITHUB_OUTPUT="$CASE/gh_output" GITHUB_STEP_SUMMARY="$CASE/summary" \
      Z1="${Z1-}" T1="${T1-}" T2="${T2-}" T3="${T3-}" A1="${A1-}" A2="" A3="" \
      CF_TOKEN="${Z1:-${T1-}}" CF_ACCOUNT="${A1-}" \
      DOMAIN="$DOMAIN" MODE="$MODE" ADD_MISSING="$ADD_MISSING" ALLOW_OTHER_MX="$ALLOW_OTHER_MX" \
      bash "$STEPS/step$i.sh" >>"$CASE/out" 2>&1
    rc=$?
    TRACE="$TRACE ${i}:rc$rc"
    if [ "$rc" != "0" ]; then JOB_RC=1; break; fi
  done
}

# defaults every case starts from
reset_inputs() { Z1="stub-zone-token-not-a-real-credential"; T1=""; T2=""; T3=""; A1="stub-account-id"; \
                 DOMAIN="atlasglinn.com"; MODE="plan"; ADD_MISSING="false"; ALLOW_OTHER_MX="false"; }

has()  { grep -Fq "$2" "$WORK/$1/out" || grep -Fq "$2" "$WORK/$1/summary"; }
stats() { curl -sS -m 10 "http://127.0.0.1:$PORT/$1/client/v4/_stats"; }
statn() { stats "$1" | python3 -c "import json,sys;print(json.load(sys.stdin).get('$2'))"; }

expect() {   # $1 case, $2 expected job verdict (pass|fail), $3.. = descriptions
  local c="$1" want="$2"; shift 2
  local got=pass; [ "$JOB_RC" = "0" ] || got=fail
  if [ "$got" = "$want" ]; then ok "$c: job $got as expected  [$TRACE]"
  else bad "$c: job $got, expected $want  [$TRACE]  --- log: $(tr '\n' '|' < "$WORK/$c/out" | tail -c 700)"; fi
}
must()    { if has "$1" "$2"; then ok "$1: says \"$2\""; else bad "$1: never said \"$2\"  --- log: $(tr '\n' '|' < "$WORK/$1/out" | tail -c 700)"; fi; }
mustnot() { if has "$1" "$2"; then bad "$1: PRINTED \"$2\" — false success"; else ok "$1: never printed \"$2\""; fi; }
eqn()     { if [ "$2" = "$3" ]; then ok "$1 ($2)"; else bad "$1: got $2, expected $3"; fi; }

NS_BLOCK="Paste these two nameservers at GoDaddy:"
VERIFIED="### Import verified"

# ── 1. no token at all ──────────────────────────────────────────────────────────────────────────────────────────────
reset_inputs; Z1=""; T1=""; A1=""
run_job no_token create_ok
expect no_token fail
must   no_token "No Cloudflare token reached this job"
mustnot no_token "$NS_BLOCK"

# ── 2. the Workers token this repo already holds: alive, 403 on zones ───────────────────────────────────────────────
reset_inputs; Z1=""; T1="stub-workers-token-not-a-real-credential"
run_job workers_scoped workers_scoped
expect workers_scoped fail
must   workers_scoped "Workers-scoped"
must   workers_scoped "falling back to the Workers token"
mustnot workers_scoped "$NS_BLOCK"

# ── 3. dead / revoked token ─────────────────────────────────────────────────────────────────────────────────────────
reset_inputs
run_job dead_token dead_token
expect dead_token fail
must   dead_token "The Cloudflare token was rejected"

# ── 4. account-owned token: verify 400 but zones 200 — must NOT be rejected ─────────────────────────────────────────
reset_inputs
run_job account_owned account_owned
expect account_owned pass
must   account_owned "not fatal"

# ── 5. the zone already exists, plan mode: full checks, and NO nameservers (plan never prints them) ─────────────────
reset_inputs
run_job zone_exists zone_exists
expect zone_exists pass
must   zone_exists "$VERIFIED"
must   zone_exists "reusing it, nothing is created"
mustnot zone_exists "$NS_BLOCK"

# ── 6. create, complete import: the one path that prints nameservers ────────────────────────────────────────────────
reset_inputs; MODE=create
run_job create_ok create_ok
expect create_ok pass
must   create_ok "zone created"
must   create_ok "$VERIFIED"
must   create_ok "$NS_BLOCK"
must   create_ok "amber.ns.cloudflare.com"
must   create_ok "delete the Cloudflare token"
eqn    "create_ok: exactly one POST /zones" "$(statn create_ok post_zones)" 1
if stats create_ok | grep -q '\\"jump_start\\": true' || stats create_ok | grep -q 'jump_start.*true'; then
  ok "create_ok: the create body asked for jump_start"
else bad "create_ok: the create body did not carry jump_start"; fi

# ── 7. the import is still growing at the deadline — the first false success ────────────────────────────────────────
reset_inputs; MODE=create
run_job growing growing
expect growing fail
must   growing "still moving"
mustnot growing "$VERIFIED"
mustnot growing "$NS_BLOCK"

# ── 8. no www — the second false success ────────────────────────────────────────────────────────────────────────────
reset_inputs; MODE=create
run_job no_www no_www
expect no_www fail
must   no_www "www.atlasglinn.com has no record"
mustnot no_www "$VERIFIED"
mustnot no_www "$NS_BLOCK"

# ── 8b. a www record EXISTS and it is a TXT: it cannot serve a website, so it must fail like an absent one ──────────
# The gate asked "is there a record called www". A TXT answered yes, the run printed the nameservers, and www would
# have stopped resolving on the switch — one record type away from case 8, and no case reached it.
reset_inputs; MODE=create
run_job www_txt_only www_txt_only
expect www_txt_only fail
must   www_txt_only "a TXT at www is a record and it is not a website"
mustnot www_txt_only "$VERIFIED"
mustnot www_txt_only "$NS_BLOCK"

# ── 8c. the same shape at the apex: TXT and MX at the apex, no address record ───────────────────────────────────────
reset_inputs; MODE=create
run_job apex_txt_only apex_txt_only
expect apex_txt_only fail
must   apex_txt_only "a TXT or an MX at the apex is a record and it is not a website"
mustnot apex_txt_only "$VERIFIED"
mustnot apex_txt_only "$NS_BLOCK"

# ── 9. MX present but not Microsoft 365, without the input ──────────────────────────────────────────────────────────
reset_inputs; MODE=create
run_job mx_other mx_other
expect mx_other fail
must   mx_other "none of them target Microsoft 365"
mustnot mx_other "$NS_BLOCK"

# ── 10. the same import, accepted on purpose with allow_other_mx = true ─────────────────────────────────────────────
reset_inputs; MODE=create; ALLOW_OTHER_MX=true
run_job mx_other_allowed mx_other
expect mx_other_allowed pass
must   mx_other_allowed "other route, accepted by input"
must   mx_other_allowed "$NS_BLOCK"
must   mx_other_allowed "they do NOT target Microsoft 365"

# ── 10b. ONE M365 MX beside one stale registrar MX — the realistic GoDaddy leftover. ANY is not ALL: this cleared the
# gate and then printed "the apex MX records were confirmed present AND targeting Microsoft 365", plural and false for
# one of the two. It must fail without the input.
reset_inputs; MODE=create
run_job mx_mixed mx_mixed
expect mx_mixed fail
must   mx_mixed "1 of the 2 apex MX records"
must   mx_mixed "and 1 do not"
mustnot mx_mixed "$VERIFIED"
mustnot mx_mixed "$NS_BLOCK"

# ── 10c. the same mixed set, accepted on purpose — and the closing sentence must name the count it measured ─────────
reset_inputs; MODE=create; ALLOW_OTHER_MX=true
run_job mx_mixed_allowed mx_mixed
expect mx_mixed_allowed pass
must   mx_mixed_allowed "$NS_BLOCK"
must   mx_mixed_allowed "1 of the 2 apex MX records target Microsoft 365 and 1 do NOT"
must   mx_mixed_allowed "M365 on 1 of 2 rows, the other 1 accepted by input"
mustnot mx_mixed_allowed "Mail keeps flowing throughout"

# ── 11. a tak A record pointing somewhere else: never post a second one ─────────────────────────────────────────────
reset_inputs; MODE=create; ADD_MISSING=true
run_job tak_mismatch tak_mismatch
expect tak_mismatch fail
must   tak_mismatch "DIFFERENT address"
mustnot tak_mismatch "$NS_BLOCK"
eqn    "tak_mismatch: no DNS record was posted" "$(statn tak_mismatch post_records)" 0

# ── 12. tak missing + add_missing: creates it exactly once ──────────────────────────────────────────────────────────
reset_inputs; MODE=create; ADD_MISSING=true
run_job tak_missing tak_missing
expect tak_missing pass
must   tak_missing "added by this run"
must   tak_missing "$NS_BLOCK"
eqn    "tak_missing: exactly one POST dns_records" "$(statn tak_missing post_records)" 1

# ── 13. tak missing and add_missing NOT ticked: fails, adds nothing ─────────────────────────────────────────────────
reset_inputs; MODE=create
run_job tak_absent tak_absent
expect tak_absent fail
must   tak_absent "has no A record"
mustnot tak_absent "$NS_BLOCK"

# ── 14. the by-name lookup answers 500 in plan mode ─────────────────────────────────────────────────────────────────
reset_inputs
run_job byname_500 byname_500
expect byname_500 fail
must   byname_500 "answered HTTP 500"
mustnot byname_500 "is **not** in this Cloudflare account yet"

# ── 15. a domain input carrying a workflow-command injection ────────────────────────────────────────────────────────
reset_inputs
DOMAIN="$(printf 'evil-canary.example\n::stop-commands::abcd')"
run_job domain_injection injection
expect domain_injection fail
must   domain_injection "not a plain domain name"
mustnot domain_injection "stop-commands"
mustnot domain_injection "evil-canary.example"
# the two token probes in step 1 legitimately run before the domain is ever read; what must never happen is a request
# CARRYING the input — no lookup by name, no create.
eqn    "domain_injection: nothing was created" "$(statn injection post_zones)" 0
mustnot domain_injection "GET /zones?name"
eqn    "domain_injection: only the two token probes reached the API" "$(statn injection reqs)" 2

# ── 16. a truncated read of the record set ──────────────────────────────────────────────────────────────────────────
reset_inputs; MODE=create
run_job truncated truncated
expect truncated fail
must   truncated "running against a slice of the import"
mustnot truncated "$NS_BLOCK"

# ── 17. every check passed but Cloudflare has assigned no nameservers yet ───────────────────────────────────────────
reset_inputs; MODE=create
run_job no_nameservers no_nameservers
expect no_nameservers fail
must   no_nameservers "has not assigned nameservers"
mustnot no_nameservers "$NS_BLOCK"

# ── 18. the create is refused because the zone already exists (Cloudflare 1061): reuse it, create nothing twice ─────
# The emulator has shipped this scenario since round 2 and no case drove it, so the workflow's most tangled branch —
# create fails, look up by name, reuse or report — was outside the CI gate that "all green" was speaking for.
reset_inputs; MODE=create
run_job create_refused create_refused
expect create_refused pass
must   create_refused "reusing it"
must   create_refused "$NS_BLOCK"
eqn    "create_refused: exactly one POST /zones" "$(statn create_refused post_zones)" 1

# ── 19. Cloudflare assigned ONE nameserver: the GoDaddy form takes a pair, so print nothing ─────────────────────────
reset_inputs; MODE=create
run_job ns_single ns_single
expect ns_single fail
must   ns_single "the GoDaddy form takes exactly two"
mustnot ns_single "$NS_BLOCK"
mustnot ns_single "solo.ns.cloudflare.com"

# ── 20-22. the three vendor-error-text paths, each on a FAILING run. Cloudflare's message quotes a record here; the
# workflow must print its numeric code and nothing else. The canary sweep at the end is what actually catches a leak —
# these cases exist to DRIVE those three paths so the sweep has something to look at.
reset_inputs
run_job err_leak_token err_leak_token
expect err_leak_token fail
must   err_leak_token "code(s) 6003"
must   err_leak_token "deliberately not echoed"

reset_inputs; MODE=create
run_job err_leak_create err_leak_create
expect err_leak_create fail
must   err_leak_create "code(s) 1109"
must   err_leak_create "message text is not echoed"

reset_inputs; MODE=create; ADD_MISSING=true
run_job err_leak_tak err_leak_tak
expect err_leak_tak fail
must   err_leak_tak "code(s) 81057"
must   err_leak_tak "message text is not echoed"
mustnot err_leak_tak "$NS_BLOCK"

# ── 23. THE PRIVACY GATE: no record content in any byte this run produced ───────────────────────────────────────────
# Every value the emulator serves is a canary. This log is public on this repo, and a record's content is the origin
# address the WAF rule exists to hide.
# The sweep is built from the list of cases run_job actually drove, not from a glob, and it asserts that the list and
# the directories on disk are the same set — so a case cannot run and quietly sit outside the privacy gate. Failing
# cases are in it by construction: err_leak_* and the txt-only and mixed-MX cases all exit non-zero.
SWEPT=""
for c in $RUNS; do
  for f in out summary gh_output; do
    [ -f "$WORK/$c/$f" ] && SWEPT="$SWEPT $WORK/$c/$f"
  done
done
NRUNS=$(printf '%s\n' $RUNS | wc -l | tr -d ' ')
NDIRS=$(find "$WORK" -mindepth 1 -maxdepth 1 -type d ! -name steps | wc -l | tr -d ' ')
eqn "privacy: the sweep covers every case that ran" "$NRUNS" "$NDIRS"

LEAK=0
for canary in 203.0.113.77 origin-canary.example.net atlas-canary.mail.protection.outlook.com \
              mx-canary.secureserver-example.net 'v=spf1' autodiscover-canary.outlook.com 198.51.100.9 \
              canary-filler- www-txt-canary-verification-string apex-txt-canary-verification-string \
              origin-canary-in-error.example.net; do
  hits="$(grep -lF -- "$canary" $SWEPT 2>/dev/null | tr '\n' ' ')"
  if [ -n "$hits" ]; then bad "privacy: record content \"$canary\" reached the log in: $hits"; LEAK=1; fi
done
[ "$LEAK" = "0" ] && ok "privacy: no record content in any log, step summary or step output across every case, failing ones included"

# the tak address is the one address this workflow is allowed to name — it is a constant in the file, public DNS
# today, and never a value read back from the API. Assert it as an expectation, not a leak.
if grep -qF -- '142.93.177.0' $SWEPT 2>/dev/null; then
  bad "privacy: 142.93.177.0 was printed — it is public DNS, but this workflow prints no addresses at all"
else
  ok "privacy: even the expected tak address is not printed"
fi

echo
echo "cases: $CASES   passed: $PASS   failed: $FAIL"
# Pinned to the EXACT count this file produces, not to a floor with slack in it. At MIN=60 against 78 actual
# assertions, eighteen could be deleted or stop running and the harness still printed "all green".
MIN=118
if [ "$CASES" -lt "$MIN" ]; then
  echo "FAIL harness: only $CASES cases ran, fewer than the $MIN pinned here — the run stopped early or a block was dropped"
  DONE=1; exit 1
fi
DONE=1
[ "$FAIL" = "0" ] || exit 1
echo "cf-zone: all green"
