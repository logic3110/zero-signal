import pytest

from zerosignal.rag.llm import ExtractiveBackend, LLMError
from zerosignal.rag.pipeline import AskPipeline, AskRequest
from zerosignal.rag.router import route
from zerosignal.rag.validator import validate_answer


# ------------------------------------------------------------------ search
@pytest.mark.parametrize(
    "query, guide",
    [
        ("car won't start clicking noise", "veh-dead-battery"),
        ("my friend is having fits", "med-seizures"),
        ("puncture", "veh-flat-tyre"),
        ("how to purify water", "sur-water"),
        ("check engine light flashing", "veh-warning-lights"),
        ("bleding wont stop", "med-severe-bleeding"),  # typo
        ("earthquake what to do", "sur-earthquake"),
    ],
)
def test_search_finds_expected_guide(searcher, query, guide):
    res = searcher.search(query, k=5)
    assert guide in [h.guide_id for h in res.hits[:3]]
    assert res.took_ms < 500  # NFR-3 hybrid search budget


def test_typo_correction_and_synonyms(searcher):
    plan = searcher.plan("bleding from the leg")
    assert plan.corrected == {"bleding": "bleeding"}
    assert "seizure" in searcher.plan("fits").expansions["fits"]


def test_short_words_are_not_miscorrected(searcher):
    assert searcher.plan("bake a cake").corrected == {}


def test_domain_filter(searcher):
    res = searcher.search("fire", k=8, domain="vehicle")
    assert res.hits and all(h.domain == "vehicle" for h in res.hits)


def test_patient_type_filter(searcher):
    res = searcher.search("cpr", k=8, patient_type="infant")
    assert res.hits and all(h.guide_id != "med-cpr-adult" for h in res.hits)


# ---------------------------------------------------------------- red flag
@pytest.mark.parametrize(
    "query, card",
    [
        ("he is not breathing", "pc-cpr"),
        ("bee sting and her throat is swelling", "pc-anaphylaxis"),
        ("smoke and flames from the bonnet", "pc-vehicle-fire"),
        ("snake bit my brother", "pc-snakebite"),
        ("सांप ने काटा", "pc-snakebite"),
        ("dil ka daura", "pc-heart-attack"),
        ("my son is having a seizuer", "pc-seizure"),  # typo tolerated
    ],
)
def test_redflag_detects(detector, query, card):
    assert card in [m.card_id for m in detector.detect(query)]


def test_specific_card_ranks_first(detector):
    assert detector.detect("baby not breathing")[0].card_id == "pc-cpr-infant"


@pytest.mark.parametrize("query", ["how do I make a fire", "how to tie a bowline", "change a flat tyre"])
def test_redflag_no_false_positive(detector, query):
    assert detector.detect(query) == []


# ------------------------------------------------------------------ router
def test_router_declines_out_of_scope():
    assert route("write a python function to sort a list").domain == "other"
    assert route("who won the election").domain == "other"
    assert route("my car battery is dead").domain == "vehicle"
    assert route("twisted my ankle").domain == "medical"


# --------------------------------------------------------------- validator
def test_validator_removes_unknown_citations_and_flags_uncited():
    raw = "Summary: Stop the bleeding [1]\nSteps:\n1. Press hard [1]\n2. Pray [9]\n3. Stay calm\nWarnings:\n- Do NOT remove it [2]"
    a = validate_answer(raw, {1: "press hard on the wound", 2: "do not remove embedded objects"})
    assert [s.text for s in a.steps] == ["Press hard", "Stay calm"]
    assert a.steps[1].flags == ["uncited"]
    assert a.removed[0]["text"].startswith("Pray")
    assert a.warnings[0].citations == [2]


