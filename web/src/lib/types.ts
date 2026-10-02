// Shapes of the pack JSON bundle written by `zs-build` (backend/zerosignal/pack/writer.py).

export type Domain = "medical" | "survival" | "vehicle";
export type PatientType = "adult" | "child" | "infant" | "pregnant" | "elderly";
export type Severity = "critical" | "urgent" | "routine";

export interface Source {
  source_id: string;
  publisher: string;
  title: string;
  url?: string | null;
  licence: string;
  permission: string;
  version?: string | null;
  notes?: string | null;
}

export interface Guide {
  guide_id: string;
  domain: Domain;
  category: string;
  title: string;
  summary: string;
  body_md: string;
  steps: string[];
  warnings: string[];
  red_flags: string[];
  seek_help: string[];
  patient_types: PatientType[];
  severity: Severity;
  region: string;
  language: string;
  tags: string[];
  sources: string[];
  protocol_card?: string | null;
  last_reviewed?: string | null;
  reviewer_role?: string | null;
}

export interface Chunk {
  chunk_id: string;
  guide_id: string | null;
  section_path: string;
  text: string;
  domain: Domain;
  category: string;
  patient_type: string;
  severity: Severity;
}

export interface CardStep {
  text: string;
  detail?: string | null;
}

export interface CardTimer {
  id: string;
  label: string;
  interval_s?: number | null;
}

export type NumberKey = "ambulance" | "fire" | "police" | "disaster" | "roadside" | "general";

export interface ProtocolCard {
  card_id: string;
  domain: Domain;
  title: string;
  subtitle?: string | null;
  icon: string;
  trigger_terms: string[];
  call_first: boolean;
  steps: CardStep[];
  do_not: string[];
  timers: CardTimer[];
  tools: string[];
  emergency_number_key: NumberKey;
  related_guides: string[];
  sources: string[];
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  order: number;
}

export interface TreeNode {
  id: string;
  text: string;
  kind: "question" | "result";
  detail?: string | null;
  options: { label: string; next: string }[];
  severity?: string | null;
  guide_id?: string | null;
}

export interface DecisionTree {
  tree_id: string;
  domain: Domain;
  title: string;
  description: string;
  start: string;
  nodes: TreeNode[];
  sources: string[];
  reviewed_by?: string | null;
  reviewed_at?: string | null;
}

export interface StaticTable<T = unknown> {
  table_id: string;
  kind: string;
  title: string;
  source_id: string;
  data: T;
}

export interface Manifest {
  pack_id: string;
  version: string;
  title: string;
  description: string;
  domain: string;
  language: string;
  region: string;
  created_at: string;
  embedding_model_id: string;
  embedding_dim: number;
  min_app_version: string;
  reviewer_signoff: string | null;
  counts: Record<string, number>;
  content_hash: string;
}

export interface PackBundle {
  manifest: Manifest;
  sources: Source[];
  guides: Guide[];
  chunks: Chunk[];
  protocol_cards: ProtocolCard[];
  decision_trees: DecisionTree[];
  static_tables: StaticTable[];
  synonyms: { term: string; canonical: string; language: string }[];
}

export interface CatalogPack extends Manifest {
  size: number;
  sha256: string;
  url: string;
  signature: string | null;
  web: { url: string; size: number; sha256: string; signature: string | null };
}

export interface ModelPack {
  id: string;
  tier: string;
  name: string;
  params: string;
  quant: string;
  size_bytes: number;
  ram_required_gb: number;
  expected_tokens_per_s: string;
  languages: string[];
  licence: string;
  runtime: string;
  status: string;
}

export interface Catalog {
  catalog_version: number;
  generated_at: string;
  app_version: string;
  packs: CatalogPack[];
  models: ModelPack[];
}

export interface CountryNumbers {
  name: string;
  general: string;
  ambulance: string;
  police: string;
  fire: string;
  disaster: string;
  women?: string;
  roadside?: string;
  other?: Record<string, string>;
}

export interface WarningLight {
  id: string;
  name: string;
  symbol: string;
  color: "red" | "amber" | "green" | "blue";
  severity: "stop" | "careful" | "check-soon" | "info";
  meaning: string;
  action: string;
  guide_id?: string;
}

export interface ObdCode {
  code: string;
  meaning: string;
  causes: string;
  safe_to_drive: "yes" | "no" | "caution";
}
