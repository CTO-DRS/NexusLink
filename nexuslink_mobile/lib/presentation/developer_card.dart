import 'dart:ui' as ui;

import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:font_awesome_flutter/font_awesome_flutter.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../state/transfer_providers.dart';

/// بطاقة «عن المطوّر» — زجاج داكن، حلقة تدرّج حول الصورة، شارة توثيق، شبكة 4×2 بألوان العلامات.
/// الروابط تُفتح بنقرة المستخدم فقط عبر الجسر الأصلي (openUrl)، بلا أي طلب خلفي.
class DeveloperCard extends ConsumerWidget {
  const DeveloperCard({super.key});

  static const _links = <(String, IconData, Color, String)>[
    ('settings.dev_wa', FontAwesomeIcons.whatsapp, Color(0xFF25D366), 'https://wa.me/message/MVTVWPOPFOVFF1'),
    ('settings.dev_tg', FontAwesomeIcons.telegram, Color(0xFF229ED9), 'https://t.me/CTO_DRS'),
    ('settings.dev_tt', FontAwesomeIcons.tiktok, Color(0xFF111111), 'https://www.tiktok.com/@cto.drs'),
    ('settings.dev_ig', FontAwesomeIcons.instagram, Color(0xFFE1306C), 'https://www.instagram.com/cto.drs'),
    ('settings.dev_x', FontAwesomeIcons.xTwitter, Color(0xFF000000), 'https://x.com/cto_drs'),
    ('settings.dev_yt', FontAwesomeIcons.youtube, Color(0xFFFF0000), 'https://youtube.com/@cto-drs'),
    ('settings.dev_gh', FontAwesomeIcons.github, Color(0xFF24292F), 'https://github.com/CTO-DRS'),
    ('settings.dev_web', FontAwesomeIcons.globe, Color(0xFF4F46E5), 'https://cto-drs.com'),
  ];

  void _viewPhoto(BuildContext context) {
    showDialog<void>(
      context: context,
      barrierColor: Colors.black87,
      builder: (ctx) => GestureDetector(
        onTap: () => Navigator.of(ctx).pop(),
        child: Center(
          child: InteractiveViewer(
            child: ClipRRect(
              borderRadius: BorderRadius.circular(20),
              child: Image.asset('assets/developer/cto-drs.jpg'),
            ),
          ),
        ),
      ),
    );
  }

