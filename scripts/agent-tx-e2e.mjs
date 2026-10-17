// NexusLink — E2E لمرحلة نقل الملفات (محاكاة الوكيل الحقيقي بروتوكول السيرفر الحرفي)
// يُشغَّل: node scripts/agent-tx-e2e.mjs   (السيرفر حي على :3000)
//
// يغطي اختبار النجاح المطلوب حرفيًا:
//  1) رفع 2GB هاتف → سيرفر مع "قتل" في المنتصف → استئناف من نفس الإزاحة → hash مطابق
//  2) إرسال 2GB من الويب → عرض tx:offer على القناة الدائمة → قبول → تنزيل Range
//     مع "قتل" في المنتصف → استئناف (206) → hash مطابق → مهمة done لدى السيرفر
//  3) إيقاف/إلغاء من الكمبيوتر يصل الهاتف عبر tx:pause/tx:cancel
//  4) نصوص/روابط سريعة عبر 3007 (clip:new / hand:new)
import { createHash } from "node:crypto"
import { createReadStream, createWriteStream, promises as fs } from "node:fs"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import http from "node:http"
import { io } from "socket.io-client"

const BASE = "http://localhost:3000"
const DEVICE_ID = "e2e-tx-agent"
const DEVICE_NAME = "E2E-TX-Phone"
const SIZE = 2 * 1024 * 1024 * 1024 // 2GB
const CHUNK = 4 * 1024 * 1024 // 4MB
const SRC_TMP = "/tmp/e2e-src-2gb.bin"
const DL_TMP = "/tmp/e2e-dl-2gb.nexuspart"
const SERVER_UP = "/home/z/my-project/data/nexus-storage/agents/e2e-tx-agent/Downloads/e2e-2gb.bin"
const SERVER_DL_SRC = "/home/z/my-project/data/nexus-storage/pc-fs/Documents/e2e-2gb.bin"
const PCFS_ROOT = "/home/z/my-project/data/nexus-storage/pc-fs"

const results = []
function check(name, cond, detail = "") {
  results.push({ name, ok: !!cond, detail })
  console.log(`${cond ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`)
}

const sha256Zeros = (() => {
  // hash معروف مسبقًا لمحتوى أصفار بحجم SIZE (نحسبه تزايديًا بسرعة)
  const h = createHash("sha256")
  const buf = Buffer.alloc(8 * 1024 * 1024)
  for (let left = SIZE; left > 0; left -= buf.length) {
    h.update(left >= buf.length ? buf : buf.subarray(0, left))
  }
  return h.digest("hex")
})()

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
  })
  const text = await res.text()
  try { return { status: res.status, json: JSON.parse(text) } } catch { return { status: res.status, json: {} } }
}

