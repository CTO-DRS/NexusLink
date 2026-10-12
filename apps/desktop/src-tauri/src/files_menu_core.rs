// FA-files (عقد §14) — نواة نقية لدمج ملفات نظام التشغيل (بلا Tauri)
// ============================================================
// تُضمَّن حرفيًا في محرك التحقق scripts/files-verify (نمط input_exec.rs):
// · مواصفات قائمة سياق Windows (Registry) — مفاتيح/أوامر/تسمية عربية
// · جمع مسارات --send من سطر الأوامر (المثيل الأول أو المُمرَّرة من الثاني)
// · نواة البث التقدّمي: عتبة الفتح + تحليل Content-Range + تعقيم الأسماء

use std::io::{Read, Write};
use std::path::PathBuf;

/// مواصفات قائمة الزر الأيمن — تُطبَّق على HKCU (بلا صلاحيات مدير).
pub struct MenuSpec {
    /// HKCU\Software\Classes\*\shell\NexusLink — كل الملفات
    pub key_file: String,
    /// HKCU\Software\Classes\Directory\shell\NexusLink — المجلدات
    pub key_dir: String,
    /// قيمة الافتراضي (التسمية الظاهرة عربيًا)
    pub verb: String,
    /// قيمة Icon — أيقونة التطبيق نفسه
    pub icon: String,
    /// قيمة المفتاح الفرعي command
    pub command: String,
}

/// بناء المواصفات من مسار التنفيذي — الأمر يمرر %1 (أول عنصر محدد).
/// ملاحظة موثقة: تعدد التحديد الفعلي يتطلب COM DelegateExecute — خارج النطاق،
/// الاختيار المتعدد يمرر أول ملف فقط (حد المنصة موثق في §14).
pub fn menu_spec(exe: &str) -> MenuSpec {
    MenuSpec {
        key_file: r"Software\Classes\*\shell\NexusLink".to_string(),
        key_dir: r"Software\Classes\Directory\shell\NexusLink".to_string(),
        verb: "إرسال عبر NexusLink".to_string(),
        icon: exe.to_string(),
        command: format!("\"{}\" --send \"%1\"", exe),
    }
}

/// جمع مسارات --send من أرجف سطر الأوامر: كل مسار يلي --send مباشرة
/// (حتى وسيط -- آخر). عدة --send = عدة مسارات (قائمة الزر الأيمن تمرر واحدة).
pub fn collect_send_paths(args: &[String]) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut take = false;
    for a in args {
        if a == "--send" {
            take = true;
            continue;
        }
        if a.starts_with('-') {
            take = false;
            continue;
        }
        if take {
            let p = PathBuf::from(a);
            if !p.as_os_str().is_empty() {
                out.push(p);
            }
            take = false; // مسار واحد بعد كل --send (الاقتباس يحمي المسافات)
        }
    }
    out
}

/// تعقيم اسم ملف للبث (مجلد مؤقت) — يبقي الامتداد ليشتغل ربط اللاعب الافتراضي.
pub fn sanitize_stream_name(name: &str) -> String {
    let mut s: String = name
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => c,
        })
        .collect();
    let s2 = s.trim().to_string();
    if s2.is_empty() || s2 == "." {
        s = format!("stream-{}", std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0));
    } else {
        s = s2;
    }
    if s.len() > 120 {
        // احفظ الامتداد عند القص
        let dot = s.rfind('.');
        s = match dot {
            Some(i) if i > 0 => format!("{}{}", &s[..100.min(i)], &s[i..]),
            _ => s[..100].to_string(),
        };
    }
    s
}

/// ترويسة Range لطلب بايتات من إزاحة معينة.
pub fn range_header(offset: u64) -> String {
    format!("bytes={}-", offset)
}

