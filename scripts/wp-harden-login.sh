#!/usr/bin/env bash
# Harden atlasglinn.com's WordPress login from the Mac — Wordfence Free, with a lightweight fallback.
#
# Why: `atlasglinn.com/wp-login.php` has answered HTTP 200 with nothing in front of it since the P1 opened on
# 2026-07-01 (brain vault `02-projects/atlasglinn-security-incident-2026-07-01.md`). **R2** of that packet — "Install
# Wordfence Free … brute-force lockout, email alerts to matthew@atlasglinn.com" — has been the only available throttle
# since **R3** (a Cloudflare WAF rate-limit rule on `/wp-login.php`) was shown to be impossible: atlasglinn.com answers
# through GoDaddy's *bundled* Cloudflare (`ns15/ns16.domaincontrol.com`, A 160.153.0.38), so the zone is not in
# Brockmann's Cloudflare account and no rule of his can exist on it. The edge does challenge a rapid burst (3rd request
# → 429 `cf-mitigated: challenge`, measured 2026-09-02) but a single request still returns 200, so the realistic attack —
# a slow credential-stuffing run — is unimpeded. R2 was gated on Brockmann's explicit act ("Requires 'install wordfence'
# explicit command"); running this script IS that act, so it prints what it is about to install and installs it in one
# pass. No prompts: it is run by hand, never by cron.
#
# What it does: preflight over the same SSH login `wp-flush.sh` uses (Keychain `mast-wp-sftp`) — `wp core version`,
# `wp plugin list`, `admin_email`, and the login form's HTTP code measured from the Mac; installs and activates
# `wordfence`; then sets the login-security keys through `wfConfig` with `wp eval-file` and READS EACH ONE BACK, so a
# key this Wordfence build does not know prints ABSENT instead of being reported as applied. GoDaddy Managed WordPress
# keeps a blocklist of disallowed plugins and whether `wordfence` is on it is UNVERIFIABLE FROM HERE — so if the
# install, the activation, or `wp plugin is-active wordfence` afterwards says no, it falls back by itself to
# `limit-login-attempts-reloaded` + `two-factor` (options set with `wp option update`, each read back) and says which
# path ran. A plugin already active is left alone and only re-tightened.
#
# What it deliberately does NOT do:
#   * no Cloudflare WAF / rate-limit rule — the zone is GoDaddy's, not his (R3 is dead, not deferred);
#   * no `auto_prepend_file` — Wordfence's "extended protection" rewrites server files and is a separate gated step;
#     this script only prints whether it is already on;
#   * no failed-login probe — a lockout test would lock Brockmann's own IP out of wp-admin for hours. Verification is
#     `wp plugin is-active` exit codes, the read-back values, and the login form's HTTP code before/after.
#
#   bash scripts/wp-harden-login.sh     # one run: preflight, install, tighten, verify, heartbeat, email the log
#
# `wp-login.php` is EXPECTED to still answer 200 afterwards — the form is meant to load; the lockout applies to failed
# POSTs. A 200 after the run is not a failure. Heartbeat: ~/.cache/wp-upload/last-harden-login =
# "<time> <wordfence|llar|already|none> <result>".
set -u
KC_SFTP="${KC_SFTP:-mast-wp-sftp}"
HOST="${WP_HOST:-1127220.us12.ssh.myftpupload.com}"; DOCROOT="${WP_DOCROOT:-html}"
LOGIN_URL="${WP_LOGIN_URL:-https://www.atlasglinn.com/wp-login.php}"
ALERT_EMAIL="matthew@atlasglinn.com"
MAILER="$HOME/.claude/bin/atlas-email"
STAMP="$HOME/.cache/wp-upload/last-harden-login"
SSH_OPTS="-o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 -o ServerAliveInterval=15 -o ServerAliveCountMax=4"

say() { printf '%s\n' "$*" | tee -a "${LOG:-/dev/null}"; }
kc_pw() { security find-generic-password -s "$1" -w 2>/dev/null; }
kc_acct() { security find-generic-password -s "$1" 2>/dev/null | sed -n 's/^ *"acct"<blob>="\(.*\)"$/\1/p'; }
# One ssh entry point so every call carries the same timeouts and host-key policy. $2 is the file fed to the remote
# command on stdin (the PHP); without it stdin is /dev/null, so a call that ships nothing cannot swallow the terminal's.
rsh() { ssh $SSH_OPTS "$U@$HOST" "$1" < "${2:-/dev/null}"; }
login_code() { c="$(curl -s -m 25 -o /dev/null -w '%{http_code}' "$LOGIN_URL" 2>/dev/null)"; printf '%s' "${c:-000}"; }

