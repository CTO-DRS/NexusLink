// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'nexus_db.dart';

// ignore_for_file: type=lint
class $TrustedServersTable extends TrustedServers
    with TableInfo<$TrustedServersTable, TrustedServer> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $TrustedServersTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<int> id = GeneratedColumn<int>(
      'id', aliasedName, false,
      hasAutoIncrement: true,
      type: DriftSqlType.int,
      requiredDuringInsert: false,
      defaultConstraints:
          GeneratedColumn.constraintIsAlways('PRIMARY KEY AUTOINCREMENT'));
  static const VerificationMeta _serverKeyMeta =
      const VerificationMeta('serverKey');
  @override
  late final GeneratedColumn<String> serverKey = GeneratedColumn<String>(
      'server_key', aliasedName, false,
      type: DriftSqlType.string,
      requiredDuringInsert: true,
      defaultConstraints: GeneratedColumn.constraintIsAlways('UNIQUE'));
  static const VerificationMeta _nameMeta = const VerificationMeta('name');
  @override
  late final GeneratedColumn<String> name = GeneratedColumn<String>(
      'name', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _hostMeta = const VerificationMeta('host');
  @override
  late final GeneratedColumn<String> host = GeneratedColumn<String>(
      'host', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _portMeta = const VerificationMeta('port');
  @override
  late final GeneratedColumn<int> port = GeneratedColumn<int>(
      'port', aliasedName, false,
      type: DriftSqlType.int, requiredDuringInsert: true);
  static const VerificationMeta _modeMeta = const VerificationMeta('mode');
  @override
  late final GeneratedColumn<String> mode = GeneratedColumn<String>(
      'mode', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _deviceIdMeta =
      const VerificationMeta('deviceId');
  @override
  late final GeneratedColumn<String> deviceId = GeneratedColumn<String>(
      'device_id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _deviceNameMeta =
      const VerificationMeta('deviceName');
  @override
  late final GeneratedColumn<String> deviceName = GeneratedColumn<String>(
      'device_name', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _pairingSecretMeta =
      const VerificationMeta('pairingSecret');
  @override
  late final GeneratedColumn<String> pairingSecret = GeneratedColumn<String>(
      'pairing_secret', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _pairedAtMeta =
      const VerificationMeta('pairedAt');
  @override
  late final GeneratedColumn<DateTime> pairedAt = GeneratedColumn<DateTime>(
      'paired_at', aliasedName, false,
      type: DriftSqlType.dateTime, requiredDuringInsert: true);
  static const VerificationMeta _lastUsedAtMeta =
      const VerificationMeta('lastUsedAt');
  @override
  late final GeneratedColumn<DateTime> lastUsedAt = GeneratedColumn<DateTime>(
      'last_used_at', aliasedName, false,
      type: DriftSqlType.dateTime, requiredDuringInsert: true);
  static const VerificationMeta _isLastUsedMeta =
      const VerificationMeta('isLastUsed');
  @override
  late final GeneratedColumn<bool> isLastUsed = GeneratedColumn<bool>(
      'is_last_used', aliasedName, false,
      type: DriftSqlType.bool,
      requiredDuringInsert: false,
      defaultConstraints: GeneratedColumn.constraintIsAlways(
          'CHECK ("is_last_used" IN (0, 1))'),
      defaultValue: const Constant(false));
  @override
  List<GeneratedColumn> get $columns => [
        id,
        serverKey,
        name,
        host,
        port,
        mode,
        deviceId,
        deviceName,
        pairingSecret,
        pairedAt,
        lastUsedAt,
        isLastUsed
      ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'trusted_servers';
  @override
  VerificationContext validateIntegrity(Insertable<TrustedServer> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    }
    if (data.containsKey('server_key')) {
      context.handle(_serverKeyMeta,
          serverKey.isAcceptableOrUnknown(data['server_key']!, _serverKeyMeta));
    } else if (isInserting) {
      context.missing(_serverKeyMeta);
    }
    if (data.containsKey('name')) {
      context.handle(
          _nameMeta, name.isAcceptableOrUnknown(data['name']!, _nameMeta));
    } else if (isInserting) {
      context.missing(_nameMeta);
    }
    if (data.containsKey('host')) {
      context.handle(
          _hostMeta, host.isAcceptableOrUnknown(data['host']!, _hostMeta));
    } else if (isInserting) {
      context.missing(_hostMeta);
    }
    if (data.containsKey('port')) {
      context.handle(
          _portMeta, port.isAcceptableOrUnknown(data['port']!, _portMeta));
    } else if (isInserting) {
      context.missing(_portMeta);
    }
    if (data.containsKey('mode')) {
      context.handle(
          _modeMeta, mode.isAcceptableOrUnknown(data['mode']!, _modeMeta));
    } else if (isInserting) {
      context.missing(_modeMeta);
    }
    if (data.containsKey('device_id')) {
      context.handle(_deviceIdMeta,
          deviceId.isAcceptableOrUnknown(data['device_id']!, _deviceIdMeta));
    } else if (isInserting) {
      context.missing(_deviceIdMeta);
    }
    if (data.containsKey('device_name')) {
      context.handle(
          _deviceNameMeta,
          deviceName.isAcceptableOrUnknown(
              data['device_name']!, _deviceNameMeta));
    } else if (isInserting) {
      context.missing(_deviceNameMeta);
    }
    if (data.containsKey('pairing_secret')) {
      context.handle(
          _pairingSecretMeta,
          pairingSecret.isAcceptableOrUnknown(
              data['pairing_secret']!, _pairingSecretMeta));
    }
    if (data.containsKey('paired_at')) {
      context.handle(_pairedAtMeta,
          pairedAt.isAcceptableOrUnknown(data['paired_at']!, _pairedAtMeta));
    } else if (isInserting) {
      context.missing(_pairedAtMeta);
    }
    if (data.containsKey('last_used_at')) {
      context.handle(
          _lastUsedAtMeta,
          lastUsedAt.isAcceptableOrUnknown(
              data['last_used_at']!, _lastUsedAtMeta));
    } else if (isInserting) {
      context.missing(_lastUsedAtMeta);
    }
    if (data.containsKey('is_last_used')) {
      context.handle(
          _isLastUsedMeta,
          isLastUsed.isAcceptableOrUnknown(
              data['is_last_used']!, _isLastUsedMeta));
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  TrustedServer map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return TrustedServer(
      id: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}id'])!,
      serverKey: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}server_key'])!,
      name: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}name'])!,
      host: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}host'])!,
      port: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}port'])!,
      mode: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}mode'])!,
      deviceId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}device_id'])!,
      deviceName: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}device_name'])!,
      pairingSecret: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}pairing_secret']),
      pairedAt: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}paired_at'])!,
      lastUsedAt: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}last_used_at'])!,
      isLastUsed: attachedDatabase.typeMapping
          .read(DriftSqlType.bool, data['${effectivePrefix}is_last_used'])!,
    );
  }

  @override
  $TrustedServersTable createAlias(String alias) {
    return $TrustedServersTable(attachedDatabase, alias);
  }
}

