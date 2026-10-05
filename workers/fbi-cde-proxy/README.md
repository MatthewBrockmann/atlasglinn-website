# fbi-cde-proxy

Cloudflare Worker that lets the Atlas EP app read FBI Crime Data Explorer state summaries without shipping the
api.data.gov key in the IPA. Spec: brain `02-projects/security-impact-fbi-cde-proxy-2026-10-05.md`.

## Request

```
GET https://fbi-cde-proxy.matthew-221.workers.dev/summarized/state/{ST}/{offense}?from=MM-YYYY&to=MM-YYYY
Authorization: Bearer <Firebase ID token, project safeguard-atlasglinn>
```

- `ST` two upper-case letters; `offense` lower-case letters and hyphens (`violent-crime`, `property-crime`).
- `from` / `to` optional, each at most once, `MM-YYYY`. Any other query parameter, including `API_KEY`, is a 404.
- The body is the upstream CDE JSON unchanged.

| Status | Meaning |
|---|---|
| 200 | upstream 200, cached 24h by the key-free URL (Cache API, per data centre) |
| 401 | token missing, malformed, wrong signature/alg/kid/iss/aud, expired, or no `sub` |
| 404 | anything but the one GET shape above |
| 502 | upstream non-200 or unreachable (upstream body never echoed) |
| 503 | `FBI_CDE_KEY` not set, or upstream 429 |

## Tests

```
node --test workers/fbi-cde-proxy/test/index.test.mjs
```

No dependencies. RSA keys are generated per run; the CDE key in the tests is a placeholder.

## Deploy

`.github/workflows/deploy-fbi-cde-proxy.yml` (not in this repo yet; workflow files need the owner's approval to land) on push to `main` under `workers/fbi-cde-proxy/**`, or by hand
(workflow_dispatch). It uses the same Cloudflare secrets as `deploy-worker.yml`, and pushes the Worker secret
`FBI_CDE_KEY` from the repository secret of the same name when that is set. Without it the Worker answers 503.
