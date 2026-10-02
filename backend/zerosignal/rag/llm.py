"""LLM runtime abstraction (US-12.5).

Backends:
  * ``extractive`` - no model at all. Assembles the answer deterministically
    from the retrieved passages (steps, warnings, help), in the same cited
    format a model would produce. Always available; used when no model is
    installed or battery-saver forbids inference.
  * ``openai`` - any OpenAI-compatible *local* server: llama.cpp
    ``llama-server`` (GGUF, mmap), Ollama, LM Studio, MLC. No cloud endpoints
    are configured by default (NG4).
"""

from __future__ import annotations

import asyncio
import json
import re
from collections.abc import AsyncIterator
from typing import Protocol

import httpx

from .prompt import ContextPassage


class LLMError(RuntimeError):
    pass


class LLMBackend(Protocol):
    name: str

    async def available(self) -> bool: ...

    def stream(
        self, messages: list[dict[str, str]], passages: list[ContextPassage], max_tokens: int, style: str
    ) -> AsyncIterator[str]: ...


_NUM_RE = re.compile(r"^\s*\d+[.)]\s+(.*)$")
_BUL_RE = re.compile(r"^\s*[-*]\s+(.*)$")


def _body(p: ContextPassage) -> str:
    # First line of every chunk is the "Title > Section" header.
    lines = p.text.split("\n", 1)
    return lines[1] if len(lines) > 1 and " > " in lines[0] else p.text


def _items(text: str, pattern: re.Pattern) -> list[str]:
    out: list[str] = []
    for line in text.splitlines():
        m = pattern.match(line)
        if m:
            out.append(m.group(1).strip())
        elif out and line.startswith((" ", "\t")) and line.strip():
            out[-1] += " " + line.strip()
    return out


class ExtractiveBackend:
    name = "extractive"

    async def available(self) -> bool:
        return True

    def compose(self, passages: list[ContextPassage], style: str = "normal") -> str:
        if not passages:
            return "NOT_IN_LIBRARY"
        primary = passages[0].guide_id

        def ordered(section: str) -> list[ContextPassage]:
            hits = [p for p in passages if p.section_path.endswith(f"> {section}")]
            return sorted(hits, key=lambda p: (p.guide_id != primary, p.n))

        summary_p = next((p for p in ordered("Summary") if p.guide_id == primary), None)
        if summary_p:
            summary = f"{_body(summary_p).strip()} [{summary_p.n}]"
        else:
            first = re.split(r"(?<=[.!?])\s", _body(passages[0]).strip())[0]
            summary = f"{first} [{passages[0].n}]"

        max_steps = 5 if style == "simpler" else (12 if style == "detail" else 8)
        steps: list[str] = []
        for p in ordered("Steps"):
            if p.guide_id != primary and steps:
                break  # don't splice two procedures together
            for item in _items(_body(p), _NUM_RE):
                if item not in (s.rsplit(" [", 1)[0] for s in steps):
                    steps.append(f"{item} [{p.n}]")
        if not steps:
            for p in passages[:3]:
                for item in _items(_body(p), _NUM_RE) or [re.split(r"(?<=[.!?])\s", _body(p).strip())[0]]:
                    steps.append(f"{item} [{p.n}]")
        steps = steps[:max_steps]

        max_side = 2 if style == "simpler" else 4
        warnings = [f"{w} [{p.n}]" for p in ordered("Warnings") if p.guide_id == primary for w in _items(_body(p), _BUL_RE)]
        helps = [f"{h} [{p.n}]" for p in ordered("When to get help") if p.guide_id == primary for h in _items(_body(p), _BUL_RE)]

        out = [f"Summary: {summary}", "Steps:"]
        out += [f"{i}. {s}" for i, s in enumerate(steps, 1)]
        if warnings:
            out.append("Warnings:")
            out += [f"- {w}" for w in warnings[:max_side]]
        if helps:
            out.append("Get help:")
            out += [f"- {h}" for h in helps[:max_side]]
        return "\n".join(out)

    async def stream(self, messages, passages, max_tokens, style="normal") -> AsyncIterator[str]:
        text = self.compose(passages, style)
        # Emit word-by-word so the client exercises the same streaming path.
        for piece in re.findall(r"\S+\s*|\n", text):
            yield piece
            await asyncio.sleep(0)


