import 'dart:async';

import 'package:drift/drift.dart' show Value;
import 'package:flutter/material.dart' show ThemeMode;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../core/protocol.dart';
import '../data/agent_channel.dart';
import '../data/database/nexus_db.dart';
import '../data/device_identity.dart';
import '../data/nexus_api.dart';
import '../domain/discovery_service.dart';
import '../domain/models.dart';

// ---------------------------------------------------------------------------
// إعدادات المظهر/اللغة (تُحفظ محليًا)
// ---------------------------------------------------------------------------

class ThemePrefs extends Notifier<ThemeMode> {
  @override
  ThemeMode build() {
    SharedPreferences.getInstance().then((p) {
      final v = p.getString('nexus.themeMode');
      if (v != null && state.name != v) {
        state = ThemeMode.values.firstWhere(
          (m) => m.name == v,
          orElse: () => ThemeMode.system,
        );
      }
    });
    return ThemeMode.system;
  }

  Future<void> set(ThemeMode mode) async {
    state = mode;
    final p = await SharedPreferences.getInstance();
    await p.setString('nexus.themeMode', mode.name);
  }
}

final themeModePrefsProvider = NotifierProvider<ThemePrefs, ThemeMode>(ThemePrefs.new);

// ---------------------------------------------------------------------------
// قاعدة البيانات + الخوادم الموثوقة
// ---------------------------------------------------------------------------

/// مزود منفرد لقاعدة البيانات (يفتح مرة واحدة لكل تشغيل).
final nexusDbProvider = Provider<NexusDatabase>((ref) {
  final db = NexusDatabase();
  ref.onDispose(db.close);
  return db;
});

final trustedServersProvider = StreamProvider<List<TrustedServer>>((ref) {
  return ref.watch(nexusDbProvider).watchAll();
});

// ---------------------------------------------------------------------------
// هوية الجهاز
// ---------------------------------------------------------------------------

final deviceIdentityProvider = FutureProvider<DeviceIdentity>((ref) async {
  return DeviceIdentity.load();
});

// ---------------------------------------------------------------------------
// اكتشاف mDNS
// ---------------------------------------------------------------------------

class DiscoveryController extends Notifier<List<DiscoveredServer>> {
  final DiscoveryService _service = DiscoveryService();
  Timer? _announce;

  @override
  List<DiscoveredServer> build() {
    ref.onDispose(() {
      _announce?.cancel();
      _service.stop();
    });
    return _service.found;
  }

  Future<void> start() async {
    _service.addListener((s) {
      state = List.of(_service.found);
      ref.read(activityLogProvider.notifier).add(
            'اكتُشف سيرفر عبر mDNS: ${s.name} (${s.host}:${s.port})',
            kind: 'ok',
          );
    });
    await _service.start();
    // إعادة إعلان القائمة دوريًا (بعد اكتمال الاكتشاف)
    _announce?.cancel();
    _announce = Timer.periodic(const Duration(seconds: 3), (_) {
      state = List.of(_service.found);
    });
  }
}

final discoveryProvider = NotifierProvider<DiscoveryController, List<DiscoveredServer>>(
  DiscoveryController.new,
);

// ---------------------------------------------------------------------------
// السجل النشط (ring buffer)
// ---------------------------------------------------------------------------

class ActivityLog extends Notifier<List<LogEntry>> {
  static const int _max = 200;

  @override
  List<LogEntry> build() => const [];

  void add(String text, {String kind = 'info'}) {
    final next = [LogEntry(text, kind: kind, at: DateTime.now()), ...state];
    state = next.length > _max ? next.sublist(0, _max) : next;
  }

  void clear() => state = const [];
}

final activityLogProvider = NotifierProvider<ActivityLog, List<LogEntry>>(ActivityLog.new);

// ---------------------------------------------------------------------------
// حالة الاتصال الرئيسية
// ---------------------------------------------------------------------------

enum ConnectPhase { idle, checking, pairing, startingService, online, error }

class ConnectionStateModel {
  final ConnectPhase phase;
  final ServerEndpoint? endpoint;
  final String? serverName;
  final NexusDevice? me; // جهازنا كما سجّله السيرفر
  final int? rttMs;
  final String? error;

  const ConnectionStateModel({
    this.phase = ConnectPhase.idle,
    this.endpoint,
    this.serverName,
    this.me,
    this.rttMs,
    this.error,
  });

  bool get isOnline => phase == ConnectPhase.online;

  ConnectionStateModel copyWith({
    ConnectPhase? phase,
    ServerEndpoint? endpoint,
    String? serverName,
    NexusDevice? me,
    int? rttMs,
    String? error,
    bool clearError = false,
  }) =>
      ConnectionStateModel(
        phase: phase ?? this.phase,
        endpoint: endpoint ?? this.endpoint,
        serverName: serverName ?? this.serverName,
        me: me ?? this.me,
        rttMs: rttMs ?? this.rttMs,
        error: clearError ? null : (error ?? this.error),
      );
}

