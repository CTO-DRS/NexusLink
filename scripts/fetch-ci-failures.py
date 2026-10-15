#!/usr/bin/env python3
"""جلب سجلات المهام الفاشلة من run محدد — ذيل كل سجل فاشل."""
import json
import os
import sys
import urllib.request

TOKEN = os.environ["GH_TOKEN"]
API = "https://api.github.com/repos/CTO-DRS/NexusLink"
run_id = int(sys.argv[1])
TAIL = int(sys.argv[2]) if len(sys.argv) > 2 else 40


def get(path, raw=False):
    req = urllib.request.Request(f"{API}{path}", headers={
        "Authorization": f"token {TOKEN}",
        "Accept": "application/vnd.github+json",
    })
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read() if raw else json.load(r)


jobs = get(f"/actions/runs/{run_id}/jobs?per_page=30")["jobs"]
for j in jobs:
    if j["conclusion"] not in ("failure", None):
        continue
    print(f"\n########## JOB: {j['name']} (id={j['id']}, concl={j['conclusion']}) ##########")
    # الخطوات الفاشلة أولًا
    for st in j.get("steps", []):
        if st["conclusion"] == "failure":
            print(f"  FAILED-STEP: {st['name']} (#{st['number']})")
    try:
        log = get(f"/actions/jobs/{j['id']}/logs", raw=True).decode("utf-8", "replace")
        lines = log.splitlines()
        print(f"  --- log tail ({len(lines)} lines total) ---")
        for ln in lines[-TAIL:]:
            print("  " + ln[:300])
    except Exception as e:
        print(f"  log-fetch-error: {e}")
