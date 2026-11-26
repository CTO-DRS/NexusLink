import 'package:flutter/material.dart';

/// بيانات لافتات بطاقة المطوّر (دوّارة). لإعلان تطبيق جديد أو عرض: أضف عنصرًا هنا
/// وأضف مفاتيح النصوص الثلاثة إلى ملفات assets/translations — لا حاجة لأي تعديل آخر.
class DeveloperBanner {
  final String id;
  final String titleKey;
  final String bodyKey;
  final String ctaKey;
  final String url;
  final List<Color> colors;
  const DeveloperBanner({
    required this.id,
    required this.titleKey,
    required this.bodyKey,
    required this.ctaKey,
    required this.url,
    required this.colors,
  });
}

const kBannerInterval = Duration(milliseconds: 5500);
const kAppSiteUrl = 'https://cto-drs.github.io/NexusLink/';
const kReleasesApi = 'https://api.github.com/repos/CTO-DRS/NexusLink/releases/latest';
const kReleasesPage = 'https://github.com/CTO-DRS/NexusLink/releases/latest';

const kDeveloperBanners = <DeveloperBanner>[
  DeveloperBanner(
    id: 'nexuslink',
    titleKey: 'settings.dev_banner_app_title',
    bodyKey: 'settings.dev_banner_app_body',
    ctaKey: 'settings.dev_banner_app_cta',
    url: kAppSiteUrl,
    colors: [Color(0xFF4338CA), Color(0xFF6D3FC9), Color(0xFF0891B2)],
  ),
  DeveloperBanner(
    id: 'app-idea',
    titleKey: 'settings.dev_banner_idea_title',
    bodyKey: 'settings.dev_banner_idea_body',
    ctaKey: 'settings.dev_banner_idea_cta',
    url: 'https://wa.me/message/MVTVWPOPFOVFF1',
    colors: [Color(0xFF0F766E), Color(0xFF2563EB), Color(0xFF7C3AED)],
  ),
];
