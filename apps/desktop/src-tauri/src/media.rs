// NexusLink Desktop — طبقة الوسائط الأصلية (FA-media — عقد §15)
// ============================================================================
// «طبقة الوسائط الأصلية» — اتجاهان حقيقيان عبر WebRTC:
//
// أ) شاشة الكمبيوتر → الهاتف (kind="screen" — نحن صاحب الوسائط):
//    التقاط (scap على ماك · windows-capture على ويندوز · x11rb على لينكس) → تصغير حسب الجودة →
//    ترميز H264 (OpenH264) → تُراك إرسال (webrtc-rs 0.21). الإشارات عبر جسر
//    3005 (الويبفيو يرحّل): screen:req من الهاتف → ننشئ rtc:offer → الهاتف
//    يجيب rtc:answer → RTP مباشرة على الشبكة المحلية (مرشحات host مضمّنة).
//    اللمس على الشاشة المعروضة في الهاتف يصل rc:pointer (3004) → enigo مطلق
//    بإحداثيات فضاء سطح المكتب المركّب — خلال جلسة تحكم موثوقة كما §13.
//
// ب) كاميرا الهاتف → ويب كام حقيقية (kind="cam" — الهاتف صاحب الوسائط):
//    نستقبل بث الهاتف (فيديو H264 + صوت Opus — خدمة الوسائط ترسل
//    getUserMedia{audio:true} حرفيًا) ونفكه ونحقنه في أجهزة افتراضية:
//    · الفيديو: لينكس v4l2loopback (YUYV + S_FMT ioctl) · ويندوز/ماك
//      akvirtualcamera (AkVCamManager stream YUY2 من stdin — بروتوكول
//      متحقق من مصدره: DEVICE FORMAT WIDTH HEIGHT).
//    · الصوت: لينكس pactl module-pipe-source (FIFO s16le) · ويندوز
//      VB-CABLE (cpal) · ماك BlackHole (cpal). غياب الدرايفور لا يكسر
//      شيئًا — الحالة والإرشاد العربي يعودان للواجهة (موثق بصدق §15).
//
// «أول إجابة من دور pc تُقبل لكل kind وتُتجاهل ما بعدها» — بوابة KindGate
// في media_core تفرضها محليًا أيضًا (الحارس الثاني بعد الجسر).
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use async_trait::async_trait;
use bytes::Bytes;
use serde_json::{json, Value};
use tauri::AppHandle;

#[path = "media_core.rs"]
pub mod core;

use crate::settings;

// ---------------------------------------------------------------------------
// أنواع webrtc-rs 0.21 (تحقق كامل من الأمثلة الرسمية play-from-disk-h26x/reflect)
// ---------------------------------------------------------------------------
use rtc::interceptor::Registry;
use rtc::media::Sample;
use rtc::media_stream::MediaStreamTrack;
use rtc::peer_connection::configuration::RTCConfigurationBuilder;
use rtc::peer_connection::configuration::interceptor_registry::register_default_interceptors;
use rtc::peer_connection::configuration::media_engine::{
    MediaEngine, MIME_TYPE_H264, MIME_TYPE_OPUS,
};
use rtc::peer_connection::sdp::RTCSessionDescription;
use rtc::peer_connection::transport::{RTCIceCandidateInit, RTCIceServer};
use rtc::rtp::codec::h264::H264Packet;
use rtc::rtp::codec::opus::OpusPacket;
use rtc::rtp::packetizer::Depacketizer;
use rtc::rtp_transceiver::rtp_sender::{
    RTCRtpCodec, RTCRtpCodecParameters, RTCRtpCodingParameters, RTCRtpEncodingParameters,
    RtpCodecKind,
};
use rtc::rtcp::payload_feedbacks::picture_loss_indication::PictureLossIndication;
use openh264::formats::YUVSource;
use webrtc::media_stream::track_local::static_sample::TrackLocalStaticSample;
use webrtc::media_stream::track_local::TrackLocal;
use webrtc::media_stream::track_remote::{TrackRemote, TrackRemoteEvent};
use webrtc::peer_connection::{
    PeerConnection, PeerConnectionBuilder, PeerConnectionEventHandler, RTCIceGatheringState,
    RTCPeerConnectionState,
};
use webrtc::rtp_transceiver::RtpSender;
use webrtc::runtime::{default_runtime, Runtime};

// ---------------------------------------------------------------------------
// الحالة العامة — الجلسات الحية (ثوابت عالمية مثل جلسة الإدخال §13)
// ---------------------------------------------------------------------------

static APP: OnceLock<Mutex<Option<AppHandle>>> = OnceLock::new();

pub fn set_app(app: AppHandle) {
    *APP.get_or_init(|| Mutex::new(None)).lock().unwrap() = Some(app);
}

fn app_handle() -> Option<AppHandle> {
    APP.get_or_init(|| Mutex::new(None)).lock().unwrap().clone()
}

fn emit(event: &str, payload: Value) {
    if let Some(app) = app_handle() {
        use tauri::Emitter;
        let _ = app.emit(event, payload);
    }
}

/// إطار مُشفّر من خيط الالتقاط إلى مهمة الإرسال
struct EncodedFrame {
    data: Vec<u8>,
    duration: Duration,
}

/// G-37 — خلية الجودة الحية للجلسة: يحدّثها media_screen_set ويقرؤها خيط
/// الالتقاط عند كل إعادة بناء — التبديل سلس (تُراك WebRTC وإرسال RTP يبقيان
/// حيّين؛ يُعاد بناء الالتقاط والمشفّر وحدهما بالقيم الجديدة — عقد §15).
#[derive(Clone)]
struct LiveQoS {
    fps: Arc<AtomicU32>,
    quality: Arc<std::sync::Mutex<String>>,
}

impl LiveQoS {
    fn new(fps: u32, quality: String) -> Self {
        Self { fps: Arc::new(AtomicU32::new(fps)), quality: Arc::new(std::sync::Mutex::new(quality)) }
    }

    fn set(&self, fps: Option<u32>, quality: Option<String>) {
        if let Some(f) = fps {
            self.fps.store(f, Ordering::Relaxed);
        }
        if let Some(q) = quality {
            if let Ok(mut g) = self.quality.lock() {
                *g = q;
            }
        }
    }

    fn snapshot(&self) -> (u32, String) {
        let f = self.fps.load(Ordering::Relaxed);
        let q = self
            .quality
            .lock()
            .map(|g| g.clone())
            .unwrap_or_else(|_| "high".into());
        (f, q)
    }
}

struct ScreenSess {
    gate: core::KindGate,
    pc: Arc<dyn PeerConnection>,
    stop: Arc<AtomicBool>,
    /// تغيير الجودة أثناء البث — خيط الالتقاط يعيد بناء مشفره
    rebuild: Arc<AtomicBool>,
    /// G-37 — القيم الحية التي يقرؤها خيط الالتقاط (media_screen_set يحدّثها)
    qos: LiveQoS,
    /// القيم المعروضة الحالية (تُحدَّث مع كل set ناجح — مصدر screen:state)
    fps: u32,
    quality: String,
    /// أبعاد سطح المكتب/الهدف الكاملة (أساس خريطة اللمس)
    w: u32,
    h: u32,
    origin: (i32, i32),
    target: String,
}

struct KindSess {
    pc: Arc<dyn PeerConnection>,
    stop: Arc<AtomicBool>,
}

static SCREEN: Mutex<Option<ScreenSess>> = Mutex::new(None);
static KINDS: std::sync::LazyLock<Mutex<HashMap<String, KindSess>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));
/// الويب كام المطلوبة (video/audio) — يقرؤها الويبفيو عبر media_status
static VCAM_WANTED: Mutex<(bool, bool)> = Mutex::new((false, false));
/// حالة الدرايفور الأخيرة (JSON من vcam_driver_status) — للواجهة
static VCAM_STATUS: Mutex<Value> = Mutex::new(Value::Null);
/// قناة إطارات YUYV جاهزة للحقن (من مفكك الكاميرا إلى الخيط الحاقن).
/// std mpsc — try_recv(&self) يعمل من مرجع ثابت (قنوات webrtc primitives
/// تتطلب &mut self وتستحيل على OnceLock) — المستهلك يأخذ Receiver مرة واحدة.
static VCAM_TX: OnceLock<std::sync::mpsc::SyncSender<Vec<u8>>> = OnceLock::new();
static VCAM_RX: Mutex<Option<std::sync::mpsc::Receiver<Vec<u8>>>> = Mutex::new(None);
/// قناة PCM (i16) من مفكك الصوت إلى الجهاز الافتراضي
static VMIC_TX: OnceLock<std::sync::mpsc::SyncSender<Vec<i16>>> = OnceLock::new();
static VMIC_RX: Mutex<Option<std::sync::mpsc::Receiver<Vec<i16>>>> = Mutex::new(None);
/// أبعاد الويب كام الحالية (يحددها أول إطار وارده)
static VCAM_DIMS: Mutex<(u32, u32, u32)> = Mutex::new((0, 0, 0)); // w,h,fps
/// إحصاءات بسيطة
static STATS: AtomicU64 = AtomicU64::new(0);

fn rt() -> Arc<dyn Runtime> {
    static RT: OnceLock<Arc<dyn Runtime>> = OnceLock::new();
    Arc::clone(RT.get_or_init(|| default_runtime().expect("webrtc runtime-tokio")))
}

fn vcam_tx() -> &'static std::sync::mpsc::SyncSender<Vec<u8>> {
    VCAM_TX.get_or_init(|| {
        let (tx, rx) = std::sync::mpsc::sync_channel(64);
        *VCAM_RX.lock().unwrap() = Some(rx);
        tx
    })
}

/// المستهلك يأخذ Receiver مرة واحدة (تُهيأ القناة كسولًا أولًا)
fn vcam_take_rx() -> Option<std::sync::mpsc::Receiver<Vec<u8>>> {
    let _ = vcam_tx();
    VCAM_RX.lock().unwrap().take()
}

fn vmic_tx() -> &'static std::sync::mpsc::SyncSender<Vec<i16>> {
    VMIC_TX.get_or_init(|| {
        let (tx, rx) = std::sync::mpsc::sync_channel(256);
        *VMIC_RX.lock().unwrap() = Some(rx);
        tx
    })
}

fn vmic_take_rx() -> Option<std::sync::mpsc::Receiver<Vec<i16>>> {
    let _ = vmic_tx();
    VMIC_RX.lock().unwrap().take()
}

fn push_tray_media() {
    let (vcam_v, vcam_a) = *VCAM_WANTED.lock().unwrap();
    let screen_on = SCREEN.lock().unwrap().is_some();
    let text = if screen_on && (vcam_v || vcam_a) {
        "الوسائط: شاشة + كاميرا الهاتف".to_string()
    } else if screen_on {
        "الوسائط: بث الشاشة نشط".to_string()
    } else if vcam_v || vcam_a {
        "الوسائط: كاميرا الهاتف تعمل".to_string()
    } else {
        "الوسائط: خاملة".to_string()
    };
    if let Some(app) = app_handle() {
        crate::tray::update_media(&app, &text);
    }
    emit("media://state", json!({"screenOn": screen_on, "vcamVideo": vcam_v, "vcamAudio": vcam_a}));
}

// ---------------------------------------------------------------------------
// محرّكات الترميز — قوائم رموز صارمة لكل kind (كما تعاقدنا)
// ---------------------------------------------------------------------------

fn h264_codec() -> RTCRtpCodecParameters {
    RTCRtpCodecParameters {
        rtp_codec: RTCRtpCodec {
            mime_type: MIME_TYPE_H264.to_owned(),
            clock_rate: 90000,
            channels: 0,
            // baseline مضمّن — يطابق ترميز flutter_webrtc على أندرويد (عقد §15)
            sdp_fmtp_line:
                "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f".to_owned(),
            rtcp_feedback: vec![],
        },
        payload_type: 102,
        ..Default::default()
    }
}

fn opus_codec() -> RTCRtpCodecParameters {
    RTCRtpCodecParameters {
        rtp_codec: RTCRtpCodec {
            mime_type: MIME_TYPE_OPUS.to_owned(),
            clock_rate: 48000,
            channels: 2,
            sdp_fmtp_line: String::new(),
            rtcp_feedback: vec![],
        },
        payload_type: 120,
        ..Default::default()
    }
}

fn engine_screen() -> Result<(MediaEngine, Registry), String> {
    let mut me = MediaEngine::default();
    me.register_codec(h264_codec(), RtpCodecKind::Video).map_err(|e| e.to_string())?;
    let reg = register_default_interceptors(Registry::new(), &mut me).map_err(|e| e.to_string())?;
    Ok((me, reg))
}

fn engine_cam() -> Result<(MediaEngine, Registry), String> {
    let mut me = MediaEngine::default();
    me.register_codec(h264_codec(), RtpCodecKind::Video).map_err(|e| e.to_string())?;
    me.register_codec(opus_codec(), RtpCodecKind::Audio).map_err(|e| e.to_string())?;
    let reg = register_default_interceptors(Registry::new(), &mut me).map_err(|e| e.to_string())?;
    Ok((me, reg))
}

fn engine_mic() -> Result<(MediaEngine, Registry), String> {
    let mut me = MediaEngine::default();
    me.register_codec(opus_codec(), RtpCodecKind::Audio).map_err(|e| e.to_string())?;
    let reg = register_default_interceptors(Registry::new(), &mut me).map_err(|e| e.to_string())?;
    Ok((me, reg))
}

