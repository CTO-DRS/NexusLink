"use client"
// NexusLink — المرحلة 10: محرك التشفير E2E الفعلي (يعمل في المتصفح على كلا الطرفين)
// ============================================================
// X25519 لتبادل المفاتيح (ECDH) + HKDF-SHA256 لاشتقاق مفتاح الجلسة
// + AES-256-GCM لتشفير كل إطار بيانات + حماية من الإعادة (seq)
// + بصمة SAS (إيموجي + hex) للتحقق البصري من عدم وجود رجل في المنتصف
// + PBKDF2-SHA256 لتخزين PIN/النمط بقسمة واحدة لا عكسية
import { x25519 } from "@noble/curves/ed25519"
import { hkdf } from "@noble/hashes/hkdf"
import { sha256 } from "@noble/hashes/sha256"

export const SUITE = "X25519 · HKDF-SHA256 · AES-256-GCM"
const PBKDF2_ITERS = 150_000

// ---------- أدوات بايتات ----------
const enc = new TextEncoder()
const dec = new TextDecoder()

export function toB64(b: Uint8Array): string {
  let s = ""
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i])
  return btoa(s)
}
export function fromB64(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
export function toHex(b: Uint8Array, sep = ""): string {
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join(sep)
}
export function utf8ToBytes(s: string): Uint8Array { return enc.encode(s) }
export function bytesToUtf8(b: Uint8Array): string { return dec.decode(b) }

/** صفرنة آمنة للمخازن (وضع التخفي: لا بقايا في الذاكرة) */
export function zeroize(...arrays: (Uint8Array | null | undefined)[]) {
  for (const a of arrays) if (a) a.fill(0)
}

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const buf = typeof data === "string" ? utf8ToBytes(data) : data
  const h = await crypto.subtle.digest("SHA-256", buf as unknown as ArrayBuffer)
  return toHex(new Uint8Array(h))
}

// ---------- هوية X25519 ----------
export interface Identity { pub: Uint8Array; priv: Uint8Array }

export function generateIdentity(): Identity {
  const priv = x25519.utils.randomPrivateKey()
  const pub = x25519.getPublicKey(priv)
  return { pub, priv }
}

/** ECDH مشترك */
export function ecdh(priv: Uint8Array, peerPub: Uint8Array): Uint8Array {
  return x25519.getSharedSecret(priv, peerPub)
}

/** اشتقاق مفتاح جلسة AES-256 من سر ECDH (ملح = معرّفا الطرفين مرتبين) */
export function deriveSessionKey(shared: Uint8Array, idA: string, idB: string): Uint8Array {
  const [s1, s2] = [idA, idB].sort()
  const salt = utf8ToBytes(`nexuslink-v1|${s1}|${s2}`)
  return hkdf(sha256, shared, salt, utf8ToBytes("nexuslink-e2e-session"), 32)
}

// ---------- AES-256-GCM ----------
export interface SealedFrame { iv: string; ct: string; seq: number }

let gcmKey: CryptoKey | null = null

export async function importSessionKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw as unknown as ArrayBuffer, "AES-GCM", false, ["encrypt", "decrypt"])
}

export async function seal(
  key: CryptoKey, plaintext: Uint8Array, seq: number, aad: string
): Promise<SealedFrame> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const aadBytes = utf8ToBytes(`${aad}|${seq}`)
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as unknown as ArrayBuffer, additionalData: aadBytes as unknown as ArrayBuffer, tagLength: 128 },
    key, plaintext as unknown as ArrayBuffer,
  )
  return { iv: toB64(iv), ct: toB64(new Uint8Array(ct)), seq }
}

export async function open(
  key: CryptoKey, frame: SealedFrame, aad: string, lastSeq: number
): Promise<Uint8Array> {
  if (frame.seq <= lastSeq) throw new Error("REPLAY_DETECTED")
  const iv = fromB64(frame.iv)
  const aadBytes = utf8ToBytes(`${aad}|${frame.seq}`)
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as unknown as ArrayBuffer, additionalData: aadBytes as unknown as ArrayBuffer, tagLength: 128 },
    key, fromB64(frame.ct) as unknown as ArrayBuffer,
  )
  return new Uint8Array(pt)
}

