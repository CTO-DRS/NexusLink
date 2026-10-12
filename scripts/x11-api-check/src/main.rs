// فحص توافق أنماط x11rb 0.13 المستخدمة في media.rs — تجميع محلي بلا X11 (أنواع فقط)
use x11rb::connection::Connection;
use x11rb::cookie::Cookie;
use x11rb::errors::ConnectionError;
use x11rb::protocol::randr;
use x11rb::protocol::xproto::{ConnectionExt, ImageFormat};
use x11rb::x11_utils::TryParse;

// المساعد المخطط له في media.rs — جسر بين خطأ الإرسال (ConnectionError) وخطأ الرد (ReplyError)
fn x11reply<C, R>(cookie: Result<Cookie<'_, C, R>, ConnectionError>) -> Option<R>
where
    C: x11rb::connection::RequestConnection + ?Sized,
    R: TryParse,
{
    let c = cookie.ok()?;
    c.reply().ok()
}

fn main() {
    let (conn, screen_num) = x11rb::connect(None).unwrap();
    let root = conn.setup().roots[screen_num].root;

    // نمط 1: get_monitors حرة + if let Some
    if let Some(reply) = x11reply(randr::get_monitors(&conn, root, true)) {
        for m in reply.monitors.iter() {
            let _ = (m.x as i32, m.width as u32);
        }
    }
    // نمط 2: query_tree + get_property + get_geometry/translate_coordinates
    if let Some(reply) = x11reply(conn.query_tree(root)) {
        for win in reply.children.iter().take(4) {
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
            let _ = name;
            if let (Some(geo), Some(tr)) = (
                x11reply(conn.get_geometry(*win)),
                x11reply(conn.translate_coordinates(*win, root, 0, 0)),
            ) {
                let _ = (geo.width as u32, tr.dst_x as i32);
            }
        }
    }
    // نمط 3: ok_or_else على list_targets الشكل 526
    let geo = x11reply(conn.get_geometry(root))
        .ok_or_else(|| "X11: get_geometry".to_string())
        .unwrap();
    let _ = (geo.width as u32, geo.height as u32);
    // نمط 4: match على get_image (شكل 745) — GetImageReply بلا width/height!
    // الأبعاد من معاملات الطلب نفسها — data طوله w*h*4 للـ ZPixmap 32bpp
    let (rw, rh): (u16, u16) = (8, 8);
    let img = match x11reply(conn.get_image(ImageFormat::Z_PIXMAP, root, 0, 0, rw, rh, !0u32)) {
        Some(i) => i,
        None => std::process::exit(0),
    };
    let _ = (img.depth, &img.data, rw as u32, rh as u32);
    println!("x11 api patterns OK: root={}x{}", geo.width, geo.height);
}
