import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parseFrontMatter } from '../storage/parsers/front-matter.js'
import { parseMarkdownTable } from '../storage/parsers/markdown-table.js'

/**
 * 全量重建缓存（BEGIN → DELETE 六表 → 扫描源文件 INSERT → COMMIT，中途失败 ROLLBACK 不留半库）。
 * @param {string} repoPath - 书仓库根目录
 * @param {DatabaseSync} db - node:sqlite 数据库实例
 * @returns {Promise<{ok: boolean, warnings: string[], errors: string[]}>}
 */
export async function rebuildCache(repoPath, db) {
  const warnings = []
  const errors = []

  try {
    // P0-3/P1-1：整次重建包在一个事务里，别名冲突等中途失败 → ROLLBACK，不留半填库
    db.exec('BEGIN')

    // 1. 清空六表（chapters/threads/secrets/entities/entity_aliases/fingerprints）
    db.exec('DELETE FROM chapters')
    db.exec('DELETE FROM threads')
    db.exec('DELETE FROM secrets')
    db.exec('DELETE FROM entities')
    db.exec('DELETE FROM entity_aliases')
    db.exec('DELETE FROM fingerprints')

    // 2. 扫描章节文件 → 填充 chapters 表
    const chapterMap = await scanChapters(repoPath, db)

    // 3. 扫描条目文件 → 填充 threads 表（验证履历章节）
    await scanThreads(repoPath, db, chapterMap, warnings)

    // 4. 扫描信息差 → 填充 secrets 表
    await scanSecrets(repoPath, db)

    // 5. 解析名册 → 填充 entities + entity_aliases 表（验证别名唯一性）
    const aliasCheck = await scanEntities(repoPath, db)
    if (aliasCheck.warnings) warnings.push(...aliasCheck.warnings)
    if (!aliasCheck.ok) {
      db.exec('ROLLBACK')
      errors.push(...aliasCheck.errors)
      return { ok: false, warnings, errors }
    }

    // 6. 扫描角色卡 → 填充 entities 表
    await scanCharacters(repoPath, db)

    // 7. fingerprints 表留空（特征提取随 M3+ 体检补）

    db.exec('COMMIT')
    return { ok: true, warnings, errors }
  } catch (err) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // 未处于事务中，忽略
    }
    errors.push(`重建失败：${err.message}`)
    return { ok: false, warnings, errors }
  }
}

/**
 * 扫描章节文件，填充 chapters 表。
 * @returns {Promise<Map<number, string>>} 章号 → 文件路径映射
 */
