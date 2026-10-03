import { CheckSquare, Package, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { SourcesList } from "../components/Sources";
import { KEYS, usePersistent } from "../lib/store";
import { useLib } from "../state/data";
import { useSettings } from "../state/settings";

interface Medicine {
  name: string;
  quantity: number;
  perDay: number;
  expiry?: string;
}

interface Supplies {
  adults: number;
  children: number;
  infants: number;
  elderly: number;
  pregnant: number;
  hot: boolean;
  waterL: number;
  foodDays: number; // adult-days of food
  medicines: Medicine[];
  batteries: number;
  fuelL: number;
  cash: number;
}

const EMPTY: Supplies = {
  adults: 2,
  children: 0,
  infants: 0,
  elderly: 0,
  pregnant: 0,
  hot: false,
  waterL: 0,
  foodDays: 0,
  medicines: [],
  batteries: 0,
  fuelL: 0,
  cash: 0,
};

interface Needs {
  water_l_per_person_day: number;
  multipliers: Record<string, number>;
  food_kcal_per_person_day: number;
  recommended_days: number;
  water_note: string;
}

function Num({ label, value, onChange, step = 1, suffix }: { label: string; value: number; onChange: (n: number) => void; step?: number; suffix?: string }) {
  return (
    <label className="field">
      {label}
      <span className="row" style={{ flexWrap: "nowrap" }}>
        <input type="number" inputMode="decimal" min={0} step={step} value={value} onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))} />
        {suffix && <span className="muted">{suffix}</span>}
      </span>
    </label>
  );
}

