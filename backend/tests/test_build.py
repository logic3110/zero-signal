import json
import sqlite3

import pytest

from zerosignal.build import BuildError, build
from zerosignal.ingest.guides import GuideParseError, parse_guide
from zerosignal.pack.reader import PackMismatchError, PackReader

from .conftest import PACK_CONFIGS

GUIDE = """---
id: t-guide
domain: medical
category: Test
title: Test guide
summary: A summary.
sources: [zs-original]
---
## Steps
1. First step
   continues here.
2. Second step
## Warnings
- Do not panic
## When to get help
- Always
"""


def test_parse_guide_sections():
    g = parse_guide(GUIDE)
    assert g.steps == ["First step continues here.", "Second step"]
    assert g.warnings == ["Do not panic"]
    assert g.seek_help == ["Always"]
    assert g.review is None and g.last_reviewed is None


def test_guide_without_steps_is_rejected():
    with pytest.raises(GuideParseError):
        parse_guide(GUIDE.replace("## Steps\n1. First step\n   continues here.\n2. Second step\n", ""))


def test_build_is_deterministic(tmp_path):
    a = build(PACK_CONFIGS[1], tmp_path / "a")
    b = build(PACK_CONFIGS[1], tmp_path / "b")
    assert a["files"]["sqlite"]["sha256"] == b["files"]["sqlite"]["sha256"]
    assert a["files"]["web"]["sha256"] == b["files"]["web"]["sha256"]
    assert a["content_hash"] == b["content_hash"]


def test_pack_contents(dist):
    con = sqlite3.connect(dist / "medical-core.sqlite")
    assert con.execute("SELECT count(*) FROM guides").fetchone()[0] >= 30
    assert con.execute("SELECT count(*) FROM protocol_cards").fetchone()[0] >= 20
    # Every chunk has a licence and every guide source is in the sources table.
    assert con.execute("SELECT count(*) FROM chunks WHERE licence IS NULL OR licence = ''").fetchone()[0] == 0
    ids = {r[0] for r in con.execute("SELECT source_id FROM sources")}
    for (sj,) in con.execute("SELECT sources_json FROM guides"):
        assert set(json.loads(sj)) <= ids
    # FTS works and synonyms are indexed as keywords ("fits" -> seizure guide).
    hit = con.execute("SELECT chunk_id FROM chunks_fts WHERE chunks_fts MATCH 'fits' LIMIT 1").fetchone()
    assert hit is not None


def test_release_build_requires_signoff(tmp_path):
    with pytest.raises(BuildError) as exc:
        build(PACK_CONFIGS[1], tmp_path, release=True)
    msg = str(exc.value)
    assert "protocol cards cannot ship without reviewer sign-off" in msg
    assert "reviewer_signoff is required" in msg


def test_dry_run_exports_review_files(tmp_path):
    res = build(PACK_CONFIGS[3], tmp_path, dry_run=True)
    assert res["dry_run"] and res["chunks"] > 0
    assert (tmp_path / "vehicle-core.chunks.json").exists()
    assert (tmp_path / "vehicle-core.review.html").exists()
    assert not (tmp_path / "vehicle-core.sqlite").exists()


def test_reader_refuses_mismatched_embedding(dist):
    with pytest.raises(PackMismatchError):
        PackReader(dist / "medical-core.sqlite", "st:intfloat/multilingual-e5-small", 384)


def test_web_bundle_shape(dist):
    bundle = json.loads((dist / "vehicle-core.json").read_text())
    assert bundle["manifest"]["pack_id"] == "vehicle-core"
    assert {t["tree_id"] for t in bundle["decision_trees"]} >= {"veh-wont-start", "veh-smoke", "veh-vibration"}
    assert all("steps" in g and "sources" in g for g in bundle["guides"])
