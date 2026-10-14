// NexusLink Desktop — الشاشة الثانية: الهاتف شاشة ممتدة فعلية (R4 مرحلة ①)
// ============================================================================
// قرار معماري موثق (عقد §19):
//   · ويندوز: سائق Virtual-Display-Driver من VirtualDrivers (MIT — توقيع SignPath،
//     HWID = Root\MttVDD) يُثبَّت من مثبت NSIS (installer-hooks.nsh): شهادات
//     mttvdd.cat → TrustedPublisher + `nefconc.exe install … "Root\MttVDD"` +
//     كتابة C:\VirtualDisplayDriver\vdd_settings.xml بأوضاعنا (المصدر: Driver.cpp:94
//     confpath ثابت في مصدر السائق).
//     التشغيل/الإطفاء وقت الرِجِيم **بلا صلاحيات مدير**: CCD (QueryDisplayConfig/
//     SetDisplayConfig) — نفس آلية Win+P — وتبديل الوضع ChangeDisplaySettingsExW.
//     إطفاء المسار يعيد النوافذ للشاشات الباقية سلوك النظام تلقائيًا (البند 8).
//   · لينكس: xrandr — cvt + newmode + addmode على مخرج غير متصل + إلحاق يمين
//     الأساسية (بلا صلاحيات، جلسة X11). Wayland بلا مسند — موثق بصدق.
//   · ماك: لا شاشات افتراضية بدون سائق موقّع (قيود توقيع النظام) — القيد موثق،
//     والبديل العملي الجاهز: بث نافذة محددة (window:* في media_targets على ماك).
//
// لا حقن موازٍ: اللمس على الشاشة الافتراضية يمر عبر NexusLive (§18) إلى
// apply_pointer القائم — فضاء المؤشر يضبطه media.rs من أبعاد/أصل الهدف.
// لا كرِيت جديد: FFI يدوي لـ user32 (النمط المعتمد في media.rs) — صفر تبعيات.
use serde_json::{json, Value};
use std::sync::Mutex;

use crate::vdisplay_core as core;

/// جلسة الشاشة الافتراضية القائمة (ما فعّلناه نحن — للإطفاء الذكي والتشخيص)
pub struct VdSession {
    pub target_id: String,
    pub w: u32,
    pub h: u32,
    pub device: String, // \\.\DISPLAYn أو اسم مخرج xrandr
}
static SESSION: Mutex<Option<VdSession>> = Mutex::new(None);

pub fn session_active() -> bool {
    SESSION.lock().map(|g| g.is_some()).unwrap_or(false)
}

#[derive(Debug, Clone)]
pub struct MonitorEx {
    pub index: usize,
    pub ox: i32,
    pub oy: i32,
    pub w: u32,
    pub h: u32,
    pub device: String,
    pub primary: bool,
}

// ===========================================================================
// ويندوز — FFI: تعداد الشاشات + CCD + تبديل الوضع (user32 حصرًا — بلا تبعيات)
// ===========================================================================
#[cfg(windows)]
mod win {
    use super::*;

    // ----- أنواع CCD (أحجام موثقة من رؤوس wingdi.h — تحقق windows-rs) -----
    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    pub struct Luid {
        pub low: u32,
        pub high: i32,
    }
    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct PathSourceInfo {
        pub adapter: Luid,
        pub id: u32,
        pub mode_info_idx: u32,
        pub status: u32,
    }
    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct Rational {
        pub num: u32,
        pub den: u32,
    }
    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct PathTargetInfo {
        pub adapter: Luid,
        pub id: u32,
        pub mode_info_idx: u32,
        pub technology: i32,
        pub rotation: i32,
        pub scaling: i32,
        pub refresh: Rational,
        pub scanline: i32,
        pub target_available: i32,
        pub status: u32,
    }
    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct PathInfo {
        pub source: PathSourceInfo,
        pub target: PathTargetInfo,
        pub flags: u32,
    }
    /// DISPLAYCONFIG_MODE_INFO — 48 بايت حرفيًا (4+4+8+اتحاد 32) — الاتحاد
    /// يُدار بايتيًا (قراءة/كتابة position فقط @12: width@0 height@4 pixelFormat@8)
    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct ModeInfo {
        pub mode_type: i32,
        pub id: u32,
        pub adapter: Luid,
        pub data: [u8; 32],
    }
    pub const MODE_TYPE_SOURCE: i32 = 0;
    pub const MODE_TYPE_TARGET: i32 = 1;
    pub const PATH_MODE_IDX_INVALID: u32 = 0xFFFF_FFFF;
    pub const PATH_ACTIVE: u32 = 0x1;
    // QDC/SDC flags (wingdi.h حرفيًا)
    pub const QDC_ALL_PATHS: u32 = 0x1;
    pub const QDC_ONLY_ACTIVE_PATHS: u32 = 0x2;
    pub const SDC_USE_SUPPLIED_DISPLAY_CONFIG: u32 = 0x1;
    pub const SDC_SAVE_TO_DATABASE: u32 = 0x2;
    pub const SDC_ALLOW_CHANGES: u32 = 0x40;
    // DISPLAYCONFIG_DEVICE_INFO_GET_*
    pub const GET_SOURCE_NAME: i32 = 1;
    pub const GET_TARGET_NAME: i32 = 2;

