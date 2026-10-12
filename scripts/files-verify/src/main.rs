#![allow(dead_code)]

fn handle_conn(mut s: std::net::TcpStream, payload: &[u8]) {
    s.set_nonblocking(false).unwrap();
    let _ = s.set_read_timeout(Some(Duration::from_secs(3)));
    let mut buf = [0u8; 8192];
    let mut req = String::new();
    while let Ok(n) = s.read(&mut buf) {
        if n == 0 { break }
        req.push_str(&String::from_utf8_lossy(&buf[..n]));
        if req.contains("\r\n\r\n") { break }
    }
    let first = req.split("\r\n").next().unwrap_or("");
    let path = first.split_whitespace().nth(1).unwrap_or("/");
    let token_ok = path.contains("token=sekret12345");
    if !token_ok {
        let _ = s.write_all(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 12\r\nConnection: close\r\n\r\n");
        let _ = s.write_all(b"unauthorized");
        return;
    }
    let range_start = req
        .to_lowercase()
        .split("\r\n")
        .find_map(|l| l.strip_prefix("range: bytes="))
        .and_then(|v| v.split('-').next())
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(0);
    let body = &payload[range_start.min(payload.len())..];
    let resp = format!(
        "HTTP/1.1 206 Partial Content\r\nContent-Type: video/mp4\r\nContent-Range: bytes {range_start}-{}/{total}\r\nContent-Length: {blen}\r\nAccept-Ranges: bytes\r\nConnection: close\r\n\r\n",
        payload.len() - 1,
        total = payload.len(),
        blen = body.len(),
    );
    let _ = s.write_all(resp.as_bytes());
    let _ = s.write_all(body);
}

// محرك التحقق الفعلي لدمج الملفات في نظام التشغيل (FA-files عقد §14)
// ============================================================
// يشغّل النواة النقية الحقيقية (files_menu_core.rs + sync_core.rs) — include! حرفي
// (نمط enigo-verify، بلا نسخ ولا تزييف) ويضيف:
// · مضخة بث تقدّمي حقيقية ضد خادم HTTP محلي يدعم Range (206) — نفس عقد /stream الهاتفي
// · مزامنة حقيقية بمجلدات مؤقتة: صادر (تجهيز + عرض JSON صحيح) + وارد (LWW) + حارس صدى
// · مواصفات قائمة سياق Windows (اقتباس الأوامر + العربية) وأرجف --send

mod fmc {
    include!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../apps/desktop/src-tauri/src/files_menu_core.rs"));
}
mod sc {
    include!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../apps/desktop/src-tauri/src/sync_core.rs"));
}

use fmc::{
    collect_send_paths, menu_spec, open_decision, parse_content_range, pump_stream, range_header,
    sanitize_stream_name, OpenDecision, OpenThreshold, DEFAULT_THRESHOLD,
};
use sc::{
    inbound_plan, is_self_write, offer_body, pairs_from_status, process_outgoing, record_out,
    rel_of, should_skip_name, staged_vpath_for,
};
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use notify::Watcher as _;

static PASS: AtomicUsize = AtomicUsize::new(0);
static FAIL: AtomicUsize = AtomicUsize::new(0);

fn ok(name: &str, cond: bool, detail: &str) {
    if cond {
        PASS.fetch_add(1, Ordering::SeqCst);
        println!("✅ {name}{}", if detail.is_empty() { String::new() } else { format!(" — {detail}") });
    } else {
        FAIL.fetch_add(1, Ordering::SeqCst);
        println!("❌ {name} — {detail}");
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn write_file(p: &Path, bytes: &[u8]) {
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d).unwrap();
    }
    std::fs::write(p, bytes).unwrap();
}

// ---------------------------------------------------------------------------
// 1) قائمة سياق Windows + أرجف --send
// ---------------------------------------------------------------------------
fn check_menu_spec() {
    println!("\n== قائمة الزر الأيمن (Registry spec) ==");
    let exe = r"C:\Program Files\NexusLink\NexusLink.exe";
    let m = menu_spec(exe);
    ok("مفتاح الملفات النجمي", m.key_file == r"Software\Classes\*\shell\NexusLink", &m.key_file);
    ok("مفتاح المجلدات", m.key_dir == r"Software\Classes\Directory\shell\NexusLink", &m.key_dir);
    ok("التسمية العربية", m.verb == "إرسال عبر NexusLink", &m.verb);
    ok(
        "اقتباس الأمر مع مسافات + %1",
        m.command == format!("\"{exe}\" --send \"%1\""),
        &m.command,
    );
    ok("الأيقونة = التنفيذي", m.icon == exe, &m.icon);

    // أرجف قائمة السياق (المثيل الثاني → الأول)
    let a: Vec<String> = ["NexusLink.exe", "--send", "C:\\المجلد\\ملف عربي.txt", "--hidden"]
        .iter().map(|s| s.to_string()).collect();
    let paths = collect_send_paths(&a);
    ok("جمع --send مع عربية ومسافات", paths.len() == 1 && paths[0].to_string_lossy().contains("ملف عربي"), &format!("{paths:?}"));
    let b: Vec<String> = vec!["exe".to_string(), "--send".to_string(), "/tmp/x".to_string()];
    ok("--send وحيد", collect_send_paths(&b).len() == 1, "");
    ok("بلا --send = لا شيء", collect_send_paths(&["exe".to_string()]).is_empty(), "");
    let c: Vec<String> = vec!["exe".to_string(), "--hidden".to_string(), "not-a-send".to_string()];
    ok("مخفي لا يلتقط مسارات", collect_send_paths(&c).is_empty(), "");
}

// ---------------------------------------------------------------------------
// 2) أسماء البث وتحليل Range وعتبة الفتح
// ---------------------------------------------------------------------------
fn check_stream_core() {
    println!("\n== نواة البث ==");
    ok("تعقيم النقطتين", sanitize_stream_name("فيلم: تجربة.mp4") == "فيلم_ تجربة.mp4", "");
    ok("تعقيم الفواصل", !sanitize_stream_name("a/b\\c:d*e?f\"g<h>i|j.mp4").contains(['/','\\',':','*','?','"','<','>','|']), "");
    ok("اسم فارغ → بديل", sanitize_stream_name("  ").starts_with("stream-"), "");
    ok("Content-Range كامل", parse_content_range("bytes 100-199/500") == Some((100, 500)), "");
    ok("Content-Range صيغة أخرى", parse_content_range("bytes=0-0/3") == Some((0, 3)), "");
    ok("ترويسة Range", range_header(42) == "bytes=42-", "");

    let th = OpenThreshold { after_bytes: 1000, after_ms: 10_000 };
    ok("عتبة: انتظار تحت الحد", open_decision(999, 0, th) == OpenDecision::Wait, "");
    ok("عتبة: فتح عند الحد", open_decision(1000, 0, th) == OpenDecision::Open, "");
    ok("عتبة: فتح بالزمن", open_decision(0, 10_001, th) == OpenDecision::Open, "");
    ok("عتبة الافتراضي 2MB", DEFAULT_THRESHOLD.after_bytes == 2 * 1024 * 1024, "");
}

// ---------------------------------------------------------------------------
// 3) مضخة البث الحقيقية + خادم Range محلي (عقد /stream للهاتف)
// ---------------------------------------------------------------------------
fn make_range_server(payload: Vec<u8>) -> (u16, Arc<AtomicBool>) {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let shutdown = Arc::new(AtomicBool::new(false));
    let sd2 = shutdown.clone();
    std::thread::spawn(move || {
        listener.set_nonblocking(true).unwrap();
        while !sd2.load(Ordering::SeqCst) {
            match listener.accept() {
                Ok((s, _)) => {
                    // خيط لكل اتصال — الخادم الحقيقي كذلك (قفل ميت موثق: كتابة جسم 2.5MB محجوبة
                    // والعميل الأول لم يبدأ القراءة بعد والثاني ينتظر القبول)
                    let p2 = payload.clone();
                    std::thread::spawn(move || {
                        handle_conn(s, &p2);
                    });
                }
                Err(_) => std::thread::sleep(Duration::from_millis(20)),
            }
        }
    });
    (port, shutdown)
}

fn check_pump_real_http() {
    println!("\n== بث تقدّمي فعلي ضد خادم Range محلي ==");
    // 2.5MB — أكبر من عتبة 2MB → on_open يجب أن يُطلق مرة واحدة
    let payload: Vec<u8> = (0..2_621_440usize).map(|i| (i % 251) as u8).collect();
    let (port, shutdown) = make_range_server(payload.clone());
    let url = format!("http://127.0.0.1:{port}/stream?token=sekret12345&path=%2FMovies%2Fvid.mp4");

    let temp = std::env::temp_dir().join(format!("files-verify-{}.mp4", std::process::id()));
    let resp = ureq::get(&url)
        .set("Range", &range_header(0))
        .call()
        .expect("connect");
    ok("رمز غير صالح يُرفض", {
        let bad = ureq::get(&format!("http://127.0.0.1:{port}/stream?token=wrong9999&path=x"))
            .call();
        matches!(bad, Err(ureq::Error::Status(403, _)))
    }, "");
    let total = parse_content_range(resp.header("Content-Range").unwrap()).map(|(_, t)| t).unwrap_or(0);
    ok("206 مع إجمالي صحيح", total == payload.len() as u64, &format!("{total}"));
    let mut reader = resp.into_reader();
    let mut file = std::fs::File::create(&temp).unwrap();
    let opens = Arc::new(AtomicUsize::new(0));
    let opens2 = opens.clone();
    let cancel = Arc::new(AtomicBool::new(false));
    let (written, _known) = pump_stream(
        &mut reader,
        &mut file,
        total,
        &|| cancel.load(Ordering::SeqCst),
        &mut move |at| {
            opens2.fetch_add(1, Ordering::SeqCst);
            assert!(at >= DEFAULT_THRESHOLD.after_bytes, "الفتح قبل العتبة: {at}");
        },
        DEFAULT_THRESHOLD,
    )
    .expect("pump");
    ok("اكتمل البث كاملًا", written == payload.len() as u64, &format!("{written}"));
    ok("on_open مرة واحدة", opens.load(Ordering::SeqCst) == 1, &format!("{} مرة", opens.load(Ordering::SeqCst)));
    ok("الملف المؤقت مطابق بالبايتات", std::fs::read(&temp).unwrap() == payload, "");
    std::fs::remove_file(&temp).ok();
    shutdown.store(true, Ordering::SeqCst);

    // الإلغاء منتصف البث
    let (port2, sd2) = make_range_server(payload.clone());
    let resp2 = ureq::get(&format!("http://127.0.0.1:{port2}/stream?token=sekret12345&path=x"))
        .set("Range", &range_header(0))
        .call()
        .unwrap();
    let mut reader2 = resp2.into_reader();
    let mut sink: Vec<u8> = Vec::new();
    let c2 = Arc::new(AtomicBool::new(true));
    let (w2, _) = pump_stream(&mut reader2, &mut sink, payload.len() as u64, &|| c2.load(Ordering::SeqCst), &mut |_| {}, DEFAULT_THRESHOLD).unwrap();
    ok("الإلغاء فوري قبل القراءة", w2 == 0, &format!("{w2}"));
    sd2.store(true, Ordering::SeqCst);
}

// ---------------------------------------------------------------------------
// 4) مزامنة المجلدات — الصادر والوارد والحارس (ملفات حقيقية)
// ---------------------------------------------------------------------------
fn check_sync_core() {
    println!("\n== نواة مزامنة المجلدات ==");
    let tmp = std::env::temp_dir().join(format!("files-sync-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    let local = tmp.join("local");
    let outbox = tmp.join("pc-fs").join("Outbox").join("pair-1");
    let agent_sync = tmp.join("agents").join("galaxy-s24").join("Sync").join("pair-1");
    std::fs::create_dir_all(&local).unwrap();

    // pairs_from_status
    let status = serde_json::json!({"desktop": {"sync": {"pairs": [
        {"id": "pair-1", "name": "مشروع", "localDir": local.to_string_lossy(), "phoneDir": "/Sync/pair-1", "enabled": true},
        {"id": "", "localDir": "x"},
        {"id": "pair-2", "localDir": ""},
        {"id": "pair-3", "name": "معطل", "localDir": "/nowhere", "enabled": false}
    ]}}});
    let pairs = pairs_from_status(&status);
    ok("تحليل الأزواج: 1 صالح + 1 معطل", pairs.len() == 2, &format!("{}", pairs.len()));
    ok("الزوج الصالح كامل", pairs[0].id == "pair-1" && pairs[0].enabled && pairs[0].phone_dir == "/Sync/pair-1", "");

    // الصادر: ملف عادي
    let data: Vec<u8> = "hello sync مرحبا".as_bytes().to_vec().repeat(10);
    write_file(&local.join("docs/تقرير.txt"), &data);
    let out = process_outgoing(&local, &outbox, "docs/تقرير.txt", 200 * 1024 * 1024).expect("outgoing");
    ok("تجهيز الصادر بنسخ حقيقي", std::fs::read(&out.staged_abs).unwrap() == data, "");
    ok("حجم الصادر صحيح", out.size == data.len() as u64, "");
    let vp = staged_vpath_for("pair-1", "docs/تقرير.txt");
    ok("vpath التجهيز", vp == "/Outbox/pair-1/docs/تقرير.txt", &vp);

    // جسم العرض — عقد §4.7/§8.3 حرفيًا
    let agent = "galaxy-s24";
    let body = offer_body(agent, "pair-1", "docs/تقرير.txt", out.size);
    ok("عرض: الاتجاه out", body["direction"] == "out", "");
    ok("عرض: المصدر pc-office", body["srcDeviceId"] == "pc-office", "");
    ok("عرض: المسار يبدأ /Outbox/<pair>", body["srcPath"] == "/Outbox/pair-1/docs/تقرير.txt", &format!("{}", body["srcPath"]));
    ok("عرض: الهدف هو الوكيل", body["deviceId"] == "galaxy-s24", "");
    ok("عرض: الاسم الأساسي فقط", body["fileName"] == "تقرير.txt", "");

    // استثناءات الصادر
    ok("تخطي مخفي", process_outgoing(&local, &outbox, ".DS_Store", 0).is_none(), "");
    write_file(&local.join(".env"), b"x");
    ok("تخطي dotfile", process_outgoing(&local, &outbox, ".env", 0).is_none(), "");
    write_file(&local.join("~tmp.docx"), b"x");
    ok("تخطي مؤقت أوفيس", process_outgoing(&local, &outbox, "~tmp.docx", 0).is_none(), "");
    ok("تخطي كبير (حد 10 بايت)", process_outgoing(&local, &outbox, "docs/تقرير.txt", 10).is_none(), "");
    ok("مسار غير موجود", process_outgoing(&local, &outbox, "no/such.bin", 0).is_none(), "");

    // الوارد: هاتف يرفع ملفًا جديدًا → خطة نسخ
    let phone_data = b"from phone".to_vec();
    write_file(&agent_sync.join("صور/صورة.png"), &phone_data);
    let plan = inbound_plan(&local, &agent_sync, "صور/صورة.png", false, 0, 0, now_ms(), phone_data.len() as u64);
    ok("وارد جديد → نسخ", plan.is_some(), "");
    let plan = plan.unwrap();
    std::fs::create_dir_all(plan.dst.parent().unwrap()).unwrap();
    std::fs::copy(&plan.src, &plan.dst).unwrap();
    ok("الوارد هبط فعليًا", std::fs::read(plan.dst.clone()).unwrap() == phone_data, "");

    // متطابقان → لا عمل
    let (mt, sz) = file_meta(&plan.dst);
    let again = inbound_plan(&local, &agent_sync, "صور/صورة.png", true, mt, sz, mt, sz);
    ok("متطابقان → تخطٍ", again.is_none(), "");

    // المحلي أحدث → لا نسخ (سيخرج في الاتجاه الآخر)
    std::thread::sleep(Duration::from_millis(30));
    write_file(&plan.dst.clone(), b"newer local edit");
    let (mt2, sz2) = file_meta(&plan.dst);
    let (rmt, _) = file_meta(&agent_sync.join("صور/صورة.png"));
    ok("المحلي أحدث → تخطٍ", inbound_plan(&local, &agent_sync, "صور/صورة.png", true, mt2, sz2, rmt, 10).is_none(), "");

    // الوارد أحدث → استبدال
    std::thread::sleep(Duration::from_millis(30));
    write_file(&agent_sync.join("صور/صورة.png"), b"phone edits second");
    let (rmt2, rsz2) = file_meta(&agent_sync.join("صور/صورة.png"));
    let (lmt2, lsz2) = file_meta(&plan.dst);
    let plan2 = inbound_plan(&local, &agent_sync, "صور/صورة.png", true, lmt2, lsz2, rmt2, rsz2);
    ok("الوارد أحدث → استبدال", plan2.map(|p| p.replace) == Some(true), "");

    // حارس الصدى
    let mut recent: Vec<(String, i64)> = Vec::new();
    record_out(&mut recent, "docs/تقرير.txt", now_ms());
    ok("صدى داخل النافذة", is_self_write(&recent, "docs/تقرير.txt", now_ms(), 6000), "");
    ok("صدى خارج النافذة", !is_self_write(&recent, "docs/تقرير.txt", now_ms() + 7000, 6000), "");
    ok("ملف آخر لا صدى", !is_self_write(&recent, "other.bin", now_ms(), 6000), "");

    // rel_of وshould_skip_name
    ok("rel_of مسار داخلي", rel_of(Path::new(&local), &local.join("a/b.txt")).as_deref() == Some("a/b.txt"), "");
    ok("rel_of خارجي None", rel_of(Path::new(&local), Path::new("/elsewhere/a")).is_none(), "");
    for n in [".x", "~doc", "Thumbs.db", ".DS_Store"] {
        ok(&format!("تخطي {n}"), should_skip_name(n), "");
    }
    ok("اسم عادي مقبول", !should_skip_name("تقرير.txt"), "");

    let _ = std::fs::remove_dir_all(&tmp);
}

fn file_meta(p: &Path) -> (i64, u64) {
    let st = std::fs::metadata(p).unwrap();
    (
        st.modified().unwrap().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0),
        st.len(),
    )
}

// ---------------------------------------------------------------------------
// 5) مراقب notify الحقيقي — نفس نمط sync.rs (API smoke)
// ---------------------------------------------------------------------------
fn check_notify_watcher() {
    println!("\n== مراقب notify الأصلي (نفس API sync.rs) ==");
    let tmp = std::env::temp_dir().join(format!("files-notify-{}", std::process::id()));
    std::fs::create_dir_all(&tmp).unwrap();
    let hits = Arc::new(AtomicUsize::new(0));
    let h2 = hits.clone();
    let mut watcher = notify::recommended_watcher(move |res: Result<notify::Event, notify::Error>| {
        if let Ok(ev) = res {
            if ev.paths.iter().any(|p| p.file_name().map(|n| n.to_string_lossy().contains("trigger")).unwrap_or(false)) {
                h2.fetch_add(1, Ordering::SeqCst);
            }
        }
    })
    .expect("watcher");
    watcher.watch(&tmp, notify::RecursiveMode::Recursive).expect("watch");
    std::fs::write(tmp.join("trigger.txt"), b"boom").unwrap();
    let t0 = Instant::now();
    while hits.load(Ordering::SeqCst) == 0 && t0.elapsed() < Duration::from_secs(5) {
        std::thread::sleep(Duration::from_millis(50));
    }
    ok("حدث الكتابة التُقط فوريًا", hits.load(Ordering::SeqCst) >= 1, &format!("{} حدث", hits.load(Ordering::SeqCst)));
    drop(watcher);
    let _ = std::fs::remove_dir_all(&tmp);
}

fn main() {
    println!("═══ محرك التحقق التنفيذي — FA-files (عقد §14) ═══");
    check_menu_spec();
    check_stream_core();
    check_pump_real_http();
    check_sync_core();
    check_notify_watcher();
    let p = PASS.load(Ordering::SeqCst);
    let f = FAIL.load(Ordering::SeqCst);
    println!("\n═══ النتيجة: {p} نجاح / {f} فشل ═══");
    if f > 0 {
        std::process::exit(1);
    }
}
