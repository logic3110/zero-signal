"""Read-only access to an installed pack."""

from __future__ import annotations

import json
import re
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ..embeddings import dequantize_int8
from ..text import normalize
from .schema import SCHEMA_VERSION


class PackMismatchError(RuntimeError):
    """Pack built with a different embedding model/dim or schema (US-15.5)."""


@dataclass
class FtsHit:
    chunk_id: str
    bm25: float  # lower (more negative) is better, as returned by SQLite


class PackReader:
    def __init__(self, path: Path, embedding_model_id: str | None = None, embedding_dim: int | None = None):
        self.path = Path(path)
        self.con = sqlite3.connect(f"file:{self.path}?mode=ro", uri=True, check_same_thread=False)
        self.con.row_factory = sqlite3.Row
        row = self.con.execute("SELECT * FROM manifest").fetchone()
        self.manifest: dict[str, Any] = dict(row)
        self.manifest["counts"] = json.loads(self.manifest.pop("counts_json") or "{}")
        if self.manifest.get("schema_version") != SCHEMA_VERSION:
            raise PackMismatchError(f"{self.pack_id}: schema {self.manifest.get('schema_version')} != {SCHEMA_VERSION}")
        if embedding_model_id and (
            self.manifest["embedding_model_id"] != embedding_model_id or self.manifest["embedding_dim"] != embedding_dim
        ):
            raise PackMismatchError(
                f"{self.pack_id}: built with {self.manifest['embedding_model_id']}/{self.manifest['embedding_dim']}, "
                f"runtime uses {embedding_model_id}/{embedding_dim}"
            )
        self._vectors: dict[str, list[float]] | None = None
        self.vocab: set[str] = {r[0] for r in self.con.execute("SELECT term FROM vocab")}
        self.synonyms: dict[str, set[str]] = {}
        for term, canonical in self.con.execute("SELECT term, canonical FROM synonyms"):
            self.synonyms.setdefault(term, set()).add(canonical)

    @property
    def pack_id(self) -> str:
        return self.manifest["pack_id"]

    # ------------------------------------------------------------------ vectors
    @property
    def vectors(self) -> dict[str, list[float]]:
        if self._vectors is None:
            self._vectors = {
                cid: dequantize_int8(blob) for cid, blob in self.con.execute("SELECT chunk_id, embedding FROM chunks_vec")
            }
        return self._vectors

    # ---------------------------------------------------------------------- fts
    def fts(self, match_expr: str, limit: int = 30) -> list[FtsHit]:
        if not match_expr:
            return []
        # Column weights: title, section, text, keywords.
        sql = (
            "SELECT chunk_id, bm25(chunks_fts, 0.0, 6.0, 2.0, 1.0, 3.0) AS s "
            "FROM chunks_fts WHERE chunks_fts MATCH ? ORDER BY s LIMIT ?"
        )
        try:
            rows = self.con.execute(sql, (match_expr, limit)).fetchall()
        except sqlite3.OperationalError:
            return []
        return [FtsHit(r["chunk_id"], r["s"]) for r in rows]

    # --------------------------------------------------------------- accessors
    def chunk(self, chunk_id: str) -> dict[str, Any] | None:
        row = self.con.execute("SELECT * FROM chunks WHERE chunk_id = ?", (chunk_id,)).fetchone()
        return dict(row) if row else None

    def chunks(self, ids: list[str]) -> dict[str, dict[str, Any]]:
        if not ids:
            return {}
        q = ",".join("?" * len(ids))
        return {r["chunk_id"]: dict(r) for r in self.con.execute(f"SELECT * FROM chunks WHERE chunk_id IN ({q})", ids)}

    def all_chunk_meta(self) -> dict[str, dict[str, Any]]:
        return {
            r["chunk_id"]: dict(r)
            for r in self.con.execute("SELECT chunk_id, guide_id, domain, patient_type, severity, region FROM chunks")
        }

    def guides(self, domain: str | None = None, category: str | None = None) -> list[dict[str, Any]]:
        sql = "SELECT guide_id, domain, category, title, summary, severity, patient_types, last_reviewed, reviewer_role FROM guides"
        where, args = [], []
        if domain:
            where.append("domain = ?")
            args.append(domain)
        if category:
            where.append("category = ?")
            args.append(category)
        if where:
            sql += " WHERE " + " AND ".join(where)
        return [dict(r) for r in self.con.execute(sql + " ORDER BY category, title", args)]

    def guide(self, guide_id: str) -> dict[str, Any] | None:
        row = self.con.execute("SELECT * FROM guides WHERE guide_id = ?", (guide_id,)).fetchone()
        if not row:
            return None
        g = dict(row)
        for key in ("steps_json", "warnings", "red_flags", "seek_help_json", "tags_json", "sources_json"):
            g[key.removesuffix("_json")] = json.loads(g.pop(key) or "[]")
        g["patient_types"] = (g["patient_types"] or "").split()
        g["sources"] = self.sources(g["sources"])
        g["chunks"] = [
            dict(r)
            for r in self.con.execute(
                "SELECT chunk_id, section_path, order_idx FROM chunks WHERE guide_id = ? ORDER BY order_idx", (guide_id,)
            )
        ]
        return g

    def sources(self, ids: list[str] | None = None) -> list[dict[str, Any]]:
        rows = [dict(r) for r in self.con.execute("SELECT * FROM sources ORDER BY source_id")]
        if ids is None:
            return rows
        by_id = {r["source_id"]: r for r in rows}
        return [by_id[i] for i in ids if i in by_id]

    def cards(self) -> list[dict[str, Any]]:
        return [json.loads(r[0]) for r in self.con.execute("SELECT card_json FROM protocol_cards ORDER BY order_idx")]

    def trees(self) -> list[dict[str, Any]]:
        return [json.loads(r[0]) for r in self.con.execute("SELECT tree_json FROM decision_trees ORDER BY tree_id")]

    def tables(self, kind: str | None = None) -> list[dict[str, Any]]:
        sql = "SELECT table_id, kind, title, data_json, source_id FROM static_tables"
        rows = self.con.execute(sql + (" WHERE kind = ?" if kind else ""), (kind,) if kind else ())
        return [
            {"table_id": r[0], "kind": r[1], "title": r[2], "data": json.loads(r[3]), "source_id": r[4]} for r in rows
        ]

    def close(self) -> None:
        self.con.close()


def load_packs(directory: Path, embedding_model_id: str | None = None, embedding_dim: int | None = None) -> list[PackReader]:
    """Load every ``*.sqlite`` pack in a directory; mismatched packs are refused."""
    readers = []
    for p in sorted(Path(directory).glob("*.sqlite")):
        readers.append(PackReader(p, embedding_model_id, embedding_dim))
    return readers


def fts_escape_term(term: str) -> str:
    return '"' + re.sub(r'"', '""', normalize(term)) + '"'
