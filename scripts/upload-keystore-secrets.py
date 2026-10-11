#!/usr/bin/env python3
"""رفع keystore + كلمات السر إلى GitHub Actions Secrets (تشفير SealedBox).
Usage: python3.13 upload-keystore-secrets.py <token> <owner/repo> <jks_path> <pass_path>
"""
import base64
import sys
from pathlib import Path

import urllib.request
import json

from nacl import encoding, public

TOKEN, REPO, JKS, PASSFILE = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]


def api(method: str, url: str, payload: dict | None = None) -> tuple[int, dict]:
    req = urllib.request.Request(
        f"https://api.github.com{url}",
        method=method,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={
            "Authorization": f"token {TOKEN}",
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req) as r:
        body = r.read().decode()
        return r.status, (json.loads(body) if body else {})


status, pk = api("GET", f"/repos/{REPO}/actions/secrets/public-key")
assert status == 200, f"public-key failed: {status}"
pk_obj = public.PublicKey(pk["key"].encode(), encoding.Base64Encoder())
sealed = public.SealedBox(pk_obj)

jks_b64 = base64.b64encode(Path(JKS).read_bytes()).decode()
password = Path(PASSFILE).read_text().strip()

secrets = {
    "ANDROID_KEYSTORE_BASE64": jks_b64,
    "ANDROID_KEYSTORE_PASSWORD": password,
    "ANDROID_KEY_ALIAS": "nexuslink",
    "ANDROID_KEY_PASSWORD": password,
}

for name, raw in secrets.items():
    enc = sealed.encrypt(raw.encode())
    status, _ = api(
        "PUT",
        f"/repos/{REPO}/actions/secrets/{name}",
        {"encrypted_value": base64.b64encode(enc).decode(), "key_id": pk["key_id"]},
    )
    print(f"{name}: HTTP {status}")
    assert status in (201, 204), f"secret {name} failed"

print("ALL_SECRETS_UPLOADED")
