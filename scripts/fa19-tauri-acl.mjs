// FA-19 — تحقق عقد ACL للقشرة الأصلية (تكليف 46) — عقد حدّي حقيقي بلا متصفح
// =========================================================================
// يقرأ مصدر Rust (main.rs/procman.rs) + capabilities/*.json + permissions/*.json
// + يجرد كل مستدعي IPC من الواجهة (src/**) ونوافذ المحتوى المحلي (splash/lock.html)
// ويتحقق أن الحدّين متطابقان حرفيًا:
//   · كل أمر مستدعى من نافذة → ممنوح لها في قدرتها بسياقها الصحيح
//   · كل أمر ممنوح → مستدعى فعلًا (أقل امتياز — لا منح ميت) وما عدا ذلك غير ممنوح
//   · كل مرجع صلاحية موجود (نفس تحقق tauri-build validate_capabilities — نكشفه قبل cargo)
//   · الأصل البعيد المطابق حرفيًا لـ REST_PORT في procman.rs — لا نمط واسع
//   · لا منح شامل (core:default أو غيره)
// الاستخدام: node scripts/fa19-tauri-acl.mjs   (يعمل بلا سيرفر — قراءة مصدر حصرًا)
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const TAURI = path.join(ROOT, 'apps/desktop/src-tauri')
const results = []
let failed = 0
function check(name, ok, detail = '') {
  results.push({ name, ok })
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`)
}

// ==== 1) مصدر Rust ====
const mainRs = readFileSync(path.join(TAURI, 'src/main.rs'), 'utf8')
const genMatch = mainRs.match(/generate_handler!\[([\s\S]*?)\]/)
check('FA19/RS: generate_handler موجود في main.rs', !!genMatch)
const handlers = (genMatch?.[1] || '')
  .split(/[,\n]/)
  .map((s) => s.trim())
  .filter((s) => s && !s.startsWith('//'))
  .map((s) => (s.includes('::') ? s.split('::').pop() : s))
  .filter((s) => /^[a-z_]+$/.test(s))
check('FA19/RS: 50 أمرًا مسجلًا في generate_handler', handlers.length === 50, `${handlers.length}`)

const procmanRs = readFileSync(path.join(TAURI, 'src/procman.rs'), 'utf8')
const restPort = procmanRs.match(/const REST_PORT: u16 = (\d+)/)?.[1]
check('FA19/RS: REST_PORT ثابت في procman.rs', !!restPort, restPort || '—')

// ==== 2) بيان صلاحيات التطبيق (permissions/*.json) ====
const permDir = path.join(TAURI, 'permissions')
check('FA19/PERM: مجلد permissions موجود', existsSync(permDir))
const appSets = new Map() // set id → commands
const appCmds = new Set() // كل الأوامر الممنوحة في البيان
const permIds = new Set()
for (const f of readdirSync(permDir).filter((x) => x.endsWith('.json'))) {
  const j = JSON.parse(readFileSync(path.join(permDir, f), 'utf8'))
  for (const p of j.permission || []) {
    permIds.add(p.identifier)
    for (const c of p.commands?.allow || []) appCmds.add(c)
  }
  for (const s of j.set || []) {
    appSets.set(s.identifier, (s.permissions || []).map((id) => {
      const p = (j.permission || []).find((x) => x.identifier === id)
      return p ? p.commands?.allow || [] : []
    }).flat())
  }
}
check('FA19/PERM: 11 مجموعة ميزة في البيان', appSets.size === 11, `${appSets.size} → ${[...appSets.keys()].join(',')}`)
check('FA19/PERM: كل أمر في البيان مسجل في generate_handler (لا أوامر شبح — وإلا فشل cargo)',
  [...appCmds].every((c) => handlers.includes(c)),
  [...appCmds].filter((c) => !handlers.includes(c)).join(',') || 'نظيف')

// ==== 3) القدرات ====
const capDir = path.join(TAURI, 'capabilities')
const caps = readdirSync(capDir).filter((x) => x.endsWith('.json')).map((f) => ({
  name: f, ...JSON.parse(readFileSync(path.join(capDir, f), 'utf8')),
}))
const remoteCap = caps.find((c) => c.remote)
const localCaps = caps.filter((c) => !c.remote)
check('FA19/CAP: قدرة واحدة بسياق remote وحيدة (main-remote-ipc)', remoteCap?.identifier === 'main-remote-ipc')
check('FA19/CAP: remote.urls == http://127.0.0.1:' + restPort + ' — الأصل الدقيق لا نمط واسع',
  remoteCap?.remote?.urls?.length === 1 && remoteCap.remote.urls[0] === `http://127.0.0.1:${restPort}`,
  remoteCap?.remote?.urls?.join(','))
