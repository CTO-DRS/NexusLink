# Nexus Link Cloud Mode (optional) — design

Status: design only. Nothing here ships until the hosted component exists and the owner approves its accounts.

## Principle
Nexus Link stays a local device hub. Cloud Mode is a separate, explicit opt-in. It is OFF by default and the app makes zero cloud requests while it is off. The README and release page promise ("no cloud, no account, no telemetry") stay true for everyone who does not turn it on, and Cloud Mode is described next to that promise as an optional extra, not a replacement.

## What Cloud Mode adds (hosted link-in-bio page)
- A public page at `https://<handle>.<host>/` built from the developer card data (photo, name, role, the 8 accounts, banners).
- Analytics: clicks per link, traffic source (referrer), country, peak hours. No raw IPs stored, no cross-site cookies, no fingerprinting. Country comes from the edge's coarse geo header and the IP is dropped at the edge.
- Visitor capture: an optional "leave your email/number" form with CSV export. Disabled by default, per page.
- Scheduled links (startsAt/endsAt), themes and animated backgrounds, shared with the local card via the same data files.
- Custom domain: the page is served from the host's custom-hostname feature. The domain purchase and renewal are the owner's cost.
- Payment buttons and digital products: deferred. Needs a merchant account at a payment provider (owner's decision).

## Architecture (what is new)
1. Hosted component (new, not in this repo's runtime): a small edge service.
   - Recommended: Cloudflare Workers + D1 (SQLite) + Pages, which has a free tier that covers a personal page. Alternative: Supabase (Postgres + edge functions).
   - Endpoints: `GET /:handle` (render page), `POST /e` (event beacon: click/view), `POST /lead` (visitor capture), `GET /api/stats` and `GET /api/leads.csv` (owner only, bearer token).
2. Client (this repo): Settings gets a "Cloud Mode" card.
   - Switch off by default; stored locally. No network code is reachable while it is off.
   - Enabling shows a disclosure dialog that must be accepted: it states that page visitors' visit data (page views, clicks, referrer, country, time) is sent to and stored on the hosted service, that visitor-submitted emails/numbers are stored there if the form is enabled, and that the owner is responsible for a privacy notice on the page.
   - Publishing pushes the card data (JSON) to the hosted service with an owner token. Disabling deletes the hosted page and data on request.
3. Data: events table (ts, link_id, referrer_host, country, hour), leads table (ts, value), pages table (handle, json, token_hash). Retention default 13 months, owner-configurable.

## Privacy and legal
- Disclosure text is shown in the app and on the page footer ("visits are counted").
- Visitor capture needs an explicit consent line on the form and a deletion path.
- Owner must add a privacy notice for the page (KSA PDPL and EU GDPR if EU visitors).

## What fits this codebase vs. what is new
- Fits now: opt-in switch + disclosure UI, page-data export (the card JSON already exists), scheduled links, themes, vCard.
- New hosted component: page rendering, event ingestion, stats API, lead storage and CSV export, custom hostnames.
- Needs owner decisions: hosting account (free tier), custom domain cost, payment provider account.
