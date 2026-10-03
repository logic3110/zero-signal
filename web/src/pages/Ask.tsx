import { BatteryWarning, BookOpen, MessageCircleQuestion, RotateCcw, Share2, Siren, Square, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ask, type Answer, type AnswerLine, type AskEvent, type Passage } from "../lib/api";
import { useT } from "../lib/i18n";
import type { GuideHit } from "../lib/search";
import { KEYS, usePersistent } from "../lib/store";
import type { PatientType, ProtocolCard } from "../lib/types";
import { useLib } from "../state/data";
import { useSettings } from "../state/settings";

const PATIENTS: PatientType[] = ["adult", "child", "infant", "pregnant", "elderly"];
type Style = "normal" | "simpler" | "detail";

interface Turn {
  question: string;
  cards: ProtocolCard[];
  passages: Passage[];
  raw: string;
  answer: Answer | null;
  backend?: string;
  status: "running" | "done" | "stopped" | "declined" | "not_in_library" | "offline" | "error";
  message?: string;
  closest?: { guide_id: string; title: string }[];
  fallback?: GuideHit[];
  ttft?: number | null;
  ms?: number;
}

function useBatteryLow() {
  const [low, setLow] = useState(false);
  useEffect(() => {
    const nav = navigator as Navigator & { getBattery?: () => Promise<{ level: number; charging: boolean }> };
    nav.getBattery?.().then((b) => setLow(b.level < 0.2 && !b.charging)).catch(() => {});
  }, []);
  return low;
}

