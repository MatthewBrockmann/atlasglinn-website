<?php
/**
 * Harness for wp-ops/atlas-cache-watch.php — a stub WordPress and a stub WPaaS\Cache_V2, no host and no network.
 *
 *   php wp-ops/tests/atlas-cache-watch-test.php
 *
 * Six scenarios, each in its own process because the plugin's constants and its file-scope `return` can only be
 * exercised once per interpreter: wpaas (the cascade), throwing (a failing flush_cdn and the back-off), nowpaas,
 * badclass (the allowlist), disabled, uninstall. The parent prints every PASS/FAIL line and exits non-zero if any
 * case fails — and each scenario carries a PINNED assertion count, because a scenario that died after its first
 * assertion used to report green: the parent counted the PASS lines it saw and nothing said how many there should
 * have been. Fewer than the pin is a failure, and so is a scenario that exits non-zero without reporting one itself.
 *
 * The throwing scenario raises an exception whose message carries a token-shaped string on purpose: the assertions
 * that matter most here are that the string reaches neither the stored option nor the error log.
 */

namespace WPaaS {
    // GoDaddy's shape, as scripts/wp-flush.sh's DIAG found it: a non-public constructor, a singleton accessor, and
    // four non-public methods that only reflection can reach. Declared only for the scenarios that need it.
    $atlas_scn = isset($_SERVER['argv'][1]) ? $_SERVER['argv'][1] : '';
    if ($atlas_scn === 'badclass') {
        // Declared inside GoDaddy's own namespace on purpose. It is what a `WPaaS\` PREFIX test would happily
        // construct, and what the plugin's exact-name allowlist has to refuse: anything that can write the global can
        // write a WPaaS-namespaced name into it too.
        class Cache_V2_Evil {
            public function __construct() { $GLOBALS['t_evil'] = 1; }
            public function do_ban() {} public function flush_cdn() {}
            public function flush_transients() {} public function flush_object_cache() {}
        }
    }
    if ($atlas_scn === 'wpaas' || $atlas_scn === 'throwing') {
        class Cache_V2 {
            public static $calls = array();
            public static $throw_method = '';
            public static $throw_message = '';
            private function __construct() {}
            public static function instance() { return new self(); }
            private function do_ban() { self::hit('do_ban'); }
            protected function flush_cdn() { self::hit('flush_cdn'); }
            private function flush_transients() { self::hit('flush_transients'); }
            private function flush_object_cache() { self::hit('flush_object_cache'); }
            private static function hit($m) {
                self::$calls[] = $m;
                if (self::$throw_method === $m) { throw new \RuntimeException(self::$throw_message); }
            }
            public static function runs() { return count(array_keys(self::$calls, 'do_ban')); }
            public static function ran($m) { return count(array_keys(self::$calls, $m)); }
        }
    }
}

