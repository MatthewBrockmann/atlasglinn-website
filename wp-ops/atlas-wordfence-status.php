<?php
/**
 * Plugin Name: Atlas Wordfence Status
 * Description: Read-only. Publishes the result of the one-shot Wordfence install as a response header, because the file that did the install deletes itself.
 * Version: 1.0.0
 * Author: atlasglinn-website (scripts/wp-wordfence-install.sh)
 *
 * WHY THIS EXISTS AS A SECOND FILE. wp-ops/atlas-wordfence-install.php unlinks itself the moment it finishes, so it
 * cannot report what it did. The saved GoDaddy login is SFTP-only (measured 2026-09-08) — there is no `wp option get`
 * from the Mac and no shell to read the database with. Something on the host has to say the result out loud.
 *
 * AND WHY IT IS A HEADER, NOT AN ENDPOINT. wp-ops/atlas-cache-watch.php already answers this question for this site:
 * a token-protected route was considered and rejected there, because it adds a remote-control surface to a production
 * site for a job that needs no caller. The mechanism that already exists here is a response header on a page WordPress
 * was going to render anyway — X-Atlas-Cache-Watch and X-Atlas-Static-Root are both read that way by their deploy
 * scripts — so this file adds a third one and no route, no query parameter, no token, and nothing an outside caller
 * can send. It reads two options and three constants and writes NOTHING: no option, no transient, no cron event, no
 * file, no post, no setting.
 *
 *   X-Atlas-Wordfence: <version>;b=<build>;st=<status>;wf=<wordfence version|none>;act=<0|1>;prep=<0|1>;self=<gone|left|pending|unknown>;tries=<n>;age=<fresh|hour|day|old|never>;err=<0|percent-encoded message>
 *
 * st  — the status recorded by the installer: installed · activated · already-active · installed-not-active · error ·
 *       gave-up · no-filesystem · running, or `none` when it has not written its option yet (the installer has not run
 *       a request yet, or never landed).
 * wf  — Wordfence's own version, measured on THIS request from WORDFENCE_VERSION when it is loaded, otherwise the
 *       version the installer recorded. `none` means nothing on this request says Wordfence is here.
 * act — whether wordfence/wordfence.php is in the live active_plugins option right now. This is the fact that matters
 *       and it is measured, not remembered: a recorded status of `installed` with act=0 is a plugin that was switched
 *       on and then switched off again.
 * prep— whether Wordfence's "extended protection" (auto_prepend_file / WFWAF_AUTO_PREPEND) is on. The installer never
 *       turns it on; this limb is here so a reader can see whether something else did.
 * b   — the first 8 of sha1 of THIS file, so a deploy can prove the bytes it just sent are the bytes running.
 * err — 0, or the installer's message percent-encoded so it survives as one header line. It is WordPress's own
 *       installer string ("Download failed…", "destination folder already exists"); no credential ever reaches it.
 *
 * The header goes out on front-end responses only (never in wp-admin), and only where the response is WordPress's:
 * https://atlasglinn.com/ is served by wp-ops/atlas-static-root.php from index.html and exits before this ever runs,
 * which is why every measurement in scripts/wp-wordfence-install.sh asks for /?atlas-wordfence=<ts> instead.
 *
 * HOW TO REMOVE: bash scripts/wp-wordfence-install.sh --remove, or define('ATLAS_WORDFENCE_STATUS_DISABLED', true);
 * in wp-config.php. Removing it leaves the option atlas_wordfence_install in place and leaves Wordfence running.
 */

if (!defined('ABSPATH')) { exit; }

define('ATLAS_WF_STATUS_VERSION', '1.0.0');
define('ATLAS_WF_STATUS_OPT', 'atlas_wordfence_install');
define('ATLAS_WF_STATUS_PLUGIN', 'wordfence/wordfence.php');

function atlas_wf_status_off() {
    return defined('ATLAS_WORDFENCE_STATUS_DISABLED') && ATLAS_WORDFENCE_STATUS_DISABLED;
}

function atlas_wf_status_build() {
    static $b = null;
    if ($b === null) {
        $h = sha1_file(__FILE__);
        $b = is_string($h) ? substr($h, 0, 8) : '00000000';
    }
    return $b;
}

// Coarse buckets, never a raw epoch — the same rule as atlas-cache-watch.php: an operator needs "is this fresh", and a
// public response has no business carrying a timestamp.
function atlas_wf_status_age($t) {
    $t = (int) $t;
    if ($t <= 0) { return 'never'; }
    $d = time() - $t;
    if ($d < 0) { $d = 0; }
    if ($d < 900) { return 'fresh'; }
    if ($d < 3600) { return 'hour'; }
    if ($d < 86400) { return 'day'; }
    return 'old';
}

// Every limb is one token with no ';' or control byte in it, or the header stops being parseable by the deploy script.
function atlas_wf_status_token($s, $max = 40) {
    $s = preg_replace('/[^A-Za-z0-9._\-]/', '_', (string) $s);
    if ($s === '') { return 'none'; }
    return strlen($s) > $max ? substr($s, 0, $max) : $s;
}

function atlas_wf_status_active() {
    $active = get_option('active_plugins', array());
    if (!is_array($active)) { $active = array(); }
    if (in_array(ATLAS_WF_STATUS_PLUGIN, $active, true)) { return 1; }
    // A network activation lives somewhere else entirely; this is a single site, so that is reported as not-active
    // rather than guessed at.
    return 0;
}

function atlas_wf_status_value() {
    $rec = get_option(ATLAS_WF_STATUS_OPT, false);
    if (!is_array($rec)) { $rec = array(); }
    $st    = isset($rec['status']) ? atlas_wf_status_token($rec['status'], 24) : 'none';
    $self  = isset($rec['self']) ? atlas_wf_status_token($rec['self'], 12) : 'unknown';
    $tries = isset($rec['tries']) ? (int) $rec['tries'] : 0;
    $age   = atlas_wf_status_age(isset($rec['time']) ? $rec['time'] : 0);
    $err   = isset($rec['error']) ? (string) $rec['error'] : '';
    $wf    = defined('WORDFENCE_VERSION') ? (string) WORDFENCE_VERSION : (isset($rec['version']) ? (string) $rec['version'] : '');
    $prep  = (defined('WFWAF_AUTO_PREPEND') && WFWAF_AUTO_PREPEND) ? 1 : 0;
    return ATLAS_WF_STATUS_VERSION
        . ';b=' . atlas_wf_status_build()
        . ';st=' . $st
        . ';wf=' . atlas_wf_status_token($wf, 24)
        . ';act=' . atlas_wf_status_active()
        . ';prep=' . $prep
        . ';self=' . $self
        . ';tries=' . $tries
        . ';age=' . $age
        . ';err=' . ($err === '' ? '0' : rawurlencode(substr($err, 0, 180)));
}

function atlas_wf_status_send_header() {
    if (atlas_wf_status_off()) { return; }
    if (function_exists('is_admin') && is_admin()) { return; }
    if (headers_sent()) { return; }
    header('X-Atlas-Wordfence: ' . atlas_wf_status_value());
}

if (atlas_wf_status_off()) { return; }
add_action('send_headers', 'atlas_wf_status_send_header');
