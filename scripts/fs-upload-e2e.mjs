// FA-20 (تكليف 48) — حرس العقود الحي: قناة الرفع المجزأ §8.2 + مسح حي لكل مسار HTTP موثق في العقد
// =====================================================================================================
// القصة: /api/fs/upload فُقد من الشجرة في commit d705e49 (2026-10-14) وظل مفقودًا شهرًا كاملًا
// رغم توثيقه في العقد §8.2 واستعماله بوكيل الهاتف — لأن فحص desktop-e2e للعقد نصي حصرًا
// والبوابة الثقيلة (agent-tx 2GB) خارج الأساس. هذه البوابة تغلق الصنفين:
//   أ) شجري: المسار موجود بالملف وببصمات حروسه الثلاثة (resolveSafe/sanitizeName/stableUploadId)
//   ب) حي: عقد §8.2 كاملًا — init حتمي + استئناف بعد «قتل» + drift/paused 409 + complete
//      فريد الاسم + بايتات القرص sha256 مطابقة + traversal مرفوض + abort يمحو الجزئي + سقف 16MB
//   ج) حرس العقود الحي: كل /api/... موثقة في protocol-contract.md تُسأل حيًا —
//      404 إطاري (HTML بلا جسم عربي) = «موثق ومفقود» → فشل. 404 عربي JSON من المسار نفسه = حي.
// الاستخدام: node scripts/fs-upload-e2e.mjs   (المكدس عامر: next standalone :3000)
import { request } from 'node:http'
import { createHash } from 'node:crypto'
import { readFileSync, existsSync, statSync, rmSync } from 'node:fs'
import path from 'node:path'

