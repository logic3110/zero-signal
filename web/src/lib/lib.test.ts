import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { plusCode } from "./pluscode";
import { RedFlagDetector } from "./redflag";
import { LocalSearch } from "./search";
import { editDistance, stem, words } from "./text";
import type { PackBundle } from "./types";

const load = (id: string) => JSON.parse(readFileSync(`public/packs/${id}.json`, "utf8")) as PackBundle;
const packs = ["medical-core", "survival-core", "vehicle-core"].map(load);
const guides = packs.flatMap((p) => p.guides);
const chunks = packs.flatMap((p) => p.chunks);
const cards = packs.flatMap((p) => p.protocol_cards);
const synonyms = packs[0].synonyms;

describe("text", () => {
  it("stems like the backend", () => {
    expect(stem("earthquakes")).toBe(stem("earthquake"));
    expect(stem("injuries")).toBe("injury");
    expect(stem("bleeding")).toBe("bleed");
  });
  it("counts a transposition as one edit", () => {
    expect(editDistance("seizuer", "seizure")).toBe(1);
  });
  it("keeps Devanagari words intact", () => {
    expect(words("सांप ने काटा")).toEqual(["सांप", "ने", "काटा"]);
  });
});

describe("red-flag detector (parity with backend tests)", () => {
  const d = new RedFlagDetector(cards);
  it.each([
    ["he is not breathing", "pc-cpr"],
    ["bee sting and her throat is swelling", "pc-anaphylaxis"],
    ["smoke and flames from the bonnet", "pc-vehicle-fire"],
    ["snake bit my brother", "pc-snakebite"],
    ["सांप ने काटा", "pc-snakebite"],
    ["dil ka daura", "pc-heart-attack"],
    ["my son is having a seizuer", "pc-seizure"],
  ])("%s -> %s", (q, card) => {
    expect(d.detect(q).map((m) => m.card.card_id)).toContain(card);
  });
  it("ranks the specific card first", () => {
    expect(d.detect("baby not breathing")[0].card.card_id).toBe("pc-cpr-infant");
  });
  it.each(["how do I make a fire", "how to tie a bowline", "change a flat tyre"])("no false positive: %s", (q) => {
    expect(d.detect(q)).toEqual([]);
  });
});

describe("local search", () => {
  const s = new LocalSearch(guides, chunks, synonyms);
  it.each([
    ["car won't start clicking noise", "veh-dead-battery"],
    ["my friend is having fits", "med-seizures"],
    ["puncture", "veh-flat-tyre"],
    ["how to purify water", "sur-water"],
    ["bleding wont stop", "med-severe-bleeding"],
    ["earthquake what to do", "sur-earthquake"],
  ])("%s -> %s", (q, id) => {
    expect(s.search(q).slice(0, 3).map((h) => h.guide.guide_id)).toContain(id);
  });
  it("filters by domain", () => {
    const hits = s.search("fire", { domain: "vehicle" });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.guide.domain === "vehicle")).toBe(true);
  });
  it("is fast enough for search-as-you-type", () => {
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) s.search("severe bleeding from leg");
    expect((performance.now() - t0) / 20).toBeLessThan(50);
  });
});

describe("plus codes", () => {
  it("encodes the reference example", () => {
    // Open Location Code test vector: 20.3701135, 2.78223535 -> 7FG49QCJ+2V
    expect(plusCode(20.3701135, 2.78223535)).toBe("7FG49QCJ+2V");
  });
});
