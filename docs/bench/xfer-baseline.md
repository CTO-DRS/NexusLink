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

## v2 (§8.6): 4 pieces at once + SHA-256 per piece, same machine (2026-11-23)

Standalone build, loopback, 256MB, 3 runs, file integrity ok. v1 was re-measured in the same session for a fair comparison.

| Piece | v1 sequential | v2 ×4 | gain |
|---|---|---|---|
| 2MB | 77.5 | 112.7 | +45% |
| 4MB | 104.2 | 120.9 | +16% |
| 8MB | — | 153.3 | |

v2 is faster on loopback even though it computes a hash for every piece. The bigger difference is expected
over Wi-Fi, because v1 waits one round trip per piece and v2 hides it. The real number is still waiting on the device lab.
