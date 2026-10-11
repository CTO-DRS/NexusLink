package com.nexuslink.mobile

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.ServiceInfo
import android.hardware.display.DisplayManager
import android.os.BatteryManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import io.socket.client.IO
import io.socket.client.Socket
import io.socket.emitter.Emitter
import org.json.JSONObject

/**
 * AgentForegroundService — قلب "وكيل الجهاز".
 *
 * خدمة أمامية (Foreground Service, type=dataSync) تملك اتصالين socket.io دائمين:
 *  · جسر الحماية 3006 (القناة الحاضنة): حضور guard:hello-phone {name, deviceId}،
 *    منارة prox:beacon كل 5s، تقرير dev:state كل 30s، أوامر dev:*،
 *    وعروض نقل الملفات tx:offer → إشعار نظام (قبول/رفض) + بث إلى الواجهة.
 *  · جسر الإنتاجية 3007: النصوص/الروابط السريعة clip:new و hand:new → بث إلى
 *    الواجهة + إشعار نظام عندما تكون الواجهة غير حية.
 *
 * إعادة اتصال تلقائية مدمجة + watchdog كل 15 ثانية — START_STICKY.
 */
class AgentForegroundService : Service() {

    companion object {
        const val CHANNEL_ID = "nexus_agent_channel"
        const val TX_CHANNEL_ID = "nexus_tx_channel"
        const val CTL_CHANNEL_ID = "nexus_ctl_channel"
        const val NOTIF_ID = 4201
        const val CTL_NOTIF_ID = 4310

        private const val BEACON_MS = 5_000L
        private const val STATE_MS = 30_000L
        private const val WATCHDOG_MS = 15_000L

        /** حالة القناة الحالية: stopped|connecting|online|offline|reconnecting */
        @Volatile
        var currentState: String = "stopped"
            private set

        @Volatile
        var currentServerKey: String? = null
            private set

        /** هل واجهة Flutter حية؟ (تُضبط من Dart عبر setUiAlive) */
        @Volatile
        var uiAlive: Boolean = false

        /** مخزن عروض النقل الأخيرة — تُصبّ في الواجهة عند إعادة فتحها. */
        val offerBacklog = ArrayDeque<JSONObject>()
        private const val BACKLOG_MAX = 20

        fun stashOffer(o: JSONObject) {
            synchronized(offerBacklog) {
                offerBacklog.addLast(JSONObject(o.toString()))
                while (offerBacklog.size > BACKLOG_MAX) offerBacklog.removeFirst()
            }
        }

        fun drainOffers(): List<JSONObject> {
            synchronized(offerBacklog) {
                val out = ArrayList<JSONObject>(offerBacklog)
                offerBacklog.clear()
                return out
            }
        }

        // ----------------------------------------------------------
        // FA-7 — جلسة التحكم باللمس (بوابة الحقن)
        // ----------------------------------------------------------

        /** النسخة الحية للخدمة — للوصول من MainActivity (قرار الحوار/الإيقاف). */
        @Volatile
        var liveInstance: AgentForegroundService? = null

        /** جلسة تحكم نشطة؟ لا جلسة = لا حقن لمس/نص إطلاقًا (بوابة الأمان). */
        @Volatile
        var ctlActive: Boolean = false

        @Volatile
        var ctlController: String? = null

        @Volatile
        var ctlName: String? = null

        /** طلب تأكيد معلّق (بعد dev:ctl-start وقبل قرار المستخدم). */
        @Volatile
        var ctlPendingFrom: String? = null

        @Volatile
        var ctlPendingName: String? = null

        /** طلب تأكيد عند بدء كل جلسة (افتراضي مفعّل — يكتبه Dart عبر setCtlConfirm). */
        @Volatile
        var ctlRequireConfirm: Boolean = true

        /** لقطة حالة الجلسة للواجهة (MethodChannel). */
        fun ctlSnapshot(): Map<String, Any?> = mapOf(
            "active" to ctlActive,
            "controller" to (ctlController ?: ""),
            "name" to (ctlName ?: ""),
            "requireConfirm" to ctlRequireConfirm,
        )

        /** إقرار تنفيذ إيماءة — من NexusAccessibilityService إلى السيرفر. */
        fun forwardTouchAck(seq: Int, op: String, ok: Boolean, err: String?) {
            liveInstance?.emitTouchAck(seq, op, ok, err)
        }
    }