// ---------- بصمة SAS (مثل Signal): إيموجي + hex للتحقق البصري ----------
const EMOJI = ["🐟","🐹","🚀","🌵","🎧","🍕","⚽","🌙","🔥","🌊","🦊","🐼","🎹","🍩","🚗","⭐","🦉","🍋","🎈","🧩","🐧","🍄","🎯","🪁","🐝","🌵","🦋","🍔","🎸","🌍","🪐","🐝"]
const HEXSET = "0123456789abcdef"

export interface Sas { emoji: string; hex: string }

/** بصمة قصيرة معتمدة على المعرفين معاً — متطابقة على الجهازين حتماً */
export function sasOf(idA: string, pubA: Uint8Array, idB: string, pubB: Uint8Array): Sas {
  const [x, y] = [idA, idB].sort()
  const [pa, pb] = x === idA ? [pubA, pubB] : [pubB, pubA]
  const h = sha256(utf8ToBytes(`${x}|${toHex(pa)}|${y}|${toHex(pb)}`))
  const emoji = Array.from(h.subarray(0, 4)).map((b) => EMOJI[b % EMOJI.length]).join(" ")
  let hex = ""
  for (let i = 0; i < 6; i++) hex += HEXSET[h[8 + i] % 16]
  const hexGroups = [hex.slice(0, 3), hex.slice(3, 6)].join("-")
  return { emoji, hex: hexGroups }
}

/** بصمة هوية طويلة (لعرضها في بطاقة الجهاز) */
export function fingerprintOf(pub: Uint8Array): string {
  const h = sha256(pub)
  return Array.from(h.subarray(0, 8)).map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase().match(/.{4}/g)!.join(" ")
}

// ---------- PBKDF2 لقفل التطبيق (PIN/نمط) ----------
export async function pbkdf2Hash(secret: string, saltB64?: string): Promise<{ salt: string; hash: string; iters: number }> {
  const salt = saltB64 ? fromB64(saltB64) : crypto.getRandomValues(new Uint8Array(16))
  const base = await crypto.subtle.importKey("raw", utf8ToBytes(secret) as unknown as ArrayBuffer, "PBKDF2", false, ["deriveBits"])
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as unknown as ArrayBuffer, iterations: PBKDF2_ITERS, hash: "SHA-256" }, base, 256,
  )
  return { salt: toB64(salt), hash: toB64(new Uint8Array(bits)), iters: PBKDF2_ITERS }
}

export async function pbkdf2Verify(secret: string, stored: { salt: string; hash: string; iters: number }): Promise<boolean> {
  const { hash } = await pbkdf2Hash(secret, stored.salt)
  // مقارنة زمن-ثابت مبسطة
  if (hash.length !== stored.hash.length) return false
  let diff = 0
  for (let i = 0; i < hash.length; i++) diff |= hash.charCodeAt(i) ^ stored.hash.charCodeAt(i)
  return diff === 0
}

// ---------- فحص تسريب النص العادي في بايتات القناة ----------
/** يبحث عن نص UTF-8 أو ترميزه Base64 داخل كل إطارات الالتقاط */
export function scanLeak(frames: { b64?: string }[], needle: string): number {
  if (!needle) return 0
  const nBytes = utf8ToBytes(needle)
  const nHex = toHex(nBytes)
  let nB64 = ""
  try { nB64 = toB64(nBytes).replace(/=+$/, "") } catch { /* ignore */ }
  let hits = 0
  for (const f of frames) {
    if (!f.b64) continue
    const bin = atob(f.b64)
    if (bin.includes(needle)) hits++
    else if (nB64.length >= 8 && bin.includes(nB64.slice(0, Math.max(8, nB64.length - 2)))) hits++
    else {
      // فحص hex (إن مُخزن نص hex)
      const lower = bin.toLowerCase()
      if (lower.includes(nHex)) hits++
    }
  }
  return hits
}
