#!/usr/bin/env bash
# Harness for .github/workflows/cf-zone-atlasglinn.yml. It does not read the workflow and reason about it — it EXTRACTS
# the ten `run:` blocks with PyYAML — and the one `uses:` step it deliberately does not run — and executes those exact bytes against scripts/tests/cf-zone-emu.py, a canned
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

# ── harness-owned files, all under $WORK/_h so the privacy sweep's directory count stays a count of CASES ──────────
# import mode reads the domain's records with dig, so the harness owns a dig: a wrapper on PATH ahead of everything
# else, pointing at cf-zone-dig-stub.py, which answers only from the emulator and never reaches the network. The
# workflow's `command -v dig` limb therefore finds it and never reaches apt-get.
STUB="$HERE/cf-zone-dig-stub.py"
[ -f "$STUB" ] || { echo "FAIL harness: no $STUB"; exit 1; }
mkdir -p "$WORK/_h/bin" "$WORK/_h/fakerepo/wp-ops"
printf '#!/bin/sh\nexec python3 "%s" "$@"\n' "$STUB" > "$WORK/_h/bin/dig"
chmod 755 "$WORK/_h/bin/dig"
# a fake repository for the candidate-list grep: one hostname under the domain that no fixed list holds, and one
# hostname that is NOT under the domain and must never be queried
printf '%s\n' '<a href="https://zzcanaryhost.atlasglinn.com/x">x</a> and <a href="https://www.example.org/y">y</a>' \
  > "$WORK/_h/fakerepo/wp-ops/page.html"
# a second fake repository whose one hostname sits BELOW a label — node.services.atlasglinn.com. It reveals the
# `services.atlasglinn.com` suffix to the sweep's nested-wildcard discovery, which is the only way a wildcard at
# *.services.atlasglinn.com can be reached by a candidate-list run (P1-3).
mkdir -p "$WORK/_h/nestedrepo/wp-ops"
printf '%s\n' '<a href="https://node.services.atlasglinn.com/x">x</a>' \
  > "$WORK/_h/nestedrepo/wp-ops/nested.html"

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
    # FAIL CLOSED on a step this harness cannot execute. `st['run']` used to be unconditional, so adding any `uses:`
    # step killed the extractor with a KeyError before the summary — loudly, but with no verdict about the step.
    if 'run' in st:
        kind, body = 'run', st['run']
    elif 'uses' in st:
        kind, body = 'uses:' + st['uses'], ''
    else:
        raise SystemExit('step %d has neither run: nor uses: — teach the harness about it' % i)
    open(os.path.join(out, 'step%d.sh' % i), 'w', encoding='utf-8').write(body)
    man.append('%d\t%s\t%s\t%s' % (i, st.get('id', ''), st.get('if', ''), kind))
open(os.path.join(out, 'manifest.tsv'), 'w', encoding='utf-8').write('\n'.join(man) + '\n')
# yaml.safe_load parses the `on:` key as the Python bool True (measured: the top keys are
# ['name', True, 'permissions', 'concurrency', 'jobs']), so it is read under both spellings.
on = d.get('on', d.get(True)) or {}
open(os.path.join(out, 'modes.txt'), 'w', encoding='utf-8').write(
    ' '.join(on['workflow_dispatch']['inputs']['mode']['options']) + '\n')
print('extracted %d step(s)' % len(steps))
PY
[ -f "$STEPS/manifest.tsv" ] || { echo "FAIL harness: extraction produced no manifest"; exit 1; }
NSTEPS=$(wc -l < "$STEPS/manifest.tsv" | tr -d ' ')

# every extracted block must be syntactically valid bash, checked here as well as in CI
step_kind() { awk -F'\t' -v n="$1" '$1==n{print $4}' "$STEPS/manifest.tsv"; }
for i in $(seq 0 $((NSTEPS-1))); do
  # an empty file passes `bash -n`, so a uses: step would print a meaningless PASS
  case "$(step_kind "$i")" in uses:*) continue ;; esac
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
# the three modes, read out of the dispatch input rather than out of prose
MODES="$(tr -d '\n' < "$STEPS/modes.txt")"
if [ "$MODES" = "plan create import" ]; then
  ok "source/modes: the dispatch offers exactly plan, create and import"
else
  bad "source/modes: the mode input offers [$MODES], not [plan create import]"
fi
# the ONE step this harness does not execute, and the condition it is allowed to carry. Anything else entering the
# file unexecuted by this harness is a step CI would run and nothing here has ever proved.
USES="$(awk -F'\t' '$4 ~ /^uses:/ {printf "%s@@%s;", $4, $3}' "$STEPS/manifest.tsv")"
if [ "$USES" = "uses:actions/checkout@v4@@inputs.mode == 'import';" ]; then
  ok "source/uses-allowlist: the only non-run step is the import-gated checkout"
else
  bad "source/uses-allowlist: the non-run steps are [$USES] — expected only the import-gated actions/checkout@v4"
fi
# NEVER DELETES, NEVER UPDATES. The emulator counts DELETE and PUT as well, so this is belt and braces on the one
# guarantee that makes running import against a live zone recoverable.
DESTR=$(grep -cE -- '-X (DELETE|PUT|PATCH)' "$WF" || true)
if [ "$DESTR" = "0" ]; then
  ok "source/no-destructive: no -X DELETE / PUT / PATCH anywhere in the workflow"
else
  bad "source/no-destructive: $DESTR destructive method(s) in the workflow — import must only ever add"
fi
# both write paths are unproxied: the multipart import, and the one-at-a-time reconcile body. A proxied import would
# change how the site is served the moment the nameservers move, which is the one thing this run promises not to do.
if grep -qF -- '-F "proxied=false"' "$WF" && grep -qF "'proxied': False" "$WF"; then
  ok "source/import-unproxied: the zone-file import and the reconcile POST are both unproxied"
else
  bad "source/import-unproxied: a write path lost its unproxied flag — the switch would change how the site is served"
fi
# import is gated by the SAME assertions as create, and prints nameservers on the same output. If either of these
# reverts to create-only, every import case degrades silently: the gate still runs, the paste block never appears.
if grep -qF "mode in ('create', 'import')" "$WF" && grep -qF "mode not in ('create', 'import')" "$WF"; then
  ok "source/verified-modes: import reaches the verified output and the plan sentence excludes it"
else
  bad "source/verified-modes: the assert step is back on create-only — import can never print nameservers"
fi
# a published DS at the parent plus a nameserver move takes the domain dark until it expires out, and Cloudflare
# cannot fix that from its side. The verdict must exit, in its own step, not print and continue.
# a recursor answers from a cache; the whole point of import mode is to copy what the parent serves RIGHT NOW. The
# workflow's header has claimed +norecurse since round 1 and no assertion could detect its removal — the emulator now
# counts an authoritative query that arrives without it, and case 24 pins that count at zero. This is the source half.
if grep -qF "if norec:" "$WF" && grep -qF "a.append('+norecurse')" "$WF" && \
   grep -qF "st, ans = dig(s, name, qtype, True)" "$WF"; then
  ok "source/norecurse: every authoritative query carries +norecurse"
