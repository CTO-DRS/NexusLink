import 'dart:async';
import 'dart:io';
import 'dart:math';

import 'package:flutter/foundation.dart';

import '../core/protocol.dart';
import 'package:drift/drift.dart' show Value;

import '../data/database/nexus_db.dart' as db;
import '../data/transfer_api.dart';
import '../data/native_bridge.dart';

/// إشارات النقل عبر قناة 3006 الدائمة (تنفّذها طبقة الإشارة — تُحقن هنا).
abstract class TxSignaling {
  void send(String event, Map<String, dynamic> data);
}

enum TxKind { upload, download }

enum TxState { queued, active, paused, done, failed, cancelled }

bool _isTerminalState(TxState s) =>
    s == TxState.done || s == TxState.failed || s == TxState.cancelled;

extension TxStateX on TxState {
  String get wire => switch (this) {
        TxState.queued => 'queued',
        TxState.active => 'active',
        TxState.paused => 'paused',
        TxState.done => 'done',
        TxState.failed => 'failed',
        TxState.cancelled => 'cancelled',
      };

  static TxState from(String s) => switch (s) {
        'queued' => TxState.queued,
        'active' => TxState.active,
        'paused' => TxState.paused,
        'done' => TxState.done,
        'failed' => TxState.failed,
        'cancelled' => TxState.cancelled,
        _ => TxState.failed,
      };
}

/// مهمة نقل واحدة (رفع أو تنزيل) — قابلة للاستئناف بعد قتل التطبيق.
class TransferTask {
  final String id; // معرّف مستقر محليًا (= taskId لدى السيرفر للرفع)
  final TxKind kind;
  final String serverKey;
  final String fileName;
  final String? mime;
  final int totalBytes;

  // رفع
  final String? localPath; // الملف المصدر على الهاتف
  final String destDir; // '/Downloads' داخل مرآتنا على السيرفر

  // تنزيل
  final String? offerId; // معرّف مهمة السيرفر tx_…
  final String? fromName;
  final String? srcDeviceId; // الجهاز الافتراضي المصدر
  final String? srcVPath; // مسار المصدر الافتراضي
  final String? tempPath; // الجزئي المحلي .nexuspart

  // حالة حية
  TxState state;
  int transferred;
  double speedBps;
  String? error;
  bool autoAccepted;
  DateTime startedAt;
  DateTime updatedAt;
  DateTime? completedAt;
  String? finalPath;

  TransferTask({
    required this.id,
    required this.kind,
    required this.serverKey,
    required this.fileName,
    required this.totalBytes,
    this.mime,
    this.localPath,
    this.destDir = TxProtocol.uploadDir,
    this.offerId,
    this.fromName,
    this.srcDeviceId,
    this.srcVPath,
    this.tempPath,
    this.state = TxState.queued,
    this.transferred = 0,
    this.speedBps = 0,
    this.error,
    this.autoAccepted = false,
    DateTime? startedAt,
    DateTime? updatedAt,
    this.completedAt,
    this.finalPath,
  })  : startedAt = startedAt ?? DateTime.now(),
        updatedAt = updatedAt ?? DateTime.now();

  bool get isTerminal => _isTerminalState(state);
  bool get isUpload => kind == TxKind.upload;
  double get progress => totalBytes <= 0 ? (state == TxState.done ? 1 : 0) : (transferred / totalBytes).clamp(0, 1);

  /// عنوان المهمة في السجل (سطر وصفي).
  String get peerLabel => isUpload ? 'السيرفر' : (fromName ?? 'الكمبيوتر');

