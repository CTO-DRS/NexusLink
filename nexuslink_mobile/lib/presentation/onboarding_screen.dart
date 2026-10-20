import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../state/security_providers.dart' show onboardingDoneProvider;
import 'language_chips.dart';

/// Onboarding أول تشغيل (FA-10 البند 7) — 5 خطوات قصيرة:
/// ترحيب + لغة ← صلاحيات بطلبات حقيقية ← الاقتران ← جولة الميزات ← انطلاق.
/// نفس سلاسل قاموس الترجمة المستخدمة في Onboarding الويب (onb.*).
class OnboardingScreen extends ConsumerStatefulWidget {
  const OnboardingScreen({super.key});

  @override
  ConsumerState<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends ConsumerState<OnboardingScreen> {
  final _controller = PageController();
  int _page = 0;
  static const _pages = 5;

  // حالة الصلاحيات في الخطوة الثانية
  final Map<Permission, PermissionStatus> _permStatus = {};
  bool _permBusy = false;

  static const _permCards = <(Permission, String, String, IconData)>[
    (Permission.notification, 'onb.permNotif', 'onb.permNotifWhy', Icons.notifications_rounded),
    (Permission.locationWhenInUse, 'onb.permLocation', 'onb.permLocationWhy', Icons.location_on_rounded),
    (Permission.camera, 'onb.permCamera', 'onb.permCameraWhy', Icons.camera_alt_rounded),
    (Permission.microphone, 'onb.permMic', 'onb.permMicWhy', Icons.mic_rounded),
    (Permission.photos, 'onb.permPhotos', 'onb.permPhotosWhy', Icons.photo_rounded),
  ];

  @override
  void initState() {
    super.initState();
    _refreshPerms();
  }

  Future<void> _refreshPerms() async {
    for (final (p, _, _, _) in _permCards) {
      try {
        _permStatus[p] = await p.status;
      } catch (_) {}
    }
    if (mounted) setState(() {});
  }

  Future<void> _request(Permission p) async {
    if (_permBusy) return;
    _permBusy = true;
    try {
      _permStatus[p] = await p.request();
    } catch (_) {}
    _permBusy = false;
    if (mounted) setState(() {});
  }

  Future<void> _next() async {
    if (_page < _pages - 1) {
      await _controller.nextPage(duration: const Duration(milliseconds: 260), curve: Curves.easeOut);
    } else {
      await _finish();
    }
  }

  Future<void> _finish() async {
    try {
      final p = await SharedPreferences.getInstance();
      await p.setBool('nexus.onboarding.done', true);
    } catch (_) {}
    // تحديث المزود → بوابة _SecurityGate تعيد البناء إلى الواجهة الكاملة
    ref.read(onboardingDoneProvider.notifier).state = true;
  }

  void _prev() {
    if (_page > 0) {
      _controller.previousPage(duration: const Duration(milliseconds: 260), curve: Curves.easeOut);
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: PageView(
                controller: _controller,
                physics: const NeverScrollableScrollPhysics(),
                onPageChanged: (i) => setState(() => _page = i),
                children: [
                  _Welcome(onNext: _next),
                  _Permissions(onNext: _next, status: _permStatus, cards: _permCards, onRequest: _request, onRefresh: _refreshPerms),
                  _Pairing(onNext: _next),
                  _Tour(onNext: _next),
                  _Done(onNext: _next),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 4, 24, 18),
              child: Row(
                children: [
                  if (_page > 0)
                    TextButton(onPressed: _prev, child: Text('onb.back'.tr()))
                  else
                    TextButton(
                      onPressed: _finish,
                      child: Text('onb.skip'.tr(), style: TextStyle(color: Theme.of(context).hintColor)),
                    ),
                  const Spacer(),
                  Row(
                    children: [
                      for (var i = 0; i < _pages; i++)
                        Container(
                          width: i == _page ? 22 : 8,
                          height: 8,
                          margin: const EdgeInsets.symmetric(horizontal: 3),
                          decoration: BoxDecoration(
                            color: i == _page ? Theme.of(context).colorScheme.primary : Theme.of(context).dividerColor,
                            borderRadius: BorderRadius.circular(4),
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(width: 14),
                  FilledButton(
                    onPressed: _next,
                    child: Text(_page == _pages - 1 ? 'onb.start'.tr() : 'onb.next'.tr()),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// 0 — الترحيب + اللغة
// ---------------------------------------------------------------------------

class _Welcome extends ConsumerWidget {
  const _Welcome({required this.onNext});

  final VoidCallback onNext;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(32),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SizedBox(height: 30),
          Icon(Icons.lan_rounded, size: 90, color: Theme.of(context).colorScheme.primary),
          const SizedBox(height: 18),
          Text(
            'onb.welcome'.tr(),
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w900),
          ),
          const SizedBox(height: 10),
          Text(
            'onb.welcomeSub'.tr(),
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 15, color: Theme.of(context).hintColor, height: 1.6),
          ),
          const SizedBox(height: 30),
          Text('onb.language'.tr(), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
          const SizedBox(height: 10),
          // M1.4 (عقد §31.ب.5): اللغات الست في الترحيب
          LanguageChips(
            current: context.locale,
            onSelect: (locale) async {
              await context.setLocale(locale);
              try {
                final p = await SharedPreferences.getInstance();
                await p.setString('nexus.onboarding.lang', locale.languageCode);
              } catch (_) {}
            },
          ),
          const SizedBox(height: 14),
          Text(
            'onb.langHint'.tr(),
            style: TextStyle(fontSize: 11, color: Theme.of(context).hintColor),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// 1 — الصلاحيات (طلبات حقيقية — نفس بنود الويب)
// ---------------------------------------------------------------------------

class _Permissions extends StatelessWidget {
  const _Permissions({
    required this.onNext,
    required this.status,
    required this.cards,
    required this.onRequest,
    required this.onRefresh,
  });

  final Map<Permission, PermissionStatus> status;
  final List<(Permission, String, String, IconData)> cards;
  final void Function(Permission) onRequest;
  final VoidCallback onNext;
  final VoidCallback onRefresh;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(28),
      children: [
        Text('onb.permsTitle'.tr(), style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w900)),
        const SizedBox(height: 8),
        Text(
          'onb.permsSub'.tr(),
          style: TextStyle(fontSize: 13, color: Theme.of(context).hintColor, height: 1.6),
        ),
        const SizedBox(height: 18),
        for (final (perm, titleKey, whyKey, icon) in cards)
          _PermCard(
            icon: icon,
            title: titleKey.tr(),
            why: whyKey.tr(),
            granted: (status[perm] ?? PermissionStatus.denied).isGranted,
            permanentlyDenied: (status[perm] ?? PermissionStatus.denied).isPermanentlyDenied,
            onRequest: () => onRequest(perm),
          ),
        const SizedBox(height: 10),
        TextButton(onPressed: onRefresh, child: Text('onb.permsRefresh'.tr())),
      ],
    );
  }
}

class _PermCard extends StatelessWidget {
  const _PermCard({
    required this.icon,
    required this.title,
    required this.why,
    required this.granted,
    required this.permanentlyDenied,
    required this.onRequest,
  });

  final IconData icon;
  final String title;
  final String why;
  final bool granted;
  final bool permanentlyDenied;
  final VoidCallback onRequest;

  @override
  Widget build(BuildContext context) {
    final ok = granted;
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Theme.of(context).cardColor,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: ok ? Colors.green.withOpacity(.5) : Theme.of(context).dividerColor,
        ),
      ),
      child: Row(
        children: [
          Icon(icon, size: 24, color: ok ? Colors.green : Theme.of(context).hintColor),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5)),
                const SizedBox(height: 3),
                Text(why, style: TextStyle(fontSize: 11.5, color: Theme.of(context).hintColor, height: 1.4)),
              ],
            ),
          ),
          const SizedBox(width: 8),
          ok
              ? const Icon(Icons.check_circle_rounded, color: Colors.green, size: 22)
              : TextButton(
                  onPressed: onRequest,
                  child: Text(permanentlyDenied ? 'onb.openSettings'.tr() : 'onb.request'.tr()),
                ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// 2 — الاقتران
// ---------------------------------------------------------------------------

class _Pairing extends StatelessWidget {
  const _Pairing({required this.onNext});

  final VoidCallback onNext;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(32),
      children: [
        Icon(Icons.qr_code_scanner_rounded, size: 80, color: Theme.of(context).colorScheme.primary),
        const SizedBox(height: 16),
        Text('onb.pairTitle'.tr(), textAlign: TextAlign.center, style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w900)),
        const SizedBox(height: 10),
        Text(
          'onb.pairSub'.tr(),
          textAlign: TextAlign.center,
          style: TextStyle(fontSize: 14, color: Theme.of(context).hintColor, height: 1.7),
        ),
        const SizedBox(height: 22),
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: Theme.of(context).cardColor,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: Theme.of(context).dividerColor),
          ),
          child: Column(
            children: [
              for (var i = 0; i < 3; i++) ...[
                Row(
                  children: [
                    CircleAvatar(radius: 11, backgroundColor: Theme.of(context).colorScheme.primary.withOpacity(.15), child: Text('${i + 1}', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w800))),
                    const SizedBox(width: 10),
                    Expanded(child: Text('onb.pairStep${i + 1}'.tr(), style: const TextStyle(fontSize: 13))),
                  ],
                ),
                if (i < 2) const SizedBox(height: 10),
              ],
            ],
          ),
        ),
        const SizedBox(height: 14),
        Text('onb.pairLater'.tr(), textAlign: TextAlign.center, style: TextStyle(fontSize: 11.5, color: Theme.of(context).hintColor)),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// 3 — جولة الميزات (نفس وحدات الويب: labels + hints من القاموس)
// ---------------------------------------------------------------------------

class _Tour extends StatelessWidget {
  const _Tour({required this.onNext});

  final VoidCallback onNext;

  static const modules = <(String, IconData)>[
    ('devices', Icons.devices_rounded),
    ('files', Icons.folder_open_rounded),
    ('transfers', Icons.swap_vert_circle_rounded),
    ('comms', Icons.message_rounded),
    ('remote', Icons.mouse_rounded),
    ('media', Icons.videocam_rounded),
    ('guard', Icons.shield_rounded),
    ('prod', Icons.bolt_rounded),
    ('security', Icons.verified_user_rounded),
    ('tools', Icons.build_rounded),
    ('storage', Icons.storage_rounded),
    ('settings', Icons.settings_rounded),
  ];

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(28),
      children: [
        Text('onb.tourTitle'.tr(), style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w900)),
        const SizedBox(height: 6),
        Text('onb.tourSub'.tr(), style: TextStyle(fontSize: 13, color: Theme.of(context).hintColor)),
        const SizedBox(height: 16),
        for (final (id, icon) in modules)
          Container(
            margin: const EdgeInsets.only(bottom: 8),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            decoration: BoxDecoration(
              color: Theme.of(context).cardColor,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: Theme.of(context).dividerColor.withOpacity(.6)),
            ),
            child: Row(
              children: [
                Icon(icon, size: 20, color: Theme.of(context).colorScheme.primary),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('onb.module_$id'.tr(), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5)),
                      Text('onb.hint_$id'.tr(), style: TextStyle(fontSize: 10.5, color: Theme.of(context).hintColor)),
                    ],
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// 4 — الانطلاق
// ---------------------------------------------------------------------------

class _Done extends StatelessWidget {
  const _Done({required this.onNext});

  final VoidCallback onNext;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(36),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.celebration_rounded, size: 84, color: Colors.green),
            const SizedBox(height: 16),
            Text('onb.doneTitle'.tr(), textAlign: TextAlign.center, style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w900)),
            const SizedBox(height: 10),
            Text(
              'onb.doneSub'.tr(),
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 14, color: Theme.of(context).hintColor, height: 1.7),
            ),
            const SizedBox(height: 16),
            Text(
              'onb.doneHint'.tr(),
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 11.5, color: Theme.of(context).hintColor),
            ),
          ],
        ),
      ),
    );
  }
}