class OpenAICompatBackend:
    """Streams from an OpenAI-compatible chat endpoint: local (llama.cpp server,
    Ollama, LM Studio) or hosted (OpenRouter, with an API key)."""

    name = "openai"

    def __init__(self, base_url: str, model: str, timeout: float = 120.0, api_key: str | None = None):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout = timeout
        self.headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}

    async def available(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=2.0) as client:
                r = await client.get(f"{self.base_url}/v1/models", headers=self.headers)
                return r.status_code == 200
        except httpx.HTTPError:
            return False

    async def stream(self, messages, passages, max_tokens, style="normal") -> AsyncIterator[str]:
        payload = {
            "model": self.model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": 0.1,
            "top_p": 0.9,
            "stream": True,
        }
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                async with client.stream(
                    "POST", f"{self.base_url}/v1/chat/completions", json=payload, headers=self.headers
                ) as resp:
                    if resp.status_code != 200:
                        body = (await resp.aread()).decode(errors="ignore")[:300]
                        raise LLMError(f"LLM server returned {resp.status_code}: {body}")
                    async for line in resp.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        data = line[5:].strip()
                        if data == "[DONE]":
                            break
                        try:
                            delta = json.loads(data)["choices"][0].get("delta", {}).get("content")
                        except (KeyError, IndexError, json.JSONDecodeError):
                            continue
                        if delta:
                            yield delta
        except httpx.HTTPError as exc:
            raise LLMError(f"LLM server unreachable: {exc}") from exc


class AnthropicBackend:
    """Claude via the Anthropic API - a development stand-in until a local
    model is available. Note: this sends the question and retrieved passages
    to a cloud API, which the on-device product (NG4) will not do."""

    name = "anthropic"

    def __init__(self, model: str = "claude-opus-5-5", effort: str = "low", max_tokens: int = 4000):
        import anthropic

        self._anthropic = anthropic
        self.client = anthropic.AsyncAnthropic()  # ANTHROPIC_API_KEY or an `ant auth login` profile
        self.model = model
        self.effort = effort
        # Thinking is always on for this model and counts toward max_tokens, so
        # the answer length is capped by the prompt, not by this ceiling.
        self.max_tokens = max_tokens

    async def available(self) -> bool:
        try:
            await self.client.with_options(timeout=5.0, max_retries=0).models.retrieve(self.model)
            return True
        except (self._anthropic.APIError, TypeError):  # TypeError: no credentials configured
            return False

    async def stream(self, messages, passages, max_tokens, style="normal") -> AsyncIterator[str]:
        a = self._anthropic
        system = "\n\n".join(m["content"] for m in messages if m["role"] == "system")
        convo = [m for m in messages if m["role"] != "system"]
        try:
            async with self.client.beta.messages.stream(
                model=self.model,
                max_tokens=self.max_tokens,
                system=system,
                messages=convo,
                output_config={"effort": self.effort},
                # On a safety decline, the API re-runs the request on a fallback model.
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
            ) as stream:
                async for text in stream.text_stream:
                    yield text
                final = await stream.get_final_message()
        except a.AuthenticationError as exc:
            raise LLMError("Anthropic API key missing or invalid") from exc
        except a.RateLimitError as exc:
            raise LLMError("Anthropic API rate limit reached") from exc
        except a.APIStatusError as exc:
            raise LLMError(f"Anthropic API error {exc.status_code}: {exc.message}") from exc
        except a.APIConnectionError as exc:
            raise LLMError("Anthropic API unreachable") from exc
        except TypeError as exc:  # raised by the SDK when no credentials are configured
            raise LLMError("No Anthropic API key configured (set ANTHROPIC_API_KEY in backend/.env)") from exc
        if final.stop_reason == "refusal":
            raise LLMError("the model declined this request")


def make_llm(settings) -> LLMBackend:
    if settings.llm_backend == "openai":
        return OpenAICompatBackend(settings.llm_base_url, settings.llm_model, api_key=settings.llm_api_key or None)
    if settings.llm_backend == "anthropic":
        return AnthropicBackend(settings.anthropic_model, settings.anthropic_effort)
    return ExtractiveBackend()
