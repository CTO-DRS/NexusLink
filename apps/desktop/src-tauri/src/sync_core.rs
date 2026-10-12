// FA-files (عقد §14) — نواة مزامنة المجلدات النقية (بلا Tauri بلا notify)
// ============================================================
// تُضمَّن حرفيًا في محرك التحقق scripts/files-verify. المنطق:
// · اتجاه الكمبيوتر ← الهاتف: ملف محلي تغيّر → نسخ إلى pc-fs/Outbox/<pair>/<rel>
//   + عرض نقل send-file (tx:offer) — الهاتف ينزّله إلى Download/NexusLink/Sync/<pair>/<rel>.
// · اتجاه الهاتف ← الكمبيوتر: الهاتف يرفع إلى /Sync/<pair>/<rel> (جذر الوكيل)،
//   ومراقب الرست ينسخ الوارد إلى المجلد المحلي.
// · الحارس: لا تمرير ملفات كتبناها للتو (صدى)، وتخطي الملفات المؤقتة/المخفية،
//   والأحدث يفوز (LWW بحسب mtime)، والحذف لا ينتشر (حد موثق).

use serde_json::json;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug)]
pub struct PairCfg {
    pub id: String,
    pub name: String,
    pub local_dir: String,
    pub phone_dir: String,
    pub enabled: bool,
}

/// بناء الأزواج من status.desktop.sync.pars — تحقق صارم، الفاسد يُسقط بصمت.
pub fn pairs_from_status(v: &serde_json::Value) -> Vec<PairCfg> {
    let Some(arr) = v.pointer("/desktop/sync/pairs").and_then(|x| x.as_array()) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for p in arr {
        let Some(id) = p.get("id").and_then(|x| x.as_str()).map(String::from) else { continue };
        if id.is_empty() || id.len() > 48 { continue }
        let Some(local_dir) = p.get("localDir").and_then(|x| x.as_str()).map(String::from) else { continue };
        if local_dir.is_empty() { continue }
        out.push(PairCfg {
            id,
            name: p.get("name").and_then(|x| x.as_str()).unwrap_or("").to_string(),
            local_dir,
            phone_dir: p.get("phoneDir").and_then(|x| x.as_str()).unwrap_or("").to_string(),
            enabled: p.get("enabled").and_then(|x| x.as_bool()).unwrap_or(true),
        });
    }
    out
}

/// أسماء تُتجاهل كليًا (مؤقتات المكتب/المخفية/الجزئيات).
pub fn should_skip_name(name: &str) -> bool {
    if name.is_empty() { return true }
    if name.starts_with('.') { return true }
    if name.starts_with('~') { return true } // ~$doc.docx مؤقتات أوفيس
    matches!(name, "Thumbs.db" | ".DS_Store" | "desktop.ini")
}

/// المسار النسبي للملف تحت جذر الزوج (بفواصل /). None = خارج الجذر.
pub fn rel_of(root: &Path, p: &Path) -> Option<String> {
    let r = p.strip_prefix(root).ok()?;
    let s = r.to_string_lossy().replace('\\', "/");
    if s.is_empty() { None } else { Some(s) }
}

/// مسار التجهيز الافتراضي على السيرفر للزوج: /Outbox/<pairId>/<rel>
pub fn stage_vpath(pair_id: &str, rel: &str) -> String {
    format!("/Outbox/{}/{}", pair_id, rel.replace('\\', "/"))
}

/// جسم طلب send-file للعرض على الهاتف — نفس عقد §4.7/§8.3 حرفيًا.
/// srcPath يبدأ بـ /Outbox/ فيعرف الهاتف أن الهبوط في مجلد المزامنة.
pub fn offer_body(agent_id: &str, pair_id: &str, rel: &str, size: u64) -> serde_json::Value {
    let name = rel.rsplit('/').next().unwrap_or(rel).to_string();
    json!({
        "action": "send-file",
        "deviceId": agent_id,
        "deviceName": agent_id,
        "direction": "out",
        "srcDeviceId": "pc-office",
        "srcPath": stage_vpath(pair_id, rel),
        "fileName": name,
        "size": size,
    })
}

