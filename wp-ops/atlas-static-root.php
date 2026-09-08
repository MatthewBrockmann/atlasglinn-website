<?php
/**
 * Plugin Name: Atlas Static Root
 * Description: Serves the uploaded static Atlas pages at / and the section slugs, so WordPress stops rendering those URLs.
 * Version: 1.0.0
 * Author: atlasglinn-website (the pages it serves are uploaded by scripts/wp-upload.sh)
 *
 * Purpose. scripts/wp-upload.sh puts the generated Atlas pages into this WordPress docroot over SFTP, and the web
 * server hands out real files before WordPress ever runs: https://atlasglinn.com/index.html and /about.html are
 * already the static pages. https://atlasglinn.com/ is not — no file is named there, so WordPress answers, and the
 * same is true of every section permalink (/about/, /training/ …). Changing that inside WordPress means editing
 * pages, a theme or the permalink structure; the saved GoDaddy login is SFTP-only ("This service allows sftp
 * connections only.", measured 2026-09-08), so a file dropped into mu-plugins is the whole deployable surface. This
 * file is that drop: on muplugins_loaded — the first hook a must-use plugin can take, long before WordPress has
 * decided what a URL means — it answers the allowlisted paths from the docroot itself and exits. Every other URL is
 * untouched and WordPress serves it exactly as it does today.
 *
 * THE ALLOWLIST, and nothing else:
 *   /                        -> index.html
 *   /about                   -> about.html          /privacy                -> privacy.html
 *   /careers                 -> careers.html        /terms                  -> terms.html
 *   /contact                 -> contact.html        /technology             -> technology.html
 *   /cuas-aerodefense        -> cuas-aerodefense.html
 *   /disaster-recovery       -> disaster-recovery.html
 *   /ep-app                  -> ep-app.html         /training               -> training.html
 *   /executive-protection    -> executive-protection.html
 *   /residential-protection  -> residential-protection.html
 *   /uas                     -> uas.html
 * The match is exact and case-sensitive, so /About, /about.html, /index.html, /wp-admin/, /wp-login.php, /wp-json/…,
 * /xmlrpc.php, /feed/, /robots.txt and /sitemap.xml all fall through untouched. It is a prefix of nothing: /training
 * is a page here, but /training/shop/ and everything under it is the LIVE IWA shop and never matches — only
 * the fourteen paths above do. A path carrying '..', '//', '%', a NUL or any control byte is refused rather than
 * normalised (so /%61bout is not /about), and only GET and HEAD are answered; a POST to / is WordPress's.
 *
 * TRAILING SLASH. WordPress's permalinks end in one and this file's do not, because the pages carry relative asset
 * links (images/…, vendor/…) that a browser resolves against the directory: at /about/ they would resolve to
 * /about/images/… and 404. So /about/ is a 301 to /about, one trailing slash and only one — /about// carries '//'
 * and falls through with everything else.
 *
 * TWO KILL SWITCHES, either one returns before the hook is added:
 *   1. define('ATLAS_STATIC_ROOT_DISABLED', true); in wp-config.php.
 *   2. a file named .atlas-static-root-off next to this one in mu-plugins. This is the one to use: the saved login is
 *      SFTP-only, so an empty file dropped beside the plugin turns it off in seconds with no wp-config edit and no
 *      dashboard. Deleting the plugin works too and leaves nothing behind — it writes no option and schedules no
 *      event, so there is nothing to uninstall.
 *
 * HEADER PROOF. Every response this file serves carries
 *   X-Atlas-Static-Root: <version>;file=<name>;b=<build>
 * where b is the first 8 of sha1 of THIS FILE — the same proof atlas-cache-watch.php carries, and for the same
 * reason: a re-upload that silently failed leaves the old bytes running under an unchanged version number, and b is
 * what tells them apart. file= names which page answered. The response's ETag is a different digest — the first 8 of
 * sha1 of the PAGE — so one response proves both which plugin ran and which page bytes it sent. A URL that is missing
 * the header is one WordPress answered, which is how to tell at a glance whether the switch is on.
 *
 * WHAT IT NEVER DOES: no option, no transient, no DB read or write, no REST route, no cron event, no admin UI, no
 * request of its own, no file write, no redirect anywhere but to a path in the allowlist above, and no input from the
 * request beyond REQUEST_METHOD, REQUEST_URI and the two conditional headers. It logs one line only when an
 * allowlisted page is missing from the docroot, and never a blank page: a page it cannot read is left to WordPress.
 * It runs on muplugins_loaded, where pluggable.php has not loaded, so it calls no WordPress function at all beyond
 * add_action — the redirect is a plain header(), not wp_redirect().
 *
 * DEPLOY GATE. This file is NOT uploaded until Brockmann replies "go" to the review email
 * (00-rules/website-go-live-gate.md: the root switch is a separate, gated deploy). Until then the static pages stay
 * reachable at their .html paths and WordPress keeps answering / — which is exactly what this file changes, so it
 * ships on his word and not before. There is no deploy script here on purpose: once claude/wp-cache-watch merges,
 * scripts/wp-cache-watch-deploy.sh is generalised to take a plugin path and sends this file the same way.
 */

