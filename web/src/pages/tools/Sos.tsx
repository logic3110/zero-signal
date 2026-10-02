import { MessageSquareText, Send, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Back } from "../../components/Layout";
import { plusCode } from "../../lib/pluscode";
import { KEYS, usePersistent } from "../../lib/store";
import { useLocation } from "./geo";
import type { Contact } from "./Numbers";

const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent);

/** One-tap SOS SMS with GPS coordinates (US-10.2). SMS works on weak signal;
 *  the phone's messaging app queues and retries it. Always confirmed first. */
export function SosPage() {
  const { fix, last, error } = useLocation();
  const [contacts] = usePersistent<Contact[]>(KEYS.contacts, []);
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const pos = fix ?? last;
  const numbers = (contacts ?? []).map((c) => c.phone.replace(/[^\d+]/g, "")).filter(Boolean);

  const message = [
    "SOS - I need help.",
    pos
      ? `Location: ${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)} (±${Math.round(pos.accuracy)} m), plus code ${plusCode(pos.lat, pos.lng)}${fix ? "" : " (last known)"}.`
      : "Location unavailable.",
    `Time: ${new Date(pos?.at ?? Date.now()).toLocaleString()}.`,
    note.trim(),
    "Sent from ZeroSignal.",
  ]
    .filter(Boolean)
    .join(" ");

  const href = `sms:${numbers.join(",")}${isIOS ? "&" : "?"}body=${encodeURIComponent(message)}`;

  return (
    <div className="stack">
      <Back to="/tools" label="Tools" />
      <h1 className="row">
        <MessageSquareText aria-hidden="true" /> SOS message
      </h1>
      {error && !pos && <div className="notice warn">{error}</div>}
      {numbers.length === 0 && (
        <div className="notice warn">
          <TriangleAlert aria-hidden="true" />
          <div>
            No emergency contacts saved. <Link to="/tools/numbers">Add contacts</Link>, or you can still choose a recipient in your SMS app.
          </div>
        </div>
      )}
      <label className="field">
        Short message (optional)
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Broken leg, 2 people, have water" maxLength={120} />
      </label>
      <div className="card">
        <strong>Preview</strong>
        <p style={{ margin: "0.5rem 0 0" }}>{message}</p>
        <p className="muted small" style={{ margin: "0.5rem 0 0" }}>
          To: {(contacts ?? []).map((c) => c.name).join(", ") || "choose in SMS app"}
        </p>
      </div>
      {!confirming ? (
        <button className="btn primary big block" onClick={() => setConfirming(true)}>
          <Send aria-hidden="true" /> Send SOS
        </button>
      ) : (
        <div className="card stack" role="alertdialog" aria-label="Confirm SOS">
          <strong>Send this SOS by SMS{numbers.length ? ` to ${numbers.length} contact(s)` : ""}?</strong>
          <div className="row">
            <a className="btn primary big" href={href} onClick={() => setConfirming(false)}>
              Yes, open SMS
            </a>
            <button className="btn big" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <p className="muted small">Your SMS app sends the message and keeps retrying if the signal is weak. Nothing is sent by ZeroSignal itself.</p>
    </div>
  );
}
