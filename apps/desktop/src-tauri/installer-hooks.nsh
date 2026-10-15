; NexusLink — hooks مثبّت NSIS (FA-files عقد §14 + R4 ① عقد §19 + §22 الكاميرا)
; ============================================================
; التثبيت: التطبيق نفسه يسجّل قائمة الزر الأيمن عند أول تشغيل (HKCU بلا
; صلاحيات مدير) — لا شيء مطلوب هنا.
; R4 ① الشاشة الثانية: تثبيت سائق Virtual-Display-Driver (VirtualDrivers —
;       MIT، توقيع SignPath) — اختياري غير حاجز: فشله لا يفشل التثبيت،
;       والحالة تعود صادقة من التشخيص (vdisplay_status).
; §22 الكاميرا الافتراضية: تثبيت akvirtualcamera الرسمي (GPL-3.0 — المثبّت
;       غير المعدَّل 9.3.1 من releases المشروع، الترخيص والمصدر في vcam/)
;       بصمت /S (NSIS معياري) ثم إنشاء «NexusLink Camera» بأوصافها —
;       اختياري غير حاجز (ويندوز 64-بت حصرًا)؛ والهدف: Zoom/Meet يراها
;       بلا أي خطوة يدوية. وقت التشغيل يملك ضمانة معادلة (provision_camera_now).
; إزالة التثبيت: تنظيف مفاتيح قائمة السياق حرفيًا + إزالة جهاز السائق.
;       كاميرا akvirtualcamera تُترك (أجهزة نظام للمستخدم — المثبّت الرسمي
;       remove-devices عند إزالته هو من يملك قرارها؛ موثق بصدق §22).
; ملاحظة: مفتاح النجمي يخص الملفات والمفتاح الثاني المجلدات.

; ---- مصادر الأسماء (الموارد تُثبَّت في $INSTDIR حرفيًا — عقد §17.ب) ----
!define NEXUS_VDD_DIR "$INSTDIR\vdd"
!define NEXUS_VDD_HWID "Root\MttVDD"
!define NEXUS_VDD_CLASS_GUID "4D36E968-E325-11CE-BFC1-08002BE10318"
!define NEXUS_VDD_CFG "C:\VirtualDisplayDriver"
!define NEXUS_VCAM_DIR "$INSTDIR\vcam"
!define NEXUS_VCAM_SETUP "akvirtualcamera-windows-9.3.1.exe"
!define NEXUS_VCAM_NAME "NexusLink Camera"
!define NEXUS_VCAM_ID "NexusLinkCam"
!define NEXUS_VCAM_REGKEY "SOFTWARE\Webcamoid\VirtualCamera"

!macro NexusProvisionCamera
  ; مسار AkVCamManager من السجل الذي كتبه المثبّت الرسمي (installscript.nsi:
  ; WriteRegStr HKLM "SOFTWARE\Webcamoid\VirtualCamera" "installPath" "$INSTDIR")
  ReadRegStr $0 HKLM "${NEXUS_VCAM_REGKEY}" "installPath"
  ${If} $0 != ""
    ${If} ${FileExists} "$0\x64\AkVCamManager.exe"
      ; إنشاء «NexusLink Camera» بمعرف ثابت — المصدر: cmdparser.cpp
      ; add-device [-i DEVICEID] DESCRIPTION + add-format DEVICE FMT W H FPS.
      ; المعرف الثابت يغني عن تحليل خرج devices في NSIS. إن كان المعرف
      ; محجوزًا (تثبيت سابق) يفشل add-device بلطف — وقت التشغيل يملك
      ; الضمانة idempotent الكاملة (provision_camera_now — عقد §22).
      DetailPrint "NexusLink: إنشاء كاميرا «${NEXUS_VCAM_NAME}»…"
      nsExec::ExecToLog `"$0\x64\AkVCamManager.exe" add-device -i ${NEXUS_VCAM_ID} "${NEXUS_VCAM_NAME}"`
      Pop $1
      ${If} $1 == 0
        nsExec::ExecToLog `"$0\x64\AkVCamManager.exe" add-format ${NEXUS_VCAM_ID} YUY2 1280 720 30`
        Pop $1
        nsExec::ExecToLog `"$0\x64\AkVCamManager.exe" add-format ${NEXUS_VCAM_ID} YUY2 1920 1080 30`
        Pop $1
        nsExec::ExecToLog `"$0\x64\AkVCamManager.exe" add-format ${NEXUS_VCAM_ID} YUY2 640 480 30`
        Pop $1
        nsExec::ExecToLog `"$0\x64\AkVCamManager.exe" update`
        Pop $1
        DetailPrint "NexusLink: الكاميرا «${NEXUS_VCAM_NAME}» جاهزة (ستظهر في Zoom/Meet)"
      ${Else}
        DetailPrint "NexusLink: إنشاء الكاميرا تأجل (معرف محجوز؟) — وقت التشغيل يضمنها"
      ${EndIf}
    ${Else}
      DetailPrint "NexusLink: AkVCamManager غير موجود بعد التثبيت — وقت التشغيل يضمنها"
    ${EndIf}
  ${Else}
    DetailPrint "NexusLink: مفتاح تثبيت الكاميرا غائب — وقت التشغيل يضمنها"
  ${EndIf}
