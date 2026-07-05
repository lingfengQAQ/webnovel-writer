import { promises as fs } from 'node:fs'
import path from 'node:path'
import { assembleBookStatus } from '../prep/book-status.js'
import { BookConfigReader } from '../storage/adapters/BookConfigReader.js'
import { readBatch, judgeStop, 章状态 } from '../staging/index.js'

/**
 * 为 AI 态组装上下文 DTO（M3 只备料，不调 AI）。M4 吃 DTO 出结构化产物，
 * 产物回流由 M3 落盘（M4 不碰文件）。每个 DTO 标注 `期望产物` 告诉 M4 该产出什么。
 * @param {{repoPath, cache}} ctx
 * @param {number} 序
 * @param {object} base 路由已知信息（failures / manualEdits / 现存与从哪继续 / 卷 / nextChapter）
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
    case 2:
      return {
        state: 'relink-manual-edits',
        变更文件: base.manualEdits || [],
        补登命令: 'relink --message=<一句话说明>',
        期望产物: '向作者出示变更清单问「补登吗」，确认后运行补登命令（fix(手改) 入档并刷新缓存）；不补登则按作者指示处理',
      }
    case 3:
      return {
        state: 'resume',
        工作区现存: base.现存 || [],
        从哪继续: base.从哪继续 || '',
        ...(await batchDetail(ctx, base)),
        期望产物: '按「从哪继续」回到写章流程对应步骤（spec §10 续跑映射）',
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
      const config = await new BookConfigReader(ctx.repoPath).read()
      const 自动确认细纲 = !!(config.ok && config.data.自动确认细纲)
      return {
        state: 'draft-outline',
        nextChapter: base.nextChapter,
        全书近况: status.ok ? status.markdown : '',
        自动确认细纲,
        期望产物: 自动确认细纲
          ? '工作区/细纲.md（含本章定位声明 + 本章要写到的事 + 备选，由 M3 落盘）；自动确认细纲已开：提案直接 persist-outline 生效，不再问作者；卷近尾声时提案可含收卷提议'
          : '工作区/细纲.md（含本章定位声明 + 本章要写到的事 + 备选，由 M3 落盘）；卷近尾声时提案可含收卷提议（依据卷纲进度与卷规模参考值，作者确认后定稿写入 收卷: 是）',
      }
    }
    default:
      return { state: base.state || 'unknown' }
  }
}

// 序 3 的待定稿批次明细（无批次时不加字段）
async function batchDetail(ctx, base) {
  if (!(base.现存 || []).includes('待定稿/')) return {}
  const batch = await readBatch(ctx.repoPath)
  if (!batch.exists) return {}
  const 打回 = batch.章列表.filter((r) => r.状态 === 章状态.打回).map((r) => r.章号)
  const 受影响 = batch.章列表.filter((r) => r.状态 === 章状态.受影响).map((r) => r.章号)
  const 停止 = await judgeStop(ctx, batch)
  let 建议
  if (打回.length) {
    建议 = `重写打回章（第 ${打回.join('、')} 章）：走写章流程后 stage-chapter 覆盖`
  } else if (受影响.length) {
    建议 = `重审受影响章（第 ${受影响.join('、')} 章）：重跑两审 save-review 后 batch-restage`
  } else if (停止.stop) {
    建议 = '批次已停：batch-status 呈报作者批量过稿，裁决后 finalize-batch'
  } else {
    建议 = `继续批内下一章（第 ${batch.章列表[batch.章列表.length - 1].章号 + 1} 章）`
  }
  return {
    批次: {
      起章: batch.起章,
      章数: batch.章列表.length,
      章: batch.章列表.map((r) => ({ 章号: r.章号, 标题: r.标题, 状态: r.状态 })),
      停止,
      建议,
    },
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
