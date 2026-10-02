"""Loaders for the structured (non-guide) content: sources, protocol cards,
decision trees, static tables and synonyms. All are YAML or JSON."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import yaml

from ..schemas import DecisionTree, ProtocolCard, Source, StaticTable


def read_data(path: Path) -> Any:
    text = path.read_text(encoding="utf-8")
    if path.suffix == ".json":
        return json.loads(text)
    return yaml.safe_load(text)


def _as_list(data: Any) -> list:
    return data if isinstance(data, list) else [data]


def load_sources(path: Path) -> dict[str, Source]:
    items = read_data(path)["sources"]
    sources = [Source(**s) for s in items]
    return {s.source_id: s for s in sources}


def load_cards(paths: list[Path]) -> list[ProtocolCard]:
    cards = [ProtocolCard(**c) for p in sorted(paths) for c in _as_list(read_data(p))]
    return sorted(cards, key=lambda c: (c.domain, c.order, c.card_id))


def load_trees(paths: list[Path]) -> list[DecisionTree]:
    return [DecisionTree(**t) for p in sorted(paths) for t in _as_list(read_data(p))]


def load_tables(paths: list[Path]) -> list[StaticTable]:
    return [StaticTable(**t) for p in sorted(paths) for t in _as_list(read_data(p))]


def load_synonyms(paths: list[Path]) -> list[tuple[str, str, str]]:
    """Return (term, canonical, language) rows.

    File format::

        language: en
        synonyms:
          seizure: [fits, fit, convulsion]
    """
    rows: set[tuple[str, str, str]] = set()
    for p in sorted(paths):
        data = read_data(p)
        lang = data.get("language", "en")
        for canonical, terms in data["synonyms"].items():
            for term in terms:
                rows.add((str(term).lower(), str(canonical).lower(), lang))
    return sorted(rows)