    #[link(name = "user32")]
    extern "system" {
        pub fn QueryDisplayConfig(
            flags: u32,
            npaths: *mut u32,
            paths: *mut PathInfo,
            nmodes: *mut u32,
            modes: *mut ModeInfo,
            topologies: *mut u32,
        ) -> i32;
        pub fn GetDisplayConfigBufferSizes(flags: u32, npaths: *mut u32, nmodes: *mut u32) -> i32;
        pub fn SetDisplayConfig(
            npaths: u32,
            paths: *mut PathInfo,
            nmodes: u32,
            modes: *mut ModeInfo,
            flags: u32,
        ) -> i32;
        pub fn DisplayConfigGetDeviceInfo(req: *mut std::ffi::c_void) -> i32;
        pub fn ChangeDisplaySettingsExW(dev: *const u16, dm: *const DevModeW, hwnd: *mut std::ffi::c_void, flags: u32, param: *mut std::ffi::c_void) -> i32;
        pub fn EnumDisplaySettingsW(dev: *const u16, mode: u32, dm: *mut DevModeW) -> i32;
    }

    /// طلبات DisplayConfigGetDeviceInfo — 336 بايت حرفيًا (رأس 16 + 64 + 256)
    #[repr(C)]
    pub struct SourceNameReq {
        pub header: DevInfoHeaderRaw,
        pub view_gdi_device_name: [u16; 32],
        pub view_gdi_device_path: [u16; 128],
    }
    #[repr(C)]
    pub struct TargetNameReq {
        pub header: DevInfoHeaderRaw,
        pub monitor_friendly_name: [u16; 32],
        pub monitor_device_path: [u16; 128],
    }
    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct DevInfoHeaderRaw {
        pub kind: i32,
        pub size: u32,
        pub adapter: Luid,
        pub id: u32,
    }

    /// DEVMODEW مصغّر بكفاية (حتى dmFields + dmYResolution — 220 بايت شائع)
    #[repr(C)]
    pub struct DevModeW {
        pub dm_device_name: [u16; 32],
        pub dm_spec_version: u16,
        pub dm_driver_version: u16,
        pub dm_size: u16,
        pub dm_driver_extra: u16,
        pub dm_fields: u32,
        pub dm_position: PointL,
        pub dm_display_orientation: u32,
        pub dm_display_fixed_output: u32,
        pub dm_color: i16,
        pub dm_duplex: i16,
        pub dm_y_resolution: i16,
        pub dm_ttoption: i16,
        pub dm_collate: i16,
        pub dm_form_name: [u16; 32],
        pub dm_log_pixels: u16,
        pub dm_bits_per_pel: u32,
        pub dm_pels_width: u32,
        pub dm_pels_height: u32,
        pub dm_display_flags: u32,
        pub dm_display_frequency: u32,
        // الذيل الإلزامي — sizeof(DEVMODEW) = 220 بايت (تحقق windows-rs 0.58)
        pub dm_icm_method: u32,
        pub dm_icm_intent: u32,
        pub dm_media_type: u32,
        pub dm_dither_type: u32,
        pub dm_reserved1: u32,
        pub dm_reserved2: u32,
        pub dm_panning_width: u32,
        pub dm_panning_height: u32,
    }
    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    pub struct PointL {
        pub x: i32,
        pub y: i32,
    }
    impl Default for DevModeW {
        fn default() -> Self {
            // dm_size = حجم البنية الفعلي — نحسبه وقت الإنشاء (sizeof)
            let mut d = unsafe { std::mem::zeroed::<DevModeW>() };
            d.dm_size = std::mem::size_of::<DevModeW>() as u16;
            d
        }
    }

    pub const DM_POSITION: u32 = 0x20;
    pub const DM_PELS_WIDTH: u32 = 0x80000;
    pub const DM_PELS_HEIGHT: u32 = 0x100000;
    pub const DM_DISPLAY_FREQUENCY: u32 = 0x400000;
    pub const CDS_TYPE: u32 = 0x0; // تغيير ديناميكي
    pub const DISP_CHANGE_SUCCESSFUL: i32 = 0;
    pub const DISP_CHANGE_BADMODE: i32 = -2;
    pub const ENUM_CURRENT: u32 = 0xFFFF_FFFF;

