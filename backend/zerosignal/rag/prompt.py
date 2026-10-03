"""Prompt builder (Section 7.5)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

SYSTEM_PROMPT = """You are ZeroSignal, an offline assistant for emergency first aid, survival and roadside vehicle repair.

RULES
1. Answer ONLY from the numbered CONTEXT passages. Do not use your own knowledge.
2. Reply exactly NOT_IN_LIBRARY only if no CONTEXT passage is relevant to the question.
3. The Summary and every step, warning and help line MUST end with the id of the passage that supports it, like [2]. Use only ids that appear in CONTEXT.
4. Never invent or state medication doses, drug amounts or dosing schedules.
5. Never contradict an emergency protocol card. If life is at risk, the first step is to call emergency services.
6. Keep the language simple and calm. Reply in {language}.
7. Keep the whole answer under {max_words} words.
8. If the question asks what something is, why, or when, answer it in the Summary using the CONTEXT, then add only the sections the CONTEXT supports. Omit a section rather than invent content for it.

FORMAT (these headings, in this order, no preamble; nothing after a heading's colon except the Summary text):
Summary: <one or two lines answering the question or describing the situation> [n]
Steps:
1. <action> [n]
2. <action> [n]
Warnings:
- Do NOT <thing> [n]
Get help:
- <when to get professional help> [n]"""

STYLE_HINTS = {
    "normal": "",
    "simpler": "Use very short sentences and at most 5 steps.",
    "detail": "Include more detail in each step where the CONTEXT supports it.",
}


@dataclass
class ContextPassage:
    n: int
    chunk_id: str
    guide_id: str | None
    title: str
    section_path: str
    text: str
    source_id: str
    pack_id: str

    def to_dict(self) -> dict[str, Any]:
        return self.__dict__.copy()


def build_messages(
    question: str,
    passages: list[ContextPassage],
    *,
    patient_type: str | None = None,
    vehicle: dict[str, Any] | None = None,
    history: list[dict[str, str]] | None = None,
    language: str = "English",
    style: str = "normal",
    max_tokens: int = 350,
) -> list[dict[str, str]]:
    system = SYSTEM_PROMPT.format(language=language, max_words=int(max_tokens * 0.7))
    hint = STYLE_HINTS.get(style, "")
    if hint:
        system += "\n" + hint

    ctx = "\n\n".join(f"[{p.n}] ({p.title} — {p.section_path})\n{p.text}" for p in passages)
    facts = []
    if patient_type:
        facts.append(f"Patient: {patient_type}")
    if vehicle:
        facts.append("Vehicle: " + ", ".join(f"{k}={v}" for k, v in vehicle.items() if v))

    messages = [{"role": "system", "content": system}]
    for turn in (history or [])[-2:]:
        messages.append({"role": "user", "content": turn["q"]})
        messages.append({"role": "assistant", "content": turn["a"]})
    user = f"CONTEXT\n{ctx}\n\n"
    if facts:
        user += "\n".join(facts) + "\n\n"
    user += f"QUESTION: {question}"
    messages.append({"role": "user", "content": user})
    return messages