namespace {

// ── the runner ──────────────────────────────────────────────────────────────────────────────────────────────────────
if (!isset($_SERVER['argv'][1])) {
    // The pin is the harness guarding itself. A scenario that died after its first assertion used to report GREEN: the
    // parent counted the PASS lines it happened to see and nothing said how many there were supposed to be. So each
    // scenario carries its assertion count, a shortfall is a failure, and a scenario that exits non-zero without
    // reporting a FAIL of its own is a death, not a pass.
    $scenarios = array('wpaas' => 51, 'throwing' => 23, 'nowpaas' => 8, 'badclass' => 9, 'disabled' => 5, 'uninstall' => 10);
    $pass = 0; $fail = 0; $bad = array(); $counts = array();
    foreach ($scenarios as $s => $want) {
        $cmd = escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg(__FILE__) . ' ' . escapeshellarg($s) . ' 2>&1';
        $lines = array(); $rc = 0;
        exec($cmd, $lines, $rc);
        $got = 0; $sawfail = false;
        foreach ($lines as $l) {
            if (strpos($l, 'PASS ') === 0) { $pass++; $got++; echo '  PASS ' . $s . '/' . substr($l, 5) . "\n"; }
            elseif (strpos($l, 'FAIL ') === 0) { $fail++; $got++; $sawfail = true; $bad[] = $s . '/' . substr($l, 5); echo '  FAIL ' . $s . '/' . substr($l, 5) . "\n"; }
            else { echo '  | ' . $l . "\n"; }
        }
        $counts[] = $s . ' ' . $got . '/' . $want;
        if ($rc !== 0 && !$sawfail) {
            $fail++; $bad[] = $s . '/scenario-exited-' . $rc;
            echo '  FAIL ' . $s . "/scenario-exited-$rc without reporting a failure — it died mid-scenario\n";
        }
        if ($got < $want) {
            $fail++; $bad[] = $s . '/assertions-shrank-' . $got . '-of-' . $want;
            echo '  FAIL ' . $s . "/assertions-shrank: ran $got of the $want pinned in this file\n";
        } elseif ($got > $want) {
            echo '  | ' . $s . ": $got assertions, $want pinned — raise the pin in this file\n";
        }
    }
    echo "\nper scenario: " . implode(' · ', $counts) . "\n";
    echo "atlas-cache-watch: $pass passed, $fail failed (" . count($scenarios) . " scenarios)\n";
    if ($fail) { echo "failed: " . implode(', ', $bad) . "\n"; }
    exit($fail ? 1 : 0);
}

// ── one scenario ────────────────────────────────────────────────────────────────────────────────────────────────────
$SCN  = $_SERVER['argv'][1];
$PASS = 0; $FAILED = 0;
function t($name, $cond, $detail = '') {
    global $PASS, $FAILED;
    if ($cond) { $PASS++; echo "PASS $name\n"; }
    else { $FAILED++; echo "FAIL $name" . ($detail !== '' ? ": $detail" : '') . "\n"; }
}

$ROOT = sys_get_temp_dir() . '/atlas-cache-watch-test-' . getmypid() . '/';
mkdir($ROOT, 0700, true);
mkdir($ROOT . 'docroot', 0700, true);
$DOC = $ROOT . 'docroot/';
$LOG = $ROOT . 'php-error.log';
ini_set('error_log', $LOG);
register_shutdown_function(function () use ($ROOT) {
    foreach (glob($ROOT . 'docroot/*') as $f) { @unlink($f); }
    @unlink($ROOT . 'php-error.log');
    @rmdir($ROOT . 'docroot'); @rmdir($ROOT);
});
foreach (array('index.html', 'mastsolutions.html', 'training.html') as $h) { file_put_contents($DOC . $h, '<html>' . $h . '</html>'); }
file_put_contents($DOC . 'build-manifest.json', '{"build":"aaa"}');
file_put_contents($DOC . 'mast-ping.txt', 'ping');

define('ABSPATH', $DOC);

// ── stub WordPress ──────────────────────────────────────────────────────────────────────────────────────────────────
$GLOBALS['t_options']    = array();
$GLOBALS['t_transients'] = array();
$GLOBALS['t_actions']    = array();
$GLOBALS['t_filters']    = array();
$GLOBALS['t_cron']       = array();
$GLOBALS['t_cache_flush'] = 0;
$GLOBALS['t_is_admin']   = false;
$GLOBALS['t_autosave']   = false;
$GLOBALS['t_revision']   = false;

function get_option($n, $d = false) { return array_key_exists($n, $GLOBALS['t_options']) ? $GLOBALS['t_options'][$n]['v'] : $d; }
function update_option($n, $v, $autoload = null) { $GLOBALS['t_options'][$n] = array('v' => $v, 'autoload' => $autoload); return true; }
function delete_option($n) { unset($GLOBALS['t_options'][$n]); return true; }
function t_autoload($n) { return isset($GLOBALS['t_options'][$n]) ? $GLOBALS['t_options'][$n]['autoload'] : 'absent'; }
function get_transient($n) {
    if (!isset($GLOBALS['t_transients'][$n])) { return false; }
    $e = $GLOBALS['t_transients'][$n];
    if ($e['exp'] > 0 && $e['exp'] <= time()) { unset($GLOBALS['t_transients'][$n]); return false; }
    return $e['v'];
}
function set_transient($n, $v, $exp = 0) { $GLOBALS['t_transients'][$n] = array('v' => $v, 'exp' => $exp > 0 ? time() + $exp : 0); return true; }
function delete_transient($n) { unset($GLOBALS['t_transients'][$n]); return true; }
function add_action($h, $cb, $p = 10, $a = 1) { $GLOBALS['t_actions'][] = array($h, $cb); return true; }
function add_filter($h, $cb, $p = 10, $a = 1) { $GLOBALS['t_filters'][] = array($h, $cb); return true; }
function do_action($h) { foreach ($GLOBALS['t_actions'] as $r) { if ($r[0] === $h) { call_user_func($r[1]); } } }
function t_hooked($h) { $n = 0; foreach ($GLOBALS['t_actions'] as $r) { if ($r[0] === $h) { $n++; } } foreach ($GLOBALS['t_filters'] as $r) { if ($r[0] === $h) { $n++; } } return $n; }
function wp_next_scheduled($h) { return isset($GLOBALS['t_cron'][$h]) ? $GLOBALS['t_cron'][$h] : false; }
function wp_schedule_event($t, $r, $h) { $GLOBALS['t_cron'][$h] = $t; return true; }
function wp_clear_scheduled_hook($h) { unset($GLOBALS['t_cron'][$h]); return 1; }
function wp_cache_flush() { $GLOBALS['t_cache_flush']++; return true; }
function is_admin() { return $GLOBALS['t_is_admin']; }
function wp_is_post_autosave($id) { return $GLOBALS['t_autosave']; }
function wp_is_post_revision($id) { return $GLOBALS['t_revision']; }

function t_bump($name, $n) { $p = ABSPATH . $name; file_put_contents($p, str_repeat('x', 64 + $n)); touch($p, time() + $n); clearstatcache(); }
function t_log() { global $LOG; return is_file($LOG) ? file_get_contents($LOG) : ''; }
function t_store() { return serialize($GLOBALS['t_options']); }
function t_fp() { $s = get_option('atlas_cache_watch_fp', array()); return isset($s['fp']) ? $s['fp'] : ''; }
function t_fail() { $s = get_option('atlas_cache_watch_fp', array()); return isset($s['fail']) ? (int) $s['fail'] : -1; }
function t_gaveup() { $s = get_option('atlas_cache_watch_fp', array()); return isset($s['gaveup']) ? (int) $s['gaveup'] : -1; }
function t_tick() { $s = get_option('atlas_cache_watch_fp', array()); return isset($s['tick']) ? (int) $s['tick'] : 0; }
function t_last() { return get_option('atlas_cache_watch_last', false); }
function t_unlock() { delete_transient('atlas_cache_watch_lock'); }

$HDR_RE = '/^\d+\.\d+\.\d+;b=[0-9a-f]{8};age=(fresh|hour|day|old|never);cdn=(ok|no|none);fp=[01];tick=(fresh|hour|day|old|never)$/';
$PLUGIN = dirname(__DIR__) . '/atlas-cache-watch.php';

if ($SCN === 'disabled')  { define('ATLAS_CACHE_WATCH_DISABLED', true); }
if ($SCN === 'uninstall') {
    define('ATLAS_CACHE_WATCH_UNINSTALL', true);
    update_option('atlas_cache_watch_fp', array('fp' => 'seed', 'files' => array(), 'tick' => time(), 'fail' => 0, 'gaveup' => 0), false);
    update_option('atlas_cache_watch_last', array('time' => time(), 'changed' => array(), 'results' => array()), false);
    set_transient('atlas_cache_watch_lock', time(), 120);
    $GLOBALS['t_cron']['atlas_cache_watch_tick'] = time() + 60;
}
if ($SCN === 'wpaas' || $SCN === 'throwing') { $GLOBALS['wpaas_cache_class'] = 'WPaaS\Cache_V2'; }
if ($SCN === 'badclass') {
    class Atlas_Test_Evil {
        public function __construct() { $GLOBALS['t_evil'] = 1; }
        public function do_ban() {} public function flush_cdn() {}
        public function flush_transients() {} public function flush_object_cache() {}
    }
    $GLOBALS['t_evil'] = 0;
    $GLOBALS['wpaas_cache_class'] = 'Atlas_Test_Evil';
}
$SECRET = 'ATLAS-TEST-SECRET-do-not-log-6b1f';
if ($SCN === 'throwing') {
    \WPaaS\Cache_V2::$throw_method  = 'flush_cdn';
    \WPaaS\Cache_V2::$throw_message = 'Cloudflare 403 Bearer ' . $SECRET . ' https://signed.example/p?sig=' . $SECRET;
}

require $PLUGIN;

// ── scenarios ───────────────────────────────────────────────────────────────────────────────────────────────────────
if ($SCN === 'wpaas') {
    t('hooks-registered-five', count($GLOBALS['t_actions']) + count($GLOBALS['t_filters']) === 5, 'got ' . (count($GLOBALS['t_actions']) + count($GLOBALS['t_filters'])));
    t('hook-cron-schedules', t_hooked('cron_schedules') === 1);
    t('hook-tick', t_hooked('atlas_cache_watch_tick') === 1);
    t('hook-save-post-page', t_hooked('save_post_page') === 1);
    t('hook-send-headers', t_hooked('send_headers') === 1);
    $sched = atlas_cache_watch_schedules(array());
    t('schedule-is-900s', isset($sched['atlas_15min']['interval']) && $sched['atlas_15min']['interval'] === 900);

    do_action('init');
    t('init-schedules-cron', wp_next_scheduled('atlas_cache_watch_tick') !== false);

    atlas_cache_watch_tick();
    t('first-tick-records-fingerprint', t_fp() !== '');
    t('first-tick-no-cascade', \WPaaS\Cache_V2::runs() === 0, 'runs=' . \WPaaS\Cache_V2::runs());
    t('first-tick-no-last-option', t_last() === false);
    t('first-tick-stamps-tick', t_tick() > 0);
    t('fp-option-autoload-false', t_autoload('atlas_cache_watch_fp') === false);

    $h = atlas_cache_watch_header_value();
    t('header-matches-regex', preg_match($HDR_RE, $h) === 1, $h);
    t('header-age-never', strpos($h, ';age=never;') !== false, $h);
    t('header-cdn-none', strpos($h, ';cdn=none;') !== false, $h);
    t('header-fp-1', strpos($h, ';fp=1;') !== false, $h);
    t('header-tick-fresh', substr($h, -11) === ';tick=fresh', $h);
    t('header-build-is-file-sha1', strpos($h, ';b=' . substr(sha1_file($PLUGIN), 0, 8) . ';') !== false, $h);
    t('header-has-no-raw-epoch', preg_match('/\d{9,}/', $h) === 0, $h);

    $fp0 = t_fp();
    t_bump('mastsolutions.html', 1);
    atlas_cache_watch_tick();
    t('change-fires-cascade', \WPaaS\Cache_V2::runs() === 1, 'runs=' . \WPaaS\Cache_V2::runs());
    t('change-runs-all-four', \WPaaS\Cache_V2::ran('do_ban') === 1 && \WPaaS\Cache_V2::ran('flush_cdn') === 1
        && \WPaaS\Cache_V2::ran('flush_transients') === 1 && \WPaaS\Cache_V2::ran('flush_object_cache') === 1);
    $last = t_last();
    t('change-records-last', is_array($last) && isset($last['results']['flush_cdn']) && $last['results']['flush_cdn'] === 'ok');
    t('change-records-class', is_array($last) && $last['results']['class'] === 'WPaaS\Cache_V2');
    t('change-records-changed-name', is_array($last) && $last['changed'] === array('mastsolutions.html'), is_array($last) ? implode(',', $last['changed']) : 'none');
    t('change-advances-fingerprint', t_fp() !== $fp0 && t_fp() !== '');
    t('change-resets-fail', t_fail() === 0 && t_gaveup() === 0);
    t('last-option-autoload-false', t_autoload('atlas_cache_watch_last') === false);
    t('log-one-line-counts-only', preg_match('/\[atlas-cache-watch\] changed=1 ok=4 failed=0 cdn=1/', t_log()) === 1, trim(t_log()));
    t('log-has-no-filenames', strpos(t_log(), 'mastsolutions.html') === false);
    $h = atlas_cache_watch_header_value();
    t('header-after-purge-age-fresh', strpos($h, ';age=fresh;') !== false, $h);
    t('header-after-purge-cdn-ok', strpos($h, ';cdn=ok;') !== false, $h);
    t('header-after-purge-regex', preg_match($HDR_RE, $h) === 1, $h);

    $fp1 = t_fp(); $tick1 = t_tick();
    atlas_cache_watch_tick();
    t('unchanged-tick-no-cascade', \WPaaS\Cache_V2::runs() === 1, 'runs=' . \WPaaS\Cache_V2::runs());
    t('unchanged-tick-keeps-fingerprint', t_fp() === $fp1);
    t('unchanged-tick-refreshes-stamp', t_tick() >= $tick1);

    // the two-minute lock is still held from the purge above
    $lastTime = t_last(); $lastTime = $lastTime['time'];
    t_bump('index.html', 2);
    atlas_cache_watch_tick();
    t('lock-blocks-second-cascade', \WPaaS\Cache_V2::runs() === 1, 'runs=' . \WPaaS\Cache_V2::runs());
    t('lock-leaves-fingerprint-unchanged', t_fp() === $fp1);
    $l2 = t_last();
    t('lock-records-nothing', $l2['time'] === $lastTime && $l2['changed'] === array('mastsolutions.html'));

    t_unlock();
    atlas_cache_watch_tick();
    t('after-lock-cascade-runs', \WPaaS\Cache_V2::runs() === 2, 'runs=' . \WPaaS\Cache_V2::runs());
    $l3 = t_last();
    t('after-lock-records-index', $l3['changed'] === array('index.html'), implode(',', $l3['changed']));
    t('after-lock-advances-fingerprint', t_fp() !== $fp1);

    // save_post_page
    $page = (object) array('post_name' => 'cache-bust');
    atlas_cache_watch_save_page(11, $page, true);
    t('save-post-respects-lock', \WPaaS\Cache_V2::runs() === 2, 'runs=' . \WPaaS\Cache_V2::runs());
    t_unlock();
    atlas_cache_watch_save_page(11, (object) array('post_name' => 'about'), true);
    t('save-post-wrong-slug-no-cascade', \WPaaS\Cache_V2::runs() === 2, 'runs=' . \WPaaS\Cache_V2::runs());
    $GLOBALS['t_autosave'] = true;
    atlas_cache_watch_save_page(11, $page, true);
    t('save-post-autosave-no-cascade', \WPaaS\Cache_V2::runs() === 2);
    $GLOBALS['t_autosave'] = false; $GLOBALS['t_revision'] = true;
    atlas_cache_watch_save_page(11, $page, true);
    t('save-post-revision-no-cascade', \WPaaS\Cache_V2::runs() === 2);
    $GLOBALS['t_revision'] = false;
    atlas_cache_watch_save_page(11, $page, true);
    t('save-post-cache-bust-fires', \WPaaS\Cache_V2::runs() === 3, 'runs=' . \WPaaS\Cache_V2::runs());
    $l4 = t_last();
    t('save-post-records-cache-bust', $l4['changed'] === array('cache-bust'), implode(',', $l4['changed']));

    // a removed file is a change too
    t_unlock();
    $fp2 = t_fp();
    unlink(ABSPATH . 'training.html'); clearstatcache();
    atlas_cache_watch_tick();
    t('deleted-file-is-a-change', \WPaaS\Cache_V2::runs() === 4, 'runs=' . \WPaaS\Cache_V2::runs());
    $l5 = t_last();
    t('deleted-file-named-in-record', $l5['changed'] === array('training.html'), implode(',', $l5['changed']));
    t('deleted-file-advances-fingerprint', t_fp() !== $fp2);

    ob_start(); atlas_cache_watch_send_header(); $o = ob_get_clean();
    t('send-header-emits-no-body', $o === '');
}

if ($SCN === 'throwing') {
    atlas_cache_watch_tick();                       // first tick records only
    $fp0 = t_fp();
    t_bump('mastsolutions.html', 1);
    atlas_cache_watch_tick();
    $last = t_last();
    $cdn  = $last['results']['flush_cdn'];
    t('throw-recorded-as-error-class', strpos($cdn, 'error:RuntimeException:') === 0, 'got a non-error value');
    t('throw-record-is-short', strlen($cdn) <= 40, 'length ' . strlen($cdn));
    t('throw-message-not-in-result', strpos($cdn, $SECRET) === false, 'the exception text is in the result');
    t('throw-message-not-in-option-store', strpos(t_store(), $SECRET) === false, 'the exception text is in an option');
    t('throw-message-not-in-error-log', strpos(t_log(), $SECRET) === false, 'the exception text is in the log');
    t('log-counts-only', preg_match('/\[atlas-cache-watch\] changed=1 ok=3 failed=1 cdn=0/', t_log()) === 1, trim(t_log()));
    t('throw-other-methods-ok', $last['results']['do_ban'] === 'ok' && $last['results']['flush_transients'] === 'ok'
        && $last['results']['flush_object_cache'] === 'ok');
    t('fail-1-counted', t_fail() === 1, 'fail=' . t_fail());
    t('fail-1-fingerprint-held', t_fp() === $fp0);
    t('fail-1-not-gaveup', t_gaveup() === 0);

    t_unlock(); atlas_cache_watch_tick();
    t('fail-2-counted', t_fail() === 2, 'fail=' . t_fail());
    t('fail-2-fingerprint-held', t_fp() === $fp0);
    t('fail-2-retried', \WPaaS\Cache_V2::runs() === 2, 'runs=' . \WPaaS\Cache_V2::runs());

    t_unlock(); atlas_cache_watch_tick();
    t('fail-3-retried', \WPaaS\Cache_V2::runs() === 3, 'runs=' . \WPaaS\Cache_V2::runs());
    t('fail-3-gives-up', t_gaveup() === 1, 'gaveup=' . t_gaveup());
    t('fail-3-records-fingerprint', t_fp() !== $fp0 && t_fp() !== '');
    t('fail-3-counter-capped', t_fail() === 3, 'fail=' . t_fail());

    t_unlock(); atlas_cache_watch_tick();
    t('after-give-up-stops-retrying', \WPaaS\Cache_V2::runs() === 3, 'runs=' . \WPaaS\Cache_V2::runs());
    $h = atlas_cache_watch_header_value();
    t('header-cdn-no-after-failure', strpos($h, ';cdn=no;') !== false, $h);
    t('header-regex-after-failure', preg_match($HDR_RE, $h) === 1, $h);
    t('header-no-exception-text', strpos($h, $SECRET) === false);

    // one more change after giving up costs ONE cascade, not a 15-minute retry loop
    t_unlock(); t_bump('index.html', 3); atlas_cache_watch_tick();
    t('post-give-up-one-attempt', \WPaaS\Cache_V2::runs() === 4, 'runs=' . \WPaaS\Cache_V2::runs());
    t_unlock(); atlas_cache_watch_tick();
    t('post-give-up-no-second-attempt', \WPaaS\Cache_V2::runs() === 4, 'runs=' . \WPaaS\Cache_V2::runs());
}

if ($SCN === 'nowpaas') {
    t('nowpaas-class-absent', !class_exists('WPaaS\Cache_V2'));
    atlas_cache_watch_tick();
    $fp0 = t_fp();
    t_bump('mastsolutions.html', 1);
    atlas_cache_watch_tick();
    $last = t_last();
    t('nowpaas-records-class-null', is_array($last) && $last['results']['class'] === null);
    t('nowpaas-flushes-object-cache', $GLOBALS['t_cache_flush'] === 1, 'calls=' . $GLOBALS['t_cache_flush']);
    t('nowpaas-not-counted-as-purged', t_fail() === 1, 'fail=' . t_fail());
    t('nowpaas-fingerprint-held', t_fp() === $fp0);
    $h = atlas_cache_watch_header_value();
    t('nowpaas-header-cdn-no', strpos($h, ';cdn=no;') !== false, $h);
    t('nowpaas-header-regex', preg_match($HDR_RE, $h) === 1, $h);
    t('nowpaas-log-cdn-0', preg_match('/\[atlas-cache-watch\] changed=1 ok=0 failed=0 cdn=0/', t_log()) === 1, trim(t_log()));
}

if ($SCN === 'badclass') {
    $r = atlas_cache_watch_run();
    t('evil-class-not-constructed', $GLOBALS['t_evil'] === 0, 'the global named a non-WPaaS class and it was instantiated');
    t('evil-class-yields-null', $r['class'] === null);
    $GLOBALS['wpaas_cache_class'] = '\Atlas_Test_Evil';
    $r = atlas_cache_watch_run();
    t('leading-backslash-evil-refused', $GLOBALS['t_evil'] === 0 && $r['class'] === null);
    $GLOBALS['wpaas_cache_class'] = 'wpaas\Atlas_Test_Evil';
    $r = atlas_cache_watch_run();
    t('lowercase-prefix-refused', $GLOBALS['t_evil'] === 0 && $r['class'] === null);
    $GLOBALS['wpaas_cache_class'] = array('Atlas_Test_Evil');
    $r = atlas_cache_watch_run();
    t('non-string-global-refused', $r['class'] === null);
    $GLOBALS['wpaas_cache_class'] = 'WPaaS\Nope_Not_Here';
    $r = atlas_cache_watch_run();
    t('missing-wpaas-class-no-crash', $r['class'] === null);
    // The allowlist is exact, not a prefix. This class is declared, constructible, and sits in GoDaddy's own namespace,
    // so a `strpos(...,'WPaaS\\') !== 0` test constructs it — which is why it is here.
    $GLOBALS['wpaas_cache_class'] = 'WPaaS\Cache_V2_Evil';
    $r = atlas_cache_watch_run();
    t('wpaas-namespaced-evil-refused', $GLOBALS['t_evil'] === 0 && $r['class'] === null,
        'a declared WPaaS\\-prefixed class outside the allowlist was constructed');
    $GLOBALS['wpaas_cache_class'] = '\WPaaS\Cache_V2_Evil';
    $r = atlas_cache_watch_run();
    t('wpaas-namespaced-evil-refused-leading-backslash', $GLOBALS['t_evil'] === 0 && $r['class'] === null);
    t('badclass-still-flushed-object-cache', $GLOBALS['t_cache_flush'] === 7, 'calls=' . $GLOBALS['t_cache_flush']);
}

if ($SCN === 'disabled') {
    t('disabled-registers-no-hooks', count($GLOBALS['t_actions']) === 0 && count($GLOBALS['t_filters']) === 0,
        'actions=' . count($GLOBALS['t_actions']));
    atlas_cache_watch_tick();
    t('disabled-tick-writes-nothing', count($GLOBALS['t_options']) === 0);
    atlas_cache_watch_save_page(11, (object) array('post_name' => 'cache-bust'), true);
    t('disabled-save-writes-nothing', count($GLOBALS['t_options']) === 0 && $GLOBALS['t_cache_flush'] === 0);
    ob_start(); atlas_cache_watch_send_header(); $o = ob_get_clean();
    t('disabled-send-header-silent', $o === '' && count($GLOBALS['t_options']) === 0);
    t('disabled-off-is-true', atlas_cache_watch_off() === true);
}

if ($SCN === 'uninstall') {
    t('uninstall-registers-only-init', count($GLOBALS['t_actions']) === 1 && $GLOBALS['t_actions'][0][0] === 'init'
        && $GLOBALS['t_actions'][0][1] === 'atlas_cache_watch_uninstall', 'actions=' . count($GLOBALS['t_actions']));
    t('uninstall-registers-no-filters', count($GLOBALS['t_filters']) === 0);
    t('uninstall-options-present-before', get_option('atlas_cache_watch_fp') !== false && get_option('atlas_cache_watch_last') !== false);
    do_action('init');
    t('uninstall-deletes-fp-option', get_option('atlas_cache_watch_fp', 'gone') === 'gone');
    t('uninstall-deletes-last-option', get_option('atlas_cache_watch_last', 'gone') === 'gone');
    t('uninstall-deletes-lock', get_transient('atlas_cache_watch_lock') === false);
    t('uninstall-unschedules-cron', wp_next_scheduled('atlas_cache_watch_tick') === false);
    atlas_cache_watch_tick();
    t('uninstall-tick-writes-nothing', count($GLOBALS['t_options']) === 0);
    atlas_cache_watch_save_page(11, (object) array('post_name' => 'cache-bust'), true);
    t('uninstall-save-writes-nothing', count($GLOBALS['t_options']) === 0 && $GLOBALS['t_cache_flush'] === 0);
    ob_start(); atlas_cache_watch_send_header(); $o = ob_get_clean();
    t('uninstall-send-header-silent', $o === '' && count($GLOBALS['t_options']) === 0);
}

exit($FAILED ? 1 : 0);

}
