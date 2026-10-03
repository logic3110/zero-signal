# ZeroSignal

*No signal. Still an answer.* Offline, cited guidance for emergency medicine, survival and vehicle repair.

This repo holds the **backend** (content pipeline, pack format, RAG engine, API) and the **web app** (an offline-first PWA).
The Android app from `zerosignal-requirements.txt` is out of scope for now; it would reuse the same packs and pipeline.

## Architecture

![Build and runtime: content is chunked, embedded and written into SQLite packs for the API and JSON bundles for the browser](docs/architecture.svg)

Each pack is built twice. The API reads a read-only `pack.sqlite`: keyword search runs inside SQLite (FTS5 `bm25()`), while the int8 vectors are only stored there and are loaded into memory for cosine search in Python. The browser gets a JSON bundle without vectors, keeps it in IndexedDB and searches it offline with MiniSearch, so only Ask needs the network.

![Ask pipeline: red flag, query plan, BM25 and vector search, rank fusion, confidence, router, gate, context, LLM, citation validator](docs/ask-pipeline.svg)

```
backend/
  zerosignal/          Python package
    build.py           zs-build   - YAML pack config -> pack.sqlite + web bundle (US-15.x)
    evaluate.py        zs-eval    - Recall@5, MRR, citation validity, refusals, red-flag recall (E17)
    sign.py            zs-sign    - ed25519 keygen / sign / verify
    publish.py         zs-publish - catalog.json, copy bundles into the PWA
    chunker.py         structure-aware chunking (numbered procedures never split)
    embeddings.py      zs-hash-v1 default embedder; st:<model> via sentence-transformers
    pack/              SQLite schema (Section 11), writer, reader
    rag/               red-flag detector, domain router, hybrid search (FTS5 BM25 + vectors, RRF),
                       prompt, LLM backends, citation validator, pipeline
    api/app.py         FastAPI: catalog, pack files (Range), library, search, protocols, /api/ask (SSE)
  content/
    guides/{medical,survival,vehicle}/*.md   80 guides (Markdown + YAML front matter)
    protocol_cards/*.yaml                    37 emergency cards (all PRD MVP cards)
    trees/*.yaml                             decision trees (won't start, smoke, vibration, START triage)
    tables/*.yaml                            emergency numbers, warning lights, OBD codes, water, supplies
    synonyms/en.yaml, sources.yaml, models.yaml, packs/*.yaml, eval/gold.yaml
  tests/               pytest suite
web/                   Vite + React + TypeScript PWA
```

## Quick start

```bash
# Backend
cd backend
python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'
.venv/bin/zs-build --config content/packs/core.yaml --config content/packs/medical-core.yaml \
  --config content/packs/survival-core.yaml --config content/packs/vehicle-core.yaml --out dist/
.venv/bin/zs-eval --packs dist --gold content/eval/gold.yaml --ci
.venv/bin/python -m pytest

# Web
cd ../web
npm install
npm run sync-packs        # zs-publish: catalog + bundles -> public/packs
npm run build             # or: npm run dev (proxies /api to :8000)
npm test

# Serve API + built PWA on one port
cd ../backend && .venv/bin/zs-serve --port 8000   # http://127.0.0.1:8000
```

## Answer engine

`/api/ask` never answers from model memory. The flow is: red flag → retrieve → route → confidence gate → prompt → generate → validate.

| `ZS_LLM_BACKEND` | What happens |
|---|---|
| `extractive` (default) | No model. Builds the cited answer directly from the retrieved Steps, Warnings and Help passages. |
| `openai` | Streams from a **local** OpenAI-compatible server, e.g. `llama-server -m model.gguf --port 8080` or Ollama. Set `ZS_LLM_BASE_URL` and `ZS_LLM_MODEL`. Hosted APIs such as OpenRouter also work: `ZS_LLM_BASE_URL=https://openrouter.ai/api` plus `ZS_LLM_API_KEY` (sends data off-device; dev only). |

Other settings: `ZS_CONFIDENCE_THRESHOLD` (default 0.4), `ZS_MAX_TOKENS` (350), `ZS_PACKS_DIR`, `ZS_EMBEDDING_MODEL` / `ZS_EMBEDDING_DIM`.
If the model fails, the pipeline falls back to the extractive answer. The validator drops lines whose citations aren't in the context, and any dose not found verbatim in a cited passage.

## Release gates

`zs-build --release` fails unless every protocol card and guide has reviewer sign-off, the pack has `reviewer_signoff`, and no source has `permission: pending`.
**All content is currently original draft text pending expert review**, and the app says so on every guide and card. Emergency numbers must be re-verified before release.

## Deploying to Vercel

One project at the repo root (`vercel.json`): the PWA is served statically from `web/dist`, and the FastAPI app runs as a Python function (`api/index.py`) behind `/api/*` and `/packs/*.sqlite`.
`scripts/vercel-build.sh` builds the packs and then the PWA. It runs on the Hobby (free) tier.
Set the `ZS_*` variables (and `ANTHROPIC_API_KEY` if you use it) under Project → Settings → Environment Variables, because `backend/.env` is not deployed. Without them, `/api/ask` uses the extractive backend.
