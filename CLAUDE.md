# Atlas Glinn Website

Static HTML site for atlasglinn.com (GitHub Pages — see `CNAME`). Pages are
hand-authored HTML files in the repo root with shared assets under `images/`.

## MAST Solutions page (decided by Brockmann 2026-09-03)

`mastsolutions.html` is the cinematic Tier 3 trailer design and it is **generated**:
edit `scripts/assemble-cinematic.py` and run `python3 scripts/assemble-cinematic.py`.
Never hand-edit the HTML; the next run overwrites it. The assembler lifts the booking
stack (catalog, calendar, checkout, quals modal, media strip) from
`mastsolutions-tesla.html`, so booking changes go there first. `mastsolutions-atlas.html`
is the earlier Atlas-frame build, kept noindex just in case; `mastsolutions-cinematic.html`
is a redirect stub for the preview links that were shared.

**Gear chapter (Brockmann, 2026-09-05: "Atlasglinn.com has this product = add to mastsolutions so we can sell there"):** the
Aimpoint optics and IWA International devices from his IWA inventory report are listed in `GEAR` in `mastsolutions-tesla.html`
and lifted into chapter 12 of the MAST page. They are **quote requests through the existing Request dialog** (`request_type:
'gear'` to the Worker's `/contact`), never a Stripe checkout: card networks bar weapons accessories and energetic devices from
ordinary checkout and a listing there would put the class bookings' Stripe account at risk, and IWA devices are law enforcement /
military / licensed-agency only (the dialog requires the agency; the office verifies before quoting). The report's costs are
dealer costs, not prices; no price is shown until he gives retail. Add products to `GEAR`; the `.gear-card` hover is the shared
one in `cinematic_shell.py`.

## Atlas Glinn pages (decided by Brockmann 2026-09-03: "SAME front end", mobile first)

The rebuilt `index`, `executive-protection`, `residential-protection`, `disaster-recovery`,
`training`, `technology`, `cuas-aerodefense`, `uas`, `about`, `careers` and `contact` pages are
**generated** by `scripts/assemble-atlas.py` on the same cinematic shell as the MAST page
(`scripts/cinematic_shell.py`, ATLAS blue palette, site menu overlay). Edit the assembler and
re-run it; never hand-edit the output.

**Published 2026-09-05** (Brockmann: "Publish AG preview", after the review links). The eleven pages are now the root-level
files, written by `python3 scripts/assemble-atlas.py --publish` (the default, preview mode, still writes `preview/` if anyone
needs a look without touching the live set; `preview/` is not committed any more). The previous hand-authored builds are
parked as `*-atlas.html` (noindex, canonical to the new page). `LIVE_LINKS` is False: cards and menu go to the new pages.
The pages reach atlasglinn.com through `scripts/wp-upload.sh` (its `PAGES` default carries them) by the Mac's hourly job
or the page workflow; the WordPress pages at the old permalinks (`/about/` …) still exist on the host until he retires them
in WordPress, and whether `index.html` wins over WordPress at `/` is a host setting to confirm on the first upload.
**Copy source (Brockmann, 2026-09-05: "why the content from the actual site and this new site front end are not
matching"):** the rebuild was written from the repo's April 2026 build (now `*-atlas.html`), the only copy a cloud
session can open; it carries that copy nearly word for word (204 of 208 headings, 223 of 235 paragraphs), but the big
chapter titles are the trailer shell's own and the site's headings became the small labels. No cloud session has read
the live WordPress text. Same day, `.github/workflows/capture-live.yml` (a GitHub runner has open internet; the
container does not) reads every page and file URL in `scripts/handoff-urls.txt` and commits them to
`claude/desktop-assets` under `reference/desktop/live/` (pages as `<slug>.html`, files by basename, a `_probe.txt` with
what the host serves at `/`, `/index.html` …), on request (`workflow_dispatch`) and daily; the Mac's handoff writes the
same place. The reconcile against the live copy is done (203 of 204 live headings, 224 of 230 paragraphs; the rest
are the intro menu text, a Senators figure he corrected, and "over 30 years" → decades). The live site's own assets
now count as approved imagery: `images/atlas/matt-ceo-2026.jpg` (the founder portrait the live About page shows),
`images/atlas/anthony-glover.png`, and the theme-folder films in `images/film/` (technology-hero, corporate-buildings,
careers-gallery, forge-legend-mast; plain files, not LFS, served whole because the container has no ffmpeg). The live
Training submenu (IWA Training Products, Aimpoint Optics) points at the MAST Gear chapter; the live shop pages are
notify-me catalogs with no checkout. Re-run the capture before any further content pass: `actions_run_trigger`
on `capture-live.yml`, then `git fetch origin claude/desktop-assets` and read `reference/desktop/live/`.
`ep-app.html`, `signup.html`, `privacy.html`, `terms.html` and the articles are hand-authored. Rebuilt forms post JSON to
the booking Worker's `POST /contact`.

**Imagery rule (Brockmann, 2026-09-04):** an Atlas page uses only what the current
atlasglinn.com page uses in that section (the approved list at the top of
`assemble-atlas.py`). No MAST range photos, nothing from `images/mast/` or `images/gallery/`;
`build()` asserts it. The files are the site's own WordPress uploads, kept under `images/atlas/` by their WordPress names
(handed off from the Mac 2026-09-05). The About portrait is `images/team/brockmann.jpg`, the picture he approved on the
MAST Instructors chapter: the WordPress file named after him is a press-line scene ("This is not my picture from
atlasglinn.com", 2026-09-05), kept only as a backdrop. `scripts/compare-atlas.py` writes `preview/compare.html`, the
section-by-section "as is vs new" sheet he reviews from.

## Privacy statement rule (Brockmann, 2026-09-03; repeated 2026-09-05)

`privacy.html` is his text, confirmed 2026-09-03 and carried on both sites. It **never names infrastructure, hosting,
analytics or security tooling** (no Cloudflare, Workers, D1, Supabase, PostHog, GitHub Pages, GoDaddy, no "how we stop
brute force"): "this is an invite to be hacked". Providers that receive a customer's data (payments, email, the app's
SMS) stay named in §8 and §12.3 as he confirmed them. On 2026-09-03 he ordered the security-posture paragraph, the
hosting-logs paragraph, the traffic-analytics bullet and the campaign-tags bullet **deleted**; the 2026-09-04 session
misread the last two as additions and put them back, and he had to say it again. Do not add tooling to the policy
without his words; when he pastes policy text with "Delete" in front, everything in the paste goes, and only the items
he marks as new (the AI section, "We do not run background checks") get added.

## Site consistency rule (Brockmann, 2026-09-04)

"For any card or any function on the site itself, when adding another product or membership, we don't lose the
consistency in the site." Concretely: every card on either site takes the shared hover in `scripts/cinematic_shell.py`
(the `.tile, .tier` rules: 0.45 s transition, 6 px lift) — add a new card class to those two selectors rather than writing
a new hover; a card's own rules set only its colours (membership borders carry the team colour). New chapters take the
shell's `panel` / `eyebrow` / `section-h` / `sub` structure and the chapter nav, HUD and backdrop entries in the assembler;
new booking or checkout pieces go into `mastsolutions-tesla.html` first, so the MAST page lifts them. Gold on the MAST page
lives in `GOLD_KEEP` (spliced after the palette recolor); everything else recolors to blue.

## Claude SEO toolchain (vendored)

This repo carries the [Claude SEO](https://github.com/AgriciDaniel/claude-seo)
plugin (v2.2.0, MIT) as project-scope skills so every session — local or
Claude Code on the web — loads it automatically:

- `.claude/skills/` — 31 skills (`seo` orchestrator + 30 sub-skills/extensions)
- `.claude/agents/` — 18 SEO specialist subagents
- `.claude/hooks/setup-seo.sh` — SessionStart bootstrap (venv, browser bridge,
  sandbox-proxy CA trust). Runs in the background on session start; log at
  `.claude/hooks/setup-seo.log`. Re-run manually if needed.

Usage: `/seo audit <url>`, `/seo page <url>`, `/seo technical <url>`, etc. —
full command table in `.claude/skills/seo/SKILL.md`.

Run the Python helpers with the venv interpreter:
`.claude/skills/seo/.venv/bin/python .claude/skills/seo/scripts/<script>.py`
If the venv is missing, run `bash .claude/hooks/setup-seo.sh` first — do not
fall back to system python without the dependencies.

### Local modification

`.claude/skills/seo/scripts/url_safety.py` is patched relative to upstream:
its SSRF guard exempts the hostnames named in `HTTP(S)_PROXY`/`ALL_PROXY` env
vars (see `_trusted_proxy_hosts`). Claude Code web sandboxes force all egress
through a loopback proxy, which the unpatched guard refused, breaking every
fetch. Keep this patch when updating the vendored copy.

### Connector / extension status

| Connector | Status | To finish |
|---|---|---|
| Core skills + agents | ✅ working | — |
| Page fetch / render / screenshot (Playwright) | ✅ working | — |
| Unlighthouse (site-wide Lighthouse, free) | ✅ working | — |
| Google APIs (GSC, PageSpeed, CrUX, GA4, Indexing) | ⏳ needs credentials | Run `/seo google setup` and provide OAuth client / service account / API key; stored at `~/.config/claude-seo/google-api.json` |
| Backlinks free tier (Moz, Bing Webmaster) | ⏳ needs API keys | Run `/seo backlinks setup`; stored at `~/.config/claude-seo/backlinks-api.json` |
| DataForSEO (live SERP/keyword data) | ⏳ needs login | `bash extensions/dataforseo/install.sh` from a claude-seo checkout, with DataForSEO email + password |
| Firecrawl (site crawling MCP) | ⏳ needs API key | `bash extensions/firecrawl/install.sh` with Firecrawl API key |
| Banana / image-gen (Gemini) | ⏳ needs API key | `bash extensions/banana/install.sh` with `GOOGLE_AI_API_KEY` |
| Ahrefs / SE Ranking / Profound / Bing extensions | ⏳ needs API keys | Each `extensions/<name>/install.sh` prompts for its vendor key |

⏳ items are blocked ONLY on secrets the user must supply — never invent or
stub credentials, and never mark them done until the vendor API answers a
real request.

### Claude Code web sandbox caveat

Restricted-network environments allowlist only dev infrastructure (GitHub,
npm, PyPI…). Fetching arbitrary sites — including atlasglinn.com — is blocked
at the egress proxy, so live crawls/audits need a session whose environment
network policy allows general web access. The toolchain itself still loads,
and its test suite runs offline.

## Mac → cloud handoff (the only Terminal command)

Cloud sessions run in a container and cannot see Brockmann's Mac; Cowork and a
Terminal `claude` session can. Files cross that line with **one script and one
command, never OneDrive**: `scripts/mac-handoff.sh` copies files/folders into
`reference/desktop/` on branch `claude/desktop-assets` and pushes them.

- Brockmann, from Terminal (always the same paste):
  `curl -fsSL https://raw.githubusercontent.com/MatthewBrockmann/atlasglinn-website/main/scripts/mac-handoff.sh | bash`
  (append `-s -- <paths or URLs>` to hand off more, on top of the default set;
  videos over 90 MB are compressed on the Mac to fit GitHub, LFS pointers are
  replaced by the real file)
- A Mac session (Cowork / Claude Code CLI): run it itself via `/handoff` or the
  `mac-handoff` skill. Do not hand Brockmann a step the session can run.
- A cloud session: never invent a new paste. Ask for `mac-handoff.sh` by name,
  then `git fetch origin claude/desktop-assets` and read the files from that ref
  (a fetch never touches the working tree): `git ls-tree -r --name-only
  origin/claude/desktop-assets -- reference/desktop` to list, `git show
  origin/claude/desktop-assets:reference/desktop/<file> > <copy>` to read one.
  Never merge the archive branch into a site branch.

Decided by Brockmann 2026-09-03. Mirrored to the brain vault as
`04-resources/agent-memory/reference_mac_handoff_command.md`. Address him as
**Brockmann** in replies.

## Hosting facts (Brockmann, 2026-09-05: "They are sep - i just forwarded atlas from mast - no site")

- **atlasglinn.com** is the GoDaddy Managed WordPress site (SFTP host `1127220.us12.ssh.myftpupload.com`). The MAST page is
  served from it at `atlasglinn.com/mastsolutions.html`; `scripts/wp-upload.sh` puts the page and its 113 assets there over
  SFTP. The login it asks for is **the atlasglinn.com site's** SFTP username and password (GoDaddy → My Products → Managed
  WordPress → Manage → Settings → Production Site → SFTP/SSH). Nobody but Brockmann can read them; they never pass through
  chat or git. He saves them once on the Mac with `bash scripts/wp-upload.sh --save-login` (macOS Keychain item
  `mast-wp-sftp`); after that the upload never asks. The GoDaddy connector in cloud sessions only checks domain
  availability; it cannot reach hosting.
  **Without the Mac (added 2026-09-05, "I won't be able to use terminal commands on the road"):** two GitHub Actions turn a
  merge into a deploy once their repository secrets exist. `.github/workflows/deploy-page.yml` uploads the MAST page and its
  assets over SFTP on every push to main that touches them (secrets `WP_SFTP_USER`, `WP_SFTP_PASSWORD`, the same pair as the
  Keychain item); `.github/workflows/deploy-worker.yml` runs the Worker tests and `wrangler deploy` (secrets
  `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) and pushes any `WORKER_<NAME>` repository secret to the Worker, so a key
  can be rotated from a phone. Without the secrets both jobs stop with a notice; the Mac's hourly upload stays the fallback.
- **mastsolutions.com** has no site: it is a GoDaddy domain forward to atlasglinn.com, pointed at
  `https://atlasglinn.com/mastsolutions.html` (set 2026-09-05). It still carries DNS: Resend verifies it so the Worker can send as
  bookings@mastsolutions.com, beside the existing matthew@mastsolutions.com mail.
- An earlier session put HTML straight into WordPress (`wp-content/themes/atlasglinn/ep-trailer.html`) from a Mac session
  with the WordPress admin. A cloud session cannot: the container has no route to atlasglinn.com and holds no credentials.
  The static page + Worker + SFTP path replaced `mast-wp-theme/`.

## Drop folders → gallery (Brockmann, 2026-09-05: "anytime I drop new items into the folder on my desktop, it should update in and add photos to the gallery")

- **Mac:** `~/Desktop/MAST NEW WEB 2026/gallery/` and `…/range/` are the drop folders. `scripts/mac-autopilot.sh install`
  (paste: `curl -fsSL https://raw.githubusercontent.com/MatthewBrockmann/atlasglinn-website/main/scripts/mac-autopilot.sh |
  bash -s -- install`, after `wp-upload.sh --save-login`) puts two LaunchAgents on the Mac. **The hourly job runs from a
  private clone at `~/Library/Caches/atlasglinn/atlasglinn-website`, never from the Desktop clone:** the Desktop is
  iCloud-synced and iCloud evicts git objects ("mmap failed: Resource deadlock avoided", "bad object", 2026-09-05), which
  is why the first install never uploaded. `wp-upload.sh` falls back to that private clone on its own whenever the clone it
  was given cannot fetch. The agents: a watcher that hands the two
  folders off to `claude/desktop-assets` on every change (`mac-handoff.sh` web-sizes photographs to 2000 px JPEG and makes a
  poster beside every clip), and an hourly `wp-upload.sh --if-changed` that uploads the page whenever main moved and, first, runs `wrangler deploy`
  from the clone whenever `mast-backend/` moved (added 2026-09-05, "Do it yourself or figure out an easier way": with the
  Mac on, a merge becomes a running Worker and page within the hour, no paste; the LaunchAgent pulls main and runs the
  script from the clone, so script changes reach it on their own).
  `status` shows loaded state and logs; `kick` runs both now. Mac-local by physics: a cloud session cannot install, see or
  confirm them ("wired, NOT confirmed firing" until a drop is seen to land).
- **Cloud (the hourly check-in):** `python3 scripts/photo-intake.py` imports what is new on the handoff ref into
  `images/mast/gallery/` (gNN) or `images/mast/range/` (aNN), appends to `images/mast/<kind>/tiles.txt` and records the
  source in `intake.json`; then `python3 scripts/assemble-cinematic.py`, commit, PR. The assembler reads the two `tiles.txt`
  files; a person reorders or removes tiles by editing them. The merge of that PR is the one hand left.

## Reply format (Brockmann, 2026-09-05: "always bring back to bottom_ wire")

Every reply ends with a **WIRE** block: the exact `YOU RUN THIS` commands that turn what is merged into what is running
(Worker migration/secret/deploy, the page upload), followed by the open questions carried forward. Reorder or shorten the
text above it; never drop the block. Every review link carries a fresh `?v=<sha>` (he has reviewed stale cached builds).

## Memory Rules

### Installation completeness (Matthew, 2026-07-18)

Any new download or install must be driven to a fully working state in the
same session — never left pending or half-configured:

1. **Installed** — all files in place, dependencies resolved.
2. **Loaded** — skills/agents/tools verifiably discovered by the harness
   (check the skills list; don't assume).
3. **Run** — exercised end-to-end at least once (test suite and/or a real
   smoke run) with output verified.
4. **Nothing silently pending** — any step that genuinely cannot be completed
   (missing user secret, environment/network-policy limit) must be surfaced
   explicitly with the exact command or action that finishes it, both in the
   final report and in this file's status tables.

## ATLAS — the one agent (added 2026-08-07)

Brockmann speaks to **ONE** agent: **ATLAS**. Everything else is a worker ATLAS
dispatches. He should never have to name a sub-agent, pick a model, or remind a
session to read the rules.

**ATLAS is defined in the `brain` repo, not here.** That repo is the source of
truth and this file is a pointer, deliberately — duplicating the definitions
across repos is how they drift, which is the failure class the brain vault exists
to kill.

| What | Where (in `MatthewBrockmann/brain`) |
|---|---|
| Entry point / doctrine | `.claude/skills/atlas/SKILL.md` |
| Worker fleet (7 agents) | `.claude/agents/atlas-*.md` |
| Locked rules, re-injected every turn | `00-rules/prime-directives.md` |
| Cloud-readable memory (442 files) | `04-resources/agent-memory/` |
| Merged-vs-running dashboard | `04-resources/Deployment-Status.md` |
| Current work queue | `04-resources/ATLAS-session-plan-2026-08-07.md` |

**Model split** (Brockmann, 2026-08-07): main loop = **Fable 5** or **Opus 5**.
Workers are routed by task with the model passed **explicitly** on every call,
never inherited — **Sonnet** for `atlas-scout` (recon) and `atlas-scribe`
(record-keeping); **Opus** for `atlas-architect`, `atlas-builder`, `atlas-ops`,
`atlas-verifier`, and `atlas-security`. The security tier is **never** downgraded.
The point is rate of return: cheap models absorb the mechanical volume so the
expensive ones are spent on judgment.

**Rules that bind sessions in this repo too:**
- **Never claim a Mac-only action from a cloud session.** Hooks, LaunchAgents, the
  local RAG and the canonical memory store are Mac-local by physics.
- **No live credentials anywhere git can see** — `[Keychain <name>]` references only.
  A real-looking secret in a tracked file is a bug to report, never to use.
- **Say who acts.** Label every command block `ALREADY RUN BY CLAUDE — do not paste`
  or `YOU RUN THIS — copy-paste into Terminal`. An unlabelled block is the violation.
- **Wired ≠ firing.** An automation is done only when it is wired, fired-observed
  with an artifact seen, has a heartbeat, has every referenced path verified to
  exist, and has its "why" captured. Until then say "wired, NOT confirmed firing."
- **Deploy-or-don't-declare-done.** Merged is not running. Say which one it is.

⚠️ **Known open item on this site:** `AtlasGlinn_WireGuard_Page.html` (in the
AtlasEP repo) advertises "military-grade WireGuard VPN tunnels" and no WireGuard
implementation exists in any repo — no config, no `.conf`, no `wg0`. Either it is
hosted entirely outside git or the claim is unsupported. Resolve before any SEO or
content work amplifies that page.
