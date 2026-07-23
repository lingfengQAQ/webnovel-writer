import { promises as fs } from 'node:fs'
import path from 'node:path'
import { readBatch, judgeStop } from '../staging/index.js'

/**
 * batch-status [--json]：待定稿批次全貌——各章状态、审稿单问题摘要、停止条件判定。
 * 作者批量过稿的呈报数据面；--json 给宿主程序消费。
 * 契约：纯返回 {ok, output?, error?}。
 */
export async function run(args, options, ctx) {
  const batch = await readBatch(ctx.repoPath)
  if (!batch.exists) {
    return { ok: false, error: '没有进行中的待定稿批次（连写用 stage-chapter 暂存后再看）' }
  }

  const 停止 = await judgeStop(ctx, batch)
  const 章 = []
  for (const row of batch.章列表) {
    const 审稿 = await reviewDigest(ctx.repoPath, row.目录)
    const 草稿路径 = await stagedDraftPath(ctx.repoPath, row)
    章.push({
      章号: row.章号,
      标题: row.标题,
      状态: row.状态,
      审稿,
      ...(草稿路径 ? { 草稿路径 } : {}),
    })
  }

  if (options.json) {
    return {
      ok: true,
      output: JSON.stringify({ 起章: batch.起章, 章: 章, 停止, warnings: batch.warnings }, null, 2),
    }
  }

  const 尾章 = batch.章列表[batch.章列表.length - 1].章号
  const lines = [`待定稿批次：第 ${batch.起章}-${尾章} 章，共 ${章.length} 章。`, '']
  for (const c of 章) {
    const 草稿 = c.草稿路径 ? `｜草稿路径：${c.草稿路径}` : ''
    lines.push(`- 第 ${c.章号} 章《${c.标题}》｜${c.状态}｜${c.审稿}${草稿}`)
  }
  lines.push('')
  if (停止.stop) {
    lines.push('停止条件已命中：')
    for (const reason of 停止.reasons) lines.push(`- ${reason}`)
  } else {
    lines.push('停止条件未命中，批次还能继续写。')
  }
  for (const w of batch.warnings) lines.push(`提醒：${w}`)
  return { ok: true, output: lines.join('\n') }
}

async function reviewDigest(repoPath, dirName) {
  try {
    const md = await fs.readFile(
      path.join(repoPath, '工作区', '待定稿', dirName, '审稿单.md'),
      'utf8'
    )
    const m = md.match(/共 (\d+) 个问题：(\d+) 阻断/)
    if (m) return `审稿：${m[1]} 个问题（${m[2]} 阻断）`
    return '审稿：已附审稿单'
  } catch {
    return '审稿：无审稿单（打回待重写或工件缺失）'
  }
}

async function stagedDraftPath(repoPath, row) {
  if (!/^\d{4}-[^\\/]*$/.test(String(row.目录 || ''))) return ''

  const relative = path.posix.join('工作区', '待定稿', row.目录, '草稿.md')
  try {
    const stat = await fs.stat(path.join(repoPath, ...relative.split('/')))
    return stat.isFile() ? relative : ''
  } catch {
    return ''
  }
}
