#!/usr/bin/env bash
# Mac autopilot for the MAST page (owner, 2026-09-05: "anytime I drop new items into the folder on my desktop, it should
# update in and add photos to the gallery"; later that day, leaving without a Terminal: "Do it yourself or figure out an
# easier way"). Installs two LaunchAgents on this Mac:
#
#   com.atlasglinn.handoff    watches  ~/Desktop/MAST NEW WEB 2026/gallery  and  …/range
#                             a new file there -> scripts/mac-handoff.sh pushes the two folders to branch claude/desktop-assets
#                             (web-sized JPEGs, a poster beside every clip). The cloud session's hourly check turns them into
#                             tiles (scripts/photo-intake.py), regenerates the page and opens a PR.
#   com.atlasglinn.wp-upload  every hour, from a private clone under ~/Library/Caches (never the iCloud-synced Desktop clone,
#                             which broke git on 2026-09-05): fetch main, deploy the Worker when mast-backend/ moved (the
#                             wrangler login on this Mac), then scripts/wp-upload.sh --if-changed puts the page on
#                             atlasglinn.com over the SFTP login saved in the Keychain (wp-upload.sh --save-login).
#
# The one hand left is the merge of a PR. Logs: ~/Library/Logs/atlasglinn-handoff.log, ~/Library/Logs/atlasglinn-wp-upload.log.
#
#   curl -fsSL https://raw.githubusercontent.com/MatthewBrockmann/atlasglinn-website/main/scripts/mac-autopilot.sh | bash -s -- install
#   bash ~/Library/Caches/atlasglinn/atlasglinn-website/scripts/mac-autopilot.sh status | kick | uninstall
# install works from a pasted curl (no clone needed: it makes the private clone itself) and can be re-run any time.
# Mac only: LaunchAgents, the Keychain and sips do not exist in a cloud container.
set -euo pipefail
say() { printf '\033[1;36m%s\033[0m\n' "$*"; }
[ "$(uname -s)" = "Darwin" ] || { echo "macOS only (LaunchAgents); run this on the Mac"; exit 1; }
CACHE="$HOME/Library/Caches/atlasglinn/atlasglinn-website"
REPO_URL="https://github.com/MatthewBrockmann/atlasglinn-website.git"
DROP="$HOME/Desktop/MAST NEW WEB 2026"
AGENTS="$HOME/Library/LaunchAgents"; LOGS="$HOME/Library/Logs"
H_LABEL="com.atlasglinn.handoff"; U_LABEL="com.atlasglinn.wp-upload"
H_PLIST="$AGENTS/$H_LABEL.plist"; U_PLIST="$AGENTS/$U_LABEL.plist"
UID_="$(id -u)"
export GIT_LFS_SKIP_SMUDGE=1   # the page's clips are plain blobs; LFS pointers in the tree stay pointers (no LFS bandwidth)