fn base_config() -> RTCConfigurationBuilder {
    // شبكة محلية — مرشحات host فقط، بلا STUN/TURN (اتصال مباشر دائمًا)
    RTCConfigurationBuilder::new().with_ice_servers(vec![RTCIceServer::default()])
}

async fn local_desc_json(pc: &Arc<dyn PeerConnection>) -> Result<Value, String> {
    let desc = pc.local_description().await.ok_or("لا وصف محلي بعد الترشيح")?;
    serde_json::to_value(&desc).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// معالج أحداث الاتصال — جمع الحالة + تنظيف ذاتي للجلسات الميتة + مسارات واردة
// ---------------------------------------------------------------------------

#[derive(Clone)]
struct MediaHandler {
    gather_tx: webrtc::runtime::Sender<()>,
    kind: String,
    role: &'static str,
}

#[async_trait]
impl PeerConnectionEventHandler for MediaHandler {
    async fn on_ice_gathering_state_change(&self, state: RTCIceGatheringState) {
        if state == RTCIceGatheringState::Complete {
            let _ = self.gather_tx.try_send(());
        }
    }

    async fn on_connection_state_change(&self, state: RTCPeerConnectionState) {
        println!("[media] {}({}) state: {state}", self.kind, self.role);
        if matches!(state, RTCPeerConnectionState::Failed | RTCPeerConnectionState::Closed) {
            cleanup_after_fail(self.kind.clone(), self.role);
        }
    }

    async fn on_track(&self, track: Arc<dyn TrackRemote>) {
        // الوارد فقط (cam/mic): ربط مسارات الفك بالأجهزة الافتراضية
        if self.role != "answer" {
            return;
        }
        let kind = track.kind().await;
        let stop = KINDS
            .lock()
            .unwrap()
            .get(&self.kind)
            .map(|s| Arc::clone(&s.stop))
            .unwrap_or_else(|| Arc::new(AtomicBool::new(true)));
        match kind {
            RtpCodecKind::Video => {
                rt().spawn(Box::pin(video_decode_loop(track, stop)));
            }
            RtpCodecKind::Audio => {
                rt().spawn(Box::pin(audio_decode_loop(track, stop)));
            }
            _ => {}
        }
    }
}

/// تنظيف ذاتي من سياق async — خيط عابر (لا يحظر الدافع)
fn cleanup_after_fail(kind: String, role: &'static str) {
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(300));
        if role == "offer" {
            let _ = screen_stop_sync("peer-failed");
        } else {
            let _ = kind_stop_sync(&kind, "peer-failed");
        }
        if let Some(app) = app_handle() {
            // إبلاغ الويبفيو ليوقف أي حالة معلقة ويحدّث البطاقات
            use tauri::Emitter;
            let _ = app.emit(
                "media://state",
                json!({"screenOn": SCREEN.lock().unwrap().is_some(), "vcamVideo": false, "vcamAudio": false}),
            );
        }
    });
}

// ---------------------------------------------------------------------------
// الأهداف — شاشات/نوافذ (البند 2: اختيار الشاشة/النافذة المحددة للبث)
// ---------------------------------------------------------------------------

pub struct TargetInfo {
    pub id: String,
    pub kind: &'static str,
    pub title: String,
    pub origin: (i32, i32),
    pub w: u32,
    pub h: u32,
}

// جسر x11rb: الإرسال يرجع Result<Cookie, ConnectionError> والرد Result<R, ReplyError>
// — نوعا خطأ مختلفان (لهذا فشلت and_then ثم E0599 في CI جولة 3). ينهار إلى None.
#[cfg(target_os = "linux")]
fn x11reply<C, R>(
    cookie: Result<x11rb::cookie::Cookie<'_, C, R>, x11rb::errors::ConnectionError>,
) -> Option<R>
where
    C: x11rb::connection::RequestConnection + ?Sized,
    R: x11rb::x11_utils::TryParse,
{
    let c = cookie.ok()?;
    c.reply().ok()
}

#[cfg(target_os = "linux")]
pub(crate) fn list_targets() -> Result<Vec<TargetInfo>, String> {
    use x11rb::connection::Connection;
    use x11rb::protocol::randr;
    use x11rb::protocol::xproto::ConnectionExt;
    // X11: RandR للشاشات (أصول دقيقة) + نوافذ الجذر بأسمائها (اقتصاص تقريبي موثق §15)
    let (conn, screen_num) = x11rb::connect(None).map_err(|e| format!("X11: {e}"))?;
    let root = conn.setup().roots[screen_num].root;
    let mut out = Vec::new();
    // ملاحظة x11rb 0.13: دوال الامتداد حرة (randr::get_monitors) — conn.randr() لا وجود لها
    if let Some(reply) = x11reply(randr::get_monitors(&conn, root, true)) {
        for (i, m) in reply.monitors.iter().enumerate() {
            out.push(TargetInfo {
                id: format!("screen:{i}"),
                kind: "screen",
                title: if m.primary {
                    format!("الشاشة الرئيسية {i}")
                } else {
                    format!("الشاشة {i}")
                },
                origin: (m.x as i32, m.y as i32),
                // RandR MonitorInfo: width/height بصيغة u16 — TargetInfo بالـ u32
                w: m.width as u32,
                h: m.height as u32,
            });
        }
    }
    if out.iter().all(|t| t.id != "screen:all") {
        out.push(TargetInfo {
            id: "screen:all".into(),
            kind: "screen",
            title: "كل الشاشات".into(),
            origin: (0, 0),
            w: 0,
            h: 0,
        });
    }
    // نوافذ المستوى الأعلى (WM_NAME) — قائمة معقولة
    if let Some(reply) = x11reply(conn.query_tree(root)) {
        for win in reply.children.iter().take(48) {
            let name = x11reply(conn.get_property(
                false,
                *win,
                x11rb::protocol::xproto::AtomEnum::WM_NAME,
                x11rb::protocol::xproto::AtomEnum::STRING,
                0,
                256,
            ))
            .and_then(|r| String::from_utf8(r.value).ok())
            .unwrap_or_default();
            if name.trim().len() < 2 {
                continue;
            }
            if let (Some(geo), Some(tr)) = (
                x11reply(conn.get_geometry(*win)),
                x11reply(conn.translate_coordinates(*win, root, 0, 0)),
            ) {
                if geo.width < 8 || geo.height < 8 {
                    continue;
                }
                // Window = u32 في x11rb (لا resource_id)
                out.push(TargetInfo {
                    id: format!("window:{win}"),
                    kind: "window",
                    title: name.chars().take(60).collect(),
                    origin: (tr.dst_x as i32, tr.dst_y as i32),
                    w: geo.width as u32,
                    h: geo.height as u32,
                });
            }
        }
    }
    Ok(out)
}

#[cfg(target_os = "macos")]
pub(crate) fn list_targets() -> Result<Vec<TargetInfo>, String> {
    // scap: شاشات + نوافذ (Windows.Graphics.Capture / ScreenCaptureKit)
    let mut out = Vec::new();
    for t in scap::get_all_targets() {
        match t {
            scap::Target::Display(d) => {
                out.push(TargetInfo {
                    id: format!("screen:{}", d.id),
                    kind: "screen",
                    title: d.title.clone(),
                    origin: (0, 0), // حد موثق §15: الأصل للشاشة الأساسية
                    w: 0,           // يُحدد من أول إطار
                    h: 0,
                });
            }
            scap::Target::Window(w) => {
                // النوع الداخلي للقبض مختلف لكل منصة — الوصول عبر القيمة نفسها
                #[cfg(windows)]
                let origin = window_origin(w.raw_handle.0 as isize);
                #[cfg(target_os = "macos")]
                let origin = window_origin(w.raw_handle);
                out.push(TargetInfo {
                    id: format!("window:{}", w.id),
                    kind: "window",
                    title: w.title.clone(),
                    origin,
                    w: 0,
                    h: 0,
                });
            }
        }
    }
    Ok(out)
}

#[cfg(windows)]
pub(crate) fn list_targets() -> Result<Vec<TargetInfo>, String> {
    let mut out: Vec<TargetInfo> = Vec::new();
    // تعداد EnumDisplayMonitors — نفس ترتيب windows-capture::Monitor::from_index
    // (كلاهما يجتاز القائمة نفسها — تحقق حرفي من مصدر الكرِيت 1.3.6 monitor.rs)
    // ⇒ فهرس screen:N يطابق حلقة الالتقاط حرفيًا، مع **أصول حقيقية** في سطح
    // المكتب المركّب (إصلاح حد §15: كانت 0,0 للجميع) — أساس خريطة لمس الشاشة
    // الافتراضية (R4 مرحلة ① — §19: اللمس = مطلق داخل الشاشة الافتراضية).
    for m in crate::vdisplay::list_monitors_ex() {
        let virtual_now =
            crate::vdisplay::current_session_device().as_deref() == Some(m.device.as_str());
        let title = if virtual_now {
            format!("الشاشة الافتراضية {} ({}×{})", m.index, m.w, m.h)
        } else if m.primary {
            format!("الشاشة الرئيسية {}", m.index)
        } else {
            format!("الشاشة {} ({}×{})", m.index, m.w, m.h)
        };
        out.push(TargetInfo {
            id: format!("screen:{}", m.index),
            kind: "screen",
            title,
            origin: (m.ox, m.oy),
            w: m.w,
            h: m.h,
        });
    }
    if out.iter().all(|t| t.id != "screen:all") {
        out.push(TargetInfo {
            id: "screen:all".into(),
            kind: "screen",
            title: "كل الشاشات".into(),
            origin: (0, 0),
            w: 0,
            h: 0,
        });
    }
    // النوافذ العليا المرئية — EnumWindows مباشرة (enumerate في windows-capture
    // يستعمل EnumChildWindows فيُعدّ عناصر التحكم الداخلية أيضًا — لا يصلح للقائمة)
    #[link(name = "user32")]
    extern "system" {
        fn EnumWindows(cb: Option<extern "system" fn(isize, isize) -> i32>, lparam: isize) -> i32;
        fn IsWindowVisible(hwnd: isize) -> i32;
        fn GetWindowTextLengthW(hwnd: isize) -> i32;
        fn GetWindowTextW(hwnd: isize, buf: *mut u16, max: i32) -> i32;
    }
    extern "system" fn enum_cb(hwnd: isize, lparam: isize) -> i32 {
        unsafe {
            if IsWindowVisible(hwnd) == 0 {
                return 1;
            }
            let len = GetWindowTextLengthW(hwnd);
            if len < 2 {
                return 1;
            }
            let mut buf = vec![0u16; len as usize + 1];
            let n = GetWindowTextW(hwnd, buf.as_mut_ptr(), len + 1);
            if n <= 0 {
                return 1;
            }
            let title = String::from_utf16_lossy(&buf[..n as usize]);
            let collected = &mut *(lparam as *mut Vec<(isize, String)>);
            collected.push((hwnd, title));
        }
        1 // متابعة التعداد
    }
    let mut collected: Vec<(isize, String)> = Vec::new();
    unsafe {
        EnumWindows(
            Some(enum_cb),
            &mut collected as *mut Vec<(isize, String)> as isize,
        );
    }
    for (hwnd, title) in collected {
        out.push(TargetInfo {
            id: format!("window:{hwnd}"),
            kind: "window",
            title: title.chars().take(60).collect(),
            origin: window_origin(hwnd),
            w: 0, // يُحدد من أول إطار
            h: 0,
        });
    }
    Ok(out)
}

#[cfg(windows)]
fn window_origin(hwnd: isize) -> (i32, i32) {
    #[repr(C)]
    struct RECT {
        left: i32,
        top: i32,
        right: i32,
        bottom: i32,
    }
    #[link(name = "user32")]
    extern "system" {
        fn GetWindowRect(hwnd: isize, rect: *mut RECT) -> i32;
    }
    let mut r = RECT { left: 0, top: 0, right: 0, bottom: 0 };
    unsafe {
        if GetWindowRect(hwnd, &mut r) != 0 {
            return (r.left, r.top);
        }
    }
    (0, 0)
}