# ── remote command strings (built here, run by rsh; no local expansion inside them except $DOCROOT and the slug) ──────
rc_preflight() {
  cat <<CMD
cd $DOCROOT || { echo 'preflight docroot-missing'; exit 3; }
printf 'preflight core-version '; wp core version 2>&1 | head -1
printf 'preflight admin-email '; wp option get admin_email 2>&1 | head -1
echo 'preflight plugin-list-begin'; wp plugin list --format=csv 2>&1; echo 'preflight plugin-list-end'
CMD
}
rc_install() {   # \$1 = plugin slug
  cat <<CMD
cd $DOCROOT || { echo 'install docroot-missing'; exit 3; }
wp plugin install $1 --activate 2>&1 | tail -4
printf 'is-active $1 '; if wp plugin is-active $1 >/dev/null 2>&1; then echo yes; else echo no; fi
CMD
}
rc_activate() {  # \$1 = plugin slug, already installed
  cat <<CMD
cd $DOCROOT || { echo 'activate docroot-missing'; exit 3; }
wp plugin activate $1 2>&1 | tail -2
printf 'is-active $1 '; if wp plugin is-active $1 >/dev/null 2>&1; then echo yes; else echo no; fi
CMD
}
rc_verify() {    # \$1 = plugin slug — prints the is-active exit code itself, not a paraphrase of it
  cat <<CMD
cd $DOCROOT || { echo 'verify docroot-missing'; exit 3; }
wp plugin is-active $1 >/dev/null 2>&1; printf 'verify is-active $1 rc=%s\n' "\$?"
CMD
}
# The PHP arrives on ssh's stdin — nothing to quote — into a file in the login's home for the one call, then it is
# removed on every path (the trailing rm runs whether wp eval-file succeeded, failed, or was killed by timeout).
rc_evalfile() {  # \$1 = remote dotfile name
  cat <<CMD
cd $DOCROOT || { echo 'eval docroot-missing'; exit 3; }
cat > \$HOME/$1 && t=''; command -v timeout >/dev/null 2>&1 && t='timeout 60'; \$t wp eval-file \$HOME/$1 2>&1; rc=\$?; rm -f \$HOME/$1; exit \$rc
CMD
}
# Fallback path. Limit Login Attempts Reloaded keeps these in wp_options under exactly these names — that is from
# memory of the plugin and is UNVERIFIABLE FROM HERE, which is why every one is read back below.
rc_llar() {
  cat <<CMD
cd $DOCROOT || { echo 'llar docroot-missing'; exit 3; }
wp option update limit_login_allowed_retries 5 >/dev/null 2>&1 || echo 'llar set-failed limit_login_allowed_retries'
wp option update limit_login_lockout_duration 14400 >/dev/null 2>&1 || echo 'llar set-failed limit_login_lockout_duration'
wp option update limit_login_allowed_lockouts 3 >/dev/null 2>&1 || echo 'llar set-failed limit_login_allowed_lockouts'
wp option update limit_login_long_duration 86400 >/dev/null 2>&1 || echo 'llar set-failed limit_login_long_duration'
wp option update limit_login_notify_email_after 1 >/dev/null 2>&1 || echo 'llar set-failed limit_login_notify_email_after'
wp option update limit_login_lockout_notify email >/dev/null 2>&1 || echo 'llar set-failed limit_login_lockout_notify'
printf 'llar limit_login_allowed_retries='; wp option get limit_login_allowed_retries 2>/dev/null || echo ABSENT
printf 'llar limit_login_lockout_duration='; wp option get limit_login_lockout_duration 2>/dev/null || echo ABSENT
printf 'llar limit_login_allowed_lockouts='; wp option get limit_login_allowed_lockouts 2>/dev/null || echo ABSENT
printf 'llar limit_login_long_duration='; wp option get limit_login_long_duration 2>/dev/null || echo ABSENT
printf 'llar limit_login_notify_email_after='; wp option get limit_login_notify_email_after 2>/dev/null || echo ABSENT
printf 'llar limit_login_lockout_notify='; wp option get limit_login_lockout_notify 2>/dev/null || echo ABSENT
printf 'llar limit_login_client_type='; wp option get limit_login_client_type 2>/dev/null || echo 'ABSENT (default, left alone)'
printf 'llar remote_addr='; wp eval 'echo \$_SERVER["REMOTE_ADDR"] ?? "n/a";' 2>/dev/null; echo
CMD
}

