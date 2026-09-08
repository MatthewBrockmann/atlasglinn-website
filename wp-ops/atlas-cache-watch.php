<?php
/**
 * Plugin Name: Atlas Cache Watch
 * Description: Runs GoDaddy's own Flush Cache cascade when the static pages in the docroot change, and when the private cache-bust page is saved.
 * Version: 1.1.0
 * Author: atlasglinn-website (scripts/wp-cache-watch-deploy.sh)
 *
 * Purpose. The static pages (mastsolutions.html, index.html, …) are uploaded into this WordPress docroot by
 * scripts/wp-upload.sh and GoDaddy's Cloudflare CDN keeps them for 31 days (cache-control: public, max-age=2678400).
 * Only the dashboard's Flush Cache clears them, and that button is $GLOBALS['wpaas_cache_class'] (WPaaS\Cache_V2)
 * calling do_ban() + flush_cdn() + flush_transients() + flush_object_cache(). Measured 2026-09-08 18:46 UTC: the saved
 * GoDaddy login `mast-wp-sftp` answers "This service allows sftp connections only.", so WP-CLI over SSH cannot run
 * that cascade from the Mac, and the WordPress application password is not on the Mac either. What still works is the
 * SFTP upload — and WordPress, running on the host, can see what the upload changed. This file watches the docroot
 * from WP-Cron and fires the same cascade within 15 minutes of a change.
 *
 * What it watches: every *.html at the docroot root (glob, no recursion — wp-admin and wp-includes are not ours) plus
 * build-manifest.json and mast-ping.txt, as name:mtime:size, sha1'd into one fingerprint.
 *
 * Why there is no endpoint. A token-protected REST route was considered and rejected: it would add a remote-control
 * surface to a production site for a job that needs no caller. This file adds no route of its own. The only remote
 * reachability it has is stock WordPress /wp-cron.php, which any caller can already hit: that can advance the tick,
 * but it cannot make this purge — the tick only acts when the docroot fingerprint has moved, and the fingerprint is
 * computed from the filesystem, never from anything a caller sends.
 *
 * What it writes: two options, both autoload=no — atlas_cache_watch_fp (fingerprint, file map, last-tick stamp, the
 * consecutive-failure counter) and atlas_cache_watch_last (last purge time, changed names, per-method results) — plus
 * a two-minute lock transient (atlas_cache_watch_lock) while a cascade runs, and ONE error_log line per purge, which
 * carries counts and a 0/1 only. No exception text is ever logged or stored: a CDN client's exception message can
 * carry a token or a signed URL, so a failure is recorded as 'error:<exception class>:<sha1 prefix of the message>'.
 *
 * What it never does: no HTTP input of any kind, no REST route, no admin UI, no file writes, no requests of its own,
 * no change to any post, option or setting beyond the two options and the lock above.
 *
 * Bounded, and it gives up. The cascade runs under set_time_limit(60) (the previous limit is restored after) because
 * flush_cdn() calls the Cloudflare API and can stall. When a tick's cascade does not report flush_cdn=ok the new
 * fingerprint is NOT recorded, so the next tick retries — but after 3 consecutive failures the fingerprint is recorded
 * anyway and cdn stays `no`, so a permanent failure costs one cascade per change instead of one every 15 minutes. The
 * counter clears on the first success.
 *
 * Visibility without an endpoint: front-end responses carry
 *   X-Atlas-Cache-Watch: <version>;b=<build>;age=<fresh|hour|day|old|never>;cdn=<ok|no|none>;fp=<0|1>;tick=<fresh|hour|day|old|never>
 * where b = the first 8 of sha1 of this file (so a deploy can prove the bytes it just sent are the bytes running),
 * age = the last purge and tick = the last cron tick, both in coarse buckets (<15 min fresh, <1 h hour, <24 h day,
 * else old; never = it has not happened), and fp = whether a fingerprint is stored yet. No raw times: the buckets say
 * what an operator needs and nothing else. fp=0;tick=never means WP-Cron is not running this; fp=1;tick=fresh means it
 * is healthy and idle. Read-only; an outside caller gets a string and nothing to send.
 *
 * How to disable: add define('ATLAS_CACHE_WATCH_DISABLED', true); to wp-config.php, or delete
 * html/wp-content/mu-plugins/atlas-cache-watch.php over SFTP (bash scripts/wp-cache-watch-deploy.sh --remove).
 * Deleting the file stops everything but LEAVES the two options and the cron event behind — a must-use plugin gets no
 * uninstall hook. To clean up: define('ATLAS_CACHE_WATCH_UNINSTALL', true); in wp-config.php and let one request run.
 * On init the plugin then deletes both options, deletes the lock, unschedules atlas_cache_watch_tick, and does nothing
 * else — no cascade, no header, no tick — so the file can be removed on the next deploy.
 */

