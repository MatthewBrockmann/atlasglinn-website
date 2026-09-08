#!/usr/bin/env python3
"""Fill the MAST Solutions Certificate of Completion template and print it to PDF.

Template: certificates/mast-certificate-of-completion.html
Assets:   certificates/assets/mast-logo.png (inlined as a data: URI so the
          generated HTML is self-contained and can be written anywhere).
Signature: NOT in this repository. The website repo is public; Brockmann's
          handwritten signature lives in the private brain repo and is read
          from --signature (default ~/Documents/brain/04-resources/brand/
          mast-signature-brockmann.png on his Mac). No signature file, no
          certificate: the builder exits 1 rather than print a blank block.

Name and course sizes step down with length so long values stay on their
rule (name: 34px to 24 chars, 28px to 34, 23px to 44, 19px to 56; course:
26px to 30 chars, 22px to 40, 18px to 52). Longer than that exits 1 - a
value that long needs a hand layout, not a smaller font.

Certificate number rule
-----------------------
    cert_no = "No. <YYYY>-<suffix>"

    YYYY   = four-digit year of the class date (the date of completion)
    suffix = the registrations.id, and it has two forms:
             * INTEGER id -> the id zero-padded to 5 digits   ->  No. 2026-00042
             * TEXT/UUID id -> last 6 hex characters, uppercased -> No. 2026-9F2C1A

mast-backend/schema.sql declares `registrations.id TEXT PRIMARY KEY` holding
`reg_<uuid>`, so the TEXT/UUID branch is the one that applies to this schema.
The INTEGER branch is kept for any future integer-keyed registration table.
"""

import argparse
import base64
import html
import mimetypes
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import zlib

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEMPLATE = os.path.join(REPO, "certificates", "mast-certificate-of-completion.html")

FIELDS = ("name", "course", "descriptor", "cert_no", "date")

SIGNATURE_DEFAULT = os.path.expanduser(
    "~/Documents/brain/04-resources/brand/mast-signature-brockmann.png")

NAME_STEPS = ((24, 34), (34, 28), (44, 23), (56, 19))
COURSE_STEPS = ((30, 26), (40, 22), (52, 18))


def fit_size(value, steps, what):
    """Font size for a value by its length; a value past the last step is refused."""
    n = len(value)
    for limit, px in steps:
        if n <= limit:
            return px
    die("%s is %d characters; the certificate fits at most %d. Shorten it or lay it out by hand."
        % (what, n, steps[-1][0]))

CHROME_CANDIDATES = (
    os.environ.get("CHROME"),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/opt/pw-browsers/chromium",
    "chromium",
    "google-chrome",
)


def die(msg):
    sys.stderr.write(msg.rstrip() + "\n")
    sys.exit(1)


def usable(cand):
    if not cand:
        return None
    if os.path.sep in cand:
        return cand if os.path.isfile(cand) and os.access(cand, os.X_OK) else None
    return shutil.which(cand)


def find_chrome(explicit=None):
    """An explicit --chrome is authoritative: it is never silently replaced."""
    if explicit:
        found = usable(explicit)
        if not found:
            die("No browser at %s (--chrome)." % explicit)
        return found
    for cand in CHROME_CANDIDATES:
        found = usable(cand)
        if found:
            return found
    return None


def inline_assets(markup, asset_root):
    """Replace src="assets/x.png" with a data: URI so the HTML stands alone."""

    def sub(match):
        rel = match.group(1)
        path = os.path.join(asset_root, rel)
        if not os.path.isfile(path):
            die("Missing template asset: %s" % path)
        mime = mimetypes.guess_type(path)[0] or "application/octet-stream"
        with open(path, "rb") as fh:
            b64 = base64.b64encode(fh.read()).decode("ascii")
        return 'src="data:%s;base64,%s"' % (mime, b64)

    return re.sub(r'src="((?:assets/)[^"]+)"', sub, markup)


def data_uri(path):
    mime = mimetypes.guess_type(path)[0] or "application/octet-stream"
    with open(path, "rb") as fh:
        return "data:%s;base64,%s" % (mime, base64.b64encode(fh.read()).decode("ascii"))


