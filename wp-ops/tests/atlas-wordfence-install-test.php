<?php
/**
 * Harness for wp-ops/atlas-wordfence-install.php and wp-ops/atlas-wordfence-status.php — a stub WordPress, a stub
 * WP_Upgrader and a fake docroot. No host, no network, no wordpress.org.
 *
 *   php wp-ops/tests/atlas-wordfence-install-test.php
 *
 * Each scenario runs in its own process, because the plugin defines constants, adds its hook once, and DELETES ITSELF:
 * every child copies the plugin into its own run directory first, so the file the one-shot unlinks is the copy and the
 * repository file is never touched. The parent prints every PASS/FAIL and exits non-zero if any case fails — and each
 * scenario carries a PINNED assertion count, because a scenario that dies after its first assertion would otherwise
 * report green (the rule wp-ops/tests/atlas-cache-watch-test.php learned).
 *
 * What it holds down:
 *   · the install path — plugins_api → Plugin_Upgrader::install → activate_plugin, recorded as status=installed with
 *     the version read back, and the file gone afterwards;
 *   · the two paths that must NOT download anything: already-active, and already-on-disk-but-inactive;
 *   · NOTHING THE SKIN ECHOES REACHES THE PAGE. Plugin_Installer_Skin is an admin-screen skin that prints a header, a
 *     feedback line per step and a block of links; the stub skin echoes on every one of those, and the assertion is
 *     that a visitor's response carried none of it;
 *   · a failed install is RETRYABLE — the file stays on the host and `tries` climbs — until the third attempt, which
 *     records the failure and removes the file anyway. This is the guard that keeps a broken install from re-running
 *     on every request forever, and the one that keeps a single flaky download from being final;
 *   · the request shapes that are refused outright: POST, admin, ajax, cron, REST, XML-RPC, wp-login.php, wp-cron.php
 *     — the IWA shop's cart fragments arrive as admin-ajax and a 30-second install must not land inside one;
 *   · the lock: a second request while one is mid-install does nothing at all;
 *   · a terminal record already in the database means the work is done — no second install, and the file goes;
 *   · a filesystem WordPress cannot write directly is refused BEFORE the upgrader is constructed, because the skin
 *     would otherwise echo an FTP-credentials form into a visitor's page and install nothing;
 *   · NO SETTING IS WRITTEN. The plugin's whole source is checked for wfConfig, loginSec_*, alertEmails, 2FA and
 *     auto_prepend — the settings the SSH-based attempt on the wp-harden-login branch wrote, and the ones that can
 *     lock the site's only admin out of wp-admin;
 *   · the error text never reaches the error_log line (a token in an exception message is the sibling plugin's rule);
 *   · the status header: every limb, the live act= read, and a message with a newline and a semicolon in it surviving
 *     as ONE parseable header line.
 */

$SCN = isset($_SERVER['argv'][1]) ? $_SERVER['argv'][1] : '';

// ── parent ────────────────────────────────────────────────────────────────────────────────────────────────────────────
if ($SCN === '') {
    $pins = array(
        'fresh'          => 11,
        'already-active' => 6,
        'on-disk'        => 5,
        'api-error'      => 12,
        'no-installer'   => 4,
        'no-filesystem'  => 5,
        'activate-fails' => 5,
        'guard'          => 4,
        'give-up'        => 4,
        'locked'         => 3,
        'refused'        => 9,
        'disabled'       => 3,
        'status-header'  => 14,
        'source'         => 9,
    );
    $php  = defined('PHP_BINARY') && PHP_BINARY ? PHP_BINARY : 'php';
    $fail = 0; $total = 0;
    foreach ($pins as $scn => $pin) {
        $out = array(); $rc = 0;
        exec(escapeshellarg($php) . ' ' . escapeshellarg(__FILE__) . ' ' . escapeshellarg($scn) . ' 2>&1', $out, $rc);
        $text = implode("\n", $out);
        echo $text . "\n";
        $pass = preg_match_all('/^PASS /m', $text);
        $bad  = preg_match_all('/^FAIL /m', $text);
        $total += $pass + $bad;
        $fail  += $bad;
        if ($pass + $bad !== $pin) {
            echo "FAIL harness: scenario $scn reported " . ($pass + $bad) . " assertions, pinned at $pin\n";
            $fail++; $total++;
        }
        if ($rc !== 0 && $bad === 0) {
            echo "FAIL harness: scenario $scn exited $rc without reporting a failure of its own\n";
            $fail++; $total++;
        }
    }
    echo "\n" . ($fail ? "FAILED" : "OK") . ": $total assertions, $fail failed\n";
    exit($fail ? 1 : 0);
}

