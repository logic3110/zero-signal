// Client for the ZeroSignal API. Only Ask and pack updates use the network.
import type { Catalog, Domain, PatientType } from "./types";

export const API_BASE: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";

export interface AskBody {
  question: string;
  patient_type?: PatientType | null;
  domain?: Domain | null;
  vehicle?: Record<string, string> | null;
  history?: { q: string; a: string }[] | null;
  language?: string;
  style?: "normal" | "simpler" | "detail";
  allow_llm?: boolean;
}

export interface Passage {
  n: number;
  chunk_id: string;
  guide_id: string | null;
  title: string;
  section_path: string;
  text: string;
  source_id: string;
  source?: { publisher: string; title: string; licence: string } | null;
}

export interface AnswerLine {
  text: string;
  citations: number[];
  flags: string[];
}

export interface Answer {
  summary: AnswerLine | null;
  steps: AnswerLine[];
  warnings: AnswerLine[];
  help: AnswerLine[];
  removed: { text: string; reason: string }[];
}

export type AskEvent =
  | { type: "redflag"; cards: { card_id: string; title: string }[] }
  | { type: "route"; domain: string; confidence: number }
  | { type: "declined"; message: string }
  | { type: "not_in_library"; message: string; closest: { guide_id: string; title: string }[] }
  | { type: "context"; passages: Passage[] }
  | { type: "token"; text: string; replace?: boolean }
  | { type: "answer"; answer: Answer; backend: string }
  | { type: "error"; message: string }
  | { type: "done"; ms: number; ttft_ms?: number | null };

/** POST /api/ask and parse the Server-Sent Events stream. Abort with `signal`. */
export async function ask(base: string, body: AskBody, onEvent: (e: AskEvent) => void, signal: AbortSignal) {
  const res = await fetch(`${base}/api/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`Ask failed (${res.status})`);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const data = frame
        .split("\n")
        .filter((l) => l.startsWith("data: "))
        .map((l) => l.slice(6))
        .join("\n");
      if (data) onEvent(JSON.parse(data) as AskEvent);
    }
  }
}

export async function health(base: string, signal?: AbortSignal) {
  const res = await fetch(`${base}/api/health`, { signal });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as { status: string; llm: { backend: string; available: boolean } };
}

export async function fetchCatalog(base: string): Promise<Catalog> {
  for (const url of [`${base}/api/catalog`, "/packs/catalog.json"]) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) return (await res.json()) as Catalog;
    } catch {
      /* try next */
    }
  }
  throw new Error("Catalog unavailable - are you offline?");
}