else
  bad "source/norecurse: the sweep no longer asks the authoritative servers with +norecurse — it would read a cache"
fi
# THE dig INSTALL IS STRUCTURALLY UNREACHABLE FROM HERE — the harness puts its own dig on PATH, so `command -v dig`
# always succeeds and no case has ever executed the apt-get limb or its failure. That is exactly why it needs a
# source-level pin: it lived in the sweep until the DS step moved ahead of it, which left the first dig of the run
# upstream of the only apt-get in the job, and an apt-get that FAILS silently leaves every probe unanswered and the
# run refusing with a partial-sweep sentence that names the wrong cause.
DIGF="$(grep -lF 'dig is not on this runner' "$STEPS"/step*.sh 2>/dev/null | head -1)"
if [ -n "$DIGF" ] && [ "$DIGF" = "$(grep -lF 'DNSSEC is ON at GoDaddy' "$STEPS"/step*.sh 2>/dev/null | head -1)" ] \
   && grep -qF 'exit 1; }' "$DIGF"; then
  ok "source/dig-fatal: dig is installed in the first step that queries DNS, and its absence is fatal there"
else
  bad "source/dig-fatal: the dig install is not in the DS step, or its absence is no longer fatal — a runner without dig would refuse 75 probes instead of naming the cause"
fi
DSF="$(grep -lF 'DNSSEC is ON at GoDaddy' "$STEPS"/step*.sh 2>/dev/null | head -1)"
if [ -n "$DSF" ] && grep -qF 'sys.exit(1)' "$DSF"; then
  ok "source/ds-fatal: a DS at the parent is fatal in the step that measures it"
else
  bad "source/ds-fatal: the DNSSEC verdict is missing or no longer exits — a signed domain would be handed nameservers"
fi
# the DS gate guards every mode that can PRINT a nameserver, not only import. Read out of the manifest rather than
# by grepping the file, so a condition reworded anywhere else cannot satisfy it.
DSN="${DSF##*/step}"; DSN="${DSN%.sh}"
DSCOND="$(awk -F'\t' -v n="$DSN" '$1==n{print $3}' "$STEPS/manifest.tsv")"
if [ "$DSCOND" = "steps.zone.outputs.proceed == 'true' && inputs.mode != 'plan'" ]; then
  ok "source/ds-gate-modes: the DS measurement runs before every mode that can print nameservers"
else
  bad "source/ds-gate-modes: the DS step is gated on [$DSCOND] — create can reach the paste block, so an import-only DS gate hands nameservers for a signed domain"
fi
# THE THREE COUNTS. recs_added and total_records_parsed exist because they can differ, and sweep_count was written
# by the sweep and read by nobody. All three have to be equal before the run continues.
if grep -qF 'if not (added == parsed == swept):' "$WF" && grep -qF "swept = int(open(S + '/sweep_count').read().strip())" "$WF"; then
  ok "source/import-counts: the import step compares swept, parsed and added, and they must all agree"
else
  bad "source/import-counts: the zone-file import no longer compares its three counts — a 200 that skipped rows would pass"
fi
# the TTL is clamped at BOTH ends. Cloudflare's non-Enterprise maximum is 86400 and GoDaddy's UI offers 604800, so
# an unclamped TTL is the likeliest way the importer answers 200 and drops the row.
if grep -qF 'keep[(o, ty, rd)] = min(86400, max(300, ttl))' "$WF"; then
  ok "source/ttl-clamp: swept TTLs are clamped to 300..86400 before the zone file is written"
else
  bad "source/ttl-clamp: the TTL ceiling is gone — a 604800 TTL from GoDaddy's UI would be written verbatim"
fi
# both truncated-read guards fail CLOSED on a size they cannot measure. `isinstance(total, int) and total > ...`
# fell through to "carry on" when result_info was absent — once on the step that writes, once on the step every
# assertion reads from.
NOTINT=$(grep -c 'if not isinstance(total, int):' "$WF" || true)
if [ "$NOTINT" = "2" ]; then
  ok "source/total-count-fatal: both record reads treat an unmeasurable zone size as fatal"
else
  bad "source/total-count-fatal: $NOTINT of the 2 record reads fail closed on a missing total_count — the others read 'could not measure' as 'small enough'"
fi
# the operator's row count is the LANDED one. Quoting the swept count told him to expect 13 rows over a zone
# holding 11, so his own check confirmed the wrong number.
NSF="$(grep -lF 'Paste these two nameservers at GoDaddy' "$STEPS"/step*.sh 2>/dev/null | head -1)"
if [ -n "$NSF" ] && grep -qF "landed = json.load(open(S + '/records.json'))" "$NSF" \
   && grep -qF 'that LANDED in Cloudflare' "$NSF" && ! grep -qF "int(open(S + '/sweep_rows').read()" "$NSF"; then
  ok "source/landed-rows: the row count above the paste block is read back out of the settled zone, and the swept count is not read there at all"
else
  bad "source/landed-rows: the operator note is back on the swept count — it would tell him to expect rows a partial import never landed"
fi
# the operator counts against the INDIVIDUAL landed record count (one row per record, as GoDaddy's page shows), not
# the collapsed (name, type) row count — otherwise two apex TXT read as one row would tell him a smaller number and
# a missing record would read as a match.
if [ -n "$NSF" ] && grep -qF "landed_n = len([r for r in landed if isinstance(r, dict)])" "$NSF" \
   && grep -qF 'record(s) that LANDED in Cloudflare' "$NSF" \
   && ! grep -qF "len({(r.get('name'), r.get('type'))" "$NSF"; then
  ok "source/landed-individual: the landed count above the paste block is the individual record count, not the collapsed row count"
else
  bad "source/landed-individual: the operator note is back on a collapsed (name,type) row count — two apex TXT would undercount and a missed record would read as a match"
fi
# P1-1: the post-settle completeness gate is a SET, not a count. Every swept (name, type, value) must be present in
# the settled zone; a bare `len(recs) < swept` is fooled by a collapsed row offsetting a missed name.
if grep -qF 'missing = [k for k in swept_keys if tuple(k) not in settled]' "$WF" \
   && grep -qF "swept_keys = [tuple(k) for k in json.load(open(S + '/swept_keys.json'))]" "$WF" \
   && ! grep -qF 'len(recs) < swept' "$WF"; then
  ok "source/completeness-set: the post-settle gate compares the swept and settled record SETS by (name,type,value), not by count"
else
  bad "source/completeness-set: the completeness gate is back on a cardinality compare — a collapsed row can offset an entirely missed name"
fi
# P1-1: the sweep WRITES the swept (name,type,value) set the gate consumes. A gate with no producer is a dead guard.
if grep -qF "json.dump([ckey(o, ty, rd) for (o, ty, rd) in keep], open(S + '/swept_keys.json', 'w'))" "$WF"; then
  ok "source/swept-set-written: the sweep writes swept_keys.json for the post-settle set gate to read"
else
  bad "source/swept-set-written: the sweep no longer writes the swept record set — the completeness gate has nothing to compare against"
