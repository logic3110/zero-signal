"""ZeroSignal: offline, cited guidance for emergency medicine, survival and
vehicle repair.

Sub-packages:
    ingest  - source parsers and Markdown guide loader (build time)
    pack    - pack SQLite schema, writer and reader
    rag     - red-flag detector, domain router, hybrid search, prompt,
              LLM backends and citation validator (run time)
    api     - FastAPI app serving the catalog, packs and the RAG endpoint
"""

__version__ = "0.1.0"
APP_VERSION = __version__
