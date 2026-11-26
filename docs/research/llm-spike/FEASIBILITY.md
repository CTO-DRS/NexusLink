# P2 spike: local-LLM natural-language command agent (research only)

Date: 2026-11-26. Status: spike on branch `spike/local-llm-planner`. Nothing here is wired into a route and nothing is merged to main.

## Question
Can NexusLink offer an optional, fully local assistant that turns "send the last 10 photos to the desktop and turn on do-not-disturb" into safe, confirmed actions, in Arabic and English, with no byte leaving the device (roadmap P2 items 1 and 4)?

## What already exists
`assistant-llm.ts` detects Ollama (:11434) or llama.cpp (:8080) on loopback and only paraphrases the deterministic assistant's answers. `docs/local-model-barrier.md` explains why no weights ship in the installers. This spike adds the missing piece: an action planner.

## Design in the PoC (`src/lib/nexus/assistant-planner.ts`)
1. A deterministic pre-filter blocks destructive intent (delete, wipe, format, امسح, احذف...) before the model sees it.
2. The model gets a closed JSON schema (grammar-constrained decoding via `response_format`), so the output always parses. It proposes ONE action from a whitelist of 5 plus `none`.
3. A pure validator clamps every argument (count 1..100, minutes 5..240), rebuilds the confirmation sentence from validated args (never model text), and marks every plan `needsConfirm: true`.
4. Loopback-only, same guard as the existing adapter. No runtime means graceful "no-llm".
5. It never executes anything. Execution stays with the existing guarded REST routes after a user tap.
Tests: `bun scripts/assistant-planner-spike.test.ts` (11 checks, mock model server): all pass.

## Measurements (real models, this sandbox: 1 CPU core, 2 GB RAM, no GPU)
12 commands (6 Arabic, 6 English; 10 in scope, 2 out of scope/destructive). llama-cpp-python 0.3.38, Q4_K_M GGUF, JSON-schema constrained, temperature 0. Script: `bench.py`, cases: `commands.json`.

| Model | File size | Accuracy | Median latency | Max |
|---|---|---|---|---|
| Qwen2.5-0.5B-Instruct | 0.49 GB | 6/12 | 0.6 s | 1.6 s |
| Qwen2.5-1.5B-Instruct | 1.12 GB | 8/12 | 1.0 s | 3.3 s (first call) |

Live end-to-end through the TS module against a 1.5B server on loopback: 1.0 to 3.6 s per command including HTTP.

Failure modes seen:
- 0.5B maps "delete all phone files" to `send_files` and "weather" to `search`. Unsafe without the pre-filter and confirmation.
- 1.5B gets argument details wrong (dnd minutes 0, count missing or -1) and sends out-of-scope questions to `search`. All of these are caught or made harmless by clamping and by the confirmation card, but they cost accuracy.
- Both are fine at picking the action for clean in-scope commands in both languages (Arabic parity looks good for Qwen2.5).

## Findings
- Feasible on a CPU-only laptop: about 1 s per command at 1.5B on a single core, so well under the roadmap target of 1.5 s on a mid-range device.
- The roadmap bar (90% on a 200-command Arabic and English set) is NOT met by 0.5B or 1.5B. Expect a 3B to 4B model (about 2 to 2.5 GB Q4) to be needed; it did not fit this 2 GB sandbox, so it is untested. Needs a proper 200-command set and a real laptop.
- Safety must not depend on the model. Pre-filter + whitelist + clamping + mandatory confirmation make the worst case "a wrong but harmless confirmation card".
- Port note: this sandbox already had a different service on :8080, so the contract port for llama.cpp can collide on real machines. Let the user set the endpoint in settings instead of assuming 8080.

## Proposed next steps (not started, need owner call)
1. Build a 200-command bilingual eval set with expected actions, and run 1.5B, 3B, 4B on a real laptop (and an NPU/GPU path later).
2. Optional download of the model by explicit consent (never bundled), checksum-pinned, stored in the app data folder; or keep "bring your own Ollama".
3. Wire a `/api/assistant/plan` loopback-guarded route plus a confirmation card in the Assistant tab, translations in 6 languages, E2E gates, screenshots.
4. Semantic search (P2 item 2): sqlite-vec plus a small multilingual embedding model; separate spike.
