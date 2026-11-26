// Spike test: validator + destructive filter + loopback guard + mock model server.
import { validateProposal, planCommand } from "../src/lib/nexus/assistant-planner"
let pass = 0, fail = 0
const ok = (c: boolean, n: string) => { c ? pass++ : fail++; console.log((c ? "  ✓ " : "  ✗ ") + n) }

ok(validateProposal({ action: "send_files", kind: "photo", count: -1 }, "x").ok && (validateProposal({ action: "send_files", count: -1 }, "x") as any).plan.args.count === 1, "negative count clamped to 1")
ok((validateProposal({ action: "send_files", count: 99999 }, "x") as any).plan.args.count === 100, "huge count clamped to 100")
ok((validateProposal({ action: "set_dnd", on: true, minutes: 0 }, "x") as any).plan.args.minutes === 5, "dnd minutes floor 5")
ok(!validateProposal({ action: "rm_rf" }, "x").ok, "unknown action rejected")
ok(!validateProposal({ action: "search", query: "  " }, "x").ok, "empty search rejected")
ok((validateProposal({ action: "start_mirror" }, "x") as any).plan.needsConfirm === true, "every plan needs confirmation")

const srv = Bun.serve({ port: 0, fetch: () => Response.json({ choices: [{ message: { content: JSON.stringify({ action: "search", query: "فاتورة" }) } }] }) })
const base = `http://127.0.0.1:${srv.port}`
const r = await planCommand("ابحث عن فاتورة", base)
ok(r.ok && (r as any).plan.action === "search", "mock local model -> validated plan")
ok((await planCommand("امسح كل ملفات الهاتف", base) as any).reason === "destructive", "destructive request blocked before the model")
ok((await planCommand("delete everything", base) as any).reason === "destructive", "destructive (English) blocked")
ok((await planCommand("search x", "http://example.com:8080") as any).reason === "refused", "non-loopback endpoint refused")
ok((await planCommand("search x", "http://127.0.0.1:1") as any).reason === "no-llm", "no runtime -> no-llm (graceful)")
srv.stop()
console.log(`${pass} pass, ${fail} fail`); process.exit(fail ? 1 : 0)
