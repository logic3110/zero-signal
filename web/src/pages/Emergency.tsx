import { BookOpen, ChevronRight, ClipboardList, Compass, Flashlight, MapPin, MessageSquareText, Volume2 } from "lucide-react";
import { useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { Back } from "../components/Layout";
import { CallButton } from "../components/CallButton";
import { CardTimers } from "../components/CardTimers";
import { CprMetronome } from "../components/CprMetronome";
import { CardIcon } from "../components/icons";
import { SourcesList } from "../components/Sources";
import { useWakeLock } from "../components/wakelock";
import { speak } from "../lib/format";
import { useT } from "../lib/i18n";
import type { Domain } from "../lib/types";
import { useLib } from "../state/data";

const DOMAINS: { id: Domain; key: "medical" | "survival" | "vehicle" }[] = [
  { id: "medical", key: "medical" },
  { id: "survival", key: "survival" },
  { id: "vehicle", key: "vehicle" },
];

/** Protocol card grid - 1 tap from home, 2 taps to any card (US-5.2, NFR-13). */
export function EmergencyGrid() {
  const lib = useLib();
  const t = useT();
  return (
    <div className="stack">
      <h1>{t("emergency")}</h1>
      <CallButton numberKey="general" label={t("call")} />
      {DOMAINS.map((d) => (
        <section key={d.id} className="section" aria-labelledby={`h-${d.id}`}>
          <h2 id={`h-${d.id}`}>{t(d.key)}</h2>
          <div className="card-grid">
            {lib.cards
              .filter((c) => c.domain === d.id)
              .map((c) => (
                <Link key={c.card_id} to={`/emergency/${c.card_id}`} className="card-tile">
                  <CardIcon name={c.icon} />
                  <span>
                    {c.title}
                    {c.subtitle && <div className="muted">{c.subtitle}</div>}
                  </span>
                </Link>
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}

const TOOL_LINKS: Record<string, { to: string; label: string; Icon: typeof MapPin }> = {
  "sos-message": { to: "/tools/sos", label: "Send SOS message", Icon: MessageSquareText },
  "my-location": { to: "/tools/location", label: "My location", Icon: MapPin },
  flashlight: { to: "/tools/flashlight", label: "SOS light", Icon: Flashlight },
  compass: { to: "/tools/compass", label: "Compass", Icon: Compass },
};

export function ProtocolCardPage() {
  const { id } = useParams();
  const lib = useLib();
  const t = useT();
  const card = id ? lib.cardById.get(id) : undefined;
  const [current, setCurrent] = useState<number | null>(null);
  useWakeLock(true);
  if (!card) return <Navigate to="/emergency" replace />;

  const read = (i: number) => {
    setCurrent(i);
    const s = card.steps[i];
    speak(`Step ${i + 1}. ${s.text}${s.detail ? ". " + s.detail : ""}`);
  };

  return (
    <article className="stack protocol">
      <Back to="/emergency" label="All emergency cards" />
      <header className="row">
        <CardIcon name={card.icon} size={40} />
        <div>
          <h1 style={{ margin: 0 }}>{card.title}</h1>
          {card.subtitle && <p className="muted" style={{ margin: 0 }}>{card.subtitle}</p>}
        </div>
      </header>

      {card.call_first && <CallButton numberKey={card.emergency_number_key} label={t("call")} />}

      <ol className="protocol-steps" aria-label={t("steps")}>
        {card.steps.map((s, i) => (
          <li key={i} className={current === i ? "current" : ""}>
            {s.text}
            {s.detail && <span className="detail">{s.detail}</span>}
          </li>
        ))}
      </ol>

      <div className="row">
        <button className="btn" onClick={() => read(current === null ? 0 : Math.min(card.steps.length - 1, current + 1))}>
          <Volume2 aria-hidden="true" /> {current === null ? "Read aloud" : "Next step"}
        </button>
        {current !== null && (
          <button className="btn ghost" onClick={() => read(current)}>
            Repeat
          </button>
        )}
      </div>

      {card.do_not.length > 0 && (
        <div className="donot" role="note">
          <strong>{t("doNot")}</strong>
          <ul>
            {card.do_not.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </div>
      )}

      {card.tools.includes("cpr-metronome") && <CprMetronome />}
      <CardTimers card={card} />
      {card.timers.length > 0 && (
        <Link to="/tools/handover" className="btn block">
          <ClipboardList aria-hidden="true" /> Handover summary for medics
        </Link>
      )}

      {!card.call_first && <CallButton numberKey={card.emergency_number_key} label={t("call")} />}

      {card.tools.some((x) => TOOL_LINKS[x]) && (
        <div className="grid">
          {card.tools
            .filter((x) => TOOL_LINKS[x])
            .map((x) => {
              const { to, label, Icon } = TOOL_LINKS[x];
              return (
                <Link key={x} to={to} className="tile">
                  <Icon aria-hidden="true" /> {label}
                </Link>
              );
            })}
        </div>
      )}

      {card.related_guides.length > 0 && (
        <section className="section">
          <h2>More detail</h2>
          <ul className="list">
            {card.related_guides
              .map((g) => lib.guides.get(g))
              .filter(Boolean)
              .map((g) => (
                <li key={g!.guide_id}>
                  <Link to={`/guide/${g!.guide_id}`}>
                    <BookOpen size={20} aria-hidden="true" />
                    <span className="grow">{g!.title}</span>
                    <ChevronRight size={18} aria-hidden="true" />
                  </Link>
                </li>
              ))}
          </ul>
        </section>
      )}
      <SourcesList ids={card.sources} reviewed={{ role: card.reviewed_by, date: card.reviewed_at }} />
    </article>
  );
}