  db.TransferHistoryCompanion toCompanion() => db.TransferHistoryCompanion.insert(
        id: id,
        serverKey: serverKey,
        kind: isUpload ? 'upload' : 'download',
        fileName: fileName,
        sizeBytes: BigInt.from(totalBytes),
        state: state.wire,
        transferredBytes: Value(BigInt.from(transferred)),
        mime: Value(mime),
        localPath: Value(localPath),
        tempPath: Value(tempPath),
        finalPath: Value(finalPath),
        remoteVPath: Value(isUpload ? destDir : srcVPath),
        srcDeviceId: Value(srcDeviceId),
        offerId: Value(offerId),
        fromName: Value(fromName),
        autoAccepted: Value(autoAccepted),
        error: Value(error),
        startedAt: startedAt,
        updatedAt: updatedAt,
        completedAt: Value(completedAt),
      );

  static TransferTask fromHistory(db.TransferRecord r) => TransferTask(
        id: r.id,
        kind: r.kind == 'upload' ? TxKind.upload : TxKind.download,
        serverKey: r.serverKey,
        fileName: r.fileName,
        mime: r.mime,
        totalBytes: r.sizeBytes.toInt(),
        localPath: r.localPath,
        destDir: r.remoteVPath ?? TxProtocol.uploadDir,
        offerId: r.offerId,
        fromName: r.fromName,
        srcDeviceId: r.srcDeviceId,
        srcVPath: r.remoteVPath,
        tempPath: r.tempPath,
        state: TxStateX.from(r.state),
        transferred: r.transferredBytes.toInt(),
        autoAccepted: r.autoAccepted,
        error: r.error,
        startedAt: r.startedAt,
        updatedAt: r.updatedAt,
        completedAt: r.completedAt,
        finalPath: r.finalPath,
      );
}

/// محرك نقل الملفات للوكيل — طابور، تقدم، سرعة، إيقاف/استئناف/إلغاء،
/// واستئناف تلقائي بعد قتل التطبيق (offsets تُشتق من الملفات نفسها).
class TransferEngine extends ChangeNotifier {
  TransferEngine({
    required NexusTransferApi api,
    required db.NexusDatabase database,
    required this.serverKey,
    required String deviceId,
    required String tempDirPath,
    NativeBridge? native,
    TxSignaling? signaling,
    void Function(String text, {String kind})? onLog,
    Future<void> Function(String? localPath)? cleanupSource,
  })  : _api = api,
        _db = database,
        _deviceId = deviceId,
        _tempDirPath = tempDirPath,
        _native = native,
        _signaling = signaling,
        _onLog = onLog,
        _cleanupSource = cleanupSource;

  final NexusTransferApi _api;
  final db.NexusDatabase _db;
  final String serverKey;
  final String _deviceId;
  final String _tempDirPath;
  final NativeBridge? _native;
  TxSignaling? _signaling;
  final void Function(String text, {String kind})? _onLog;
  final Future<void> Function(String? localPath)? _cleanupSource;

  final Map<String, TransferTask> _tasks = {};
  final Map<String, List<_SpeedSample>> _samples = {};
  bool _restored = false;
  bool _pumpScheduled = false;
  Timer? _speedTimer;

  static const int maxConcurrent = 2;

  /// مجلد الجزئيات المحلي — يعيش خارج القرص العابر فيبقى بعد قتل العملية.
  Directory get tempDir => Directory(_tempDirPath);

  List<TransferTask> get tasks {
    final list = _tasks.values.toList()
      ..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
    return List.unmodifiable(list);
  }

  TransferTask? byId(String id) => _tasks[id];

  void attachSignaling(TxSignaling s) => _signaling = s;

  // ------------------------------------------------------------------
  // الاستعادة بعد قتل التطبيق
  // ------------------------------------------------------------------

  /// يقرأ المهام غير المنتهية من SQLite ويبني الطابور من جديد.
  /// الاستئناف الفعلي يحدث عند [resumePending] (بعد التأكد من الاتصال).
  Future<void> restore() async {
    if (_restored) return;
    _restored = true;
    try {
      final rows = await _db.unfinished(serverKey);
      for (final r in rows) {
        final t = TransferTask.fromHistory(r);
        // حالة الذاكرة تبدأ queued حتى يتأكد الاستئناف من الاتصال
        if (!t.isTerminal) t.state = TxState.queued;
        _tasks[t.id] = t;
      }
      _onLog?.call('استُعيد ${rows.length} مهمة نقل من السجل المحلي', kind: 'info');
      notifyListeners();
    } catch (e) {
      _onLog?.call('تعذّرت استعادة مهام النقل: $e', kind: 'warn');
    }
  }

