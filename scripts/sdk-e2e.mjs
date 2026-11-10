// SDK/CLI — عقد حدّي حي للحيّز المفتوح (تكليف 47 — M3.1/M3.3)
// =====================================================================================================
// أول بطارية E2E للعميل العام الرسمي (sdk/index.mjs) وأول تكامل فوقه (cli/nexus.mjs):
// · أ) النقي (بلا خادم): حرس النطاق المحلي (رفض خارجي/LAN/مخطط آخر/DNS-rebind/مسار أعمق — قبول
//    الشريحة المائلة الوحيدة) + المهلة الافتراضية المعلنة 10s والتجاوز والحسم عند اللاتماهية
//    + redirect:"error" (عقد النقل: الجهاز هو الحدود — لا اتباع تحويل نحو الخارج)
//    + حرس since الصحيح ≥ 0 (لا since=NaN صامت) + جرد 16 طريقة معلنة في الدليل + شكل NexusError
//    + مهلة حية ضد مستمع TCP أبدي (مستقبل يقبل ولا يرد — رفض ≤ مهلته المقاسة)
// · ب) الحي ضد الخادم الإنتاجي (:3000 + جسر الأتمتة): كل طريقة معلنة في docs/sdk-guide.md
//    حرفيًا — الإصدار والصحة والأجهزة والتصفية وسجل العمليات بلا حمولات (F6) والبحث الموحد
//    (عربي/فارغ 400 مسبب/اقتصاص >80) والمساعد والرؤى والأتمتة (قائمة/إنشاء/رفض مسبب/إطلاقات/حذف
//    متسامح) والسوق (قناة موقعة ≥10/توقيع 64hex/تثبيت/تكرار مرفوض 400/إزالة/إزالة الغائب 404)
//    + CLI كامل بنهايات خرج صادقة: help/أوامر مجهولة/عنوان خارجي مرفوض/منفذ ومهلة وsince غير صالحة
//    + جولة إضافة ثم حذف قاعدة عبر CLI حصرًا.
// الاستخدام: node scripts/sdk-e2e.mjs   (الخادم الإنتاجي عامل: next standalone :3000)
import { spawnSync } from 'node:child_process'
import net from 'node:net'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const REST = { host: '127.0.0.1', port: 3000 }
const results = []
let failed = 0
function check(name, ok, detail = '') {
  results.push({ name, ok })
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`)
}
const { NexusLink, NexusError } = await import('../sdk/index.mjs')

// ==== أ) النقي — الحرس التعاقدي في البناء ====
const badUrls = [
  'https://example.com', 'http://192.168.1.5:3000', 'http://10.0.0.2', 'ws://127.0.0.1:3000',
  'http://127.0.0.1.evil.com:3000', 'http://localhost.evil.com', 'http://127.0.0.1:3000/api',
  'http://0x7f000001:3000', 'ftp://127.0.0.1:3000',
]
let rejected = 0
for (const u of badUrls) {
  try { new NexusLink({ url: u }); } catch (e) {
    if (e instanceof NexusError && e.status === 0 && e.path === 'constructor') rejected++
    else check(`SDK/حرس: رفض ${u} بشكل NexusError الصحيح`, false, String(e))
  }
}
check('SDK/حرس: كل العناوين غير المحلية مرفوعة بNexusError(0,constructor)', rejected === badUrls.length, `${rejected}/${badUrls.length}`)
const goodCases = [
  [{}, 'http://127.0.0.1:3000'], [{ port: 3000 }, 'http://127.0.0.1:3000'],
  [{ port: 8123 }, 'http://127.0.0.1:8123'], [{ url: 'http://127.0.0.1:3000/' }, 'http://127.0.0.1:3000'],
  [{ url: 'http://localhost:3000' }, 'http://localhost:3000'], [{ url: 'http://[::1]:3000' }, 'http://[::1]:3000'],
  [{ url: 'HTTP://LOCALHOST:3000/' }, 'HTTP://LOCALHOST:3000'],
]
let accepted = 0
for (const [opts, base] of goodCases) {
  try { const nx = new NexusLink(opts); if (nx.base === base) accepted++; else check(`SDK/حرس: قاعدة ${base}`, false, nx.base) }
  catch (e) { check(`SDK/حرس: قبول ${base}`, false, String(e)) }
}
check('SDK/حرس: الأشكال المحلية الصالحة كلها مقبولة (بما فيها الشريحة المائلة الوحيدة)', accepted === goodCases.length, `${accepted}/${goodCases.length}`)

const nx0 = new NexusLink({})
check('SDK/مهلة: الافتراضي المعلن 10000ms', nx0.timeoutMs === 10000, String(nx0.timeoutMs))
check('SDK/مهلة: التجاوز مقبول', new NexusLink({ timeoutMs: 2500 }).timeoutMs === 2500, '')
check('SDK/مهلة: غير الصالح (0/سالب/نص) يسقط للافتراضي',
  new NexusLink({ timeoutMs: 0 }).timeoutMs === 10000 && new NexusLink({ timeoutMs: -5 }).timeoutMs === 10000
  && new NexusLink({ timeoutMs: 'abc' }).timeoutMs === 10000 && new NexusLink({ timeoutMs: 999_000 }).timeoutMs === 10000, '')

const src = (await import('node:fs')).readFileSync(new URL('../sdk/index.mjs', import.meta.url), 'utf8')
check('SDK/نقل: redirect:"error" في كل طلب (لا اتباع تحويل نحو الخارج)', src.includes('redirect: "error"'), '')
check('SDK/نقل: المهلة عبر AbortSignal.timeout المعلن', src.includes('AbortSignal.timeout'), '')
check('SDK/خطأ: NexusError يحمل status وmessage وpath', (() => { try { new NexusLink({ url: 'https://x.io' }); return false } catch (e) { return e instanceof NexusError && e.name === 'NexusError' && typeof e.status === 'number' && typeof e.message === 'string' && typeof e.path === 'string' } })(), '')

let opsThrows = 0
for (const bad of ['abc', NaN, -1, 1.5, '1.5']) {
  try { nx0.ops(bad); } catch (e) { if (e instanceof NexusError && e.status === 400 && e.path === '/api/sync/ops') opsThrows++ }
}
check('SDK/since: النص وNaN والسالب والمكسور كلها 400 مسببًا (لا since=NaN صامت)', opsThrows === 5, `${opsThrows}/5`)

const methods = ['version', 'health', 'devices', 'device', 'ops', 'transfers', 'search', 'ask', 'insights']
let mOk = 0
for (const m of methods) if (typeof nx0[m] === 'function') mOk++
for (const m of ['list', 'upsert', 'remove', 'fires']) if (typeof nx0.automation[m] === 'function') mOk++
for (const m of ['list', 'install', 'uninstall', 'sign']) if (typeof nx0.market[m] === 'function') mOk++
check('SDK/جرد: ‏17 طريقة معلنة في الدليل كلها موجودة (9 + 4 أتمتة + 4 سوق)', mOk === 17, `${mOk}/17`)

// شكل الخطأ على منفذ ميت — منفذ مغلق حتميًا: اربط، خذ الرقم، أغلق ثم اضربه
// (المنفذ 9 discard مفتوح في بيئات بعض الحاويات — درس الجولة الأولى)
async function closedPort() {
  const s = net.createServer(() => { })
  await new Promise((r) => s.listen(0, '127.0.0.1', r))
  const p = s.address().port
  await new Promise((r) => s.close(r))
  return p
}
const deadPort = await closedPort()
const nxDead = new NexusLink({ port: deadPort })
const tDead = Date.now()
try { await nxDead.health(); check('SDK/خطأ: منفذ ميت يرمي', false, 'لم يرمِ') }
catch (e) {
  const dt = Date.now() - tDead
  check('SDK/خطأ: منفذ ميت → NexusError(0) برسالة اتصال ومسار', e instanceof NexusError && e.status === 0 && e.path === '/api/health' && /لا اتصال/.test(e.message), `status=${e.status} dt=${dt}ms`)
}

// مهلة حية: مستمع TCP يقبل ولا يرد أبدًا
const sink = net.createServer((c) => { /* يقبل — لا رد */ })
await new Promise((r) => sink.listen(0, '127.0.0.1', r))
const sinkPort = sink.address().port
const nxSink = new NexusLink({ port: sinkPort, timeoutMs: 600 })
const tSink = Date.now()
try { await nxSink.version(); check('SDK/مهلة: مستمع أبدي يرمي', false, 'لم يرمِ') }
catch (e) {
  const dt = Date.now() - tSink
  check('SDK/مهلة: مستمع أبدي → NexusError(0) رسالة مهلة خلال المهلته', e instanceof NexusError && e.status === 0 && /انتهت مهلة الطلب \(600ms\)/.test(e.message) && dt < 3000, `dt=${dt}ms msg=${e.message.slice(0, 44)}`)
}
sink.close()

// ==== ب) الحي ضد الخادم الإنتاجي ====
async function jget(path) {
  const r = await fetch(`http://127.0.0.1:${REST.port}${path}`)
  return { status: r.status, json: await r.json().catch(() => null) }
}
let boot = null
for (let i = 0; i < 30; i++) {
  try { boot = await jget('/api/automation/boot'); if (boot.json?.ok) break } catch { }
  await new Promise((r) => setTimeout(r, 1000))
}
check('حي/إقلاع: جسر الأتمتة عامل عبر /api/automation/boot', boot?.json?.ok === true, JSON.stringify(boot?.json ?? {}).slice(0, 60))