class TrustedServer extends DataClass implements Insertable<TrustedServer> {
  final int id;

  /// مفتاح فريد: "host:port"
  final String serverKey;

  /// اسم السيرفر المعروض (من QR أو mDNS أو يدوي)
  final String name;
  final String host;

  /// منفذ الوصول (بوابة 81 أو REST 3000)
  final int port;

  /// gateway | direct
  final String mode;

  /// معرّفنا لدى السيرفر (ناتج الاقتران — NexusDevice.id)
  final String deviceId;

  /// اسم جهازنا كما سجّلناه
  final String deviceName;

  /// سر الاقتران الأخير (للعرض فقط؛ السيرفر يولّد سرًا جديدًا لكل QR)
  final String? pairingSecret;
  final DateTime pairedAt;
  final DateTime lastUsedAt;
  final bool isLastUsed;
  const TrustedServer(
      {required this.id,
      required this.serverKey,
      required this.name,
      required this.host,
      required this.port,
      required this.mode,
      required this.deviceId,
      required this.deviceName,
      this.pairingSecret,
      required this.pairedAt,
      required this.lastUsedAt,
      required this.isLastUsed});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<int>(id);
    map['server_key'] = Variable<String>(serverKey);
    map['name'] = Variable<String>(name);
    map['host'] = Variable<String>(host);
    map['port'] = Variable<int>(port);
    map['mode'] = Variable<String>(mode);
    map['device_id'] = Variable<String>(deviceId);
    map['device_name'] = Variable<String>(deviceName);
    if (!nullToAbsent || pairingSecret != null) {
      map['pairing_secret'] = Variable<String>(pairingSecret);
    }
    map['paired_at'] = Variable<DateTime>(pairedAt);
    map['last_used_at'] = Variable<DateTime>(lastUsedAt);
    map['is_last_used'] = Variable<bool>(isLastUsed);
    return map;
  }

  TrustedServersCompanion toCompanion(bool nullToAbsent) {
    return TrustedServersCompanion(
      id: Value(id),
      serverKey: Value(serverKey),
      name: Value(name),
      host: Value(host),
      port: Value(port),
      mode: Value(mode),
      deviceId: Value(deviceId),
      deviceName: Value(deviceName),
      pairingSecret: pairingSecret == null && nullToAbsent
          ? const Value.absent()
          : Value(pairingSecret),
      pairedAt: Value(pairedAt),
      lastUsedAt: Value(lastUsedAt),
      isLastUsed: Value(isLastUsed),
    );
  }

  factory TrustedServer.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return TrustedServer(
      id: serializer.fromJson<int>(json['id']),
      serverKey: serializer.fromJson<String>(json['serverKey']),
      name: serializer.fromJson<String>(json['name']),
      host: serializer.fromJson<String>(json['host']),
      port: serializer.fromJson<int>(json['port']),
      mode: serializer.fromJson<String>(json['mode']),
      deviceId: serializer.fromJson<String>(json['deviceId']),
      deviceName: serializer.fromJson<String>(json['deviceName']),
      pairingSecret: serializer.fromJson<String?>(json['pairingSecret']),
      pairedAt: serializer.fromJson<DateTime>(json['pairedAt']),
      lastUsedAt: serializer.fromJson<DateTime>(json['lastUsedAt']),
      isLastUsed: serializer.fromJson<bool>(json['isLastUsed']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<int>(id),
      'serverKey': serializer.toJson<String>(serverKey),
      'name': serializer.toJson<String>(name),
      'host': serializer.toJson<String>(host),
      'port': serializer.toJson<int>(port),
      'mode': serializer.toJson<String>(mode),
      'deviceId': serializer.toJson<String>(deviceId),
      'deviceName': serializer.toJson<String>(deviceName),
      'pairingSecret': serializer.toJson<String?>(pairingSecret),
      'pairedAt': serializer.toJson<DateTime>(pairedAt),
      'lastUsedAt': serializer.toJson<DateTime>(lastUsedAt),
      'isLastUsed': serializer.toJson<bool>(isLastUsed),
    };
  }

  TrustedServer copyWith(
          {int? id,
          String? serverKey,
          String? name,
          String? host,
          int? port,
          String? mode,
          String? deviceId,
          String? deviceName,
          Value<String?> pairingSecret = const Value.absent(),
          DateTime? pairedAt,
          DateTime? lastUsedAt,
          bool? isLastUsed}) =>
      TrustedServer(
        id: id ?? this.id,
        serverKey: serverKey ?? this.serverKey,
        name: name ?? this.name,
        host: host ?? this.host,
        port: port ?? this.port,
        mode: mode ?? this.mode,
        deviceId: deviceId ?? this.deviceId,
        deviceName: deviceName ?? this.deviceName,
        pairingSecret:
            pairingSecret.present ? pairingSecret.value : this.pairingSecret,
        pairedAt: pairedAt ?? this.pairedAt,
        lastUsedAt: lastUsedAt ?? this.lastUsedAt,
        isLastUsed: isLastUsed ?? this.isLastUsed,
      );
  TrustedServer copyWithCompanion(TrustedServersCompanion data) {
    return TrustedServer(
      id: data.id.present ? data.id.value : this.id,
      serverKey: data.serverKey.present ? data.serverKey.value : this.serverKey,
      name: data.name.present ? data.name.value : this.name,
      host: data.host.present ? data.host.value : this.host,
      port: data.port.present ? data.port.value : this.port,
      mode: data.mode.present ? data.mode.value : this.mode,
      deviceId: data.deviceId.present ? data.deviceId.value : this.deviceId,
      deviceName:
          data.deviceName.present ? data.deviceName.value : this.deviceName,
      pairingSecret: data.pairingSecret.present
          ? data.pairingSecret.value
          : this.pairingSecret,
      pairedAt: data.pairedAt.present ? data.pairedAt.value : this.pairedAt,
      lastUsedAt:
          data.lastUsedAt.present ? data.lastUsedAt.value : this.lastUsedAt,
      isLastUsed:
          data.isLastUsed.present ? data.isLastUsed.value : this.isLastUsed,
    );
  }

  @override
  String toString() {
    return (StringBuffer('TrustedServer(')
          ..write('id: $id, ')
          ..write('serverKey: $serverKey, ')
          ..write('name: $name, ')
          ..write('host: $host, ')
          ..write('port: $port, ')
          ..write('mode: $mode, ')
          ..write('deviceId: $deviceId, ')
          ..write('deviceName: $deviceName, ')
          ..write('pairingSecret: $pairingSecret, ')
          ..write('pairedAt: $pairedAt, ')
          ..write('lastUsedAt: $lastUsedAt, ')
          ..write('isLastUsed: $isLastUsed')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(id, serverKey, name, host, port, mode,
      deviceId, deviceName, pairingSecret, pairedAt, lastUsedAt, isLastUsed);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is TrustedServer &&
          other.id == this.id &&
          other.serverKey == this.serverKey &&
          other.name == this.name &&
          other.host == this.host &&
          other.port == this.port &&
          other.mode == this.mode &&
          other.deviceId == this.deviceId &&
          other.deviceName == this.deviceName &&
          other.pairingSecret == this.pairingSecret &&
          other.pairedAt == this.pairedAt &&
          other.lastUsedAt == this.lastUsedAt &&
          other.isLastUsed == this.isLastUsed);
}

