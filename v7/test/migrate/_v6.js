import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { mkdtemp, rm, cp } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const inlineFixture = path.join(__dirname, '../fixtures/v6-inline')
export const sqliteFixture = path.join(__dirname, '../fixtures/v6-sqlite')

/** 拷 fixture 到临时目录（可写）。 */
export async function tempV6(fixture) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'wnw-v6-'))
  await cp(fixture, tmp, { recursive: true })
  return { v6Path: tmp, cleanup: () => rm(tmp, { recursive: true, force: true }) }
}

/**
 * 拷 v6-sqlite fixture 并现场建 index.db（DDL 摘自 v6 index_manager.py，
 * 见任务 research/v6-data-inventory.md Q3；故意不建 chase_debt 等表——测缺表容忍）。
 */
export async function tempV6Sqlite() {
  const { v6Path, cleanup } = await tempV6(sqliteFixture)
  const db = new DatabaseSync(path.join(v6Path, '.webnovel', 'index.db'))
  db.exec(`CREATE TABLE entities (
    id TEXT PRIMARY KEY, type TEXT, canonical_name TEXT, tier TEXT DEFAULT '装饰',
    desc TEXT, current_json TEXT, first_appearance INTEGER, last_appearance INTEGER,
    is_protagonist INTEGER DEFAULT 0, is_archived INTEGER DEFAULT 0,
    created_at TEXT, updated_at TEXT)`)
  db.exec(`CREATE TABLE aliases (
    alias TEXT, entity_id TEXT, entity_type TEXT, created_at TEXT,
    PRIMARY KEY (alias, entity_id, entity_type))`)
  db.exec(`CREATE TABLE state_changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT, entity_id TEXT, field TEXT,
    old_value TEXT, new_value TEXT, reason TEXT, chapter INTEGER, created_at TEXT)`)
  db.exec(`CREATE TABLE relationships (
    id INTEGER PRIMARY KEY AUTOINCREMENT, from_entity TEXT, to_entity TEXT,
    type TEXT, description TEXT, chapter INTEGER, created_at TEXT)`)
  db.exec(`CREATE TABLE chapters (
    chapter INTEGER PRIMARY KEY, title TEXT, location TEXT, word_count INTEGER,
    characters TEXT, summary TEXT, created_at TEXT)`)
  db.exec(`CREATE TABLE chapter_reading_power (
    chapter INTEGER PRIMARY KEY, hook_type TEXT, hook_strength TEXT DEFAULT 'medium',
    coolpoint_patterns TEXT, micropayoffs TEXT, hard_violations TEXT, soft_suggestions TEXT,
    is_transition INTEGER DEFAULT 0, override_count INTEGER DEFAULT 0,
    debt_balance REAL DEFAULT 0, created_at TEXT, updated_at TEXT)`)

  db.prepare(`INSERT INTO entities (id, type, canonical_name, tier, desc, current_json, first_appearance, last_appearance, is_protagonist)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('jiangyao', '角色', '江遥', '核心', '滨海市海事记者', '{"location":"滨海市","状态":"在世"}', 1, 2, 1)
  db.prepare(`INSERT INTO entities (id, type, canonical_name, tier, current_json, first_appearance, last_appearance)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run('binhai', '地点', '滨海市', '支线', '{}', 1, 2)
  db.prepare('INSERT INTO aliases (alias, entity_id, entity_type) VALUES (?, ?, ?)').run('小江', 'jiangyao', '角色')
  db.prepare(`INSERT INTO state_changes (entity_id, field, old_value, new_value, reason, chapter)
    VALUES (?, ?, ?, ?, ?, ?)`).run('jiangyao', 'location', '报社', '滨海市', '回乡奔丧', 1)
  db.prepare(`INSERT INTO relationships (from_entity, to_entity, type, description, chapter)
    VALUES (?, ?, ?, ?, ?)`).run('jiangyao', 'binhai', '故乡', '江遥的故乡', 1)
  db.prepare('INSERT INTO chapters (chapter, title, summary) VALUES (?, ?, ?)')
    .run(1, '退潮', '江遥在退潮滩涂拾得停摆怀表，表盖刻字暗藏警告。')
  db.prepare('INSERT INTO chapter_reading_power (chapter, hook_type, hook_strength, coolpoint_patterns) VALUES (?, ?, ?, ?)')
    .run(1, '悬念钩', 'strong', '["异物入手"]')
  db.close()
  return { v6Path, cleanup }
}
