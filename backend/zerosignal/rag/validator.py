"""Post-generation citation validator (US-4.2, S-3).

Parses the model's answer into sections and lines, then:
  * removes lines citing an id that was not in the retrieved context,
  * flags lines with no citation at all ("uncited"),
  * removes any line that states a dose/amount not present verbatim in the
    passages it cites - the LLM must never generate doses.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

_CITE_RE = re.compile(r"\[(\d+(?:\s*,\s*\d+)*)\]")
_DOSE_RE = re.compile(
    r"\b\d+(?:[.,]\d+)?\s*(?:mg|mcg|µg|ug|g|grams?|ml|mL|millilitres?|milliliters?|iu|units?|tablets?|tabs?|pills?|capsules?|puffs?|drops?)\b"
    r"(?:\s*/\s*kg)?",
    re.I,
)
_HEADINGS = {
    "summary": "summary",
    "steps": "steps",
    "warnings": "warnings",
    "warning": "warnings",
    "do not": "warnings",
    "get help": "help",
    "when to get help": "help",
    "when to get professional help": "help",
}


@dataclass
class Line:
    text: str
    citations: list[int]
    flags: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {"text": self.text, "citations": self.citations, "flags": self.flags}


@dataclass
class ValidatedAnswer:
    summary: Line | None
    steps: list[Line]
    warnings: list[Line]
    help: list[Line]
    removed: list[dict[str, str]]
    not_in_library: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "summary": self.summary.to_dict() if self.summary else None,
            "steps": [s.to_dict() for s in self.steps],
            "warnings": [s.to_dict() for s in self.warnings],
            "help": [s.to_dict() for s in self.help],
            "removed": self.removed,
            "not_in_library": self.not_in_library,
        }

    @property
    def is_empty(self) -> bool:
        return not (self.not_in_library or self.summary or self.steps or self.warnings or self.help)

    @property
    def cited_ids(self) -> set[int]:
        out: set[int] = set()
        for line in ([self.summary] if self.summary else []) + self.steps + self.warnings + self.help:
            out.update(line.citations)
        return out


def _citations(text: str) -> list[int]:
    ids: list[int] = []
    for m in _CITE_RE.finditer(text):
        ids.extend(int(x) for x in re.split(r"\s*,\s*", m.group(1)))
    return ids


def _strip_marker(text: str) -> str:
    return re.sub(r"^\s*(?:\d+[.)]|[-*•])\s*", "", text).strip()


def _heading(line: str) -> tuple[str | None, str]:
    m = re.match(r"^\s*\**\s*([A-Za-z ]+?)\s*\**\s*:\s*\**\s*(.*)$", line)
    if m and m.group(1).strip().lower() in _HEADINGS:
        return _HEADINGS[m.group(1).strip().lower()], m.group(2).strip()
    return None, line


def validate_answer(raw: str, passages: dict[int, str]) -> ValidatedAnswer:
    """``passages`` maps context id -> passage text."""
    if "NOT_IN_LIBRARY" in raw:
        return ValidatedAnswer(None, [], [], [], [], not_in_library=True)

    sections: dict[str, list[str]] = {"summary": [], "steps": [], "warnings": [], "help": []}
    current = "summary"
    for line in raw.splitlines():
        if not line.strip():
            continue
        head, rest = _heading(line)
        if head:
            current = head
            if rest:
                sections[current].append(rest)
            continue
        sections[current].append(line)

    removed: list[dict[str, str]] = []

    def check(text: str, required: bool) -> Line | None:
        body = _strip_marker(text)
        if not body:
            return None
        cites = _citations(body)
        bad = [c for c in cites if c not in passages]
        if bad:
            removed.append({"text": body, "reason": f"cites unknown source {bad}"})
            return None
        # Doses must appear verbatim in a cited passage.
        for dose in _DOSE_RE.findall(body):
            support = " ".join(passages[c] for c in cites)
            if dose.lower() not in support.lower():
                removed.append({"text": body, "reason": f"dose '{dose}' not in cited source"})
                return None
        line = Line(_CITE_RE.sub("", body).strip(), sorted(set(cites)))
        if not line.text:  # a bare citation, e.g. "Steps: [2]"
            return None
        if required and not cites:
            line.flags.append("uncited")
        return line

    summary_lines = [ln for ln in (check(t, False) for t in sections["summary"]) if ln]
    summary = None
    if summary_lines:
        summary = Line(" ".join(s.text for s in summary_lines), sorted({c for s in summary_lines for c in s.citations}))
    return ValidatedAnswer(
        summary=summary,
        steps=[ln for ln in (check(t, True) for t in sections["steps"]) if ln],
        warnings=[ln for ln in (check(t, True) for t in sections["warnings"]) if ln],
        help=[ln for ln in (check(t, True) for t in sections["help"]) if ln],
        removed=removed,
    )
