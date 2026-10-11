import 'dart:async';
import '../state/providers.dart' show agentChannelProvider;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:local_auth/local_auth.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../data/agent_channel.dart';

// ============================================================================
// FA-10 — مزودات الأمان: قفل التطبيق (PIN/بصمة) + قناة الأمان + لوحة الأذونات
// + وضع الفقدان + المسح الآمن + الإقلاع التلقائي.
// ============================================================================

/// تكوين قفل التطبيق — يُحفظ محليًا وتُنقل قيمته إلى الخدمة (sec:lock-state).
class LockConfig {
  final bool enabled; // القفل مفعّل أصلًا؟
  final bool hasPin;
  final bool hasBiometric;
  final int autoLockSec; // مهلة الخلفية قبل القفل (0 = فوري)

  const LockConfig({
    this.enabled = false,
    this.hasPin = false,
    this.hasBiometric = false,
    this.autoLockSec = 60,
  });

  LockConfig copyWith({bool? enabled, bool? hasPin, bool? hasBiometric, int? autoLockSec}) => LockConfig(
        enabled: enabled ?? this.enabled,
        hasPin: hasPin ?? this.hasPin,
        hasBiometric: hasBiometric ?? this.hasBiometric,
        autoLockSec: autoLockSec ?? this.autoLockSec,
      );
}

class LockConfigController extends StateNotifier<LockConfig> {
  LockConfigController(this._native) : super(const LockConfig()) {
    _load();
  }

  final AgentChannel _native;

  static const _prefsKey = 'nexus.sec.lock';

  Future<void> _load() async {
    try {
      final p = await SharedPreferences.getInstance();
      final raw = p.getString(_prefsKey);
      if (raw != null && raw.isNotEmpty) {
        final j = raw.split('|');
        if (j.length >= 4) {
          state = LockConfig(
            enabled: j[0] == '1',
            hasPin: j[1] == '1',
            hasBiometric: j[2] == '1',
            autoLockSec: int.tryParse(j[3]) ?? 60,
          );
        }
      }
    } catch (_) {}
    await _push();
  }

  Future<void> _push() async {
    await _native.setLockConfig(
      hasPin: state.hasPin,
      hasBiometric: state.hasBiometric,
      autoLockSec: state.autoLockSec,
    );
  }

  Future<void> save(LockConfig next) async {
    state = next;
    try {
      final p = await SharedPreferences.getInstance();
      await p.setString(_prefsKey, [
        next.enabled ? '1' : '0',
        next.hasPin ? '1' : '0',
        next.hasBiometric ? '1' : '0',
        '${next.autoLockSec}',
      ].join('|'));
    } catch (_) {}
    await _push();
  }
}

final lockConfigProvider =
    StateNotifierProvider<LockConfigController, LockConfig>((ref) => LockConfigController(ref.read(agentChannelProvider)));

/// لقطة قناة الأمان 3009 (من MethodChannel + أحداث kind:"sec").
class SecSnapshot {
  final bool online;
  final bool kexDone;
  final String sasEmoji;
  final String sasHex;
  final String fingerprint;
  final String peerId;
  final String peerName;
  final int epoch;
  final bool lost;
  final String lostMessage;
  final String suite;

  const SecSnapshot({
    this.online = false,
    this.kexDone = false,
    this.sasEmoji = '',
    this.sasHex = '',
    this.fingerprint = '',
    this.peerId = '',
    this.peerName = '',
    this.epoch = 0,
    this.lost = false,
    this.lostMessage = '',
    this.suite = '',
  });

  static SecSnapshot fromMap(Map<Object?, Object?> m) => SecSnapshot(
        online: m['online'] == true,
        kexDone: m['kexDone'] == true,
        sasEmoji: '${m['sasEmoji'] ?? ''}',
        sasHex: '${m['sasHex'] ?? ''}',
        fingerprint: '${m['fingerprint'] ?? ''}',
        peerId: '${m['peerId'] ?? ''}',
        peerName: '${m['peerName'] ?? ''}',
        epoch: (m['epoch'] as num?)?.toInt() ?? 0,
        lost: m['lost'] == true,
        lostMessage: '${m['lostMessage'] ?? ''}',
        suite: '${m['suite'] ?? ''}',
      );
}

class SecStateController extends StateNotifier<SecSnapshot> {
  SecStateController(this._native) : super(const SecSnapshot()) {
    _init();
  }

  final AgentChannel _native;

  Future<void> _init() async {
    final snap = await _native.secSnapshot();
    if (snap.isNotEmpty) state = SecSnapshot.fromMap(snap.cast<Object?, Object?>());
  }

  void ingest(Map<Object?, Object?> detail) {
    state = SecSnapshot.fromMap(detail);
  }
}

final secStateProvider =
    StateNotifierProvider<SecStateController, SecSnapshot>((ref) => SecStateController(ref.read(agentChannelProvider)));

/// وضع الفقدان الحي (من أحداث kind:"lost" — Kotlin LostMode).
class LostState {
  final bool active;
  final String message;
  const LostState({this.active = false, this.message = ''});
}

