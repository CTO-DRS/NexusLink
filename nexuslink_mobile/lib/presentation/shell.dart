import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'connect_screen.dart';
import 'devices_screen.dart';
import 'log_screen.dart';
import 'settings_screen.dart';

/// الهيكل الرئيسي: BottomNavigationBar بديل الـ Dock في نسخة الويب.
class NexusShell extends StatefulWidget {
  const NexusShell({super.key});

  @override
  State<NexusShell> createState() => _NexusShellState();
}

class _NexusShellState extends State<NexusShell> {
  int _tab = 0;

  static const List<String> _keys = ['nav.connect', 'nav.devices', 'nav.log', 'nav.settings'];

  @override
  Widget build(BuildContext context) {
    final pages = const [
      ConnectScreen(),
      DevicesScreen(),
      LogScreen(),
      SettingsScreen(),
    ];
    return Scaffold(
      body: IndexedStack(index: _tab, children: pages),
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: _tab,
        onTap: (i) => setState(() => _tab = i),
        items: [
          for (final k in _keys)
            BottomNavigationBarItem(
              icon: Icon(_iconFor(k, selected: false)),
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
        'nav.log' => selected ? Icons.receipt_long_rounded : Icons.receipt_long_outlined,
        _ => selected ? Icons.settings_rounded : Icons.settings_outlined,
      };
}
