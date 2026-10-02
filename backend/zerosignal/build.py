"""zs-build: build a signed-ready pack from a YAML config (US-15.1..15.7).

    zs-build --config content/packs/medical-core.yaml --out dist/
    zs-build --config ... --out dist/ --dry-run     # chunks.json + review.html only
    zs-build --config ... --out dist/ --release     # enforce reviewer sign-off
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import sys
from pathlib import Path

import yaml

from .chunker import chunk_text
from .embeddings import get_embedder
from .ingest.content import load_cards, load_sources, load_synonyms, load_tables, load_trees
from .ingest.documents import parse_document
from .ingest.guides import load_guides, split_sections
from .pack.writer import sha256_file, write_pack, write_web_bundle
from .schemas import Chunk, Guide, PackConfig, Source
from .text import estimate_tokens, slugify


class BuildError(RuntimeError):
    pass


def _glob(base: Path, patterns: list[str]) -> list[Path]:
    out: set[Path] = set()
    for pat in patterns:
        out.update(p for p in base.glob(pat) if p.is_file())
    return sorted(out)


def _chunk_id(*parts: str) -> str:
    """Deterministic, content-addressed chunk id."""
    return hashlib.sha1("\x1f".join(parts).encode()).hexdigest()[:12]


def chunk_guide(guide: Guide, sources: dict[str, Source], cfg: PackConfig) -> list[Chunk]:
    primary = guide.sources[0]
    chunks: list[Chunk] = []
    order = 0
    # The summary is its own small chunk so short "what is X" queries hit it.
    sections = [("Summary", guide.summary), *split_sections(guide.body_md)]
    for heading, text in sections:
        header = f"{guide.title} > {heading}"
        for piece in chunk_text(
            text,
            target_tokens=cfg.chunking.target_tokens,
            max_tokens=cfg.chunking.max_tokens,
            overlap_ratio=cfg.chunking.overlap_ratio,
            header=header,
        ):
            chunks.append(
                Chunk(
                    chunk_id=_chunk_id(guide.guide_id, heading, str(order), piece),
                    guide_id=guide.guide_id,
                    source_id=primary,
                    section_path=header,
                    text=piece,
                    token_count=estimate_tokens(piece),
                    domain=guide.domain,
                    category=guide.category,
                    topic=guide.title,
                    patient_type=" ".join(guide.patient_types),
                    severity=guide.severity,
                    region=guide.region,
                    language=guide.language,
                    licence=sources[primary].licence,
                    reviewed=guide.review is not None,
                    order_idx=order,
                )
            )
            order += 1
    return chunks


def validate(cfg: PackConfig, sources, guides, cards, trees, tables, release: bool) -> list[str]:
    errors: list[str] = []
    warnings: list[str] = []
    guide_ids = {g.guide_id for g in guides}
    for g in guides:
        for sid in g.sources:
            if sid not in sources:
                errors.append(f"guide {g.guide_id}: unknown source '{sid}' (every source needs a licence entry)")
        if release and g.review is None:
            errors.append(f"guide {g.guide_id}: no reviewer sign-off (release build)")
    card_ids = {c.card_id for c in cards}
    for g in guides:
        if g.protocol_card and g.protocol_card not in card_ids and cards:
            warnings.append(f"guide {g.guide_id}: protocol card '{g.protocol_card}' not in this pack")
    for c in cards:
        for sid in c.sources:
            if sid not in sources:
                errors.append(f"card {c.card_id}: unknown source '{sid}'")
        if not c.trigger_terms:
            errors.append(f"card {c.card_id}: needs trigger_terms for the red-flag detector")
        # US-16.1: protocol cards cannot ship without reviewer sign-off.
        if release and not (c.reviewed_by and c.reviewed_at):
            errors.append(f"card {c.card_id}: protocol cards cannot ship without reviewer sign-off")
        for gid in c.related_guides:
            if gid not in guide_ids:
                warnings.append(f"card {c.card_id}: related guide '{gid}' not in this pack")
    for t in trees:
        errors.extend(t.validate_graph())
        for n in t.nodes:
            if n.guide_id and n.guide_id not in guide_ids:
                warnings.append(f"tree {t.tree_id}:{n.id}: guide '{n.guide_id}' not in this pack")
    for t in tables:
        if t.source_id not in sources:
            errors.append(f"table {t.table_id}: unknown source '{t.source_id}'")
    if release and not cfg.reviewer_signoff:
        errors.append("pack: reviewer_signoff is required for a release build")
    if release:
        used = {sid for g in guides for sid in g.sources} | {sid for c in cards for sid in c.sources}
        for sid in sorted(used & sources.keys()):
            if sources[sid].permission == "pending":
                errors.append(f"source {sid}: licence/permission still 'pending' (release build)")
    for w in warnings:
        print(f"warning: {w}", file=sys.stderr)
    return errors


def dry_run_report(out: Path, cfg: PackConfig, chunks: list[Chunk]) -> None:
    (out / f"{cfg.pack_id}.chunks.json").write_text(
        json.dumps([c.model_dump() for c in chunks], indent=2, ensure_ascii=False), encoding="utf-8"
    )
    rows = "\n".join(
        f"<tr><td><code>{c.chunk_id}</code></td><td>{html.escape(c.section_path)}</td>"
        f"<td>{c.token_count}</td><td>{c.severity}</td><td>{html.escape(c.patient_type)}</td>"
        f"<td>{'yes' if c.reviewed else '<b>pending</b>'}</td>"
        f"<td><pre>{html.escape(c.text)}</pre></td></tr>"
        for c in chunks
    )
    (out / f"{cfg.pack_id}.review.html").write_text(
        f"""<!doctype html><meta charset="utf-8"><title>{cfg.pack_id} chunks</title>
