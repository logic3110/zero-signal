"""Typed content and pack models (Section 11 data model)."""

from __future__ import annotations

from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

Domain = Literal["medical", "survival", "vehicle"]
Severity = Literal["critical", "urgent", "routine"]
PatientType = Literal["adult", "child", "infant", "pregnant", "elderly"]

ALL_PATIENT_TYPES: tuple[str, ...] = ("adult", "child", "infant", "pregnant", "elderly")


class Source(BaseModel):
    """A source document. A licence is mandatory (US-15.2, R3)."""

    source_id: str
    publisher: str
    title: str
    url: str | None = None
    licence: str
    retrieved_at: str | None = None
    version: str | None = None
    permission: Literal["public-domain", "open-licence", "permission-granted", "original", "pending"]
    notes: str | None = None

    @field_validator("licence")
    @classmethod
    def _licence_required(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("every source must record a licence")
        return v


class Review(BaseModel):
    by_role: str
    date: date


class Guide(BaseModel):
    guide_id: str
    domain: Domain
    category: str
    title: str
    summary: str
    body_md: str
    steps: list[str]
    warnings: list[str] = Field(default_factory=list)
    red_flags: list[str] = Field(default_factory=list)
    seek_help: list[str] = Field(default_factory=list)
    patient_types: list[str] = Field(default_factory=lambda: list(ALL_PATIENT_TYPES))
    severity: Severity = "routine"
    region: str = "global"
    language: str = "en"
    tags: list[str] = Field(default_factory=list)
    sources: list[str]
    protocol_card: str | None = None
    review: Review | None = None

    @property
    def last_reviewed(self) -> str | None:
        return self.review.date.isoformat() if self.review else None

    @property
    def reviewer_role(self) -> str | None:
        return self.review.by_role if self.review else None


class CardStep(BaseModel):
    text: str
    detail: str | None = None


class CardTimer(BaseModel):
    id: str
    label: str
    # Optional reminder interval in seconds (e.g. re-check every 2 minutes).
    interval_s: int | None = None


class ProtocolCard(BaseModel):
    """Static, human-authored emergency card. Never LLM-generated (US-5.1)."""

    card_id: str
    domain: Domain
    title: str
    subtitle: str | None = None
    icon: str
    trigger_terms: list[str]
    call_first: bool = True
    steps: list[CardStep]
    do_not: list[str] = Field(default_factory=list)
    timers: list[CardTimer] = Field(default_factory=list)
    tools: list[str] = Field(default_factory=list)  # e.g. ["cpr-metronome"]
    emergency_number_key: Literal["ambulance", "fire", "police", "disaster", "roadside", "general"] = "ambulance"
    related_guides: list[str] = Field(default_factory=list)
    sources: list[str]
    reviewed_by: str | None = None
    reviewed_at: date | None = None
    order: int = 100


class TreeNode(BaseModel):
    id: str
    text: str
    kind: Literal["question", "result"] = "question"
    detail: str | None = None
    options: list[dict[str, str]] = Field(default_factory=list)  # {label, next}
    severity: str | None = None
    guide_id: str | None = None


class DecisionTree(BaseModel):
    tree_id: str
    domain: Domain
    title: str
    description: str
    start: str
    nodes: list[TreeNode]
    sources: list[str]
    reviewed_by: str | None = None
    reviewed_at: date | None = None

    def validate_graph(self) -> list[str]:
        ids = {n.id for n in self.nodes}
        errors = []
        if self.start not in ids:
            errors.append(f"{self.tree_id}: start node '{self.start}' missing")
        for n in self.nodes:
            if n.kind == "question" and not n.options:
                errors.append(f"{self.tree_id}:{n.id}: question without options")
            for opt in n.options:
                if opt.get("next") not in ids:
                    errors.append(f"{self.tree_id}:{n.id}: option -> unknown node {opt.get('next')!r}")
        return errors


class StaticTable(BaseModel):
    table_id: str
    kind: str
    title: str
    source_id: str
    data: Any


class ChunkingParams(BaseModel):
    target_tokens: int = 380
    max_tokens: int = 520
    overlap_ratio: float = 0.12


class EmbeddingParams(BaseModel):
    model_id: str = "zs-hash-v1"
    dim: int = 384


class DocumentInput(BaseModel):
    """A raw source document to ingest in addition to authored guides."""

    source_id: str
    path: str
    format: Literal["html", "pdf", "epub", "md", "docx", "txt", "auto"] = "auto"
    domain: Domain
    category: str = "Reference"
    ocr: bool = False


class PackInputs(BaseModel):
    guides: list[str] = Field(default_factory=list)
    protocol_cards: list[str] = Field(default_factory=list)
    trees: list[str] = Field(default_factory=list)
    tables: list[str] = Field(default_factory=list)
    synonyms: list[str] = Field(default_factory=list)
    documents: list[DocumentInput] = Field(default_factory=list)


class PackConfig(BaseModel):
    pack_id: str
    version: str
    title: str
    description: str = ""
    domain: Literal["medical", "survival", "vehicle", "multi"]
    language: str = "en"
    region: str = "global"
    min_app_version: str = "0.1.0"
    # Fixed timestamp keeps builds deterministic (US-15.1).
    created_at: str
    sources_file: str = "../sources.yaml"
    inputs: PackInputs
    chunking: ChunkingParams = Field(default_factory=ChunkingParams)
    embedding: EmbeddingParams = Field(default_factory=EmbeddingParams)
    reviewer_signoff: str | None = None


class Chunk(BaseModel):
    chunk_id: str
    guide_id: str | None
    source_id: str
    section_path: str
    text: str
    token_count: int
    domain: str
    category: str
    topic: str
    patient_type: str  # space-separated list
    severity: str
    region: str
    language: str
    licence: str
    reviewed: bool
    order_idx: int


class Manifest(BaseModel):
    pack_id: str
    version: str
    title: str
    description: str
    domain: str
    language: str
    region: str
    created_at: str
    embedding_model_id: str
    embedding_dim: int
    min_app_version: str
    reviewer_signoff: str | None
    counts: dict[str, int]
    content_hash: str
    schema_version: int = 1
