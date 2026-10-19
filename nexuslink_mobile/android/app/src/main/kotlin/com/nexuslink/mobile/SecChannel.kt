package com.nexuslink.mobile

import android.content.Context
import io.socket.client.IO
import io.socket.client.Socket
import org.json.JSONArray
import org.json.JSONObject

/**
 * SecChannel — عميل قناة الأمان المشفرة 3009 داخل الخدمة (FA-10، عقد §4.6 + §9).
 *
 * يعمل بلا واجهة إطلاقًا:
 *  · sec:announce {role:"phone", deviceId, name, pub, eph} عند كل اتصال
 *  · مصافحة X25519 عبر kex:peer (بنفس تدفق use-sec-bridge.ts: تدوير العصور، pendingEph، عصر أول = 1)
 *  · sec:frame {to, from, kind, e, iv, ct, seq} — AES-256-GCM مع AAD "from|to|kind|e{epoch}"
 *  · أوامر مشفرة: cmd (ring/lock-phone) · ack · clip · lost-state
 *  · أوامر بث: sec:lost-cmd · sec:wipe-cmd · sec:lock-cmd (احتياطي)
 *  · حالة: sec:lock-state عند الاتصال وعند كل تغيّر · تدقيق sec:audit
 */
class SecChannel(
    private val ctx: Context,
    private val deviceId: String,
    private val deviceName: String,
) {

    class PeerKeys(val id: String, val name: String, val pub: String, val eph: String)

    private var socket: Socket? = null

    // ---- حالة التشفير (مرآة S في use-sec-bridge.ts) ----
    private val identity: SecCrypto.Identity = SecCrypto.loadOrGenerateIdentity(ctx)
    private var eph: SecCrypto.Identity? = null
    private var pendingEph: SecCrypto.Identity? = null
    private var awaitingEpoch: Int? = null
    private var epoch = 0
    private val keyring = HashMap<Int, ByteArray>()
    private val lastSeqByEpoch = HashMap<Int, Int>()

    @Volatile
    private var seq = 0

    @Volatile
    private var peer: PeerKeys? = null

    @Volatile
    private var lastResyncAt = 0L

    // ---- حالة العرض ----
    @Volatile
    var bridgeOnline = false
        private set

    @Volatile
    var kexDone = false
        private set

    @Volatile
    var sasEmoji = ""
        private set

    @Volatile
    var sasHex = ""
        private set

    // ------------------------------------------------------------------
    // الاتصال
    // ------------------------------------------------------------------

    fun connect(host: String, port: Int, mode: String, secPort: Int) {
        val url = if (mode == "gateway") "http://$host:$port" else "http://$host:$secPort"
        try {
            val opts = IO.Options()
            opts.reconnection = true
            opts.reconnectionDelay = 2_000
            opts.reconnectionDelayMax = 15_000
            opts.timeout = 10_000
            if (mode == "gateway") {
                opts.query = "XTransformPort=$secPort"
            }
            val s = IO.socket(url, opts)
            socket = s

            s.on(Socket.EVENT_CONNECT) {
                bridgeOnline = true
                // عصر جديد وكيل رجيعي جديد عند كل اتصال (مطابق سلوك الويب عند disconnect)
                keyring.clear()
                lastSeqByEpoch.clear()
                epoch = 0
                seq = 0
                kexDone = false
                peer = null
                pendingEph = null
                awaitingEpoch = null
                eph = SecCrypto.generateIdentity()
                announce()
                emitLockState(null)
                pushState("online")
            }
            s.on(Socket.EVENT_DISCONNECT) {
                bridgeOnline = false
                kexDone = false
                peer = null
                keyring.clear()
                epoch = 0
                pushState("offline")
            }
            s.on(Socket.EVENT_CONNECT_ERROR) {
                bridgeOnline = false
                pushState("reconnecting")
            }

            s.on("sec:hello") { /* {port, suite, peers, stealth, counters} — لا شيء مطلوب */ }

            s.on("kex:peer") { args ->
                val d = args.firstOrNull() as? JSONObject ?: return@on
                handleKexPeer(d)
            }
            s.on("sec:frame") { args ->
                val d = args.firstOrNull() as? JSONObject ?: return@on
                handleFrame(d)
            }
            s.on("sec:pending-trust") { args ->
                val d = args.firstOrNull() as? JSONObject ?: return@on
                pushData(
                    "sec",
                    mapOf(
                        "event" to "pending-trust",
                        "alertId" to d.optString("alertId"),
                        "probeId" to d.optString("probeId"),
                    ),
                )
                audit("trust", "بانتظار قرار التوثيق من الكمبيوتر — القناة المشفرة معطلة حتى التوثيق", "warn")
            }
            s.on("sec:rejected") { args ->
                val d = args.firstOrNull() as? JSONObject ?: return@on
                pushData("sec", mapOf("event" to "rejected", "reason" to d.optString("reason")))
            }

            // ==== أوامر بث غير مشفرة (عقد §9.2) ====
            s.on("sec:lost-cmd") { args ->
                val d = args.firstOrNull() as? JSONObject ?: return@on
                val msg = d.optString("message", "")
                val locate = if (d.has("locate")) d.optBoolean("locate", true) else true
                LostMode.start(ctx, msg, locate)
                emitLockState(null)
                audit("lock", "وضع الفقدان مفعّل بأمر من الكمبيوتر — «${msg.take(40)}»", "warn")
            }
            s.on("sec:lock-cmd") { _ ->
                // احتياطي غير مشفر: قفل التطبيق فقط (بلا شاشة فقدان ولا موقع)
                lockAppOnly("أمر قفل من الكمبيوتر")
            }
            s.on("sec:wipe-cmd") { args ->
                val d = args.firstOrNull() as? JSONObject ?: return@on
                val passes = d.optInt("passes", 3)
                wipe(passes)
            }

            s.connect()
        } catch (e: Exception) {
            bridgeOnline = false
            android.util.Log.e("NexusSec", "connect failed", e)
        }
    }

    /** حارس الاتصال (يُستدعى من watchdog الخدمة). */
    fun ensureAlive() {
        try {
            val s = socket
            if (s != null && !s.connected()) s.connect()
        } catch (_: Exception) {
        }
    }

    fun shutdown() {
        try {
            socket?.off()
            socket?.disconnect()
        } catch (_: Exception) {
        }
        socket = null
        bridgeOnline = false
        kexDone = false
        keyring.clear()
    }

    // ------------------------------------------------------------------
    // المصافحة (مطابقة kex:peer في use-sec-bridge.ts حرفيًا)
    // ------------------------------------------------------------------

    private fun announce() {
        val e = eph ?: return
        try {
            socket?.emit(
                "sec:announce",
                JSONObject()
                    .put("role", "phone")
                    .put("deviceId", deviceId)
                    .put("name", deviceName)
                    .put("pub", SecCrypto.toB64(identity.pub))
                    .put("eph", SecCrypto.toB64(e.pub)),
            )
        } catch (_: Exception) {
        }
    }

    private fun handleKexPeer(p: JSONObject) {
        val pub = p.optString("pub", "")
        val ephB64 = p.optString("eph", "")
        if (pub.isEmpty() || ephB64.isEmpty()) return
        peer = PeerKeys(p.optString("deviceId", ""), p.optString("name", ""), pub, ephB64)
        val pEpoch = p.optInt("epoch", 0)

        if (pEpoch > epoch && pEpoch != awaitingEpoch) {
            // الطرف الآخر بدأ تدويرًا — نجيب بمفاتيح رجيعية جديدة لنفس العصر ثم نشتق فورًا
            val myNew = SecCrypto.generateIdentity()
            eph = myNew
            try {
                socket?.emit("kex:update", JSONObject().put("eph", SecCrypto.toB64(myNew.pub)).put("epoch", pEpoch))
            } catch (_: Exception) {
            }
            deriveEpoch(myNew, ephB64, pub, pEpoch)
            return
        }
        val myEph = pendingEph ?: eph ?: return
        if (pendingEph != null) {
            eph = pendingEph
            pendingEph = null
        }
        awaitingEpoch = null
        // مصافحة أولى بلا عصر → العصران يتطابقان على 1 دائمًا (نفس قاعدة الويب)
        val target = if (pEpoch > 0) pEpoch else 1
        deriveEpoch(myEph, ephB64, pub, target)
    }

    /** اشتقاق مفتاح عصر — تشغيل ثقيل خارج المعالج الرئيسي. */
    private fun deriveEpoch(myEph: SecCrypto.Identity, peerEphB64: String, peerPubB64: String, target: Int) {
        val p = peer ?: return
        Thread {
            try {
                val shared = SecCrypto.ecdh(myEph.priv, SecCrypto.fromB64(peerEphB64))
                val raw = SecCrypto.deriveSessionKey(shared, deviceId, p.id)
                synchronized(keyring) {
                    keyring[target] = raw
                    epoch = target
                    seq = 0
                    lastSeqByEpoch[target] = 0
                }
                val (emoji, hex) = SecCrypto.sasOf(deviceId, identity.pub, p.id, SecCrypto.fromB64(peerPubB64))
                sasEmoji = emoji
                sasHex = hex
                kexDone = true
                // صفرنة السرورات المؤقتة (تخفي الذاكرة — نفس zeroize في الويب)
                shared.fill(0)
                pushState("kex")
                audit("kex", "مصافحة X25519 اكتملت مع «${p.name}» — بصمة SAS جاهزة للتحقق البصري", "info")
            } catch (e: Exception) {
                android.util.Log.e("NexusSec", "derive failed", e)
            }
        }.start()
    }

    // ------------------------------------------------------------------
    // الإطارات المشفرة
    // ------------------------------------------------------------------

    fun sendFrame(kind: String, payload: JSONObject): Boolean {
        val key = synchronized(keyring) { keyring[epoch] } ?: return false
        val p = peer ?: return false
        return try {
            seq++
            val aad = "$deviceId|${p.id}|$kind|e$epoch"
            val sealed = SecCrypto.seal(key, SecCrypto.utf8(payload.toString()), seq, aad)
            socket?.emit(
                "sec:frame",
                JSONObject()
                    .put("to", p.id)
                    .put("from", deviceId)
                    .put("kind", kind)
                    .put("e", epoch)
                    .put("iv", SecCrypto.toB64(sealed.iv))
                    .put("ct", SecCrypto.toB64(sealed.ct))
                    .put("seq", sealed.seq),
            )
            true
        } catch (e: Exception) {
            android.util.Log.e("NexusSec", "sendFrame failed: $kind", e)
            false
        }
    }

    private fun handleFrame(d: JSONObject) {
        val frameEpoch = if (d.has("e")) d.optInt("e", -1) else -1
        val key = synchronized(keyring) { keyring[frameEpoch] }
        if (key == null || !d.has("iv") || !d.has("ct")) {
            // عصر غير معروف → إعادة مزامنة ذاتية (≤ مرة كل 5 ثوانٍ — نفس قاعدة الويب)
            if (d.has("iv") && System.currentTimeMillis() - lastResyncAt > 5_000) {
                lastResyncAt = System.currentTimeMillis()
                eph = eph ?: SecCrypto.generateIdentity()
                announce()
            }
            return
        }
        try {
            val from = d.optString("from", "")
            val to = d.optString("to", "")
            val kind = d.optString("kind", "data")
            val frameSeq = d.optInt("seq", 0)
            val aad = "$from|$to|$kind|e$frameEpoch"
            val last = synchronized(keyring) { lastSeqByEpoch[frameEpoch] ?: 0 }
            val pt = SecCrypto.open(key, d.optString("iv"), d.optString("ct"), frameSeq, aad, last)
            synchronized(keyring) { lastSeqByEpoch[frameEpoch] = frameSeq }
            val msg = JSONObject(String(pt, Charsets.UTF_8))
            handleDecrypted(kind, msg, from)
        } catch (e: Exception) {
            if (e.message == "REPLAY_DETECTED") {
                android.util.Log.w("NexusSec", "replay rejected")
                audit("replay", "حماية الإعادة: رُفض إطار مكرر من الكمبيوتر", "warn")
            } else {
                android.util.Log.e("NexusSec", "open failed", e)
            }
        }
    }

    private fun handleDecrypted(kind: String, msg: JSONObject, from: String) {
        when (kind) {
            "cmd" -> {
                val op = msg.optString("op")
                val feature = msg.optString("feature", "remote_input")
                // بوابة الصلاحيات: الميزة موقوفة من لوحة الأذونات → رفض مشفر
                if (!featureEnabled(feature)) {
                    sendFrame("perm-denied", JSONObject().put("op", op).put("feature", feature).put("reason", "الميزة موقوفة من صلاحيات الهاتف"))
                    audit("perm-denied", "رُفض تنفيذ «$op» — صلاحية «$feature» موقوفة", "warn")
                    return
                }
                when (op) {
                    "ring" -> {
                        val text = FindMyPhone.startRing(ctx)
                        sendFrame("ack", JSONObject().put("op", "ring").put("note", "الهاتف يرن الآن: $text"))
                        MainActivity.pushDataEvent("sec", mapOf("event" to "ack", "op" to "ring", "note" to text))
                    }
                    "lock-phone" -> {
                        val m = msg.optString("message", "")
                        LostMode.start(ctx, m, true)
                        emitLockState(null)
                        sendFrame("ack", JSONObject().put("op", "lock-phone").put("note", "الهاتف قُفل ورسالة الفقدان على الشاشة"))
                        audit("lock", "قُفل الهاتف بأمر مشفر من الكمبيوتر", "warn")
                    }
                    else -> sendFrame("ack", JSONObject().put("op", op).put("note", "أمر غير معروف — استُلم فقط"))
                }
            }
            "ack" -> {
                MainActivity.pushDataEvent(
                    "sec",
                    mapOf("event" to "ack", "op" to msg.optString("op"), "note" to msg.optString("note")),
                )
            }
            "perm-denied" -> {
                MainActivity.pushDataEvent(
                    "sec",
                    mapOf("event" to "perm-denied", "op" to msg.optString("op"), "reason" to msg.optString("reason")),
                )
            }
            "clip" -> {
                // SEC (F6 → M1): تسليم الحافظة المشفر — نفس دلالات §11.ب لكن فوق
                // القناة المشفرة: الكتابة في الحافظة مسموحة دائمًا من الخدمة (قيود
                // Android 10+ على القراءة فقط) + حرس الحلقة clipLastFromPc كي لا
                // تعيدها مراقبة الإتاحة إلى الكمبيوتر (لا صدى).
                val text = msg.optString("text")
                var applied = false
                if (text.isNotEmpty()) {
                    try {
                        val cm = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
                        cm.setPrimaryClip(android.content.ClipData.newPlainText("NexusLink", text))
                        AgentForegroundService.clipLastFromPc = text
                        applied = true
                    } catch (_: Exception) {
                    }
                }
                MainActivity.pushDataEvent("secclip", mapOf("text" to text, "from" to from, "applied" to applied))
                if (!AgentForegroundService.uiAlive) {
                    AgentForegroundService.liveInstance?.let { svc ->
                        svc.notifySecClip(text)
                    }
                }
            }
            "lost-state" -> {
                // من الكمبيوتر — لا حاجة على الهاتف (الهاتف مصدر الحالة) — تسجيل فقط
                audit("info", "استُلم تقرير حالة فقدان من «$from»", "info")
            }
            "file-meta", "file-chunk", "file-end" -> {
                audit("info", "إطار نقل ملف مشفر ($kind) — الاستقبال الكامل على طرف الويب", "info")
            }
        }
    }

    // ------------------------------------------------------------------
    // الحالة والتدقيق والأوامر المحلية
    // ------------------------------------------------------------------

    /** أمر قفل بسيط (بلا شاشة فقدان): يُقفل التطبيق ويُبلَّغ الطرفان. */
    fun lockAppOnly(reason: String) {
        try {
            ctx.getSharedPreferences(LostMode.PREFS, Context.MODE_PRIVATE)
                .edit().putBoolean("locked", true).apply()
        } catch (_: Exception) {
        }
        MainActivity.pushDataEvent("sec", mapOf("event" to "locked", "reason" to reason))
        emitLockState(null)
        audit("lock", reason, "warn")
    }

    fun unlockApp() {
        try {
            ctx.getSharedPreferences(LostMode.PREFS, Context.MODE_PRIVATE)
                .edit().putBoolean("locked", false).apply()
        } catch (_: Exception) {
        }
        emitLockState(null)
    }

    /** حالة القفل/الفقدان للطرفين (sec:lock-state) — من الهاتف. */
    fun emitLockState(location: JSONObject?) {
        try {
            val p = ctx.getSharedPreferences(LostMode.PREFS, Context.MODE_PRIVATE)
            val cfg = ctx.getSharedPreferences(SecPrefs.PREFS, Context.MODE_PRIVATE)
            val o = JSONObject()
                .put("deviceId", deviceId)
                .put("locked", p.getBoolean("locked", false))
                .put("lost", p.getBoolean("lost", false))
                .put("hasPin", cfg.getBoolean(SecPrefs.KEY_HAS_PIN, false))
                .put("hasBiometric", cfg.getBoolean(SecPrefs.KEY_HAS_BIO, false))
                .put("autoLockSec", cfg.getInt(SecPrefs.KEY_AUTO_LOCK, 60))
            val m = p.getString("lost_message", null)
            if (p.getBoolean("lost", false) && !m.isNullOrEmpty()) o.put("message", m)
            if (location != null) o.put("location", location)
            socket?.emit("sec:lock-state", o)
        } catch (_: Exception) {
        }
    }

    /** استدعاؤها من خيط الموقع في LostMode — يبلّغ مشفرًا وعامًا. */
    fun emitLostState(location: JSONObject?) {
        if (location != null && kexDone) {
            val payload = JSONObject()
                .put("lost", true)
                .put("message", LostMode.message)
                .put("location", location)
            sendFrame("lost-state", payload)
        }
        emitLockState(location)
        if (location != null) {
            audit("lost", "أُبلغ الكمبيوتر بالموقع: ${location.optDouble("lat", 0.0)}, ${location.optDouble("lng", 0.0)} (±${location.optDouble("accuracy", 0.0).toInt()}م)", "warn")
        } else {
            audit("lost", "تعذّر جمع الموقع — صلاحية الموقع غير ممنوحة أو لا إشارة", "warn")
        }
    }

    /** المسح الآمن للملفات المستلمة — من زر التطبيق أو sec:wipe-cmd/dev:wipe. */
    fun wipe(passes: Int, fromUi: Boolean = false) {
        Thread {
            val result = SecureWipe.wipe(ctx, deviceId, passes) { done, total, file ->
                MainActivity.pushDataEvent(
                    "wipe",
                    mapOf("event" to "progress", "done" to done, "total" to total, "file" to file, "passes" to passes),
                )
            }
            try {
                socket?.emit("sec:wipe-state", result)
            } catch (_: Exception) {
            }
            val files = result.optJSONArray("files") ?: JSONArray()
            MainActivity.pushDataEvent(
                "wipe",
                mapOf(
                    "event" to "done",
                    "ok" to result.optBoolean("ok"),
                    "count" to result.optInt("count"),
                    "bytes" to result.optLong("bytes"),
                    "error" to if (result.has("error")) result.optString("error") else null,
                    "passes" to passes,
                ),
            )
            audit(
                "wipe",
                if (result.optBoolean("ok")) "مسح آمن: ${result.optInt("count")} ملف بـ $passes تمريرات ثم حذف من MediaStore"
                else "فشل المسح الآمن: ${result.optString("error")}",
                "warn",
            )
            if (fromUi) android.util.Log.i("NexusSec", "wipe من الواجهة: ${files.length()} ملف")
        }.start()
    }

    /** سطر تدقيق إلى سجل الويب الموحد. */
    fun audit(action: String, detail: String, severity: String) {
        try {
            socket?.emit(
                "sec:audit",
                JSONObject()
                    .put("actor", deviceName)
                    .put("action", action)
                    .put("detail", detail)
                    .put("severity", severity),
            )
        } catch (_: Exception) {
        }
    }

    /** صلاحية ميزة محلية (لوحة الأذونات في الواجهة تكتبها). */
    fun featureEnabled(feature: String): Boolean =
        try {
            ctx.getSharedPreferences(SecPrefs.PREFS, Context.MODE_PRIVATE)
                .getBoolean("feat_$feature", true)
        } catch (_: Exception) {
            true
        }

    fun setFeatureEnabled(feature: String, enabled: Boolean) {
        try {
            ctx.getSharedPreferences(SecPrefs.PREFS, Context.MODE_PRIVATE)
                .edit().putBoolean("feat_$feature", enabled).apply()
        } catch (_: Exception) {
        }
    }

    /** لقطة الحالة للواجهة (MethodChannel + أحداث sec). */
    fun snapshot(): Map<String, Any?> = mapOf(
        "online" to bridgeOnline,
        "kexDone" to kexDone,
        "sasEmoji" to sasEmoji,
        "sasHex" to sasHex,
        "fingerprint" to SecCrypto.fingerprintOf(identity.pub),
        "peerId" to (peer?.id ?: ""),
        "peerName" to (peer?.name ?: ""),
        "epoch" to epoch,
        "lost" to LostMode.isActive(ctx),
        "lostMessage" to LostMode.storedMessage(ctx),
        "suite" to SecCrypto.SUITE,
    )

    private fun pushState(reason: String) {
        val snap = snapshot()
        val m = HashMap<String, Any?>(snap)
        m["event"] = "state"
        m["reason"] = reason
        MainActivity.pushDataEvent("sec", m)
    }

    private fun pushData(kind: String, data: Map<String, Any?>) {
        MainActivity.pushDataEvent(kind, data)
    }
}

/** مفاتيح إعدادات الأمان التي تكتبها الواجهة وتقرأها الخدمة. */
object SecPrefs {
    const val PREFS = "nexus_sec_cfg"
    const val KEY_HAS_PIN = "hasPin"
    const val KEY_HAS_BIO = "hasBiometric"
    const val KEY_AUTO_LOCK = "autoLockSec"
}