<style>body{{font:14px system-ui;margin:1rem}}table{{border-collapse:collapse}}
td,th{{border:1px solid #ccc;padding:4px;vertical-align:top}}pre{{white-space:pre-wrap;margin:0;max-width:70ch}}</style>
<h1>{cfg.title} &mdash; {len(chunks)} chunks (dry run)</h1>
<table><tr><th>id</th><th>section</th><th>tokens</th><th>severity</th><th>patients</th><th>reviewed</th><th>text</th></tr>
{rows}</table>""",
        encoding="utf-8",
    )


def build(config_path: Path, out: Path, dry_run: bool = False, release: bool = False) -> dict:
    config_path = config_path.resolve()
    base = config_path.parent
    cfg = PackConfig(**yaml.safe_load(config_path.read_text(encoding="utf-8")))
    out.mkdir(parents=True, exist_ok=True)

    sources = load_sources((base / cfg.sources_file).resolve())
    guides = load_guides(_glob(base, cfg.inputs.guides))
    cards = load_cards(_glob(base, cfg.inputs.protocol_cards))
    trees = load_trees(_glob(base, cfg.inputs.trees))
    tables = load_tables(_glob(base, cfg.inputs.tables))
    synonyms = load_synonyms(_glob(base, cfg.inputs.synonyms))

    errors = validate(cfg, sources, guides, cards, trees, tables, release)
    if errors:
        raise BuildError("build failed:\n  " + "\n  ".join(errors))

    chunks: list[Chunk] = []
    for g in guides:
        chunks.extend(chunk_guide(g, sources, cfg))
    for doc in cfg.inputs.documents:
        if doc.source_id not in sources:
            raise BuildError(f"document {doc.path}: unknown source '{doc.source_id}'")
        src = sources[doc.source_id]
        for si, section in enumerate(parse_document(doc.path, doc.format, src.title, base, ocr=doc.ocr)):
            header = " > ".join(section.path)
            for pi, piece in enumerate(
                chunk_text(section.text, cfg.chunking.target_tokens, cfg.chunking.max_tokens, cfg.chunking.overlap_ratio, header)
            ):
                chunks.append(
                    Chunk(
                        chunk_id=_chunk_id(doc.source_id, header, str(si), str(pi), piece),
                        guide_id=None,
                        source_id=doc.source_id,
                        section_path=header,
                        text=piece,
                        token_count=estimate_tokens(piece),
                        domain=doc.domain,
                        category=doc.category,
                        topic=slugify(section.path[-1]),
                        patient_type="adult child infant pregnant elderly",
                        severity="routine",
                        region=cfg.region,
                        language=cfg.language,
                        licence=src.licence,
                        reviewed=False,
                        order_idx=si * 1000 + pi,
                    )
                )

    used_sources = sorted(
        {sid for g in guides for sid in g.sources}
        | {sid for c in cards for sid in c.sources}
        | {t.source_id for t in tables}
        | {c.source_id for c in chunks}
        | {sid for t in trees for sid in t.sources}
    )
    pack_sources = [sources[s] for s in used_sources]

    if dry_run:
        dry_run_report(out, cfg, chunks)
        return {"pack_id": cfg.pack_id, "chunks": len(chunks), "dry_run": True}

    embedder = get_embedder(cfg.embedding.model_id, cfg.embedding.dim)
    vectors = embedder.embed([c.text for c in chunks])

    pack_path = out / f"{cfg.pack_id}.sqlite"
    manifest = write_pack(pack_path, cfg, pack_sources, guides, chunks, vectors, cards, trees, tables, synonyms)
    bundle_path = out / f"{cfg.pack_id}.json"
    write_web_bundle(bundle_path, manifest, pack_sources, guides, chunks, cards, trees, tables, synonyms)

    sidecar = {
        **manifest.model_dump(),
        "files": {
            "sqlite": {"name": pack_path.name, "size": pack_path.stat().st_size, "sha256": sha256_file(pack_path)},
            "web": {"name": bundle_path.name, "size": bundle_path.stat().st_size, "sha256": sha256_file(bundle_path)},
        },
        "signature": None,
    }
    (out / f"{cfg.pack_id}.manifest.json").write_text(json.dumps(sidecar, indent=2), encoding="utf-8")
    return sidecar


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="zs-build", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", required=True, type=Path, action="append", help="pack YAML (repeatable)")
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--dry-run", action="store_true", help="export chunks JSON/HTML for inspection only")
    ap.add_argument("--release", action="store_true", help="fail unless all content has reviewer sign-off")
    args = ap.parse_args(argv)
    for cfg in args.config:
        try:
            result = build(cfg, args.out, dry_run=args.dry_run, release=args.release)
        except BuildError as exc:
            print(exc, file=sys.stderr)
            return 1
        if result.get("dry_run"):
            print(f"{result['pack_id']}: {result['chunks']} chunks -> {args.out} (dry run)")
        else:
            f = result["files"]["sqlite"]
            print(f"{result['pack_id']} {result['version']}: {result['counts']} -> {f['name']} sha256={f['sha256'][:16]}…")
    return 0


if __name__ == "__main__":
    sys.exit(main())
