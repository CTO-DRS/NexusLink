// NexusLink — device registry with simulated live state + heartbeat.
import type { NexusDevice } from "./types"

interface Store {
  devices: NexusDevice[]
  pairingSecret: string | null
  pairingIssuedAt: number
}

const g = globalThis as unknown as { __nexusStore?: Store }

function seed(): Store {
  return {
    devices: [
      {
        id: "pc-office", name: "PC-OFFICE", kind: "desktop", state: "connected",
        mode: "wifi", ip: "192.168.1.2", battery: 100, storageTotal: 512 * 1024 ** 3,
        storageUsed: 231 * 1024 ** 3, lastSeen: Date.now(), rttMs: 3,
        pairedAt: Date.now() - 90 * 864e5, trusted: true,
      },
      {
        id: "galaxy-s24", name: "Galaxy-S24", kind: "phone", state: "connected",
        mode: "wifi", ip: "192.168.1.14", battery: 78, storageTotal: 256 * 1024 ** 3,
        storageUsed: 88 * 1024 ** 3, lastSeen: Date.now(), rttMs: 11,
        pairedAt: Date.now() - 12 * 864e5, trusted: true,
      },
      {
        id: "ipad-pro", name: "iPad-Pro", kind: "tablet", state: "offline",
        mode: "wifi", ip: "192.168.1.21", battery: 45, storageTotal: 128 * 1024 ** 3,
        storageUsed: 61 * 1024 ** 3, lastSeen: Date.now() - 36e5, rttMs: 24,
        pairedAt: Date.now() - 30 * 864e5, trusted: true,
      },
      {
        id: "redmi-note13", name: "Redmi-Note13", kind: "phone", state: "offline",
        mode: "hotspot", ip: "192.168.43.7", battery: 92, storageTotal: 128 * 1024 ** 3,
        storageUsed: 103 * 1024 ** 3, lastSeen: Date.now() - 72e5, rttMs: 40,
        pairedAt: Date.now() - 60 * 864e5, trusted: true,
      },
    ],
    pairingSecret: null,
    pairingIssuedAt: 0,
  }
}

export function store(): Store {
  if (!g.__nexusStore) g.__nexusStore = seed()
  return g.__nexusStore
}

export function heartbeatBump() {
  for (const d of store().devices) {
    if (d.state === "connected") {
      d.lastSeen = Date.now()
      // small realistic jitter around a base rtt
      const base = d.kind === "desktop" ? 3 : d.kind === "phone" ? 11 : 22
      d.rttMs = Math.max(2, Math.round(base + (Math.random() * 6 - 3)))
      d.battery = Math.max(5, d.battery - (Math.random() < 0.15 ? 1 : 0))
    }
  }
}
