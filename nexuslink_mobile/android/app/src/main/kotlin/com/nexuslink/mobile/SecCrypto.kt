package com.nexuslink.mobile

import android.content.Context
import android.os.Build
import android.util.Base64
import com.goterl.lazysodium.LazySodiumAndroid
import com.goterl.lazysodium.SodiumAndroid
import java.io.ByteArrayOutputStream
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Mac
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

/**
 * SecCrypto — محرك التشفير E2E للهاتف (FA-10).
 *
 * مطابقة حرفية لصيغ src/lib/nexus/e2e-crypto.ts (عقد §9.1):
 *  · X25519 (lazysodium) لتبادل المفاتيح — هوية دائمة + مفاتيح رجيعية لكل عصر
 *  · HKDF-SHA256: salt = "nexuslink-v1|" + join("|", sort(الطرفان)) · info = "nexuslink-e2e-session" · 32B
 *  · AES-256-GCM: IV 12B عشوائي · AAD = "from|to|kind|e{epoch}" · tag 128-bit (افتراضي libsodium)
 *  · SAS: sha256("x|hex(pubX)|y|hex(pubY)") مرتب → 4 إيموجي + 6 hex (مجموعتان 3-3) — نفس قائمة الويب
 *  · PBKDF2-SHA256 150k دورة / 256 بت / ملح 16B — يطابق pbkdf2Hash في الويب بايتًا ببايت
 */
object SecCrypto {

    const val SUITE = "X25519 · HKDF-SHA256 · AES-256-GCM · PBKDF2(150k)"

    /** قائمة إيموجي SAS — نسخة حرفية من EMOJI في e2e-crypto.ts (بالتكرارات نفسها). */
    private val SAS_EMOJI = listOf(
        "🐟", "🐹", "🚀", "🌵", "🎧", "🍕", "⚽", "🌙", "🔥", "🌊", "🦊", "🐼",
        "🎹", "🍩", "🚗", "⭐", "🦉", "🍋", "🎈", "🧩", "🐧", "🍄", "🎯", "🪁",
        "🐝", "🌵", "🦋", "🍔", "🎸", "🌍", "🪐", "🐝",
    )

    const val PBKDF2_ITERS = 150_000

    @Volatile
    private var lazy: LazySodiumAndroid? = null

    private fun s(): LazySodiumAndroid {
        return lazy ?: synchronized(this) {
            lazy ?: LazySodiumAndroid(SodiumAndroid()).also { lazy = it }
        }
    }

    /** واجهة JNA الخام — نفس تواقيع libsodium C (مُتحقق منها عبر javap على الـ AAR). */
    private fun sodium(): SodiumAndroid = s().getSodium()

    // ---------- أدوات البايتات ----------

    fun toB64(b: ByteArray): String = Base64.encodeToString(b, Base64.NO_WRAP)

    fun fromB64(s: String): ByteArray {
        val clean = s.trim()
        if (clean.isEmpty()) return ByteArray(0)
        return try {
            Base64.decode(clean, Base64.NO_WRAP)
        } catch (_: IllegalArgumentException) {
            Base64.decode(clean, Base64.NO_WRAP or Base64.URL_SAFE)
        }
    }

    fun toHex(b: ByteArray): String = b.joinToString("") { "%02x".format(it) }

    fun sha256(data: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(data)

    fun utf8(s: String): ByteArray = s.toByteArray(Charsets.UTF_8)

    // ---------- هوية X25519 ----------

    class Identity(val pub: ByteArray, val priv: ByteArray)

    /** keypair جديد: 32B عشوائية ثم المفتاح العام = crypto_scalarmult_base (نفس @noble x25519). */
    fun generateIdentity(): Identity {
        val priv = s().randomBytesBuf(32)
        val pub = ByteArray(32)
        val rc = sodium().crypto_scalarmult_base(pub, priv)
        if (rc != 0) throw IllegalStateException("scalarmult_base failed: $rc")
        return Identity(pub, priv)
    }

    /** ECDH مشترك X25519. */
    fun ecdh(priv: ByteArray, peerPub: ByteArray): ByteArray {
        val shared = ByteArray(32)
        val rc = sodium().crypto_scalarmult(shared, priv, peerPub)
        if (rc != 0) throw IllegalStateException("scalarmult failed: $rc")
        return shared
    }

    // ---------- HKDF-SHA256 (RFC 5869) — javax.crypto بلا تبعيات ----------

    fun hkdfSha256(ikm: ByteArray, salt: ByteArray, info: ByteArray, length: Int): ByteArray {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(if (salt.isEmpty()) ByteArray(32) else salt, "HmacSHA256"))
        val prk = mac.doFinal(ikm) // doFinal يعيد Mac لحالة init تلقائيًا
        val out = ByteArrayOutputStream()
        var t = ByteArray(0)
        var counter = 1
        while (out.size() < length) {
            mac.update(t)
            mac.update(info)
            mac.update(counter.toByte())
            t = mac.doFinal()
            out.write(t)
            counter++
        }
        return out.toByteArray().copyOf(length)
    }

    /**
     * اشتقاق مفتاح الجلسة — مطابق deriveSessionKey في الويب:
     * salt = "nexuslink-v1|<id1>|<id2>" بعد الترتيب الأبجدي للمعرّفين.
     */
    fun deriveSessionKey(shared: ByteArray, idA: String, idB: String): ByteArray {
        val (s1, s2) = listOf(idA, idB).sorted()
        val salt = utf8("nexuslink-v1|$s1|$s2")
        val info = utf8("nexuslink-e2e-session")
        return hkdfSha256(shared, salt, info, 32)
    }

