# حزم MDM التعريفية — عقد §47 (`packaging/mdm/`)

> **قوالب تعريفية حصرًا** (declaration-only): تحوّل مفاتيح MDM إلى ملف السياسة
> `policy.json` **v2** نفسه الذي يقرؤه المحرك لحظيًا (`src/lib/enterprise-policy.ts`
> — `docs/enterprise-deploy.md` §16). لا كود ولا تنفيذ فيها، وبوابة
> `enterprise47-e2e.mjs` تفحص بنيتها فتمنع الانجراف. **لا اتصال بسحابة MDM
> في أي نقطة** — النشر الفعلي (ربط Intune/Jamf/AnyMind بالأسطول) بيد المدير
> على أجهزته (الحد الصادق 47.و.1).

## خريطة المفاتيح (واحدة للمنصات الثلاث)

| مفتاح MDM | حقل policy.json v2 | القيم | الفرض (§47.أ) |
|---|---|---|---|
| `Organization` | `organization` | نص ≤120 | توصيفي (امتثال + تقارير) |
| `RemoteAccess` | `managed.remoteAccess` | `force-on` \| `force-off` | §38 حرفيًا (البوابة + API) |
| `BlockedBridges` | `managed.blockedBridges` | من 3003 إلى 3009 | §38 حرفيًا (خارج الجهاز حصرًا) |
| `LockedSettings` | `managed.lockedSettings` | `appLock` · `idle` · `updater` | PUT للقسم المقفول → 403 |
| `AccessCodeRotationDays` | `managed.accessCodeRotationDays` | عدد 1–365 | استحقاق التدوير يُعلن صاخبًا |
| `DisabledCapabilities` | `managed.disabledCapabilities` | `market` · `assist` · `sync` | 403 على نقطة القدرة (§47.أ) |
| `MinimumVersion` | `managed.minimumVersion` | semver `X.Y.Z` | ختم معلن (إعلان لا حجب) |

## Windows (GPO / Intune Administrative Templates)

1. انسخ `windows/nexuslink.admx` إلى `C:\Windows\PolicyDefinitions\` و
   `windows/nexuslink.adml` إلى `C:\Windows\PolicyDefinitions\en-US\`.
2. افتح `gpedit.msc` → Computer Configuration → Administrative Templates →
   NexusLink device management — سبع سياسات.
3. بعد ضبط القيم في السجل (`SOFTWARE\NexusLink\Policy`) حوّلها إلى ملف
   السياسة الحي (PowerShell كمسؤول — كتابة ذرّية):

```powershell
$reg = "HKLM:\SOFTWARE\NexusLink\Policy"
$k = Get-ItemProperty -Path $reg -ErrorAction SilentlyContinue
$m = Get-ItemProperty -Path "$reg\Managed" -ErrorAction SilentlyContinue
function Get-RegList($path) {
  # قوائم ADMX تُخزَّن كمفاتيح فرعية قيمةً لكل عنصر (explicitValue)
  if (-not (Test-Path $path)) { return @() }
  Get-Item $path | Select-Object -ExpandProperty Property | ForEach-Object {
    (Get-ItemProperty -Path $path -Name $_).$_
  }
}
$policy = [ordered]@{ schemaVersion = 2 }
if ($k.Organization) { $policy.organization = $k.Organization }
$managed = [ordered]@{}
if ($m.RemoteAccess) { $managed.remoteAccess = $m.RemoteAccess }
if ($m.AccessCodeRotationDays) { $managed.accessCodeRotationDays = [int]$m.AccessCodeRotationDays }
if ($m.MinimumVersion) { $managed.minimumVersion = $m.MinimumVersion }
$bb = Get-RegList "$reg\Managed\BlockedBridges"
if ($bb) { $managed.blockedBridges = $bb | ForEach-Object { [int]$_ } }
$ls = Get-RegList "$reg\Managed\LockedSettings"
if ($ls) { $managed.lockedSettings = $ls }
$dc = Get-RegList "$reg\Managed\DisabledCapabilities"
if ($dc) { $managed.disabledCapabilities = $dc }
if ($managed.Count) { $policy.managed = $managed }
New-Item -ItemType Directory -Force -Path "C:\ProgramData\NexusLink" | Out-Null
$tmp = "C:\ProgramData\NexusLink\policy.json.tmp"
[IO.File]::WriteAllText($tmp, ($policy | ConvertTo-Json -Depth 5))
Move-Item -Force $tmp "C:\ProgramData\NexusLink\policy.json"
```

> ملاحظة صادقة: السكربت أعلاه هو **الجسر من السجل إلى الملف** — احتفظ به
> في ملف `apply.ps1` وشغّله من GPO Scheduled Task أو Intune PowerShell
> profile بعد كل تغيير سياسة (الملف يُقرأ لحظيًا فلا إعادة تشغيل). أبسط
> مسار Intune: تجاهل ADMX والكتابة مباشرة لـ `policy.json` بنفس المخطط
> من PowerShell script profile.

## macOS (Jamf / Munki)

1. Payload بصيغة Application & Custom Settings → ارفع
   `macos/com.nexuslink.policy.plist` لمجال `com.nexuslink.policy`.
2. حوّل البصمة إلى ملف السياسة الحي (launchd daemon أو script واحد):

```bash
#!/bin/bash
# apply.sh — بصمة Jamf → policy.json (plutil يحول plist إلى JSON حرفيًا)
set -euo pipefail
PLIST="/Library/Managed Preferences/com.nexuslink.policy.plist"
DEST_DIR="/Library/Application Support/NexusLink"
mkdir -p "$DEST_DIR"
plutil -convert json -o "$DEST_DIR/policy.json.tmp" "$PLIST"
mv "$DEST_DIR/policy.json.tmp" "$DEST_DIR/policy.json"
```

## Android (AnyMind / MDM general)

مرّر `android/managed_config.json` كـ managed configuration لتطبيق الوكيل
(`com.nexuslink.agent`) — الوكيل يكتب المحتوى كما هو في مسار السياسة
(§2 من `docs/enterprise-deploy.md`). الملف **JSON أصلاً** فلا تحويل — القيم
الغريبة تُرفض بالكامل عند القراءة (فشل-آمن).

## التحقق بعد النشر (على كل جهاز)

```bash
curl -s http://127.0.0.1:3000/api/enterprise/compliance | jq '.policyState, .enforced'
curl -s "http://127.0.0.1:3000/api/enterprise/report?format=json" | jq '.enforced'
```

والبوابة المحلية: `node scripts/enterprise47-e2e.mjs` (طور أ نقي — يفحص بنية
هذه القوالب نفسها ضمن فحوصه).