fi
# P1-2: TXT/SPF rdata is compared BYTE-EXACT in the reconcile. Opaque text is case-sensitive and every byte matters;
# a DKIM key differing only by case or a trailing '.' is MISSING, not a match. Lower-casing or stripping it (the
# round-3 shape) let a stale token pass as present with no later gate validating it.
if grep -qF "if t in ('TXT', 'SPF'):" "$WF" && grep -qF 'return txt_value(c)' "$WF" \
   && ! grep -qF "txt_value(c).strip().rstrip('.').lower()" "$WF"; then
  ok "source/txt-byte-exact: the reconcile compares TXT/SPF rdata byte-exact, never case-folded or dot-stripped"
else
  bad "source/txt-byte-exact: TXT/SPF rdata is being normalised — a DKIM key differing only by case would be treated as already present"
fi
# P1-3(a): nested wildcards below the apex are discovered by asking *.<suffix> for every owner suffix a swept name
# revealed. Without it, a wildcard at *.services.<dom> is invisible to the apex probe and the candidate list.
if grep -qF "wname = '*.' + suf" "$WF" && grep -qF 'st, ans = ask(wname, TYPES[0])' "$WF" \
   && grep -qF "suffixes.add('.'.join(labels[i:]) + '.' + dom)" "$WF"; then
  ok "source/nested-wildcard-discovery: the sweep probes *.<suffix> for every owner suffix a swept name revealed"
else
  bad "source/nested-wildcard-discovery: the nested-wildcard discovery loop is gone — a wildcard one label below the apex would be omitted and go dark on the switch"
fi
# P1-3(b): the honest-limit warning about nested wildcards sits ABOVE the paste block, worded as a required step.
if [ -n "$NSF" ] && grep -qF 'CANNOT be fully auto-' "$NSF" && grep -qF 'Required before you flip the nameservers' "$NSF"; then
  ok "source/nested-wildcard-warning: a required pre-cutover diff-against-GoDaddy warning is printed for nested wildcards"
else
  bad "source/nested-wildcard-warning: the nested-wildcard operator warning is missing — the honest limit is not surfaced above the paste block"
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
    "inputs.mode == 'import'")
        [ "$MODE" = "import" ] ;;
    "steps.zone.outputs.proceed == 'true' && inputs.mode == 'import'")
        [ "$(last_out proceed)" = "true" ] && [ "$MODE" = "import" ] ;;
    "steps.zone.outputs.proceed == 'true' && inputs.mode != 'plan'")
        [ "$(last_out proceed)" = "true" ] && [ "$MODE" != "plan" ] ;;
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
    # a uses: step is Actions' to run, not this harness's — recorded in the trace so it cannot be silently absent
    case "$(step_kind "$i")" in uses:*) TRACE="$TRACE ${i}:uses"; continue ;; esac
    env -i PATH="$WORK/_h/bin:$PATH" HOME="$HOME" LANG=C \
      CF_API_BASE="http://127.0.0.1:$PORT/$SCN/client/v4" \
      CF_STATE_DIR="$CASE/state" \
      CF_IMPORT_DEADLINE_S="$IMPORT_DEADLINE" CF_POLL_SLEEP_S=1 \
      CF_SWEEP_BUDGET_S="$SWEEP_BUDGET" CF_DNS_RESOLVERS="1.1.1.1 8.8.8.8" \
      GITHUB_WORKSPACE="$WORKSPACE" \
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
# WORKSPACE defaults to the REAL repository, so every import case greps the real tree — which is also the only proof
# the candidate-list grep does not crash on it.
reset_inputs() { Z1="stub-zone-token-not-a-real-credential"; T1=""; T2=""; T3=""; A1="stub-account-id"; \
                 DOMAIN="atlasglinn.com"; MODE="plan"; ADD_MISSING="false"; ALLOW_OTHER_MX="false"; \
                 WORKSPACE="$ROOT"; SWEEP_BUDGET=300; IMPORT_DEADLINE=3; }

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
# $2 must appear on an EARLIER line than $3 in the case's own output — an ordering pin, not merely a presence one.
# The nested-wildcard warning has to sit ABOVE the paste block: below the fold, it is a step he never reads.
before()  {
  local f="$WORK/$1/out" a b
  a=$(grep -nF -- "$2" "$f" 2>/dev/null | head -1 | cut -d: -f1)
  b=$(grep -nF -- "$3" "$f" 2>/dev/null | head -1 | cut -d: -f1)
  if [ -n "$a" ] && [ -n "$b" ] && [ "$a" -lt "$b" ]; then ok "$1: \"$2\" is above \"$3\" (lines $a<$b)"
  else bad "$1: \"$2\" is NOT above \"$3\" (a=$a b=$b)"; fi
}

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

# ══ IMPORT MODE ═════════════════════════════════════════════════════════════════════════════════════════════════════
# The zone for atlasglinn.com exists in the account and holds NOTHING — jump_start's scan imported zero records
# (measured 2026-09-09: records=0 MX=0 across 32 polls in runs 34382780038 and 34383841484). Import mode reads the
# records out of the parent's own authoritative nameservers with dig, writes a BIND file, imports it unproxied, and
# then hands off to the SAME Wait / Assert / nameserver steps that guard create. Every case below drives that with a
# stub dig on PATH; nothing here reaches a network.

# ── 24. the whole import path, green: sweep 12 records, import them once, pass all four gates, print the pair ───────
reset_inputs; MODE=import
run_job full_import full_import
expect full_import pass
must   full_import "$VERIFIED"
must   full_import "$NS_BLOCK"
must   full_import "amber.ns.cloudflare.com"
must   full_import "authoritative nameservers at the parent: 2"
must   full_import "recs added: 13"
# THREE COUNTS ON ONE LINE, and the run continues only when all three agree: what the sweep read at the parent,
# what Cloudflare says it parsed, and what Cloudflare says it created. Two of them used to be printed beside each
# other and compared to nothing, and the third was written to disk and read by nobody.
must   full_import "recs added: 13   total records parsed: 13   swept from the parent: 13"
# the one check only he can make, printed ABOVE the irreversible paste rather than under it — and quoting the count
# that LANDED, not the count the sweep found. Over a partial import those differ, and the swept one told him to
# expect rows the zone does not hold, so his own row count confirmed the wrong number.
must   full_import "compare its row count against the 13 record(s) that LANDED in Cloudflare"
# P1-3(b): the nested-wildcard warning sits ABOVE the paste block and is worded as a required pre-cutover step.
must   full_import "CANNOT be fully auto-discovered"
before full_import "CANNOT be fully auto-discovered" "$NS_BLOCK"
# ONE row carrying both halves of the promise: unproxied, and the TTL floored to 300 from the 60 the parent served.
# It is read back out of the existing assert table, so it also proves import reaches that table at all.
must   full_import "| A | tak.atlasglinn.com | False | 300 |"
mustnot full_import "ns-canary-1.example.net"
# THE WILDCARD PROBE, on the path where it finds nothing. A candidate list can only enumerate a zone whose parent
# answers NXDOMAIN for names that do not exist; the probe is what establishes that, and it has to be seen firing on
# the green run or its absence would only ever show up as a green run against a wildcard zone (case 37b).
must   full_import "no wildcard in the way of the sweep"
# and the literal `*` owner is QUERIED, not merely listed: a wildcard is synthesised into an answer owned by the name
# that was asked for, so asking for `*` is the only query that can ever put the wildcard record into the zone file.
if stats full_import | grep -Fq '*.atlasglinn.com|A'; then
  ok "full_import: the literal '*' owner was asked for at the parent"
