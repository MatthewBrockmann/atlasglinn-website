<?php
/**
 * Plugin Name: Atlas Wordfence Install
 * Description: One-shot. Installs and activates Wordfence Security from wordpress.org on the first front-end request after it lands, records the result in an option, and deletes itself.
 * Version: 1.0.0
 * Author: atlasglinn-website (scripts/wp-wordfence-install.sh)
 *
 * WHY A FILE AND NOT A DASHBOARD CLICK OR WP-CLI. R2 of the 2026-07-01 security packet is "install Wordfence Free",
 * and it has been open since. The saved GoDaddy login `mast-wp-sftp` answers "This service allows sftp connections
 * only." (measured 2026-09-08 18:46 UTC, scripts/wp-cache-watch-deploy.sh), so `wp plugin install wordfence` over SSH cannot run from
 * the Mac at all — a script built on that route installs nothing and reports a preflight failure. What still works is
 * SFTP, and WordPress itself is already running on the host with the installer WP-CLI would have called. So the
 * install travels the way the cache cascade travels: as a must-use plugin dropped into
 * html/wp-content/mu-plugins/ by scripts/wp-wordfence-install.sh.
 *
 * WHAT IT DOES, EXACTLY ONCE: plugins_api('plugin_information') for the `wordfence` slug, Plugin_Upgrader with
 * Plugin_Installer_Skin to fetch and unpack the package from wordpress.org, activate_plugin() to switch it on. It
 * then writes the option atlas_wordfence_install = array(status, version, time, error, tries, plugin, self) and
 * unlinks itself. Nothing reads the result from here — atlas-wordfence-status.php publishes it as a response header,
 * because this file will not exist by the time anyone asks.
 *
 * WHAT IT DELIBERATELY DOES NOT DO, and this is the part that matters on a site whose owner is its only admin: it
 * sets NO Wordfence setting. No login-failure limit, no lockout window, no username blacklist, no forced 2FA, no
 * alert-email write, no auto_prepend_file / "extended protection" (that rewrites server files), no firewall mode
 * change. Wordfence's own out-of-the-box defaults are the throttle. Every one of those settings is a way to lock
 * Brockmann out of his own wp-admin from a script he is not sitting in front of, and the packet's throttle does not
 * need any of them to exist. Tightening them is a separate, gated act with him at the keyboard.
 *
 * WHEN IT RUNS. On `init`, and only on a plain front-end GET/HEAD: never on wp-login.php, never in wp-admin, never on
 * an admin-ajax, REST, XML-RPC or cron request, never on a POST. The IWA shop at /training/shop/ is live and its cart
 * fragments arrive as admin-ajax; a 30-second install must not land inside one. In practice the request that runs it
 * is the deploy script's own trigger fetch, a few seconds after the upload.
 *
 * NOTE ON THE FRONT PAGE: html/index.html is served by wp-ops/atlas-static-root.php on `muplugins_loaded`, which
 * exits before `init` — so https://atlasglinn.com/ does NOT run this file. The trigger and every measurement use a
 * URL carrying a non-tracking query (?atlas-wordfence=<ts>), which that plugin passes through to WordPress by design.
 *
 * BOUNDED, AND IT GIVES UP. One attempt per request, behind a 5-minute lock transient; set_time_limit(180) while the
 * package downloads (the previous limit is restored). THE LOCK IS NOT ATOMIC and this file does not claim it is: it is
 * get_transient() then set_transient(), a check-then-set, so two front-end requests arriving inside the same few
 * milliseconds can both pass it. The transient is kept anyway rather than add_option() — WordPress core is not in this
 * repository and add_option()'s insert could not be read this run, so calling it an atomic insert would be a claim
 * nothing here measured. What bounds the residual is the branch below it: the second request finds Wordfence already
 * on disk (or gets the upgrader's own "destination folder already exists"), which is recorded as a retryable error,
 * not a second install. A failed
 * attempt increments `tries` and leaves this file in place so the next trigger retries; on the third it records the
 * failure and removes itself anyway. A request killed mid-install leaves status=running and the lock, and the next
 * request after the lock expires retries. A terminal record already present means the work is done: the file removes
 * itself and returns without touching anything.
 *
 * WHAT IT WRITES: one option (autoload=no), one transient, and one error_log line carrying a status word, a version
 * and a 0/1 — never the error text, in keeping with wp-ops/atlas-cache-watch.php. Two fields carry a failure, and the
 * split is deliberate: `code` is a short token this file composes itself (install_download_failed, activate_*,
 * api_*, fs_ftpext, no_download_link, install_refused, not_in_plugins_dir, missing_include, gave_up) and `error` is
 * WordPress's own message. ONLY THE CODE GOES ON THE RESPONSE HEADER — a WP_Error message can carry an absolute
 * filesystem path or a source URL, and that header is readable off the wire. The message stays in the option, which
 * needs the database to reach. No post, no user, no setting, no file beyond its own deletion.
 *
 * HOW TO STOP IT: define('ATLAS_WORDFENCE_INSTALL_DISABLED', true); in wp-config.php, or delete
 * html/wp-content/mu-plugins/atlas-wordfence-install.php (bash scripts/wp-wordfence-install.sh --remove). Removing
 * the file leaves the option behind — a must-use plugin gets no uninstall hook — and leaves Wordfence installed and
 * active, which is the point of the run. Uninstalling Wordfence itself is a dashboard act, not this file's.
 */