function putChunk(uploadId, offset, readStream) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${BASE}/api/fs/upload?upload=${uploadId}&offset=${offset}`, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
    }, (res) => {
      let body = ""
      res.on("data", (c) => (body += c))
      res.on("end", () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(body) }) }
        catch { resolve({ status: res.statusCode, json: {} }) }
      })
    })
    req.on("error", reject)
    readStream.pipe(req)
    readStream.on("error", reject)
  })
}

function hashFile(path) {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256")
    createReadStream(path).on("data", (c) => h.update(c)).on("end", () => resolve(h.digest("hex"))).on("error", reject)
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  // الجسور تقوم بالإقلاع عند الطلب — تأكد أنها حية قبل الاتصال
  await api("/api/guard/boot")
  await api("/api/prod/boot")
  await sleep(300)

  console.log(`\n=== NexusLink Transfer E2E — ${SIZE / 1024 ** 3}GB عبر localhost ===`)
  console.log(`الـ hash المتوقع لمحتوى الأصفار: ${sha256Zeros.slice(0, 16)}…\n`)

  // ---------------------------------------------------------------- ربط
  // G-1 (عقد §6): جلب سر الاقتران من آخر رمز QR مُصدَر قبل التسجيل
  const qr = await api("/api/devices/qr")
  const pair = await api("/api/devices", {
    method: "POST",
    body: JSON.stringify({
      action: "pair", id: DEVICE_ID, name: DEVICE_NAME, kind: "phone",
      model: "E2E Simulator", battery: 88, storageTotal: 128 * 1024 ** 3,
      storageUsed: 40 * 1024 ** 3, ip: "192.168.1.77",
      secret: qr.json?.payload?.secret,
    }),
  })
  check("تسجيل الجهاز (pair) idempotent — بسر QR صحيح (G-1)", pair.json?.ok === true && pair.json?.device?.id === DEVICE_ID)

  // قناة الحماية الدائمة — نفس نمط الخدمة الخلفية
  const guard = io("http://localhost:3006", { transports: ["websocket", "polling"] })
  const offers = []
  const txCmds = []
  guard.on("tx:offer", (d) => offers.push(d))
  guard.on("tx:pause", (d) => txCmds.push({ ev: "tx:pause", ...d }))
  guard.on("tx:cancel", (d) => txCmds.push({ ev: "tx:cancel", ...d }))
  await new Promise((r) => guard.on("connect", r))
  guard.emit("guard:hello-phone", { name: DEVICE_NAME, deviceId: DEVICE_ID })
  await sleep(400)
  check("القناة الدائمة 3006 حية + hello-phone بمعرّف الجهاز", guard.connected)

  // ================================================================ 1) الرفع
  console.log("\n--- 1) رفع 2GB هاتف → سيرفر مع قطع واستئناف ---")
  {
    // مصدر sparse (أصفار) — حجم منطقي 2GB دون استهلاك قرص
    const fh = await fs.open(SRC_TMP, "w")
    await fh.truncate(SIZE)
    await fh.close()

    const TASK_ID = "t_e2e_up_resume"
    let init = (await api("/api/fs/upload", {
      method: "POST",
      body: JSON.stringify({
        op: "init", deviceId: DEVICE_ID, path: "/Downloads", name: "e2e-2gb.bin",
        size: SIZE, mime: "application/octet-stream", localPath: "(هاتف) /DCIM/e2e-2gb.bin",
        chunkSize: CHUNK, taskId: TASK_ID,
      }),
    })).json
    check("upload init يعيد uploadId/jobId", init?.ok === true && !!init.uploadId && !!init.jobId)
    check("upload init يبدأ من صفر (بلا جزئي سابق)", init.received === 0)

    // رفع حتى ~40% ثم "قتل" التطبيق (إسقاط الجلسة)
    const killAt = Math.floor(SIZE * 0.4 / CHUNK) * CHUNK
    let received = 0
    let uploadStart = Date.now()
    let bytes400 = 0
    while (received < killAt) {
      const stream = createReadStream(SRC_TMP, { start: received, end: received + CHUNK - 1 })
      const r = await putChunk(init.uploadId, received, stream)
      if (r.json?.ok !== true) { check("PUT قطعة أثناء أول جولة", false, JSON.stringify(r.json)); break }
      received = r.json.received
      bytes400 += CHUNK
    }
    const upMbps = bytes400 / 1024 / 1024 / ((Date.now() - uploadStart) / 1000)
    check(`رفع أول جولة حتى 40% (${(received / 1024 ** 3).toFixed(2)}GB بسرعة ${upMbps.toFixed(0)}MB/s)`, received >= killAt)

    // قتل + إعادة init بنفس taskId → استئناف
    init = (await api("/api/fs/upload", {
      method: "POST",
      body: JSON.stringify({
        op: "init", deviceId: DEVICE_ID, path: "/Downloads", name: "e2e-2gb.bin",
        size: SIZE, taskId: TASK_ID, chunkSize: CHUNK,
      }),
    })).json
    check("بعد القتل: إعادة init تعيد نفس الجلسة", init?.ok === true && init.uploadId?.length > 0)
    check(`السيرفر يحفظ الجزئي: received=${(init.received / 1024 ** 3).toFixed(2)}GB == آخر إزاحة`, init.received === received)

    // مواصلة الرفع حتى الاكتمال
    uploadStart = Date.now()
    while (received < SIZE) {
      const stream = createReadStream(SRC_TMP, { start: received, end: Math.min(received + CHUNK, SIZE) - 1 })
      const r = await putChunk(init.uploadId, received, stream)
      if (r.json?.ok !== true) { check("PUT قطعة أثناء الاستئناف", false, JSON.stringify(r.json)); break }
      received = r.json.received
    }
    const totalMbps = SIZE / 1024 / 1024 / ((Date.now() - uploadStart) / 1000 + 1)
    check(`اكتمل الرفع: ${received} == ${SIZE} (استئناف ${totalMbps.toFixed(0)}MB/s)`, received === SIZE)

    const done = (await api("/api/fs/upload", { method: "POST", body: JSON.stringify({ op: "complete", uploadId: init.uploadId }) })).json
    check("upload complete يعيد مهمة done", done?.ok === true && done?.job?.status === "done")

    // تحقق البايتات: حجم + hash للملف النهائي على السيرفر
    const st = await fs.stat(SERVER_UP).catch(() => null)
    check("حجم الملف النهائي على السيرفر 2GB", st?.size === SIZE)
    const serverHash = st ? await hashFile(SERVER_UP) : ""
    check("sha256 الملف المرفوع مطابق للمصدر", serverHash === sha256Zeros, serverHash.slice(0, 16))

    const jobs = (await api("/api/transfer")).json.jobs || []
    const job = jobs.find((j) => j.id === init.jobId)
    check("المهمة ظاهرة في GET /api/transfer بحالة done", job?.status === "done" && job?.agent === true)

    // تنظيف فوري لتحرير القرص لاختبار التنزيل
    await fs.rm(SERVER_UP, { force: true })
    await fs.rm(SRC_TMP, { force: true })
  }

  // ================================================================ 2) التنزيل
  console.log("\n--- 2) إرسال 2GB من الويب → الهاتف (offer → قبول → Range مع قطع واستئناف) ---")
  {
    // مصدر sparse داخل جذر pc-office
    await fs.mkdir(`${PCFS_ROOT}/Documents`, { recursive: true })
    const fh = await fs.open(SERVER_DL_SRC, "w")
    await fh.truncate(SIZE)
    await fh.close()

    const send = await api("/api/devices", {
      method: "POST",
      body: JSON.stringify({
        action: "send-file", deviceId: DEVICE_ID, direction: "out",
        srcDeviceId: "pc-office", srcPath: "/Documents/e2e-2gb.bin", fileName: "e2e-2gb.bin",
      }),
    })
    check("send-file من الويب أنشأ مهمة queued للوكيل الحي", send.json?.ok === true && send.json?.job?.status === "queued" && send.json?.job?.agent === true)

    // انتظار tx:offer على القناة الدائمة
    const offer = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("لم يصل tx:offer خلال 5 ثوانٍ")), 5000)
      const poll = setInterval(() => {
        const o = offers.find((x) => x.id === send.json.job.id)
        if (o) { clearTimeout(t); clearInterval(poll); resolve(o) }
      }, 50)
    })
    check("الهاتف استقبل tx:offer على 3006", !!offer?.id && offer.size === SIZE, `${offer?.fileName} من ${offer?.from}`)

    // قبول → تنزيل Range
    guard.emit("tx:accept", { id: offer.id })
    const url = `${BASE}/api/preview?device=pc-office&path=/Documents/e2e-2gb.bin&download=1`
    let offset = 0
    let saw206 = false
    let dlStart = Date.now()
    let lastProgress = 0

    async function downloadInto(out, rangeHeader) {
      const res = await fetch(url, { headers: rangeHeader ? { Range: rangeHeader } : {} })
      if (rangeHeader && res.status === 206) saw206 = true
      if (res.status !== 200 && res.status !== 206) throw new Error(`HTTP ${res.status}`)
      let pendingDrain = Promise.resolve()
      for await (const c of Readable.fromWeb(res.body)) {
        offset += c.length
        if (!out.write(c)) {
          await new Promise((r) => out.once("drain", r))
        }
        // tx:progress مُخفّف — نفس ما يفعله التطبيق
        if (offset - lastProgress > 32 * 1024 * 1024) {
          lastProgress = offset
          guard.emit("tx:progress", { id: offer.id, transferred: offset })
        }
      }
      await pendingDrain
    }

    // جولة أولى: نطلب المجال كاملًا لكن نقتل الاتصال عند 35% (قتل حقيقي في المنتصف)
    const killAt = Math.floor(SIZE * 0.35 / (1024 * 1024)) * (1024 * 1024)
    const out1 = createWriteStream(DL_TMP, { flags: "w" })
    const killerLeg = (async () => {
      const res = await fetch(url)
      let aborted = false
      for await (const c of Readable.fromWeb(res.body)) {
        if (offset >= killAt) { aborted = true; res.body?.controller?.abort?.(); break }
        offset += c.length
        if (!out1.write(c)) await new Promise((r) => out1.once("drain", r))
      }
      await new Promise((r) => out1.end(r))
      return aborted
    })()
    await killerLeg
    const firstLegGb = (offset / 1024 ** 3).toFixed(2)
    check(`قتل حقيقي في المنتصف: أول جولة ${firstLegGb}GB ثم قطع الاتصال`, offset >= killAt)

    // قتل: الملف أُغلق داخل killerLeg — استئناف من حجم الجزئي (نفس ما يفعله التطبيق بعد إعادة الفتح)
    const tempSize = (await fs.stat(DL_TMP)).size
    check("الجزئي المحلي محفوظ بعد القتل (استئناف ممكن)", tempSize === offset)
    guard.emit("tx:accept", { id: offer.id })

    const out2 = createWriteStream(DL_TMP, { flags: "a" })
    offset = tempSize
    dlStart = Date.now() - dlStart
    // إعادة ربط التقدم
    const emitProgress = setInterval(() => guard.emit("tx:progress", { id: offer.id, transferred: offset }), 800)
    await downloadInto(out2, `bytes=${offset}-`)
    await new Promise((r) => out2.end(r))
    clearInterval(emitProgress)
    const dlMbps = SIZE / 1024 / 1024 / ((Date.now() - dlStart) / 1000)
    check(`اكتمل التنزيل: ${offset} == ${SIZE} (${dlMbps.toFixed(0)}MB/s إجمالًا)`, offset === SIZE)
    check("الاستئناف استخدم 206 Partial Content (Range حقيقي)", saw206)

    // تحقق البايتات
    const dlHash = await hashFile(DL_TMP)
    check("sha256 الملف المنزّل مطابق للمصدر (2GB)", dlHash === sha256Zeros, dlHash.slice(0, 16))

    // إبلاغ السيرفر بالاكتمال (نفس حدث التطبيق)
    guard.emit("tx:state", { id: offer.id, state: "done" })
    await sleep(300)
    const jobs = (await api("/api/transfer")).json.jobs || []
    const job = jobs.find((j) => j.id === offer.id)
    check("مهمة السيرفر صارت done بعد tx:state", job?.status === "done" && job?.transferred === SIZE)

    // تنظيف
    await fs.rm(DL_TMP, { force: true })
    await fs.rm(SERVER_DL_SRC, { force: true })
  }

  // ================================================================ 3) تحكم الكمبيوتر
  console.log("\n--- 3) إيقاف/إلغاء من الكمبيوتر يصل الهاتف عبر القناة ---")
  {
    // ملف صغير
    await fs.mkdir(`${PCFS_ROOT}/Documents`, { recursive: true })
    await fs.writeFile(`${PCFS_ROOT}/Documents/e2e-small.txt`, "hello nexus")
    const send = await api("/api/devices", {
      method: "POST",
      body: JSON.stringify({
        action: "send-file", deviceId: DEVICE_ID, direction: "out",
        srcDeviceId: "pc-office", srcPath: "/Documents/e2e-small.txt", fileName: "e2e-small.txt",
      }),
    })
    const jobId = send.json?.job?.id
    await sleep(300)
    check("عرض صغير وصل", !!jobId && offers.some((o) => o.id === jobId))

    const pause = await api("/api/transfer", { method: "POST", body: JSON.stringify({ action: "pause", id: jobId }) })
    await sleep(300)
    check("إيقاف من الكمبيوتر → tx:pause للهاتف", pause.json?.ok === true && txCmds.some((c) => c.ev === "tx:pause" && c.id === jobId))

    const cancel = await api("/api/transfer", { method: "POST", body: JSON.stringify({ action: "cancel", id: jobId }) })
    await sleep(300)
    check("إلغاء من الكمبيوتر → tx:cancel للهاتف + حذف المهمة", cancel.json?.ok === true && txCmds.some((c) => c.ev === "tx:cancel" && c.id === jobId))

    // إيقاف جلسة رفع من الكمبيوتر → PUT يُرفض 409 paused
    const up = (await api("/api/fs/upload", {
      method: "POST",
      body: JSON.stringify({ op: "init", deviceId: DEVICE_ID, name: "e2e-pause.bin", size: 10 * 1024 * 1024, taskId: "t_e2e_pause" }),
    })).json
    await api("/api/transfer", { method: "POST", body: JSON.stringify({ action: "pause", id: up.jobId }) })
    const buf = Buffer.alloc(1024 * 1024)
    const pausedPut = await putChunk(up.uploadId, 0, Readable.from(buf))
    check("PUT أثناء الإيقاف من الكمبيوتر → 409 paused", pausedPut.status === 409 && pausedPut.json?.paused === true)
    await api("/api/transfer", { method: "POST", body: JSON.stringify({ action: "resume", id: up.jobId }) })
    const resumedPut = await putChunk(up.uploadId, 0, Readable.from(buf))
    check("بعد الاستئناف PUT يعمل ويحسب الإزاحة", resumedPut.json?.ok === true && resumedPut.json?.received === buf.length)
    await api("/api/fs/upload", { method: "POST", body: JSON.stringify({ op: "abort", uploadId: up.uploadId }) })
    await fs.rm(`${PCFS_ROOT}/Documents/e2e-small.txt`, { force: true })
  }

  // ================================================================ 4) نصوص/روابط 3007
  console.log("\n--- 4) النصوص والروابط السريعة عبر جسر الإنتاجية 3007 ---")
  {
    const prod = io("http://localhost:3007", { transports: ["websocket", "polling"] })
    const clips = []
    const hands = []
    prod.on("clip:new", (d) => clips.push(d))
    prod.on("hand:new", (d) => hands.push(d))
    await new Promise((r) => prod.on("connect", r))
    await sleep(200)

    prod.emit("clip:push", {
      deviceId: "pc-office", deviceName: "PC-OFFICE", kind: "text",
      content: "مرحبًا من الويب — نص سريع للهاتف", mode: "manual",
    })
    prod.emit("hand:push", {
      deviceId: "pc-office", deviceName: "PC-OFFICE", kind: "link",
      title: "مستند NexusLink", url: "https://example.com/nexus-doc",
    })
    await sleep(600)
    check("clip:new وصل للهاتف (نص)", clips.some((c) => c.content?.includes("نص سريع للهاتف") && c.deviceName === "PC-OFFICE"))
    check("hand:new وصل للهاتف (رابط)", hands.some((h) => h.url === "https://example.com/nexus-doc" && !!h.title))
    prod.disconnect()
  }

  // ================================================================ تنظيف + خلاصة
  guard.disconnect()
  await api("/api/devices", { method: "POST", body: JSON.stringify({ action: "forget", id: DEVICE_ID }) })

  const pass = results.filter((r) => r.ok).length
  console.log(`\n=== النتيجة: ${pass}/${results.length} ناجح ===`)
  if (pass !== results.length) {
    process.exit(1)
  }
}

main().catch((e) => {
  console.error("فشل السيناريو:", e)
  process.exit(1)
})
