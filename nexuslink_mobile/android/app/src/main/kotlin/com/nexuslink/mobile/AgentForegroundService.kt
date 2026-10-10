package com.nexuslink.mobile

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
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
        const val NOTIF_ID = 4201

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
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
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
        setState("connecting")
        connect()
        connectProd()

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
            s.on(Socket.EVENT_DISCONNECT) { setState("offline") }
            s.on(Socket.EVENT_CONNECT_ERROR) { setState("reconnecting") }

            // أوامر الكمبيوتر → الهاتف: إقرار الاستلام (التنفيذ الكامل في مرحلة الحماية)
            for (cmd in AgentBridge.PC_COMMANDS) {
                s.on(cmd) { args -> main.post { ackCommand(cmd, args) } }
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
        if (intent?.getStringExtra("nexus.action") == "reject") {
            val offerId = intent.getStringExtra("nexus.offerId") ?: return
            try {
                socket?.emit(AgentBridge.EV_TX_REJECT, JSONObject().put("id", offerId))
                (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
                    .cancel(offerId.hashCode() and 0x7fffffff)
            } catch (_: Exception) {
            }
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
            // 2) بدء المنارة + تقرير الحالة
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
                    if (socket?.connected() == true) {
                        socket?.emit(
                            AgentBridge.EV_DEV_STATE,
                            JSONObject()
                                .put("deviceId", deviceId)
                                .put("name", deviceName)
                                .put("battery", readBattery())
                                .put("source", "agent")
                                .put("at", System.currentTimeMillis()),
                        )
                    }
                } catch (_: Exception) {
                }
                main.postDelayed(this, STATE_MS)
            }
        }
        main.postDelayed(stateRun!!, STATE_MS)
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

    // الإنتاجية (عقد §4.5)
    const val EV_CLIP_NEW = "clip:new"
    const val EV_HAND_NEW = "hand:new"

    val PC_COMMANDS = listOf(
        "dev:ring", "dev:ring-stop", "dev:light", "dev:lost", "dev:lost-off",
        "dev:wipe", "dev:alarm", "dev:qs", "dev:app",
    )
}