    // ----- تعداد الشاشات (MONITORINFOEXW) — نفس ترتيب windows-capture::Monitor
    //       (كلاهما EnumDisplayMonitors — تحقق من مصدر الكرِيت 1.3.6) -----
    #[repr(C)]
    struct MonitorInfoExW {
        cb_size: u32,
        rc_monitor: [i32; 4],
        rc_work: [i32; 4],
        flags: u32,
        device: [u16; 32],
    }
    #[link(name = "user32")]
    extern "system" {
        fn EnumDisplayMonitors(hdc: *mut std::ffi::c_void, clip: *mut std::ffi::c_void, cb: Option<extern "system" fn(isize, isize, *mut RectRaw, isize) -> i32>, data: isize) -> i32;
        fn GetMonitorInfoW(hmon: isize, info: *mut MonitorInfoExW) -> i32;
    }
    #[repr(C)]
    struct RectRaw {
        l: i32,
        t: i32,
        r: i32,
        b: i32,
    }
    extern "system" fn mon_cb(hmon: isize, _hdc: isize, _rect: *mut RectRaw, data: isize) -> i32 {
        unsafe {
            let list = &mut *(data as *mut Vec<MonitorEx>);
            let mut info = std::mem::zeroed::<MonitorInfoExW>();
            info.cb_size = std::mem::size_of::<MonitorInfoExW>() as u32;
            if GetMonitorInfoW(hmon, &mut info) != 0 {
                let idx = list.len();
                list.push(MonitorEx {
                    index: idx,
                    ox: info.rc_monitor[0],
                    oy: info.rc_monitor[1],
                    w: (info.rc_monitor[2] - info.rc_monitor[0]).max(0) as u32,
                    h: (info.rc_monitor[3] - info.rc_monitor[1]).max(0) as u32,
                    device: String::from_utf16_lossy(
                        &info.device[..info.device.iter().position(|c| *c == 0).unwrap_or(32)],
                    ),
                    primary: info.flags & 1 != 0,
                });
            }
            1 // متابعة التعداد
        }
    }
    pub fn list_monitors_ex() -> Vec<MonitorEx> {
        let mut list: Vec<MonitorEx> = Vec::new();
        unsafe {
            EnumDisplayMonitors(
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                Some(mon_cb),
                &mut list as *mut _ as isize,
            );
        }
        list
    }

