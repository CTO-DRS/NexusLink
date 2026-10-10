package com.nexuslink.mobile

import android.content.Intent
import android.os.BatteryManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodChannel

/**
 * MainActivity — بوابتا Flutter ⇄ Native:
 *  1) MethodChannel "nexuslink/agent": startAgent / stopAgent / lastState / deviceInfo
 *  2) EventChannel "nexuslink/agent/events": بث حالة القناة (online/offline/reconnecting)
 */
class MainActivity : FlutterActivity() {

    companion object {
        const val METHOD_CH = "nexuslink/agent"
        const val EVENT_CH = "nexuslink/agent/events"

        private val mainHandler = Handler(Looper.getMainLooper())

        /** دفع حدث حالة من الخدمة الخلفية إلى Dart (يُتجاهل إن كانت الواجهة مغلقة). */
        fun pushEvent(state: String, serverKey: String?, detail: String?) {
            val sink = eventSink ?: return
            mainHandler.post {
                try {
                    val payload = HashMap<String, Any?>().apply {
                        put("state", state)
                        put("serverKey", serverKey ?: "")
                        put("detail", detail)
                    }
                    sink.success(payload)
                } catch (_: Exception) {
                }
            }
        }

        @Volatile
        var eventSink: EventChannel.EventSink? = null
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, METHOD_CH).setMethodCallHandler { call, result ->
            when (call.method) {
                "startAgent" -> {
                    val intent = Intent(this, AgentForegroundService::class.java).apply {
                        putExtra("host", call.argument<String>("host") ?: "")
                        putExtra("port", call.argument<Int>("port") ?: 81)
                        putExtra("mode", call.argument<String>("mode") ?: "gateway")
                        putExtra("bridgePort", call.argument<Int>("bridgePort") ?: AgentBridge.GUARD_PORT)
                        putExtra("deviceId", call.argument<String>("deviceId") ?: "")
                        putExtra("deviceName", call.argument<String>("deviceName") ?: "Nexus Android")
                        putExtra("serverKey", call.argument<String>("serverKey") ?: "")
                    }
                    try {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                            startForegroundService(intent)
                        } else {
                            startService(intent)
                        }
                        result.success(true)
                    } catch (e: Exception) {
                        result.error("start_failed", e.message, null)
                    }
                }

                "stopAgent" -> {
                    stopService(Intent(this, AgentForegroundService::class.java))
                    result.success(true)
                }

                "lastState" -> result.success(AgentForegroundService.currentState)

                "deviceInfo" -> {
                    val battery = try {
                        val bm = getSystemService(BATTERY_SERVICE) as BatteryManager
                        bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
                    } catch (_: Exception) {
                        100
                    }
                    val deviceName = try {
                        Settings.Global.getString(contentResolver, "device_name")
                    } catch (_: Exception) {
                        null
                    } ?: Build.DEVICE
                    val info = mapOf(
                        "androidId" to (
                            Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID) ?: ""
                            ),
                        "model" to Build.MODEL,
                        "manufacturer" to Build.MANUFACTURER,
                        "deviceName" to deviceName,
                        "os" to "Android ${Build.VERSION.RELEASE} (SDK ${Build.VERSION.SDK_INT})",
                        "battery" to battery,
                    )
                    result.success(info)
                }

                else -> result.notImplemented()
            }
        }

        EventChannel(flutterEngine.dartExecutor.binaryMessenger, EVENT_CH).setStreamHandler(
            object : EventChannel.StreamHandler {
                override fun onListen(args: Any?, events: EventChannel.EventSink?) {
                    eventSink = events
                    // أرسل الحالة الحالية فورًا لمزامنة الواجهة
                    MainActivity.pushEvent(AgentForegroundService.currentState, AgentForegroundService.currentServerKey, null)
                }

                override fun onCancel(args: Any?) {
                    eventSink = null
                }
            },
        )
    }
}
