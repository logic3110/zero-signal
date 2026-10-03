import { BookOpen, ChevronLeft, GitBranch, RotateCcw } from "lucide-react";
import { useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { Back } from "../../components/Layout";
import { SourcesList } from "../../components/Sources";
import { useLib } from "../../state/data";

const SEVERITY_LABEL: Record<string, string> = {
  stop: "Stop - do not continue",
  "check-soon": "Get it checked soon",
  careful: "Drive carefully",
  info: "Information",
  red: "RED - Immediate",
  yellow: "YELLOW - Delayed",
  green: "GREEN - Minor",
  black: "BLACK - Expectant",
};

/** Runs a reviewed, deterministic decision tree (US-9.2, US-7.2). */
export function TreePage() {
  const { id } = useParams();
  const lib = useLib();
  const tree = lib.trees.find((t) => t.tree_id === id);
  const [path, setPath] = useState<string[]>(() => (tree ? [tree.start] : []));
  if (!tree) return <Navigate to="/tools" replace />;
  const nodes = new Map(tree.nodes.map((n) => [n.id, n]));
  const node = nodes.get(path[path.length - 1])!;
  const guide = node.guide_id ? lib.guides.get(node.guide_id) : undefined;
  const sev = node.severity ?? "info";

  return (
    <div className="stack">
      <Back to="/tools" label="Tools" />
      <h1 className="row">
        <GitBranch aria-hidden="true" /> {tree.title}
      </h1>
      <p className="muted">{tree.description}</p>
      {path.length > 1 && (
        <ol className="bullets small muted">
          {path.slice(0, -1).map((pid, i) => {
            const n = nodes.get(pid)!;
            const chosen = n.options.find((o) => o.next === path[i + 1]);
            return (
              <li key={i}>
                {n.text} <strong>{chosen?.label}</strong>
              </li>
            );
          })}
        </ol>
      )}
      {node.kind === "question" ? (
        <section className="card stack" aria-live="polite">
          <h2 style={{ fontSize: "1.3rem" }}>{node.text}</h2>
          {node.options.map((o) => (
            <button key={o.next + o.label} className="btn big block" style={{ justifyContent: "flex-start" }} onClick={() => setPath([...path, o.next])}>
              {o.label}
            </button>
          ))}
        </section>
      ) : (
        <section className={`card stack tree-result ${sev}`} aria-live="polite">
          <span className={`badge ${sev === "stop" || sev === "red" ? "critical" : sev === "check-soon" || sev === "careful" || sev === "yellow" ? "urgent" : "info"}`}>
            {SEVERITY_LABEL[sev] ?? sev}
          </span>
          <h2 style={{ fontSize: "1.3rem" }}>{node.text}</h2>
          {node.detail && <p>{node.detail}</p>}
          {guide && (
            <Link className="btn block" to={`/guide/${guide.guide_id}`}>
              <BookOpen aria-hidden="true" /> {guide.title}
            </Link>
          )}
        </section>
      )}
      <div className="row">
        {path.length > 1 && (
          <button className="btn" onClick={() => setPath(path.slice(0, -1))}>
            <ChevronLeft aria-hidden="true" /> Back
          </button>
        )}
        <button className="btn ghost" onClick={() => setPath([tree.start])}>
          <RotateCcw aria-hidden="true" /> Start again
        </button>
      </div>
      <SourcesList ids={tree.sources} reviewed={{ role: tree.reviewed_by, date: tree.reviewed_at }} />
    </div>
  );
}