/** Supplies tracker with "days remaining" (US-11.1, 11.2) and kit checklists (US-11.4). */
export function SuppliesPage() {
  const lib = useLib();
  const [settings] = useSettings();
  const [sup, setSup] = usePersistent<Supplies>(KEYS.supplies, EMPTY);
  const [checks, setChecks] = usePersistent<Record<string, boolean>>(KEYS.checklists, {});
  const [med, setMed] = useState<Medicine>({ name: "", quantity: 0, perDay: 1 });
  const s = { ...EMPTY, ...(sup ?? {}) };
  const set = (patch: Partial<Supplies>) => setSup({ ...s, ...patch });
  const needs = lib.table<Needs>("supply_needs")?.data;
  const kits = lib.table<Record<string, string[]>>("kit_checklists");
  const imperial = settings.units === "imperial";

  if (!needs) return <p>Supply tables not installed.</p>;
  const m = needs.multipliers;
  const persons = s.adults + s.children * m.child + s.infants * m.infant + s.elderly * m.elderly + s.pregnant * m.pregnant;
  const waterPerDay = persons * needs.water_l_per_person_day * (s.hot ? m.hot_climate : 1);
  const rows = [
    { name: "Water", days: waterPerDay ? (imperial ? s.waterL * 3.785 : s.waterL) / waterPerDay : 0 },
    { name: "Food", days: persons ? s.foodDays / persons : 0 },
    ...s.medicines.map((x) => ({ name: x.name, days: x.perDay ? x.quantity / x.perDay : Infinity })),
  ];
  const first = rows.filter((r) => Number.isFinite(r.days)).sort((a, b) => a.days - b.days)[0];
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="stack">
      <h1 className="row">
        <Package aria-hidden="true" /> Supplies
      </h1>

      <section className="card stack">
        <h2>Days remaining</h2>
        {first && s.waterL + s.foodDays > 0 ? (
          <p className={`notice ${first.days < needs.recommended_days ? "warn" : ""}`}>
            <strong>{first.name}</strong>&nbsp;runs out first - in about {first.days.toFixed(1)} days.
          </p>
        ) : (
          <p className="muted">Enter your household and supplies below.</p>
        )}
        <table className="simple">
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <th>{r.name}</th>
                <td>
                  <strong>{Number.isFinite(r.days) ? r.days.toFixed(1) : "-"}</strong> days
                  {Number.isFinite(r.days) && r.days < needs.recommended_days && <span className="badge urgent" style={{ marginLeft: 8 }}>below {needs.recommended_days} days</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">
          Water need: {(imperial ? waterPerDay / 3.785 : waterPerDay).toFixed(1)} {imperial ? "gal" : "L"} per day for this household. {needs.water_note}
        </p>
      </section>

      <section className="card stack">
        <h2>Household</h2>
        <div className="grid">
          <Num label="Adults" value={s.adults} onChange={(n) => set({ adults: n })} />
          <Num label="Children" value={s.children} onChange={(n) => set({ children: n })} />
          <Num label="Infants" value={s.infants} onChange={(n) => set({ infants: n })} />
          <Num label="Elderly" value={s.elderly} onChange={(n) => set({ elderly: n })} />
          <Num label="Pregnant / nursing" value={s.pregnant} onChange={(n) => set({ pregnant: n })} />
        </div>
        <label className="check">
          <input type="checkbox" checked={s.hot} onChange={(e) => set({ hot: e.target.checked })} /> Hot weather (more water needed)
        </label>
      </section>

      <section className="card stack">
        <h2>Stock</h2>
        <div className="grid">
          <Num label="Water" value={s.waterL} onChange={(n) => set({ waterL: n })} step={0.5} suffix={imperial ? "gal" : "L"} />
          <Num label="Food" value={s.foodDays} onChange={(n) => set({ foodDays: n })} step={0.5} suffix="adult-days" />
          <Num label="Batteries" value={s.batteries} onChange={(n) => set({ batteries: n })} />
          <Num label="Fuel" value={s.fuelL} onChange={(n) => set({ fuelL: n })} suffix={imperial ? "gal" : "L"} />
          <Num label="Cash" value={s.cash} onChange={(n) => set({ cash: n })} step={100} />
        </div>
        <p className="muted small">1 adult-day of food ≈ {needs.food_kcal_per_person_day} kcal (for example about 550 g of dry rice or lentils).</p>
      </section>

      <section className="card stack">
        <h2>Medicines</h2>
        {s.medicines.length > 0 && (
          <ul className="list">
            {s.medicines.map((x, i) => (
              <li key={i} className="item">
                <span className="grow">
                  <strong>{x.name}</strong> · {x.quantity} left · {x.perDay}/day
                  {x.expiry && (
                    <span className={`badge ${x.expiry < today ? "critical" : "info"}`} style={{ marginLeft: 8 }}>
                      {x.expiry < today ? "Expired" : `Expires ${x.expiry}`}
                    </span>
                  )}
                </span>
                <button className="btn ghost" aria-label={`Remove ${x.name}`} onClick={() => set({ medicines: s.medicines.filter((_, j) => j !== i) })}>
                  <Trash2 aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (!med.name.trim()) return;
            set({ medicines: [...s.medicines, { ...med, name: med.name.trim() }] });
            setMed({ name: "", quantity: 0, perDay: 1 });
          }}
        >
          <label className="field">
            Medicine name
            <input value={med.name} onChange={(e) => setMed({ ...med, name: e.target.value })} />
          </label>
          <div className="grid">
            <Num label="Quantity left" value={med.quantity} onChange={(n) => setMed({ ...med, quantity: n })} />
            <Num label="Used per day" value={med.perDay} onChange={(n) => setMed({ ...med, perDay: n })} step={0.5} />
            <label className="field">
              Expiry
              <input type="date" value={med.expiry ?? ""} onChange={(e) => setMed({ ...med, expiry: e.target.value || undefined })} />
            </label>
          </div>
          <button className="btn">
            <Plus aria-hidden="true" /> Add medicine
          </button>
        </form>
      </section>

      {kits && (
        <section className="section stack">
          <h2 className="row">
            <CheckSquare aria-hidden="true" /> Kit checklists
          </h2>
          {Object.entries(kits.data).map(([kit, items]) => {
            const done = items.filter((it) => checks?.[`${kit}:${it}`]).length;
            return (
              <details key={kit} className="card">
                <summary style={{ minHeight: 44, cursor: "pointer", fontWeight: 700 }}>
                  {kit.replace("_", " ").replace(/^./, (c) => c.toUpperCase())} kit - {done}/{items.length}
                </summary>
                {items.map((it) => (
                  <label key={it} className="check">
                    <input
                      type="checkbox"
                      checked={!!checks?.[`${kit}:${it}`]}
                      onChange={(e) => setChecks({ ...(checks ?? {}), [`${kit}:${it}`]: e.target.checked })}
                    />
                    {it}
                  </label>
                ))}
              </details>
            );
          })}
        </section>
      )}
      <SourcesList ids={["fema-ready"]} />
    </div>
  );
}