/// تحليل ترويسة Content-Range: bytes=<start>-<end>/<total> → (start, total)
pub fn parse_content_range(v: &str) -> Option<(u64, u64)> {
    let s = v.trim();
    let s = if let Some(x) = s.strip_prefix("bytes ") {
        x
    } else if let Some(x) = s.strip_prefix("bytes=") {
        x
    } else {
        return None;
    };
    let mut it = s.split('/');
    let range = it.next()?.trim();
    let total = it.next()?.trim().parse::<u64>().ok()?;
    let start = range.split('-').next()?.trim().parse::<u64>().ok()?;
    Some((start, total))
}

/// عتبة فتح الملف المؤقت في المشغّل: كفاية بايتات أو كفاية زمن.
#[derive(Clone, Copy, Debug)]
pub struct OpenThreshold {
    pub after_bytes: u64,
    pub after_ms: u128,
}

pub const DEFAULT_THRESHOLD: OpenThreshold = OpenThreshold { after_bytes: 2 * 1024 * 1024, after_ms: 1500 };

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum OpenDecision {
    Wait,
    Open,
}

pub fn open_decision(bytes_written: u64, elapsed_ms: u128, th: OpenThreshold) -> OpenDecision {
    if bytes_written >= th.after_bytes || elapsed_ms >= th.after_ms {
        OpenDecision::Open
    } else {
        OpenDecision::Wait
    }
}

/// حلقة البث التقدّمي النقية (تُضمَّن في محرك التحقق حرفيًا):
/// تقرأ من أي Reader وتكتب في أي Writer، تُطلق on_open مرة واحدة عند العتبة،
/// وتحترم الإلغاء. تعيد (مكتوب، الإجمالي المعلوم أو 0).
pub fn pump_stream<R: Read, W: Write>(
    reader: &mut R,
    writer: &mut W,
    total_hint: u64,
    cancel: &dyn Fn() -> bool,
    on_open: &mut dyn FnMut(u64),
    th: OpenThreshold,
) -> Result<(u64, u64), String> {
    let mut buf = [0u8; 64 * 1024];
    let mut written: u64 = 0;
    let started = std::time::Instant::now();
    let mut opened = false;
    loop {
        if cancel() {
            return Ok((written, total_hint));
        }
        let n = reader.read(&mut buf).map_err(|e| format!("قراءة البث: {e}"))?;
        if n == 0 {
            break;
        }
        writer.write_all(&buf[..n]).map_err(|e| format!("كتابة مؤقت: {e}"))?;
        written += n as u64;
        if !opened {
            if let OpenDecision::Open = open_decision(written, started.elapsed().as_millis(), th) {
                opened = true;
                on_open(written);
            }
        }
    }
    Ok((written, if total_hint > 0 { total_hint } else { written }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spec_quoting() {
        let m = menu_spec("C:\\Program Files\\NexusLink\\NexusLink.exe");
        assert_eq!(m.command, "\"C:\\Program Files\\NexusLink\\NexusLink.exe\" --send \"%1\"");
        assert!(m.verb.contains("NexusLink"));
    }

    #[test]
    fn cli_collect() {
        let a: Vec<String> = ["exe", "--send", "C:\\a b.txt", "--hidden"]
            .iter().map(|s| s.to_string()).collect();
        assert_eq!(collect_send_paths(&a), vec![PathBuf::from("C:\\a b.txt")]);
        let b: Vec<String> = ["exe".into(), "--send".into(), "/tmp/x".into()].iter().map(|s| s.to_string()).collect();
        assert_eq!(collect_send_paths(&b).len(), 1);
        assert!(collect_send_paths(&["exe".to_string()]).is_empty());
    }

    #[test]
    fn names_and_ranges() {
        assert_eq!(sanitize_stream_name("فيلم: حكاية.mp4"), "فيلم_ حكاية.mp4");
        assert_eq!(parse_content_range("bytes 100-199/500"), Some((100, 500)));
        assert_eq!(parse_content_range("bytes=0-0/3"), Some((0, 3)));
        assert_eq!(range_header(42), "bytes=42-");
    }
}
