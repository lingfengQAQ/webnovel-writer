import { DatabaseSync } from 'node:sqlite'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema.js'
import { rebuildCache } from './rebuilder.js'

let rebuildCounter = 0

/**
 * 改源流程统一的缓存刷新（P1-2）：finalize/goto/retcon/卷复盘/修复补登等改了源文件的路径,
 * 成功尾部必须自刷——ensureReady 只兜「缺失/损坏」,不感知源变更。
 * 失败不抛：作废旧缓存（防陈旧数据驱动后续判定）,返回结果供上层如实上报,下次命令自动重建。
 */
export async function refreshCacheAfterSourceChange(ctx) {
  if (!ctx.cache) return null
  try {
    // 源变了 → 体检产出的 imagery_top 已陈旧，一并作废（宁可无提醒不给过时提醒），
    // 下次体检重算；裸重建（删缓存/ensureReady）不经此路径，imagery_top 照常保留。
    return await ctx.cache.rebuildFromSource(ctx.repoPath, {
      keepExistingOnFailure: false,
      preserveDerived: false,
    })
  } catch (err) {
    return { ok: false, warnings: [], errors: [`缓存刷新失败：${err.message}`] }
  }
}

/**
 * CacheManager：管理 .cache/index.db 六表（含 entity_aliases）。
 */
export class CacheManager {
  constructor(dbPath) {
    this.dbPath = dbPath
    this.db = null
  }

  /**
   * 确保数据库就绪（不存在或损坏 → 重建）。
   * @param {string} repoPath - 书仓库根目录
   * @returns {Promise<void>}
   */
  async ensureReady(repoPath) {
    let needsRebuild = false

    try {
      await fs.access(this.dbPath)
    } catch (err) {
      const dir = path.dirname(this.dbPath)
      await fs.mkdir(dir, { recursive: true })
      needsRebuild = true
    }

    if (!needsRebuild) {
      try {
        this.db = new DatabaseSync(this.dbPath)
        const tables = this.db
          .prepare("SELECT name FROM sqlite_master WHERE type='table'")
          .all()
        if (tables.length === 0 || !this._schemaVersionMatches()) {
          this.db.close()
          this.db = null
          needsRebuild = true
        }
      } catch (err) {
        if (this.db) {
          try {
            this.db.close()
          } catch {
            // 忽略关闭失败
          }
        }
        this.db = null
        needsRebuild = true
      }
    }

    if (needsRebuild) {
      const result = await this.rebuildFromSource(repoPath)
      if (!result.ok) throw new Error(`缓存重建失败：${result.errors.join('；')}`)
      return result
    }

    return { ok: true, warnings: [], errors: [] }
  }

  /**
   * 全量重建缓存。
   * @param {string} repoPath
   * @param {{keepExistingOnFailure?: boolean, preserveDerived?: boolean}} [opts]
   *   preserveDerived=false 时不保留体检派生物（imagery_top）——改源刷新用，防陈旧提醒
   * @returns {Promise<{ok: boolean, warnings: string[], errors: string[]}>}
   */
  async rebuildFromSource(repoPath, opts = {}) {
    const { keepExistingOnFailure = true, preserveDerived = true } = opts
    let hadExisting = false
    try {
      await fs.access(this.dbPath)
      hadExisting = true
    } catch {
      hadExisting = false
    }

    // 保留 meta 运行标记（如上次体检章号）跨重建：读不到就从零开始（体检重测无害）
    let preservedMeta = []
    if (hadExisting) {
      try {
        const src = this.db || new DatabaseSync(this.dbPath)
        try {
          preservedMeta = src
            .prepare("SELECT key, value FROM meta WHERE key != 'schema_version'")
            .all()
        } finally {
          if (!this.db) src.close()
        }
      } catch {
        preservedMeta = []
      }
    }
    if (!preserveDerived) {
      preservedMeta = preservedMeta.filter((row) => row.key !== 'imagery_top')
    }

    // 关闭现有连接
    if (this.db) {
      this.db.close()
      this.db = null
    }

    // 确保 .cache 目录存在：rebuildFromSource 可被直接调用，不保证先过 ensureReady
    await fs.mkdir(path.dirname(this.dbPath), { recursive: true })

    const tmpPath = `${this.dbPath}.rebuild.${process.pid}.${rebuildCounter++}`
    let tmpDb = null
    try {
      tmpDb = new DatabaseSync(tmpPath)
      tmpDb.exec(SCHEMA_SQL)
      const metaStmt = tmpDb.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)')
      metaStmt.run('schema_version', String(SCHEMA_VERSION))
      for (const row of preservedMeta) metaStmt.run(row.key, row.value)
      const result = await rebuildCache(repoPath, tmpDb)
      tmpDb.close()
      tmpDb = null

      if (!result.ok) {
        await fs.rm(tmpPath, { force: true })
        await this._handleFailedRebuild(hadExisting, keepExistingOnFailure)
        return result
      }

      await fs.rm(this.dbPath, { force: true })
      await fs.rename(tmpPath, this.dbPath)
      this.db = new DatabaseSync(this.dbPath)
      return result
    } catch (err) {
      if (tmpDb) {
        try {
          tmpDb.close()
        } catch {
          // 忽略关闭失败
        }
      }
      await fs.rm(tmpPath, { force: true })
      await this._handleFailedRebuild(hadExisting, keepExistingOnFailure)
      return { ok: false, warnings: [], errors: [`重建失败：${err.message}`] }
    }
  }

  async _handleFailedRebuild(hadExisting, keepExistingOnFailure) {
    if (!hadExisting) return
    if (keepExistingOnFailure) {
      this.db = new DatabaseSync(this.dbPath)
      return
    }
    try {
      await fs.rm(this.dbPath, { force: true })
    } catch {
      // 删除失败时保持关闭状态，后续 git 健康/缓存重建路径会兜底
    }
  }

  _schemaVersionMatches() {
    try {
      const row = this.db
        .prepare("SELECT value FROM meta WHERE key = 'schema_version'")
        .get()
      return row?.value === String(SCHEMA_VERSION)
    } catch {
      return false // 无 meta 表 = 旧 schema
    }
  }

  /**
   * 执行查询。
   * @param {string} sql
   * @param {any[]} params
   * @returns {Promise<any[]>}
   */
  async query(sql, params = []) {
    if (!this.db) {
      throw new Error('数据库未初始化')
    }

    const stmt = this.db.prepare(sql)
    return stmt.all(...params)
  }

  /**
   * 执行写语句（INSERT/UPDATE/DELETE）。
   * @param {string} sql
   * @param {any[]} params
   */
  async run(sql, params = []) {
    if (!this.db) {
      throw new Error('数据库未初始化')
    }
    return this.db.prepare(sql).run(...params)
  }

  /**
   * 关闭数据库连接。
   * @returns {Promise<void>}
   */
  async close() {
    if (this.db) {
      this.db.close()
      this.db = null
    }
  }
}