if (!defined('ABSPATH')) { exit; }

define('ATLAS_STATIC_ROOT_VERSION', '1.0.0');
define('ATLAS_STATIC_ROOT_MARKER', '.atlas-static-root-off');
define('ATLAS_STATIC_ROOT_MAX_AGE', 300);

// header(), exit and the file read go through these three so the CLI harness can shim them and watch what a request
// would have sent without a web server. ATLAS_STATIC_ROOT_TESTING means the harness has already declared its own.
if (!defined('ATLAS_STATIC_ROOT_TESTING')) {
    function atlas_static_root_send_header($header, $code = 0) {
        if ($code > 0) { header($header, true, $code); return; }
        header($header);
    }
    function atlas_static_root_exit() { exit; }
    function atlas_static_root_read($path) { return file_get_contents($path); }
}

// The allowlist, built once. Keys are the exact request paths; values are the file names in ABSPATH.
function atlas_static_root_map() {
    static $map = null;
    if ($map === null) {
        $map = array('/' => 'index.html');
        foreach (array(
            'about', 'careers', 'contact', 'cuas-aerodefense', 'disaster-recovery', 'ep-app',
            'executive-protection', 'residential-protection', 'technology', 'training', 'uas',
            'privacy', 'terms',
        ) as $slug) {
            $map['/' . $slug] = $slug . '.html';
        }
    }
    return $map;
}

// The marker file sits in the mu-plugins directory, which is where this file runs from. WPMU_PLUGIN_DIR is defined by
// wp-includes/default-constants.php long before mu-plugins load; __DIR__ is the fallback so the switch still works if
// a host has not defined it.
function atlas_static_root_marker_path() {
    $dir = defined('WPMU_PLUGIN_DIR') ? WPMU_PLUGIN_DIR : __DIR__;
    return rtrim($dir, '/\\') . '/' . ATLAS_STATIC_ROOT_MARKER;
}

// One stat per request, deliberately: that is the price of a switch that flips over SFTP with no wp-config edit.
function atlas_static_root_off() {
    if (defined('ATLAS_STATIC_ROOT_DISABLED') && ATLAS_STATIC_ROOT_DISABLED) { return true; }
    return file_exists(atlas_static_root_marker_path());
}

// The first 8 of this file's own sha1: a re-upload that silently failed leaves the old bytes running under the same
// version number, and this is what tells them apart on the wire.
function atlas_static_root_build() {
    static $b = null;
    if ($b === null) {
        $h = sha1_file(__FILE__);
        $b = is_string($h) ? substr($h, 0, 8) : '00000000';
    }
    return $b;
}

function atlas_static_root_proof($name) {
    return ATLAS_STATIC_ROOT_VERSION . ';file=' . $name . ';b=' . atlas_static_root_build();
}

// Everything read from the request, read once: the method, the raw path and the raw query. No decoding happens here —
// see atlas_static_root_safe().
function atlas_static_root_request() {
    $method = isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : '';
    $uri    = isset($_SERVER['REQUEST_URI']) ? $_SERVER['REQUEST_URI'] : '';
    if (!is_string($method) || !is_string($uri) || $uri === '') { return null; }
    $query = '';
    $cut = strpos($uri, '?');
    if ($cut !== false) { $query = substr($uri, $cut + 1); $uri = substr($uri, 0, $cut); }
    $cut = strpos($uri, '#');   // a fragment never reaches a server, but one sent anyway must not widen the match
    if ($cut !== false) { $uri = substr($uri, 0, $cut); }
    return array($method, $uri, $query);
}

// Refused, not normalised. A path that needs cleaning up is a path this file has no business guessing about: '..' and
// '//' are for the web server to resolve, and '%' is refused instead of decoded so that /%61bout stays /%61bout and
// never becomes /about. What is left is its own decoded form, and the comparison is a plain case-sensitive ===.
function atlas_static_root_safe($path) {
    if ($path === '' || $path[0] !== '/') { return false; }
    if (strpos($path, '..') !== false) { return false; }
    if (strpos($path, '//') !== false) { return false; }
    if (strpos($path, '%') !== false) { return false; }
    if (preg_match('/[\x00-\x1f\x7f]/', $path) === 1) { return false; }
    return true;
}

// The query changes nothing except this: any wp= parameter hands the URL back to WordPress, so /?wp=1 and /about?wp=1
// stay the WordPress version and the two can be compared side by side while the switch is live.
function atlas_static_root_wordpress_wanted($query) {
    return $query !== '' && preg_match('/(?:^|&)wp(?:=|&|$)/', $query) === 1;
}

