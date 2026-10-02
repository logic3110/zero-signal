// Red-flag detector - same algorithm as backend/zerosignal/rag/redflag.py.
// Runs locally before anything else so the protocol card appears instantly,
// with or without a network.
import { editDistance, normalize, words } from "./text";
import type { ProtocolCard } from "./types";

export interface RedFlagMatch {
  card: ProtocolCard;
  score: number;
  matched: string[];
}

const FILLERS = new Set(
  "is are was were has have had been being her his my our their its the a an very really so getting got just now badly suddenly".split(" "),
);
const MAX_GAP = 2;

const isLatin = (s: string) => [...s].every((c) => c.codePointAt(0)! < 0x250);
const tokEq = (a: string, b: string) => a === b || (a.length >= 6 && editDistance(a, b, 1) <= 1);

function phraseIn(tokens: string[], q: string[]): boolean {
  for (let start = 0; start < q.length; start++) {
    if (!tokEq(tokens[0], q[start])) continue;
    let j = 1;
    let k = start + 1;
    while (j < tokens.length && k < q.length) {
      if (tokEq(tokens[j], q[k])) {
        j++;
        k++;
        continue;
      }
      let gap = 0;
      while (k < q.length && FILLERS.has(q[k]) && gap < MAX_GAP) {
        k++;
        gap++;
      }
      if (gap === 0 || k >= q.length || !tokEq(tokens[j], q[k])) break;
    }
    if (j === tokens.length) return true;
  }
  return false;
}

export class RedFlagDetector {
  private terms: { card: ProtocolCard; raw: string; tokens: string[]; norm: string }[] = [];

  constructor(cards: ProtocolCard[]) {
    for (const card of cards) {
      for (const raw of card.trigger_terms) {
        const norm = normalize(raw).trim();
        this.terms.push({ card, raw, tokens: words(norm), norm });
      }
    }
  }

  detect(query: string, limit = 3): RedFlagMatch[] {
    const qn = normalize(query);
    const qt = words(qn);
    const scores = new Map<string, RedFlagMatch>();
    for (const t of this.terms) {
      if (!t.tokens.length) continue;
      const latin = isLatin(t.norm);
      if (!(latin ? phraseIn(t.tokens, qt) : qn.includes(t.norm))) continue;
      const weight = latin ? 1 + 0.6 * (t.tokens.length - 1) : 1.5;
      const m = scores.get(t.card.card_id) ?? { card: t.card, score: 0, matched: [] };
      m.score += weight;
      m.matched.push(t.raw);
      scores.set(t.card.card_id, m);
    }
    return [...scores.values()]
      .sort((a, b) => b.score - a.score || a.card.card_id.localeCompare(b.card.card_id))
      .slice(0, limit);
  }
}
