import { CircleAlert, Info, OctagonAlert, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Back } from "../../components/Layout";
import type { WarningLight } from "../../lib/types";
import { useLib } from "../../state/data";

const SEV: Record<WarningLight["severity"], { label: string; cls: string; Icon: typeof Info }> = {
  stop: { label: "Stop now", cls: "critical", Icon: OctagonAlert },
  careful: { label: "Drive carefully", cls: "urgent", Icon: TriangleAlert },
  "check-soon": { label: "Check soon", cls: "urgent", Icon: CircleAlert },
  info: { label: "Information", cls: "info", Icon: Info },
};

const COLOR: Record<WarningLight["color"], string> = { red: "Red", amber: "Amber", green: "Green", blue: "Blue" };

/** Dashboard warning-light reference with severity (US-9.3). */
export function WarningLightsPage() {
  const lib = useLib();
  const [q, setQ] = useState("");
  const lights = lib.warningLights().filter((l) => !q || `${l.name} ${l.meaning}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="stack">
      <Back to="/library/vehicle" label="Vehicle" />
      <h1>Warning lights</h1>
      <p className="muted">
        Red = stop safely as soon as possible. Amber = get it checked soon. Green / blue = information. Symbols vary by
        manufacturer - check your owner's manual.
      </p>
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter (oil, battery, engine…)" aria-label="Filter warning lights" />
      <ul className="list">
        {lights.map((l) => {
          const s = SEV[l.severity];
          return (
            <li key={l.id} className="item" style={{ alignItems: "flex-start" }}>
              <span className="grow stack" style={{ gap: "0.3rem" }}>
                <span className="row">
                  <strong>{l.name}</strong>
                  <span className={`badge ${s.cls}`}>
                    <s.Icon size={14} aria-hidden="true" /> {s.label}
                  </span>
                  <span className="muted small">{COLOR[l.color]} light</span>
                </span>
                <span>{l.meaning}</span>
                <span className="small">
                  <strong>What to do:</strong> {l.action}
                </span>
                {l.guide_id && lib.guides.get(l.guide_id) && (
                  <Link className="small" to={`/guide/${l.guide_id}`}>
                    Guide: {lib.guides.get(l.guide_id)!.title}
                  </Link>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