/** Ask (E4): red-flag card first, then a streamed, cited answer from the API. */
export function AskPage() {
  const lib = useLib();
  const t = useT();
  const [settings] = useSettings();
  const [params] = useSearchParams();
  const [ack, setAck] = usePersistent<boolean>(KEYS.disclaimer, false);
  const [q, setQ] = useState(params.get("q") ?? "");
  const [patient, setPatient] = useState<PatientType | null>(null);
  const [style, setStyle] = useState<Style>("normal");
  const [turns, setTurns] = useState<Turn[]>([]);
  const abort = useRef<AbortController | null>(null);
  const batteryLow = useBatteryLow();
  const running = turns.at(-1)?.status === "running";

  useEffect(() => () => abort.current?.abort(), []);

  const patch = (fn: (t: Turn) => Turn) => setTurns((ts) => [...ts.slice(0, -1), fn(ts[ts.length - 1])]);

  const run = async (question: string, s: Style = style, followUp = true) => {
    if (!question.trim() || running) return;
    // Red-flag fast path: runs locally before any network call (US-5.1, S-2).
    const cards = lib.redflag.detect(question).map((m) => m.card);
    const history = followUp
      ? turns
          .filter((x) => x.status === "done" && x.raw)
          .slice(-1)
          .map((x) => ({ q: x.question, a: x.raw }))
      : [];
    setTurns((ts) => [...(followUp ? ts : []), { question, cards, passages: [], raw: "", answer: null, status: "running" }]);
    setQ("");
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      await ask(
        settings.apiBase,
        { question, patient_type: patient, style: s, history, language: settings.language, allow_llm: !settings.batterySaver },
        (e: AskEvent) => {
          switch (e.type) {
            case "redflag":
              patch((x) => {
                const extra = e.cards.map((c) => lib.cardById.get(c.card_id)).filter((c): c is ProtocolCard => !!c);
                const ids = new Set(x.cards.map((c) => c.card_id));
                return { ...x, cards: [...x.cards, ...extra.filter((c) => !ids.has(c.card_id))] };
              });
              break;
            case "context":
              patch((x) => ({ ...x, passages: e.passages }));
              break;
            case "token":
              patch((x) => ({ ...x, raw: e.replace ? e.text : x.raw + e.text }));
              break;
            case "answer":
              patch((x) => ({ ...x, answer: e.answer, backend: e.backend }));
              break;
            case "declined":
              patch((x) => ({ ...x, status: "declined", message: e.message }));
              break;
            case "not_in_library":
              patch((x) => ({ ...x, status: "not_in_library", message: e.message, closest: e.closest, answer: null }));
              break;
            case "error":
              patch((x) => ({ ...x, message: e.message }));
              break;
            case "done":
              patch((x) => ({ ...x, status: x.status === "running" ? "done" : x.status, ttft: e.ttft_ms, ms: e.ms }));
              break;
          }
        },
        ctrl.signal,
      );
      patch((x) => (x.status === "running" ? { ...x, status: "done" } : x));
    } catch (err) {
      if (ctrl.signal.aborted) {
        patch((x) => ({ ...x, status: "stopped" }));
        return;
      }
      // Offline or server unreachable: the library still answers (G1, R2).
      patch((x) => ({
        ...x,
        status: "offline",
        message: err instanceof Error ? err.message : String(err),
        fallback: lib.search.search(question, { patientType: patient, limit: 5 }),
      }));
    }
  };

  if (!ack) {
    return (
      <div className="stack">
        <h1>{t("ask")}</h1>
        <div className="notice warn" role="alert">
          <TriangleAlert aria-hidden="true" />
          <div>
            <p>{t("disclaimer")}</p>
            <p className="small">Answers are generated only from the offline library, with a citation for every step.</p>
            <label className="check">
              <input type="checkbox" onChange={(e) => setAck(e.target.checked)} /> I understand
            </label>
          </div>
        </div>
      </div>
    );
  }

  if (settings.batterySaver) {
    return (
      <div className="stack">
        <h1>{t("ask")}</h1>
        <div className="notice warn">
          <BatteryWarning aria-hidden="true" />
          <div>
            Battery saver is on, so Ask is turned off. The library, search, emergency cards and tools still work.
            <div className="row" style={{ marginTop: "0.75rem" }}>
              <Link className="btn" to="/search">
                Search the library
              </Link>
              <Link className="btn ghost" to="/settings">
                Settings
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      <h1>{t("ask")}</h1>
      {batteryLow && (
        <div className="notice warn">
          <BatteryWarning aria-hidden="true" /> Battery is below 20%. Consider using the library and emergency cards instead.
        </div>
      )}

      {turns.map((turn, i) => (
        <TurnView key={i} turn={turn} />
      ))}

      <form
        className="stack card"
        onSubmit={(e) => {
          e.preventDefault();
          void run(q);
        }}
      >
        <label htmlFor="ask-q" className="field">
          {turns.length ? "Follow-up question" : "Your question"}
          <textarea
            id="ask-q"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={turns.length ? "e.g. what if it is a child?" : t("askPlaceholder")}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void run(q);
              }
            }}
          />
        </label>
        <div className="chips" role="group" aria-label="Who is the patient?">
          {PATIENTS.map((p) => (
            <button type="button" key={p} className="chip" aria-pressed={patient === p} onClick={() => setPatient(patient === p ? null : p)}>
              {p[0].toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
        <div className="row">
          {running ? (
            <button type="button" className="btn primary block big" onClick={() => abort.current?.abort()}>
              <Square aria-hidden="true" /> {t("stop")}
            </button>
          ) : (
            <button className="btn primary block big" disabled={!q.trim()}>
              <MessageCircleQuestion aria-hidden="true" /> {t("ask")}
            </button>
          )}
        </div>
        {turns.length > 0 && !running && (
          <div className="row">
            <span className="muted small">Last answer:</span>
            {(["simpler", "detail"] as Style[]).map((s) => (
              <button
                type="button"
                key={s}
                className="chip"
                aria-pressed={style === s}
                onClick={() => {
                  setStyle(s);
                  void run(turns.at(-1)!.question, s, false);
                }}
              >
                {s === "simpler" ? "Simpler" : "More detail"}
              </button>
            ))}
            <button type="button" className="btn ghost" onClick={() => setTurns([])}>
              <RotateCcw aria-hidden="true" /> New question
            </button>
          </div>
        )}
      </form>
    </div>
  );
}

function Cite({ n, passages }: { n: number; passages: Passage[] }) {
  const p = passages.find((x) => x.n === n);
  if (!p?.guide_id) return <span className="cite">{n}</span>;
  const section = p.section_path.split(" > ").pop() ?? "";
  return (
    <Link className="cite" to={`/guide/${p.guide_id}?section=${encodeURIComponent(section)}`} aria-label={`Source ${n}: ${p.title}, ${section}`}>
      {n}
    </Link>
  );
}

function Line({ line, passages }: { line: AnswerLine; passages: Passage[] }) {
  return (
    <>
      {line.text}
      {line.citations.map((c) => (
        <Cite key={c} n={c} passages={passages} />
      ))}
      {line.flags.includes("uncited") && <span className="flag"> ⚠ no source</span>}
    </>
  );
}

function TurnView({ turn }: { turn: Turn }) {
  const t = useT();
  const a = turn.answer;
  const share = async () => {
    const text = `${turn.question}\n\n${turn.raw}\n\n- ZeroSignal (offline library). ${t("disclaimer")}`;
    if (navigator.share) await navigator.share({ title: "ZeroSignal answer", text }).catch(() => {});
    else await navigator.clipboard?.writeText(text);
  };

  return (
    <section className="stack answer" aria-live="polite" aria-busy={turn.status === "running"}>
      <p style={{ fontWeight: 700, fontSize: "1.1rem", margin: 0 }}>“{turn.question}”</p>

      {turn.cards.map((c) => (
        <Link key={c.card_id} to={`/emergency/${c.card_id}`} className="card-tile" style={{ flexDirection: "row", alignItems: "center", minHeight: 72 }}>
          <Siren aria-hidden="true" />
          <span>
            {c.title}
            <div className="muted">Open emergency card now</div>
          </span>
        </Link>
      ))}

      {turn.status === "declined" && <div className="notice">{turn.message}</div>}

      {turn.status === "not_in_library" && (
        <div className="notice warn">
          <TriangleAlert aria-hidden="true" />
          <div>
            <strong>{t("notInLibrary")}</strong>
            {turn.closest && turn.closest.length > 0 && (
              <>
                <p className="small">{t("closestGuides")}:</p>
                <ul className="bullets">
                  {turn.closest.map((g) => (
                    <li key={g.guide_id}>
                      <Link to={`/guide/${g.guide_id}`}>{g.title}</Link>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      )}

      {turn.status === "offline" && (
        <div className="notice warn">
          <TriangleAlert aria-hidden="true" />
          <div>
            <strong>AI answers are unavailable right now</strong> (offline or the ZeroSignal server is not reachable). The library still
            works - best matches:
            <ul className="bullets">
              {(turn.fallback ?? []).map((h) => (
                <li key={h.guide.guide_id}>
                  <Link to={`/guide/${h.guide.guide_id}`}>{h.guide.title}</Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {a ? (
        <div className="card stack">
          {a.summary && (
            <p style={{ margin: 0, fontWeight: 600 }}>
              <Line line={a.summary} passages={turn.passages} />
            </p>
          )}
          {a.steps.length > 0 && (
            <ol className="guide-steps">
              {a.steps.map((s, i) => (
                <li key={i}>
                  <Line line={s} passages={turn.passages} />
                </li>
              ))}
            </ol>
          )}
          {a.warnings.length > 0 && (
            <div className="donot">
              <strong>{t("warnings")}</strong>
              <ul>
                {a.warnings.map((w, i) => (
                  <li key={i}>
                    <Line line={w} passages={turn.passages} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {a.help.length > 0 && (
            <div>
              <strong>{t("seekHelp")}</strong>
              <ul className="bullets">
                {a.help.map((h, i) => (
                  <li key={i}>
                    <Line line={h} passages={turn.passages} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {a.removed.length > 0 && (
            <p className="muted small">
              {a.removed.length} line(s) were removed because they were not supported by the cited library passages.
            </p>
          )}
          <div className="row muted small" style={{ justifyContent: "space-between" }}>
            <span>
              {turn.backend === "extractive" ? "Assembled directly from library passages (no AI model)" : "Generated from library passages"}
              {turn.ms ? ` · ${(turn.ms / 1000).toFixed(1)} s` : ""}
            </span>
            <button className="btn ghost" onClick={() => void share()} aria-label="Share or copy answer">
              <Share2 size={18} aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : (
        (turn.status === "running" || turn.status === "stopped") &&
        (turn.raw ? (
          <div className="card streaming">{turn.raw}</div>
        ) : (
          turn.status === "running" && <p className="muted">Searching the library…</p>
        ))
      )}
      {turn.status === "stopped" && <p className="muted small">Stopped. Sources are still available below.</p>}
      {turn.message && turn.status === "done" && <p className="muted small">Note: {turn.message}</p>}

      {turn.passages.length > 0 && (
        <details open={turn.status === "stopped"}>
          <summary className="btn ghost">
            <BookOpen size={18} aria-hidden="true" /> {t("sources")} ({turn.passages.length})
          </summary>
          <ol className="bullets small">
            {turn.passages.map((p) => (
              <li key={p.n} value={p.n}>
                {p.guide_id ? (
                  <Link to={`/guide/${p.guide_id}?section=${encodeURIComponent(p.section_path.split(" > ").pop() ?? "")}`}>
                    {p.section_path}
                  </Link>
                ) : (
                  p.section_path
                )}
                {p.source && (
                  <span className="muted">
                    {" "}
                    - {p.source.publisher}; {p.source.licence}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
