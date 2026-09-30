# MAST welcome series — branded HTML for Mailchimp flow 5839

Text approved by Brockmann 2026-09-30 ("Text approved"). One file per email, paste into each email's
"Code your own" block in the Mailchimp customer-journey builder (flow 5839 "MAST Welcome Sequence (full, 21 days)").

| File | Email | Sent |
|---|---|---|
| E1-mailchimp.html | Welcome to MAST — start here | on sign-up |
| E2-mailchimp.html | Which weekend? | day 2 |
| E3A/E3B/E3C-mailchimp.html | one email, three versions by INTEREST (A firearms · B CQB/hand/knife · C everything else) | day 4 |
| E4-mailchimp.html | What a MAST weekend feels like | day 7 |
| E5-mailchimp.html | Bring someone | day 12 |

E3: keep the live E3's conditional merge tags and put version A/B/C inside them.
Images load from www.mastsolutions.com (photos, already published by the Pages build) and the Atlas Glinn logo
from atlasglinn.com — the same files the live site uses. Merge tags: `*|FNAME|*`, `*|UNSUB|*`,
`*|UPDATE_PROFILE|*`, `*|LIST:ADDRESSLINE|*`.

Not deployed: nothing under `reference/` is staged by the Pages workflow.
