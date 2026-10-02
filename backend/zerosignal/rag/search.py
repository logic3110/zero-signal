"""Hybrid search (US-3.1..3.4): FTS5 BM25 + vector, merged with Reciprocal
Rank Fusion, with synonym expansion, typo correction and metadata filters."""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Any

from ..embeddings import Embedder, cosine
from ..pack.reader import PackReader, fts_escape_term
from ..text import PERSON_WORDS, STOPWORDS, content_words, edit_distance, normalize, stem, words

RRF_K = 60


@dataclass
class Hit:
    chunk_id: str
    pack_id: str
    guide_id: str | None
    title: str
    section_path: str
    text: str
    domain: str
    category: str
    source_id: str
    severity: str
    rrf: float
    bm25_rank: int | None = None
    vec_rank: int | None = None
    cosine: float = 0.0
    coverage: float = 0.0

    @property
    def confidence(self) -> float:
        return round(0.65 * self.coverage + 0.35 * max(0.0, self.cosine), 4)

    def to_dict(self) -> dict[str, Any]:
        return {
            "chunk_id": self.chunk_id,
            "pack_id": self.pack_id,
            "guide_id": self.guide_id,
            "title": self.title,
            "section_path": self.section_path,
            "text": self.text,
            "domain": self.domain,
            "category": self.category,
            "source_id": self.source_id,
            "severity": self.severity,
            "score": round(self.rrf, 5),
            "confidence": self.confidence,
            "bm25_rank": self.bm25_rank,
            "vec_rank": self.vec_rank,
        }


@dataclass
class QueryPlan:
    original: str
    terms: list[str]
    corrected: dict[str, str] = field(default_factory=dict)
    expansions: dict[str, list[str]] = field(default_factory=dict)
    match_expr: str = ""

    def all_terms(self) -> list[str]:
        out = list(self.terms)
        for exp in self.expansions.values():
            for phrase in exp:
                out.extend(words(phrase))
        return out


@dataclass
class SearchResult:
    query: QueryPlan
    hits: list[Hit]
    took_ms: float

    @property
    def top_confidence(self) -> float:
        return max((h.confidence for h in self.hits[:3]), default=0.0)


