import { History, Search as SearchIcon, Siren, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { SeverityBadge } from "../components/icons";
import { useT } from "../lib/i18n";
import { KEYS, usePersistent } from "../lib/store";
import type { Domain } from "../lib/types";
import { useLib } from "../state/data";

const DOMAINS: (Domain | null)[] = [null, "medical", "survival", "vehicle"];

/** Offline search (US-3.1..3.5). Red-flag cards are surfaced above results. */
export function SearchPage() {
  const lib = useLib();
  const t = useT();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const domain = (params.get("domain") as Domain | null) ?? null;
  const [recent, setRecent] = usePersistent<string[]>(KEYS.searches, []);

  const { hits, flags, ms } = useMemo(() => {
    const t0 = performance.now();
    const hits = q.trim().length >= 2 ? lib.search.search(q, { domain }) : [];
    const flags = q.trim().length >= 3 ? lib.redflag.detect(q) : [];
    return { hits, flags, ms: Math.round(performance.now() - t0) };
  }, [q, domain, lib]);

  const commit = (value = q) => {
    const v = value.trim();
    if (!v) return;
    setParams((p) => {
      p.set("q", v);
      return p;
    });
    setRecent((prev) => [v, ...(prev ?? []).filter((x) => x !== v)].slice(0, 10));
  };

  return (
    <div className="stack">
      <h1>{t("search")}</h1>
      <form
        className="search-box"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          commit();
        }}
      >
        <label htmlFor="q" className="sr-only">
          {t("search")}
        </label>
        <input id="q" type="search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("searchPlaceholder")} />
        <button className="btn primary" aria-label={t("search")}>
          <SearchIcon aria-hidden="true" />
        </button>
      </form>
      <div className="chips" role="group" aria-label="Filter by domain">
        {DOMAINS.map((d) => (
          <button
            key={d ?? "all"}
            className="chip"
            aria-pressed={domain === d}
            onClick={() =>
              setParams((p) => {
                if (d) p.set("domain", d);
                else p.delete("domain");
                return p;
              })
            }
          >
            {d ? t(d) : t("allDomains")}
          </button>
        ))}
      </div>

      {flags.map((f) => (
        <Link key={f.card.card_id} to={`/emergency/${f.card.card_id}`} className="card-tile" style={{ flexDirection: "row", alignItems: "center", minHeight: 64 }}>
          <Siren aria-hidden="true" /> Emergency card: {f.card.title}
        </Link>
      ))}

      {q.trim().length < 2 && (recent ?? []).length > 0 && (
        <section>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2 style={{ margin: 0 }}>Recent searches</h2>
            <button className="btn ghost" onClick={() => setRecent([])}>
              <X aria-hidden="true" /> Clear
            </button>
          </div>
          <ul className="list" style={{ marginTop: "0.5rem" }}>
            {(recent ?? []).map((r) => (
              <li key={r}>
                <button
                  className="item"
                  style={{ width: "100%", border: 0, font: "inherit", cursor: "pointer", textAlign: "left" }}
                  onClick={() => {
                    setQ(r);
                    commit(r);
                  }}
                >
                  <History size={18} aria-hidden="true" /> {r}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {q.trim().length >= 2 && (
        <p className="muted small" role="status">
          {hits.length} guides · {ms} ms · offline
        </p>
      )}
      <ul className="list" aria-label="Results">
        {hits.map((h) => (
          <li key={h.guide.guide_id}>
            <div className="item" style={{ flexDirection: "column", alignItems: "stretch" }}>
              <Link to={`/guide/${h.guide.guide_id}`} onClick={() => commit()} style={{ padding: 0, background: "none", minHeight: 0 }}>
                <span className="grow">
                  <strong>{h.guide.title}</strong>{" "}
                  <span className="muted small">
                    · {t(h.guide.domain)} · {h.guide.category}
                  </span>
                </span>
                {h.guide.severity !== "routine" && <SeverityBadge severity={h.guide.severity} />}
              </Link>
              {h.sections.slice(0, 2).map((s) => (
                <Link
                  key={s.chunk_id}
                  to={`/guide/${h.guide.guide_id}?section=${encodeURIComponent(s.section)}`}
                  onClick={() => commit()}
                  className="small"
                  style={{ padding: "0.25rem 0", background: "none", minHeight: 44, color: "var(--text-2)" }}
                >
                  <span>
                    <strong>{s.section}:</strong> {s.snippet}
                  </span>
                </Link>
              ))}
            </div>
          </li>
        ))}
      </ul>
      {q.trim().length >= 2 && hits.length === 0 && (
        <p>
          Nothing found. Try other words, or <Link to={`/ask?q=${encodeURIComponent(q)}`}>ask a question</Link>.
        </p>
      )}
    </div>
  );
}
