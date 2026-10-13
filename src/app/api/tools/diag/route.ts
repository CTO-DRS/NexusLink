import { NextResponse } from "next/server"
import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import os from "node:os"

function dirSize(dir: string, depth = 0): number {
  if (depth > 6) return 0
  try {
    let total = 0
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      const st = statSync(p)
      if (st.isDirectory()) total += dirSize(p, depth + 1)
      else total += st.size
    }
    return total
  } catch {
    return 0
  }
}

async function probeService(port: number): Promise<"up" | "down"> {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 900)
    const r = await fetch(`http://127.0.0.1:${port}/socket.io/?EIO=4&transport=polling`, {
      signal: ctrl.signal,
      cache: "no-store",
    })
    clearTimeout(timer)
    return r.ok ? "up" : "down"
  } catch {
    return "down"
  }
}

// FA-harden (عقد §16 بند 5) — فحص كل منافذ Sidecar (العقد §1 حرفيًا):
// 3000 (النواة — نحن) + جسور socket.io (3003/3004/3005/3006/3007/3009) + البوابة 81.
// المنافذ socket.io تُفحص بـ handshake فعلي، والبوابة 81 بطلب HTTP حقيقي.
async function probeGateway(): Promise<"up" | "down"> {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 900)
    const r = await fetch("http://127.0.0.1:81/api/tools/ping", {
      signal: ctrl.signal,
      cache: "no-store",
    })
    clearTimeout(timer)
    return r.ok ? "up" : "down"
  } catch {
    return "down"
  }
}

// GET /api/tools/diag — server-side diagnostics snapshot
export async function GET() {
  const [comms, remote, media, guard, prod, sec, gateway] = await Promise.all([
    probeService(3003),
    probeService(3004),
    probeService(3005),
    probeService(3006),
    probeService(3007),
    probeService(3009),
    probeGateway(),
  ])
  const mem = process.memoryUsage()
  return NextResponse.json(
    {
      platform: `${os.type()} ${os.arch()}`,
      runtime: `Node ${process.version}`,
      uptimeSec: Math.round(process.uptime()),
      memory: {
        rssMB: Math.round(mem.rss / 1048576),
        heapUsedMB: Math.round(mem.heapUsed / 1048576),
        heapTotalMB: Math.round(mem.heapTotal / 1048576),
      },
      storageBytes: dirSize(join(process.cwd(), "data", "nexus-storage")),
      services: {
        commsBridge: comms,
        remoteBridge: remote,
        mediaBridge: media,
        guardBridge: guard,
        prodBridge: prod,
        secBridge: sec,
        gateway,
      },
      // قائمة مسطحة لواجهة التشخيص — كل منافذ العقد §1 مع حالتها
      ports: [
        { port: 3000, role: "core", ok: true }, // نحن — الطلب نفسه دليل الحياة
        { port: 3003, role: "comms", ok: comms === "up" },
        { port: 3004, role: "remote", ok: remote === "up" },
        { port: 3005, role: "media", ok: media === "up" },
        { port: 3006, role: "guard", ok: guard === "up" },
        { port: 3007, role: "prod", ok: prod === "up" },
        { port: 3009, role: "sec", ok: sec === "up" },
        { port: 81, role: "gateway", ok: gateway === "up" },
      ],
      cores: os.cpus().length,
      hostname: os.hostname(),
      t: Date.now(),
    },
    { headers: { "Cache-Control": "no-store" } },
  )
}