else
  bad "full_import: '*' never reached a dig query — the one name that can reveal a wildcard record is not in the candidate list"
fi
mustnot full_import "This was a **plan** run"
eqn "full_import: exactly one zone-file import" "$(statn full_import import_calls)" 1
eqn "full_import: no record posted one at a time" "$(statn full_import post_records)" 0
eqn "full_import: no zone was created" "$(statn full_import post_zones)" 0
eqn "full_import: nothing was deleted" "$(statn full_import deletes)" 0
eqn "full_import: the zone file parsed" "$(statn full_import parse_errors)" 0
eqn "full_import: no record was read from a recursive resolver" "$(statn full_import dig_recursor_data_queries)" 0
# the other half of the same claim, and the one nothing could measure: a query that REACHED an authoritative server
# without +norecurse would have been answered out of that server's cache. Dropping the flag left the suite green.
eqn "full_import: every authoritative query was +norecurse" "$(statn full_import dig_recursive_auth_queries)" 0
# POSITIVE CONTROL. Without it a sweep that collected nothing would sail through the privacy gate looking spotless —
# the gate can only prove an absence, so something has to prove the presence.
if grep -Fq 203.0.113.77 "$WORK/full_import/state/zone.txt"; then
  ok "full_import: the zone file really holds the apex address the parent served"
else
  bad "full_import: the zone file does not hold the apex address — the sweep collected nothing and the gate saw nothing"
fi
# THE OUT-OF-ZONE FILTER, which is the only guard against importing a record for the WRONG domain. Removing it left
# the suite 200/200 green, because no dig table anywhere returned an answer whose owner was outside the zone. One
# does now: the parent answers the `www` probe with an A owned by elsewhere.example.net, and it must be dropped
# before the zone file is written — the record count above (13, not 14) is the second detector for the same thing.
if grep -Fq 203.0.113.99 "$WORK/full_import/state/zone.txt" || grep -Fq elsewhere.example.net "$WORK/full_import/state/zone.txt"; then
  bad "full_import: an answer whose OWNER is outside the zone reached the zone file — the out-of-zone filter is gone"
else
  ok "full_import: the out-of-zone owner the parent returned never reached the zone file"
fi
# MULTI-STRING TXT. Any TXT over 255 bytes — every real DKIM key, a long SPF — is served as several quoted
# character-strings whose wire value is their CONCATENATION. rd.strip('"') turned `"a" "b"` into `a" "b`, and no
# assertion would have noticed: the assert table prints names and types only. Read the expected value out of the
# emulator rather than restating it here, so the two cannot drift.
EXPECT_TXT="$(python3 -c "
import importlib.util
sp = importlib.util.spec_from_file_location('emu', '$EMU')
m = importlib.util.module_from_spec(sp); sp.loader.exec_module(m)
print(m.CANARY_TXT_JOINED)
")"
if stats full_import | grep -Fq "$EXPECT_TXT"; then
  ok "full_import: the 405-byte two-string TXT imported as the concatenation of both character-strings"
else
  bad "full_import: the multi-string TXT did not round-trip — a long DKIM key would import corrupted and look fine in a name/type table"
fi

# ── 25. the parent serves no apex MX: the same gate that guards create must stop import ─────────────────────────────
# The Wait step's fast path is "MX present and the count stopped moving", so a zone with no MX needs FOUR polls to
# settle on the count alone — more than the 3 s every other case runs under. The deadline is raised for this case
# only, because the point here is the MX gate, not the deadline.
reset_inputs; MODE=import; IMPORT_DEADLINE=12
run_job import_no_mx import_no_mx
expect import_no_mx fail
must   import_no_mx "no MX record on the apex"
mustnot import_no_mx "$VERIFIED"
mustnot import_no_mx "$NS_BLOCK"

# ── 26. DNSSEC is already ON at GoDaddy. Moving the nameservers with a DS in the registry takes the domain dark until
# the DS expires out, and Cloudflare cannot fix it from its side. The workflow told him not to ENABLE it; nothing ever
# measured whether it already was.
reset_inputs; MODE=import
run_job ds_present ds_present
expect ds_present fail
must   ds_present "DNSSEC is ON at GoDaddy"
mustnot ds_present "$NS_BLOCK"
mustnot ds_present "$VERIFIED"
# PINS THE ORDER, and the order changed: the DS is measured BEFORE the sweep and before any write, so a signed domain
# costs one dig and ZERO records in the live zone. This assertion read 1 while the verdict fired after the import.
eqn "ds_present: not one record was written before the DS verdict" "$(statn ds_present import_calls)" 0
eqn "ds_present: no record was posted either" "$(statn ds_present post_records)" 0

# ── 27. the DS state cannot be measured at all: an absence claim needs a successful read behind it ──────────────────
reset_inputs; MODE=import
run_job ds_unknown ds_unknown
expect ds_unknown fail
must   ds_unknown "cannot tell whether the domain is signed"
mustnot ds_unknown "$NS_BLOCK"

# ── 28. no authoritative nameserver is named at the parent: there is nothing to copy from ───────────────────────────
reset_inputs; MODE=import
run_job dig_no_ns dig_no_ns
expect dig_no_ns fail
must   dig_no_ns "Could not read the authoritative nameservers"
eqn    "dig_no_ns: nothing was imported" "$(statn dig_no_ns import_calls)" 0
eqn    "dig_no_ns: no record was posted" "$(statn dig_no_ns post_records)" 0
mustnot dig_no_ns "$NS_BLOCK"

# ── 29. the servers answer, and answer nothing for every candidate name ─────────────────────────────────────────────
reset_inputs; MODE=import
run_job dig_empty dig_empty
expect dig_empty fail
must   dig_empty "answered nothing for any candidate name"
eqn    "dig_empty: nothing was imported" "$(statn dig_empty import_calls)" 0
eqn    "dig_empty: no record was posted" "$(statn dig_empty post_records)" 0

# ── 30. the zone already holds a previous import, minus www and tak: add exactly those two, delete nothing ──────────
reset_inputs; MODE=import
run_job zone_prefilled zone_prefilled
expect zone_prefilled pass
must   zone_prefilled "adding only what is missing, deleting nothing"
eqn    "zone_prefilled: exactly the two missing records were posted" "$(statn zone_prefilled post_records)" 2
eqn    "zone_prefilled: no second zone-file import" "$(statn zone_prefilled import_calls)" 0
eqn    "zone_prefilled: nothing was deleted" "$(statn zone_prefilled deletes)" 0
must   zone_prefilled "$NS_BLOCK"

# ── 31. the one missing record is an SRV. Cloudflare's JSON shape for SRV and CAA was never read from a live
# response, so the reconcile refuses to guess it rather than writing a guess into a service path.
reset_inputs; MODE=import
run_job zone_prefilled_srv zone_prefilled_srv
expect zone_prefilled_srv fail
must   zone_prefilled_srv "will not create one at a time"
eqn    "zone_prefilled_srv: nothing was posted" "$(statn zone_prefilled_srv post_records)" 0