class TrustedServersCompanion extends UpdateCompanion<TrustedServer> {
  final Value<int> id;
  final Value<String> serverKey;
  final Value<String> name;
  final Value<String> host;
  final Value<int> port;
  final Value<String> mode;
  final Value<String> deviceId;
  final Value<String> deviceName;
  final Value<String?> pairingSecret;
  final Value<DateTime> pairedAt;
  final Value<DateTime> lastUsedAt;
  final Value<bool> isLastUsed;
  const TrustedServersCompanion({
    this.id = const Value.absent(),
    this.serverKey = const Value.absent(),
    this.name = const Value.absent(),
    this.host = const Value.absent(),
    this.port = const Value.absent(),
    this.mode = const Value.absent(),
    this.deviceId = const Value.absent(),
    this.deviceName = const Value.absent(),
    this.pairingSecret = const Value.absent(),
    this.pairedAt = const Value.absent(),
    this.lastUsedAt = const Value.absent(),
    this.isLastUsed = const Value.absent(),
  });
  TrustedServersCompanion.insert({
    this.id = const Value.absent(),
    required String serverKey,
    required String name,
    required String host,
    required int port,
    required String mode,
    required String deviceId,
    required String deviceName,
    this.pairingSecret = const Value.absent(),
    required DateTime pairedAt,
    required DateTime lastUsedAt,
    this.isLastUsed = const Value.absent(),
  })  : serverKey = Value(serverKey),
        name = Value(name),
        host = Value(host),
        port = Value(port),
        mode = Value(mode),
        deviceId = Value(deviceId),
        deviceName = Value(deviceName),
        pairedAt = Value(pairedAt),
        lastUsedAt = Value(lastUsedAt);
  static Insertable<TrustedServer> custom({
    Expression<int>? id,
    Expression<String>? serverKey,
    Expression<String>? name,
    Expression<String>? host,
    Expression<int>? port,
    Expression<String>? mode,
    Expression<String>? deviceId,
    Expression<String>? deviceName,
    Expression<String>? pairingSecret,
    Expression<DateTime>? pairedAt,
    Expression<DateTime>? lastUsedAt,
    Expression<bool>? isLastUsed,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (serverKey != null) 'server_key': serverKey,
      if (name != null) 'name': name,
      if (host != null) 'host': host,
      if (port != null) 'port': port,
      if (mode != null) 'mode': mode,
      if (deviceId != null) 'device_id': deviceId,
      if (deviceName != null) 'device_name': deviceName,
      if (pairingSecret != null) 'pairing_secret': pairingSecret,
      if (pairedAt != null) 'paired_at': pairedAt,
      if (lastUsedAt != null) 'last_used_at': lastUsedAt,
      if (isLastUsed != null) 'is_last_used': isLastUsed,
    });
  }

  TrustedServersCompanion copyWith(
      {Value<int>? id,
      Value<String>? serverKey,
      Value<String>? name,
      Value<String>? host,
      Value<int>? port,
      Value<String>? mode,
      Value<String>? deviceId,
      Value<String>? deviceName,
      Value<String?>? pairingSecret,
      Value<DateTime>? pairedAt,
      Value<DateTime>? lastUsedAt,
      Value<bool>? isLastUsed}) {
    return TrustedServersCompanion(
      id: id ?? this.id,
      serverKey: serverKey ?? this.serverKey,
      name: name ?? this.name,
      host: host ?? this.host,
      port: port ?? this.port,
      mode: mode ?? this.mode,
      deviceId: deviceId ?? this.deviceId,
      deviceName: deviceName ?? this.deviceName,
      pairingSecret: pairingSecret ?? this.pairingSecret,
      pairedAt: pairedAt ?? this.pairedAt,
      lastUsedAt: lastUsedAt ?? this.lastUsedAt,
      isLastUsed: isLastUsed ?? this.isLastUsed,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<int>(id.value);
    }
    if (serverKey.present) {
      map['server_key'] = Variable<String>(serverKey.value);
    }
    if (name.present) {
      map['name'] = Variable<String>(name.value);
    }
    if (host.present) {
      map['host'] = Variable<String>(host.value);
    }
    if (port.present) {
      map['port'] = Variable<int>(port.value);
    }
    if (mode.present) {
      map['mode'] = Variable<String>(mode.value);
    }
    if (deviceId.present) {
      map['device_id'] = Variable<String>(deviceId.value);
    }
    if (deviceName.present) {
      map['device_name'] = Variable<String>(deviceName.value);
    }
    if (pairingSecret.present) {
      map['pairing_secret'] = Variable<String>(pairingSecret.value);
    }
    if (pairedAt.present) {
      map['paired_at'] = Variable<DateTime>(pairedAt.value);
    }
    if (lastUsedAt.present) {
      map['last_used_at'] = Variable<DateTime>(lastUsedAt.value);
    }
    if (isLastUsed.present) {
      map['is_last_used'] = Variable<bool>(isLastUsed.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('TrustedServersCompanion(')
          ..write('id: $id, ')
          ..write('serverKey: $serverKey, ')
          ..write('name: $name, ')
          ..write('host: $host, ')
          ..write('port: $port, ')
          ..write('mode: $mode, ')
          ..write('deviceId: $deviceId, ')
          ..write('deviceName: $deviceName, ')
          ..write('pairingSecret: $pairingSecret, ')
          ..write('pairedAt: $pairedAt, ')
          ..write('lastUsedAt: $lastUsedAt, ')
          ..write('isLastUsed: $isLastUsed')
          ..write(')'))
        .toString();
  }
}

