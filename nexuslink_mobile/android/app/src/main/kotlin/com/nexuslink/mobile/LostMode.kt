package com.nexuslink.mobile

import android.Manifest
import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle

import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * LostMode — وضع الفقدان (FA-10، عقد §9.3).
 *
 * أمر من الكمبيوتر (`sec:lost-cmd` أو `cmd {op:"lock-phone"}` مشفرًا أو `dev:lost` على 3006):
 *  1) قفل التطبيق (راية locked في prefs تقرأها بوابة LockScreen في Dart)
 *  2) شاشة ملء الشاشة حمراء برسالة المالك (تعمل فوق شاشة القفل)
 *  3) بيانات الموقع من LocationManager → تُبلَّغ مشفرة عبر sec:frame + حالة عامة sec:lock-state
 *
 * الإلغاء: `dev:lost-off` أو أمر من الواجهة.
 */
object LostMode {

    const val PREFS = "nexus_sec"
    private const val LOST_CHANNEL_ID = "nexus_lost_channel"
    private const val LOST_NOTIF_ID = 4501

    @Volatile
    var active: Boolean = false

    @Volatile
    var message: String = ""

    fun isActive(ctx: Context): Boolean =
        try { ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("lost", false) } catch (_: Exception) { false }

    fun storedMessage(ctx: Context): String =
        try { ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("lost_message", "") ?: "" } catch (_: Exception) { "" }