# ── 31b. THE CONFLICT. The zone already holds an apex A pointing somewhere ELSE than the parent serves today. By
# name+type nothing is missing; by (name, type, content) the parent's apex A IS missing — so a reconcile that treats
# a differing content as a missing record POSTS A SECOND APEX A beside the first. All four gates then pass, because
# the assert step only asks whether an A/AAAA/CNAME is PRESENT at the apex and at www, so `verified=true` is written
# and the nameserver paste block prints — and on the switch roughly half of the web traffic round-robins to the stale
# origin. Every prefilled scenario before this one was built from the same dig answers the sweep reads, so nothing in
# 200 cases put a record in the zone whose content differed and this branch had zero coverage.
# ABSENCE IS THE ONLY SAFE PRECONDITION FOR A CREATE — the rule the tak step has enforced since round 1, now applied
# at every name for A, AAAA and CNAME.
reset_inputs; MODE=import
run_job zone_conflicting zone_conflicting
expect zone_conflicting fail
must   zone_conflicting "already hold a record of this type with a different value"
eqn    "zone_conflicting: not one record was posted beside the existing one" "$(statn zone_conflicting post_records)" 0
eqn    "zone_conflicting: no zone-file import either" "$(statn zone_conflicting import_calls)" 0
eqn    "zone_conflicting: nothing was deleted" "$(statn zone_conflicting deletes)" 0
mustnot zone_conflicting "$VERIFIED"
mustnot zone_conflicting "$NS_BLOCK"

# ── 31d. THE PAGE. Everything the reconcile knows about the zone comes from ONE un-paged read of
# per_page=100 — and per_page=100 is a PAGE, not a zone: Cloudflare serves a slice and reports the real size in
# result_info.total_count. This zone holds 122 records with the CONFLICTING apex A at row 101, so a reconcile built
# on page one cannot see an apex A at all, reads the parent's apex A as MISSING, and POSTs a second one beside the
# one it never read — into a live zone, on the only step in this file that writes. The run did exit 1 before this
# fix, but at the NEXT step, after the write, with a sentence about a truncated read that never mentioned the
# duplicate it had just created. Every prefilled scenario before this one held fewer than 100 records, so the single
# read was always the whole zone and nothing in 217 cases could tell absence from truncation.
reset_inputs; MODE=import
run_job zone_paged zone_paged
expect zone_paged fail
must   zone_paged "so it cannot tell what the zone already holds"
eqn    "zone_paged: not one record was posted against a partial view" "$(statn zone_paged post_records)" 0
eqn    "zone_paged: no zone-file import either" "$(statn zone_paged import_calls)" 0
eqn    "zone_paged: nothing was deleted" "$(statn zone_paged deletes)" 0
mustnot zone_paged "$VERIFIED"
mustnot zone_paged "$NS_BLOCK"

# ── 31e. the one missing record is the two-character-string DKIM TXT, and the reconcile posts it ONE AT A TIME —
# a different code path from the BIND import, with its own body, and it had zero assertion coverage. The value that
# body must carry is the CONCATENATION of both strings: the join is the fix round 2 shipped, and only the multipart
# import path was ever asserted on it.
reset_inputs; MODE=import
run_job zone_prefilled_txt zone_prefilled_txt
expect zone_prefilled_txt pass
eqn    "zone_prefilled_txt: exactly the one missing TXT was posted" "$(statn zone_prefilled_txt post_records)" 1
if [ -n "${EXPECT_TXT:-}" ] && stats zone_prefilled_txt | grep -Fq "$EXPECT_TXT"; then
  ok "zone_prefilled_txt: the one-at-a-time POST carried the concatenation of both character-strings"
else
  bad "zone_prefilled_txt: the reconcile's POST body for the multi-string TXT is not the joined value — a long DKIM key would be added corrupted and would look correct in every name/type table this workflow prints"
fi
must   zone_prefilled_txt "$NS_BLOCK"

# ── 31f. ONE ADDRESS, TWO SPELLINGS. The zone holds an AAAA written out in full and the parent serves the same
# address compressed. Compared as text they differ, so the conflict limb added in round 2 refuses a run where
# nothing is wrong — a false positive on a limb whose whole job is to stop the run.
reset_inputs; MODE=import
run_job zone_prefilled_v6 zone_prefilled_v6
expect zone_prefilled_v6 pass
eqn    "zone_prefilled_v6: the two spellings of one address are not a conflict and nothing was posted" "$(statn zone_prefilled_v6 post_records)" 0
must   zone_prefilled_v6 "$NS_BLOCK"

# ── 31g. a name answers with a CNAME and a TXT. A CNAME cannot share an owner with any other type; Cloudflare
# rejects the zone file for it and rejects it PART-WAY, leaving the records before the clash created — a half
# imported zone the next dispatch would then reconcile against.
reset_inputs; MODE=import
run_job dig_cname_clash dig_cname_clash
expect dig_cname_clash fail
must   dig_cname_clash "cannot share a name with any other type"
eqn    "dig_cname_clash: nothing was imported" "$(statn dig_cname_clash import_calls)" 0
eqn    "dig_cname_clash: no record was posted" "$(statn dig_cname_clash post_records)" 0

# ── 31c. an authoritative server answers with an rdata past the 2048-byte ceiling. The sweep refuses to put it in a
# zone file, and refuses before anything is imported — the value is never printed, only the name and the type.
reset_inputs; MODE=import
run_job dig_bad_rdata dig_bad_rdata
expect dig_bad_rdata fail
must   dig_bad_rdata "carries a value this run will not put in a zone file"
eqn    "dig_bad_rdata: nothing was imported" "$(statn dig_bad_rdata import_calls)" 0
eqn    "dig_bad_rdata: no record was posted" "$(statn dig_bad_rdata post_records)" 0

# ── 32. the read back after the import is truncated: the existing 100-cap check still guards import ─────────────────
reset_inputs; MODE=import
run_job import_truncated import_truncated
expect import_truncated fail
must   import_truncated "running against a slice of the import"
mustnot import_truncated "$NS_BLOCK"

# ── 33. Cloudflare refuses the zone-file import. Its message quotes the record it is about; only the numeric code
# may reach this log, and the canary riding inside that message is what the privacy sweep at the end looks for.
reset_inputs; MODE=import
run_job import_4xx import_4xx
expect import_4xx fail
must   import_4xx "code(s) 1004"
must   import_4xx "message text is not echoed"
mustnot import_4xx "$NS_BLOCK"
eqn    "import_4xx: no record was posted after the refusal" "$(statn import_4xx post_records)" 0

# ── 34. one of the two authoritative nameservers stops answering: use the other, and say so as a COUNT ──────────────
reset_inputs; MODE=import
run_job ns_failover ns_failover
expect ns_failover pass
must   ns_failover "did not answer — the sweep used another"
must   ns_failover "$NS_BLOCK"
eqn    "ns_failover: the import still ran exactly once" "$(statn ns_failover import_calls)" 1