    fn to_wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }
    fn wide_str(buf: &[u16]) -> String {
        let end = buf.iter().position(|c| *c == 0).unwrap_or(buf.len());
        String::from_utf16_lossy(&buf[..end])
    }

    // ----- CCD: استعلام المسارات وأسماء الأهداف -----
    pub struct CcdQuery {
        pub paths: Vec<PathInfo>,
        pub modes: Vec<ModeInfo>,
    }

    pub fn query_paths(flags: u32) -> Result<CcdQuery, String> {
        let (mut np, mut nm) = (0u32, 0u32);
        let r = unsafe { GetDisplayConfigBufferSizes(flags, &mut np, &mut nm) };
        if r != 0 {
            return Err(format!("GetDisplayConfigBufferSizes: {r}"));
        }
        if np == 0 || np > 128 || nm > 1024 {
            return Err("CCD: أحجام غير منطقية".into());
        }
        let mut paths = vec![PathInfo {
            source: PathSourceInfo { adapter: Luid::default(), id: 0, mode_info_idx: 0, status: 0 },
            target: PathTargetInfo {
                adapter: Luid::default(),
                id: 0,
                mode_info_idx: 0,
                technology: 0,
                rotation: 0,
                scaling: 0,
                refresh: Rational { num: 0, den: 0 },
                scanline: 0,
                target_available: 0,
                status: 0,
            },
            flags: 0,
        }; np as usize];
        let mut modes = vec![
            ModeInfo { mode_type: 0, id: 0, adapter: Luid::default(), data: [0u8; 40] };
            nm as usize
        ];
        let mut topo = 0u32;
        let r = unsafe {
            QueryDisplayConfig(flags, &mut np, paths.as_mut_ptr(), &mut nm, modes.as_mut_ptr(), &mut topo)
        };
        if r != 0 {
            return Err(format!("QueryDisplayConfig: {r}"));
        }
        paths.truncate(np as usize);
        modes.truncate(nm as usize);
        Ok(CcdQuery { paths, modes })
    }

    /// اسم الجهاز GDI للمصدر (\\.\DISPLAYn) — تحديد الشاشة الافتراضية بدقة
    pub fn source_gdi_name(p: &PathInfo) -> String {
        let mut req = SourceNameReq {
            header: DevInfoHeaderRaw {
                kind: GET_SOURCE_NAME,
                size: std::mem::size_of::<SourceNameReq>() as u32,
                adapter: p.source.adapter,
                id: p.source.id,
            },
            view_gdi_device_name: [0; 32],
            view_gdi_device_path: [0; 128],
        };
        let r = unsafe { DisplayConfigGetDeviceInfo(&mut req as *mut SourceNameReq as *mut std::ffi::c_void) };
        if r != 0 {
            return String::new();
        }
        wide_str(&req.view_gdi_device_name)
    }

    /// الاسم الودود للهدف (يحمل "VDD by MTT" من EDID السائق — تحقق من
    /// Community Scripts/changeres-VDD.ps1: DisplayName -eq "VDD by MTT")
    pub fn target_friendly_name(p: &PathInfo) -> String {
        let mut req = TargetNameReq {
            header: DevInfoHeaderRaw {
                kind: GET_TARGET_NAME,
                size: std::mem::size_of::<TargetNameReq>() as u32,
                adapter: p.target.adapter,
                id: p.target.id,
            },
            monitor_friendly_name: [0; 32],
            monitor_device_path: [0; 128],
        };
        let r = unsafe { DisplayConfigGetDeviceInfo(&mut req as *mut TargetNameReq as *mut std::ffi::c_void) };
        if r != 0 {
            return String::new();
        }
        wide_str(&req.monitor_friendly_name)
    }

    pub fn is_vdd_name(name: &str) -> bool {
        let n = name.to_lowercase();
        n.contains("vdd") || n.contains("virtual display")
    }

    /// موضع (x,y) لوضع مصدر من بايتات الاتحاد (DISPLAYCONFIG_SOURCE_MODE.position @12)
    pub fn source_mode_position(m: &ModeInfo) -> Option<(i32, i32)> {
        if m.mode_type != MODE_TYPE_SOURCE || m.data.len() < 20 {
            return None;
        }
        let x = i32::from_le_bytes(m.data[12..16].try_into().ok()?);
        let y = i32::from_le_bytes(m.data[16..20].try_into().ok()?);
        Some((x, y))
    }
    pub fn set_source_mode_position(m: &mut ModeInfo, x: i32, y: i32) {
        if m.mode_type == MODE_TYPE_SOURCE && m.data.len() >= 20 {
            m.data[12..16].copy_from_slice(&x.to_le_bytes());
            m.data[16..20].copy_from_slice(&y.to_le_bytes());
        }
    }
    pub fn source_mode_dims(m: &ModeInfo) -> Option<(u32, u32)> {
        if m.mode_type != MODE_TYPE_SOURCE || m.data.len() < 8 {
            return None;
        }
        let w = u32::from_le_bytes(m.data[0..4].try_into().ok()?);
        let h = u32::from_le_bytes(m.data[4..8].try_into().ok()?);
        Some((w, h))
    }

    /// إيجاد مسار الشاشة الافتراضية (نشطًا كان أم لا) — يعيد (index, active, gdiName)
    pub fn find_vdd_path(q: &CcdQuery) -> Option<(usize, bool, String)> {
        for (i, p) in q.paths.iter().enumerate() {
            let friendly = target_friendly_name(p);
            if is_vdd_name(&friendly) {
                return Some((i, p.flags & PATH_ACTIVE != 0, source_gdi_name(p)));
            }
        }
        None
    }

    /// تطبيق تهيئة مسارات (SetDisplayConfig) — بلا صلاحيات (سلوك Win+P)
    pub fn apply_config(paths: &mut [PathInfo], modes: &mut [ModeInfo]) -> Result<(), String> {
        let r = unsafe {
            SetDisplayConfig(
                paths.len() as u32,
                paths.as_mut_ptr(),
                modes.len() as u32,
                modes.as_mut_ptr(),
                SDC_USE_SUPPLIED_DISPLAY_CONFIG | SDC_ALLOW_CHANGES | SDC_SAVE_TO_DATABASE,
            )
        };
        if r != 0 {
            return Err(format!("SetDisplayConfig: {r}"));
        }
        Ok(())
    }

    /// هل الوضع (w,h,60) معروض ضمن أوضاع الجهاز؟ (EnumDisplaySettingsW)
    pub fn mode_available(device: &str, w: u32, h: u32) -> bool {
        let dev = to_wide(device);
        let mut i = 0u32;
        loop {
            let mut dm = DevModeW::default();
            if unsafe { EnumDisplaySettingsW(dev.as_ptr(), i, &mut dm) } == 0 {
                return false;
            }
            if dm.dm_pels_width == w && dm.dm_pels_height == h && dm.dm_display_frequency == 60 {
                return true;
            }
            i += 1;
            if i > 400 {
                return false;
            }
        }
    }

    /// تبديل وضع جهاز شاشة (ChangeDisplaySettingsExW — مستخدم-level)
    pub fn change_mode(device: &str, w: u32, h: u32) -> Result<(), String> {
        let dev = to_wide(device);
        let mut dm = DevModeW::default();
        dm.dm_fields = DM_PELS_WIDTH | DM_PELS_HEIGHT | DM_DISPLAY_FREQUENCY;
        dm.dm_pels_width = w;
        dm.dm_pels_height = h;
        dm.dm_display_frequency = 60;
        let r = unsafe { ChangeDisplaySettingsExW(dev.as_ptr(), &dm, std::ptr::null_mut(), CDS_TYPE, std::ptr::null_mut()) };
        if r != DISP_CHANGE_SUCCESSFUL {
            let why = if r == DISP_CHANGE_BADMODE { "الوضع غير متاح (تأكد من كتابة الأوضاع عند التثبيت)" } else { "انظر الرمز" };
            return Err(format!("تبديل الوضع رُفض ({r}): {why}"));
        }
        Ok(())
    }

    // ----- حالة السائق من السجل (بلا اعتماد على مخرجات مترجمة) -----
    pub fn driver_status() -> (bool, bool, bool) {
        // (installed, enabled, settings_ok)
        let out = std::process::Command::new("reg")
            .args(["query", r"HKLM\SYSTEM\CurrentControlSet\Enum\ROOT\MttVDD"])
            .output();
        let installed = out.as_ref().map(|o| o.status.success()).unwrap_or(false);
        let mut enabled = false;
        if installed {
            if let Ok(o) = out {
                // ConfigFlags bit0 = معطَّل — نقرأ أول مفاتيح أجهزة تحت الجذر
                let s = String::from_utf8_lossy(&o.stdout);
                enabled = !s.contains("0x1");
            }
        }
        let settings_ok = std::path::Path::new(r"C:\VirtualDisplayDriver\vdd_settings.xml").exists();
        (installed, enabled, settings_ok)
    }

    pub fn settings_xml_text() -> Option<String> {
        std::fs::read_to_string(r"C:\VirtualDisplayDriver\vdd_settings.xml").ok()
    }

    pub fn write_settings_xml(text: &str) -> Result<(), String> {
        let dir = std::path::Path::new(r"C:\VirtualDisplayDriver");
        std::fs::create_dir_all(dir).map_err(|e| format!("إنشاء مجلد الإعدادات: {e}"))?;
        std::fs::write(dir.join("vdd_settings.xml"), text).map_err(|e| format!("كتابة الإعدادات: {e}"))
    }
}