#[cfg(target_os = "macos")]
fn window_origin(cid: u32) -> (i32, i32) {
    // CGWindowGetBounds ليست API عامة (جولة 3cea500 استعملتها وكشفها الرابط أول مرة
    // بعد اجتياز الترجمة). الطريق الصحيح: CGWindowListCopyWindowInfo + kCGWindowBounds
    // + CGRectMakeWithDictionaryRepresentation — تحقق حرفي من رؤوس CGWindow.h.
    #[repr(C)]
    struct CGPoint {
        x: f64,
        y: f64,
    }
    #[repr(C)]
    struct CGSize {
        width: f64,
        height: f64,
    }
    #[repr(C)]
    struct CGRect {
        origin: CGPoint,
        size: CGSize,
    }
    type CFTypeRef = *const std::ffi::c_void;
    type CFArrayRef = *const std::ffi::c_void;
    type CFDictionaryRef = *const std::ffi::c_void;
    type CFStringRef = *const std::ffi::c_void;
    type CFNumberRef = *const std::ffi::c_void;
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFArrayGetCount(arr: CFArrayRef) -> isize;
        fn CFArrayGetValueAtIndex(arr: CFArrayRef, idx: isize) -> CFTypeRef;
        fn CFDictionaryGetValue(dict: CFDictionaryRef, key: CFTypeRef) -> CFTypeRef;
        fn CFNumberGetValue(num: CFNumberRef, ntype: isize, value: *mut std::ffi::c_void) -> u8;
        fn CFRelease(cf: CFTypeRef);
    }
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGWindowListCopyWindowInfo(option: u32, relative_to: u32) -> CFArrayRef;
        fn CGRectMakeWithDictionaryRepresentation(dict: CFDictionaryRef, rect: *mut CGRect) -> u8;
        static kCGWindowNumber: CFStringRef;
        static kCGWindowBounds: CFStringRef;
    }
    // kCGWindowListOptionAll = 0 · kCGNullWindowID = 0
    let list = unsafe { CGWindowListCopyWindowInfo(0, 0) };
    if list.is_null() {
        return (0, 0);
    }
    let mut out = (0i32, 0i32);
    let n = unsafe { CFArrayGetCount(list) };
    for i in 0..n {
        let dict = unsafe { CFArrayGetValueAtIndex(list, i) as CFDictionaryRef };
        let num = unsafe { CFDictionaryGetValue(dict, kCGWindowNumber as CFTypeRef) };
        if num.is_null() {
            continue;
        }
        let mut wid: u32 = 0;
        unsafe {
            CFNumberGetValue(
                num as CFNumberRef,
                9, // kCFNumberIntType
                &mut wid as *mut u32 as *mut std::ffi::c_void,
            );
        }
        if wid != cid {
            continue;
        }
        let bounds = unsafe { CFDictionaryGetValue(dict, kCGWindowBounds as CFTypeRef) };
        if !bounds.is_null() {
            let mut rect = CGRect {
                origin: CGPoint { x: 0.0, y: 0.0 },
                size: CGSize {
                    width: 0.0,
                    height: 0.0,
                },
            };
            unsafe {
                if CGRectMakeWithDictionaryRepresentation(bounds as CFDictionaryRef, &mut rect) != 0 {
                    out = (rect.origin.x as i32, rect.origin.y as i32);
                }
            }
        }
        break;
    }
    unsafe { CFRelease(list as CFTypeRef) };
    out
}

/// حل الهدف المطلوب — "default" = الشاشة الكاملة/الأساسية
fn resolve_target(id: &str) -> Result<Option<TargetInfo>, String> {
    if id.is_empty() || id == "default" {
        return Ok(None);
    }
    list_targets()?.into_iter().find(|t| t.id == id).map(Some).ok_or_else(|| "الهدف المطلوب غير موجود".into())
}

// ---------------------------------------------------------------------------
// خريطة اللمس — أبعاد الهدف الكاملة + أصله في فضاء سطح المكتب المركّب
// ---------------------------------------------------------------------------

fn full_dims(target: &str, tinfo: &Option<TargetInfo>) -> Result<(u32, u32, (i32, i32)), String> {
    if let Some(ti) = tinfo {
        if ti.kind == "screen" && ti.w > 0 && ti.h > 0 {
            return Ok((ti.w, ti.h, ti.origin));
        }
    }
    full_desktop_dims()
}

#[cfg(target_os = "linux")]
fn full_desktop_dims() -> Result<(u32, u32, (i32, i32)), String> {
    use x11rb::connection::Connection;
    use x11rb::protocol::xproto::ConnectionExt;
    let (conn, n) = x11rb::connect(None).map_err(|e| format!("X11: {e}"))?;
    let root = conn.setup().roots[n].root;
    let geo = x11reply(conn.get_geometry(root)).ok_or_else(|| "X11: get_geometry".to_string())?;
    Ok((geo.width as u32, geo.height as u32, (0, 0)))
}

#[cfg(windows)]
fn full_desktop_dims() -> Result<(u32, u32, (i32, i32)), String> {
    #[link(name = "user32")]
    extern "system" {
        fn GetSystemMetrics(index: i32) -> i32;
    }
    const SM_XVIRTUALSCREEN: i32 = 76;
    const SM_YVIRTUALSCREEN: i32 = 77;
    const SM_CXVIRTUALSCREEN: i32 = 78;
    const SM_CYVIRTUALSCREEN: i32 = 79;
    let (x, y, w, h) = unsafe {
        (
            GetSystemMetrics(SM_XVIRTUALSCREEN),
            GetSystemMetrics(SM_YVIRTUALSCREEN),
            GetSystemMetrics(SM_CXVIRTUALSCREEN),
            GetSystemMetrics(SM_CYVIRTUALSCREEN),
        )
    };
    if w <= 0 || h <= 0 {
        return Err("تعذر قياس سطح المكتب".into());
    }
    Ok((w as u32, h as u32, (x, y)))
}

#[cfg(target_os = "macos")]
fn full_desktop_dims() -> Result<(u32, u32, (i32, i32)), String> {
    #[repr(C)]
    struct CGPoint {
        x: f64,
        y: f64,
    }
    #[repr(C)]
    struct CGSize {
        width: f64,
        height: f64,
    }
    #[repr(C)]
    struct CGRect {
        origin: CGPoint,
        size: CGSize,
    }
    #[repr(transparent)]
    struct CGDirectDisplayID(u32);
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGMainDisplayID() -> CGDirectDisplayID;
        fn CGDisplayPixelsWide(d: u32) -> usize;
        fn CGDisplayPixelsHigh(d: u32) -> usize;
        fn CGDisplayBounds(d: u32) -> CGRect;
    }
    // CGDirectDisplayID بنية غير Copy — نستخرج الرقم مرة واحدة (الحقل عام في fork سيرفو)
    let id: u32 = unsafe { CGMainDisplayID().0 };
    let (w, h) = unsafe { (CGDisplayPixelsWide(id) as u32, CGDisplayPixelsHigh(id) as u32) };
    let b = unsafe { CGDisplayBounds(id) };
    Ok((w, h, (b.origin.x as i32, b.origin.y as i32)))
}

// ---------------------------------------------------------------------------
// حلقات الالتقاط والترميز — خيط مخصص لكل جلسة
// ---------------------------------------------------------------------------

#[cfg(target_os = "macos")]
fn capture_loop(
    stop: Arc<AtomicBool>,
    rebuild: Arc<AtomicBool>,
    target: String,
    qos: LiveQoS,
    tx: webrtc::runtime::Sender<EncodedFrame>,
) {
    loop {
        if stop.load(Ordering::Relaxed) {
            return;
        }
        // G-37 — قراءة القيم الحية عند كل إعادة بناء (media_screen_set حدّثتها
        // فعلى العلم rebuild) — التبديل سلس والاتصال WebRTC باقٍ
        let (fps, quality) = qos.snapshot();
        let preset = core::quality_preset(&quality);
        let opts = scap::capturer::Options {
            fps,
            show_cursor: true,
            show_highlight: false,
            target: build_scap_target(&target),
            crop_area: None,
            output_type: scap::frame::FrameType::BGRAFrame,
            output_resolution: scap::capturer::Resolution::Captured,
            excluded_targets: None,
        };
        let mut capturer = match scap::capturer::Capturer::build(opts) {
            Ok(c) => c,
            Err(e) => {
                println!("[media] scap build: {e}");
                std::thread::sleep(Duration::from_secs(2));
                continue;
            }
        };
        capturer.start_capture();
        let mut encoder: Option<(openh264::encoder::Encoder, u32, u32)> = None;
        loop {
            if stop.load(Ordering::Relaxed) {
                capturer.stop_capture();
                return;
            }
            if rebuild.swap(false, Ordering::Relaxed) {
                capturer.stop_capture();
                break; // إعادة بناء بالجودة الجديدة
            }
            let frame = match capturer.get_next_frame() {
                Ok(f) => f,
                Err(_) => continue,
            };
            let (data, w, h) = match frame {
                scap::frame::Frame::BGRA(f) => (f.data, f.width.max(0) as u32, f.height.max(0) as u32),
                scap::frame::Frame::BGRx(f) => (f.data, f.width.max(0) as u32, f.height.max(0) as u32),
                _ => continue,
            };
            if w < 2 || h < 2 {
                continue;
            }
            let (w2, h2) = core::scaled_dims(w, h, preset.scale);
            let scaled = core::downscale_bgra(&data, w, h, w2, h2);
            if let Err(e) = encode_and_send(&mut encoder, &scaled, w2, h2, preset, fps, &tx) {
                println!("[media] encode: {e}");
            }
        }
    }
}

#[cfg(target_os = "macos")]
fn build_scap_target(id: &str) -> Option<scap::Target> {
    for t in scap::get_all_targets() {
        match &t {
            scap::Target::Display(d) => {
                if id == format!("screen:{}", d.id) {
                    return Some(t);
                }
            }
            scap::Target::Window(w) => {
                if id == format!("window:{}", w.id) {
                    return Some(t);
                }
            }
        }
    }
    None // افتراضي — الشاشة الأساسية
}

// ويندوز: windows-capture مباشرة (scap 0.0.8 مكسور مع أي نسخة منشورة — موثق بالأعلى)
// الدفع: خيط Windows.Graphics.Capture يكتب في فتحة مشتركة، وهذه الحلقة تستهلك بمعدل fps
#[cfg(windows)]
fn capture_loop(
    stop: Arc<AtomicBool>,
    rebuild: Arc<AtomicBool>,
    target: String,
    qos: LiveQoS,
    tx: webrtc::runtime::Sender<EncodedFrame>,
) {
    use windows_capture::capture::GraphicsCaptureApiHandler;
    use windows_capture::frame::Frame;
    use windows_capture::graphics_capture_api::InternalCaptureControl;
    use windows_capture::monitor::Monitor;
    use windows_capture::settings::{
        ColorFormat, CursorCaptureSettings, DrawBorderSettings, Settings,
    };
    use windows_capture::window::Window;

    struct WinSlot {
        data: Vec<u8>,
        w: u32,
        h: u32,
        seq: u64,
    }
    struct WinHandler {
        slot: Arc<Mutex<WinSlot>>,
    }
    impl GraphicsCaptureApiHandler for WinHandler {
        type Flags = Arc<Mutex<WinSlot>>;
        type Error = Box<dyn std::error::Error + Send + Sync>;

        fn new(slot: Self::Flags) -> Result<Self, Self::Error> {
            Ok(Self { slot })
        }

        fn on_frame_arrived(
            &mut self,
            frame: &mut Frame,
            _capture_control: InternalCaptureControl,
        ) -> Result<(), Self::Error> {
            let (w, h) = (frame.width(), frame.height());
            if w < 2 || h < 2 {
                return Ok(());
            }
            // Bgra8 = B,G,R,A معبأة — نفس ترتيب محول BGRA النقي (بلا حشو صفوف).
            // buffer() يرجع FrameBuffer وas_raw_nopadding_buffer عليه وليس على Frame
            let mut fb = frame.buffer()?;
            let packed = fb.as_raw_nopadding_buffer()?;
            let mut s = match self.slot.lock() {
                Ok(g) => g,
                Err(_) => return Err("win slot poisoned".into()),
            };
            s.data.clear();
            s.data.extend_from_slice(packed);
            s.w = w;
            s.h = h;
            s.seq = s.seq.wrapping_add(1);
            Ok(())
        }
    }

    loop {
        if stop.load(Ordering::Relaxed) {
            return;
        }
        // G-37 — قراءة القيم الحية عند كل إعادة بناء (media_screen_set حدّثتها
        // فعلى العلم rebuild) — التبديل سلس والاتصال WebRTC باقٍ
        let (fps, quality) = qos.snapshot();
        let preset = core::quality_preset(&quality);
        // العنصر: window:HWND أو screen:N (from_index 1-based) — الافتراضي الشاشة الأساسية.
        // الإنشاء داخل كل فرع: Window/Monitor نوعان مختلفان وGraphicsCaptureItem نوع WinRT
        // من crate windows — غلاف enum يتطلب اعتمادها مباشرة؛ ونوع الإرجاع لا يذكر T فيتحد.
        let slot = Arc::new(Mutex::new(WinSlot {
            data: Vec::new(),
            w: 0,
            h: 0,
            seq: 0,
        }));
        let control = if target.starts_with("window:") {
            match target["window:".len()..].parse::<isize>() {
                Ok(hwnd) => WinHandler::start_free_threaded(Settings::new(
                    Window::from_raw_hwnd(hwnd as *mut std::ffi::c_void),
                    CursorCaptureSettings::WithCursor,
                    DrawBorderSettings::WithoutBorder,
                    ColorFormat::Bgra8,
                    slot.clone(),
                )),
                Err(e) => {
                    println!("[media] win hwnd: {e}");
                    std::thread::sleep(Duration::from_secs(2));
                    continue;
                }
            }
        } else {
            let idx: usize = target
                .strip_prefix("screen:")
                .and_then(|s| s.parse().ok())
                .unwrap_or(0);
            match Monitor::from_index(idx + 1).or_else(|_| Monitor::primary()) {
                Ok(m) => WinHandler::start_free_threaded(Settings::new(
                    m,
                    CursorCaptureSettings::WithCursor,
                    DrawBorderSettings::WithoutBorder,
                    ColorFormat::Bgra8,
                    slot.clone(),
                )),
                Err(e) => {
                    println!("[media] win monitor: {e:?}");
                    std::thread::sleep(Duration::from_secs(2));
                    continue;
                }
            }
        };
        let control = match control {
            Ok(c) => c,
            Err(e) => {
                println!("[media] win capture: {e:?}");
                std::thread::sleep(Duration::from_secs(2));
                continue;
            }
        };
        let frame_dur = Duration::from_nanos(1_000_000_000 / fps.max(1) as u64);
        let mut last_seq: u64 = 0;
        let mut encoder: Option<(openh264::encoder::Encoder, u32, u32)> = None;
        loop {
            let t0 = Instant::now();
            if stop.load(Ordering::Relaxed) {
                let _ = control.stop();
                return;
            }
            if rebuild.swap(false, Ordering::Relaxed) {
                let _ = control.stop();
                break; // إعادة بناء بالجودة الجديدة
            }
            let (data, w, h, seq) = match slot.lock() {
                Ok(s) => (s.data.clone(), s.w, s.h, s.seq),
                Err(_) => (Vec::new(), 0, 0, last_seq),
            };
            if seq != last_seq && w >= 2 && h >= 2 && data.len() >= (w as usize) * (h as usize) * 4 {
                last_seq = seq;
                let (w2, h2) = core::scaled_dims(w, h, preset.scale);
                let scaled = core::downscale_bgra(&data, w, h, w2, h2);
                if let Err(e) = encode_and_send(&mut encoder, &scaled, w2, h2, preset, fps, &tx) {
                    println!("[media] encode: {e}");
                }
            }
            let el = t0.elapsed();
            if el < frame_dur {
                std::thread::sleep(frame_dur - el);
            }
        }
    }
}

