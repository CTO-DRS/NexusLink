import 'dart:async';
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../core/protocol.dart';
import '../data/agent_channel.dart';
import '../data/database/nexus_db.dart';
import '../data/echo_registry.dart';
import '../data/native_bridge.dart';
import '../data/phone_media_server.dart';
import '../data/signaling.dart';
import '../data/sync_service.dart';
import '../data/transfer_api.dart';
import '../data/transfer_engine.dart';
import '../domain/models.dart';
import 'control_providers.dart';
import 'controller_providers.dart';
import 'media_providers.dart';
import 'providers.dart' show ConnectPhase, activityLogProvider, agentChannelProvider, connectionProvider, nexusDbProvider;
import 'security_providers.dart' show lostProvider, secStateProvider, wipeProvider;

// ---------------------------------------------------------------------------
// إعدادات النقل (تُحفظ محليًا)
// ---------------------------------------------------------------------------

class TxSettings {
  final bool autoAcceptTrusted; // قبول تلقائي من سيرفر موثوق
  final bool autoCopyText; // نسخ النصوص/الروابط تلقائيًا للحافظة
  final bool photoSyncEnabled; // رفع الصور الجديدة تلقائيًا عند الاتصال
  final int photoLastSyncSec; // علامة آخر مسح لـ DCIM (ثواني Epoch)

  const TxSettings({
    this.autoAcceptTrusted = true,
    this.autoCopyText = true,
    this.photoSyncEnabled = false,
    this.photoLastSyncSec = 0,
  });

  TxSettings copyWith({bool? autoAcceptTrusted, bool? autoCopyText, bool? photoSyncEnabled, int? photoLastSyncSec}) =>
      TxSettings(
        autoAcceptTrusted: autoAcceptTrusted ?? this.autoAcceptTrusted,
        autoCopyText: autoCopyText ?? this.autoCopyText,
        photoSyncEnabled: photoSyncEnabled ?? this.photoSyncEnabled,
        photoLastSyncSec: photoLastSyncSec ?? this.photoLastSyncSec,
      );
}

class TxSettingsController extends Notifier<TxSettings> {
  @override
  TxSettings build() {
    SharedPreferences.getInstance().then((p) {
      state = TxSettings(
        autoAcceptTrusted: p.getBool('nexus.tx.autoAccept') ?? true,
        autoCopyText: p.getBool('nexus.tx.autoCopy') ?? true,
        photoSyncEnabled: p.getBool('nexus.tx.photoSync') ?? false,
        photoLastSyncSec: p.getInt('nexus.tx.photoSyncMarker') ?? 0,
      );
    });
    return const TxSettings();
  }

  Future<void> update(TxSettings next) async {
    state = next;
    final p = await SharedPreferences.getInstance();
    await p.setBool('nexus.tx.autoAccept', next.autoAcceptTrusted);
    await p.setBool('nexus.tx.autoCopy', next.autoCopyText);
    await p.setBool('nexus.tx.photoSync', next.photoSyncEnabled);
    await p.setInt('nexus.tx.photoSyncMarker', next.photoLastSyncSec);
  }
}

final txSettingsProvider = NotifierProvider<TxSettingsController, TxSettings>(TxSettingsController.new);

// ---------------------------------------------------------------------------
// جسر النظام الأصلي
// ---------------------------------------------------------------------------

final nativeBridgeProvider = Provider<NativeBridge>((ref) => NativeBridge());

// ---------------------------------------------------------------------------
// محرك النقل — يُبنى لكل سيرفر عند الاتصال، ويُستأنف من SQLite
// ---------------------------------------------------------------------------

class EngineController extends Notifier<TransferEngine?> {
  String? _builtFor;
  // FA-files (عقد §14) — خدمة مزامنة المجلدات (هاتف → كمبيوتر)
  PhoneSyncService? _sync;
  String? _syncDeviceId;

  @override
  TransferEngine? build() {
    ref.listen(connectionProvider, (_, next) {
      Future.microtask(() => _onConnection(next));
    });
    // أول بناء: ربما الاتصال جاهز بالفعل (مؤجّل — يُمنع تعديل الحالة أثناء build)
    final cur = ref.read(connectionProvider).value;
    if (cur?.phase == ConnectPhase.online && cur?.endpoint != null && cur?.me != null) {
      Future.microtask(() => _onConnection(AsyncData(cur)));
    }
    ref.onDispose(() => state?.dispose());
    return null;
  }