// ── child: the stub WordPress ─────────────────────────────────────────────────────────────────────────────────────────
$GLOBALS['t_opts']   = array();
$GLOBALS['t_trans']  = array();
$GLOBALS['t_acts']   = array();
$GLOBALS['t_calls']  = array();
$GLOBALS['t_active'] = false;      // is_plugin_active()
$GLOBALS['t_fsmeth'] = 'direct';
$GLOBALS['t_api']    = null;       // object, or a WP_Error, set per scenario
$GLOBALS['t_install']= true;       // what Plugin_Upgrader::install() returns
$GLOBALS['t_act_ret']= true;       // what activate_plugin() returns
$GLOBALS['t_admin']  = false;
$GLOBALS['t_ajax']   = false;
$GLOBALS['t_cron']   = false;
$GLOBALS['t_plugins']= array();    // get_plugins()

class WP_Error {
    private $c, $m;
    public function __construct($c = '', $m = '') { $this->c = $c; $this->m = $m; }
    public function get_error_code() { return $this->c; }
    public function get_error_message() { return $this->m; }
}
function is_wp_error($t) { return $t instanceof WP_Error; }
function t_hit($n) { $GLOBALS['t_calls'][] = $n; }
function t_hits($n) { return count(array_keys($GLOBALS['t_calls'], $n)); }

function get_option($k, $d = false) { return array_key_exists($k, $GLOBALS['t_opts']) ? $GLOBALS['t_opts'][$k] : $d; }
function update_option($k, $v, $a = null) { t_hit('update_option:' . $k); $GLOBALS['t_opts'][$k] = $v; return true; }
function delete_option($k) { unset($GLOBALS['t_opts'][$k]); return true; }
function get_transient($k) { return array_key_exists($k, $GLOBALS['t_trans']) ? $GLOBALS['t_trans'][$k] : false; }
function set_transient($k, $v, $t = 0) { t_hit('set_transient'); $GLOBALS['t_trans'][$k] = $v; return true; }
function delete_transient($k) { t_hit('delete_transient'); unset($GLOBALS['t_trans'][$k]); return true; }
function add_action($h, $cb, $p = 10, $n = 1) { $GLOBALS['t_acts'][$h][] = $cb; }
function do_action($h) { foreach (isset($GLOBALS['t_acts'][$h]) ? $GLOBALS['t_acts'][$h] : array() as $cb) { call_user_func($cb); } }
function wp_strip_all_tags($s) { return strip_tags((string) $s); }
function wp_installing() { return false; }
function wp_doing_ajax() { return (bool) $GLOBALS['t_ajax']; }
function wp_doing_cron() { return (bool) $GLOBALS['t_cron']; }
function is_admin() { return (bool) $GLOBALS['t_admin']; }
function is_plugin_active($p) { t_hit('is_plugin_active'); return (bool) $GLOBALS['t_active']; }
function get_plugins() { return $GLOBALS['t_plugins']; }
function get_filesystem_method() { t_hit('get_filesystem_method'); return $GLOBALS['t_fsmeth']; }
function plugins_api($action, $args = array()) { t_hit('plugins_api'); return $GLOBALS['t_api']; }
function activate_plugin($p, $r = '', $n = false, $s = false) {
    t_hit('activate_plugin');
    // $silent must stay false: it would skip Wordfence's own activation hook, which is what creates its tables.
    if ($s) { t_hit('activate_plugin:silent'); }
    if (!is_wp_error($GLOBALS['t_act_ret'])) { $GLOBALS['t_active'] = true; }
    return $GLOBALS['t_act_ret'];
}

