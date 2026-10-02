import { Timer } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { clock, duration, speak, vibrate } from "../lib/format";
import { KEYS, usePersistent } from "../lib/store";
import type { ProtocolCard } from "../lib/types";

export interface TimerEntry {
  card_id: string;
  timer_id: string;
  label: string;
  at: number;
}

/** Card timers with timestamps for handover to medics (US-5.5, 5.6). */
export function CardTimers({ card }: { card: ProtocolCard }) {
  const [log, setLog] = usePersistent<TimerEntry[]>(KEYS.timerLog, []);
  const [now, setNow] = useState(Date.now());
  const alerted = useRef(new Map<string, number>());
  const mine = (log ?? []).filter((e) => e.card_id === card.card_id);
  const latest = (id: string) => mine.filter((e) => e.timer_id === id).at(-1);

  useEffect(() => {
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      for (const timer of card.timers) {
        const start = latest(timer.id);
        if (!start || !timer.interval_s) continue;
        const n = Math.floor((t - start.at) / (timer.interval_s * 1000));
        if (n > (alerted.current.get(timer.id) ?? 0)) {
          alerted.current.set(timer.id, n);
          vibrate([300, 150, 300]);
          speak(`${timer.label}: ${Math.round(((t - start.at) / 60000) * 10) / 10} minutes`);
        }
      }
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card, log]);

  if (!card.timers.length) return null;
  const start = (id: string, label: string) => {
    alerted.current.set(id, 0);
    setLog((prev) => [...(prev ?? []), { card_id: card.card_id, timer_id: id, label, at: Date.now() }]);
  };

  return (
    <section className="section card" aria-label="Timers">
      <h2 className="row">
        <Timer aria-hidden="true" /> Timers
      </h2>
      <div className="stack">
        {card.timers.map((t) => {
          const s = latest(t.id);
          return (
            <div key={t.id} className="row" style={{ justifyContent: "space-between" }}>
              <div>
                <strong>{t.label}</strong>
                <div className="muted small">
                  {s ? `at ${clock(s.at)}` : "not started"}
                  {t.interval_s ? ` · reminder every ${Math.round(t.interval_s / 60)} min` : ""}
                </div>
              </div>
              <div className="row">
                {s && <span className="big-readout" style={{ fontSize: "1.6rem" }}>{duration(now - s.at)}</span>}
                <button className="btn primary" onClick={() => start(t.id, t.label)}>
                  {s ? "Restart" : "Start"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