if (!defined('ABSPATH')) { exit; }

define('ATLAS_CACHE_WATCH_VERSION', '1.1.0');
define('ATLAS_CACHE_WATCH_HOOK', 'atlas_cache_watch_tick');
define('ATLAS_CACHE_WATCH_SCHEDULE', 'atlas_15min');
define('ATLAS_CACHE_WATCH_OPT_FP', 'atlas_cache_watch_fp');
define('ATLAS_CACHE_WATCH_OPT_LAST', 'atlas_cache_watch_last');
define('ATLAS_CACHE_WATCH_LOCK', 'atlas_cache_watch_lock');
define('ATLAS_CACHE_WATCH_GIVE_UP', 3);

function atlas_cache_watch_uninstalling() {
    return defined('ATLAS_CACHE_WATCH_UNINSTALL') && ATLAS_CACHE_WATCH_UNINSTALL;
}

// Off covers both switches: once the uninstall constant is set, every entry point below is a no-op, so the only thing
// that still happens is the one-time cleanup on init.
function atlas_cache_watch_off() {
    if (atlas_cache_watch_uninstalling()) { return true; }
    return defined('ATLAS_CACHE_WATCH_DISABLED') && ATLAS_CACHE_WATCH_DISABLED;
}

function atlas_cache_watch_uninstall() {
    delete_option(ATLAS_CACHE_WATCH_OPT_FP);
    delete_option(ATLAS_CACHE_WATCH_OPT_LAST);
    delete_transient(ATLAS_CACHE_WATCH_LOCK);
    if (function_exists('wp_clear_scheduled_hook')) {
        wp_clear_scheduled_hook(ATLAS_CACHE_WATCH_HOOK);
    }
}

// The first 8 of this file's own sha1: the deploy script sends the file, then reads this back off the wire to prove the
// bytes running are the bytes it sent (a same-version file that never replaced the old one is otherwise invisible).
function atlas_cache_watch_build() {
    static $b = null;
    if ($b === null) {
        $h = sha1_file(__FILE__);
        $b = is_string($h) ? substr($h, 0, 8) : '00000000';
    }
    return $b;
}

// Coarse buckets, never a raw epoch: an operator needs "is this fresh", not a timestamp on a public response.
function atlas_cache_watch_age($t) {
    $t = (int) $t;
    if ($t <= 0) { return 'never'; }
    $d = time() - $t;
    if ($d < 0) { $d = 0; }
    if ($d < 900) { return 'fresh'; }
    if ($d < 3600) { return 'hour'; }
    if ($d < 86400) { return 'day'; }
    return 'old';
}

// The dashboard's Flush Cache button, as scripts/wp-flush.sh runs it over `wp eval-file`: the class is a string in a
// global on this host, its constructor is not public, and the four methods are not public either.
function atlas_cache_watch_run() {
    $c = isset($GLOBALS['wpaas_cache_class']) ? $GLOBALS['wpaas_cache_class'] : null;
    // Allowlist before instantiation: the global names a class this file is about to construct, so it may only ever
    // name GoDaddy's own. Anything else is dropped and the run falls through to the WPaaS\Cache_V2 path below.
    if (!is_string($c) || strpos(ltrim($c, '\\'), 'WPaaS\\') !== 0) { $c = null; }
    if (is_string($c) && class_exists($c)) {
        try { $c = new $c(); } catch (\Throwable $e) { $c = null; }
    }
    if (!is_object($c) && class_exists('WPaaS\Cache_V2')) {
        foreach (array('instance', 'get_instance', 'getInstance') as $acc) {
            if (is_callable(array('\WPaaS\Cache_V2', $acc))) {
                try { $c = \call_user_func(array('\WPaaS\Cache_V2', $acc)); } catch (\Throwable $e) { $c = null; }
            }
            if (is_object($c)) { break; }
        }
        if (!is_object($c)) {
            try { $c = new \WPaaS\Cache_V2(); } catch (\Throwable $e) { $c = null; }
        }
    }
    if (!is_object($c)) {
        // No WPaaS class: the object cache is all there is to clear, and the record says class=null so a reader knows
        // the CDN was NOT purged rather than reading an empty result as success.
        if (function_exists('wp_cache_flush')) { wp_cache_flush(); }
        return array('class' => null, 'wp_cache_flush' => 'ok');
    }
    $out = array('class' => get_class($c));
    foreach (array('do_ban', 'flush_cdn', 'flush_transients', 'flush_object_cache') as $m) {
        if (!method_exists($c, $m)) { $out[$m] = 'missing'; continue; }
        try {
            $r = new \ReflectionMethod($c, $m);
            $r->setAccessible(true);
            $r->invoke($c);
            $out[$m] = 'ok';
        } catch (\Throwable $e) {
            // Never the message: a CDN client's exception can carry a token or a signed URL, and this string is stored
            // in an option and counted in the log. The class says what broke; the digest says whether it is the same
            // break as last time.
            $out[$m] = 'error:' . get_class($e) . ':' . substr(sha1($e->getMessage()), 0, 8);
        }
    }
    return $out;
}

