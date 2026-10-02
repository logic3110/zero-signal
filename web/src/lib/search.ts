// Local, offline keyword search over pack chunks (US-3.1, 3.3, 3.4): BM25-style
// ranking (MiniSearch), stemming, fuzzy + prefix matching for typos, and the
// curated synonym table for lay terms. The API adds vector search for Ask.
import MiniSearch, { type SearchResult } from "minisearch";
import { STOPWORDS, contentWords, normalize, stem, words } from "./text";
import type { Chunk, Domain, Guide, PatientType } from "./types";

export interface GuideHit {
  guide: Guide;
  score: number;
  sections: { chunk_id: string; section: string; snippet: string }[];
}

interface Doc {
  id: string;
  title: string;
  section: string;
  text: string;
  keywords: string;
  guide_id: string;
  domain: Domain;
  patient_type: string;
}

const processTerm = (term: string) => {
  const t = normalize(term);
  if (STOPWORDS.has(t) || t.length < 2) return null;
  return stem(t);
};

export class LocalSearch {
  private index: MiniSearch<Doc>;
  private guides: Map<string, Guide>;
  private chunks: Map<string, Chunk>;
  /** lay term -> canonical phrases */
  private synonyms = new Map<string, string[]>();

  constructor(guides: Guide[], chunks: Chunk[], synonyms: { term: string; canonical: string }[]) {
    this.guides = new Map(guides.map((g) => [g.guide_id, g]));
    this.chunks = new Map(chunks.map((c) => [c.chunk_id, c]));
    for (const s of synonyms) {
      const list = this.synonyms.get(s.term) ?? [];
      if (!list.includes(s.canonical)) list.push(s.canonical);
      this.synonyms.set(s.term, list);
    }
    this.index = new MiniSearch<Doc>({
      fields: ["title", "section", "text", "keywords"],
      storeFields: ["guide_id", "domain", "patient_type", "section"],
      tokenize: (text) => words(text),
      processTerm,
      searchOptions: { boost: { title: 4, keywords: 2.5, section: 1.5 }, combineWith: "OR" },
    });
    const docs: Doc[] = [];
    for (const c of chunks) {
      if (!c.guide_id) continue;
      const g = this.guides.get(c.guide_id);
      if (!g) continue;
      docs.push({
        id: c.chunk_id,
        title: g.title,
        section: c.section_path.split(" > ").pop() ?? "",
        text: c.text,
        keywords: this.keywordsFor(c, g),
        guide_id: g.guide_id,
        domain: g.domain,
        patient_type: c.patient_type,
      });
    }
    this.index.addAll(docs);
  }

  /** Index-time synonym expansion, as in the backend writer. */
  private keywordsFor(c: Chunk, g: Guide): string {
    const hay = ` ${words(`${c.text} ${g.title} ${g.tags.join(" ")}`).join(" ")} `;
    const extra = new Set(g.tags);
    for (const [term, canon] of this.synonyms) {
      if (canon.some((cn) => hay.includes(` ${words(cn).join(" ")} `))) extra.add(term);
    }
    return [...extra].join(" ");
  }

  expand(query: string): string[] {
    const q = ` ${words(query).join(" ")} `;
    const out = new Set<string>();
    for (const [term, canon] of this.synonyms) {
      if (q.includes(` ${term} `)) canon.forEach((c) => out.add(c));
    }
    return [...out];
  }

  search(
    query: string,
    opts: { domain?: Domain | null; patientType?: PatientType | null; limit?: number } = {},
  ): GuideHit[] {
    const terms = contentWords(query);
    if (!terms.length) return [];
    const expanded = [query, ...this.expand(query)].join(" ");
    const last = processTerm(terms[terms.length - 1]);
    const results: SearchResult[] = this.index.search(expanded, {
      fuzzy: (term) => (term.length > 4 ? 0.2 : false),
      prefix: (term) => term === last && term.length >= 3,
      filter: (r) =>
        (!opts.domain || r.domain === opts.domain) &&
        (!opts.patientType || String(r.patient_type).split(" ").includes(opts.patientType)),
    });
    const byGuide = new Map<string, GuideHit>();
    for (const r of results) {
      const g = this.guides.get(r.guide_id as string);
      const c = this.chunks.get(r.id as string);
      if (!g || !c) continue;
      const hit = byGuide.get(g.guide_id) ?? { guide: g, score: 0, sections: [] };
      // Sum with diminishing weight so one long guide doesn't swamp the list.
      hit.score += r.score / (1 + hit.sections.length);
      if (hit.sections.length < 3) {
        hit.sections.push({ chunk_id: c.chunk_id, section: String(r.section), snippet: snippet(c.text, terms) });
      }
      byGuide.set(g.guide_id, hit);
    }
    const ranked = [...byGuide.values()].sort((a, b) => b.score - a.score);
    // Drop the long tail of weak OR-matches (a single shared common word).
    const floor = (ranked[0]?.score ?? 0) * 0.2;
    return ranked.filter((h) => h.score >= floor).slice(0, opts.limit ?? 20);
  }
}

export function snippet(text: string, terms: string[], width = 160): string {
  const body = text.includes("\n") && text.split("\n")[0].includes(" > ") ? text.slice(text.indexOf("\n") + 1) : text;
  const flat = body.replace(/\s+/g, " ").trim();
  const lower = flat.toLowerCase();
  const stems = terms.map((t) => stem(t));
  let pos = -1;
  for (const s of stems) {
    pos = lower.indexOf(s);
    if (pos >= 0) break;
  }
  const start = Math.max(0, pos - width / 3);
  const cut = flat.slice(start, start + width);
  return (start > 0 ? "…" : "") + cut + (start + width < flat.length ? "…" : "");
}