#[cfg(target_os = "linux")]
fn capture_loop(
    stop: Arc<AtomicBool>,
    rebuild: Arc<AtomicBool>,
    target: String,
    qos: LiveQoS,
    tx: webrtc::runtime::Sender<EncodedFrame>,
) {
    use x11rb::connection::Connection;
    use x11rb::protocol::randr;
    use x11rb::protocol::xproto::{ConnectionExt, ImageFormat};
    loop {
        if stop.load(Ordering::Relaxed) {
            return;
        }
        // G-37 — قراءة القيم الحية عند كل إعادة بناء (media_screen_set حدّثتها
        // فعلى العلم rebuild) — التبديل سلس والاتصال WebRTC باقٍ
        let (fps, quality) = qos.snapshot();
        let preset = core::quality_preset(&quality);
        let (conn, screen_num) = match x11rb::connect(None) {
            Ok(v) => v,
            Err(e) => {
                println!("[media] X11 connect: {e}");
                std::thread::sleep(Duration::from_secs(2));
                continue;
            }
        };
        let root = conn.setup().roots[screen_num].root;
        let root_geo = match x11reply(conn.get_geometry(root)) {
            Some(g) => g,
            None => {
                println!("[media] X11 geometry: فشل الإرسال أو الرد");
                std::thread::sleep(Duration::from_secs(2));
                continue;
            }
        };
        let mut region = (0i16, 0i16, root_geo.width, root_geo.height);
        if target.starts_with("screen:") && target != "screen:all" {
            // مملوكة لا مستعارة: المرجع داخل r المحلية يهرب من الإغلاق (E0515)
            if let Some((mx, my, mw, mh)) =
                x11reply(randr::get_monitors(&conn, root, true)).and_then(|r| {
                    let idx: usize = target["screen:".len()..].parse().ok()?;
                    let m = r.monitors.get(idx)?;
                    Some((m.x as i16, m.y as i16, m.width as u16, m.height as u16))
                })
            {
                region = (mx, my, mw, mh);
            }
        } else if target.starts_with("window:") {
            if let Ok(id) = target["window:".len()..].parse::<x11rb::protocol::xproto::Window>() {
                if let (Some(geo), Some(tr)) = (
                    x11reply(conn.get_geometry(id)),
                    x11reply(conn.translate_coordinates(id, root, 0, 0)),
                ) {
                    region = (tr.dst_x as i16, tr.dst_y as i16, geo.width, geo.height);
                }
            }
        }
        let (rx, ry, rw, rh) = region;
        if rw < 2 || rh < 2 {
            std::thread::sleep(Duration::from_millis(500));
            continue;
        }
        let frame_dur = Duration::from_nanos(1_000_000_000 / fps.max(1) as u64);
        let mut encoder: Option<(openh264::encoder::Encoder, u32, u32)> = None;
        loop {
            let t0 = Instant::now();
            if stop.load(Ordering::Relaxed) {
                return;
            }
            if rebuild.swap(false, Ordering::Relaxed) {
                break;
            }
            let img = match
                x11reply(conn.get_image(ImageFormat::Z_PIXMAP, root, rx, ry, rw, rh, !0u32))
            {
                Some(i) => i,
                None => {
                    println!("[media] X11 get_image: فشل الإرسال أو الرد");
                    break;
                }
            };
            // ZPixmap 32bpp = BGRX (كـ BGRA بلا ألفا — المحول يتجاهل القناة الرابعة)
            // GetImageReply بلا width/height (حقوله: depth/sequence/visual/data) — الأبعاد من الطلب
            let (w, h) = (rw as u32, rh as u32);
            let (w2, h2) = core::scaled_dims(w, h, preset.scale);
            let scaled = core::downscale_bgra(&img.data, w, h, w2, h2);
            if let Err(e) = encode_and_send(&mut encoder, &scaled, w2, h2, preset, fps, &tx) {
                println!("[media] encode: {e}");
            }
            let el = t0.elapsed();
            if el < frame_dur {
                std::thread::sleep(frame_dur - el);
            }
        }
    }
}

