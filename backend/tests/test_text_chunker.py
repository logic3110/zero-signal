from zerosignal.chunker import chunk_text, to_blocks
from zerosignal.text import content_words, edit_distance, stem


def test_stem_plurals_and_suffixes():
    assert stem("earthquakes") == stem("earthquake")
    assert stem("injuries") == "injury"
    assert stem("bleeding") == "bleed"
    assert stem("glass") == "glass"
    assert stem("boxes") == "box"


def test_edit_distance_with_limit():
    assert edit_distance("bleding", "bleeding") == 1
    assert edit_distance("abc", "xyzuvw", limit=2) == 3


def test_content_words_drop_stopwords():
    assert content_words("How do I stop the bleeding?") == ["stop", "bleeding"]


def test_blocks_classify_lists_and_prose():
    kinds = [b.kind for b in to_blocks("Intro text.\n\n1. one\n2. two\n\n- a\n- b\n\nMore prose.")]
    assert kinds == ["prose", "procedure", "bullets", "prose"]


def test_numbered_procedure_is_never_split():
    steps = "\n".join(f"{i}. Do the thing number {i} carefully and completely." for i in range(1, 40))
    chunks = chunk_text("Some intro.\n\n" + steps + "\n\nOutro paragraph.", target_tokens=60, max_tokens=80)
    holding = [c for c in chunks if "1. Do the thing" in c]
    assert len(holding) == 1
    assert all(f"{i}. Do the thing" in holding[0] for i in range(1, 40))


def test_prose_is_split_with_overlap_and_header():
    prose = " ".join(f"Sentence number {i} talks about water safety." for i in range(60))
    chunks = chunk_text(prose, target_tokens=80, max_tokens=100, overlap_ratio=0.15, header="Water > Notes")
    assert len(chunks) > 2
    assert all(c.startswith("Water > Notes\n") for c in chunks)
    # Overlap: the tail of one chunk re-appears at the start of the next.
    first_tail = chunks[0].rsplit(". ", 1)[-1].strip(".")
    assert first_tail.split()[-1] in chunks[1]
