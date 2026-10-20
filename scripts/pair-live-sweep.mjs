// مسحة حية لقياس الاقتران — عبر البوابة 8180 حصرًا (المكدس الحقيقي)
// سلسلة كاملة: QR (بوابة) → pair (بوابة) → أول قيمة (3007 المدمج) → قراءة القياس (بوابة)
const GW = "http://127.0.0.1:8180"
const PROD = "http://localhost:3007"

const j = async (u, opts) => { const r = await fetch(u, opts); return { code: r.status, body: await r.json().catch(() => null) } }
const sleep = (ms) => new Promise((res) => setTimeout(res, ms))

async function main() {
  // (1) إصدار QR عبر البوابة — t0
  const qr = await j(`${GW}/api/devices/qr`)
  const secret = qr.body?.payload?.secret
  console.log(`[1] QR عبر البوابة: http=${qr.code} code=${qr.body?.code} secret=${secret ? "present" : "MISSING"}`)
  if (!secret) process.exit(1)

  // (2) pair عبر البوابة — t1
  const devId = `pair-sweep-${Date.now().toString(36)}`
  const pair = await j(`${GW}/api/devices`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "pair", name: "PAIR-SWEEP", kind: "phone", id: devId, secret }),
  })
  console.log(`[2] pair عبر البوابة: http=${pair.code} ok=${pair.body?.ok} id=${pair.body?.device?.id}`)
  if (pair.body?.ok !== true) process.exit(1)

  // (3) الإدخال المعلق عبر البوابة
  const pm1 = await j(`${GW}/api/pair-metrics`)
  const pend = (pm1.body?.entries ?? []).find((e) => e.deviceId === devId)
  console.log(`[3] إدخال معلق: qrToPair=${pend?.qrToPairMs}ms pending=${pend?.pairToFirstValueMs === null}`)

  // (4) أول قيمة: حافظة عبر 3007 المدمج — t2
  const { io } = await import("socket.io-client")
  const sock = io(PROD, { path: "/", transports: ["polling", "websocket"], forceNew: true, reconnection: false, timeout: 8000 })
  await new Promise((res, rej) => { sock.on("connect", res); sock.on("connect_error", (e) => rej(new Error(e.message))); setTimeout(() => rej(new Error("3007 timeout")), 10000) })
  sock.emit("clip:push", { deviceId: devId, deviceName: "PAIR-SWEEP", kind: "text", content: `sweep-${devId}`, mode: "manual" })
  let done = null
  for (let i = 0; i < 25 && !done; i++) {
    await sleep(200)
    const pm = await j(`${GW}/api/pair-metrics`)
    done = (pm.body?.entries ?? []).find((e) => e.deviceId === devId && e.pairToFirstValueMs !== null) ?? null
  }
  try { sock.disconnect() } catch {}
  console.log(`[4] أول قيمة عبر 3007 → الإدخال المكتمل: total=${done?.totalMs}ms (${done?.qrToPairMs}+${done?.pairToFirstValueMs}) kind=${done?.firstValueKind} pass=${done?.pass}`)

  // (5) الإحصاء النهائي عبر البوابة
  const pm2 = await j(`${GW}/api/pair-metrics`)
  const s = pm2.body?.stats ?? {}
  console.log(`[5] الإحصاء عبر البوابة: completed=${s.completed} last=${s.last}ms p95=${s.p95}ms max=${s.max}ms pass=${s.pass} target=${pm2.body?.targetMs}`)

  const ok = done && done.totalMs < 30000 && done.pass === true && s.completed >= 1
  console.log(ok ? "SWEEP PASS — السلسلة كاملة عبر البوابة والقياس صادق" : "SWEEP FAIL")
  process.exit(ok ? 0 : 1)
}
main().catch((e) => { console.error("sweep error:", e.message); process.exit(1) })
