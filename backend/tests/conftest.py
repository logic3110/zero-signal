from __future__ import annotations

import os
from pathlib import Path

import pytest

# Tests run offline and deterministic, whatever backend/.env selects. Set before
# zerosignal.settings loads .env, which only fills variables not already set.
os.environ["ZS_LLM_BACKEND"] = "extractive"

from zerosignal.build import build
from zerosignal.embeddings import get_embedder
from zerosignal.pack.reader import load_packs
from zerosignal.rag.llm import ExtractiveBackend
from zerosignal.rag.pipeline import AskPipeline
from zerosignal.rag.redflag import RedFlagDetector
from zerosignal.rag.search import HybridSearcher

ROOT = Path(__file__).resolve().parent.parent
PACK_CONFIGS = [ROOT / "content" / "packs" / f"{n}.yaml" for n in ("core", "medical-core", "survival-core", "vehicle-core")]


@pytest.fixture(scope="session")
def dist(tmp_path_factory) -> Path:
    out = tmp_path_factory.mktemp("dist")
    for cfg in PACK_CONFIGS:
        build(cfg, out)
    return out


@pytest.fixture(scope="session")
def packs(dist):
    readers = load_packs(dist, "zs-hash-v1", 384)
    yield readers
    for r in readers:
        r.close()


@pytest.fixture(scope="session")
def searcher(packs) -> HybridSearcher:
    return HybridSearcher(packs, get_embedder("zs-hash-v1", 384))


@pytest.fixture(scope="session")
def detector(packs) -> RedFlagDetector:
    return RedFlagDetector([c for p in packs for c in p.cards()])


@pytest.fixture
def pipeline(searcher, detector) -> AskPipeline:
    return AskPipeline(searcher, detector, ExtractiveBackend())
