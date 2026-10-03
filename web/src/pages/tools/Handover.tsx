import { ClipboardList, Copy, Trash2 } from "lucide-react";
import { Back } from "../../components/Layout";
import type { TimerEntry } from "../../components/CardTimers";
import { clock } from "../../lib/format";
import { KEYS, usePersistent } from "../../lib/store";
import { useLib } from "../../state/data";

/** Handover summary for paramedics: what happened and when (US-5.6). */
export function HandoverPage() {
  const lib = useLib();
  const [log, setLog] = usePersistent<TimerEntry[]>(KEYS.timerLog, []);
  const entries = [...(log ?? [])].sort((a, b) => a.at - b.at);
  const text = entries
    .map((e) => `${clock(e.at)}  ${lib.cardById.get(e.card_id)?.title ?? e.card_id}: ${e.label}`)
    .join("\n");

  return (
    <div className="stack">
      <Back to="/tools" label="Tools" />
      <h1 className="row">
        <ClipboardList aria-hidden="true" /> Handover summary
      </h1>
      <p className="muted">Show or read this to paramedics. Times come from the timers on emergency cards.</p>
      {entries.length === 0 ? (
        <p>No events recorded yet. Start a timer on an emergency card (e.g. tourniquet applied, seizure started).</p>
      ) : (
        <>
          <table className="simple" style={{ fontSize: "1.1rem" }}>
            <tbody>
              {entries.map((e, i) => (
                <tr key={i}>
                  <td style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                    <strong>{clock(e.at)}</strong>
                  </td>
                  <td>
                    {e.label}
                    <div className="muted small">{lib.cardById.get(e.card_id)?.title}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row">
            <button className="btn" onClick={() => void navigator.clipboard?.writeText(text)}>
              <Copy aria-hidden="true" /> Copy
            </button>
            <button className="btn danger" onClick={() => confirm("Clear the event log?") && setLog([])}>
              <Trash2 aria-hidden="true" /> Clear log
            </button>
          </div>
        </>
      )}
    </div>
  );
}
