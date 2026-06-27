/**
 * ThreadLedgerWriter：更新条目、追加履历（M2 落地，本任务只定接口占位）。
 */
export class ThreadLedgerWriter {
  constructor(repoPath, cache = null) {
    this.repoPath = repoPath
    this.cache = cache
  }

  /**
   * 更新条目状态。
   * @param {string} threadId
   * @param {object} updates
   * @returns {Promise<{ok: boolean, error: string}>}
   */
  async updateThread(threadId, updates) {
    throw new Error('ThreadLedgerWriter.updateThread() 将在 M2 定稿流程中实现')
  }

  /**
   * 追加履历条目。
   * @param {string} threadId
   * @param {object} historyEntry
   * @returns {Promise<{ok: boolean, error: string}>}
   */
  async appendHistory(threadId, historyEntry) {
    throw new Error('ThreadLedgerWriter.appendHistory() 将在 M2 定稿流程中实现')
  }
}
