<?php
/**
 * Plugin Name: Atlas Static Root
 * Description: Serves the uploaded static Atlas pages at / and the section slugs, so WordPress stops rendering those URLs.
 * Version: 1.2.0
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
 * These are the 14 ALLOWLISTED pages, which is not the uploaded set: wp-upload.sh uploads 17 files, and the three it
 * sends that are not allowlisted here — mastsolutions.html, mast-capability-statement.html and signup.html — keep
 * answering at their own .html names and at no other URL.
 *
 * THE QUERY STRING decides as much as the path does. A static file cannot answer a WordPress query-var route, so a
 * page is served only when the query is EMPTY or every parameter name is one of the tracking tags that change nothing
 * about what a page renders: utm_source, utm_medium, utm_campaign, utm_term, utm_content, fbclid, gclid, msclkid,
 * ttclid, mc_cid, mc_eid, ref, v. Any other name falls through, and that default is what leaves
 * /?wc-ajax=get_refreshed_fragments, /?wc-api=…, /?s=…, /?rest_route=…, /?feed=rss2, /?p=1, /?page_id=7,
 * /?preview=true, /?customize_changeset_uuid=…, /?elementor-preview=… and every other route WordPress reads off the
 * query on '/' working exactly as they do today — the IWA shop's cart fragments are the one that would be missed.
 * Names are compared raw and case-sensitively, so ?UTM_SOURCE= and ?%75tm_source= fall through too: a name that needs
 * decoding or case-folding to match is a name this file does not recognise, and every ambiguity resolves to
 * WordPress. ';' separates parameters here as well as '&', because a host that sets arg_separator.input to '&;' reads
 * ?utm_source=x;p=1 as a p=1 and this file must not answer a page over the top of it. A query carrying a control byte falls through before any of this, because the redirect below puts the
 * query back on the wire.
 *
 * THE ESCAPE is therefore any parameter at all. '?wp=1' is the documented one — /?wp=1 and /about?wp=1 are the
 * WordPress version, so the two can be compared side by side while the switch is live — and '?anything=1' does the
 * same thing for the same reason: an unknown name is WordPress's.
 *
 * TRAILING SLASH. WordPress's permalinks end in one and this file's do not, because the pages carry relative asset
 * links (images/…, vendor/…) that a browser resolves against the directory: at /about/ they would resolve to
 * /about/images/… and 404. So /about/ is a 301 to /about, one trailing slash and only one — /about// carries '//'
 * and falls through with everything else. The redirect KEEPS the query: /about/?utm_source=x is a 301 to
 * /about?utm_source=x, or a campaign tag would be dropped on the way in. /about/?p=1 never reaches the redirect —
 * an unknown parameter fell through one gate earlier and the whole URL is WordPress's.
 *
 * AND THE 301 IS SENT ONLY WHEN THE TARGET CAN ACTUALLY BE SERVED — the same check, on the same bytes, that the serve
 * path runs. Otherwise a page that is missing, zero-byte, truncated, a directory or a symlink turns its own working
 * WordPress permalink (/privacy/, /careers/ …) into a 301 to a URL where this file falls through and WordPress
 * renders the slug: a loop on a host that puts the trailing slash back, and at best a 404 at a URL that worked
 * yesterday. When the target is not servable, /privacy/ is handed to WordPress untouched, exactly as /privacy is.
 * The 301 carries Cache-Control: public, max-age=300 and the same Vary as the pages, because a 301 with no cache
 * directive is one a browser may keep for good — and a redirect already stored is out of reach of both kill switches.
 * Five minutes is how long a rollback takes to be complete on the wire, and that is the whole reason for the header.
 *
 * WHAT IS SERVED, and what is refused. The file name comes from the allowlist and never from the request. On top of
 * that the file must be a regular file whose realpath() is inside realpath(ABSPATH) and which is not a symlink, and
 * its bytes must be a non-empty string containing '</html>'. That last one is the truncated-upload case: SFTP that
 * dies halfway leaves a short file, and a short file has no closing tag — serving it as a 200 with public caching
 * would push a broken page into the CDN for max-age seconds and a re-upload alone would not pull it back. Each
 * refusal is one error_log line naming which check refused it, and a fall-through to WordPress: never a blank page.
 * All of it is ONE function, atlas_static_root_load(), and both paths call it — the serve path for the bytes, the
 * redirect above for the answer. Two lists would drift, and the day they disagreed is the day a 301 pointed at a page
 * that could not be served.
 *
 * BEFORE THE BODY GOES OUT, zlib.output_compression is turned off and every output buffer is dropped, and only then
 * is Content-Length computed and the body echoed — an inherited buffer or a compression filter is how a
 * Content-Length stops matching the bytes on the wire. That reset is bounded, because ob_end_clean() returns false
 * forever on a buffer started non-removable and a bare `while (ob_get_level())` spins on such a host; and it REPORTS.
 * If a buffer is still standing when it returns, the request falls through with one log line rather than announce a
 * Content-Length for bytes that are going to leave wrapped in somebody else's buffer. And if headers have already
 * been sent when the hook runs, the request is handed back untouched rather than half-answered.
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
 * request of its own, no file write, no redirect anywhere but to a path in the allowlist above with the request's own
 * tracking query put back on it, and no input from the request beyond REQUEST_METHOD, REQUEST_URI and the two
 * conditional headers. It logs one line when an allowlisted page cannot be served — missing, a directory, unreadable,
 * outside the docroot, a symlink, empty, truncated, unreadable at read time, or sitting behind an output buffer that
 * will not drop — naming the file and which check refused it. It runs on muplugins_loaded, where pluggable.php has
 * not loaded, so it calls no WordPress function at all beyond add_action — the redirect is a plain header(), not
 * wp_redirect().
 *
 * DEPLOY GATE. This file is NOT uploaded until Brockmann replies "go" to the review email (the brain vault's
 * 00-rules/website-go-live-gate.md: the root switch is a separate, gated deploy). Until then the static pages stay
 * reachable at their .html paths and WordPress keeps answering / — which is exactly what this file changes, so it
 * ships on his word and not before. There is no deploy script here on purpose: once claude/wp-cache-watch merges,
 * scripts/wp-cache-watch-deploy.sh is generalised to take a plugin path and sends this file the same way.
 *
 * AND THE DEPLOY IS NOT DONE WHEN THE FILE LANDS — the host's cache is the second half of it. GoDaddy's WPaaS
 * Cloudflare layer keeps serving the WordPress '/' it already cached, so
 *     curl -sI https://atlasglinn.com/ | grep -i x-atlas-static-root
 * can print NOTHING while this plugin is installed and firing correctly. Nothing purges it on its own either:
 * atlas-cache-watch fingerprints the docroot's *.html plus build-manifest.json and mast-ping.txt, so dropping a file
 * into mu-plugins does not move the fingerprint and does not trip the watcher. So the deploy has one more step —
 * re-upload mast-ping.txt with a fresh stamp (that moves the fingerprint, and the watcher runs the flush cascade
 * within 15 minutes), or click Flush Cache in the GoDaddy dashboard. Verify in this order:
 *   1. https://atlasglinn.com/?v=<unix ts>  — cache-busted, and 'v' is in the tracking allowlist above precisely so
 *      this probe still reaches the plugin. The X-Atlas-Static-Root header here means the plugin is live.
 *   2. https://atlasglinn.com/  — the plain URL, AFTER the flush. The same header here means visitors see it too.
 * A header on 1 and nothing on 2 is a stale edge cache, not a broken plugin, and the cure is the flush and not a
 * re-upload of this file.
 */

