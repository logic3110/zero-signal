import { Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { duration, speak, vibrate } from "../lib/format";

type Mode = "30:2" | "hands-only";
const BREATH_PAUSE_MS = 5000;

/** CPR metronome (US-5.3): 100-120 bpm click + vibration, compression count,
 *  breath prompts for 30:2, and a 2-minute rescuer swap reminder. */
export function CprMetronome() {
  const [running, setRunning] = useState(false);
  const [bpm, setBpm] = useState(110);
  const [mode, setMode] = useState<Mode>("30:2");
  const [count, setCount] = useState(0);
  const [cycles, setCycles] = useState(0);
  const [breathing, setBreathing] = useState(false);
  const [on, setOn] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [voice, setVoice] = useState(true);
  const ctx = useRef<AudioContext | null>(null);
  const lastSwap = useRef(0);

  const click = (accent: boolean) => {
    const ac = ctx.current;
    if (ac) {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.frequency.value = accent ? 1320 : 880;
      gain.gain.setValueAtTime(0.6, ac.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.06);
      osc.connect(gain).connect(ac.destination);
      osc.start();
      osc.stop(ac.currentTime + 0.07);
    }
    vibrate(35);
    setOn(true);
    setTimeout(() => setOn(false), 90);
  };

  useEffect(() => {
    if (!running || breathing) return;
    const id = setInterval(() => {
      setCount((c) => {
        const next = c + 1;
        click(next === 1);
        if (mode === "30:2" && next >= 30) {
          setBreathing(true);
          setCycles((n) => n + 1);
          if (voice) speak("Give 2 breaths");
          vibrate([200, 100, 200]);
          setTimeout(() => {
            setBreathing(false);
            setCount(0);
          }, BREATH_PAUSE_MS);
          return 30;
        }
        return mode === "hands-only" && next >= 100 ? 0 : next;
      });
    }, 60000 / bpm);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, breathing, bpm, mode, voice]);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (startedAt && t - startedAt - lastSwap.current >= 120000) {
        lastSwap.current += 120000;
        if (voice) speak("Two minutes. Swap rescuers if you can.");
        vibrate([400, 200, 400]);
      }
    }, 500);
    return () => clearInterval(id);
  }, [running, startedAt, voice]);

  const toggle = () => {
    if (!ctx.current) ctx.current = new AudioContext();
    void ctx.current.resume();
    if (!running && !startedAt) {
      setStartedAt(Date.now());
      lastSwap.current = 0;
    }
    setRunning((r) => !r);
  };

  const reset = () => {
    setRunning(false);
    setCount(0);
    setCycles(0);
    setBreathing(false);
    setStartedAt(null);
  };

  return (
    <section className="metronome" aria-label="CPR metronome">
      <div className={`beat ${on ? "on" : ""}`} aria-live="off">
        {breathing ? "2 ×" : count}
      </div>
      <div role="status" aria-live="assertive" style={{ fontWeight: 800, fontSize: "1.2rem" }}>
        {breathing ? "GIVE 2 BREATHS" : running ? "PUSH HARD, PUSH FAST" : "Ready"}
      </div>
      <div className="muted small">
        {bpm}/min · cycles {cycles} · {startedAt ? duration(now - startedAt) : "0:00"}
      </div>
      <div className="row" style={{ justifyContent: "center" }}>
        <button className="btn primary big" onClick={toggle} aria-pressed={running}>
          {running ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
          {running ? "Pause" : "Start"}
        </button>
        <button className="btn big" onClick={reset} aria-label="Reset metronome">
          <RotateCcw aria-hidden="true" />
        </button>
      </div>
      <div className="chips" role="group" aria-label="CPR mode">
        <button className="chip" aria-pressed={mode === "30:2"} onClick={() => setMode("30:2")}>
          30 : 2
        </button>
        <button className="chip" aria-pressed={mode === "hands-only"} onClick={() => setMode("hands-only")}>
          Compressions only
        </button>
        <button className="chip" aria-pressed={voice} onClick={() => setVoice((v) => !v)}>
          Voice cues
        </button>
      </div>
      <label className="field small" style={{ width: "100%" }}>
        Rate: {bpm} per minute
        <input type="range" min={100} max={120} step={5} value={bpm} onChange={(e) => setBpm(Number(e.target.value))} />
      </label>
    </section>
  );
}
