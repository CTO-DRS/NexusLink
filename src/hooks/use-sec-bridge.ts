"use client"
// NexusLink — المرحلة 10: جسر الأمان على العميل (كلا الطرفين)
// مصافحة X25519 حقيقية → مفتاح جلسة AES-256-GCM → كل الإطارات مشفرة
// + تدوير مفاتيح بعصور (epochs) + حماية إعادة + نقل ملفات + أوامر + لصق آمن
import { useEffect, useRef } from "react"
import { toast } from "sonner"
import { getSecSocket } from "@/lib/sec-socket"
import { useSec, type PermRow } from "@/lib/sec-store"
import {
  generateIdentity, ecdh, deriveSessionKey, importSessionKey, seal, open,
  sasOf, fingerprintOf, toB64, fromB64, utf8ToBytes, bytesToUtf8, zeroize, sha256Hex,
  type Identity,
} from "@/lib/nexus/e2e-crypto"

const CHUNK = 48 * 1024
const ROTATE_MS = 180_000

// ---------- حالة التشفير على مستوى الوحدة (خارج React) ----------
const S = {
  role: "desktop" as "desktop" | "phone",
  deviceId: "pc-office",
  name: "PC-OFFICE",
  identity: null as Identity | null,
  eph: null as Identity | null,
  epoch: 0,
  keyring: new Map<number, CryptoKey>(),
  seq: 0,
  lastSeqByEpoch: new Map<number, number>(),
  pendingEph: null as Identity | null,
  awaitingEpoch: null as number | null,
  resyncAt: 0,
  peerKeys: null as { deviceId: string; name: string; pub: string | null; eph: string | null } | null,
  chunksIn: new Map<string, { meta: { name: string; size: number; hash: string; stealth: boolean }; parts: (Uint8Array | null)[]; received: number }>(),
  sendingLock: false,
}

export const SEC_FEATURES = [
  { id: "file_transfer", name: "نقل الملفات", hint: "إرسال واستقبال الملفات عبر القناة" },
  { id: "clipboard", name: "الحافظة الآمنة", hint: "مشاركة نصوص مشفرة بين الأجهزة" },
  { id: "remote_input", name: "التحكم عن بُعد", hint: "أوامر الرن والتنبيه والقفل" },
  { id: "notifications", name: "مرآة الإشعارات", hint: "إظهار إشعارات الهاتف على الكمبيوتر" },
  { id: "media", name: "الوسائط والبث", hint: "البث والكاميرا والميكروفون" },
  { id: "system_commands", name: "أوامر النظام", hint: "إيقاف/إعادة تشغيل/أوامر حساسة" },
] as const

export function roleDeviceInfo(role: "desktop" | "phone") {
  return role === "desktop"
    ? { deviceId: "pc-office", name: "PC-OFFICE" }
    : { deviceId: "galaxy-s24", name: "Galaxy-S24" }
}

// ---------- هوية محفوظة ----------
function loadIdentity(): Identity {
  const key = `nl-sec-identity-${S.role}`
  try {
    const raw = localStorage.getItem(key)
    if (raw) {
      const j = JSON.parse(raw) as { pub: string; priv: string }
      return { pub: fromB64(j.pub), priv: fromB64(j.priv) }
    }
  } catch { /* ignore */ }
  const id = generateIdentity()
  try {
    localStorage.setItem(key, JSON.stringify({ pub: toB64(id.pub), priv: toB64(id.priv) }))
  } catch { /* ignore */ }
  return id
}

// ---------- إرسال إطار مشفر ----------
async function sendFrame(kind: string, payload: Record<string, unknown>, opts?: { to?: string; quiet?: boolean }) {
  const key = S.keyring.get(S.epoch)
  const peer = S.peerKeys
  if (!key || !peer || !S.identity || !S.eph) {
    if (!opts?.quiet) toast.error("القناة غير مشفرة بعد — لا توجد جلسة مفاتيح")
    return false
  }
  S.seq++
  const aad = `${S.deviceId}|${peer.deviceId}|${kind}|e${S.epoch}`
  const frame = await seal(key, utf8ToBytes(JSON.stringify(payload)), S.seq, aad)
  const { getSecSocket } = await import("@/lib/sec-socket")
  getSecSocket().emit("sec:frame", {
    to: peer.deviceId, from: S.deviceId, kind, e: S.epoch,
    iv: frame.iv, ct: frame.ct, seq: frame.seq,
  })
  useSec.getState().setCounters({ framesSent: useSec.getState().framesSent + 1 })
  return true
}

