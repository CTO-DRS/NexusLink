package com.nexuslink.mobile

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews

/**
 * NexusWidgets — الودجات المنزلية (FA-9 — البند 7):
 *
 *  · [ConnectionWidgetProvider] ودجت حالة الاتصال: نقطة ملونة + نص الحالة
 *    (يُحدَّث من خدمة الوكيل الدائمة عند كل تغيير حالة عبر [updateConnectionWidget]).
 *  · [SendWidgetProvider] ودجت الإرسال السريع: زر واحد يفتح التطبيق مع
 *    nexus_open=quicksend → الدارت ترسل حافظة الهاتف إلى الكمبيوتر فورًا.
 *
 *  بلا سوكت مستقل — الودجت تقرأ SharedPrefs وتطلق النشاط فقط.
 */
object NexusWidgets {

    private const val PREFS = "nexus_widgets"
    const val OPEN_QUICKSEND = "nexus_open"
    const val OPEN_QUICKSEND_VAL = "quicksend"

    /** يحدّث ودجت حالة الاتصال بناءً على حالة خدمة الوكيل. */
    fun updateConnectionWidget(ctx: Context, state: String) {
        val connected = state.contains("متصل") || state.equals("online", ignoreCase = true) ||
            state.contains("connected", ignoreCase = true)
        try {
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putBoolean("connected", connected)
                .putString("state", state)
                .putLong("at", System.currentTimeMillis())
                .apply()
        } catch (_: Exception) {
        }

        val mgr = AppWidgetManager.getInstance(ctx) ?: return
        val ids = mgr.getAppWidgetIds(ComponentName(ctx, ConnectionWidgetProvider::class.java))
        if (ids.isEmpty()) return
        pushConnection(ctx, mgr, ids, connected, state)
    }

    /** يبث الحالة الحالية لكل ودجات الاتصال (استدعاء عند إقلاع/تحديث النظام). */
    fun refreshAll(ctx: Context) {
        val mgr = AppWidgetManager.getInstance(ctx) ?: return
        val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val ids = mgr.getAppWidgetIds(ComponentName(ctx, ConnectionWidgetProvider::class.java))
        if (ids.isNotEmpty()) {
            pushConnection(ctx, mgr, ids, p.getBoolean("connected", false), p.getString("state", "—") ?: "—")
        }
        val sendIds = mgr.getAppWidgetIds(ComponentName(ctx, SendWidgetProvider::class.java))
        if (sendIds.isNotEmpty()) {
            pushSend(ctx, mgr, sendIds)
        }
    }

    private fun pushConnection(ctx: Context, mgr: AppWidgetManager, ids: IntArray, connected: Boolean, state: String) {
        val views = RemoteViews(ctx.packageName, R.layout.widget_connection)
        views.setTextViewText(R.id.wcState, if (connected) "NexusLink — $state" else "NexusLink — $state")
        views.setInt(R.id.wcDot, "setBackgroundResource", if (connected) R.drawable.wc_dot_on else R.drawable.wc_dot_off)
        views.setOnClickPendingIntent(R.id.wcRoot, openApp(ctx))
        mgr.updateAppWidget(ids, views)
    }

    private fun pushSend(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
        val views = RemoteViews(ctx.packageName, R.layout.widget_send)
        views.setOnClickPendingIntent(R.id.wsRoot, quickSend(ctx))
        mgr.updateAppWidget(ids, views)
    }

    private fun openApp(ctx: Context): PendingIntent {
        val i = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)
            ?: Intent(ctx, MainActivity::class.java)
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        return PendingIntent.getActivity(ctx, 11, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    private fun quickSend(ctx: Context): PendingIntent {
        val i = Intent(ctx, MainActivity::class.java)
        i.action = Intent.ACTION_MAIN
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        i.putExtra(OPEN_QUICKSEND, OPEN_QUICKSEND_VAL)
        return PendingIntent.getActivity(ctx, 12, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }
}

/** ودجت حالة الاتصال. */
class ConnectionWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, mgr: AppWidgetManager, ids: IntArray) {
        NexusWidgets.refreshAll(context)
    }

    override fun onEnabled(context: Context) = NexusWidgets.refreshAll(context)
}

/** ودجت الإرسال السريع (حافظة الهاتف → الكمبيوتر). */
class SendWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, mgr: AppWidgetManager, ids: IntArray) {
        NexusWidgets.refreshAll(context)
    }
}