class ConnectionController extends AsyncNotifier<ConnectionStateModel> {
  StreamSubscription<AgentEvent>? _eventsSub;

  @override
  Future<ConnectionStateModel> build() async {
    ref.onDispose(() {
      _eventsSub?.cancel();
    });
    _listenAgentEvents();
    // استعادة آخر خادم موثوق عند الإقلاع (لا اتصال تلقائي — عرض فقط)
    final db = ref.read(nexusDbProvider);
    final last = await db.lastUsed();
    if (last == null) return const ConnectionStateModel();
    return ConnectionStateModel(
      serverName: last.name,
      endpoint: ServerEndpoint(host: last.host, port: last.port, mode: last.mode == 'direct' ? AccessMode.direct : AccessMode.gateway),
    );
  }

  void _listenAgentEvents() {
    _eventsSub ??= ref.read(agentChannelProvider).events.listen((e) {
      final log = ref.read(activityLogProvider.notifier);
      switch (e.state) {
        case AgentLinkState.online:
          log.add('القناة الخلفية حية مع ${e.serverKey}', kind: 'ok');
        case AgentLinkState.reconnecting:
          log.add('إعادة اتصال بالخادم ${e.serverKey}…', kind: 'warn');
        case AgentLinkState.offline:
          log.add('انقطعت القناة الخلفية', kind: 'error');
        case AgentLinkState.connecting:
          log.add('الخدمة الخلفية تتصل…', kind: 'info');
        case AgentLinkState.stopped:
          break;
      }
      state.whenData((m) => m); // يحفّز المستمعين عبر stateAgent أعلاه
      ref.read(agentStateProvider.notifier).state = e.state;
    });
  }
  /// مسار الاتصال الكامل: فحص الصحة → الاقتران → الحفظ → بدء الخدمة الخلفية.
  Future<void> connect({
    required ServerEndpoint endpoint,
    required String serverName,
    String? qrSecret,
  }) async {
    final log = ref.read(activityLogProvider.notifier);
    state = AsyncData(ConnectionStateModel(phase: ConnectPhase.checking, endpoint: endpoint, serverName: serverName));

    // 1) فحص الصحة عبر endpoint موجود بالسيرفر (/api/tools/ping)
    int rtt;
    final api = NexusApi(endpoint);
    try {
      rtt = await api.healthCheck();
      log.add('فحص الصحة ناجح: ${endpoint.key} — ${rtt}ms', kind: 'ok');
    } catch (e) {
      log.add('فشل فحص الصحة: $e', kind: 'error');
      state = AsyncData(ConnectionStateModel(
        phase: ConnectPhase.error,
        endpoint: endpoint,
        serverName: serverName,
        error: e.toString(),
      ));
      return;
    }

    // 2) تسجيل الجهاز لدى السيرفر (شكل البيانات مطابق حرفيًا)
    state = AsyncData(ConnectionStateModel(
      phase: ConnectPhase.pairing, endpoint: endpoint, serverName: serverName, rttMs: rtt,
    ));
    final identity = await ref.read(deviceIdentityProvider.future);
    NexusDevice me;
    try {
      me = await api.pair(
        stableId: identity.stableId,
        deviceName: identity.name,
        model: identity.model,
        os: identity.os,
        battery: identity.battery,
        storageTotal: 128 * 1024 * 1024 * 1024,
        storageUsed: 40 * 1024 * 1024 * 1024,
        ip: '0.0.0.0', // السيرفر يعيد تسجيل IP فعلي عبر الحقل الاختياري
      );
      log.add('سُجّل الجهاز لدى السيرفر: ${me.name} (${me.id})', kind: 'ok');
    } catch (e) {
      log.add('فشل تسجيل الجهاز: $e', kind: 'error');
      state = AsyncData(ConnectionStateModel(
        phase: ConnectPhase.error, endpoint: endpoint, serverName: serverName, rttMs: rtt, error: '$e',
      ));
      return;
    }

    // 3) الحفظ في SQLite المحلي (خوادم موثوقة) + تعليمه آخر استخدام
    final db = ref.read(nexusDbProvider);
    await db.upsert(TrustedServersCompanion.insert(
      serverKey: endpoint.key,
      name: serverName,
      host: endpoint.host,
      port: endpoint.port,
      mode: endpoint.mode.name,
      deviceId: me.id,
      deviceName: me.name,
      pairingSecret: Value(qrSecret),
      pairedAt: DateTime.now(),
      lastUsedAt: DateTime.now(),
    ));
    final row = await db.byKey(endpoint.key);
    if (row != null) await db.markLastUsed(row.id);
    ref.invalidate(trustedServersProvider);

    // 4) بدء الخدمة الخلفية (Foreground Service + socket.io دائم + إعادة اتصال)
    state = AsyncData(ConnectionStateModel(
      phase: ConnectPhase.startingService,
      endpoint: endpoint, serverName: serverName, me: me, rttMs: rtt,
    ));
    try {
      await ref.read(agentChannelProvider).start(
            endpoint: endpoint,
            bridgePort: NexusPorts.guard,
            deviceId: me.id,
            deviceName: me.name,
          );
      log.add('الخدمة الخلفية تعمل — قناة دائمة مع جسر الحماية (${NexusPorts.guard})', kind: 'ok');
    } catch (e) {
      log.add('$e', kind: 'warn');
      // البيئة الحالية بلا أندرويد — القناة التفاعلية تعمل من الواجهة كبديل
    }

    // 5) الدخول في وضع الاتصال — استطلاع الأجهزة يتم عبر devicesProvider
    state = AsyncData(ConnectionStateModel(
      phase: ConnectPhase.online,
      endpoint: endpoint, serverName: serverName, me: me, rttMs: rtt,
    ));
  }