class LostController extends StateNotifier<LostState> {
  LostController(this._native) : super(const LostState());

  final AgentChannel _native;

  void ingest(Map<Object?, Object?> detail) {
    state = LostState(
      active: detail['active'] == true,
      message: '${detail['message'] ?? ''}',
    );
  }

  Future<void> stop() async {
    await _native.lostStop();
    state = const LostState();
  }
}

final lostProvider = StateNotifierProvider<LostController, LostState>((ref) => LostController(ref.read(agentChannelProvider)));

/// حالة المسح الآمن الحي.
class WipeState {
  final int done;
  final int total;
  final String file;
  final int passes;
  final bool running;
  final bool? ok;
  final int count;
  final int bytes;
  final String error;

  const WipeState({
    this.done = 0,
    this.total = 0,
    this.file = '',
    this.passes = 3,
    this.running = false,
    this.ok,
    this.count = 0,
    this.bytes = 0,
    this.error = '',
  });

  WipeState copyWith({int? done, int? total, String? file, int? passes, bool? running, bool? ok, int? count, int? bytes, String? error}) =>
      WipeState(
        done: done ?? this.done,
        total: total ?? this.total,
        file: file ?? this.file,
        passes: passes ?? this.passes,
        running: running ?? this.running,
        ok: ok ?? this.ok,
        count: count ?? this.count,
        bytes: bytes ?? this.bytes,
        error: error ?? this.error,
      );
}

class WipeController extends StateNotifier<WipeState> {
  WipeController(this._native) : super(const WipeState());

  final AgentChannel _native;

  void ingest(Map<Object?, Object?> detail) {
    final event = '${detail['event'] ?? ''}';
    if (event == 'progress') {
      state = state.copyWith(
        running: true,
        done: (detail['done'] as num?)?.toInt() ?? 0,
        total: (detail['total'] as num?)?.toInt() ?? 0,
        file: '${detail['file'] ?? ''}',
        passes: (detail['passes'] as num?)?.toInt() ?? 3,
        ok: null,
      );
    } else if (event == 'done') {
      state = state.copyWith(
        running: false,
        ok: detail['ok'] == true,
        count: (detail['count'] as num?)?.toInt() ?? state.count,
        bytes: (detail['bytes'] as num?)?.toInt() ?? state.bytes,
        error: '${detail['error'] ?? ''}',
      );
    }
  }

  Future<void> run(int passes) async {
    state = WipeState(running: true, passes: passes);
    await _native.secWipe(passes);
  }
}

final wipeProvider = StateNotifierProvider<WipeController, WipeState>((ref) => WipeController(ref.read(agentChannelProvider)));

/// لوحة الأذونات: مفتاح لكل ميزة (عقد §4.6) — يُحفظ محليًا وتقرأه بوابة أوامر Kotlin.
class SecFeaturesController extends StateNotifier<Map<String, bool>> {
  SecFeaturesController(this._ref) : super(const {}) {
    _load();
  }

  final Ref _ref;
  static const _prefsKey = 'nexus.sec.features';

  Future<void> _load() async {
    try {
      final p = await SharedPreferences.getInstance();
      final raw = p.getString(_prefsKey);
      if (raw != null && raw.isNotEmpty) {
        final map = <String, bool>{};
        for (final pair in raw.split(',')) {
          final kv = pair.split('=');
          if (kv.length == 2) map[kv[0]] = kv[1] == '1';
        }
        state = map;
      }
    } catch (_) {}
  }

  bool isEnabled(String feature) => state[feature] ?? true;

  Future<void> set(String feature, bool enabled) async {
    state = {...state, feature: enabled};
    try {
      final p = await SharedPreferences.getInstance();
      await p.setString(_prefsKey, state.entries.map((e) => '${e.key}=${e.value ? '1' : '0'}').join(','));
    } catch (_) {}
    // عبر الخدمة: تُسجَّل في تفضيلات بوابة الأوامر (القراءة في SecChannel.featureEnabled)
    try {
      await _ref.read(agentChannelProvider).setSecFeature(feature, enabled);
    } catch (_) {}
  }
}

final secFeaturesProvider = StateNotifierProvider<SecFeaturesController, Map<String, bool>>((ref) {
  return SecFeaturesController(ref);
});

/// الإقلاع التلقائي مع النظام.
class AutoStartController extends StateNotifier<bool> {
  AutoStartController(this._native) : super(true) {
    _load();
  }

  final AgentChannel _native;
  static const _prefsKey = 'nexus.sec.autoStart';

  Future<void> _load() async {
    try {
      final p = await SharedPreferences.getInstance();
      state = p.getBool(_prefsKey) ?? true;
    } catch (_) {}
  }

  Future<void> set(bool on) async {
    state = on;
    try {
      final p = await SharedPreferences.getInstance();
      await p.setBool(_prefsKey, on);
    } catch (_) {}
    await _native.setAutoStart(on);
  }
}

final autoStartProvider =
    StateNotifierProvider<AutoStartController, bool>((ref) => AutoStartController(ref.read(agentChannelProvider)));

