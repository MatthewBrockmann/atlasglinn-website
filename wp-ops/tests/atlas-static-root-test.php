<?php
/**
 * Harness for wp-ops/atlas-static-root.php — a fake docroot in a temp directory and fake $_SERVER requests. No web
 * server, no WordPress, no host, no network.
 *
 *   php wp-ops/tests/atlas-static-root-test.php
 *
 * Five scenarios, each in its own process because the plugin's constants and its file-scope `return` can only be
 * exercised once per interpreter: serve (the routing, the headers, the query allowlist and the conditional requests),
 * guards (every refusal — path shape, query-var routes, broken files, symlinks, a failed read, headers already sent,
 * inherited output buffers), wrappers (the plugin's OWN five wrappers, un-shimmed), disabled (the
 * ATLAS_STATIC_ROOT_DISABLED constant) and marker (the .atlas-static-root-off file). header(), exit, the file read,
 * headers_sent() and the output reset are shimmed the way the cache-watch harness shims its host functions — the
 * plugin declares its five wrappers only when ATLAS_STATIC_ROOT_TESTING is absent, so declaring them here first is
 * what lets a request be inspected instead of sent, and leaving them undeclared is what lets the wrappers scenario
 * run the real ones.
 *
 * THE FIXTURES ARE THE POINT. A guard that no fixture can reach is a guard the harness cannot prove, and round 1
 * shipped seven of those. Every check in the plugin now has a case whose result CHANGES if the check is deleted:
 *   docroot/          a SYMLINK to real-docroot/, so realpath(ABSPATH) !== ABSPATH — a containment check written as a
 *                     string prefix against ABSPATH would refuse every page on a host like this one, which is most.
 *   index/about/
 *   training.html     good pages, each with a multi-byte character so Content-Length is pinned to bytes not chars.
 *   careers.html      ABSENT, and allowlisted: the missing-page fall-through is measured, not hypothetical.
 *   privacy.html      zero bytes — the upload that created the file and wrote nothing.
 *   terms.html        truncated: real HTML, no closing </html>. The SFTP transfer that died halfway.
 *   technology.html   a DIRECTORY wearing a page's name.
 *   uas.html          chmod 000 — the is_readable() case, and the one case this environment may not be able to run
 *                     (see below: as uid 0 it is readable anyway and the harness SKIPs rather than pass hollow).
 *   ep-app.html       a symlink pointing OUT of the docroot — only the containment check refuses it first.
 *   contact.html      a symlink pointing INSIDE the docroot at about.html — containment is happy; only is_link()
 *                     refuses it, and the two are told apart by which line each writes to the log.
 *   disaster-recovery.html  a symlink into real-docroot2/ — a SIBLING directory whose name starts with the docroot's
 *                     own name. realpath() of the target begins with realpath(ABSPATH) character for character, so an
 *                     un-anchored strpos($real, $root) === 0 containment check passes it; the separator the real check
 *                     appends is the only thing that refuses it. A probe beside the case pins that the naive check
 *                     WOULD have passed, so the assertion is measuring the anchoring and not something else.
 *   x/                an empty directory, so docroot/x/../about.html is a path that really does resolve on disk and
 *                     the '..' probe is a probe and not a spelling.
 *
 * EVERY UNSERVABLE SHAPE IS ALSO PROBED THROUGH ITS TRAILING-SLASH PERMALINK (/privacy/, /careers/ …). The 301 is the
 * one response that can make a URL worse than it was: sending /privacy/ to /privacy when privacy.html cannot be served
 * hands the visitor to a URL where this file falls through and WordPress renders the slug — a loop where the host puts
 * the slash back, a 404 where it does not, at a URL that worked before the plugin was installed. So the redirect runs
 * the same servability check the serve path runs, and these cases are what hold it there.
 *
 * ONE CASE CANNOT RUN AS ROOT, and it says so rather than counting itself green. uas.html is chmod 000, which is the
 * is_readable() case — but uid 0 reads it anyway, so under root the harness prints SKIP with the reason instead of an
 * assertion that would pass without testing anything. On the host PHP runs unprivileged and that guard is live; the
 * directory case (technology.html) is the unreadable-file case that runs everywhere. The parent counts a SKIP toward
 * the pinned total, so a case that quietly disappears is still a failure, and reports skips separately from passes.
 *
 * Each scenario carries a PINNED assertion count (the cache-watch harness's rule, for the same reason): a scenario
 * that dies after its first assertion would otherwise report green, because the parent counts the PASS lines it
 * happens to see and nothing says how many there should have been. Fewer than the pin is a failure, and so is a
 * scenario that exits non-zero without reporting one itself.
 */

// ── the runner ──────────────────────────────────────────────────────────────────────────────────────────────────────
// A scenario gets a wall clock. The output-buffer reset is a loop over ob_end_clean(), and ob_end_clean() returns
// false forever on a handler started non-removable — the naive `while (ob_get_level() > 0)` spins, and set_time_limit()
// does NOT stop it in CLI (measured 2026-09-08: 193 MB of notices, no timeout). A test that can hang is worse than no
// test, so the child is killed at the deadline and reported as a failure like any other.
//
// AND A TEST THAT CAN FILL THE DISK IS WORSE STILL. Later the same day a mutant of this suite wrote 3.47 GB to
// php-error.log in the system temp directory and filled the disk it was running on: a spinning child logs a notice per
// iteration, and PHP's default error_log is one unbounded file that nothing here owned or cleaned. So every child now
// gets its OWN error_log and its OWN scratch directory, both inside a single run directory this process creates and
// deletes on the way out — including after a child was killed at the deadline and never ran its own shutdown function,
// which is exactly the case that leaked. Under that, `ulimit -f` is the backstop the harness cannot talk its way past
// (dash counts those blocks as 512 bytes, so 200000 is 100 MB here; bash counts 1 KiB and the same number is 200 MB —
// measured 2026-09-08, and either way it is bounded, which is the point). A child whose log passes T_LOG_CAP is
// reported as a red naming the byte count, so a runaway is a test failure and not a disk-full at 3am.
define('T_DEADLINE', 60);
define('T_ULIMIT_BLOCKS', 200000);
define('T_LOG_CAP', 8388608);
function t_rmrf($p) {
    if (is_link($p) || is_file($p)) { @chmod($p, 0700); @unlink($p); return; }
    if (is_dir($p)) {
        foreach (array_diff(scandir($p), array('.', '..')) as $c) { t_rmrf(rtrim($p, '/') . '/' . $c); }
        @rmdir($p);
    }
}
// Every byte under a path, so a runaway log is measured wherever the child put it — the one the runner named on the
// command line, or the one the child pointed ini_set() at inside its own scratch directory.
function t_bytes($p) {
    if (is_link($p)) { return 0; }
    if (is_file($p)) { return (int) filesize($p); }
    if (!is_dir($p)) { return 0; }
    $n = 0;
    foreach (array_diff(scandir($p), array('.', '..')) as $c) { $n += t_bytes(rtrim($p, '/') . '/' . $c); }
    return $n;
}
function t_spawn($cmd) {
    $pipes = array();
    $proc = proc_open($cmd, array(1 => array('pipe', 'w'), 2 => array('pipe', 'w')), $pipes);
    if (!is_resource($proc)) { return array(array('FAIL runner/proc-open-failed'), 1, false); }
    stream_set_blocking($pipes[1], false); stream_set_blocking($pipes[2], false);
    $out = ''; $start = microtime(true); $timedout = false;
    while (true) {
        $chunk = stream_get_contents($pipes[1]) . stream_get_contents($pipes[2]);
        if (strlen($out) < 262144) { $out .= $chunk; }   // a spinning child can emit hundreds of MB; drain, discard
        $st = proc_get_status($proc);
        if (!$st['running']) { break; }
        if (microtime(true) - $start > T_DEADLINE) { $timedout = true; proc_terminate($proc, 9); usleep(200000); break; }
        usleep(20000);
    }
    $chunk = stream_get_contents($pipes[1]) . stream_get_contents($pipes[2]);
    if (strlen($out) < 262144) { $out .= $chunk; }
    fclose($pipes[1]); fclose($pipes[2]);
    $st = proc_get_status($proc);
    $rc = $st['running'] ? 137 : (int) $st['exitcode'];
    proc_close($proc);
    return array(explode("\n", rtrim($out, "\n")), $rc, $timedout);
}