  Future<void> disconnect({bool forgetRow = false}) async {
    final log = ref.read(activityLogProvider.notifier);
    await ref.read(agentChannelProvider).stop();
    final cur = state.value;
    final db = ref.read(nexusDbProvider);
    if (forgetRow && cur?.endpoint != null) {
      final row = await db.byKey(cur!.endpoint!.key);
      if (row != null) await db.forget(row.id);
      ref.invalidate(trustedServersProvider);
    } else {
      await db.clearLastUsed();
    }
    ref.read(agentStateProvider.notifier).state = AgentLinkState.stopped;
    log.add('تم قطع الاتصال${forgetRow ? ' ونسيان الخادم' : ''}', kind: 'warn');
    state = const AsyncData(ConnectionStateModel());
  }

  /// التبديل إلى خادم موثوق محفوظ.
  Future<void> switchTo(TrustedServer row) async {
    final db = ref.read(nexusDbProvider);
    await db.markLastUsed(row.id);
    ref.invalidate(trustedServersProvider);
    await connect(
      endpoint: ServerEndpoint(
        host: row.host,
        port: row.port,
        mode: row.mode == 'direct' ? AccessMode.direct : AccessMode.gateway,
      ),
      serverName: row.name,
    );
  }

  /// FA-power (عقد §12) — إعادة محاولة الاتصال بنفس الخادم الأخير.
  /// تُستدعى بعد إرسال حزمة الإيقاظ: فحص صحة سريع (السيرفر استيقظ؟) ثم
  /// اتصال كامل مع الاقتران idempotent. يعيد true عند نجاح الصحة والاتصال.
  Future<bool> reconnect() async {
    final cur = state.value;
    final ep = cur?.endpoint;
    if (ep == null || cur == null) return false;
    final log = ref.read(activityLogProvider.notifier);
    try {
      await NexusApi(ep).healthCheck();
      log.add('السيرفر استجاب بعد الإيقاظ — جارٍ إعادة الاتصال…', kind: 'ok');
    } catch (_) {
      return false;
    }
    try {
      await connect(endpoint: ep, serverName: cur.serverName ?? 'Nexus PC');
      return true;
    } catch (_) {
      return false;
    }
  }
}

final connectionProvider = AsyncNotifierProvider<ConnectionController, ConnectionStateModel>(
  ConnectionController.new,
);

/// حالة الوكيل الخلفي (من EventChannel) — مؤشر الحالة في الواجهة.
final agentStateProvider = StateProvider<AgentLinkState>((ref) => AgentLinkState.stopped);

final agentChannelProvider = Provider<AgentChannel>((ref) {
  final ch = AgentChannel();
  ref.onDispose(() => ch.stop());
  return ch;
});

// ---------------------------------------------------------------------------
// قائمة الأجهزة الحية من السيرفر (بولينغ كل 4 ثوانٍ طالما أنا متصل)
// ---------------------------------------------------------------------------

final devicesProvider = StreamProvider<List<NexusDevice>>((ref) {
  final conn = ref.watch(connectionProvider).value;
  final ep = conn?.endpoint;
  if (ep == null || conn?.phase != ConnectPhase.online) {
    return Stream.value(const <NexusDevice>[]);
  }
  final api = NexusApi(ep);
  late StreamController<List<NexusDevice>> ctrl;
  Timer? timer;

  Future<void> tick() async {
    try {
      final list = await api.devices();
      if (!ctrl.isClosed) ctrl.add(list);
    } catch (_) {/* الدورة التالية تحاول من جديد */}
  }

  ctrl = StreamController<List<NexusDevice>>(
    onListen: () {
      tick();
      timer = Timer.periodic(const Duration(seconds: 4), (_) => tick());
    },
    onCancel: () => timer?.cancel(),
  );

  ref.onDispose(() {
    timer?.cancel();
    ctrl.close();
    api.close();
  });
  return ctrl.stream;
});
