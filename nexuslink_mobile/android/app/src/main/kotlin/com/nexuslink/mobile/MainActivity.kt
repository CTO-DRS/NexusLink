package com.nexuslink.mobile

import android.Manifest
import android.app.NotificationManager
import android.content.ComponentName
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.BatteryManager
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.provider.Settings
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodChannel
import java.io.File

/**
 * MainActivity — بوابتا Flutter ⇄ Native:
 *  1) MethodChannel "nexuslink/agent":
 *     الاتصال: startAgent / stopAgent / lastState / deviceInfo
 *     النقل:   publishDownload (نشر في Download/NexusLink + إشعار نظام)
 *     المشاركة: drainShare (قائمة المشاركة "إرسال عبر NexusLink")
 *     الصور:   queryNewPhotos (مسح DCIM/Pictures الجديدة)
 *     فتح:     openPath / openUrl · إشعارات: cancelNotif · حالة الواجهة: setUiAlive
 *  2) EventChannel "nexuslink/agent/events": حالة القناة + أحداث النقل/النصوص/الصور/المشاركة.
 *
 * يستقبل أيضًا intents المشاركة (ACTION_SEND / SEND_MULTIPLE) وعروض النقل من الإشعارات.
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
                        put("kind", "state")
                        put("state", state)
                        put("serverKey", serverKey ?: "")
                        put("detail", detail)
                    }
                    sink.success(payload)
                } catch (_: Exception) {
                }
            }
        }

        /** دفع حدث بيانات (نقل/نصوص/صور/مشاركة) إلى Dart. */
        fun pushDataEvent(kind: String, data: Map<String, Any?>) {
            val sink = eventSink ?: return
            mainHandler.post {
                try {
                    val payload = HashMap<String, Any?>().apply {
                        put("kind", kind)
                        put("detail", HashMap(data))
                    }
                    sink.success(payload)
                } catch (_: Exception) {
                }
            }
        }

        /** عناصر مشاركة معلّقة (من قائمة المشاركة) — يسحبها Dart عبر drainShare. */
        val pendingShares = ArrayDeque<HashMap<String, Any?>>()

        fun stashShare(item: HashMap<String, Any?>) {
            synchronized(pendingShares) {
                pendingShares.addLast(item)
                while (pendingShares.size > 10) pendingShares.removeFirst()
            }
        }

        @Volatile
        var eventSink: EventChannel.EventSink? = null
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        // جدولة مراقب الصور الدوري (WorkManager — البند 6)
        PhotoSyncWorker.schedule(this)

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

                "deviceInfo" -> result.success(readDeviceInfo())

                // ---------- نقل الملفات ----------

                "publishDownload" -> {
                    val tempPath = call.argument<String>("tempPath") ?: ""
                    val displayName = call.argument<String>("displayName") ?: "file"
                    val mime = call.argument<String>("mime") ?: "application/octet-stream"
                    Thread {
                        val path = publishDownload(tempPath, displayName, mime)
                        runOnUiThread {
                            if (path != null) {
                                result.success(mapOf("ok" to true, "path" to path))
                                notifyDownloadDone(displayName, path)
                            } else {
                                result.success(mapOf("ok" to false))
                            }
                        }
                    }.start()
                }

                // ---------- المشاركة (Share Sheet) ----------

                "drainShare" -> {
                    val items = ArrayList<HashMap<String, Any?>>()
                    synchronized(pendingShares) {
                        while (pendingShares.isNotEmpty()) items.add(pendingShares.removeFirst())
                    }
                    // ادمج كل العناصر في قباولة واحدة (نص + ملفات)
                    var text: String? = null
                    val files = ArrayList<HashMap<String, Any?>>()
                    for (it in items) {
                        (it["text"] as? String)?.let { t -> text = ((text ?: "") + t).takeIf { tt -> tt.isNotEmpty() } }
                        (it["files"] as? List<*>)?.forEach { f -> (f as? HashMap<String, Any?>)?.let { files.add(it) } }
                    }
                    result.success(mapOf("text" to text, "files" to files))
                }

                // ---------- الصور التلقائية ----------

                "queryNewPhotos" -> {
                    val since = (call.argument<Number>("since") ?: 0).toLong()
                    val limit = (call.argument<Number>("limit") ?: 200).toInt()
                    Thread {
                        val photos = queryNewPhotos(since, limit)
                        runOnUiThread { result.success(mapOf("photos" to photos)) }
                    }.start()
                }

                // ---------- فتح وأدوات ----------

                "openPath" -> {
                    try {
                        val path = call.argument<String>("path") ?: ""
                        val file = File(path)
                        val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", file)
                        val view = Intent(Intent.ACTION_VIEW).apply {
                            setDataAndType(uri, guessMime(file.name))
                            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                        }
                        startActivity(view)
                        result.success(true)
                    } catch (e: Exception) {
                        result.error("open_failed", e.message, null)
                    }
                }

                "openUrl" -> {
                    try {
                        val url = call.argument<String>("url") ?: ""
                        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                        result.success(true)
                    } catch (e: Exception) {
                        result.error("open_failed", e.message, null)
                    }
                }

                "cancelNotif" -> {
                    val id = (call.argument<Number>("id") ?: 0).toInt()
                    (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).cancel(id)
                    result.success(true)
                }

                "setUiAlive" -> {
                    AgentForegroundService.uiAlive = call.argument<Boolean>("alive") ?: false
                    result.success(true)
                }

                // ---------- FA-7: التحكم عن بعد (الإتاحة + الجلسة) ----------

                "accessibilityStatus" -> {
                    val enabled = try {
                        val setting = Settings.Secure.getString(
                            contentResolver,
                            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
                        ) ?: ""
                        val flat = "$packageName/com.nexuslink.mobile.NexusAccessibilityService"
                        val flatCompat = ComponentName(packageName, NexusAccessibilityService::class.java.name).flattenToString()
                        setting.split(':').any { it.equals(flat, true) || it.equals(flatCompat, true) } || NexusAccessibilityService.isReady
                    } catch (_: Exception) {
                        NexusAccessibilityService.isReady
                    }
                    result.success(mapOf("enabled" to enabled, "ready" to NexusAccessibilityService.isReady))
                }

                "openAccessibilitySettings" -> {
                    try {
                        startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
                        result.success(true)
                    } catch (e: Exception) {
                        result.error("open_failed", e.message, null)
                    }
                }

                "ctlSnapshot" -> result.success(AgentForegroundService.ctlSnapshot())

                "ctlDecision" -> {
                    val allow = call.argument<Boolean>("allow") ?: false
                    AgentForegroundService.liveInstance?.decideControl(allow)
                        ?: run { // لا خدمة حية — نظّف الحالة المعلقة
                            AgentForegroundService.ctlPendingFrom = null
                            AgentForegroundService.ctlPendingName = null
                        }
                    result.success(true)
                }

                "ctlStop" -> {
                    AgentForegroundService.liveInstance?.phoneStopControl()
                    result.success(true)
                }

                "setCtlConfirm" -> {
                    val enabled = call.argument<Boolean>("enabled") ?: true
                    AgentForegroundService.liveInstance?.setCtlConfirm(enabled)
                        ?: run {
                            // الخدمة غير حية — احفظ الإعداد ليقرأه onCreate
                            try {
                                getSharedPreferences("nexus_ctl", Context.MODE_PRIVATE)
                                    .edit().putBoolean("require_confirm", enabled).apply()
                            } catch (_: Exception) {
                            }
                        }
                    result.success(true)
                }

                else -> result.notImplemented()
            }
        }

        EventChannel(flutterEngine.dartExecutor.binaryMessenger, EVENT_CH).setStreamHandler(
            object : EventChannel.StreamHandler {
                override fun onListen(args: Any?, events: EventChannel.EventSink?) {
                    eventSink = events
                    // مزامنة فورية: الحالة الحالية + عروض النقل المخزنة أثناء غياب الواجهة
                    MainActivity.pushEvent(AgentForegroundService.currentState, AgentForegroundService.currentServerKey, null)
                    Thread {
                        for (offer in AgentForegroundService.drainOffers()) {
                            try {
                                val map = HashMap<String, Any?>()
                                for (k in offer.keys()) map[k] = if (offer.isNull(k)) null else offer.opt(k)
                                pushDataEvent("tx", map)
                            } catch (_: Exception) {
                            }
                        }
                    }.start()
                }

                override fun onCancel(args: Any?) {
                    eventSink = null
                }
            },
        )
    }

    // ------------------------------------------------------------------
    // دورة الحياة: المشاركة وعروض الإشعارات
    // ------------------------------------------------------------------

    override fun onCreate(savedInstanceState: android.os.Bundle?) {
        super.onCreate(savedInstanceState)
        handleIncoming(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIncoming(intent)
    }

    private fun handleIncoming(intent: Intent?) {
        if (intent == null) return
        when {
            // من إشعار "قبول" → أخبر الواجهة لتبدأ التنزيل
            intent.hasExtra("nexus.offerId") -> {
                val offerId = intent.getStringExtra("nexus.offerId")
                if (offerId != null) {
                    pushDataEvent("txaction", mapOf("id" to offerId, "action" to "accept"))
                }
            }
            // قائمة المشاركة: نص أو ملف(ات) من أي تطبيق (البند 4)
            intent.action == Intent.ACTION_SEND || intent.action == Intent.ACTION_SEND_MULTIPLE -> {
                Thread { stashFromShareIntent(intent); pushDataEvent("share", emptyMap()) }.start()
            }
        }
    }

    private fun stashFromShareIntent(intent: Intent) {
        val item = HashMap<String, Any?>()
        val files = ArrayList<HashMap<String, Any?>>()
        when (intent.action) {
            Intent.ACTION_SEND -> {
                (intent.getStringExtra(Intent.EXTRA_TEXT))?.let { item["text"] = it }
                @Suppress("DEPRECATION")
                val uri = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
                } else {
                    intent.getParcelableExtra(Intent.EXTRA_STREAM)
                }
                if (uri != null) copyUriToCache(uri)?.let { files.add(it) }
            }
            Intent.ACTION_SEND_MULTIPLE -> {
                @Suppress("DEPRECATION")
                @Suppress("UNCHECKED_CAST")
                val uris = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
                } else {
                    intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)
                }
                uris?.forEach { u -> copyUriToCache(u)?.let { files.add(it) } }
            }
        }
        if (item["text"] != null || files.isNotEmpty()) {
            item["files"] = files
            stashShare(item)
        }
    }

    private fun copyUriToCache(uri: Uri): HashMap<String, Any?>? {
        return try {
            val nameCol = arrayOf(MediaStore.MediaColumns.DISPLAY_NAME, MediaStore.MediaColumns.SIZE, MediaStore.MediaColumns.MIME_TYPE)
            var name = "file_${System.currentTimeMillis()}"
            var size = 0L
            var mime = "application/octet-stream"
            contentResolver.query(uri, nameCol, null, null, null)?.use { c ->
                if (c.moveToFirst()) {
                    c.getString(0)?.let { name = it }
                    size = c.getLong(1)
                    c.getString(2)?.let { mime = it }
                }
            }
            val dir = File(cacheDir, "nexus-share").apply { mkdirs() }
            val dst = File(dir, "${System.currentTimeMillis()}_$name")
            contentResolver.openInputStream(uri)?.use { input ->
                dst.outputStream().use { output -> input.copyTo(output) }
            } ?: return null
            if (size <= 0L) size = dst.length()
            hashMapOf(
                "path" to dst.absolutePath,
                "name" to name,
                "size" to size,
                "mime" to mime,
            )
        } catch (_: Exception) {
            null
        }
    }

    // ------------------------------------------------------------------
    // نشر ملف منزّل في Download/NexusLink + إشعار اكتمال (البند 2)
    // ------------------------------------------------------------------

    private fun publishDownload(tempPath: String, displayName: String, mime: String): String? {
        val temp = File(tempPath)
        if (!temp.exists() || temp.length() == 0L) return null
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val resolver = contentResolver
                val values = ContentValues().apply {
                    put(MediaStore.Downloads.DISPLAY_NAME, displayName)
                    put(MediaStore.Downloads.MIME_TYPE, mime)
                    put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/NexusLink")
                    put(MediaStore.Downloads.IS_PENDING, 1)
                }
                val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: return null
                resolver.openOutputStream(uri)?.use { out ->
                    temp.inputStream().use { it.copyTo(out) }
                } ?: return null
                values.clear()
                values.put(MediaStore.Downloads.IS_PENDING, 0)
                resolver.update(uri, values, null, null)
                "${Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)}/NexusLink/$displayName"
            } else {
                val dir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "NexusLink")
                dir.mkdirs()
                var dst = File(dir, displayName)
                var i = 1
                while (dst.exists()) {
                    val dot = displayName.lastIndexOf('.')
                    val stem = if (dot > 0) displayName.substring(0, dot) else displayName
                    val ext = if (dot > 0) displayName.substring(dot) else ""
                    dst = File(dir, "$stem ($i)$ext")
                    i++
                }
                temp.copyTo(dst)
                dst.absolutePath
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun notifyDownloadDone(name: String, path: String) {
        try {
            val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
            val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                android.app.Notification.Builder(this, AgentForegroundService.TX_CHANNEL_ID)
            } else {
                @Suppress("DEPRECATION")
                android.app.Notification.Builder(this)
            }
            builder.setContentTitle("اكتمل استلام الملف")
                .setContentText("$name — حُفظ في Download/NexusLink")
                .setSmallIcon(android.R.drawable.stat_sys_download_done)
                .setAutoCancel(true)
            val id = ("done" + path).hashCode() and 0x7fffffff
            nm.notify(id, builder.build())
        } catch (_: Exception) {
        }
    }

    // ------------------------------------------------------------------
    // مسح الصور الجديدة في DCIM/Pictures (البند 6)
    // ------------------------------------------------------------------

    private fun hasPhotosPermission(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(this, Manifest.permission.READ_MEDIA_IMAGES) == PackageManager.PERMISSION_GRANTED
        } else {
            ContextCompat.checkSelfPermission(this, Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED
        }
    }

    private fun queryNewPhotos(since: Long, limit: Int): List<HashMap<String, Any?>> {
        if (!hasPhotosPermission()) return emptyList()
        val out = ArrayList<HashMap<String, Any?>>()
        try {
            val collection = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL)
            } else {
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI
            }
            val proj = arrayOf(
                MediaStore.Images.Media._ID,
                MediaStore.Images.Media.DISPLAY_NAME,
                MediaStore.Images.Media.SIZE,
                MediaStore.Images.Media.DATE_ADDED,
                MediaStore.Images.Media.MIME_TYPE,
                MediaStore.Images.Media.DATA,
            )
            contentResolver.query(collection, proj, null, null, "${MediaStore.Images.Media.DATE_ADDED} ASC")?.use { c ->
                while (c.moveToNext() && out.size < limit) {
                    val dateAdded = c.getLong(3)
                    val dataPath = c.getString(5) ?: ""
                    // DCIM أو Pictures فقط (المراقبة المطلوبة) — ودعم <Q عبر المسار
                    val inScope = dataPath.contains("/DCIM/") || dataPath.contains("/Pictures/") ||
                        dataPath.contains("\\DCIM\\") || dataPath.contains("\\Pictures\\")
                    if (!inScope) continue
                    if (dateAdded <= since) continue
                    try {
                        val uri = Uri.withAppendedPath(collection, c.getString(0))
                        val dir = File(cacheDir, "nexus-photos").apply { mkdirs() }
                        val dst = File(dir, "${dateAdded}_${c.getString(1) ?: "photo.jpg"}")
                        if (!dst.exists() || dst.length() == 0L) {
                            contentResolver.openInputStream(uri)?.use { input ->
                                dst.outputStream().use { input.copyTo(it) }
                            } ?: continue
                        }
                        out.add(
                            hashMapOf(
                                "path" to dst.absolutePath,
                                "name" to (c.getString(1) ?: "photo.jpg"),
                                "size" to (if (c.getLong(2) > 0) c.getLong(2) else dst.length()),
                                "dateAdded" to dateAdded,
                                "mime" to (c.getString(4) ?: "image/jpeg"),
                            ),
                        )
                    } catch (_: Exception) {
                    }
                }
            }
        } catch (_: Exception) {
        }
        return out
    }

    // ------------------------------------------------------------------
    // أدوات
    // ------------------------------------------------------------------

    private fun readDeviceInfo(): Map<String, Any?> {
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
        return mapOf(
            "androidId" to (
                Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID) ?: ""
                ),
            "model" to Build.MODEL,
            "manufacturer" to Build.MANUFACTURER,
            "deviceName" to deviceName,
            "os" to "Android ${Build.VERSION.RELEASE} (SDK ${Build.VERSION.SDK_INT})",
            "battery" to battery,
        )
    }

    private fun guessMime(name: String): String {
        val ext = name.substringAfterLast('.', "").lowercase()
        return mapOf(
            "jpg" to "image/jpeg", "jpeg" to "image/jpeg", "png" to "image/png", "gif" to "image/gif", "webp" to "image/webp",
            "mp4" to "video/mp4", "mkv" to "video/x-matroska", "webm" to "video/webm", "mov" to "video/quicktime",
            "mp3" to "audio/mpeg", "wav" to "audio/wav", "m4a" to "audio/mp4", "flac" to "audio/flac", "ogg" to "audio/ogg",
            "pdf" to "application/pdf", "apk" to "application/vnd.android.package-archive", "zip" to "application/zip",
            "txt" to "text/plain", "md" to "text/plain", "csv" to "text/plain", "json" to "text/plain",
        )[ext] ?: "application/octet-stream"
    }
}
