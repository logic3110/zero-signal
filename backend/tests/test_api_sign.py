import json

import pytest
from fastapi.testclient import TestClient

from zerosignal.api.app import create_app
from zerosignal.publish import build_catalog
from zerosignal.settings import Settings
from zerosignal.sign import keygen, sign_file, verify_file, load_private


@pytest.fixture(scope="module")
def client(dist):
    settings = Settings()
    settings.packs_dir = dist
    settings.web_dist = None
    with TestClient(create_app(settings)) as c:
        yield c


def test_health(client):
    body = client.get("/api/health").json()
    assert body["status"] == "ok" and len(body["packs"]) == 4
    assert body["llm"]["backend"] == "extractive"


def test_library_endpoints(client):
    domains = {d["domain"] for d in client.get("/api/library/domains").json()}
    assert domains == {"medical", "survival", "vehicle"}
    g = client.get("/api/library/guides/med-burns").json()
    assert g["title"].startswith("Burns") and g["sources"][0]["licence"]
    assert client.get("/api/library/guides/nope").status_code == 404


def test_search_endpoint(client):
    body = client.get("/api/search", params={"q": "jump start", "domain": "vehicle"}).json()
    assert body["hits"][0]["guide_id"] == "veh-jump-start"


def test_redflag_and_protocols(client):
    assert client.post("/api/redflag", json={"question": "car on fire"}).json()[0]["card_id"] == "pc-vehicle-fire"
    cards = client.get("/api/protocols", params={"domain": "survival"}).json()
    assert {c["card_id"] for c in cards} >= {"pc-lost", "pc-flood"}


def test_ask_streams_sse(client):
    with client.stream("POST", "/api/ask", json={"question": "how to change a flat tyre"}) as r:
        text = "".join(r.iter_text())
    events = [json.loads(line[6:]) for line in text.splitlines() if line.startswith("data: ")]
    types = [e["type"] for e in events]
    assert types[-1] == "done" and "answer" in types


def test_pack_download_supports_range(client, dist):
    r = client.get("/packs/core.sqlite", headers={"Range": "bytes=0-15"})
    assert r.status_code == 206 and r.content == b"SQLite format 3\x00"
    assert client.get("/packs/../secret").status_code == 404


def test_catalog(client, dist):
    cat = build_catalog(dist, "https://cdn.example.org/zs")
    assert {p["pack_id"] for p in cat["packs"]} == {"core", "medical-core", "survival-core", "vehicle-core"}
    assert cat["packs"][0]["url"].startswith("https://cdn.example.org/zs/")
    assert {m["id"] for m in cat["models"]} == {"compact", "recommended"}
    assert client.get("/api/catalog").json()["packs"]


def test_sign_and_verify(tmp_path):
    priv, pub = keygen(tmp_path / "keys")
    f = tmp_path / "pack.sqlite"
    f.write_bytes(b"pack-bytes")
    sign_file(load_private(priv), f)
    assert verify_file(pub, f)
    f.write_bytes(b"tampered")
    assert not verify_file(pub, f)