#[cfg(windows)]
use win::*;

/// تعداد الشاشات بهندستها الحقيقية — يستعمله media.rs (قائمة الأهداف وأصولها)
/// وعقد الفهرس موثق: نفس ترتيب EnumDisplayMonitors = ترتيب windows-capture.
#[cfg(windows)]
pub fn list_monitors_ex() -> Vec<MonitorEx> {
    win::list_monitors_ex()
}
#[cfg(not(windows))]
pub fn list_monitors_ex() -> Vec<MonitorEx> {
    Vec::new()
}

/// جهاز جلسة الشاشة الافتراضية الحالية (إن كنا من فعلها) — لتسمية الهدف في
/// قائمة الأهداف والتمييز عن شاشات الطرف الآخر
pub fn current_session_device() -> Option<String> {
    SESSION.lock().ok().and_then(|g| g.as_ref().map(|s| s.device.clone()))
}

// ===========================================================================
// الأوامر المشتركة (Tauri) — شكل موحد لكل المنصات
// ===========================================================================

/// حالة الشاشة الثانية — صادقة لكل منصة (تُستهلك في البطاقة والتشخيص)
#[tauri::command]
pub fn vdisplay_status() -> Value {
    let sess = SESSION.lock().ok().and_then(|g| {
        g.as_ref().map(|s| json!({"targetId": s.target_id, "w": s.w, "h": s.h, "device": s.device}))
    });
    #[cfg(windows)]
    {
        let (installed, enabled, settings_ok) = driver_status();
        let (virtual_active, gdi) = query_paths(QDC_ONLY_ACTIVE_PATHS)
            .ok()
            .and_then(|q| find_vdd_path(&q))
            .map(|(_, a, g)| (a, g))
            .unwrap_or((false, String::new()));
        let contract_modes: Vec<(u32, u32)> =
            core::PRESET_MODES.iter().map(|(_, w, h)| (*w, *h)).collect();
        let modes_ok = settings_xml_text()
            .map(|x| core::modes_present(&x, &contract_modes))
            .unwrap_or(false);
        json!({
            "platform": "windows",
            "supported": installed,
            "driverInstalled": installed,
            "driverEnabled": enabled,
            "settingsFile": settings_ok,
            "modesReady": modes_ok,
            "virtualActive": virtual_active,
            "virtualDevice": gdi,
            "sessionActive": session_active(),
            "session": sess,
            "note": if installed { "" } else { "سائق الشاشة الافتراضية غير مثبت — أعد تثبيت NexusLink ليتولى تثبيته (بند التثبيت)" },
        })
    }
    #[cfg(target_os = "linux")]
    {
        let x11 = std::env::var("DISPLAY").map(|v| !v.is_empty()).unwrap_or(false);
        let wayland = std::env::var("WAYLAND_DISPLAY").map(|v| !v.is_empty()).unwrap_or(false);
        let xrandr = if x11 {
            std::process::Command::new("xrandr").arg("--query").output().map(|o| o.status.success()).unwrap_or(false)
        } else {
            false
        };
        let outs = if x11 {
            std::process::Command::new("xrandr").arg("--query").output().ok().and_then(|o| {
                let t = String::from_utf8_lossy(&o.stdout).to_string();
                let m = core::xrandr_mode_name(1080, 2400);
                Some(core::parse_xrandr_query(&t, &m))
            })
        } else {
            None
        };
        let has_candidate = outs.as_ref().map(|o| core::pick_disconnected_output(o).is_some()).unwrap_or(false);
        json!({
            "platform": "linux",
            "supported": x11 && xrandr && has_candidate,
            "x11": x11,
            "wayland": wayland,
            "xrandr": xrandr,
            "hasCandidateOutput": has_candidate,
            "sessionActive": session_active(),
            "session": sess,
            "note": if wayland && !x11 { "لينكس Wayland غير مسند — استخدم جلسة X11/XWayland" }
                    else if !has_candidate { "لا مخرجًا غير متصل لإنشاء الشاشة الافتراضية عليه (سائق dummy/مخرج فارغ مطلوب — موثق §19)" }
                    else { "" },
        })
    }
    #[cfg(target_os = "macos")]
    {
        json!({
            "platform": "macos",
            "supported": false,
            "sessionActive": session_active(),
            "session": sess,
            "note": "ماك: لا شاشات افتراضية بدون سائق موقّع من النظام (قيود توقيع macOS) — البديل العملي: «بث نافذة محددة» من قائمة الأهداف (نمط شبه-ثانوي موثق §19)",
        })
    }
}

