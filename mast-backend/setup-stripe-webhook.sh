#!/usr/bin/env bash
# One command, no copy-paste: create the Stripe webhook for the MAST booking
# backend and store its signing secret in the Worker.
#
#   cd mast-backend && bash setup-stripe-webhook.sh
#
# What it does:
#   1. asks for your Stripe secret key once (typed blind, never saved)
#   2. removes any earlier webhook endpoint that points at this Worker
#   3. creates the endpoint for checkout.session.completed
#   4. pipes the signing secret straight into `wrangler secret put`
# Safe to run again; it always leaves exactly one endpoint.
set -euo pipefail

WORKER_URL="https://mast-booking-backend.matthew-221.workers.dev/webhook"

printf 'Paste your Stripe SECRET key (starts sk_test_ for test mode), then press Enter.\nIt will not show on screen: '
read -rs SK; echo
if [[ "$SK" != sk_* ]]; then
  echo "That does not look like a Stripe secret key (they start with sk_). Nothing changed."; exit 1
fi

api() { curl -sS -u "$SK:" "$@"; }

# 1. Remove earlier endpoints for this Worker so there is exactly one.
existing=$(api "https://api.stripe.com/v1/webhook_endpoints?limit=100" | python3 -c '
import sys, json
d = json.load(sys.stdin)
if "error" in d:
    sys.stderr.write("Stripe error: " + d["error"].get("message", str(d["error"])) + "\n"); sys.exit(1)
print(" ".join(e["id"] for e in d.get("data", []) if e.get("url") == sys.argv[1]))' "$WORKER_URL")
for id in $existing; do
  api -X DELETE "https://api.stripe.com/v1/webhook_endpoints/$id" >/dev/null && echo "Removed earlier endpoint $id"
done

# 2. Create the endpoint and read the signing secret straight from Stripe's reply.
secret=$(api https://api.stripe.com/v1/webhook_endpoints \
  -d url="$WORKER_URL" \
  -d "enabled_events[]=checkout.session.completed" \
  -d description="MAST booking backend" | python3 -c '
import sys, json
d = json.load(sys.stdin)
if "error" in d:
    sys.stderr.write("Stripe error: " + d["error"].get("message", str(d["error"])) + "\n"); sys.exit(1)
print(d.get("secret", ""))')
if [[ "$secret" != whsec_* ]]; then
  echo "Stripe did not return a signing secret. Nothing stored."; exit 1
fi
echo "Endpoint created. Signing secret is ${#secret} characters long."

# 3. Store it in the Worker without it ever touching the clipboard.
printf '%s' "$secret" | npx wrangler secret put STRIPE_WEBHOOK_SECRET

mode="LIVE"; [[ "$SK" == sk_test_* ]] && mode="TEST"
unset SK secret
echo
echo "Done. Webhook wired in Stripe $mode mode, secret stored in the Worker."
echo "Next: book a seat on the preview with card 4242 4242 4242 4242."