# The handoff agent keeps working from whichever clone it was installed with (the Desktop clone pushes the handoff branch
# fine); a fresh install without one uses the private clone.
handoff_repo() {
  local r=""
  [ -f "$H_PLIST" ] && r="$(sed -n 's/.*HANDOFF_REPO="\([^"]*\)".*/\1/p' "$H_PLIST" | head -1 || true)"
  [ -n "$r" ] && [ -d "$r/.git" ] && { echo "$r"; return; }
  r="$(find "$HOME/Desktop" -maxdepth 4 -type d -name atlasglinn-website 2>/dev/null | head -1 || true)"
  [ -n "$r" ] && [ -d "$r/.git" ] && { echo "$r"; return; }
  echo "$CACHE"
}
ensure_cache() {
  if [ ! -d "$CACHE/.git" ]; then
    say "Making the private clone at $CACHE (outside iCloud)"; mkdir -p "$(dirname "$CACHE")"
    git clone -q --single-branch -b main "$REPO_URL" "$CACHE"
  fi
  git -C "$CACHE" fetch -q origin main && git -C "$CACHE" reset -q --hard origin/main
}

plist_handoff() {
local R="$1"
cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$H_LABEL</string>
  <key>ProgramArguments</key><array>
    <string>/bin/bash</string><string>-c</string>
    <string>export PATH=/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin; export HANDOFF_ONLY=1 HANDOFF_REPO="$R"; exec /bin/bash "$R/scripts/mac-handoff.sh" "$DROP/gallery" "$DROP/range"</string>
  </array>
  <key>WatchPaths</key><array><string>$DROP/gallery</string><string>$DROP/range</string></array>
  <key>ThrottleInterval</key><integer>120</integer>
  <key>StandardOutPath</key><string>$LOGS/atlasglinn-handoff.log</string>
  <key>StandardErrorPath</key><string>$LOGS/atlasglinn-handoff.log</string>
</dict></plist>
EOF
}
plist_upload() {
cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$U_LABEL</string>
  <key>ProgramArguments</key><array>
    <string>/bin/bash</string><string>-c</string>
    <string>export PATH=/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin GIT_LFS_SKIP_SMUDGE=1 ATLAS_REPO="$CACHE"; cd "$CACHE" &amp;&amp; git fetch -q origin main &amp;&amp; git reset -q --hard origin/main; exec /bin/bash "$CACHE/scripts/wp-upload.sh" --if-changed</string>
  </array>
  <key>StartInterval</key><integer>3600</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$LOGS/atlasglinn-wp-upload.log</string>
  <key>StandardErrorPath</key><string>$LOGS/atlasglinn-wp-upload.log</string>
</dict></plist>
EOF
}
unload() { launchctl bootout "gui/$UID_/$1" >/dev/null 2>&1 || launchctl unload "$AGENTS/$1.plist" >/dev/null 2>&1 || true; }
load() { launchctl bootstrap "gui/$UID_" "$AGENTS/$1.plist" 2>/dev/null || launchctl load "$AGENTS/$1.plist"; }

case "${1:-}" in
  install)
    security find-generic-password -s mast-wp-sftp >/dev/null 2>&1 || { echo "save the SFTP login first: bash scripts/wp-upload.sh --save-login"; exit 1; }
    ensure_cache
    HR="$(handoff_repo)"
    mkdir -p "$DROP/gallery" "$DROP/range" "$AGENTS" "$LOGS"
    unload "$H_LABEL"; unload "$U_LABEL"
    plist_handoff "$HR" > "$H_PLIST"; plist_upload > "$U_PLIST"
    plutil -lint "$H_PLIST" "$U_PLIST" >/dev/null
    load "$H_LABEL"; load "$U_LABEL"
    say "Installed. The hourly job runs now from $CACHE: Worker deploy if mast-backend/ moved, then the page upload."
    say "Drop photographs or clips into:"
    say "   $DROP/gallery      -> the gallery under In Action"
    say "   $DROP/range        -> The Range chapter"
    say "Check in a few minutes with: bash $CACHE/scripts/mac-autopilot.sh status" ;;
  uninstall)
    unload "$H_LABEL"; unload "$U_LABEL"; rm -f "$H_PLIST" "$U_PLIST"; say "Removed both agents (the drop folders, the private clone and the logs stay)." ;;
  status)
    for l in "$H_LABEL" "$U_LABEL"; do
      if launchctl print "gui/$UID_/$l" >/dev/null 2>&1; then say "$l: loaded"; else say "$l: NOT loaded"; fi
    done
    for f in "$LOGS/atlasglinn-handoff.log" "$LOGS/atlasglinn-wp-upload.log"; do
      say "--- $(basename "$f") (last 10 lines) ---"; [ -f "$f" ] && tail -n 10 "$f" || echo "   (no run yet)"
    done
    say "last uploaded page:    $(cat "$HOME/.cache/wp-upload/last-uploaded" 2>/dev/null || echo none)"
    say "last Worker deploy:    $(cat "$HOME/.cache/wp-upload/last-worker-deploy" 2>/dev/null || echo none)"
    say "private clone:         $( [ -d "$CACHE/.git" ] && git -C "$CACHE" rev-parse --short HEAD 2>/dev/null || echo 'not made yet' )" ;;
  kick)
    launchctl kickstart -k "gui/$UID_/$H_LABEL" 2>/dev/null || launchctl start "$H_LABEL"
    launchctl kickstart -k "gui/$UID_/$U_LABEL" 2>/dev/null || launchctl start "$U_LABEL"
    say "Both started; give them a few minutes, then: bash $CACHE/scripts/mac-autopilot.sh status" ;;
  *) echo "usage: bash scripts/mac-autopilot.sh install | status | kick | uninstall"; exit 1 ;;
esac