# ── 35. BOTH authoritative nameservers stop answering half way. A PARTIAL SWEEP IS A FAILED SWEEP: a zone file
# missing the half that did not answer imports clean and takes those names dark on the switch.
reset_inputs; MODE=import
run_job dig_all_dead dig_all_dead
expect dig_all_dead fail
must   dig_all_dead "The sweep is incomplete"
eqn    "dig_all_dead: nothing was imported" "$(statn dig_all_dead import_calls)" 0
eqn    "dig_all_dead: no record was posted" "$(statn dig_all_dead post_records)" 0

# ── 36. the sweep runs out of its budget: refuse, rather than import the records it happened to have ────────────────
reset_inputs; MODE=import; SWEEP_BUDGET=0
run_job import_budget full_import_budget
expect import_budget fail
must   import_budget "sweep budget"
eqn    "import_budget: nothing was imported" "$(statn full_import_budget import_calls)" 0
eqn    "import_budget: no record was posted" "$(statn full_import_budget post_records)" 0

# ── 37. the candidate list is extended by every <label>.<domain> the repository itself mentions, so a name this
# project invented cannot be missed by a fixed list. Against the REAL repository that limb adds zero names today
# (measured: www, tak, selector1._domainkey, selector2._domainkey and _dmarc, all five already in the fixed list) —
# which is exactly why it needs a fake tree to be provable at all.
reset_inputs; MODE=import; WORKSPACE="$WORK/_h/fakerepo"
run_job import_repo_grep full_import_repo
expect import_repo_grep pass
must   import_repo_grep "candidate names added by the repository grep (1): zzcanaryhost"
if stats full_import_repo | grep -q 'zzcanaryhost.atlasglinn.com'; then
  ok "import_repo_grep: the grepped label was actually QUERIED at the parent, not just printed"
else
  bad "import_repo_grep: the grepped label never reached a dig query — the limb prints a name it does not sweep"
fi
if stats full_import_repo | grep -q 'example.org'; then
  bad "import_repo_grep: a hostname OUTSIDE the domain was queried — the grep is matching more than <label>.<domain>"
else
  ok "import_repo_grep: the out-of-domain hostname in the same file was never queried"
fi

# ── 37b. A WILDCARD AT THE PARENT, and the run this fix stops used to be fully green. An authoritative server
# under `*.<zone>` SYNTHESISES an answer owned by whatever name was asked, so it answers for every name, reveals the
# wildcard for none of them, and never returns NXDOMAIN — which also turns the sweep's name-level shortcut off, so
# all 8 types get asked for all 75 labels and the swept list comes back long and complete-looking. Measured before
# the fix: the run reached the nameserver step, the zone file held 77 explicit A records, `grep -c '^\*'` on it
# returned 0, and every name GoDaddy served outside the candidate list would have gone dark on the switch. The four
# gates cannot see it — apex, www, MX and tak are all present — and the operator note above the paste block INVERTS
# here, telling him to compare row counts when the run would list ~77 rows against GoDaddy's handful.
reset_inputs; MODE=import
run_job wildcard wildcard
expect wildcard fail
must   wildcard "CANNOT be enumerated by asking a candidate list of names"
eqn    "wildcard: nothing was imported" "$(statn wildcard import_calls)" 0
eqn    "wildcard: no record was posted" "$(statn wildcard post_records)" 0
mustnot wildcard "$VERIFIED"
mustnot wildcard "$NS_BLOCK"

# ── 38. import dispatched at a domain that is NOT in the account. import never creates a zone: create is the step
# that decides which account owns a domain, and this run will not guess.
reset_inputs; MODE=import
run_job import_no_zone import_no_zone
expect import_no_zone fail
must   import_no_zone "import mode will not create a zone"
eqn    "import_no_zone: no zone was created" "$(statn import_no_zone post_zones)" 0

# ── 40. A 200 IS NOT AN IMPORT. Cloudflare's importer parses the file, creates what it CAN, and answers 200 —
# recs_added and total_records_parsed exist precisely because they can differ. The step printed both and compared
# them to NOTHING, and the sweep's own count sat on disk with zero readers. Eleven of thirteen rows landing takes
# `_dmarc` and the M365 DKIM selector dark on the switch while all four gates pass, because the gates ask about the
# apex, www, MX and tak and are structurally blind to every other name. Two shapes, and they fail differently.
# 40a: the importer reports only what it CREATED (added == parsed == 11) — the swept count is the only witness.
reset_inputs; MODE=import
run_job partial_import partial_import
expect partial_import fail
must   partial_import "the sweep read 13 record(s) at the parent, Cloudflare parsed 11 and created 11"
mustnot partial_import "$VERIFIED"
mustnot partial_import "$NS_BLOCK"
eqn    "partial_import: the import was attempted exactly once" "$(statn partial_import import_calls)" 1
eqn    "partial_import: no record was posted after the refusal" "$(statn partial_import post_records)" 0
eqn    "partial_import: nothing was deleted" "$(statn partial_import deletes)" 0

# 40b: the importer reports HONESTLY (parsed 13, added 11) — the two numbers already disagree before the swept
# count is consulted, and that limb needs its own case or it is only ever reached through the other one.
reset_inputs; MODE=import
run_job partial_import_parsed partial_import_parsed
expect partial_import_parsed fail
must   partial_import_parsed "the sweep read 13 record(s) at the parent, Cloudflare parsed 13 and created 11"
mustnot partial_import_parsed "$VERIFIED"
mustnot partial_import_parsed "$NS_BLOCK"
eqn    "partial_import_parsed: the import was attempted exactly once" "$(statn partial_import_parsed import_calls)" 1
# THE SENTENCE ITSELF names three counts and not one record. Scoped to the error line on purpose: the sweep step
# above it prints a name/type inventory, which the workflow header accepts by name ("there is no other way to tell
# him which record failed"). What must not happen is this error naming the rows that did not land — it cannot know
# which they were, and a guess here is a subdomain list attached to a failure.
if grep -F 'Cloudflare parsed 13 and created 11' "$WORK/partial_import_parsed/out" \
   | grep -qE '_dmarc|selector[12]|autodiscover|_sip|www\.|tak\.'; then
  bad "partial_import_parsed: a record NAME reached the partial-import error sentence — this log is public"
else
  ok "partial_import_parsed: the partial-import error names three counts and not one record"
fi

# 40c: the two counts AGREE, and the zone still settles short — a row lost between Cloudflare's parse and the
# zone it serves. The import step cannot see this: it trusts recs_added, and recs_added is what is wrong. This is
# the only case that arms the SECOND count check, the one after the wait that counts the rows the zone actually
# serves rather than the ones Cloudflare said it made.
reset_inputs; MODE=import
run_job partial_import_settled partial_import_settled
expect partial_import_settled fail
must   partial_import_settled "recs added: 13   total records parsed: 13   swept from the parent: 13"
must   partial_import_settled "2 of them are NOT present in the settled Cloudflare zone (which holds 11 row(s))"
mustnot partial_import_settled "$VERIFIED"
mustnot partial_import_settled "$NS_BLOCK"
eqn    "partial_import_settled: the import was attempted exactly once" "$(statn partial_import_settled import_calls)" 1
eqn    "partial_import_settled: nothing was deleted" "$(statn partial_import_settled deletes)" 0

