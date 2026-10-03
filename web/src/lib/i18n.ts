// UI strings are externalised here (NFR-11). Hindi is partial for now; any
// missing key falls back to English. Library content language comes from packs.
import { useSettings } from "../state/settings";

const en = {
  appName: "ZeroSignal",
  tagline: "No signal. Still an answer.",
  emergency: "EMERGENCY",
  emergencySub: "Protocol cards - no AI, instant",
  search: "Search",
  searchPlaceholder: "Search guides (e.g. bleeding, jump start, water)",
  ask: "Ask",
  askPlaceholder: "Describe the situation…",
  library: "Library",
  tools: "Tools",
  supplies: "Supplies",
  settings: "Settings",
  home: "Home",
  medical: "Medical",
  survival: "Survival",
  vehicle: "Vehicle",
  bookmarks: "Bookmarks",
  recent: "Recently opened",
  steps: "Steps",
  warnings: "Warnings",
  redFlags: "Red flags",
  seekHelp: "When to get help",
  sources: "Sources",
  doNot: "Do NOT",
  call: "Call",
  pendingReview: "Pending expert review",
  lastReviewed: "Last reviewed",
  disclaimer:
    "Reference information for when help is not available. Not a substitute for professional medical care, emergency services or a qualified mechanic. Call emergency services when you can.",
  notInLibrary: "This isn't covered in the library.",
  closestGuides: "Closest guides",
  stop: "Stop",
  offline: "Offline",
  online: "Online",
  allDomains: "All",
} as const;

export type StringKey = keyof typeof en;

const hi: Partial<Record<StringKey, string>> = {
  tagline: "सिग्नल नहीं। फिर भी जवाब।",
  emergency: "आपातकाल",
  emergencySub: "प्रोटोकॉल कार्ड - बिना AI, तुरंत",
  search: "खोजें",
  ask: "पूछें",
  library: "पुस्तकालय",
  tools: "उपकरण",
  supplies: "सामान",
  settings: "सेटिंग्स",
  home: "होम",
  medical: "चिकित्सा",
  survival: "सर्वाइवल",
  vehicle: "वाहन",
  steps: "कदम",
  warnings: "चेतावनी",
  call: "कॉल करें",
  doNot: "यह न करें",
  sources: "स्रोत",
  stop: "रोकें",
};

const dicts = { en, hi } as const;

export function translate(lang: string, key: StringKey): string {
  return (dicts[lang as keyof typeof dicts] as Partial<Record<StringKey, string>>)?.[key] ?? en[key];
}

export function useT() {
  const [settings] = useSettings();
  return (key: StringKey) => translate(settings.language, key);
}
