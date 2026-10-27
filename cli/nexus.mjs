#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// NexusLink CLI — كل عملية قابلة للأتمتة من الطرفية (عقد §34.ج — M3.3)
// ============================================================
// صفر اعتماد — يعيد استخدام SDK 2.0 (sdk/index.mjs) وهو أول تكامل فعلي
// فوق الـSDK: ما لا يفعله الـCLI لا يعلنه الـSDK. محلي حصرًا بحرس الـSDK.

import { NexusLink, NexusError } from "../sdk/index.mjs"

const argv = process.argv.slice(2)
const flags = { port: 3000, url: "", json: false }
const args = []
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === "--port") flags.port = Number(argv[++i])
  else if (a === "--url") flags.url = argv[++i]
  else if (a === "--json") flags.json = true
  else args.push(a)
}

function out(data) {
  console.log(typeof data === "string" ? data : JSON.stringify(data, null, 2))
}
function fail(msg, code = 1) {
  console.error(`خطأ: ${msg}`)
  process.exit(code)
}

const HELP = `NexusLink CLI (عقد 2.0 — محلي حصرًا)

الاستخدام: node cli/nexus.mjs <أمر> [معاملات] [--port 3000 | --url http://127.0.0.1:3000] [--json]

الأوامر:
  version                     إصدار التطبيق وسجل الإصدارات
  health                      فحص صحة الخادم المضمن
  status                      ملخص: إصدار + أجهزة + رؤوس المزامنة
  devices                     قائمة الأجهزة وحالتها
  device <id>                 جهاز واحد
  ops [since]                 سجل العمليات (رأس + نافذة — بلا حمولات F6)
  transfers                   قوائم النقل النشطة
  search <q>                  البحث الموحد (8 مخازن محلية)
  ask <q>                     المساعد المحلي
  insights                    لوحة الرؤى (14 يومًا)
  automation list             قواعد الروتين
  automation add <name> '<json trigger/action>'
  automation rm <id>          حذف قاعدة
  automation fires            آخر الإطلاقات المرسوخة
  market list                 القناة الموقعة + المثبت
  market install <id>         تثبيت تكامل من القناة
  market uninstall <id>       إزالة تكامل
  market sign <file.json>     توقيع manifest بمفتاح القناة المحلية (للمؤلفين)

أمثلة:
  node cli/nexus.mjs status
  node cli/nexus.mjs automation add "تنبيه" '{"trigger":{"kind":"battery.below","threshold":20},"action":{"kind":"notify","text":"بطارية منخفضة"}}'
  node cli/nexus.mjs search ملاحظات --json
`

async function main() {
  let nx
  try {
    nx = new NexusLink(flags.url ? { url: flags.url } : { port: flags.port })
  } catch (e) {
    fail(e instanceof NexusError ? e.message : String(e))
  }
  const [cmd, sub, ...rest] = args

  switch (cmd) {
    case undefined:
    case "help": console.log(HELP); return
    case "version": out(await nx.version()); return
    case "health": out(await nx.health()); return
    case "devices": out((await nx.devices()).devices); return
    case "device": {
      if (!sub) fail("معرف الجهاز مطلوب")
      const d = await nx.device(sub)
      if (!d) fail("الجهاز غير موجود", 2)
      out(d); return
    }
    case "ops": out(await nx.ops(rest[0] !== undefined ? Number(rest[0]) : undefined)); return
    case "transfers": out((await nx.transfers()).jobs); return
    case "search": {
      const q = sub ? [sub, ...rest].join(" ") : ""
      if (!q) fail("استعلام البحث مطلوب")
      out(await nx.search(q)); return
    }
    case "ask": {
      const q = sub ? [sub, ...rest].join(" ") : ""
      if (!q) fail("سؤال المساعد مطلوب")
      out(await nx.ask(q)); return
    }
    case "insights": out(await nx.insights()); return
    case "automation": {
      if (sub === "list") { out(await nx.automation.list()); return }
      if (sub === "fires") { out(await nx.automation.fires()); return }
      if (sub === "add") {
        const name = rest[0]
        const raw = rest.slice(1).join(" ")
        if (!name || !raw) fail("الاستخدام: automation add <name> '<json>'")
        let body
        try { body = JSON.parse(raw) } catch { fail("JSON القاعدة غير صالح") }
        const r = await nx.automation.upsert({ name, enabled: true, ...body })
        out(r); return
      }
      if (sub === "rm") {
        if (!rest[0]) fail("معرف القاعدة مطلوب")
        out(await nx.automation.remove(rest[0])); return
      }
      fail(`أمر أتمتة غير معروف: ${sub ?? "(فارغ)"}`)
      return
    }
    case "market": {
      if (sub === "list") {
        const j = await nx.market.list()
        if (flags.json) { out(j); return }
        out(j.channel.map((c) => `${c.manifest.id}  v${c.manifest.version}  [${c.manifest.capabilities.join(",") || "بلا قدرات"}]  ${c.manifest.name}`))
        out(`--- مثبت محليًا: ${j.installed.length}`)
        for (const p of j.installed) out(`${p.manifest.id}  v${p.manifest.version}  (مثبت ${new Date(p.installedAt).toISOString()})`)
        return
      }
      if (sub === "install") {
        if (!rest[0]) fail("معرف التكامل مطلوب")
        const j = await nx.market.list()
        const item = j.channel.find((c) => c.manifest.id === rest[0])
        if (!item) fail("التكامل ليس في القناة", 2)
        out(await nx.market.install(item.manifest, item.sig)); return
      }
      if (sub === "uninstall") {
        if (!rest[0]) fail("معرف التكامل مطلوب")
        out(await nx.market.uninstall(rest[0])); return
      }
      if (sub === "sign") {
        if (!rest[0]) fail("مسار ملف manifest مطلوب")
        const { readFileSync } = await import("node:fs")
        let manifest
        try { manifest = JSON.parse(readFileSync(rest[0], "utf8")) } catch (e) { fail(`ملف غير صالح: ${e.message}`) }
        out(await nx.market.sign(manifest)); return
      }
      fail(`أمر سوق غير معروف: ${sub ?? "(فارغ)"}`)
      return
    }
    case "status": {
      const [v, d, o] = await Promise.all([nx.version(), nx.devices(), nx.ops()])
      const devices = d.devices ?? []
      out({
        version: v.current,
        devices: { total: devices.length, connected: devices.filter((x) => x.state === "connected").length },
        syncOps: { head: o.head, count: o.count },
      })
      return
    }
    default: fail(`أمر غير معروف: ${cmd} — جرّب help`)
  }
}

main().catch((e) => {
  if (e instanceof NexusError) fail(`NexusError ${e.status}: ${e.message} (${e.path})`)
  fail(e instanceof Error ? e.message : String(e))
})
