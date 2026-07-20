#!/usr/bin/env bash
# Bootstrap the vendored Claude SEO toolchain (.claude/skills/seo*) so it is
# fully runnable in this session — not just present on disk.
#
# Idempotent: safe to re-run. Invoked automatically by the SessionStart hook
# in .claude/settings.json (in the background); can also be run manually:
#   bash .claude/hooks/setup-seo.sh
#
# Log: .claude/hooks/setup-seo.log
set -uo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SEO_DIR="$(cd "${HOOK_DIR}/../skills/seo" && pwd)" || exit 0
VENV="${SEO_DIR}/.venv"

log() { echo "[setup-seo] $*"; }

# ── 1. Python venv with the skill's dependencies ─────────────────────────────
# pypi.org / files.pythonhosted.org are direct-allowed even in restricted
# Claude Code web sandboxes, so this works under any network policy.
if [ ! -x "${VENV}/bin/python" ]; then
    log "creating venv at ${VENV}"
    python3 -m venv "${VENV}" || { log "ERROR: venv creation failed"; exit 1; }
fi
if ! "${VENV}/bin/python" -c "import requests, bs4, trafilatura" 2>/dev/null; then
    log "installing Python dependencies (first run takes 1-3 min)"
    "${VENV}/bin/pip" install --quiet -r "${SEO_DIR}/requirements.txt" \
        && log "python deps OK" \
        || log "WARNING: pip install failed — run '${VENV}/bin/pip' install -r '${SEO_DIR}/requirements.txt' manually"
else
    log "python deps already present"
fi

# ── 2. Claude Code web sandbox: bridge the preinstalled Chromium ─────────────
# Remote containers preinstall Chromium under /opt/pw-browsers and block
# browser downloads at the egress proxy. Map whatever revision the venv's
# Playwright expects onto the preinstalled binaries.
if [ -d /opt/pw-browsers ] && [ -w /opt/pw-browsers ]; then
    PRE_CHROME="$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome 2>/dev/null | head -1)"
    PRE_SHELL="$(ls -d /opt/pw-browsers/chromium_headless_shell-*/chrome-linux/headless_shell 2>/dev/null | head -1)"
    if [ -n "${PRE_CHROME}" ] && [ -x "${VENV}/bin/python" ]; then
        "${VENV}/bin/python" -m playwright install --dry-run chromium 2>/dev/null \
        | grep -o '/opt/pw-browsers/chromium[a-z_-]*-[0-9]*' | sort -u | while read -r want; do
            [ -e "${want}" ] && continue
            case "${want}" in
                */chromium_headless_shell-*)
                    [ -n "${PRE_SHELL}" ] || continue
                    mkdir -p "${want}/chrome-headless-shell-linux64"
                    ln -sf "${PRE_SHELL}" "${want}/chrome-headless-shell-linux64/chrome-headless-shell" ;;
                */chromium-*)
                    mkdir -p "${want}/chrome-linux64"
                    ln -sf "${PRE_CHROME}" "${want}/chrome-linux64/chrome" ;;
            esac
            touch "${want}/INSTALLATION_COMPLETE"
            log "bridged $(basename "${want}") -> preinstalled browser"
        done
    fi
fi

# ── 3. Trust the sandbox egress-proxy CA in Chromium's NSS store ─────────────
# The web sandbox re-terminates TLS at a local proxy; Chromium reads user CAs
# from ~/.pki/nssdb only. Without this, every browser fetch fails with
# ERR_CERT_AUTHORITY_INVALID.
CA_BUNDLE="${CCR_CA_BUNDLE:-/root/.ccr/ca-bundle.crt}"
if [ "${CCR_AGENT_PROXY_ENABLED:-0}" = "1" ] && [ -f "${CA_BUNDLE}" ]; then
    if ! command -v certutil >/dev/null 2>&1; then
        apt-get update -q >/dev/null 2>&1; apt-get install -y -q libnss3-tools >/dev/null 2>&1 || true
    fi
    if command -v certutil >/dev/null 2>&1; then
        NSSDB="${HOME}/.pki/nssdb"
        mkdir -p "${NSSDB}"
        [ -f "${NSSDB}/cert9.db" ] || certutil -d "sql:${NSSDB}" -N --empty-password 2>/dev/null
        if ! certutil -d "sql:${NSSDB}" -L 2>/dev/null | grep -q '^agentproxy-0 '; then
            TMP="$(mktemp -d)"
            ( cd "${TMP}" && csplit -s -z -f ca- "${CA_BUNDLE}" '/-----BEGIN CERTIFICATE-----/' '{*}' 2>/dev/null
              i=0; for f in ca-*; do certutil -d "sql:${NSSDB}" -A -t "C,," -n "agentproxy-${i}" -i "${f}" 2>/dev/null; i=$((i+1)); done )
            rm -rf "${TMP}"
            log "imported egress-proxy CA bundle into NSS store"
        else
            log "egress-proxy CA already trusted"
        fi
    else
        log "WARNING: certutil unavailable — browser HTTPS via the sandbox proxy will fail cert validation"
    fi
fi

log "done"
