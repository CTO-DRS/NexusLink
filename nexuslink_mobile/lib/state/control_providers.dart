import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/native_bridge.dart';
import 'providers.dart';
import 'transfer_providers.dart';

// ---------------------------------------------------------------------------
// FA-7 — حالة التحكم عن بعد (بديل AirMirror) في تطبيق الهاتف.
//
// الأحداث (kind == 'ctl') تصل عبر قناة EventChannel الوحيدة — يعيد توجيهها
// مستمع rawEvents القائم في SignalingController (قناة واحدة لا تحتمل أكثر من
// مستمع Dart واحد)، وهنا تُجمع في حالة واجهة واحدة:
//   · state        — جلسة نشطة أم لا + من يتحكم (البند 6: مؤشر الحالة)
//   · pending      — طلب بدء ينتظر قرار المستخدم (البند 7: طلب تأكيد)
//   · requireConfirm — إعداد طلب التأكيد (يُحفظ داخل الخدمة الأصلية)
// ---------------------------------------------------------------------------

/// طلب بدء جلسة تحكم ينتظر قرار المستخدم.
class CtlStartRequest {
  final String controller;
  final String name;
  final DateTime at;
  const CtlStartRequest({required this.controller, required this.name, required this.at});
}

/// حالة التحكم الكاملة للواجهة.
class CtlStateModel {
  final CtlSession session;
  final CtlStartRequest? pending;

  const CtlStateModel({this.session = const CtlSession(), this.pending});

  bool get isActive => session.active;

  CtlStateModel copyWith({CtlSession? session, CtlStartRequest? pending, bool clearPending = false}) =>
      CtlStateModel(
        session: session ?? this.session,
        pending: clearPending ? null : (pending ?? this.pending),
      );
}

class ControlController extends Notifier<CtlStateModel> {
  bool _disposed = false;
  bool _booted = false;

  @override
  CtlStateModel build() {
    ref.onDispose(() {
      _disposed = true;
    });
    // مزامنة أولية من الخدمة الأصلية (بعد إعادة فتح الواجهة)
    if (!_booted) {
      _booted = true;
      () async {
        final snap = await ref.read(nativeBridgeProvider).ctlSnapshot();
        if (_disposed) return;
        state = state.copyWith(
          session: snap,
          pending: snap.active
              ? null
              : (state.pending == null
                  ? null
                  : CtlStartRequest(
                      controller: state.pending!.controller,
                      name: state.pending!.name,
                      at: state.pending!.at,
                    )),
        );
      }();
    }
    return const CtlStateModel();
  }

  /// استقبال حدث ctl من القناة الأصلية (يستدعيه مستمع rawEvents المركزي).
  void ingest(Map<String, dynamic> d) {
    final event = '${d['event'] ?? ''}';
    switch (event) {
      case 'start-request':
        state = state.copyWith(
          pending: CtlStartRequest(
            controller: '${d['controller'] ?? ''}',
            name: '${d['name'] ?? 'الكمبيوتر'}',
            at: DateTime.now(),
          ),
        );
      case 'state':
        final active = d['active'] == true;
        final controller = '${d['controller'] ?? ''}';
        final name = '${d['name'] ?? ''}';
        state = state.copyWith(
          session: CtlSession(
            active: active,
            controller: active ? controller : '',
            name: active ? (name.isEmpty ? 'الكمبيوتر' : name) : '',
            requireConfirm: state.session.requireConfirm,
          ),
          clearPending: true,
        );
        ref.read(activityLogProvider.notifier).add(
              active
                  ? 'بدأ التحكم عن بعد من ${name.isEmpty ? controller : name} — يمكنك القطع فورًا من هنا'
                  : 'انتهت جلسة التحكم عن بعد (${d['reason'] ?? ' stopped'})',
              kind: active ? 'warn' : 'info',
            );
    }
  }

  /// قرار المستخدم على طلب البدء (البند 7).
  Future<void> decide(bool allow) async {
    final pending = state.pending;
    state = state.copyWith(clearPending: true);
    await ref.read(nativeBridgeProvider).ctlDecision(allow);
    if (!allow && pending != null) {
      ref.read(activityLogProvider.notifier).add(
            'رُفض طلب التحكم من ${pending.name}',
            kind: 'info',
          );
    }
  }

  /// زر القطع الفوري (البند 6).
  Future<void> stopNow() async {
    await ref.read(nativeBridgeProvider).ctlStop();
  }

  /// إعداد طلب التأكيد عند بدء الجلسة (البند 7).
  Future<void> setRequireConfirm(bool enabled) async {
    state = state.copyWith(
      session: CtlSession(
        active: state.session.active,
        controller: state.session.controller,
        name: state.session.name,
        requireConfirm: enabled,
      ),
    );
    await ref.read(nativeBridgeProvider).setCtlConfirm(enabled);
  }
}

final controlControllerProvider =
    NotifierProvider<ControlController, CtlStateModel>(ControlController.new);

/// حالة خدمة الإتاحة (البند 5 — شاشة الإرشاد).
class AccessibilityController extends AsyncNotifier<CtlAccessibility> {
  @override
  Future<CtlAccessibility> build() async {
    return ref.read(nativeBridgeProvider).accessibilityStatus();
  }

  Future<void> refresh() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(
      () => ref.read(nativeBridgeProvider).accessibilityStatus(),
    );
  }
}

final accessibilityProvider =
    AsyncNotifierProvider<AccessibilityController, CtlAccessibility>(
  AccessibilityController.new,
);