    private var socket: Socket? = null
    private var prodSocket: Socket? = null

    private var host = ""
    private var port = 81
    private var mode = "gateway"
    private var bridgePort = 3006
    private var deviceId = ""
    private var deviceName = "Nexus Android"

    private val main = Handler(Looper.getMainLooper())
    private var beaconRun: Runnable? = null
    private var stateRun: Runnable? = null
    private var watchdogRun: Runnable? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        createTxChannel()
        createCtlChannel()
        liveInstance = this
        loadCtlPrefs()
        registerDisplayListener()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // أفعال الإشعار (رفض عرض نقل / قرار تحكم) — تُعالج ثم نخرج مبكرًا
        // (بدونها نُعيد فتح سوكِتات جديدة فوق القائمة — تكرار اتصال)
        if (intent?.hasExtra("nexus.action") == true) {
            startForegroundCompat()
            handleServiceAction(intent)
            return START_STICKY
        }
        intent?.let { i ->
            host = i.getStringExtra("host") ?: host
            port = i.getIntExtra("port", port)
            mode = i.getStringExtra("mode") ?: mode
            bridgePort = i.getIntExtra("bridgePort", bridgePort)
            deviceId = i.getStringExtra("deviceId") ?: deviceId
            deviceName = i.getStringExtra("deviceName") ?: deviceName
        }
        currentServerKey = "$host:$port"

        startForegroundCompat()
        val fresh = socket?.connected() != true
        if (fresh) {
            setState("connecting")
            connect()
            connectProd()
        }

