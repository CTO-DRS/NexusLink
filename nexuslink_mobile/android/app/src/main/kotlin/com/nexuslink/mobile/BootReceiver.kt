package com.nexuslink.mobile

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

/**
 * BootReceiver — الإقلاع التلقائي مع النظام (FA-10، عقد §9.4).
 *
 * عند BOOT_COMPLETED يقرأ آخر اتصال محفوظ من SharedPreferences `nexus_agent`
 * (تُكتب في كل onStartCommand من الخدمة) ومفتاح autoStart (من لوحة الأمان في الواجهة)
 * — ويعيد تشغيل الخدمة الأمامية بلا واجهة إطلاقًا.
 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        if (action != Intent.ACTION_BOOT_COMPLETED &&
            action != "android.intent.action.QUICKBOOT_POWERON" &&
            action != "android.intent.action.LOCKED_BOOT_COMPLETED"
        ) return

        try {
            val p = context.getSharedPreferences(AgentServicePrefs.PREFS, Context.MODE_PRIVATE)
            val autoStart = p.getBoolean(AgentServicePrefs.KEY_AUTOSTART, true)
            val host = p.getString(AgentServicePrefs.KEY_HOST, "") ?: ""
            if (!autoStart || host.isEmpty()) {
                android.util.Log.i("NexusBoot", "boot: autostart=$autoStart host=${if (host.isEmpty()) "فارغ" else "مضبوط"} — لا إقلاع")
                return
            }
            val i = Intent(context, AgentForegroundService::class.java).apply {
                putExtra("host", host)
                putExtra("port", p.getInt(AgentServicePrefs.KEY_PORT, 81))
                putExtra("mode", p.getString(AgentServicePrefs.KEY_MODE, "gateway"))
                putExtra("bridgePort", p.getInt(AgentServicePrefs.KEY_BRIDGE, 3006))
                putExtra("deviceId", p.getString(AgentServicePrefs.KEY_DEVICE_ID, "") ?: "")
                putExtra("deviceName", p.getString(AgentServicePrefs.KEY_DEVICE_NAME, "Nexus Android") ?: "Nexus Android")
                putExtra("serverKey", p.getString(AgentServicePrefs.KEY_SERVER_KEY, "") ?: "")
                putExtra("fromBoot", true)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(i)
            } else {
                context.startService(i)
            }
            android.util.Log.i("NexusBoot", "boot: أُعيد إقلاع الوكيل إلى $host:${p.getInt(AgentServicePrefs.KEY_PORT, 81)}")
        } catch (e: Exception) {
            android.util.Log.e("NexusBoot", "boot failed", e)
        }
    }
}

/** مفاتيح التخزين المشتركة بين الخدمة/الإقلاع/العامل الدوري. */
object AgentServicePrefs {
    const val PREFS = "nexus_agent"
    const val KEY_AUTOSTART = "autoStart"
    const val KEY_HOST = "host"
    const val KEY_PORT = "port"
    const val KEY_MODE = "mode"
    const val KEY_BRIDGE = "bridgePort"
    const val KEY_DEVICE_ID = "deviceId"
    const val KEY_DEVICE_NAME = "deviceName"
    const val KEY_SERVER_KEY = "serverKey"
}
