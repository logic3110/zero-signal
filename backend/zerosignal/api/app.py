"""ZeroSignal API.

Static-first by design (Section 7.4): the catalog and signed pack files are
plain files. The only dynamic endpoints are library/search conveniences and
``/api/ask``, which runs the RAG pipeline against a *local* model server - the
web counterpart of the on-device runtime. No accounts, no analytics, no
request logging of queries (US-14.1).
"""

from __future__ import annotations

import argparse
import json
import logging
import mimetypes
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .. import APP_VERSION
from ..embeddings import get_embedder
from ..pack.reader import PackReader, load_packs
from ..publish import build_catalog
from ..rag.llm import make_llm
from ..rag.pipeline import AskPipeline, AskRequest
from ..rag.redflag import RedFlagDetector
from ..rag.search import HybridSearcher
from ..settings import Settings

log = logging.getLogger("zerosignal")
mimetypes.add_type("application/manifest+json", ".webmanifest")


class State:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.load()

    def load(self) -> None:
        s = self.settings
        self.embedder = get_embedder(s.embedding_model_id, s.embedding_dim)
        self.packs: list[PackReader] = (
            load_packs(s.packs_dir, s.embedding_model_id, s.embedding_dim) if s.packs_dir.exists() else []
        )
        self.searcher = HybridSearcher(self.packs, self.embedder)
        self.cards = [c for p in self.packs for c in p.cards()]
        self.detector = RedFlagDetector(self.cards)
        self.llm = make_llm(s)
        self.pipeline = AskPipeline(
            self.searcher,
            self.detector,
            self.llm,
            confidence_threshold=s.confidence_threshold,
            max_tokens=s.max_output_tokens,
            context_passages=s.context_passages,
            context_token_budget=s.context_token_budget,
        )

    def guide(self, guide_id: str) -> dict[str, Any] | None:
        for p in self.packs:
            g = p.guide(guide_id)
            if g:
                return g | {"pack_id": p.pack_id}
        return None


class AskBody(BaseModel):
    question: str = Field(min_length=2, max_length=1000)
    patient_type: Literal["adult", "child", "infant", "pregnant", "elderly"] | None = None
    domain: Literal["medical", "survival", "vehicle"] | None = None
    vehicle: dict[str, str] | None = None
    history: list[dict[str, str]] | None = Field(default=None, max_length=2)
    language: str = "en"
    style: Literal["normal", "simpler", "detail"] = "normal"
    allow_llm: bool = True


