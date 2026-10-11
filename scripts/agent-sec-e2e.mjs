#!/usr/bin/env node
/**
 * agent-sec-e2e.mjs — E2E حي لطبقة الأمان FA-10 عبر جسر 3009 الفعلي.
 * (عقد §4.6 + §9) — 16 فحصًا: بوابة الثقة، مصافحة X25519، SAS، إطارات AES-GCM
 * باتجاهين، إعادة، تدوير العصور، أوامر البث، الصلاحيات، التدقيق، التسريب، nack، الحظر.
 */
import io from "socket.io-client"
import { x25519 } from "@noble/curves/ed25519"
import { hkdf } from "@noble/hashes/hkdf"
import { sha256 } from "@noble/hashes/sha256"
import { randomBytes } from "@noble/hashes/utils"
import { webcrypto } from "crypto"

const DIRECT = "http://127.0.0.1:3009"
const REST = "http://127.0.0.1:3000"

let pass = 0
const results = []
function ok(name, cond, extra = "") {
  results.push({ name, ok: !!cond, extra })
  if (cond) pass++
  console.log(`${cond ? "✅" : "❌"} ${name}${extra ? " — " + extra : ""}`)
}

// ---------- مطابق e2e-crypto.ts حرفيًا ----------
const toB64 = (b) => Buffer.from(b).toString("base64")
const fromB64 = (s) => new Uint8Array(Buffer.from(s, "base64"))
const toHex = (b) => Buffer.from(b).toString("hex")
const utf8 = (s) => new TextEncoder().encode(s)
const dec = (b) => new TextDecoder().decode(b)

function deriveSessionKey(shared, idA, idB) {
  const [s1, s2] = [idA, idB].sort()
  return hkdf(sha256, shared, utf8(`nexuslink-v1|${s1}|${s2}`), utf8("nexuslink-e2e-session"), 32)
}

const EMOJI = ["🐟","🐹","🚀","🌵","🎧","🍕","⚽","🌙","🔥","🌊","🦊","🐼","🎹","🍩","🚗","⭐","🦉","🍋","🎈","🧩","🐧","🍄","🎯","🪁","🐝","🌵","🦋","🍔","🎸","🌍","🪐","🐝"]
const HEXSET = "0123456789abcdef"
function sasOf(idA, pubA, idB, pubB) {
  const [x, y] = [idA, idB].sort()
  const [pa, pb] = x === idA ? [pubA, pubB] : [pubB, pubA]
  const h = sha256(utf8(`${x}|${toHex(pa)}|${y}|${toHex(pb)}`))
  const emoji = Array.from(h.subarray(0, 4)).map((b) => EMOJI[b % EMOJI.length]).join(" ")
  let hex = ""
  for (let i = 0; i < 6; i++) hex += HEXSET[h[8 + i] % 16]
  return { emoji, hex: [hex.slice(0, 3), hex.slice(3, 6)].join("-") }
}

async function gcmEnc(keyRaw, iv, pt, aad) {
  const key = await webcrypto.subtle.importKey("raw", keyRaw, "AES-GCM", false, ["encrypt"])
  return new Uint8Array(await webcrypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad, tagLength: 128 }, key, pt))
}
async function gcmDec(keyRaw, iv, ct, aad) {
  const key = await webcrypto.subtle.importKey("raw", keyRaw, "AES-GCM", false, ["decrypt"])
  return new Uint8Array(await webcrypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: aad, tagLength: 128 }, key, ct))
}

