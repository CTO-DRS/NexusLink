# NexusLink — دليل النشر المؤسسي (M4.1 — عقد §38)

> النواة المحلية للنشر المؤسسي: سياسات مركزية بملف واحد + فرض لحظي + تقرير
> امتثال. ما يبقى خارجيًا: مدقق SOC 2/ISO، عقد OEM، والنفق/TLS للوصول عبر
> الإنترنت (حدود §38.هـ — القبول المؤسسي بقرار المالك).

## 1) الفكرة في سطرين

المؤسسة تنشر **ملف سياسة JSON واحدًا** على كل جهاز (بأي أداة MDM تكتب
ملفات)، فيفرض الجهاز السياسة لحظيًا فوق قرار مستخدمه (المُدار فوق
المستخدم)، ويعلن حالة الامتثال على `/api/enterprise/compliance` (حلقي —
بيد الجهاز). بلا ملف سياسة = الجهاز بيد مستخدمه بالكامل (الافتراضي
التاريخي، صفر تغيير).

## 2) مسارات ملف السياسة (بالترتيب)

| الأولوية | المسار | متى تستخدمه |
|---|---|---|
| 1 | `NEXUSLINK_POLICY_FILE` (متغير بيئة) | النشر حيث يتعدد مجلد العمل (حاويات/خدمات مخصصة) |
| 2 | Windows: `C:\ProgramData\NexusLink\policy.json` | MDM على ويندوز (ProgramData قابلة للكتابة بSYSTEM دون تدخل المستخدم) |
| 2 | macOS: `/Library/Application Support/NexusLink/policy.json` | MDM على ماك (مسار نظام — يقرؤه كل المستخدمين) |
| 2 | Linux: `/etc/nexuslink/policy.json` | حزم deb/AppImage على لينكس |

- **التعديل حي**: البوابة والمسارات تقرأ الملف بمتغير تعديل-الوقت عند كل
  نداء — تغيير أو حذف الملف يسري فورًا بلا إعادة تشغيل أي خدمة.
- **الصلاحيات**: الملف في مسار نظام يحتاج صلاحيات إدارية للكتابة — هذا
  مقصود (من يملك القرص يملك السياسة؛ مستخدم عادي لا يعيد توجيه الإدارة).
- **مخطط غير صالح = لا فرض** (فشل-آمن §38.هـ.3) والحالة تُعلن `invalid` في
  الامتثال — لا فرض جزئي ولا سلوك صامت.

## 3) المخطط v1 (المرجع الكامل في عقد §38.ج)

```json
{
  "schemaVersion": 1,
  "organization": "Acme Corp",
  "managed": {
    "remoteAccess": "force-off",
    "blockedBridges": [3005, 3006]
  }
}
```

| المفتاح | القيم | الفرض |
|---|---|---|
| `managed.remoteAccess` | `"force-off"` | كل واصل من خارج الجهاز يُرفض 403 ولو برمز صحيح؛ تفعيل/تدوير من الواجهة مرفوض — الوصول البعيد مؤسسيًا مغلق |
| | `"force-on"` | الرمز شرط دائم للخارج؛ تعطيل من الواجهة مرفوض (التدوير متروك — دورة الرمز بلا فجوة) |
| `managed.blockedBridges` | أعداد من 3003 إلى 3009 | جسور محددة محجوبة عن الواصل الخارجي (HTTP وWS) — loopback معفى دائمًا (الجهاز هي الحدود) |
| (غياب الملف) | — | غير مُدار: السلوك التاريخي حرفيًا |

## 4) القوالب الجاهزة (data/enterprise/)

| الملف | الغرض |
|---|---|
| `policy.template.json` | هيكل موثق بتعليقات — انسخ وعدّل |
| `examples/privacy-first.json` | وضع «الخصوصية افتراضيًا» لتحميلات OEM: وصول بعيد مغلق + جسور النقل محجوبة عن الخارج |
| `examples/field-kiosk.json` | أجهزة ميدانية/لوحات: رمز شرط دائم + نقل ملفات محجوب عن الخارج |

## 5) النشر الصامت لكل منصة (تثبيت التطبيق نفسه)

