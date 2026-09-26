#!/usr/bin/env python3
import base64
import json
import os
import struct
import urllib.error
import urllib.request
import uuid

base = os.environ.get("SYNC_API_URL", "http://127.0.0.1:8087/api/v1")
token = os.environ.get("SYNC_API_TOKEN", "local-development-token-change-me-000000000000")
basic_user = os.environ.get("SYNC_BASIC_USER")
basic_password = os.environ.get("SYNC_BASIC_PASSWORD")
if basic_user and basic_password:
    encoded = base64.b64encode(f"{basic_user}:{basic_password}".encode()).decode()
    auth = {"Authorization": f"Basic {encoded}", "X-Sync-Token": token}
else:
    auth = {"Authorization": f"Bearer {token}"}

health = json.load(urllib.request.urlopen(f"{base}/health"))
create = urllib.request.Request(
    f"{base}/books",
    data=json.dumps({"clientBookId": f"smoke-{uuid.uuid4()}", "title": "Smoke Test"}).encode(),
    headers={**auth, "Content-Type": "application/json"},
    method="POST",
)
created_response = urllib.request.urlopen(create)
book = json.load(created_response)
initial_etag = created_response.headers["ETag"]
manifest = json.dumps({"format": "arc-book", "version": 1}).encode()
archive = b"ARCBK001" + struct.pack(">I", len(manifest)) + manifest + b"smoke-test"

headers = {
    **auth,
    "Content-Type": "application/vnd.arc-book",
    "If-Match": initial_etag,
    "X-Device-ID": "smoke-test",
}
upload = urllib.request.Request(f"{base}/books/{book['id']}/state", data=archive, headers=headers, method="PUT")
uploaded_response = urllib.request.urlopen(upload)
uploaded = json.load(uploaded_response)

stale = urllib.request.Request(f"{base}/books/{book['id']}/state", data=archive, headers=headers, method="PUT")
try:
    urllib.request.urlopen(stale)
    raise AssertionError("stale upload unexpectedly succeeded")
except urllib.error.HTTPError as error:
    assert error.code == 412, error.code

download = urllib.request.Request(f"{base}/books/{book['id']}/state", headers=auth)
downloaded = urllib.request.urlopen(download).read()
versions = json.load(urllib.request.urlopen(urllib.request.Request(f"{base}/books/{book['id']}/versions", headers=auth)))

assert health == {"status": "ok"}
assert uploaded["currentRevision"] == 1
assert downloaded == archive
assert len(versions["versions"]) == 1
print(json.dumps({"bookId": book["id"], "etag": uploaded_response.headers["ETag"], "status": "ok"}, indent=2))