abstract class _$NexusDatabase extends GeneratedDatabase {
  _$NexusDatabase(QueryExecutor e) : super(e);
  $NexusDatabaseManager get managers => $NexusDatabaseManager(this);
  late final $TrustedServersTable trustedServers = $TrustedServersTable(this);
  @override
  Iterable<TableInfo<Table, Object?>> get allTables =>
      allSchemaEntities.whereType<TableInfo<Table, Object?>>();
  @override
  List<DatabaseSchemaEntity> get allSchemaEntities => [trustedServers];
}

typedef $$TrustedServersTableCreateCompanionBuilder = TrustedServersCompanion
    Function({
  Value<int> id,
  required String serverKey,
  required String name,
  required String host,
  required int port,
  required String mode,
  required String deviceId,
  required String deviceName,
  Value<String?> pairingSecret,
  required DateTime pairedAt,
  required DateTime lastUsedAt,
  Value<bool> isLastUsed,
});
typedef $$TrustedServersTableUpdateCompanionBuilder = TrustedServersCompanion
    Function({
  Value<int> id,
  Value<String> serverKey,
  Value<String> name,
  Value<String> host,
  Value<int> port,
  Value<String> mode,
  Value<String> deviceId,
  Value<String> deviceName,
  Value<String?> pairingSecret,
  Value<DateTime> pairedAt,
  Value<DateTime> lastUsedAt,
  Value<bool> isLastUsed,
});

