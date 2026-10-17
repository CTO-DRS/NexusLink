// اختبار مسار socket.io عبر بوابة 81 مقابل :3000 مباشرة (تشخيص dev)
import { io } from "socket.io-client"

function probe(name, url) {
  return new Promise((resolve) => {
    const s = io(url, { transports: ["websocket", "polling"], timeout: 6000, reconnection: false })
    const done = (ok) => { try { s.close() } catch {} ; console.log(`${name}: ${ok ? "CONNECTED" : "FAIL"}`); resolve(ok) }
    s.on("connect", () => done(true))
    s.on("connect_error", () => done(false))
    setTimeout(() => done(false), 7000)
  })
}

const a = await probe("3000/?XTransformPort=3006", "http://127.0.0.1:3000/?XTransformPort=3006")
const b = await probe("81/?XTransformPort=3006", "http://127.0.0.1:81/?XTransformPort=3006")
const c = await probe("direct 3006", "http://127.0.0.1:3006")
process.exit(0)