if (!isset($_SERVER['argv'][1])) {
    // One directory holds everything this run can write, and it goes on the way out whatever happens: the shutdown
    // function is the finally path, and it runs on a clean exit, on a fatal and on exit() alike.
    $RUNDIR = rtrim(sys_get_temp_dir(), '/') . '/atlas-static-root-run-' . getmypid() . '/';
    t_rmrf(rtrim($RUNDIR, '/'));
    mkdir($RUNDIR, 0700, true);
    ini_set('error_log', $RUNDIR . 'runner.log');   // this process's own notices, inside the directory it deletes
    register_shutdown_function(function () use ($RUNDIR) { t_rmrf(rtrim($RUNDIR, '/')); });

    $scenarios = array('serve' => 124, 'guards' => 129, 'wrappers' => 12, 'disabled' => 7, 'marker' => 10);
    $pass = 0; $fail = 0; $skip = 0; $bad = array(); $counts = array();
    foreach ($scenarios as $s => $want) {
        $childlog = $RUNDIR . $s . '.log';
        $childdir = $RUNDIR . $s . '/';
        // ulimit first, then exec so the limit lands on PHP itself and not on a shell that has already gone. The child
        // is told where to put its scratch directory, so the runner can clean up after a kill -9 that ran no shutdown.
        $cmd = 'ulimit -f ' . T_ULIMIT_BLOCKS . '; exec ' . escapeshellarg(PHP_BINARY)
             . ' -d ' . escapeshellarg('error_log=' . $childlog)
             . ' -d ' . escapeshellarg('log_errors_max_len=1024')
             . ' ' . escapeshellarg(__FILE__) . ' ' . escapeshellarg($s) . ' ' . escapeshellarg($childdir);
        list($lines, $rc, $timedout) = t_spawn($cmd);
        if ($timedout) {
            $fail++; $bad[] = $s . '/timed-out';
            echo '  FAIL ' . $s . '/timed-out after ' . T_DEADLINE . "s — killed, it was not going to finish\n";
        }
        $got = 0; $sawfail = false;
        foreach ($lines as $l) {
            if (strpos($l, 'PASS ') === 0) { $pass++; $got++; echo '  PASS ' . $s . '/' . substr($l, 5) . "\n"; }
            elseif (strpos($l, 'FAIL ') === 0) { $fail++; $got++; $sawfail = true; $bad[] = $s . '/' . substr($l, 5); echo '  FAIL ' . $s . '/' . substr($l, 5) . "\n"; }
            elseif (strpos($l, 'SKIP ') === 0) { $skip++; $got++; echo '  SKIP ' . $s . '/' . substr($l, 5) . "\n"; }
            else { echo '  | ' . $l . "\n"; }
        }
        $counts[] = $s . ' ' . $got . '/' . $want;
        // 137 is the deadline kill; a child stopped by SIGXFSZ (the ulimit -f backstop) comes back from proc_close as -1, not 153
        // (measured 2026-09-08) — both are already non-zero here.
        if ($rc !== 0 && !$sawfail) {
            $fail++; $bad[] = $s . '/scenario-exited-' . $rc;
            echo '  FAIL ' . $s . "/scenario-exited-$rc without reporting a failure — it died mid-scenario\n";
        }
        $wrote = t_bytes($childlog) + t_bytes(rtrim($childdir, '/'));
        if ($wrote > T_LOG_CAP) {
            $fail++; $bad[] = $s . '/wrote-' . $wrote . '-bytes';
            echo '  FAIL ' . $s . "/error-log-ran-away: $wrote bytes under $RUNDIR — a child was logging without a bound\n";
        }
        if ($got < $want) {
            $fail++; $bad[] = $s . '/assertions-shrank-' . $got . '-of-' . $want;
            echo '  FAIL ' . $s . "/assertions-shrank: ran $got of the $want pinned in this file\n";
        } elseif ($got > $want) {
            echo '  | ' . $s . ": $got assertions, $want pinned — raise the pin in this file\n";
        }
    }
    $cases  = $pass + $fail + $skip;
    $pinned = array_sum($scenarios);
    echo "\nper scenario: " . implode(' · ', $counts) . "\n";
    echo "atlas-static-root: $pass passed, $fail failed, $skip skipped ($cases cases, $pinned pinned)\n";
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
// A case the environment cannot exercise says so and is counted as neither. The parent still counts it toward the
// pinned total — a case that vanishes has to be a failure — and reports skips apart from passes.
function s($name, $why) { echo "SKIP $name: $why\n"; }

// The runner names the scratch directory so it can delete it even after killing this process; the fallback is for a
// scenario run by hand.
$ROOT = (isset($_SERVER['argv'][2]) && $_SERVER['argv'][2] !== '')
    ? rtrim($_SERVER['argv'][2], '/') . '/'
    : sys_get_temp_dir() . '/atlas-static-root-test-' . getmypid() . '/';
$REAL = $ROOT . 'real-docroot/';   // where the files actually live
$DOC  = $ROOT . 'docroot/';        // a symlink to it, and ABSPATH: realpath(ABSPATH) differs from ABSPATH on purpose
$MU   = $ROOT . 'mu-plugins/';
$OUT  = $ROOT . 'outside.html';    // a valid page OUTSIDE the docroot, for the escaping symlink
$SIB  = $ROOT . 'real-docroot2/';  // a SIBLING whose name starts with the docroot's own — the containment anchoring
$LOG  = $ROOT . 'php-error.log';
mkdir($ROOT, 0700, true); mkdir($REAL, 0700, true); mkdir($MU, 0700, true); mkdir($SIB, 0700, true);
$DOCLINKED = @symlink(rtrim($REAL, '/'), rtrim($DOC, '/'));
if (!$DOCLINKED) { $DOC = $REAL; }   // one case reports this; the rest of the file still runs
ini_set('error_log', $LOG);   // inside $ROOT, which this process removes below and the runner removes regardless
register_shutdown_function(function () use ($ROOT) { t_rmrf(rtrim($ROOT, '/')); });

// No careers.html: /careers is allowlisted, so the missing-file fall-through is a measured case. The em dash makes the
// byte length differ from the character length, which is what Content-Length has to follow. The closing </html> is
// load-bearing now — a page without one is a truncated upload and is refused.
$PAGES = array(
    'index.html'    => "<!doctype html><html><title>Atlas Glinn — root</title><p>index</p></html>\n",
    'about.html'    => "<!doctype html><html><title>About — Atlas Glinn</title><p>about</p></html>\n",
    'training.html' => "<!doctype html><html><title>Training — Atlas Glinn</title><p>training</p></html>\n",
    'uas.html'      => "<!doctype html><html><title>UAS — Atlas Glinn</title><p>uas</p></html>\n",
);
$MTIME = time() - 3600;
foreach ($PAGES as $n => $c) { file_put_contents($REAL . $n, $c); touch($REAL . $n, $MTIME); }
file_put_contents($REAL . 'privacy.html', '');                                              // zero bytes
file_put_contents($REAL . 'terms.html', "<!doctype html><html><title>Terms — Atlas Gli");    // truncated, no </html>
file_put_contents($OUT, "<!doctype html><html><title>outside the docroot</title></html>\n");
// real-docroot2/ is a sibling of real-docroot/, so its realpath starts with the docroot's realpath character for
// character: strpos($real, $root) === 0 without a separator on the end of $root passes it. The symlink is how a
// request reaches it, and the probe beside the assertion is what proves the naive check would have been fooled.
file_put_contents($SIB . 'target.html', "<!doctype html><html><title>next door to the docroot</title></html>\n");
mkdir($REAL . 'technology.html', 0700);   // a directory wearing a page's name
mkdir($REAL . 'x', 0700);                 // so docroot/x/../about.html resolves
$LINK_OUT = @symlink($OUT, $REAL . 'ep-app.html');
$LINK_IN  = @symlink($REAL . 'about.html', $REAL . 'contact.html');
$LINK_SIB = @symlink($SIB . 'target.html', $REAL . 'disaster-recovery.html');
chmod($REAL . 'uas.html', 0000);
clearstatcache();

define('ABSPATH', $DOC);
define('WPMU_PLUGIN_DIR', rtrim($MU, '/'));

// ── the shims the plugin leaves room for ────────────────────────────────────────────────────────────────────────────
// Not in the 'wrappers' scenario: that one leaves ATLAS_STATIC_ROOT_TESTING undefined so the plugin declares its OWN
// five wrappers, and calls the real output reset. It never calls dispatch(), because the real exit() would end it.
if ($SCN !== 'wrappers') {
define('ATLAS_STATIC_ROOT_TESTING', true);
$GLOBALS['t_headers'] = array(); $GLOBALS['t_exit'] = 0; $GLOBALS['t_read'] = 0; $GLOBALS['t_flush'] = 0;
$GLOBALS['t_read_false'] = false; $GLOBALS['t_headers_sent'] = false;
$GLOBALS['t_ob_floor'] = 0; $GLOBALS['t_ob_depth'] = -1;
function atlas_static_root_send_header($header, $code = 0) { $GLOBALS['t_headers'][] = array($header, $code); }
function atlas_static_root_exit() { $GLOBALS['t_exit']++; }
function atlas_static_root_read($path) {
    $GLOBALS['t_read']++;
    if ($GLOBALS['t_read_false']) { return false; }   // the read that comes back not-a-string
    return file_get_contents($path);
}
function atlas_static_root_headers_sent() { return $GLOBALS['t_headers_sent']; }
// The real one drops every buffer; this one drops every buffer the REQUEST added and stops at the harness's own
// capture buffer, then records how many were left. Anything the plugin was supposed to drop shows up as a non-zero
// depth, and anything echoed into a buffer the plugin did not drop never reaches the captured body. It returns what
// the real one returns — true only when nothing survived — so the plugin's fall-through on a failed reset is reachable
// from here; the real function's return value is pinned against a real non-removable buffer in the wrappers scenario.
function atlas_static_root_reset_output() {
    $GLOBALS['t_flush']++;
    while (($level = ob_get_level()) > $GLOBALS['t_ob_floor']) {
        if (!@ob_end_clean() || ob_get_level() >= $level) { break; }
    }
    $GLOBALS['t_ob_depth'] = ob_get_level() - $GLOBALS['t_ob_floor'];
    return $GLOBALS['t_ob_depth'] === 0;
}
}

// ── stub WordPress (add_action is the only WordPress function the plugin calls) ──────────────────────────────────────
$GLOBALS['t_actions'] = array();
function add_action($h, $cb, $p = 10, $a = 1) { $GLOBALS['t_actions'][] = array($h, $cb); return true; }
function t_hooked($h) { $n = 0; foreach ($GLOBALS['t_actions'] as $r) { if ($r[0] === $h) { $n++; } } return $n; }

// ── request helpers ─────────────────────────────────────────────────────────────────────────────────────────────────
// $buffers pre-registers output buffers on top of the capture buffer, the way a host with output_buffering on or a
// plugin that started its own would: the served body only survives if the plugin dropped them before echoing.
// $stuck adds a buffer started with no flags, which ob_end_clean() can never remove: the plugin's reset returns false
// on it and the request must fall through. It is left EMPTY on purpose — it survives to the end of the process by
// construction, and anything echoed into it would come back out at shutdown in the middle of somebody's PASS line.
// The cleanup below is bounded for the same reason the plugin's is: a bare `while (ob_get_level() > $floor)` spins
// forever on that buffer, and a harness that hangs is worse than no harness.
function req($method, $uri, $extra = array(), $buffers = 0, $stuck = false) {
    $GLOBALS['t_headers'] = array(); $GLOBALS['t_exit'] = 0; $GLOBALS['t_read'] = 0;
    $GLOBALS['t_flush'] = 0; $GLOBALS['t_ob_depth'] = -1;
    $_SERVER['REQUEST_METHOD'] = $method;
    $_SERVER['REQUEST_URI']    = $uri;
    unset($_SERVER['HTTP_IF_NONE_MATCH'], $_SERVER['HTTP_IF_MODIFIED_SINCE']);
    foreach ($extra as $k => $v) { $_SERVER[$k] = $v; }
    ob_start();
    $GLOBALS['t_ob_floor'] = ob_get_level();
    for ($i = 0; $i < $buffers; $i++) { ob_start(); echo 'OUTPUT-FROM-SOMETHING-ELSE'; }
    if ($stuck) { ob_start(null, 0, 0); }
    atlas_static_root_dispatch();
    $left = false;
    while (($level = ob_get_level()) > $GLOBALS['t_ob_floor']) {
        if (!@ob_end_clean() || ob_get_level() >= $level) { $left = true; break; }
    }
    // A buffer that will not go takes the capture buffer with it — ob_get_clean() on it would fail and log a notice.
    // Nothing reached the wire in that case, which is the assertion the caller is making anyway.
    $body = $left ? '' : ob_get_clean();
    return array('headers' => $GLOBALS['t_headers'], 'exit' => $GLOBALS['t_exit'], 'read' => $GLOBALS['t_read'],
                 'flush' => $GLOBALS['t_flush'], 'depth' => $GLOBALS['t_ob_depth'], 'body' => $body);
}
function h($r, $name) {
    $p = strtolower($name) . ':';
    foreach ($r['headers'] as $entry) {
        if (stripos($entry[0], $p) === 0) { return trim(substr($entry[0], strlen($p))); }
    }
    return '';
}
function code($r) { foreach ($r['headers'] as $entry) { if ($entry[1] > 0) { return $entry[1]; } } return 0; }
// Nothing sent, nothing exited, nothing echoed, nothing read: the request never got as far as opening a file.
function fell_through($r) { return count($r['headers']) === 0 && $r['exit'] === 0 && $r['body'] === '' && $r['read'] === 0; }
// The same, for the refusals that happen after the file has been opened.
function refused($r) { return count($r['headers']) === 0 && $r['exit'] === 0 && $r['body'] === ''; }
function etag_of($file) { return '"' . substr(sha1(file_get_contents($file)), 0, 8) . '"'; }
function t_log() { global $LOG; return is_file($LOG) ? file_get_contents($LOG) : ''; }
function t_log_lines() { $s = trim(t_log()); return $s === '' ? 0 : substr_count($s, "\n") + 1; }
function t_log_last() { $s = trim(t_log()); if ($s === '') { return ''; } $l = explode("\n", $s); return end($l); }

$PLUGIN = dirname(__DIR__) . '/atlas-static-root.php';
$BUILD  = substr(sha1_file($PLUGIN), 0, 8);   // computed here the direct way; the plugin reads its own bytes
$VER    = '1.2.0';                            // pinned here on purpose: a version bump has to be a deliberate edit

if ($SCN === 'disabled') { define('ATLAS_STATIC_ROOT_DISABLED', true); }
if ($SCN === 'marker')   { file_put_contents(WPMU_PLUGIN_DIR . '/.atlas-static-root-off', ''); clearstatcache(); }

require $PLUGIN;

// ── serve: routing, headers, the query allowlist, conditional requests ──────────────────────────────────────────────
if ($SCN === 'serve') {
    // First, before any request: the build digest is read through the read wrapper (S2-9) and memoised, so every
    // per-request read count below is the page and only the page.
    $GLOBALS['t_read'] = 0;
    $warm = atlas_static_root_build();
    t('build-reads-its-own-file-through-the-wrapper', $GLOBALS['t_read'] === 1 && $warm === $BUILD, 'reads=' . $GLOBALS['t_read'] . ' b=' . $warm);
    $GLOBALS['t_read'] = 0;
    atlas_static_root_build(); atlas_static_root_build();
    t('build-is-memoised-one-read-per-process', $GLOBALS['t_read'] === 0, 'reads=' . $GLOBALS['t_read']);

    t('docroot-is-reached-through-a-symlink', $DOCLINKED && realpath(ABSPATH) !== rtrim(ABSPATH, '/'),
        'the containment fixture is not testing realpath vs string prefix');
    t('hook-registered-once', count($GLOBALS['t_actions']) === 1 && t_hooked('muplugins_loaded') === 1,
        'actions=' . count($GLOBALS['t_actions']));
    t('hook-is-dispatch', $GLOBALS['t_actions'][0][1] === 'atlas_static_root_dispatch');
    t('off-is-false', atlas_static_root_off() === false);
    t('allowlist-is-fourteen', count(atlas_static_root_map()) === 14, 'entries=' . count(atlas_static_root_map()));
    t('allowlist-has-no-signup-or-mast', !isset(atlas_static_root_map()['/signup']) && !isset(atlas_static_root_map()['/mastsolutions']));
    t('version-constant-is-pinned', ATLAS_STATIC_ROOT_VERSION === $VER, ATLAS_STATIC_ROOT_VERSION);

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
    t('root-proof-header', h($r, 'X-Atlas-Static-Root') === $VER . ';file=index.html;b=' . $BUILD, h($r, 'X-Atlas-Static-Root'));
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
    t('about-proof-names-file', h($r, 'X-Atlas-Static-Root') === $VER . ';file=about.html;b=' . $BUILD, h($r, 'X-Atlas-Static-Root'));
    t('about-etag', h($r, 'ETag') === etag_of(ABSPATH . 'about.html'));
    t('about-content-length', h($r, 'Content-Length') === (string) strlen($ab));
    t('about-exits-once', $r['exit'] === 1);

    // ── '/about/' → 301 to '/about', no body, query carried across ──
    $r = req('GET', '/about/');
    t('about-slash-is-301', code($r) === 301, 'code=' . code($r));
    t('about-slash-location', h($r, 'Location') === '/about', h($r, 'Location'));
    t('about-slash-no-body', $r['body'] === '');
    // The redirect READS the target now: a 301 goes only to a page that passes the serve path's own check, so the read
    // is the proof and not an accident. Round 2 pinned read === 0 here, and that is exactly what let /privacy/ 301 to
    // a page that cannot be served. The unservable shapes are all probed through their permalinks in guards.
    t('about-slash-reads-the-target-once', $r['read'] === 1, 'read=' . $r['read']);
    t('about-slash-cache-control', h($r, 'Cache-Control') === 'public, max-age=300', h($r, 'Cache-Control'));
    t('about-slash-vary', h($r, 'Vary') === 'Accept-Encoding', h($r, 'Vary'));
    t('about-slash-three-headers', count($r['headers']) === 3, 'sent=' . count($r['headers']));
    t('about-slash-exits-once', $r['exit'] === 1);
    t('about-slash-resets-output-once', $r['flush'] === 1, 'flush=' . $r['flush']);
    $r = req('GET', '/about/?utm_source=x');
    t('301-keeps-the-query', h($r, 'Location') === '/about?utm_source=x', h($r, 'Location'));
    $r = req('GET', '/training/?v=1725830000&utm_medium=email');
    t('301-keeps-every-tracking-parameter', h($r, 'Location') === '/training?v=1725830000&utm_medium=email', h($r, 'Location'));
    $r = req('GET', '/about/?utm_source=x#frag');
    t('301-drops-the-fragment', h($r, 'Location') === '/about?utm_source=x', h($r, 'Location'));
    $r = req('GET', '/');
    t('root-is-not-redirected', code($r) === 0 && $r['body'] !== '', 'the single trailing slash rule ate /');
    $r = req('GET', '/training/');
    t('training-slash-is-301', code($r) === 301 && h($r, 'Location') === '/training', h($r, 'Location'));
    // EVERY 301, not just the one measured above. A redirect with no cache directive is one a browser may keep for
    // good, and a stored redirect is out of reach of both kill switches: max-age is the ceiling on a rollback.
    foreach (array('/about/', '/about/?utm_source=x', '/training/', '/training/?v=1725830000&utm_medium=email',
                   '/about/?fbclid=IwAR0#frag') as $u) {
        $r = req('GET', $u);
        t('301-is-cacheable-for-five-minutes-' . $u,
            code($r) === 301 && h($r, 'Cache-Control') === 'public, max-age=300' && h($r, 'Vary') === 'Accept-Encoding',
            'code=' . code($r) . ' cc=' . h($r, 'Cache-Control') . ' vary=' . h($r, 'Vary'));
    }

    // ── the query allowlist, serving side: a tracking tag changes nothing about which page answers ──
    $tags = array(
        'utm_source'  => '/about?utm_source=newsletter',
        'utm_medium'  => '/about?utm_medium=email',
        'utm_campaign' => '/about?utm_campaign=fall',
        'utm_term'    => '/about?utm_term=protection',
        'utm_content' => '/about?utm_content=a',
        'fbclid'      => '/about?fbclid=IwAR0',
        'gclid'       => '/about?gclid=Cj0KC',
        'msclkid'     => '/about?msclkid=abc',
        'ttclid'      => '/about?ttclid=abc',
        'mc_cid'      => '/about?mc_cid=1&mc_eid=2',
        'ref'         => '/about?ref=partner',
        'v'           => '/about?v=1725830000',
        'empty-value' => '/about?utm_source=',
        'no-value'    => '/about?fbclid',
        'trailing-sep' => '/about?utm_source=x&',
        'all-of-them' => '/about?utm_source=a&utm_medium=b&utm_campaign=c&gclid=d',
    );
    foreach ($tags as $name => $uri) { t('query-tag-serves-' . $name, req('GET', $uri)['body'] === $ab, $uri); }
    $r = req('GET', '/?v=1725830000');
    t('cache-bust-probe-reaches-the-plugin', $r['body'] === $bytes && h($r, 'X-Atlas-Static-Root') === $VER . ';file=index.html;b=' . $BUILD,
        'https://atlasglinn.com/?v=<ts> is the go-live check and it must hit the plugin');
    t('about-with-fragment-serves', req('GET', '/about#frag')['body'] === $ab);
    t('about-with-query-and-fragment-serves', req('GET', '/about?utm_source=x#frag')['body'] === $ab);
    t('query-ok-empty', atlas_static_root_query_ok('') === true);
    t('query-ok-tracking', atlas_static_root_query_ok('utm_source=x') === true);
    t('query-ok-refuses-unknown', atlas_static_root_query_ok('p=1') === false);
    t('query-ok-refuses-mixed', atlas_static_root_query_ok('utm_source=x&p=1') === false);

    // ── '/training' → training.html ──
    $r = req('GET', '/training');
    t('training-serves', $r['body'] === file_get_contents(ABSPATH . 'training.html'));
    t('training-proof-names-file', h($r, 'X-Atlas-Static-Root') === $VER . ';file=training.html;b=' . $BUILD);

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
    t('inm-equal-keeps-proof-header', h($r, 'X-Atlas-Static-Root') === $VER . ';file=about.html;b=' . $BUILD);
    t('inm-equal-keeps-cache-control', h($r, 'Cache-Control') === 'public, max-age=300');
    t('inm-equal-keeps-vary', h($r, 'Vary') === 'Accept-Encoding');
    t('inm-equal-no-content-length', h($r, 'Content-Length') === '', h($r, 'Content-Length'));
    t('inm-equal-six-headers', count($r['headers']) === 6, 'sent=' . count($r['headers']));
    t('inm-equal-exits-once', $r['exit'] === 1);
    t('inm-equal-resets-output-once', $r['flush'] === 1, 'flush=' . $r['flush']);
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
    $r = req('GET', '/about', array('HTTP_IF_MODIFIED_SINCE' => ' ' . $aboutLm . ' '));
    t('ims-padded-is-304', code($r) === 304, 'a header value with surrounding space is still a fixdate');
    $r = req('GET', '/about', array('HTTP_IF_MODIFIED_SINCE' => gmdate('D, d M Y H:i:s', filemtime(ABSPATH . 'about.html') - 600) . ' GMT'));
    t('ims-older-is-200', code($r) === 0 && $r['body'] === $ab, 'code=' . code($r));
    // Strict IMF-fixdate only: everything below is a value some parser would accept and this one must not.
    $loose = array(
        'garbage'   => 'not a date at all',
        'relative'  => 'tomorrow',
        'relative-past' => 'yesterday',
        'epoch'     => (string) (filemtime(ABSPATH . 'about.html') + 600),
        'rfc850'    => gmdate('l, d-M-y H:i:s', filemtime(ABSPATH . 'about.html') + 600) . ' GMT',
        'asctime'   => gmdate('D M j H:i:s Y', filemtime(ABSPATH . 'about.html') + 600),
        'iso8601'   => gmdate('c', filemtime(ABSPATH . 'about.html') + 600),
        'no-gmt'    => gmdate('D, d M Y H:i:s', filemtime(ABSPATH . 'about.html') + 600),
        'wrong-tz'  => gmdate('D, d M Y H:i:s', filemtime(ABSPATH . 'about.html') + 600) . ' UTC',
    );
    foreach ($loose as $name => $value) {
        $r = req('GET', '/about', array('HTTP_IF_MODIFIED_SINCE' => $value));
        t('ims-not-a-fixdate-is-200-' . $name, code($r) === 0 && $r['body'] === $ab, $value . ' produced a 304');
    }
    $wrongDay = (strpos($aboutLm, 'Mon') === 0 ? 'Tue' : 'Mon') . substr($aboutLm, 3);
    $r = req('GET', '/about', array('HTTP_IF_MODIFIED_SINCE' => $wrongDay));
    t('ims-wrong-weekday-is-200', code($r) === 0 && $r['body'] === $ab, $wrongDay . ' produced a 304');
    t('since-returns-a-timestamp', atlas_static_root_since($aboutLm) === filemtime(ABSPATH . 'about.html'), (string) atlas_static_root_since($aboutLm));
    t('since-refuses-relative', atlas_static_root_since('tomorrow') === false);
    $r = req('GET', '/about', array('HTTP_IF_NONE_MATCH' => '"deadbeef"',
        'HTTP_IF_MODIFIED_SINCE' => gmdate('D, d M Y H:i:s', filemtime(ABSPATH . 'about.html') + 600) . ' GMT'));
    t('inm-beats-ims-rfc7232', code($r) === 0 && $r['body'] === $ab, 'If-Modified-Since answered while If-None-Match disagreed');
    $r = req('HEAD', '/about', array('HTTP_IF_NONE_MATCH' => $aboutEtag));
    t('head-conditional-is-304', code($r) === 304 && $r['body'] === '');
    t('conditional-fall-through-still-works', fell_through(req('GET', '/wp-admin/', array('HTTP_IF_NONE_MATCH' => $aboutEtag))));

    // ── nothing was written anywhere ──
    t('no-file-written-to-docroot', count(glob(ABSPATH . '*')) === 11, 'entries=' . count(glob(ABSPATH . '*')));
    t('no-marker-created', !file_exists(WPMU_PLUGIN_DIR . '/.atlas-static-root-off'));
    t('serve-scenario-logged-nothing', trim(t_log()) === '', trim(t_log()));
}

// ── guards: every refusal, one case each, each one detectable if its check is deleted ───────────────────────────────
if ($SCN === 'guards') {
    $GLOBALS['t_read'] = 0;
    atlas_static_root_build();   // warm the memoised digest so per-request read counts are the page only
    $ab    = file_get_contents(ABSPATH . 'about.html');
    $bytes = file_get_contents(ABSPATH . 'index.html');

    // ── path shape. Be honest about what these pin: the allowlist is an EXACT map, so deleting a shape guard does
    // not change what a request returns — the map refuses the path one step later. The detector is therefore the
    // direct atlas_static_root_safe() assertion beside each probe, and it is a real one: removing any of the five
    // lines in that function turns its assertion red (measured 2026-09-08, five mutants, five reds). Each probe also
    // carries the on-disk proof that it WOULD have resolved, so the guard is defending something that exists. ──
    t('safe-accepts-an-allowlisted-shape', atlas_static_root_safe('/about') === true);
    t('safe-refuses-empty', atlas_static_root_safe('') === false);
    t('safe-refuses-relative', atlas_static_root_safe('about') === false);
    t('probe-dotdot-resolves-on-disk', is_file(ABSPATH . 'x/../about.html'), ABSPATH . 'x/../about.html');
    t('safe-refuses-dotdot', atlas_static_root_safe('/x/../about') === false);
    t('dotdot-falls-through', fell_through(req('GET', '/x/../about')));
    t('dotdot-to-wp-admin-falls-through', fell_through(req('GET', '/about/../wp-admin')));
    t('probe-double-slash-resolves-on-disk', is_file(ABSPATH . '/about.html'), ABSPATH . '/about.html');
    t('safe-refuses-double-slash', atlas_static_root_safe('//about') === false);
    t('double-slash-falls-through', fell_through(req('GET', '//about')));
    t('trailing-double-slash-falls-through', fell_through(req('GET', '/about//')));
    t('probe-percent-decodes-to-an-allowlisted-path', rawurldecode('/%61bout') === '/about');
    t('safe-refuses-percent', atlas_static_root_safe('/%61bout') === false);
    t('percent-falls-through', fell_through(req('GET', '/%61bout')));
    t('percent-encoded-slash-falls-through', fell_through(req('GET', '/about%2F')));
    t('safe-refuses-nul', atlas_static_root_safe("/ab\0out") === false);
    t('nul-falls-through', fell_through(req('GET', "/ab\0out")));
    t('safe-refuses-control-byte', atlas_static_root_safe("/about\x01") === false);
    t('safe-refuses-newline', atlas_static_root_safe("/about\r\n") === false, 'a header-injection shape');
    t('safe-refuses-del', atlas_static_root_safe("/about\x7f") === false);
    t('control-byte-falls-through', fell_through(req('GET', "/about\x01")));

    // ── the query. Every one of these is a WordPress route that lives on '/' and dies if a static file answers it. ──
    $wpq = array(
        'wc-ajax'       => '/?wc-ajax=get_refreshed_fragments',
        'wc-api'        => '/?wc-api=WC_Gateway_Stripe',
        'search'        => '/?s=executive+protection',
        'rest-route'    => '/?rest_route=/wp/v2/pages',
        'feed'          => '/?feed=rss2',
        'post-id'       => '/?p=1',
        'page-id'       => '/?page_id=7',
        'preview'       => '/?preview=true',
        'customize'     => '/?customize_changeset_uuid=abc123',
        'customize-msg' => '/?customize_messenger_channel=preview-0',
        'elementor'     => '/?elementor-preview=12',
        'add-to-cart'   => '/?add-to-cart=99',
        'lost-password' => '/?action=lostpassword',
        'wp-escape'     => '/?wp=1',
        'anything'      => '/?anything=1',
        'mixed'         => '/?utm_source=x&p=1',
        'mixed-reverse' => '/?p=1&utm_source=x',
        'uppercase-tag' => '/?UTM_SOURCE=x',
        'encoded-name'  => '/?%75tm_source=x',
        'array-name'    => '/?utm_source[]=x',
        'semicolon'     => '/?utm_source=x;p=1',
        'control-byte'  => "/?utm_source=a\x01b",
    );
    foreach ($wpq as $name => $uri) { t('query-falls-through-' . $name, fell_through(req('GET', $uri)), $uri); }
    t('wp-escape-about', fell_through(req('GET', '/about?wp=1')));
    t('wp-escape-about-any-value', fell_through(req('GET', '/about?wp=0')));
    t('wp-escape-about-empty-value', fell_through(req('GET', '/about?wp=')));
    t('wp-escape-not-first-param', fell_through(req('GET', '/about?utm_source=x&wp=1')));
    t('unknown-param-beats-the-redirect', fell_through(req('GET', '/about/?p=1')), '/about/?p=1 must be WordPress, not a 301');
    t('wpx-is-not-wp', req('GET', '/about?wpx=1')['read'] === 0, 'wpx is simply an unknown name — WordPress either way');

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
        'not-in-allowlist'   => '/mastsolutions',
        'signup-not-listed'  => '/signup',
        'capability-not-listed' => '/mast-capability-statement',
        'unknown'            => '/nope',
    );
    $before = t_log_lines();
    foreach ($fall as $name => $uri) { t('fall-through-' . $name, fell_through(req('GET', $uri)), $uri); }
    t('fall-through-logs-nothing', t_log_lines() === $before, trim(t_log()));

    // ── the file itself: one case per refusal, and the log line is what tells them apart ──
    $before = t_log_lines();
    $r = req('GET', '/careers');                                    // allowlisted, no file on disk
    t('missing-falls-through', refused($r));
    t('missing-logs-one-line', t_log_lines() === $before + 1, 'lines went ' . $before . ' -> ' . t_log_lines());
    t('missing-log-names-the-file-and-the-check', strpos(t_log_last(), 'missing or unreadable: careers.html') !== false, t_log_last());
    t('missing-log-is-tagged', strpos(t_log_last(), '[atlas-static-root]') !== false, t_log_last());
    $before = t_log_lines();
    req('GET', '/careers');
    t('missing-logs-one-line-per-request', t_log_lines() === $before + 1);

    $before = t_log_lines();
    $r = req('GET', '/technology');                                 // a directory wearing a page's name
    t('directory-falls-through', refused($r) && $r['read'] === 0);
    t('directory-logs-the-unreadable-line', t_log_lines() === $before + 1 && strpos(t_log_last(), 'missing or unreadable: technology.html') !== false, t_log_last());

    // chmod 000 is only a real case for a process that is not root. As uid 0 the file is readable anyway, so an
    // assertion here would pass while testing nothing — it SKIPs with the reason instead, and the parent counts the
    // skip toward the pin so the case cannot quietly disappear. The is_readable() guard stays in the plugin: on the
    // host PHP runs unprivileged, and the directory case above is the unreadable-file case that runs everywhere.
    $uid = function_exists('posix_geteuid') ? posix_geteuid() : getmyuid();
    if (is_readable(ABSPATH . 'uas.html')) {
        s('chmod-000-falls-through', 'running as uid ' . $uid . ', which reads a 0000 file regardless — is_readable() '
            . 'cannot be made false here, so this case is not runnable in this environment');
    } else {
        $before = t_log_lines();
        $r = req('GET', '/uas');
        t('chmod-000-falls-through', refused($r) && t_log_lines() === $before + 1 && strpos(t_log_last(), 'missing or unreadable: uas.html') !== false, t_log_last());
    }

    $before = t_log_lines();
    $r = req('GET', '/privacy');                                    // zero bytes
    t('empty-file-falls-through', refused($r) && $r['read'] === 1, 'read=' . $r['read']);
    t('empty-file-logs-the-truncated-line', t_log_lines() === $before + 1 && strpos(t_log_last(), 'empty or truncated') !== false && strpos(t_log_last(), 'privacy.html') !== false, t_log_last());
    $before = t_log_lines();
    $r = req('GET', '/terms');                                      // real HTML, no closing tag
    t('truncated-file-is-not-a-200', refused($r), 'a half-written upload was served with public caching');
    t('truncated-file-logs-the-truncated-line', t_log_lines() === $before + 1 && strpos(t_log_last(), 'empty or truncated') !== false && strpos(t_log_last(), 'terms.html') !== false, t_log_last());
    t('truncated-fixture-is-really-truncated', stripos(file_get_contents(ABSPATH . 'terms.html'), '</html>') === false && filesize(ABSPATH . 'terms.html') > 0);

    t('symlink-fixtures-exist', $LINK_OUT && $LINK_IN, 'the symlink cases below are not testing anything');
    $before = t_log_lines();
    $r = req('GET', '/ep-app');                                     // a symlink pointing OUT of the docroot
    t('symlink-out-of-docroot-falls-through', refused($r) && $r['read'] === 0);
    t('symlink-out-logs-the-containment-line', t_log_lines() === $before + 1 && strpos(t_log_last(), 'outside the docroot: ep-app.html') !== false, t_log_last());
    $before = t_log_lines();
    $r = req('GET', '/contact');                                    // a symlink pointing INSIDE it, at about.html
    t('symlink-inside-docroot-falls-through', refused($r) && $r['body'] !== $ab);
    t('symlink-inside-logs-the-symlink-line', t_log_lines() === $before + 1 && strpos(t_log_last(), 'symlink: contact.html') !== false, t_log_last());
    t('contained-accepts-a-real-page', atlas_static_root_contained(ABSPATH . 'about.html') === true);
    t('contained-refuses-a-path-outside', atlas_static_root_contained($OUT) === false, $OUT);

    // ── containment is ANCHORED on the separator, and this is the case that can tell. real-docroot2/ is a sibling of
    // the docroot whose name starts with the docroot's name, so the naive strpos($real, $root) === 0 — no separator on
    // the end of $root — passes it. The probe pins that the naive check really would have been fooled here, so the
    // assertion under it is measuring the anchoring and not the fact that the file is somewhere else. ──
    t('sibling-fixture-exists', $LINK_SIB && is_file($SIB . 'target.html'), 'the anchoring case below is hollow');
    t('probe-the-naive-prefix-check-would-pass-the-sibling',
        strpos(realpath($SIB . 'target.html'), realpath(ABSPATH)) === 0,
        'real-docroot2 does not share the docroot realpath as a prefix: ' . realpath($SIB . 'target.html'));
    t('contained-refuses-the-sibling-sharing-the-docroot-name', atlas_static_root_contained($SIB . 'target.html') === false,
        $SIB . 'target.html');
    $before = t_log_lines();
    $r = req('GET', '/disaster-recovery');
    t('sibling-prefix-falls-through', refused($r) && $r['read'] === 0);
    t('sibling-prefix-logs-the-containment-line', t_log_lines() === $before + 1 && strpos(t_log_last(), 'outside the docroot: disaster-recovery.html') !== false, t_log_last());

    $before = t_log_lines();
    $GLOBALS['t_read_false'] = true;
    $r = req('GET', '/about');                                      // the read comes back false
    $GLOBALS['t_read_false'] = false;
    t('read-failure-falls-through', refused($r) && $r['read'] === 1, 'read=' . $r['read']);
    t('read-failure-logs-the-read-line', t_log_lines() === $before + 1 && strpos(t_log_last(), 'read failed: about.html') !== false, t_log_last());
    t('read-works-again-after', req('GET', '/about')['body'] === $ab);

    // ── the 301 goes only to a page that can be served. Every shape above, reached through its WordPress permalink:
    // a redirect here takes a URL that works today and points it at one where this file falls through and WordPress
    // renders the slug — a loop where the host puts the slash back, a 404 where it does not. The log line proves it
    // was the SAME check that refused it, and not a second list that could drift from the serve path's. ──
    $unservable = array(
        'missing'        => array('/careers/',           'missing or unreadable: careers.html'),
        'directory'      => array('/technology/',        'missing or unreadable: technology.html'),
        'empty'          => array('/privacy/',           'empty or truncated'),
        'truncated'      => array('/terms/',             'empty or truncated'),
        'symlink-out'    => array('/ep-app/',            'outside the docroot: ep-app.html'),
        'symlink-in'     => array('/contact/',           'symlink: contact.html'),
        'sibling-prefix' => array('/disaster-recovery/', 'outside the docroot: disaster-recovery.html'),
    );
    foreach ($unservable as $name => $case) {
        $before = t_log_lines();
        $r = req('GET', $case[0]);
        t('unservable-slash-sends-no-301-' . $name, refused($r) && h($r, 'Location') === '' && code($r) === 0,
            $case[0] . ' -> ' . code($r) . ' ' . h($r, 'Location'));
        t('unservable-slash-logs-the-serve-paths-line-' . $name,
            t_log_lines() === $before + 1 && strpos(t_log_last(), $case[1]) !== false, t_log_last());
    }
    $r = req('GET', '/careers/?utm_source=x');
    t('unservable-slash-with-a-tracking-tag-sends-no-301', refused($r) && h($r, 'Location') === '', h($r, 'Location'));
    $r = req('GET', '/about/');
    t('servable-slash-still-301s', code($r) === 301 && h($r, 'Location') === '/about',
        'the servability gate is refusing every redirect, so the cases above prove nothing');

    // ── headers already sent: hand it back, do not half-answer ──
    $GLOBALS['t_headers_sent'] = true;
    t('headers-sent-root-falls-through', fell_through(req('GET', '/')));
    t('headers-sent-redirect-falls-through', fell_through(req('GET', '/about/')));
    t('headers-sent-conditional-falls-through', fell_through(req('GET', '/about', array('HTTP_IF_NONE_MATCH' => etag_of(ABSPATH . 'about.html')))));
    $GLOBALS['t_headers_sent'] = false;
    t('headers-not-sent-serves-again', req('GET', '/')['body'] === $bytes);

    // ── inherited output buffers: dropped before the body, or Content-Length is a lie ──
    $r = req('GET', '/', array(), 2);
    t('buffers-body-survives-two-inherited-buffers', $r['body'] === $bytes, 'len=' . strlen($r['body']));
    t('buffers-reset-called-once', $r['flush'] === 1, 'flush=' . $r['flush']);
    t('buffers-depth-is-zero-when-the-body-is-sent', $r['depth'] === 0, 'depth=' . $r['depth']);
    t('buffers-content-length-still-matches-the-body', h($r, 'Content-Length') === (string) strlen($r['body']), h($r, 'Content-Length'));
    $r = req('GET', '/about', array('HTTP_IF_NONE_MATCH' => etag_of(ABSPATH . 'about.html')), 2);
    t('buffers-304-drops-them-too', code($r) === 304 && $r['depth'] === 0 && $r['body'] === '', 'depth=' . $r['depth']);
    $r = req('GET', '/about/', array(), 2);
    t('buffers-301-drops-them-too', code($r) === 301 && $r['depth'] === 0 && $r['body'] === '', 'depth=' . $r['depth']);
    $r = req('GET', '/wp-admin/', array(), 2);
    t('buffers-fall-through-touches-nothing', $r['flush'] === 0 && $r['depth'] === -1, 'flush=' . $r['flush']);

    t('guards-wrote-no-file-to-docroot', count(glob(ABSPATH . '*')) === 11, 'entries=' . count(glob(ABSPATH . '*')));

    // ── the reset that cannot succeed. ob_start(null, 0, 0) is a buffer with no flags: ob_end_clean() returns false on
    // it forever, which the wrappers scenario pins against the REAL reset. The plugin must not carry on and announce a
    // Content-Length for bytes that are going to leave wrapped in it, or send a 304 that trails somebody else's output.
    // These run LAST on purpose: the fixture cannot be removed, so it stands for the rest of this process. ──
    $before = t_log_lines();
    $r = req('GET', '/', array(), 0, true);
    t('stuck-buffer-200-falls-through', refused($r) && $r['depth'] === 1, 'depth=' . $r['depth'] . ' headers=' . count($r['headers']));
    t('stuck-buffer-200-logs-the-buffer-line',
        t_log_lines() === $before + 1 && strpos(t_log_last(), 'output buffer would not drop: index.html') !== false, t_log_last());
    $before = t_log_lines();
    $r = req('GET', '/about', array('HTTP_IF_NONE_MATCH' => etag_of(ABSPATH . 'about.html')), 0, true);
    t('stuck-buffer-304-falls-through', refused($r), 'a 304 went out over a buffer still holding output');
    t('stuck-buffer-304-logs-the-buffer-line',
        t_log_lines() === $before + 1 && strpos(t_log_last(), 'output buffer would not drop: about.html') !== false, t_log_last());
    $before = t_log_lines();
    $r = req('GET', '/about/', array(), 0, true);
    t('stuck-buffer-301-falls-through', refused($r) && h($r, 'Location') === '', h($r, 'Location'));
    t('stuck-buffer-301-logs-the-redirect-line',
        t_log_lines() === $before + 1 && strpos(t_log_last(), 'not redirected, an output buffer would not drop: /about') !== false, t_log_last());
}

