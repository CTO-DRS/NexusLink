# Cloud Mode security review (2026-11-28)

Scope: `cloud/worker/index.mjs` (Cloudflare Worker + D1), the web `/api/cloud` proxy, and the app-side key handling. Method: code read-through plus the existing and new Worker tests (9 pass). No live attack traffic was sent.

| Area | Finding | Status |
|---|---|---|
| Owner auth | Bearer key of 32+ chars; only its SHA-256 is stored; compared in constant time. | OK |
| Key guessing | Keys are 40+ random chars, so brute force is not practical. Failed attempts are not rate limited, which is acceptable at this entropy. | OK |
| XSS in published pages | All text is HTML-escaped; link colors must match `#rrggbb`; theme is a fixed whitelist; photo is a validated data URL or https URL; CSP is `default-src 'none'` with only inline style/script and `connect-src 'self'`. | OK |
| Open redirect | `/go/<handle>/<id>` redirects only to URLs stored in the owner's page, which must be http or https. `javascript:` and similar are rejected at publish time. | OK |
| Lead capture abuse | Consent required; value must be a valid email or phone; 30 leads per handle per hour. | OK (added in #84) |
| Publish abuse | 60 publishes per handle per hour; 100 new pages per hour overall. Handle squatting is still possible within that cap. | Accepted risk |
| CSV injection | Cells starting with `= + - @` are neutralized (phone numbers excepted). | OK |
| Privacy | No IPs, user agents or cookies stored. Rate limits are keyed by handle. Events keep referrer host, country and hour only; 395-day retention. | OK |
| Owner data access | Stats, leads CSV and JSON export need the owner key; unauthenticated calls return 401. | OK |
| Key storage | Web keeps the key in localStorage, Android in app preferences. Both are local only. Copying a key to the clipboard is a user action and the key is never logged. | OK, note: clipboard is readable by other apps on older Android versions |
| Errors | The Worker returns generic errors; no stack traces. | OK |

Follow-ups, none blocking: move the Android key to encrypted storage; add a "rotate key" action (needs a Worker endpoint to replace the stored hash).
