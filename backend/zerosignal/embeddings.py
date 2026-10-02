"""Embedding models. Build time and run time MUST use the same model id and
dimension (US-15.5); readers refuse packs whose manifest does not match.

``zs-hash-v1`` is a dependency-free feature-hashing embedder (word unigrams,
bigrams and character trigrams, signed hashing, L2-normalised). It is lexical
rather than truly semantic, but deterministic, tiny and identical on every
platform - a sensible default until a real model is wired in on-device.

``st:<name>`` uses sentence-transformers (e.g. ``st:intfloat/multilingual-e5-small``
or ``st:google/embeddinggemma-300m``) when the ``embeddings`` extra is installed.
"""

from __future__ import annotations

import hashlib
import math
import struct
from typing import Protocol

from .text import content_words, stem


class Embedder(Protocol):
    model_id: str
    dim: int

    def embed(self, texts: list[str]) -> list[list[float]]: ...


class HashingEmbedder:
    def __init__(self, dim: int = 384):
        self.dim = dim
        self.model_id = "zs-hash-v1"

    def _features(self, text: str) -> dict[str, float]:
        toks = [stem(w) for w in content_words(text)]
        feats: dict[str, float] = {}
        for t in toks:
            feats[f"w:{t}"] = feats.get(f"w:{t}", 0.0) + 1.0
            padded = f"#{t}#"
            for i in range(len(padded) - 2):
                g = f"c:{padded[i:i + 3]}"
                feats[g] = feats.get(g, 0.0) + 0.25
        for a, b in zip(toks, toks[1:]):
            k = f"b:{a}_{b}"
            feats[k] = feats.get(k, 0.0) + 0.75
        return feats

    def _vec(self, text: str) -> list[float]:
        v = [0.0] * self.dim
        for feat, weight in self._features(text).items():
            h = hashlib.blake2b(feat.encode("utf-8"), digest_size=8).digest()
            idx = int.from_bytes(h[:4], "little") % self.dim
            sign = 1.0 if h[4] & 1 else -1.0
            # Sub-linear term frequency.
            v[idx] += sign * (1.0 + math.log(weight)) if weight >= 1 else sign * weight
        norm = math.sqrt(sum(x * x for x in v)) or 1.0
        return [x / norm for x in v]

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [self._vec(t) for t in texts]


class SentenceTransformerEmbedder:  # pragma: no cover - optional heavy dependency
    def __init__(self, name: str, dim: int):
        from sentence_transformers import SentenceTransformer

        self._model = SentenceTransformer(name)
        self.model_id = f"st:{name}"
        self.dim = dim
        actual = self._model.get_sentence_embedding_dimension()
        if actual != dim:
            raise ValueError(f"{name} produces dim {actual}, config says {dim}")

    def embed(self, texts: list[str]) -> list[list[float]]:
        return self._model.encode(texts, normalize_embeddings=True).tolist()


def get_embedder(model_id: str, dim: int) -> Embedder:
    if model_id == "zs-hash-v1":
        return HashingEmbedder(dim)
    if model_id.startswith("st:"):
        return SentenceTransformerEmbedder(model_id[3:], dim)
    raise ValueError(f"unknown embedding model id: {model_id}")


# -------------------------------------------------------------- int8 quantisation
def quantize_int8(vec: list[float]) -> bytes:
    """Symmetric per-vector int8 quantisation; 4-byte float scale header."""
    scale = max((abs(x) for x in vec), default=0.0) or 1.0
    q = [max(-127, min(127, round(x / scale * 127))) for x in vec]
    return struct.pack("<f", scale) + struct.pack(f"<{len(q)}b", *q)


def dequantize_int8(blob: bytes) -> list[float]:
    (scale,) = struct.unpack_from("<f", blob)
    n = len(blob) - 4
    q = struct.unpack_from(f"<{n}b", blob, 4)
    return [x * scale / 127 for x in q]


def cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a)) or 1.0
    nb = math.sqrt(sum(y * y for y in b)) or 1.0
    return dot / (na * nb)
