#!/usr/bin/env python3
"""
Server-side credential scan for the atlasglinn-website repository.

Runs on every push and pull request (.github/workflows/cred-scan.yml). It reads every tracked file — so it covers pushes
that never touched a Claude session, a hook or a local guard: the web UI, a phone, another client, an Action.

The pattern set is the canonical one from the brain vault's NO LIVE CREDENTIALS IN VAULT NOTES rule. Nothing here is
allowed to be relaxed to make a build pass: a hit is either a real secret (rotate it, then remove it) or a false positive
that gets an explicit, narrow allow entry naming the file and why.

Exit 0 = clean. Exit 1 = at least one hit; every hit is printed as file:line with the matched value masked, because the
log of a failing public job must not become the second place the secret leaked.
"""

import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Directories and file kinds a credential cannot meaningfully live in as text, or that are not ours to police.
SKIP_DIRS = {'node_modules', '.git', 'vendor', 'films', '.venv', 'venv', '__pycache__', 'dist', 'build'}
SKIP_EXT = {
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.svg', '.bmp', '.tiff',
    '.mp4', '.mov', '.webm', '.m4v', '.mp3', '.wav', '.ogg',
    '.pdf', '.zip', '.gz', '.tgz', '.bz2', '.xz', '.7z', '.woff', '.woff2', '.ttf', '.otf', '.eot',
}
MAX_BYTES = 4 * 1024 * 1024

# (name, regex). Ordered loosest-last so the most specific name is reported.
PATTERNS = [
    ('Google API key', re.compile(r'AIzaSy[A-Za-z0-9_\-]{33}')),
    ('OpenAI / Anthropic key', re.compile(r'\bsk-[A-Za-z0-9_\-]{20,}')),
    ('Stripe live key', re.compile(r'\b(?:sk|pk|rk)_live_[A-Za-z0-9]{10,}')),
    ('RevenueCat key', re.compile(r'\bappl_[A-Za-z0-9]{20,}')),
    ('Slack token', re.compile(r'\bxox[bpaers]-[A-Za-z0-9\-]{10,}')),
    ('GitHub token', re.compile(r'\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}')),
    ('GitHub fine-grained PAT', re.compile(r'\bgithub_pat_[A-Za-z0-9_]{20,}')),
    ('GitLab token', re.compile(r'\bglpat-[A-Za-z0-9_\-]{20,}')),
    ('AWS access key id', re.compile(r'\bAKIA[A-Z0-9]{16}\b')),
    ('JWT', re.compile(r'\beyJ[A-Za-z0-9_\-]{10,}\.eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}')),
    ('Twilio SID / key', re.compile(r'\b(?:AC|SK)[a-f0-9]{32}\b')),
    ('Resend key', re.compile(r'\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{20,}')),
    ('Bearer token', re.compile(r'Bearer\s+[A-Za-z0-9_\-\.=]{20,}')),
    # An opaque 32–40 hex blob sitting next to a key-ish name — the class that got missed once (AISStream, 2026-05-09).
    ('key-adjacent hex blob', re.compile(
        r'(?i)(?:api[_\-]?key|access[_\-]?token|secret|_key|_token)["\'\s:=]{1,8}([a-f0-9]{32,40})\b')),
    # A private key of any flavour. Non-capturing, so the report names the header rather than an empty group.
    ('private key block', re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH |DSA |)PRIVATE KEY-----')),
    # Cloudflare API tokens are 40 characters of [A-Za-z0-9_-] with no prefix to anchor on, so the context is the anchor.
    # This repository deploys a Worker; a token pasted beside the word that names it is the shape to catch.
    ('Cloudflare API token', re.compile(
        r'(?i)(?:cloudflare|CF_|cf_api|api_token)[^\n]{0,48}?["\'\s:=]([A-Za-z0-9_\-]{40})(?![A-Za-z0-9_\-])')),
    # An AWS secret access key is 40 base64 characters and, like the Cloudflare one, has no prefix of its own — AKIA…
    # above only catches the id that travels with it.
    ('AWS secret access key', re.compile(
        r'(?i)(?:aws_secret|secret_access_key)[^\n]{0,48}?["\'\s:=]([A-Za-z0-9/+=]{40})(?![A-Za-z0-9/+=])')),
]

