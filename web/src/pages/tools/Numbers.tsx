import { Phone, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Back } from "../../components/Layout";
import { KEYS, usePersistent } from "../../lib/store";
import { useLib } from "../../state/data";
import { useSettings } from "../../state/settings";

export interface Contact {
  name: string;
  phone: string;
  relation?: string;
}

const LABELS: Record<string, string> = {
  general: "Emergency (all services)",
  ambulance: "Ambulance",
  police: "Police",
  fire: "Fire",
  disaster: "Disaster helpline",
  women: "Women's helpline",
  roadside: "Highway / roadside",
};

/** Local emergency numbers bundled offline + personal contacts (US-10.5). */
export function NumbersPage() {
  const lib = useLib();
  const [s, update] = useSettings();
  const table = lib.numbers();
  const c = table[s.country];
  const [contacts, setContacts] = usePersistent<Contact[]>(KEYS.contacts, []);
  const [draft, setDraft] = useState<Contact>({ name: "", phone: "", relation: "" });
  const src = lib.table<{ verified_at: string; note: string }>("emergency_numbers");

  return (
    <div className="stack">
      <Back to="/tools" label="Tools" />
      <h1>Emergency numbers</h1>
      <label className="field">
        Country
        <select value={s.country} onChange={(e) => update({ country: e.target.value })}>
          {Object.entries(table).map(([code, x]) => (
            <option key={code} value={code}>
              {x.name}
            </option>
          ))}
        </select>
      </label>
      {c ? (
        <ul className="list">
          {Object.entries(LABELS)
            .filter(([k]) => c[k as keyof typeof c])
            .map(([k, label]) => {
              const n = c[k as keyof typeof c] as string;
              return (
                <li key={k}>
                  <a href={`tel:${n.replace(/\s/g, "")}`}>
                    <Phone size={20} aria-hidden="true" />
                    <span className="grow">{label}</span>
                    <strong style={{ fontSize: "1.2rem" }}>{n}</strong>
                  </a>
                </li>
              );
            })}
          {Object.entries(c.other ?? {}).map(([label, n]) => (
            <li key={label}>
              <a href={`tel:${n.replace(/[^\d+]/g, "")}`}>
                <Phone size={20} aria-hidden="true" />
                <span className="grow">{label}</span>
                <strong>{n}</strong>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No numbers for this country yet. 112 works from most mobile phones.</p>
      )}
      {src && <p className="muted small">{src.data.note} Last checked {src.data.verified_at}.</p>}

      <section className="section stack">
        <h2>My emergency contacts</h2>
        <p className="muted small">Stored only on this device. Used by SOS message.</p>
        {(contacts ?? []).length > 0 && (
          <ul className="list">
            {(contacts ?? []).map((ct, i) => (
              <li key={i} className="item">
                <span className="grow">
                  <strong>{ct.name}</strong>
                  {ct.relation ? <span className="muted"> · {ct.relation}</span> : null}
                  <div>
                    <a href={`tel:${ct.phone}`}>{ct.phone}</a>
                  </div>
                </span>
                <button className="btn ghost" aria-label={`Remove ${ct.name}`} onClick={() => setContacts((p) => (p ?? []).filter((_, j) => j !== i))}>
                  <Trash2 aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="stack card"
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.name.trim() || !draft.phone.trim()) return;
            setContacts((p) => [...(p ?? []), { ...draft, name: draft.name.trim(), phone: draft.phone.trim() }]);
            setDraft({ name: "", phone: "", relation: "" });
          }}
        >
          <label className="field">
            Name
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} autoComplete="off" />
          </label>
          <label className="field">
            Phone
            <input type="tel" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
          </label>
          <label className="field">
            Relation (optional)
            <input value={draft.relation} onChange={(e) => setDraft({ ...draft, relation: e.target.value })} />
          </label>
          <button className="btn primary">
            <Plus aria-hidden="true" /> Add contact
          </button>
        </form>
      </section>
    </div>
  );
}
