package com.nexuslink.mobile

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.telephony.TelephonyManager
import android.view.Gravity
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONObject

/**
 * KillMode — الطوارئ الذكي على الهاتف (enterprise-deploy §48.د/§48.ز، عقد §46).
 *
 *  · `guard:arm {rules:{unlockFailLimit, simChangeAction}, at}` → تخزين القواعد محليًا
 *    + خط أساس الشريحة لحظة التسليح (مشغّل الشبكة/الدولة/الحالة — بلا أي صلاحية).
 *  · `dev:kill` من الخادم (بعد PIN + كلمة التأكيد) أو التصعيد الذاتي بلا شبكة →
 *    شاشة القتل بلا زر ولا مسار عودة داخل التطبيق، مرسَّخة في prefs فإعادة
 *    التشغيل/الإقلاع تعيدها، وكل أوامر الكمبيوتر الأخرى تصير صامتة.
 *  · ترتيب القرار حرفيًا كـ decideSelfEscalation في emergency-core.ts:
 *    already-killed ← unlock-fails ← sim-changed (والقواعد الغائبة = لا تصعيد).
 *
 * حدود صادقة (§48.و): سياسة تطبيق لا عتاد — لا مسح بيانات ولا إقفال للنظام؛
 * فلاش الجهاز أو إزالة التطبيق تمحو الوكيل. «warn» يُبلغ الكمبيوتر فقط.
 */
object KillMode {

    private const val PREFS = "nexus_sec"
    private const val CHANNEL_ID = "nexus_kill_channel"
    private const val NOTIF_ID = 4502

    fun isKilled(ctx: Context): Boolean =
        try { prefs(ctx).getBoolean("killed", false) } catch (_: Exception) { false }

    fun killReason(ctx: Context): String =
        try { prefs(ctx).getString("kill_reason", "") ?: "" } catch (_: Exception) { "" }

    fun isArmed(ctx: Context): Boolean = unlockLimit(ctx) > 0

    private fun unlockLimit(ctx: Context): Int =
        try { prefs(ctx).getInt("arm_unlock_limit", 0) } catch (_: Exception) { 0 }

    private fun simAction(ctx: Context): String =
        try { prefs(ctx).getString("arm_sim_action", "off") ?: "off" } catch (_: Exception) { "off" }

    fun unlockFails(ctx: Context): Int =
        try { prefs(ctx).getInt("unlock_fails", 0) } catch (_: Exception) { 0 }

    /** حالة للواجهة ولتقرير dev:state (لا أسرار). */
    fun status(ctx: Context): Map<String, Any> = mapOf(
        "killed" to isKilled(ctx),
        "armed" to isArmed(ctx),
        "unlockFailLimit" to unlockLimit(ctx),
        "simChangeAction" to simAction(ctx),
        "unlockFails" to unlockFails(ctx),
    )

    /**
     * تخزين قواعد guard:arm بتطبيع دفاعي يطابق normalizeArmRules على الخادم
     * (الحد 3–10، الإجراء kill/warn/off). يُرجع false لحمولة بلا حد رقمي.
     */
    fun storeRules(ctx: Context, data: JSONObject): Boolean {
        val rules = data.optJSONObject("rules") ?: return false
        if (!rules.has("unlockFailLimit")) return false
        val raw = rules.optDouble("unlockFailLimit", Double.NaN)
        if (raw.isNaN()) return false
        val limit = raw.toInt().coerceIn(3, 10)
        val action = when (rules.optString("simChangeAction", "warn")) {
            "kill" -> "kill"
            "off" -> "off"
            else -> "warn"
        }
        try {
            prefs(ctx).edit()
                .putInt("arm_unlock_limit", limit)
                .putString("arm_sim_action", action)
                .putString("arm_at", data.optString("at", ""))
                .putString("sim_baseline", simFingerprint(ctx))
                .putInt("unlock_fails", 0)
                .apply()
        } catch (_: Exception) {
            return false
        }
        return true
    }

    /** محاولة فتح فاشلة على قفل التطبيق — يُرجع true إن أدت للقتل. */
    fun recordUnlockFail(ctx: Context): Boolean {
        if (isKilled(ctx)) return true
        val n = unlockFails(ctx) + 1
        try { prefs(ctx).edit().putInt("unlock_fails", n).apply() } catch (_: Exception) {
        }
        val limit = unlockLimit(ctx)
        if (limit > 0 && n >= limit) {
            kill(ctx, "unlock-fails")
            return true
        }
        return false
    }

    fun resetUnlockFails(ctx: Context) {
        try { prefs(ctx).edit().putInt("unlock_fails", 0).apply() } catch (_: Exception) {
        }
    }

