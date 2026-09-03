# /handoff — push files from this Mac to the repo for a cloud session

Cloud Claude sessions cannot see this Mac. This command runs `scripts/mac-handoff.sh`,
which copies files or folders into `reference/desktop/` on branch `claude/desktop-assets`
and pushes, so any session can read them from GitHub. Nothing goes through OneDrive.

## Usage

- `/handoff` — hands off the default set (the "MAST NEW WEB 2026" desktop folder, the
  Tier 3 / Landing 4D trailer HTML files, the About-page hero video from the clone and
  the Atlas Glinn home-page video from atlasglinn.com).
- `/handoff ~/Desktop/some-folder ~/Downloads/clip.mov https://example.com/clip.mp4` —
  hands off those paths or URLs in addition to the default set.

## What to do

1. Run from the repo root, passing through any arguments verbatim:

   ```
   bash scripts/mac-handoff.sh $ARGUMENTS
   ```

2. Report the `DONE:` line exactly as printed. If the script prints `FAILED:` or lists
   files as too big for GitHub, report that too. Do not retry blindly; the message says why.
3. Tell the cloud session (or Brockmann) that branch `claude/desktop-assets` is ready.

Videos over 90 MB are compressed with the Mac's built-in `avconvert` (720p, then 480p)
because GitHub rejects files over 100 MB; only a video that still does not fit is
listed. HEIC photos become JPEG, and Git LFS pointers are replaced by the real file
with `git lfs pull` on the way. Re-running only adds what is new.
