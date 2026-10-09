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

// GET /api/tools/diag — server-side diagnostics snapshot
export async function GET() {
  const [comms, remote] = await Promise.all([probeService(3003), probeService(3004)])
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
      services: { commsBridge: comms, remoteBridge: remote },
      cores: os.cpus().length,
      hostname: os.hostname(),
      t: Date.now(),
    },
    { headers: { "Cache-Control": "no-store" } },
  )
}
