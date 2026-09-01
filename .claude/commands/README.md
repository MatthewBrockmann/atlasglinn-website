# Slash commands — atlasglinn.com / MAST Solutions site

Project commands for working on this static site with Claude Code (Fable).
Type `/` in Claude Code to see them; each is a markdown prompt in this folder.

## Project commands (this folder)

| Command | What it does |
|---|---|
| `/site-audit` | Multi-agent workflow audit of every page: links, SEO, brand, accessibility, cross-page drift |
| `/new-page <name> <purpose>` | Scaffold a new page in the Atlas Glinn brand system (nav, footer, shimmer, cards, reveal) |
| `/seo-check [page]` | Title/meta/canonical/OG/h1/schema review, per page or site-wide |
| `/link-check [page]` | Verify every href/src resolves; flags Git LFS pointer files that break on GitHub Pages |
| `/brand-check [page]` | Enforce the color/font/pattern system; catch off-palette values and chrome drift |
| `/screenshot [page]` | Headless-Chromium desktop + mobile screenshots sent back to you |
| `/update-nav-footer <change>` | Propagate a nav/footer change identically across all pages |
| `/deploy-check` | Go/no-go pre-deploy checklist for GitHub Pages (CNAME, LFS, case sensitivity, mixed content) |
| `/new-testimonial <quote> — <name>` | Add a review card in the site's testimonial style |
| `/content-refresh <page> <topic>` | Deep-research a topic and draft verified replacement copy (applies only after your approval) |

## Built-in Fable commands (always available)

These ship with Claude Code — no files needed here:

| Command | What it does |
|---|---|
| `/workflows` | Watch live progress of multi-agent workflow runs |
| `/code-review [low–max]` | Review the current diff for bugs and cleanups; `--fix` applies findings |
| `/review <PR>` | Review a GitHub pull request |
| `/security-review` | Security review of pending changes on the branch |
| `/verify` | Exercise a change end-to-end and observe real behavior before committing |
| `/simplify` | Reuse/simplification/efficiency pass on changed code (quality, not bug-hunting) |
| `/deep-research <question>` | Fan-out web research with adversarial fact-checking and a cited report |
| `/dataviz` | Design-system guidance before building any chart or dashboard |
| `/run` | Launch the app/site to see a change working (here: serve + open the static site) |
| `/loop [interval] <prompt>` | Run a prompt or command on a recurring interval |
| `/init` | Generate a CLAUDE.md for the repo |
| `/fewer-permission-prompts` | Build an allowlist from your usage to cut permission prompts |
| `/update-config` | Configure settings.json — permissions, env vars, hooks |
| `/keybindings-help` | Customize keyboard shortcuts |
| `/claude-api` | Claude API / Anthropic SDK reference |
| `/session-start-hook` | Set up SessionStart hooks for Claude Code on the web |

## House rules baked into these commands

- Videos: YouTube embeds only — local `.mp4` files in `images/` are Git LFS pointers and GitHub Pages serves the pointer text, not the video.
- Brand: bg `#080C14`, blue `#1A6BDE`, gold `#C9A84C`; Orbitron / Rajdhani / Inconsolata.
- Nav + footer are duplicated per page — shared-chrome edits must touch every `*.html`.
- Outward-facing copy changes get a before/after diff and user approval first.
