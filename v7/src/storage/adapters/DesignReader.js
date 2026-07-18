import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  DESIGN_CLASSES,
  DESIGN_ROOT,
  isDesignPath,
  validateDesignRegistry,
  validateDesignContent,
} from '../../knowledge/design.js'

export class DesignReader {
  constructor(repoPath) {
    this.repoPath = repoPath
  }

  async list() {
    const objects = []
    const errors = []
    for (const classification of DESIGN_CLASSES) {
      const dir = path.join(this.repoPath, ...DESIGN_ROOT.split('/'), classification)
      let files
      try {
        files = (await fs.readdir(dir, { withFileTypes: true }))
          .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
          .map((entry) => entry.name)
          .sort(compareCodePoints)
      } catch (err) {
        if (err.code !== 'ENOENT') errors.push(`${classification}计划目录读取失败：${err.message}`)
        continue
      }
      for (const file of files) {
        const rel = path.posix.join(DESIGN_ROOT, classification, file)
        try {
          const content = await fs.readFile(path.join(this.repoPath, ...rel.split('/')), 'utf8')
          const parsed = validateDesignContent(content, { classification })
          if (!parsed.ok) {
            errors.push(`${rel}：${parsed.errors.join('；')}`)
            continue
          }
          objects.push({ ...parsed.data, path: rel })
        } catch (err) {
          errors.push(`${rel} 读取失败：${err.message}`)
        }
      }
    }
    errors.push(...validateDesignRegistry(objects))
    return { ok: errors.length === 0, objects, errors }
  }

  async read(reference) {
    const result = await this.readMany([reference])
    if (!result.ok) return { ok: false, data: null, error: result.error }
    if (!result.objects.length) {
      return { ok: false, data: null, error: `未找到计划对象「${String(reference || '').trim()}」` }
    }
    return { ok: true, data: result.objects[0], error: '' }
  }

  async readMany(references, { excludePaths = new Set() } = {}) {
    const listed = await this.list()
    if (!listed.ok) return { ok: false, objects: [], missing: [], error: listed.errors.join('；') }
    const objects = []
    const missing = []
    const seen = new Set()
    for (const raw of Array.isArray(references) ? references : []) {
      const reference = String(raw || '').trim()
      if (!reference) continue
      const object = listed.objects.find(
        (item) => item.ID === reference || item.名称 === reference || item.正名 === reference
      )
      if (!object || excludePaths.has(object.path)) {
        missing.push(reference)
        continue
      }
      if (!seen.has(object.path)) objects.push(object)
      seen.add(object.path)
    }
    return { ok: true, objects, missing, error: '' }
  }

  async readPath(planPath) {
    if (!isDesignPath(planPath)) return { ok: false, data: null, error: '计划对象路径不合法' }
    const parts = planPath.split('/')
    try {
      const content = await fs.readFile(path.join(this.repoPath, ...parts), 'utf8')
      const parsed = validateDesignContent(content, { classification: parts[2] })
      return parsed.ok
        ? { ok: true, data: { ...parsed.data, path: planPath }, error: '' }
        : { ok: false, data: null, error: parsed.errors.join('；') }
    } catch (err) {
      return { ok: false, data: null, error: `计划对象不存在：${err.message}` }
    }
  }
}

function compareCodePoints(a, b) {
  return a < b ? -1 : a > b ? 1 : 0
}