    /**
     * فحص تغيير الشريحة مقابل خط أساس التسليح. يُرجع "kill" أو "warn" أو null.
     * التحذير يُطلق مرة واحدة لكل بصمة جديدة (لا إغراق).
     */
    fun checkSim(ctx: Context): String? {
        if (isKilled(ctx) || !isArmed(ctx)) return null
        val action = simAction(ctx)
        if (action == "off") return null
        val p = prefs(ctx)
        val base = p.getString("sim_baseline", null) ?: return null
        val now = simFingerprint(ctx)
        if (now == base) return null
        if (action == "kill") {
            kill(ctx, "sim-changed")
            return "kill"
        }
        if (p.getString("sim_warned", null) == now) return null
        try { p.edit().putString("sim_warned", now).apply() } catch (_: Exception) {
        }
        return "warn"
    }

    /** بصمة شريحة بلا صلاحيات: الحالة + المشغّل + الدولة. */
    fun simFingerprint(ctx: Context): String = try {
        val tm = ctx.getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager
        val ready = tm.simState == TelephonyManager.SIM_STATE_READY
        if (!ready) "absent:${tm.simState}" else "ready:${tm.simOperator}:${tm.simCountryIso}"
    } catch (_: Exception) {
        "unknown"
    }

    /** القتل: ترسيخ + قفل التطبيق + إنهاء الفقدان + الشاشة. أحادي الاتجاه. */
    fun kill(ctx: Context, reason: String) {
        try {
            prefs(ctx).edit()
                .putBoolean("killed", true)
                .putString("kill_reason", reason.take(32))
                .putLong("kill_at", System.currentTimeMillis())
                .putBoolean("locked", true)
                .apply()
        } catch (_: Exception) {
        }
        try { LostMode.stop(ctx) } catch (_: Exception) {
        }
        show(ctx)
        try {
            MainActivity.pushDataEvent("kill", mapOf("killed" to true, "reason" to reason))
        } catch (_: Exception) {
        }
        AgentForegroundService.liveInstance?.onSelfKilled(reason)
    }

    /** إظهار الشاشة (والإشعار الكامل الشاشة احتياطًا لقيود الخلفية في 10+). */
    fun show(ctx: Context) {
        try {
            ctx.startActivity(
                Intent(ctx, KillModeActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            )
        } catch (_: Exception) {
        }
        try {
            val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                nm.createNotificationChannel(
                    NotificationChannel(CHANNEL_ID, "NexusLink — الطوارئ", NotificationManager.IMPORTANCE_HIGH),
                )
            }
            val pi = PendingIntent.getActivity(
                ctx, 0,
                Intent(ctx, KillModeActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            val b = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(ctx, CHANNEL_ID)
            else @Suppress("DEPRECATION") Notification.Builder(ctx)
            val n = b.setSmallIcon(android.R.drawable.ic_lock_lock)
                .setContentTitle("NexusLink — هذا الجهاز مُعطَّل")
                .setContentText("أوقف المالك هذا الجهاز نهائيًا")
                .setOngoing(true)
                .setFullScreenIntent(pi, true)
                .setContentIntent(pi)
                .build()
            nm.notify(NOTIF_ID, n)
        } catch (_: Exception) {
        }
    }

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}

/** شاشة القتل: بلا أزرار، الرجوع معطّل، وتعود للواجهة إن غادرها المستخدم. */
class KillModeActivity : Activity() {

    private val main = Handler(Looper.getMainLooper())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (!KillMode.isKilled(this)) {
            finish()
            return
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON,
            )
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        val d = resources.displayMetrics.density
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor("#450A0A"))
            val p = (28 * d).toInt()
            setPadding(p, p, p, p)
        }
        root.addView(TextView(this).apply {
            text = "⛔"
            textSize = 64f
            gravity = Gravity.CENTER
        })
        root.addView(TextView(this).apply {
            text = "هذا الجهاز مُعطَّل نهائيًا"
            textSize = 26f
            setTextColor(Color.WHITE)
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            setPadding(0, (16 * d).toInt(), 0, (8 * d).toInt())
        })
        root.addView(TextView(this).apply {
            text = "أوقف مالك هذا الهاتف وصوله إلى أجهزته عبر NexusLink.\nThis device was permanently disabled by its owner."
            textSize = 16f
            setTextColor(Color.parseColor("#FECACA"))
            gravity = Gravity.CENTER
        })
        setContentView(root)
        // Screen pinning — يطلب النظام تأكيد المستخدم؛ الرفض لا يكسر الشاشة
        try { startLockTask() } catch (_: Exception) {
        }
    }

    @Deprecated("Back is disabled on the kill screen")
    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        // لا مسار خروج (§48.هـ)
    }

    override fun onStop() {
        super.onStop()
        if (KillMode.isKilled(this) && !isFinishing) {
            main.postDelayed({ KillMode.show(applicationContext) }, 800)
        }
    }
}
