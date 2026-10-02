import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { loadPacks, type InstalledPack } from "../lib/packs";
import { RedFlagDetector } from "../lib/redflag";
import { LocalSearch } from "../lib/search";
import type {
  Chunk,
  CountryNumbers,
  DecisionTree,
  Domain,
  Guide,
  ObdCode,
  ProtocolCard,
  Source,
  StaticTable,
  WarningLight,
} from "../lib/types";

export interface Library {
  packs: InstalledPack[];
  guides: Map<string, Guide>;
  guideList: Guide[];
  chunks: Map<string, Chunk>;
  cards: ProtocolCard[];
  cardById: Map<string, ProtocolCard>;
  trees: DecisionTree[];
  sources: Map<string, Source>;
  tables: Map<string, StaticTable>;
  search: LocalSearch;
  redflag: RedFlagDetector;
  categories(domain: Domain): { name: string; guides: Guide[] }[];
  table<T>(kind: string): StaticTable<T> | undefined;
  numbers(): Record<string, CountryNumbers>;
  warningLights(): WarningLight[];
  obdCodes(): ObdCode[];
}

const DOMAIN_ORDER: Domain[] = ["medical", "survival", "vehicle"];

function buildLibrary(packs: InstalledPack[]): Library {
  const guides = new Map<string, Guide>();
  const chunks = new Map<string, Chunk>();
  const cards: ProtocolCard[] = [];
  const trees: DecisionTree[] = [];
  const sources = new Map<string, Source>();
  const tables = new Map<string, StaticTable>();
  const synonyms = new Map<string, { term: string; canonical: string }>();
  for (const { bundle } of packs) {
    bundle.guides.forEach((g) => guides.set(g.guide_id, g));
    bundle.chunks.forEach((c) => chunks.set(c.chunk_id, c));
    cards.push(...bundle.protocol_cards);
    trees.push(...bundle.decision_trees);
    bundle.sources.forEach((s) => sources.set(s.source_id, s));
    bundle.static_tables.forEach((t) => tables.set(t.table_id, t));
    bundle.synonyms.forEach((s) => synonyms.set(`${s.term}|${s.canonical}`, s));
  }
  cards.sort((a, b) => DOMAIN_ORDER.indexOf(a.domain) - DOMAIN_ORDER.indexOf(b.domain) || a.order - b.order);
  const guideList = [...guides.values()].sort((a, b) => a.title.localeCompare(b.title));
  const search = new LocalSearch(guideList, [...chunks.values()], [...synonyms.values()]);
  const byKind = (kind: string) => [...tables.values()].find((t) => t.kind === kind);
  return {
    packs,
    guides,
    guideList,
    chunks,
    cards,
    cardById: new Map(cards.map((c) => [c.card_id, c])),
    trees,
    sources,
    tables,
    search,
    redflag: new RedFlagDetector(cards),
    categories(domain) {
      const cats = new Map<string, Guide[]>();
      for (const g of guideList) if (g.domain === domain) cats.set(g.category, [...(cats.get(g.category) ?? []), g]);
      return [...cats.entries()].map(([name, gs]) => ({ name, guides: gs })).sort((a, b) => a.name.localeCompare(b.name));
    },
    table<T>(kind: string) {
      return byKind(kind) as StaticTable<T> | undefined;
    },
    numbers() {
      return (byKind("emergency_numbers")?.data as { countries: Record<string, CountryNumbers> } | undefined)?.countries ?? {};
    },
    warningLights() {
      return (byKind("warning_lights")?.data as WarningLight[] | undefined) ?? [];
    },
    obdCodes() {
      return (byKind("obd_codes")?.data as ObdCode[] | undefined) ?? [];
    },
  };
}

interface DataState {
  lib: Library | null;
  error: string | null;
  reload: () => Promise<void>;
}

const Ctx = createContext<DataState>({ lib: null, error: null, reload: async () => {} });

export function DataProvider({ children }: { children: ReactNode }) {
  const [packs, setPacks] = useState<InstalledPack[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setPacks(await loadPacks());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  const lib = useMemo(() => (packs ? buildLibrary(packs) : null), [packs]);
  return <Ctx.Provider value={{ lib, error, reload }}>{children}</Ctx.Provider>;
}

export function useData() {
  return useContext(Ctx);
}

/** Library that is guaranteed loaded (components render under <Loaded>). */
export function useLib(): Library {
  const { lib } = useContext(Ctx);
  if (!lib) throw new Error("library not loaded");
  return lib;
}
