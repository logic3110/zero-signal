import { useEffect } from "react";
import { API_BASE } from "../lib/api";
import { KEYS, usePersistent } from "../lib/store";

export interface Settings {
  theme: "system" | "sunlight" | "night";
  textScale: number;
  country: string;
  units: "metric" | "imperial";
  language: "en" | "hi";
  batterySaver: boolean;
  apiBase: string;
}

function defaultCountry(): string {
  const region = (navigator.language.split("-")[1] ?? "").toUpperCase();
  return region || "IN";
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  textScale: 1,
  country: typeof navigator !== "undefined" ? defaultCountry() : "IN",
  units: "metric",
  language: "en",
  batterySaver: false,
  apiBase: API_BASE,
};

export function useSettings() {
  const [s, set, ready] = usePersistent<Settings>(KEYS.settings, DEFAULT_SETTINGS);
  const merged = { ...DEFAULT_SETTINGS, ...(s ?? {}) };
  const update = (patch: Partial<Settings>) => set((prev) => ({ ...DEFAULT_SETTINGS, ...(prev ?? {}), ...patch }));
  return [merged, update, ready] as const;
}

/** Apply theme + text scale to <html>. */
export function useApplySettings() {
  const [s] = useSettings();
  useEffect(() => {
    const root = document.documentElement;
    const dark = s.theme === "night" || (s.theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    root.dataset.theme = dark ? "night" : "sunlight";
    root.style.fontSize = `${100 * s.textScale}%`;
    root.lang = s.language;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#140606" : "#b3261e");
  }, [s.theme, s.textScale, s.language]);
}