# ── main ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
LOG="$(mktemp /tmp/wp-harden-login.XXXXXX)"; A=""; P=""
mkdir -p "$(dirname "$STAMP")"
cleanup() { [ -n "$A" ] && rm -f "$A"; [ -n "$P" ] && rm -f "$P"; return 0; }
trap cleanup EXIT INT TERM

TS="$(date -u +%FT%TZ)"
say "wp-harden-login $TS — atlasglinn.com ($HOST:$DOCROOT), login form $LOGIN_URL"
before_code="$(login_code)"
say "before: wp-login.php HTTP $before_code  (200 = the form loads; 200 is also the EXPECTED value after this run — the"
say "        lockout applies to failed POSTs, not to fetching the page. 429 = GoDaddy's edge rate-control, not a plugin.)"

U="$(kc_acct "$KC_SFTP" || true)"
if [ -z "$U" ] || ! kc_pw "$KC_SFTP" >/dev/null 2>&1; then
  say "no Keychain item '$KC_SFTP' (the atlasglinn.com SFTP/SSH login) on this Mac — nothing can be installed from here."
  say "Next: bash scripts/wp-upload.sh --save-login saves it once, then re-run this script."
  path="none"; result="no-keychain"; active=""
else
  # The password never leaves the Keychain: ssh asks the helper for it at connect time (OpenSSH 8.4+ honours
  # SSH_ASKPASS_REQUIRE=force). It is never printed, never in the log, never in git.
  A="$(mktemp /tmp/wp-harden-askpass.XXXXXX)"
  printf '#!/bin/sh\nexec security find-generic-password -s %s -w\n' "$KC_SFTP" > "$A"; chmod 700 "$A"
  export SSH_ASKPASS="$A" SSH_ASKPASS_REQUIRE=force DISPLAY="${DISPLAY:-:0}"

  pre="$(rsh "$(rc_preflight)" 2>&1)"
  core="$(printf '%s\n' "$pre" | sed -n 's/^preflight core-version //p' | head -1)"
  adm="$(printf '%s\n' "$pre" | sed -n 's/^preflight admin-email //p' | head -1)"
  pstat() { printf '%s\n' "${pre:-}" | awk -F, -v n="$1" '$1==n{print $2; exit}'; }
  wf="$(pstat wordfence)"; llar="$(pstat limit-login-attempts-reloaded)"; tfa="$(pstat two-factor)"
  npl="$(printf '%s\n' "$pre" | sed -n '/plugin-list-begin/,/plugin-list-end/p' | grep -cv 'plugin-list-\|^name,status')"
  say "preflight: WordPress ${core:-UNREADABLE} · admin_email ${adm:-UNREADABLE} · $npl plugins installed"
  say "preflight: wordfence=${wf:-absent} limit-login-attempts-reloaded=${llar:-absent} two-factor=${tfa:-absent}"
  ok_pre=1
  case "${core:-}" in ''|*docroot-missing*|*'command not found'*|*Error:*) ok_pre=0 ;; esac

  path=""; active=""; result="preflight-failed"
  if [ "$ok_pre" = 0 ]; then
    path="none"
    say "preflight did not return a WordPress version — the SSH login or WP-CLI is not usable from here, so nothing is installed."
    say "${pre:-preflight: no output at all (ssh never connected)}"
  else
    if [ "$wf" = active ] || [ "$wf" = active-network ]; then
      path="already"; active="wordfence"
      say "wordfence is already $wf — install skipped; its login settings are re-applied and read back below."
    elif [ "$llar" = active ] || [ "$llar" = active-network ]; then
      path="already"; active="llar"
      say "limit-login-attempts-reloaded is already $llar — install skipped (two-factor=${tfa:-absent}); its options are re-applied and read back below."
    elif [ -n "$wf" ]; then
      say "wordfence is installed but $wf — activating it, no install."
      out="$(rsh "$(rc_activate wordfence)" 2>&1)"; say "$out"
      case "$out" in *'is-active wordfence yes'*) path="wordfence"; active="wordfence" ;; esac
    else
      say "ABOUT TO INSTALL — wordfence (Wordfence Security, free, from wordpress.org) on atlasglinn.com, activated, then"
      say "  login lockouts (5 failures / 4 h), invalid-username lockout, author-scan block, alerts to $ALERT_EMAIL."
      say "  If GoDaddy refuses it, the fallback is limit-login-attempts-reloaded + two-factor. No WAF rule, no auto_prepend."
      out="$(rsh "$(rc_install wordfence)" 2>&1)"; say "$out"
      case "$out" in *'is-active wordfence yes'*) path="wordfence"; active="wordfence" ;; esac
    fi

    if [ -z "$path" ] || [ -z "$active" ]; then
      say "wordfence did not end up active. GoDaddy Managed WordPress maintains a blocklist of disallowed plugins and"
      say "whether wordfence is on it is UNVERIFIABLE FROM HERE — taking the fallback path automatically."
      out="$(rsh "$(rc_install limit-login-attempts-reloaded)" 2>&1)"; say "$out"
      case "$out" in *'is-active limit-login-attempts-reloaded yes'*) path="llar"; active="llar" ;; esac
      out="$(rsh "$(rc_install two-factor)" 2>&1)"; say "$out"
      case "$out" in *'is-active two-factor yes'*) [ -n "$active" ] || { path="llar"; active="two-factor"; } ;; esac
    fi

    nset=0
    if [ "$active" = wordfence ]; then
      P="$(mktemp /tmp/wp-harden-wf.XXXXXX)"
      cat > "$P" <<'PHP'