  /// ورقة زجاجية: QR مُولَّد على الجهاز + «فتح» و«نسخ الرابط».
  void _showQr(BuildContext context, WidgetRef ref, (String, IconData, Color, String) l) {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: Colors.transparent,
      barrierColor: Colors.black54,
      isScrollControlled: true,
      builder: (ctx) => ClipRRect(
        borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
        child: BackdropFilter(
          filter: ui.ImageFilter.blur(sigmaX: 24, sigmaY: 24),
          child: Container(
            padding: EdgeInsets.fromLTRB(20, 14, 20, 20 + MediaQuery.of(ctx).viewPadding.bottom),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [Color(0xD9181A3E), Color(0xE60B0C24)],
              ),
              border: Border.all(color: const Color(0x668E5BD0)),
              borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(color: const Color(0x40FFFFFF), borderRadius: BorderRadius.circular(2)),
                ),
                const SizedBox(height: 16),
                Container(
                  width: 48,
                  height: 48,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: l.$3,
                    border: Border.all(color: const Color(0x40FFFFFF)),
                  ),
                  child: FaIcon(l.$2, size: 24, color: Colors.white),
                ),
                const SizedBox(height: 8),
                Text(l.$1.tr(),
                    style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: Colors.white)),
                const SizedBox(height: 14),
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(18)),
                  child: QrImageView(
                    data: l.$4,
                    size: 200,
                    backgroundColor: Colors.white,
                    eyeStyle: const QrEyeStyle(eyeShape: QrEyeShape.square, color: Colors.black),
                    dataModuleStyle: const QrDataModuleStyle(dataModuleShape: QrDataModuleShape.square, color: Colors.black),
                  ),
                ),
                const SizedBox(height: 12),
                Text('settings.dev_scan'.tr(),
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontSize: 12, color: Color(0xFFCBD5E1))),
                const SizedBox(height: 4),
                Text(l.$4,
                    textDirection: ui.TextDirection.ltr,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 11, color: Color(0xFF64748B))),
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: FilledButton.icon(
                        style: FilledButton.styleFrom(
                          backgroundColor: const Color(0xFF6D3FC9),
                          minimumSize: const Size.fromHeight(46),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                        ),
                        onPressed: () {
                          final bridge = ref.read(nativeBridgeProvider);
                          Navigator.of(ctx).pop();
                          bridge.openUrl(l.$4);
                        },
                        icon: const Icon(Icons.open_in_new, size: 18),
                        label: Text('settings.dev_open'.tr()),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: OutlinedButton.icon(
                        style: OutlinedButton.styleFrom(
                          foregroundColor: Colors.white,
                          minimumSize: const Size.fromHeight(46),
                          side: const BorderSide(color: Color(0x40FFFFFF)),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                        ),
                        onPressed: () async {
                          final messenger = ScaffoldMessenger.of(context);
                          final msg = 'settings.dev_copied'.tr();
                          await Clipboard.setData(ClipboardData(text: l.$4));
                          if (ctx.mounted) Navigator.of(ctx).pop();
                          messenger.showSnackBar(SnackBar(content: Text(msg), duration: const Duration(seconds: 2)));
                        },
                        icon: const Icon(Icons.copy_rounded, size: 18),
                        label: Text('settings.dev_copy'.tr()),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final cs = Theme.of(context).colorScheme;
    final rows = <Widget>[];
    for (var i = 0; i < _links.length; i += 4) {
      rows.add(Row(
        children: [
          for (final l in _links.skip(i).take(4))
            Expanded(
              child: InkWell(
                borderRadius: BorderRadius.circular(12),
                onTap: () => _showQr(context, ref, l),
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 6),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Container(
                        width: 46,
                        height: 46,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: l.$3,
                          border: Border.all(color: const Color(0x40FFFFFF)),
                        ),
                        child: FaIcon(l.$2, size: 22, color: Colors.white),
                      ),
                      const SizedBox(height: 6),
                      Text(l.$1.tr(),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 11, color: Color(0xFFCBD5E1))),
                    ],
                  ),
                ),
              ),
            ),
        ],
      ));
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(children: [
          Container(
            width: 4,
            height: 20,
            decoration: BoxDecoration(color: const Color(0xFF6D3FC9), borderRadius: BorderRadius.circular(2)),
          ),
          const SizedBox(width: 10),
          Text('settings.developer'.tr(),
              style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: cs.onSurface)),
          const SizedBox(width: 10),
          const Expanded(child: Divider(height: 1, thickness: 1, color: Color(0x40A78BFA))),
        ]),
        const SizedBox(height: 10),
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(24),
            gradient: const LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [Color(0xFF1B1C3A), Color(0xFF0B0C24)],
            ),
            border: Border.all(color: const Color(0x5C8E5BD0)),
          ),
          child: Column(
            children: [
              GestureDetector(
                onTap: () => _viewPhoto(context),
                child: SizedBox(
                  width: 96,
                  height: 96,
                  child: Stack(
                    clipBehavior: Clip.none,
                    children: [
                      Container(
                        padding: const EdgeInsets.all(3),
                        decoration: const BoxDecoration(
                          shape: BoxShape.circle,
                          gradient: LinearGradient(
                            begin: Alignment.topLeft,
                            end: Alignment.bottomRight,
                            colors: [Color(0xFF6366F1), Color(0xFF06B6D4), Color(0xFFA855F7)],
                          ),
                        ),
                        child: Container(
                          padding: const EdgeInsets.all(3),
                          decoration: const BoxDecoration(shape: BoxShape.circle, color: Color(0xFF161437)),
                          child: const CircleAvatar(
                            backgroundImage: AssetImage('assets/developer/cto-drs.jpg'),
                          ),
                        ),
                      ),
                      PositionedDirectional(
                        end: -2,
                        bottom: -2,
                        child: Container(
                          width: 26,
                          height: 26,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: const Color(0xFF1D9BF0),
                            border: Border.all(color: const Color(0xFF0B0C24), width: 2),
                          ),
                          child: const Icon(Icons.check, size: 16, color: Colors.white),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 12),
              const Text('CTO: DRS',
                  textDirection: ui.TextDirection.ltr,
                  style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: Colors.white)),
              const SizedBox(height: 2),
              Text('settings.developerLine'.tr(),
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontSize: 13, color: Color(0xFFA5B4FC))),
              const SizedBox(height: 14),
              ...rows,
              const SizedBox(height: 10),
              const Text('NexusLink • v0.1.0',
                  textDirection: ui.TextDirection.ltr,
                  style: TextStyle(fontSize: 11, color: Color(0xFF64748B))),
            ],
          ),
        ),
      ],
    );
  }
}