  Future<void> _onConnection(AsyncValue<dynamic> next) async {
    final m = next.value;
    if (m == null) return;
    if (m.phase == ConnectPhase.online && m.endpoint != null && m.me != null) {
      await _ensure(m.endpoint!, m.me!.id);
      await state?.resumePending();
      // امسح الصور الجديدة عند الاتصال (إن كان الخيار مفعّلًا)
      unawaited(ref.read(photoSyncControllerProvider.notifier).scanNow());
    }
  }

  Future<void> _ensure(ServerEndpoint endpoint, String deviceId) async {
    if (_builtFor == endpoint.key && state != null) return;
    // سيرفر مختلف → أوقف المحرك القديم (مهامه محفوظة في SQLite وتُستأنف لاحقًا)
    state?.dispose();
    final support = await getApplicationSupportDirectory();
    final tempDir = '${support.path}${Platform.pathSeparator}transfers';
    final engine = TransferEngine(
      api: NexusTransferApi(endpoint),
      database: ref.read(nexusDbProvider),
      serverKey: endpoint.key,
      deviceId: deviceId,
      tempDirPath: tempDir,
      native: ref.read(nativeBridgeProvider),
      signaling: ref.read(signalingProvider.notifier).attachEngineServer(endpoint),
      onLog: (text, {kind = 'info'}) => ref.read(activityLogProvider.notifier).add(text, kind: kind),
      cleanupSource: _cleanupUploadSource,
    );
    state = engine;
    _builtFor = endpoint.key;
    ref.read(activityLogProvider.notifier).add('محرك النقل جاهز (${endpoint.key})', kind: 'ok');
    unawaited(_ensurePhoneFilesServices(endpoint, deviceId));
  }

  /// FA-files (عقد §14) — خادم وسائط الهاتف + مزامنة المجلدات + إعلان النقطة.
  Future<void> _ensurePhoneFilesServices(ServerEndpoint endpoint, String deviceId) async {
    final native = ref.read(nativeBridgeProvider);
    final log = (String text, {String kind = 'info'}) =>
        ref.read(activityLogProvider.notifier).add(text, kind: kind);

    // 1) خادم الوسائط (idempotent على مستوى العملية) + إعلان النقطة للخدمة الدائمة
    try {
      final media = PhoneMediaServer.instance;
      await media.start();
      await native.setMediaEndpoint(media.port, media.token);
      log('خدمة وسائط الهاتف على المنفذ ${media.port}', kind: 'ok');
    } catch (e) {
      log('تعذر إقلاع خدمة الوسائط: $e', kind: 'warn');
    }

    // 2) مزامنة المجلدات (الهاتف → الكمبيوتر) — مراقبة فورية بـ Directory.watch
    try {
      if (_sync == null || _syncDeviceId != deviceId) {
        await _sync?.stop();
        _sync = PhoneSyncService(api: NexusTransferApi(endpoint), deviceId: deviceId, onLog: log);
        _syncDeviceId = deviceId;
      }
      await _sync!.start();
    } catch (e) {
      log('تعذر بدء مزامنة المجلدات: $e', kind: 'warn');
    }
    // سجل الصدى جاهز (يستخدمه محرك النقل عند نزول عروض المزامنة)
    EchoRegistry.instance;
  }

  /// مصادر الرفع المؤقتة (صور cache/مشاركات) تُحذف بعد اكتمال رفعها.
  Future<void> _cleanupUploadSource(String? localPath) async {
    if (localPath == null) return;
    for (final marker in ['/nexus-photos/', '/nexus-share/']) {
      if (localPath.contains(marker)) {
        try {
          final f = File(localPath);
          if (await f.exists()) await f.delete();
        } catch (_) {}
        return;
      }
    }
  }
}

final engineProvider = NotifierProvider<EngineController, TransferEngine?>(EngineController.new);

// ---------------------------------------------------------------------------
// قنوات الإشارة الحية (socket.io من الواجهة: 3006 نقل + 3007 نصوص/روابط)
// ---------------------------------------------------------------------------

class SignalingController extends Notifier<AgentSignaling?> {
  StreamSubscription? _subOffers;
  StreamSubscription? _subCommands;
  StreamSubscription? _subClips;
  StreamSubscription? _subHands;
  StreamSubscription? _subNative;
  ServerEndpoint? _endpoint;
  AgentSignaling? _sig;

