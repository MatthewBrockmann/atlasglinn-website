---
name: mac-handoff
description: Push files or folders from Brockmann's Mac into the atlasglinn-website repo so a cloud Claude session can read them. Use when Brockmann says "hand off", "send these to the cloud session", "get this folder to Claude", "push the desktop folder", or when a cloud session reports it cannot reach a file on the Mac. Runs only on the Mac (Cowork or a Terminal claude session), never in a cloud container.
---

# Mac handoff

Cloud Claude sessions (Claude Code on the web) run in a container and cannot see this Mac.
Cowork and a Terminal `claude` session can. This skill closes that gap with one script and
no OneDrive: files land in `reference/desktop/` on branch `claude/desktop-assets` of
`MatthewBrockmann/atlasglinn-website`, where any session reads them from GitHub.

## Run it

From the repo root (any clone of atlasglinn-website on the Mac):

```
bash scripts/mac-handoff.sh
```

That hands off the default set: the desktop folder "MAST NEW WEB 2026" and the Tier 3 /
Landing 4D trailer HTML files. To hand off other things, pass paths:

```
bash scripts/mac-handoff.sh ~/Desktop/some-folder ~/Downloads/clip.mov
```

If no clone exists yet, the script clones one to `~/atlasglinn-website` by itself.
The same script also runs without a clone from Terminal:

```
curl -fsSL https://raw.githubusercontent.com/MatthewBrockmann/atlasglinn-website/main/scripts/mac-handoff.sh | bash
```

## What it does

Finds or clones the repo, fetches, checks out the handoff branch in a throw-away worktree
(the working copy is never touched), copies each source in (folders keep their structure,
HEIC becomes JPEG, videos over 90 MB are listed instead of copied because GitHub rejects
files over 100 MB), commits, pushes, prints `DONE:`. Re-running only adds what is new.

## Report

Repeat the `DONE:` line verbatim, plus any `FAILED:` or "too big" lines. Then say that
branch `claude/desktop-assets` is ready for the cloud session. Do not paste file contents.

## Rule this enforces

Brockmann, 2026-09-03: one Terminal command, the only one from now on, and if Claude can
run it, Claude runs it. Cloud sessions ask for this script by name instead of inventing a
new paste. Mac sessions run it themselves instead of handing Brockmann a step.
