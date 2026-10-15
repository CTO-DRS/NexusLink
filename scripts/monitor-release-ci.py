#!/usr/bin/env python3
"""مراقبة CI لإطلاق v1.1.0 — حلقات استقصاء حتى اكتمال الخطين."""
import json
import os
import sys
import time
import urllib.request

TOKEN = os.environ["GH_TOKEN"]
API = "https://api.github.com/repos/CTO-DRS/NexusLink"
RUNS = {"release": 38818886866, "desktop": 38818886899}
POLL_SEC = int(sys.argv[1]) if len(sys.argv) > 1 else 120
MAX_MIN = int(sys.argv[2]) if len(sys.argv) > 2 else 8


def get(path):
    req = urllib.request.Request(f"{API}{path}", headers={
        "Authorization": f"token {TOKEN}",
        "Accept": "application/vnd.github+json",
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def snapshot():
    out = {}
    for key, rid in RUNS.items():
        run = get(f"/actions/runs/{rid}")
        jobs = get(f"/actions/runs/{rid}/jobs?per_page=30")["jobs"]
        out[key] = {
            "status": run["status"],
            "conclusion": run["conclusion"],
            "jobs": [(j["name"], j["status"], j["conclusion"]) for j in jobs],
        }
    return out


def fmt(snap):
    lines = []
    for key, s in snap.items():
        mark = {"in_progress": "▶", "queued": "…", "completed": s["conclusion"] or "?"}.get(s["status"], s["status"])
        lines.append(f"[{key}] {mark} ({s['status']}/{s['conclusion']})")
        for name, jst, jcc in s["jobs"]:
            jm = {"in_progress": "▶", "queued": "…", "completed": jcc or "?"}.get(jst, jst)
            lines.append(f"    {jm:<9} {name}")
    return "\n".join(lines)


LOG = "/tmp/ci-monitor.log"
deadline = time.time() + MAX_MIN * 60
while time.time() < deadline:
    try:
        snap = snapshot()
    except Exception as e:
        msg = f"poll-error: {e}"
        print(msg, flush=True); open(LOG, "a").write(msg + "\n")
        time.sleep(30)
        continue
    done = all(s["status"] == "completed" for s in snap.values())
    block = f"=== {time.strftime('%H:%M:%S')} {'DONE' if done else 'RUNNING'} ===\n{fmt(snap)}"
    print(block, flush=True); open(LOG, "a").write(block + "\n")
    if done:
        bad = [f"{k}:{s['conclusion']}" for k, s in snap.items() if s["conclusion"] != "success"]
        res = "RESULT: " + ("ALL_GREEN" if not bad else "FAILED " + ",".join(bad))
        print(res, flush=True); open(LOG, "a").write(res + "\n")
        sys.exit(0 if not bad else 1)
    if time.time() + POLL_SEC > deadline:
        print("STILL_RUNNING_NEXT_POLL", flush=True)
        sys.exit(2)
    time.sleep(POLL_SEC)
print("TIMEOUT_STILL_RUNNING", flush=True)
sys.exit(2)