  @override
  AgentSignaling? build() {
    ref.listen(connectionProvider, (_, next) {
      final m = next.value;
      if (m == null) return;
      if (m.phase == ConnectPhase.online && m.endpoint != null) {
        Future.microtask(() => _start(m.endpoint!));
      }
    });
    final cur = ref.read(connectionProvider).value;
    if (cur?.phase == ConnectPhase.online && cur?.endpoint != null) {
      Future.microtask(() => _start(cur!.endpoint!));
    }
    ref.onDispose(() {
      _cancelSubs();
      _sig?.dispose();
    });
    return null;
  }

  void _cancelSubs() {
    for (final s in [_subOffers, _subCommands, _subClips, _subHands, _subNative]) {
      s?.cancel();
    }
    _subOffers = _subCommands = _subClips = _subHands = _subNative = null;
  }

  /// تُستدعى من EngineController ليحصل المحرك على قناة إرسال فور بنائه.
  TxSignaling attachEngineServer(ServerEndpoint endpoint) {
    if (_sig == null || _endpoint?.key != endpoint.key) {
      _endpoint = endpoint;
      _sig = AgentSignaling();
      _sig!.connect(host: endpoint.host, port: endpoint.port, mode: endpoint.mode.name);
      _wire(_sig!);
    }
    return _sig!;
  }

  Future<void> _start(ServerEndpoint endpoint) async {
    _endpoint = endpoint;
    _sig ??= AgentSignaling();
    if (!(_sig?.isConnected ?? false)) {
      _sig!.connect(host: endpoint.host, port: endpoint.port, mode: endpoint.mode.name);
    }
    _wire(_sig!);
    state = _sig;
  }