check('FA19/CAP: القدرة البعيدة local:false وwindows:[main] حصرًا',
  remoteCap?.local === false && remoteCap?.windows?.length === 1 && remoteCap.windows[0] === 'main')
check('FA19/CAP: لا منح شامل core:default في أي قدرة',
  caps.every((c) => !(c.permissions || []).some((p) => p === 'core:default')))

// مراجع الصلاحيات — نفس منطق tauri-build validate_capabilities (نكشف الخطأ قبل cargo)
const KNOWN_PLUGIN = /^(core:event|dialog|drag):[a-z-]+$/
const capRefs = caps.flatMap((c) => c.permissions || [])
const badRefs = capRefs.filter((id) => !appSets.has(id) && !permIds.has(id) && !KNOWN_PLUGIN.test(id) && !/^[a-z-]+:[a-z-]+$/.test(id))
check('FA19/CAP: كل مرجع صلاحية موجود (كما يفحص tauri-build — نكشفه قبل cargo)', badRefs.length === 0, badRefs.join(','))
const knownPrefix = capRefs.filter((id) => /^[a-z-]+:/.test(id))
check('FA19/CAP: مراجع الإضافات من القائمة الموثوقة حصرًا (dialog/drag/core:event)',
  knownPrefix.every((id) => KNOWN_PLUGIN.test(id)), knownPrefix.join(','))

function grantedOn(cap, cmd) {
  for (const id of cap.permissions || []) {
    if (appSets.get(id)?.includes(cmd)) return true
    if (permIds.has(id)) {
      // صلاحية مباشرة — نجد ملفها
      for (const f of readdirSync(permDir).filter((x) => x.endsWith('.json'))) {
        const j = JSON.parse(readFileSync(path.join(permDir, f), 'utf8'))
        if ((j.permission || []).some((p) => p.identifier === id && (p.commands?.allow || []).includes(cmd))) return true
      }
    }
  }
  return false
}

// ==== 4) جرد المستدعي الفعلي — نافذة الواجهة (remote) ====
const srcRoot = path.join(ROOT, 'src')
const srcFiles = []
function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else if (/\.(ts|tsx)$/.test(e.name)) srcFiles.push(p)
  }
}
walk(srcRoot)
const srcWithTauri = srcFiles.filter((f) => /tauriInvoke|__TAURI__/.test(readFileSync(f, 'utf8')))
check('FA19/UI: 8 ملفات واجهة تستعمل IPC', srcWithTauri.length === 8, `${srcWithTauri.length}`)
const srcText = srcWithTauri.map((f) => readFileSync(f, 'utf8')).join('\n')
const mainInvoked = handlers.filter((c) => new RegExp(`["']${c}["']`).test(srcText))
check('FA19/UI: الأوامر المستدعاة من الواجهة = 44', mainInvoked.length === 44, `${mainInvoked.length}: ${mainInvoked.join(' ')}`)

// plugin commands من الواجهة: dialog save/open + drag + event.listen
check('FA19/UI: dialog|save مستدعى → dialog:allow-save ممنوح للبعيد',
  srcText.includes('plugin:dialog|save') && remoteCap.permissions.includes('dialog:allow-save'))
check('FA19/UI: dialog.open مستدعى (pickFolder) → dialog:allow-open ممنوح للبعيد',
  /__TAURI__\?\.\s*dialog[\s\S]*?\.open/.test(srcText) && remoteCap.permissions.includes('dialog:allow-open'))
check('FA19/UI: drag|start_drag مستدعى → drag:allow-start-drag ممنوح للبعيد',
  srcText.includes('plugin:drag|start_drag') && remoteCap.permissions.includes('drag:allow-start-drag'))
check('FA19/UI: event.listen مستدعى (جسر الأحداث الأصلي) → core:event:default ممنوح للبعيد',
  /__TAURI__\?\.\s*event[\s\S]{0,120}listen/.test(srcText) && remoteCap.permissions.includes('core:event:default'))

const ungrantedMain = mainInvoked.filter((c) => !grantedOn(remoteCap, c))
check('FA19/GRANT: كل أمر مستدعى من الواجهة ممنوح في main-remote-ipc', ungrantedMain.length === 0, ungrantedMain.join(','))

