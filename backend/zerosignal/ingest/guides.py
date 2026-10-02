"""Load authored Markdown guides (YAML front matter + sectioned body).

Guide file layout::

    ---
    id: med-severe-bleeding
    domain: medical
    category: Bleeding
    title: Severe bleeding
    summary: ...
    severity: critical
    sources: [zs-original, ifrc-ifag-2020]
    ---
    ## Steps
    1. ...
    ## Warnings
    - ...
    ## When to get help
    - ...
    ## Red flags
    - ...

Any other ``##`` section is kept in ``body_md`` and chunked, but only the
four named sections are lifted into structured fields.
"""

from __future__ import annotations

import re
from pathlib import Path

import yaml

from ..schemas import Guide

_FRONT_RE = re.compile(r"\A---\s*\n(.*?)\n---\s*\n(.*)\Z", re.S)
_NUMBERED_RE = re.compile(r"^\s*\d+[.)]\s+(.*)$")
_BULLET_RE = re.compile(r"^\s*[-*]\s+(.*)$")

SECTION_ALIASES = {
    "steps": "steps",
    "what to do": "steps",
    "warnings": "warnings",
    "do not": "warnings",
    "when to get help": "seek_help",
    "when to seek help": "seek_help",
    "red flags": "red_flags",
}


class GuideParseError(ValueError):
    pass


def split_sections(body: str) -> list[tuple[str, str]]:
    """Split a Markdown body into (heading, text) pairs on ``##`` headings."""
    sections: list[tuple[str, str]] = []
    heading = "Overview"
    buf: list[str] = []
    for line in body.splitlines():
        m = re.match(r"^##\s+(.*)$", line)
        if m:
            if "".join(buf).strip():
                sections.append((heading, "\n".join(buf).strip()))
            heading, buf = m.group(1).strip(), []
        else:
            buf.append(line)
    if "".join(buf).strip():
        sections.append((heading, "\n".join(buf).strip()))
    return sections


def _list_items(text: str) -> list[str]:
    """Collect list items, folding indented continuation lines into the item."""
    items: list[str] = []
    for line in text.splitlines():
        m = _NUMBERED_RE.match(line) or _BULLET_RE.match(line)
        if m and not line.startswith("   "):
            items.append(m.group(1).strip())
        elif items and line.strip():
            items[-1] += " " + line.strip()
    return items


def parse_guide(text: str, path: str = "<string>") -> Guide:
    m = _FRONT_RE.match(text)
    if not m:
        raise GuideParseError(f"{path}: missing YAML front matter")
    meta = yaml.safe_load(m.group(1)) or {}
    body = m.group(2).strip()

    fields: dict[str, list[str]] = {"steps": [], "warnings": [], "seek_help": [], "red_flags": []}
    for heading, sec_text in split_sections(body):
        key = SECTION_ALIASES.get(heading.lower())
        if key:
            fields[key].extend(_list_items(sec_text))

    if not fields["steps"]:
        raise GuideParseError(f"{path}: guide has no numbered steps under '## Steps'")
    if "id" not in meta:
        raise GuideParseError(f"{path}: front matter needs an 'id'")

    try:
        return Guide(
            guide_id=meta.pop("id"),
            body_md=body,
            **fields,
            **meta,
        )
    except Exception as exc:  # pydantic error -> readable file-scoped message
        raise GuideParseError(f"{path}: {exc}") from exc


def load_guides(paths: list[Path]) -> list[Guide]:
    guides = [parse_guide(p.read_text(encoding="utf-8"), str(p)) for p in sorted(paths)]
    seen: set[str] = set()
    for g in guides:
        if g.guide_id in seen:
            raise GuideParseError(f"duplicate guide id {g.guide_id}")
        seen.add(g.guide_id)
    return guides