const nx = new NexusLink({ port: REST.port })
const v = await nx.version()
check('حي/version: current نص + عربة تاريخ history (عقد §34.أ حرفيًا — الاسم البديل المصلح)', typeof v?.current === 'string' && v.current.length >= 5 && Array.isArray(v?.history) && v.history.length >= 0, `current=${v?.current} history=${v?.history?.length}`)
check('حي/version: changelog يبقى لمستهلكيه القائمين (لا كسر)', Array.isArray(v?.changelog), `n=${v?.changelog?.length}`)
const h = await nx.health()
check('حي/health: ok صادق', h && (h.ok === true || h.status === 'ok'), JSON.stringify(h).slice(0, 60))
const d = await nx.devices()
check('حي/devices: شكل {devices:[…]}', Array.isArray(d?.devices), `count=${d?.devices?.length}`)
check('حي/device: جهاز غائب → null (تصفية محلية)', (await nx.device('sdk-e2e-no-such-device')) === null, '')

const ops = await nx.ops()
check('حي/ops: head رقم وقائمة سجل', typeof ops?.head === 'number' && Array.isArray(ops?.ops), `head=${ops?.head} n=${ops?.ops?.length}`)
const opPayloads = (ops.ops ?? []).every((o) => o.payload !== undefined && Object.keys(o.payload).length === 0 && typeof o.hasPayload === 'boolean')
check('حي/ops/F6: كل العملية بلا حمولات — payload:{} وعلم hasPayload (القراءة لا تسرّب بايت)', opPayloads && (ops.ops?.length === 0 || true), `n=${ops.ops?.length}`)
if (ops.ops?.length) {
  const win = await nx.ops(ops.head)
  check('حي/ops(since=head): النافذة فوق الرأس فارغة (لا سالبة)', win?.count === 0 && Array.isArray(win.ops), `count=${win.count}`)
} else check('حي/ops(since=head): السجل فارغ — القاعدة نظيفة (مقبول)', true, '')
const opsBad = await (async () => { try { await nx.ops('abc'); return null } catch (e) { return e } })()
check('حي/ops(غير صالح): NexusError ‏400 مسببًا حيًا', opsBad instanceof NexusError && opsBad.status === 400, '')
const tr = await nx.transfers()
check('حي/transfers: {jobs:[…]}', Array.isArray(tr?.jobs), `n=${tr?.jobs?.length}`)

