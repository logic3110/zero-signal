import { BookOpen, Cpu, ShieldAlert, WifiOff } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { deviceTier } from "../lib/device";
import { useT } from "../lib/i18n";
import { KEYS, usePersistent } from "../lib/store";
import { useLib } from "../state/data";
import { useSettings } from "../state/settings";

/** Max 4 screens, skippable, revisitable from Settings (US-1.2, 1.3). */
export function Onboarding() {
  const t = useT();
  const nav = useNavigate();
  const lib = useLib();
  const [step, setStep] = useState(0);
  const [, setDone] = usePersistent<boolean>(KEYS.onboarding, false);
  const [ack, setAck] = usePersistent<boolean>(KEYS.disclaimer, false);
  const [settings, update] = useSettings();
  const tier = deviceTier();
  const finish = () => {
    setDone(true);
    nav("/", { replace: true });
  };

  const screens = [
    <>
      <WifiOff size={48} color="var(--accent)" aria-hidden="true" />
      <h1>{t("tagline")}</h1>
      <p>
        ZeroSignal works with no internet. The library, search, emergency protocol cards and field tools (SOS light,
        compass, location, supplies) all run on this device.
      </p>
      <p className="muted">No account. No analytics. Nothing you type leaves your device except when you choose Ask or a download.</p>
    </>,
    <>
      <BookOpen size={48} color="var(--accent)" aria-hidden="true" />
      <h1>What the AI can and cannot do</h1>
      <ul className="bullets">
        <li>Ask rewrites vetted library passages into numbered steps, and every step cites its source.</li>
        <li>It never answers from its own memory. If the library doesn't cover it, it says so.</li>
        <li>It never gives medication doses and never overrides an emergency protocol card.</li>
        <li>In a life-threatening situation, the protocol card appears first, with no AI involved.</li>
      </ul>
    </>,
    <>
      <ShieldAlert size={48} color="var(--accent)" aria-hidden="true" />
      <h1>Important</h1>
      <p style={{ fontSize: "1.1rem" }}>{t("disclaimer")}</p>
      <p className="muted small">Content is currently pending expert review and is marked as such on every guide.</p>
      <label className="check">
        <input type="checkbox" checked={!!ack} onChange={(e) => setAck(e.target.checked)} />I understand
      </label>
    </>,
    <>
      <Cpu size={48} color="var(--accent)" aria-hidden="true" />
      <h1>Set up</h1>
      <label className="field">
        Country (for emergency numbers)
        <select value={settings.country} onChange={(e) => update({ country: e.target.value })}>
          {Object.entries(lib.numbers()).map(([code, c]) => (
            <option key={code} value={code}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Theme
        <select value={settings.theme} onChange={(e) => update({ theme: e.target.value as typeof settings.theme })}>
          <option value="system">Match device</option>
          <option value="sunlight">Sunlight (light)</option>
          <option value="night">Night / Field (dark red)</option>
        </select>
      </label>
      <div className="notice">
        <Cpu size={20} aria-hidden="true" />
        <div>
          <strong>Device check: {tier.label}</strong>
          <p className="small" style={{ margin: 0 }}>
            {tier.advice}
          </p>
        </div>
      </div>
    </>,
  ];

  return (
    <div className="onboarding">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <Link to="/emergency" className="sos-mini">
          SOS
        </Link>
        <button className="btn ghost" onClick={finish}>
          Skip
        </button>
      </div>
      <div className="stack" style={{ flex: 1 }} aria-live="polite">
        {screens[step]}
      </div>
      <div className="dots" aria-label={`Step ${step + 1} of ${screens.length}`}>
        {screens.map((_, i) => (
          <span key={i} className={i === step ? "on" : ""} />
        ))}
      </div>
      <div className="row">
        {step > 0 && (
          <button className="btn" onClick={() => setStep(step - 1)}>
            Back
          </button>
        )}
        <button
          className="btn primary"
          style={{ flex: 1 }}
          disabled={step === 2 && !ack}
          onClick={() => (step < screens.length - 1 ? setStep(step + 1) : finish())}
        >
          {step < screens.length - 1 ? "Next" : "Start using ZeroSignal"}
        </button>
      </div>
    </div>
  );
}
