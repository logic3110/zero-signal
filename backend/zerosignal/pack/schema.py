"""Pack SQLite schema (Section 11).

Deviations from the PRD table sketch, all additive:
  * ``manifest.sha256`` / ``signature`` cannot live inside the file they
    hash; they are recorded in the sidecar ``<pack>.manifest.json`` and the
    catalog. The columns exist and stay NULL inside the pack.
  * ``guides`` also stores steps / seek_help / sources / tags as JSON.
  * ``chunks`` also stores region, licence and reviewed flag (US-15.4).
  * ``chunks_vec`` is a plain table of int8 blobs (4-byte scale header +
    ``dim`` int8 values). The same layout can be loaded into a sqlite-vec
    ``vec0`` table on device; search here is brute-force cosine, which is
    well under budget for a few thousand chunks.
  * ``vocab`` holds unstemmed terms for typo correction (US-3.1).
"""

SCHEMA_VERSION = 1

DDL = """
CREATE TABLE manifest(
  pack_id TEXT PRIMARY KEY, version TEXT NOT NULL, title TEXT, description TEXT,
  domain TEXT, language TEXT, region TEXT, created_at TEXT,
  embedding_model_id TEXT NOT NULL, embedding_dim INTEGER NOT NULL,
  min_app_version TEXT, sha256 TEXT, signature TEXT, reviewer_signoff TEXT,
  content_hash TEXT, counts_json TEXT, schema_version INTEGER
);

CREATE TABLE sources(
  source_id TEXT PRIMARY KEY, publisher TEXT, title TEXT, url TEXT,
  licence TEXT NOT NULL, retrieved_at TEXT, version TEXT, permission TEXT, notes TEXT
);

CREATE TABLE guides(
  guide_id TEXT PRIMARY KEY, domain TEXT, category TEXT, title TEXT, summary TEXT,
  body_md TEXT, steps_json TEXT, warnings TEXT, red_flags TEXT, seek_help_json TEXT,
  patient_types TEXT, severity TEXT, region TEXT, language TEXT, tags_json TEXT,
  sources_json TEXT, protocol_card TEXT, last_reviewed TEXT, reviewer_role TEXT
);

CREATE TABLE chunks(
  chunk_id TEXT PRIMARY KEY, guide_id TEXT, source_id TEXT, section_path TEXT,
  text TEXT, token_count INTEGER, domain TEXT, category TEXT, topic TEXT,
  patient_type TEXT, severity TEXT, region TEXT, language TEXT, licence TEXT,
  reviewed INTEGER, order_idx INTEGER
);
CREATE INDEX chunks_guide ON chunks(guide_id, order_idx);

CREATE VIRTUAL TABLE chunks_fts USING fts5(
  chunk_id UNINDEXED, title, section, text, keywords,
  tokenize = 'porter unicode61 remove_diacritics 2'
);

CREATE TABLE chunks_vec(chunk_id TEXT PRIMARY KEY, embedding BLOB NOT NULL);

CREATE TABLE protocol_cards(
  card_id TEXT PRIMARY KEY, domain TEXT, title TEXT, trigger_terms TEXT,
  steps_json TEXT, timers_json TEXT, emergency_number_key TEXT,
  reviewed_by TEXT, reviewed_at TEXT, card_json TEXT, order_idx INTEGER
);

CREATE TABLE decision_trees(tree_id TEXT PRIMARY KEY, domain TEXT, title TEXT, nodes_json TEXT, tree_json TEXT);

CREATE TABLE static_tables(table_id TEXT PRIMARY KEY, kind TEXT, title TEXT, data_json TEXT, source_id TEXT);

CREATE TABLE synonyms(term TEXT, canonical TEXT, language TEXT, PRIMARY KEY(term, canonical, language));

CREATE TABLE vocab(term TEXT PRIMARY KEY, df INTEGER);
"""
