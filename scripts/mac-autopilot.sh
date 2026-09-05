#!/usr/bin/env bash
# Mac autopilot for the MAST page (owner, 2026-09-05: "anytime I drop new items into the folder on my desktop, it should
# update in and add photos to the gallery"). Installs two LaunchAgents on this Mac:
#
#   com.atlasglinn.handoff    watches  ~/Desktop/MAST NEW WEB 2026/gallery  and  …/range
#                             a new file there -> scripts/mac-handoff.sh pushes the two folders to branch claude/desktop-assets
#                             (web-sized JPEGs, a poster beside every clip). The cloud session's hourly check turns them into
#                             tiles (scripts/photo-intake.py), regenerates the page and opens a PR.
#   com.atlasglinn.wp-upload  every hour -> scripts/wp-upload.sh --if-changed: when main moved since the last upload, puts the
#                             page on atlasglinn.com over the SFTP login saved in the Keychain (wp-upload.sh --save-login),
#                             and first deploys the Worker when mast-backend/ moved (wrangler login on this Mac; added 2026-09-05).
#
# The one hand left is the merge of that PR. Logs: ~/Library/Logs/atlasglinn-handoff.log, ~/Library/Logs/atlasglinn-wp-upload.log.
#
#   bash scripts/mac-autopilot.sh install     # write both agents and start them (re-run after moving the clone)
#   bash scripts/mac-autopilot.sh status      # loaded? last log lines?
#   bash scripts/mac-autopilot.sh kick        # run both once now (the "fired, artifact seen" check)
#   bash scripts/mac-autopilot.sh uninstall   # stop and remove both
# Mac only: LaunchAgents, the Keychain and sips do not exist in a cloud container.
set -euo pipefail
say() { printf '\033[1;36m%s\033[0m\n' "$*"; }
[ "$(uname -s)" = "Darwin" ] || { echo "macOS only (LaunchAgents); run this on the Mac"; exit 1; }
R="$(cd "$(dirname "$0")/.." && pwd)"
DROP="$HOME/Desktop/MAST NEW WEB 2026"
AGENTS="$HOME/Library/LaunchAgents"; LOGS="$HOME/Library/Logs"
H_LABEL="com.atlasglinn.handoff"; U_LABEL="com.atlasglinn.wp-upload"
H_PLIST="$AGENTS/$H_LABEL.plist"; U_PLIST="$AGENTS/$U_LABEL.plist"
UID_="$(id -u)"

plist_handoff() {
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
    <string>export PATH=/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin; cd "$R" &amp;&amp; git pull -q --ff-only origin main; exec /bin/bash "$R/scripts/wp-upload.sh" --if-changed</string>
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
    git -C "$R" remote get-url origin 2>/dev/null | grep -q atlasglinn-website || { echo "run this from the atlasglinn-website clone (scripts/mac-autopilot.sh)"; exit 1; }
    security find-generic-password -s mast-wp-sftp >/dev/null 2>&1 || { echo "save the SFTP login first: bash scripts/wp-upload.sh --save-login"; exit 1; }
    mkdir -p "$DROP/gallery" "$DROP/range" "$AGENTS" "$LOGS"
    unload "$H_LABEL"; unload "$U_LABEL"
    plist_handoff > "$H_PLIST"; plist_upload > "$U_PLIST"
    plutil -lint "$H_PLIST" "$U_PLIST" >/dev/null
    load "$H_LABEL"; load "$U_LABEL"
    say "Installed. Drop photographs or clips into:"
    say "   $DROP/gallery      -> the gallery under In Action"
    say "   $DROP/range        -> The Range chapter"
    say "Within about two minutes they are on the handoff branch; the cloud session tiles them and opens a PR; after the merge"
    say "the hourly upload puts the page live. Check with: bash scripts/mac-autopilot.sh status"
    say "Wired, NOT yet confirmed firing: drop one photograph into $DROP/gallery and run: bash scripts/mac-autopilot.sh status" ;;
  uninstall)
    unload "$H_LABEL"; unload "$U_LABEL"; rm -f "$H_PLIST" "$U_PLIST"; say "Removed both agents (the drop folders and logs stay)." ;;
  status)
    for l in "$H_LABEL" "$U_LABEL"; do
      if launchctl print "gui/$UID_/$l" >/dev/null 2>&1; then say "$l: loaded"; else say "$l: NOT loaded"; fi
    done
    for f in "$LOGS/atlasglinn-handoff.log" "$LOGS/atlasglinn-wp-upload.log"; do
      say "--- $(basename "$f") (last 8 lines) ---"; [ -f "$f" ] && tail -n 8 "$f" || echo "   (no run yet)"
    done
    say "stamp of the last uploaded page: $(cat "$HOME/.cache/wp-upload/last-uploaded" 2>/dev/null || echo none)" ;;
  kick)
    launchctl kickstart -k "gui/$UID_/$H_LABEL" 2>/dev/null || launchctl start "$H_LABEL"
    launchctl kickstart -k "gui/$UID_/$U_LABEL" 2>/dev/null || launchctl start "$U_LABEL"
    say "Both started; give them a minute, then: bash scripts/mac-autopilot.sh status" ;;
  *) echo "usage: bash scripts/mac-autopilot.sh install | status | kick | uninstall"; exit 1 ;;
esac