// WordPress's installer, as much of its shape as this plugin touches. The skin ECHOES on every frame on purpose: the
// assertion that matters most here is that none of it reaches the response.
class WP_Upgrader_Skin {
    public $done_header = false, $done_footer = false, $options = array(), $api = null;
    public function __construct($args = array()) { $this->options = $args; if (isset($args['api'])) { $this->api = $args['api']; } }
    public function header() { if ($this->done_header) { return; } echo "SKIN-NOISE-header\n"; }
    public function footer() { if ($this->done_footer) { return; } echo "SKIN-NOISE-footer\n"; }
    public function feedback($s, ...$a) { echo "SKIN-NOISE-feedback:$s\n"; }
}
class Plugin_Installer_Skin extends WP_Upgrader_Skin {
    public function before() { echo "SKIN-NOISE-before\n"; }
    public function after() { echo "SKIN-NOISE-after\n"; }
}
class Plugin_Upgrader {
    public $skin;
    public function __construct($skin = null) { $this->skin = $skin; t_hit('upgrader:new'); }
    public function install($package) {
        t_hit('install:' . $package);
        $this->skin->header(); $this->skin->before(); $this->skin->feedback('installing');
        $r = $GLOBALS['t_install'];
        if ($r === true) {
            $dir = WP_PLUGIN_DIR . '/wordfence';
            if (!is_dir($dir)) { mkdir($dir, 0777, true); }
            file_put_contents($dir . '/wordfence.php', "<?php // stub wordfence\n");
        }
        $this->skin->after(); $this->skin->footer();
        return $r;
    }
}

// ── child: the run directory ──────────────────────────────────────────────────────────────────────────────────────────
$RUN = sys_get_temp_dir() . '/atlas-wf-test-' . getmypid() . '-' . $SCN;
foreach (array('/wp-admin/includes', '/wp-content/plugins', '/wp-content/mu-plugins') as $sub) { @mkdir($RUN . $sub, 0777, true); }
define('ABSPATH', $RUN . '/');
define('WP_PLUGIN_DIR', $RUN . '/wp-content/plugins');
$INCLUDES = array('plugin.php', 'file.php', 'misc.php', 'plugin-install.php', 'class-wp-upgrader.php');
function t_write_includes($which) {
    foreach ($which as $f) { file_put_contents(ABSPATH . 'wp-admin/includes/' . $f, "<?php\n// stub: the harness defines these itself\n"); }
}
$ERRLOG = $RUN . '/error.log';
ini_set('log_errors', '1');
ini_set('error_log', $ERRLOG);

$SRC_INSTALL  = dirname(__DIR__) . '/atlas-wordfence-install.php';
$SRC_STATUS   = dirname(__DIR__) . '/atlas-wordfence-status.php';
$COPY_INSTALL = ABSPATH . 'wp-content/mu-plugins/atlas-wordfence-install.php';
$COPY_STATUS  = ABSPATH . 'wp-content/mu-plugins/atlas-wordfence-status.php';

$T_N = 0;
function ok($what, $cond) {
    $GLOBALS['T_N']++;
    echo ($cond ? 'PASS ' : 'FAIL ') . $GLOBALS['argv'][1] . ': ' . $what . "\n";
}
// A file's CODE with every comment removed, so an assertion about what a file never does is not defeated by the file
// saying, in a comment, that it never does it.
function t_code($file) {
    $out = '';
    foreach (token_get_all(file_get_contents($file)) as $t) {
        if (is_array($t)) {
            if ($t[0] === T_COMMENT || $t[0] === T_DOC_COMMENT) { continue; }
            $out .= $t[1];
        } else { $out .= $t; }
    }
    return $out;
}
function t_rec() { return get_option('atlas_wordfence_install', false); }
function t_field($k) { $r = t_rec(); return is_array($r) && isset($r[$k]) ? $r[$k] : null; }
// Every scenario drives the plugin the way WordPress does — through the hook it registered — and captures anything it
// prints, because a visitor's page is what that output would land in.
function t_run_init() {
    ob_start();
    do_action('init');
    return ob_get_clean();
}
$_SERVER['REQUEST_METHOD'] = 'GET';
$_SERVER['SCRIPT_NAME']    = '/index.php';

