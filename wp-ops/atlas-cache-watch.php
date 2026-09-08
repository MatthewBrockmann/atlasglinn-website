<?php
/**
 * Plugin Name: Atlas Cache Watch
 * Description: Runs GoDaddy's own Flush Cache cascade when the static pages in the docroot change, and when the private cache-bust page is saved.
 * Version: 1.0.0
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
 * Why there is no endpoint. A token-protected REST route was considered and rejected: it would add a remote-control
 * surface to a production site for a job that needs no caller. Everything here reacts to something WordPress already
 * observes — its own cron tick and its own save_post. There is no input path.
 *
 * What it touches: two options (atlas_cache_watch_fp, atlas_cache_watch_last) and one cron hook
 * (atlas_cache_watch_tick, on the custom 15-minute schedule atlas_15min, which matches the upload cadence).
 *
 * What it never does: no HTTP input of any kind, no REST route, no admin UI, no file writes, no requests of its own,
 * no change to any post, option or setting beyond the two options above.
 *
 * Visibility without an endpoint: front-end responses carry
 *   X-Atlas-Cache-Watch: <version>;last=<unix>;cdn=<ok|no|none>
 * so a plain HEAD from the Mac says whether this file is deployed and when it last purged. Read-only; an outside
 * caller gets a string and nothing to send.
 *
 * How to disable: delete html/wp-content/mu-plugins/atlas-cache-watch.php over SFTP
 * (bash scripts/wp-cache-watch-deploy.sh --remove), or add define('ATLAS_CACHE_WATCH_DISABLED', true); to wp-config.php.
 */

if (!defined('ABSPATH')) { exit; }

define('ATLAS_CACHE_WATCH_VERSION', '1.0.0');
define('ATLAS_CACHE_WATCH_HOOK', 'atlas_cache_watch_tick');
define('ATLAS_CACHE_WATCH_SCHEDULE', 'atlas_15min');
define('ATLAS_CACHE_WATCH_OPT_FP', 'atlas_cache_watch_fp');
define('ATLAS_CACHE_WATCH_OPT_LAST', 'atlas_cache_watch_last');
define('ATLAS_CACHE_WATCH_LOCK', 'atlas_cache_watch_lock');

function atlas_cache_watch_off() {
    return defined('ATLAS_CACHE_WATCH_DISABLED') && ATLAS_CACHE_WATCH_DISABLED;
}

// The dashboard's Flush Cache button, as scripts/wp-flush.sh runs it over `wp eval-file`: the class is a string in a
// global on this host, its constructor is not public, and the four methods are not public either.
function atlas_cache_watch_cascade() {
    $c = isset($GLOBALS['wpaas_cache_class']) ? $GLOBALS['wpaas_cache_class'] : null;
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
            $out[$m] = str_replace("\n", ' ', $e->getMessage());
        }
    }
    return $out;
}

function atlas_cache_watch_record($changed, $results) {
    update_option(ATLAS_CACHE_WATCH_OPT_LAST, array(
        'time'    => time(),
        'changed' => array_values($changed),
        'results' => $results,
    ));
    $cdn = isset($results['flush_cdn']) ? $results['flush_cdn'] : 'none';
    error_log('[atlas-cache-watch] changed=' . count($changed) . ' flush_cdn=' . $cdn);
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
    $map   = atlas_cache_watch_stat();
    $fp    = atlas_cache_watch_fingerprint($map);
    $store = get_option(ATLAS_CACHE_WATCH_OPT_FP, false);
    $prev  = (is_array($store) && isset($store['files']) && is_array($store['files'])) ? $store['files'] : array();
    $had   = is_array($store) && isset($store['fp']);
    if (!$had) {
        update_option(ATLAS_CACHE_WATCH_OPT_FP, array('fp' => $fp, 'files' => $map), false);
        return;
    }
    if ($store['fp'] === $fp) { return; }
    // One purge per change, not one per tick that races with the upload: the lock is taken only when there is
    // something to purge, and it is left to expire so a second run inside two minutes finds it.
    if (get_transient(ATLAS_CACHE_WATCH_LOCK)) { return; }
    set_transient(ATLAS_CACHE_WATCH_LOCK, time(), 120);
    $changed = array();
    foreach ($map as $name => $stat) {
        if (!isset($prev[$name]) || $prev[$name] !== $stat) { $changed[] = $name; }
    }
    foreach ($prev as $name => $stat) {
        if (!isset($map[$name])) { $changed[] = $name; }
    }
    sort($changed);
    $results = atlas_cache_watch_cascade();
    update_option(ATLAS_CACHE_WATCH_OPT_FP, array('fp' => $fp, 'files' => $map), false);
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
    atlas_cache_watch_record(array('cache-bust'), atlas_cache_watch_cascade());
}

function atlas_cache_watch_header_value() {
    $last = get_option(ATLAS_CACHE_WATCH_OPT_LAST, false);
    $time = (is_array($last) && isset($last['time'])) ? (int) $last['time'] : 0;
    $cdn  = 'none';
    if (is_array($last) && isset($last['results']) && is_array($last['results'])) {
        $r   = $last['results'];
        $cdn = (isset($r['flush_cdn']) && $r['flush_cdn'] === 'ok') ? 'ok' : 'no';
    }
    return ATLAS_CACHE_WATCH_VERSION . ';last=' . $time . ';cdn=' . $cdn;
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

if (atlas_cache_watch_off()) { return; }

add_filter('cron_schedules', 'atlas_cache_watch_schedules');
add_action('init', 'atlas_cache_watch_init');
add_action(ATLAS_CACHE_WATCH_HOOK, 'atlas_cache_watch_tick');
add_action('save_post_page', 'atlas_cache_watch_save_page', 10, 3);
add_action('send_headers', 'atlas_cache_watch_send_header');