  /// بعد الاتصال: استئناف كل المهام queued/active/paused التي كانت تعمل.
  Future<void> resumePending() async {
    await restore();
    for (final t in _tasks.values.toList()) {
      if (t.isTerminal || t.state == TxState.paused) continue;
      try {
        if (t.isUpload) {
          await _resumeUpload(t);
        } else {
          await _resumeDownload(t);
        }
      } catch (e) {
        _fail(t, 'تعذّر الاستئناف: $e');
      }
    }
    _pump();
    notifyListeners();
  }

  Future<void> _resumeUpload(TransferTask t) async {
    final src = File(t.localPath ?? '');
    if (!await src.exists()) {
      _fail(t, 'الملف المصدر اختفى من الهاتف');
      return;
    }
    // init idempotent بنفس taskId → السيرفر يعيد الجزئي أو ينشئه
    final init = await _api.uploadInit(
      deviceId: _deviceId,
      name: t.fileName,
      size: t.totalBytes,
      mime: t.mime,
      localPath: t.localPath,
      dir: t.destDir,
      taskId: t.id,
    );
    final serverReceived = init.received;
    final localSize = await src.length();
    if (t.transferred != serverReceived) {
      t.transferred = serverReceived;
    }
    if (serverReceived >= localSize && localSize > 0) {
      // الجزئي مكتمل لدى السيرفر — أكمل مباشرة
      await _completeUpload(t);
      return;
    }
    t.state = TxState.active;
    await _persist(t);
    _onLog?.call('استئناف رفع ${t.fileName} من ${(serverReceived / 1048576).toStringAsFixed(1)}MB', kind: 'ok');
    _pump();
  }

  Future<void> _resumeDownload(TransferTask t) async {
    final offer = t.offerId;
    if (offer == null) {
      _fail(t, 'مهمة بلا معرّف سيرفر');
      return;
    }
    // هل المهمة ما تزال حية على السيرفر؟
    try {
      final jobs = await _api.serverJobs();
      final job = jobs.where((j) => j.id == offer).toList();
      if (job.isEmpty) {
        _fail(t, 'فقد السيرفر المهمة (أُعيد تشغيله أو أُلغيت من الكمبيوتر)');
        return;
      }
    } catch (_) {
      /* السيرفر غير متصل الآن — أعد المحاولة في الدورة القادمة */
      return;
    }
    final temp = File(t.tempPath ?? '');
    if (await temp.exists()) {
      t.transferred = await temp.length();
    }
    if (t.transferred >= t.totalBytes && t.totalBytes > 0) {
      await _completeDownload(t);
      return;
    }
    // أعد الإعلان عن القبول (المهمة queued على السيرفر بعد إعادة تشغيله)
    _signaling?.send('tx:accept', {'id': offer});
    t.state = TxState.active;
    await _persist(t);
    _onLog?.call('استئناف تنزيل ${t.fileName} من ${(t.transferred / 1048576).toStringAsFixed(1)}MB', kind: 'ok');
    _pump();
  }

  // ------------------------------------------------------------------
  // إنشاء المهام
  // ------------------------------------------------------------------

  static String _newId() {
    final rnd = Random();
    return 't_${DateTime.now().millisecondsSinceEpoch.toRadixString(36)}_${rnd.nextInt(0x100000).toRadixString(36).padLeft(4, '0')}';
  }

