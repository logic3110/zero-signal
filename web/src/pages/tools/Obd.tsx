import { useState } from "react";
import { Back } from "../../components/Layout";
import { useLib } from "../../state/data";

const SAFE: Record<string, { label: string; cls: string }> = {
  yes: { label: "Usually safe to drive", cls: "ok" },
  caution: { label: "Drive with caution - get checked", cls: "urgent" },
  no: { label: "Do not drive", cls: "critical" },
};

/** Offline OBD-II generic code lookup (US-9.4). */
export function ObdPage() {
  const lib = useLib();
  const [q, setQ] = useState("");
  const code = q.trim().toUpperCase();
  const codes = lib.obdCodes();
  const results = code ? codes.filter((c) => c.code.startsWith(code) || c.meaning.toLowerCase().includes(q.toLowerCase())) : codes;
  return (
    <div className="stack">
      <Back to="/library/vehicle" label="Vehicle" />
      <h1>OBD-II codes</h1>
      <p className="muted small">
        Generic codes only (P0xxx, P2xxx, B, C, U). Manufacturer codes differ. A fault code points to a system - it is not a full
        diagnosis.
      </p>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Enter code, e.g. P0301" aria-label="OBD code" autoCapitalize="characters" />
      {code && results.length === 0 && <p>Code not in the offline table. First letter: P = powertrain, B = body, C = chassis, U = network.</p>}
      <ul className="list">
        {results.map((c) => (
          <li key={c.code} className="item" style={{ alignItems: "flex-start" }}>
            <span className="grow stack" style={{ gap: "0.25rem" }}>
              <span className="row">
                <strong style={{ fontFamily: "ui-monospace, monospace", fontSize: "1.1rem" }}>{c.code}</strong>
                <span className={`badge ${SAFE[c.safe_to_drive]?.cls ?? "info"}`}>{SAFE[c.safe_to_drive]?.label}</span>
              </span>
              <span>{c.meaning}</span>
              <span className="muted small">Likely causes: {c.causes}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