class HybridSearcher:
    def __init__(self, packs: list[PackReader], embedder: Embedder):
        self.packs = packs
        self.embedder = embedder
        self.vocab: set[str] = set().union(*(p.vocab for p in packs)) if packs else set()
        self.synonyms: dict[str, set[str]] = {}
        for p in packs:
            for term, canon in p.synonyms.items():
                self.synonyms.setdefault(term, set()).update(canon)
        self.meta: dict[str, tuple[PackReader, dict[str, Any]]] = {}
        for p in packs:
            for cid, m in p.all_chunk_meta().items():
                self.meta[cid] = (p, m)
        self._guide_titles: dict[str, str] = {}
        self._guide_tags: dict[str, str] = {}
        for p in packs:
            for g in p.guides():
                self._guide_titles[g["guide_id"]] = g["title"]
            for gid, tags in p.con.execute("SELECT guide_id, tags_json FROM guides"):
                self._guide_tags[gid] = " ".join(json.loads(tags or "[]"))

    # ------------------------------------------------------------ query plan
    def _correct(self, word: str) -> str | None:
        # Short words have too many one-edit neighbours ("bake" -> "bare").
        if word in self.vocab or len(word) < 5 or word.isdigit():
            return None
        limit = 1 if len(word) <= 7 else 2
        best, best_d = None, limit + 1
        for v in self.vocab:
            if abs(len(v) - len(word)) > limit or v[0] != word[0]:
                continue
            d = edit_distance(word, v, limit)
            if d < best_d or (d == best_d and best and v < best):
                best, best_d = v, d
        return best if best_d <= limit else None

    def plan(self, query: str) -> QueryPlan:
        q = normalize(query)
        plan = QueryPlan(original=query, terms=content_words(q))
        # Multi-word synonyms ("check engine light") first, then single words.
        for term, canon in self.synonyms.items():
            if " " in term and f" {term} " in f" {' '.join(words(q))} ":
                plan.expansions[term] = sorted(canon)
        for t in list(plan.terms):
            if t in self.synonyms:
                plan.expansions.setdefault(t, sorted(self.synonyms[t]))
            fixed = self._correct(t)
            if fixed:
                plan.corrected[t] = fixed
                if fixed in self.synonyms:
                    plan.expansions.setdefault(fixed, sorted(self.synonyms[fixed]))

        parts: list[str] = []
        for t in plan.terms:
            parts.append(fts_escape_term(t))
            if t in plan.corrected:
                parts.append(fts_escape_term(plan.corrected[t]))
        if plan.terms:
            last = plan.terms[-1]
            if len(last) >= 3:
                parts.append(fts_escape_term(last) + "*")  # search-as-you-type prefix
        for exp in plan.expansions.values():
            for phrase in exp:
                parts.append(fts_escape_term(phrase))
        plan.match_expr = " OR ".join(dict.fromkeys(parts))
        return plan

    # ---------------------------------------------------------------- search
    def _passes(self, meta: dict[str, Any], domain: str | None, patient_type: str | None) -> bool:
        if domain and meta["domain"] != domain:
            return False
        if patient_type and patient_type not in (meta["patient_type"] or "").split():
            return False
        return True

    def _coverage(self, plan: QueryPlan, text: str) -> float:
        """Fraction of the query's topical terms found in the chunk, directly,
        via spelling correction, or via a synonym phrase present in the chunk."""
        originals = {stem(t): t for t in plan.terms if t not in STOPWORDS and t not in PERSON_WORDS}
        if not originals:
            return 0.0
        hay = {stem(w) for w in words(text)}

        def present(phrase: str) -> bool:
            return all(stem(w) in hay for w in words(phrase))

        covered: set[str] = set()
        # Multi-word lay phrases ("snake bit") cover all of their words.
        for key, phrases in plan.expansions.items():
            if " " in key and any(present(p) for p in phrases):
                covered.update(stem(w) for w in words(key))
        for t, orig in originals.items():
            if t in covered:
                continue
            alts = {t}
            if orig in plan.corrected:
                alts.add(stem(plan.corrected[orig]))
            if alts & hay:
                covered.add(t)
                continue
            for phrase in plan.expansions.get(orig, []) + plan.expansions.get(plan.corrected.get(orig, ""), []):
                if present(phrase):
                    covered.add(t)
                    break
        return len(covered & originals.keys()) / len(originals)

    def search(
        self,
        query: str,
        k: int = 8,
        domain: str | None = None,
        patient_type: str | None = None,
        candidates: int = 40,
    ) -> SearchResult:
        t0 = time.perf_counter()
        plan = self.plan(query)

        bm25: list[str] = []
        scored: list[tuple[float, str]] = []
        for p in self.packs:
            for h in p.fts(plan.match_expr, limit=candidates * 2):
                scored.append((h.bm25, h.chunk_id))
        scored.sort()
        for _s, cid in scored:
            if cid in self.meta and self._passes(self.meta[cid][1], domain, patient_type):
                bm25.append(cid)
            if len(bm25) >= candidates:
                break

        vec_query = " ".join([query, *[" ".join(v) for v in plan.expansions.values()]])
        qv = self.embedder.embed([vec_query])[0]
        sims: dict[str, float] = {}
        for p in self.packs:
            for cid, v in p.vectors.items():
                if self._passes(self.meta[cid][1], domain, patient_type):
                    sims[cid] = cosine(qv, v)
        vec = [cid for cid, _ in sorted(sims.items(), key=lambda kv: (-kv[1], kv[0]))[:candidates]]

        fused: dict[str, float] = {}
        for rank, cid in enumerate(bm25):
            fused[cid] = fused.get(cid, 0.0) + 1.0 / (RRF_K + rank + 1)
        for rank, cid in enumerate(vec):
            fused[cid] = fused.get(cid, 0.0) + 1.0 / (RRF_K + rank + 1)
        ranked = sorted(fused.items(), key=lambda kv: (-kv[1], kv[0]))[: max(k * 3, k)]

        by_pack: dict[str, list[str]] = {}
        for cid, _ in ranked:
            by_pack.setdefault(self.meta[cid][0].pack_id, []).append(cid)
        rows: dict[str, dict[str, Any]] = {}
        for p in self.packs:
            rows.update(p.chunks(by_pack.get(p.pack_id, [])))

        bm25_pos = {cid: i for i, cid in enumerate(bm25)}
        vec_pos = {cid: i for i, cid in enumerate(vec)}
        hits = []
        for cid, score in ranked:
            r = rows[cid]
            gid = r["guide_id"]
            title = self._guide_titles.get(gid or "", r["topic"])
            hits.append(
                Hit(
                    chunk_id=cid,
                    pack_id=self.meta[cid][0].pack_id,
                    guide_id=gid,
                    title=title,
                    section_path=r["section_path"],
                    text=r["text"],
                    domain=r["domain"],
                    category=r["category"],
                    source_id=r["source_id"],
                    severity=r["severity"],
                    rrf=score,
                    bm25_rank=bm25_pos.get(cid),
                    vec_rank=vec_pos.get(cid),
                    cosine=sims.get(cid, 0.0),
                    coverage=self._coverage(plan, f"{title} {self._guide_tags.get(gid or '', '')} {r['text']}"),
                )
            )
        # Re-rank lightly: RRF first, lexical coverage as the tie-breaker signal.
        hits.sort(key=lambda h: (-(h.rrf + 0.01 * h.coverage), h.chunk_id))
        return SearchResult(plan, hits[:k], (time.perf_counter() - t0) * 1000)

    def guide_chunks(self, guide_id: str) -> list[dict[str, Any]]:
        for p in self.packs:
            rows = p.con.execute(
                "SELECT * FROM chunks WHERE guide_id = ? ORDER BY order_idx", (guide_id,)
            ).fetchall()
            if rows:
                return [dict(r) | {"pack_id": p.pack_id} for r in rows]
        return []