  Future<TransferTask> enqueueUpload({
    required String localPath,
    required String fileName,
    required int size,
    String? mime,
    String dir = TxProtocol.uploadDir,
  }) async {
    final t = TransferTask(
      id: _newId(),
      kind: TxKind.upload,
      serverKey: serverKey,
      fileName: fileName,
      mime: mime,
      totalBytes: size,
      localPath: localPath,
      destDir: dir,
    );
    _tasks[t.id] = t;
    await _persist(t);
    _onLog?.call('أُضيف للطابور (رفع): $fileName', kind: 'info');
    _pump();
    notifyListeners();
    return t;
  }

  /// عرض ملف قادم من الكمبيوتر (tx:offer) — يُسجّل في الطابور انتظار القرار
  /// أو يبدأ فورًا إذا كان القبول تلقائيًا من سيرفر موثوق.
  Future<TransferTask> enqueueOffer({
    required String offerId,
    required String fileName,
    required int size,
    String? mime,
    String? fromName,
    required String srcDeviceId,
    required String srcVPath,
    required bool autoAccept,
  }) async {
    // إزالة تكرار العرض نفسه (السيرفر قد يعيد الإرسال بعد إعادة الاتصال)
    final existing = _tasks.values.where((t) => t.offerId == offerId).toList();
    if (existing.isNotEmpty) return existing.first;

    final dir = await _ensureTempDir();
    final t = TransferTask(
      id: _newId(),
      kind: TxKind.download,
      serverKey: serverKey,
      fileName: fileName,
      mime: mime,
      totalBytes: size,
      offerId: offerId,
      fromName: fromName,
      srcDeviceId: srcDeviceId,
      srcVPath: srcVPath,
      tempPath: '${dir.path}/$offerId.nexuspart',
      autoAccepted: autoAccept,
    );
    _tasks[t.id] = t;
    await _persist(t);
    _onLog?.call(
      autoAccept ? 'ملف وارد (قبول تلقائي): $fileName' : 'ملف وارد بانتظار القبول: $fileName',
      kind: 'info',
    );
    if (autoAccept) {
      t.state = TxState.active;
      await _persist(t);
      _signaling?.send('tx:accept', {'id': offerId});
    }
    _pump();
    notifyListeners();
    return t;
  }

  // ------------------------------------------------------------------
  // أوامر المستخدم
  // ------------------------------------------------------------------

  Future<void> accept(String taskId) async {
    final t = _tasks[taskId];
    if (t == null || t.isTerminal) return;
    t.state = TxState.active;
    await _persist(t);
    if (!t.isUpload) _signaling?.send('tx:accept', {'id': t.offerId});
    _onLog?.call('قُبل استلام ${t.fileName}', kind: 'ok');
    _pump();
    notifyListeners();
  }

  Future<void> reject(String taskId) async {
    final t = _tasks[taskId];
    if (t == null || t.isTerminal) return;
    if (!t.isUpload) _signaling?.send('tx:reject', {'id': t.offerId});
    t.state = TxState.cancelled;
    t.error = 'رُفض من المستخدم';
    t.completedAt = DateTime.now();
    await _cleanupTemp(t);
    await _persist(t);
    _onLog?.call('رُفض استلام ${t.fileName}', kind: 'warn');
    _pump();
    notifyListeners();
  }

  Future<void> pause(String taskId) async {
    final t = _tasks[taskId];
    if (t == null || t.state != TxState.active) return;
    t.state = TxState.paused;
    t.speedBps = 0;
    await _persist(t);
    if (!t.isUpload) {
      _signaling?.send('tx:state', {'id': t.offerId, 'state': 'paused'});
    } else {
      try {
        await _api.uploadPause(t.id);
      } catch (_) {/* الحالة محلية تكفي */}
    }
    notifyListeners();
  }

  Future<void> resume(String taskId) async {
    final t = _tasks[taskId];
    if (t == null || t.state != TxState.paused) return;
    t.state = TxState.active;
    await _persist(t);
    if (!t.isUpload) {
      _signaling?.send('tx:accept', {'id': t.offerId});
    } else {
      try {
        await _api.uploadResume(t.id);
      } catch (_) {}
    }
    _pump();
    notifyListeners();
  }

