#!/usr/bin/env node
/**
 * MEASURE ONE THING: what HTTP status Stripe answers when a Checkout Session carries `automatic_tax[enabled]=true` and
 * Stripe Tax is NOT active on the account, and whether that answer carries an `error` object.
 *
 * WHY IT EXISTS. `isStripeRefusal` in src/worker.js retries the tax-off body only on a 400 or 402 that carries a Stripe
 * error object. Everything else — a 5xx, a timeout, a transport failure — is not an answer about the body and goes to
 * the ordinary error path, which answers the customer 502. That narrowing is correct if and only if a genuine tax
 * refusal really is a 400 or a 402. It has never been measured: `api.stripe.com` answers `CONNECT tunnel failed,
 * response 403` from the build container every session of this work has run in, so the premise is UNVERIFIABLE THERE.
 * Widening it blind would re-open the path a wrong guess costs a customer their checkout, so it is measured instead.
 *
 * THIS IS A MEASUREMENT, SO IT EXITS ON THE ANSWER: 0 when the status is 400 or 402 (the premise holds and nothing in
 * the Worker changes), non-zero otherwise — and the non-zero case is the finding: widen isStripeRefusal to the observed
 * status and pin it with a test.
 *
 *   export STRIPE_SECRET_KEY=<the Stripe TEST key>     # env only. This file reads no key file and holds no literal.
 *   node mast-backend/scripts/probe-tax-refusal.mjs
 *
 * TEST KEYS ONLY, and it refuses to run otherwise. A Checkout Session on a live account is a real object on a real
 * account, and this is not the script to find out what that costs. The account must have Stripe Tax INACTIVE, which is
 * the condition being measured — against an account that IS collecting, the Session succeeds and the probe says so.
 *
 * Nothing is printed that could be a secret: the status, the error type/code/param, and whether an error object was
 * present. Not the message, which is free text Stripe may quote a request body back into.
 */

const ENDPOINT = 'https://api.stripe.com/v1/checkout/sessions';

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error('STRIPE_SECRET_KEY is not set. Export the Stripe TEST key into the environment and run this again; this script reads no file and has no default.');
  process.exit(2);
}
if (!/^(sk|rk)_test_/.test(key)) {
  console.error('STRIPE_SECRET_KEY is not a test key. This probe creates a Checkout Session, so it runs against the TEST account only.');
  process.exit(2);
}

// The smallest Session that can be refused for a tax reason: one inline price, automatic_tax on, and a customer with no
// address at all — no Texas, no anything — so the refusal that comes back is about the ACCOUNT, which is the question.
const body = new URLSearchParams({
  mode: 'payment',
  customer_email: 'tax-refusal-probe@example.com',
  'line_items[0][price_data][currency]': 'usd',
  'line_items[0][price_data][product_data][name]': 'Stripe Tax refusal probe',
  'line_items[0][price_data][unit_amount]': '100',
  'line_items[0][quantity]': '1',
  'automatic_tax[enabled]': 'true',
  success_url: 'https://example.com/probe-success',
  cancel_url: 'https://example.com/probe-cancel',
});

const res = await fetch(ENDPOINT, {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/x-www-form-urlencoded' },
  body: body.toString(),
});

let data = null, parsed = true;
try { data = await res.json(); } catch { parsed = false; }
const err = (data && data.error) || null;

console.log('http_status      ' + res.status);
console.log('body_parsed      ' + parsed);
console.log('error_object     ' + (err ? 'present' : 'absent'));
console.log('error.type       ' + ((err && err.type) || '—'));
console.log('error.code       ' + ((err && err.code) || '—'));
console.log('error.param      ' + ((err && err.param) || '—'));

if (res.ok) {
  console.log('\nThe Session was CREATED, so Stripe Tax is ACTIVE on this account. This probe measures the refusal, so it needs an account with Tax inactive — turn it off on the test account, or use one that has never been set up, and run it again.');
  process.exit(3);
}
if (res.status === 400 || res.status === 402) {
  console.log('\nisStripeRefusal is correct as written: a tax refusal is a ' + res.status + ' with an error object, which is exactly what src/worker.js retries the tax-off body on. Nothing to change.');
  process.exit(0);
}
console.log('\nFINDING: a genuine tax refusal is HTTP ' + res.status + ', which isStripeRefusal does NOT match — so this checkout answers the customer 502 instead of completing untaxed. Widen isStripeRefusal in mast-backend/src/worker.js to include ' + res.status + (err ? ' (an error object IS present, so the object test still holds)' : ' (NO error object, so that half of the test has to be reconsidered too)') + ', and pin it with a test.');
process.exit(1);
