#!/usr/bin/env bash
# Flush GoDaddy Managed WordPress's cache for atlasglinn.com from the Mac — no dashboard click.
#
# Why (Brockmann, 2026-09-07: "Can't find flush in app … You do actually have GoDaddy access"): the vault records the
# access a Mac session has — the WordPress application password of the admin user in the macOS Keychain (item
# `wp_app_password_claude`, rotated 2026-09-03; `04-resources/agent-memory/project_atlasglinn_wordpress.md`) and the
# SFTP/SSH login (`mast-wp-sftp`). GoDaddy's cache clears itself when WordPress content changes, so the REST API with the
# application password is the automated Flush Cache. A cloud session has none of this; the Mac's hourly job runs it after
# every upload (scripts/wp-upload.sh), and the capture probe's `self-refresh:` lines show the plain URL "fresh" afterwards.
#
#   bash scripts/wp-flush.sh              # flush, then measure the plain /mastsolutions.html against the cache-busted copy
#   WP_FLUSH_SSH=1 bash scripts/wp-flush.sh   # also try WP-CLI over SSH (any GoDaddy cache command it finds, plus `wp cache flush`)
#   WP_FLUSH_SSH=1 WP_FLUSH_DIAG=1 bash scripts/wp-flush.sh   # plus a read-only DIAG dump of the host's cache classes/hooks
#
# 2026-09-08: `wp cache flush` clears the OBJECT cache only — the vault has said so since April
# (agent-memory/project_atlasglinn_wordpress.md:16) and the 09-08 run proved it again: ssh ran, the plain URL still served
# [Mon, 07 Sep 2026 12:26:11 GMT]. The dashboard's Flush Cache button is `$GLOBALS['wpaas_cache_class']` (WPaaS\Cache_V2)
# calling do_ban() (Varnish) + flush_cdn() (Cloudflare) + flush_transients() + flush_object_cache()
# (agent-memory/project_session_2026_04_30_atlasglinn_careers_form.md:25-27). Method B now fires that exact cascade through
# `wp eval-file` over the same SSH login, so the button is no longer the fallback.
#
# Method A (REST): a private page with slug `cache-bust` (created once, never public) gets its content updated with the
# time; the GoDaddy system plugin purges the site cache on that save. Method B (SSH): `wp cli cmd-dump` is searched for a
# GoDaddy/WPaaS cache command, which is run beside `wp cache flush`. Both are measured: the plain URL's Last-Modified must
# move to the cache-busted copy's. Heartbeat: ~/.cache/wp-upload/last-flush = "<time> <method> <result>".
set -u
KC_WP="${KC_WP:-wp_app_password_claude}"; KC_SFTP="${KC_SFTP:-mast-wp-sftp}"
WP_BASE="${WP_BASE:-https://www.atlasglinn.com}"; HOST="${WP_HOST:-1127220.us12.ssh.myftpupload.com}"; DOCROOT="${WP_DOCROOT:-html}"
SITE="https://atlasglinn.com/mastsolutions.html"
STAMP="$HOME/.cache/wp-upload/last-flush"; mkdir -p "$(dirname "$STAMP")"
say() { printf '%s\n' "$*"; }
hdr() { curl -sL -A "wp-flush" -o /dev/null -D - "$1" 2>/dev/null | tr -d '\r' | awk -v k="$2" 'tolower($1)==k":" {sub(/^[^:]*: */,""); v=$0} END{print v}'; }
kc_pw() { security find-generic-password -s "$1" -w 2>/dev/null; }
kc_acct() { security find-generic-password -s "$1" 2>/dev/null | sed -n 's/^ *"acct"<blob>="\(.*\)"$/\1/p'; }

TS="$(date -u +%FT%TZ)"
before_plain="$(hdr "$SITE" last-modified)"; busted="$(hdr "$SITE?x=$(date +%s)" last-modified)"
say "before: plain Last-Modified [$before_plain]  cache-busted [$busted]"
if [ -n "$before_plain" ] && [ "$before_plain" = "$busted" ]; then
  say "nothing to flush: the plain URL already serves the latest upload"; echo "$TS none already-fresh" > "$STAMP"; exit 0
fi