  Future<void> cancel(String taskId) async {
    final t = _tasks[taskId];
    if (t == null || t.isTerminal) return;
    t.state = TxState.cancelled;
    t.error = 'أُلغيت بواسطة المستخدم';
    t.completedAt = DateTime.now();
    t.speedBps = 0;
    if (t.isUpload) {
      try {
        await _api.uploadAbort(t.id);
      } catch (_) {}
    } else {
      _signaling?.send('tx:state', {'id': t.offerId, 'state': 'cancelled'});
      await _cleanupTemp(t);
    }
    await _persist(t);
    _onLog?.call('أُلغي نقل ${t.fileName}', kind: 'warn');
    _pump();
    notifyListeners();
  }

  /// إعادة محاولة مهمة فاشلة/ملغاة من الصفر.
  Future<void> retry(String taskId) async {
    final old = _tasks[taskId];
    if (old == null) return;
    if (old.isUpload) {
      await enqueueUpload(
        localPath: old.localPath ?? '',
        fileName: old.fileName,
        size: old.totalBytes,
        mime: old.mime,
        dir: old.destDir,
      );
    } else {
      await enqueueOffer(
        offerId: old.offerId ?? _newId(),
        fileName: old.fileName,
        size: old.totalBytes,
        mime: old.mime,
        fromName: old.fromName,
        srcDeviceId: old.srcDeviceId ?? '',
        srcVPath: old.srcVPath ?? '/',
        autoAccept: true,
      );
      await _cleanupTemp(old);
    }
    _tasks.remove(old.id);
    await _db.removeTransfer(old.id);
    notifyListeners();
    return;
  }

  Future<void> remove(String taskId) async {
    final t = _tasks[taskId];
    if (t == null) return;
    if (!t.isTerminal) await cancel(taskId);
    _tasks.remove(taskId);
    await _db.removeTransfer(taskId);
    notifyListeners();
  }

  Future<void> clearFinished() async {
    final finished = _tasks.values.where((t) => t.isTerminal).toList();
    for (final t in finished) {
      _tasks.remove(t.id);
    }
    await _db.purgeOldTransfers(days: 0); // المنتهية فقط من السجل
    notifyListeners();
  }

  // ------------------------------------------------------------------
  // المجدول
  // ------------------------------------------------------------------

  void _pump() {
    if (_pumpScheduled) return;
    _pumpScheduled = true;
    Future.microtask(() async {
      _pumpScheduled = false;
      var running = _tasks.values.where((t) => t.state == TxState.active && t._running).length;
      for (final t in _tasks.values.toList()..sort((a, b) => a.startedAt.compareTo(b.startedAt))) {
        if (running >= maxConcurrent) break;
        if (t.state == TxState.active && !t._running) {
          running++;
          unawaited(_run(t));
        }
      }
    });
  }

  Future<void> _run(TransferTask t) async {
    t._running = true;
    _startSpeedTimer();
    try {
      if (t.isUpload) {
        await _runUpload(t);
      } else {
        await _runDownload(t);
      }
    } on TxDriftException catch (e) {
      t.transferred = e.received;
      t._running = false;
      _pump(); // أعد جدولتها بإزاحة مصححة
      notifyListeners();
      return;
    } on TxPausedException catch (e) {
      t.transferred = e.received;
      t.state = TxState.paused;
      t.speedBps = 0;
      await _persist(t);
      _onLog?.call('أوقف الكمبيوتر نقل ${t.fileName} مؤقتًا', kind: 'warn');
    } catch (e) {
      // فشل شبكة/قراءة → أوقف المهمة (تبقى قابلة للاستئناف من نفس الإزاحة)
      if (t.state == TxState.active) {
        t.state = TxState.paused;
        t.error = 'انقطع النقل: $e';
        t.speedBps = 0;
        await _persist(t);
        _onLog?.call('انقطع نقل ${t.fileName} — سيُستأنف من نفس النقطة', kind: 'warn');
      }
    } finally {
      t._running = false;
      _maybeStopSpeedTimer();
      notifyListeners();
      // بعد انتهاء أي مهمة حاول سحب التالية
      _pump();
    }
  }

