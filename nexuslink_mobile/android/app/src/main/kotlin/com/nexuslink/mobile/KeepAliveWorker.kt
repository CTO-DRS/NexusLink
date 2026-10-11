package com.nexuslink.mobile

import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/**
 * KeepAliveWorker — حزام أمان دوري (FA-10، عقد §9.4).
 *
 * كل 15 دقيقة: إن كان الإقلاع التلقائي مفعّلًا وهناك اتصال محفوظ والخدمة ميتة
 * (قتلها النظام لضغط الذاكرة) → يعيد تشغيلها. START_STICKY يعيد الخدمة غالبًا،
 * وهذا العامل يغطي الحالات التي يفشل فيها ذلك (برو ماكر، إعدادات صانع الجهاز).
 */
class KeepAliveWorker(
    context: Context,
    params: WorkerParameters,
) : Worker(context, params) {

    override fun doWork(): Result {
        try {
            val ctx = applicationContext
            val p = ctx.getSharedPreferences(AgentServicePrefs.PREFS, Context.MODE_PRIVATE)
            if (!p.getBoolean(AgentServicePrefs.KEY_AUTOSTART, true)) return Result.success()
            val host = p.getString(AgentServicePrefs.KEY_HOST, "") ?: ""
            if (host.isEmpty()) return Result.success()
            // الخدمة حية؟ (started / اتصال جارٍ / إعادة اتصال)
            val running = AgentForegroundService.liveInstance != null &&
                AgentForegroundService.currentState != "stopped"
            if (running) return Result.success()
            val i = Intent(ctx, AgentForegroundService::class.java).apply {
                putExtra("host", host)
                putExtra("port", p.getInt(AgentServicePrefs.KEY_PORT, 81))
                putExtra("mode", p.getString(AgentServicePrefs.KEY_MODE, "gateway"))
                putExtra("bridgePort", p.getInt(AgentServicePrefs.KEY_BRIDGE, 3006))
                putExtra("deviceId", p.getString(AgentServicePrefs.KEY_DEVICE_ID, "") ?: "")
                putExtra("deviceName", p.getString(AgentServicePrefs.KEY_DEVICE_NAME, "Nexus Android") ?: "Nexus Android")
                putExtra("serverKey", p.getString(AgentServicePrefs.KEY_SERVER_KEY, "") ?: "")
                putExtra("fromKeepAlive", true)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.startForegroundService(i)
            } else {
                ctx.startService(i)
            }
            android.util.Log.i("NexusKeepAlive", "أُعيد إقلاع الخدمة من العامل الدوري")
        } catch (e: Exception) {
            android.util.Log.e("NexusKeepAlive", "keepalive failed", e)
        }
        return Result.success()
    }

    companion object {
        fun schedule(ctx: Context) {
            try {
                WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(
                    "nexus_keepalive",
                    ExistingPeriodicWorkPolicy.KEEP,
                    PeriodicWorkRequestBuilder<KeepAliveWorker>(15, TimeUnit.MINUTES).build(),
                )
            } catch (_: Exception) {
            }
        }
    }
}
