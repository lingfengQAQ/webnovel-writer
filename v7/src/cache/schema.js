// 六表 + meta DDL（O4 §1；spec 0.9 §11）
// SCHEMA_VERSION 变更即触发全量重建（缓存是派生物，无迁移）——加列/加表时 +1。
export const SCHEMA_VERSION = 2

export const SCHEMA_SQL = `
-- meta 表（schema 版本与运行标记，如上次体检章号；跨重建保留见 CacheManager）
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- chapters 表
CREATE TABLE IF NOT EXISTS chapters (
  chapter_num INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  volume_num INTEGER NOT NULL,
  perspective TEXT,
  story_time TEXT,
  word_count INTEGER NOT NULL,
  chapter_position TEXT NOT NULL,
  hook_type TEXT,
  mood_position TEXT,
  is_volume_end BOOLEAN DEFAULT 0,
  file_path TEXT NOT NULL,
  is_key_chapter BOOLEAN DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_chapters_volume ON chapters(volume_num);
CREATE INDEX IF NOT EXISTS idx_chapters_position ON chapters(chapter_position);
CREATE INDEX IF NOT EXISTS idx_chapters_hook ON chapters(hook_type);

-- threads 表（三类条目统一）
CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  short_title TEXT NOT NULL,
  strength TEXT NOT NULL,
  status TEXT NOT NULL,
  opened_chapter INTEGER NOT NULL,
  planned_end TEXT,
  last_advanced_chapter INTEGER,
  file_path TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_threads_type ON threads(type);
CREATE INDEX IF NOT EXISTS idx_threads_status ON threads(status);

-- secrets 表
CREATE TABLE IF NOT EXISTS secrets (
  id TEXT PRIMARY KEY,
  short_title TEXT NOT NULL,
  known_to TEXT NOT NULL,
  reader_knows BOOLEAN NOT NULL,
  registered_chapter INTEGER NOT NULL,
  keywords TEXT NOT NULL,
  file_path TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_secrets_reader_knows ON secrets(reader_knows);

-- entities 表
CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT,
  location TEXT,
  realm TEXT,
  possessions TEXT,
  last_changed_chapter INTEGER,
  file_path TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
CREATE INDEX IF NOT EXISTS idx_entities_status ON entities(status);

-- entity_aliases 表
CREATE TABLE IF NOT EXISTS entity_aliases (
  alias TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  FOREIGN KEY(entity_id) REFERENCES entities(id)
);
CREATE INDEX IF NOT EXISTS idx_entity_aliases_entity ON entity_aliases(entity_id);

-- fingerprints 表
CREATE TABLE IF NOT EXISTS fingerprints (
  chapter_range_start INTEGER NOT NULL,
  chapter_range_end INTEGER NOT NULL,
  is_baseline BOOLEAN DEFAULT 0,
  avg_sentence_length REAL,
  sentence_length_variance REAL,
  avg_paragraph_length REAL,
  common_phrase_frequency TEXT,
  vocabulary_richness REAL,
  fingerprint_data TEXT NOT NULL,
  PRIMARY KEY(chapter_range_start, chapter_range_end)
);
CREATE INDEX IF NOT EXISTS idx_fingerprints_baseline ON fingerprints(is_baseline);
`
