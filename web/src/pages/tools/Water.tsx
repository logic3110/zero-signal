import { useState } from "react";
import { Link } from "react-router-dom";
import { Back } from "../../components/Layout";
import { SourcesList } from "../../components/Sources";
import { useLib } from "../../state/data";
import { useSettings } from "../../state/settings";

interface WaterTable {
  boil: { max_altitude_m: number; rolling_boil_minutes: number }[];
  bleach: { note: string; drops_per_litre: { concentration: string; clear: number; cloudy: number }[]; wait_minutes: number };
}

/** Water purification calculator from sourced tables (US-8.4). */
export function WaterPage() {
  const lib = useLib();
  const [s] = useSettings();
  const table = lib.table<WaterTable>("water_purification");
  const [altitude, setAltitude] = useState(0);
  const [volume, setVolume] = useState(1);
  const [conc, setConc] = useState(0);
  const [cloudy, setCloudy] = useState(false);
  if (!table) return <p>Water table not installed.</p>;
  const altM = s.units === "metric" ? altitude : altitude / 3.281;
  const litres = s.units === "metric" ? volume : volume * 3.785;
  const boil = table.data.boil.find((b) => altM <= b.max_altitude_m) ?? table.data.boil.at(-1)!;
  const row = table.data.bleach.drops_per_litre[conc];
  const drops = Math.ceil((cloudy ? row.cloudy : row.clear) * litres);

  return (
    <div className="stack">
      <Back to="/tools" label="Tools" />
      <h1>Water purification</h1>
      <section className="card stack">
        <h2>Boiling</h2>
        <label className="field">
          Altitude ({s.units === "metric" ? "m" : "ft"})
          <input type="number" inputMode="numeric" min={0} value={altitude} onChange={(e) => setAltitude(Number(e.target.value) || 0)} />
        </label>
        <p className="big-readout" style={{ fontSize: "1.8rem" }}>
          Rolling boil for {boil.rolling_boil_minutes} minute{boil.rolling_boil_minutes > 1 ? "s" : ""}
        </p>
        <p className="muted small">Let it cool covered. Boiling does not remove chemicals or fuel.</p>
      </section>
      <section className="card stack">
        <h2>Household bleach</h2>
        <label className="field">
          Water volume ({s.units === "metric" ? "litres" : "US gallons"})
          <input type="number" inputMode="decimal" min={0} step={0.5} value={volume} onChange={(e) => setVolume(Number(e.target.value) || 0)} />
        </label>
        <label className="field">
          Bleach strength (on the label)
          <select value={conc} onChange={(e) => setConc(Number(e.target.value))}>
            {table.data.bleach.drops_per_litre.map((r, i) => (
              <option key={r.concentration} value={i}>
                {r.concentration} sodium hypochlorite
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={cloudy} onChange={(e) => setCloudy(e.target.checked)} /> Water is cloudy or very cold
        </label>
        <p className="big-readout" style={{ fontSize: "1.8rem" }}>
          {drops} drops, wait {table.data.bleach.wait_minutes} min
        </p>
        <p className="muted small">{table.data.bleach.note}</p>
      </section>
      <Link to="/guide/sur-water">Full guide: Finding and purifying water</Link>
      <SourcesList ids={[table.source_id]} />
    </div>
  );
}
