import { Flashlight, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Back } from "../../components/Layout";
import { useWakeLock } from "../../components/wakelock";

type Mode = "steady" | "strobe" | "sos";
type Output = "torch" | "white" | "red";

// Morse SOS: ... --- ... (unit = 200 ms)
const U = 200;
const SOS: [boolean, number][] = [];
for (const letter of ["...", "---", "..."]) {
  for (const [i, sym] of [...letter].entries()) {
    SOS.push([true, sym === "." ? U : 3 * U]);
    SOS.push([false, i < 2 ? U : 3 * U]);
  }
}
SOS[SOS.length - 1] = [false, 7 * U];

/** Flashlight with steady, strobe and Morse SOS, via the camera torch where
 *  the browser allows it, or a full-screen white/red light (US-10.1). */
export function FlashlightPage() {
  const [mode, setMode] = useState<Mode>("sos");
  const [output, setOutput] = useState<Output>("white");
  const [active, setActive] = useState(false);
  const [lit, setLit] = useState(false);
  const [torchOk, setTorchOk] = useState<boolean | null>(null);
  const track = useRef<MediaStreamTrack | null>(null);
  useWakeLock(active);

  const setTorch = async (on: boolean) => {
    try {
      await track.current?.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
    } catch {
      /* ignore */
    }
  };

  const openTorch = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      const t = stream.getVideoTracks()[0];
      const caps = (t.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean };
      if (!caps.torch) {
        t.stop();
        setTorchOk(false);
        return false;
      }
      track.current = t;
      setTorchOk(true);
      return true;
    } catch {
      setTorchOk(false);
      return false;
    }
  };

  useEffect(() => {
    if (output === "torch" && active) void setTorch(lit);
  }, [lit, output, active]);

  useEffect(() => {
    if (!active) {
      setLit(false);
      return;
    }
    if (mode === "steady") {
      setLit(true);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    if (mode === "strobe") {
      let on = false;
      const tick = () => {
        if (cancelled) return;
        on = !on;
        setLit(on);
        timer = setTimeout(tick, 100);
      };
      tick();
    } else {
      let i = 0;
      const tick = () => {
        if (cancelled) return;
        const [on, ms] = SOS[i % SOS.length];
        setLit(on);
        i++;
        timer = setTimeout(tick, ms);
      };
      tick();
    }
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, mode]);

  useEffect(
    () => () => {
      track.current?.stop();
    },
    [],
  );

  const start = async () => {
    if (output === "torch" && !track.current && !(await openTorch())) return;
    setActive(true);
  };
  const stop = () => {
    setActive(false);
    void setTorch(false);
  };

  const screen = active && output !== "torch";
  return (
    <div className="stack">
      <Back to="/tools" label="Tools" />
      <h1>SOS light</h1>
      <div className="chips" role="group" aria-label="Pattern">
        {(["steady", "strobe", "sos"] as Mode[]).map((m) => (
          <button key={m} className="chip" aria-pressed={mode === m} onClick={() => setMode(m)}>
            {m === "sos" ? "Morse SOS" : m[0].toUpperCase() + m.slice(1)}
          </button>
        ))}
      </div>
      <div className="chips" role="group" aria-label="Light source">
        {(["torch", "white", "red"] as Output[]).map((o) => (
          <button key={o} className="chip" aria-pressed={output === o} onClick={() => setOutput(o)}>
            {o === "torch" ? "Phone torch" : o === "white" ? "White screen" : "Red screen"}
          </button>
        ))}
      </div>
      {torchOk === false && output === "torch" && (
        <div className="notice warn">
          <TriangleAlert aria-hidden="true" /> This browser can't control the torch. Use the full-screen light instead.
        </div>
      )}
      {mode === "strobe" && (
        <div className="notice warn small">
          <TriangleAlert size={18} aria-hidden="true" /> Strobe light can trigger seizures in people with photosensitive epilepsy.
        </div>
      )}
      <button className="btn primary big block" onClick={() => void (active ? stop() : start())}>
        <Flashlight aria-hidden="true" /> {active ? "Turn off" : "Turn on"}
      </button>
      {screen && (
        <div
          className="light-full"
          style={{ background: lit ? (output === "red" ? "#ff1a1a" : "#ffffff") : "#000000" }}
          onClick={stop}
          role="button"
          aria-label="Full-screen light. Tap to turn off."
        >
          <span style={{ color: "#777", fontSize: "0.9rem" }}>Tap anywhere to turn off</span>
        </div>
      )}
    </div>
  );
}
