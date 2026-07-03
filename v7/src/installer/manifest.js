import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

/**
 * 模板哈希清单（multi-agent spec §8.2）：.webnovel/manifest.json 记录安装器写出的每个文件的
 * sha256。update 三态：unchanged(哈希==清单)→覆写新版;user-modified(!=)→跳过(--force 覆盖);
 * missing(文件没了)→重建。books.jsonl（用户数据）与 .claude/settings.json（合并式）不进清单。
 */

const MANIFEST_REL = path.join('.webnovel', 'manifest.json')

export function sha256(content) {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

export async function readManifest(workdir) {
  try {
    const raw = await fs.readFile(path.join(workdir, MANIFEST_REL), 'utf8')
    const m = JSON.parse(raw)
    if (m && typeof m === 'object' && m.files && typeof m.files === 'object') return m
    return null
  } catch {
    return null
  }
}

export async function writeManifest(workdir, { version, files }) {
  const p = path.join(workdir, MANIFEST_REL)
  await fs.mkdir(path.dirname(p), { recursive: true })
  // 键排序：清单可 diff、生成确定
  const sorted = {}
  for (const k of Object.keys(files).sort()) sorted[k] = files[k]
  await fs.writeFile(p, JSON.stringify({ version, files: sorted }, null, 2) + '\n', 'utf8')
}

/**
 * 三态判定。diskHash 传 null 表示文件不存在。
 * @returns {'new'|'unchanged'|'user-modified'|'missing'}
 */
export function classifyFile(relPath, diskHash, manifest) {
  const recorded = manifest?.files?.[relPath]
  if (!recorded) return 'new' // 清单没记过（首装/新增文件）→ 直接写
  if (diskHash == null) return 'missing' // 记过但文件没了 → 重建
  return diskHash === recorded ? 'unchanged' : 'user-modified'
}