// header(), exit, the file read, headers_sent() and the output reset go through these five wrappers so the CLI
// harness can shim them and watch what a request WOULD have sent without a web server. Nothing else in this file
// touches the response or the filesystem's contents. ATLAS_STATIC_ROOT_TESTING means the harness declared its own
// first — they are declared before the ABSPATH guard below so that guard's exit goes through the wrapper too.
if (!defined('ATLAS_STATIC_ROOT_TESTING')) {
    function atlas_static_root_send_header($header, $code = 0) {
        if ($code > 0) { header($header, true, $code); return; }
        header($header);
    }
    function atlas_static_root_exit() { exit; }
    function atlas_static_root_read($path) { return file_get_contents($path); }
    function atlas_static_root_headers_sent() { return headers_sent(); }
    // Compression off and every inherited buffer dropped, before a single byte and before Content-Length is counted.
    // The loop stops on a buffer it cannot remove instead of spinning on it: ob_end_clean() returns false on a handler
    // that was started non-removable, and `while (ob_get_level() > 0)` on its own is an infinite loop on that host.
    // TRUE only when nothing is left standing. A caller that got false has not been given a clean wire and must fall
    // through: the alternative is a Content-Length counted over bytes another buffer is still holding.
    function atlas_static_root_reset_output() {
        @ini_set('zlib.output_compression', '0');
        while (($level = ob_get_level()) > 0) {
            if (!@ob_end_clean() || ob_get_level() >= $level) { break; }
        }
        return ob_get_level() === 0;
    }
}

