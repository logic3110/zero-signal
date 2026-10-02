"""Runtime settings from environment variables (prefix ``ZS_``)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent


def load_dotenv(path: Path = BACKEND_ROOT / ".env") -> None:
    """Load KEY=VALUE lines from backend/.env (never committed). Real
    environment variables take precedence."""
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("'\""))


load_dotenv()


def _env(name: str, default: str) -> str:
    return os.environ.get(f"ZS_{name}", default)


@dataclass
class Settings:
    packs_dir: Path = field(default_factory=lambda: Path(_env("PACKS_DIR", str(BACKEND_ROOT / "dist"))))
    web_dist: Path | None = field(
        default_factory=lambda: Path(p) if (p := _env("WEB_DIST", str(BACKEND_ROOT.parent / "web" / "dist"))) else None
    )
    embedding_model_id: str = field(default_factory=lambda: _env("EMBEDDING_MODEL", "zs-hash-v1"))
    embedding_dim: int = field(default_factory=lambda: int(_env("EMBEDDING_DIM", "384")))
    # "extractive" (no model), "openai" (local llama.cpp / Ollama server) or
    # "anthropic" (Claude API - dev stand-in; needs ANTHROPIC_API_KEY).
    llm_backend: str = field(default_factory=lambda: _env("LLM_BACKEND", "extractive"))
    llm_base_url: str = field(default_factory=lambda: _env("LLM_BASE_URL", "http://127.0.0.1:8080"))
    llm_model: str = field(default_factory=lambda: _env("LLM_MODEL", "local"))
    # Bearer token for hosted OpenAI-compatible APIs (e.g. OpenRouter); empty for local servers.
    llm_api_key: str = field(default_factory=lambda: _env("LLM_API_KEY", ""))
    anthropic_model: str = field(default_factory=lambda: _env("ANTHROPIC_MODEL", "claude-opus-5-5"))
    anthropic_effort: str = field(default_factory=lambda: _env("ANTHROPIC_EFFORT", "low"))
    confidence_threshold: float = field(default_factory=lambda: float(_env("CONFIDENCE_THRESHOLD", "0.4")))
    max_output_tokens: int = field(default_factory=lambda: int(_env("MAX_TOKENS", "350")))
    context_passages: int = field(default_factory=lambda: int(_env("CONTEXT_PASSAGES", "6")))
    context_token_budget: int = field(default_factory=lambda: int(_env("CONTEXT_TOKENS", "2400")))
    cors_origins: list[str] = field(
        default_factory=lambda: _env("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
    )