# ── 41. THE `*` CANDIDATE LABEL, on the one case it was added for. A wildcard is synthesised into an answer owned
# by the name that was ASKED for, so no query but one for the literal `*` owner can ever copy the record itself.
# This parent answers NXDOMAIN normally — so the probe passes, the sweep proceeds, and the `*` label is the only
# thing standing between that record and a name that goes dark on the switch. The emulator branch written for `*`
# in round 3 was dead code: no dig table had a `*` entry.
reset_inputs; MODE=import
run_job wildcard_typed wildcard_typed
expect wildcard_typed pass
must   wildcard_typed "no wildcard in the way of the sweep"
must   wildcard_typed "recs added: 14   total records parsed: 14   swept from the parent: 14"
must   wildcard_typed "| TXT | *.atlasglinn.com | False | 3600 |"
must   wildcard_typed "$NS_BLOCK"
if grep -q '^\*\.atlasglinn\.com\.' "$WORK/wildcard_typed/state/zone.txt"; then
  ok "wildcard_typed: the wildcard row reached the zone file at its literal owner"
else
  bad "wildcard_typed: the '*' owner never reached the zone file — the label is listed and the record is not copied"
fi
if stats wildcard_typed | grep -Fq '*.atlasglinn.com'; then
  ok "wildcard_typed: the wildcard row was imported into the zone"
else
  bad "wildcard_typed: the wildcard row never reached the import"
fi

# ── 42. A 1-WEEK TTL AT THE PARENT. GoDaddy's DNS UI offers 604800 and Cloudflare's documented non-Enterprise
# maximum is 86400, so a row copied verbatim is the likeliest single cause of an importer that answers 200 and
# silently skips a record. The sweep clamps at both ends; the floor has been asserted since round 1 by tak's 60.
reset_inputs; MODE=import
run_job ttl_ceiling ttl_ceiling
expect ttl_ceiling pass
must   ttl_ceiling "| A | app.atlasglinn.com | False | 86400 |"
must   ttl_ceiling "$NS_BLOCK"
TTLROW="$(python3 -c "
import sys
for l in open('$WORK/ttl_ceiling/state/zone.txt'):
    p = l.rstrip('\n').split('\t')
    if len(p) == 5 and p[0] == 'app.atlasglinn.com.' and p[3] == 'A':
        print(p[1])
" 2>/dev/null)"
eqn "ttl_ceiling: the 604800 TTL the parent served was written at the 86400 ceiling" "${TTLROW:-none}" 86400

# ── 43. ONE LOST UDP PACKET IS NOT A DEAD SERVER, and until this case the two-strikes counter and the rested-
# nameserver retry were source-only: reverting both wholesale left the suite green. ns1 drops its first two
# queries (two strikes, rested), then ns2 drops its fifth — at which point NOTHING is in the rotation and the only
# way the sweep completes is by asking the rested server again.
reset_inputs; MODE=import
run_job ns_flaky ns_flaky
expect ns_flaky pass
must   ns_flaky "did not answer — the sweep used another"
must   ns_flaky "a rested authoritative nameserver answered again"
must   ns_flaky "recs added: 13   total records parsed: 13   swept from the parent: 13"
must   ns_flaky "$NS_BLOCK"
eqn    "ns_flaky: three datagrams were dropped" "$(statn ns_flaky dig_dropped)" 3
eqn    "ns_flaky: the import still ran exactly once" "$(statn ns_flaky import_calls)" 1

# ── 44. THE ZONE'S SIZE CANNOT BE MEASURED. Both truncated-read guards were `isinstance(total, int) and total >
# len(rows)`, which falls through to "carry on" when result_info is absent or total_count is not a number — "I
# could not measure the zone" read as "the zone is small enough". Once on the only step that WRITES:
reset_inputs; MODE=import
run_job no_result_info_import no_result_info_import
expect no_result_info_import fail
must   no_result_info_import "did not report this zone's size"
eqn    "no_result_info_import: nothing was imported" "$(statn no_result_info_import import_calls)" 0
eqn    "no_result_info_import: no record was posted" "$(statn no_result_info_import post_records)" 0
mustnot no_result_info_import "$NS_BLOCK"

# and once on the step every assertion below reads its record set from:
reset_inputs; MODE=create
run_job no_result_info_wait no_result_info_wait
expect no_result_info_wait fail
must   no_result_info_wait "did not report this zone's size"
mustnot no_result_info_wait "$VERIFIED"
mustnot no_result_info_wait "$NS_BLOCK"

# ── 45. DNSSEC IS ALREADY ON, AND THE DISPATCH IS create. The DS gate was import-only while the paste block is
# reachable from create as well, so this exact run printed two nameservers for a signed domain — the same
# domain-dark outcome the import gate exists to prevent, one dispatch choice away.
reset_inputs; MODE=create
run_job ds_present_create ds_present_create
expect ds_present_create fail
must   ds_present_create "DNSSEC is ON at GoDaddy"
mustnot ds_present_create "$VERIFIED"
mustnot ds_present_create "$NS_BLOCK"

# ── 45b. THE NUMBER ABOVE THE PASTE BLOCK IS THE ONE THAT LANDED. Every case up to here has swept == landed, so
# reverting the note to the swept count left the suite green — the guard was unarmed. This zone already holds a
# record at `legacy`, a name no candidate label and no repository grep will ever ask about, so the sweep finds 13
# rows and the settled zone serves 14. The one manual check in R3' is a row count he makes by hand against
# GoDaddy's DNS page; quoting 13 over a zone of 14 inverts it, which is precisely how a partial import got
# CONFIRMED by his own check.
reset_inputs; MODE=import
run_job zone_extra zone_extra
expect zone_extra pass
must   zone_extra "compare its row count against the 14 record(s) that LANDED in Cloudflare"
mustnot zone_extra "against the 13 name/type row(s)"
must   zone_extra "$NS_BLOCK"
eqn    "zone_extra: exactly the two missing records were posted" "$(statn zone_extra post_records)" 2
eqn    "zone_extra: nothing was deleted" "$(statn zone_extra deletes)" 0

