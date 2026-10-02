"""zs-eval: automated quality metrics per build (US-17.1, 17.2, 17.5).

    zs-eval --packs dist/ --gold content/eval/gold.yaml [--report out.json] [--ci]

Gold item::

    - id: med-001
      kind: answer | out_of_scope | not_in_library | emergency
      question: "..."
      expected_guides: [med-severe-bleeding]      # answer / emergency
      expected_card: pc-severe-bleeding           # emergency (optional)
      patient_type: child                         # optional

Metrics:
  recall@5 / MRR           expected guide among top-5 retrieved guides
  citation_validity        cited ids that exist in the context (target 100%)
  faithfulness (proxy)     answer lines whose content words are mostly found
                           in the cited passage (expert judgement still needed)
  refusal_rate             out_of_scope -> declined, not_in_library -> gated
  redflag_recall           emergency queries that surface the expected card
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

import yaml

from .embeddings import get_embedder
from .pack.reader import load_packs
from .rag.llm import make_llm
from .rag.pipeline import AskPipeline, AskRequest
from .rag.redflag import RedFlagDetector
from .rag.search import HybridSearcher
from .settings import Settings
from .text import content_words, stem

THRESHOLDS = {
    "recall@5": 0.90,
    "citation_validity": 1.0,
    "faithfulness": 0.95,
    "refusal_rate": 0.95,
    "redflag_recall": 0.99,
}


def _supported(line: str, passage: str) -> bool:
    words = {stem(w) for w in content_words(line)}
    if not words:
        return True
    hay = {stem(w) for w in content_words(passage)}
    return len(words & hay) / len(words) >= 0.7


async def evaluate(pipeline: AskPipeline, gold: list[dict]) -> dict:
    searcher, detector = pipeline.searcher, pipeline.detector
    rr, hits5, n_ret = 0.0, 0, 0
    refusals, n_ref = 0, 0
    rf_hits, n_rf = 0, 0
    cites_ok = cites_total = 0
    faithful = lines_total = 0
    failures: list[dict] = []

    for item in gold:
        kind = item.get("kind", "answer")
        q = item["question"]
        if kind in ("answer", "emergency") and item.get("expected_guides"):
            n_ret += 1
            res = searcher.search(q, k=10, patient_type=item.get("patient_type"))
            guides = list(dict.fromkeys(h.guide_id for h in res.hits if h.guide_id))
            rank = next((i for i, g in enumerate(guides) if g in item["expected_guides"]), None)
            if rank is not None:
                rr += 1 / (rank + 1)
                hits5 += rank < 5
            if rank is None or rank >= 5:
                failures.append({"id": item["id"], "metric": "recall@5", "got": guides[:5]})

        if kind == "emergency":
            n_rf += 1
            cards = [m.card_id for m in detector.detect(q)]
            expected = item.get("expected_card")
            if (expected and expected in cards) or (not expected and cards):
                rf_hits += 1
            else:
                failures.append({"id": item["id"], "metric": "redflag", "got": cards})

        events = [ev async for ev in pipeline.run(AskRequest(question=q, patient_type=item.get("patient_type")))]
        types = {e["type"] for e in events}
        if kind in ("out_of_scope", "not_in_library"):
            n_ref += 1
            ok = ("declined" in types) if kind == "out_of_scope" else ({"declined", "not_in_library"} & types)
            if ok:
                refusals += 1
            else:
                failures.append({"id": item["id"], "metric": "refusal", "got": sorted(types)})
            continue

        ctx = next((e for e in events if e["type"] == "context"), None)
        ans = next((e for e in events if e["type"] == "answer"), None)
        if ctx and ans:
            passages = {p["n"]: p["text"] for p in ctx["passages"]}
            a = ans["answer"]
            removed = len(a["removed"])
            for line in a["steps"] + a["warnings"] + a["help"]:
                lines_total += 1
                cites_total += len(line["citations"]) or 1
                cites_ok += sum(1 for c in line["citations"] if c in passages)
                support = " ".join(passages.get(c, "") for c in line["citations"])
                faithful += _supported(line["text"], support)
            cites_total += removed  # removed lines count as invalid citations
        elif kind == "answer":
            failures.append({"id": item["id"], "metric": "answered", "got": sorted(types)})

    def ratio(a, b):
        return round(a / b, 4) if b else None

    return {
        "items": len(gold),
        "metrics": {
            "recall@5": ratio(hits5, n_ret),
            "mrr": ratio(rr, n_ret),
            "citation_validity": ratio(cites_ok, cites_total),
            "faithfulness": ratio(faithful, lines_total),
            "refusal_rate": ratio(refusals, n_ref),
            "redflag_recall": ratio(rf_hits, n_rf),
        },
        "thresholds": THRESHOLDS,
        "failures": failures,
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="zs-eval", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--packs", type=Path, required=True)
    ap.add_argument("--gold", type=Path, required=True)
    ap.add_argument("--report", type=Path)
    ap.add_argument("--ci", action="store_true", help="exit 1 if any metric is below threshold")
    args = ap.parse_args(argv)

    s = Settings()
    embedder = get_embedder(s.embedding_model_id, s.embedding_dim)
    packs = load_packs(args.packs, s.embedding_model_id, s.embedding_dim)
    llm = make_llm(s)
    pipeline = AskPipeline(
        HybridSearcher(packs, embedder),
        RedFlagDetector([c for p in packs for c in p.cards()]),
        llm,
        confidence_threshold=s.confidence_threshold,
        max_tokens=s.max_output_tokens,
    )
    gold = yaml.safe_load(args.gold.read_text(encoding="utf-8"))["items"]
    report = asyncio.run(evaluate(pipeline, gold))
    report["backend"] = llm.name
    if args.report:
        args.report.write_text(json.dumps(report, indent=2))

    print(f"backend={llm.name} items={report['items']}")
    failed = False
    for name, value in report["metrics"].items():
        th = THRESHOLDS.get(name)
        bad = th is not None and value is not None and value < th
        failed |= bad
        print(f"  {name:18s} {value if value is not None else '-':>8}  {'target ' + str(th) if th else ''} {'FAIL' if bad else ''}")
    for f in report["failures"][:25]:
        print(f"  ! {f['id']}: {f['metric']} -> {f['got']}")
    return 1 if (failed and args.ci) else 0


if __name__ == "__main__":
    sys.exit(main())