  // ------------------------------------------------------------------
  // الرفع
  // ------------------------------------------------------------------

  Future<void> _runUpload(TransferTask t) async {
    final src = File(t.localPath ?? '');
    if (!await src.exists()) {
      _fail(t, 'الملف المصدر غير موجود');
      return;
    }
    if (t.transferred == 0 && t.totalBytes == 0) {
      // ملف فارغ: init ثم complete مباشرة
      await _api.uploadInit(
        deviceId: _deviceId, name: t.fileName, size: 0, mime: t.mime,
        localPath: t.localPath, dir: t.destDir, taskId: t.id,
      );
      await _completeUpload(t);
      return;
    }

    // جلسة موجودة؟ (استئناف) وإلا init جديد
    if (t.transferred == 0) {
      try {
        final init = await _api.uploadInit(
          deviceId: _deviceId, name: t.fileName, size: t.totalBytes, mime: t.mime,
          localPath: t.localPath, dir: t.destDir, taskId: t.id,
        );
        t.transferred = init.received;
        await _persist(t);
      } on TxException {
        rethrow;
      }
    }

    final raf = await src.open();
    try {
      var lastSignal = DateTime.now().subtract(TxProtocol.progressEvery);
      var lastPersist = DateTime.now();
      while (t.transferred < t.totalBytes && t.state == TxState.active) {
        final len = min(TxProtocol.uploadChunk, t.totalBytes - t.transferred);
        await raf.setPosition(t.transferred);
        final bytes = await raf.read(len);
        if (bytes.isEmpty) {
          _fail(t, 'وصل نهاية الملف مبكرًا (الحجم تغيّر؟)');
          return;
        }
        final received = await _api.uploadChunk(t.id, t.transferred, bytes);
        t.transferred = received;
        _sampleSpeed(t);
        final now = DateTime.now();
        if (now.difference(lastSignal) >= TxProtocol.progressEvery) {
          lastSignal = now;
          notifyListeners();
        }
        if (now.difference(lastPersist) >= const Duration(seconds: 2)) {
          lastPersist = now;
          await _persist(t);
        }
      }
    } finally {
      await raf.close();
    }

    if (t.state == TxState.active) {
      await _completeUpload(t);
    }
  }

  Future<void> _completeUpload(TransferTask t) async {
    final job = await _api.uploadComplete(t.id);
    t.state = TxState.done;
    t.transferred = t.totalBytes;
    t.finalPath = job.destPath;
    t.completedAt = DateTime.now();
    t.speedBps = 0;
    await _persist(t);
    // مصادر مؤقتة (صور/مشاركات cache) تُحذف بعد رفعها
    await _cleanupSource?.call(t.localPath);
    _onLog?.call('اكتمل الرفع: ${t.fileName} → ${t.finalPath}', kind: 'ok');
    notifyListeners();
  }

  // ------------------------------------------------------------------
  // التنزيل
  // ------------------------------------------------------------------

