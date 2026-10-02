import { useLib } from "../state/data";

/** Source list with publisher, title, licence (US-2.2, US-16.2). */
export function SourcesList({ ids, reviewed }: { ids: string[]; reviewed?: { role?: string | null; date?: string | null } }) {
  const lib = useLib();
  return (
    <section className="section" aria-labelledby="sources-h">
      <h2 id="sources-h">Sources</h2>
      <ul className="bullets small">
        {ids.map((id) => {
          const s = lib.sources.get(id);
          if (!s) return <li key={id}>{id}</li>;
          return (
            <li key={id}>
              <strong>{s.publisher}</strong> - {s.title}
              {s.version ? ` (${s.version})` : ""}. <span className="muted">Licence: {s.licence}</span>
            </li>
          );
        })}
      </ul>
      {reviewed && (
        <p className="small" style={{ marginTop: "0.75rem" }}>
          {reviewed.date ? (
            <span className="badge ok">
              Last reviewed {reviewed.date} by {reviewed.role}
            </span>
          ) : (
            <span className="badge urgent">Pending expert review</span>
          )}
        </p>
      )}
    </section>
  );
}
