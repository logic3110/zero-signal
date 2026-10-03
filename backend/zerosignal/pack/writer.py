"""Write a pack SQLite file plus the JSON bundle used by the web client."""

from __future__ import annotations

import hashlib
import json
import sqlite3
from collections import Counter
from pathlib import Path

from ..embeddings import quantize_int8
from ..schemas import Chunk, DecisionTree, Guide, Manifest, PackConfig, ProtocolCard, Source, StaticTable
from ..text import words
from .schema import DDL, SCHEMA_VERSION


def _j(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def chunk_keywords(chunk: Chunk, guide: Guide | None, synonyms: list[tuple[str, str, str]]) -> str:
    """Index-time synonym expansion: lay terms whose canonical term appears in
    the chunk (or its guide's title/tags) become searchable keywords."""
    haystack = " " + " ".join(words(chunk.text)) + " "
    if guide:
        haystack += " " + " ".join(words(guide.title + " " + " ".join(guide.tags))) + " "
    extra = set(guide.tags if guide else [])
    for term, canonical, _lang in synonyms:
        if f" {' '.join(words(canonical))} " in haystack:
            extra.add(term)
    return " ".join(sorted(extra))


def write_pack(
    out_path: Path,
    config: PackConfig,
    sources: list[Source],
    guides: list[Guide],
    chunks: list[Chunk],
    vectors: list[list[float]],
    cards: list[ProtocolCard],
    trees: list[DecisionTree],
    tables: list[StaticTable],
    synonyms: list[tuple[str, str, str]],
) -> Manifest:
    if out_path.exists():
        out_path.unlink()
    out_path.parent.mkdir(parents=True, exist_ok=True)

    guide_by_id = {g.guide_id: g for g in guides}
    counts = {
        "guides": len(guides),
        "chunks": len(chunks),
        "protocol_cards": len(cards),
        "decision_trees": len(trees),
        "static_tables": len(tables),
        "sources": len(sources),
        "synonyms": len(synonyms),
    }
    content_hash = hashlib.sha256(
        _j(
            {
                "sources": [s.model_dump() for s in sources],
                "guides": [g.model_dump() for g in guides],
                "chunks": [c.model_dump() for c in chunks],
                "cards": [c.model_dump() for c in cards],
                "trees": [t.model_dump() for t in trees],
                "tables": [t.model_dump() for t in tables],
                "synonyms": synonyms,
                "embedding": config.embedding.model_dump(),
            }
        ).encode()
    ).hexdigest()

    manifest = Manifest(
        pack_id=config.pack_id,
        version=config.version,
        title=config.title,
        description=config.description,
        domain=config.domain,
        language=config.language,
        region=config.region,
        created_at=config.created_at,
        embedding_model_id=config.embedding.model_id,
        embedding_dim=config.embedding.dim,
        min_app_version=config.min_app_version,
        reviewer_signoff=config.reviewer_signoff,
        counts=counts,
        content_hash=content_hash,
        schema_version=SCHEMA_VERSION,
    )

    con = sqlite3.connect(out_path)
    try:
        con.executescript(DDL)
        con.execute(
            "INSERT INTO manifest VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,?,?,?,?)",
            (
                manifest.pack_id, manifest.version, manifest.title, manifest.description,
                manifest.domain, manifest.language, manifest.region, manifest.created_at,
                manifest.embedding_model_id, manifest.embedding_dim, manifest.min_app_version,
                manifest.reviewer_signoff, content_hash, _j(counts), SCHEMA_VERSION,
            ),
        )
        con.executemany(
            "INSERT INTO sources VALUES (?,?,?,?,?,?,?,?,?)",
            [
                (s.source_id, s.publisher, s.title, s.url, s.licence, s.retrieved_at, s.version, s.permission, s.notes)
                for s in sorted(sources, key=lambda s: s.source_id)
            ],
        )
        con.executemany(
            "INSERT INTO guides VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            [
                (
                    g.guide_id, g.domain, g.category, g.title, g.summary, g.body_md,
                    _j(g.steps), _j(g.warnings), _j(g.red_flags), _j(g.seek_help),
                    " ".join(g.patient_types), g.severity, g.region, g.language,
                    _j(g.tags), _j(g.sources), g.protocol_card, g.last_reviewed, g.reviewer_role,
                )
                for g in guides
            ],
        )
        con.executemany(
            "INSERT INTO chunks VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            [
                (
                    c.chunk_id, c.guide_id, c.source_id, c.section_path, c.text, c.token_count,
                    c.domain, c.category, c.topic, c.patient_type, c.severity, c.region,
                    c.language, c.licence, int(c.reviewed), c.order_idx,
                )
                for c in chunks
            ],
        )
        fts_rows = []
        vocab: Counter[str] = Counter()
        for c in chunks:
            g = guide_by_id.get(c.guide_id or "")
            title = g.title if g else c.topic
            section = c.section_path.split(" > ")[-1]
            keywords = chunk_keywords(c, g, synonyms)
            fts_rows.append((c.chunk_id, title, section, c.text, keywords))
            vocab.update(set(words(" ".join([title, c.text, keywords]))))
        con.executemany("INSERT INTO chunks_fts VALUES (?,?,?,?,?)", fts_rows)
        con.executemany(
            "INSERT INTO vocab VALUES (?,?)",
            sorted((t, n) for t, n in vocab.items() if len(t) > 2 and not t.isdigit()),
        )
        con.executemany(
            "INSERT INTO chunks_vec VALUES (?,?)",
            [(c.chunk_id, quantize_int8(v)) for c, v in zip(chunks, vectors)],
        )
        con.executemany(
            "INSERT INTO protocol_cards VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            [
                (
                    c.card_id, c.domain, c.title, _j(c.trigger_terms),
                    _j([s.model_dump() for s in c.steps]), _j([t.model_dump() for t in c.timers]),
                    c.emergency_number_key, c.reviewed_by,
                    c.reviewed_at.isoformat() if c.reviewed_at else None,
                    _j(c.model_dump(mode="json")), i,
                )
                for i, c in enumerate(cards)
            ],
        )
        con.executemany(
            "INSERT INTO decision_trees VALUES (?,?,?,?,?)",
            [
                (t.tree_id, t.domain, t.title, _j([n.model_dump() for n in t.nodes]), _j(t.model_dump(mode="json")))
                for t in sorted(trees, key=lambda t: t.tree_id)
            ],
        )
        con.executemany(
            "INSERT INTO static_tables VALUES (?,?,?,?,?)",
            [(t.table_id, t.kind, t.title, _j(t.data), t.source_id) for t in sorted(tables, key=lambda t: t.table_id)],
        )
        con.executemany("INSERT INTO synonyms VALUES (?,?,?)", synonyms)
        con.commit()
        con.execute("VACUUM")
    finally:
        con.close()
    return manifest