if (!defined('ABSPATH')) { exit; }

define('ATLAS_WF_INSTALL_VERSION', '1.0.0');
define('ATLAS_WF_INSTALL_SLUG', 'wordfence');
define('ATLAS_WF_INSTALL_PLUGIN', 'wordfence/wordfence.php');
define('ATLAS_WF_INSTALL_OPT', 'atlas_wordfence_install');
define('ATLAS_WF_INSTALL_LOCK', 'atlas_wordfence_install_lock');
define('ATLAS_WF_INSTALL_TRIES', 3);

function atlas_wf_install_off() {
    return defined('ATLAS_WORDFENCE_INSTALL_DISABLED') && ATLAS_WORDFENCE_INSTALL_DISABLED;
}

// The first 8 of this file's own sha1, so the deploy script can prove the bytes running are the bytes it sent — the
// same proof wp-ops/atlas-cache-watch.php carries, for the same reason. Read while the file still exists.
function atlas_wf_install_build() {
    static $b = null;
    if ($b === null) {
        $h = is_file(__FILE__) ? sha1_file(__FILE__) : false;
        $b = is_string($h) ? substr($h, 0, 8) : '00000000';
    }
    return $b;
}

// WordPress's own installer strings, clipped and flattened: they go into an option and onto a response header, so a
// newline or a 400-character stack of them would break the header rather than inform anyone.
function atlas_wf_install_clip($s, $max = 180) {
    $s = is_string($s) ? $s : '';
    if (function_exists('wp_strip_all_tags')) { $s = wp_strip_all_tags($s); }
    else { $s = strip_tags($s); }
    $s = trim(preg_replace('/\s+/', ' ', $s));
    if (strlen($s) > $max) { $s = substr($s, 0, $max - 1) . '…'; }
    return $s;
}

