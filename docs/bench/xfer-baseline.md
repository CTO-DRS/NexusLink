# Transfer baseline (v1, before P1)

Measured on 2026-11-23 with `node scripts/xfer-bench.mjs` against `next start`, on loopback.
Sandbox: arm64, 2 cores. 256MB random file, 3 runs, sha256 of the stored file matches the source.

| PUT size | median MB/s | min | max |
|---|---|---|---|
| 2MB (the phone's current default in `transfer_engine.dart`) | 93.2 | 87.6 | 93.8 |
| 4MB (server default) | 119.4 | 105.0 | 120.5 |
| 8MB (contract max) | 148.9 | 147.1 | 176.7 |

Reading: on loopback the cost is per request, not the disk, so bigger pieces win.
Over Wi-Fi the round-trip time is added to each sequential PUT. That is what v2 fixes,
with ~4 pieces in flight and a hash per piece. These numbers only measure server
overhead. The ≥90% of the link target needs the device lab (G10).