  Future<void> _runDownload(TransferTask t) async {
    final url = _api.downloadUrl(t.srcDeviceId ?? '', t.srcVPath ?? '/');
    final temp = File(t.tempPath ?? '');
    await temp.parent.create(recursive: true);

    if (t.transferred >= t.totalBytes && t.totalBytes > 0) {
      await _completeDownload(t);
      return;
    }

    var offset = t.transferred;
    if (offset > 0 && !await temp.exists()) offset = t.transferred = 0;

    final res = await _api.openRange(url, offset);
    if (res.statusCode == 200 && offset > 0) {
      // السيرفر تجاهل الـ Range → ابدأ من الصفر
      offset = 0;
      t.transferred = 0;
      await temp.writeAsBytes(List.empty(), mode: FileMode.write);
    }

    final sink = temp.openWrite(mode: offset == 0 ? FileMode.write : FileMode.append);
    var lastSignal = DateTime.now().subtract(TxProtocol.progressEvery);
    var lastPersist = DateTime.now();
    try {
      await for (final chunk in res.stream) {
        if (t.state != TxState.active) {
          // إيقاف/إلغاء أثناء البث — اقطع فورًا (الجزئي محفوظ للاستئناف)
          break;
        }
        sink.add(chunk);
        t.transferred += chunk.length;
        _sampleSpeed(t);
        final now = DateTime.now();
        if (now.difference(lastSignal) >= TxProtocol.progressEvery) {
          lastSignal = now;
          _signaling?.send('tx:progress', {'id': t.offerId, 'transferred': t.transferred});
          notifyListeners();
        }
        if (now.difference(lastPersist) >= const Duration(seconds: 2)) {
          lastPersist = now;
          await _persist(t);
        }
      }
      await sink.flush();
    } finally {
      await sink.close();
    }

    if (t.state != TxState.active) return;

    if (t.transferred >= t.totalBytes && t.totalBytes > 0) {
      await _completeDownload(t);
    } else if (t.totalBytes == 0) {
      await _completeDownload(t);
    } else {
      // انقطع البث قبل الاكتمال — تبقى المهمة قابلة للاستئناف
      throw TxException('انقطع البث عند ${t.transferred}/${t.totalBytes}');
    }
  }

  Future<void> _completeDownload(TransferTask t) async {
    // انشر الملف في مجلد NexusLink العام (MediaStore على Android) + إشعار نظام
    String? finalPath;
    final temp = File(t.tempPath ?? '');
    if (await temp.exists()) {
      final published = await _native?.publishDownload(
        tempPath: temp.path,
        displayName: t.fileName,
        mime: t.mime,
      );
      if (published != null && published.isNotEmpty) {
        finalPath = published;
        await temp.delete().catchError((_) => temp);
      } else {
        // بيئة بلا أندرويد (فحص/تحليل) — أبقِ الملف في مجلد الجزئيات بالاسم النهائي
        finalPath = '${temp.parent.path}/${t.fileName}';
        await temp.rename(finalPath).catchError((_) => temp);
      }
    }
    t.state = TxState.done;
    t.transferred = t.totalBytes;
    t.finalPath = finalPath;
    t.completedAt = DateTime.now();
    t.speedBps = 0;
    await _persist(t);
    _signaling?.send('tx:state', {'id': t.offerId, 'state': 'done'});
    _onLog?.call('اكتمل الاستلام: ${t.fileName}${finalPath != null ? ' → $finalPath' : ''}', kind: 'ok');
    notifyListeners();
  }

  // ------------------------------------------------------------------
  // أوامر الكمبيوتر الواردة (عبر الإشارة)
  // ------------------------------------------------------------------

  /// tx:pause من الكمبيوتر (مهمة تنزيل).
  Future<void> pauseByServer(String offerId) async {
    final t = _tasks.values.where((x) => x.offerId == offerId).firstOrNull;
    if (t == null || t.state != TxState.active) return;
    t.state = TxState.paused;
    t.speedBps = 0;
    await _persist(t);
    _onLog?.call('أوقف الكمبيوتر تنزيل ${t.fileName}', kind: 'warn');
    notifyListeners();
  }

  Future<void> resumeByServer(String offerId) async {
    final t = _tasks.values.where((x) => x.offerId == offerId).firstOrNull;
    if (t == null || t.state != TxState.paused) return;
    t.state = TxState.active;
    await _persist(t);
    _pump();
    notifyListeners();
  }