// ---------- اشتقاق مفتاح عصر جديد ----------
async function deriveEpoch(myEph: Identity, peerEphB64: string, peerPubB64: string, epoch: number) {
  if (!S.identity) return
  const shared = ecdh(myEph.priv, fromB64(peerEphB64))
  const raw = deriveSessionKey(shared, S.deviceId, S.peerKeys?.deviceId ?? "peer")
  const key = await importSessionKey(raw)
  S.keyring.set(epoch, key)
  S.epoch = epoch
  S.seq = 0
  S.lastSeqByEpoch.set(epoch, 0)
  zeroize(raw, shared)
  // تحقق بصري SAS (ثابت على الهوية — يتطابق على الطرفين حتماً)
  const sas = sasOf(S.deviceId, S.identity.pub, S.peerKeys!.deviceId, fromB64(peerPubB64))
  useSec.getState().setKex({
    myPub: toB64(S.identity.pub),
    myFingerprint: fingerprintOf(S.identity.pub),
    peer: { deviceId: S.peerKeys!.deviceId, name: S.peerKeys!.name, role: "", pub: peerPubB64, eph: peerEphB64 },
    kexDone: true,
    sas,
  })
}

// ---------- استقبال إطار مشفر ----------
async function onSecureFrame(d: { to?: string; from?: string; kind?: string; e?: number; iv?: string; ct?: string; seq?: number }) {
  const epoch = Number(d?.e ?? -1)
  let key = S.keyring.get(epoch)
  if (!key || !d?.iv || !d?.ct) {
    // عصر مفتاح غير معروف → إعادة مزامنة ذاتية (مرة كل 5 ثوانٍ كحد أقصى)
    if (d?.iv && Date.now() - S.resyncAt > 5000) {
      S.resyncAt = Date.now()
      const { getSecSocket } = await import("@/lib/sec-socket")
      if (S.identity && S.eph) {
        getSecSocket().emit("sec:announce", { role: S.role, deviceId: S.deviceId, name: S.name, pub: toB64(S.identity.pub), eph: toB64(S.eph.pub) })
      }
    }
    return
  }
  const last = S.lastSeqByEpoch.get(epoch) ?? 0
  try {
    const aad = `${d.from}|${d.to}|${d.kind}|e${epoch}`
    const pt = await open(key, { iv: d.iv, ct: d.ct, seq: Number(d.seq) }, aad, last)
    S.lastSeqByEpoch.set(epoch, Number(d.seq))
    const msg = JSON.parse(bytesToUtf8(pt)) as Record<string, unknown>
    await handleDecrypted(String(d.kind), msg, String(d.from))
  } catch (e) {
    if (e instanceof Error && e.message === "REPLAY_DETECTED") {
      toast.error("حماية الإعادة: إطار مكرر تم رفضه")
      useSec.getState().addAudit({ id: `replay-${Date.now()}`, at: Date.now(), actor: "الأمان", action: "replay", detail: "رفض إطار مكرر (حماية Replay)", severity: "warn", stealth: false })
    }
  }
}