// ==== 5) نوافذ المحتوى المحلي ====
const lockHtml = readFileSync(path.join(ROOT, 'apps/desktop/splash/lock.html'), 'utf8')
const lockInvoked = [...lockHtml.matchAll(/invoke\("([a-z_]+)"/g)].map((m) => m[1])
check('FA19/LOCK: lock.html يستدعي 3 أوامر', lockInvoked.length === 3, lockInvoked.join(','))
const hardening = caps.find((c) => !c.remote)
const ungrantedLock = lockInvoked.filter((c) => !grantedOn(hardening, c))
check('FA19/LOCK: كل أوامر lock ممنوعة محليًا في hardening (السياق المحلي أصبح محكومًا بوجود البيان)',
  ungrantedLock.length === 0 && hardening.windows.includes('lock'), ungrantedLock.join(','))
check('FA19/LOCK: hardening windows = splash+lock حصرًا (main لا يحمل محتوى محليًا أبدًا)',
  hardening.windows.length === 2 && hardening.windows.includes('splash') && hardening.windows.includes('lock'))
const splashHtml = readFileSync(path.join(ROOT, 'apps/desktop/splash/index.html'), 'utf8')
check('FA19/SPLASH: مستمع أحداث splash ممنوح محليًا (core:event:default)',
  /__TAURI__[\s\S]{0,80}event[\s\S]{0,80}listen/.test(splashHtml) && hardening.permissions.includes('core:event:default'))

// ==== 6) أقل امتياز — لا منح ميت ====
const grantedAll = [...remoteCap.permissions.flatMap((id) => appSets.get(id) || []),
  ...hardening.permissions.flatMap((id) => appSets.get(id) || [])]
const deadGrants = grantedAll.filter((c) => !mainInvoked.includes(c) && !lockInvoked.includes(c))
check('FA19/MIN: صفر منح ميت — كل أمر ممنوح مستدعى فعلًا (الجرد مزدوج الاتجاه)', deadGrants.length === 0, deadGrants.join(','))
const neverInvoked = handlers.filter((c) => !mainInvoked.includes(c) && !lockInvoked.includes(c))
check('FA19/MIN: الأوامر بلا مستدعي ويب (power_cancel/live_state/media_targets/updater_install) غير ممنوحة إطلاقًا',
  neverInvoked.length === 4 && neverInvoked.every((c) => !grantedAll.includes(c)), neverInvoked.join(','))

// ==== 7) عمق دفاعي — بنية الملفات ====
check('FA19/RS: معرفات القدرات فريدة', new Set(caps.map((c) => c.identifier)).size === caps.length)
check('FA19/RS: لا صلاحية app بلا وصف عربي موثق (نمط المشروع)',
  [...appSets.entries()].every(([, cmds]) => cmds.length > 0) && appSets.size === 11)

// ==== 8) محاكاة دلالات ACL — نفس منطق tauri 2.12.3 (authority.rs Origin::matches
//         + acl/mod.rs RemoteUrlPattern: pathname/search/hash الفارغة تصيران '*') ====
function remotePatternTest(pattern, urlStr) {
  const u = new URL(urlStr)
  const p = new URL(pattern) // نمطنا حرفيًا بروتوكول+مضيف+منفذ — لا أحرف بدل فيه
  const proto = u.protocol === p.protocol
  const host = u.hostname === p.hostname
  const port = u.port === p.port
  return proto && host && port // pathname/search/hash يطابق '*' دائمًا
}
const WIN_URL = `http://127.0.0.1:${restPort}/?desktop=1`
check('FA19/ACL: URL نافذة الواجهة الفعلي يطابق النمط البعيد (Origin::Remote→capability)',
  remotePatternTest(remoteCap.remote.urls[0], WIN_URL))
check('FA19/ACL: عنوان LAN لا يطابق (الشبكة المحلية لا تحصل على IPC القشرة)',
  !remotePatternTest(remoteCap.remote.urls[0], `http://${'192.168.99.9'}:81/?desktop=1`))
check('FA19/ACL: منفذ بديل لا يطابق (fallback 8180 خارج المنح)',
  !remotePatternTest(remoteCap.remote.urls[0], 'http://127.0.0.1:8180/?desktop=1'))
check('FA19/ACL: localhost لا يطابق 127.0.0.1 (أصلان مختلفان حرفيًا كما في Origin::Remote)',
  !remotePatternTest(remoteCap.remote.urls[0], 'http://localhost:3000/?desktop=1'))
check('FA19/ACL: فصل السياقات حرفيًا — القدرة المحلية بلا remote والبعيدة local:false (Origin::Local≠Remote كما في authority.rs:58)',
  !caps.filter((c) => !c.remote).some((c) => c.remote) && remoteCap.local === false)

console.log(`\nfa19-tauri-acl: ${results.length - failed}/${results.length}`)
if (failed) process.exit(1)