!macroend

!macro NexusInstallVDD
  ; 1) الشهادات من كتالوج السائق إلى TrustedPublisher — نفس تدفق
  ;    silent-install.ps1 الرسمي للمشروع (تحقق من مصدره §19)
  DetailPrint "NexusLink: تثبيت شهادة سائق الشاشة الافتراضية…"
  nsExec::ExecToLog `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$c=New-Object System.Security.Cryptography.X509Certificates.X509Certificate2Collection; $c.Import('${NEXUS_VDD_DIR}\mttvdd.cat'); foreach($x in $c){ $p=Join-Path $env:TEMP ($x.Thumbprint+'.cer'); [IO.File]::WriteAllBytes($p,$x.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert)); Import-Certificate -FilePath $p -CertStoreLocation Cert:\LocalMachine\TrustedPublisher | Out-Null; Remove-Item $p -ErrorAction SilentlyContinue }"`
  ; 2) ملف الإعدادات بأوضاعنا (السائق يقرأ C:\VirtualDisplayDriver — Driver.cpp:94)
  DetailPrint "NexusLink: كتابة إعدادات الشاشة الافتراضية (1080×2400 / 2400×1080 @60)…"
  CreateDirectory "${NEXUS_VDD_CFG}"
  CopyFiles /SILENT "${NEXUS_VDD_DIR}\vdd_settings.xml" "${NEXUS_VDD_CFG}\vdd_settings.xml"
  ; 3) تثبيت جهاز ROOT + السائق — nefconc (nefarius — MIT) أمر install
  ;    المتوافق مع devcon (موثق في README nefcon) — نفسه المستعمل في
  ;    سكربت التثبيت الصامت الرسمي للمشروع
  DetailPrint "NexusLink: تثبيت سائق الشاشة الافتراضية (Root\MttVDD)…"
  nsExec::ExecToLog `"${NEXUS_VDD_DIR}\nefconc.exe" install "${NEXUS_VDD_DIR}\MttVDD.inf" "${NEXUS_VDD_HWID}"`
  Pop $0
  DetailPrint "NexusLink: سائق الشاشة الافتراضية — رمز الخروج $0 (0 = ناجح، 3010 = يلزم إعادة تشغيل)"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "NexusLink: تثبيت قائمة الزر الأيمن تم من التطبيق (HKCU) — لا شيء هنا"
  ; السائق اختياري: على 64-bit حصرًا (السائق NTamd64) — فشل التثبيت غير حاجز
  ${If} ${RunningX64}
    ${If} ${FileExists} "${NEXUS_VDD_DIR}\MttVDD.inf"
      !insertmacro NexusInstallVDD
    ${Else}
      DetailPrint "NexusLink: حزمة سائق الشاشة الافتراضية غير موجودة — تُتخطى (يمكن تثبيتها لاحقًا يدويًا)"
    ${EndIf}
    ; §22 الكاميرا الافتراضية — غير حاجزة أيضًا (ويندوز 64-بت حصرًا)
    ${If} ${FileExists} "${NEXUS_VCAM_DIR}\${NEXUS_VCAM_SETUP}"
      DetailPrint "NexusLink: تثبيت حزمة الكاميرا الافتراضية (akvirtualcamera الرسمي 9.3.1 — /S)…"
      nsExec::ExecToLog `"${NEXUS_VCAM_DIR}\${NEXUS_VCAM_SETUP}" /S`
      Pop $0
      DetailPrint "NexusLink: حزمة الكاميرا — رمز الخروج $0 (0 = ناجح)"
      !insertmacro NexusProvisionCamera
    ${Else}
      DetailPrint "NexusLink: حزمة الكاميرا الافتراضية غير موجودة — يمكن تثبيتها لاحقًا من لوحة الأدوات"
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "NexusLink: تنظيف مفاتيح قائمة الزر الأيمن (يُنظف أيضًا بعد الإزالة)…"
  DeleteRegKey HKCU "Software\Classes\*\shell\NexusLink"
  DeleteRegKey HKCU "Software\Classes\Directory\shell\NexusLink"
  ; R4 ① — إزالة جهاز السائق (الجهاز فقط — الحزمة تبقى في مخزن السائقين،
  ;       نمط `remove` الموثق في nefcon) — غير حاجز أيضًا
  ${If} ${RunningX64}
    ${If} ${FileExists} "${NEXUS_VDD_DIR}\nefconc.exe"
      DetailPrint "NexusLink: إزالة جهاز الشاشة الافتراضية (Root\MttVDD)…"
      nsExec::ExecToLog `"${NEXUS_VDD_DIR}\nefconc.exe" remove "${NEXUS_VDD_HWID}"`
      Pop $0
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DetailPrint "NexusLink: إزالة قائمة الزر الأيمن (إرسال عبر NexusLink)…"
  DeleteRegKey HKCU "Software\Classes\*\shell\NexusLink"
  DeleteRegKey HKCU "Software\Classes\Directory\shell\NexusLink"
  ; إعدادات السائق تُترك (قد يملكها المستخدم من قبل) — موثق بصدق §19
!macroend