// ---------- توجيه المحتوى المفكوك ----------
async function handleDecrypted(kind: string, msg: Record<string, unknown>, from: string) {
  const st = useSec.getState()
  const isDesktop = S.role === "desktop"

  if (kind === "file-meta") {
    S.chunksIn.set(String(msg.tid), {
      meta: { name: String(msg.name), size: Number(msg.size), hash: String(msg.hash), stealth: !!msg.stealth },
      parts: new Array(Number(msg.chunks)).fill(null), received: 0,
    })
    st.setTransfer({ name: String(msg.name), size: Number(msg.size), sent: 0, stealth: !!msg.stealth, direction: "in", status: "active", startedAt: Date.now() })
    return
  }

  if (kind === "file-chunk") {
    const job = S.chunksIn.get(String(msg.tid))
    if (!job) return
    const idx = Number(msg.idx)
    const bytes = fromB64(String(msg.data))
    job.parts[idx] = bytes
    job.received++
    st.updateTransfer({ sent: job.received * CHUNK })
    if (!!msg.zeroAfter) zeroize(bytes) // تخفي: لا بقاء في الذاكرة أطول من اللازم
    return
  }

  if (kind === "file-end") {
    const job = S.chunksIn.get(String(msg.tid))
    if (!job) return
    const total = job.parts.reduce((a, b) => a + (b?.length ?? 0), 0)
    const all = new Uint8Array(total)
    let off = 0
    for (const p of job.parts) { if (p) { all.set(p, off); off += p.length } }
    const hash = await sha256Hex(all)
    const hashOk = hash === job.meta.hash
    const stealth = job.meta.stealth
    S.chunksIn.delete(String(msg.tid))

    if (stealth) {
      // وضع التخفي: بطاقة حية مؤقتة فقط — لا سجل، لا حفظ، ثم صفرنة
      st.setTransfer({ name: job.meta.name, size: total, sent: total, stealth: true, direction: "in", status: "done", hashOk, startedAt: Date.now() })
      st.setRecvEphemeral({ name: job.meta.name, size: total, at: Date.now() })
      setTimeout(() => { st.setRecvEphemeral(null); st.setTransfer(null) }, 4000)
      zeroize(all)
      toast.success("استلام تخفي مكتمل — لن يظهر في السجل نهائياً", { description: `${job.meta.name} · بصمة مطابقة: ${hashOk ? "نعم" : "لا"}` })
      st.setCheck("stealth", true)
      return
    }

    if (hashOk) {
      // حفظ محلي (يمثل حفظ الهاتف للملف المستلم)
      let bin = ""
      for (let i = 0; i < all.length; i++) bin += String.fromCharCode(all[i])
      try {
        const r = await fetch("/api/security/recv", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: job.meta.name, dataB64: btoa(bin), sha256: hash }),
        })
        const j = await r.json()
        st.setTransfer({ name: job.meta.name, size: total, sent: total, stealth: false, direction: "in", status: "done", hashOk, startedAt: Date.now() })
        toast.success(`فُك التشفير وحُفظ: ${j.saved ?? job.meta.name}`, { description: `SHA-256 مطابق ✓ · ${(total / 1024).toFixed(1)}KB مفكوكة في متصفح المستقبِل` })
        st.setCheck("transfer", true)
      } catch {
        st.updateTransfer({ status: "error", error: "فشل الحفظ" })
      }
    } else {
      st.updateTransfer({ status: "error", error: "بصمة SHA-256 غير مطابقة!" })
      toast.error("فشل التحقق من سلامة الملف")
    }
    zeroize(all)
    return
  }

  if (kind === "cmd") {
    const op = String(msg.op)
    const feature = String(msg.feature || "remote_input")
    const rule = st.perms.find((p) => p.feature === feature && p.deviceId === S.deviceId)
    if (rule && !rule.enabled) {
      await sendFrame("perm-denied", { feature, op, reason: "الميزة موقوفة من صلاحيات الجهاز" }, { quiet: true })
      st.addAudit({ id: `denied-${Date.now()}`, at: Date.now(), actor: S.name, action: "perm-denied", detail: `رفض أمر «${op}» — صلاحية «${feature}» موقوفة لهذا الجهاز`, severity: "warn", stealth: false })
      return
    }
    if (op === "ring") {
      try { navigator.vibrate?.([400, 150, 400, 150, 600]) } catch { /* ignore */ }
      toast.success("أمر رن مفكوك التشفير — الهاتف يهتز الآن", { description: "وصلك أمر مشفر عبر القناة الآمنة" })
      await sendFrame("ack", { op: "ring", note: "الهاتف رن" }, { quiet: true })
      return
    }
    if (op === "lock-phone") {
      window.dispatchEvent(new CustomEvent("nl-sec-lock-now"))
      toast.info("قُفل التطبيق بأمر من الكمبيوتر")
      return
    }
    toast.info(`أمر مشفر مستلم: ${op}`)
    return
  }

  if (kind === "perm-denied") {
    st.addAudit({ id: `denied-${Date.now()}`, at: Date.now(), actor: "Galaxy-S24", action: "perm-denied", detail: `رفض تنفيذ «${String(msg.op)}» — ${String(msg.reason)}`, severity: "warn", stealth: false })
    void clientAudit({ actor: "Galaxy-S24", action: "perm-denied", detail: `رفض تنفيذ «${String(msg.op)}» — ${String(msg.reason)}`, severity: "warn" })
    st.setCheck("perms", true)
    toast.error("رُفض الأمر: الصلاحية موقوفة على الهاتف", { description: String(msg.reason) })
    return
  }

  if (kind === "ack") {
    toast.success(`تأكيد مشفر من الهاتف: ${String(msg.note ?? msg.op)}`)
    st.setCheck("perms", true)
    return
  }

  if (kind === "clip") {
    st.setReceivedClip({ text: String(msg.text), from, at: Date.now() })
    st.setCheck("clip", true)
    toast.success("نص مشفر وصل من الهاتف — جاهز للصق", { description: "قناة الحافظة الآمنة" })
    return
  }
}

