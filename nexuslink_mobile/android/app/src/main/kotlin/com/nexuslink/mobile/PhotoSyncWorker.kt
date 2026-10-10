package com.nexuslink.mobile

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.concurrent.TimeUnit

/**
 * PhotoSyncWorker — مراقبة دورية لمجلدات الكاميرا عبر WorkManager (البند 6).
 *
 * كل 15 دقيقة يمسح DCIM/Pictures عن صور أحدث من علامة آخر مسح
 * (نفس مفتاح SharedPreferences الذي تستخدمه الواجهة) ويُبلّغ الواجهة
 * إن كانت حية — الرفع نفسه يقوم به محرك النقل في Dart عند الاتصال،
 * والعلامة تتقدم فقط بعد صف الصور في طابور الرفع (لا صور تُفقد أبدًا).
 */
class PhotoSyncWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        try {
            val prefs = applicationContext.getSharedPreferences("FlutterSharedPreferences", Context.MODE_PRIVATE)
            // مفتاح shared_preferences من Dart يضاف له بادئة "flutter."
            val since = prefs.getLong("flutter.nexus.tx.photoSyncMarker", 0L)
            val enabled = prefs.getBoolean("flutter.nexus.tx.photoSync", false)
            if (!enabled) return@withContext Result.success()

            val count = countNewPhotos(since)
            if (count > 0) {
                // الواجهة حية؟ → اطلب منها المسح والرفع فورًا
                if (AgentForegroundService.uiAlive || MainActivity.eventSink != null) {
                    MainActivity.pushDataEvent("photos", mapOf("count" to count))
                }
            }
            Result.success()
        } catch (_: Exception) {
            Result.success() // الفحص دوري — لا تُعِد المحاولة بعنف
        }
    }

    private fun countNewPhotos(since: Long): Int {
        if (!hasPhotosPermission()) return 0
        var count = 0
        try {
            val collection = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                android.provider.MediaStore.Images.Media.getContentUri(android.provider.MediaStore.VOLUME_EXTERNAL)
            } else {
                android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI
            }
            val proj = arrayOf(
                android.provider.MediaStore.Images.Media.DATE_ADDED,
                android.provider.MediaStore.Images.Media.DATA,
            )
            applicationContext.contentResolver.query(collection, proj, null, null, null)?.use { c ->
                while (c.moveToNext()) {
                    val dataPath = c.getString(1) ?: ""
                    val inScope = dataPath.contains("/DCIM/") || dataPath.contains("/Pictures/") ||
                        dataPath.contains("\\DCIM\\") || dataPath.contains("\\Pictures\\")
                    if (!inScope) continue
                    if (c.getLong(0) > since) count++
                }
            }
        } catch (_: Exception) {
        }
        return count
    }

    private fun hasPhotosPermission(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(applicationContext, Manifest.permission.READ_MEDIA_IMAGES) == PackageManager.PERMISSION_GRANTED
        } else {
            ContextCompat.checkSelfPermission(applicationContext, Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED
        }
    }

    companion object {
        private const val WORK_NAME = "nexus_photo_sync"

        /** جدولة دورية كل 15 دقيقة (الحد الأدنى المسموح لـ WorkManager) — idempotent. */
        fun schedule(context: Context) {
            try {
                val request = PeriodicWorkRequestBuilder<PhotoSyncWorker>(15, TimeUnit.MINUTES)
                    .build()
                WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                    WORK_NAME,
                    ExistingPeriodicWorkPolicy.KEEP,
                    request,
                )
            } catch (_: Exception) {
            }
        }
    }
}