        // إعادة البدء إن قتلها النظام
        return START_STICKY
    }

    // ------------------------------------------------------------------
    // الاتصال الدائم — جسر الحماية 3006
    // ------------------------------------------------------------------

    private fun connect() {
        val url = if (mode == "gateway") "http://$host:$port" else "http://$host:$bridgePort"
        try {
            val opts = IO.Options()
            opts.reconnection = true
            opts.reconnectionDelay = 2_000
            opts.reconnectionDelayMax = 15_000
            opts.timeout = 10_000
            if (mode == "gateway") {
                // نفس نمط عميل الويب: Caddy يوجّه ?XTransformPort إلى منفذ الجسر
                opts.query = "XTransformPort=$bridgePort"
            }

            val s = IO.socket(url, opts)
            socket = s

            s.on(Socket.EVENT_CONNECT, onConnect)
            s.on(Socket.EVENT_DISCONNECT) {
                setState("offline")
                // انقطاع القناة = نهاية الجلسة دائمًا (من يتحكم لم يعد متصلًا)
                main.post { endControlSession("disconnected") }
            }
            s.on(Socket.EVENT_CONNECT_ERROR) { setState("reconnecting") }

            // أوامر الكمبيوتر → الهاتف: إقرار الاستلام (التنفيذ الكامل في مرحلة الحماية)
            for (cmd in AgentBridge.PC_COMMANDS) {
                s.on(cmd) { args -> main.post { ackCommand(cmd, args) } }
            }

            // ==== FA-7: جلسة التحكم + أوامر اللمس/النص/الأزرار + فتح التطبيقات ====
            s.on(AgentBridge.EV_CTL_START) { args ->
                val data = args.firstOrNull() as? JSONObject ?: return@on
                main.post { handleCtlStart(data) }
            }
            s.on(AgentBridge.EV_CTL_STOP) { _ ->
                main.post { endControlSession("stopped") }
            }
            s.on(AgentBridge.EV_TOUCH) { args ->
                val data = args.firstOrNull() as? JSONObject ?: return@on
                // اللمس على المعالج الرئيسي — dispatchGesture يتطلبه عمليًا للحساسية القصوى
                main.post { handleTouch(data) }
            }
            s.on(AgentBridge.EV_TEXT) { args ->
                val data = args.firstOrNull() as? JSONObject ?: return@on
                main.post { handleText(data) }
            }
            s.on(AgentBridge.EV_KEY) { args ->
                val data = args.firstOrNull() as? JSONObject ?: return@on
                main.post { handleKey(data) }
            }
            s.on(AgentBridge.EV_APP) { args ->
                val data = args.firstOrNull() as? JSONObject ?: return@on
                main.post { handleAppOpen(data) }
            }

            // عروض نقل الملفات (عقد §8): إشعار نظام + بث إلى الواجهة
            s.on(AgentBridge.EV_TX_OFFER) { args ->
                val data = args.firstOrNull() as? JSONObject ?: return@on
                main.post { handleTxOffer(data) }
            }
            // أوامر الكمبيوتر على مهام التنزيل — تُبث للواجهة فقط (المحرك يعيش فيها)
            for (ev in listOf(AgentBridge.EV_TX_PAUSE, AgentBridge.EV_TX_RESUME, AgentBridge.EV_TX_CANCEL)) {
                s.on(ev) { args ->
                    val data = args.firstOrNull() as? JSONObject ?: return@on
                    main.post {
                        MainActivity.pushDataEvent("txcmd", mapOf(
                            "event" to ev,
                            "id" to data.optString("id"),
                        ))
                    }
                }
            }

            s.connect()
            startWatchdog()
        } catch (e: Exception) {
            setState("offline")
            android.util.Log.e(TAG, "connect failed", e)
        }
    }

    // ------------------------------------------------------------------
    // جسر الإنتاجية 3007 — النصوص/الروابط السريعة
    // ------------------------------------------------------------------

    private fun connectProd() {
        val prodPort = AgentBridge.PROD_PORT
        val url = if (mode == "gateway") "http://$host:$port" else "http://$host:$prodPort"
        try {
            val opts = IO.Options()
            opts.reconnection = true
            opts.reconnectionDelay = 2_000
            opts.reconnectionDelayMax = 15_000
            opts.timeout = 10_000
            if (mode == "gateway") {
                opts.query = "XTransformPort=$prodPort"
            }
            val s = IO.socket(url, opts)
            prodSocket = s

            s.on(Socket.EVENT_CONNECT) {
                android.util.Log.i(TAG, "prod bridge online")
            }
            s.on(AgentBridge.EV_CLIP_NEW) { args ->
                val data = args.firstOrNull() as? JSONObject ?: return@on
                main.post {
                    MainActivity.pushDataEvent("clip", mapOf(
                        "id" to data.optString("id"),
                        "deviceId" to data.optString("deviceId"),
                        "deviceName" to data.optString("deviceName"),
                        "kind" to data.optString("kind"),
                        "content" to data.optString("content"),
                        "fileName" to if (data.has("fileName")) data.optString("fileName") else null,
                        "size" to data.optLong("size"),
                        "mode" to data.optString("mode"),
                        "createdAt" to data.optLong("createdAt"),
                    ))
                    if (!uiAlive && data.optString("kind") == "text") {
                        notifyTx(
                            id = 7300 + (data.optString("id").hashCode() and 0x7fffffff) % 300,
                            title = "نص من ${data.optString("deviceName", "الكمبيوتر")}",
                            body = data.optString("content").take(160),
                            offerId = null,
                        )
                    }
                }
            }
            s.on(AgentBridge.EV_HAND_NEW) { args ->
                val data = args.firstOrNull() as? JSONObject ?: return@on
                main.post {
                    MainActivity.pushDataEvent("hand", mapOf(
                        "id" to data.optString("id"),
                        "deviceId" to data.optString("deviceId"),
                        "deviceName" to data.optString("deviceName"),
                        "kind" to data.optString("kind"),
                        "title" to data.optString("title"),
                        "url" to data.optString("url"),
                        "status" to data.optString("status"),
                        "createdAt" to data.optLong("createdAt"),
                    ))
                    if (!uiAlive) {
                        notifyTx(
                            id = 7600 + (data.optString("id").hashCode() and 0x7fffffff) % 300,
                            title = "رابط من ${data.optString("deviceName", "الكمبيوتر")}",
                            body = data.optString("title").ifEmpty { data.optString("url") }.take(160),
                            offerId = null,
                        )
                    }
                }
            }
            s.connect()
        } catch (e: Exception) {
            android.util.Log.e(TAG, "prod connect failed", e)
        }
    }

    // ------------------------------------------------------------------
    // عروض النقل tx:offer
    // ------------------------------------------------------------------

    private fun handleTxOffer(data: JSONObject) {
        stashOffer(data)
        MainActivity.pushDataEvent("tx", mapOf(
            "id" to data.optString("id"),
            "fileName" to data.optString("fileName"),
            "size" to data.optLong("size"),
            "mime" to if (data.has("mime")) data.optString("mime") else null,
            "from" to data.optString("from"),
            "srcDeviceId" to data.optString("srcDeviceId"),
            "srcVPath" to data.optString("srcVPath"),
            "at" to data.optLong("at"),
        ))
        val id = data.optString("id").hashCode() and 0x7fffffff
        val sizeMb = data.optLong("size") / (1024.0 * 1024.0)
        val sizeLabel = if (sizeMb >= 1024) {
            String.format("%.1fGB", sizeMb / 1024)
        } else String.format("%.1fMB", sizeMb)
        notifyTx(
            id = id,
            title = "ملف وارد من ${data.optString("from", "الكمبيوتر")}",
            body = "${data.optString("fileName")} — $sizeLabel",
            offerId = data.optString("id"),
        )
    }

    /** إشعار نقل: قبول يفتح التطبيق، رفض يُرسل مباشرة عبر القناة الدائمة. */
    private fun notifyTx(id: Int, title: String, body: String, offerId: String?) {
        try {
            val contentIntent = PendingIntent.getActivity(
                this, id,
                Intent(this, MainActivity::class.java).apply {
                    flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
                    offerId?.let { putExtra("nexus.offerId", it) }
                },
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )

            val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Notification.Builder(this, TX_CHANNEL_ID)
            } else {
                @Suppress("DEPRECATION")
                Notification.Builder(this)
            }
            builder.setContentTitle(title)
                .setContentText(body)
                .setSmallIcon(android.R.drawable.stat_sys_download)
                .setContentIntent(contentIntent)
                .setAutoCancel(true)

            if (offerId != null) {
                // قبول → افتح التطبيق ليبدأ التنزيل بالمحرك الكامل
                builder.addAction(
                    0, "قبول",
                    contentIntent,
                )
                // رفض → الخدمة ترفض مباشرة عبر القناة الدائمة
                val rejectIntent = PendingIntent.getService(
                    this, id + 1,
                    Intent(this, AgentForegroundService::class.java).apply {
                        putExtra("nexus.action", "reject")
                        putExtra("nexus.offerId", offerId)
                    },
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                )
                builder.addAction(0, "رفض", rejectIntent)
            }

            (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
                .notify(id, builder.build())
        } catch (_: Exception) {
        }
    }

    private fun handleServiceAction(intent: Intent?) {
        when (intent?.getStringExtra("nexus.action")) {
            "reject" -> {
                val offerId = intent.getStringExtra("nexus.offerId") ?: return
                try {
                    socket?.emit(AgentBridge.EV_TX_REJECT, JSONObject().put("id", offerId))
                    (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
                        .cancel(offerId.hashCode() and 0x7fffffff)
                } catch (_: Exception) {
                }
            }
            "ctl-allow" -> {
                val from = ctlPendingFrom
                val name = ctlPendingName
                ctlPendingFrom = null
                ctlPendingName = null
                cancelCtlNotification()
                if (from != null) acceptControl(from, name ?: "الكمبيوتر")
            }
            "ctl-deny" -> {
                val from = ctlPendingFrom
                val name = ctlPendingName
                ctlPendingFrom = null
                ctlPendingName = null
                cancelCtlNotification()
                if (from != null) {
                    pushCtlToUi("state", mapOf("active" to false, "controller" to from, "reason" to "denied"))
                    emitCtlState(false, "denied", from, name)
                }
            }
        }
    }

    // ------------------------------------------------------------------
    // FA-7 — جلسة التحكم باللمس والحقن (عقد §4.8)
    // ------------------------------------------------------------------

    private fun pushCtlToUi(event: String, data: Map<String, Any?>) {
        val m = HashMap<String, Any?>(data)
        m["event"] = event
        MainActivity.pushDataEvent("ctl", m)
    }

    private fun emitCtlState(active: Boolean, reason: String, controller: String?, name: String?) {
        try {
            val o = JSONObject()
                .put("active", active)
                .put("reason", reason)
                .put("at", System.currentTimeMillis())
            if (!controller.isNullOrEmpty()) o.put("controller", controller)
            if (!name.isNullOrEmpty()) o.put("name", name)
            socket?.emit(AgentBridge.EV_CTL_STATE, o)
        } catch (_: Exception) {
        }
    }

    private fun handleCtlStart(data: JSONObject) {
        val from = data.optString("from")
        val name = data.optString("name").ifEmpty { "الكمبيوتر" }
        if (from.isEmpty()) return
        if (ctlActive) {
            // الجلسة الواحدة فقط في الوقت نفسه — بلّغ بأن الخط مشغول
            emitCtlState(true, "busy", ctlController, ctlName)
            return
        }
        if (ctlRequireConfirm) {
            ctlPendingFrom = from
            ctlPendingName = name
            notifyCtlRequest(name)
            pushCtlToUi("start-request", mapOf("controller" to from, "name" to name))
            // لا حالة بعد — القرار قادم من الإشعار أو حوار الواجهة
        } else {
            acceptControl(from, name)
        }
    }

    private fun acceptControl(from: String, name: String) {
        ctlActive = true
        ctlController = from
        ctlName = name
        cancelCtlNotification()
        pushCtlToUi("state", mapOf("active" to true, "controller" to from, "name" to name, "reason" to "confirmed"))
        emitCtlState(true, "confirmed", from, name)
        emitDevState()
        android.util.Log.i(TAG, "control session started by $from ($name)")
    }

    private fun endControlSession(reason: String) {
        if (!ctlActive) return
        val c = ctlController
        val n = ctlName
        ctlActive = false
        ctlController = null
        ctlName = null
        cancelCtlNotification()
        pushCtlToUi("state", mapOf("active" to false, "controller" to (c ?: ""), "reason" to reason))
        emitCtlState(false, reason, c, n)
        emitDevState()
        android.util.Log.i(TAG, "control session ended: $reason")
    }

    /** قرار حوار الواجهة (MethodChannel — MainActivity). */
    fun decideControl(allow: Boolean) {
        val from = ctlPendingFrom
        val name = ctlPendingName
        ctlPendingFrom = null
        ctlPendingName = null
        cancelCtlNotification()
        if (allow && from != null) {
            acceptControl(from, name ?: "الكمبيوتر")
        } else if (from != null) {
            pushCtlToUi("state", mapOf("active" to false, "controller" to from, "reason" to "denied"))
            emitCtlState(false, "denied", from, name)
        }
    }

    /** زر القطع الفوري من التطبيق (البند 6). */
    fun phoneStopControl() {
        endControlSession("phone-stop")
    }

    private fun emitTouchAck(seq: Int, op: String, ok: Boolean, err: String?) {
        try {
            val o = JSONObject().put("op", op).put("ok", ok)
            if (seq > 0) o.put("seq", seq)
            if (err != null) o.put("err", err)
            socket?.emit(AgentBridge.EV_TOUCH_ACK, o)
        } catch (_: Exception) {
        }
    }

    private fun handleTouch(data: JSONObject) {
        if (!ctlActive) return // بوابة الجلسة — لا جلسة، لا حقن
        val svc = NexusAccessibilityService.instance
        val op = data.optString("op")
        val seq = data.optInt("seq", 0)
        if (svc == null) {
            emitTouchAck(seq, op, false, "accessibility-off")
            return
        }
        val x = data.optDouble("x", 0.0).toFloat()
        val y = data.optDouble("y", 0.0).toFloat()
        when (op) {
            "tap" -> svc.tap(x, y, seq)
            "long" -> svc.longPress(x, y, data.optLong("durationMs", 700), seq)
            "swipe" -> svc.swipe(
                x, y,
                data.optDouble("x2", x.toDouble()).toFloat(),
                data.optDouble("y2", y.toDouble()).toFloat(),
                data.optLong("durationMs", 300), "swipe", seq,
            )
            "scroll" -> svc.scroll(
                x, y,
                data.optDouble("x2", x.toDouble()).toFloat() - x,
                data.optDouble("y2", y.toDouble()).toFloat() - y,
                data.optLong("durationMs", 300), seq,
            )
            "down" -> svc.touchDown(x, y)
            "move" -> svc.touchMove(x, y)
            "up" -> svc.touchUp(x, y)
            else -> if (seq > 0) emitTouchAck(seq, op, false, "unknown-op")
        }
    }

    private fun handleText(data: JSONObject) {
        if (!ctlActive) return
        val svc = NexusAccessibilityService.instance
        if (svc == null) {
            emitTouchAck(0, "text", false, "accessibility-off")
            return
        }
        svc.setText(data.optString("text"), 0)
    }

    private fun handleKey(data: JSONObject) {
        if (!ctlActive) return
        val svc = NexusAccessibilityService.instance
        if (svc == null) {
            emitTouchAck(0, "key", false, "accessibility-off")
            return
        }
        svc.keyAction(data.optString("action"), 0)
    }

    /** فتح تطبيق بالحزمة (البند: افتح تطبيقًا من الويب) — لا يحتاج الإتاحة. */
    private fun handleAppOpen(data: JSONObject) {
        val action = data.optString("action", "open")
        val pkg = data.optString("pkg")
        if (action != "open" || pkg.isEmpty()) {
            socket?.emit(AgentBridge.EV_DEV_ACKED, JSONObject().put("text", "أمر تطبيق غير مدعوم — تجاهُل"))
            return
        }
        try {
            val intent = packageManager.getLaunchIntentForPackage(pkg)
            if (intent != null) {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                startActivity(intent)
                socket?.emit(
                    AgentBridge.EV_DEV_ACKED,
                    JSONObject().put("text", "فُتح تطبيق ${data.optString("name", pkg)} من الكمبيوتر"),
                )
            } else {
                socket?.emit(
                    AgentBridge.EV_DEV_ACKED,
                    JSONObject().put("text", "تعذّر فتح ${data.optString("name", pkg)} — التطبيق غير مثبت على الهاتف"),
                )
            }
        } catch (e: Exception) {
            socket?.emit(
                AgentBridge.EV_DEV_ACKED,
                JSONObject().put("text", "خطأ في فتح $pkg: ${e.message?.take(60) ?: "مجهول"}"),
            )
        }
    }

    // ------------------------------------------------------------------
    // FA-7 — أبعاد الشاشة الحقيقية (تحويل إحداثيات الويب)
    // ------------------------------------------------------------------

    private fun emitScreen() {
        try {
            val m = NexusAccessibilityService.instance?.screenInfo()
                ?: NexusAccessibilityService.metricsFromContext(this)
                ?: return
            socket?.emit(
                AgentBridge.EV_DEV_SCREEN,
                JSONObject()
                    .put("w", m.first)
                    .put("h", m.second)
                    .put("density", m.third),
            )
        } catch (_: Exception) {
        }
    }

    private fun registerDisplayListener() {
        try {
            val dm = getSystemService(Context.DISPLAY_SERVICE) as DisplayManager
            dm.registerDisplayListener(
                object : DisplayManager.DisplayListener {
                    override fun onDisplayAdded(displayId: Int) {}
                    override fun onDisplayRemoved(displayId: Int) {}
                    override fun onDisplayChanged(displayId: Int) {
                        // تدوير الشاشة أو تغيّر الكثافة → أبلغ الويب بأبعاد جديدة
                        main.post { emitScreen() }
                    }
                },
                main,
            )
        } catch (_: Exception) {
        }
    }

    // ------------------------------------------------------------------
    // FA-7 — إعداد طلب التأكيد (يُحفظ محليًا)
    // ------------------------------------------------------------------

    private fun loadCtlPrefs() {
        try {
            val p = getSharedPreferences("nexus_ctl", Context.MODE_PRIVATE)
            ctlRequireConfirm = p.getBoolean("require_confirm", true)
        } catch (_: Exception) {
        }
    }

    fun setCtlConfirm(enabled: Boolean) {
        ctlRequireConfirm = enabled
        try {
            getSharedPreferences("nexus_ctl", Context.MODE_PRIVATE)
                .edit().putBoolean("require_confirm", enabled).apply()
        } catch (_: Exception) {
        }
    }

    private val onConnect = Emitter.Listener {
        main.post {
            setState("online")
            // 1) تسجيل الحضور لدى جسر الحماية (بمعرّف الجهاز — يفعّل عروض النقل)
            socket?.emit(
                AgentBridge.EV_HELLO_PHONE,
                JSONObject()
                    .put("name", deviceName)
                    .put("deviceId", deviceId),
            )
            // 2) أبعاد الشاشة الحقيقية (أساس تحويل إحداثيات الويب — عقد §4.8)
            emitScreen()
            // 3) بدء المنارة + تقرير الحالة
            startBeacons()
        }
    }

    private fun ackCommand(cmd: String, args: Array<Any?>) {
        val data = args.firstOrNull() as? JSONObject
        val detail = when {
            data == null -> ""
            cmd == AgentBridge.EV_LOST && data.optBoolean("on") -> " — «${data.optString("message")}»"
            else -> ""
        }
        val text = "استُلم أمر «$cmd»$detail على $deviceName — الوكيل حي"
        socket?.emit(AgentBridge.EV_DEV_ACKED, JSONObject().put("text", text))
        android.util.Log.i(TAG, "$cmd $detail")
    }

    // ------------------------------------------------------------------
    // المنارة وتقرير الحالة
    // ------------------------------------------------------------------

    private fun startBeacons() {
        stopTimers()

        beaconRun = object : Runnable {
            override fun run() {
                try {
                    if (socket?.connected() == true) {
                        // الموقع الحقيقي لـ RSSI يحتاج صلاحيات الموقع — قناة LAN الوثيقة تكفي
                        // لإثبات القرب عمليًا؛ القيمة أدناه ثابتة توحيديًا حتى مرحلة الحماية.
                        socket?.emit(
                            AgentBridge.EV_BEACON,
                            JSONObject()
                                .put("rssi", -52)
                                .put("device", deviceName),
                        )
                    }
                } catch (_: Exception) {
                }
                main.postDelayed(this, BEACON_MS)
            }
        }
        main.postDelayed(beaconRun!!, BEACON_MS)

        stateRun = object : Runnable {
            override fun run() {
                try {
                    emitDevState()
                } catch (_: Exception) {
                }
                main.postDelayed(this, STATE_MS)
            }
        }
        main.postDelayed(stateRun!!, STATE_MS)
    }

    /** تقرير الحالة الدوري + بعد جلسة التحكم والإتاحة (البند 6 — مؤشر الحالة). */
    private fun emitDevState() {
        try {
            if (socket?.connected() != true) return
            socket?.emit(
                AgentBridge.EV_DEV_STATE,
                JSONObject()
                    .put("deviceId", deviceId)
                    .put("name", deviceName)
                    .put("battery", readBattery())
                    .put("source", "agent")
                    .put("accessibility", NexusAccessibilityService.isReady)
                    .put("ctl", JSONObject(ctlSnapshot()))
                    .put("at", System.currentTimeMillis()),
            )
        } catch (_: Exception) {
        }
    }

    private fun readBattery(): Int = try {
        val bm = getSystemService(BATTERY_SERVICE) as BatteryManager
        bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
    } catch (_: Exception) {
        100
    }

    // ------------------------------------------------------------------
    // حارس الاتصال (watchdog)
    // ------------------------------------------------------------------

    private fun startWatchdog() {
        if (watchdogRun != null) return
        watchdogRun = object : Runnable {
            override fun run() {
                try {
                    val s = socket
                    if (s != null && !s.connected()) {
                        android.util.Log.w(TAG, "watchdog: reconnecting…")
                        s.connect()
                        setState("reconnecting")
                    }
                    val p = prodSocket
                    if (p != null && !p.connected()) p.connect()
                } catch (_: Exception) {
                }
                main.postDelayed(this, WATCHDOG_MS)
            }
        }
        main.postDelayed(watchdogRun!!, WATCHDOG_MS)
    }

    // ------------------------------------------------------------------
    // الحالة والإشعار
    // ------------------------------------------------------------------

    private fun setState(s: String) {
        currentState = s
        MainActivity.pushEvent(s, currentServerKey, null)
        updateNotification(s)
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(
                CHANNEL_ID,
                "NexusLink — قناة الجهاز",
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = "حالة الاتصال الدائم بسيرفر NexusLink"
                setShowBadge(false)
            }
            (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
                .createNotificationChannel(ch)
        }
    }

    private fun createTxChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(
                TX_CHANNEL_ID,
                "NexusLink — نقل الملفات",
                NotificationManager.IMPORTANCE_DEFAULT,
            ).apply {
                description = "عروض الملفات الواردة واكتمال الاستلام"
            }
            (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
                .createNotificationChannel(ch)
        }
    }

    private fun createCtlChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(
                CTL_CHANNEL_ID,
                "NexusLink — التحكم عن بعد",
                NotificationManager.IMPORTANCE_HIGH,
            ).apply {
                description = "طلبات بدء جلسات التحكم باللمس من الكمبيوتر"
                setShowBadge(true)
            }
            (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
                .createNotificationChannel(ch)
        }
    }

    private fun startForegroundCompat() {
        val n = buildNotification("connecting")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(NOTIF_ID, n)
        }
    }

    private fun updateNotification(state: String) {
        try {
            (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
                .notify(NOTIF_ID, buildNotification(state))
        } catch (_: Exception) {
        }
    }

    private fun buildNotification(state: String): Notification {
        val label = when (state) {
            "online" -> "متصل بـ ${currentServerKey ?: "السيرفر"}"
            "connecting" -> "جارٍ الاتصال…"
            "reconnecting" -> "إعادة اتصال…"
            "offline" -> "غير متصل — محاولة تلقائية…"
            else -> "متوقف"
        }
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }
        return builder
            .setContentTitle("NexusLink Agent")
            .setContentText(label)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .build()
    }

    // ------------------------------------------------------------------
    // تنظيف
    // ------------------------------------------------------------------

    private fun stopTimers() {
        beaconRun?.let { main.removeCallbacks(it) }
        beaconRun = null
        stateRun?.let { main.removeCallbacks(it) }
        stateRun = null
    }

    override fun onDestroy() {
        stopTimers()
        watchdogRun?.let { main.removeCallbacks(it) }
        watchdogRun = null
        try {
            socket?.off()
            socket?.disconnect()
            prodSocket?.off()
            prodSocket?.disconnect()
        } catch (_: Exception) {
        }
        socket = null
        prodSocket = null
        setState("stopped")
        super.onDestroy()
    }

    private val TAG = "NexusAgent"
}