// The one place that decides whether this request may carry an install. Returns '' when it may, or the reason it may
// not — every reason is a request shape where a 30-second download would be felt by somebody who did not ask for it.
function atlas_wf_install_refused() {
    if (atlas_wf_install_off()) { return 'disabled'; }
    if (function_exists('wp_installing') && wp_installing()) { return 'wp-installing'; }
    if (defined('REST_REQUEST') && REST_REQUEST) { return 'rest'; }
    if (defined('XMLRPC_REQUEST') && XMLRPC_REQUEST) { return 'xmlrpc'; }
    if (function_exists('wp_doing_ajax') && wp_doing_ajax()) { return 'ajax'; }
    if (function_exists('wp_doing_cron') && wp_doing_cron()) { return 'cron'; }
    if (defined('DOING_CRON') && DOING_CRON) { return 'cron'; }
    if (function_exists('is_admin') && is_admin()) { return 'admin'; }
    $m = isset($_SERVER['REQUEST_METHOD']) ? strtoupper((string) $_SERVER['REQUEST_METHOD']) : '';
    if ($m !== 'GET' && $m !== 'HEAD') { return 'method'; }
    $s = isset($_SERVER['SCRIPT_NAME']) ? (string) $_SERVER['SCRIPT_NAME'] : '';
    $base = $s === '' ? '' : basename($s);
    if ($base === 'wp-login.php' || $base === 'wp-signup.php' || $base === 'wp-cron.php') { return $base; }
    return '';
}

// `code` is the short token that may be published; `error` is WordPress's own message and stays in the option.
function atlas_wf_install_code($s, $max = 32) {
    $s = preg_replace('/[^A-Za-z0-9_]/', '_', strtolower((string) $s));
    $s = trim($s, '_');
    if ($s === '') { return 'unknown'; }
    return strlen($s) > $max ? substr($s, 0, $max) : $s;
}

function atlas_wf_install_record($status, $version, $code, $error, $tries, $self) {
    update_option(ATLAS_WF_INSTALL_OPT, array(
        'status'  => $status,
        'version' => $version,
        'time'    => time(),
        'code'    => $code,
        'error'   => $error,
        'tries'   => (int) $tries,
        'plugin'  => ATLAS_WF_INSTALL_PLUGIN,
        'self'    => $self,
        'by'      => ATLAS_WF_INSTALL_VERSION . '/' . atlas_wf_install_build(),
    ), false);
    // A status word, a version, this file's own error CODE and a 0/1 — WordPress's message stays out of the log, as
    // in atlas-cache-watch.php: a path or a token can ride inside an installer string.
    error_log('[atlas-wordfence-install] status=' . $status . ' version=' . ($version === '' ? 'none' : $version)
        . ' code=' . ($code === '' ? 'none' : $code)
        . ' tries=' . (int) $tries . ' err=' . ($error === '' ? 0 : 1) . ' self=' . $self);
}

// Marks the record with what actually happened to this file, after the attempt to delete it. The deploy script proves
// the same fact independently with an sftp `ls`; this is the copy an operator can read from the wire.
function atlas_wf_install_remove_self() {
    if (function_exists('opcache_invalidate') && is_file(__FILE__)) { @opcache_invalidate(__FILE__, true); }
    if (is_file(__FILE__)) { @unlink(__FILE__); }
    clearstatcache();
    $self = is_file(__FILE__) ? 'left' : 'gone';
    $rec = get_option(ATLAS_WF_INSTALL_OPT, false);
    if (is_array($rec)) { $rec['self'] = $self; update_option(ATLAS_WF_INSTALL_OPT, $rec, false); }
    return $self;
}

// WordPress's installer, loaded on demand: none of these files are present on a front-end request. class-wp-upgrader.php
// is the one that pulls in Plugin_Upgrader and Plugin_Installer_Skin (split into their own files since WP 5.3 and
// required at the bottom of it), and the split files are required by name as well when that did not produce them.
function atlas_wf_install_load_installer() {
    $need = array(
        'wp-admin/includes/plugin.php',
        'wp-admin/includes/file.php',
        'wp-admin/includes/misc.php',
        'wp-admin/includes/plugin-install.php',
        'wp-admin/includes/class-wp-upgrader.php',
    );
    foreach ($need as $rel) {
        $p = ABSPATH . $rel;
        if (!is_file($p)) { return 'missing ' . $rel; }
        require_once $p;
    }
    foreach (array('class-plugin-upgrader.php', 'class-plugin-installer-skin.php', 'class-wp-upgrader-skins.php') as $extra) {
        $p = ABSPATH . 'wp-admin/includes/' . $extra;
        if (is_file($p)) { require_once $p; }
    }
    foreach (array('Plugin_Upgrader', 'Plugin_Installer_Skin') as $cls) {
        if (!class_exists($cls)) { return 'no class ' . $cls . ' after loading the upgrader'; }
    }
    foreach (array('plugins_api', 'activate_plugin', 'is_plugin_active', 'get_plugins', 'get_filesystem_method') as $fn) {
        if (!function_exists($fn)) { return 'no function ' . $fn . '() after loading the upgrader'; }
    }
    return '';
}

