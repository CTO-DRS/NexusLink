import { NextResponse } from "next/server"

// ping endpoint — client measures RTT via Date.now() delta
export async function GET() {
  return NextResponse.json(
    { pong: true, t: Date.now() },
    { headers: { "Cache-Control": "no-store" } },
  )
}
