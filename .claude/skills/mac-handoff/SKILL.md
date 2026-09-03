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

That hands off the default set: the desktop folder "MAST NEW WEB 2026", the Tier 3 /
Landing 4D trailer HTML files, the About-page hero video from the clone and the Atlas
Glinn home-page video from atlasglinn.com. To hand off more, pass paths or URLs; they
are added on top of the default set (`HANDOFF_ONLY=1` skips the defaults):

```
bash scripts/mac-handoff.sh ~/Desktop/some-folder ~/Downloads/clip.mov https://example.com/clip.mp4
```

If no clone exists yet, the script clones one to `~/atlasglinn-website` by itself.
The same script also runs without a clone from Terminal:

```
curl -fsSL https://raw.githubusercontent.com/MatthewBrockmann/atlasglinn-website/main/scripts/mac-handoff.sh | bash
```

## What it does

Finds or clones the repo, fetches, checks out the handoff branch in a throw-away worktree
(the working copy is never touched), copies each source in (folders keep their structure,
HEIC becomes JPEG, Git LFS pointers are replaced by the real file, URLs are downloaded on
the Mac, videos over 90 MB are compressed with the built-in `avconvert` to 720p or 480p
because GitHub rejects files over 100 MB, and only a video that still does not fit is
listed), commits, pushes, prints `DONE:`. Re-running only adds what is new.

## Report

Repeat the `DONE:` line verbatim, plus any `FAILED:` or "too big" lines. Then say that
branch `claude/desktop-assets` is ready for the cloud session. Do not paste file contents.

## Rule this enforces

Brockmann, 2026-09-03: one Terminal command, the only one from now on, and if Claude can
run it, Claude runs it. Cloud sessions ask for this script by name instead of inventing a
new paste. Mac sessions run it themselves instead of handing Brockmann a step.
