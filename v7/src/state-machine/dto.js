import { promises as fs } from 'node:fs'
import path from 'node:path'
import { assembleBookStatus } from '../prep/book-status.js'

/**
 * 为 AI 态组装上下文 DTO（M3 只备料，不调 AI）。M4 吃 DTO 出结构化产物，
 * 产物回流由 M3 落盘（M4 不碰文件）。每个 DTO 标注 `期望产物` 告诉 M4 该产出什么。
 * @param {{repoPath, cache}} ctx
 * @param {number} 序
 * @param {object} base 路由已知信息（failures / 卷 / nextChapter）
 */
export async function buildDto(ctx, 序, base = {}) {
  switch (序) {
    case 0:
      return {
        state: 'repair-confirm',
        failures: base.failures || [],
        期望产物: '逐个给出「保留作者意图」的修复方案，作者确认后由 M3 写回',
      }
    case 1:
      return {
        state: 'create-book',
        缺: await whatsMissing(ctx),
        期望产物: '问答生成 book.yaml + 总纲 + 第一卷卷纲（由 M3 落盘 + 登记 books.jsonl）',
      }
    case 4: {
      const status = await assembleBookStatus(ctx)
      return {
        state: 'volume-review',
        卷: base.卷,
        全书近况: status.ok ? status.markdown : '',
        悬了太久: status.ok ? status.data.悬了太久 : [],
        期望产物: '卷摘要 + 下卷卷纲 + 伏笔机会候选（作者勾选后 M3 生成条目）',
      }
    }
    case 6: {
      const status = await assembleBookStatus(ctx)
      return {
        state: 'draft-outline',
        nextChapter: base.nextChapter,
        全书近况: status.ok ? status.markdown : '',
        期望产物: '工作区/细纲.md（含本章定位声明 + 本章要写到的事 + 备选，由 M3 落盘）；卷近尾声时提案可含收卷提议（依据卷纲进度与卷规模参考值，作者确认后定稿写入 收卷: 是）',
      }
    }
    default:
      return { state: base.state || 'unknown' }
  }
}

async function whatsMissing(ctx) {
  if (!ctx.repoPath) return ['book.yaml', '总纲'] // 空工作目录：书仓库还不存在
  const missing = []
  for (const [label, rel] of [
    ['book.yaml', 'book.yaml'],
    ['总纲', '大纲/总纲.md'],
  ]) {
    try {
      await fs.access(path.join(ctx.repoPath, rel))
    } catch {
      missing.push(label)
    }
  }
  return missing
}
