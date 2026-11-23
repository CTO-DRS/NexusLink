// NexusLink: P1 discovery beacon (docs/ROADMAP-2027.md, P1 / reconnection)
// ============================================================
// Problem: the phone remembers the PC by IP:port. When DHCP gives the PC a new
// address, the link breaks until the QR is scanned again. mDNS (bonsoir) helps,
// but it does not get through on many routers, hotspots and guest networks.
//
// Fix: a small UDP announcement carrying a stable PC identity (pcId) that does
// not change with the IP. The phone matches the pcId it paired with and
// reconnects to the new address on its own.
//
// Security: the beacon is public by nature, so it carries only whitelisted
// fields: { proto, v, pcId, name, port }. Never the pairing token or its
// fingerprint, and nothing about policy. Knowing the pcId opens nothing,
// because the gateway still demands the token for any non-loopback client (G1).
//
// Transport (zero dependencies, node dgram only):
//   · Broadcast to 255.255.255.255:<port> and multicast to 239.255.77.77:<port>,
//     every BEACON_INTERVAL_MS.
//   · Unicast reply to a probe { proto, v, probe: true } on the same port, for
//     networks that block broadcast (the phone probes the subnet, or an
//     address it remembers).
//   · Off with NEXUSLINK_BEACON=0. Silent while LAN access is closed
//     (isEnabled() false).
"use strict"
const dgram = require("dgram")
const fs = require("fs")
const os = require("os")
const pathMod = require("path")
const crypto = require("crypto")

const PROTO = "nexuslink-beacon"
const VERSION = 1
const DEFAULT_PORT = 41234
const MCAST_ADDR = "239.255.77.77"
const MAX_NAME = 64

/** Stable PC identity: random, persisted, independent of the IP and of the token. */
function loadOrCreatePcId(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8"))
    if (j && typeof j.pcId === "string" && /^[a-f0-9]{32}$/.test(j.pcId)) return j.pcId
  } catch {}
  const pcId = crypto.randomBytes(16).toString("hex")
  try {
    fs.mkdirSync(pathMod.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify({ pcId, createdAt: new Date().toISOString() }), { mode: 0o600 })
  } catch {}
  return pcId
}

/** The only payload that ever goes out on the network. Whitelisted fields, nothing else. */
function buildPayload({ pcId, name, port }) {
  const clean = String(name || "").replace(/[\u0000-\u001f]/g, "").slice(0, MAX_NAME)
  return Buffer.from(JSON.stringify({ proto: PROTO, v: VERSION, pcId: String(pcId), name: clean, port: Number(port) || 0 }))
}

function isProbe(buf) {
  if (buf.length > 512) return false
  try {
    const j = JSON.parse(buf.toString("utf8"))
    return j && j.proto === PROTO && j.probe === true
  } catch {
    return false
  }
}

/**
 * startBeacon({ pcId, getPort, isEnabled, name?, port?, intervalMs?, log? }) → { stop(), port }
 * getPort(): the actual gateway port (BOUND_PORT, after any fallback).
 * isEnabled(): false = silence (LAN access closed or disabled on purpose).
 */
function startBeacon(opts) {
  if (process.env.NEXUSLINK_BEACON === "0") return { stop() {}, port: 0, disabled: true }
  const port = Number(opts.port || process.env.NEXUSLINK_BEACON_PORT || DEFAULT_PORT)
  const intervalMs = Number(opts.intervalMs || process.env.NEXUSLINK_BEACON_INTERVAL_MS || 2000)
  const name = opts.name || os.hostname()
  const isEnabled = opts.isEnabled || (() => true)
  const log = opts.log || (() => {})
  const payload = () => buildPayload({ pcId: opts.pcId, name, port: opts.getPort() })

  const sock = dgram.createSocket({ type: "udp4", reuseAddr: true })
  let timer = null
  let stopped = false

  sock.on("error", (e) => {
    log(`[beacon] error: ${e.code || e.message}`)
  })
  sock.on("message", (msg, rinfo) => {
    if (stopped || !isEnabled() || !isProbe(msg)) return
    sock.send(payload(), rinfo.port, rinfo.address, () => {})
  })
  sock.bind(port, () => {
    try { sock.setBroadcast(true) } catch {}
    try { sock.setMulticastTTL(1) } catch {}
    try { sock.addMembership(MCAST_ADDR) } catch {}
    const tick = () => {
      if (stopped || !isEnabled()) return
      const p = payload()
      sock.send(p, port, "255.255.255.255", () => {})
      sock.send(p, port, MCAST_ADDR, () => {})
    }
    tick()
    timer = setInterval(tick, intervalMs)
    if (timer.unref) timer.unref()
    log(`[beacon] UDP :${port} (broadcast + ${MCAST_ADDR})`)
  })

  return {
    port,
    stop() {
      stopped = true
      if (timer) clearInterval(timer)
      try { sock.close() } catch {}
    },
  }
}

module.exports = { startBeacon, loadOrCreatePcId, buildPayload, PROTO, VERSION, DEFAULT_PORT, MCAST_ADDR }
