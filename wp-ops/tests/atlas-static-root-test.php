<?php
/**
 * Harness for wp-ops/atlas-static-root.php — a fake docroot in a temp directory and fake $_SERVER requests. No web
 * server, no WordPress, no host, no network.
 *
 *   php wp-ops/tests/atlas-static-root-test.php
 *
 * Three scenarios, each in its own process because the plugin's constants and its file-scope `return` can only be
 * exercised once per interpreter: serve (the routing, the headers and the conditional requests), disabled (the
 * ATLAS_STATIC_ROOT_DISABLED constant) and marker (the .atlas-static-root-off file). header(), exit and the file read
 * are shimmed the way the cache-watch harness shims its host functions — the plugin declares its three wrappers only
 * when ATLAS_STATIC_ROOT_TESTING is absent, so declaring them here first is what lets a request be inspected instead
 * of sent.
 *
 * The fake docroot holds index.html, about.html and training.html and deliberately has NO careers.html: /careers is
 * allowlisted, so the missing-file path is a real case here and not a hypothetical. Every page carries a multi-byte
 * character on purpose, so Content-Length is pinned to the byte count and not the character count.
 *
 * Each scenario carries a PINNED assertion count (the cache-watch harness's rule, for the same reason): a scenario
 * that dies after its first assertion would otherwise report green, because the parent counts the PASS lines it
 * happens to see and nothing says how many there should have been. Fewer than the pin is a failure, and so is a
 * scenario that exits non-zero without reporting one itself.
 */

