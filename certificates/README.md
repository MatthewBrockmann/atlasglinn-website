# MAST Solutions — Certificate of Completion

The print template every MAST class certificate comes off, rebuilt from the auction
gift certificate (`Certificate of Training · PRIVATE COURSE OF INSTRUCTION`) so the
paper, the double gold border, the corner flourishes, the ◆ divider and the signature
block are the same artwork. The auction copy is gone — bearer and guests, range fee,
firearm rentals, ammunition, scheduling, `CERTIFICATE VALUE`, `VALID THROUGH` — and
`VALID THROUGH` has been replaced by a blank **INSTRUCTOR** rule the instructor signs
by hand at the class.

- `mast-certificate-of-completion.html` — the template, letter landscape, one page.
- `assets/mast-logo.png` — the MAST shield, lifted with alpha out of the source certificate.
- **The signature is not in this repository.** This repo is public; Brockmann's handwritten
  signature (also lifted from the source certificate) lives in the private brain repo at
  `04-resources/brand/mast-signature-brockmann.png` and the builder reads it from
  `--signature` (default `~/Documents/brain/04-resources/brand/mast-signature-brockmann.png`
  on his Mac). No signature file, no certificate: the builder exits 1 rather than print a
  blank block. For the same reason no built sample is committed — every finished
  certificate carries the signature. Build one to `~/Desktop` to see it.

## Build one

```
python3 scripts/build-certificate.py --name "Jane Doe" --course "Handgun Fundamentals" --descriptor "HANDGUN · EIGHT HOURS" --cert-no "No. 2026-9F2C1A" --date "September 20, 2026" --out ~/Desktop/doe-handgun.pdf
```

`--png <file>` also writes a 1056×816 preview, `--html <file>` keeps the filled HTML,
`--chrome <path>` overrides the browser probe (`$CHROME`, Google Chrome, Chromium,
`/opt/pw-browsers/chromium`, `chromium`, `google-chrome`). The images are inlined as
data URIs, so the generated HTML is self-contained and can be written anywhere.

## Fields

| Placeholder | What goes in it |
|---|---|
| `{{name}}` | participant's name, printed on the rule under PRESENTED TO |
| `{{course}}` | course name **verbatim from the catalog** in `mast-backend/src/worker.js` (`SEED_CLASSES`) — e.g. `Handgun Fundamentals`, `Low-Light / No-Light NVG Operator P1` |
| `{{descriptor}}` | the gold line under the course, e.g. `HANDGUN · EIGHT HOURS` |
| `{{cert_no}}` | certificate number, see below |
| `{{date}}` | date of completion, long form, e.g. `September 20, 2026` |

Values are HTML-escaped by the builder. There are no other placeholders.

## Certificate number rule

```
cert_no = "No. <YYYY>-<suffix>"
```

`YYYY` is the four-digit year of the class date. `suffix` comes from the registration
id, and there are two forms:

- **integer id** → the id zero-padded to five digits — id `42`, 2026 → `No. 2026-00042`
- **text / uuid id** → the last six hex characters, uppercased — `reg_5c1f…9f2c1a`, 2026 → `No. 2026-9F2C1A`

**This schema is the text/uuid case.** `mast-backend/schema.sql` declares
`registrations.id TEXT PRIMARY KEY` holding `reg_<uuid>`, so live certificates use the
last-six-hex form. The integer branch exists for any future integer-keyed registration
table (id `42`, 2026 → `No. 2026-00042` shows that form).

## Print settings

Letter · **landscape** · margins **None** · **Background graphics ON**. The template
sets `@page { size: letter landscape; margin: 0 }` and forces
`print-color-adjust: exact`, so a PDF built by the script already carries the paper
tint, the gold and the vignette; the background-graphics checkbox only matters when
printing the HTML straight from a browser. The sheet is 11in × 8.5in with no printer
margin — print at 100%, not "fit to page", or the border insets shift.

Fonts are Cormorant Garamond and Inter from Google Fonts, falling back to Liberation
Serif / Liberation Sans, Georgia and system-ui. The source certificate embeds Cormorant
Garamond, so a build on a networked Mac (Chrome loads the Google Fonts) matches the
original; a build with no network renders on the Liberation fallbacks and reads slightly
heavier. Long values step down in size so they stay on their rule: the name at 34px to
24 characters, 28px to 34, 23px to 44, 19px to 56; the course at 26px to 30, 22px to
40, 18px to 52. Longer than that the builder exits 1 — lay it out by hand.

## Auto-build on payment (planned — not in this change)

The Worker already holds everything a certificate needs at the moment a registration is
paid: `registrations.id` (the number), `customer_name` (the name), `item_name` / `sku`
(the course, matching `SEED_CLASSES`) and `session_date` (the year and the date of
completion). The plan is a protected office-only endpoint that serves this template
filled for one paid registration, so the certificate is ready to print before class and
the instructor signs the INSTRUCTOR line by hand. The descriptor is the one field with
no column behind it — it wants a per-SKU lookup beside the catalog. None of that is
built here; this change is the template, the builder and the sample.
