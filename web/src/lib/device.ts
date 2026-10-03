// Device capability check (US-1.3). Browsers expose approximate RAM via
// navigator.deviceMemory (Chromium, capped at 8). The web app runs models on a
// local server rather than in the browser, so this is advisory.
export interface Tier {
  ramGb: number | null;
  recommended: "none" | "compact" | "recommended";
  label: string;
  advice: string;
}

export function deviceTier(): Tier {
  const ram = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null;
  if (ram === null)
    return {
      ramGb: null,
      recommended: "compact",
      label: "memory unknown",
      advice: "Your browser does not report memory. The Compact AI pack is the safe choice; library and tools work regardless.",
    };
  if (ram < 6)
    return {
      ramGb: ram,
      recommended: "none",
      label: `about ${ram} GB RAM`,
      advice: "On-device AI is not recommended for this device (under 6 GB). Library, search, protocol cards and tools work fully.",
    };
  if (ram < 8)
    return { ramGb: ram, recommended: "compact", label: `about ${ram} GB RAM`, advice: "The Compact AI pack (~1.4 GB) is recommended." };
  return {
    ramGb: ram,
    recommended: "recommended",
    label: `${ram}+ GB RAM`,
    advice: "The Recommended AI pack (~2.5 GB) should run well.",
  };
}