/** ثوابت الأحداث — مرآة حرفية لجسري الحماية (3006) والإنتاجية (3007) في عقد البروتوكول. */
object AgentBridge {
    const val GUARD_PORT = 3006
    const val PROD_PORT = 3007

    const val EV_HELLO_PHONE = "guard:hello-phone"
    const val EV_BEACON = "prox:beacon"
    const val EV_DEV_STATE = "dev:state"
    const val EV_DEV_ACKED = "dev:acked"
    const val EV_LOST = "dev:lost"

    // نقل الملفات (عقد §8)
    const val EV_TX_OFFER = "tx:offer"
    const val EV_TX_ACCEPT = "tx:accept"
    const val EV_TX_REJECT = "tx:reject"
    const val EV_TX_PROGRESS = "tx:progress"
    const val EV_TX_STATE = "tx:state"
    const val EV_TX_PAUSE = "tx:pause"
    const val EV_TX_RESUME = "tx:resume"
    const val EV_TX_CANCEL = "tx:cancel"

    // FA-7 — التحكم باللمس والحقن (عقد §4.8)
    const val EV_CTL_START = "dev:ctl-start"
    const val EV_CTL_STOP = "dev:ctl-stop"
    const val EV_CTL_STATE = "dev:ctl-state"
    const val EV_TOUCH = "dev:touch"
    const val EV_TEXT = "dev:text"
    const val EV_KEY = "dev:key"
    const val EV_TOUCH_ACK = "dev:touch-ack"
    const val EV_DEV_SCREEN = "dev:screen"
    const val EV_APP = "dev:app"

    // الإنتاجية (عقد §4.5)
    const val EV_CLIP_NEW = "clip:new"
    const val EV_HAND_NEW = "hand:new"

    val PC_COMMANDS = listOf(
        "dev:ring", "dev:ring-stop", "dev:light", "dev:lost", "dev:lost-off",
        "dev:wipe", "dev:alarm", "dev:qs",
    )
}