# ── 46. `proxied` IS AN ADDRESS-RECORD FIELD. It was sent in the reconcile body for TXT, MX, SRV and CAA — a shape
# never read from a live Cloudflare response, and the same caution already applied to SRV and CAA one branch up.
# Every body this run POSTs must carry it for A/AAAA/CNAME and for nothing else.
proxied_shape() { stats "$1" | python3 -c "
import json, sys
rows = [json.loads(x) for x in json.load(sys.stdin).get('added', [])]
ADDR = ('A', 'AAAA', 'CNAME')
bad = [(r.get('type'), 'proxied' in r) for r in rows if ('proxied' in r) != (r.get('type') in ADDR)]
print('no-bodies' if not rows else ('ok' if not bad else 'wrong:%s' % bad))
"; }
eqn "zone_prefilled: the CNAME and A bodies carry proxied and nothing else does" "$(proxied_shape zone_prefilled)" ok
eqn "zone_prefilled_txt: the TXT body carries no proxied key" "$(proxied_shape zone_prefilled_txt)" ok

# the MX reconcile body had no case at all: every prefilled scenario was missing an address record or a TXT.
reset_inputs; MODE=import
run_job zone_prefilled_mx zone_prefilled_mx
expect zone_prefilled_mx pass
eqn    "zone_prefilled_mx: exactly the one missing MX was posted" "$(statn zone_prefilled_mx post_records)" 1
eqn    "zone_prefilled_mx: the MX body carries no proxied key" "$(proxied_shape zone_prefilled_mx)" ok
must   zone_prefilled_mx "$NS_BLOCK"

# ── 47. P1-2. THE ZONE HOLDS A TXT DIFFERING ONLY BY CASE. A prior import left the apex SPF as its uppercase form
# with a trailing dot; the parent serves the real value. Opaque text is byte-exact, so the reconcile must call it
# MISSING and POST the parent's value — exactly one record. A case-folding compare (the round-3 shape) calls it an
# exact match, posts nothing, and leaves a stale SPF/DKIM value no later gate validates. Reverting the byte-exact
# norm drops post_records to 0 (behavioural), and the settled zone then lacks the authoritative value so the P1-1
# set gate also refuses — either way the run stops being the clean pass it is here.
reset_inputs; MODE=import
run_job zone_txt_case zone_txt_case
expect zone_txt_case pass
eqn    "zone_txt_case: the case-differing TXT is MISSING and exactly one record was posted" "$(statn zone_txt_case post_records)" 1
eqn    "zone_txt_case: nothing was deleted" "$(statn zone_txt_case deletes)" 0
must   zone_txt_case "$NS_BLOCK"

# ── 48. P1-1. A COLLAPSED ROW OFFSETS A MISSED NAME. The parent serves two apex TXT (two records, one name/type
# row) and the importer drops the `mail` A while an unrelated `extra` A is served — so the LANDED count equals the
# SWEPT count and a cardinality check matches, while a real swept name is gone. Only a (name, type, value) SET check
# sees it. The three-count import check passes on honest full counts; the miss surfaces only after the zone settles.
reset_inputs; MODE=import
run_job import_offset import_offset
expect import_offset fail
must   import_offset "are NOT present in the settled Cloudflare zone"
eqn    "import_offset: the zone-file import still ran once" "$(statn import_offset import_calls)" 1
eqn    "import_offset: nothing was posted one at a time" "$(statn import_offset post_records)" 0
eqn    "import_offset: nothing was deleted" "$(statn import_offset deletes)" 0
mustnot import_offset "$VERIFIED"
mustnot import_offset "$NS_BLOCK"

# ── 49. P1-1. TWO apex TXT land intact: 14 records but 13 (name, type) rows. The operator note above the paste block
# must quote the INDIVIDUAL landed count (14, the way GoDaddy's page counts), never the collapsed row count (13).
reset_inputs; MODE=import
run_job landed_multi landed_multi
expect landed_multi pass
must   landed_multi "compare its row count against the 14 record(s) that LANDED in Cloudflare"
mustnot landed_multi "compare its row count against the 13 record(s) that LANDED in Cloudflare"
must   landed_multi "$NS_BLOCK"

# ── 50. P1-3. A NESTED WILDCARD at *.services.atlasglinn.com. The apex probe still gets NXDOMAIN, so the run
# proceeds; the repository grep reveals node.services.atlasglinn.com, discovery derives the `services` suffix, and
# the query for the literal *.services owner is the ONLY thing that copies the wildcard record into the import.
# Removing the discovery loop leaves node.services swept but *.services never queried — a behavioural miss.
reset_inputs; MODE=import; WORKSPACE="$WORK/_h/nestedrepo"
run_job nested_wildcard nested_wildcard
expect nested_wildcard pass
must   nested_wildcard "*.services.atlasglinn.com"
if stats nested_wildcard | grep -Fq '*.services.atlasglinn.com|A'; then
  ok "nested_wildcard: the literal *.services owner was actually QUERIED at the parent, not just derived"
else
  bad "nested_wildcard: the nested wildcard was never queried — discovery did not reach *.services.atlasglinn.com"
fi
eqn    "nested_wildcard: the import ran exactly once" "$(statn nested_wildcard import_calls)" 1
must   nested_wildcard "$NS_BLOCK"

# ── 39. THE PRIVACY GATE: no record content in any byte this run produced ───────────────────────────────────────────
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
NDIRS=$(find "$WORK" -mindepth 1 -maxdepth 1 -type d ! -name steps ! -name _h | wc -l | tr -d ' ')
eqn "privacy: the sweep covers every case that ran" "$NRUNS" "$NDIRS"

LEAK=0
for canary in 203.0.113.77 origin-canary.example.net atlas-canary.mail.protection.outlook.com \
              mx-canary.secureserver-example.net 'v=spf1' autodiscover-canary.outlook.com 198.51.100.9 \
              canary-filler- www-txt-canary-verification-string apex-txt-canary-verification-string \
              origin-canary-in-error.example.net \
              ns-canary-1.example.net ns-canary-2.example.net 203.0.113.88 dkim-canary.example.net \
              sipdir-canary.example.net caa-canary.example.net deleg-canary.example.net dmarc-canary@example.net \
              ds0canary0000000000000000000000000000000000000000000000000000cafe \
              dkim-second-string-canary.example.net 203.0.113.99 elsewhere.example.net 203.0.113.55 \
              bigrdata-canary.example.net 203.0.113.66 pagefill-canary.example.net 2001:db8:beef::1 \
              2001:0db8:beef:0000:0000:0000:0000:0001 clash-canary.example.net \
              clash-txt-canary-verification-string wildcard-txt-canary-verification-string 203.0.113.44 \
              203.0.113.22 apex-txt2-canary-verification-string SPF.PROTECTION.OUTLOOK.COM \
              203.0.113.111 203.0.113.123; do
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
# An EQUALITY pin on the exact count this file produces. It was a `-lt` floor that happened to sit at the current
# count, so a case could be added without a thought while a deletion was caught — both directions are a deliberate
# edit now. At MIN=60 against 78 actual assertions, eighteen could be deleted or stop running and the harness still
# printed "all green". Measured, never lowered: 118 before import mode, 200 with it, 217 with round 2's
# conflict, out-of-zone, multi-string-TXT and +norecurse coverage, and 244 with round 3's paged-read, wildcard,
# one-at-a-time-TXT-body, IPv6-spelling and CNAME-clash coverage, and 313 with round 4's partial-import,
# TTL-ceiling, typed-wildcard, flaky-nameserver, unmeasurable-size, create-mode-DS and proxied-shape coverage, and
# 341 with round 5's completeness-SET gate (P1-1), byte-exact TXT/SPF reconcile (P1-2) and nested-wildcard
# discovery plus its honest-limit warning (P1-3).
MIN=341
if [ "$CASES" != "$MIN" ]; then
  echo "FAIL harness: $CASES cases ran, not the $MIN pinned here — a block was dropped, the run stopped early, or a case was added without updating MIN"
  DONE=1; exit 1
fi
DONE=1
[ "$FAIL" = "0" ] || exit 1
echo "cf-zone: all green"
