// Mirrors backend/zerosignal/text.py so web search and the red-flag detector
// behave like the server.

export const STOPWORDS = new Set(
  `a an and are as at be been but by can could do does did for from had has
  have how i if in into is it its me my of on or our should so than that the
  their them then there these they this to too was we were what when where
  which who why will with would you your yours he she his her him us am
  get got just do dont don't im i'm what's whats any some very really please
  help need want tell know about now make making made keep keeps keeping happen happened
  happening going goes thing things like also still one`.split(/\s+/),
);

export function isIndicMark(ch: string): boolean {
  const c = ch.codePointAt(0)!;
  return c >= 0x0900 && c <= 0x0dff;
}

export function normalize(text: string): string {
  const lowered = text.normalize("NFKC").toLowerCase();
  let out = "";
  for (const ch of lowered.normalize("NFD")) {
    if (/\p{Mn}/u.test(ch) && !isIndicMark(ch)) continue;
    out += ch;
  }
  return out.normalize("NFC").replace(/’/g, "'");
}

const WORD_RE = /[\p{L}\p{N}\p{M}_']+/gu;

export function words(text: string): string[] {
  return (normalize(text).match(WORD_RE) ?? []).map((w) => w.replace(/^'+|'+$/g, "")).filter(Boolean);
}

export function contentWords(text: string): string[] {
  return words(text).filter((w) => !STOPWORDS.has(w) && w.length > 1);
}

export function stem(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith("ies") && word.length > 4) return word.slice(0, -3) + "y";
  if (/(sses|xes|zes|ches|shes)$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("s") && !/(ss|us|is)$/.test(word)) return word.slice(0, -1);
  for (const suffix of ["ing", "edly", "ed", "ly"]) {
    if (word.length > suffix.length + 3 && word.endsWith(suffix)) return word.slice(0, -suffix.length);
  }
  return word;
}

/** Damerau-Levenshtein (OSA) distance with an early-exit limit. */
export function editDistance(a: string, b: string, limit = 3): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, prev2[j - 2] + 1);
      cur.push(d);
    }
    if (Math.min(...cur) > limit) return limit + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length];
}

export function slug(text: string): string {
  return normalize(text).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