function atlas_wf_install_version() {
    if (function_exists('get_plugins')) {
        $all = get_plugins();
        if (is_array($all) && isset($all[ATLAS_WF_INSTALL_PLUGIN]['Version'])) {
            return (string) $all[ATLAS_WF_INSTALL_PLUGIN]['Version'];
        }
    }
    if (defined('WORDFENCE_VERSION')) { return (string) WORDFENCE_VERSION; }
    return '';
}

// The install itself. Returns array(status, code, error) and touches nothing else; the caller records and removes.
function atlas_wf_install_do() {
    $dir  = defined('WP_PLUGIN_DIR') ? WP_PLUGIN_DIR : (defined('WP_CONTENT_DIR') ? WP_CONTENT_DIR . '/plugins' : ABSPATH . 'wp-content/plugins');
    $path = $dir . '/' . ATLAS_WF_INSTALL_PLUGIN;

    if (is_plugin_active(ATLAS_WF_INSTALL_PLUGIN)) {
        return array('already-active', '', '');
    }
    $on_disk = is_file($path);
    if (!$on_disk) {
        // Anything but 'direct' means WP_Upgrader would ask for FTP credentials — which, on a request with no admin
        // screen, means Plugin_Installer_Skin echoing a credentials FORM into a visitor's page and installing nothing.
        // Refuse before that happens rather than discover it in an output buffer.
        $method = get_filesystem_method();
        if ($method !== 'direct') {
            return array('no-filesystem', atlas_wf_install_code('fs_' . $method), 'WP_Filesystem method is "' . atlas_wf_install_clip($method, 40) . '", not "direct" — WordPress cannot write to wp-content/plugins without credentials this file will not ask for');
        }
        $api = plugins_api('plugin_information', array(
            'slug'   => ATLAS_WF_INSTALL_SLUG,
            'fields' => array('sections' => false, 'short_description' => false, 'screenshots' => false, 'banners' => false),
        ));
        if (is_wp_error($api)) {
            return array('error', atlas_wf_install_code('api_' . $api->get_error_code()), 'plugins_api:' . $api->get_error_code() . ':' . atlas_wf_install_clip($api->get_error_message()));
        }
        if (!is_object($api) || empty($api->download_link)) {
            return array('error', 'no_download_link', 'plugins_api returned no download_link for the ' . ATLAS_WF_INSTALL_SLUG . ' slug');
        }
        $skin = new Plugin_Installer_Skin(array('type' => 'web', 'api' => $api, 'nonce' => '', 'title' => '', 'url' => ''));
        // The skin is WordPress's admin-screen skin and it echoes: a header, a feedback line per step, and a block of
        // action links. None of that may reach a visitor's page, so its two frames are marked done and the whole run
        // happens inside an output buffer that is DISCARDED — the useful part of what it says comes back as a WP_Error.
        $skin->done_header = true;
        $skin->done_footer = true;
        $upgrader = new Plugin_Upgrader($skin);
        ob_start();
        $res = $upgrader->install($api->download_link);
        ob_end_clean();
        clearstatcache();
        if (is_wp_error($res)) {
            return array('error', atlas_wf_install_code('install_' . $res->get_error_code()), 'install:' . $res->get_error_code() . ':' . atlas_wf_install_clip($res->get_error_message()));
        }
        if ($res === false) {
            return array('error', 'install_refused', 'install: the upgrader refused the package (a filesystem it could not write, or an unreadable download)');
        }
        if (!is_file($path)) {
            return array('error', 'not_in_plugins_dir', 'install: reported success but ' . ATLAS_WF_INSTALL_PLUGIN . ' is not in the plugins directory');
        }
    }
    // activate_plugin() with its defaults on purpose: $silent=true would skip Wordfence's own activation hook, which is
    // what creates its tables — an "active" plugin with no schema is worse than none.
    $act = activate_plugin(ATLAS_WF_INSTALL_PLUGIN);
    if (is_wp_error($act)) {
        return array('installed-not-active', atlas_wf_install_code('activate_' . $act->get_error_code()), 'activate:' . $act->get_error_code() . ':' . atlas_wf_install_clip($act->get_error_message()));
    }
    return array($on_disk ? 'activated' : 'installed', '', '');
}

