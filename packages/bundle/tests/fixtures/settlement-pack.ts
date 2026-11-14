import fs from 'node:fs'
import path from 'node:path'
import { paths, preparePack, serializeDocument, type ChapterKey } from '@webnovel/core'

/** Ask/host fixtures must reach approval with a real prepared inventory. */
export function settlementPack(root: string, bookId: string, chapter: ChapterKey, prose = '作者已核对的待定稿正文。') {
  const key = { 卷: chapter.卷, 章: chapter.章, 章名: chapter.章名 }
  const contract = path.join(root, paths.契约())
  if (!fs.existsSync(contract)) {
    fs.mkdirSync(path.dirname(contract), { recursive: true })
    fs.writeFileSync(contract, serializeDocument({ 书id: bookId }, '# 作品契约\n'))
  }
  const draftDir = paths.草稿目录(chapter.卷, chapter.章名)
  fs.mkdirSync(path.join(root, draftDir), { recursive: true })
  const sourceDraft = `${draftDir}/稿1.md`
  fs.writeFileSync(path.join(root, sourceDraft), serializeDocument({ 身份: key, 角色: '待审稿', 选定: true, 版本: 1, 父版本: null }, prose))
  const result = preparePack(root, key)
  if (!result.ok) throw new Error(result.reason)
  return { sourceDraft, packageDir: result.dir }
}