// ============ الهوك الرئيسي ============
export function useSecBridge(role: "desktop" | "phone") {
  const startedRef = useRef(false)

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    S.role = role
    const info = roleDeviceInfo(role)
    S.deviceId = info.deviceId
    S.name = info.name
    S.identity = loadIdentity()
    S.eph = generateIdentity()
    // نقطة تشخيص للفحص من الكونسول
    ;(window as unknown as { __nlSecDbg?: typeof S }).__nlSecDbg = S

    void fetch("/api/security/boot").catch(() => { /* ignore */ })
    const socket = getSecSocket()
    const st = useSec.getState()

    socket.on("connect", () => {
      st.setBridgeOnline(true)
      socket.emit("sec:announce", {
        role, deviceId: S.deviceId, name: S.name,
        pub: toB64(S.identity!.pub), eph: toB64(S.eph!.pub),
      })
      socket.emit("sec:perm-get")
      socket.emit("audit:get", { limit: 250 })
      // الهاتف يعلن حالة قفله
      if (role === "phone") {
        try {
          const cfg = JSON.parse(localStorage.getItem("nl-sec-lock") || "{}")
          socket.emit("sec:lock-state", {
            locked: (window as unknown as { __nlSecLocked?: boolean }).__nlSecLocked ?? false,
            hasPin: !!cfg.pin, hasPattern: !!cfg.pattern, hasBiometric: !!cfg.credId,
            autoLockSec: cfg.autoLockSec ?? 60,
          })
        } catch { /* ignore */ }
      }
    })
    socket.on("disconnect", () => {
      useSec.getState().setBridgeOnline(false)
      useSec.getState().setKex({ myPub: useSec.getState().myPub, myFingerprint: useSec.getState().myFingerprint, peer: null, kexDone: false, sas: null })
      S.keyring.clear()
      S.epoch = 0
      S.eph = generateIdentity()
    })

    socket.on("sec:hello", (d: { stealth?: boolean; counters?: { frames?: number; bytes?: number; rotations?: number } }) => {
      if (typeof d?.stealth === "boolean") useSec.getState().setStealth(d.stealth)
      if (d?.counters) useSec.getState().setCounters({ framesSent: d.counters.frames ?? 0, bytesOnWire: d.counters.bytes ?? 0, rotations: d.counters.rotations ?? 0 })
    })

    // ==== مصافحة الطرف الآخر / رد التدوير ====
    socket.on("kex:peer", async (p: { deviceId: string; name: string; pub: string | null; eph: string | null; epoch?: number }) => {
      if (!p?.eph || !p?.pub) return
      S.peerKeys = { deviceId: p.deviceId, name: p.name, pub: p.pub, eph: p.eph }
      const pEpoch = Number(p.epoch ?? 0)
      if (pEpoch > S.epoch && pEpoch !== S.awaitingEpoch) {
        // الطرف الآخر بدأ تدويراً — نجيب بمفاتيح رجيعية جديدة لنفس العصر ثم نشتق فوراً
        const myNew = generateIdentity()
        S.eph = myNew
        socket.emit("kex:update", { eph: toB64(myNew.pub), epoch: pEpoch })
        await deriveEpoch(myNew, p.eph, p.pub, pEpoch)
        useSec.getState().setCheck("kex", true)
        return
      }
      const myEph = S.pendingEph ?? S.eph
      if (!myEph) return
      if (S.pendingEph) { S.eph = S.pendingEph; S.pendingEph = null }
      S.awaitingEpoch = null
      // مصافحة جديدة بلا عصر (اتصال أول أو بعد إعادة تحميل صفحة) → العصران يتطابقان على 1 دائماً
      const epoch = pEpoch > 0 ? pEpoch : 1
      await deriveEpoch(myEph, p.eph, p.pub, epoch)
      useSec.getState().setCheck("kex", true)
    })

    // ==== الإطارات المشفرة ====
    socket.on("sec:frame", (d: Record<string, unknown>) => { void onSecureFrame(d as Parameters<typeof onSecureFrame>[0]) })

    // ==== الالتقاط الأسلاكي ====
    socket.on("sec:wire-frame", (f: Parameters<ReturnType<typeof useSec.getState>["addWire"]>[0]) => {
      if (!useSec.getState().capturePaused) useSec.getState().addWire(f)
    })
    socket.on("sec:capture", (d: { frames: Parameters<ReturnType<typeof useSec.getState>["setWire"]>[0] }) => useSec.getState().setWire(d.frames))
    socket.on("sec:capture-cleared", () => useSec.getState().setWire([]))

    // ==== التنبيهات ====
    socket.on("sec:alert", (a: Parameters<ReturnType<typeof useSec.getState>["addAlert"]>[0]) => {
      useSec.getState().addAlert(a)
      toast.error("تنبيه أمني: محاولة اتصال جهاز غير موثوق!", { description: `${a.name} (${a.deviceId}) — راجع واجهة الأمان`, duration: 10000 })
    })
    socket.on("sec:alert-resolved", (d: { alertId?: string; decision?: string }) => {
      if (d?.alertId) useSec.getState().resolveAlert(d.alertId, d.decision ?? "ignored")
    })

    // ==== الصلاحيات ====
    socket.on("perm:rules", (rules: PermRow[]) => useSec.getState().setPerms(rules))
    socket.on("perm:changed", (rule: PermRow) => useSec.getState().upsertPerm(rule))

    // ==== التدقيق ====
    socket.on("audit:list", (rows: Parameters<ReturnType<typeof useSec.getState>["setAudit"]>[0]) => useSec.getState().setAudit(rows))
    socket.on("audit:new", (row: Parameters<ReturnType<typeof useSec.getState>["addAudit"]>[0]) => useSec.getState().addAudit(row))
    socket.on("audit:cleared", () => useSec.getState().setAudit([]))

    // ==== الحذف الآمن ====
    socket.on("wipe:progress", (p: Parameters<ReturnType<typeof useSec.getState>["setWipeJob"]>[0]) => useSec.getState().setWipeJob(p))
    socket.on("wipe:done", (r: Parameters<ReturnType<typeof useSec.getState>["setWipeResult"]>[0]) => {
      if (!r) return
      useSec.getState().setWipeJob(null)
      useSec.getState().setWipeResult(r)
      if (r.ok) { useSec.getState().setCheck("wipe", true); toast.success("اكتمل الحذف الآمن — الملف لم يعد قابلاً للاسترجاع") }
      else toast.error(`فشل الحذف: ${r.error ?? "غير معروف"}`)
    })

    // ==== التخفي + قفل الهاتف ====
    socket.on("sec:stealth", (d: { on: boolean }) => useSec.getState().setStealth(d.on))
    socket.on("sec:lock-state", (d: Parameters<ReturnType<typeof useSec.getState>["setPhoneLock"]>[0]) => useSec.getState().setPhoneLock(d))
    socket.on("sec:lock-cmd", () => {
      // مسار احتياطي غير مشفر — الأمر الرسمي يمر عبر sec:frame المشفر
      window.dispatchEvent(new CustomEvent("nl-sec-lock-now"))
    })

    // تدوير تلقائي كل 3 دقائق
    const iv = window.setInterval(() => { void rotateKeys() }, ROTATE_MS)

    return () => window.clearInterval(iv)
  }, [role])
}

