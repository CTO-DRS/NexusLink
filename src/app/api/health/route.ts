// NexusLink — فحص جاهزية السيرفر (للتطبيقات المضمّنة: سطح المكتب/الوكيل)
// GET /api/health → 200 {ok, proto, ts, uptime} — بلا آثار جانبية، بلا مصادقة (نمط الجسور).
export const dynamic = "force-dynamic"

export async function GET() {
  return Response.json({
    ok: true,
    proto: "Nexus/1.2",
    ts: Date.now(),
    uptime: process.uptime(),
  })
}