// The lock lives here, not in the tick, so BOTH callers (the cron tick and the cache-bust save) are covered by it: one
// purge per two minutes whichever path arrives. It is left to expire rather than released, so a second run inside the
// window finds it. A locked call returns array('locked' => 1) and its caller records nothing.
function atlas_cache_watch_cascade() {
    if (get_transient(ATLAS_CACHE_WATCH_LOCK)) { return array('locked' => 1); }
    set_transient(ATLAS_CACHE_WATCH_LOCK, time(), 120);
    $limit = ini_get('max_execution_time');
    if (function_exists('set_time_limit')) { set_time_limit(60); }
    $out = atlas_cache_watch_run();
    if (function_exists('set_time_limit')) { set_time_limit($limit === false ? 0 : (int) $limit); }
    return $out;
}

function atlas_cache_watch_purged($results) {
    return isset($results['flush_cdn']) && $results['flush_cdn'] === 'ok';
}

function atlas_cache_watch_record($changed, $results) {
    update_option(ATLAS_CACHE_WATCH_OPT_LAST, array(
        'time'    => time(),
        'changed' => array_values($changed),
        'results' => $results,
    ), false);
    $ok = 0; $bad = 0;
    foreach (array('do_ban', 'flush_cdn', 'flush_transients', 'flush_object_cache') as $m) {
        if (!isset($results[$m])) { continue; }
        if ($results[$m] === 'ok') { $ok++; } else { $bad++; }
    }
    // Counts and a 0/1 — nothing from an exception, nothing from a response body.
    error_log('[atlas-cache-watch] changed=' . count($changed) . ' ok=' . $ok . ' failed=' . $bad
        . ' cdn=' . (atlas_cache_watch_purged($results) ? 1 : 0));
}

function atlas_cache_watch_store($fp, $map, $fail, $gaveup) {
    update_option(ATLAS_CACHE_WATCH_OPT_FP, array(
        'fp'     => $fp,
        'files'  => $map,
        'tick'   => time(),
        'fail'   => (int) $fail,
        'gaveup' => $gaveup ? 1 : 0,
    ), false);
}

// name => "mtime:size" for the static files the upload puts in the docroot: every *.html directly in ABSPATH (no
// recursion — wp-admin and wp-includes are not ours), plus the manifest and the upload's ping file.
function atlas_cache_watch_stat() {
    clearstatcache();
    $files = glob(ABSPATH . '*.html');
    if (!is_array($files)) { $files = array(); }
    foreach (array('build-manifest.json', 'mast-ping.txt') as $extra) {
        if (is_file(ABSPATH . $extra)) { $files[] = ABSPATH . $extra; }
    }
    $map = array();
    foreach ($files as $f) {
        if (!is_file($f)) { continue; }
        $map[basename($f)] = filemtime($f) . ':' . filesize($f);
    }
    ksort($map);
    return $map;
}

function atlas_cache_watch_fingerprint($map) {
    $parts = array();
    foreach ($map as $name => $stat) { $parts[] = $name . ':' . $stat; }
    return sha1(implode("\n", $parts));
}