    // ---------- AES-256-GCM ----------

    class SealedFrame(val iv: ByteArray, val ct: ByteArray, val seq: Int)

    private const val TAG_LEN = 16 // AES-256-GCM tag 128-bit (ABYTES)

    /** AES-256-GCM عبر crypto_aead_aes256gcm_encrypt الخام — AAD = "aad|seq" (مطابق seal في الويب). */
    fun seal(rawKey: ByteArray, plaintext: ByteArray, seq: Int, aad: String): SealedFrame {
        val iv = s().randomBytesBuf(12)
        val aadBytes = utf8("$aad|$seq")
        val c = ByteArray(plaintext.size + TAG_LEN)
        val cLen = longArrayOf(0)
        val rc = sodium().crypto_aead_aes256gcm_encrypt(
            c, cLen, plaintext, plaintext.size.toLong(),
            aadBytes, aadBytes.size.toLong(), null, iv, rawKey,
        )
        if (rc != 0) throw IllegalStateException("aes256gcm_encrypt failed: $rc")
        return SealedFrame(iv, c.copyOf(cLen[0].toInt()), seq)
    }

    /** فك الإطار + فحص الإعادة (مطابق open في الويب) — يرمي REPLAY_DETECTED أو tag فاسد. */
    fun open(rawKey: ByteArray, ivB64: String, ctB64: String, seq: Int, aad: String, lastSeq: Int): ByteArray {
        if (seq <= lastSeq) throw IllegalStateException("REPLAY_DETECTED")
        val aadBytes = utf8("$aad|$seq")
        val ct = fromB64(ctB64)
        val m = ByteArray(maxOf(0, ct.size - TAG_LEN))
        val mLen = longArrayOf(0)
        val rc = sodium().crypto_aead_aes256gcm_decrypt(
            m, mLen, null, ct, ct.size.toLong(),
            aadBytes, aadBytes.size.toLong(), fromB64(ivB64), rawKey,
        )
        if (rc != 0) throw IllegalStateException("aes256gcm_decrypt failed: $rc")
        return m.copyOf(mLen[0].toInt())
    }

    // ---------- بصمات SAS والهوية ----------

    /**
     * بصمة SAS القصيرة — مطابقة sasOf في الويب بايتًا ببايت:
     * المعرّفان مرتبان؛ المفاتيح تتبع ترتيب المعرّفات؛ 4 إيموجي من البايتات 0..3 و6 hex من 8..13.
     */
    fun sasOf(idA: String, pubA: ByteArray, idB: String, pubB: ByteArray): Pair<String, String> {
        val sorted = listOf(idA, idB).sorted()
        val x = sorted[0]
        val y = sorted[1]
        val pa = if (x == idA) pubA else pubB
        val pb = if (x == idA) pubB else pubA
        val h = sha256(utf8("$x|${toHex(pa)}|$y|${toHex(pb)}"))
        // مطابق JS: b % EMOJI.length — على القيمة غير الموقعة
        val emoji = (0 until 4).map { SAS_EMOJI[(h[it].toInt() and 0xFF) % SAS_EMOJI.size] }.joinToString(" ")
        var hex = ""
        for (i in 0 until 6) hex += "%x".format((h[8 + i].toInt() and 0xFF) % 16)
        return Pair(emoji, "${hex.substring(0, 3)}-${hex.substring(3, 6)}")
    }

    /** بصمة الهوية الطويلة — مطابقة fingerprintOf في الويب. */
    fun fingerprintOf(pub: ByteArray): String {
        val h = sha256(pub)
        return h.take(8).joinToString("") { "%02x".format(it) }.uppercase().chunked(4).joinToString(" ")
    }

    // ---------- PBKDF2 (قفل التطبيق) — مطابق pbkdf2Hash/pbkdf2Verify في الويب ----------

    class Pbkdf2Result(val salt: String, val hash: String, val iters: Int)

    fun pbkdf2Hash(secret: String, saltB64: String? = null): Pbkdf2Result {
        val salt = saltB64?.let { fromB64(it) } ?: ByteArray(16).also { SecureRandom().nextBytes(it) }
        val spec = PBEKeySpec(secret.toCharArray(), salt, PBKDF2_ITERS, 256)
        val f = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
        return Pbkdf2Result(toB64(salt), toB64(f.generateSecret(spec).encoded), PBKDF2_ITERS)
    }

    /** مقارنة زمن-ثابت مبسطة (مطابق pbkdf2Verify في الويب). */
    fun pbkdf2Verify(secret: String, saltB64: String, expectedHashB64: String): Boolean {
        val r = pbkdf2Hash(secret, saltB64)
        if (r.hash.length != expectedHashB64.length) return false
        var diff = 0
        for (i in r.hash.indices) diff = diff or (r.hash[i].code xor expectedHashB64[i].code)
        return diff == 0
    }

    // ---------- تخزين الهوية ----------

    private const val PREFS = "nexus_sec"

    fun loadOrGenerateIdentity(ctx: Context): Identity {
        val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val pubS = p.getString("identity_pub", null)
        val privS = p.getString("identity_priv", null)
        if (!pubS.isNullOrEmpty() && !privS.isNullOrEmpty()) {
            try {
                return Identity(fromB64(pubS), fromB64(privS))
            } catch (_: Exception) {
            }
        }
        val id = generateIdentity()
        p.edit().putString("identity_pub", toB64(id.pub)).putString("identity_priv", toB64(id.priv)).apply()
        return id
    }

    /** بصمة الجهاز للسجل (اسم النسخة — تشخيصي فقط). */
    fun deviceTag(): String = "Android ${Build.VERSION.SDK_INT}"
}
