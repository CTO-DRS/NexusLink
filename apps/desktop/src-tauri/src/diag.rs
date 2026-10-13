// NexusLink Desktop — التشخيص الأصلي (FA-harden — عقد §16 بند 5)
// ============================================================
// أدوات المرحلة 11 من الجولة 1 «تعمل أصلًا»:
// · diag_sidecar_ports — فحص فعلي لكل منافذ الجسور من الطبقة الأصلية نفسها
//   (اتصال TCP حقيقي + زمن استجابة) — العقد §1: 3000/3003/3004/3005/3006/3007/3009/81.
// · diag_speed_test — قياس نقل حقيقي من محرك Rust (وليس المتصفح): تنزيل
//   24MB ورفع 8MB من/إلى /api/tools/speedtest على النواة المحلية.
// · diag_export — تصدير التقرير إلى ملف يختاره المستخدم (حوار نظام أصلي).
use serde_json::json;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::{Duration, Instant};

/// منافذ العقد §1 — (port, role عربي)
const SIDECAR_PORTS: &[(u16, &str)] = &[
    (3000, "النواة (واجهة + REST)"),
    (3003, "جسر الاتصالات"),
    (3004, "جسر التحكم عن بُعد"),
    (3005, "جسر الوسائط"),
    (3006, "جسر الحماية"),
    (3007, "جسر الإنتاجية"),
    (3009, "جسر التشفير E2E"),
    (81, "البوابة العامة (caddy)"),
];

/// فحص منفذ واحد: TCP connect + زمن الاستجابة (من الأصلي — لا متصفح)
fn probe_tcp(port: u16) -> (bool, u128) {
    let t0 = Instant::now();
    match TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
        Duration::from_millis(1200),
    ) {
        Ok(s) => (true, t0.elapsed().as_millis()),
        Err(_) => (false, t0.elapsed().as_millis()),
    }
}

#[tauri::command]
pub fn diag_sidecar_ports() -> serde_json::Value {
    let ports: Vec<serde_json::Value> = SIDECAR_PORTS
        .iter()
        .map(|(p, role)| {
            let (ok, ms) = probe_tcp(*p);
            json!({ "port": p, "role": role, "ok": ok, "ms": ms })
        })
        .collect();
    let up = ports.iter().filter(|p| p["ok"].as_bool().unwrap_or(false)).count();
    json!({ "ports": ports, "up": up, "total": SIDECAR_PORTS.len() })
}

/// قياس سرعة حقيقي من محرك Rust — تنزيل ثم رفع (HTTP/1.1 محلي)
/// النواة تسكب بايتات عشوائية في GET وتلتهم المرفوع في POST (نفس مسار
/// أدوات المرحلة 11 — عقد §16).
fn speed_once(bytes: usize, download: bool) -> Result<f64, String> {
    // نفس مسار أدوات المرحلة 11 حرفيًا (عقد §16): GET ?bytes=N للتنزيل وPOST للرفع
    let url = format!("http://127.0.0.1:3000/api/tools/speedtest?bytes={bytes}");
    let t0 = Instant::now();
    if download {
        let mut resp = ureq::get(&url)
            .call()
            .map_err(|e| format!("تنزيل: {e}"))?;
        let mut total = 0usize;
        let mut buf = [0u8; 64 * 1024];
        loop {
            let n = resp.read(&mut buf).map_err(|e| format!("قراءة: {e}"))?;
            if n == 0 {
                break;
            }
            total += n;
        }
        let secs = t0.elapsed().as_secs_f64();
        if secs <= 0.0 || total == 0 {
            return Err("قياس فارغ".into());
        }
        Ok(total as f64 / 1048576.0 / secs)
    } else {
        // الرفع: مقبس مباشر بطلب POST يدوي — ureq مع body كبير في الذاكرة أثقل
        let payload = vec![0x5Au8; 256 * 1024]; // عشوائية غير ضرورية للقياس
        let mut stream = TcpStream::connect("127.0.0.1:3000").map_err(|e| e.to_string())?;
        stream
            .set_write_timeout(Some(Duration::from_secs(20)))
            .ok();
        let head = format!(
            "POST /api/tools/speedtest?bytes={bytes} HTTP/1.1\r\n\
             Host: 127.0.0.1:3000\r\nContent-Type: application/octet-stream\r\n\
             Content-Length: {bytes}\r\nConnection: close\r\n\r\n"
        );
        stream.write_all(head.as_bytes()).map_err(|e| e.to_string())?;
        let mut sent = 0usize;
        while sent < bytes {
            let take = payload.len().min(bytes - sent);
            stream.write_all(&payload[..take]).map_err(|e| e.to_string())?;
            sent += take;
        }
        // قراءة الرد حتى الإغلاق (لتجنب RST قبل استهلاك الخادم)
        let mut resp = Vec::new();
        let _ = stream.read_to_end(&mut resp);
        let secs = t0.elapsed().as_secs_f64();
        if secs <= 0.0 {
            return Err("قياس فارغ".into());
        }
        Ok(bytes as f64 / 1048576.0 / secs)
    }
}

