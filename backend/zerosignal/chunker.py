"""Structure-aware chunking (US-15.3).

Text is split into blocks: numbered procedures, bullet lists and paragraphs.
Blocks are packed greedily up to ``target_tokens``. A numbered procedure is
atomic - it is never split, even if it overflows ``max_tokens``. Bullet lists
and paragraphs may be split (on items / sentences) when they alone exceed
``max_tokens``. Consecutive chunks of the same section share a short overlap
taken from the tail of the previous prose block (~10-15%).
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from .text import estimate_tokens

_NUM_RE = re.compile(r"^\s*\d+[.)]\s+")
_BULLET_RE = re.compile(r"^\s*[-*]\s+")
_SENT_RE = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"'(])")


@dataclass
class Block:
    kind: str  # "procedure" | "bullets" | "prose"
    text: str

    @property
    def tokens(self) -> int:
        return estimate_tokens(self.text)


def to_blocks(text: str) -> list[Block]:
    blocks: list[Block] = []
    buf: list[str] = []
    kind: str | None = None

    def flush():
        nonlocal buf, kind
        if buf and kind:
            blocks.append(Block(kind, "\n".join(buf).strip()))
        buf, kind = [], None

    for line in text.splitlines():
        if not line.strip():
            # Blank lines end prose, but a list may have blank lines between items.
            if kind == "prose":
                flush()
            continue
        if _NUM_RE.match(line):
            line_kind = "procedure"
        elif _BULLET_RE.match(line):
            line_kind = "bullets"
        elif kind in ("procedure", "bullets") and line.startswith((" ", "\t")):
            line_kind = kind  # indented continuation of a list item
        else:
            line_kind = "prose"
        if kind and line_kind != kind:
            flush()
        kind = line_kind
        buf.append(line)
    flush()
    return blocks


def _split_oversized(block: Block, max_tokens: int) -> list[Block]:
    if block.kind == "procedure" or block.tokens <= max_tokens:
        return [block]
    if block.kind == "bullets":
        units = [u for u in re.split(r"\n(?=\s*[-*]\s)", block.text) if u.strip()]
        joiner = "\n"
    else:
        units = [u for u in _SENT_RE.split(block.text) if u.strip()]
        joiner = " "
    out, cur = [], []
    for unit in units:
        if cur and estimate_tokens(joiner.join(cur + [unit])) > max_tokens:
            out.append(Block(block.kind, joiner.join(cur)))
            cur = []
        cur.append(unit)
    if cur:
        out.append(Block(block.kind, joiner.join(cur)))
    return out


def _overlap_tail(block: Block, budget: int) -> str:
    """Last sentences of a prose block, up to ``budget`` tokens."""
    if block.kind != "prose" or budget <= 0:
        return ""
    sentences = _SENT_RE.split(block.text)
    tail: list[str] = []
    for s in reversed(sentences):
        if estimate_tokens(" ".join([s, *tail])) > budget:
            break
        tail.insert(0, s)
    # Never repeat an entire block as "overlap".
    return " ".join(tail) if len(tail) < len(sentences) else ""


def chunk_text(
    text: str,
    target_tokens: int = 380,
    max_tokens: int = 520,
    overlap_ratio: float = 0.12,
    header: str = "",
) -> list[str]:
    blocks: list[Block] = []
    for b in to_blocks(text):
        blocks.extend(_split_oversized(b, max_tokens))

    header_tokens = estimate_tokens(header) if header else 0
    budget = target_tokens - header_tokens
    overlap_budget = int(target_tokens * overlap_ratio)

    chunks: list[list[str]] = []
    cur: list[str] = []
    cur_tokens = 0
    last_block: Block | None = None
    for b in blocks:
        if cur and cur_tokens + b.tokens > budget:
            chunks.append(cur)
            tail = _overlap_tail(last_block, overlap_budget) if last_block else ""
            cur = [tail] if tail else []
            cur_tokens = estimate_tokens(tail) if tail else 0
        cur.append(b.text)
        cur_tokens += b.tokens
        last_block = b
    if cur:
        chunks.append(cur)

    prefix = f"{header}\n" if header else ""
    return [prefix + "\n\n".join(parts) for parts in chunks]
