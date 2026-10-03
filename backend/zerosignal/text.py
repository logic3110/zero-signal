"""Small, dependency-free text utilities shared by build and run time."""

from __future__ import annotations

import re
import unicodedata

_WORD_RE = re.compile(r"[\w']+", re.UNICODE)

STOPWORDS = frozenset(
    """
    a an and are as at be been but by can could do does did for from had has
    have how i if in into is it its me my of on or our should so than that the
    their them then there these they this to too was we were what when where
    which who why will with would you your yours he she his her him us am
    get got just do dont don't im i'm what's whats any some very really please
    help need want tell know about now make making made keep keeps keeping happen happened
    happening going goes thing things like also still one
    """.split()
)


# People words carry no topical signal for coverage scoring ("my brother").
PERSON_WORDS = frozenset(
    """
    brother sister friend friends mother father mom mum dad son daughter husband wife man woman
    guy someone somebody person people grandma grandpa grandmother grandfather uncle aunt cousin
    colleague neighbour neighbor
    """.split()
)


def normalize(text: str) -> str:
    """Lowercase, strip accents/diacritics (but keep non-Latin scripts)."""
    text = unicodedata.normalize("NFKC", text).lower()
    # Remove combining marks only for Latin text so Devanagari matras survive.
    out = []
    for ch in unicodedata.normalize("NFD", text):
        if unicodedata.category(ch) == "Mn" and not _is_indic_mark(ch):
            continue
        out.append(ch)
    return unicodedata.normalize("NFC", "".join(out)).replace("’", "'")


def _is_indic_mark(ch: str) -> bool:
    return 0x0900 <= ord(ch) <= 0x0DFF


def words(text: str) -> list[str]:
    return [w.strip("'") for w in _WORD_RE.findall(normalize(text)) if w.strip("'")]


def content_words(text: str) -> list[str]:
    return [w for w in words(text) if w not in STOPWORDS and len(w) > 1]


def estimate_tokens(text: str) -> int:
    """Rough sub-word token estimate (~1.3 tokens per word) without a tokenizer."""
    n = len(words(text))
    return max(1, round(n * 1.3)) if text.strip() else 0


def stem(word: str) -> str:
    """Very light English suffix stripping (plural/-ing/-ed/-ly), used for
    coverage scoring and embedding features. Mirrored in web/src/lib/text.ts."""
    if len(word) <= 3:
        return word
    if word.endswith("ies") and len(word) > 4:
        return word[:-3] + "y"
    if word.endswith(("sses", "xes", "zes", "ches", "shes")):
        return word[:-2]
    if word.endswith("s") and not word.endswith(("ss", "us", "is")):
        return word[:-1]
    for suffix in ("ing", "edly", "ed", "ly"):
        if len(word) > len(suffix) + 3 and word.endswith(suffix):
            return word[: -len(suffix)]
    return word


def edit_distance(a: str, b: str, limit: int = 3) -> int:
    """Damerau-Levenshtein (optimal string alignment) distance with an
    early-exit limit; a swap of adjacent letters ("seizuer") costs 1."""
    if abs(len(a) - len(b)) > limit:
        return limit + 1
    prev2: list[int] = []
    prev = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        cur = [i]
        for j in range(1, len(b) + 1):
            cost = a[i - 1] != b[j - 1]
            d = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
            if i > 1 and j > 1 and a[i - 1] == b[j - 2] and a[i - 2] == b[j - 1]:
                d = min(d, prev2[j - 2] + 1)
            cur.append(d)
        if min(cur) > limit:
            return limit + 1
        prev2, prev = prev, cur
    return prev[-1]


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", normalize(text)).strip("-")