function atlas_cache_watch_tick() {
    if (atlas_cache_watch_off()) { return; }
    $store  = get_option(ATLAS_CACHE_WATCH_OPT_FP, false);
    if (!is_array($store)) { $store = array(); }
    $prev   = (isset($store['files']) && is_array($store['files'])) ? $store['files'] : array();
    $fail   = isset($store['fail']) ? (int) $store['fail'] : 0;
    $gaveup = empty($store['gaveup']) ? 0 : 1;
    $map    = atlas_cache_watch_stat();
    $fp     = atlas_cache_watch_fingerprint($map);
    // Every tick refreshes the tick stamp, whatever else it decides: that stamp is the heartbeat limb of the header.
    if (!isset($store['fp'])) { atlas_cache_watch_store($fp, $map, 0, 0); return; }   // first tick records only
    if ($store['fp'] === $fp) { atlas_cache_watch_store($fp, $map, $fail, $gaveup); return; }
    $changed = array();
    foreach ($map as $name => $stat) {
        if (!isset($prev[$name]) || $prev[$name] !== $stat) { $changed[] = $name; }
    }
    foreach ($prev as $name => $stat) {
        if (!isset($map[$name])) { $changed[] = $name; }
    }
    sort($changed);
    $results = atlas_cache_watch_cascade();
    // Locked means another path is purging this same change right now: leave the fingerprint alone so the next tick
    // still sees the change if that run fails, and record nothing.
    if (isset($results['locked'])) { atlas_cache_watch_store($store['fp'], $prev, $fail, $gaveup); return; }
    if (atlas_cache_watch_purged($results)) {
        atlas_cache_watch_store($fp, $map, 0, 0);
    } elseif ($fail + 1 >= ATLAS_CACHE_WATCH_GIVE_UP) {
        // Three ticks in a row could not clear the CDN. Record the fingerprint anyway: the header keeps saying cdn=no,
        // and this change stops costing a cascade every 15 minutes. One success clears the counter.
        atlas_cache_watch_store($fp, $map, ATLAS_CACHE_WATCH_GIVE_UP, 1);
    } else {
        atlas_cache_watch_store($store['fp'], $prev, $fail + 1, $gaveup);
    }
    atlas_cache_watch_record($changed, $results);
}

// The private page scripts/wp-flush.sh Method A edits: saving it purges here, so Method A becomes real the day the
// application password is back on the Mac.
function atlas_cache_watch_save_page($post_id, $post = null, $update = null) {
    if (atlas_cache_watch_off()) { return; }
    if (function_exists('wp_is_post_autosave') && wp_is_post_autosave($post_id)) { return; }
    if (function_exists('wp_is_post_revision') && wp_is_post_revision($post_id)) { return; }
    $slug = is_object($post) && isset($post->post_name) ? $post->post_name : '';
    if ($slug !== 'cache-bust') { return; }
    $results = atlas_cache_watch_cascade();
    if (isset($results['locked'])) { return; }
    atlas_cache_watch_record(array('cache-bust'), $results);
}

function atlas_cache_watch_header_value() {
    $last = get_option(ATLAS_CACHE_WATCH_OPT_LAST, false);
    $age  = 'never';
    $cdn  = 'none';
    if (is_array($last)) {
        $age = atlas_cache_watch_age(isset($last['time']) ? $last['time'] : 0);
        $r   = (isset($last['results']) && is_array($last['results'])) ? $last['results'] : array();
        $cdn = atlas_cache_watch_purged($r) ? 'ok' : 'no';
    }
    $store = get_option(ATLAS_CACHE_WATCH_OPT_FP, false);
    $has   = (is_array($store) && isset($store['fp'])) ? '1' : '0';
    $tick  = atlas_cache_watch_age((is_array($store) && isset($store['tick'])) ? $store['tick'] : 0);
    return ATLAS_CACHE_WATCH_VERSION . ';b=' . atlas_cache_watch_build()
        . ';age=' . $age . ';cdn=' . $cdn . ';fp=' . $has . ';tick=' . $tick;
}

function atlas_cache_watch_send_header() {
    if (atlas_cache_watch_off()) { return; }
    if (function_exists('is_admin') && is_admin()) { return; }
    if (headers_sent()) { return; }
    header('X-Atlas-Cache-Watch: ' . atlas_cache_watch_header_value());
}

function atlas_cache_watch_schedules($schedules) {
    if (!is_array($schedules)) { $schedules = array(); }
    $schedules[ATLAS_CACHE_WATCH_SCHEDULE] = array(
        'interval' => 900,
        'display'  => 'Every 15 minutes (atlas-cache-watch)',
    );
    return $schedules;
}

function atlas_cache_watch_init() {
    if (atlas_cache_watch_off()) { return; }
    if (!wp_next_scheduled(ATLAS_CACHE_WATCH_HOOK)) {
        wp_schedule_event(time() + 60, ATLAS_CACHE_WATCH_SCHEDULE, ATLAS_CACHE_WATCH_HOOK);
    }
}

if (atlas_cache_watch_uninstalling()) { add_action('init', 'atlas_cache_watch_uninstall'); return; }
if (atlas_cache_watch_off()) { return; }

add_filter('cron_schedules', 'atlas_cache_watch_schedules');
add_action('init', 'atlas_cache_watch_init');
add_action(ATLAS_CACHE_WATCH_HOOK, 'atlas_cache_watch_tick');
add_action('save_post_page', 'atlas_cache_watch_save_page', 10, 3);
add_action('send_headers', 'atlas_cache_watch_send_header');