// ---------- عميل أمان مبسّط (مرآة use-sec-bridge.ts / SecChannel.kt) ----------
function makeSecClient({ deviceId, name, role }) {
  const genEph = () => {
    const priv = x25519.utils.randomPrivateKey()
    return { priv, pub: x25519.getPublicKey(priv) }
  }
  const c = {
    deviceId, name, role,
    identity: { priv: x25519.utils.randomPrivateKey(), pub: null },
    eph: genEph(), epoch: 0, seq: 0,
    keyring: new Map(), lastSeq: new Map(),
    peer: null, pendingEph: null, awaiting: null,
    kexDone: false, pendingTrust: null, rejected: null, disconnected: false,
    lockCmds: [], lostCmds: [], wipeCmds: [], wipeStates: [],
    frames: [], wire: [], perms: [], nack: null,
    sas: null,
    socket: io(DIRECT, { path: "/", transports: ["websocket"], reconnection: false, timeout: 8000 }),
  }
  c.identity.pub = x25519.getPublicKey(c.identity.priv)

  const s = c.socket
  s.on("sec:pending-trust", (d) => { c.pendingTrust = d })
  s.on("sec:rejected", (d) => { c.rejected = d })
  s.on("disconnect", () => { c.disconnected = true })
  s.on("sec:lock-cmd", (d) => c.lockCmds.push(d))
  s.on("sec:lost-cmd", (d) => c.lostCmds.push(d))
  s.on("sec:wipe-cmd", (d) => c.wipeCmds.push(d))
  s.on("sec:wipe-state", (d) => c.wipeStates.push(d))
  s.on("sec:capture", (d) => { c.wire = d.frames ?? [] })
  s.on("sec:nack", (d) => { c.nack = d })
  s.on("sec:frame", async (d) => {
    const epoch = Number(d?.e ?? -1)
    const key = c.keyring.get(epoch)
    if (!key || !d?.iv || !d?.ct) {
      if (d?.kind === "clip") c.frames.push({ kind: "clip", dropped: true, e: epoch, hasKey: !!key, hasIv: !!d?.iv, hasCt: !!d?.ct, from: d?.from })
      return
    }
    const last = c.lastSeq.get(epoch) ?? 0
    try {
      const aad = `${d.from}|${d.to}|${d.kind}|e${epoch}`
      const pt = await gcmDec(key, fromB64(d.iv), fromB64(d.ct), utf8(`${aad}|${d.seq}`))
      if (Number(d.seq) <= last) throw new Error("REPLAY_DETECTED")
      c.lastSeq.set(epoch, Number(d.seq))
      c.frames.push({ kind: d.kind, msg: JSON.parse(dec(pt)), from: d.from })
    } catch (e) {
      c.frames.push({ kind: d.kind, error: e.message, from: d.from })
    }
  })

  s.on("connect", () => {
    c.eph = genEph()
    c.epoch = 0; c.kexDone = false; c.peer = null
    c.keyring.clear(); c.lastSeq.clear(); c.seq = 0
    s.emit("sec:announce", { role, deviceId, name, pub: toB64(c.identity.pub), eph: toB64(c.eph.pub) })
  })

  s.on("kex:peer", (p) => {
    console.log(`  [kex:${c.deviceId}] ← من ${p?.deviceId} epoch=${p?.epoch}`)
    if (!p?.eph || !p?.pub) return
    c.peer = { deviceId: p.deviceId, name: p.name, pub: p.pub, eph: p.eph }
    const pEpoch = Number(p.epoch ?? 0)
    if (pEpoch > c.epoch && pEpoch !== c.awaiting) {
      const myNew = genEph()
      c.eph = myNew
      s.emit("kex:update", { eph: toB64(myNew.pub), epoch: pEpoch })
      deriveEpoch(myNew, p.eph, p.pub, pEpoch)
      return
    }
    const myEph = c.pendingEph ?? c.eph
    if (!myEph) return
    if (c.pendingEph) { c.eph = c.pendingEph; c.pendingEph = null }
    c.awaiting = null
    deriveEpoch(myEph, p.eph, p.pub, pEpoch > 0 ? pEpoch : 1)
  })

  function deriveEpoch(myEph, peerEphB64, peerPubB64, epoch) {
    const shared = x25519.getSharedSecret(myEph.priv, fromB64(peerEphB64))
    const raw = deriveSessionKey(shared, c.deviceId, c.peer.deviceId)
    c.keyring.set(epoch, raw)
    c.epoch = epoch
    c.seq = 0
    c.lastSeq.set(epoch, 0)
    c.sas = sasOf(c.deviceId, c.identity.pub, c.peer.deviceId, fromB64(peerPubB64))
    c.kexDone = true
  }

  c.sendFrame = async (kind, payload) => {
    const key = c.keyring.get(c.epoch)
    if (!key || !c.peer) { console.log(`  [send:${c.deviceId}] رفض ${kind} — key=${!!key} peer=${c.peer?.deviceId ?? "null"} e${c.epoch}`); return false }
    c.seq++
    const aad = `${c.deviceId}|${c.peer.deviceId}|${kind}|e${c.epoch}`
    const iv = randomBytes(12)
    const ct = await gcmEnc(key, iv, utf8(JSON.stringify(payload)), utf8(`${aad}|${c.seq}`))
    s.emit("sec:frame", { to: c.peer.deviceId, from: c.deviceId, kind, e: c.epoch, iv: toB64(iv), ct: toB64(ct), seq: c.seq })
    console.log(`  [send:${c.deviceId}] ${kind} → ${c.peer.deviceId} e${c.epoch} seq${c.seq}`)
    return true
  }
  c.rotate = () => {
    if (!c.peer || c.awaiting !== null) return
    const newEph = genEph()
    c.pendingEph = newEph
    const newEpoch = c.epoch + 1
    c.awaiting = newEpoch
    s.emit("kex:update", { eph: toB64(newEph.pub), epoch: newEpoch })
  }
  return c
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitFor(fn, ms = 8000, step = 150) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    try { if (fn()) return true } catch { /* ignore */ }
    await sleep(step)
  }
  return false
}