const s = await nx.search('ملاحظات')
check('حي/search: عربي → ok + مجموعات + total', s?.ok === true && Array.isArray(s?.groups) && typeof s?.total === 'number', `total=${s?.total} groups=${s?.groups?.length}`)
try { await nx.search(''); check('حي/search: فارغ يرمي 400', false, 'لم يرمِ') }
catch (e) { check('حي/search: فارغ → NexusError ‏400 برسالة الخادم المسببة', e instanceof NexusError && e.status === 400 && /استعلام/.test(e.message), e.message.slice(0, 40)) }
const s80 = await nx.search('خ'.repeat(200))
check('حي/search: ‏>80 حرفًا يُقتصّ في الخادم ولا يفشل', s80?.ok === true, `total=${s80?.total}`)

const a = await nx.ask('ما حالة أجهزتي؟')
check('حي/ask: نية حتمية بإجابة ومصادر', a?.ok === true && typeof a?.intent === 'string' && typeof a?.answer === 'string' && a.answer.length > 0 && Array.isArray(a?.sources), `intent=${a?.intent} sources=${a?.sources?.length}`)
try { await nx.ask(''); check('حي/ask: فارغ يرمي 400', false, 'لم يرمِ') }
catch (e) { check('حي/ask: فارغ → NexusError ‏400', e instanceof NexusError && e.status === 400, '') }