> المثبتات من [GitHub Releases](https://github.com/CTO-DRS/NexusLink/releases/latest) —
> حزمة MSI هي المفضلة لأدوات MDM على ويندوز، وAPK/AAB للإدارة المدارة على أندرويد.

### Windows (Intune / GPO / أي MDM يدعم MSI أو Win32)
```powershell
# MSI — صامت تمامًا (لا واجهة ولا إعادة تشغيل)
msiexec /i NexusLink_2.0.0_x64_en-US.msi /qn /norestart
# NSIS بديل
NexusLink_2.0.0_x64-setup.exe /S
```
- **Intune**: أضف تطبيق Win32 (IntuneWin) أو MSI مباشرة، ثم سكربت PowerShell
  للخطوة الثانية: `Copy-Item policy.json 'C:\ProgramData\NexusLink\'`.
- **ترتيب خطوتين**: ثبّت التطبيق ثم انسخ ملف السياسة — أو العكس؛ الفرض لحظي
  فلا فرق (التطبيق يلتقط الملف عند أول قراءة بعد وضعه).
- **GPO بلا Intune**: سكربت بدء تشغيل (Startup Script) ينسخ الملف إلى
  ProgramData — بلا سجل وبلا ADMX (حد §38.هـ.2: الملف مصدر الحقيقة الواحد).

### macOS (Jamf / MDM القياسي)
```bash
# تثبيت DMG بالبرمجة (غير موقّع — زر يمين Open للتشغيل الأول اليدوي، أو
# زر التحميل المسبق OEM بوضع الحارس الطرفي)
hdiutil attach NexusLink_2.0.0_aarch64.dmg -nobrowse
cp -R "/Volumes/NexusLink/NexusLink.app" /Applications/
hdiutil detach "/Volumes/NexusLink"
# ملف السياسة
mkdir -p "/Library/Application Support/NexusLink"
cp policy.json "/Library/Application Support/NexusLink/policy.json"
```
- **Jamf**: سياسة Install بعد payload ثم سياسة Files and Processes لنسخ
  الملف (أو Custom Settings لاحقًا إن انتقلت للقراءة من Managed Preferences
  — بند لاحق بقرار صريح، حد §38.هـ.2).

### Linux (deb / AppImage)
```bash
sudo apt install ./NexusLink_2.0.0_amd64.deb
sudo mkdir -p /etc/nexuslink && sudo cp policy.json /etc/nexuslink/policy.json
```

### Android (Managed Google Play / Intune / المدير المدار)
- ثبّت `app-release.aab` عبر Play المدار أو `NexusLink-2.0.0-release.apk`
  بأي MDM أندرويد (نشر صامت على الأجهزة المدارة بالكامل).
- ملف السياسة على أندرويد: عبر MDM انسخ الملف إلى التخزين الخارجي للتطبيق
  ومرّر المسار بمتغير البيئة `NEXUSLINK_POLICY_FILE` عند تشغيل خدمة الجهاز
  (بند تنفيذ أندرويد الكامل لقراءة managed config الأصلي: لاحق بقرار صريح).

## 6) التحقق بعد النشر (على كل جهاز)

```bash
# 1) البوابة تعلن الإدارة (بلا حساسيات):
curl -s http://127.0.0.1:81/__gw/health
#   → "policyManaged":true و"policyRemoteAccess" كما في الملف

# 2) تقرير الامتثال الكامل (حلقي — من الجهاز نفسه):
curl -s http://127.0.0.1:3000/api/enterprise/compliance
#   → policyState:"managed" + organization + policyHash + enforced + pairGate

# 3) بصمة السياسة تطابق الملف المنشور:
python3 - <<'PY'
import hashlib, json, sys
raw = open("policy.json","rb").read()
print(hashlib.sha256(raw).hexdigest()[:16])
PY
#   قارن الناتج مع policyHash في التقرير — تطابقه يثبت أن الفرض من ملفك
#   (بصمة §38.د — تثبت من الفرض والنشر بحجة واحدة).
```

## 7) الجولة الحية المرجعية

`node scripts/enterprise-e2e.mjs --app http://127.0.0.1:3000` — ‏26 فحصًا
حية (17 بوابة + 9 تطبيق) تشغّل نفس ما يوثقه §38.و: غير المُدار تاريخيًا،
force-off/force-on، حظر الجسور عن الخارج حصرًا، التعديل الحي، الفشل-آمن،
قفل الأفعال، والامتثال حلقيًا وعبر البوابة.

## 8) حدود صادقة (خلاصة §38.هـ)

1. القبول المؤسسي الموسع (نشر فعلي على عشرات الأجهزة/مدقق SOC 2/عقد OEM)
   خارجي بقرار المالك — هذا البند يجعل الجهاز *قابلًا* للإدارة لا *مُدارًا*.
2. لا قراءة سجل نظام (Registry/Preferences) — MDM ينشر الملف نفسه.
3. ملف غير صالح = لا فرض + `invalid` معلنة — لا فرض جزئي ولا صمت.
4. الحجب والقفل يمسان الخارج حصرًا — loopback معفى (الجهاز هي الحدود).
5. الامتثال حلقي فقط — التقارير المركزية عبر الشبكة بند النفق/TLS الخارجي
   (لا يُفتح بلا تصميم رموز وتدقيق — حد §36.هـ.1 الموروث).