async function scanChapters(repoPath, db) {
  const chapterDir = path.join(repoPath, '定稿', '正文')
  const chapterMap = new Map()

  try {
    const files = await fs.readdir(chapterDir)
    const insertStmt = db.prepare(`
      INSERT INTO chapters (chapter_num, title, volume_num, perspective, story_time, word_count, chapter_position, hook_type, mood_position, file_path, is_key_chapter)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    for (const file of files) {
      if (!file.endsWith('.md')) continue

      const filePath = path.join(chapterDir, file)
      const content = await fs.readFile(filePath, 'utf8')
      const parsed = parseFrontMatter(content)

      if (parsed.ok) {
        const fm = parsed.data
        const chapterNum = fm.章号 || parseInt(file.match(/\d+/)?.[0] || '0', 10)

        insertStmt.run(
          chapterNum,
          fm.标题 || '未命名',
          fm.卷 || 1,
          fm.视角 || null,
          fm.书内时间 || null,
          fm.字数 || 0,
          fm.章定位 || '推进',
          fm.钩子 || null,
          fm.情绪定位 || null,
          filePath,
          fm.是否关键章 ? 1 : 0
        )

        chapterMap.set(chapterNum, filePath)
      }
    }
  } catch (err) {
    // 目录不存在，跳过
  }

  return chapterMap
}

/**
 * 扫描条目文件，填充 threads 表。
 */
async function scanThreads(repoPath, db, chapterMap, warnings) {
  const types = [
    { dir: '伏笔', type: 'foreshadow' },
    { dir: '悬念', type: 'suspense' },
    { dir: '感情线', type: 'romance' },
  ]

  const insertStmt = db.prepare(`
    INSERT INTO threads (id, type, short_title, strength, status, opened_chapter, planned_end, last_advanced_chapter, file_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  for (const { dir, type } of types) {
    const threadDir = path.join(repoPath, '大纲', dir)

    try {
      const files = await fs.readdir(threadDir)

      for (const file of files) {
        if (!file.endsWith('.md')) continue

        const filePath = path.join(threadDir, file)
        const content = await fs.readFile(filePath, 'utf8')
        const parsed = parseFrontMatter(content)

        if (parsed.ok) {
          const fm = parsed.data
          const id = file.replace('.md', '').split('-').slice(0, 2).join('-') // 伏笔-001

          // 验证履历章节存在性
          const historySection = extractSection(parsed.body, '履历')
          if (historySection) {
            const historyChapters = parseHistoryChapters(historySection)
            for (const ch of historyChapters) {
              if (!chapterMap.has(ch)) {
                warnings.push(`条目 ${id} 履历引用章节 ${ch} 不存在`)
              }
            }
          }

          insertStmt.run(
            id,
            type,
            id, // short_title 简化为 id
            fm.强度 || '中',
            fm.状态 || '进行',
            fm.开启章 || 1,
            fm.预计收尾 || null,
            fm.最后推进章 || fm.开启章 || 1,
            filePath
          )
        }
      }
    } catch (err) {
      // 目录不存在，跳过
    }
  }
}

/**
 * 扫描信息差，填充 secrets 表。
 */
async function scanSecrets(repoPath, db) {
  const secretDir = path.join(repoPath, '定稿', '设定', '信息差')

  const insertStmt = db.prepare(`
    INSERT INTO secrets (id, short_title, known_to, reader_knows, registered_chapter, keywords, file_path)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)

  try {
    const files = await fs.readdir(secretDir)

    for (const file of files) {
      if (!file.endsWith('.md')) continue

      const filePath = path.join(secretDir, file)
      const content = await fs.readFile(filePath, 'utf8')
      const parsed = parseFrontMatter(content)

      if (parsed.ok) {
        const fm = parsed.data
        const id = file.replace('.md', '').split('-').slice(0, 2).join('-')

        insertStmt.run(
          id,
          id,
          JSON.stringify(fm.知情人 || []),
          fm.读者已知 ? 1 : 0,
          fm.登记章 || 1,
          JSON.stringify(fm.关键词 || []),
          filePath
        )
      }
    }
  } catch (err) {
    // 目录不存在，跳过
  }
}

/**
 * 解析名册，填充 entities + entity_aliases 表（验证别名唯一性）。
 * 名册非必需：缺失则跳过（角色卡可独立入 entities）；解析失败/别名冲突才算硬错。
 */
async function scanEntities(repoPath, db) {
  const rosterPath = path.join(repoPath, '定稿', '设定', '名册.md')
  const aliasMap = new Map() // alias → entity_id

  let content
  try {
    content = await fs.readFile(rosterPath, 'utf8')
  } catch {
    // 无名册：跳过（角色卡 scanCharacters 仍会入档），不算失败
    return { ok: true, errors: [] }
  }

  try {
    const table = parseMarkdownTable(content)

    if (!table.ok) {
      // 名册格式解析不动 → 软跳过（不阻断重建；chapters/threads/secrets 不应因此回滚）。
      // 别名冲突才是硬错（见下），走 ok:false 触发 ROLLBACK。
      return { ok: true, errors: [], warnings: [`名册解析失败，已跳过实体/别名入库：${table.error}`] }
    }

    const entityStmt = db.prepare(`
      INSERT INTO entities (id, type, status, location, realm, possessions, last_changed_chapter, file_path)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const aliasStmt = db.prepare(`
      INSERT INTO entity_aliases (alias, entity_id)
      VALUES (?, ?)
    `)

    for (const row of table.rows) {
      const entityId = row.正名
      const type = row.类型 || 'character'

      entityStmt.run(entityId, type, null, null, null, null, parseInt(row.首现章 || '1', 10), rosterPath)

      // 处理别名
      const aliases = row.别名.split(',').map((a) => a.trim()).filter((a) => a)
      for (const alias of aliases) {
        if (aliasMap.has(alias)) {
          return {
            ok: false,
            errors: [`别名冲突：「${alias}」同时指向「${aliasMap.get(alias)}」和「${entityId}」`],
          }
        }
        aliasMap.set(alias, entityId)
        aliasStmt.run(alias, entityId)
      }
    }

    return { ok: true, errors: [] }
  } catch (err) {
    return { ok: false, errors: [`名册扫描失败：${err.message}`] }
  }
}

/**
 * 扫描角色卡，填充 entities 表。
 */
async function scanCharacters(repoPath, db) {
  const charDir = path.join(repoPath, '定稿', '设定', '角色')

  // upsert：角色卡可能不在名册里（名册非强制全覆盖），只 UPDATE 会丢这些角色。
  // 在名册里则补全字段并把 file_path 指向更详细的角色卡。
  const upsertStmt = db.prepare(`
    INSERT INTO entities (id, type, status, location, realm, possessions, last_changed_chapter, file_path)
    VALUES (?, 'character', ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      location = excluded.location,
      realm = excluded.realm,
      possessions = excluded.possessions,
      last_changed_chapter = excluded.last_changed_chapter,
      file_path = excluded.file_path
  `)

  try {
    const files = await fs.readdir(charDir)

    for (const file of files) {
      if (!file.endsWith('.md')) continue

      const name = file.replace('.md', '')
      const filePath = path.join(charDir, file)
      const content = await fs.readFile(filePath, 'utf8')
      const parsed = parseFrontMatter(content)

      if (parsed.ok) {
        const fm = parsed.data
        upsertStmt.run(
          name,
          fm.状态 || null,
          fm.位置 || null,
          fm.境界 || null,
          JSON.stringify(fm.持有 || []),
          fm.最后变更章 || 1,
          filePath
        )
      }
    }
  } catch (err) {
    // 目录不存在，跳过
  }
}

/**
 * 从正文提取指定段落。
 */
function extractSection(body, sectionTitle) {
  const lines = body.split('\n')
  let inSection = false
  const sectionLines = []

  for (const line of lines) {
    if (line.startsWith('##')) {
      if (inSection) break
      if (line.includes(sectionTitle)) {
        inSection = true
        continue
      }
    }
    if (inSection) sectionLines.push(line)
  }

  return sectionLines.join('\n').trim()
}

/**
 * 解析履历中的章号。
 */
function parseHistoryChapters(historyText) {
  const chapters = []
  const lines = historyText.split('\n')

  for (const line of lines) {
    const match = line.match(/第(\d+)章/)
    if (match) {
      chapters.push(parseInt(match[1], 10))
    }
  }

  return chapters
}
