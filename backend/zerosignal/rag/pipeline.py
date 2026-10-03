"""Ask pipeline (Section 7.1 run-time flow).

    red-flag detector -> retrieval -> domain router -> confidence gate
      -> prompt -> LLM (streaming) -> citation validator

``AskPipeline.run`` is an async generator of events, which the API streams
to the client as Server-Sent Events:

    redflag         matching protocol cards (sent before anything else)
    route           domain decision
    declined        clearly off-topic (router OUT_OF_SCOPE); nothing else follows
    not_in_library  low confidence; 3 closest guides; LLM is NOT called
    context         numbered sources (so they survive a Stop, US-4.5)
    token           streamed answer text
    answer          validated, structured answer
    error           LLM failure (sources remain usable)
    done            timings
"""

from __future__ import annotations

import time
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

from ..text import estimate_tokens
from .llm import ExtractiveBackend, LLMBackend, LLMError
from .prompt import ContextPassage, build_messages
from .redflag import RedFlagDetector
from .router import route
from .search import HybridSearcher, SearchResult
from .validator import validate_answer

LANGUAGES = {"en": "English", "hi": "Hindi"}


@dataclass
class AskRequest:
    question: str
    patient_type: str | None = None
    domain: str | None = None
    vehicle: dict[str, Any] | None = None
    history: list[dict[str, str]] | None = None
    language: str = "en"
    style: str = "normal"
    allow_llm: bool = True  # False = battery saver / no model: extractive only