/// تفعيل الشاشة الثانية — (w,h) اختياريان (افتراضي 1080×2400 عمودي)
/// يعيد هدف البث "screen:N" + هندسته (أصلها في المركّب) لتمريرها للبث.
#[tauri::command]
pub async fn vdisplay_enable(w: Option<u32>, h: Option<u32>) -> Result<Value, String> {
    let (w, h) = core::validate_mode(w.unwrap_or(1080), h.unwrap_or(2400))?;
    // جلسة شاشة نشطة سابقًا → أطفئها أولًا (نمط الجلسات الواحدة)
    let _ = disable_inner().await;
    let info = enable_inner(w, h).await?;
    if let Ok(mut g) = SESSION.lock() {
        *g = Some(VdSession {
            target_id: info.target_id.clone(),
            w,
            h,
            device: info.device.clone(),
        });
    }
    println!("[vdisplay] enabled {}x{} → {} ({})", w, h, info.target_id, info.device);
    Ok(json!({
        "ok": true,
        "targetId": info.target_id,
        "ox": info.ox, "oy": info.oy, "w": info.w, "h": info.h,
        "device": info.device,
    }))
}

/// إيقاف الشاشة الثانية — النوافذ تعود للشاشات الباقية سلوك النظام
#[tauri::command]
pub async fn vdisplay_disable() -> Result<Value, String> {
    disable_inner().await?;
    Ok(json!({"ok": true}))
}

pub struct EnabledInfo {
    pub target_id: String,
    pub ox: i32,
    pub oy: i32,
    pub w: u32,
    pub h: u32,
    pub device: String,
}

async fn enable_inner(w: u32, h: u32) -> Result<EnabledInfo, String> {
    #[cfg(windows)]
    {
        win_enable(w, h)
    }
    #[cfg(target_os = "linux")]
    {
        let (ox, oy, gw, gh, out_name) = linux_enable(w, h)?;
        // فهرس الشاشة في RandR — مطابقة أصل/أبعاد مع قائمة الأهداف القائمة
        let target_id = resolve_target_id(ox, oy, gw, gh, out_name.as_str());
        Ok(EnabledInfo { target_id, ox, oy, w: gw, h: gh, device: out_name })
    }
    #[cfg(target_os = "macos")]
    {
        let _ = (w, h);
        Err("ماك: بلا شاشات افتراضية بدون سائق موقّع (قيود توقيع macOS — موثقة §19) — البديل: «بث نافذة محددة» من قائمة الأهداف".into())
    }
}

async fn disable_inner() -> Result<(), String> {
    let sess = SESSION.lock().ok().and_then(|mut g| g.take());
    match sess {
        None => Ok(()), // لا جلسة لنا — لا فعل (لا نمس شاشة طرف آخر)
        Some(s) => {
            #[cfg(windows)]
            {
                win_disable(&s.device)
            }
            #[cfg(target_os = "linux")]
            {
                linux_disable(s.device.as_str(), s.w, s.h)
            }
            #[cfg(target_os = "macos")]
            {
                let _ = s;
                Ok(())
            }
        }
    }
}

fn resolve_target_id(ox: i32, oy: i32, w: u32, h: u32, fallback: &str) -> String {
    // نطابق هندسة الشاشة الجديدة في قائمة الأهداف الحية — نفس قائمة البث
    if let Ok(targets) = crate::media::list_targets() {
        for t in targets.iter().filter(|t| t.kind == "screen") {
            if t.origin == (ox, oy) && (t.w == w || w == 0) && (t.h == h || h == 0) {
                return t.id.clone();
            }
        }
    }
    let _ = fallback;
    "screen:1".into() // احتياط: ثاني شاشة في التعداد (الحالة الشائعة)
}