<?php
// Wordfence keeps its settings in its own table through wfConfig, not in wp_options — hence eval-file rather than
// `wp option update`. The key names below are from memory of the Wordfence source and are UNVERIFIABLE FROM HERE, so
// each one is set and then READ BACK: a key this build does not know prints ABSENT(unknown key) rather than being
// reported as applied. Nothing here touches server files — no wfWAF install, no auto_prepend_file.
if (!class_exists('wfConfig')) { echo "wf: wfConfig not found — Wordfence is not loaded under WP-CLI\n"; exit(2); }
if (!method_exists('wfConfig', 'set') || !method_exists('wfConfig', 'get')) { echo "wf: wfConfig has no set()/get()\n"; exit(2); }
echo 'wf: wordfence version ' . (defined('WORDFENCE_VERSION') ? WORDFENCE_VERSION : 'unknown') . "\n";
$sentinel = '__wf_absent__';
$read = function ($k) use ($sentinel) {
    try { $v = wfConfig::get($k, $sentinel); } catch (\Throwable $e) { return 'THREW(' . str_replace("\n", ' ', $e->getMessage()) . ')'; }
    if ($v === $sentinel) { return 'ABSENT(unknown key)'; }
    if ($v === null) { return 'NULL'; }
    if (is_array($v)) { return json_encode($v); }
    if ($v === '') { return '(empty)'; }
    if (is_bool($v)) { return $v ? 'true' : 'false'; }
    return str_replace("\n", '\n', (string) $v);
};
$want = array(
    'loginSecurityEnabled'       => 1,
    'loginSec_maxFailures'       => 5,
    'loginSec_maxForgotPasswd'   => 5,
    'loginSec_countFailMins'     => 240,
    'loginSec_lockoutMins'       => 240,
    'loginSec_lockInvalidUsers'  => 1,
    'loginSec_strongPasswds'     => 1,
    'loginSec_disableAuthorScan' => 1,
    'loginSec_userBlacklist'     => "admin\nadministrator\ntest",
    'alertEmails'                => 'matthew@atlasglinn.com',
    'alertOn_loginLockout'       => 1,
    'alertOn_block'              => 1,
    'alertOn_adminLogin'         => 1,
);
foreach ($want as $k => $v) {
    // loginSec_strongPasswds is set only where a key of that name already exists (its documented values are strings
    // such as 'pubs'/'admins', so writing 1 into a build that does not carry it would invent a setting).
    if ($k === 'loginSec_strongPasswds' && $read($k) === 'ABSENT(unknown key)') { echo "wf: loginSec_strongPasswds — no key of that name; not set\n"; continue; }
    try { wfConfig::set($k, $v); }
    catch (\Throwable $e) { echo 'wf: set ' . $k . ' threw ' . str_replace("\n", ' ', $e->getMessage()) . "\n"; }
}
foreach (array_keys($want) as $k) { echo 'wf: ' . $k . '=' . $read($k) . "\n"; }
echo 'wf: extended protection (auto_prepend_file) ' . ((defined('WFWAF_AUTO_PREPEND') && WFWAF_AUTO_PREPEND) ? 'ON' : 'off') . " — read only, not changed here\n";
PHP
      wfout="$(rsh "$(rc_evalfile .wp-harden-wf.php)" "$P" 2>&1)"; rm -f "$P"; P=""
      say "${wfout:-wf: no output (ssh failed before wp ran)}"
      nset="$(printf '%s\n' "$wfout" | grep -E '^wf: [A-Za-z_]+=' | grep -cv 'ABSENT\|NULL\|THREW')"
    elif [ "$active" = two-factor ]; then
      say "two-factor is active but limit-login-attempts-reloaded is not — no lockout options are written (they belong to"
      say "      that plugin); two-factor is enrolled per user in wp-admin → Users → Profile → Two-Factor Options."
    elif [ "$active" = llar ]; then
      llout="$(rsh "$(rc_llar)" 2>&1)"
      say "${llout:-llar: no output (ssh failed before wp ran)}"
      say "llar: client_type is left at its default — which header carries the real client IP behind GoDaddy's CDN is"
      say "      UNVERIFIABLE FROM HERE, and WP-CLI has no HTTP request, so the remote_addr above is the CLI's, not a visitor's."
      nset="$(printf '%s\n' "$llout" | grep -E '^llar limit_login_[a-z_]+=' | grep -cv 'ABSENT')"
    fi

    if [ -n "$active" ]; then
      slug="$active"; [ "$slug" = llar ] && slug="limit-login-attempts-reloaded"
      ver="$(rsh "$(rc_verify "$slug")" 2>&1)"; say "$ver"
      case "$ver" in *'rc=0'*) result="hardened" ;; *) result="not-active"; active="" ;; esac
    else
      result="nothing-activated"
    fi
    [ "$path" = already ] && [ "$result" = hardened ] && result="already-hardened"
  fi
