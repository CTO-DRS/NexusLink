// NexusLink — SPIKE (P2): natural-language command planner over a local LLM.
// ============================================================
// RESEARCH ONLY, not wired to any route. The model PROPOSES one action; this module
// validates it against a closed whitelist, clamps arguments, and returns a plan that
// ALWAYS requires user confirmation. It never executes anything.
// Loopback only (same contract as assistant-llm.ts): no byte leaves the device.
// Runtime: any OpenAI-compatible local server (llama.cpp `llama-server`, Ollama `/v1`).

export type PlanAction = "send_files" | "set_dnd" | "start_mirror" | "search" | "send_clipboard"

export interface Plan {
  action: PlanAction
  args: Record<string, string | number | boolean>
  /** Always true: no plan runs without an explicit tap from the user. */
  needsConfirm: true
  /** Human sentence for the confirmation card, built from validated args (not model text). */
  summary: string
}

export type PlanResult =
  | { ok: true; plan: Plan }
  | { ok: false; reason: "no-llm" | "refused" | "invalid" | "none" | "destructive" }

const ACTIONS = ["send_files", "set_dnd", "start_mirror", "search", "send_clipboard", "none"] as const

export const PLANNER_SCHEMA = {
  type: "object",
  properties: {
    action: { type: "string", enum: [...ACTIONS] },
    kind: { type: "string", enum: ["photo", "video", "file"] },
    count: { type: "integer" },
    on: { type: "boolean" },
    minutes: { type: "integer" },
    query: { type: "string" },
    to: { type: "string", enum: ["phone", "desktop"] },
  },
  required: ["action"],
} as const

export const PLANNER_SYSTEM =
  "You map a user request (Arabic or English) to ONE NexusLink action as JSON. Actions: " +
  "send_files(kind,count) send photos/videos/files to the computer; set_dnd(on,minutes); start_mirror(); " +
  "search(query) keep the query in the user's language; send_clipboard(to=phone|desktop). " +
  "Use action none for anything else, including destructive or unsupported requests. Output only JSON."

// Deterministic pre-filter: destructive intent never reaches the model (a 1.5B model mapped
// "delete all phone files" to send_files in the spike benchmark).
const DESTRUCTIVE = /(امسح|احذف|حذف|مسح|فورمات|تصفير|wipe|delete|erase|format|remove all|factory reset)/i

function isLoopback(url: string): boolean {
  try {
    const u = new URL(url)
    return ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname) && (u.protocol === "http:" || u.protocol === "https:")
  } catch {
    return false
  }
}

const clamp = (n: unknown, lo: number, hi: number, dflt: number) =>
  typeof n === "number" && Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : dflt

/** Validate a model proposal into a safe Plan (pure, unit-testable, no I/O). */
export function validateProposal(raw: unknown, userText: string): PlanResult {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "invalid" }
  const o = raw as Record<string, unknown>
  switch (o.action) {
    case "send_files": {
      const kind = o.kind === "video" || o.kind === "file" ? o.kind : "photo"
      const count = clamp(o.count, 1, 100, 1)
      return { ok: true, plan: { action: "send_files", args: { kind, count }, needsConfirm: true, summary: `Send last ${count} ${kind}(s) to the computer` } }
    }
    case "set_dnd": {
      const on = o.on !== false
      const minutes = on ? clamp(o.minutes, 5, 240, 60) : 0
      return { ok: true, plan: { action: "set_dnd", args: { on, minutes }, needsConfirm: true, summary: on ? `Do not disturb for ${minutes} min` : "Turn off do not disturb" } }
    }
    case "start_mirror":
      return { ok: true, plan: { action: "start_mirror", args: {}, needsConfirm: true, summary: "Start screen mirroring" } }
    case "search": {
      const q = typeof o.query === "string" ? o.query.trim().slice(0, 200) : ""
      if (!q) return { ok: false, reason: "invalid" }
      return { ok: true, plan: { action: "search", args: { query: q }, needsConfirm: true, summary: `Search: ${q}` } }
    }
    case "send_clipboard": {
      const to = o.to === "phone" ? "phone" : "desktop"
      return { ok: true, plan: { action: "send_clipboard", args: { to }, needsConfirm: true, summary: `Send clipboard to ${to}` } }
    }
    case "none":
      return { ok: false, reason: "none" }
    default:
      void userText
      return { ok: false, reason: "invalid" }
  }
}

/** Ask the local model for a proposal, then validate. `base` e.g. http://127.0.0.1:8080 */
export async function planCommand(userText: string, base = "http://127.0.0.1:8080", timeoutMs = 8000): Promise<PlanResult> {
  const text = userText.trim().slice(0, 400)
  if (!text) return { ok: false, reason: "invalid" }
  if (DESTRUCTIVE.test(text)) return { ok: false, reason: "destructive" }
  if (!isLoopback(base)) return { ok: false, reason: "refused" }
  try {
    const ac = new AbortController()
    const t = setTimeout(() => ac.abort(), timeoutMs)
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: ac.signal,
      body: JSON.stringify({
        temperature: 0,
        max_tokens: 60,
        response_format: { type: "json_object", schema: PLANNER_SCHEMA },
        messages: [{ role: "system", content: PLANNER_SYSTEM }, { role: "user", content: text }],
      }),
    })
    clearTimeout(t)
    if (!res.ok) return { ok: false, reason: "no-llm" }
    const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
    return validateProposal(JSON.parse(j.choices?.[0]?.message?.content ?? "null"), text)
  } catch {
    return { ok: false, reason: "no-llm" }
  }
}