  void _wire(AgentSignaling sig) {
    _cancelSubs();

    // 1) عروض ملفات قادمة (tx:offer) — من السوكِت ومن القناة الأصلية معًا
    //    (إزالة التكرار تتم في المحرك عبر offerId)
    _subOffers = sig.offers.listen((offer) => _handleOffer(offer, fromNative: false));
    _subNative = ref.read(agentChannelProvider).rawEvents.listen((raw) {
      final kind = '${raw['kind'] ?? ''}';
      final detail = AgentChannel.decodeDetail(raw['detail']);
      if (kind == 'tx' && detail != null) {
        final offer = TxOfferEvent.tryParse(detail);
        if (offer != null) _handleOffer(offer, fromNative: true);
      } else if (kind == 'photos') {
        unawaited(ref.read(photoSyncControllerProvider.notifier).scanNow());
      } else if (kind == 'share') {
        unawaited(ref.read(shareIntakeProvider.notifier).drain());
      } else if (kind == 'ctl' && detail != null) {
        // FA-7 — أحداث جلسة التحكم عن بعد (القناة الوحيدة لا تحتمل مستمعين)
        ref.read(controlControllerProvider.notifier).ingest(detail);
      } else if (kind == 'mediastop') {
        // FA-8 — زر «إيقاف البث» من إشعار الوسائط في شريط النظام
        unawaited(ref.read(mediaControllerProvider.notifier).stopEverything());
      } else if (kind == 'quicksend') {
        // FA-9 — ودجت الإرسال السريع: حافظة الهاتف → الكمبيوتر فورًا
        unawaited(ref.read(controllerControllerProvider.notifier).pushClipboard());
        ref.read(activityLogProvider.notifier).add('إرسال سريع من الودجت: تُرفع حافظة الهاتف إلى الكمبيوتر', kind: 'ok');
      } else if (kind == 'clip' && detail != null) {
        // FA-clipboard-sync — الخدمة الأصلية كتبت نصًا من الكمبيوتر في حافظة
        // الهاتف (تعمل حتى مع واجهة ميتة): تحديث حرس الحلقة (عقد §11.ج)
        final text = '${detail['content'] ?? ''}';
        if (text.isNotEmpty) {
          ref.read(controllerControllerProvider.notifier).markExternal(text);
          ref.read(activityLogProvider.notifier).add('نص من الكمبيوتر جاهز في حافظة الهاتف (${text.length} حرفًا)', kind: 'ok');
        }
      } else if (kind == 'sec' && detail != null) {
        // FA-10 — حالة قناة الأمان 3009 (online/kex/sas/قفل)
        ref.read(secStateProvider.notifier).ingest(detail);
      } else if (kind == 'lost' && detail != null) {
        // FA-10 — وضع الفقدان الحي من LostMode
        ref.read(lostProvider.notifier).ingest(detail);
      } else if (kind == 'wipe' && detail != null) {
        // FA-10 — تقدم/نتيجة المسح الآمن
        ref.read(wipeProvider.notifier).ingest(detail);
      } else if (kind == 'secclip') {
        // FA-10 — نص مشفر وصل عبر 3009 (لا يتم حفظه في الحافظة إلا بقرار المستخدم)
        final text = '${detail?['text'] ?? ''}';
        if (text.isNotEmpty) {
          ref.read(activityLogProvider.notifier).add('وصل نص مشفر عبر القناة الآمنة (${text.length} حرفًا)', kind: 'ok');
        }
      }
    });

    // 2) أوامر الكمبيوتر على مهام التنزيل
    _subCommands = sig.commands.listen((cmd) {
      final engine = ref.read(engineProvider);
      if (engine == null || cmd.offerId.isEmpty) return;
      switch (cmd.event) {
        case GuardEvents.txPause:
          engine.pauseByServer(cmd.offerId);
        case GuardEvents.txResume:
          engine.resumeByServer(cmd.offerId);
        case GuardEvents.txCancel:
          engine.cancelByServer(cmd.offerId);
      }
    });

    // 3) النصوص/الروابط السريعة
    _subClips = sig.clips.listen((clip) {
      ref.read(quickIntakeProvider.notifier).addClip(clip);
      final autoCopy = ref.read(txSettingsProvider).autoCopyText;
      if (autoCopy && clip.kind == 'text' && clip.content.isNotEmpty) {
        Clipboard.setData(ClipboardData(text: clip.content));
        // FA-clipboard-sync — حرس الحلقة: ما وضعناه في الحافظة ليس نسخة هاتفية
        // للإرسال، بل نص وارد من الكمبيوتر — كي لا تعيده مراقبة الشاشة المفتوحة (عقد §11.ج)
        ref.read(controllerControllerProvider.notifier).markExternal(clip.content);
        ref.read(activityLogProvider.notifier).add(
              'نُسخ نص وارد من ${clip.deviceName} إلى الحافظة (${clip.content.length} حرفًا)',
              kind: 'ok',
            );
      }
    });
    _subHands = sig.hands.listen((hand) {
      ref.read(quickIntakeProvider.notifier).addHand(hand);
      final autoCopy = ref.read(txSettingsProvider).autoCopyText;
      if (autoCopy) {
        Clipboard.setData(ClipboardData(text: hand.url));
        ref.read(activityLogProvider.notifier).add('نُسخ رابط وارد من ${hand.deviceName} إلى الحافظة', kind: 'ok');
      }
    });
  }

  Future<void> _handleOffer(TxOfferEvent offer, {required bool fromNative}) async {
    final engine = ref.read(engineProvider);
    if (engine == null) return;
    final auto = ref.read(txSettingsProvider).autoAcceptTrusted;
    await engine.enqueueOffer(
      offerId: offer.id,
      fileName: offer.fileName,
      size: offer.size,
      mime: offer.mime,
      fromName: offer.from,
      srcDeviceId: offer.srcDeviceId,
      srcVPath: offer.srcVPath,
      autoAccept: auto,
    );
    // الواجهة عالجت العرض → أخفِ إشعار الخدمة الخاص به (تجنب التكرار)
    await ref.read(nativeBridgeProvider).cancelNotif(offer.id.hashCode & 0x7fffffff);
  }
}

final signalingProvider = NotifierProvider<SignalingController, AgentSignaling?>(SignalingController.new);

// ---------------------------------------------------------------------------
// النصوص/الروابط السريعة الواردة (لشاشة النقل)
// ---------------------------------------------------------------------------

/// عنصر موحد للعرض: نص أو رابط وارد.
class QuickItem {
  final ClipItem? clip;
  final HandItem? hand;
  final DateTime at;
  const QuickItem({this.clip, this.hand, required this.at});
  bool get isLink => hand != null;
  String get title => isLink ? hand!.title : (clip!.kind == 'text' ? clip!.content : (clip!.fileName ?? 'ملف'));
  String get from => isLink ? hand!.deviceName : clip!.deviceName;
  String? get url => hand?.url;
}