def render_html(values, template=TEMPLATE, signature=SIGNATURE_DEFAULT):
    if not os.path.isfile(template):
        die("Template not found: %s" % template)
    if not signature or not os.path.isfile(signature):
        die("No signature image at %s. The signature is kept in the private brain repo "
            "(04-resources/brand/mast-signature-brockmann.png); pass --signature <path>." % signature)
    with open(template, encoding="utf-8") as fh:
        markup = fh.read()
    for field in FIELDS:
        markup = markup.replace("{{%s}}" % field, html.escape(values[field]))
    markup = markup.replace("{{signature_src}}", data_uri(signature))
    name_px = fit_size(values["name"], NAME_STEPS, "The name")
    course_px = fit_size(values["course"], COURSE_STEPS, "The course name")
    markup = markup.replace('class="row name"    style="--y:402px"',
                            'class="row name"    style="--y:402px;--name-size:%dpx"' % name_px, 1)
    markup = markup.replace('class="row course"     style="--y:532px"',
                            'class="row course"     style="--y:532px;--course-size:%dpx"' % course_px, 1)
    assert "--name-size:" in markup and "--course-size:" in markup, "size hooks missing in the template"
    left = re.findall(r"\{\{([a-z_]+)\}\}", markup)
    if left:
        die("Template still holds unfilled placeholders: %s" % ", ".join(sorted(set(left))))
    return inline_assets(markup, os.path.dirname(os.path.abspath(template)))


SHEET_W, SHEET_H = 1056, 816


def chrome_argv(chrome, profile):
    return [
        chrome,
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--hide-scrollbars",
        "--user-data-dir=%s" % profile,
        "--run-all-compositor-stages-before-draw",
        "--virtual-time-budget=4000",
    ]


def viewport_size(chrome, want_w, want_h):
    """Ask the browser what viewport a --window-size actually yields.

    Headless Chrome reserves window chrome, so --window-size=1056,816 renders a
    short viewport and the screenshot comes out clipped. Measure it instead of
    assuming; on a build with no reserved chrome this returns exactly what was
    asked for and the screenshot runs at the requested size.
    """
    probe = ("<!doctype html><meta charset=utf-8><body><script>"
             "document.body.textContent='VP:'+innerWidth+'x'+innerHeight"
             "</script></body>")
    profile = tempfile.mkdtemp(prefix="mast-cert-chrome-")
    tmp = tempfile.mkdtemp(prefix="mast-cert-probe-")
    path = os.path.join(tmp, "probe.html")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(probe)
    try:
        argv = chrome_argv(chrome, profile) + [
            "--window-size=%d,%d" % (want_w, want_h),
            "--dump-dom", "file://%s" % path,
        ]
        proc = subprocess.run(argv, capture_output=True, text=True, timeout=120)
    except (OSError, subprocess.TimeoutExpired):
        return want_w, want_h
    finally:
        shutil.rmtree(profile, ignore_errors=True)
        shutil.rmtree(tmp, ignore_errors=True)
    hit = re.search(r"VP:(\d+)x(\d+)", proc.stdout or "")
    if not hit:
        return want_w, want_h
    return int(hit.group(1)), int(hit.group(2))


def crop_png_height(path, height):
    """Drop trailing scanlines from a PNG without decoding it.

    PNG row filters only reference the row above, so the leading rows stay valid
    verbatim once the height in IHDR is reduced.
    """
    with open(path, "rb") as fh:
        blob = fh.read()
    pos, idat, ihdr, keep = 8, b"", None, []
    while pos < len(blob):
        length = struct.unpack(">I", blob[pos:pos + 4])[0]
        kind = blob[pos + 4:pos + 8]
        data = blob[pos + 8:pos + 8 + length]
        if kind == b"IHDR":
            ihdr = bytearray(data)
        elif kind == b"IDAT":
            idat += data
        elif kind not in (b"IEND",):
            keep.append((kind, data))
        pos += 12 + length
    if ihdr is None:
        return
    w, h, depth, colour, _, _, interlace = struct.unpack(">IIBBBBB", bytes(ihdr))
    if interlace or h <= height:
        return
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[colour]
    stride = (w * channels * depth + 7) // 8
    raw = zlib.decompress(idat)[: height * (1 + stride)]
    struct.pack_into(">I", ihdr, 4, height)

    def chunk(kind, payload):
        return (struct.pack(">I", len(payload)) + kind + payload
                + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF))

    out = [b"\x89PNG\r\n\x1a\n", chunk(b"IHDR", bytes(ihdr))]
    out += [chunk(k, d) for k, d in keep]
    out += [chunk(b"IDAT", zlib.compress(raw, 9)), chunk(b"IEND", b"")]
    with open(path, "wb") as fh:
        fh.write(b"".join(out))


