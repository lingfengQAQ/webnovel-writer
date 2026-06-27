import { DatabaseSync } from 'node:sqlite'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { SCHEMA_SQL } from './schema.js'
import { rebuildCache } from './rebuilder.js'

/**
 * CacheManager：管理 .cache/index.db 五表。
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
    // 检查 db 文件是否存在
    try {
      await fs.access(this.dbPath)
    } catch (err) {
      // 不存在，先创建目录
      const dir = path.dirname(this.dbPath)
      await fs.mkdir(dir, { recursive: true })
      // 重建
      return this.rebuildFromSource(repoPath)
    }

    // 打开现有数据库
    try {
      this.db = new DatabaseSync(this.dbPath)
      // 验证表是否存在
      const tables = this.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all()
      if (tables.length === 0) {
        // 空数据库，重建
        this.db.close()
        return this.rebuildFromSource(repoPath)
      }
    } catch (err) {
      // 损坏，重建
      return this.rebuildFromSource(repoPath)
    }
  }

  /**
   * 全量重建缓存。
   * @param {string} repoPath
   * @returns {Promise<{ok: boolean, warnings: string[], errors: string[]}>}
   */
  async rebuildFromSource(repoPath) {
    // 关闭现有连接
    if (this.db) {
      this.db.close()
      this.db = null
    }

    // 删除旧数据库
    try {
      await fs.unlink(this.dbPath)
    } catch (err) {
      // 文件不存在，忽略
    }

    // 确保 .cache 目录存在：rebuildFromSource 可被直接调用，不保证先过 ensureReady
    await fs.mkdir(path.dirname(this.dbPath), { recursive: true })

    // 创建新数据库
    this.db = new DatabaseSync(this.dbPath)

    // 执行 DDL
    this.db.exec(SCHEMA_SQL)

    // 调用重建器
    const result = await rebuildCache(repoPath, this.db)

    return result
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
