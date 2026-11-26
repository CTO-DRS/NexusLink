import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:font_awesome_flutter/font_awesome_flutter.dart';

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
                onTap: () => ref.read(nativeBridgeProvider).openUrl(l.$4),
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
                  textDirection: TextDirection.ltr,
                  style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: Colors.white)),
              const SizedBox(height: 2),
              Text('settings.developerLine'.tr(),
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontSize: 13, color: Color(0xFFA5B4FC))),
              const SizedBox(height: 14),
              ...rows,
              const SizedBox(height: 10),
              const Text('NexusLink • v0.1.0',
                  textDirection: TextDirection.ltr,
                  style: TextStyle(fontSize: 11, color: Color(0xFF64748B))),
            ],
          ),
        ),
      ],
    );
  }
}
