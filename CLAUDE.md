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

## Atlas Glinn pages (decided by Brockmann 2026-09-03: "SAME front end", mobile first)

The rebuilt `index`, `executive-protection`, `residential-protection`, `disaster-recovery`,
`training`, `technology`, `cuas-aerodefense`, `uas`, `about`, `careers` and `contact` pages are
**generated** by `scripts/assemble-atlas.py` on the same cinematic shell as the MAST page
(`scripts/cinematic_shell.py`, ATLAS blue palette, site menu overlay). Edit the assembler and
re-run it; never hand-edit the output.

**Not published yet** (Brockmann, 2026-09-04: "let me review it before we publish"). The
assembler writes to `preview/` by default (noindex, assets via `../`, reachable at
`https://atlasglinn.com/preview/` once merged, unlinked from the site). The root-level pages
are still the previous hand-authored builds. When he approves, run
`python3 scripts/assemble-atlas.py --publish`, which overwrites the root pages; park the old
builds as `*-atlas.html` (noindex, canonical to the new page) in the same commit and delete
`preview/`. `ep-app.html`, `signup.html`, `privacy.html`, `terms.html` and the articles are
hand-authored. Rebuilt forms post JSON to the booking Worker's `POST /contact`.

**Imagery rule (Brockmann, 2026-09-04):** an Atlas page uses only what the current
atlasglinn.com page uses in that section (the approved list at the top of
`assemble-atlas.py`). No MAST range photos, nothing from `images/mast/` or `images/gallery/`;
`build()` asserts it. `scripts/compare-atlas.py` writes `preview/compare.html`, the
section-by-section "as is vs new" sheet he reviews from.

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