// ============================================================================
// قفل التطبيق — PIN عبر PBKDF2 (Kotlin) + بصمة/وجه عبر local_auth + قفل خلفية
// ============================================================================

class AppLockController extends StateNotifier<bool> {
  AppLockController(this._native, this._ref) : super(false) {
    _init();
  }

  final AgentChannel _native;
  final Ref _ref;
  final LocalAuthentication _bio = LocalAuthentication();
  DateTime _pausedAt = DateTime.now();

  /// هل الجهاز يدعم البصمة/وجه؟
  Future<bool> canBiometric() async {
    try {
      final ok = await _bio.canCheckBiometrics || await _bio.isDeviceSupported();
      return ok;
    } catch (_) {
      return false;
    }
  }

  Future<void> _init() async {
    // استعادة الحالة المقفولة من الخدمة (أمر كمبيوتر والواجهة ميتة)
    try {
      final p = await SharedPreferences.getInstance();
      if (p.getBool('nexus.sec.lockedNow') == true) {
        state = true;
      }
    } catch (_) {}
  }

  /// قفل الآن (زر يدوي أو مهلة الخلفية).
  Future<void> lockNow({String reason = 'manual'}) async {
    final cfg = _ref.read(lockConfigProvider);
    if (!cfg.enabled) return;
    state = true;
    try {
      final p = await SharedPreferences.getInstance();
      await p.setBool('nexus.sec.lockedNow', true);
    } catch (_) {}
    await _native.setLocked(true);
    if (reason != 'manual') await _native.secLockNow();
  }

  /// دورة الحياة: اتصل عند paused/hidden/detached.
  void markPaused() {
    _pausedAt = DateTime.now();
    final cfg = _ref.read(lockConfigProvider);
    if (cfg.enabled && cfg.autoLockSec == 0) {
      // قفل فوري عند مغادرة التطبيق
      lockNow(reason: 'auto-immediate');
    }
  }

  /// دورة الحياة: اتصل عند resumed — يقفل إن تجاوزت المهلة.
  Future<void> markResumed() async {
    final cfg = _ref.read(lockConfigProvider);
    if (!cfg.enabled || state) return;
    final away = DateTime.now().difference(_pausedAt).inSeconds;
    if (away >= cfg.autoLockSec) {
      await lockNow(reason: 'auto-timeout');
    }
  }

  /// التحقق من PIN (مخزن PBKDF2 في prefs عبر Kotlin).
  Future<bool> verifyPin(String pin) async {
    try {
      final p = await SharedPreferences.getInstance();
      final stored = p.getString('nexus.sec.pin');
      if (stored == null || !stored.contains(':')) return false;
      final parts = stored.split(':'); // salt:hash
      final ok = await _native.pbkdf2Verify(pin, parts[0], parts[1]);
      if (ok) await _completeUnlock();
      return ok;
    } catch (_) {
      return false;
    }
  }

  /// بصمة/وجه.
  Future<bool> verifyBiometric() async {
    try {
      final ok = await _bio.authenticate(
        localizedReason: 'افتح NexusLink',
        options: const AuthenticationOptions(biometricOnly: true, stickyAuth: true),
      );
      if (ok) await _completeUnlock();
      return ok;
    } catch (_) {
      return false;
    }
  }

  Future<void> _completeUnlock() async {
    state = false;
    try {
      final p = await SharedPreferences.getInstance();
      await p.setBool('nexus.sec.lockedNow', false);
    } catch (_) {}
    await _native.setLocked(false);
    await _native.secUnlock();
  }

  /// حفظ PIN جديد (hash عبر Kotlin — مطابق صيغة الويب).
  Future<bool> setPin(String pin) async {
    try {
      final r = await _native.pbkdf2Hash(pin);
      final salt = '${r['salt'] ?? ''}';
      final hash = '${r['hash'] ?? ''}';
      if (salt.isEmpty || hash.isEmpty) return false;
      final p = await SharedPreferences.getInstance();
      await p.setString('nexus.sec.pin', '$salt:$hash');
      final cfg = _ref.read(lockConfigProvider);
      await _ref.read(lockConfigProvider.notifier).save(cfg.copyWith(hasPin: true, enabled: true));
      return true;
    } catch (_) {
      return false;
    }
  }

  Future<void> clearPin() async {
    try {
      final p = await SharedPreferences.getInstance();
      await p.remove('nexus.sec.pin');
    } catch (_) {}
    final cfg = _ref.read(lockConfigProvider);
    await _ref.read(lockConfigProvider.notifier).save(cfg.copyWith(hasPin: false));
  }

  Future<void> setBiometricEnabled(bool on) async {
    final cfg = _ref.read(lockConfigProvider);
    await _ref.read(lockConfigProvider.notifier).save(cfg.copyWith(hasBiometric: on, enabled: on || cfg.enabled || cfg.hasPin));
  }
}

final appLockProvider = StateNotifierProvider<AppLockController, bool>((ref) {
  return AppLockController(ref.read(agentChannelProvider), ref);
});

/// Onboarding أول تشغيل.
final onboardingDoneProvider = StateProvider<bool>((ref) => true); // يُحمَّل في app.dart من prefs