class QuickIntake extends Notifier<List<QuickItem>> {
  static const int _max = 50;

  @override
  List<QuickItem> build() => const [];

  void addClip(ClipItem c) {
    if (c.kind != 'text' && c.kind != 'image') return;
    state = [QuickItem(clip: c, at: DateTime.now()), ...state].take(_max).toList();
  }

  void addHand(HandItem h) {
    state = [QuickItem(hand: h, at: DateTime.now()), ...state].take(_max).toList();
  }

  void clear() => state = const [];
}

final quickIntakeProvider = NotifierProvider<QuickIntake, List<QuickItem>>(QuickIntake.new);

// ---------------------------------------------------------------------------
// المشاركة الواردة من أندرويد (Share Sheet): "إرسال عبر NexusLink"
// ---------------------------------------------------------------------------

class ShareIntakeController extends Notifier<List<SharedIntake>> {
  @override
  List<SharedIntake> build() {
    // عند فتح التطبيق: اسحب ما علّق من مشاركات سابقة
    Future.microtask(() => drain());
    return const [];
  }

  /// اسحب العناصر المعلقة من أندرويد (ثلاث مرات: نص، ملف واحد، ملفات متعددة).
  Future<void> drain() async {
    final item = await ref.read(nativeBridgeProvider).drainShare();
    if (!item.isEmpty) {
      state = [...state, item];
      ref.read(activityLogProvider.notifier).add(
            'وُصل محتوى مشارَك: ${item.text != null ? 'نص' : '${item.files.length} ملف'} — بانتظار الإرسال',
            kind: 'info',
          );
    }
  }

  void removeAt(int index) {
    state = [...state]..removeAt(index);
  }
}

final shareIntakeProvider = NotifierProvider<ShareIntakeController, List<SharedIntake>>(ShareIntakeController.new);

// ---------------------------------------------------------------------------
// النسخ التلقائي للصور الجديدة (DCIM) عند الاتصال
// ---------------------------------------------------------------------------

class PhotoSyncController extends Notifier<void> {
  bool _scanning = false;

  @override
  void build() {}

  /// يمسح DCIM/Pictures عن صور أحدث من العلامة ويرفعها عبر محرك النقل.
  Future<void> scanNow() async {
    if (_scanning) return;
    final settings = ref.read(txSettingsProvider);
    if (!settings.photoSyncEnabled) return;
    final engine = ref.read(engineProvider);
    if (engine == null) return; // الرفع فقط عند الاتصال
    _scanning = true;
    try {
      final photos = await ref.read(nativeBridgeProvider).queryNewPhotos(settings.photoLastSyncSec);
      if (photos.isEmpty) {
        // لا جديد → قدّم العلامة لتقليل المسح القادم
        await ref.read(txSettingsProvider.notifier).update(
              settings.copyWith(photoLastSyncSec: DateTime.now().millisecondsSinceEpoch ~/ 1000 - 60),
            );
        return;
      }
      var enqueued = 0;
      var maxDate = settings.photoLastSyncSec;
      for (final ph in photos) {
        if (ph.dateAddedSec > maxDate) maxDate = ph.dateAddedSec;
        try {
          await engine.enqueueUpload(
            localPath: ph.path,
            fileName: ph.name,
            size: ph.size,
            mime: ph.mime ?? 'image/jpeg',
          );
          enqueued++;
        } catch (_) {/* الملف التالي */}
      }
      await ref.read(txSettingsProvider.notifier).update(
            settings.copyWith(photoLastSyncSec: maxDate + 1),
          );
      if (enqueued > 0) {
        ref.read(activityLogProvider.notifier).add('رُفعت $enqueued صورة جديدة تلقائيًا من الكاميرا', kind: 'ok');
      }
    } catch (e) {
      ref.read(activityLogProvider.notifier).add('فشل مسح الصور: $e', kind: 'warn');
    } finally {
      _scanning = false;
    }
  }
}

final photoSyncControllerProvider = NotifierProvider<PhotoSyncController, void>(PhotoSyncController.new);

// ---------------------------------------------------------------------------
// سجل النقل الدائم (SQLite) — للعرض المباشر
// ---------------------------------------------------------------------------

final transfersHistoryProvider = StreamProvider<List<TransferRecord>>((ref) {
  return ref.watch(nexusDbProvider).watchTransfers();
});