# Long lines are scanned WHOLE, in overlapping windows. Truncating at 8000 characters (what this did until 2026-09-08)
# meant a secret in a minified bundle or a one-line JSON blob was simply not looked at; the overlap is wider than any
# pattern here, so a match lying across a window boundary is still found.
CHUNK = 8000
OVERLAP = 512


def windows(line):
    if len(line) <= CHUNK:
        return [line]
    out, start = [], 0
    while start < len(line):
        out.append(line[start:start + CHUNK])
        if start + CHUNK >= len(line):
            break
        start += CHUNK - OVERLAP
    return out

# Narrow, explicit false positives. Each entry is (path suffix, pattern name, substring that must be present ON THE LINE).
# Adding to this list is a code review, not a workaround: it names the file, the class and the exact value shape.
#
# The third field is matched against the LINE, not against the matched value, so an entry can be anchored on the thing
# that makes it harmless rather than on the thing that makes it look like a secret. Anchoring on the file alone would
# disarm the scanner for that file forever, which is how an allow list stops being a review.
ALLOW = [
    # A documented example of the shape of a Google service-account JSON. The key body on that line is the three-dot
    # elision '\\n...\\n', so the entry only holds while the body stays elided: paste a real key in and it fires.
    ('.claude/skills/seo-google/references/auth-setup.md', 'private key block', '\\n...\\n'),
]


def masked(value):
    """First four characters, then the length. Never the value."""
    v = str(value)
    return '%s… (%d chars)' % (v[:4], len(v))


def tracked_files():
    out = subprocess.run(['git', 'ls-files', '-z'], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    return [p for p in out.split('\0') if p]


def skip(path):
    parts = path.split('/')
    if any(p in SKIP_DIRS for p in parts[:-1]):
        return True
    if os.path.splitext(parts[-1])[1].lower() in SKIP_EXT:
        return True
    # This scanner carries the pattern set itself; scanning it finds its own regexes.
    return path == '.github/scripts/ci_cred_scan.py'


def allowed(path, name, line):
    return any(path.endswith(p) and name == n and s in line for p, n, s in ALLOW)


def main():
    hits = []
    scanned = 0
    for rel in tracked_files():
        if skip(rel):
            continue
        full = os.path.join(ROOT, rel)
        try:
            if not os.path.isfile(full) or os.path.getsize(full) > MAX_BYTES:
                continue
            with open(full, 'r', encoding='utf-8', errors='replace') as fh:
                lines = fh.read().split('\n')
        except OSError:
            continue
        scanned += 1
        for n, line in enumerate(lines, 1):
            found = False
            for chunk in windows(line):
                for name, rx in PATTERNS:
                    m = rx.search(chunk)
                    if not m:
                        continue
                    value = m.group(1) if rx.groups else m.group(0)
                    if allowed(rel, name, chunk):
                        continue
                    hits.append((rel, n, name, value))
                    found = True
                    break
                if found:       # one hit per line is enough to fail the run and name the file
                    break

    print('cred-scan: %d tracked files scanned' % scanned)
    if not hits:
        print('cred-scan: clean — no credential pattern matched')
        return 0
    print('')
    print('cred-scan: %d HIT(S). A hit is a real secret until proven otherwise:' % len(hits))
    print('  1. ROTATE it first — git history is permanent, removing the line does not un-leak it.')
    print('  2. Replace the literal with a reference (a repository secret, a Worker secret, or [Keychain <name>]).')
    print('  3. Only if it is genuinely not a secret, add a narrow entry to ALLOW in this file, naming why.')
    print('')
    for rel, n, name, value in hits:
        print('  %s:%d  %s  %s' % (rel, n, name, masked(value)))
    return 1


if __name__ == '__main__':
    sys.exit(main())
