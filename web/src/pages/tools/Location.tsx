import { Copy, MapPin, Volume2 } from "lucide-react";
import { Back } from "../../components/Layout";
import { clock, coord, speak } from "../../lib/format";
import { plusCode } from "../../lib/pluscode";
import { useSettings } from "../../state/settings";
import { useLocation, type Fix } from "./geo";

function FixView({ f, title, units }: { f: Fix; title: string; units: "metric" | "imperial" }) {
  const alt = f.altitude == null ? "unknown" : units === "metric" ? `${Math.round(f.altitude)} m` : `${Math.round(f.altitude * 3.281)} ft`;
  const acc = units === "metric" ? `±${Math.round(f.accuracy)} m` : `±${Math.round(f.accuracy * 3.281)} ft`;
  const text = `${f.lat.toFixed(5)}, ${f.lng.toFixed(5)}`;
  return (
    <section className="card stack">
      <h2>{title}</h2>
      <div className="big-readout" style={{ fontSize: "1.8rem" }}>
        {coord(f.lat, "N", "S")}
        <br />
        {coord(f.lng, "E", "W")}
      </div>
      <table className="simple">
        <tbody>
          <tr>
            <th>Decimal</th>
            <td>{text}</td>
          </tr>
          <tr>
            <th>Plus code</th>
            <td>{plusCode(f.lat, f.lng)}</td>
          </tr>
          <tr>
            <th>Accuracy</th>
            <td>{acc}</td>
          </tr>
          <tr>
            <th>Altitude</th>
            <td>{alt}</td>
          </tr>
          <tr>
            <th>Time</th>
            <td>{clock(f.at)}</td>
          </tr>
        </tbody>
      </table>
      <div className="row">
        <button
          className="btn"
          onClick={() =>
            speak(
              `Latitude ${f.lat.toFixed(5).split("").join(" ")}. Longitude ${f.lng.toFixed(5).split("").join(" ")}. Plus code ${plusCode(f.lat, f.lng).split("").join(" ")}.`,
            )
          }
        >
          <Volume2 aria-hidden="true" /> Read aloud
        </button>
        <button className="btn" onClick={() => void navigator.clipboard?.writeText(`${text} (${plusCode(f.lat, f.lng)})`)}>
          <Copy aria-hidden="true" /> Copy
        </button>
      </div>
    </section>
  );
}

/** US-10.4: current and last-known GPS fix, no internet needed. */
export function LocationPage() {
  const { fix, last, error } = useLocation();
  const [s] = useSettings();
  return (
    <div className="stack">
      <Back to="/tools" label="Tools" />
      <h1 className="row">
        <MapPin aria-hidden="true" /> My location
      </h1>
      {error && <div className="notice warn">{error}</div>}
      {fix ? <FixView f={fix} title="Current position" units={s.units} /> : !error && <p aria-busy="true">Getting GPS fix…</p>}
      {!fix && last && <FixView f={last} title={`Last known (${new Date(last.at).toLocaleString()})`} units={s.units} />}
    </div>
  );
}