/** تدوير المفاتيح الآن (PFS-style): عصر جديد بمفاتيح رجيعية جديدة */
export async function rotateKeys() {
  const socket = (await import("@/lib/sec-socket")).getSecSocket()
  if (!S.peerKeys || !S.identity || S.awaitingEpoch) return
  const newEph = generateIdentity()
  S.pendingEph = newEph
  const newEpoch = S.epoch + 1
  S.awaitingEpoch = newEpoch
  socket.emit("kex:update", { eph: toB64(newEph.pub), epoch: newEpoch })
  // الجانب الآخر سيجيب بمفاتيحه لنفس العصر عبر kex:peer → الاشتقاق يكتمل عند الطرفين
}

// ============ واجهات الإرسال ============

/** نقل ملف مشفر كامل (بايتات → chunks → AES-GCM) */
export async function sendEncryptedFile(bytes: Uint8Array, name: string, stealth: boolean) {
  const tid = `t${Date.now().toString(36)}`
  const hash = await sha256Hex(bytes)
  const total = Math.max(1, Math.ceil(bytes.length / CHUNK))
  const ok = await sendFrame("file-meta", { tid, name, size: bytes.length, stealth, hash, chunks: total })
  if (!ok) return false
  const st = useSec.getState()
  st.setTransfer({ name, size: bytes.length, sent: 0, stealth, direction: "out", status: "active", startedAt: Date.now() })
  for (let i = 0; i < total; i++) {
    try {
      const part = bytes.subarray(i * CHUNK, Math.min((i + 1) * CHUNK, bytes.length))
      const sent = await sendFrame("file-chunk", { tid, idx: i, data: toB64(part), zeroAfter: stealth }, { quiet: true })
      if (!sent) { toast.error(`توقف الإرسال عند القطعة ${i} — القناة غير جاهزة`); st.updateTransfer({ status: "error", error: `قناة غير جاهزة عند ${i}` }); return false }
      st.updateTransfer({ sent: Math.min((i + 1) * CHUNK, bytes.length) })
      if (stealth) zeroize(part)
      await new Promise((r) => setTimeout(r, 12))
    } catch (err) {
      console.error("[sec] chunk send failed:", i, err)
      toast.error(`فشل إرسال القطعة ${i}: ${err instanceof Error ? err.message : String(err)}`)
      st.updateTransfer({ status: "error", error: String(err) })
      return false
    }
  }
  await sendFrame("file-end", { tid }, { quiet: true })
  st.setTransfer({ name, size: bytes.length, sent: bytes.length, stealth, direction: "out", status: "done", hashOk: true, startedAt: Date.now() })
  if (!stealth) { st.setCheck("transfer", true); zeroize(bytes) }
  else setTimeout(() => st.setTransfer(null), 3500)
  return true
}

/** أمر مشفر للهاتف */
export async function sendSecureCmd(op: string, feature: string) {
  return sendFrame("cmd", { op, feature, at: Date.now() })
}

/** لصق آمن (نص مشفر) */
export async function sendSecureClip(text: string) {
  return sendFrame("clip", { text, at: Date.now() })
}

/** إعلام بأن قفل الهاتف تغيّر (من هوك الهاتف) */
export async function announceLockState(state: Record<string, unknown>) {
  const { getSecSocket } = await import("@/lib/sec-socket")
  getSecSocket().emit("sec:lock-state", state)
}

/** إرسال سجل تدقيق من العميل */
export async function clientAudit(entry: { actor: string; action: string; detail: string; severity?: "info" | "warn" | "critical" }) {
  try {
    const { getSecSocket } = await import("@/lib/sec-socket")
    getSecSocket()?.emit("sec:audit", entry)
  } catch { /* ignore */ }
}