class $$TrustedServersTableFilterComposer
    extends Composer<_$NexusDatabase, $TrustedServersTable> {
  $$TrustedServersTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<int> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get serverKey => $composableBuilder(
      column: $table.serverKey, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get name => $composableBuilder(
      column: $table.name, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get host => $composableBuilder(
      column: $table.host, builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get port => $composableBuilder(
      column: $table.port, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get mode => $composableBuilder(
      column: $table.mode, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get deviceId => $composableBuilder(
      column: $table.deviceId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get deviceName => $composableBuilder(
      column: $table.deviceName, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get pairingSecret => $composableBuilder(
      column: $table.pairingSecret, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get pairedAt => $composableBuilder(
      column: $table.pairedAt, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get lastUsedAt => $composableBuilder(
      column: $table.lastUsedAt, builder: (column) => ColumnFilters(column));

  ColumnFilters<bool> get isLastUsed => $composableBuilder(
      column: $table.isLastUsed, builder: (column) => ColumnFilters(column));
}

class $$TrustedServersTableOrderingComposer
    extends Composer<_$NexusDatabase, $TrustedServersTable> {
  $$TrustedServersTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<int> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get serverKey => $composableBuilder(
      column: $table.serverKey, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get name => $composableBuilder(
      column: $table.name, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get host => $composableBuilder(
      column: $table.host, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get port => $composableBuilder(
      column: $table.port, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get mode => $composableBuilder(
      column: $table.mode, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get deviceId => $composableBuilder(
      column: $table.deviceId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get deviceName => $composableBuilder(
      column: $table.deviceName, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get pairingSecret => $composableBuilder(
      column: $table.pairingSecret,
      builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get pairedAt => $composableBuilder(
      column: $table.pairedAt, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get lastUsedAt => $composableBuilder(
      column: $table.lastUsedAt, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<bool> get isLastUsed => $composableBuilder(
      column: $table.isLastUsed, builder: (column) => ColumnOrderings(column));
}

class $$TrustedServersTableAnnotationComposer
    extends Composer<_$NexusDatabase, $TrustedServersTable> {
  $$TrustedServersTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<int> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get serverKey =>
      $composableBuilder(column: $table.serverKey, builder: (column) => column);

  GeneratedColumn<String> get name =>
      $composableBuilder(column: $table.name, builder: (column) => column);

  GeneratedColumn<String> get host =>
      $composableBuilder(column: $table.host, builder: (column) => column);

  GeneratedColumn<int> get port =>
      $composableBuilder(column: $table.port, builder: (column) => column);

  GeneratedColumn<String> get mode =>
      $composableBuilder(column: $table.mode, builder: (column) => column);

  GeneratedColumn<String> get deviceId =>
      $composableBuilder(column: $table.deviceId, builder: (column) => column);

  GeneratedColumn<String> get deviceName => $composableBuilder(
      column: $table.deviceName, builder: (column) => column);

  GeneratedColumn<String> get pairingSecret => $composableBuilder(
      column: $table.pairingSecret, builder: (column) => column);

  GeneratedColumn<DateTime> get pairedAt =>
      $composableBuilder(column: $table.pairedAt, builder: (column) => column);

  GeneratedColumn<DateTime> get lastUsedAt => $composableBuilder(
      column: $table.lastUsedAt, builder: (column) => column);

  GeneratedColumn<bool> get isLastUsed => $composableBuilder(
      column: $table.isLastUsed, builder: (column) => column);
}

class $$TrustedServersTableTableManager extends RootTableManager<
    _$NexusDatabase,
    $TrustedServersTable,
    TrustedServer,
    $$TrustedServersTableFilterComposer,
    $$TrustedServersTableOrderingComposer,
    $$TrustedServersTableAnnotationComposer,
    $$TrustedServersTableCreateCompanionBuilder,
    $$TrustedServersTableUpdateCompanionBuilder,
    (
      TrustedServer,
      BaseReferences<_$NexusDatabase, $TrustedServersTable, TrustedServer>
    ),
    TrustedServer,
    PrefetchHooks Function()> {
  $$TrustedServersTableTableManager(
      _$NexusDatabase db, $TrustedServersTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$TrustedServersTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$TrustedServersTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$TrustedServersTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback: ({
            Value<int> id = const Value.absent(),
            Value<String> serverKey = const Value.absent(),
            Value<String> name = const Value.absent(),
            Value<String> host = const Value.absent(),
            Value<int> port = const Value.absent(),
            Value<String> mode = const Value.absent(),
            Value<String> deviceId = const Value.absent(),
            Value<String> deviceName = const Value.absent(),
            Value<String?> pairingSecret = const Value.absent(),
            Value<DateTime> pairedAt = const Value.absent(),
            Value<DateTime> lastUsedAt = const Value.absent(),
            Value<bool> isLastUsed = const Value.absent(),
          }) =>
              TrustedServersCompanion(
            id: id,
            serverKey: serverKey,
            name: name,
            host: host,
            port: port,
            mode: mode,
            deviceId: deviceId,
            deviceName: deviceName,
            pairingSecret: pairingSecret,
            pairedAt: pairedAt,
            lastUsedAt: lastUsedAt,
            isLastUsed: isLastUsed,
          ),
          createCompanionCallback: ({
            Value<int> id = const Value.absent(),
            required String serverKey,
            required String name,
            required String host,
            required int port,
            required String mode,
            required String deviceId,
            required String deviceName,
            Value<String?> pairingSecret = const Value.absent(),
            required DateTime pairedAt,
            required DateTime lastUsedAt,
            Value<bool> isLastUsed = const Value.absent(),
          }) =>
              TrustedServersCompanion.insert(
            id: id,
            serverKey: serverKey,
            name: name,
            host: host,
            port: port,
            mode: mode,
            deviceId: deviceId,
            deviceName: deviceName,
            pairingSecret: pairingSecret,
            pairedAt: pairedAt,
            lastUsedAt: lastUsedAt,
            isLastUsed: isLastUsed,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ));
}

typedef $$TrustedServersTableProcessedTableManager = ProcessedTableManager<
    _$NexusDatabase,
    $TrustedServersTable,
    TrustedServer,
    $$TrustedServersTableFilterComposer,
    $$TrustedServersTableOrderingComposer,
    $$TrustedServersTableAnnotationComposer,
    $$TrustedServersTableCreateCompanionBuilder,
    $$TrustedServersTableUpdateCompanionBuilder,
    (
      TrustedServer,
      BaseReferences<_$NexusDatabase, $TrustedServersTable, TrustedServer>
    ),
    TrustedServer,
    PrefetchHooks Function()>;

class $NexusDatabaseManager {
  final _$NexusDatabase _db;
  $NexusDatabaseManager(this._db);
  $$TrustedServersTableTableManager get trustedServers =>
      $$TrustedServersTableTableManager(_db, _db.trustedServers);
}