function atlas_wf_install_run() {
    if (atlas_wf_install_refused() !== '') { return; }

    $rec   = get_option(ATLAS_WF_INSTALL_OPT, false);
    $tries = (is_array($rec) && isset($rec['tries'])) ? (int) $rec['tries'] : 0;
    // A terminal record means a previous request already did this. The file should not be here — it is, so remove it
    // again (an unlink can fail on a read-only mount, and a re-upload puts it back) and do nothing else. `error` with
    // attempts left is NOT terminal: that is the state this file deliberately survives, so the next trigger retries.
    if (is_array($rec) && isset($rec['status'])) {
        $prev     = $rec['status'];
        $retryable = ($prev === 'error' && $tries < ATLAS_WF_INSTALL_TRIES);
        if ($prev !== 'running' && !$retryable) {
            atlas_wf_install_remove_self();
            return;
        }
    }
    if (get_transient(ATLAS_WF_INSTALL_LOCK)) { return; }
    if ($tries >= ATLAS_WF_INSTALL_TRIES) {
        atlas_wf_install_record('gave-up', '', 'gave_up', ATLAS_WF_INSTALL_TRIES . ' attempts did not finish', $tries, 'pending');
        atlas_wf_install_remove_self();
        return;
    }
    set_transient(ATLAS_WF_INSTALL_LOCK, time(), 300);
    $tries++;
    // status=running is written BEFORE the download, so a request killed mid-install is visible as running rather than
    // as "never started", and the attempt is counted whether or not it comes back.
    atlas_wf_install_record('running', '', '', '', $tries, 'pending');

    $miss = atlas_wf_install_load_installer();
    if ($miss !== '') {
        $status = 'error';
        $code   = 'missing_include';
        $error  = 'installer:' . $miss;
    } else {
        $limit = ini_get('max_execution_time');
        if (function_exists('set_time_limit')) { set_time_limit(180); }
        $out = atlas_wf_install_do();
        if (function_exists('set_time_limit')) { set_time_limit($limit === false ? 0 : (int) $limit); }
        $status = $out[0];
        $code   = $out[1];
        $error  = $out[2];
    }
    $version = ($status === 'installed' || $status === 'activated' || $status === 'already-active' || $status === 'installed-not-active')
        ? atlas_wf_install_version() : '';

    // A retryable failure keeps this file on the host so the next trigger fetch tries again; everything else — success,
    // a filesystem that cannot be written, the last allowed attempt — is the end of this file's life.
    $retry = ($status === 'error' && $tries < ATLAS_WF_INSTALL_TRIES);
    atlas_wf_install_record($status, $version, $code, $error, $tries, $retry ? 'pending' : 'removing');
    delete_transient(ATLAS_WF_INSTALL_LOCK);
    if (!$retry) { atlas_wf_install_remove_self(); }
}

if (atlas_wf_install_off()) { return; }
add_action('init', 'atlas_wf_install_run', 99);