  Future<void> cancelByServer(String offerId) async {
    final t = _tasks.values.where((x) => x.offerId == offerId).firstOrNull;
    if (t == null || t.isTerminal) return;
    t.state = TxState.cancelled;
    t.error = 'أُلغيت من الكمبيوتر';
    t.completedAt = DateTime.now();
    await _cleanupTemp(t);
    await _persist(t);
    _onLog?.call('أُلغي تنزيل ${t.fileName} من الكمبيوتر', kind: 'warn');
    notifyListeners();
  }

  // ------------------------------------------------------------------
  // أدوات داخلية
  // ------------------------------------------------------------------

  void _fail(TransferTask t, String message) {
    t.state = TxState.failed;
    t.error = message;
    t.speedBps = 0;
    t.completedAt = DateTime.now();
    if (!t.isUpload) {
      _signaling?.send('tx:state', {'id': t.offerId, 'state': 'failed', 'error': message});
    }
    _persist(t);
    _onLog?.call('فشل نقل ${t.fileName}: $message', kind: 'error');
    notifyListeners();
    _pump();
  }

  Future<void> _persist(TransferTask t) async {
    try {
      await _db.upsertTransfer(t.toCompanion());
      t.updatedAt = DateTime.now();
    } catch (e) {
      if (kDebugMode) debugPrint('persist transfer failed: $e');
    }
  }

  Future<void> _cleanupTemp(TransferTask t) async {
    final p = t.tempPath;
    if (p == null) return;
    try {
      final f = File(p);
      if (await f.exists()) await f.delete();
    } catch (_) {}
  }

  Future<Directory> _ensureTempDir() async {
    final dir = Directory(_tempDirPath);
    if (!await dir.exists()) await dir.create(recursive: true);
    return dir;
  }

  void _sampleSpeed(TransferTask t) {
    final now = DateTime.now();
    final list = _samples.putIfAbsent(t.id, () => <_SpeedSample>[]);
    list.add(_SpeedSample(now, t.transferred));
    while (list.length > 2 && now.difference(list.first.at).inMilliseconds > 3000) {
      list.removeAt(0);
    }
    if (list.length >= 2) {
      final first = list.first;
      final dtMs = now.difference(first.at).inMilliseconds;
      if (dtMs > 200) {
        t.speedBps = max(0.0, (t.transferred - first.transferred) * 1000 / dtMs);
      }
    }
  }

  void _startSpeedTimer() {
    _speedTimer ??= Timer.periodic(const Duration(milliseconds: 700), (_) {
      var anyActive = false;
      for (final t in _tasks.values) {
        if (t.state == TxState.active) {
          anyActive = true;
          final list = _samples[t.id];
          if (list != null && list.isNotEmpty && DateTime.now().difference(list.last.at).inMilliseconds > 2500) {
            // لا بايتات جديدة مؤخرًا → سرعة صفر
            t.speedBps = 0;
          }
        }
      }
      if (anyActive) notifyListeners();
    });
  }

  void _maybeStopSpeedTimer() {
    final any = _tasks.values.any((t) => t.state == TxState.active);
    if (!any) {
      _speedTimer?.cancel();
      _speedTimer = null;
    }
  }

  @override
  void dispose() {
    _speedTimer?.cancel();
    super.dispose();
  }
}

class _SpeedSample {
  final DateTime at;
  final int transferred;
  const _SpeedSample(this.at, this.transferred);
}

extension _TaskRuntime on TransferTask {
  /// هل المهمة تعمل فعليًا داخل _run الآن؟ (حقل وقت تشغيل غير محفوظ)
  static final Expando<bool> _runningFlag = Expando<bool>();
  bool get _running => _runningFlag[this] ?? false;
  set _running(bool v) => _runningFlag[this] = v;
}

extension _FirstWhereX<T> on Iterable<T> {
  T? get firstOrNull => isEmpty ? null : first;
}
