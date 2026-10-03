import { CheckCircle2, Cpu, Download, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { Back } from "../components/Layout";
import { fetchCatalog } from "../lib/api";
import { deviceTier } from "../lib/device";
import { bytes, duration } from "../lib/format";
import { BUNDLED_PACKS, installPack, isNewer, removePack, restoreBundled, type Progress } from "../lib/packs";
import type { Catalog, CatalogPack } from "../lib/types";
import { useData, useLib } from "../state/data";
import { useSettings } from "../state/settings";

/** Pack and model management (US-12.1..12.3, US-1.4). Updates only happen
 *  when the user taps them - never automatically. */
export function PacksPage() {
  const lib = useLib();
  const { reload } = useData();
  const [s] = useSettings();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const tier = deviceTier();
  const installed = new Map(lib.packs.map((p) => [p.pack_id, p]));

  const check = async () => {
    setStatus("Checking for updates…");
    try {
      setCatalog(await fetchCatalog(s.apiBase));
      setStatus(null);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  };

  const install = async (cp: CatalogPack) => {
    if (!navigator.onLine) return setStatus("You are offline.");
    const conn = (navigator as Navigator & { connection?: { type?: string; saveData?: boolean } }).connection;
    if (conn?.type === "cellular" && !confirm(`You're on mobile data. Download ${bytes(cp.web.size)} anyway?`)) return;
    setBusy(cp.pack_id);
    setStatus(null);
    try {
      await installPack(cp, setProgress);
      await reload();
      setStatus(`${cp.title} ${cp.version} installed and verified.`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const eta = (p: Progress) => {
    const elapsed = performance.now() - p.startedAt;
    const rate = p.loaded / Math.max(1, elapsed);
    return p.total > p.loaded ? duration((p.total - p.loaded) / Math.max(rate, 0.001)) : "0:00";
  };

  return (
    <div className="stack">
      <Back to="/settings" label="Settings" />
      <h1>Knowledge packs</h1>
      <ul className="list">
        {lib.packs.map((p) => {
          const m = p.bundle.manifest;
          const cp = catalog?.packs.find((x) => x.pack_id === p.pack_id);
          const update = cp && isNewer(cp.version, p.version);
          return (
            <li key={p.pack_id} className="item" style={{ alignItems: "flex-start" }}>
              <span className="grow stack" style={{ gap: "0.2rem" }}>
                <strong>{m.title}</strong>
                <span className="muted small">
                  v{p.version} · {bytes(p.size)} · {m.counts.guides ?? 0} guides · {m.counts.protocol_cards ?? 0} cards · sha256 {p.sha256.slice(0, 10)}…
                </span>
                <span className="small">
                  {m.reviewer_signoff ? <span className="badge ok">Reviewed: {m.reviewer_signoff}</span> : <span className="badge urgent">Pending expert review</span>}
                </span>
                {update && (
                  <button className="btn primary" disabled={!!busy} onClick={() => void install(cp!)}>
                    <Download aria-hidden="true" /> Update to {cp!.version} ({bytes(cp!.web.size)})
                  </button>
                )}
                {cp && !update && (
                  <span className="small row" style={{ color: "var(--ok)" }}>
                    <CheckCircle2 size={16} aria-hidden="true" /> Up to date
                  </span>
                )}
              </span>
              {BUNDLED_PACKS.includes(p.pack_id) ? (
                p.version !== undefined && (
                  <button
                    className="btn ghost"
                    aria-label={`Restore bundled ${m.title}`}
                    title="Restore the version that shipped with the app"
                    onClick={async () => {
                      await restoreBundled(p.pack_id);
                      await reload();
                    }}
                  >
                    <RotateCcw aria-hidden="true" />
                  </button>
                )
              ) : (
                <button
                  className="btn ghost"
                  aria-label={`Delete ${m.title}`}
                  onClick={async () => {
                    if (!confirm(`Delete ${m.title}?`)) return;
                    await removePack(p.pack_id);
                    await reload();
                  }}
                >
                  <Trash2 aria-hidden="true" />
                </button>
              )}
            </li>
          );
        })}
        {catalog?.packs
          .filter((cp) => !installed.has(cp.pack_id))
          .map((cp) => (
            <li key={cp.pack_id} className="item">
              <span className="grow">
                <strong>{cp.title}</strong>
                <div className="muted small">
                  v{cp.version} · {bytes(cp.web.size)} · {cp.description}
                </div>
              </span>
              <button className="btn primary" disabled={!!busy} onClick={() => void install(cp)}>
                <Download aria-hidden="true" /> Install
              </button>
            </li>
          ))}
      </ul>
      {progress && busy && (
        <div className="stack" role="status" aria-live="polite">
          <div className="progress" aria-hidden="true">
            <span style={{ width: `${Math.min(100, (progress.loaded / Math.max(1, progress.total)) * 100)}%` }} />
          </div>
          <span className="small">
            {bytes(progress.loaded)} of {bytes(progress.total)} · about {eta(progress)} left
          </span>
        </div>
      )}
      <button className="btn" onClick={() => void check()} disabled={!!busy}>
        <RefreshCw aria-hidden="true" /> Check for updates
      </button>
      {status && (
        <p className="notice" role="status">
          {status}
        </p>
      )}

      <section className="section stack">
        <h2 className="row">
          <Cpu aria-hidden="true" /> AI model packs
        </h2>
        <p className="small">
          Device: {tier.label}. {tier.advice}
        </p>
        <p className="muted small">
          On the web, answers are generated by the ZeroSignal server you connect to (running a local model such as llama.cpp), not
          inside the browser. The Android app downloads these packs to the phone.
        </p>
        {(catalog?.models ?? []).map((m) => (
          <div key={m.id} className="card small">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <strong>
                {m.tier}: {m.name}
              </strong>
              {tier.recommended === m.id && <span className="badge ok">Recommended for this device</span>}
            </div>
            <div className="muted">
              {bytes(m.size_bytes)} · needs {m.ram_required_gb} GB RAM · {m.expected_tokens_per_s} tokens/s · {m.languages.join(", ")} · {m.licence} ·{" "}
              {m.status}
            </div>
          </div>
        ))}
        {!catalog && <p className="muted small">Check for updates to see available model packs.</p>}
      </section>
    </div>
  );
}