switch ($SCN) {

case 'fresh':
    t_write_includes($INCLUDES);
    $GLOBALS['t_api'] = (object) array('download_link' => 'https://downloads.wordpress.org/plugin/wordfence.8.0.5.zip', 'version' => '8.0.5');
    $GLOBALS['t_plugins'] = array('wordfence/wordfence.php' => array('Version' => '8.0.5'));
    copy($SRC_INSTALL, $COPY_INSTALL); require $COPY_INSTALL;
    $leak = t_run_init();
    ok('the skin printed nothing into the response', $leak === '');
    ok('status=installed', t_field('status') === 'installed');
    ok('version read back from get_plugins()', t_field('version') === '8.0.5');
    ok('no error recorded', t_field('error') === '');
    ok('one attempt counted', t_field('tries') === 1);
    ok('the package fetched is the download_link plugins_api gave', t_hits('install:https://downloads.wordpress.org/plugin/wordfence.8.0.5.zip') === 1);
    ok('activate_plugin() called, and NOT silently', t_hits('activate_plugin') === 1 && t_hits('activate_plugin:silent') === 0);
    ok('the lock was taken and released', t_hits('set_transient') === 1 && t_hits('delete_transient') === 1);
    ok('the one-shot deleted itself', !file_exists($COPY_INSTALL));
    ok('the record says self=gone', t_field('self') === 'gone');
    $log = is_file($ERRLOG) ? file_get_contents($ERRLOG) : '';
    ok('the error_log line carries status/version/0-1 and no message text', strpos($log, 'status=installed') !== false && strpos($log, 'err=0') !== false);
    break;

case 'already-active':
    t_write_includes($INCLUDES);
    $GLOBALS['t_active'] = true;
    $GLOBALS['t_plugins'] = array('wordfence/wordfence.php' => array('Version' => '7.11.0'));
    copy($SRC_INSTALL, $COPY_INSTALL); require $COPY_INSTALL;
    $leak = t_run_init();
    ok('nothing printed', $leak === '');
    ok('status=already-active', t_field('status') === 'already-active');
    ok('version still read back', t_field('version') === '7.11.0');
    ok('wordpress.org was never asked', t_hits('plugins_api') === 0);
    ok('nothing was installed and nothing was activated', t_hits('upgrader:new') === 0 && t_hits('activate_plugin') === 0);
    ok('the one-shot deleted itself', !file_exists($COPY_INSTALL));
    break;

case 'on-disk':
    t_write_includes($INCLUDES);
    mkdir(WP_PLUGIN_DIR . '/wordfence', 0777, true);
    file_put_contents(WP_PLUGIN_DIR . '/wordfence/wordfence.php', "<?php\n");
    $GLOBALS['t_plugins'] = array('wordfence/wordfence.php' => array('Version' => '8.0.5'));
    copy($SRC_INSTALL, $COPY_INSTALL); require $COPY_INSTALL;
    t_run_init();
    ok('status=activated (installed already, only switched on)', t_field('status') === 'activated');
    ok('no download', t_hits('plugins_api') === 0 && t_hits('upgrader:new') === 0);
    ok('the filesystem method was not even asked for', t_hits('get_filesystem_method') === 0);
    ok('activate_plugin() called once', t_hits('activate_plugin') === 1);
    ok('the one-shot deleted itself', !file_exists($COPY_INSTALL));
    break;

case 'api-error':
    t_write_includes($INCLUDES);
    $GLOBALS['t_api'] = new WP_Error('plugins_api_failed', "An unexpected error occurred.\nSomething may be wrong with WordPress.org");
    copy($SRC_INSTALL, $COPY_INSTALL); require $COPY_INSTALL;
    t_run_init();
    ok('first failure: status=error', t_field('status') === 'error');
    ok('the error carries the WP_Error code', strpos((string) t_field('error'), 'plugins_api:plugins_api_failed') === 0);
    ok('the message is flattened to one line', strpos((string) t_field('error'), "\n") === false);
    ok('tries=1', t_field('tries') === 1);
    ok('the file STAYS for the next trigger', file_exists($COPY_INSTALL));
    ok('self=pending', t_field('self') === 'pending');
    t_run_init();
    ok('second failure counted', t_field('tries') === 2);
    ok('the file still stays', file_exists($COPY_INSTALL));
    t_run_init();
    ok('third failure is the last', t_field('tries') === 3);
    ok('status is still error, not a false success', t_field('status') === 'error');
    ok('now the file is removed', !file_exists($COPY_INSTALL));
    $log = is_file($ERRLOG) ? file_get_contents($ERRLOG) : '';
    ok('the message text never reached the error_log line', strpos($log, 'err=1') !== false && strpos($log, 'WordPress.org') === false);
    break;

case 'no-installer':
    // class-wp-upgrader.php absent: WordPress's own installer is not there, so nothing is constructed.
    t_write_includes(array('plugin.php', 'file.php', 'misc.php', 'plugin-install.php'));
    copy($SRC_INSTALL, $COPY_INSTALL); require $COPY_INSTALL;
    t_run_init();
    ok('status=error', t_field('status') === 'error');
    ok('the error names the missing include', strpos((string) t_field('error'), 'installer:missing wp-admin/includes/class-wp-upgrader.php') === 0);
    ok('nothing was fetched', t_hits('plugins_api') === 0);
    ok('retryable: the file stays', file_exists($COPY_INSTALL));
    break;

case 'no-filesystem':
    t_write_includes($INCLUDES);
    $GLOBALS['t_fsmeth'] = 'ftpext';
    copy($SRC_INSTALL, $COPY_INSTALL); require $COPY_INSTALL;
    $leak = t_run_init();
    ok('status=no-filesystem', t_field('status') === 'no-filesystem');
    ok('the reason names the method', strpos((string) t_field('error'), 'ftpext') !== false);
    ok('wordpress.org was never asked and no skin was built', t_hits('plugins_api') === 0 && t_hits('upgrader:new') === 0);
    ok('no credentials form reached the response', $leak === '');
    ok('not retryable: the file is removed', !file_exists($COPY_INSTALL));
    break;

case 'activate-fails':
    t_write_includes($INCLUDES);
    $GLOBALS['t_api'] = (object) array('download_link' => 'https://downloads.wordpress.org/plugin/wordfence.zip');
    $GLOBALS['t_act_ret'] = new WP_Error('plugin_not_found', 'Plugin file does not exist.');
    $GLOBALS['t_plugins'] = array('wordfence/wordfence.php' => array('Version' => '8.0.5'));
    copy($SRC_INSTALL, $COPY_INSTALL); require $COPY_INSTALL;
    t_run_init();
    ok('status=installed-not-active', t_field('status') === 'installed-not-active');
    ok('the error carries the activation code', strpos((string) t_field('error'), 'activate:plugin_not_found') === 0);
    ok('the version is still recorded', t_field('version') === '8.0.5');
    ok('it installed exactly once', t_hits('upgrader:new') === 1);
    ok('not retryable: the file is removed', !file_exists($COPY_INSTALL));
    break;

case 'guard':
    t_write_includes($INCLUDES);
    $GLOBALS['t_opts']['atlas_wordfence_install'] = array('status' => 'installed', 'version' => '8.0.5', 'time' => time() - 60, 'error' => '', 'tries' => 1, 'self' => 'gone');
    copy($SRC_INSTALL, $COPY_INSTALL); require $COPY_INSTALL;
    t_run_init();
    ok('a terminal record means no second install', t_hits('plugins_api') === 0 && t_hits('upgrader:new') === 0 && t_hits('activate_plugin') === 0);
    ok('the recorded status is left alone', t_field('status') === 'installed');
    ok('no lock was taken', t_hits('set_transient') === 0);
    ok('the file is removed again anyway', !file_exists($COPY_INSTALL));
    break;

case 'give-up':
    t_write_includes($INCLUDES);
    $GLOBALS['t_opts']['atlas_wordfence_install'] = array('status' => 'running', 'version' => '', 'time' => time() - 900, 'error' => '', 'tries' => 3, 'self' => 'pending');
    copy($SRC_INSTALL, $COPY_INSTALL); require $COPY_INSTALL;
    t_run_init();
    ok('status=gave-up after three attempts', t_field('status') === 'gave-up');
    ok('no fourth download', t_hits('plugins_api') === 0);
    ok('the file is removed', !file_exists($COPY_INSTALL));
    ok('the record says self=gone', t_field('self') === 'gone');
    break;

case 'locked':
    t_write_includes($INCLUDES);
    $GLOBALS['t_trans']['atlas_wordfence_install_lock'] = time();
    copy($SRC_INSTALL, $COPY_INSTALL); require $COPY_INSTALL;
    t_run_init();
    ok('a locked request installs nothing', t_hits('plugins_api') === 0 && t_hits('upgrader:new') === 0);
    ok('and records nothing', t_rec() === false);
    ok('and leaves the file for the run that holds the lock', file_exists($COPY_INSTALL));
    break;

case 'refused':
    t_write_includes($INCLUDES);
    $GLOBALS['t_api'] = (object) array('download_link' => 'https://downloads.wordpress.org/plugin/wordfence.zip');
    $GLOBALS['t_plugins'] = array('wordfence/wordfence.php' => array('Version' => '8.0.5'));
    copy($SRC_INSTALL, $COPY_INSTALL); require $COPY_INSTALL;
    $_SERVER['REQUEST_METHOD'] = 'POST';
    t_run_init(); ok('a POST installs nothing', t_rec() === false);
    $_SERVER['REQUEST_METHOD'] = 'GET';
    $GLOBALS['t_admin'] = true;  t_run_init(); ok('wp-admin installs nothing', t_rec() === false); $GLOBALS['t_admin'] = false;
    $GLOBALS['t_ajax']  = true;  t_run_init(); ok('admin-ajax installs nothing (the shop cart lives there)', t_rec() === false); $GLOBALS['t_ajax'] = false;
    $GLOBALS['t_cron']  = true;  t_run_init(); ok('cron installs nothing', t_rec() === false); $GLOBALS['t_cron'] = false;
    $_SERVER['SCRIPT_NAME'] = '/wp-login.php';
    t_run_init(); ok('wp-login.php installs nothing — the login page is never made slower', t_rec() === false);
    $_SERVER['SCRIPT_NAME'] = '/wp-cron.php';
    t_run_init(); ok('wp-cron.php installs nothing', t_rec() === false);
    $_SERVER['SCRIPT_NAME'] = '/index.php';
    ok('and after all of that the file is still there', file_exists($COPY_INSTALL));
    t_run_init();
    ok('a plain front-end GET is the one shape that runs it', t_field('status') === 'installed');
    ok('which then removes the file', !file_exists($COPY_INSTALL));
    break;

case 'disabled':
    t_write_includes($INCLUDES);
    define('ATLAS_WORDFENCE_INSTALL_DISABLED', true);
    copy($SRC_INSTALL, $COPY_INSTALL); require $COPY_INSTALL;
    ok('the kill switch means no hook is registered at all', !isset($GLOBALS['t_acts']['init']));
    t_run_init();
    ok('nothing recorded', t_rec() === false);
    ok('the file is left exactly where it is', file_exists($COPY_INSTALL));
    break;

case 'status-header':
    copy($SRC_STATUS, $COPY_STATUS); require $COPY_STATUS;
    $GLOBALS['t_opts']['active_plugins'] = array('woocommerce/woocommerce.php');
    $GLOBALS['t_opts']['atlas_wordfence_install'] = array(
        'status' => 'installed', 'version' => '8.0.5', 'time' => time() - 30, 'error' => '', 'tries' => 1, 'self' => 'gone',
    );
    $writes = count($GLOBALS['t_calls']);
    $h = atlas_wf_status_value();
    ok('the reporter writes nothing at all', count($GLOBALS['t_calls']) === $writes);
    ok('it carries its own build fingerprint', strpos($h, ';b=' . substr(sha1_file($COPY_STATUS), 0, 8) . ';') !== false);
    ok('st= is the recorded status', strpos($h, ';st=installed;') !== false);
    ok('wf= is the recorded version', strpos($h, ';wf=8.0.5;') !== false);
    ok('act=0 while active_plugins does not carry it — the LIVE read, not the record', strpos($h, ';act=0;') !== false);
    ok('prep=0 while extended protection is off', strpos($h, ';prep=0;') !== false);
    ok('self= and tries= are carried', strpos($h, ';self=gone;') !== false && strpos($h, ';tries=1;') !== false);
    ok('age=fresh 30 seconds after the record', strpos($h, ';age=fresh;') !== false);
    ok('err=0 when there was none', substr($h, -6) === ';err=0');
    $GLOBALS['t_opts']['active_plugins'][] = 'wordfence/wordfence.php';
    ok('act=1 the moment the plugin is in active_plugins', strpos(atlas_wf_status_value(), ';act=1;') !== false);
    $GLOBALS['t_opts']['atlas_wordfence_install'] = array(
        'status' => 'error', 'version' => '', 'time' => time() - 7200, 'error' => "install:download_failed:Download failed.\nsemi;colon and a space", 'tries' => 2, 'self' => 'pending',
    );
    $h2 = atlas_wf_status_value();
    ok('a message with a newline stays ONE header line', strpos($h2, "\n") === false && strpos($h2, "\r") === false);
    ok('its own semicolon cannot fake a limb', substr_count($h2, ';') === 9);
    ok('age=day two hours later', strpos($h2, ';age=day;') !== false);
    ok('the message survives percent-decoding', strpos(rawurldecode(substr($h2, strpos($h2, ';err=') + 5)), 'Download failed.') !== false);
    break;

case 'source':
    // Read as text, because these are absences: a setting this file never writes cannot be proved by running it. The
    // COMMENTS are stripped first — both files name auto_prepend_file and unlink() in prose, saying they do not do
    // them, and a grep of the raw text reads that promise as the violation it rules out.
    $src = t_code($SRC_INSTALL);
    ok('no wfConfig write', strpos($src, 'wfConfig') === false);
    ok('no login-failure or lockout setting', strpos($src, 'loginSec_') === false);
    ok('no username blacklist', stripos($src, 'userBlacklist') === false);
    ok('no alert-email write', strpos($src, 'alertEmails') === false);
    ok('no 2FA enrolment', stripos($src, 'two-factor') === false && stripos($src, 'wfls_') === false);
    ok('no auto_prepend_file / extended protection', stripos($src, 'auto_prepend') === false && stripos($src, 'WFWAF') === false);
    ok('the only plugin slug it can install is wordfence', substr_count($src, "'wordfence'") === 1 && strpos($src, "ATLAS_WF_INSTALL_SLUG', 'wordfence'") !== false);
    ok('it exits when loaded outside WordPress', strpos($src, "if (!defined('ABSPATH')) { exit; }") !== false);
    $st = t_code($SRC_STATUS);
    ok('the reporter writes no option, transient or file', strpos($st, 'update_option') === false && strpos($st, 'set_transient') === false && strpos($st, 'file_put_contents') === false && strpos($st, 'unlink') === false);
    break;

default:
    echo "FAIL unknown scenario $SCN\n";
    exit(1);
}
exit(0);
