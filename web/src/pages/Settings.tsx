import { BatteryCharging, Database, Info, RotateCcw, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { health } from "../lib/api";
import { useT } from "../lib/i18n";
import { KEYS, save, wipePersonalData } from "../lib/store";
import { useLib } from "../state/data";
import { useSettings, type Settings } from "../state/settings";

/** Settings, privacy and accessibility (E14). */
export function SettingsPage() {
  const t = useT();
  const lib = useLib();
  const nav = useNavigate();
  const [s, update] = useSettings();
  const [server, setServer] = useState<string>("checking…");
  const [wiped, setWiped] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    health(s.apiBase, ctrl.signal)
      .then((h) => setServer(`reachable · answer engine: ${h.llm.backend}${h.llm.available ? "" : " (model offline)"}`))
      .catch(() => setServer("not reachable - Ask falls back to library search"));
    return () => ctrl.abort();
  }, [s.apiBase]);

  const sel = <K extends keyof Settings>(key: K, label: string, options: [Settings[K], string][]) => (
    <label className="field">
      {label}
      <select value={String(s[key])} onChange={(e) => update({ [key]: options.find(([v]) => String(v) === e.target.value)![0] } as Partial<Settings>)}>
        {options.map(([v, l]) => (
          <option key={String(v)} value={String(v)}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="stack">
      <h1>{t("settings")}</h1>

      <section className="card stack">
        <h2>Display</h2>
        {sel("theme", "Theme", [
          ["system", "Match device"],
          ["sunlight", "Sunlight (high-contrast light)"],
          ["night", "Night / Field (dark red)"],
        ])}
        {sel("textScale", "Text size", [
          [1, "Normal"],
          [1.15, "Large"],
          [1.3, "Larger"],
          [1.5, "Largest"],
        ])}
      </section>

      <section className="card stack">
        <h2>Region and language</h2>
        {sel(
          "country",
          "Country (emergency numbers)",
          Object.entries(lib.numbers()).map(([code, c]) => [code, c.name]),
        )}
        {sel("units", "Units", [
          ["metric", "Metric (m, L, °C)"],
          ["imperial", "Imperial (ft, gal)"],
        ])}
        {sel("language", "Language", [
          ["en", "English"],
          ["hi", "हिन्दी (Hindi) - interface only, partial"],
        ])}
      </section>

      <section className="card stack">
        <h2 className="row">
          <BatteryCharging aria-hidden="true" /> Battery saver
        </h2>
        <label className="check">
          <input type="checkbox" checked={s.batterySaver} onChange={(e) => update({ batterySaver: e.target.checked })} />
          Turn off Ask (AI). Library, search, emergency cards and tools keep working.
        </label>
      </section>

      <section className="card stack">
        <h2 className="row">
          <Database aria-hidden="true" /> Knowledge packs and AI
        </h2>
        <p className="small" style={{ margin: 0 }}>
          {lib.packs.length} packs installed · {lib.guideList.length} guides · {lib.cards.length} emergency cards
        </p>
        <Link className="btn" to="/settings/packs">
          Manage packs and AI models
        </Link>
        <label className="field">
          ZeroSignal server for Ask (leave empty for this site)
          <input value={s.apiBase} placeholder="http://192.168.1.10:8000" onChange={(e) => update({ apiBase: e.target.value.trim().replace(/\/$/, "") })} />
        </label>
        <p className="muted small" style={{ margin: 0 }}>
          Server: {server}
        </p>
      </section>

      <section className="card stack">
        <h2 className="row">
          <ShieldCheck aria-hidden="true" /> Privacy
        </h2>
        <p className="small" style={{ margin: 0 }}>
          No accounts, no analytics, no tracking. Bookmarks, contacts, supplies, history and settings are stored only in this browser.
          The network is used only when you press Ask (your question goes to the ZeroSignal server you configured, which does not log
          it) or when you download pack updates.
        </p>
        {wiped ? (
          <p className="badge ok">All personal data deleted.</p>
        ) : (
          <button
            className="btn danger"
            onClick={async () => {
              if (!confirm("Delete all bookmarks, history, contacts, supplies, timers and settings on this device?")) return;
              await wipePersonalData();
              setWiped(true);
            }}
          >
            <Trash2 aria-hidden="true" /> Wipe all personal data
          </button>
        )}
      </section>

      <section className="card stack">
        <h2 className="row">
          <Info aria-hidden="true" /> About
        </h2>
        <p className="small" style={{ margin: 0 }}>
          {t("disclaimer")}
        </p>
        <button
          className="btn"
          onClick={async () => {
            await save(KEYS.onboarding, false);
            nav("/onboarding");
          }}
        >
          <RotateCcw aria-hidden="true" /> Show introduction again
        </button>
        <p className="muted small" style={{ margin: 0 }}>
          ZeroSignal web 0.1.0 · content licences are listed on every guide.
        </p>
      </section>
    </div>
  );
}