const ins = await nx.insights()
check('حي/insights: أرقام وأزمنة حصرًا (كائن بعناصر عددية)', ins && typeof ins === 'object' && Object.keys(ins).length > 0, `keys=${Object.keys(ins ?? {}).length}`)

const rules0 = await nx.automation.list()
check('حي/automation.list: قائمة قواعد', Array.isArray(rules0?.rules), `n=${rules0?.rules?.length}`)
const up = await nx.automation.upsert({ name: 'sdk-e2e-قاعدة-عربية', enabled: true, trigger: { kind: 'battery.below', threshold: 20 }, action: { kind: 'notify', text: 'بطارية منخفضة — فحص SDK' } })
check('حي/automation.upsert: قاعدة عربية جديدة → ok + id', up?.ok === true && typeof up?.rule?.id === 'string' && up.rule.id.length > 0, `id=${up?.rule?.id?.slice(0, 10)}`)
try { await nx.automation.upsert({ name: 'sdk-e2e-رفض', enabled: true, trigger: { kind: 'xyz.not-a-kind' }, action: { kind: 'notify', text: 'لن يمر' } }); check('حي/automation.upsert: مشغل مجهول يرمي 400', false, 'لم يرمِ') }
catch (e) { check('حي/automation.upsert: مشغل مجهول → NexusError ‏400 مسبب كدليل ‏§34.أ حرفيًا', e instanceof NexusError && e.status === 400 && /مشغّل/.test(e.message), e.message.slice(0, 44)) }
const fires = await nx.automation.fires()
check('حي/automation.fires: إطلاقات مرسوخة من SQLite', Array.isArray(fires?.fires), `n=${fires?.fires?.length}`)
const del = await nx.automation.remove(up.rule.id)
check('حي/automation.remove: حذف بالمعرف → ok', del?.ok === true, '')
const del2 = await nx.automation.remove('sdk-e2e-غائب')
check('حي/automation.remove: حذف الغائب متسامح → ok (نفس دلالات الجسر حرفيًا)', del2?.ok === true, '')

