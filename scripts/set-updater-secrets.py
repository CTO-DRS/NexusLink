#!/usr/bin/env python3
"""Set GitHub Actions secrets for the signed updater (TA-harden item 2).

Encrypts secret values with the repo's public key (libsodium sealed box)
and PUTs them to /repos/CTO-DRS/NexusLink/actions/secrets/{name}.
"""
import base64
import json
import sys
import urllib.request
from pathlib import Path

from nacl.public import PublicKey, SealedBox

TOKEN = "GITHUB_TOKEN_ENV"
REPO = "CTO-DRS/NexusLink"
API = f"https://api.github.com/repos/{REPO}"


def api(method: str, path: str, body: dict | None = None) -> tuple[int, dict]:
    req = urllib.request.Request(
        f"{API}{path}",
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={
            "Authorization": f"token {TOKEN}",
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req) as r:
        text = r.read().decode()
        return r.status, (json.loads(text) if text else {})


def main() -> None:
    priv = Path("/home/z/.tauri/nexuslink.key").read_text()
    # كلمة مرور صريحة (توليد بكلمة فارغة لا يُطبّقها tauri signer) — السرّان معًا في CI
    secrets = {
        "TAURI_SIGNING_PRIVATE_KEY": priv,
        "TAURI_SIGNING_PRIVATE_KEY_PASSWORD": "nexuslink-harden-2026",
    }
    status, pk = api("GET", "/actions/secrets/public-key")
    if status != 200:
        print("FAILED to fetch repo public key", status, pk)
        sys.exit(1)
    print(f"repo pubkey: {pk['key_id']}")

    for name, value in secrets.items():
        sealed = SealedBox(PublicKey(base64.b64decode(pk["key"]))).encrypt(value.encode())
        status, resp = api(
            "PUT",
            f"/actions/secrets/{name}",
            {
                "encrypted_value": base64.b64encode(sealed).decode(),
                "key_id": pk["key_id"],
            },
        )
        print(f"{name}: HTTP {status} {resp if status != 201 else 'OK'}")
        if status not in (201, 204):
            sys.exit(1)
    print("ALL_SECRETS_SET")


if __name__ == "__main__":
    main()