#[tauri::command]
pub fn diag_speed_test() -> serde_json::Value {
    // مكتمل بالأخطاء بصدق — النواة غير جاهزة (إقلاع) يعيد ok=false
    let down = speed_once(24 * 1024 * 1024, true);
    let up = speed_once(8 * 1024 * 1024, false);
    let (down_mbs, down_err) = match down {
        Ok(v) => (Some((v * 100.0).round() / 100.0), None),
        Err(e) => (None, Some(e)),
    };
    let (up_mbs, up_err) = match up {
        Ok(v) => (Some((v * 100.0).round() / 100.0), None),
        Err(e) => (None, Some(e)),
    };
    crate::audit::audit(
        "diag",
        "info",
        format!(
            "قياس سرعة أصلي: تنزيل {} ميجابايت/ث · رفع {} ميجابايت/ث",
            down_mbs.map(|v| v.to_string()).unwrap_or_else(|| "—".into()),
            up_mbs.map(|v| v.to_string()).unwrap_or_else(|| "—".into()),
        ),
    );
    json!({
        "ok": down_mbs.is_some() || up_mbs.is_some(),
        "downMBs": down_mbs,
        "upMBs": up_mbs,
        "downError": down_err,
        "upError": up_err,
        "at": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0),
    })
}

/// تصدير التقرير إلى مسار مطلق (حوار الحفظ من الواجهة عبر tauri-plugin-dialog)
#[tauri::command]
pub fn diag_export(path: String, content: String) -> serde_json::Value {
    if path.trim().is_empty() {
        return json!({ "ok": false, "error": "مسار فارغ" });
    }
    match std::fs::write(&path, content.as_bytes()) {
        Ok(_) => {
            crate::audit::audit("diag", "info", format!("تصدير تقرير التشخيص إلى {path}"));
            json!({ "ok": true, "path": path, "bytes": content.len() })
        }
        Err(e) => json!({ "ok": false, "error": format!("كتابة: {e}") }),
    }
}

/// حالة الخمول الحقيقية من الطبقة الأصلية (لعرضها في التشخيص) — بند 4
#[tauri::command]
pub fn diag_idle_state() -> serde_json::Value {
    let secs = crate::idle::idle_secs();
    json!({
        "idleSecs": secs.map(|s| (s * 10.0).round() / 10.0),
        "idleMode": crate::idle::is_idle_mode(),
        "locked": crate::lock::is_locked(),
        "platform": std::env::consts::OS,
    })
}

// ----------------------------------------------------------------------------
// قرار الخمول الخالص انتقل إلى harden_core (مُختبر في hardening-verify) —
// idle.rs يستدعيه مباشرة: crate::harden_core::idle_decision.
// ----------------------------------------------------------------------------