class AskPipeline:
    def __init__(
        self,
        searcher: HybridSearcher,
        detector: RedFlagDetector,
        llm: LLMBackend,
        *,
        confidence_threshold: float = 0.4,
        max_tokens: int = 350,
        context_passages: int = 6,
        context_token_budget: int = 2400,
    ):
        self.searcher = searcher
        self.detector = detector
        self.llm = llm
        self.extractive = ExtractiveBackend()
        self.threshold = confidence_threshold
        self.max_tokens = max_tokens
        self.k = context_passages
        self.budget = context_token_budget

    # ------------------------------------------------------------ context
    def build_context(self, result: SearchResult) -> list[ContextPassage]:
        """Top-k hits, then make sure the top guide's Steps / Warnings /
        When-to-get-help sections are present (they are library passages too)."""
        chosen: list[dict[str, Any]] = []
        seen: set[str] = set()
        for h in result.hits[: self.k]:
            chosen.append(h.to_dict() | {"text": h.text})
            seen.add(h.chunk_id)
        if result.hits and result.hits[0].guide_id:
            extra = []
            for c in self.searcher.guide_chunks(result.hits[0].guide_id):
                sec = c["section_path"].rsplit(" > ", 1)[-1]
                if c["chunk_id"] not in seen and sec in ("Summary", "Steps", "Warnings", "When to get help"):
                    extra.append(c | {"title": result.hits[0].title})
                    seen.add(c["chunk_id"])
            chosen = chosen[:1] + extra + chosen[1:]

        passages: list[ContextPassage] = []
        used = 0
        for c in chosen:
            t = estimate_tokens(c["text"])
            if passages and used + t > self.budget:
                continue
            used += t
            passages.append(
                ContextPassage(
                    n=len(passages) + 1,
                    chunk_id=c["chunk_id"],
                    guide_id=c.get("guide_id"),
                    title=c.get("title") or c.get("topic", ""),
                    section_path=c["section_path"],
                    text=c["text"],
                    source_id=c["source_id"],
                    pack_id=c["pack_id"],
                )
            )
        return passages

    def closest_guides(self, result: SearchResult, n: int = 3) -> list[dict[str, Any]]:
        out, seen = [], set()
        for h in result.hits:
            if h.guide_id and h.guide_id not in seen:
                seen.add(h.guide_id)
                out.append({"guide_id": h.guide_id, "title": h.title, "domain": h.domain, "category": h.category})
            if len(out) >= n:
                break
        return out

    # ---------------------------------------------------------------- run
    async def run(self, req: AskRequest) -> AsyncIterator[dict[str, Any]]:
        t0 = time.perf_counter()

        def ms() -> int:
            return round((time.perf_counter() - t0) * 1000)

        matches = self.detector.detect(req.question)
        if matches:
            yield {
                "type": "redflag",
                "cards": [{"card_id": m.card_id, "title": m.title, "matched": m.matched} for m in matches],
                "ms": ms(),
            }

        # Follow-ups re-retrieve with the previous question folded in (US-4.7).
        retrieval_q = req.question
        if req.history:
            retrieval_q = f"{req.history[-1]['q']} {req.question}"
        result = self.searcher.search(retrieval_q, k=8, domain=req.domain, patient_type=req.patient_type)
        if matches and result.top_confidence < self.threshold:
            # A red flag fired but the wording (slang, Hinglish, Hindi) did not
            # retrieve well: fold the matched card's title into the query.
            assisted = self.searcher.search(
                f"{retrieval_q} {matches[0].title}", k=8, domain=req.domain, patient_type=req.patient_type
            )
            if assisted.top_confidence > result.top_confidence:
                result = assisted
        top = result.hits[0] if result.hits else None
        r = route(req.question if not req.history else retrieval_q, top.domain if top else None, result.top_confidence)
        yield {"type": "route", "domain": r.domain, "reason": r.reason, "confidence": result.top_confidence}

        if r.out_of_scope and not matches:
            yield {
                "type": "declined",
                "message": "ZeroSignal only answers emergency first aid, survival and vehicle repair questions.",
            }
            yield {"type": "done", "ms": ms()}
            return

        if not top or result.top_confidence < self.threshold:
            yield {
                "type": "not_in_library",
                "message": "This isn't covered in the library.",
                "closest": self.closest_guides(result),
                "confidence": result.top_confidence,
            }
            yield {"type": "done", "ms": ms()}
            return

        passages = self.build_context(result)
        sources = {s["source_id"]: s for pack in self.searcher.packs for s in pack.sources()}
        yield {
            "type": "context",
            "passages": [p.to_dict() | {"source": sources.get(p.source_id)} for p in passages],
        }

        backend: LLMBackend = self.llm if req.allow_llm else self.extractive
        messages = build_messages(
            req.question,
            passages,
            patient_type=req.patient_type,
            vehicle=req.vehicle,
            history=req.history,
            language=LANGUAGES.get(req.language, "English"),
            style=req.style,
            max_tokens=self.max_tokens,
        )
        raw = []
        ttft = None
        try:
            async for piece in backend.stream(messages, passages, self.max_tokens, req.style):
                if ttft is None:
                    ttft = ms()
                raw.append(piece)
                yield {"type": "token", "text": piece}
        except LLMError as exc:
            yield {"type": "error", "message": str(exc), "backend": backend.name}
            if backend is not self.extractive:
                # Library-grounded fallback keeps the feature useful without a model.
                backend = self.extractive
                raw = [self.extractive.compose(passages, req.style)]
                yield {"type": "token", "text": raw[0], "replace": True}

        context = {p.n: p.text for p in passages}
        answer = validate_answer("".join(raw), context)
        if answer.is_empty and backend is not self.extractive:
            # Nothing usable survived (blank or unparseable model output).
            yield {"type": "error", "message": "model returned no usable answer", "backend": backend.name}
            backend = self.extractive
            raw = [self.extractive.compose(passages, req.style)]
            yield {"type": "token", "text": raw[0], "replace": True}
            answer = validate_answer(raw[0], context)
        if answer.not_in_library:
            yield {
                "type": "not_in_library",
                "message": "This isn't covered in the library.",
                "closest": self.closest_guides(result),
                "confidence": result.top_confidence,
            }
        else:
            yield {"type": "answer", "answer": answer.to_dict(), "backend": backend.name}
        yield {
            "type": "done",
            "ms": ms(),
            "ttft_ms": ttft,
            "search_ms": round(result.took_ms),
            "tokens": sum(estimate_tokens(p) for p in raw),
        }
