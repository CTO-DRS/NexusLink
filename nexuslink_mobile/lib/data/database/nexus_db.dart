import 'dart:io';

import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

part 'nexus_db.g.dart';

/// الخوادم الموثوقة المحفوظة محليًا (SQLite عبر drift) — البند 7 من المهمة.
class TrustedServers extends Table {
  IntColumn get id => integer().autoIncrement()();

  /// مفتاح فريد: "host:port"
  TextColumn get serverKey => text().unique()();

  /// اسم السيرفر المعروض (من QR أو mDNS أو يدوي)
  TextColumn get name => text()();

  TextColumn get host => text()();

  /// منفذ الوصول (بوابة 81 أو REST 3000)
  IntColumn get port => integer()();

  /// gateway | direct
  TextColumn get mode => text()();

  /// معرّفنا لدى السيرفر (ناتج الاقتران — NexusDevice.id)
  TextColumn get deviceId => text()();

  /// اسم جهازنا كما سجّلناه
  TextColumn get deviceName => text()();

  /// سر الاقتران الأخير (للعرض فقط؛ السيرفر يولّد سرًا جديدًا لكل QR)
  TextColumn get pairingSecret => text().nullable()();

  DateTimeColumn get pairedAt => dateTime()();
  DateTimeColumn get lastUsedAt => dateTime()();
  BoolColumn get isLastUsed => boolean().withDefault(const Constant(false))();
}

@DriftDatabase(tables: [TrustedServers])
class NexusDatabase extends _$NexusDatabase {
  NexusDatabase() : super(_openConnection());

  @override
  int get schemaVersion => 1;

  /// بث قائمة الخوادم (الأحدث استخدامًا أولًا) — للتبديل الحي بينها.
  Stream<List<TrustedServer>> watchAll() {
    return (select(trustedServers)
          ..orderBy([(t) => OrderingTerm.desc(t.lastUsedAt)]))
        .watch();
  }

  Future<List<TrustedServer>> all() => select(trustedServers).get();

  Future<TrustedServer?> lastUsed() =>
      (select(trustedServers)..where((t) => t.isLastUsed)).getSingleOrNull();

  Future<TrustedServer?> byKey(String key) =>
      (select(trustedServers)..where((t) => t.serverKey.equals(key))).getSingleOrNull();

  /// إدراج أو تحديث (idempotent لكل "host:port").
  Future<void> upsert(TrustedServersCompanion entry) async {
    await into(trustedServers).insertOnConflictUpdate(entry);
  }

  /// تعليم خادم كآخر استخدام (يسوّي البقية).
  Future<void> markLastUsed(int id) async {
    await transaction(() async {
      await (update(trustedServers)..where((t) => t.isLastUsed))
          .write(const TrustedServersCompanion(isLastUsed: Value(false)));
      await (update(trustedServers)..where((t) => t.id.equals(id))).write(
        TrustedServersCompanion(
          isLastUsed: const Value(true),
          lastUsedAt: Value(DateTime.now()),
        ),
      );
    });
  }

  Future<void> forget(int id) =>
      (delete(trustedServers)..where((t) => t.id.equals(id))).go();

  Future<void> clearLastUsed() =>
      (update(trustedServers)..where((t) => t.isLastUsed))
          .write(const TrustedServersCompanion(isLastUsed: Value(false)));
}

LazyDatabase _openConnection() {
  return LazyDatabase(() async {
    final dir = await getApplicationDocumentsDirectory();
    final file = File(p.join(dir.path, 'nexuslink.db'));
    return NativeDatabase.createInBackground(file);
  });
}