def run_chrome(chrome, html_path, mode, out_path, window=None):
    """mode is 'pdf' or 'png'."""
    profile = tempfile.mkdtemp(prefix="mast-cert-chrome-")
    argv = chrome_argv(chrome, profile)
    if mode == "pdf":
        argv += ["--no-pdf-header-footer", "--no-margins",
                 "--print-to-pdf=%s" % out_path]
    else:
        argv += ["--window-size=%d,%d" % window, "--screenshot=%s" % out_path]
    argv.append("file://%s" % html_path)

    try:
        proc = subprocess.run(argv, capture_output=True, text=True, timeout=120)
    except FileNotFoundError:
        die("Could not execute the browser at %s." % chrome)
    except subprocess.TimeoutExpired:
        die("The browser timed out rendering %s." % out_path)
    finally:
        shutil.rmtree(profile, ignore_errors=True)

    if not os.path.isfile(out_path) or os.path.getsize(out_path) == 0:
        detail = (proc.stderr or proc.stdout or "").strip().splitlines()
        tail = detail[-1] if detail else "no output from the browser"
        die("The browser did not write %s (%s)." % (out_path, tail))
    return out_path


def main():
    parser = argparse.ArgumentParser(
        prog="build-certificate.py",
        description="Build one MAST Solutions Certificate of Completion.",
        epilog=(
            "CERTIFICATE NUMBER RULE\n"
            "  cert_no = \"No. <YYYY>-<suffix>\", where YYYY is the four-digit year of\n"
            "  the class date and suffix comes from the registration id:\n"
            "    integer id   -> zero-pad to 5 digits          e.g. No. 2026-00042\n"
            "    text/uuid id -> last 6 hex chars, uppercased  e.g. No. 2026-9F2C1A\n"
            "  mast-backend/schema.sql declares registrations.id as TEXT (reg_<uuid>),\n"
            "  so the text/uuid branch is the case that applies to this schema.\n"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--name", required=True, help="participant name, e.g. \"Jane Doe\"")
    parser.add_argument("--course", required=True,
                        help="course name verbatim from the catalog, e.g. \"Handgun Fundamentals\"")
    parser.add_argument("--descriptor", required=True,
                        help="gold descriptor line, e.g. \"HANDGUN · EIGHT HOURS\"")
    parser.add_argument("--cert-no", required=True, dest="cert_no",
                        help="certificate number, see the rule below")
    parser.add_argument("--date", required=True,
                        help="date of completion, e.g. \"September 20, 2026\"")
    parser.add_argument("--out", required=True, help="output PDF path")
    parser.add_argument("--html", help="also keep the filled HTML at this path")
    parser.add_argument("--png", help="also write a 1056x816 preview PNG here")
    parser.add_argument("--chrome", help="path to Chrome/Chromium (overrides probing)")
    parser.add_argument("--signature", default=SIGNATURE_DEFAULT,
                        help="Brockmann's signature PNG (private brain repo); default %s" % SIGNATURE_DEFAULT)
    parser.add_argument("--template", default=TEMPLATE, help=argparse.SUPPRESS)
    args = parser.parse_args()

    chrome = find_chrome(args.chrome)
    if not chrome:
        die("No Chrome or Chromium found. Set $CHROME or pass --chrome <path>; "
            "tried: " + ", ".join(c for c in CHROME_CANDIDATES if c))

    values = {f: getattr(args, f) for f in FIELDS}
    markup = render_html(values, args.template, args.signature)

    for target in (args.out, args.html, args.png):
        if target:
            parent = os.path.dirname(os.path.abspath(target))
            if parent:
                os.makedirs(parent, exist_ok=True)

    if args.html:
        html_path = os.path.abspath(args.html)
        with open(html_path, "w", encoding="utf-8") as fh:
            fh.write(markup)
        tmpdir = None
    else:
        tmpdir = tempfile.mkdtemp(prefix="mast-cert-")
        html_path = os.path.join(tmpdir, "certificate.html")
        with open(html_path, "w", encoding="utf-8") as fh:
            fh.write(markup)

    try:
        written = [run_chrome(chrome, html_path, "pdf", os.path.abspath(args.out))]
        if args.png:
            png_path = os.path.abspath(args.png)
            vp_w, vp_h = viewport_size(chrome, SHEET_W, SHEET_H)
            window = (SHEET_W + max(0, SHEET_W - vp_w), SHEET_H + max(0, SHEET_H - vp_h))
            run_chrome(chrome, html_path, "png", png_path, window)
            crop_png_height(png_path, SHEET_H)
            written.append(png_path)
    finally:
        if tmpdir:
            shutil.rmtree(tmpdir, ignore_errors=True)

    if args.html:
        written.append(os.path.abspath(args.html))
    for path in written:
        print(path)


if __name__ == "__main__":
    main()
