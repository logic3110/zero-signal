import { Phone } from "lucide-react";
import type { NumberKey } from "../lib/types";
import { useLib } from "../state/data";
import { useSettings } from "../state/settings";

export function useEmergencyNumber(key: NumberKey) {
  const lib = useLib();
  const [s] = useSettings();
  const table = lib.numbers();
  const country = table[s.country] ?? table.EU ?? Object.values(table)[0];
  const number = (country?.[key as keyof typeof country] as string | undefined) ?? country?.general ?? "112";
  return { number, country: country?.name ?? s.country };
}

/** One-tap call (US-5.4). tel: links hand off to the phone dialler. */
export function CallButton({ numberKey, label }: { numberKey: NumberKey; label?: string }) {
  const { number, country } = useEmergencyNumber(numberKey);
  return (
    <a className="call-btn" href={`tel:${number.replace(/\s/g, "")}`} aria-label={`Call ${number} (${numberKey}, ${country})`}>
      <Phone size={28} aria-hidden="true" />
      {label ?? "Call"} {number}
    </a>
  );
}