def test_validator_strips_invented_doses():
    raw = "Steps:\n1. Give 500 mg paracetamol [1]\n2. Add 2 drops per litre [2]"
    a = validate_answer(raw, {1: "give simple pain relief", 2: "bleach: 2 drops per litre of clear water"})
    assert [s.text for s in a.steps] == ["Add 2 drops per litre"]
    assert "dose" in a.removed[0]["reason"]


def test_validator_not_in_library():
    assert validate_answer("NOT_IN_LIBRARY", {}).not_in_library


def test_validator_drops_bare_citation_lines():
    a = validate_answer("Summary: CPR is chest compressions. [1]\nSteps: [1]\n1. Push hard. [1]", {1: "x"})
    assert a.summary.text == "CPR is chest compressions."
    assert [s.text for s in a.steps] == ["Push hard."]


# ---------------------------------------------------------------- pipeline
async def _run(pipeline, **kw):
    return [e async for e in pipeline.run(AskRequest(**kw))]


async def test_pipeline_redflag_first_then_cited_answer(pipeline):
    events = await _run(pipeline, question="deep cut on leg bleeding heavily won't stop")
    types = [e["type"] for e in events]
    assert types[0] == "redflag"
    assert types.index("context") < types.index("token") < types.index("answer")
    ctx = next(e for e in events if e["type"] == "context")["passages"]
    ans = next(e for e in events if e["type"] == "answer")["answer"]
    ids = {p["n"] for p in ctx}
    assert ans["steps"] and all(set(s["citations"]) <= ids and s["citations"] for s in ans["steps"])
    assert ctx[0]["source"]["licence"]


async def test_pipeline_declines_out_of_scope(pipeline):
    types = [e["type"] for e in await _run(pipeline, question="write a python function to sort a list")]
    assert "declined" in types and "token" not in types


@pytest.mark.parametrize(
    "question",
    ["how can carbonmonooxide kill a human", "how can carbon oxide kill a human", "what to do in a tornado"],
)
async def test_pipeline_low_confidence_on_topic_is_not_declined(pipeline, question):
    # No domain vocabulary and weak retrieval, but not clearly off-topic:
    # "not in library", never the "we only answer..." decline.
    types = [e["type"] for e in await _run(pipeline, question=question)]
    assert "not_in_library" in types and "declined" not in types


async def test_pipeline_gate_blocks_generation(pipeline):
    events = await _run(pipeline, question="how to treat a sunburn on my dog")
    nil = next(e for e in events if e["type"] == "not_in_library")
    assert len(nil["closest"]) == 3
    assert "token" not in [e["type"] for e in events]


async def test_pipeline_followup_uses_history(pipeline):
    events = await _run(
        pipeline,
        question="what if it is a child?",
        history=[{"q": "how to do cpr", "a": "..."}],
    )
    ctx = next(e for e in events if e["type"] == "context")
    assert any(p["guide_id"] == "med-cpr-child-infant" for p in ctx["passages"])


class _BrokenLLM(ExtractiveBackend):
    name = "openai"

    async def stream(self, *a, **k):
        raise LLMError("server down")
        yield  # pragma: no cover


async def test_pipeline_falls_back_when_llm_fails(searcher, detector):
    p = AskPipeline(searcher, detector, _BrokenLLM())
    events = [e async for e in p.run(AskRequest(question="how to jump start a car"))]
    types = [e["type"] for e in events]
    assert "error" in types
    ans = next(e for e in events if e["type"] == "answer")
    assert ans["backend"] == "extractive" and ans["answer"]["steps"]


class _BlankLLM:
    name = "openai"

    async def stream(self, *a, **k):
        yield "   \n"


async def test_pipeline_falls_back_when_llm_answer_is_empty(searcher, detector):
    p = AskPipeline(searcher, detector, _BlankLLM())
    events = [e async for e in p.run(AskRequest(question="how to jump start a car"))]
    assert "error" in [e["type"] for e in events]
    ans = next(e for e in events if e["type"] == "answer")
    assert ans["backend"] == "extractive" and ans["answer"]["steps"]