// ===========================================================================
// ويندوز — التنفيذ: CCD (تشغيل/إطفاء بلا صلاحيات) + تبديل الوضع
// ===========================================================================
#[cfg(windows)]
fn win_enable(w: u32, h: u32) -> Result<EnabledInfo, String> {
    let (installed, _enabled, settings_ok) = driver_status();
    if !installed {
        return Err("سائق الشاشة الافتراضية غير مثبت — أعد تثبيت NexusLink (المثبت يتولى الشهادة والسائق والإعدادات)".into());
    }
    if !settings_ok {
        return Err("ملف إعدادات السائق غائب (C:\\VirtualDisplayDriver\\vdd_settings.xml) — أعد التثبيت".into());
    }
    let mut q = query_paths(QDC_ALL_PATHS).map_err(|e| format!("CCD: {e}"))?;
    let (idx, active, gdi) = find_vdd_path(&q).ok_or_else(|| {
        "لا مسار شاشة افتراضية في CCD — السائق مثبت لكن بلا مخرج: أعد تشغيل الجهاز أو أعد التثبيت".to_string()
    })?;

    if active {
        // شاشة ظاهرة أصلًا — نضبط وضعها فقط إن لزم
        if let Some(dev) = if gdi.is_empty() { None } else { Some(gdi.clone()) } {
            let dims = list_monitors_ex()
                .into_iter()
                .find(|m| m.device == dev)
                .map(|m| (m.w, m.h));
            if dims != Some((w, h)) {
                if !mode_available(&dev, w, h) {
                    return Err(format!("الوضع {w}×{h}@60 غير متاح في السائق — أعد التثبيت ليكتب الأوضاع"));
                }
                change_mode(&dev, w, h)?;
            }
        }
        return finish_enable(gdi, w, h);
    }

    // ----- تنشيط المسار الخامل: نفعّل bit ACTIVE ونضمن وضعي مصدر/هدف صالحين -----
    // (نمط Win+P البرمجي: تهيئة موصولة بمسارات، المصدر يستنسخ من الأساسية
    //  بموضع يمين كل الشاشات القائمة — orientation تضبط لاحقًا change_mode)
    let primary_active = q
        .paths
        .iter()
        .position(|p| p.flags & PATH_ACTIVE != 0)
        .ok_or("لا مسارًا نشطًا أصلًا — بيئة عرض غير قياسية")?;

    // أصل جديد: يمين أقصى حافة لكل الشاشات النشطة
    let mut max_x: i32 = 0;
    for p in q.paths.iter() {
        if p.flags & PATH_ACTIVE != 0 && p.source.mode_info_idx != PATH_MODE_IDX_INVALID {
            if let Some(mi) = q.modes.get(p.source.mode_info_idx as usize) {
                if let Some((x, _)) = source_mode_position(mi) {
                    if let Some((_, sw)) = source_mode_dims(mi) {
                        max_x = max_x.max(x + sw as i32);
                    }
                }
            }
        }
    }

    // وضع مصدر للشاشة الافتراضية: استنساخ من الأساسية + موضع جديد
    let mut new_modes: Vec<ModeInfo> = q.modes.clone();
    let primary_src_idx = q.paths[primary_active].source.mode_info_idx;
    let src_template = if primary_src_idx != PATH_MODE_IDX_INVALID {
        new_modes.get(primary_src_idx as usize).copied()
    } else {
        None
    };
    let vsrc_idx = new_modes.len() as u32;
    if let Some(mut m) = src_template {
        m.id = q.paths[idx].source.id;
        m.adapter = q.paths[idx].source.adapter;
        set_source_mode_position(&mut m, max_x, 0);
        new_modes.push(m);
        q.paths[idx].source.mode_info_idx = vsrc_idx;
    } else {
        return Err("لا وضع مصدر للاستنساخ — بيئة عرض غير مدعومة للتنشيط البارد".into());
    }

    // وضع الهدف: السائق الخامل يعلن targetAvailable — وضع الهدف غالبًا موجود في
    // قائمة الأوضاع المرجعية (modeInfoIdx)؛ إن غاب نستنسخ من الهدف الأساسي.
    if q.paths[idx].target.mode_info_idx == PATH_MODE_IDX_INVALID {
        let primary_tgt_idx = q.paths[primary_active].target.mode_info_idx;
        if primary_tgt_idx != PATH_MODE_IDX_INVALID {
            let mut m = new_modes[primary_tgt_idx as usize];
            m.id = q.paths[idx].target.id;
            m.adapter = q.paths[idx].target.adapter;
            let tgt_idx = new_modes.len() as u32;
            new_modes.push(m);
            q.paths[idx].target.mode_info_idx = tgt_idx;
        }
    }

    q.paths[idx].flags |= PATH_ACTIVE; // تنشيط
    apply_config(&mut q.paths, &mut new_modes)?;

    // بعد التنشيط: جهاز GDI الفعلي + ضبط الوضع المطلوب (عمودي/أفقي)
    let gdi2 = {
        let q2 = query_paths(QDC_ONLY_ACTIVE_PATHS).map_err(|e| format!("CCD بعد التنشيط: {e}"))?;
        find_vdd_path(&q2).map(|(_, _, g)| g).unwrap_or_default()
    };
    let dev = if gdi2.is_empty() { gdi.clone() } else { gdi2 };
    if dev.is_empty() {
        return Err("نشط لكن بلا اسم جهاز GDI — أعد المحاولة".into());
    }
    let dims = list_monitors_ex().into_iter().find(|m| m.device == dev).map(|m| (m.w, m.h));
    if dims != Some((w, h)) {
        if !mode_available(&dev, w, h) {
            return Err(format!("الوضع {w}×{h}@60 غير متاح في السائق — أعد التثبيت ليكتب الأوضاع"));
        }
        change_mode(&dev, w, h)?;
    }
    finish_enable(dev, w, h)
}

