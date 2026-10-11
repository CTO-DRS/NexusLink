import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'connect_screen.dart';
import 'controller_screen.dart';
import 'devices_screen.dart';
import 'log_screen.dart';
import 'media_screen.dart';
import 'security_screen.dart';
import 'settings_screen.dart';
import 'transfers_screen.dart';
import '../state/transfer_providers.dart';
import '../data/transfer_engine.dart';

/// الهيكل الرئيسي: BottomNavigationBar بديل الـ Dock في نسخة الويب.
/// ثمانية تبويبات: الاتصال، الأجهزة، الوسائط، التحكم، النقل، الأمان، السجل، الإعدادات.
/// تُفعِّل هذه الشاشة مزودات النقل (المحرك + الإشارة) بمراقبتها هنا.
class NexusShell extends ConsumerStatefulWidget {
  const NexusShell({super.key});

  @override
  ConsumerState<NexusShell> createState() => _NexusShellState();
}

class _NexusShellState extends ConsumerState<NexusShell> {
  int _tab = 0;

  static const List<String> _keys = [
    'nav.connect', 'nav.devices', 'nav.media', 'nav.control', 'nav.transfers', 'nav.security', 'nav.log', 'nav.settings',
  ];

  @override
  Widget build(BuildContext context) {
    // تفعيل دورة حياة النقل: محرك النقل + قنوات الإشارة الحية
    final engine = ref.watch(engineProvider);
    ref.watch(signalingProvider);
    final tasks = engine?.tasks ?? const <TransferTask>[];
    final pendingOffers = tasks
        .where((t) => !t.isUpload && t.state == TxState.queued && !t.autoAccepted)
        .length;

    const pages = [
      ConnectScreen(),
      DevicesScreen(),
      MediaScreen(),
      RcScreen(),
      TransfersScreen(),
      SecurityScreen(),
      LogScreen(),
      SettingsScreen(),
    ];
    return Scaffold(
      body: IndexedStack(index: _tab, children: pages),
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: _tab,
        type: BottomNavigationBarType.fixed,
        onTap: (i) => setState(() => _tab = i),
        items: [
          for (final k in _keys)
            BottomNavigationBarItem(
              icon: pendingOffers > 0 && k == 'nav.transfers'
                  ? Badge(
                      label: Text('$pendingOffers'),
                      child: Icon(_iconFor(k, selected: false)),
                    )
                  : Icon(_iconFor(k, selected: false)),
              activeIcon: Icon(_iconFor(k, selected: true)),
              label: k.tr(),
            ),
        ],
      ),
    );
  }

  IconData _iconFor(String key, {required bool selected}) => switch (key) {
        'nav.connect' => selected ? Icons.lan_rounded : Icons.lan_outlined,
        'nav.devices' => selected ? Icons.devices_rounded : Icons.devices_outlined,
        'nav.media' => selected ? Icons.surround_sound_rounded : Icons.surround_sound_outlined,
        'nav.control' => selected ? Icons.mouse_rounded : Icons.mouse_outlined,
        'nav.transfers' => selected ? Icons.swap_vert_circle_rounded : Icons.swap_vert_circle_outlined,
        'nav.security' => selected ? Icons.verified_user_rounded : Icons.verified_user_outlined,
        'nav.log' => selected ? Icons.receipt_long_rounded : Icons.receipt_long_outlined,
        _ => selected ? Icons.settings_rounded : Icons.settings_outlined,
      };
}