/// خطة نسخة واردة: من جذر الوكيل على الرست → المجلد المحلي.
pub struct InboundPlan {
    pub src: PathBuf,
    pub dst: PathBuf,
    /// true = وجهة موجودة وستُستبدل (تحديث)؛ false = جديد
    pub replace: bool,
}

/// قرار الوجهة الواردة — LWW: متطابق (حجم + mtime±1.5ث) → تخطَّ؛
/// المحلي أحدث → تخطَّ (المراقب المحلي سيرسله للهاتف)؛ الوارد أحدث أو الملف جديد → انسخ.
#[allow(clippy::too_many_arguments)]
pub fn inbound_plan(
    local_root: &Path,
    agent_sync_root: &Path,
    rel: &str,
    local_exists: bool,
    local_mtime_ms: i64,
    local_size: u64,
    remote_mtime_ms: i64,
    remote_size: u64,
) -> Option<InboundPlan> {
    if rel.is_empty() { return None }
    if rel.split('/').any(should_skip_name) { return None }
    let src = agent_sync_root.join(rel.replace('/', std::path::MAIN_SEPARATOR_STR));
    let dst = local_root.join(rel.replace('/', std::path::MAIN_SEPARATOR_STR));
    if !local_exists {
        return Some(InboundPlan { src, dst, replace: false });
    }
    let same = local_size == remote_size && (local_mtime_ms - remote_mtime_ms).abs() < 1500;
    if same {
        return None; // متطابقان — لا عمل
    }
    if local_mtime_ms > remote_mtime_ms {
        return None; // المحلي أحدث — يخرج في الاتجاه الآخر
    }
    Some(InboundPlan { src, dst, replace: true })
}

/// حارس الصدى: هل هذا الملف خرج من هذا الجهاز خلال النافذة؟ (افتراضي 6 ثوانٍ)
pub fn is_self_write(recent: &[(String, i64)], rel: &str, now_ms: i64, window_ms: i64) -> bool {
    recent.iter().any(|(r, t)| r == rel && now_ms - *t < window_ms)
}

/// تسجيل خروج محلي — يحافظ على القائمة ≤ 256 عنصرًا.
pub fn record_out(recent: &mut Vec<(String, i64)>, rel: &str, now_ms: i64) {
    if let Some(slot) = recent.iter_mut().find(|(r, _)| r == rel) {
        slot.1 = now_ms;
    } else {
        recent.push((rel.to_string(), now_ms));
        if recent.len() > 256 {
            recent.drain(..recent.len() - 256);
        }
    }
}

/// نتيجة تجهيز صادر
pub struct OutResult {
    pub staged_abs: PathBuf,
    pub size: u64,
}

/// تجهيز ملف صادر: نسخ محلي → pc-fs/Outbox/<pair>/<rel> (نفس قرار sync.rs).
/// None = لا شيء (مؤقت/كبير/غير موجود). max_bytes = 0 بلا حد.
pub fn process_outgoing(
    local_root: &Path,
    outbox_root: &Path,
    rel: &str,
    max_bytes: u64,
) -> Option<OutResult> {
    if rel.is_empty() { return None }
    if rel.split('/').any(should_skip_name) { return None }
    let src = local_root.join(rel.replace('/', std::path::MAIN_SEPARATOR_STR));
    let st = std::fs::metadata(&src).ok()?;
    if !st.is_file() { return None }
    let size = st.len();
    if max_bytes > 0 && size > max_bytes {
        return None;
    }
    let dst = outbox_root.join(rel.replace('/', std::path::MAIN_SEPARATOR_STR));
    if let Some(parent) = dst.parent() {
        std::fs::create_dir_all(parent).ok()?;
    }
    std::fs::copy(&src, &dst).ok()?;
    Some(OutResult { size, staged_abs: dst })
}

/// vpath التجهيز الصحيح لزوج معروف (تستخدمها الطبقة الأصلية بعد process_outgoing)
pub fn staged_vpath_for(pair_id: &str, rel: &str) -> String {
    stage_vpath(pair_id, rel)
}
