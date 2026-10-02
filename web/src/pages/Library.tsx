import { BookOpen, Car, ChevronRight, GitBranch, Lightbulb, ScanSearch, Stethoscope, Tent } from "lucide-react";
import { Link, Navigate, useParams } from "react-router-dom";
import { Back } from "../components/Layout";
import { SeverityBadge } from "../components/icons";
import { useT } from "../lib/i18n";
import type { Domain } from "../lib/types";
import { useLib } from "../state/data";

const META: Record<Domain, { Icon: typeof Car; key: "medical" | "survival" | "vehicle" }> = {
  medical: { Icon: Stethoscope, key: "medical" },
  survival: { Icon: Tent, key: "survival" },
  vehicle: { Icon: Car, key: "vehicle" },
};

export function LibraryPage() {
  const lib = useLib();
  const t = useT();
  return (
    <div className="stack">
      <h1>{t("library")}</h1>
      <ul className="list">
        {(Object.keys(META) as Domain[]).map((d) => {
          const { Icon, key } = META[d];
          const cats = lib.categories(d);
          return (
            <li key={d}>
              <Link to={`/library/${d}`}>
                <Icon aria-hidden="true" />
                <span className="grow">
                  <strong>{t(key)}</strong>
                  <div className="muted small">
                    {cats.reduce((n, c) => n + c.guides.length, 0)} guides · {cats.map((c) => c.name).join(", ")}
                  </div>
                </span>
                <ChevronRight aria-hidden="true" />
              </Link>
            </li>
          );
        })}
      </ul>
      <Link to="/search" className="btn block">
        Search all guides
      </Link>
    </div>
  );
}

export function DomainPage() {
  const { domain } = useParams();
  const lib = useLib();
  const t = useT();
  if (!domain || !(domain in META)) return <Navigate to="/library" replace />;
  const d = domain as Domain;
  const trees = lib.trees.filter((x) => x.domain === d);

  return (
    <div className="stack">
      <Back to="/library" label={t("library")} />
      <h1>{t(META[d].key)}</h1>
      {(trees.length > 0 || d === "vehicle") && (
        <section className="section">
          <h2>Step-by-step tools</h2>
          <div className="grid">
            {trees.map((tr) => (
              <Link key={tr.tree_id} to={`/tools/tree/${tr.tree_id}`} className="tile">
                <GitBranch aria-hidden="true" /> {tr.title}
              </Link>
            ))}
            {d === "vehicle" && (
              <>
                <Link to="/tools/warning-lights" className="tile">
                  <Lightbulb aria-hidden="true" /> Warning lights
                </Link>
                <Link to="/tools/obd" className="tile">
                  <ScanSearch aria-hidden="true" /> OBD-II codes
                </Link>
              </>
            )}
          </div>
        </section>
      )}
      {lib.categories(d).map((cat) => (
        <section key={cat.name} className="section" aria-labelledby={`c-${cat.name}`}>
          <h2 id={`c-${cat.name}`}>{cat.name}</h2>
          <ul className="list">
            {cat.guides.map((g) => (
              <li key={g.guide_id}>
                <Link to={`/guide/${g.guide_id}`}>
                  <BookOpen size={20} aria-hidden="true" />
                  <span className="grow">
                    {g.title}
                    <div className="muted small">{g.summary}</div>
                  </span>
                  {g.severity !== "routine" && <SeverityBadge severity={g.severity} />}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