// ── wrappers: the plugin's OWN five, not the shims ──────────────────────────────────────────────────────────────────
if ($SCN === 'wrappers') {
    // These two have to be measured BEFORE this process writes a byte, and the reason is the same reason the plugin
    // calls the reset early: in CLI headers_sent() flips on the first byte out, and zlib.output_compression can only
    // be changed while no output has been sent (measured 2026-09-08 — ini_set() back to '0' after output is refused).
    $sentBefore = atlas_static_root_headers_sent();
    @ini_set('zlib.output_compression', '1');
    $zlibOn = ini_get('zlib.output_compression');
    atlas_static_root_reset_output();
    $zlibOff = ini_get('zlib.output_compression');

    t('wrappers-are-the-plugins-own', !defined('ATLAS_STATIC_ROOT_TESTING') && function_exists('atlas_static_root_reset_output'));
    t('real-headers-sent-is-false-before-any-output', $sentBefore === false);
    t('real-headers-sent-is-true-once-output-has-gone', atlas_static_root_headers_sent() === true, 'the wrapper is reporting a constant, not headers_sent()');
    t('zlib-fixture-really-turned-compression-on', $zlibOn === '1', 'zlib.output_compression=' . var_export($zlibOn, true) . ' — the next case would be hollow');
    t('real-reset-turns-zlib-compression-off', $zlibOff === '' || $zlibOff === '0', 'zlib.output_compression=' . var_export($zlibOff, true));
    t('real-read-returns-the-bytes', atlas_static_root_read(ABSPATH . 'about.html') === file_get_contents(ABSPATH . 'about.html'));
    t('real-read-of-a-missing-file-is-not-a-string', @atlas_static_root_read(ABSPATH . 'careers.html') === false);
    ob_start(); ob_start(); echo 'OUTPUT-FROM-SOMETHING-ELSE';
    $clean = atlas_static_root_reset_output();
    t('real-reset-drops-two-removable-buffers-to-zero', ob_get_level() === 0, 'level=' . ob_get_level());
    t('real-reset-reports-true-when-nothing-is-left', $clean === true, var_export($clean, true));
    // The one that used to spin. flags 0 = not removable: ob_end_clean() returns false on it forever, so REACHING the
    // line after this call is itself the assertion — and the runner's deadline is what turns a regression here into a
    // red instead of a hang.
    ob_start(null, 0, 0);
    $before = ob_get_level();
    $clean  = atlas_static_root_reset_output();
    $after  = ob_get_level();
    t('real-reset-returns-on-a-buffer-it-cannot-remove', $after === $before, 'before=' . $before . ' after=' . $after);
    t('real-reset-left-the-unremovable-buffer-standing', $after === 1, 'level=' . $after);
    // The return value the plugin acts on: false here is what makes serve() and the redirect fall through instead of
    // declaring a Content-Length for bytes this buffer is still holding.
    t('real-reset-reports-false-when-a-buffer-survives', $clean === false, var_export($clean, true));
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
    // Removing it does NOT re-enable the plugin inside this request, and that is the point: the marker is stat'ed once
    // and the answer memoised, because the file-scope guard and dispatch() both ask and a request cannot be allowed to
    // change its mind halfway through itself. mu-plugins are executed afresh on every request under mod_php and
    // php-fpm, where a static resets with the request, so the next request after the file is deleted is served — and
    // THAT case is every other scenario in this file, each of which is a fresh process with no marker.
    unlink(atlas_static_root_marker_path()); clearstatcache();
    t('marker-removed-is-still-off-in-this-request', atlas_static_root_off() === true,
        "the marker was stat'ed a second time inside one request");
    t('marker-removed-still-falls-through-in-this-request', fell_through(req('GET', '/')));
}

exit($FAILED ? 1 : 0);