if (!defined('ABSPATH')) { atlas_static_root_exit(); return; }

define('ATLAS_STATIC_ROOT_VERSION', '1.2.0');
define('ATLAS_STATIC_ROOT_MARKER', '.atlas-static-root-off');
define('ATLAS_STATIC_ROOT_MAX_AGE', 300);

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

// The tracking tags a page can ignore: analytics reads them in the browser and none of them change what WordPress
// would have rendered. Every other parameter name belongs to WordPress. Append-only, and deliberately short.
function atlas_static_root_query_tags() {
    static $tags = null;
    if ($tags === null) {
        $tags = array_fill_keys(array(
            'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
            'fbclid', 'gclid', 'msclkid', 'ttclid', 'mc_cid', 'mc_eid', 'ref', 'v',
        ), true);
    }
    return $tags;
}

// The marker file sits in the mu-plugins directory, which is where this file runs from. WPMU_PLUGIN_DIR is defined by
// wp-includes/default-constants.php long before mu-plugins load; __DIR__ is the fallback so the switch still works if
// a host has not defined it.
function atlas_static_root_marker_path() {
    $dir = defined('WPMU_PLUGIN_DIR') ? WPMU_PLUGIN_DIR : __DIR__;
    return rtrim($dir, '/\\') . '/' . ATLAS_STATIC_ROOT_MARKER;
}

// One stat per request, and exactly one — the file-scope guard at the bottom and dispatch() both ask, and a request
// cannot watch the marker appear halfway through itself, so the answer is memoised. mu-plugins are executed afresh on
// every request under mod_php and php-fpm, where a static resets with the process's request state, so dropping or
// deleting the marker still takes effect on the very next request. That one stat is the price of a switch that flips
// over SFTP with no wp-config edit.
function atlas_static_root_off() {
    static $off = null;
    if ($off === null) {
        $off = (defined('ATLAS_STATIC_ROOT_DISABLED') && ATLAS_STATIC_ROOT_DISABLED)
            || file_exists(atlas_static_root_marker_path());
    }
    return $off;
}

// The first 8 of this file's own sha1: a re-upload that silently failed leaves the old bytes running under the same
// version number, and this is what tells them apart on the wire. Read through the wrapper like every other read, and
// memoised, so it costs one read per PHP process and not one per response.
function atlas_static_root_build() {
    static $b = null;
    if ($b === null) {
        $own = atlas_static_root_read(__FILE__);
        $b = (is_string($own) && $own !== '') ? substr(sha1($own), 0, 8) : '00000000';
    }
    return $b;
}

function atlas_static_root_proof($name) {
    return ATLAS_STATIC_ROOT_VERSION . ';file=' . $name . ';b=' . atlas_static_root_build();
}