fi

after_code="$(login_code)"
say "after:  wp-login.php HTTP $after_code (expected 200 — the form still loads; that is not a failure)"
echo "$TS ${path:-none} ${result:-failed}" > "$STAMP"
if [ -n "${active:-}" ] && { [ "${result:-}" = hardened ] || [ "${result:-}" = already-hardened ]; }; then
  say "LOOP STATUS: wp-login hardening — FIRED-OBSERVED (${active} active by is-active rc=0, ${nset:-0} settings read back from the host, wp-login.php $before_code→$after_code); heartbeat $STAMP ✓"
else
  say "LOOP STATUS: wp-login hardening — NOT confirmed firing: ${result:-failed} (path ${path:-none}). Next: read the log below, then re-run; the manual fallback is wp-admin → Plugins → Add New → Wordfence Security. Heartbeat $STAMP."
fi

# Delivery. The EMAIL rule: a report he cannot see did not happen — and when no connector is present, say so rather
# than failing quietly. atlas-email reads MS_CLIENT_ID/MS_TENANT_ID from ~/.zshrc, which only an interactive shell
# sources (brain vault `02-projects/scheduled-email-silent-failure-2026-08-26.md`), so it is sourced for the one call.
SUBJ="wp-harden-login $TS — ${result:-failed}"
if [ -x "$MAILER" ]; then
  body="$(cat "$LOG")"
  t=""; command -v timeout >/dev/null 2>&1 && t="timeout 120"
  if [ -z "${MS_CLIENT_ID:-}" ] && [ -f "$HOME/.zshrc" ] && command -v zsh >/dev/null 2>&1; then
    $t zsh -c 'source ~/.zshrc >/dev/null 2>&1; exec "$1" send --to "$2" --subject "$3" --body "$4"' _ "$MAILER" "$ALERT_EMAIL" "$SUBJ" "$body" >/dev/null 2>&1
  else
    $t "$MAILER" send --to "$ALERT_EMAIL" --subject "$SUBJ" --body "$body" >/dev/null 2>&1
  fi
  rc=$?
  [ "$rc" = 0 ] && say "emailed the log to $ALERT_EMAIL" || say "atlas-email exited $rc — the log was NOT emailed; it is at $LOG"
else
  say "no email connector on this Mac ($MAILER missing) — the log was NOT emailed."
fi
say "log: $LOG"
[ -n "${active:-}" ]