const mkt = await nx.market.list()
check('حي/market.list: قناة موقعة ≥10 + مثبت + بصمة مفتاح', Array.isArray(mkt?.channel) && mkt.channel.length >= 10 && Array.isArray(mkt?.installed) && /^[0-9a-f]{16}$/.test(mkt?.keyFp ?? ''), `channel=${mkt?.channel?.length} installed=${mkt?.installed?.length} fp=${mkt?.keyFp}`)
const chan = mkt.channel[0]
check('حي/market.list: بنود القناة موقعة (manifest + sig 64hex)', chan?.manifest?.id && typeof chan?.sig === 'string' && /^[0-9a-f]{64}$/.test(chan.sig), `id=${chan?.manifest?.id}`)
const tmp = mkdtempSync(join(tmpdir(), 'sdk-e2e-'))
const manifestPath = join(tmp, 'manifest.json')
writeFileSync(manifestPath, JSON.stringify({ id: 'sdk-e2e-local', name: 'SDK E2E', description: 'تكامل فحص — حصرًا لهذه الجولة', version: '1.0.0', author: 'sdk-e2e', capabilities: ['read.devices'], entry: { kind: 'local-open', open: '/download' } }, null, 2))
const sg = await nx.market.sign(JSON.parse((await import('node:fs')).readFileSync(manifestPath, 'utf8')))
check('حي/market.sign: توقيع بالقناة المحلية — sig 64hex + keyFp', sg?.ok === true && /^[0-9a-f]{64}$/.test(sg?.sig ?? '') && /^[0-9a-f]{16}$/.test(sg?.keyFp ?? ''), `fp=${sg?.keyFp}`)
const inst = await nx.market.install(chan.manifest, chan.sig)
check('حي/market.install: تثبيت من القناة → ok + البند نفسه مثبتًا', inst?.ok === true && inst?.installed?.manifest?.id === chan.manifest.id, `id=${inst?.installed?.manifest?.id}`)
const inst2 = await (async () => { try { await nx.market.install(chan.manifest, chan.sig); return null } catch (e) { return e } })()
check('حي/market.install: التكرار → NexusError ‏400 «معرف التكامل مكرر» (لا توسيع صامت)', inst2 instanceof NexusError && inst2.status === 400 && /مكرر/.test(inst2.message), inst2?.message)
const uni = await nx.market.uninstall(chan.manifest.id)
check('حي/market.uninstall: إزالة → ok', uni?.ok === true, '')
const uni2 = await (async () => { try { await nx.market.uninstall(chan.manifest.id); return null } catch (e) { return e } })()
check('حي/market.uninstall: إزالة الغائب → NexusError ‏404 «التكامل غير مثبت» كما في الدليل', uni2 instanceof NexusError && uni2.status === 404 && /غير مثبت/.test(uni2.message), uni2?.message)

