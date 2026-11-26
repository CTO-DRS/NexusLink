# NexusLink — Device QA checklist (v0.1.x)

Run on a real Android phone (8+) and at least one desktop OS. Record pass/fail and the build number. Automated E2E covers protocol and API; this list covers what CI cannot: real radios, real screens, real OS dialogs.

## 0. Install
- [ ] Desktop installer runs; first launch shows an empty hub (no demo devices) and "link your first device".
- [ ] Android APK (arm64) installs; app id `com.nexuslink.mobile`; no cloud permission prompts.
- [ ] Signature check: `apksigner verify --print-certs` SHA-256 = `E2:0E:D5:53:...:3B:80`.

## 1. Pairing and discovery
- [ ] QR pairing from the phone works on the same Wi-Fi; pairing token is carried by the QR.
- [ ] Emoji SAS code matches on both sides.
- [ ] Phone rediscovers the PC after the PC's IP changes (UDP beacon).
- [ ] Gateway rejects a LAN request without the pair token (401).

## 2. Clipboard
- [ ] Copy on phone -> paste on PC and back, under 1 s.
- [ ] Sensitive text (OTP, card number) is masked in the history list.

## 3. File transfer
- [ ] 1 GB file phone -> PC and PC -> phone; speed noted (Mbit/s) and compared to the link rate.
- [ ] Kill Wi-Fi mid-transfer, reconnect: transfer resumes, SHA-256 matches.

## 4. Screen mirroring and control
- [ ] Mirror starts, shows live phone screen; measure latency (target p95 <= 35 ms, current baseline not measured).
- [ ] Touch/click control works after enabling the Accessibility service; disabling it stops control.
- [ ] Rotation, screen off/on, lock screen behaviour noted.

## 5. Notifications / media / camera
- [ ] Phone notifications mirror to the PC (after granting notification access).
- [ ] Media control, virtual camera, photo sync.

## 6. Updater
- [ ] Desktop "check for updates" against `latest.json` verifies the new minisign key (publish a v0.1.1 draft test build first).

## 7. Safety
- [ ] Remote wipe / lost mode flows show the honest UI and require confirmation.
- [ ] Revoke a paired device from the PC; the phone is cut off immediately.