def write_web_bundle(
    out_path: Path,
    manifest: Manifest,
    sources: list[Source],
    guides: list[Guide],
    chunks: list[Chunk],
    cards: list[ProtocolCard],
    trees: list[DecisionTree],
    tables: list[StaticTable],
    synonyms: list[tuple[str, str, str]],
) -> None:
    """JSON rendition of the pack for the web client (no vectors: the browser
    does keyword + synonym search locally and calls the API for Ask)."""
    bundle = {
        "manifest": manifest.model_dump(),
        "sources": [s.model_dump() for s in sorted(sources, key=lambda s: s.source_id)],
        "guides": [
            {**g.model_dump(mode="json", exclude={"review"}), "last_reviewed": g.last_reviewed, "reviewer_role": g.reviewer_role}
            for g in guides
        ],
        "chunks": [
            c.model_dump(include={"chunk_id", "guide_id", "section_path", "text", "domain", "category", "patient_type", "severity"})
            for c in chunks
        ],
        "protocol_cards": [c.model_dump(mode="json") for c in cards],
        "decision_trees": [t.model_dump(mode="json") for t in sorted(trees, key=lambda t: t.tree_id)],
        "static_tables": [t.model_dump(mode="json") for t in sorted(tables, key=lambda t: t.table_id)],
        "synonyms": [{"term": t, "canonical": c, "language": lang} for t, c, lang in synonyms],
    }
    out_path.write_text(_j(bundle), encoding="utf-8")