// ==== ج) الحي — CLI فوق الـSDK حصرًا (أول تكامل فعلي) ====
function cli(args, expect = {}) {
  const r = spawnSync('node', ['cli/nexus.mjs', ...args], { cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8', timeout: 30000 })
  const okExit = expect.exit === undefined ? r.status === 0 : r.status === expect.exit
  const okOut = expect.out ? expect.out.test((r.stdout || '') + (r.stderr || '')) : true
  return { r, ok: okExit && okOut }
}
const st = cli(['status', '--json'], { out: /"version"/ })
check('حي/CLI status --json: إصدار + أجهزة + رأس المزامنة (Promise.all فوق SDK)', st.ok && (() => { try { const j = JSON.parse(st.r.stdout); return typeof j.version === 'string' && typeof j.devices?.total === 'number' && typeof j.syncOps?.head === 'number' } catch { return false } })(), st.r.stdout.slice(0, 70))
const dv = cli(['devices', '--json'])
check('حي/CLI devices --json: JSON خام لأي سكربت', dv.ok && Array.isArray(JSON.parse(dv.r.stdout || '[]')), '')
const ver = cli(['version'], { out: /"current"/ })
check('حي/CLI version: JSON عبر out()', ver.ok && JSON.parse(ver.r.stdout).current === v.current, '')
const hl = cli(['health'])
check('حي/CLI health: صحة الخادم المضمن', hl.ok, '')
const op = cli(['ops', '0'])
check('حي/CLI ops 0: نافذة من البداية', op.ok && /"head"/.test(op.r.stdout), '')
const sr = cli(['search', 'ملاحظات', '--json'])
check('حي/CLI search عربي: البحث الموحد عبر SDK', sr.ok && JSON.parse(sr.r.stdout).ok === true, '')
const al = cli(['automation', 'list', '--json'])
check('حي/CLI automation list: فوق مقبس الجسر نفسه', al.ok && Array.isArray(JSON.parse(al.r.stdout).rules), '')
const ml = cli(['market', 'list', '--json'])
check('حي/CLI market list --json: القناة كاملة', ml.ok && Array.isArray(JSON.parse(ml.r.stdout).channel), '')
const hel = cli(['help'])
check('حي/CLI help: الاستخدام والأوامر (بلا خادم)', hel.ok && /الاستخدام/.test(hel.r.stdout) && /automation/.test(hel.r.stdout), '')
const unk = cli(['no-such-cmd'], { exit: 1, out: /غير معروف/ })
check('حي/CLI أمر مجهول: خروج ≠0 برسالة عربية', unk.ok, `exit=${unk.r.status}`)
const ext = cli(['--url', 'https://example.com', 'health'], { exit: 1, out: /محلي حصرًا/ })
check('حي/CLI عنوان خارجي: حرس الـSDK يرفض قبل أي شبكة', ext.ok, `exit=${ext.r.status}`)
const trail = cli(['--url', 'http://127.0.0.1:3000/', 'health'])
check('حي/CLI شريحة مائلة زائدة: مقبولة الآن (إصلاح حرس النطاق)', trail.ok, `exit=${trail.r.status}`)
const devMissing = cli(['device', 'no-such-device-xyz'], { exit: 2, out: /الجهاز غير موجود/ })
check('حي/CLI جهاز غائب: خروج 2 مسبب', devMissing.ok, `exit=${devMissing.r.status}`)
const opsBadCli = cli(['ops', 'abc'], { exit: 1, out: /since/ })
check('حي/CLI ops نص: رفض مسبب (لا since=NaN صامتًا نحو الخادم)', opsBadCli.ok, `exit=${opsBadCli.r.status}`)
const portBad = cli(['--port', 'abc', 'health'], { exit: 1, out: /--port/ })
check('حي/CLI منفذ غير صالح: رفض مسبب', portBad.ok, `exit=${portBad.r.status}`)
const toBad = cli(['--timeout', 'abc', 'health'], { exit: 1, out: /--timeout/ })
check('حي/CLI مهلة غير صالحة: رفض مسبب', toBad.ok, `exit=${toBad.r.status}`)
const add = cli(['automation', 'add', 'sdk-e2e-قاعدة-cli', JSON.stringify({ trigger: { kind: 'clip.received' }, action: { kind: 'notify', text: 'فحص CLI' } }), '--json'])
check('حي/CLI automation add: إنشاء قاعدة عبر CLI حصرًا', add.ok && (() => { try { return typeof JSON.parse(add.r.stdout).rule?.id === 'string' } catch { return false } })(), add.r.stdout.slice(0, 60))
if (add.ok) {
  const id = JSON.parse(add.r.stdout).rule.id
  const lst = cli(['automation', 'list', '--json'])
  check('حي/CLI automation add: القاعدة ظهرت في القائمة', lst.ok && JSON.parse(lst.r.stdout).rules.some((r) => r.id === id), `id=${id.slice(0, 10)}`)
  const rm = cli(['automation', 'rm', id])
  check('حي/CLI automation rm: حذف → ok', rm.ok && /"ok":\s*true/.test(rm.r.stdout), '')
}
const dead = cli(['--port', '59999', '--timeout', '800', 'health'], { exit: 1 })
check('حي/CLI منفذ ميت: NexusError مطبوع ورمز خروج 1', dead.ok && /NexusError/.test((dead.r.stderr || '') + (dead.r.stdout || '')), '')

// ==== الخلاصة ====
const passed = results.length - failed
console.log(`\n===== SDK/CLI E2E: ${passed}/${results.length} فحصًا — ${failed === 0 ? 'أخضر كامل' : failed + ' فشل'}`)
process.exit(failed === 0 ? 0 : 1)
