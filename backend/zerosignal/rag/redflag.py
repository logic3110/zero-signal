"""Red-flag detector (US-5.1). Runs BEFORE retrieval and the LLM so the
matching protocol card is on screen immediately.

It is deliberately simple and auditable: normalised phrase matching against
each card's curated ``trigger_terms`` (multilingual), tolerant to one typo in
longer words, scored by how specific the matched phrase is. The same
algorithm is mirrored in the web client (``web/src/lib/redflag.ts``).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from ..text import edit_distance, normalize, words


@dataclass
class RedFlagMatch:
    card_id: str
    title: str
    score: float
    matched: list[str] = field(default_factory=list)


FILLERS = frozenset(
    "is are was were has have had been being her his my our their its the a an very really so "
    "getting got just now badly suddenly".split()
)
MAX_GAP = 2


def _is_latin(s: str) -> bool:
    return all(ord(c) < 0x250 for c in s)


class RedFlagDetector:
    def __init__(self, cards: list[dict[str, Any]]):
        self.cards = cards
        self._terms: list[tuple[str, str, list[str], str]] = []  # (card_id, raw, tokens, normalized)
        for c in cards:
            for t in c["trigger_terms"]:
                n = normalize(t).strip()
                self._terms.append((c["card_id"], t, words(n), n))

    @staticmethod
    def _tok_eq(a: str, b: str) -> bool:
        return a == b or (len(a) >= 6 and edit_distance(a, b, 1) <= 1)

    @classmethod
    def _phrase_in(cls, tokens: list[str], qtokens: list[str]) -> bool:
        """Ordered token match. Up to ``MAX_GAP`` filler words may sit between
        phrase words ("throat *is* swelling", "smoke from *the* bonnet"); one
        edit is tolerated in words of 6+ characters."""
        for start in range(len(qtokens)):
            if not cls._tok_eq(tokens[0], qtokens[start]):
                continue
            j, k = 1, start + 1
            while j < len(tokens) and k < len(qtokens):
                if cls._tok_eq(tokens[j], qtokens[k]):
                    j += 1
                    k += 1
                    continue
                gap = 0
                while k < len(qtokens) and qtokens[k] in FILLERS and gap < MAX_GAP:
                    k += 1
                    gap += 1
                if gap == 0 or k >= len(qtokens) or not cls._tok_eq(tokens[j], qtokens[k]):
                    break
            if j == len(tokens):
                return True
        return False

    def detect(self, query: str, limit: int = 3) -> list[RedFlagMatch]:
        qn = normalize(query)
        qtokens = words(qn)
        scores: dict[str, RedFlagMatch] = {}
        for card_id, raw, tokens, n in self._terms:
            if not tokens:
                continue
            if _is_latin(n):
                hit = self._phrase_in(tokens, qtokens)
            else:
                hit = n in qn  # Indic scripts: substring match on normalised text
            if not hit:
                continue
            # Multi-word phrases are stronger evidence than single words.
            weight = 1.0 + 0.6 * (len(tokens) - 1) if _is_latin(n) else 1.5
            m = scores.setdefault(card_id, RedFlagMatch(card_id, "", 0.0))
            m.score += weight
            m.matched.append(raw)
        titles = {c["card_id"]: c["title"] for c in self.cards}
        out = []
        for m in scores.values():
            m.title = titles[m.card_id]
            out.append(m)
        out.sort(key=lambda m: (-m.score, m.card_id))
        return out[:limit]


_EMERGENCY_WORDS = re.compile(r"\b(emergency|dying|urgent|help me|sos|mayday)\b")


def sounds_urgent(query: str) -> bool:
    return bool(_EMERGENCY_WORDS.search(normalize(query)))
