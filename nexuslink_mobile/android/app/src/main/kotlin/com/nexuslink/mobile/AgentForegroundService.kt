package com.nexuslink.mobile

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
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
 * AgentForegroundService — قلب "وكيل الجهاز" (البند 6 من المهمة).
 *
 * خدمة أمامية (Foreground Service, type=dataSync) تملك اتصال socket.io دائمًا
 * مع جسر الحماية (منفذ 3006 — القناة الحاضنة للجهاز في بروتوكول Nexus):
 *  · تسجيل الحضور: guard:hello-phone
 *  · منارة القرب كل 5 ثوانٍ: prox:beacon (أولوية للهاتف الحقيقي على المحاكاة)
 *  · تقرير حالة كل 30 ثانية: dev:state (بطارية/معرّف)
 *  · الاستماع لأوامر الكمبيوتر: dev:ring|light|lost|wipe|alarm|qs… (إقرار الآن، تنفيذ كامل في مرحلة الحماية)
 *  · إعادة اتصال تلقائي مدمجة + حارس دوري (watchdog) كل 15 ثانية
 *
 * نمط الوصول (مطابق لعقد docs/protocol-contract.md):
 *  · gateway → ws://host:81 مع ?XTransformPort=3006 (نفس نمط عميل الويب عبر Caddy)
 *  · direct  → ws://host:3006 مباشرة
 */
class AgentForegroundService : Service() {

    companion object {
        const val CHANNEL_ID = "nexus_agent_channel"
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
    }

    private var socket: Socket? = null

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

        // إعادة البدء إن قتلها النظام
        return START_STICKY
    }

    // ------------------------------------------------------------------
    // الاتصال الدائم
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

            s.connect()
            startWatchdog()
        } catch (e: Exception) {
            setState("offline")
            android.util.Log.e(TAG, "connect failed", e)
        }
    }

    private val onConnect = Emitter.Listener {
        main.post {
            setState("online")
            // 1) تسجيل الحضور لدى جسر الحماية
            socket?.emit(
                AgentBridge.EV_HELLO_PHONE,
                JSONObject().put("name", deviceName),
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
        } catch (_: Exception) {
        }
        socket = null
        setState("stopped")
        super.onDestroy()
    }

    private val TAG = "NexusAgent"
}

/** ثوابت الأحداث — مرآة حرفية لجسر الحماية (3006) في عقد البروتوكول. */
object AgentBridge {
    const val GUARD_PORT = 3006

    const val EV_HELLO_PHONE = "guard:hello-phone"
    const val EV_BEACON = "prox:beacon"
    const val EV_DEV_STATE = "dev:state"
    const val EV_DEV_ACKED = "dev:acked"
    const val EV_LOST = "dev:lost"

    val PC_COMMANDS = listOf(
        "dev:ring", "dev:ring-stop", "dev:light", "dev:lost", "dev:lost-off",
        "dev:wipe", "dev:alarm", "dev:qs", "dev:app",
    )
}