// array('serve', <file>) | array('redirect', <path>) | null
function atlas_static_root_match($path) {
    $map = atlas_static_root_map();
    if (isset($map[$path])) { return array('serve', $map[$path]); }
    if ($path !== '/' && substr($path, -1) === '/') {
        $bare = substr($path, 0, -1);   // ONE trailing slash; '/about//' carried '//' and never reached here
        if (isset($map[$bare])) { return array('redirect', $bare); }
    }
    return null;
}

function atlas_static_root_last_modified($mtime) {
    return gmdate('D, d M Y H:i:s', $mtime) . ' GMT';   // RFC 7231 IMF-fixdate
}

// RFC 7232: when If-None-Match is present it decides on its own and If-Modified-Since is not consulted.
function atlas_static_root_fresh($etag, $mtime) {
    $inm = isset($_SERVER['HTTP_IF_NONE_MATCH']) ? $_SERVER['HTTP_IF_NONE_MATCH'] : '';
    if (is_string($inm) && $inm !== '') {
        foreach (explode(',', $inm) as $candidate) {
            $candidate = trim($candidate);
            if ($candidate === '*') { return true; }
            if (stripos($candidate, 'W/') === 0) { $candidate = substr($candidate, 2); }
            if ($candidate === $etag) { return true; }
        }
        return false;
    }
    $ims = isset($_SERVER['HTTP_IF_MODIFIED_SINCE']) ? $_SERVER['HTTP_IF_MODIFIED_SINCE'] : '';
    if (is_string($ims) && $ims !== '' && $mtime > 0) {
        $since = strtotime($ims);
        if ($since !== false && $since >= $mtime) { return true; }
    }
    return false;
}

function atlas_static_root_redirect($to) {
    atlas_static_root_send_header('Location: ' . $to, 301);
    atlas_static_root_exit();
}

function atlas_static_root_serve($name, $head) {
    $file = ABSPATH . $name;
    // Missing or unreadable is a fall-through, never a blank page: WordPress still has a page at this URL today, and
    // an empty 200 would be worse than the WordPress copy. One line, naming the file, and nothing else.
    if (!is_file($file) || !is_readable($file)) {
        error_log('[atlas-static-root] not served, missing or unreadable: ' . $name);
        return;
    }
    $body = atlas_static_root_read($file);
    if (!is_string($body)) {
        error_log('[atlas-static-root] not served, read failed: ' . $name);
        return;
    }
    $mtime = filemtime($file);
    if (!is_int($mtime)) { $mtime = 0; }
    $etag    = '"' . substr(sha1($body), 0, 8) . '"';
    $lastmod = atlas_static_root_last_modified($mtime);

    if (atlas_static_root_fresh($etag, $mtime)) {
        // No Content-Length and no Content-Type on a 304: RFC 7232 asks for the validators and the cache directives,
        // and a Content-Length beside an empty body is what breaks a client that believes it.
        atlas_static_root_send_header('HTTP/1.1 304 Not Modified', 304);
        atlas_static_root_send_header('Last-Modified: ' . $lastmod);
        atlas_static_root_send_header('ETag: ' . $etag);
        atlas_static_root_send_header('Cache-Control: public, max-age=' . ATLAS_STATIC_ROOT_MAX_AGE);
        atlas_static_root_send_header('X-Atlas-Static-Root: ' . atlas_static_root_proof($name));
        atlas_static_root_send_header('Vary: Accept-Encoding');
        atlas_static_root_exit();
        return;
    }

    atlas_static_root_send_header('Content-Type: text/html; charset=utf-8');
    atlas_static_root_send_header('Content-Length: ' . strlen($body));
    atlas_static_root_send_header('Last-Modified: ' . $lastmod);
    atlas_static_root_send_header('ETag: ' . $etag);
    atlas_static_root_send_header('Cache-Control: public, max-age=' . ATLAS_STATIC_ROOT_MAX_AGE);
    atlas_static_root_send_header('X-Atlas-Static-Root: ' . atlas_static_root_proof($name));
    atlas_static_root_send_header('Vary: Accept-Encoding');
    if (!$head) { echo $body; }
    atlas_static_root_exit();
}

// The whole plugin, in the order the checks are cheapest and most restrictive: off, then the method, then the shape of
// the path, then the wp= escape, then the allowlist. Any one of them returning hands the request back to WordPress
// untouched — that is the default, and every URL that is not one of the fourteen takes it.
function atlas_static_root_dispatch() {
    if (atlas_static_root_off()) { return; }
    $request = atlas_static_root_request();
    if ($request === null) { return; }
    list($method, $path, $query) = $request;
    if ($method !== 'GET' && $method !== 'HEAD') { return; }
    if (!atlas_static_root_safe($path)) { return; }
    if (atlas_static_root_wordpress_wanted($query)) { return; }
    $hit = atlas_static_root_match($path);
    if ($hit === null) { return; }
    if ($hit[0] === 'redirect') { atlas_static_root_redirect($hit[1]); return; }
    atlas_static_root_serve($hit[1], $method === 'HEAD');
}

if (atlas_static_root_off()) { return; }

add_action('muplugins_loaded', 'atlas_static_root_dispatch');