class RedFlagBody(BaseModel):
    question: str = Field(min_length=1, max_length=1000)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.zs = State(settings)
        log.info("loaded %d packs from %s", len(app.state.zs.packs), settings.packs_dir)
        yield
        for p in app.state.zs.packs:
            p.close()

    app = FastAPI(title="ZeroSignal API", version=APP_VERSION, lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["GET", "POST"], allow_headers=["*"]
    )

    def st(request: Request) -> State:
        return request.app.state.zs

    # ------------------------------------------------------------- health
    @app.get("/api/health")
    async def health(request: Request):
        s = st(request)
        return {
            "status": "ok",
            "version": APP_VERSION,
            "packs": [{"pack_id": p.pack_id, "version": p.manifest["version"]} for p in s.packs],
            "llm": {"backend": s.llm.name, "available": await s.llm.available()},
            "embedding": s.embedder.model_id,
        }

    # ------------------------------------------------------ catalog/packs
    @app.get("/api/catalog")
    async def catalog(request: Request):
        path = settings.packs_dir / "catalog.json"
        if path.exists():
            return JSONResponse(json.loads(path.read_text(encoding="utf-8")))
        return build_catalog(settings.packs_dir, base_url="/packs/")

    @app.get("/packs/{name}")
    async def pack_file(name: str):
        # Only files that the build produced; FileResponse handles Range
        # requests, so interrupted downloads resume (US-1.4).
        if "/" in name or name.startswith(".") or not name.endswith((".sqlite", ".json", ".sig")):
            raise HTTPException(404)
        path = settings.packs_dir / name
        if not path.is_file():
            raise HTTPException(404)
        return FileResponse(path, headers={"Cache-Control": "public, max-age=300"})

    # ------------------------------------------------------------- library
    @app.get("/api/library/domains")
    async def domains(request: Request):
        out: dict[str, dict[str, int]] = {}
        for p in st(request).packs:
            for g in p.guides():
                out.setdefault(g["domain"], {}).setdefault(g["category"], 0)
                out[g["domain"]][g["category"]] += 1
        return [
            {"domain": d, "categories": [{"name": c, "guides": n} for c, n in sorted(cats.items())]}
            for d, cats in sorted(out.items())
        ]

    @app.get("/api/library/guides")
    async def guides(request: Request, domain: str | None = None, category: str | None = None):
        return [g for p in st(request).packs for g in p.guides(domain, category)]

    @app.get("/api/library/guides/{guide_id}")
    async def guide(request: Request, guide_id: str):
        g = st(request).guide(guide_id)
        if not g:
            raise HTTPException(404, "guide not found")
        return g

    @app.get("/api/library/chunks/{chunk_id}")
    async def chunk(request: Request, chunk_id: str):
        for p in st(request).packs:
            c = p.chunk(chunk_id)
            if c:
                return c
        raise HTTPException(404, "chunk not found")

    # -------------------------------------------------------------- search
    @app.get("/api/search")
    async def search(
        request: Request,
        q: str = Query(min_length=1, max_length=300),
        domain: Literal["medical", "survival", "vehicle"] | None = None,
        patient_type: str | None = None,
        k: int = Query(10, ge=1, le=30),
    ):
        res = st(request).searcher.search(q, k=k, domain=domain, patient_type=patient_type)
        return {
            "query": q,
            "corrected": res.query.corrected,
            "expansions": res.query.expansions,
            "took_ms": round(res.took_ms, 1),
            "hits": [h.to_dict() for h in res.hits],
        }

    # ----------------------------------------------------- protocol cards
    @app.get("/api/protocols")
    async def protocols(request: Request, domain: str | None = None):
        return [c for c in st(request).cards if not domain or c["domain"] == domain]

    @app.get("/api/protocols/{card_id}")
    async def protocol(request: Request, card_id: str):
        for c in st(request).cards:
            if c["card_id"] == card_id:
                return c
        raise HTTPException(404, "card not found")

    @app.post("/api/redflag")
    async def redflag(request: Request, body: RedFlagBody):
        return [m.__dict__ for m in st(request).detector.detect(body.question)]

    # ------------------------------------------------- trees and tables
    @app.get("/api/trees")
    async def trees(request: Request, domain: str | None = None):
        return [t for p in st(request).packs for t in p.trees() if not domain or t["domain"] == domain]

    @app.get("/api/tables")
    async def tables(request: Request, kind: str | None = None):
        return [t for p in st(request).packs for t in p.tables(kind)]

    # ------------------------------------------------------------------ ask
    @app.post("/api/ask")
    async def ask(request: Request, body: AskBody):
        pipeline = st(request).pipeline
        req = AskRequest(**body.model_dump())

        async def events():
            async for ev in pipeline.run(req):
                if await request.is_disconnected():  # user pressed Stop (US-4.5)
                    break
                yield f"event: {ev['type']}\ndata: {json.dumps(ev, ensure_ascii=False)}\n\n"

        return StreamingResponse(
            events(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
        )

    # ----------------------------------------------- optional: serve the PWA
    web = settings.web_dist
    if web and (web / "index.html").exists():
        app.mount("/assets", StaticFiles(directory=web / "assets"), name="assets")

        @app.get("/{path:path}", include_in_schema=False)
        async def spa(path: str):
            candidate = (web / path).resolve()
            if path and candidate.is_file() and web.resolve() in candidate.parents:
                return FileResponse(candidate)
            return FileResponse(web / "index.html")

    return app


def main(argv: list[str] | None = None) -> None:
    import uvicorn

    ap = argparse.ArgumentParser(prog="zs-serve")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--reload", action="store_true")
    args = ap.parse_args(argv)
    # access_log off: queries must not be logged anywhere (privacy).
    uvicorn.run(
        "zerosignal.api.app:create_app", factory=True, host=args.host, port=args.port, reload=args.reload, access_log=False
    )


if __name__ == "__main__":
    main()