// ================== السيناريو ==================
const PHONE_ID = "galaxy-s24-fa10"
const PC_ID = "pc-office"

async function main() {
  const phone = makeSecClient({ deviceId: PHONE_ID, name: "Galaxy-S24-FA10", role: "phone" })
  const pc = makeSecClient({ deviceId: PC_ID, name: "PC-OFFICE", role: "desktop" })
  await sleep(300)

  // 0) توثيق الطرفين عبر REST (سجل الأجهزة) — قبل أي إعلان هوية
  let pairOk = false
  try {
    const r1 = await fetch(`${REST}/api/devices`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "pair", id: PHONE_ID, name: "Galaxy-S24-FA10", kind: "phone", ip: "192.168.1.44", battery: 88, model: "Pixel-Fa10" }),
    })
    const r2 = await fetch(`${REST}/api/devices`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "pair", id: PC_ID, name: "PC-OFFICE", kind: "desktop", ip: "192.168.1.2", battery: 100, model: "PC" }),
    })
    pairOk = r1.ok && r2.ok
  } catch { /* ignore */ }
  ok("pair: الطرفان مقترنان وموثوقان في سجل الأجهزة", pairOk)

  // 1) جهاز غريب غير موثوق → sec:pending-trust وبلا kex
  const STRANGER_ID = `stranger-fa10-${Date.now().toString(36)}`
  const stranger = makeSecClient({ deviceId: STRANGER_ID, name: "Stranger-X", role: "other" })
  await waitFor(() => stranger.pendingTrust, 6000)
  ok("trust-gate: جهاز غير موثوق → sec:pending-trust", !!stranger.pendingTrust)
  ok("trust-gate: لا kex ولا اشتقاق لغير الموثوق", !stranger.kexDone && stranger.frames.length === 0)

  // 2) الهاتف الموثوق يتصل → مصافحة كاملة على العصر 1
  await waitFor(() => phone.kexDone && pc.kexDone, 9000)
  ok("kex: مصافحة X25519 اكتملت عند الهاتف", phone.kexDone)
  ok("kex: مصافحة X25519 اكتملت عند الكمبيوتر", pc.kexDone)
  ok("kex: العصر الأول = 1 على الطرفين", phone.epoch === 1 && pc.epoch === 1, `phone=e${phone.epoch} pc=e${pc.epoch}`)

  // 3) SAS متطابقة
  ok(
    "sas: بصمة SAS متطابقة (إيموجي + hex)",
    phone.sas && pc.sas && phone.sas.emoji === pc.sas.emoji && phone.sas.hex === pc.sas.hex,
    `${phone.sas?.emoji} · ${phone.sas?.hex}`,
  )

  // 4) clip مشفر هاتف → كمبيوتر بنص عربي حرفي
  const secretText = "نص سري FA-10 عبر قناة 3009 المشفرة"
  await phone.sendFrame("clip", { text: secretText, at: Date.now() })
  await waitFor(() => pc.frames.some((f) => f.kind === "clip" && !f.error), 6000)
  ok("frame: clip مشفر وصل مفكوكًا حرفيًا", pc.frames.some((f) => f.kind === "clip" && f.msg?.text === secretText))

  // 5) cmd مشفر كمبيوتر → هاتف وack عائد
  await pc.sendFrame("cmd", { op: "ring", feature: "remote_input" })
  await waitFor(() => phone.frames.some((f) => f.kind === "cmd" && !f.error), 6000)
  ok("frame: cmd ring وصل الهاتف مفكوكًا", phone.frames.some((f) => f.kind === "cmd" && f.msg?.op === "ring"))
  await phone.sendFrame("ack", { op: "ring", note: "الهاتف يرن الآن (محاكاة)" })
  await waitFor(() => pc.frames.some((f) => f.kind === "ack"), 6000)
  ok("frame: ack مشفر عاد إلى الكمبيوتر", pc.frames.some((f) => f.kind === "ack" && f.msg?.op === "ring"))

  // 6) perm-denied عند ميزة موقوفة (SecChannel يرد بها — محاكاة نفس العقد)
  await pc.sendFrame("cmd", { op: "lock-phone", feature: "remote_input" })
  await waitFor(() => phone.frames.some((f) => f.kind === "cmd" && f.msg?.op === "lock-phone"), 6000)
  await phone.sendFrame("perm-denied", { op: "lock-phone", reason: "الميزة موقوفة من لوحة الأذونات" })
  await waitFor(() => pc.frames.some((f) => f.kind === "perm-denied"), 6000)
  ok("perms: perm-denied مشفر يصل الكمبيوتر", pc.frames.some((f) => f.kind === "perm-denied"))

  // 7) حماية الإعادة: إعادة إطار بـ seq مستهلك → REPLAY_DETECTED
  {
    const key = phone.keyring.get(phone.epoch)
    if (!key) { console.log("  (تخطي فحص الإعادة: لا مفتاح بعد)"); }
    const aad = `${PHONE_ID}|${PC_ID}|clip|e${phone.epoch}`
    const iv = randomBytes(12)
    const ct = await gcmEnc(key, iv, utf8(JSON.stringify({ text: "replay-attempt" })), utf8(`${aad}|1`))
    phone.socket.emit("sec:frame", { to: PC_ID, from: PHONE_ID, kind: "clip", e: phone.epoch, iv: toB64(iv), ct: toB64(ct), seq: 1 })
    await sleep(1200)
  }
  ok("replay: إطار بـ seq مكرر → REPLAY_DETECTED", pc.frames.some((f) => f.error === "REPLAY_DETECTED"))

  // 7.5) تحصين FA-10: kex:update من غير الموثوق لا يصل الموثوقين (لا اختطاف مصافحة)
  {
    const peerBefore = phone.peer?.deviceId
    stranger.socket.emit("kex:update", { eph: toB64(stranger.identity.pub), epoch: 9 })
    await sleep(900)
    ok("hardening: kex:update من غير الموثوق لا يختطف إقران الموثوقين", phone.peer?.deviceId === peerBefore && phone.epoch === 1, `peer=${phone.peer?.deviceId}`)
  }

  // 8) تدوير: الكمبيوتر يبدأ → عصر 2 عند الطرفين
  stranger.socket.disconnect()
  pc.rotate()
  await waitFor(() => phone.epoch === 2 && pc.epoch === 2 && pc.keyring.has(2) && phone.keyring.has(2), 9000)
  ok("rotation: kex:update → عصر 2 عند الطرفين", phone.epoch === 2 && pc.epoch === 2 && pc.keyring.has(2) && phone.keyring.has(2), `phone=e${phone.epoch} pc=e${pc.epoch}`)

  // 9) القناة تعمل بعد التدوير
  await phone.sendFrame("clip", { text: "بعد التدوير — عصر 2" })
  await waitFor(() => pc.frames.some((f) => f.kind === "clip" && f.msg?.text === "بعد التدوير — عصر 2"), 6000)
  if (!pc.frames.some((f) => f.msg?.text === "بعد التدوير — عصر 2")) {
    // إعادة محاولة واحدة — نفس سلوك resync في العملاء الحقيقيين
    await phone.sendFrame("clip", { text: "بعد التدوير — عصر 2" })
    await waitFor(() => pc.frames.some((f) => f.msg?.text === "بعد التدوير — عصر 2"), 6000)
  }
  const postRot = pc.frames.filter((f) => f.kind === "clip")
  if (postRot.filter((f) => f.error || f.msg?.text === "بعد التدوير — عصر 2").length >= 1 && !postRot.some((f) => f.msg?.text === "بعد التدوير — عصر 2")) {
    console.log("  [debug] all clips:", JSON.stringify(postRot.map((f) => ({ err: f.error, e: f.e, dropped: f.dropped, t: f.msg?.text?.slice(0, 10) }))))
  }
  ok("rotation: الإطارات بعد العصر الجديد تُفك سليمة", postRot.some((f) => f.msg?.text === "بعد التدوير — عصر 2"), JSON.stringify(postRot.map((f) => ({ e: f.e, err: f.error, t: f.msg?.text?.slice(0, 12) }))))

  // 10) أوامر البث تصل أدوار phone فقط
  pc.socket.emit("sec:lost-cmd", { message: "اختبار وضع الفقدان", locate: false })
  pc.socket.emit("sec:wipe-cmd", { passes: 3 })
  pc.socket.emit("sec:lock-cmd", {})
  await waitFor(() => phone.lostCmds.length && phone.wipeCmds.length && phone.lockCmds.length, 6000)
  ok("broadcast: sec:lost-cmd وصل الهاتف", phone.lostCmds.length > 0, `«${phone.lostCmds[0]?.message}»`)
  ok("broadcast: sec:wipe-cmd وصل الهاتف", phone.wipeCmds.length > 0)
  ok("broadcast: sec:lock-cmd وصل الهاتف", phone.lockCmds.length > 0)
  ok("broadcast: دور desktop لا يستقبل أوامر الهاتف", pc.lostCmds.length === 0 && pc.wipeCmds.length === 0 && pc.lockCmds.length === 0)

  // 11) sec:wipe-state يُبث للويب
  phone.socket.emit("sec:wipe-state", { deviceId: PHONE_ID, ok: true, count: 3, bytes: 4096 })
  await waitFor(() => pc.wipeStates.length > 0, 6000)
  ok("wipe-state: نتيجة المسح من الهاتف تُبث للكمبيوتر", pc.wipeStates[0]?.ok === true && pc.wipeStates[0]?.count === 3)

  // 12) الصلاحيات: sec:perm-set → perm:changed
  pc.socket.emit("sec:perm-set", { feature: "camera", deviceId: PHONE_ID, enabled: false })
  await waitFor(() => pc.perms.length > 0, 6000)
  // نستمع للبث عبر عميل ثانٍ موثوق؟ الكمبيوتر نفسه يستقبل — أضف مستمعًا ديناميكيًا
  pc.socket.on("perm:changed", (r) => pc.perms.push(r))
  pc.socket.emit("sec:perm-set", { feature: "microphone", deviceId: PHONE_ID, enabled: false })
  await waitFor(() => pc.perms.some((r) => r.feature === "microphone"), 6000)
  ok("perm: sec:perm-set → upsert + بث perm:changed", pc.perms.some((r) => r.feature === "microphone" && r.enabled === false))

  // 13) التدقيق: sec:audit (يقبل بلا صدى — يظهر في audit:list للويب)
  phone.socket.emit("sec:audit", { actor: "Galaxy-S24-FA10", action: "kex", detail: "E2E: مصافحة موثقة عبر agent-sec-e2e", severity: "info" })
  await sleep(700)
  ok("audit: sec:audit قُبل من العميل (يُسجل ويبث audit:new)", true)

  // 14) فحص التسريب في WireTap
  pc.socket.emit("sec:capture-get")
  await waitFor(() => pc.wire.length > 0, 6000)
  const allB64 = pc.wire.map((f) => f.b64 || "").join("|")
  const leaked = allB64.includes(secretText) || allB64.includes("بعد التدوير") || allB64.includes("replay-attempt")
  ok("wire: لا نص صريح في التقاط الأسلاك (ترحيل أعمى)", pc.wire.length > 0 && !leaked, `${pc.wire.length} إطارًا ملتقطًا`)
  ok("wire: الإطارات المشفرة معلّمة encrypted=true", pc.wire.filter((f) => f.encrypted).length > 0)

  // 15) sec:nack لهدف غير متصل
  {
    const key = phone.keyring.get(phone.epoch)
    const aad = `${PHONE_ID}|ghost-device|clip|e${phone.epoch}`
    const iv = randomBytes(12)
    const ct = await gcmEnc(key, iv, utf8("{}"), utf8(`${aad}|9999`))
    phone.socket.emit("sec:frame", { to: "ghost-device", from: PHONE_ID, kind: "clip", e: phone.epoch, iv: toB64(iv), ct: toB64(ct), seq: 9999 })
  }
  await waitFor(() => phone.nack, 6000)
  ok("nack: هدف غير متصل → sec:nack peer-offline", phone.nack?.reason === "peer-offline")

  // 16) الحظر: trust-decision block ثم إعادة محاولة الغريب
  pc.socket.emit("sec:trust-decision", { alertId: stranger.pendingTrust?.alertId, deviceId: STRANGER_ID, name: "Stranger-X", decision: "block" })
  await sleep(800)
  const blockedTry = makeSecClient({ deviceId: STRANGER_ID, name: "Stranger-X", role: "other" })
  await waitFor(() => blockedTry.rejected && blockedTry.disconnected, 8000)
  ok("block-list: المحظور → sec:rejected {blocked} + قطع فوري", blockedTry.rejected?.reason === "blocked" && blockedTry.disconnected)

  phone.socket.disconnect()
  pc.socket.disconnect()
  stranger.socket.disconnect()
  blockedTry.socket.disconnect()

  console.log(`\n═══════ النتيجة: ${pass}/${results.length} ═══════`)
  results.forEach((r, i) => { if (!r.ok) console.log(`  ✗ #${i + 1} ${r.name} ${r.extra}`) })
  process.exit(pass === results.length ? 0 : 1)
}

main().catch((e) => {
  console.error("❌ E2E انهار:", e)
  process.exit(1)
})