#[cfg(windows)]
fn finish_enable(device: String, w: u32, h: u32) -> Result<EnabledInfo, String> {
    // انتظار قصير لتثبيت الطوبولوجيا ثم تحديد الفهرس من التعداد الحي
    for _ in 0..20 {
        let mons = list_monitors_ex();
        if let Some(m) = mons.iter().find(|m| m.device == device && m.w > 0 && m.h > 0) {
            return Ok(EnabledInfo {
                target_id: format!("screen:{}", m.index),
                ox: m.ox,
                oy: m.oy,
                w: m.w,
                h: m.h,
                device,
            });
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    Err("الشاشة الافتراضية لم تظهر في التعداد بعد التنشيط".into())
}

#[cfg(windows)]
fn win_disable(_device: &str) -> Result<(), String> {
    // إطفاء المسار الافتراضي من التهيئة (بلا صلاحيات) — النوافذ تعود للباقية
    let mut q = query_paths(QDC_ALL_PATHS).map_err(|e| format!("CCD: {e}"))?;
    let (idx, active, _gdi) = match find_vdd_path(&q) {
        Some(v) => v,
        None => return Ok(()), // زال أصلًا
    };
    if !active {
        return Ok(());
    }
    if q.paths.iter().filter(|p| p.flags & PATH_ACTIVE != 0).count() <= 1 {
        return Err("رفض الإطفاء: ستتبقى شاشات صفر — النظام لا يقبل ذلك".into());
    }
    q.paths[idx].flags &= !PATH_ACTIVE;
    apply_config(&mut q.paths, &mut q.modes)?;
    Ok(())
}

// ===========================================================================
// لينكس — xrandr: cvt/newmode/addmode/attach على مخرج غير متصل (X11 حصرًا)
// ===========================================================================
#[cfg(target_os = "linux")]
fn run_xrandr(args: &[String]) -> Result<String, String> {
    let out = std::process::Command::new("xrandr")
        .args(args)
        .output()
        .map_err(|e| format!("xrandr: {e}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    } else {
        Err(format!("xrandr {:?}: {}", args.first().unwrap_or(&String::new()), String::from_utf8_lossy(&out.stderr).trim()))
    }
}

#[cfg(target_os = "linux")]
fn linux_enable(w: u32, h: u32) -> Result<(i32, i32, u32, u32, String), String> {
    if std::env::var("DISPLAY").map(|v| v.is_empty()).unwrap_or(true) {
        return Err("لينكس: بلا جلسة X11 (DISPLAY فارغ) — Wayland غير مسند (موثق §19)".into());
    }
    let mode_name = core::xrandr_mode_name(w, h);
    let query = run_xrandr(&["--query".into()])?;
    let outs = core::parse_xrandr_query(&query, &mode_name);
    let pick = core::pick_disconnected_output(&outs)
        .ok_or("لا مخرجًا غير متصل — السائق يحتاج مخرجًا فارغًا (VIRTUAL1/DUMMY/إلخ — موثق §19)")?
        .name
        .clone();
    let primary = outs.iter().find(|o| o.primary && o.connected).map(|o| o.name.clone()).unwrap_or_default();

    // cvt → modeline (إن لم يكن وضعنا معرفًا على أي مخرج)
    if !outs.iter().any(|o| o.has_our_mode) && !query.contains(&mode_name) {
        let cvt = std::process::Command::new("cvt")
            .args([w.to_string(), h.to_string(), "60".to_string()])
            .output()
            .map_err(|e| format!("cvt: {e}"))?;
        let text = String::from_utf8_lossy(&cvt.stdout).to_string();
        let (mname, rest) = core::parse_cvt_modeline(&text).ok_or("cvt: لا Modeline في المخرج")?;
        // نستخدم اسم وضعنا الثابت (حذفه لاحقًا حتمي)
        let mut newmode = vec!["--newmode".to_string(), mode_name.clone()];
        newmode.extend(rest.split_whitespace().skip(1).map(|s| s.to_string())); // اسم cvt ثم التردد…
        let _ = run_xrandr(&newmode); // إن فشل (موجود) نكمل — addmode سيقرر
        let _ = mname;
    }
    for cmd in core::build_xrandr_setup(&mode_name, "", &pick, &primary) {
        if cmd.first().map(|s| s.as_str()) == Some("--newmode") {
            continue; // عالجناه أعلاه بوسائط cvt الكاملة
        }
        run_xrandr(&cmd)?;
    }
    // قراءة الهندسة الفعلية بعد الإلحاق
    for _ in 0..20 {
        if let Ok(q2) = run_xrandr(&["--query".into()]) {
            for line in q2.lines() {
                if let Some(rest) = line.strip_prefix(&format!("{pick} connected")) {
                    // "… connected 1080x2400+1920+0 …"
                    for tok in rest.split_whitespace() {
                        let g = parse_geom(tok);
                        if let Some((gw, gh, gx, gy)) = g {
                            return Ok((gx, gy, gw, gh, pick));
                        }
                    }
                }
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(150));
    }
    Err("أُلحق المخرج لكن بلا هندسة في xrandr — أعد المحاولة".into())
}

#[cfg(target_os = "linux")]
fn parse_geom(tok: &str) -> Option<(u32, u32, i32, i32)> {
    // "1920x1080+0+0"
    let (dim, pos) = tok.split_once('+')?;
    let (w, h) = dim.split_once('x')?;
    let (x, y) = pos.split_once('+')?;
    Some((w.parse().ok()?, h.parse().ok()?, x.parse().ok()?, y.parse().ok()?))
}

#[cfg(target_os = "linux")]
fn linux_disable(output: &str, w: u32, h: u32) -> Result<(), String> {
    let mode_name = core::xrandr_mode_name(w, h);
    for cmd in core::build_xrandr_teardown(&mode_name, output) {
        // rmmode قد يفشل إن كان الوضع مستخدمًا — الإطفاء هو الجوهري
        let _ = run_xrandr(&cmd);
    }
    Ok(())
}

// ===========================================================================
// التشخيص (§16 نمط diag) — الحالة تُستهلك مباشرة من لوحة التشخيص عبر
// أمر vdisplay_status (tools-view.tsx يجمعها في التصدير) — بلا غلاف زائد.
// ===========================================================================
