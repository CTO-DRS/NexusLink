# NexusLink — Roadmap to a Complete, World-Class Product

> Written 2026-11-27 at the owner's direction: draw the roadmap, then execute it autonomously, milestone by milestone.
> Standing docs stay in force: `docs/ROADMAP.md` (contracts and gates), `docs/ROADMAP-2027.md` (measured gaps), `docs/MASTER-PLAN.md`, `docs/design/CLOUD-MODE.md`.
> Product principles: local-first (no cloud, no accounts, no telemetry by default) · Cloud Mode explicit opt-in with disclosure · Arabic-first RTL with 6 languages (ar · en · fr · es · de · ru) · dark-mode aware · every UI change ships with screenshots · every claim proven by CI or a real device.

---

## Where we stand (v0.1.0 line, versions restarted)

**Done and merged**
- Desktop hub (Windows · macOS · Linux) + Android agent: pairing over LAN, E2E encryption, clipboard, file transfer, screen/input, media, routines, SDK + CLI.
- Developer card system on web and Android: accounts with QR sheets, share link/image, vCard save, scheduled banners, card themes, version + update check.
- Cloud Mode, opt-in and off by default: Cloudflare Worker + D1 live (`nexuslink-cloud.nexus-link.workers.dev`), web publish card with disclosure, stats view, lead CSV export; owner page `cto-drs` live with lead capture verified.
- Android Cloud Mode card: publish from the phone, 30-day stats, lead CSV export.
- Quality: CI gate (lint, tsc, build, e2e i18n guard, Android analyze + build), secret scanning, Dependabot.

**Known gaps**
- No real-device QA on Android since the Cloud Mode work (no SDK/emulator here; CI only).
- Android developer card has no themes yet (web has them).
- NFC writing unimplemented (needs hardware).
- Payment buttons deferred (needs a merchant account — owner's decision).
- App-side ownership reset / sharing of a published handle is missing (web publish owns `cto-drs`).
- No release yet on the v0.1.x line.

---

## Phase 1 — Polish and prove what exists (now)

1. Web polish: stats auto-refresh, empty states, error and loading states, mobile layout pass. Screenshots for every change.
2. Android developer card themes, matching the web set. CI analyze + build; screenshots from an emulator if one becomes available, otherwise mark for device QA.
3. First release on the new line: **v0.1.0** with release notes and artifacts. (Release publish waits for the owner's go-ahead each time.)
4. Device-QA checklist run on a real phone (owner): Cloud Mode publish flow, lead capture, sharing, QR, themes. Findings become issues.

## Phase 2 — Complete Cloud Mode

1. App-side ownership: reset/reclaim a handle from the Android app with the ownership token; share read-only stats.
2. Custom domain for published pages (e.g. `nexus.cto-drs.com` or the owner's pick). Cost is the owner's — escalate before buying.
3. Payment buttons on published pages. Blocked on a merchant account — owner's decision; flagged, not started.
4. Rate limiting and abuse controls on the Worker; backup/export of D1 data.

## Phase 3 — NFC and reach

1. NFC writing from Android (write the published URL to a tag). Needs physical tags and a device — owner QA.
2. Landing page refresh with the current feature set, fresh screenshots and the walkthrough video.
3. Store presence: Google Play listing (paid developer account — owner's decision).

## Phase 4 — World-class bar

1. Performance and battery measurements on real devices, published honestly.
2. Accessibility pass (TalkBack, contrast, focus order) across web and Android.
3. Localization quality review of all 6 languages by native-level review.
4. Security review of the Cloud Mode path (token handling, Worker auth, D1 access).

---

## Standing execution rules

- Branch from fresh `origin/main`; PR; squash-merge only when CI is green; verify the merge through the API.
- Every UI string in all 6 languages; screenshots (light + dark where relevant) committed under `docs/screenshots/`.
- Anything costing money, needing paid accounts/certificates, or changing product direction goes back to the owner first.
- Tags and releases are never deleted; versions continue on the v0.1.x line.

---

## Progress log

| Date | Item | Status |
|---|---|---|
| 2026-11-27 | Roadmap written (#81) | Done |
| 2026-11-27 | Phase 1.1 Web polish: Cloud stats auto-refresh, refresh button, loading/error/empty states (#82) | Done |
| 2026-11-28 | Phase 1.2 Android developer card themes (#83) | Done (device QA pending) |
| 2026-11-28 | Phase 2.4 Worker rate limits (per handle, no IP) + owner JSON export, deployed (#84) | Done |
| 2026-11-28 | Phase 2.1 Copy/reuse page key across web and Android (#85) | Done (Android device QA pending) |
| 2026-11-28 | Phase 4.2 Accessibility pass on the developer card (#86) | Done (web); Android TalkBack pass pending |

**Waiting on the owner or hardware:** v0.1.0 release publish go-ahead, custom domain (cost), payment buttons (merchant account), NFC writing (hardware), Google Play listing (paid account), device-QA run on a real phone.
**Next, not blocked:** landing page refresh, Cloud Mode security review, localization review.