const REST = { host: '127.0.0.1', port: 3000 }
const results = []
let failed = 0
function check(name, ok, detail = '') {
  results.push({ name, ok })
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`)
}

function reqJson(p, method, body) {
  return new Promise((res, rej) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body))
    const r = request({ host: REST.host, port: REST.port, path: p, method, headers: data ? {
      'content-type': 'application/json', 'content-length': data.length,
    } : {} }, (resp) => {
      let raw = ''
      resp.on('data', (c) => { raw += c })
      resp.on('end', () => {
        let j = null
        try { j = JSON.parse(raw) } catch { /* بلا جسم JSON */ }
        res({ status: resp.statusCode, json: j, raw })
      })
    })
    r.on('error', rej)
    r.setTimeout(15000, () => { r.destroy(new Error('timeout')) })
    if (data) r.write(data)
    r.end()
  })
}

function reqRaw(p, method, buf, headers = {}) {
  return new Promise((res, rej) => {
    const r = request({ host: REST.host, port: REST.port, path: p, method, headers: {
      'content-length': buf ? buf.length : 0, ...headers,
    } }, (resp) => {
      let raw = ''
      resp.on('data', (c) => { raw += c })
      resp.on('end', () => {
        let j = null
        try { j = JSON.parse(raw) } catch { /* بلا جسم */ }
        res({ status: resp.statusCode, json: j, raw })
      })
    })
    r.on('error', rej)
    r.setTimeout(30000, () => { r.destroy(new Error('timeout')) })
    if (buf) r.write(buf)
    r.end()
  })
}

const sha256 = (b) => createHash('sha256').update(b).digest('hex')
const RUN = Date.now().toString(36)
const DEV = 'fa20-dev'
const TASK = `fa20-up-${RUN}`
const NAME = `e2e-fa20-${RUN}.bin`
// درس desktop-e2e (سطر 230): standalone server.js يعمل chdir(__dirname) — جذر بيانات السيرفر
const SRV_DATA = path.join(path.resolve(import.meta.dirname, '..'), '.next', 'standalone')
const resolveSrv = (p) => path.isAbsolute(String(p)) ? path.resolve(String(p)) : path.join(SRV_DATA, String(p))

async function main() {
  const ROOT = path.resolve(import.meta.dirname, '..')

  // ================================================================ أ) شجري
  console.log('\n--- أ) الطبقة الشجرية — حرس الحذف الصامت ---')
  const routeRel = 'src/app/api/fs/upload/route.ts'
  const routeAbs = path.join(ROOT, routeRel)
  check('أ/1: ملف المسار موجود في الشجرة (لا حذف صامت مجددًا)', existsSync(routeAbs), routeRel)
  const contract = readFileSync(path.join(ROOT, 'docs/protocol-contract.md'), 'utf8')
  check('أ/2: العقد §8.2 يوثق القناة (init/PUT/complete/pause/resume/abort)',
    contract.includes('/api/fs/upload') && contract.includes('### 8.2') &&
    contract.includes('{op:"init"') && contract.includes('{op:"complete"') && contract.includes('abort'))
  const mobile = readFileSync(path.join(ROOT, 'nexuslink_mobile/lib/data/transfer_api.dart'), 'utf8')
  check('أ/3: وكيل الهاتف يستهلك القناة فعليًا (transfer_api.dart)', mobile.includes("api('fs/upload')"))
  const routeSrc = existsSync(routeAbs) ? readFileSync(routeAbs, 'utf8') : ''
  check('أ/4: بصمات الحرس الثلاثة في المسار (resolveSafe/sanitizeName/stableUploadId)',
    routeSrc.includes('resolveSafe') && routeSrc.includes('sanitizeName') && routeSrc.includes('stableUploadId'))
  check('أ/5: الحمايتان المعلنتان حاضرتان (سقف 16MB + قص الخمول 6س)',
    routeSrc.includes('MAX_CHUNK_BYTES') && routeSrc.includes('IDLE_GC_MS'))

  // ================================================================ ب) حي — عقد §8.2
  console.log('\n--- ب) القناة الحية — العقد §8.2 حرفيًا ---')
  const CH = 256 * 1024
  const A = Buffer.alloc(CH, 0x41), B = Buffer.alloc(CH, 0x42), C = Buffer.alloc(7777, 0x43)
  const TOTAL = A.length + B.length + C.length

  let init = await reqJson('/api/fs/upload', 'POST', { op: 'init', deviceId: DEV, path: '/Downloads', name: NAME, size: TOTAL, chunkSize: 1024, taskId: TASK, localPath: '(هاتف) /DCIM/e2e' })
  check('ب/1: init يعيد ok + uploadId + received:0', init.json?.ok === true && typeof init.json?.uploadId === 'string' && init.json?.received === 0, `status=${init.status}`)
  check('ب/2: تثبيت chunkSize عند الأرضية 2MB (الحماسة 1024 تُثبَّت)', init.json?.chunkSize === 2 * 1024 * 1024, `chunkSize=${init.json?.chunkSize}`)
  const UP = init.json?.uploadId

  const reinit = await reqJson('/api/fs/upload', 'POST', { op: 'init', deviceId: DEV, path: '/Downloads', name: NAME, size: TOTAL, taskId: TASK })
  check('ب/3: init حتمي — نفس taskId يعيد نفس uploadId (§8.2)', reinit.json?.uploadId === UP && reinit.json?.received === 0, `same=${reinit.json?.uploadId === UP}`)

  const p1 = await reqRaw(`/api/fs/upload?upload=${UP}&offset=0`, 'PUT', A)
  check('ب/4: الجزء الأول → 200 {received=len(A)}', p1.status === 200 && p1.json?.received === A.length, `status=${p1.status} received=${p1.json?.received}`)

  const drift = await reqRaw(`/api/fs/upload?upload=${UP}&offset=0`, 'PUT', A)
  check('ب/5: إزاحة منحرفة → 409 drift ب received الصادق', drift.status === 409 && drift.json?.drift === true && drift.json?.received === A.length, `status=${drift.status}`)

  const st = await reqJson(`/api/fs/upload?upload=${UP}`, 'GET')
  check('ب/6: حالة الجلسة GET → received/name/status', st.json?.ok === true && st.json?.received === A.length && st.json?.name === NAME, `received=${st.json?.received}`)

  // «قتل» محاكى: إعادة init بعد الكتابة — الاستئناف من القرص (الجلسة عائمة في الذاكرة فقط)
  const killed = await reqJson('/api/fs/upload', 'POST', { op: 'init', deviceId: DEV, path: '/Downloads', name: NAME, size: TOTAL, taskId: TASK })
  check('ب/7: إعادة init بعد «قتل» → نفس الجلسة وreceived من القرص (استئناف)', killed.json?.uploadId === UP && killed.json?.received === A.length, `received=${killed.json?.received}`)

  const p2 = await reqRaw(`/api/fs/upload?upload=${UP}&offset=${A.length}`, 'PUT', B)
  check('ب/8: الجزء الثاني من الإزاحة الصحيحة → 200', p2.status === 200 && p2.json?.received === A.length + B.length, `received=${p2.json?.received}`)

  await reqJson('/api/fs/upload', 'POST', { op: 'pause', uploadId: UP })
  const paused = await reqRaw(`/api/fs/upload?upload=${UP}&offset=${A.length + B.length}`, 'PUT', C)
  check('ب/9: موقوفة من الكمبيوتر → 409 paused (لا كتابة)', paused.status === 409 && paused.json?.paused === true, `status=${paused.status}`)
  await reqJson('/api/fs/upload', 'POST', { op: 'resume', uploadId: UP })
  const p3 = await reqRaw(`/api/fs/upload?upload=${UP}&offset=${A.length + B.length}`, 'PUT', C)
  check('ب/10: استئناف ثم الجزء الأخير → 200 بreceived كامل', p3.status === 200 && p3.json?.received === TOTAL, `received=${p3.json?.received}`)

  const comp = await reqJson('/api/fs/upload', 'POST', { op: 'complete', uploadId: UP })
  const job = comp.json?.job
  check('ب/11: complete → ok + job done + destPath داخل جذر الجهاز (لا ..)', comp.json?.ok === true && job?.status === 'done' && typeof job?.destPath === 'string' && !job.destPath.includes('..') && job.destPath.includes(`agents/${DEV}/`), `dest=${job?.destPath}`)

  const destAbs = resolveSrv(job?.destPath)
  const onDisk = existsSync(destAbs) ? readFileSync(destAbs) : null
  check('ب/12: بايتات القرص مطابقة sha256 للتركيب A+B+C', onDisk !== null && sha256(onDisk) === sha256(Buffer.concat([A, B, C])), onDisk ? `bytes=${onDisk.length}` : 'مفقود')
  check('ب/13: لا جزئي متبقٍ بعد complete', !existsSync(destAbs + '.nexuspart'))

  const gone = await reqJson(`/api/fs/upload?upload=${UP}`, 'GET')
  check('ب/14: الجلسة أُقفل بعد complete → 404 عربي من المسار نفسه', gone.status === 404 && gone.json?.error === 'جلسة غير معروفة', `status=${gone.status}`)

  // إعادة init بعد complete — جلسة جديدة من صفر (الجزئي أُعيد تسميته فلا دخل قديم)
  // uploadId بقي حتميًا من نفس taskId (عقد §8.2) لكن الجلسة الجديدة تأخذ received من القرص = 0
  const fresh = await reqJson('/api/fs/upload', 'POST', { op: 'init', deviceId: DEV, path: '/Downloads', name: NAME, size: TOTAL, taskId: TASK })
  check('ب/15: إعادة init بعد complete → جلسة جديدة received:0 (لا دخل قديم)', fresh.json?.received === 0, `received=${fresh.json?.received}`)
  await reqJson('/api/fs/upload', 'POST', { op: 'abort', uploadId: fresh.json?.uploadId })

  // الاسم المكرر → لاحقة (1)
  const TASK2 = `${TASK}-d`
  const i2 = await reqJson('/api/fs/upload', 'POST', { op: 'init', deviceId: DEV, path: '/Downloads', name: NAME, size: 1024, taskId: TASK2 })
  const u2 = i2.json?.uploadId
  await reqRaw(`/api/fs/upload?upload=${u2}&offset=0`, 'PUT', Buffer.alloc(1024, 0x44))
  const c2 = await reqJson('/api/fs/upload', 'POST', { op: 'complete', uploadId: u2 })
  check('ب/16: الاسم المكرر → لاحقة " (1)" لا توسيع صامت', / \(\d+\)\.bin$/.test(String(c2.json?.job?.destPath ?? '')), `dest=${c2.json?.job?.destPath}`)

  // مسار فاسد / جهاز فاسد / اسم فاسد
  const trav = await reqJson('/api/fs/upload', 'POST', { op: 'init', deviceId: DEV, path: '/../etc', name: 'x.bin', taskId: `${TASK}-t1` })
  check('ب/17: مسار خارج الجذر → 400 (resolveSafe)', trav.status === 400, `status=${trav.status} error=${trav.json?.error}`)
  const badDev = await reqJson('/api/fs/upload', 'POST', { op: 'init', deviceId: '../evil', path: '/Downloads', name: 'x.bin', taskId: `${TASK}-t2` })
  check('ب/18: deviceId فاسد → 400 (معرّف جهاز غير صالح)', badDev.status === 400 && badDev.json?.error === 'معرّف جهاز غير صالح', `error=${badDev.json?.error}`)
  const TASK3 = `${TASK}-san`
  const san = await reqJson('/api/fs/upload', 'POST', { op: 'init', deviceId: DEV, path: '/Downloads', name: `../../fa20-evil-${RUN}.bin`, size: 10, taskId: TASK3 })
  const sanUp = san.json?.uploadId
  await reqRaw(`/api/fs/upload?upload=${sanUp}&offset=0`, 'PUT', Buffer.alloc(10, 0x45))
  const sanC = await reqJson('/api/fs/upload', 'POST', { op: 'complete', uploadId: sanUp })
  const sanDest = String(sanC.json?.job?.destPath ?? '')
  check('ب/19: اسم فيه ../ يُنقّى basename — الهبوط داخل الجذر حصرًا بالاسم المقصوص',
    sanC.json?.ok === true && !sanDest.includes('..') && sanDest.endsWith(`fa20-evil-${RUN}.bin`), `dest=${sanDest}`)
  rmSync(resolveSrv(sanDest), { force: true })

  // complete قبل الاكتمال + abort يمحو
  const TASK4 = `${TASK}-inc`
  const inc = await reqJson('/api/fs/upload', 'POST', { op: 'init', deviceId: DEV, path: '/Downloads', name: `e2e-fa20-partial-${RUN}.bin`, size: 1000, taskId: TASK4 })
  const incUp = inc.json?.uploadId
  await reqRaw(`/api/fs/upload?upload=${incUp}&offset=0`, 'PUT', Buffer.alloc(100, 0x46))
  const incC = await reqJson('/api/fs/upload', 'POST', { op: 'complete', uploadId: incUp })
  check('ب/20: complete قبل الاكتمال → 400 «الجلسة غير مكتملة»', incC.status === 400 && String(incC.json?.error ?? '').includes('غير مكتملة'), `error=${incC.json?.error}`)
  const partialAbs = resolveSrv(`data/nexus-storage/agents/${DEV}/Downloads/e2e-fa20-partial-${RUN}.bin.nexuspart`)
  const ab = await reqJson('/api/fs/upload', 'POST', { op: 'abort', uploadId: incUp })
  check('ب/21: abort → ok + الجزئي ممحو من القرص فعليًا', ab.json?.ok === true && !existsSync(partialAbs))

  const unknownPut = await reqRaw('/api/fs/upload?upload=up_nonexistent&offset=0', 'PUT', Buffer.alloc(4, 0))
  const unknownGet = await reqJson('/api/fs/upload?upload=up_nonexistent', 'GET')
  check('ب/22: جلسة غير معروفة (PUT/GET) → 404 عربي', unknownPut.status === 404 && unknownGet.status === 404 && unknownGet.json?.error === 'جلسة غير معروفة')
  const badOp = await reqJson('/api/fs/upload', 'POST', { op: 'shredder', uploadId: 'x' })
  check('ب/23: op غير معروف → 400', badOp.status === 400)

  // سقف الجزء المعلن (تكليف 48): 16MB+1 → 400 قبل أي كتابة
  const TASK5 = `${TASK}-cap`
  const capInit = await reqJson('/api/fs/upload', 'POST', { op: 'init', deviceId: DEV, path: '/Downloads', name: `e2e-fa20-cap-${RUN}.bin`, size: 17 * 1024 * 1024, taskId: TASK5 })
  const capUp = capInit.json?.uploadId
  const bigBuf = Buffer.alloc(16 * 1024 * 1024 + 1, 0x47)
  const capPut = await reqRaw(`/api/fs/upload?upload=${capUp}&offset=0`, 'PUT', bigBuf)
  check('ب/24: جزء فوق سقف 16MB → 400 رفض قبل الكتابة', capPut.status === 400 && String(capPut.json?.error ?? '').includes('السقف'), `status=${capPut.status}`)
  await reqJson('/api/fs/upload', 'POST', { op: 'abort', uploadId: capUp })
  rmSync(resolveSrv(`data/nexus-storage/agents/${DEV}/Downloads/e2e-fa20-cap-${RUN}.bin.nexuspart`), { force: true })

  // ================================================================ ج) حرس العقود الحي
  console.log('\n--- ج) حرس العقود الحي: كل مسار موثق يُسأل حيًا (404 إطاري = موثق ومفقود) ---')
  const doc = contract
  const raw = doc.match(/\/api\/[A-Za-z0-9\-/._]+/g) ?? []
  // تكليف 49 — إصلاح شرط فشل ذاتي شحنه FA-20: سطر FA-20 النثري في العقد نفسه (§حدود الخادم)
  // يحمل الحرفي `/api/...` (علامة تعبير لا مسار) فألقطه المستخرج كمسار وهمي → n=47 بدل 46
  // الموثقة → أول جولة تشغيل لاحقة تفشل على بابها. العنصر النثري يُستبعد صراحة —
  // المحاذاة لنية FA-20 الموثقة (46 مسارًا) لا إضعاف: كل مسار حقيقي يبقى مفحوصًا.
  const excl = new Set(['/api', '/api/pair/claim', '/api/...']) // زوج/claim: قرار سلبي موثق («لا بروتوكول موازٍ») + `/api/...` نثري (فائضة نقاط)
  const eps = [...new Set(raw.map((p) => p.replace(/\/route(\.ts)?$/, '').replace(/\/$/, '')))].filter((p) => !excl.has(p) && p !== '/api/desktop').sort()
  check('ج/0: العقد يوثق 40+ مسارًا (حرس انكماش الاستخراج)', eps.length >= 40, `n=${eps.length}`)
  for (const p of eps) {
    const r = await reqJson(p, 'GET').catch((e) => ({ status: 0, json: null, raw: String(e) }))
    let alive = r.status !== 404
    if (r.status === 404) {
      // 404 الإطار = صفحة HTML كاملة — أما المسار الحي فيرد جسمه الخاص (JSON عربي أو نص مثل "No thumb")
      alive = !String(r.raw ?? '').trimStart().startsWith('<')
    }
    check(`ج: عقد حي ${p} → ${r.status}`, alive, alive ? '' : 'موثق ومفقود (404 إطاري)')
  }

  const fails = results.filter((r) => !r.ok).length
  console.log(`\n=== FA-20 fs-upload + حرس العقود الحي E2E: ${results.length - fails}/${results.length} PASS ===`)
  process.exit(fails ? 1 : 0)
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
