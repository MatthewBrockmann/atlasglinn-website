# Atlas Glinn Website

Static HTML site for atlasglinn.com (GitHub Pages — see `CNAME`). Pages are
hand-authored HTML files in the repo root with shared assets under `images/`.

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