// Everything read from the request, read once: the method, the raw path and the raw query. The fragment is cut first
// (one never reaches a server, but one sent anyway must not widen the match or ride the redirect back out). No
// decoding happens here — see atlas_static_root_safe().
function atlas_static_root_request() {
    $method = isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : '';
    $uri    = isset($_SERVER['REQUEST_URI']) ? $_SERVER['REQUEST_URI'] : '';
    if (!is_string($method) || !is_string($uri) || $uri === '') { return null; }
    $cut = strpos($uri, '#');
    if ($cut !== false) { $uri = substr($uri, 0, $cut); }
    $query = '';
    $cut = strpos($uri, '?');
    if ($cut !== false) { $query = substr($uri, $cut + 1); $uri = substr($uri, 0, $cut); }
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

// True only when the query is empty or EVERY parameter name is a tracking tag. One unknown name hands the whole URL
// back to WordPress — that is what keeps wc-ajax, wc-api, s, rest_route, feed, p, page_id, preview, customize_* and
// the rest of the query-var routes on '/' answering as they do today, and it is also the '?wp=1' escape.
function atlas_static_root_query_ok($query) {
    if ($query === '') { return true; }
    if (preg_match('/[\x00-\x1f\x7f]/', $query) === 1) { return false; }   // the 301 puts this back on the wire
    $tags = atlas_static_root_query_tags();
    // Split on ';' as well as '&': arg_separator.input is '&' on stock PHP but hosts do set '&;', and on one of those
    // '?utm_source=x;p=1' IS a p=1 to WordPress. Splitting on both means the unknown name wins either way.
    foreach (preg_split('/[&;]/', $query) as $pair) {
        if ($pair === '') { continue; }                     // '?utm_source=x&' — a separator, not a parameter
        $cut  = strpos($pair, '=');
        $name = ($cut === false) ? $pair : substr($pair, 0, $cut);
        if (!isset($tags[$name])) { return false; }
    }
    return true;
}

// array('serve', <file>) | array('redirect', <path>, <file>) | null. The redirect carries the target's file name as
// well as its path, because the caller has to prove that page is servable before it sends anyone to it.
function atlas_static_root_match($path) {
    $map = atlas_static_root_map();
    if (isset($map[$path])) { return array('serve', $map[$path]); }
    if (substr($path, -1) === '/') {    // '/' itself never reaches here — it is in the map and returned on the line above
        $bare = substr($path, 0, -1);   // ONE trailing slash; '/about//' carried '//' and never reached here
        if (isset($map[$bare])) { return array('redirect', $bare, $map[$bare]); }
    }
    return null;
}

// The file name came from the allowlist, so this is belt and braces: it must resolve to a regular file INSIDE the
// docroot. realpath() on both sides, because ABSPATH itself is often reached through a symlinked directory and a
// string prefix would refuse every page on such a host. The two checks are kept apart, each with its own log line:
// containment catches a link that escapes, and is_link() catches one that does not — an allowlisted name must be the
// page, not a pointer to something a later upload could re-aim.
function atlas_static_root_contained($file) {
    $real = realpath($file);
    $root = realpath(ABSPATH);
    if ($real === false || $root === false) { return false; }
    return strpos($real, rtrim($root, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR) === 0;
}

function atlas_static_root_last_modified($mtime) {
    return gmdate('D, d M Y H:i:s', $mtime) . ' GMT';   // RFC 7231 IMF-fixdate
}

// Strict IMF-fixdate (RFC 7231 §7.1.1.1) and nothing else: a relative string like 'tomorrow', an RFC 850 date or an
// asctime date is ignored rather than guessed at, and the request gets its full 200. The round trip is the check —
// createFromFormat() accepts more than the format says, and a value that does not print back byte for byte was not a
// fixdate. Returns the timestamp or false.
function atlas_static_root_since($value) {
    if (!is_string($value)) { return false; }
    $value = trim($value);
    if ($value === '') { return false; }
    $dt = \DateTime::createFromFormat('D, d M Y H:i:s \G\M\T', $value, new \DateTimeZone('UTC'));
    if (!($dt instanceof \DateTime)) { return false; }
    if ($dt->format('D, d M Y H:i:s \G\M\T') !== $value) { return false; }
    return $dt->getTimestamp();
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
    if ($ims !== '' && $mtime > 0) {
        $since = atlas_static_root_since($ims);
        if ($since !== false && $since >= $mtime) { return true; }
    }
    return false;
}

// The query rides along: it was already checked, so it is either empty or tracking tags only. The target was proved
// servable by the caller. Cache-Control is on it for the same reason it is on the pages and for one more: a 301 a
// browser or an edge has already stored is out of reach of both kill switches, so max-age is the longest a rollback
// can take to be complete on the wire.
function atlas_static_root_redirect($to, $query) {
    if (!atlas_static_root_reset_output()) {
        error_log('[atlas-static-root] not redirected, an output buffer would not drop: ' . $to);
        return;
    }
    atlas_static_root_send_header('Location: ' . $to . ($query === '' ? '' : '?' . $query), 301);
    atlas_static_root_send_header('Cache-Control: public, max-age=' . ATLAS_STATIC_ROOT_MAX_AGE);
    atlas_static_root_send_header('Vary: Accept-Encoding');
    atlas_static_root_exit();
}

// THE servability check, and the only one there is. Returns the page's bytes, or null after one error_log line naming
// the file and the check that refused it. The serve path calls it for the bytes; the redirect path calls it for the
// answer. Every refusal is a fall-through, never a blank page: WordPress still has a page at this URL today, and an
// empty or half-written 200 would be worse than the WordPress copy.
function atlas_static_root_load($name) {
    $file = ABSPATH . $name;
    if (!is_file($file) || !is_readable($file)) {
        error_log('[atlas-static-root] not served, missing or unreadable: ' . $name);
        return null;
    }
    if (!atlas_static_root_contained($file)) {
        error_log('[atlas-static-root] not served, outside the docroot: ' . $name);
        return null;
    }
    if (is_link($file)) {
        error_log('[atlas-static-root] not served, symlink: ' . $name);
        return null;
    }
    $body = atlas_static_root_read($file);
    if (!is_string($body)) {
        error_log('[atlas-static-root] not served, read failed: ' . $name);
        return null;
    }
    // The truncated-upload case: SFTP that died halfway leaves a short file, and a short file has no closing tag.
    if ($body === '' || stripos($body, '</html>') === false) {
        error_log('[atlas-static-root] not served, empty or truncated (no closing </html>): ' . $name);
        return null;
    }
    return $body;
}

function atlas_static_root_serve($name, $head) {
    $body = atlas_static_root_load($name);
    if ($body === null) { return; }
    $file  = ABSPATH . $name;
    $mtime = filemtime($file);
    if (!is_int($mtime)) { $mtime = 0; }
    $etag    = '"' . substr(sha1($body), 0, 8) . '"';
    $lastmod = atlas_static_root_last_modified($mtime);
    $fresh   = atlas_static_root_fresh($etag, $mtime);

    // The buffers go first on both branches, and a buffer that will not drop ends the request here: a 304 trailing
    // somebody else's buffered output is a 304 with a body, and a Content-Length counted while a buffer still holds
    // the bytes describes something other than the wire. Falling through hands WordPress a URL it can still answer.
    if (!atlas_static_root_reset_output()) {
        error_log('[atlas-static-root] not served, an output buffer would not drop: ' . $name);
        return;
    }

    if ($fresh) {
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
// the path, then the query (which is where every WordPress query-var route on '/' goes home, the '?wp=1' escape
// included), then whether anything has been sent already, then the allowlist. Any one of them returning hands the
// request back to WordPress untouched — that is the default, and every URL that is not one of the fourteen takes it.
function atlas_static_root_dispatch() {
    if (atlas_static_root_off()) { return; }
    $request = atlas_static_root_request();
    if ($request === null) { return; }
    list($method, $path, $query) = $request;
    if ($method !== 'GET' && $method !== 'HEAD') { return; }
    if (!atlas_static_root_safe($path)) { return; }
    if (!atlas_static_root_query_ok($query)) { return; }
    if (atlas_static_root_headers_sent()) { return; }
    $hit = atlas_static_root_match($path);
    if ($hit === null) { return; }
    if ($hit[0] === 'redirect') {
        // Only ever to a page that can be served. /privacy/ 301'd to /privacy when privacy.html is missing or
        // truncated is WordPress rendering the slug at the end of a redirect — a loop where the host puts the slash
        // back, a 404 where it does not, at a URL that worked before this file was installed. The log line is the
        // serve path's, because it is literally the same check.
        if (atlas_static_root_load($hit[2]) === null) { return; }
        atlas_static_root_redirect($hit[1], $query);
        return;
    }
    atlas_static_root_serve($hit[1], $method === 'HEAD');
}

if (atlas_static_root_off()) { return; }

add_action('muplugins_loaded', 'atlas_static_root_dispatch');
