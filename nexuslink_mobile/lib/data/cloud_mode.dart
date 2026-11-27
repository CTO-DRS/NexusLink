import 'dart:convert';
import 'dart:math';

import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

/// الوضع السحابي (اختياري، مُعطَّل افتراضيًا). لا يُرسَل أي طلب شبكة ما لم يفعّله المستخدم ويوافق على الإفصاح.
const kCloudEndpoint = 'https://nexuslink-cloud.nexus-link.workers.dev';
const _kPrefs = 'nexus.cloud.v1';

class CloudState {
  final bool enabled;
  final int? acceptedAt;
  final String handle;
  final String token; // يُولَّد هنا ويبقى على هذا الجهاز فقط
  final bool capture;
  final String? publishedUrl;
  const CloudState({this.enabled = false, this.acceptedAt, this.handle = '', this.token = '', this.capture = false, this.publishedUrl});

  CloudState copy({bool? enabled, int? acceptedAt, String? handle, String? token, bool? capture, String? publishedUrl, bool clearUrl = false}) => CloudState(
        enabled: enabled ?? this.enabled,
        acceptedAt: acceptedAt ?? this.acceptedAt,
        handle: handle ?? this.handle,
        token: token ?? this.token,
        capture: capture ?? this.capture,
        publishedUrl: clearUrl ? null : (publishedUrl ?? this.publishedUrl),
      );

  Map<String, dynamic> toJson() => {'enabled': enabled, 'acceptedAt': acceptedAt, 'handle': handle, 'token': token, 'capture': capture, 'publishedUrl': publishedUrl};

  static CloudState fromJson(Map<String, dynamic> j) => CloudState(
        enabled: j['enabled'] == true,
        acceptedAt: j['acceptedAt'] as int?,
        handle: (j['handle'] as String?) ?? '',
        token: (j['token'] as String?) ?? '',
        capture: j['capture'] == true,
        publishedUrl: j['publishedUrl'] as String?,
      );
}

class CloudStats {
  final int views;
  final int clicks;
  final List<(String, int)> sources;
  final List<(String, int)> countries;
  final int? peakHour;
  const CloudStats(this.views, this.clicks, this.sources, this.countries, this.peakHour);
}

class CloudException implements Exception {
  final int status;
  final String code;
  const CloudException(this.status, this.code);
  @override
  String toString() => 'CloudException($status,$code)';
}

final _handleRe = RegExp(r'^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$');
bool cloudHandleOk(String h) => _handleRe.hasMatch(h);

String newCloudToken() {
  final r = Random.secure();
  return List.generate(32, (_) => r.nextInt(256).toRadixString(16).padLeft(2, '0')).join();
}

Future<CloudState> loadCloud() async {
  try {
    final p = await SharedPreferences.getInstance();
    final s = p.getString(_kPrefs);
    if (s == null) return const CloudState();
    return CloudState.fromJson(jsonDecode(s) as Map<String, dynamic>);
  } catch (_) {
    return const CloudState();
  }
}

Future<void> saveCloud(CloudState s) async {
  final p = await SharedPreferences.getInstance();
  await p.setString(_kPrefs, jsonEncode(s.toJson()));
}

void _gate(CloudState s) {
  if (!s.enabled || s.acceptedAt == null) throw StateError('cloud_disabled'); // لا طلب بلا موافقة
}

Map<String, String> _auth(CloudState s, [bool json = false]) => {
      'authorization': 'Bearer ${s.token}',
      if (json) 'content-type': 'application/json',
    };

Future<String> cloudPublish(CloudState s, Map<String, dynamic> page) async {
  _gate(s);
  final r = await http
      .put(Uri.parse('$kCloudEndpoint/api/pages'), headers: _auth(s, true), body: jsonEncode({'handle': s.handle, 'page': page}))
      .timeout(const Duration(seconds: 15));
  if (r.statusCode != 200) throw CloudException(r.statusCode, r.body);
  return (jsonDecode(r.body) as Map<String, dynamic>)['url'] as String;
}

Future<void> cloudDelete(CloudState s) async {
  _gate(s);
  final r = await http.delete(Uri.parse('$kCloudEndpoint/api/pages?handle=${s.handle}'), headers: _auth(s)).timeout(const Duration(seconds: 15));
  if (r.statusCode != 200) throw CloudException(r.statusCode, r.body);
}

Future<CloudStats> cloudStats(CloudState s, {int days = 30}) async {
  _gate(s);
  final r = await http.get(Uri.parse('$kCloudEndpoint/api/stats?handle=${s.handle}&days=$days'), headers: _auth(s)).timeout(const Duration(seconds: 15));
  if (r.statusCode != 200) throw CloudException(r.statusCode, r.body);
  final j = jsonDecode(r.body) as Map<String, dynamic>;
  List<(String, int)> pairs(String key, String name) =>
      ((j[key] as List?) ?? const []).map((e) => ((e as Map)[name].toString(), (e['n'] as num).toInt())).toList();
  final hours = ((j['hours'] as List?) ?? const []).map((e) => ((e as Map)['hour'] as num).toInt() * 100000 + (e['n'] as num).toInt()).toList();
  int? peak;
  if (hours.isNotEmpty) {
    var best = hours.first;
    for (final h in hours) {
      if (h % 100000 > best % 100000) best = h;
    }
    peak = best ~/ 100000;
  }
  return CloudStats((j['views'] as num).toInt(), (j['clicks'] as num).toInt(), pairs('sources', 'source'), pairs('countries', 'country'), peak);
}

Future<String> cloudLeadsCsv(CloudState s) async {
  _gate(s);
  final r = await http.get(Uri.parse('$kCloudEndpoint/api/leads.csv?handle=${s.handle}'), headers: _auth(s)).timeout(const Duration(seconds: 15));
  if (r.statusCode != 200) throw CloudException(r.statusCode, r.body);
  return utf8.decode(r.bodyBytes);
}

Future<String> cloudPhotoDataUrl() async {
  final data = await rootBundle.load('assets/developer/cto-drs.jpg');
  return 'data:image/jpeg;base64,${base64Encode(data.buffer.asUint8List())}';
}
