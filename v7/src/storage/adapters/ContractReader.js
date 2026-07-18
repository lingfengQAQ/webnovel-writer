import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  CONTRACT_REVIEW_SECTIONS,
  CONTRACT_WRITING_SECTIONS,
  WORK_CONTRACT_PATH,
  renderContractSections,
  validateWorkContract,
} from '../../knowledge/contract.js'

export class ContractReader {
  constructor(repoPath) {
    this.repoPath = repoPath
  }

  async read() {
    try {
      const content = await fs.readFile(
        path.join(this.repoPath, ...WORK_CONTRACT_PATH.split('/')),
        'utf8'
      )
      const validation = validateWorkContract(content)
      if (!validation.ok) {
        return {
          ok: false,
          data: null,
          content: '',
          error: '作品契约结构不完整：' + validation.errors.join('；'),
        }
      }
      return { ok: true, data: validation.data, content, error: '' }
    } catch {
      return { ok: false, data: null, content: '', error: '作品契约/作品契约.md 不存在' }
    }
  }

  async readWritingSections() {
    return this.readSections(CONTRACT_WRITING_SECTIONS)
  }

  async readReviewSections() {
    return this.readSections(CONTRACT_REVIEW_SECTIONS)
  }

  async readSections(names) {
    const result = await this.read()
    if (!result.ok) return { ...result, content: '' }
    return {
      ok: true,
      data: result.data,
      content: renderContractSections(result.data, names),
      error: '',
    }
  }
}