method=""; result="failed"
# ── Method A: WordPress REST with the application password ──────────────────────────────────────────────────────────────
APP_PW="$(kc_pw "$KC_WP" || true)"
if [ -n "$APP_PW" ]; then
  APP_USER="${WP_APP_USER:-$(kc_acct "$KC_WP")}"; APP_USER="${APP_USER:-1006850pwpadmin}"
  api() { curl -sS -m 40 -L --post301 --post302 -u "$APP_USER:$APP_PW" -H "Content-Type: application/json" "$@"; }
  id="$(api "$WP_BASE/wp-json/wp/v2/pages?slug=cache-bust&status=private&context=edit&per_page=1" 2>/dev/null | python3 -c 'import json,sys
try:
    d=json.load(sys.stdin); print(d[0]["id"] if isinstance(d,list) and d else "")
except Exception: print("")')"
  if [ -z "$id" ]; then
    id="$(api -X POST "$WP_BASE/wp-json/wp/v2/pages" --data "{\"title\":\"cache-bust\",\"slug\":\"cache-bust\",\"status\":\"private\",\"content\":\"cache flush marker $TS (private; scripts/wp-flush.sh)\"}" 2>/dev/null | python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("id",""))
except Exception: print("")')"
    [ -n "$id" ] && say "created the private cache-bust page (id $id)"
  fi
  if [ -n "$id" ]; then
    code="$(api -o /tmp/wp-flush.out -w '%{http_code}' -X POST "$WP_BASE/wp-json/wp/v2/pages/$id" --data "{\"content\":\"cache flush marker $TS (private; scripts/wp-flush.sh)\"}" 2>/dev/null || echo ERR)"
    if [ "$code" = 200 ]; then method="rest"; say "REST: private page $id saved (the host purges its cache on content changes)"
    else say "REST: HTTP $code $(head -c 160 /tmp/wp-flush.out 2>/dev/null)"; fi
  else
    say "REST: could not find or create the cache-bust page (application password rejected, or REST blocked)"
  fi
else
  say "no Keychain item '$KC_WP' (the WordPress application password) on this Mac; REST flush skipped"
fi

# Did the REST save actually clear the edge? (2026-09-08: two uploads with no click, 23:50 and 04:11 UTC, and the runner
# still saw the day-old plain copies afterwards — the private-page save returned 200 but purged nothing static.) When it
# did not, the SSH path runs as well instead of being skipped.
need_ssh=0
if [ -n "$method" ]; then
  sleep 12; mid_plain="$(hdr "$SITE" last-modified)"
  if [ -z "$mid_plain" ] || [ "$mid_plain" != "$busted" ]; then need_ssh=1; say "REST save did not clear the plain URL (still [$mid_plain]); trying WP-CLI over SSH"; fi
fi
# ── Method B: WP-CLI over SSH (opt-in, when REST did nothing, or when REST cleared nothing) ─────────────────────────────
if [ "${WP_FLUSH_SSH:-0}" = 1 ] || [ -z "$method" ] || [ "$need_ssh" = 1 ]; then
  U="$(kc_acct "$KC_SFTP" || true)"
  if [ -n "$U" ] && kc_pw "$KC_SFTP" >/dev/null 2>&1; then
    A="$(mktemp /tmp/wp-flush-askpass.XXXXXX)"; printf '#!/bin/sh\nexec security find-generic-password -s %s -w\n' "$KC_SFTP" > "$A"; chmod 700 "$A"
    export SSH_ASKPASS="$A" SSH_ASKPASS_REQUIRE=force DISPLAY="${DISPLAY:-:0}"
    cmds="$(ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 "$U@$HOST" "cd $DOCROOT && wp cli cmd-dump --format=json 2>/dev/null" 2>/dev/null | python3 -c '
import json,sys
def walk(n, path):
    name = (path + " " + n.get("name","")).strip()
    yield name
    for s in n.get("subcommands", []): yield from walk(s, name)
try:
    d = json.load(sys.stdin)
    for top in d.get("subcommands", []):          # skip the root "wp" itself
        for name in walk(top, ""):
            low = name.lower()
            if low == "cache flush": continue       # run separately below
            if ("flush" in low or "purge" in low) and any(k in low for k in ("gd", "godaddy", "wpaas", "system")): print(name)