    /** تفعيل وضع الفقدان: قفل + شاشة + إشعار + موقع (اختياري). */
    fun start(ctx: Context, msg: String, locate: Boolean) {
        active = true
        message = msg.ifEmpty { "هذا الهاتف فُقد — يرجى التواصل مع مالكه" }
        try {
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putBoolean("lost", true)
                .putString("lost_message", message)
                .putLong("lost_at", System.currentTimeMillis())
                .apply()
        } catch (_: Exception) {
        }

        // 1) شاشة ملء الشاشة (قد تُرفض من الخلفية على 10+ — الإشعار الكامل الشاشة هو الاحتياط)
        try {
            val i = Intent(ctx, LostModeActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            ctx.startActivity(i)
        } catch (_: Exception) {
        }

        // 2) إشعار full-screen intent — يرفع الشاشة حتى مقفلة
        notifyFullScreen(ctx)

        // 3) الموقع في خيط خلفي — النتيجة عبر الخدمة (sec:lock-state + إطار مشفر)
        if (locate) {
            Thread {
                val loc = readLocation(ctx, 10_000L)
                AgentForegroundService.liveInstance?.emitLostState(loc)
            }.start()
        }
        emitUi()
    }

    /** إلغاء وضع الفقدان. */
    fun stop(ctx: Context) {
        active = false
        message = ""
        try {
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().putBoolean("lost", false).remove("lost_message").apply()
        } catch (_: Exception) {
        }
        try {
            (ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancel(LOST_NOTIF_ID)
        } catch (_: Exception) {
        }
        LostModeActivity.finishIfAlive()
        emitUi()
    }

    /** دفع حالة الفقدان إلى واجهة Dart. */
    fun emitUi() {
        MainActivity.pushDataEvent(
            "lost",
            mapOf(
                "active" to active,
                "message" to message,
            ),
        )
    }

    private fun notifyFullScreen(ctx: Context) {
        try {
            val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                nm.createNotificationChannel(
                    NotificationChannel(LOST_CHANNEL_ID, "NexusLink — وضع الفقدان", NotificationManager.IMPORTANCE_HIGH).apply {
                        description = "تنبيه وضع الفقدان — يرفع الشاشة فورًا"
                        enableVibration(true)
                        setShowBadge(true)
                    },
                )
            }
            val fullScreen = PendingIntent.getActivity(
                ctx, LOST_NOTIF_ID,
                Intent(ctx, LostModeActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Notification.Builder(ctx, LOST_CHANNEL_ID)
            } else {
                @Suppress("DEPRECATION")
                Notification.Builder(ctx)
            }
            builder.setContentTitle("NexusLink — وضع الفقدان مفعّل")
                .setContentText(message.ifEmpty { "هذا الهاتف فُقد" })
                .setSmallIcon(android.R.drawable.ic_dialog_alert)
                .setPriority(Notification.PRIORITY_MAX)
                .setCategory(Notification.CATEGORY_ALARM)
                .setFullScreenIntent(fullScreen, true)
                .setAutoCancel(false)
                .setOngoing(true)
            nm.notify(LOST_NOTIF_ID, builder.build())
        } catch (_: Exception) {
        }
    }

    /**
     * قراءة الموقع: آخر موقع معروف خلال 15 دقيقة من (GPS/الشبكة/الخامل) —
     * وإلا تحديث وحيد احتياطي بحد 10 ثوانٍ. يتطلب صلاحية الموقع الممنوحة.
     */
    fun readLocation(ctx: Context, timeoutMs: Long): JSONObject? {
        try {
            val fine = ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            val coarse = ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
            if (!fine && !coarse) return null
            val lm = ctx.getSystemService(Context.LOCATION_SERVICE) as LocationManager
            val providers = buildList {
                if (lm.isProviderEnabled(LocationManager.GPS_PROVIDER)) add(LocationManager.GPS_PROVIDER)
                if (lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) add(LocationManager.NETWORK_PROVIDER)
                if (lm.isProviderEnabled(LocationManager.PASSIVE_PROVIDER)) add(LocationManager.PASSIVE_PROVIDER)
            }
            val fresh = System.currentTimeMillis() - 15 * 60 * 1000L
            var best: Location? = null
            for (p in providers) {
                try {
                    val l = lm.getLastKnownLocation(p) ?: continue
                    if (l.time >= fresh && (best == null || l.accuracy < best!!.accuracy)) best = l
                } catch (_: SecurityException) {
                }
            }
            if (best == null && providers.isNotEmpty()) {
                val latch = CountDownlatch1()
                val listener = LocationListener { l ->
                    latch.hit(l)
                }
                for (p in providers) {
                    try { lm.requestSingleUpdate(p, listener, Looper.getMainLooper()) } catch (_: Exception) {
                    }
                }
                latch.await(timeoutMs)
                try { lm.removeUpdates(listener) } catch (_: Exception) {
                }
                best = latch.value
            }
            return best?.let {
                JSONObject()
                    .put("lat", it.latitude)
                    .put("lng", it.longitude)
                    .put("accuracy", it.accuracy.toDouble())
                    .put("at", System.currentTimeMillis())
            }
        } catch (_: Exception) {
            return null
        }
    }

    /** مغلف بسيط حول CountDownLatch لأول قراءة موقع. */
    private class CountDownlatch1 {
        private val latch = CountDownLatch(1)
        @Volatile var value: Location? = null
        fun hit(l: Location) { value = l; latch.countDown() }
        fun await(ms: Long) { latch.await(ms, TimeUnit.MILLISECONDS) }
    }
}

/**
 * LostModeActivity — شاشة ملء الشاشة فوق القفل برسالة المالك.
 * بلا layout XML — تُبنى برمجيًا حتى لا تتضخم الموارد.
 */
class LostModeActivity : Activity() {

    companion object {
        @Volatile
        private var instance: LostModeActivity? = null
        fun finishIfAlive() {
            val a = instance
            Handler(Looper.getMainLooper()).post {
                try { a?.finish() } catch (_: Exception) {
                }
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        instance = this
        // فوق شاشة القفل (API 27+ واجهة نظيفة، وقبلها الأعلام القديمة)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                    or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON,
            )
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        val msg = LostMode.storedMessage(this).ifEmpty { "هذا الهاتف فُقد — يرجى التواصل مع مالكه" }
        val device = try {
            android.provider.Settings.Global.getString(contentResolver, android.provider.Settings.Global.DEVICE_NAME)
                ?: "NexusLink"
        } catch (_: Exception) {
            "NexusLink"
        }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor("#7F1D1D"))
            setPadding(dp(28), dp(28), dp(28), dp(28))
        }

        val shield = TextView(this).apply {
            text = "🛡️"
            textSize = 64f
            gravity = Gravity.CENTER
        }
        val title = TextView(this).apply {
            text = "الهاتف في وضع الفقدان"
            textSize = 26f
            setTextColor(Color.WHITE)
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            setPadding(0, dp(16), 0, dp(8))
        }
        val body = TextView(this).apply {
            text = msg
            textSize = 18f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            setPadding(0, dp(8), 0, dp(16))
        }
        val meta = TextView(this).apply {
            text = "$device · NexusLink Agent حيّ ويُبلّغ عن الموقع"
            textSize = 12f
            setTextColor(Color.parseColor("#FCA5A5"))
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, dp(28))
        }
        val open = Button(this).apply {
            text = "فتح التطبيق (يتطلب القفل)"
            setTextColor(Color.WHITE)
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#991B1B"))
                cornerRadius = dp(14).toFloat()
            }
            setPadding(dp(24), dp(12), dp(24), dp(12))
            setOnClickListener {
                try {
                    startActivity(
                        Intent(this@LostModeActivity, MainActivity::class.java)
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
                    )
                } catch (_: Exception) {
                }
            }
        }
        root.addView(shield)
        root.addView(title)
        root.addView(body)
        root.addView(meta)
        root.addView(open, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        setContentView(root)
    }

    override fun onDestroy() {
        if (instance === this) instance = null
        super.onDestroy()
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()
}