/// ترميز إطار BGRA وإرساله — بناء المشفر كسولًا وإعادة بنائه عند تغيّر الأبعاد
fn encode_and_send(
    encoder: &mut Option<(openh264::encoder::Encoder, u32, u32)>,
    bgra: &[u8],
    w: u32,
    h: u32,
    preset: core::QualityPreset,
    fps: u32,
    tx: &webrtc::runtime::Sender<EncodedFrame>,
) -> Result<(), String> {
    let needs_init = !matches!(encoder, Some((_, ew, eh)) if *ew == w && *eh == h);
    if needs_init {
        let cfg = openh264::encoder::EncoderConfig::new()
            .bitrate(openh264::encoder::BitRate::from_bps(preset.bitrate_bps))
            .intra_frame_period(openh264::encoder::IntraFramePeriod::from_num_frames(
                fps.max(1) * 2,
            ));
        let enc = openh264::encoder::Encoder::with_api_config(
            openh264::OpenH264API::from_source(),
            cfg,
        )
        .map_err(|e| format!("openh264 init: {e}"))?;
        *encoder = Some((enc, w, h));
    }
    let enc = &mut encoder.as_mut().unwrap().0;
    // الأبعاد مضمونة زوجية من scaled_dims — new يتحقق دفاعيًا (panic إذا فاسد)
    let yuv = openh264::formats::YUVBuffer::from_bgra8_source(
        openh264::formats::BgraSliceU8::new(bgra, (w as usize, h as usize)),
    );
    let stream = enc.encode(&yuv).map_err(|e| format!("openh264 encode: {e}"))?;
    let mut buf: Vec<u8> = Vec::with_capacity((w * h / 4) as usize);
    stream.write_vec(&mut buf);
    if buf.is_empty() {
        return Ok(());
    }
    let frame =
        EncodedFrame { data: buf, duration: Duration::from_nanos(1_000_000_000 / fps.max(1) as u64) };
    if tx.try_send(frame).is_err() {
        STATS.fetch_add(1, Ordering::Relaxed); // المستهلك متأخر — أسقط الإطار
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// حلقات الفك الواردة (كاميرا/ميكروفون الهاتف) — مهمة tokio لكل مسار
// ---------------------------------------------------------------------------

/// فك فيديو الهاتف H264 → YUV420 → YUYV → قناة الحقن (+ PLI دوري)
async fn video_decode_loop(track: Arc<dyn TrackRemote>, stop: Arc<AtomicBool>) {
    let media_ssrc = match track.ssrcs().await.first() {
        Some(s) => *s,
        None => return,
    };
    let mut depack = H264Packet::default();
    let mut decoder = match openh264::decoder::Decoder::new() {
        Ok(d) => d,
        Err(e) => {
            println!("[media] openh264 decoder: {e}");
            return;
        }
    };
    let mut frame_buf: Vec<u8> = Vec::with_capacity(256 * 1024);
    let mut last_pli = Instant::now();
    while !stop.load(Ordering::Relaxed) {
        // طلب إطارات مفتاحية دوريًا أثناء الجريان (انضمام جديد يحتاج IDR)
        if last_pli.elapsed() >= Duration::from_secs(2) {
            last_pli = Instant::now();
            let _ = track
                .write_rtcp(vec![Box::new(PictureLossIndication { sender_ssrc: 0, media_ssrc })])
                .await;
        }
        let evt = match track.poll().await {
            Some(e) => e,
            None => break,
        };
        let pkt = match evt {
            TrackRemoteEvent::OnRtpPacket(p) => p,
            _ => continue,
        };
        match depack.depacketize(&pkt.payload) {
            Ok(nal) => {
                if !nal.is_empty() {
                    frame_buf.extend_from_slice(&nal);
                }
                if pkt.header.marker && !frame_buf.is_empty() {
                    // اكتمل الإطار — فك ثم تحويل إلى YUYV وحقنه
                    match decoder.decode(&frame_buf) {
                        Ok(Some(yuv)) => {
                            let dims = yuv.dimensions();
                            let (w, h) = (dims.0 as u32, dims.1 as u32);
                            let s = yuv.strides();
                            if w >= 2 && h >= 2 {
                                let yuyv =
                                    core::yuv420_to_yuyv(yuv.y(), yuv.u(), yuv.v(), w, h, s.0, s.1);
                                let _ = vcam_tx().try_send(yuyv);
                                STATS.fetch_add(1, Ordering::Relaxed);
                                let mut d = VCAM_DIMS.lock().unwrap();
                                if d.0 != w || d.1 != h {
                                    *d = (w, h, 30);
                                }
                            }
                        }
                        Ok(None) => {} // إطار مرجعي — لا خروج بعد
                        Err(e) => println!("[media] h264 decode: {e}"),
                    }
                    frame_buf.clear();
                }
            }
            Err(_) => {} // حزمة فاسدة — تجاهل
        }
    }
    println!("[media] video decode loop ended");
}

/// فك صوت الهاتف Opus → PCM 48k ستيريو i16 → قناة الصوت الافتراضي
async fn audio_decode_loop(track: Arc<dyn TrackRemote>, stop: Arc<AtomicBool>) {
    let mut depack = OpusPacket::default();
    let mut decoder = match audiopus::coder::Decoder::new(
        audiopus::SampleRate::Hz48000,
        audiopus::Channels::Stereo,
    ) {
        Ok(d) => d,
        Err(e) => {
            println!("[media] opus decoder: {e}");
            return;
        }
    };
    let mut out = vec![0i16; 5760]; // 60ms كحد أقصى عند 48k ستيريو
    while !stop.load(Ordering::Relaxed) {
        let evt = match track.poll().await {
            Some(e) => e,
            None => break,
        };
        let pkt = match evt {
            TrackRemoteEvent::OnRtpPacket(p) => p,
            _ => continue,
        };
        let payload = match depack.depacketize(&pkt.payload) {
            Ok(p) => p,
            Err(_) => continue,
        };
        if payload.is_empty() {
            continue;
        }
        let packet = match audiopus::packet::Packet::try_from(&payload[..]) {
            Ok(p) => p,
            Err(_) => continue,
        };
        let muts = match audiopus::MutSignals::try_from(&mut out) {
            Ok(m) => m,
            Err(e) => {
                println!("[media] MutSignals: {e}");
                continue;
            }
        };
        match decoder.decode(Some(packet), muts, false) {
            Ok(frames) => {
                let n = frames * 2; // ستيريو
                if n > 0 {
                    let _ = vmic_tx().try_send(out[..n].to_vec());
                }
            }
            Err(e) => println!("[media] opus decode: {e}"),
        }
    }
    println!("[media] audio decode loop ended");
}

// ---------------------------------------------------------------------------
// جلسة الشاشة — دورة حياة كاملة (عقد §15)
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn media_screen_start(
    fps: Option<f64>,
    quality: Option<String>,
    target: Option<String>,
) -> Result<Value, String> {
    let quality = quality.unwrap_or_else(|| settings::get().media_quality.clone());
    let fps = core::sanitize_fps(fps.unwrap_or(settings::get().media_fps as f64));
    {
        let g = SCREEN.lock().unwrap();
        if g.is_some() {
            return Err("بث الشاشة قائم بالفعل — أوقفه أولًا".into());
        }
    }
    let tinfo = resolve_target(&target.unwrap_or_else(|| "default".into()))?;
    let (full_w, full_h, origin) = full_dims("default", &tinfo)?;
    let target_id = tinfo.as_ref().map(|t| t.id.clone()).unwrap_or_else(|| "default".into());
    let preset = core::quality_preset(&quality);
    let (w, h) = core::scaled_dims(full_w, full_h, preset.scale);

    // PeerConnection — عرض إرسال H264 (الشاشة صاحب الوسائط)
    let (me, reg) = engine_screen()?;
    let (gather_tx, mut gather_rx) = webrtc::runtime::channel::<()>(1);
    let handler = MediaHandler { gather_tx, kind: "screen".into(), role: "offer" };
    let pc: Arc<dyn PeerConnection> = Arc::new(
        PeerConnectionBuilder::new()
            .with_configuration(base_config().build())
            .with_media_engine(me)
            .with_interceptor_registry(reg)
            .with_handler(Arc::new(handler))
            .with_runtime(rt())
            .with_udp_addrs(vec!["0.0.0.0:0".to_string()])
            .build()
            .await
            .map_err(|e| format!("بناء اتصال الشاشة: {e}"))?,
    );
    let codec = h264_codec();
    let ssrc: u32 = 0x4E45_5853;
    let track: Arc<TrackLocalStaticSample> = TrackLocalStaticSample::new(
        Instant::now(),
        MediaStreamTrack::new(
            "nexuslink-screen".into(),
            "screen-video".into(),
            "screen".into(),
            RtpCodecKind::Video,
            vec![RTCRtpEncodingParameters {
                rtp_coding_parameters: RTCRtpCodingParameters {
                    ssrc: Some(ssrc),
                    ..Default::default()
                },
                codec: codec.rtp_codec.clone(),
                ..Default::default()
            }],
        ),
    )
    .map_err(|e| e.to_string())
    .map(Arc::new)?;

    let sender: Arc<dyn RtpSender> =
        pc.add_track(Arc::clone(&track) as Arc<dyn TrackLocal>).await.map_err(|e| e.to_string())?;
    let params = sender.get_parameters().await.map_err(|e| e.to_string())?;
    let payload_type = params
        .rtp_parameters
        .codecs
        .first()
        .map(|c| c.payload_type)
        .ok_or("لا رمز بعد التفاوض")?;

    // عرض + ترشيح كامل (غير ترشيحي — كل مرشحات host داخل SDP)
    let offer = pc.create_offer(None).await.map_err(|e| format!("إنشاء العرض: {e}"))?;
    pc.set_local_description(offer).await.map_err(|e| format!("الوصف المحلي: {e}"))?;
    let _ = gather_rx.recv().await;
    let offer_json = local_desc_json(&pc).await?;

    // قناة الإطارات + مهمة الإرسال إلى التُراك
    let (frame_tx, mut frame_rx) = webrtc::runtime::channel::<EncodedFrame>(8);
    let track2 = Arc::clone(&track);
    rt().spawn(Box::pin(async move {
        while let Some(f) = frame_rx.recv().await {
            let s = Sample {
                data: Bytes::from(f.data),
                timestamp: Instant::now(),
                duration: f.duration,
                packet_timestamp: 0,
                prev_dropped_packets: 0,
                prev_padding_packets: 0,
            };
            if track2.sample_writer(ssrc, payload_type).write_sample(&s).await.is_err() {
                break;
            }
        }
    }));

    // خيط الالتقاط/الترميز
    let stop = Arc::new(AtomicBool::new(false));
    let rebuild = Arc::new(AtomicBool::new(false));
    // G-37 — خلية الجودة الحية: يشاركها الخيط مع الجلسة ليقرأ التغييرات الحية
    let qos = LiveQoS::new(fps, quality.clone());
    {
        let stop2 = Arc::clone(&stop);
        let rebuild2 = Arc::clone(&rebuild);
        let target2 = target_id.clone();
        let qos2 = qos.clone();
        std::thread::Builder::new()
            .name("media-capture".into())
            .spawn(move || capture_loop(stop2, rebuild2, target2, qos2, frame_tx))
            .map_err(|e| format!("خيط الالتقاط: {e}"))?;
    }

    let mut gate = core::KindGate::new("screen", "offer");
    gate.mark_offered();
    *SCREEN.lock().unwrap() = Some(ScreenSess {
        gate,
        pc,
        stop,
        rebuild,
        qos,
        fps,
        quality,
        w: full_w,
        h: full_h,
        origin,
        target: target_id,
    });
    // فضاء المؤشر المطلق (عقد §15) — أبعاد الهدف + أصله في المركّب
    crate::input::exec::set_pointer_space(full_w, full_h, origin.0, origin.1);
    push_tray_media();
    println!("[media] screen streaming {full_w}x{full_h} @{fps} ({})", preset.name);
    Ok(json!({
        "ok": true,
        "offer": offer_json,
        "w": full_w, "h": full_h, "fps": fps, "quality": preset.name,
    }))
}

#[tauri::command]
pub async fn media_screen_answer(sdp: Value) -> Result<Value, String> {
    let (t, s) = core::parse_sdp_obj(&sdp)?;
    if t != "answer" {
        return Err("متوقع إجابة لعرض الشاشة".into());
    }
    let pc = {
        let mut g = SCREEN.lock().unwrap();
        let sess = g.as_mut().ok_or("لا بث شاشة قائم")?;
        if !sess.gate.accept_remote_answer() {
            return Ok(json!({"ok": true, "ignored": true})); // أول إجابة فقط (§4.3)
        }
        Arc::clone(&sess.pc)
    };
    let desc = RTCSessionDescription::answer(s).map_err(|e| format!("SDP الإجابة: {e}"))?;
    pc.set_remote_description(desc).await.map_err(|e| format!("الإجابة: {e}"))?;
    Ok(json!({"ok": true}))
}

#[tauri::command]
pub async fn media_screen_ice(candidate: Value) -> Result<Value, String> {
    let init = core::parse_ice_obj(&candidate)?;
    let init: RTCIceCandidateInit =
        serde_json::from_value(init).map_err(|e| format!("مرشح ICE: {e}"))?;
    let pc = {
        let g = SCREEN.lock().unwrap();
        match g.as_ref() {
            Some(s) => Arc::clone(&s.pc),
            None => return Ok(json!({"ok": true, "ignored": true})),
        }
    };
    pc.add_ice_candidate(init).await.map_err(|e| format!("إضافة مرشح: {e}"))?;
    Ok(json!({"ok": true}))
}

#[tauri::command]
pub async fn media_screen_stop() -> Result<Value, String> {
    screen_stop_async("phone-stop").await
}

async fn screen_stop_async(reason: &str) -> Result<Value, String> {
    let sess = SCREEN.lock().unwrap().take();
    match sess {
        Some(s) => {
            s.stop.store(true, Ordering::Relaxed);
            let _ = s.pc.close().await;
            // إعادة فضاء المؤشر للافتراضي (بلا بث — خريطة اللمس معطلة عمليًا)
            crate::input::exec::set_pointer_space(1920, 1080, 0, 0);
            push_tray_media();
            println!("[media] screen stopped ({reason})");
            Ok(json!({"ok": true}))
        }
        None => Ok(json!({"ok": true, "noop": true})),
    }
}

fn screen_stop_sync(reason: &str) -> Result<(), String> {
    let sess = SCREEN.lock().unwrap().take();
    if let Some(s) = sess {
        s.stop.store(true, Ordering::Relaxed);
        let pc = Arc::clone(&s.pc);
        rt().spawn(Box::pin(async move {
            let _ = pc.close().await;
        }));
        push_tray_media();
        println!("[media] screen stopped ({reason})");
    }
    Ok(())
}

/// تغيير الجودة أثناء البث — G-37: تبديل سلس (الخيط يعيد بناء الالتقاط والمشفّر
/// بالقيم الجديدة وتُرك اتصال WebRTC والتراك حيّين — بلا stop→req — عقد §15)
#[tauri::command]
pub async fn media_screen_set(fps: Option<f64>, quality: Option<String>) -> Result<Value, String> {
    let fps = fps.map(core::sanitize_fps);
    let quality = quality.filter(|q| ["low", "medium", "high", "ultra"].contains(&q.as_str()));
    settings::set_media_defaults(fps, quality.clone());
    let g = SCREEN.lock().unwrap();
    match g.as_mut() {
        Some(s) => {
            let changed = fps.is_some() || quality.is_some();
            s.qos.set(fps, quality.clone());
            if let Some(f) = fps {
                s.fps = f;
            }
            if let Some(q) = quality {
                s.quality = q;
            }
            if changed {
                s.rebuild.store(true, Ordering::Relaxed);
            }
            Ok(json!({"ok": true, "live": true, "w": s.w, "h": s.h,
                      "fps": s.fps, "quality": s.quality,
                      "note": "G-37: التبديل حي — أعيد بناء الالتقاط والمشفّر فقط والاتصال باقٍ"}))
        }
        None => Err("لا بث شاشة قائم".into()),
    }
}

/// شاشات/نوافذ قابلة للبث (البند 2)
#[tauri::command]
pub fn media_targets() -> Result<Value, String> {
    let targets = list_targets()?;
    Ok(json!(targets
        .iter()
        .map(|t| json!({"id": t.id, "kind": t.kind, "title": t.title, "origin": t.origin, "w": t.w, "h": t.h}))
        .collect::<Vec<_>>()))
}

// ---------------------------------------------------------------------------
// الويب كام — استقبال عروض الهاتف (cam/mic) والإجابة عليها
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn media_vcam_start(video: Option<bool>, audio: Option<bool>) -> Result<Value, String> {
    let video = video.unwrap_or(true);
    let audio = audio.unwrap_or(true);
    let status = vcam_driver_status_fresh();
    *VCAM_STATUS.lock().unwrap() = status.clone();
    *VCAM_WANTED.lock().unwrap() = (video, audio);
    // إطلاق الخيوط الحاقنة (إن لم تكن تعمل)
    if video {
        spawn_vcam_sink(&status)?;
    }
    if audio {
        spawn_vmic_sink(&status)?;
    }
    push_tray_media();
    // يبث للويبفيو — الويبفيو يطلب من الهاتف بدء البث (cam:cmd cam-start/mic-start)
    emit("media://vcam-start", json!({"video": video, "audio": audio}));
    Ok(json!({"ok": true, "status": status}))
}

#[tauri::command]
pub async fn media_vcam_stop() -> Result<Value, String> {
    *VCAM_WANTED.lock().unwrap() = (false, false);
    // يبث للويبفيو — الويبفيو يطلب إيقاف البث من الهاتف
    emit("media://vcam-stop", json!({"ok": true}));
    // إنهاء جلسات cam/mic إن كانت حية
    for kind in ["cam", "mic"] {
        let _ = kind_stop_async(kind, "vcam-stop").await;
    }
    // الخيوط الحاقنة تنتهي ذاتيًا بانسداد القنوات دون منتجين — ننسّف الحالة
    *VCAM_STATUS.lock().unwrap() = Value::Null;
    push_tray_media();
    Ok(json!({"ok": true}))
}

#[tauri::command]
pub fn media_vcam_status() -> Value {
    vcam_driver_status_fresh()
}

// ---------------------------------------------------------------------------
// المرحلة 0-وسائط (عقد §22) — تثبيت حزمة الكاميرا + مشغل النظام + إعدادات الصوت
// ---------------------------------------------------------------------------

/// SHA256 المتوقع لمثبّت akvirtualcamera المرفق (9.3.1 الرسمي) — التحقق قبل
/// التشغيل (نمط SHA256SUMS في vdd). قيمة محسوبة من الملف المُلتزم بالمستودع.
pub const VCAM_INSTALLER_SHA256: &str = "6a17c098d05bf380834ede5b1ad275762ebb216f667b73abc24ee9ba5ef459de";

/// التحقق من بصمة المثبّت عبر certutil (أداة ويندوز معيارية) — بلا كرِيت جديد.
#[cfg(windows)]
fn installer_sha256_matches(path: &std::path::Path) -> bool {
    let out = match std::process::Command::new("certutil")
        .args(["-hashfile"])
        .arg(path)
        .arg("SHA256")
        .output()
    {
        Ok(o) => o,
        Err(_) => return false,
    };
    let text = String::from_utf8_lossy(&out.stdout);
    // certutil يطبع البصمة في السطر الثاني (hex متصل)
    for line in text.lines().skip(1) {
        let hex: String = line.chars().filter(|c| c.is_ascii_hexdigit()).collect();
        if hex.len() == 64 {
            return hex.eq_ignore_ascii_case(VCAM_INSTALLER_SHA256);
        }
    }
    false
}

#[cfg(not(windows))]
fn installer_sha256_matches(_p: &std::path::Path) -> bool {
    false
}

/// مسار مثبّت الكاميرا المرفق — تخطيط الموارد المدمجة (نمط resolve_resources):
/// NSIS/portable → بجانب التنفيذي، التطوير → src-tauri/vcam.
fn vcam_installer_path() -> Option<std::path::PathBuf> {
    const NAME: &str = "akvirtualcamera-windows-9.3.1.exe";
    if let Some(app) = app_handle() {
        use tauri::Manager;
        if let Ok(rd) = app.path().resource_dir() {
            let p = rd.join("vcam").join(NAME);
            if p.exists() {
                return Some(p);
            }
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let p = dir.join("vcam").join(NAME);
            if p.exists() {
                return Some(p);
            }
        }
    }
    let dev = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("vcam").join(NAME);
    dev.exists().then_some(dev)
}

/// ضمانة §22 المشتركة: إن لم تكن كاميرا «NexusLink Camera» مسجلة أنشئها
/// (idempotent — لا يلمس أجهزة المستخدم الأخرى). تستعملها البداية والتثبيت.
#[cfg(not(target_os = "linux"))]
fn provision_camera_now() {
    let Some(manager) = akvcam_manager_resolved() else { return };
    let (ids, descriptions) = akvcam_devices_described(&manager);
    if let Some(plan) = core::ensure_camera_plan(&ids, &descriptions) {
        println!("[media] توفير كاميرا «{}» ({} أوامر)", core::NEXUS_CAMERA_NAME, plan.len());
        if let Err(e) = run_camera_plan(&manager, &plan) {
            println!("[media] التوفير تأجل — {e}");
        }
    }
}

/// تثبيت حزمة الكاميرا الافتراضية (ويندوز): مثبّت akvirtualcamera الرسمي
/// المرفق (GPL — الترخيص والمصدر في vcam/) بصمت `/S` عبر Start-Process -Verb
/// RunAs (موجة UAC واحدة)، ثم إنشاء «NexusLink Camera» إن لم تكن موجودة.
/// ماك: إرشاد صادق فقط (قيود التوقيع §3 من round4-audit). لينكس: غير مطلوب.
#[tauri::command]
pub async fn media_vcam_install() -> Result<Value, String> {
    let platform = std::env::consts::OS;
    if platform == "linux" {
        return Err("لينكس يستخدم v4l2loopback من مستودعات النظام — لا حزمة مرفقة (راجع الإرشاد)".into());
    }
    let installer = vcam_installer_path()
        .ok_or("حزمة الكاميرا المرفقة غائبة من هذا التوزيع — نزّل akvirtualcamera من github.com/webcamoid/akvirtualcamera/releases")?;
    if platform == "windows" {
        if !installer_sha256_matches(&installer) {
            return Err("بصمة مثبّت الكاميرا لا تطابق SHA256SUMS — رفض تشغيله (سلامة الحزمة)".into());
        }
        // Start-Process -Verb RunAs → موجة UAC واحدة؛ /S = صامت (NSIS معياري)
        let ps = format!(
            "Start-Process -FilePath '{}' -ArgumentList '/S' -Wait",
            installer.to_string_lossy().replace('\'', "''")
        );
        let out = std::process::Command::new("powershell")
            .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", &ps])
            .output()
            .map_err(|e| format!("تشغيل المثبّت: {e}"))?;
        if !out.status.success() {
            let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
            if err.is_empty() {
                return Err("المثبّت لم يكتمل (أُلغيت موجة الإذن؟) — أعد المحاولة".into());
            }
            return Err(format!("المثبّت فشل: {err}"));
        }
    } else {
        // ماك: pkg الرسمي — نفتحه (المستخدم يكمل المعاينة يدويًا — توقيع CMIO)
        #[cfg(target_os = "macos")]
        {
            let _ = std::process::Command::new("open").arg(&installer).spawn();
        }
        let _ = &installer;
    }
    // إعادة الكشف + إنشاء الكاميرا فورًا (بلا انتظار أول vcam-start)
    let status = vcam_driver_status_fresh();
    #[cfg(not(target_os = "linux"))]
    {
        provision_camera_now();
    }
    Ok(json!({ "ok": true, "status": status }))
}

/// فتح البث الحالي في مشغل سطح المكتب الافتراضي (عقد §22 — «stream مؤقت»):
/// نكتب ملف m3u معياريًا يشير إلى تيار HTTP Range القائم (/api/preview) ونفتحه
/// بالمعالج النظامي — مشغلات سطح المكتب (VLC/WMP/mpv) تشغّل تيار m3u بلا نسخ.
#[tauri::command]
pub fn media_open_player(url: String, name: Option<String>) -> Result<Value, String> {
    // تنقية: http(s) حصرًا + طول معقول + بلا أسطر (m3u سطرًا لكل عنوان)
    let u = url.trim();
    if !(u.starts_with("http://127.0.0.1:") || u.starts_with("http://localhost:") || u.starts_with("http://+")
        || (u.starts_with("http://") && !u[7..].starts_with(['/', '\\'])))
    {
        return Err("URL غير مدعوم — يُقبل http فقط (تيار /api/preview المحلي)".into());
    }
    if u.len() > 2048 || u.contains(['\r', '\n', '<', '>', '"']) {
        return Err("URL فاسد (طول/محارف غير آمنة)".into());
    }
    let nm = name.unwrap_or_else(|| "NexusLink Cast".into());
    let m3u = core::nexuslink_cast_m3u(&nm, u);
    let path = std::env::temp_dir().join(core::cast_m3u_file_name());
    std::fs::write(&path, m3u).map_err(|e| format!("كتابة قائمة التشغيل: {e}"))?;
    let path_str = path.to_string_lossy().to_string();
    let res = if cfg!(windows) {
        std::process::Command::new("cmd").args(["/C", "start", "", &path_str]).spawn()
    } else if cfg!(target_os = "macos") {
        std::process::Command::new("open").arg(&path_str).spawn()
    } else {
        std::process::Command::new("xdg-open").arg(&path_str).spawn()
    };
    match res {
        Ok(_) => Ok(json!({ "ok": true, "file": path_str })),
        Err(e) => Err(format!("فتح المشغل: {e} — إن لم يبدأ التشغيل اربط امتداد .m3u بمشغل وسائط")),
    }
}

/// فتح إعدادات صوت النظام (اختيار جهاز الإدخال الافتراضي للميكروفون)
#[tauri::command]
pub fn media_open_sound_settings() -> Result<Value, String> {
    let res = if cfg!(windows) {
        // ms-settings:sound — عنوان معياري في ويندوز 10/11
        std::process::Command::new("cmd").args(["/C", "start", "ms-settings:sound"]).spawn()
    } else if cfg!(target_os = "macos") {
        // لوحة الصوت المعيارية في النظام
        std::process::Command::new("open")
            .arg("/System/Library/PreferencePanes/Sound.prefPane")
            .spawn()
    } else {
        // لينكس: أفضل مجهود — pavucontrol إن وُجد
        std::process::Command::new("sh")
            .args(["-c", "command -v pavucontrol >/dev/null && exec pavucontrol"])
            .spawn()
    };
    match res {
        Ok(_) => Ok(json!({ "ok": true })),
        Err(_) => Err("لم أستطع فتح إعدادات الصوت — افتحها يدويًا من النظام واختر «NexusLink Mic» أو «CABLE Output»".into()),
    }
}

fn vcam_driver_status_fresh() -> Value {
    // كاش 2ث — الفحص يشغّل عدة عمليات (reg/-v/system-api/devices) والواجهة
    // تستعلم كل 5-6ث من بطاقتين؛ بلا كاش يصير عاصفة عمليات على ويندوز
    static CACHE: Mutex<Option<(Instant, Value)>> = Mutex::new(None);
    {
        let c = CACHE.lock().unwrap();
        if let Some((at, v)) = c.as_ref() {
            if at.elapsed() < Duration::from_secs(2) {
                return v.clone();
            }
        }
    }
    let fresh = vcam_driver_status_uncached();
    *CACHE.lock().unwrap() = Some((Instant::now(), fresh.clone()));
    fresh
}

fn vcam_driver_status_uncached() -> Value {
    let platform = std::env::consts::OS;
    // كشف فعلي: AkVCamManager (ويندوز/ماك) — السجل أولًا (installPath موثق من
    // مصدر المثبّت installscript.nsi) ثم المسارات المعروفة — §22
    let akvcam = if platform == "linux" {
        None
    } else {
        akvcam_manager_resolved()
    };
    // نسخة + واجهة + أجهزة الكاميرا (كلها من الأداة نفسها — بلا اختراع)
    let (akvcam_version, akvcam_api, camera_names) = match &akvcam {
        Some(m) => (run_manager_version(m), run_manager_api(m), camera_names_fresh(m)),
        None => (None, None, None),
    };
    let loopback = if platform == "linux" { count_loopback_devices() } else { 0 };
    let loopback_version = if platform == "linux" && loopback > 0 { loopback_version() } else { None };
    let audio_out = if platform == "linux" {
        None
    } else {
        audio_output_device_name()
    };
    let obs = platform != "linux" && obs_installed();
    core::vcam_driver_status_v2(
        platform,
        akvcam.map(|p| p.display().to_string()),
        akvcam_version,
        akvcam_api,
        camera_names,
        loopback,
        loopback_version,
        audio_out,
        obs,
    )
}

/// مسار AkVCamManager الفعلي: السجل (installPath — موثق installscript.nsi)
/// ثم المسارات المعروفة. يعيد الأول الموجود فعلًا على القرص.
#[cfg(any(windows, target_os = "macos"))]
fn akvcam_manager_resolved() -> Option<std::path::PathBuf> {
    // 1) السجل — مصدر الحقيقة للمثبّت الرسمي (ويندوز فقط)
    if cfg!(windows) {
        if let Ok(out) = std::process::Command::new("reg")
            .args(["query", r"HKLM\SOFTWARE\Webcamoid\VirtualCamera", "/v", "installPath"])
            .output()
        {
            let text = String::from_utf8_lossy(&out.stdout);
            if let Some(dir) = core::parse_reg_install_path(&text) {
                let p = std::path::PathBuf::from(dir.clone()).join("x64").join("AkVCamManager.exe");
                if p.exists() {
                    return Some(p);
                }
                let p = std::path::PathBuf::from(dir).join("AkVCamManager.exe");
                if p.exists() {
                    return Some(p);
                }
            }
        }
    }
    // 2) المسارات المعروفة (ماك + قِدَم)
    core::akvcam_manager_paths()
        .into_iter()
        .map(std::path::PathBuf::from)
        .find(|p| p.exists())
}

#[cfg(target_os = "linux")]
fn akvcam_manager_resolved() -> Option<std::path::PathBuf> {
    None
}

/// `AkVCamManager -v` → نسخة (cmdparser.cpp يطبع COMMONS_VERSION)
#[cfg(any(windows, target_os = "macos"))]
fn run_manager_version(manager: &std::path::Path) -> Option<String> {
    let out = std::process::Command::new(manager).arg("-v").output().ok()?;
    core::parse_akvcam_version(&String::from_utf8_lossy(&out.stdout))
        .or_else(|| core::parse_akvcam_version(&String::from_utf8_lossy(&out.stderr)))
}

#[cfg(target_os = "linux")]
fn run_manager_version(_m: &std::path::Path) -> Option<String> {
    None
}

/// `AkVCamManager system-api` → DirectShow / MediaFoundation / CoreMediaIO
#[cfg(any(windows, target_os = "macos"))]
fn run_manager_api(manager: &std::path::Path) -> Option<String> {
    let out = std::process::Command::new(manager).arg("system-api").output().ok()?;
    let l = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if l.is_empty() { None } else { Some(l.chars().take(32).collect()) }
}

#[cfg(target_os = "linux")]
fn run_manager_api(_m: &std::path::Path) -> Option<String> {
    None
}

/// أجهزة akvirtualcamera بالأوصاف — `devices -p` (معرف/سطر) ثم `description ID`
/// لكل معرف (cmdparser.cpp: showDevices parseable + showDeviceDescription).
#[cfg(not(target_os = "linux"))]
fn akvcam_devices_described(
    manager: &std::path::Path,
) -> (Vec<String>, Vec<(String, String)>) {
    use std::process::Command;
    let ids = Command::new(manager)
        .args(["devices", "-p"])
        .output()
        .map(|o| core::parse_akvcam_devices(&String::from_utf8_lossy(&o.stdout)))
        .unwrap_or_default();
    let mut descriptions = Vec::new();
    for id in ids.iter().take(8) {
        let d = Command::new(manager)
            .args(["description", id])
            .output()
            .ok()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .unwrap_or_default();
        descriptions.push((id.clone(), d));
    }
    (ids, descriptions)
}

/// أسماء الكاميرات للحالة (الوصف يغلب المعرف إن وُجد) — بلا لينكس
#[cfg(not(target_os = "linux"))]
fn camera_names_fresh(manager: &std::path::Path) -> Option<Vec<String>> {
    Some(
        akvcam_devices_described(manager)
            .1
            .into_iter()
            .map(|(id, d)| if d.is_empty() { id } else { d })
            .collect(),
    )
}

#[cfg(target_os = "linux")]
fn camera_names_fresh(_m: &std::path::Path) -> Option<Vec<String>> {
    None
}

/// نسخة v4l2loopback من modinfo (لينكس — معلومات الوحدة المعيارية)
#[cfg(target_os = "linux")]
fn loopback_version() -> Option<String> {
    let out = std::process::Command::new("modinfo").args(["-F", "version", "v4l2loopback"]).output().ok()?;
    let l = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if l.is_empty() { None } else { Some(l.chars().take(24).collect()) }
}

#[cfg(not(target_os = "linux"))]
fn loopback_version() -> Option<String> {
    None
}

/// كشف OBS المثبّت (بديل الكاميرا الافتراضي) — مسارات obs64.exe المعروفة.
/// CLSID كاميرا OBS يُحقن وقت بناء OBS (virtualcam-guid.h.in) — لا يصلح
/// علامة ثابتة، فالوجود هنا يكفي للتوجيه (§22).
#[cfg(any(windows, target_os = "macos"))]
fn obs_installed() -> bool {
    let candidates: &[&str] = if cfg!(windows) {
        &[
            r"C:\Program Files\obs-studio\bin\64bit\obs64.exe",
            r"C:\Program Files (x86)\obs-studio\bin\64bit\obs64.exe",
        ]
    } else {
        &["/Applications/OBS.app/Contents/MacOS/OBS"]
    };
    candidates.iter().any(|c| std::path::Path::new(c).exists())
}

#[cfg(target_os = "linux")]
fn obs_installed() -> bool {
    // لينكس: OBS عبر الحزم — الفحص عبر which (القناع الصادق يكفي هنا)
    std::process::Command::new("sh")
        .args(["-c", "command -v obs"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// عدّ أجهزة v4l2loopback من /sys/class/video4linux (لينكس فقط)
#[cfg(target_os = "linux")]
fn count_loopback_devices() -> usize {
    let mut entries = Vec::new();
    if let Ok(rd) = std::fs::read_dir("/sys/class/video4linux") {
        for e in rd.flatten() {
            let name = std::fs::read_to_string(e.path().join("name")).unwrap_or_default();
            entries.push((
                e.file_name().to_string_lossy().to_string(),
                name.trim().to_string(),
            ));
        }
    }
    core::parse_v4l2_entries(&entries).len()
}

#[cfg(not(target_os = "linux"))]
fn count_loopback_devices() -> usize {
    0
}

/// اسم جهاز الإخراج الافتراضي المطابق (ويندوز/ماك — عبر cpal)
#[cfg(any(windows, target_os = "macos"))]
fn audio_output_device_name() -> Option<String> {
    use cpal::traits::{DeviceTrait, HostTrait};
    let host = cpal::default_host();
    let mut names = Vec::new();
    if let Ok(devs) = host.output_devices() {
        for d in devs {
            // cpal 0.18: name() استُبدلت بdescription().name()
            if let Ok(desc) = d.description() {
                names.push(desc.name().to_string());
            }
        }
    }
    core::match_audio_output(&names)
}

#[cfg(target_os = "linux")]
fn audio_output_device_name() -> Option<String> {
    None // لينكس: module-pipe-source — لا حاجة لجهاز مقترن
}

#[tauri::command]
pub async fn media_answer(kind: String, sdp: Value) -> Result<Value, String> {
    // بوابة الويب كام: نُجيب فقط إن كنا طالبين هذا النوع (vcam مفعّل)
    let (want_v, want_a) = *VCAM_WANTED.lock().unwrap();
    let wanted = match kind.as_str() {
        "cam" => want_v || want_a, // كاميرا الهاتف تجلب فيديو+صوت معًا
        "mic" => want_a,
        _ => return Err(format!("نوع غير مدعوم للإجابة: {kind}")),
    };
    if !wanted {
        return Err(format!("الويب كام غير مفعلة لـ {kind} — فعّلها من بطاقة الوسائط"));
    }
    // أول إجابة فقط لكل kind (عقد §4.3) — الحارس الثاني بعد الجسر
    {
        let map = KINDS.lock().unwrap();
        if map.contains_key(&kind) {
            return Ok(json!({"ok": true, "ignored": true}));
        }
    }
    let (t, s) = core::parse_sdp_obj(&sdp)?;
    if t != "offer" {
        return Err(format!("متوقع عرضًا من الهاتف لـ {kind}"));
    }
    let (me, reg) = match kind.as_str() {
        "cam" => engine_cam()?,
        _ => engine_mic()?,
    };
    let (gather_tx, mut gather_rx) = webrtc::runtime::channel::<()>(1);
    let handler = MediaHandler { gather_tx, kind: kind.clone(), role: "answer" };
    let pc: Arc<dyn PeerConnection> = Arc::new(
        PeerConnectionBuilder::new()
            .with_configuration(base_config().build())
            .with_media_engine(me)
            .with_interceptor_registry(reg)
            .with_handler(Arc::new(handler))
            .with_runtime(rt())
            .with_udp_addrs(vec!["0.0.0.0:0".to_string()])
            .build()
            .await
            .map_err(|e| format!("بناء اتصال {kind}: {e}"))?,
    );
    let desc = RTCSessionDescription::offer(s).map_err(|e| format!("SDP العرض: {e}"))?;
    pc.set_remote_description(desc).await.map_err(|e| format!("العرض: {e}"))?;
    let answer = pc.create_answer(None).await.map_err(|e| format!("إنشاء الإجابة: {e}"))?;
    pc.set_local_description(answer).await.map_err(|e| format!("الوصف المحلي: {e}"))?;
    let _ = gather_rx.recv().await;
    let answer_json = local_desc_json(&pc).await?;
    KINDS.lock().unwrap().insert(
        kind.clone(),
        KindSess { pc: Arc::clone(&pc), stop: Arc::new(AtomicBool::new(false)) },
    );
    push_tray_media();
    println!("[media] answered {kind}");
    Ok(json!({"ok": true, "answer": answer_json}))
}

#[tauri::command]
pub async fn media_ice(kind: String, candidate: Value) -> Result<Value, String> {
    let init = core::parse_ice_obj(&candidate)?;
    let init: RTCIceCandidateInit =
        serde_json::from_value(init).map_err(|e| format!("مرشح ICE: {e}"))?;
    let pc = {
        let map = KINDS.lock().unwrap();
        match map.get(&kind) {
            Some(s) => Arc::clone(&s.pc),
            None => return Ok(json!({"ok": true, "ignored": true})),
        }
    };
    pc.add_ice_candidate(init).await.map_err(|e| format!("إضافة مرشح: {e}"))?;
    Ok(json!({"ok": true}))
}

#[tauri::command]
pub async fn media_kind_stop(kind: String) -> Result<Value, String> {
    kind_stop_async(&kind, "phone-stop").await
}

async fn kind_stop_async(kind: &str, reason: &str) -> Result<Value, String> {
    let sess = KINDS.lock().unwrap().remove(kind);
    match sess {
        Some(s) => {
            s.stop.store(true, Ordering::Relaxed);
            let _ = s.pc.close().await;
            push_tray_media();
            println!("[media] {kind} stopped ({reason})");
            Ok(json!({"ok": true}))
        }
        None => Ok(json!({"ok": true, "noop": true})),
    }
}

fn kind_stop_sync(kind: &str, reason: &str) -> Result<(), String> {
    let sess = KINDS.lock().unwrap().remove(kind);
    if let Some(s) = sess {
        s.stop.store(true, Ordering::Relaxed);
        let pc = Arc::clone(&s.pc);
        rt().spawn(Box::pin(async move {
            let _ = pc.close().await;
        }));
        push_tray_media();
        println!("[media] {kind} stopped ({reason})");
    }
    Ok(())
}

#[tauri::command]
pub fn media_status() -> Value {
    let (want_v, want_a) = *VCAM_WANTED.lock().unwrap();
    let screen = {
        let g = SCREEN.lock().unwrap();
        match g.as_ref() {
            Some(s) => json!({"on": true, "fps": s.fps, "quality": s.quality, "w": s.w, "h": s.h, "target": s.target}),
            None => json!({"on": false}),
        }
    };
    let dims = *VCAM_DIMS.lock().unwrap();
    json!({
        "screen": screen,
        "vcam": {"video": want_v, "audio": want_a, "dims": [dims.0, dims.1], "frames": STATS.load(Ordering::Relaxed)},
        "driver": VCAM_STATUS.lock().unwrap().clone(),
    })
}

/// إيقاف كل الوسائط عند الخروج (main.rs → RunEvent)
pub fn stop_all() {
    if let Ok(mut g) = SCREEN.lock() {
        if let Some(s) = g.take() {
            s.stop.store(true, Ordering::Relaxed);
            let pc = Arc::clone(&s.pc);
            rt().spawn(Box::pin(async move {
                let _ = pc.close().await;
            }));
        }
    }
    if let Ok(mut map) = KINDS.lock() {
        for (_, s) in map.drain() {
            s.stop.store(true, Ordering::Relaxed);
            let pc = Arc::clone(&s.pc);
            rt().spawn(Box::pin(async move {
                let _ = pc.close().await;
            }));
        }
    }
    *VCAM_WANTED.lock().unwrap() = (false, false);
}

// ---------------------------------------------------------------------------
// الحاقنات — خيوط تستهلك قنوات YUYV/PCM وتكتب الأجهزة الافتراضية
// (نمط مشترك: قناة primitives → مستهلك خيطي عبر try_recv + نوم قصير —
//  القناة waker-driven لكن الاستقصاء 8ms هنا مقبول تمامًا لمعدل الفيديو)
// ---------------------------------------------------------------------------

fn spawn_vcam_sink(status: &Value) -> Result<(), String> {
    let platform = std::env::consts::OS;
    if platform == "linux" {
        spawn_v4l2_sink(status)
    } else {
        spawn_akvcam_sink(status)
    }
}

fn spawn_vmic_sink(status: &Value) -> Result<(), String> {
    let platform = std::env::consts::OS;
    if platform == "linux" {
        spawn_pulse_sink(status)
    } else {
        spawn_cpal_sink(status)
    }
}

// ----- لينكس: v4l2loopback (YUYV + S_FMT ioctl) -----

#[repr(C)]
struct V4l2Fmt {
    type_: u32,
    /// v4l2_pix_format (48 بايت) + حشوة الاتحاد حتى 200
    pix: [u8; 200],
    /// حشوة للتوافق مع sizeof(struct v4l2_format) = 208 على 64-بت
    pad: [u8; 4],
}

const VIDIOC_S_FMT: std::ffi::c_ulong = 0xC0D05659; // _IOWR('V', 89, struct v4l2_format) 64-بت
const V4L2_BUF_TYPE_VIDEO_OUTPUT: u32 = 2;
const V4L2_PIX_FMT_YUYV: u32 = 0x56595559; // 'YUYV' little-endian

#[cfg(target_os = "linux")]
fn v4l2_set_yuyv(fd: i32, w: u32, h: u32) -> Result<(), String> {
    let mut fmt = V4l2Fmt { type_: V4L2_BUF_TYPE_VIDEO_OUTPUT, pix: [0u8; 200], pad: [0; 4] };
    let put = |buf: &mut [u8], off: usize, v: u32| buf[off..off + 4].copy_from_slice(&v.to_ne_bytes());
    put(&mut fmt.pix, 0, w); // width
    put(&mut fmt.pix, 4, h); // height
    put(&mut fmt.pix, 8, V4L2_PIX_FMT_YUYV); // pixelformat
    put(&mut fmt.pix, 12, 0); // field = NONE
    put(&mut fmt.pix, 16, w * 2); // bytesperline
    put(&mut fmt.pix, 20, w * h * 2); // sizeimage
    let r = unsafe { ioctl(fd, VIDIOC_S_FMT, &mut fmt as *mut V4l2Fmt as *mut std::ffi::c_void) };
    if r < 0 {
        return Err(format!("S_FMT فشل (errno {})", std::io::Error::last_os_error()));
    }
    // التحقق من ما وافق عليه السائق
    let got_w = u32::from_ne_bytes(fmt.pix[0..4].try_into().unwrap());
    let got_h = u32::from_ne_bytes(fmt.pix[4..8].try_into().unwrap());
    if got_w != w || got_h != h {
        return Err(format!("السائق رفض {w}x{h} وقبل {got_w}x{got_h}"));
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn spawn_v4l2_sink(_status: &Value) -> Result<(), String> {
    let mut entries = Vec::new();
    if let Ok(rd) = std::fs::read_dir("/sys/class/video4linux") {
        for e in rd.flatten() {
            let name = std::fs::read_to_string(e.path().join("name")).unwrap_or_default();
            entries.push((e.file_name().to_string_lossy().to_string(), name.trim().to_string()));
        }
    }
    let devs = core::parse_v4l2_entries(&entries);
    let dev = devs
        .first()
        .map(|(n, _)| format!("/dev/{n}"))
        .ok_or("لا جهاز v4l2loopback — ثبّت الوحدة (راجع الإرشاد)")?;
    std::thread::Builder::new()
        .name("vcam-v4l2".into())
        .spawn(move || v4l2_writer(dev))
        .map_err(|e| format!("خيط الكاميرا: {e}"))?;
    Ok(())
}

#[cfg(not(target_os = "linux"))]
fn spawn_v4l2_sink(_status: &Value) -> Result<(), String> {
    Err("v4l2 غير متاح على هذه المنصة".into())
}

/// مستهلك قناة YUYV → جهاز v4l2loopback — يعيد الفتح عند تغيّر الأبعاد
#[cfg(target_os = "linux")]
fn v4l2_writer(dev_path: String) {
    use std::io::Write;
    use std::os::unix::io::{AsRawFd, FromRawFd};
    let mut rx = match vcam_take_rx() {
        Some(r) => r,
        None => return,
    };
    let mut cur_dims: (u32, u32) = (0, 0);
    let mut file: Option<std::fs::File> = None;
    loop {
        match rx.try_recv() {
            Ok(frame) => {
                let dims = *VCAM_DIMS.lock().unwrap();
                let (w, h) = (dims.0, dims.1);
                if w < 2 || h < 2 {
                    continue; // لم يُحدد البعد بعد
                }
                if (w, h) != cur_dims || file.is_none() {
                    // إعادة فتح بضبط YUYV الصحيح
                    file = None;
                    let path = std::ffi::CString::new(dev_path.clone()).unwrap();
                    let fd = unsafe { libc_open(path.as_ptr(), 2 /* O_RDWR */) };
                    if fd < 0 {
                        println!("[media] فتح {dev_path} فشل — إعادة المحاولة");
                        std::thread::sleep(Duration::from_secs(1));
                        continue;
                    }
                    let f = unsafe { std::fs::File::from_raw_fd(fd) };
                    if let Err(e) = v4l2_set_yuyv(f.as_raw_fd(), w, h) {
                        println!("[media] {e}");
                        continue;
                    }
                    println!("[media] v4l2 {dev_path} ← YUYV {w}x{h}");
                    cur_dims = (w, h);
                    file = Some(f);
                }
                if let Some(f) = file.as_mut() {
                    if f.write_all(&frame).is_err() {
                        println!("[media] كتابة v4l2 فشلت — إعادة الفتح");
                        file = None;
                        cur_dims = (0, 0);
                    }
                }
            }
            Err(_) => std::thread::sleep(Duration::from_millis(8)),
        }
    }
}

// ----- ويندوز/ماك: akvirtualcamera (AkVCamManager stream YUY2 من stdin) -----

#[cfg(not(target_os = "linux"))]
fn spawn_akvcam_sink(_status: &Value) -> Result<(), String> {
    let manager = akvcam_manager_resolved()
        .ok_or("AkVCamManager غير موجود — ثبّت akvirtualcamera (أو «تثبيت حزمة الكاميرا» من لوحة الأدوات)")?;
    // ضمانة §22: إن لم تسجل كاميرا «NexusLink Camera» ننشئها تلقائيًا —
    // «NexusLink Camera» تظهر في Zoom/Meet بلا أي خطوة يدوية (idempotent:
    // نتحقق من الأوصاف أولًا ولا نلمس أجهزة المستخدم الأخرى — لا load المدمر).
    provision_camera_now();
    let (ids, descriptions) = akvcam_devices_described(&manager);
    let device = descriptions
        .iter()
        .find(|(_, d)| d.eq_ignore_ascii_case(core::NEXUS_CAMERA_NAME))
        .map(|(id, _)| id.clone())
        .or_else(|| ids.first().cloned())
        .ok_or("لا كاميرا افتراضية مسجلة — أنشئ جهازًا عبر AkVCamManager add-device (راجع الإرشاد)")?;
    std::thread::Builder::new()
        .name("vcam-akvcam".into())
        .spawn(move || akvcam_writer(manager.to_string_lossy().to_string(), device))
        .map_err(|e| format!("خيط الكاميرا: {e}"))?;
    Ok(())
}

/// تنفيذ خطة ensure_camera_plan (أوامر argv مهيكلة) — add-device -p يرد
/// المعرف الجديد (cmdparser.cpp: parseable → AkPrintOut(deviceId)) ونستبدل
/// @NEW@ به في أوامر add-format التالية.
#[cfg(not(target_os = "linux"))]
fn run_camera_plan(manager: &std::path::Path, plan: &[Vec<String>]) -> Result<String, String> {
    use std::process::Command;
    let mut new_id = String::new();
    for argv in plan {
        if argv.is_empty() {
            continue;
        }
        let args: Vec<String> = argv[1..]
            .iter()
            .map(|a| a.replace("@NEW@", &new_id))
            .collect();
        let mut c = Command::new(manager);
        c.arg(&argv[0]);
        if argv[0] == "add-device" {
            c.arg("-p"); // المعرف يطبع وحده — نلتقطه للصيغ التالية
        }
        for a in &args {
            c.arg(a); // الوصف يمر وسيطًا واحدًا (add-device يقرأ args[1] حصرًا)
        }
        let out = c.output().map_err(|e| format!("{}: {e}", argv[0]))?;
        let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !out.status.success() {
            return Err(format!("{} فشل: {}", argv[0], String::from_utf8_lossy(&out.stderr).trim()));
        }
        if argv[0] == "add-device" {
            // parseable: السطر الأخير هو المعرف
            new_id = text.lines().last().unwrap_or("").trim().to_string();
            if new_id.is_empty() {
                return Err("add-device لم يرد معرفًا".into());
            }
            println!("[media] أُنشئت كاميرا {new_id} «{}»", core::NEXUS_CAMERA_NAME);
        }
    }
    if new_id.is_empty() {
        return Err("خطة التوفير لم تُنتج جهازًا".into());
    }
    Ok(new_id)
}

#[cfg(target_os = "linux")]
fn spawn_akvcam_sink(_status: &Value) -> Result<(), String> {
    Err("akvirtualcamera على لينكس غير مسند — استخدم v4l2loopback".into())
}

/// مستهلك قناة YUYV → عملية AkVCamManager stream — يعيد التشغيل عند تغيّر الأبعاد
#[cfg(not(target_os = "linux"))]
fn akvcam_writer(manager: String, device: String) {
    use std::io::Write;
    use std::process::{Child, Command, Stdio};
    let mut rx = match vcam_take_rx() {
        Some(r) => r,
        None => return,
    };
    let mut cur_dims: (u32, u32) = (0, 0);
    let mut child: Option<Child> = None;
    let mut stdin: Option<std::process::ChildStdin> = None;
    loop {
        match rx.try_recv() {
            Ok(frame) => {
                let dims = *VCAM_DIMS.lock().unwrap();
                let (w, h) = (if dims.0 > 0 { dims.0 } else { 1280 }, if dims.1 > 0 { dims.1 } else { 720 });
                if (w, h) != cur_dims || child.is_none() {
                    // إعادة تشغيل stream بالأبعاد الجديدة
                    if let Some(mut c) = child.take() {
                        let _ = c.kill();
                        let _ = c.wait();
                    }
                    stdin = None;
                    let mut c = match Command::new(&manager)
                        .args(core::akvcam_stream_args(&device, w, h, 30))
                        .stdin(Stdio::piped())
                        .stdout(Stdio::null())
                        .stderr(Stdio::null())
                        .spawn()
                    {
                        Ok(c) => c,
                        Err(e) => {
                            println!("[media] AkVCamManager stream: {e}");
                            std::thread::sleep(Duration::from_secs(2));
                            continue;
                        }
                    };
                    stdin = c.stdin.take();
                    child = Some(c);
                    cur_dims = (w, h);
                    println!("[media] akvcam stream {device} YUY2 {w}x{h}");
                }
                if let Some(si) = stdin.as_mut() {
                    if si.write_all(&frame).is_err() || si.flush().is_err() {
                        println!("[media] تغذية akvcam انقطعت — إعادة التشغيل");
                        stdin = None;
                        if let Some(mut c) = child.take() {
                            let _ = c.kill();
                            let _ = c.wait();
                        }
                        cur_dims = (0, 0);
                    }
                }
            }
            Err(_) => std::thread::sleep(Duration::from_millis(8)),
        }
    }
}

// ----- لينكس: ميكروفون افتراضي عبر PulseAudio/PipeWire module-pipe-source -----

const MIC_PCM_PATH: &str = "/tmp/nexuslink-mic.pcm";

#[cfg(target_os = "linux")]
fn spawn_pulse_sink(_status: &Value) -> Result<(), String> {
    // إنشاء المصدر الافتراضي (idempotent: أزل القديم أولًا)
    let _ = std::process::Command::new("pactl")
        .args(["unload-module", "module-pipe-source"])
        .output();
    let out = std::process::Command::new("pactl")
        .args([
            "load-module", "module-pipe-source",
            "source_name=NexusLinkMic",
            &format!("file={MIC_PCM_PATH}"),
            "format=s16le", "rate=48000", "channels=2",
        ])
        .output()
        .map_err(|e| format!("pactl: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "module-pipe-source فشل: {} — ثبّت PulseAudio/PipeWire أو راجع الإرشاد",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    std::thread::Builder::new()
        .name("vmic-pulse".into())
        .spawn(|| pulse_writer())
        .map_err(|e| format!("خيط الميكروفون: {e}"))?;
    Ok(())
}

#[cfg(target_os = "linux")]
fn pulse_writer() {
    use std::io::Write;
    use std::os::unix::io::FromRawFd;
    let mut rx = match vmic_take_rx() {
        Some(r) => r,
        None => return,
    };
    // O_RDWR يمنع الانسداد حتى قبل اتصال القارئ
    let path = std::ffi::CString::new(MIC_PCM_PATH).unwrap();
    let fd = unsafe { libc_open(path.as_ptr(), 2) };
    if fd < 0 {
        println!("[media] فتح FIFO الميكروفون فشل");
        return;
    }
    let mut file = unsafe { std::fs::File::from_raw_fd(fd) };
    loop {
        match rx.try_recv() {
            Ok(pcm) => {
                let bytes: Vec<u8> = pcm.iter().flat_map(|s| s.to_ne_bytes()).collect();
                if file.write_all(&bytes).is_err() {
                    println!("[media] كتابة FIFO فشلت — نهاية حاقن الصوت");
                    return;
                }
            }
            Err(_) => std::thread::sleep(Duration::from_millis(10)),
        }
    }
}

#[cfg(not(target_os = "linux"))]
fn spawn_pulse_sink(_status: &Value) -> Result<(), String> {
    Err("module-pipe-source غير متاح — استخدم cpal".into())
}

// ----- ويندوز/ماك: إخراج cpal إلى درايفر الصوت الافتراضي المكتشف -----

#[cfg(any(windows, target_os = "macos"))]
fn spawn_cpal_sink(_status: &Value) -> Result<(), String> {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    use std::collections::VecDeque;
    let host = cpal::default_host();
    let mut target: Option<cpal::Device> = None;
    if let Ok(devs) = host.output_devices() {
        for d in devs {
            let name = d.description().map(|x| x.name().to_string()).unwrap_or_default();
            if core::match_audio_output(&[name.clone()]).is_some() {
                target = Some(d);
                break;
            }
        }
    }
    let device = target.ok_or("لا درايفر صوت افتراضي — ثبّت VB-CABLE/BlackHole (راجع الإرشاد)")?;
    let cfg = device.default_output_config().map_err(|e| format!("صيغة الإخراج: {e}"))?;
    let rate = cfg.sample_rate();
    let channels = cfg.channels() as usize;
    let dev_name = device.description().map(|x| x.name().to_string()).unwrap_or_default();
    println!("[media] audio sink: {dev_name} @ {rate}Hz x{channels}");
    let buffer: Arc<Mutex<VecDeque<i16>>> = Arc::new(Mutex::new(VecDeque::with_capacity(9600)));
    let err_fn = |e| println!("[media] cpal stream error: {e}");
    // مهمة التغذية: قناة PCM (48k) → buffer مع إعادة تشكيل خطية إن لزم
    let buf2 = Arc::clone(&buffer);
    let mut vmic_rx = match vmic_take_rx() {
        Some(r) => r,
        None => return Err("قناة الصوت غير مهيأة — أعد تشغيل الويب كام".into()),
    };
    rt().spawn(Box::pin(async move {
        loop {
            match vmic_rx.try_recv() {
                Ok(mut pcm) => {
                    // إعادة تشكيل خطية 48000 → rate إن لزم (ستيريو)
                    let src_frames = pcm.len() / 2;
                    if rate != 48000 && src_frames > 1 {
                        let dst_frames = (src_frames as u64 * rate as u64 / 48000) as usize;
                        let mut out = Vec::with_capacity(dst_frames * 2);
                        for i in 0..dst_frames {
                            let pos = i as f64 * 48000.0 / rate as f64;
                            let i0 = (pos as usize).min(src_frames - 1);
                            let i1 = (i0 + 1).min(src_frames - 1);
                            let frac = pos - i0 as f64;
                            let l = pcm[i0 * 2] as f64 * (1.0 - frac) + pcm[i1 * 2] as f64 * frac;
                            let r = pcm[i0 * 2 + 1] as f64 * (1.0 - frac) + pcm[i1 * 2 + 1] as f64 * frac;
                            out.push(l as i16);
                            out.push(r as i16);
                        }
                        pcm = out;
                    }
                    let mut b = buf2.lock().unwrap();
                    for s in pcm {
                        if b.len() > 19200 {
                            break; // سقف ~200ms — إسقاط بدل التراكم اللانهائي
                        }
                        b.push_back(s);
                    }
                }
                Err(_) => std::thread::sleep(Duration::from_millis(10)),
            }
        }
    }));
    // ستريم الإخراج — يملأ من المخزن أو صمتًا
    let stream = match cfg.sample_format() {
        cpal::SampleFormat::I16 => device.build_output_stream(
            cpal::StreamConfig { channels: channels as u16, sample_rate: cfg.sample_rate(), buffer_size: cpal::BufferSize::Default },
            move |data: &mut [i16], _: &cpal::OutputCallbackInfo| {
                let mut b = buffer.lock().unwrap();
                for s in data.iter_mut() {
                    *s = b.pop_front().unwrap_or(0);
                }
            },
            err_fn,
            None,
        ),
        cpal::SampleFormat::F32 => device.build_output_stream(
            cpal::StreamConfig { channels: channels as u16, sample_rate: cfg.sample_rate(), buffer_size: cpal::BufferSize::Default },
            move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                let mut b = buffer.lock().unwrap();
                for s in data.iter_mut() {
                    *s = b.pop_front().unwrap_or(0) as f32 / 32768.0;
                }
            },
            err_fn,
            None,
        ),
        _ => Err(cpal::ErrorKind::DeviceNotAvailable.into()),
    };
    match stream {
        Ok(s) => {
            s.play().map_err(|e| format!("تشغيل الصوت: {e}"))?;
            std::mem::forget(s); // البقاء حتى نهاية الجلسة (v1 — موثق §15)
            Ok(())
        }
        Err(e) => Err(format!("فشل بناء ستريم الصوت: {e}")),
    }
}

#[cfg(target_os = "linux")]
fn spawn_cpal_sink(_status: &Value) -> Result<(), String> {
    Err("cpal غير مستخدم على لينكس — module-pipe-source بدلًا منه".into())
}

// ----- FFI مشترك (مفتوح POSIX + ioctl) -----

unsafe extern "C" {
    // open في libc متغيّرة: int open(const char*, int, ...) — التوقيع الثابت
    // يرفضه لاينت invalid_runtime_symbol_definitions الجديد (CI ماك جولة 3)
    #[link_name = "open"]
    fn libc_open(path: *const std::ffi::c_char, flags: i32, ...) -> i32;
    fn ioctl(fd: i32, request: std::ffi::c_ulong, arg: *mut std::ffi::c_void) -> i32;
}