except Exception: pass' | head -5)"
    say "SSH: cache commands found: ${cmds:-none}"
    out="$(ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 "$U@$HOST" "cd $DOCROOT && wp cache flush 2>&1$(printf '%s\n' "$cmds" | grep -v '^$' | sed 's/^/ ; wp /' | tr -d '\n' | sed 's/ ; wp cache flush//')" 2>&1 | tail -3)"
    say "SSH: $out"; [ -n "$method" ] || method="ssh"
    # The dashboard button's own cascade (WPaaS\Cache_V2: Varnish ban + Cloudflare CDN purge + transients + object cache),
    # run inside WordPress by WP-CLI with the mu-plugins loaded. The PHP travels on ssh's stdin — nothing to quote — into a
    # file in the login's home for the one call, then it is removed. Reflection covers the methods being non-public.
    P="$(mktemp /tmp/wp-flush-cascade.XXXXXX)"
    cat > "$P" <<'PHP'
<?php
$c = isset($GLOBALS['wpaas_cache_class']) ? $GLOBALS['wpaas_cache_class'] : null;
if (is_string($c) && class_exists($c)) { try { $c = new $c(); } catch (\Throwable $e) { $c = null; } }
if (!is_object($c) && class_exists('WPaaS\Cache_V2')) {
  foreach (array('instance', 'get_instance', 'getInstance') as $acc) {   // singleton accessors first: a private constructor is the likely shape
    if (is_callable(array('\WPaaS\Cache_V2', $acc))) { try { $c = \call_user_func(array('\WPaaS\Cache_V2', $acc)); } catch (\Throwable $e) { $c = null; } }
    if (is_object($c)) { break; }
  }
  if (!is_object($c)) { try { $c = new \WPaaS\Cache_V2(); } catch (\Throwable $e) { $c = null; } }
}
if (!is_object($c)) { echo "wpaas-cascade: no WPaaS cache class (GoDaddy system plugin not loaded?)\n"; exit(2); }
$done = array();
foreach (array('do_ban', 'flush_cdn', 'flush_transients', 'flush_object_cache') as $m) {
  if (!method_exists($c, $m)) { $done[] = $m . ':missing'; continue; }
  try { $r = new \ReflectionMethod($c, $m); $r->setAccessible(true); $r->invoke($c); $done[] = $m . ':ok'; }
  catch (\Throwable $e) { $done[] = $m . ':' . str_replace("\n", ' ', $e->getMessage()); }
}
echo 'wpaas-cascade: ' . get_class($c) . ' ' . implode(' ', $done) . "\n";
PHP
    # flush_cdn() calls the Cloudflare API and is the one step that can stall; the remote `timeout 90` bounds it (the host is
    # Linux, coreutils present) so the hourly job that runs this script cannot hang on it, and the file is removed either way.
    # `timeout` is coreutils; GoDaddy's restricted shell may not carry it, so it is used only when present (2026-09-08: the
    # first run after the cascade landed still printed method `ssh`, and a missing `timeout` would explain that silently).
    casc="$(ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 -o ServerAliveInterval=15 -o ServerAliveCountMax=4 "$U@$HOST" "cd $DOCROOT && cat > \$HOME/.wp-flush-cascade.php && t=''; command -v timeout >/dev/null 2>&1 && t='timeout 90'; \$t wp eval-file \$HOME/.wp-flush-cascade.php 2>&1; rc=\$?; rm -f \$HOME/.wp-flush-cascade.php; [ \$rc = 124 ] && echo 'wpaas-cascade: timed out after 90s (Cloudflare API stall?)'; exit \$rc" < "$P" 2>&1 | tail -3)"
    rm -f "$P"
    say "SSH: ${casc:-wpaas-cascade: no output (ssh failed before wp ran)}"
    case "$casc" in *"flush_cdn:ok"*) method="ssh-wpaas";; esac
    # WP_FLUSH_DIAG=1: when the cascade does not report flush_cdn:ok, print what the host actually has — which classes,
    # globals, methods (with visibility and arity) and flush/purge hooks the GoDaddy system plugin exposes under WP-CLI —
    # so the next fix is written from a measurement, not a guess. Read-only; nothing is flushed by this block.
    if [ "${WP_FLUSH_DIAG:-0}" = 1 ]; then
      D="$(mktemp /tmp/wp-flush-diag.XXXXXX)"
      cat > "$D" <<'PHP'
