import { Compass as CompassIcon, Navigation } from "lucide-react";
import { useEffect, useState } from "react";
import { Back } from "../../components/Layout";
import { KEYS, usePersistent } from "../../lib/store";

const CARDINALS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const cardinal = (deg: number) => CARDINALS[Math.round(deg / 45) % 8];

type OrientationEvt = DeviceOrientationEvent & { webkitCompassHeading?: number; webkitCompassAccuracy?: number };

/** Compass with calibration prompt and mark/follow bearing (US-10.3). */
export function CompassPage() {
  const [heading, setHeading] = useState<number | null>(null);
  const [needsCal, setNeedsCal] = useState(false);
  const [permission, setPermission] = useState<"unknown" | "needed" | "granted" | "denied">("unknown");
  const [marked, setMarked] = usePersistent<number | null>(KEYS.bearing, null);

  useEffect(() => {
    const req = (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission;
    setPermission(req ? "needed" : "granted");
  }, []);

  useEffect(() => {
    if (permission !== "granted") return;
    const onAbs = (e: OrientationEvt) => {
      if (typeof e.webkitCompassHeading === "number") {
        setHeading(e.webkitCompassHeading);
        setNeedsCal((e.webkitCompassAccuracy ?? 0) > 25 || (e.webkitCompassAccuracy ?? 0) < 0);
      } else if (e.alpha != null && (e.absolute || e.type === "deviceorientationabsolute")) {
        setHeading((360 - e.alpha) % 360);
      }
    };
    window.addEventListener("deviceorientationabsolute", onAbs as EventListener);
    window.addEventListener("deviceorientation", onAbs as EventListener);
    return () => {
      window.removeEventListener("deviceorientationabsolute", onAbs as EventListener);
      window.removeEventListener("deviceorientation", onAbs as EventListener);
    };
  }, [permission]);

  const ask = async () => {
    const req = (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission;
    try {
      setPermission((await req?.()) === "granted" ? "granted" : "denied");
    } catch {
      setPermission("denied");
    }
  };

  const diff = heading != null && marked != null ? ((marked - heading + 540) % 360) - 180 : null;

  return (
    <div className="stack">
      <Back to="/tools" label="Tools" />
      <h1 className="row">
        <CompassIcon aria-hidden="true" /> Compass
      </h1>
      {permission === "needed" && (
        <button className="btn primary big" onClick={() => void ask()}>
          Allow compass access
        </button>
      )}
      {permission === "denied" && <div className="notice warn">Compass permission was denied.</div>}
      {heading == null && permission === "granted" && (
        <div className="notice">
          Waiting for the compass sensor… Desktop browsers and some phones don't provide one; use the sun or stars method in the
          Navigation guide.
        </div>
      )}
      {needsCal && <div className="notice warn">Calibrate: move your phone in a figure-8 a few times, away from metal and magnets.</div>}
      <div className="compass-dial" aria-hidden="true">
        <div className="rose" style={{ transform: `rotate(${-(heading ?? 0)}deg)` }}>
          {["N", "E", "S", "W"].map((l, i) => {
            const a = (i * 90 * Math.PI) / 180;
            return (
              <span key={l} className="label" style={{ left: `${50 + 42 * Math.sin(a)}%`, top: `${50 - 42 * Math.cos(a)}%`, color: l === "N" ? "var(--accent)" : undefined }}>
                {l}
              </span>
            );
          })}
        </div>
        <div className="needle" />
      </div>
      <div className="big-readout" role="status" style={{ textAlign: "center" }}>
        {heading != null ? `${Math.round(heading)}° ${cardinal(heading)}` : "--"}
      </div>
      <div className="row" style={{ justifyContent: "center" }}>
        <button className="btn primary" disabled={heading == null} onClick={() => setMarked(Math.round(heading!))}>
          Mark this bearing
        </button>
        {marked != null && (
          <button className="btn ghost" onClick={() => setMarked(null)}>
            Clear
          </button>
        )}
      </div>
      {marked != null && (
        <div className="card" style={{ textAlign: "center" }}>
          <div>
            Following <strong>{marked}°</strong> {cardinal(marked)}
          </div>
          {diff != null && (
            <div className="big-readout" style={{ fontSize: "1.6rem" }}>
              <Navigation aria-hidden="true" style={{ transform: `rotate(${diff}deg)` }} />{" "}
              {Math.abs(diff) < 5 ? "On course" : `Turn ${diff > 0 ? "right" : "left"} ${Math.abs(Math.round(diff))}°`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
