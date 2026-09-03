# /handoff — push files from this Mac to the repo for a cloud session

Cloud Claude sessions cannot see this Mac. This command runs `scripts/mac-handoff.sh`,
which copies files or folders into `reference/desktop/` on branch `claude/desktop-assets`
and pushes, so any session can read them from GitHub. Nothing goes through OneDrive.

## Usage

- `/handoff` — hands off the default set (the "MAST NEW WEB 2026" desktop folder and the
  Tier 3 / Landing 4D trailer HTML files).
- `/handoff ~/Desktop/some-folder ~/Downloads/clip.mov` — hands off those paths.

## What to do

1. Run from the repo root, passing through any arguments verbatim:

   ```
   bash scripts/mac-handoff.sh $ARGUMENTS
   ```

2. Report the `DONE:` line exactly as printed. If the script prints `FAILED:` or lists
   files as too big for GitHub, report that too. Do not retry blindly; the message says why.
3. Tell the cloud session (or Brockmann) that branch `claude/desktop-assets` is ready.

Videos over 90 MB are listed, not copied, because GitHub rejects files over 100 MB.
HEIC photos are converted to JPEG on the way.