<?php
if (!function_exists('get_mu_plugins') && defined('ABSPATH') && is_file(ABSPATH . 'wp-admin/includes/plugin.php')) { require_once ABSPATH . 'wp-admin/includes/plugin.php'; }
echo 'DIAG php=' . PHP_VERSION . ' wp=' . get_bloginfo('version') . ' cli=' . (defined('WP_CLI') ? 'yes' : 'no') . ' host=' . php_uname('n') . "\n";
echo 'DIAG mu-plugins: ' . (function_exists('get_mu_plugins') ? implode(', ', array_keys(get_mu_plugins())) : 'n/a') . "\n";
$classes = array();
foreach (get_declared_classes() as $k) { if (stripos($k, 'wpaas') !== false || stripos($k, 'godaddy') !== false || stripos($k, 'gd_') === 0) { $classes[] = $k; } }
echo 'DIAG classes (wpaas/godaddy): ' . (count($classes) ? implode(', ', $classes) : 'NONE') . "\n";
$g = array(); foreach (array_keys($GLOBALS) as $k) { if (stripos($k, 'wpaas') !== false || stripos($k, 'gd_') === 0 || stripos($k, 'cache') !== false) { $v = $GLOBALS[$k]; $g[] = $k . '=' . (is_object($v) ? get_class($v) : gettype($v)); } }
echo 'DIAG globals: ' . (count($g) ? implode(', ', $g) : 'NONE') . "\n";
foreach ($classes as $cls) {
  if (stripos($cls, 'cache') === false) { continue; }
  $r = new \ReflectionClass($cls); $m = array();
  foreach ($r->getMethods() as $x) { $m[] = ($x->isPublic() ? '+' : ($x->isProtected() ? '#' : '-')) . ($x->isStatic() ? 'static:' : '') . $x->getName() . '/' . $x->getNumberOfRequiredParameters(); }
  echo 'DIAG ' . $cls . ' ctor=' . ($r->getConstructor() ? ($r->getConstructor()->isPublic() ? 'public' : 'non-public') : 'none') . ' methods: ' . implode(' ', $m) . "\n";
}
global $wp_filter; $hooks = array();
foreach (array_keys((array) $wp_filter) as $h) { if (stripos($h, 'flush') !== false || stripos($h, 'purge') !== false || stripos($h, 'wpaas') !== false || stripos($h, 'cache') !== false) { $hooks[] = $h; } }
echo 'DIAG hooks (flush/purge/wpaas/cache): ' . (count($hooks) ? implode(', ', $hooks) : 'NONE') . "\n";
PHP
      diag="$(ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 "$U@$HOST" "cd $DOCROOT && echo \"DIAG shell: timeout=\$(command -v timeout || echo MISSING) wp=\$(command -v wp || echo MISSING) \$(wp cli version 2>/dev/null | head -1)\"; ls wp-content/mu-plugins 2>/dev/null | sed 's/^/DIAG mu-file: /' | head -12; cat > \$HOME/.wp-flush-diag.php && wp eval-file \$HOME/.wp-flush-diag.php 2>&1 | head -40; rm -f \$HOME/.wp-flush-diag.php" < "$D" 2>&1)"
      rm -f "$D"
      printf '%s\n' "${diag:-DIAG: no output (ssh failed)}"
    fi
    rm -f "$A"
  else
    say "no Keychain item '$KC_SFTP' (the SFTP/SSH login); SSH flush skipped"
  fi
fi

sleep 12
after_plain="$(hdr "$SITE" last-modified)"; cf="$(hdr "$SITE" cf-cache-status)"
if [ -n "$after_plain" ] && [ "$after_plain" = "$busted" ]; then result="cleared"; else result="still-stale"; fi
echo "$TS ${method:-none} $result" > "$STAMP"
say "after:  plain Last-Modified [$after_plain] (cf-cache-status $cf) → $result"
if [ "$result" = cleared ]; then
  say "LOOP STATUS: GoDaddy cache flush — FIRED-OBSERVED (plain URL now serves the latest upload) via ${method}; heartbeat $STAMP ✓"
else
  say "LOOP STATUS: GoDaddy cache flush — ran (${method:-no method available}) but the plain URL still serves [$after_plain]; the dashboard's Flush Cache is the fallback. Heartbeat $STAMP."
fi
[ "$result" = cleared ]