// ── the runner ──────────────────────────────────────────────────────────────────────────────────────────────────────
if (!isset($_SERVER['argv'][1])) {
    $scenarios = array('serve' => 109, 'disabled' => 7, 'marker' => 10);
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
    $cases  = $pass + $fail;
    $pinned = array_sum($scenarios);
    echo "\nper scenario: " . implode(' · ', $counts) . "\n";
    echo "atlas-static-root: $pass passed, $fail failed ($cases cases, $pinned pinned)\n";
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

$ROOT = sys_get_temp_dir() . '/atlas-static-root-test-' . getmypid() . '/';
$DOC  = $ROOT . 'docroot/';
$MU   = $ROOT . 'mu-plugins/';
$LOG  = $ROOT . 'php-error.log';
mkdir($ROOT, 0700, true); mkdir($DOC, 0700, true); mkdir($MU, 0700, true);
ini_set('error_log', $LOG);
register_shutdown_function(function () use ($ROOT, $DOC, $MU, $LOG) {
    foreach (glob($DOC . '*') as $f) { @unlink($f); }
    foreach (glob($MU . '.*') as $f) { if (is_file($f)) { @unlink($f); } }
    @unlink($LOG); @rmdir($DOC); @rmdir($MU); @rmdir($ROOT);
});

// No careers.html: /careers is allowlisted, so the missing-file fall-through is a measured case. The em dash makes the
// byte length differ from the character length, which is what Content-Length has to follow.
$PAGES = array(
    'index.html'    => "<!doctype html><title>Atlas Glinn — root</title><p>index</p>\n",
    'about.html'    => "<!doctype html><title>About — Atlas Glinn</title><p>about</p>\n",
    'training.html' => "<!doctype html><title>Training — Atlas Glinn</title><p>training</p>\n",
);
$MTIME = time() - 3600;
foreach ($PAGES as $n => $c) { file_put_contents($DOC . $n, $c); touch($DOC . $n, $MTIME); }
clearstatcache();

define('ABSPATH', $DOC);
define('WPMU_PLUGIN_DIR', rtrim($MU, '/'));

// ── the shims the plugin leaves room for ────────────────────────────────────────────────────────────────────────────
define('ATLAS_STATIC_ROOT_TESTING', true);
$GLOBALS['t_headers'] = array(); $GLOBALS['t_exit'] = 0; $GLOBALS['t_read'] = 0;
function atlas_static_root_send_header($header, $code = 0) { $GLOBALS['t_headers'][] = array($header, $code); }
function atlas_static_root_exit() { $GLOBALS['t_exit']++; }
function atlas_static_root_read($path) { $GLOBALS['t_read']++; return file_get_contents($path); }

// ── stub WordPress (add_action is the only WordPress function the plugin calls) ──────────────────────────────────────
$GLOBALS['t_actions'] = array();
function add_action($h, $cb, $p = 10, $a = 1) { $GLOBALS['t_actions'][] = array($h, $cb); return true; }
function t_hooked($h) { $n = 0; foreach ($GLOBALS['t_actions'] as $r) { if ($r[0] === $h) { $n++; } } return $n; }

// ── request helpers ─────────────────────────────────────────────────────────────────────────────────────────────────
function req($method, $uri, $extra = array()) {
    $GLOBALS['t_headers'] = array(); $GLOBALS['t_exit'] = 0; $GLOBALS['t_read'] = 0;
    $_SERVER['REQUEST_METHOD'] = $method;
    $_SERVER['REQUEST_URI']    = $uri;
    unset($_SERVER['HTTP_IF_NONE_MATCH'], $_SERVER['HTTP_IF_MODIFIED_SINCE']);
    foreach ($extra as $k => $v) { $_SERVER[$k] = $v; }
    ob_start();
    atlas_static_root_dispatch();
    $body = ob_get_clean();
    return array('headers' => $GLOBALS['t_headers'], 'exit' => $GLOBALS['t_exit'], 'read' => $GLOBALS['t_read'], 'body' => $body);
}
function h($r, $name) {
    $p = strtolower($name) . ':';
    foreach ($r['headers'] as $entry) {
        if (stripos($entry[0], $p) === 0) { return trim(substr($entry[0], strlen($p))); }
    }
    return '';
}
function code($r) { foreach ($r['headers'] as $entry) { if ($entry[1] > 0) { return $entry[1]; } } return 0; }
function fell_through($r) { return count($r['headers']) === 0 && $r['exit'] === 0 && $r['body'] === '' && $r['read'] === 0; }
function etag_of($file) { return '"' . substr(sha1(file_get_contents($file)), 0, 8) . '"'; }
function t_log() { global $LOG; return is_file($LOG) ? file_get_contents($LOG) : ''; }
function t_log_lines() { $s = trim(t_log()); return $s === '' ? 0 : substr_count($s, "\n") + 1; }

$PLUGIN = dirname(__DIR__) . '/atlas-static-root.php';
$BUILD  = substr(sha1_file($PLUGIN), 0, 8);

if ($SCN === 'disabled') { define('ATLAS_STATIC_ROOT_DISABLED', true); }
if ($SCN === 'marker')   { file_put_contents(WPMU_PLUGIN_DIR . '/.atlas-static-root-off', ''); clearstatcache(); }

require $PLUGIN;

// ── serve: routing, headers, conditional requests ───────────────────────────────────────────────────────────────────
if ($SCN === 'serve') {
    t('hook-registered-once', count($GLOBALS['t_actions']) === 1 && t_hooked('muplugins_loaded') === 1,
        'actions=' . count($GLOBALS['t_actions']));
    t('hook-is-dispatch', $GLOBALS['t_actions'][0][1] === 'atlas_static_root_dispatch');
    t('off-is-false', atlas_static_root_off() === false);
    t('allowlist-is-fourteen', count(atlas_static_root_map()) === 14, 'entries=' . count(atlas_static_root_map()));
    t('allowlist-has-no-signup-or-mast', !isset(atlas_static_root_map()['/signup']) && !isset(atlas_static_root_map()['/mastsolutions']));

    // ── '/' → index.html, 200, all six headers plus Vary, and the body ──
    $r = req('GET', '/');
    $file = ABSPATH . 'index.html'; $bytes = file_get_contents($file);
    t('root-body-is-index-bytes', $r['body'] === $bytes);
    t('root-body-byte-identical-length', strlen($r['body']) === strlen($bytes) && strlen($bytes) > 0);
    t('root-content-type', h($r, 'Content-Type') === 'text/html; charset=utf-8', h($r, 'Content-Type'));
    t('root-content-length-is-strlen', h($r, 'Content-Length') === (string) strlen($bytes), h($r, 'Content-Length'));
    t('root-content-length-is-bytes-not-chars', (int) h($r, 'Content-Length') !== mb_strlen($bytes, 'UTF-8'),
        'the em dash made no difference — Content-Length is counting characters');
    t('root-last-modified', h($r, 'Last-Modified') === gmdate('D, d M Y H:i:s', filemtime($file)) . ' GMT', h($r, 'Last-Modified'));
    t('root-last-modified-rfc7231', preg_match('/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/', h($r, 'Last-Modified')) === 1, h($r, 'Last-Modified'));
    t('root-etag-is-sha1-8-of-file', h($r, 'ETag') === etag_of($file), h($r, 'ETag'));
    t('root-etag-is-quoted-8-hex', preg_match('/^"[0-9a-f]{8}"$/', h($r, 'ETag')) === 1, h($r, 'ETag'));
    t('root-cache-control', h($r, 'Cache-Control') === 'public, max-age=300', h($r, 'Cache-Control'));
    t('root-proof-header', h($r, 'X-Atlas-Static-Root') === '1.0.0;file=index.html;b=' . $BUILD, h($r, 'X-Atlas-Static-Root'));
    t('root-proof-b-is-plugin-sha1', strpos(h($r, 'X-Atlas-Static-Root'), ';b=' . substr(sha1_file($PLUGIN), 0, 8)) !== false);
    t('root-proof-b-is-not-the-page-etag', ';b=' . $BUILD !== ';b=' . trim(etag_of($file), '"'));
    t('root-vary', h($r, 'Vary') === 'Accept-Encoding', h($r, 'Vary'));
    t('root-sends-exactly-seven-headers', count($r['headers']) === 7, 'sent=' . count($r['headers']));
    t('root-exits-once', $r['exit'] === 1, 'exit=' . $r['exit']);
    t('root-reads-file-once', $r['read'] === 1, 'read=' . $r['read']);
    t('root-no-status-override-on-200', code($r) === 0, 'code=' . code($r));

    // ── '/about' → about.html ──
    $r = req('GET', '/about'); $ab = file_get_contents(ABSPATH . 'about.html');
    t('about-body', $r['body'] === $ab);
    t('about-proof-names-file', h($r, 'X-Atlas-Static-Root') === '1.0.0;file=about.html;b=' . $BUILD, h($r, 'X-Atlas-Static-Root'));
    t('about-etag', h($r, 'ETag') === etag_of(ABSPATH . 'about.html'));
    t('about-content-length', h($r, 'Content-Length') === (string) strlen($ab));
    t('about-exits-once', $r['exit'] === 1);

    // ── '/about/' → 301 to '/about', no body ──
    $r = req('GET', '/about/');
    t('about-slash-is-301', code($r) === 301, 'code=' . code($r));
    t('about-slash-location', h($r, 'Location') === '/about', h($r, 'Location'));
    t('about-slash-no-body', $r['body'] === '');
    t('about-slash-reads-nothing', $r['read'] === 0);
    t('about-slash-one-header-only', count($r['headers']) === 1, 'sent=' . count($r['headers']));
    t('about-slash-exits-once', $r['exit'] === 1);
    $r = req('GET', '/');
    t('root-is-not-redirected', code($r) === 0 && $r['body'] !== '', 'the single trailing slash rule ate /');
    $r = req('GET', '/training/');
    t('training-slash-is-301', code($r) === 301 && h($r, 'Location') === '/training', h($r, 'Location'));

    // ── query strings ──
    $r = req('GET', '/about?utm_source=x');
    t('about-with-query-serves', $r['body'] === $ab && h($r, 'X-Atlas-Static-Root') === '1.0.0;file=about.html;b=' . $BUILD);
    $r = req('GET', '/about#frag');
    t('about-with-fragment-serves', $r['body'] === $ab);
    t('wp-escape-about', fell_through(req('GET', '/about?wp=1')));
    t('wp-escape-about-any-value', fell_through(req('GET', '/about?wp=0')));
    t('wp-escape-about-empty-value', fell_through(req('GET', '/about?wp=')));
    t('wp-escape-root', fell_through(req('GET', '/?wp=1')));
    t('wp-escape-not-first-param', fell_through(req('GET', '/about?utm_source=x&wp=1')));
    t('wp-escape-does-not-match-other-params', req('GET', '/about?wpx=1')['body'] === $ab, 'wpx=1 was treated as wp=');
    t('wp-escape-does-not-match-suffix', req('GET', '/about?awp=1')['body'] === $ab, 'awp=1 was treated as wp=');

    // ── the IWA shop and everything else stays WordPress ──
    $fall = array(
        'shop-dir'           => '/training/shop/',
        'shop-product'       => '/training/shop/product/x',
        'shop-no-slash'      => '/training/shop',
        'wp-admin'           => '/wp-admin/',
        'wp-login'           => '/wp-login.php',
        'wp-json'            => '/wp-json/wp/v2/pages',
        'xmlrpc'             => '/xmlrpc.php',
        'feed'               => '/feed/',
        'robots'             => '/robots.txt',
        'sitemap'            => '/sitemap.xml',
        'capital-A'          => '/About',
        'about-dot-html'     => '/about.html',
        'index-dot-html'     => '/index.html',
        'leading-slash-slash' => '//about',
        'dot-dot-traversal'  => '/about/../wp-admin',
        'percent-encoded'    => '/%61bout',
        'nul-byte'           => "/ab\0out",
        'control-byte'       => "/about\x01",
        'double-trailing'    => '/about//',
        'not-in-allowlist'   => '/mastsolutions',
        'signup-not-listed'  => '/signup',
        'empty-uri-guard'    => '/nope',
    );
    $before = t_log_lines();
    foreach ($fall as $name => $uri) { t('fall-through-' . $name, fell_through(req('GET', $uri)), $uri); }
    t('fall-through-logs-nothing', t_log_lines() === $before, trim(t_log()));

    // ── '/training' → training.html ──
    $r = req('GET', '/training');
    t('training-serves', $r['body'] === file_get_contents(ABSPATH . 'training.html'));
    t('training-proof-names-file', h($r, 'X-Atlas-Static-Root') === '1.0.0;file=training.html;b=' . $BUILD);

    // ── '/careers' — allowlisted, file missing: fall through + exactly one log line naming it ──
    $before = t_log_lines();
    $r = req('GET', '/careers');
    t('careers-missing-falls-through', count($r['headers']) === 0 && $r['exit'] === 0 && $r['body'] === '');
    t('careers-missing-logs-one-line', t_log_lines() === $before + 1, 'lines went ' . $before . ' -> ' . t_log_lines());
    t('careers-log-names-the-file', strpos(t_log(), 'careers.html') !== false, trim(t_log()));
    t('careers-log-is-tagged', strpos(t_log(), '[atlas-static-root]') !== false);
    $before = t_log_lines();
    req('GET', '/careers');
    t('careers-logs-one-line-per-request', t_log_lines() === $before + 1);

    // ── methods ──
    t('post-root-falls-through', fell_through(req('POST', '/')));
    t('put-root-falls-through', fell_through(req('PUT', '/')));
    t('options-root-falls-through', fell_through(req('OPTIONS', '/')));
    t('lowercase-get-falls-through', fell_through(req('get', '/')));
    $r = req('HEAD', '/');
    t('head-root-empty-body', $r['body'] === '');
    t('head-root-sends-headers', count($r['headers']) === 7, 'sent=' . count($r['headers']));
    t('head-root-content-length-is-full', h($r, 'Content-Length') === (string) strlen($bytes), h($r, 'Content-Length'));
    t('head-root-etag-matches-get', h($r, 'ETag') === etag_of(ABSPATH . 'index.html'));
    t('head-root-exits-once', $r['exit'] === 1);

    // ── conditional requests ──
    $aboutEtag = etag_of(ABSPATH . 'about.html');
    $aboutLm   = gmdate('D, d M Y H:i:s', filemtime(ABSPATH . 'about.html')) . ' GMT';
    $r = req('GET', '/about', array('HTTP_IF_NONE_MATCH' => $aboutEtag));
    t('inm-equal-is-304', code($r) === 304, 'code=' . code($r));
    t('inm-equal-no-body', $r['body'] === '');
    t('inm-equal-same-etag', h($r, 'ETag') === $aboutEtag, h($r, 'ETag'));
    t('inm-equal-same-last-modified', h($r, 'Last-Modified') === $aboutLm, h($r, 'Last-Modified'));
    t('inm-equal-keeps-proof-header', h($r, 'X-Atlas-Static-Root') === '1.0.0;file=about.html;b=' . $BUILD);
    t('inm-equal-keeps-cache-control', h($r, 'Cache-Control') === 'public, max-age=300');
    t('inm-equal-keeps-vary', h($r, 'Vary') === 'Accept-Encoding');
    t('inm-equal-no-content-length', h($r, 'Content-Length') === '', h($r, 'Content-Length'));
    t('inm-equal-six-headers', count($r['headers']) === 6, 'sent=' . count($r['headers']));
    t('inm-equal-exits-once', $r['exit'] === 1);
    $r = req('GET', '/about', array('HTTP_IF_NONE_MATCH' => 'W/' . $aboutEtag));
    t('inm-weak-equal-is-304', code($r) === 304);
    $r = req('GET', '/about', array('HTTP_IF_NONE_MATCH' => '"deadbeef", ' . $aboutEtag));
    t('inm-list-containing-etag-is-304', code($r) === 304);
    $r = req('GET', '/about', array('HTTP_IF_NONE_MATCH' => '*'));
    t('inm-star-is-304', code($r) === 304);
    $r = req('GET', '/about', array('HTTP_IF_NONE_MATCH' => '"deadbeef"'));
    t('inm-different-is-200', code($r) === 0 && $r['body'] === $ab, 'code=' . code($r));
    t('inm-different-sends-seven-headers', count($r['headers']) === 7);
    $r = req('GET', '/about', array('HTTP_IF_MODIFIED_SINCE' => gmdate('D, d M Y H:i:s', filemtime(ABSPATH . 'about.html') + 600) . ' GMT'));
    t('ims-newer-is-304', code($r) === 304, 'code=' . code($r));
    t('ims-newer-no-body', $r['body'] === '');
    $r = req('GET', '/about', array('HTTP_IF_MODIFIED_SINCE' => $aboutLm));
    t('ims-equal-is-304', code($r) === 304);
    $r = req('GET', '/about', array('HTTP_IF_MODIFIED_SINCE' => gmdate('D, d M Y H:i:s', filemtime(ABSPATH . 'about.html') - 600) . ' GMT'));
    t('ims-older-is-200', code($r) === 0 && $r['body'] === $ab, 'code=' . code($r));
    $r = req('GET', '/about', array('HTTP_IF_MODIFIED_SINCE' => 'not a date at all'));
    t('ims-garbage-is-200', code($r) === 0 && $r['body'] === $ab);
    $r = req('GET', '/about', array('HTTP_IF_NONE_MATCH' => '"deadbeef"',
        'HTTP_IF_MODIFIED_SINCE' => gmdate('D, d M Y H:i:s', filemtime(ABSPATH . 'about.html') + 600) . ' GMT'));
    t('inm-beats-ims-rfc7232', code($r) === 0 && $r['body'] === $ab, 'If-Modified-Since answered while If-None-Match disagreed');
    $r = req('HEAD', '/about', array('HTTP_IF_NONE_MATCH' => $aboutEtag));
    t('head-conditional-is-304', code($r) === 304 && $r['body'] === '');
    t('conditional-fall-through-still-works', fell_through(req('GET', '/wp-admin/', array('HTTP_IF_NONE_MATCH' => $aboutEtag))));

    // ── nothing was written anywhere ──
    t('no-file-written-to-docroot', count(glob(ABSPATH . '*')) === 3, 'files=' . count(glob(ABSPATH . '*')));
    t('no-marker-created', !file_exists(WPMU_PLUGIN_DIR . '/.atlas-static-root-off'));
}

// ── disabled: the constant ──────────────────────────────────────────────────────────────────────────────────────────
if ($SCN === 'disabled') {
    t('disabled-registers-no-hooks', count($GLOBALS['t_actions']) === 0, 'actions=' . count($GLOBALS['t_actions']));
    t('disabled-off-is-true', atlas_static_root_off() === true);
    t('disabled-root-falls-through', fell_through(req('GET', '/')));
    t('disabled-about-falls-through', fell_through(req('GET', '/about')));
    t('disabled-slash-redirect-falls-through', fell_through(req('GET', '/about/')));
    t('disabled-head-falls-through', fell_through(req('HEAD', '/')));
    t('disabled-logs-nothing', trim(t_log()) === '', trim(t_log()));
}

// ── marker: the SFTP-flippable file ─────────────────────────────────────────────────────────────────────────────────
if ($SCN === 'marker') {
    t('marker-path-is-mu-plugins', atlas_static_root_marker_path() === WPMU_PLUGIN_DIR . '/.atlas-static-root-off',
        atlas_static_root_marker_path());
    t('marker-file-exists', file_exists(atlas_static_root_marker_path()));
    t('marker-registers-no-hooks', count($GLOBALS['t_actions']) === 0, 'actions=' . count($GLOBALS['t_actions']));
    t('marker-off-is-true', atlas_static_root_off() === true);
    t('marker-root-falls-through', fell_through(req('GET', '/')));
    t('marker-about-falls-through', fell_through(req('GET', '/about')));
    t('marker-slash-redirect-falls-through', fell_through(req('GET', '/about/')));
    t('marker-logs-nothing', trim(t_log()) === '', trim(t_log()));
    // Removing it turns the plugin back on for the next request: the switch is the file itself, read per request, not
    // a value cached at load. (clearstatcache() is this process standing in for the next request's fresh stat cache.)
    unlink(atlas_static_root_marker_path()); clearstatcache();
    t('marker-removed-off-is-false', atlas_static_root_off() === false);
    $r = req('GET', '/');
    t('marker-removed-serves-again', $r['body'] === file_get_contents(ABSPATH . 'index.html') && $r['exit'] === 1);
}

exit($FAILED ? 1 : 0);
